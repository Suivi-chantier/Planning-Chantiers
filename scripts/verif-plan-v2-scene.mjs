// Vérification de la « scène du plan » du nouvel éditeur de plans (projet
// docs/projets/editeur-plans.md, tâche 6a, étape 1) : à partir d'un relevé, de
// son modèle, des métrés et des points à valider, la liste de ce qu'il faut
// dessiner (pièces, murs pleins, ouvertures, cotes, repères) et sa sortie SVG.
//
// Jeux de test :
//  • des logements dessinés à la main dans ce fichier : exemples issus des
//    tests, données fictives ;
//  • le relevé de référence ANONYMISÉ de scripts/fixtures/ (6 pièces), le même
//    que scripts/verif-releve-imapper.mjs. Aucun relevé réel n'est versionné.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assemblerReleve, lirePdfImapper, calculerMetres, texteMetre, couleurPiece, cotesPiece, longueursCotes, COTE_MIN_M,
} from "../src/Renovation/releveImapper.mjs";
import { construireModeleExistant } from "../src/Renovation/planV2/planV2Modele.mjs";
import { redresserReleve } from "../src/Renovation/planV2/planV2Redressement.mjs";
import { construireScene, mesurerRecouvrement, CALQUES_SCENE, VERSION_SCENE } from "../src/Renovation/planV2/planV2Scene.mjs";
import {
  dessinerScene, dessinEnSvg, sceneEnSvg, versDessin, versPlan, mesurerTexteDefaut, COULEURS_PLAN, TAILLES_DESSIN, TOUCHER_MIN_PX,
} from "../src/Renovation/planV2/planV2SceneSvg.mjs";

