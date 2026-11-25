// Vérification du modèle d'objets métier du nouvel éditeur de plans (projet
// docs/projets/editeur-plans.md, tâche 1) : murs calculés à partir des pièces
// d'un relevé iMapper, ouvertures accrochées à un mur, rien de perdu.
//
// Jeux de test :
//  • des logements dessinés à la main dans ce fichier (rectangles, pièce en L,
//    mur en biais…) : exemples issus des tests, données fictives ;
//  • le relevé de référence ANONYMISÉ de scripts/fixtures/ (6 pièces), le même
//    que scripts/verif-releve-imapper.mjs. Aucun relevé réel n'est versionné.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assemblerReleve, lirePdfImapper, calculerMetres, airePolygone, pointDansPoly, cotesPiece,
} from "../src/Renovation/releveImapper.mjs";
import {
  construireModeleExistant, calculerMurs, rattacherOuvertures, bilanModele, contourMur,
  mursDePiece, tronconsCote, voisinagesPieces, TOLERANCES_MURS, TYPES_MUR, ETATS, VERSION_MODELE_PLAN,
} from "../src/Renovation/planV2/planV2Modele.mjs";

const ici = path.dirname(fileURLToPath(import.meta.url));
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg} : ${a} ≠ ${b} (± ${tol})`);

// ── Logements fictifs ──────────────────────────────────────────────────────
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const piece = (id, polygone) => ({
  id, nom: `Pièce ${id}`, type: "autre", polygone, hsp: 2.5, hsp_statut: "defaut", photos: [], observations: [],
});
const releve = (pieces, murs = [], ouvertures = null) => ({
  version: 1, source: { outil: "imapper", projet: "TEST" }, pieces,
  murs: murs.map((polygone) => ({ polygone })), ouvertures, points: {}, scanners: {}, alertes: [],
});
const tourner = (R, deg) => {
  const a = (deg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
  const rot = (P) => P.map(([x, y]) => [x * co - y * si, x * si + y * co]);
  return { ...R, pieces: R.pieces.map((p) => ({ ...p, polygone: rot(p.polygone) })), murs: R.murs.map((m) => ({ polygone: rot(m.polygone) })) };
};
const geler = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(geler); } return o; };
const murId = (M, id) => M.existant.murs.find((m) => m.id === id);
const types = (M) => M.existant.murs.map((m) => m.type).sort().join(",");
// L'épaisseur lue dans les murs dessinés avance par pas de 1 cm : 29 ou 30 pour 30.
const lu = (e, attendu, msg) => assert.ok(e != null && e >= attendu - 0.0101 && e <= attendu + 1e-9, `${msg} : ${e} pour ${attendu}`);

// Invariants communs à tout modèle : rien de perdu, rien d'absurde.
function invariants(R, M) {
  const E = M.existant;
  assert.deepEqual(E.pieces.map((p) => p.id), R.pieces.map((p) => p.id), "toutes les pièces, dans l'ordre du relevé");
  const ids = E.murs.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, "identifiants de murs uniques");
  for (const m of E.murs) {
    assert.ok(TYPES_MUR.includes(m.type), `type ${m.type}`);
    assert.equal(m.etat, "existant");
    assert.ok(ETATS.includes(m.etat) && m.corps_etat, "état et corps d'état");
    assert.ok(m.faces.length === (m.type === "partage" ? 2 : m.faces.length) && m.faces.length >= 1 && m.faces.length <= 2);
    if (m.epaisseur == null) {
      assert.ok(m.epaisseur_raison, `${m.id} : épaisseur inconnue sans raison`);
      assert.equal(m.axe, null, `${m.id} : pas d'axe sans épaisseur`);
      assert.equal(contourMur(m), null);
    } else {
      assert.ok(m.epaisseur >= 0 && m.epaisseur <= M.tolerances.epaisseurMax + 1e-9, `${m.id} : épaisseur ${m.epaisseur}`);
      assert.ok(m.epaisseur_source, `${m.id} : épaisseur sans source`);
      assert.ok(m.type === "limite" ? m.epaisseur === 0 : m.epaisseur >= M.tolerances.epaisseurMin - 1e-9, `${m.id} : ${m.epaisseur}`);
    }
    assert.ok(m.longueur > 0, `${m.id} : longueur ${m.longueur}`);
  }
  // Chaque côté de chaque pièce est couvert en entier par les faces de ses murs.
  R.pieces.forEach((p, i) => {
    const cotes = cotesPiece(p);
    assert.equal(E.pieces[i].cotes.length, cotes.length);
    cotes.forEach((c) => {
      const tr = tronconsCote(E.murs, p.id, c.k);
      assert.deepEqual(tr.map((t) => t.mur), E.pieces[i].cotes[c.k].murs, `${p.id} côté ${c.k}`);
      proche(tr.reduce((t, x) => t + (x.t1 - x.t0), 0), c.L, 1e-3, `${p.id} côté ${c.k} couvert`);
      proche(tr[0].t0, 0, 1e-3, "début du côté");
      for (let k = 1; k < tr.length; k++) proche(tr[k].t0, tr[k - 1].t1, 1e-3, `${p.id} côté ${c.k} : tronçons jointifs`);
    });
  });
  // Ouvertures : rattachées ou listées avec leur raison, jamais perdues.
  if (R.ouvertures === null) {
    assert.equal(E.ouvertures, null, "ouvertures pas encore relevées : null, pas []");
  } else {
    assert.deepEqual([...E.ouvertures.map((o) => o.id), ...E.ouvertures_non_rattachees.map((o) => o.id)].sort(),
      R.ouvertures.map((o) => o.id).sort(), "toute ouverture est rattachée ou listée");
    for (const o of E.ouvertures) {
      const m = murId(M, o.mur);
      assert.ok(m && m.ouvertures.includes(o.id), `${o.id} portée par son mur`);
      assert.ok(m.faces[o.face].piece === o.piece && m.faces[o.face].cote === o.cote, `${o.id} : face de sa pièce`);
    }
    for (const o of E.ouvertures_non_rattachees) assert.ok(o.raison && o.texte, `${o.id} : raison`);
  }
  // Emplacements des tâches suivantes : présents et vides.
  assert.deepEqual([M.equipements, M.notes, M.traits, M.projet.modifications], [[], [], [], []]);
  assert.equal(M.version, VERSION_MODELE_PLAN);
}

