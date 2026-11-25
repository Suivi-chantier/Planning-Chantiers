// Vérification du redressement du nouvel éditeur de plans (projet
// docs/projets/editeur-plans.md, tâche 2, règle 3) : angles presque droits
// ramenés à 90°, côtés presque alignés alignés, faces d'un mur rendues
// parallèles — dans la tolérance, sinon point à valider.
//
// Jeux de test :
//  • des logements dessinés à la main ou tirés au sort (graine fixe) dans ce
//    fichier : exemples issus des tests, données fictives ;
//  • le relevé de référence ANONYMISÉ de scripts/fixtures/ (6 pièces), le même
//    que scripts/verif-releve-imapper.mjs. Aucun relevé réel n'est versionné.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assemblerReleve, lirePdfImapper, calculerMetres, texteMetre, geometrieOuverture, pointsAValider, airePolygone, longueursCotes,
} from "../src/Renovation/releveImapper.mjs";
import { construireModeleExistant, bilanModele } from "../src/Renovation/planV2/planV2Modele.mjs";
import {
  redresserReleve, appliquerPointRedressement, directionsDominantes, mesurerEcart, bilanDeplacement,
  TOLERANCES_REDRESSEMENT, NATURES_REDRESSEMENT, EPSILON_M,
} from "../src/Renovation/planV2/planV2Redressement.mjs";