const ici = path.dirname(fileURLToPath(import.meta.url));
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg} : ${a} ≠ ${b} (± ${tol})`);

// TOLÉRANCE : part de l'emprise des murs pleins qui peut recouvrir l'intérieur
// des pièces. Une bande de mur part de la face de la pièce : elle ne mord sur
// une pièce que si une AUTRE pièce se trouve derrière, plus près que
// l'épaisseur lue. Or cette épaisseur est lue dans les murs dessinés par pas de
// 1 cm (un mur de 30 cm peut être lu 31), et deux faces sont dites parallèles
// jusqu'à 5° d'écart. 1 % de l'emprise laisse passer ces deux imprécisions et
// rien d'autre : un mur de 10 cm qui déborderait d'1 cm sur toute sa longueur
// en serait déjà à 10 %. Mesuré sur les deux relevés réels : 0,01 % et 0,13 %.
const RECOUVREMENT_MAX = 0.01;

// ── Logements fictifs ──────────────────────────────────────────────────────
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const piece = (id, polygone, type = "autre") => ({
  id, nom: `Pièce ${id}`, type, polygone, hsp: 2.5, hsp_statut: "defaut", photos: [], observations: [],
});
const releve = (pieces, murs = [], ouvertures = null) => ({
  version: 1, source: { outil: "imapper", projet: "TEST" }, pieces,
  murs: murs.map((polygone) => ({ polygone })), ouvertures, points: {}, scanners: {}, alertes: [],
});
const ouverture = (id, pieceId, mur, t0, t1, plus = {}) => ({
  id, code: id.toUpperCase(), piece: pieceId, mur, t0, t1, type: "porte", pieces_liees: [pieceId], statut: "detecte",
  sens: { charniere: "t0", cote: "interieur" }, hauteur: null, allege: null, origine: "detection", epaisseur: 0.1, masque: false, ...plus,
});
const geler = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(geler); } return o; };
const aire = (P) => Math.abs(P.reduce((t, p, k) => { const q = P[(k + 1) % P.length]; return t + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
const de = (scene, type, f = () => true) => scene.elements.filter((e) => e.type === type && f(e));
const pleins = (scene) => scene.elements.filter((e) => e.type === "mur" || e.type === "jonction").map((e) => e.polygone);

// Pièce de 4 × 3 m, murs extérieurs de 30 cm (les quatre bandes dessinées par
// le relevé ne couvrent PAS les angles : c'est à la scène de les fermer).
const mursRect = [rect(0, -0.3, 4, 0), rect(4, 0, 4.3, 3), rect(0, 3, 4, 3.3), rect(-0.3, 0, 0, 3)];
const unePiece = (ouvertures = null) => releve([piece("A", rect(0, 0, 4, 3), "chambre")], mursRect, ouvertures);
// Deux pièces séparées par une cloison de 10 cm, murs extérieurs de 30 cm.
const mursDeux = [rect(4, 0, 4.1, 3), rect(-0.3, -0.3, 0, 3.3), rect(7, -0.3, 7.3, 3.3), rect(0, -0.3, 7, 0), rect(0, 3, 7, 3.3)];
const deuxPieces = (ouvertures = null) => releve([piece("A", rect(0, 0, 4, 3), "sejour"), piece("B", rect(4.1, 0, 7, 3), "cuisine")], mursDeux, ouvertures);

// SVG bien formé : balises équilibrées, attributs entre guillemets, aucun
// nombre impossible, textes échappés. Retourne les balises ouvertes rencontrées.
function verifierSvg(svg) {
  assert.ok(svg.startsWith("<svg ") && svg.endsWith("</svg>"), "commence par <svg et finit par </svg>");
  for (const mot of ["NaN", "undefined", "Infinity", "null", "[object"]) assert.ok(!svg.includes(mot), `le SVG ne contient pas « ${mot} »`);
  const pile = [], vues = [];
  let reste = svg;
  const re = /<(\/?)([A-Za-z][\w-]*)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/y;
  let i = 0;
  while (i < reste.length) {
    if (reste[i] !== "<") {
      const j = reste.indexOf("<", i), texte = reste.slice(i, j < 0 ? reste.length : j);
      assert.ok(!/>/.test(texte) && !/&(?!(amp|lt|gt|quot);)/.test(texte), `texte échappé : « ${texte.slice(0, 40)} »`);
      i = j < 0 ? reste.length : j;
      continue;
    }
    re.lastIndex = i;
    const m = re.exec(reste);
    assert.ok(m, `balise mal formée vers « ${reste.slice(i, i + 60)} »`);
    const [tout, ferme, nom, attributs, seule] = m;
    assert.ok(!/&(?!(amp|lt|gt|quot);)/.test(attributs), `attributs échappés : ${nom}`);
    if (ferme) assert.equal(pile.pop(), nom, `</${nom}> ferme la bonne balise`);
    else { vues.push(nom); if (!seule) pile.push(nom); }
    i += tout.length;
  }
  assert.deepEqual(pile, [], "toutes les balises sont fermées");
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  assert.ok(vb && Number(vb[1]) > 0 && Number(vb[2]) > 0, "viewBox en unités de sortie");
  return vues;
}

// Chaîne complète sur un relevé, avec ce qui doit être vrai de TOUTE scène.
function chaine(R, { redresser = false, options = {}, reglages = {}, points = null } = {}) {
  geler(R);
  const X = redresser ? redresserReleve(R) : { releve: R, points_a_valider: [] };
  const S = X.releve, modele = construireModeleExistant(S), metres = calculerMetres(S);
  const pts = points || X.points_a_valider;
  const entree = geler({ releve: S, modele, metres, points_a_valider: pts, reglages });
  const avant = JSON.stringify(entree);
  const scene = construireScene(entree);
  const dessin = dessinerScene(scene, options), svg = dessinEnSvg(dessin);
  assert.equal(JSON.stringify(entree), avant, "relevé, modèle, métrés et points d'entrée non modifiés");
  // Déterministe, et enregistrable tel quel.
  assert.equal(JSON.stringify(construireScene(entree)), JSON.stringify(scene), "deux calculs : même scène");
  assert.equal(sceneEnSvg(scene, options), svg, "deux sorties : même SVG");
  assert.deepEqual(JSON.parse(JSON.stringify(scene)), scene, "la scène s'enregistre telle quelle (JSON)");
  assert.equal(scene.version, VERSION_SCENE);
  assert.equal(scene.unite, "m");
  assert.deepEqual(scene.calques, CALQUES_SCENE);
  const ids = scene.elements.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "identifiants d'éléments uniques");
  const rang = scene.elements.map((e) => CALQUES_SCENE.indexOf(e.calque));
  assert.ok(rang.every((r, i) => r >= 0 && (i === 0 || r >= rang[i - 1])), "éléments rangés calque par calque");
  for (const e of scene.elements) {
    assert.ok(e.objet && e.objet.type && e.objet.id != null, `${e.id} : objet métier désigné`);
    assert.ok(["existant", "a_demolir", "a_creer", null].includes(e.etat) && "corps_etat" in e, `${e.id} : état et corps d'état`);
    for (const q of e.polygone || []) assert.ok(Number.isFinite(q[0]) && Number.isFinite(q[1]), `${e.id} : coordonnées finies`);
  }
  // Emplacements prévus et vides.
  for (const c of ["equipements", "traits", "notes", "projet"]) assert.equal(scene.elements.filter((e) => e.calque === c).length, 0, `calque ${c} prévu, vide`);

  // Pièces : un remplissage de la couleur du type, une étiquette dont la
  // surface est EXACTEMENT le texte des métrés reçus.
  const sols = S.pieces.filter((p) => p.polygone.length >= 3);
  assert.equal(de(scene, "piece").length, sols.length, "une pièce de scène par pièce du relevé");
  for (const p of sols) {
    const e = scene.elements.find((x) => x.id === `piece:${p.id}`), l = metres.pieces.find((x) => x.id === p.id);
    assert.deepEqual([e.polygone, e.couleur, e.nom], [p.polygone, couleurPiece(p.type), p.nom], `${p.id} : contour, couleur, nom`);
    assert.equal(e.surface.texte, `${texteMetre(l.sol)} m²`, `${p.id} : surface = texte des métrés`);
    const formes = dessin.formes.filter((f) => f.element === e.id);
    const sol = formes.filter((f) => f.role === "sol");
    assert.ok(sol.length === 1 && sol[0].forme === "polygone" && sol[0].interactif && sol[0].remplissage === couleurPiece(p.type), `${p.id} : un seul sol, cliquable, coloré`);
    assert.equal(formes.filter((f) => f.interactif).length, 1, `${p.id} : la pièce se touche d'un seul tenant (étiquette non cliquable)`);
    const textes = formes.filter((f) => f.forme === "texte").map((f) => f.texte);
    assert.ok(textes.includes(e.surface.texte) || textes.includes(`${p.nom} · ${e.surface.texte}`), `${p.id} : étiquette avec la surface (${textes.join(" | ")})`);
    assert.ok(textes.some((t) => t.startsWith(p.nom)), `${p.id} : étiquette avec le nom`);
  }

  // Murs : chaque mur du modèle a UN élément, ou une raison de ne pas en avoir.
  const murs = modele.existant.murs;
  for (const m of murs) {
    const el = scene.elements.filter((e) => e.id === m.id);
    const sans = scene.bilan.murs_sans_element.find((x) => x.mur === m.id);
    if (m.type === "raccord") { assert.ok(!el.length && sans && sans.raison, `${m.id} : raccord sans élément, raison donnée`); continue; }
    assert.ok(el.length === 1 && !sans, `${m.id} : un élément`);
    if (m.type !== "limite" && m.epaisseur > 0) {
      assert.ok(el[0].type === "mur" && el[0].polygone.length === 4 && aire(el[0].polygone) > 0, `${m.id} : bande pleine`);
      assert.deepEqual([el[0].etat, el[0].corps_etat, el[0].epaisseur], [m.etat, m.corps_etat, m.epaisseur], `${m.id} : état, corps d'état, épaisseur du modèle`);
    } else {
      assert.equal(el[0].type, "mur_trait", `${m.id} : pas de bande sans épaisseur`);
      assert.ok(el[0].raison && el[0].genre === (m.type === "limite" ? "limite" : "epaisseur_inconnue"), `${m.id} : trait avec sa raison`);
    }
  }
  assert.equal(de(scene, "mur").length + de(scene, "mur_trait").length + scene.bilan.murs_sans_element.length, murs.length, "aucun mur du modèle oublié");
  for (const j of de(scene, "jonction")) {
    assert.ok(j.murs.length === 2 && j.murs.every((id) => murs.some((m) => m.id === id)) && aire(j.polygone) > 0, `${j.id} : relie deux murs du modèle`);
  }

  // Cotes : une par côté d'au moins 30 cm, longueur réelle du côté.
  const attendues = sols.flatMap((p) => longueursCotes(p.polygone).map((L, k) => [`cote:${p.id}:${k}`, L]).filter(([, L]) => L >= COTE_MIN_M));
  assert.deepEqual(de(scene, "cote").map((c) => c.id).sort(), attendues.map(([id]) => id).sort(), "cotes : tous les côtés d'au moins 30 cm");
  for (const [id, L] of attendues) {
    const c = scene.elements.find((e) => e.id === id);
    proche(Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]), L, 1e-12, `${id} : extrémités sur le côté`);
    assert.deepEqual([c.longueur, c.texte], [L, String(Math.round(L * 100))], `${id} : longueur réelle, en centimètres`);
  }
  assert.equal(dessin.cotes.length, attendues.length, "la mise en page rend compte de chaque cote");
  for (const c of dessin.cotes) assert.ok(c.visible ? c.raison === null : typeof c.raison === "string", `${c.id} : affichée, ou raison de ne pas l'être`);

  // Dessin : formes finies, orange réservé à ce qui est à valider, zones de
  // toucher d'au moins 44 px, SVG bien formé.
  const orange = COULEURS_PLAN.a_valider;
  const aValider = new Set(scene.elements.filter((e) => e.type === "point_a_valider" || (e.type === "ouverture" && e.rendu !== "menuiserie")).map((e) => e.id));
  for (const f of dessin.formes) {
    for (const v of [f.points, f.a, f.b, f.de, f.vers, [f.cx, f.cy, f.x, f.y, f.rayon, f.largeur, f.hauteur, f.taille, f.angle, f.epaisseur]].flat(2)) {
      assert.ok(v === undefined || Number.isFinite(v), `forme ${f.role} de ${f.element} : nombres finis`);
    }
    const enOrange = [f.remplissage, f.trait, f.couleur].includes(orange);
    assert.equal(enOrange && !aValider.has(f.element), false, `${f.element} (${f.role}) : orange réservé à ce qui est à valider`);
  }
  for (const id of aValider) assert.ok(dessin.formes.some((f) => f.element === id && [f.trait, f.couleur].includes(orange)), `${id} : dessiné en orange`);
  const mini = TOUCHER_MIN_PX / (options.pxEcranParUnite || 1) - 1e-9;
  for (const e of scene.elements.filter((x) => x.type === "ouverture" || x.type === "point_a_valider")) {
    const z = dessin.zones_toucher.filter((x) => x.element === e.id);
    assert.equal(z.length, 1, `${e.id} : une zone de toucher`);
    assert.ok(z[0].forme === "cercle" ? 2 * z[0].rayon >= mini : z[0].largeur >= mini && z[0].hauteur >= mini, `${e.id} : zone d'au moins 44 px`);
  }
  verifierSvg(svg);
  assert.equal((svg.match(/data-role="sol"/g) || []).length, sols.length, "SVG : un sol par pièce");
  return { releve: S, modele, metres, scene, dessin, svg, points: pts };
}