// Deux pièces séparées par une cloison de 10 cm, murs extérieurs de 30 cm.
const deuxPieces = () => releve(
  [piece("A", rect(0, 0, 4, 3)), piece("B", rect(4.1, 0, 7, 3))],
  [rect(4, 0, 4.1, 3), rect(-0.3, -0.3, 0, 3.3), rect(7, -0.3, 7.3, 3.3), rect(0, -0.3, 7, 0), rect(0, 3, 7, 3.3)],
);
// Une pièce A longée par deux voisines B et C, séparées par une cloison.
const troisPieces = (ouvertures = null) => releve(
  [piece("A", rect(0, 0, 6, 3)), piece("B", rect(0, 3.1, 2.95, 6)), piece("C", rect(3.05, 3.1, 6, 6))],
  [rect(0, 3, 6, 3.1), rect(2.95, 3.1, 3.05, 6)],
  ouvertures,
);

test("deux pièces côte à côte : UN mur partagé de 10 cm, six murs périphériques de 30 cm", () => {
  const R = deuxPieces(), M = construireModeleExistant(R);
  invariants(R, M);
  assert.equal(M.existant.murs.length, 7);
  const partages = M.existant.murs.filter((m) => m.type === "partage");
  assert.equal(partages.length, 1);
  const m = partages[0];
  assert.equal(m.id, "mur:A:1:0");
  assert.deepEqual(m.pieces, ["A", "B"]);
  assert.deepEqual(m.faces.map((f) => [f.piece, f.cote]), [["A", 1], ["B", 3]]);
  proche(m.epaisseur, 0.10, 1e-6, "épaisseur");
  proche(m.longueur, 3, 1e-6, "longueur");
  assert.equal(m.epaisseur_source, "faces");
  assert.equal(m.plein, 1);
  assert.equal(m.angle_faces_deg, 0);
  assert.deepEqual(m.axe, { a: [4.05, 0], b: [4.05, 3] });
  proche(airePolygone(contourMur(m)), 0.3, 1e-6, "contour du mur");
  const peri = M.existant.murs.filter((x) => x.type === "peripherique");
  assert.equal(peri.length, 6);
  peri.forEach((x) => { lu(x.epaisseur, 0.30, x.id); assert.equal(x.epaisseur_source, "murs_releve"); assert.equal(x.pieces.length, 1); });
  assert.deepEqual(voisinagesPieces(M.existant.murs), [{ pieces: ["A", "B"], murs: ["mur:A:1:0"], longueur: 3 }]);
  assert.deepEqual(mursDePiece(M, "B").map((x) => x.id), ["mur:B:0:0", "mur:B:1:0", "mur:B:2:0", "mur:A:1:0"]);
});