const ici = path.dirname(fileURLToPath(import.meta.url));
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg} : ${a} ≠ ${b} (± ${tol})`);
const DEG = 180 / Math.PI, tan = (deg) => Math.tan(deg / DEG);

// ── Logements fictifs ──────────────────────────────────────────────────────
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const piece = (id, polygone) => ({
  id, nom: `Pièce ${id}`, type: "autre", polygone, hsp: 2.5, hsp_statut: "defaut", photos: [], observations: [],
});
const releve = (pieces, murs = [], ouvertures = null) => ({
  version: 1, source: { outil: "imapper", projet: "TEST" }, pieces,
  murs: murs.map((polygone) => ({ polygone })), ouvertures, points: {}, scanners: {}, alertes: [],
});
const ouverture = (id, pieceId, mur, t0, t1, plus = {}) => ({
  id, code: id.toUpperCase(), piece: pieceId, mur, t0, t1, type: "porte", pieces_liees: [pieceId], statut: "detecte",
  sens: { charniere: "t0", cote: "interieur" }, hauteur: null, allege: null, origine: "detection", epaisseur: 0.1, masque: false, ...plus,
});
const tourner = (P, deg, C = [0, 0]) => {
  const a = deg / DEG, co = Math.cos(a), si = Math.sin(a);
  return P.map(([x, y]) => [C[0] + (x - C[0]) * co - (y - C[1]) * si, C[1] + (x - C[0]) * si + (y - C[1]) * co]);
};
const geler = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(geler); } return o; };
const poly = (R, id) => R.pieces.find((p) => p.id === id).polygone;
// Angle intérieur (°) au sommet k d'un polygone.
const angle = (P, k) => {
  const n = P.length, a = P[(k - 1 + n) % n], b = P[k], c = P[(k + 1) % n];
  const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]];
  return Math.acos((u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))) * DEG;
};
// Direction (°, entre 0 et 180) du côté k.
const direction = (P, k) => { const a = P[k], b = P[(k + 1) % P.length]; return ((Math.atan2(b[1] - a[1], b[0] - a[0]) * DEG) % 180 + 180) % 180; };
const natures = (liste) => liste.map((x) => x.nature).sort().join(",");

// Redresse en vérifiant ce qui doit être vrai de TOUT redressement : entrée
// non modifiée, même forme, tolérance jamais dépassée, deuxième passe sans effet.
function redresser(R, options = {}) {
  const T = { ...TOLERANCES_REDRESSEMENT, ...(options.tolerances || {}) };
  const avant = JSON.stringify(R);
  geler(R);                                   // toute écriture dans le relevé lèverait une erreur
  const X = redresserReleve(R, options);
  assert.equal(JSON.stringify(R), avant, "le relevé d'entrée n'est pas modifié");
  const S = X.releve;
  // Même forme : mêmes clés, mêmes pièces, mêmes nombres de côtés, mêmes ouvertures.
  assert.deepEqual(Object.keys(S), Object.keys(R), "mêmes clés");
  assert.deepEqual(S.pieces.map((p) => [p.id, p.polygone.length]), R.pieces.map((p) => [p.id, p.polygone.length]), "mêmes pièces, mêmes nombres de côtés");
  assert.deepEqual(S.murs.map((m) => m.polygone.length), R.murs.map((m) => m.polygone.length), "mêmes murs dessinés");
  if (R.ouvertures === null) assert.equal(S.ouvertures, null, "ouvertures pas encore relevées : null reste null");
  else assert.deepEqual(S.ouvertures.map((o) => [o.id, o.piece, o.mur]), R.ouvertures.map((o) => [o.id, o.piece, o.mur]), "mêmes ouvertures, même côté");
  assert.deepEqual([S.points, S.scanners, S.alertes], [R.points, R.scanners, R.alertes], "mesures brutes et alertes inchangées");
  // Tolérance : aucun sommet à plus de deplacementMax de sa position relevée,
  // aucun côté tourné de plus de angleMaxDeg, quel que soit le cumul.
  R.pieces.forEach((p, i) => {
    const m = mesurerEcart(p.polygone, S.pieces[i].polygone);
    m.deplacements.forEach((d, k) => assert.ok(d <= T.deplacementMax + 1e-9, `${p.id} sommet ${k} déplacé de ${d} m`));
    m.rotations.forEach((r, k) => assert.ok(r <= T.angleMaxDeg + 1e-6, `${p.id} côté ${k} tourné de ${r}°`));
    assert.ok(!m.renverses.some(Boolean), `${p.id} : aucun côté renversé`);
    S.pieces[i].polygone.flat().forEach((v) => assert.ok(Number.isFinite(v), "coordonnées finies"));
  });
  assert.deepEqual({ ...bilanDeplacement(R, S), corrections: X.bilan.corrections, points_a_valider: X.bilan.points_a_valider }, X.bilan, "bilan = écart mesuré");
  for (const c of X.corrections) {
    assert.ok(NATURES_REDRESSEMENT.includes(c.nature) && c.cotes.length && c.pieces.length, c.cle);
    assert.ok(c.deplacement_m <= T.deplacementMax + 1e-9 && c.rotation_deg <= T.angleMaxDeg + 1e-6, `${c.cle} : ${c.deplacement_m} m, ${c.rotation_deg}°`);
  }
  const cles = X.points_a_valider.map((p) => p.cle);
  assert.equal(new Set(cles).size, cles.length, "clés de points uniques");
  for (const p of X.points_a_valider) {
    assert.ok(NATURES_REDRESSEMENT.includes(p.nature) && p.code === `redressement_${p.nature}` && p.raison && p.texte && p.cible.type === "piece", p.cle);
    assert.ok(p.applicable ? p.correction.cotes.length > 0 && p.deplacement_m != null : p.correction === null, `${p.cle} : correction jointe ou absente`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(X)), X, "le résultat s'enregistre tel quel (JSON)");
  // Les métrés et le modèle de la tâche 1 s'appliquent tels quels au relevé redressé.
  for (const l of calculerMetres(S).pieces) assert.ok(Number.isFinite(l.sol) && Number.isFinite(l.perimetre), "métrés calculables");
  assert.equal(bilanModele(construireModeleExistant(S)).cotes, R.pieces.reduce((t, p) => t + p.polygone.length, 0), "modèle : mêmes côtés");
  // Idempotence : redresser le relevé redressé ne déplace plus rien.
  const X2 = redresserReleve(S, options);
  assert.equal(JSON.stringify(X2.releve), JSON.stringify(S), "deuxième passe : relevé identique");
  assert.deepEqual(X2.corrections, [], "deuxième passe : aucune correction");
  assert.deepEqual(X2.points_a_valider.map((p) => [p.cle, p.raison]), X.points_a_valider.map((p) => [p.cle, p.raison]), "deuxième passe : mêmes points à valider");
  return X;
}

// Deux pièces séparées par une cloison de 10 cm, murs extérieurs de 30 cm.
const mursDeux = [rect(4, 0, 4.1, 3), rect(-0.3, -0.3, 0, 3.3), rect(7, -0.3, 7.3, 3.3), rect(0, -0.3, 7, 0), rect(0, 3, 7, 3.3)];
const deuxPieces = (B = rect(4.1, 0, 7, 3), ouvertures = null) => releve([piece("A", rect(0, 0, 4, 3)), piece("B", B)], mursDeux, ouvertures);
// Pièce A (qui donne la direction du logement) et un quadrilatère B dont le
// côté droit penche de `deg` degrés : ses angles valent 90° + deg et 90° − deg.
const penche = (deg, h = 3) => releve([piece("A", rect(0, 0, 6, 4)), piece("B", [[7, 0], [10, 0], [10 + h * tan(deg), h], [7, h]])]);

test("logement déjà droit : rien ne bouge, le relevé rendu est le même objet", () => {
  const R = deuxPieces(), X = redresser(R);
  assert.equal(X.releve, R, "aucune copie quand rien ne change");
  assert.deepEqual([X.corrections, X.points_a_valider], [[], []]);
  assert.deepEqual(X.bilan.sommets_deplaces, 0);
  assert.equal(X.directions.length, 1);
  proche(X.directions[0].angle_deg, 0, 1e-9, "direction dominante");
  assert.deepEqual(X.tolerances, { ...TOLERANCES_REDRESSEMENT }, "tolérances de départ : 1 cm et 0,5°");
  assert.deepEqual([X.tolerances.deplacementMax, X.tolerances.angleMaxDeg], [0.01, 0.5]);
});

test("relevé absent, vide, ou pièce sans contour : rien à redresser, rien ne casse", () => {
  for (const R of [null, undefined, {}, releve([]), releve([piece("A", [])])]) {
    const X = redresserReleve(R);
    assert.equal(X.releve, R);
    assert.deepEqual([X.corrections, X.points_a_valider, X.directions, X.bilan.sommets], [[], [], [], 0]);
  }
  const seule = releve([piece("A", [[0, 0], [4, 0.01], [4.02, 3], [0, 3]])]);
  assert.ok(redresser(seule).releve.pieces.length === 1, "une seule pièce : redressée sur sa propre direction");
});

test("rectangle légèrement de travers (0,1°) : remis d'équerre d'un bloc, ses dimensions ne changent pas", () => {
  const B0 = rect(4.1, 0, 7, 3), B = tourner(B0, 0.1, [5.55, 1.5]);
  const R = deuxPieces(B), X = redresser(R);
  assert.equal(natures(X.corrections), "angle");
  assert.equal(X.corrections[0].cotes.length, 4, "les quatre côtés forment un seul groupe");
  proche(X.corrections[0].rotation_deg, 0.1, 1e-6, "rotation");
  const Q = poly(X.releve, "B");
  Q.forEach((q, k) => { proche(angle(Q, k), 90, 1e-9, `angle ${k}`); proche(q[0], B0[k][0], 1e-9, "x"); proche(q[1], B0[k][1], 1e-9, "y"); });
  longueursCotes(Q).forEach((l, k) => proche(l, longueursCotes(B)[k], 1e-9, `longueur du côté ${k}`));
  proche(airePolygone(Q), airePolygone(B), 1e-9, "surface");
  assert.deepEqual(poly(X.releve, "A"), poly(R, "A"), "la pièce droite ne bouge pas");
  // Le mur partagé A | B a maintenant deux faces parallèles et une épaisseur constante.
  const m = construireModeleExistant(X.releve).existant.murs.find((x) => x.type === "partage");
  assert.equal(m.angle_faces_deg, 0);
  proche(m.epaisseur_min, m.epaisseur_max, 1e-9, "épaisseur constante");
});

test("angle à 89,7° : ramené à 90° (dans la tolérance), sans toucher au reste", () => {
  const R = penche(0.3), X = redresser(R), P = poly(R, "B"), Q = poly(X.releve, "B");
  proche(angle(P, 2), 89.7, 1e-6, "avant");
  assert.equal(natures(X.corrections), "angle");
  assert.deepEqual(X.corrections[0].cotes, [{ piece: "B", cote: 1 }]);
  proche(X.corrections[0].rotation_deg, 0.3, 1e-6, "rotation");
  proche(X.corrections[0].deplacement_m, 1.5 * Math.sin(0.3 / DEG), 1e-5, "le côté tourne autour de son milieu");
  Q.forEach((_, k) => proche(angle(Q, k), 90, 1e-9, `angle ${k}`));
  assert.deepEqual(X.points_a_valider, []);
  assert.equal(poly(X.releve, "A"), poly(R, "A"), "pièce A : même polygone");
});

test("angle à 87° : NON ramené, point à valider ; appliqué ensuite sur action de l'utilisateur", () => {
  const R = penche(3), X = redresser(R);
  assert.equal(X.releve, R, "rien n'est déplacé en silence");
  assert.deepEqual(X.corrections, []);
  assert.equal(X.points_a_valider.length, 1);
  const p = X.points_a_valider[0];
  assert.deepEqual([p.nature, p.code, p.raison, p.applicable], ["angle", "redressement_angle", "rotation", true]);
  assert.deepEqual(p.cible, { type: "piece", id: "B" });
  assert.deepEqual(p.cotes, [{ piece: "B", cote: 1 }]);
  proche(p.rotation_deg, 3, 1e-6, "rotation proposée");
  proche(p.deplacement_m, 1.5 * Math.sin(3 / DEG), 1e-3, "déplacement proposé");
  assert.ok(p.deplacement_m > X.tolerances.deplacementMax && /Pièce B/.test(p.texte), p.texte);
  // Application : nouveau relevé, l'ancien intact, l'angle vaut 90°.
  const avant = JSON.stringify(R), S = appliquerPointRedressement(R, p), Q = poly(S, "B");
  assert.equal(JSON.stringify(R), avant);
  Q.forEach((_, k) => proche(angle(Q, k), 90, 1e-9, `angle ${k} après application`));
  const m = mesurerEcart(poly(R, "B"), Q);
  proche(Math.max(...m.deplacements), p.deplacement_m, 1e-6, "l'ampleur annoncée est celle de l'application");
  assert.deepEqual(redresser(S).points_a_valider, [], "plus rien à valider ensuite");
  // Tolérances réglables : à 10 cm et 4°, la même correction est appliquée.
  const large = redresser(penche(3), { tolerances: { deplacementMax: 0.1, angleMaxDeg: 4 } });
  assert.deepEqual([natures(large.corrections), large.points_a_valider.length], ["angle", 0]);
  assert.deepEqual([large.tolerances.deplacementMax, large.tolerances.angleMaxDeg], [0.1, 4]);
});

test("rotation dans la tolérance mais déplacement au-delà (0,3° sur 6 m) : point à valider", () => {
  const X = redresser(penche(0.3, 6));
  assert.deepEqual([X.corrections.length, X.points_a_valider.map((p) => [p.nature, p.raison])], [0, [["angle", "deplacement"]]]);
  proche(X.points_a_valider[0].deplacement_m, 3 * Math.sin(0.3 / DEG), 1e-4, "1,6 cm aux deux bouts");
});

test("mur franchement en biais (20°, pan coupé à 45°) : intact, aucun point à valider", () => {
  const R = releve([piece("A", rect(0, 0, 6, 4)), piece("B", [[7, 0], [10, 0], [10 + 3 * tan(20), 3], [8, 3], [7, 2]])]);
  const X = redresser(R);
  assert.equal(X.releve, R);
  assert.deepEqual([X.corrections, X.points_a_valider], [[], []]);
});

test("deux côtés décalés de 5 mm : alignés ; décalés de 3 cm : point à valider", () => {
  const R = deuxPieces(rect(4.1, 0.005, 7, 3)), X = redresser(R);
  assert.equal(natures(X.corrections), "alignement");
  assert.deepEqual(X.corrections[0].cotes, [{ piece: "A", cote: 0 }, { piece: "B", cote: 0 }]);
  const yA = poly(X.releve, "A")[0][1], QB = poly(X.releve, "B");
  assert.deepEqual([poly(X.releve, "A")[1][1], QB[0][1], QB[1][1]], [yA, yA, yA], "les deux côtés sont sur la même droite");
  proche(yA, (0.005 * 2.9) / 6.9, 1e-12, "le plus court s'aligne sur le plus long, au prorata");
  assert.deepEqual([QB[2], QB[3]], [poly(R, "B")[2], poly(R, "B")[3]], "le reste de la pièce ne bouge pas");
  assert.deepEqual(X.points_a_valider, []);
  // Les deux faces de la cloison (à 10 cm l'une de l'autre) ne sont pas « alignées ».
  proche(QB[0][0] - poly(X.releve, "A")[1][0], 0.1, 1e-12, "épaisseur de la cloison conservée");

  const R3 = deuxPieces(rect(4.1, 0.03, 7, 3)), X3 = redresser(R3);
  assert.equal(X3.releve, R3);
  assert.deepEqual(X3.points_a_valider.map((p) => [p.nature, p.raison, p.applicable, p.pieces]), [["alignement", "deplacement", true, ["A", "B"]]]);
  proche(X3.points_a_valider[0].deplacement_m, (0.03 * 4) / 6.9, 1e-6, "déplacement proposé");
  const S = appliquerPointRedressement(R3, X3.points_a_valider[0]);
  proche(poly(S, "B")[0][1], poly(S, "A")[0][1], 1e-12, "alignés après application");
  assert.deepEqual(redresser(S).points_a_valider, []);
  // Décalage de 8 cm : ce n'est plus « presque aligné », rien n'est proposé.
  const X8 = redresser(deuxPieces(rect(4.1, 0.08, 7, 3)));
  assert.deepEqual([X8.corrections, X8.points_a_valider], [[], []]);
});

test("petit décrochement de 5 mm dans une pièce : il reste (la forme de la pièce ne change pas)", () => {
  const R = releve([piece("A", [[0, 0], [2, 0], [2, 0.005], [4, 0.005], [4, 3], [0, 3]])]);
  const X = redresser(R);
  assert.equal(X.releve, R);
  assert.deepEqual([X.corrections, X.points_a_valider], [[], []]);
});

// Deux pièces séparées par un mur en biais (60°), faces à 60° et 60° + deg.
// La grande pièce C donne la direction du logement (le biais reste minoritaire).
const murEnBiais = (deg) => releve([
  piece("A", [[0, 0], [3, 0], [3 + 4 / tan(60), 4], [0, 4]]),
  piece("B", [[3.1155, 0], [8, 0], [8, 4], [3.1155 + 4 / tan(60 + deg), 4]]),
  piece("C", rect(-6, 4.1, 8, 12)),
]);

test("mur partagé en biais aux faces non parallèles (0,3°) : rendues parallèles, sans le remettre d'équerre", () => {
  const R = murEnBiais(0.3), X = redresser(R);
  assert.equal(natures(X.corrections), "epaisseur");
  assert.deepEqual(X.corrections[0].cotes, [{ piece: "A", cote: 1 }, { piece: "B", cote: 3 }]);
  const dA = direction(poly(X.releve, "A"), 1), dB = direction(poly(X.releve, "B"), 3);
  proche(dA, dB, 1e-9, "faces parallèles");
  assert.ok(dA > 60 && dA < 60.3, `le mur reste en biais (${dA}°)`);
  const avant = construireModeleExistant(R).existant.murs.find((m) => m.type === "partage");
  const apres = construireModeleExistant(X.releve).existant.murs.find((m) => m.type === "partage");
  assert.ok(avant.angle_faces_deg > 0.29 && avant.epaisseur_max - avant.epaisseur_min > 0.02, "avant : épaisseur variable");
  assert.equal(apres.angle_faces_deg, 0);
  proche(apres.epaisseur_min, apres.epaisseur_max, 1e-4, "après : épaisseur constante le long du mur");
  proche(apres.epaisseur, avant.epaisseur, 2e-3, "l'épaisseur moyenne n'est pas « normalisée »");
  // Faces à 2° l'une de l'autre : au-delà de la tolérance, point à valider.
  const R2 = murEnBiais(-2), X2 = redresser(R2);
  assert.equal(X2.releve, R2);
  assert.deepEqual(X2.points_a_valider.map((p) => [p.nature, p.raison, p.applicable]), [["epaisseur", "rotation", true]]);
  const S = appliquerPointRedressement(R2, X2.points_a_valider[0]);
  proche(direction(poly(S, "A"), 1), direction(poly(S, "B"), 3), 1e-9, "parallèles après application");
});

test("cumul : deux corrections qui tiennent chacune dans la tolérance mais pas ensemble → deux points à valider", () => {
  // Au sommet 2 de B se rencontrent un côté penché de 0,3° (8,9 mm) et un côté
  // penché de 0,25° dans l'autre sens (8,7 mm) : ensemble, le sommet bougerait
  // de 12,4 mm.
  const B = (a, b) => [[7, 0], [11, 0], [11 + 3.4 * tan(a), 3.4], [7, 3.4 + (4 + 3.4 * tan(a)) * tan(b)]];
  const base = (a, b) => releve([piece("A", rect(0, 0, 6, 5)), piece("B", B(a, b))]);
  assert.equal(natures(redresser(base(0.3, 0)).corrections), "angle", "le premier côté seul : appliqué");
  assert.equal(natures(redresser(base(0, -0.25)).corrections), "angle", "le second côté seul : appliqué");
  const R = base(0.3, -0.25), X = redresser(R);
  assert.equal(X.releve, R, "aucun sommet ne dépasse la tolérance : rien n'est appliqué");
  assert.deepEqual(X.points_a_valider.map((p) => [p.nature, p.raison, p.cotes]), [
    ["angle", "cumul", [{ piece: "B", cote: 1 }]],
    ["angle", "cumul", [{ piece: "B", cote: 2 }]],
  ]);
  X.points_a_valider.forEach((p) => assert.ok(p.deplacement_m <= 0.01 && /ajoutée à une autre/.test(p.texte), p.texte));
});

test("ouvertures : même identifiant, même côté, même largeur, même position réelle", () => {
  const B = tourner(rect(4.1, 0, 7, 3), 0.1, [5.55, 1.5]);
  const ouv = [
    ouverture("o1", "B", 3, 1, 1.83, { pieces_liees: ["B", "A"] }),          // porte sur le mur partagé
    ouverture("o2", "B", 0, 0, 2.9, { type: "baie" }),                       // couvre tout son côté
    ouverture("o3", "B", 1, null, null, { statut: "a_verifier" }),           // vue sur photo, pas placée
    ouverture("o4", "A", 0, 0.5, 1.4, { type: "fenetre" }),                  // pièce qui ne bouge pas
    ouverture("o5", "B", 2, 2.7, 0.2),                                       // t0 et t1 inversés
  ];
  const R = deuxPieces(B, ouv), X = redresser(R), S = X.releve;
  assert.equal(natures(X.corrections), "angle");
  const [o1, o2, o3, o4, o5] = S.ouvertures;
  proche(o1.t1 - o1.t0, 0.83, 1e-12, "largeur de la porte conservée");
  const g0 = geometrieOuverture(R, ouv[0]), g1 = geometrieOuverture(S, o1);
  assert.ok(Math.hypot(g0.p0[0] - g1.p0[0], g0.p0[1] - g1.p0[1]) <= 0.01, "la porte n'a pas bougé de plus que la tolérance");
  assert.deepEqual([o2.t0, o2.t1], [0, 2.9], "la baie couvre toujours tout son côté");
  assert.equal(o3, ouv[2], "ouverture pas encore placée : inchangée");
  assert.equal(o4, ouv[3], "ouverture d'une pièce qui ne bouge pas : même objet");
  assert.ok(o5.t0 > o5.t1, "le sens t0 / t1 est conservé");
  proche(o5.t0 - o5.t1, 2.5, 1e-12, "largeur conservée (sens inversé)");
  for (const o of S.ouvertures) if (o.t0 != null) assert.ok(Math.min(o.t0, o.t1) >= 0 && Math.max(o.t0, o.t1) <= longueursCotes(poly(S, o.piece))[o.mur] + 1e-4, `${o.id} dans son côté`);
  // Toutes restent accrochées à un mur du modèle, le même qu'avant.
  const M0 = construireModeleExistant(R).existant, M1 = construireModeleExistant(S).existant;
  assert.deepEqual(M1.ouvertures.map((o) => [o.id, o.mur]), M0.ouvertures.map((o) => [o.id, o.mur]));
  assert.deepEqual(M1.ouvertures_non_rattachees.map((o) => o.id), M0.ouvertures_non_rattachees.map((o) => o.id));
  // Les métrés qui dépendent des ouvertures ne bougent pas (largeurs conservées).
  const a = calculerMetres(R).pieces[1], b = calculerMetres(S).pieces[1];
  proche(b.plinthes, a.plinthes, 1e-9, "plinthes");
  proche(b.murs_nets, a.murs_nets, 1e-9, "murs nets");
});

test("murs dessinés (calque A-WALL) : ils suivent, les épaisseurs lues par le modèle restent les mêmes", () => {
  // B tournée de 0,1°, avec SES murs dessinés autour d'elle (30 cm dehors, la cloison côté A).
  const B = tourner(rect(4.1, 0, 7, 3), 0.1, [5.55, 1.5]);
  const dehors = (k) => { const a = B[k], b = B[(k + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = [(b[1] - a[1]) / L * 0.3, -(b[0] - a[0]) / L * 0.3]; return [a, b, [b[0] + n[0], b[1] + n[1]], [a[0] + n[0], a[1] + n[1]]]; };
  const murs = [[[4, 0], [4, 3], B[3], B[0]], dehors(0), dehors(1), dehors(2), rect(-0.3, -0.3, 0, 3.3), rect(0, -0.3, 4, 0), rect(0, 3, 4, 3.3)];
  const R = releve([piece("A", rect(0, 0, 4, 3)), piece("B", B)], murs), X = redresser(R), S = X.releve;
  assert.equal(natures(X.corrections), "angle");
  assert.deepEqual(S.murs.map((m, i) => m !== R.murs[i]), [true, true, true, true, false, false, false], "les murs dessinés de B suivent, ceux de A sont les mêmes objets");
  const QB = poly(S, "B");
  // Chaque sommet de mur posé sur un sommet de B y est toujours ; la face extérieure a suivi.
  [[0, 3, 0], [0, 2, 3], [1, 0, 0], [1, 1, 1], [2, 0, 1], [3, 1, 3]].forEach(([i, v, k]) => assert.deepEqual(S.murs[i].polygone[v], QB[k], `mur ${i}, sommet ${v}`));
  proche(S.murs[1].polygone[3][1], -0.3, 1e-3, "face extérieure du mur du bas");
  proche(S.murs[1].polygone[2][1], -0.3, 1e-3, "face extérieure du mur du bas, autre bout");
  assert.deepEqual(S.murs[0].polygone.slice(0, 2), [[4, 0], [4, 3]], "la face de la cloison côté A ne bouge pas");
  const M0 = construireModeleExistant(R), M1 = construireModeleExistant(S), b0 = bilanModele(M0), b1 = bilanModele(M1);
  assert.deepEqual(b1.murs, b0.murs, "mêmes murs, mêmes types");
  assert.deepEqual([b1.murs.partages, b1.murs.peripheriques, b1.murs.peripheriques_epaisseur_inconnue], [1, 6, 0]);
  assert.deepEqual(M1.existant.murs.map((m) => `${m.id}/${m.type}`), M0.existant.murs.map((m) => `${m.id}/${m.type}`), "mêmes identifiants de murs");
  // Épaisseurs périphériques relues dans les murs dessinés : 29 ou 30 cm pour 30 (pas de 1 cm), avant comme après.
  M1.existant.murs.filter((m) => m.type === "peripherique").forEach((m) => assert.ok(m.epaisseur >= 0.29 - 1e-9 && m.epaisseur <= 0.30 + 1e-9, `${m.id} : ${m.epaisseur}`));
});

test("pièces qui se chevauchent : point à valider sans correction automatique", () => {
  const R = releve([piece("A", rect(0, 0, 4, 3)), piece("B", rect(3.9, 0.5, 7, 2.5))]), X = redresser(R);
  const p = X.points_a_valider.find((x) => x.nature === "superposition");
  assert.ok(p, "le chevauchement est signalé");
  assert.deepEqual([p.raison, p.applicable, p.correction, p.pieces, p.deplacement_m], ["pieces_superposees", false, null, ["A", "B"], null]);
  assert.ok(/se chevauchent/.test(p.texte) && /à la main/.test(p.texte), p.texte);
  assert.equal(appliquerPointRedressement(R, p), R, "rien à appliquer : même relevé");
  assert.equal(X.bilan.points_a_valider.superposition, 1);
});

test("deux directions dominantes (aile à 30°) : chaque côté se redresse sur la direction de son aile", () => {
  const aile = tourner([[0, 0], [5, 0], [5 + 3 * tan(0.3), 3], [0, 3]], 30, [0, 0]).map(([x, y]) => [x + 12, y]);
  const R = releve([piece("A", rect(0, 0, 6, 4)), piece("B", rect(6.1, 0, 9, 4)), piece("C", aile)]), X = redresser(R);
  assert.deepEqual(X.directions.map((d) => Math.round(d.angle_deg * 1e6) / 1e6), [0, 30]);
  assert.deepEqual(X.corrections.map((c) => [c.nature, c.cotes]), [["angle", [{ piece: "C", cote: 1 }]]]);
  const Q = poly(X.releve, "C");
  Q.forEach((_, k) => proche(angle(Q, k), 90, 1e-9, `angle ${k} de l'aile`));
  proche(direction(Q, 0), 30, 1e-9, "l'aile reste à 30°");
  assert.deepEqual(directionsDominantes([{ L: 5, ang: 10 }, { L: 4, ang: 100.2 }, { L: 1, ang: 55 }]).map((d) => d.angle_deg), [10], "la direction retenue est celle d'un côté réel");
});