// Épaisseur des murs extérieurs telle que le modèle la lit dans les murs
// dessinés (par pas de 1 cm : un mur dessiné à 30 cm peut être lu 29).
const epaisseurLue = (modele) => {
  const e = [...new Set(modele.existant.murs.filter((m) => m.type === "peripherique").map((m) => m.epaisseur))];
  assert.ok(e.length === 1 && e[0] >= 0.29 && e[0] <= 0.3, `murs extérieurs lus à ${e.join(" / ")} m`);
  return e[0];
};

test("pièce seule : quatre murs à leur épaisseur, quatre angles fermés, anneau sans trou", () => {
  const { scene, modele, releve: S } = chaine(unePiece());
  const e = epaisseurLue(modele), sols = S.pieces.map((p) => p.polygone);
  assert.deepEqual([de(scene, "mur").length, de(scene, "jonction").length, de(scene, "mur_trait").length], [4, 4, 0]);
  assert.ok(de(scene, "jonction").every((j) => j.source === "calcul" && j.polygone.length === 4));
  for (const m of de(scene, "mur")) proche(aire(m.polygone), (m.polygone[1][0] === m.polygone[0][0] ? 3 : 4) * e, 1e-9, `${m.id} : bande à l'épaisseur du mur`);
  for (const j of de(scene, "jonction")) proche(aire(j.polygone), e * e, 1e-9, `${j.id} : carré d'angle`);
  // L'anneau : tout ce qui est entre la pièce et le rectangle extérieur.
  const anneau = mesurerRecouvrement(pleins(scene), sols, { pas: 0.005 });
  proche(anneau.surface_m2, (4 + 2 * e) * (3 + 2 * e) - 12, 0.02, "emprise = rectangle extérieur − pièce");
  assert.equal(anneau.commune_m2, 0, "aucun mur dans la pièce");
  // Les quatre angles, que les murs dessinés du relevé ne couvraient pas.
  const angles = [rect(-e, -e, 0, 0), rect(4, -e, 4 + e, 0), rect(4, 3, 4 + e, 3 + e), rect(-e, 3, 0, 3 + e)];
  for (const a of angles) assert.equal(mesurerRecouvrement([a], pleins(scene), { pas: 0.005 }).part, 1, "angle entièrement plein");
  assert.equal(mesurerRecouvrement([rect(-e, -e, 4 + e, 3 + e)], [...pleins(scene), ...sols], { pas: 0.005 }).part, 1, "aucun trou dans le rectangle extérieur");
  assert.deepEqual(scene.emprise, { x0: -e, y0: -e, x1: 4 + e, y1: 3 + e });
});