test("pièce en L et sa voisine : deux murs partagés, raccords d'angle, épaisseur inconnue visible", () => {
  const L = [[0, 0], [5, 0], [5, 2], [2, 2], [2, 4], [0, 4]];
  const R = releve([piece("L", L), piece("N", rect(2.1, 2.1, 5, 4))], [rect(2, 2, 5, 2.1), rect(2, 2, 2.1, 4)]);
  const M = construireModeleExistant(R);
  invariants(R, M);
  const E = M.existant;
  assert.equal(E.murs.length, 10);
  assert.equal(types(M), "partage,partage,peripherique,peripherique,peripherique,peripherique,peripherique,peripherique,raccord,raccord");
  // Les deux côtés du creux du L portent chacun un mur partagé + un raccord d'angle.
  assert.deepEqual(E.pieces[0].cotes[2].murs.map((id) => murId(M, id).type), ["partage", "raccord"]);
  assert.deepEqual(E.pieces[0].cotes[3].murs.map((id) => murId(M, id).type), ["raccord", "partage"]);
  E.murs.filter((m) => m.type === "partage").forEach((m) => { proche(m.epaisseur, 0.1, 1e-6, m.id); assert.deepEqual(m.pieces, ["L", "N"]); });
  E.murs.filter((m) => m.type === "raccord").forEach((m) => {
    assert.equal(m.epaisseur, null); assert.equal(m.epaisseur_raison, "matiere_continue"); proche(m.longueur, 0.1, 1e-6, m.id);
  });
  // Aucun mur n'est dessiné derrière les autres côtés : épaisseur inconnue, dite.
  E.murs.filter((m) => m.type === "peripherique").forEach((m) => {
    assert.equal(m.epaisseur, null); assert.equal(m.epaisseur_raison, "aucun_mur_dessine");
  });
  const b = bilanModele(M);
  assert.equal(b.murs.peripheriques_epaisseur_inconnue, 6);
  assert.deepEqual(b.murs.raisons_epaisseur_inconnue, { aucun_mur_dessine: 6 });
  assert.deepEqual(b.epaisseurs_cm, { 10: 2 }, "une épaisseur inconnue n'est rangée dans aucune valeur");
});

test("côté longeant deux voisins : découpé en tronçons (partagé, raccord, partagé)", () => {
  const R = troisPieces(), M = construireModeleExistant(R);
  invariants(R, M);
  const cote = M.existant.pieces[0].cotes[2];
  assert.deepEqual(cote.murs, ["mur:A:2:0", "mur:A:2:1", "mur:A:2:2"]);
  assert.deepEqual(cote.murs.map((id) => murId(M, id).type), ["partage", "raccord", "partage"]);
  assert.deepEqual(murId(M, "mur:A:2:0").pieces, ["A", "C"]);
  assert.deepEqual(murId(M, "mur:A:2:2").pieces, ["A", "B"]);
  proche(murId(M, "mur:A:2:0").longueur, 2.95, 1e-6, "tronçon A|C");
  proche(murId(M, "mur:A:2:1").longueur, 0.10, 1e-6, "about de la cloison B|C");
  proche(murId(M, "mur:A:2:2").longueur, 2.95, 1e-6, "tronçon A|B");
  const bc = murId(M, "mur:B:1:0");
  assert.deepEqual(bc.pieces, ["B", "C"]);
  proche(bc.epaisseur, 0.1, 1e-6, "cloison B|C");
  assert.equal(voisinagesPieces(M.existant.murs).length, 3);
  assert.equal(bilanModele(M).murs.partages, 3);
});

test("mur en biais : mêmes murs après rotation du logement de 30°", () => {
  const R = tourner(deuxPieces(), 30), M = construireModeleExistant(R);
  invariants(R, M);
  assert.equal(types(M), types(construireModeleExistant(deuxPieces())));
  const m = M.existant.murs.find((x) => x.type === "partage");
  proche(m.epaisseur, 0.10, 1e-4, "épaisseur");
  proche(m.longueur, 3, 1e-4, "longueur");
  proche(Math.hypot(...m.direction), 1, 1e-9, "direction unitaire");
  M.existant.murs.filter((x) => x.type === "peripherique").forEach((x) => lu(x.epaisseur, 0.30, x.id));
});