test("ordre des pièces indifférent, résultat stable d'un calcul à l'autre", () => {
  const B = tourner(rect(4.1, 0.004, 7, 3), 0.1, [5.55, 1.5]);
  const R = releve([piece("A", rect(0, 0, 4, 3)), piece("B", B), piece("C", [[0, 3.1], [4, 3.1], [4 + 3 * tan(3), 6.1], [0, 6.1]])], mursDeux, [ouverture("o1", "B", 3, 1, 1.83)]);
  const X = redresser(R), inverse = redresser({ ...R, pieces: [...R.pieces].reverse() });
  for (const p of R.pieces) assert.deepEqual(poly(inverse.releve, p.id), poly(X.releve, p.id), `pièce ${p.id}`);
  assert.deepEqual(inverse.releve.murs, X.releve.murs);
  assert.deepEqual(inverse.releve.ouvertures, X.releve.ouvertures);
  assert.deepEqual([inverse.corrections, inverse.points_a_valider, inverse.directions], [X.corrections, X.points_a_valider, X.directions]);
  assert.deepEqual(redresserReleve(JSON.parse(JSON.stringify(R))), X, "deux calculs identiques");
  assert.ok(X.corrections.length >= 1 && X.points_a_valider.length >= 1, "le cas contient des corrections et un point à valider");
});