test("deux pièces : la cloison est UN mur, les rencontres en T sont pleines, rien ne mord sur les pièces", () => {
  const { scene, modele, releve: S } = chaine(deuxPieces());
  const e = epaisseurLue(modele), sols = S.pieces.map((p) => p.polygone);
  const cloison = modele.existant.murs.find((m) => m.type === "partage");
  const el = scene.elements.find((x) => x.id === cloison.id);
  assert.deepEqual([el.type, el.type_mur, el.objet], ["mur", "partage", { type: "mur", id: cloison.id }]);
  proche(aire(el.polygone), 0.1 * 3, 1e-9, "cloison de 10 cm sur 3 m");
  const tout = mesurerRecouvrement([rect(-e, -e, 7 + e, 3 + e)], [...pleins(scene), ...sols], { pas: 0.005 });
  assert.equal(tout.part, 1, "aucun trou : ni aux angles, ni au bout de la cloison");
  const r = mesurerRecouvrement(pleins(scene), sols, { pas: 0.005 });
  assert.equal(r.commune_m2, 0, "aucun mur dans une pièce");
  proche(r.surface_m2, (7 + 2 * e) * (3 + 2 * e) - 12 - 8.7, 0.02, "emprise des murs = tout ce qui n'est pas pièce");
  // Les jonctions du T relient la cloison à un mur extérieur.
  assert.ok(de(scene, "jonction").filter((j) => j.murs.includes(cloison.id)).length >= 2, "le bout de la cloison est relié aux murs extérieurs");
});

test("décrochement : le mur fait le tour, sans trou derrière le petit côté", () => {
  // Le haut de la pièce descend de 40 cm sur sa moitié droite (mur de 30 cm qui suit).
  const P = [[0, 0], [6, 0], [6, 2.6], [3, 2.6], [3, 3], [0, 3]];
  const murs = [rect(-0.3, -0.3, 6.3, 0), rect(6, 0, 6.3, 2.9), rect(3.3, 2.6, 6.3, 2.9), rect(3, 2.6, 3.3, 3.3), rect(-0.3, 3, 3, 3.3), rect(-0.3, 0, 0, 3)];
  const { scene, modele, releve: S } = chaine(releve([piece("A", P)], murs));
  const e = epaisseurLue(modele);
  assert.ok(modele.existant.murs.some((m) => m.type === "raccord"), "le petit côté du décrochement est un raccord");
  assert.ok(de(scene, "jonction").some((j) => j.source === "raccord"), "jonction derrière le raccord");
  // Contour extérieur du mur, à l'épaisseur lue : tout y est mur ou pièce.
  const dehors = [[-e, -e], [6 + e, -e], [6 + e, 2.6 + e], [3 + e, 2.6 + e], [3 + e, 3 + e], [-e, 3 + e]];
  assert.equal(mesurerRecouvrement([dehors], [...pleins(scene), P], { pas: 0.005 }).part, 1, "aucun trou, y compris derrière le décrochement");
  assert.equal(mesurerRecouvrement(pleins(scene), [dehors], { pas: 0.005 }).part, 1, "rien ne dépasse du contour extérieur");
  assert.equal(mesurerRecouvrement(pleins(scene), S.pieces.map((p) => p.polygone), { pas: 0.005 }).commune_m2, 0, "rien dans la pièce");
});

test("épaisseur inconnue : un trait interrompu, jamais une bande d'épaisseur par défaut", () => {
  const R = releve([piece("A", rect(0, 0, 4, 3)), piece("B", rect(4.1, 0, 7, 3))]);       // relevé sans murs dessinés
  const { scene, dessin, svg } = chaine(R);
  const traits = de(scene, "mur_trait");
  assert.equal(traits.length, 6, "six murs extérieurs sans épaisseur");
  assert.ok(traits.every((t) => t.genre === "epaisseur_inconnue" && t.raison === "releve_sans_murs"));
  assert.deepEqual([de(scene, "mur").length, de(scene, "jonction").length], [1, 0], "seule la cloison (mesurée entre ses deux faces) est pleine");
  assert.equal(scene.bilan.murs_epaisseur_inconnue, 6);
  const formes = dessin.formes.filter((f) => f.role === "mur_epaisseur_inconnue");
  assert.ok(formes.length === 6 && formes.every((f) => f.forme === "ligne" && f.tirets && !f.remplissage), "traits interrompus, sans aplat");
  assert.ok(svg.includes("stroke-dasharray"));
});