test("faces pas tout à fait parallèles : partagé jusqu'à la tolérance d'angle, sinon périphérique avec la pièce derrière", () => {
  const cas2 = (deg) => {
    const d = 3 * Math.tan((deg * Math.PI) / 180);
    return releve([piece("A", rect(0, 0, 4, 3)), piece("B", [[4.1, 0], [7, 0], [7, 3], [4.1 + d, 3]])], [[[4, 0], [4.1, 0], [4.1 + d, 3], [4, 3]]]);
  };
  const M3 = construireModeleExistant(cas2(3));
  invariants(cas2(3), M3);
  const m = murId(M3, "mur:A:1:0");
  assert.equal(m.type, "partage");
  proche(m.angle_faces_deg, 3, 0.01, "angle entre les faces");
  assert.ok(m.epaisseur_min < m.epaisseur && m.epaisseur < m.epaisseur_max, "épaisseur variable exposée");
  proche(m.epaisseur_min, 0.10, 0.005, "épaisseur au plus mince");
  // Tolérance d'angle réglable : à 1°, ce n'est plus un mur partagé.
  assert.equal(murId(construireModeleExistant(cas2(3), { tolerances: { angleMaxDeg: 1 } }), "mur:A:1:0").type, "peripherique");
  const M8 = construireModeleExistant(cas2(8));
  invariants(cas2(8), M8);
  const p = murId(M8, "mur:A:1:0");
  assert.equal(p.type, "peripherique");
  assert.equal(p.piece_derriere, "B");
  assert.equal(p.epaisseur_source, "murs_releve");
  assert.ok(p.epaisseur_min < p.epaisseur_max, "mesures dispersées exposées");
  assert.equal(bilanModele(M8).murs.peripheriques_piece_derriere, 2);
});

test("pièce isolée : quatre murs périphériques ; sans mur dessiné, épaisseur inconnue et non inventée", () => {
  const R = releve([piece("A", rect(0, 0, 4, 3))], [rect(-0.3, -0.3, 0, 3.3), rect(4, -0.3, 4.3, 3.3), rect(0, -0.3, 4, 0), rect(0, 3, 4, 3.3)]);
  const M = construireModeleExistant(R);
  invariants(R, M);
  assert.equal(types(M), "peripherique,peripherique,peripherique,peripherique");
  M.existant.murs.forEach((m) => { lu(m.epaisseur, 0.30, m.id); assert.ok(m.axe && contourMur(m)); });
  proche(M.existant.murs.reduce((t, m) => t + m.longueur, 0), calculerMetres(R).pieces[0].perimetre, 1e-6, "longueur des murs = périmètre");
  const R0 = releve([piece("A", rect(0, 0, 4, 3))]);
  const M0 = construireModeleExistant(R0);
  invariants(R0, M0);
  M0.existant.murs.forEach((m) => {
    assert.equal(m.type, "peripherique"); assert.equal(m.epaisseur, null); assert.equal(m.epaisseur_raison, "releve_sans_murs");
  });
  assert.equal(bilanModele(M0).murs.peripheriques_epaisseur_inconnue, 4);
  assert.deepEqual(construireModeleExistant(releve([])).existant.murs, [], "relevé sans pièce : aucun mur");
  assert.deepEqual(construireModeleExistant(null).existant.pieces, [], "pas de relevé : modèle vide, sans erreur");
});

test("poteau dans une pièce : mur à deux faces de la même pièce", () => {
  const P = [[0, 0], [2, 0], [2, 0.4], [2.3, 0.4], [2.3, 0], [5, 0], [5, 4], [0, 4]];
  const R = releve([piece("A", P)], [rect(2, 0, 2.3, 0.4), rect(-0.3, -0.3, 5.3, 0)]);
  const M = construireModeleExistant(R);
  invariants(R, M);
  const m = murId(M, "mur:A:1:0");
  assert.equal(m.type, "partage");
  assert.deepEqual(m.pieces, ["A"]);
  assert.deepEqual(m.faces.map((f) => f.cote), [1, 3]);
  proche(m.epaisseur, 0.3, 1e-6, "largeur du poteau");
  assert.equal(voisinagesPieces(M.existant.murs).length, 0, "un poteau n'est pas un voisinage");
});