test("logements tirés au sort (graine fixe) : tolérance jamais dépassée, deuxième passe sans effet, ordre indifférent", () => {
  let g = 20261125;
  const alea = () => { g = (g * 1103515245 + 12345) % 2147483648; return g / 2147483648; };
  const entre = (a, b) => a + (b - a) * alea();
  let corrections = 0, points = 0;
  for (let n = 0; n < 40; n++) {
    const bruit = [0, 0.0005, 0.003, 0.012][n % 4], tour = [0, 0.05, 0.3, 1.5][(n >> 2) % 4];
    const pieces = [], larg = [entre(2.5, 5), entre(2.5, 5), entre(1, 3)], haut = [entre(2.5, 4.5), entre(2, 4)];
    let y = 0;
    haut.forEach((h, j) => {
      let x = 0;
      larg.forEach((l, i) => {
        const P = rect(x, y, x + l, y + h).map(([px, py]) => [px + entre(-bruit, bruit), py + entre(-bruit, bruit)]);
        pieces.push(piece(`p${j}${i}`, tourner(P, entre(-tour, tour), [x + l / 2, y + h / 2])));
        x += l + 0.1;
      });
      y += h + 0.1;
    });
    const ouv = pieces.map((p, i) => ouverture(`o${i}`, p.id, i % 4, 0.4, 1.23));
    const R = releve(pieces, [], n % 3 ? ouv : null), X = redresser(R);
    corrections += X.corrections.length; points += X.points_a_valider.length;
    const inverse = redresserReleve({ ...R, pieces: [...R.pieces].reverse() });
    for (const p of R.pieces) assert.deepEqual(poly(inverse.releve, p.id), poly(X.releve, p.id), `tirage ${n}, pièce ${p.id}`);
    for (const p of X.points_a_valider.filter((x) => x.applicable)) {
      const S = appliquerPointRedressement(X.releve, p);
      assert.ok(S !== X.releve && S.pieces.every((q) => q.polygone.flat().every(Number.isFinite)), `tirage ${n} : ${p.cle} applicable`);
    }
  }
  assert.ok(corrections > 40 && points > 40, `les tirages exercent les deux issues (${corrections} corrections, ${points} points à valider)`);
});