test("ouvertures : « à vérifier » en orange et sans trou, porte et fenêtre validées en menuiseries, non placée en repère", () => {
  const R = deuxPieces([
    ouverture("p1", "A", 0, 1, 1.9, { statut: "valide" }),
    ouverture("f1", "A", 3, 1, 2.2, { type: "fenetre", statut: "confirme_photo" }),
    ouverture("p2", "B", 2, 0.5, 1.4, { statut: "a_verifier" }),
    ouverture("f2", "B", 1, null, null, { type: "fenetre", statut: "a_verifier" }),
    ouverture("p3", "B", 0, 0.2, 1.0, { masque: true }),
  ]);
  const { scene, dessin, modele } = chaine(R);
  const o = (id) => scene.elements.find((e) => e.id === `ouverture:${id}`);
  assert.deepEqual(["p1", "f1", "p2", "f2"].map((id) => o(id).rendu), ["menuiserie", "menuiserie", "a_valider", "a_placer"]);
  assert.equal(o("p3"), undefined, "ouverture masquée : pas dessinée");
  assert.deepEqual(scene.bilan.ouvertures, { menuiseries: 2, a_valider: 1, a_placer: 1, sans_repere: [] });
  assert.deepEqual(scene.indications, []);
  const roles = (id) => dessin.formes.filter((f) => f.element === `ouverture:${id}`).map((f) => f.role);
  // Porte validée : trou dans le mur, vantail, arc de débattement, à la largeur réelle.
  assert.ok(["baie", "menuiserie", "vantail", "debattement", "pastille", "code"].every((r) => roles("p1").includes(r)), roles("p1").join(","));
  proche(o("p1").largeur, 0.9, 1e-9, "largeur réelle");
  proche(o("p1").symbole.arc.rayon, 0.9, 1e-9, "débattement = largeur de la porte");
  const mur = modele.existant.murs.find((m) => m.id === o("p1").mur);
  assert.deepEqual([o("p1").epaisseur, o("p1").epaisseur_source], [mur.epaisseur, "mur"], "trou à l'épaisseur du mur qui porte l'ouverture");
  assert.deepEqual(o("p1").sens, { charniere: "t0", cote: "interieur" });
  assert.equal(o("f1").symbole.lignes.length, 3, "fenêtre : trois traits dans l'épaisseur du mur");
  assert.ok(!roles("f1").includes("vantail"));
  // « À vérifier » : ni trou ni symbole de menuiserie.
  assert.deepEqual([...new Set(roles("p2"))], ["a_valider"], "à vérifier : repère seul");
  assert.ok(!("symbole" in o("p2")) && o("p2").marque.length === 2);
  assert.ok(dessin.formes.filter((f) => f.element === "ouverture:p2").every((f) => f.trait === COULEURS_PLAN.a_valider));
  // Non placée : pastille « ? » orange, pas de géométrie inventée.
  assert.deepEqual(roles("f2"), ["pastille", "code"]);
  assert.ok(!("baie" in o("f2")) && dessin.formes.find((f) => f.element === "ouverture:f2" && f.role === "code").texte === "F2 ?");
  for (const id of ["p1", "f1"]) assert.ok(dessin.formes.filter((f) => f.element === `ouverture:${id}`).every((f) => ![f.trait, f.couleur, f.remplissage].includes(COULEURS_PLAN.a_valider)), `${id} : pas d'orange`);
});

test("ouvertures pas encore relevées (null) : aucune ouverture dessinée, et le plan le dit", () => {
  const { scene, svg } = chaine(deuxPieces(null), { options: { titre: "Essai" } });
  assert.equal(de(scene, "ouverture").length, 0);
  assert.equal(scene.bilan.ouvertures, null, "null reste null : ce n'est pas « zéro ouverture »");
  assert.deepEqual(scene.indications.map((i) => i.code), ["ouvertures_non_relevees"]);
  assert.ok(svg.includes("Ouvertures non relevées"), "indication écrite sur le plan");
  assert.ok(svg.includes(">Essai<"), "titre écrit sous le plan");
  // Relevé dont les ouvertures sont relevées et qui n'en a aucune : pas d'indication.
  const vide = chaine(deuxPieces([]));
  assert.deepEqual([vide.scene.indications, vide.scene.bilan.ouvertures], [[], { menuiseries: 0, a_valider: 0, a_placer: 0, sans_repere: [] }]);
  assert.ok(!vide.svg.includes("Ouvertures non relevées"));
});