test("pas de mur entre deux pièces : limite (côtés confondus) et pièces superposées signalées", () => {
  const R = releve([piece("A", rect(0, 0, 4, 3)), piece("B", rect(4, 0, 7, 3))]);
  const M = construireModeleExistant(R);
  invariants(R, M);
  const m = murId(M, "mur:A:1:0");
  assert.equal(m.type, "limite");
  assert.equal(m.epaisseur, 0);
  assert.equal(m.faces.length, 2);
  assert.equal(contourMur(m), null, "pas de mur à dessiner");
  assert.deepEqual(bilanModele(M).epaisseurs_cm, {}, "une limite ne compte pas comme un mur de 0 cm");
  // B déborde de 10 cm sur A : le relevé est incohérent, le modèle le dit.
  const R2 = releve([piece("A", rect(0, 0, 4, 3)), piece("B", rect(3.9, 0, 7, 3))], [rect(4, 0, 4.3, 3)]);
  const M2 = construireModeleExistant(R2);
  invariants(R2, M2);
  const s = murId(M2, "mur:A:1:0");
  assert.equal(s.type, "limite");
  assert.equal(s.epaisseur, null);
  assert.equal(s.epaisseur_raison, "pieces_superposees");
  assert.equal(s.piece_derriere, "B");
  assert.equal(bilanModele(M2).murs.pieces_superposees, 2);
});

test("vide entre deux pièces (gaine, espace non relevé) : deux murs distincts, vis-à-vis écarté et listé", () => {
  const R = releve([piece("A", rect(0, 0, 4, 3)), piece("B", rect(4.6, 0, 7, 3))], [rect(4, 0, 4.1, 3), rect(4.5, 0, 4.6, 3)]);
  const M = construireModeleExistant(R);
  invariants(R, M);
  assert.equal(M.existant.murs.filter((m) => m.type === "partage").length, 0);
  assert.equal(M.existant.voisinages_ecartes.length, 1);
  assert.equal(M.existant.voisinages_ecartes[0].raison, "vide_entre_les_faces");
  proche(M.existant.voisinages_ecartes[0].ecart, 0.6, 1e-6, "écart entre les faces");
  lu(murId(M, "mur:A:1:0").epaisseur, 0.10, "mur côté A");
  lu(murId(M, "mur:B:3:0").epaisseur, 0.10, "mur côté B");
  assert.equal(murId(M, "mur:A:1:0").piece_derriere, null);
  // Relevé sans aucun mur dessiné : le voisinage est retenu sur la seule géométrie des pièces.
  const R0 = releve([piece("A", rect(0, 0, 4, 3)), piece("B", rect(4.1, 0, 7, 3))]);
  const m0 = murId(construireModeleExistant(R0), "mur:A:1:0");
  assert.equal(m0.type, "partage");
  assert.equal(m0.plein, null, "matière non vérifiable : null, pas 1");
  // Au-delà de l'épaisseur maximale, plus de mur partagé.
  const loin = releve([piece("A", rect(0, 0, 4, 3)), piece("B", rect(5.5, 0, 8, 3))]);
  assert.equal(construireModeleExistant(loin).existant.murs.filter((m) => m.type === "partage").length, 0);
});