// ── Relevé de référence anonymisé (scripts/fixtures) ───────────────────────
const dxfTexte = fs.readFileSync(path.join(ici, "fixtures/releve-imapper-reference.dxf"), "latin1");
const pdfJson = JSON.parse(fs.readFileSync(path.join(ici, "fixtures/releve-imapper-reference-pdf.json"), "utf8"));
const pdfs = pdfJson.pdfs.map((p) => ({ nom: p.nom, lecture: lirePdfImapper(p.page1, p.page2), nbPhotos: p.nbPhotos }));
const REF = () => assemblerReleve({ dxfTexte, pdfs, maintenant: "2026-10-15T10:00:00Z" }).releve;

test("relevé de référence : redressé dans la tolérance, même topologie, ouvertures toutes rattachées", () => {
  const R = REF(), X = redresser(R), S = X.releve;
  const M0 = construireModeleExistant(R), M1 = construireModeleExistant(S), b0 = bilanModele(M0), b1 = bilanModele(M1);
  assert.deepEqual([b1.pieces, b1.cotes, b1.murs.partages, b1.murs.peripheriques, b1.murs.limites, b1.murs.peripheriques_epaisseur_inconnue],
    [b0.pieces, b0.cotes, b0.murs.partages, b0.murs.peripheriques, b0.murs.limites, b0.murs.peripheriques_epaisseur_inconnue], "mêmes pièces, côtés, murs partagés et périphériques");
  // Identifiants de murs : conservés, sauf un bout de raccord de 1,07 cm — juste
  // au-dessus du centimètre en dessous duquel le modèle rattache un reste de
  // côté au mur voisin — qui passe sous ce seuil une fois le côté redressé.
  const ids0 = M0.existant.murs.map((m) => m.id), ids1 = M1.existant.murs.map((m) => m.id);
  const disparus = M0.existant.murs.filter((m) => !ids1.includes(m.id));
  assert.deepEqual(ids1.filter((id) => !ids0.includes(id)), [], "aucun mur nouveau");
  assert.deepEqual(disparus.map((m) => [m.id, m.type, m.longueur < 0.011]), [["mur:p4:2:1", "raccord", true]]);
  assert.deepEqual(M1.existant.murs.map((m) => `${m.id}/${m.type}`), M0.existant.murs.filter((m) => !disparus.includes(m)).map((m) => `${m.id}/${m.type}`), "les autres murs gardent identifiant et type");
  assert.deepEqual(b1.ouvertures, b0.ouvertures, "ouvertures toujours toutes rattachées");
  assert.deepEqual(M1.existant.ouvertures.map((o) => [o.id, o.mur]), M0.existant.ouvertures.map((o) => [o.id, o.mur]), "chaque ouverture sur le même mur");
  R.ouvertures.forEach((o, i) => { if (o.t0 != null) proche(S.ouvertures[i].t1 - S.ouvertures[i].t0, o.t1 - o.t0, 1.01e-4, `largeur de ${o.code}`); });
  assert.deepEqual(pointsAValider(S), pointsAValider(R), "les points à valider existants du relevé ne changent pas");
  // Écart de chaque métré, brut → redressé (ce que l'ancien éditeur affiche / ce que donnerait le relevé redressé).
  const A = calculerMetres(R), B = calculerMetres(S), cles = ["sol", "perimetre", "plafond", "murs_bruts", "plinthes", "murs_nets"];
  let max = 0, affiches = 0, nb = 0;
  [...A.pieces.map((l, i) => [l, B.pieces[i]]), [A.total, B.total]].forEach(([a, b]) => cles.forEach((k) => {
    nb++; max = Math.max(max, Math.abs(a[k] - b[k]));
    if (texteMetre(a[k], a.approx?.[k], a.raison) !== texteMetre(b[k], b.approx?.[k], b.raison)) affiches++;
  }));
  // Bornes qui découlent de la tolérance : un sommet bouge de 1 cm au plus, donc
  // la surface d'une pièce de (périmètre × 1 cm) au plus, son périmètre de 2 cm par sommet.
  A.pieces.forEach((a, i) => {
    assert.ok(Math.abs(B.pieces[i].sol - a.sol) <= a.perimetre * 0.01, `${a.id} : surface ${a.sol} → ${B.pieces[i].sol}`);
    assert.ok(Math.abs(B.pieces[i].perimetre - a.perimetre) <= R.pieces[i].polygone.length * 0.02, `${a.id} : périmètre ${a.perimetre} → ${B.pieces[i].perimetre}`);
  });
  const bil = X.bilan;
  console.log(`      exemple issu des tests, données fictives (relevé de référence anonymisé, hors base) : direction dominante ${X.directions.map((d) => d.angle_deg.toFixed(2)).join("° / ")}° ; corrections appliquées ${JSON.stringify(bil.corrections)} ; points à valider ${JSON.stringify(bil.points_a_valider)} ; ${bil.sommets_deplaces}/${bil.sommets} sommets déplacés, au plus ${(bil.deplacement_max_m * 1000).toFixed(2)} mm et ${bil.rotation_max_deg.toFixed(3)}° ; métrés : ${nb} valeurs, écart maximal ${max.toFixed(5)}, ${affiches} différente(s) à la précision affichée.`);
  // Chiffres figés : un changement du redressement doit se voir ici.
  assert.deepEqual([X.directions.length, bil.sommets, bil.cotes], [1, b0.cotes, b0.cotes]);
  assert.deepEqual([bil.corrections, bil.points_a_valider], [REFERENCE.corrections, REFERENCE.points_a_valider]);
});
const REFERENCE = { corrections: { angle: 8, alignement: 6, epaisseur: 0 }, points_a_valider: { angle: 6, alignement: 1, epaisseur: 0, superposition: 0 } };