test("cotes : masquer ou déplacer une cote par son identifiant, sans la recalculer", () => {
  const base = chaine(unePiece());
  assert.deepEqual(de(base.scene, "cote").map((c) => [c.id, c.texte]), [["cote:A:0", "400"], ["cote:A:1", "300"], ["cote:A:2", "400"], ["cote:A:3", "300"]]);
  assert.ok(base.dessin.cotes.every((c) => c.visible), "quatre cotes affichées");
  const cote = (d, id) => d.formes.find((f) => f.element === id && f.role === "cote");
  // À l'intérieur de la pièce, le long du côté.
  const c0 = cote(base.dessin, "cote:A:0"), [x, y] = versPlan(base.dessin.projection, [c0.x, c0.y]);
  assert.ok(x > 1.9 && x < 2.1 && y > 0 && y < 0.4, `cote du bas : au milieu du côté, dans la pièce (${x}, ${y})`);
  assert.equal(c0.angle, 0);
  assert.equal(Math.abs(cote(base.dessin, "cote:A:1").angle), 90, "cote d'un côté vertical : tournée d'un quart de tour");
  const regle = chaine(unePiece(), { reglages: { cotes: { "cote:A:0": { masquee: true }, "cote:A:2": { decalage: [0.5, -1] } } } });
  assert.deepEqual(regle.dessin.cotes.find((c) => c.id === "cote:A:0"), { id: "cote:A:0", visible: false, raison: "masquee", texte: "400" });
  assert.equal(cote(regle.dessin, "cote:A:0"), undefined, "cote masquée : pas dessinée");
  const avant = cote(base.dessin, "cote:A:2"), apres = cote(regle.dessin, "cote:A:2");
  proche(apres.x - avant.x, 0.5 * 50, 1e-9, "déplacée de 50 cm vers la droite");
  proche(apres.y - avant.y, 1 * 50, 1e-9, "déplacée de 1 m vers le bas");
  assert.equal(apres.texte, "400", "la valeur ne change pas");
});

test("cloison qui avance dans une pièce : ses deux faces ne donnent qu'une cote", () => {
  const P = [[0, 0], [2.95, 0], [2.95, 2], [3.05, 2], [3.05, 0], [6, 0], [6, 4], [0, 4]];
  const { scene, dessin } = chaine(releve([piece("A", P)], [rect(2.95, 0, 3.05, 2), rect(-0.3, -0.3, 6.3, 0), rect(6, 0, 6.3, 4), rect(-0.3, 4, 6.3, 4.3), rect(-0.3, 0, 0, 4)]));
  const faces = de(scene, "cote", (c) => c.texte === "200");
  assert.deepEqual(faces.map((c) => [c.id, c.doublon]), [["cote:A:1", null], ["cote:A:3", "cote:A:1"]]);
  assert.deepEqual(dessin.cotes.filter((c) => c.texte === "200").map((c) => [c.visible, c.raison]), [[true, null], [false, "doublon"]]);
});

test("points à valider du redressement : un repère orange numéroté par point, sur les côtés désignés", () => {
  // Pièce B dont le côté droit penche de 3° : le redressement le propose sans l'appliquer.
  const R = releve([piece("A", rect(0, 0, 6, 4)), piece("B", [[7, 0], [10, 0], [10 + 3 * Math.tan((3 * Math.PI) / 180), 3], [7, 3]])]);
  const { scene, dessin, points, releve: S } = chaine(R, { redresser: true });
  assert.ok(points.length >= 1, "le redressement laisse au moins un point à valider");
  const reperes = de(scene, "point_a_valider");
  assert.deepEqual(reperes.map((p) => [p.id, p.cle, p.numero]), points.map((p, i) => [`point:${p.cle}`, p.cle, i + 1]));
  for (const p of reperes) {
    const source = points.find((x) => x.cle === p.cle);
    assert.deepEqual(p.segments.map((s) => [s.piece, s.cote]), source.cotes.map((c) => [c.piece, c.cote]), "côtés désignés par le point");
    for (const s of p.segments) {
      const c = cotesPiece(S.pieces.find((x) => x.id === s.piece))[s.cote];
      assert.deepEqual([s.a, s.b], [c.a, c.b], "repère posé sur le côté de la pièce redressée");
    }
    assert.equal(p.texte, source.texte);
    const roles = dessin.formes.filter((f) => f.element === p.id).map((f) => f.role);
    assert.deepEqual([...new Set(roles)].sort(), ["cote_a_valider", "numero", "repere"]);
    assert.equal(roles.filter((r) => r === "cote_a_valider").length, p.segments.length);
  }
  // Un point sans côté (alerte générale) n'a pas de repère : il est listé à part.
  const autre = chaine(R, { points: [{ cle: "hsp_defaut", code: "hsp_defaut", texte: "Hauteur par défaut" }] });
  assert.deepEqual([de(autre.scene, "point_a_valider").length, autre.scene.hors_plan, autre.scene.bilan.points_hors_plan], [0, [{ cle: "hsp_defaut", texte: "Hauteur par défaut" }], 1]);
});