test("ouvertures : accrochées au mur qui porte leur côté, des deux côtés d'un mur partagé", () => {
  const o = (id, p, mur, t0, t1, plus = {}) => ({ id, code: id.toUpperCase(), piece: p, mur, t0, t1, type: "porte", statut: "detecte", pieces_liees: [p], masque: false, ...plus });
  const R = troisPieces([
    o("o1", "A", 2, 1, 1.9, { pieces_liees: ["A", "C"] }),
    o("o2", "B", 1, 1, 1.8, { pieces_liees: ["B", "C"] }),
    o("o3", "C", 3, 0.5, 1.3, { type: "baie" }),
    o("o4", "A", 2, 2.5, 3.6),
    o("o5", "A", 0, null, null, { position_inconnue: true }),
    o("o6", "A", 2, null, null, { position_inconnue: true }),
    o("o7", "Z", 0, 0, 1),
    o("o8", "A", 9, 0, 1),
    o("o9", "A", 2, 7, 8),
    o("o10", "A", 1, 2.9, 3.00004, { masque: true }),
  ]);
  const M = construireModeleExistant(R);
  invariants(R, M);
  const E = M.existant, ouv = (id) => E.ouvertures.find((x) => x.id === id);
  assert.deepEqual(E.ouvertures.map((x) => x.id), ["o1", "o2", "o3", "o4", "o5", "o10"]);
  assert.deepEqual([ouv("o1").mur, ouv("o1").face, ouv("o1").s0, ouv("o1").s1, ouv("o1").deborde], ["mur:A:2:0", 0, 1, 1.9, false]);
  assert.equal(murId(M, ouv("o1").mur).type, "partage");
  // o2 vue de B et o3 vue de C tombent sur le MÊME mur B|C, chacune sur sa face.
  assert.deepEqual([ouv("o2").mur, ouv("o2").face], ["mur:B:1:0", 0]);
  assert.deepEqual([ouv("o3").mur, ouv("o3").face], ["mur:B:1:0", 1]);
  assert.deepEqual(murId(M, "mur:B:1:0").ouvertures, ["o2", "o3"]);
  // o4 est à cheval sur trois tronçons : accrochée au plus couvert, débord signalé.
  assert.deepEqual([ouv("o4").mur, ouv("o4").deborde], ["mur:A:2:2", true]);
  assert.deepEqual(ouv("o4").murs_touches, ["mur:A:2:0", "mur:A:2:1", "mur:A:2:2"]);
  // o5 : vue sur photo, pas placée, mais son côté ne porte qu'un mur.
  assert.deepEqual([ouv("o5").mur, ouv("o5").position, ouv("o5").t0], ["mur:A:0:0", "inconnue", null]);
  // o10 : masquée dans le relevé, conservée quand même ; bornée à son côté.
  assert.deepEqual([ouv("o10").mur, ouv("o10").t1], ["mur:A:1:0", 3]);
  // Non rattachées : listées avec leur raison.
  assert.deepEqual(E.ouvertures_non_rattachees.map((x) => [x.id, x.raison]),
    [["o6", "position_inconnue"], ["o7", "piece_introuvable"], ["o8", "cote_introuvable"], ["o9", "hors_cote"]]);
  assert.match(E.ouvertures_non_rattachees[0].texte, /^O6 : vue sur photo mais pas encore placée.*\(3 murs\)\.$/);
  assert.deepEqual(bilanModele(M).ouvertures, {
    releve: 10, rattachees: 6, non_rattachees: 4,
    raisons: { position_inconnue: 1, piece_introuvable: 1, cote_introuvable: 1, hors_cote: 1 },
  });
  // Les fonctions se composent : mêmes ouvertures en partant des murs seuls.
  assert.deepEqual(rattacherOuvertures(R, calculerMurs(R).murs).ouvertures, E.ouvertures);
});

test("relevé sans ouvertures relevées : null reste null (≠ aucune ouverture)", () => {
  const M = construireModeleExistant(troisPieces(null));
  assert.equal(M.existant.ouvertures, null);
  assert.deepEqual(bilanModele(M).ouvertures, { releve: null, rattachees: null, non_rattachees: null, raisons: {} });
  const M0 = construireModeleExistant(troisPieces([]));
  assert.deepEqual(M0.existant.ouvertures, []);
  assert.equal(bilanModele(M0).ouvertures.releve, 0);
  assert.ok(M0.existant.murs.every((m) => m.ouvertures.length === 0));
});

test("identifiants stables : deux calculs identiques, indépendants de l'ordre des pièces", () => {
  const R = troisPieces();
  const M1 = construireModeleExistant(R), M2 = construireModeleExistant(JSON.parse(JSON.stringify(R)));
  assert.deepEqual(M1, M2);
  const inverse = { ...R, pieces: [...R.pieces].reverse() };
  const parId = (M) => Object.fromEntries(M.existant.murs.map((m) => [m.id, m]));
  assert.deepEqual(parId(construireModeleExistant(inverse)), parId(M1));
  assert.deepEqual(M1.tolerances, { ...TOLERANCES_MURS }, "tolérances utilisées inscrites dans le modèle");
  assert.equal(construireModeleExistant(R, { tolerances: { epaisseurMax: 0.05 } }).existant.murs.filter((m) => m.type === "partage").length, 0);
});

// ── Relevé de référence anonymisé (scripts/fixtures) ───────────────────────
const dxfTexte = fs.readFileSync(path.join(ici, "fixtures/releve-imapper-reference.dxf"), "latin1");
const pdfJson = JSON.parse(fs.readFileSync(path.join(ici, "fixtures/releve-imapper-reference-pdf.json"), "utf8"));
const pdfs = pdfJson.pdfs.map((p) => ({ nom: p.nom, lecture: lirePdfImapper(p.page1, p.page2), nbPhotos: p.nbPhotos }));
const REF = assemblerReleve({ dxfTexte, pdfs, maintenant: "2026-10-15T10:00:00Z" }).releve;