test("relevé de référence : chaque point à valider s'applique, sans toucher au relevé d'origine", () => {
  const R = REF(), X = redresser(R), avant = JSON.stringify(X.releve);
  for (const p of X.points_a_valider) {
    const S = appliquerPointRedressement(X.releve, p);
    assert.equal(JSON.stringify(X.releve), avant, `${p.cle} : relevé redressé non modifié`);
    if (!p.applicable) { assert.equal(S, X.releve); continue; }
    const m = Math.max(...X.releve.pieces.map((q, i) => Math.max(...mesurerEcart(q.polygone, S.pieces[i].polygone).deplacements)));
    proche(m, p.deplacement_m, 1e-5, `${p.cle} : ampleur annoncée = ampleur appliquée`);
    assert.ok(m > EPSILON_M, `${p.cle} : l'application déplace quelque chose`);
    assert.equal(bilanModele(construireModeleExistant(S)).ouvertures.non_rattachees, 0, `${p.cle} : ouvertures toujours rattachées`);
  }
});

let ok = 0;
for (const [nom, fn] of cas) {
  try { await fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { console.error(`  ✗ ${nom}\n    ${e.message}`); process.exitCode = 1; }
}
console.log(`\n${ok}/${cas.length} vérifications redressement du plan (nouvel éditeur)`);