test("échelle : la géométrie suit l'échelle, les textes gardent leur taille ; tailles et mesure de texte réglables", () => {
  const { scene } = chaine(unePiece([]));
  const a = dessinerScene(scene, { unitesParMetre: 50 }), b = dessinerScene(scene, { unitesParMetre: 100 });
  const m = TAILLES_DESSIN.marge, E = scene.emprise, L = E.x1 - E.x0, H = E.y1 - E.y0;
  [[a.largeur, L * 50 + 2 * m], [a.hauteur, H * 50 + 2 * m], [b.largeur, L * 100 + 2 * m], [b.hauteur, H * 100 + 2 * m]]
    .forEach(([v, attendu]) => proche(v, attendu, 1e-9, "taille du dessin = emprise × échelle + marges"));
  // 1 m du plan = `unitesParMetre` unités du dessin (1/50 en millimètres : 20).
  const pr = dessinerScene(scene, { unitesParMetre: 20, facteurTailles: 0.2646 }).projection;
  const [p, q] = [versDessin(pr, [0, 0]), versDessin(pr, [1, 0])];
  proche(Math.hypot(q[0] - p[0], q[1] - p[1]), 20, 1e-9, "1 m = 20 unités à l'échelle 20");
  assert.deepEqual(versPlan(pr, versDessin(pr, [1.25, 2.5])).map((v) => Math.round(v * 1e9) / 1e9), [1.25, 2.5], "aller et retour plan ↔ dessin");
  const taille = (d, role) => d.formes.find((f) => f.role === role).taille;
  assert.deepEqual([taille(a, "nom"), taille(a, "cote")], [taille(b, "nom"), taille(b, "cote")], "textes de même taille à toute échelle");
  assert.deepEqual([taille(a, "nom"), taille(a, "cote")], [TAILLES_DESSIN.etiquetteNom, TAILLES_DESSIN.cote]);
  const demi = dessinerScene(scene, { unitesParMetre: 50, facteurTailles: 0.5 });
  assert.deepEqual([taille(demi, "nom"), taille(demi, "cote")], [TAILLES_DESSIN.etiquetteNom / 2, TAILLES_DESSIN.cote / 2], "facteur de taille appliqué");
  assert.equal(dessinerScene(scene, { tailles: { cote: 20 } }).formes.find((f) => f.role === "cote").taille, 20);
  // À très petite échelle les textes ne tiennent plus : la cote n'est pas
  // dessinée (et on sait pourquoi), l'étiquette passe sur un fond clair.
  const petit = dessinerScene(scene, { unitesParMetre: 4 });
  assert.ok(petit.cotes.every((c) => !c.visible && c.raison === "cote_trop_court"), "cotes non affichées : côté trop court à cette échelle");
  assert.deepEqual(petit.etiquettes.map((e) => e.tient), [false]);
  assert.ok(petit.formes.some((f) => f.role === "fond_etiquette"));
  // La mesure de texte est fournie par l'appelant ; à défaut, une estimation.
  let appels = 0;
  const large = dessinerScene(scene, { mesurerTexte: (t, taille) => { appels++; return t.length * taille * 3; } });
  assert.ok(appels > 0 && large.cotes.filter((c) => c.visible).length < 4, "une mesure plus large masque des cotes");
  assert.ok(mesurerTexteDefaut("400", 10) > 12 && mesurerTexteDefaut("400", 10) < 22 && mesurerTexteDefaut("400", 10, { gras: true }) > mesurerTexteDefaut("400", 10));
});

test("zones de toucher : au moins 44 px à l'écran, quel que soit le zoom d'affichage", () => {
  const R = deuxPieces([ouverture("p1", "A", 0, 1, 1.9, { statut: "valide" }), ouverture("p2", "B", 2, 0.5, 1.4, { statut: "a_verifier" })]);
  const { scene, dessin } = chaine(R);
  const z = dessin.zones_toucher.find((x) => x.element === "ouverture:p1");
  // Porte de 90 cm dans un mur de 30 cm, à 50 unités par mètre : 45 × 15 → 45 × 44.
  assert.deepEqual([z.forme, Math.round(z.largeur * 1e6) / 1e6, z.hauteur], ["rect", 45, 44]);
  // Affiché deux fois plus grand (zoom) : 22 unités suffisent pour 44 px.
  const zoom = chaine(R, { options: { pxEcranParUnite: 2 } }).dessin.zones_toucher.find((x) => x.element === "ouverture:p1");
  assert.deepEqual([Math.round(zoom.largeur * 1e6) / 1e6, zoom.hauteur], [45, 22]);
  assert.ok(!dessin.formes.some((f) => f.role === "zone_toucher"), "zones décrites, pas dessinées par défaut");
  const avec = dessinerScene(scene, { zonesToucher: true });
  assert.equal(avec.formes.filter((f) => f.role === "zone_toucher").length, 2);
  assert.ok(dessinEnSvg(avec).includes('pointer-events="all"'));
});

test("état d'un mur : existant en gris-noir, à démolir en jaune, à créer en rouge (règle 12)", () => {
  const R = unePiece(), modele = JSON.parse(JSON.stringify(construireModeleExistant(R)));
  modele.existant.murs[0].etat = "a_demolir";
  modele.existant.murs[1].etat = "a_creer";
  const scene = construireScene({ releve: R, modele, metres: calculerMetres(R) });
  const d = dessinerScene(scene), couleur = (i) => d.formes.find((f) => f.element === modele.existant.murs[i].id).remplissage;
  assert.deepEqual([couleur(0), couleur(1), couleur(2)], [COULEURS_PLAN.a_demolir, COULEURS_PLAN.a_creer, COULEURS_PLAN.existant]);
  assert.deepEqual([COULEURS_PLAN.a_demolir, COULEURS_PLAN.a_creer], ["#f2c200", "#d92d20"]);
  // Ce que la scène ne sait pas encore dessiner n'est pas passé sous silence.
  modele.notes.push({ id: "n1", texte: "à voir" });
  assert.deepEqual(construireScene({ releve: R, modele }).indications.map((i) => i.code), ["ouvertures_non_relevees", "elements_non_dessines"]);
});