test("relevé de référence : le relevé n'est pas modifié, calculerMetres donne le même résultat avant et après", () => {
  const R = JSON.parse(JSON.stringify(REF));
  const avant = JSON.stringify(R), metresAvant = JSON.stringify(calculerMetres(R));
  geler(R);   // toute écriture dans le relevé lèverait une erreur
  const M = construireModeleExistant(R);
  assert.equal(JSON.stringify(R), avant);
  assert.equal(JSON.stringify(calculerMetres(R)), metresAvant);
  assert.deepEqual(construireModeleExistant(JSON.parse(avant)), M, "identifiants et murs stables d'un calcul à l'autre");
  assert.deepEqual(JSON.parse(JSON.stringify(M)), M, "le modèle s'enregistre tel quel (JSON)");
});

test("relevé de référence : toute pièce conservée, tout côté couvert, toute ouverture rattachée ou listée", () => {
  const M = construireModeleExistant(REF);
  invariants(REF, M);
  const E = M.existant, b = bilanModele(M);
  assert.equal(b.pieces, 6);
  assert.equal(b.cotes, REF.pieces.reduce((t, p) => t + p.polygone.length, 0));
  assert.equal(b.ouvertures.releve, REF.ouvertures.length);
  assert.equal(b.murs.total, b.murs.partages + b.murs.limites + b.murs.peripheriques + b.murs.raccords);
  // Longueur des faces d'une pièce = son périmètre (même chiffre que les métrés).
  const metres = calculerMetres(REF);
  for (const p of E.pieces) {
    const faces = E.murs.flatMap((m) => m.faces.filter((f) => f.piece === p.id));
    proche(faces.reduce((t, f) => t + (f.t1 - f.t0), 0), metres.pieces.find((l) => l.id === p.id).perimetre, 5e-3, `périmètre ${p.id}`);
  }
  // Un mur partagé est fait de matière : son axe ne tombe dans aucune pièce.
  for (const m of E.murs.filter((x) => x.type === "partage")) {
    const milieu = [(m.axe.a[0] + m.axe.b[0]) / 2, (m.axe.a[1] + m.axe.b[1]) / 2];
    assert.ok(!REF.pieces.some((p) => pointDansPoly(milieu, p.polygone)), `${m.id} : axe dans une pièce`);
    assert.ok(airePolygone(contourMur(m)) > 0);
    assert.ok(m.plein >= M.tolerances.pleinMin);
  }
});

test("relevé de référence : chiffres attendus (6 pièces, murs partagés entre pièces voisines)", () => {
  const M = construireModeleExistant(REF);
  const b = bilanModele(M);
  console.log(`      exemple issu des tests, données fictives (relevé de référence anonymisé, hors base) : ${JSON.stringify(b)}`);
  // Chiffres figés : un changement du calcul des murs doit se voir ici.
  assert.deepEqual([b.murs.total, b.murs.partages, b.murs.peripheriques, b.murs.raccords], [41, 10, 20, 11]);
  assert.equal(voisinagesPieces(M.existant.murs).length, 9, "9 paires de pièces voisines");
  assert.equal(b.murs.peripheriques_epaisseur_inconnue, 0, "référence : toutes les épaisseurs périphériques sont lues");
  assert.equal(b.murs.pieces_superposees, 0);
  assert.equal(b.ouvertures.non_rattachees, 0, JSON.stringify(M.existant.ouvertures_non_rattachees));
  // Chaque porte « entre deux pièces » du relevé est accrochée à un mur de ces deux pièces.
  for (const o of REF.ouvertures.filter((x) => (x.pieces_liees || []).length === 2 && x.statut === "detecte")) {
    const m = murId(M, M.existant.ouvertures.find((x) => x.id === o.id).mur);
    assert.deepEqual([...m.pieces].sort(), [...o.pieces_liees].sort(), `${o.code}`);
  }
});

let ok = 0;
for (const [nom, fn] of cas) {
  try { await fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { console.error(`  ✗ ${nom}\n    ${e.message}`); process.exitCode = 1; }
}
console.log(`\n${ok}/${cas.length} vérifications modèle du plan (nouvel éditeur)`);