test("métrés absents, relevé vide ou absent : rien ne casse, et la surface inconnue se voit", () => {
  const R = unePiece();
  const scene = construireScene({ releve: R, modele: construireModeleExistant(R) });
  assert.deepEqual(de(scene, "piece")[0].surface, { texte: "non calculable", connue: false });
  assert.ok(sceneEnSvg(scene).includes("non calculable"));
  for (const entree of [undefined, {}, { releve: null, modele: null }, { releve: releve([]), modele: construireModeleExistant(releve([])) }, { releve: releve([piece("A", [])]), modele: construireModeleExistant(releve([piece("A", [])])) }]) {
    const s = construireScene(entree);
    assert.deepEqual([s.elements, s.emprise], [[], { x0: 0, y0: 0, x1: 0, y1: 0 }]);
    verifierSvg(sceneEnSvg(s, { titre: "Plan vide" }));
  }
  // Un nom de pièce avec des caractères spéciaux ne casse pas le SVG.
  const special = releve([{ ...piece("A", rect(0, 0, 4, 3)), nom: "Salon & <séjour> \"sud\"" }], mursRect);
  const svg = chaine(special).svg;
  assert.ok(svg.includes("Salon &amp; &lt;séjour&gt; &quot;sud&quot;"));
});

// ── Relevé de référence anonymisé (scripts/fixtures) ───────────────────────
const dxfTexte = fs.readFileSync(path.join(ici, "fixtures/releve-imapper-reference.dxf"), "latin1");
const pdfJson = JSON.parse(fs.readFileSync(path.join(ici, "fixtures/releve-imapper-reference-pdf.json"), "utf8"));
const pdfs = pdfJson.pdfs.map((p) => ({ nom: p.nom, lecture: lirePdfImapper(p.page1, p.page2), nbPhotos: p.nbPhotos }));
const REF = () => assemblerReleve({ dxfTexte, pdfs, maintenant: "2026-10-15T10:00:00Z" }).releve;

test("relevé de référence : scène complète sur le relevé redressé, murs fermés, pièces intactes", () => {
  const { scene, dessin, svg, releve: S, modele } = chaine(REF(), { redresser: true, options: { titre: "Relevé de référence (données fictives)" } });
  const sols = S.pieces.map((p) => p.polygone), dessines = S.murs.map((m) => m.polygone);
  const r = mesurerRecouvrement(pleins(scene), sols);
  assert.ok(r.part <= RECOUVREMENT_MAX, `murs pleins dans les pièces : ${(r.part * 100).toFixed(2)} % (au plus ${RECOUVREMENT_MAX * 100} %)`);
  // Fidélité au relevé : les murs dessinés par iMapper se retrouvent dans les
  // murs pleins (ou dans les pièces, là où iMapper les fait déborder).
  const retrouves = mesurerRecouvrement(dessines, [...pleins(scene), ...sols]);
  assert.ok(retrouves.part >= 0.97, `murs dessinés du relevé retrouvés : ${(retrouves.part * 100).toFixed(2)} %`);
  const invente = mesurerRecouvrement(pleins(scene), [...dessines, ...sols]);
  assert.ok(invente.part >= 0.97, `murs pleins appuyés sur les murs dessinés : ${(invente.part * 100).toFixed(2)} %`);
  assert.equal(scene.bilan.murs_epaisseur_inconnue, modele.existant.murs.filter((m) => m.type === "peripherique" && m.epaisseur == null).length);
  const b = scene.bilan, visibles = dessin.cotes.filter((c) => c.visible).length;
  const parRendu = (rendu) => de(scene, "ouverture", (e) => e.rendu === rendu).length;
  assert.equal(parRendu("menuiserie") + parRendu("a_valider") + parRendu("a_placer"), S.ouvertures.filter((o) => !o.masque).length, "aucune ouverture perdue");
  console.log(`      exemple issu des tests, données fictives (relevé de référence anonymisé, hors base) : ${b.pieces} pièces, ${b.murs} murs pleins, ${b.jonctions} jonctions, ${b.murs_sans_element.length} raccords sans élément, ${b.jonctions_ecartees.length} jonction(s) écartée(s) ; ouvertures : ${b.ouvertures.menuiseries} menuiseries, ${b.ouvertures.a_valider} à valider, ${b.ouvertures.a_placer} à placer ; ${b.cotes} cotes dont ${visibles} affichées à 50 unités par mètre ; ${b.points_a_valider} points à valider ; murs pleins dans les pièces ${(r.part * 100).toFixed(2)} %, murs du relevé retrouvés ${(retrouves.part * 100).toFixed(2)} % ; SVG de ${Math.round(svg.length / 1024)} ko.`);
  // Chiffres figés : un changement de la scène doit se voir ici.
  assert.deepEqual([b.pieces, b.murs, b.jonctions, b.murs_sans_element.length, b.murs_epaisseur_inconnue, b.limites, b.cotes, b.points_a_valider],
    [REFERENCE.pieces, REFERENCE.murs, REFERENCE.jonctions, REFERENCE.raccords, 0, 0, REFERENCE.cotes, REFERENCE.points]);
  assert.deepEqual(b.ouvertures, REFERENCE.ouvertures);
});
const REFERENCE = { pieces: 6, murs: 30, jonctions: 27, raccords: 10, cotes: 36, points: 7, ouvertures: { menuiseries: 6, a_valider: 14, a_placer: 0, sans_repere: [] } };

test("relevé de référence brut (sans redressement) : la scène se construit aussi, mêmes garanties", () => {
  const { scene, releve: S } = chaine(REF());
  const r = mesurerRecouvrement(pleins(scene), S.pieces.map((p) => p.polygone));
  assert.ok(r.part <= RECOUVREMENT_MAX, `murs pleins dans les pièces : ${(r.part * 100).toFixed(2)} %`);
  assert.equal(de(scene, "point_a_valider").length, 0);
});

let ok = 0;
for (const [nom, fn] of cas) {
  try { await fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { console.error(`  ✗ ${nom}\n    ${e.message}`); process.exitCode = 1; }
}
console.log(`\n${ok}/${cas.length} vérifications scène du plan (nouvel éditeur)`);
