// Vérification de l'import d'un relevé iMapper (lot 1 : pièces, murs, noms,
// scans isolés, rapprochement des PDF, photos ↔ murs, métrés, rendu).
//
// Jeu de test : le relevé de référence du 14/10/2026 (6 pièces), en version
// ANONYMISÉE dans scripts/fixtures/ (numéro de projet remplacé, textes des PDF
// sans titre ni auteur, aucune photo). Les fichiers d'origine (photos du
// logement) ne sont jamais versionnés : s'ils sont présents dans
// scripts/fixtures-privees/releve-reference/, la lecture des vrais PDF
// (extraction des photos) est vérifiée en plus — sinon cette partie est sautée.
//
// Les ouvertures utilisées pour le test des métrés sont celles du prototype
// (largeurs relevées), posées sans position réelle : exemple issu des tests,
// données fictives pour ce qui est de leur emplacement.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  lireDXF, releveDepuisDXF, assemblerReleve, lirePdfImapper, extraireJpegsPdf,
  rattacherPhotosMurs, calculerMetres, texteMetre, pointsAValider, airePolygone,
  perimetrePolygone, longueursCotes, pointDansPoly, distancePointPolygone,
  cotesInterieures, traduireNomPiece, emprisesReleve, MSG_DXF_SANS_PIECES,
  decouperPdfImapper, extraireJpegsParPage, versionsDuPlan, ancrePiece, poleInaccessibilite,
  geometrieOuverture, glisserOuverture, largeurOuverture, nouvelleOuverture, ouvertureSousPoint,
  coteLePlusProche, traiterPointAValider, prochainCode,
} from "../src/Renovation/releveImapper.mjs";
import { dessinerReleve, miseEnPageEtiquettes } from "../src/Renovation/releveRendu.mjs";

const ici = path.dirname(fileURLToPath(import.meta.url));
const dxfTexte = fs.readFileSync(path.join(ici, "fixtures/releve-imapper-reference.dxf"), "latin1");
const pdfJson = JSON.parse(fs.readFileSync(path.join(ici, "fixtures/releve-imapper-reference-pdf.json"), "utf8"));
const pdfs = pdfJson.pdfs.map((p) => ({ nom: p.nom, lecture: lirePdfImapper(p.page1, p.page2), nbPhotos: p.nbPhotos }));

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg} : ${a} ≠ ${b} (± ${tol})`);

const res = assemblerReleve({ dxfTexte, pdfs, maintenant: "2026-10-15T10:00:00Z" });
const R = res.releve;
const piece = (nom) => R.pieces.find((p) => p.nom === nom);

// ── Lot 1 — critères de la spécification ───────────────────────────────────
test("le DXF R12 se lit : 6 pièces fermées, murs, points par scan", () => {
  const dxf = lireDXF(dxfTexte);
  assert.equal(dxf.unites, 6);
  assert.equal(dxf.polylignes.filter((p) => p.calque === "A-AREA-ONE-POLYLINE").length, 6);
  assert.equal(dxf.polylignes.filter((p) => p.calque === "A-WALL").length, 37);
  assert.ok(res.ok);
  assert.equal(R.pieces.length, 6);
  assert.equal(R.murs.length, 37);
  assert.equal(R.source.projet, "00000");
  assert.equal(R.source.importe_le, "2026-10-15T10:00:00Z");
  assert.ok(Array.isArray(R.ouvertures), "lot 2 : ouvertures détectées dès l'import");
  assert.equal(assemblerReleve({ dxfTexte, pdfs, detecter: false }).releve.ouvertures, null, "sans détection : null, pas []");
});

test("aires 11,70 / 6,39 / 23,50 / 4,05 / 7,80 / 3,28 m² et périmètres des PDF au mm près", () => {
  const attendu = { Chambre: 11.70, Buanderie: 6.39, Salon: 23.50, "Entrée": 4.05, Cuisine: 7.80, "Salle d'eau": 3.28 };
  for (const [nom, aire] of Object.entries(attendu)) {
    const p = piece(nom);
    assert.ok(p, `pièce ${nom} absente`);
    proche(airePolygone(p.polygone), aire, 0.005, `aire ${nom}`);
    const pdf = pdfs.find((x) => x.nom === p.pdf.nom).lecture;
    proche(perimetrePolygone(p.polygone) * 1000, pdf.perimetre_mm, 1, `périmètre ${nom}`);
  }
});

test("noms : chaque pièce porte le nom de son scanner, scanner à l'intérieur", () => {
  for (const p of R.pieces) {
    assert.ok(p.scan, `${p.nom} sans scan`);
    assert.ok(pointDansPoly(R.scanners[p.scan], p.polygone), `scanner ${p.scan} hors de ${p.nom}`);
  }
  assert.deepEqual(R.pieces.map((p) => p.nom_source).sort(), ["Buand", "Chamb", "Cuisi", "Entre", "Salle", "Salon"]);
  assert.equal(piece("Salle d'eau").type, "salle_d_eau");
  assert.equal(piece("Salon").type, "sejour");
});

test("le scan 277 produit une alerte « scan isolé » et aucune pièce", () => {
  const a = R.alertes.filter((x) => x.code === "scan_isole");
  assert.equal(a.length, 1);
  assert.equal(a[0].scan, "277");
  assert.match(a[0].texte, /Scan « 277 Entrée » isolé à 6 m du logement/);
  assert.ok(!R.pieces.some((p) => p.scan === "277"));
  assert.ok(!R.points["277"] && !R.scanners["277"], "le scan isolé est ignoré pour la suite");
});

test("les 6 PDF sont rapprochés sans ambiguïté ; 60 photos, aucun logo", () => {
  assert.ok(!R.alertes.some((x) => /^pdf_|piece_sans_pdf/.test(x.code)), JSON.stringify(R.alertes));
  assert.equal(new Set(R.pieces.map((p) => p.pdf?.nom)).size, 6);
  assert.equal(R.pieces.reduce((t, p) => t + p.photos.length, 0), 60);
  assert.ok(R.pieces.every((p) => p.photos.every((ph) => ph.chemin === null)), "aucun chemin avant envoi");
});

test("photos ↔ murs : chaque photo du tableau désigne le côté de même longueur", () => {
  for (const p of R.pieces) {
    const lecture = pdfs.find((x) => x.nom === p.pdf.nom).lecture;
    const L = longueursCotes(p.polygone).map((l) => l * 1000);
    for (const l of lecture.murs.filter((m) => m.photo != null)) {
      const ph = p.photos.find((x) => x.num === l.photo);
      assert.ok(ph.mur != null, `${p.nom} photo ${l.photo} sans mur`);
      proche(L[ph.mur], l.longueur_mm, 5, `${p.nom} photo ${l.photo}`);
    }
  }
  // Chambre : photo 3 → mur de 3,375 m ; photo 8 → mur de 3,455 m.
  const ch = piece("Chambre"), Lc = longueursCotes(ch.polygone);
  proche(Lc[ch.photos.find((x) => x.num === 3).mur], 3.375, 0.005, "Chambre photo 3");
  proche(Lc[ch.photos.find((x) => x.num === 8).mur], 3.455, 0.005, "Chambre photo 8");
  // Photos absentes du tableau : rattachées à la pièce, sans mur.
  assert.equal(ch.photos.find((x) => x.num === 2).mur, null);
});

test("photos ↔ murs : pièce symétrique départagée par l'ordre d'iMapper, sinon aucun mur", () => {
  const sde = piece("Salle d'eau");
  const lecture = pdfs.find((x) => x.nom === sde.pdf.nom).lecture;
  assert.equal(rattacherPhotosMurs(sde.polygone, lecture.murs).mode, "convention");
  // Une suite qui ne correspond à aucun tour de la pièce : aucun mur inventé.
  const faux = lecture.murs.map((m) => ({ ...m, longueur_mm: m.longueur_mm + 40 }));
  const r = rattacherPhotosMurs(sde.polygone, faux);
  assert.ok(Object.values(r.parPhoto).every((k) => k === null), JSON.stringify(r));
  const ch = piece("Chambre");
  const lc = pdfs.find((x) => x.nom === ch.pdf.nom).lecture;
  assert.equal(rattacherPhotosMurs(ch.polygone, lc.murs).mode, "unique");
});

test("pièces, murs et points bruts se superposent (même repère, Y inversé partout)", () => {
  // Chaque sommet de pièce touche un mur (face intérieure des murs).
  for (const p of R.pieces) for (const q of p.polygone) {
    const d = Math.min(...R.murs.map((m) => distancePointPolygone(q, m.polygone)));
    assert.ok(d < 0.02, `${p.nom} : sommet à ${d.toFixed(3)} m du mur le plus proche`);
  }
  // Les points d'un scan tombent dans le logement (pièces + épaisseur des murs) ;
  // une partie passe par les fenêtres (vitres) : 7 % au salon.
  for (const [scan, pts] of Object.entries(R.points)) {
    const proches = pts.filter((q) => R.pieces.some((p) => distancePointPolygone(q, p.polygone) < 0.35)).length;
    assert.ok(proches / pts.length > 0.9, `scan ${scan} : ${proches}/${pts.length} points dans le logement`);
  }
  // Y inversé : la cuisine (au nord dans le DXF) passe au-dessus du salon à l'écran.
  const cy = (n) => { const e = emprisesReleve({ pieces: [piece(n)] }); return (e.minY + e.maxY) / 2; };
  assert.ok(cy("Cuisine") < cy("Chambre"), "Y non inversé");
});

test("un DXF sans pièces (plan automatique non lancé) est refusé proprement", () => {
  const sans = dxfTexte.replaceAll("A-AREA-ONE-POLYLINE", "A-AREA-AUTRE");
  assert.deepEqual(releveDepuisDXF(sans), { ok: false, erreur: MSG_DXF_SANS_PIECES });
  assert.equal(MSG_DXF_SANS_PIECES, "Lancez le plan automatique sur iMapper avant d'exporter.");
  assert.equal(releveDepuisDXF("").ok, false);
});

test("noms tronqués : table de traduction, inconnu laissé tel quel", () => {
  assert.deepEqual(traduireNomPiece("Chamb"), { nom: "Chambre", type: "chambre", connu: true });
  assert.deepEqual(traduireNomPiece("Entre"), { nom: "Entrée", type: "entree", connu: true });
  assert.deepEqual(traduireNomPiece("Grenx"), { nom: "Grenx", type: "autre", connu: false });
});

// ── Métrés ─────────────────────────────────────────────────────────────────
test("plinthes et murs nets NON calculés tant que les ouvertures ne sont pas relevées", () => {
  const R0 = { ...R, ouvertures: null };
  const m = calculerMetres(R0);
  assert.equal(m.ouverturesConnues, false);
  for (const l of m.pieces) {
    assert.equal(l.plinthes, null);
    assert.equal(l.murs_nets, null);
    assert.equal(l.raison, "ouvertures_non_relevees");
    assert.equal(l.approx.murs_bruts, true, "HSP par défaut → ≈");
  }
  assert.equal(m.total.plinthes, null);
  assert.equal(texteMetre(null, false, "ouvertures_non_relevees"), "en attente des ouvertures");
  proche(m.total.sol, 56.72, 0.01, "total sol");
  proche(m.total.perimetre, 72.42, 0.01, "total périmètre");
  proche(m.total.murs_bruts, 181.04, 0.02, "total murs bruts");
  assert.equal(texteMetre(m.total.murs_bruts, true), "≈ 181,04");
  const pav = pointsAValider(R0).map((x) => x.code);
  assert.ok(pav.includes("hsp_defaut") && pav.includes("scan_isole") && pav.includes("ouvertures_non_relevees"));
});

test("métrés avec les ouvertures du prototype = tableau de la spécification à 0,05 près", () => {
  const id = (n) => piece(n).id;
  const o = (code, type, largeur, noms, statut = "detecte") => ({
    id: code, code, type, t0: 0, t1: largeur, piece: id(noms[0]), pieces_liees: noms.map(id), statut,
  });
  const avecOuv = { ...R, ouvertures: [
    o("P1", "porte", 0.75, ["Chambre", "Salon"]), o("P2", "porte", 0.60, ["Chambre", "Buanderie"]),
    o("P3", "porte", 0.80, ["Cuisine", "Buanderie"]), o("P4", "porte", 0.70, ["Cuisine", "Salle d'eau"]),
    o("P5", "porte", 0.80, ["Cuisine", "Entrée"]), o("P6", "porte", 0.60, ["Entrée"], "a_verifier"),
    o("P7", "porte", 0.60, ["Buanderie", "Salon"], "a_verifier"), o("B1", "baie", 1.30, ["Salon", "Entrée"]),
    o("PL", "placard", 0.60, ["Entrée"]), o("F1", "fenetre", 1.25, ["Chambre"]),
    o("F2", "fenetre", 0.73, ["Cuisine"]), o("F3", "fenetre", 1.45, ["Salon"]),
    o("F4", "fenetre", 1.85, ["Salon"], "a_verifier"),
  ] };
  const attendu = {
    "Entrée": [4.05, 8.23, 5.53, 20.58, 14.86], Salon: [23.50, 19.87, 17.22, 49.68, 39.29],
    Chambre: [11.70, 13.77, 12.42, 34.43, 29.87], Buanderie: [6.39, 11.36, 9.36, 28.41, 24.33],
    Cuisine: [7.80, 11.82, 9.52, 29.56, 23.81], "Salle d'eau": [3.28, 7.35, 6.65, 18.38, 16.95],
  };
  const m = calculerMetres(avecOuv);
  for (const [nom, v] of Object.entries(attendu)) {
    const l = m.pieces.find((x) => x.nom === nom);
    ["sol", "perimetre", "plinthes", "murs_bruts", "murs_nets"].forEach((k, i) => proche(l[k], v[i], 0.05, `${nom} ${k}`));
  }
  [[m.total.sol, 56.72], [m.total.perimetre, 72.42], [m.total.plinthes, 60.72], [m.total.murs_bruts, 181.04], [m.total.murs_nets, 149.10]]
    .forEach(([a, b]) => proche(a, b, 0.05, "total"));
  assert.equal(m.pieces.find((x) => x.nom === "Salon").approx.plinthes, true, "P7 à vérifier → ≈");
  assert.equal(m.pieces.find((x) => x.nom === "Chambre").approx.plinthes, false);
  // Décisions encore ouvertes : chaque option change bien le résultat.
  const sansAV = calculerMetres(avecOuv, { deduireAVerifier: false });
  proche(sansAV.pieces.find((x) => x.nom === "Salon").plinthes, 17.22 + 0.60, 0.05, "sans les « à vérifier »");
  const avecPL = calculerMetres(avecOuv, { deduirePlacards: true });
  proche(avecPL.pieces.find((x) => x.nom === "Entrée").plinthes, 5.53 - 0.60, 0.05, "placard déduit");
  // Une ouverture masquée (faux positif) n'est pas déduite.
  const masque = { ...avecOuv, ouvertures: avecOuv.ouvertures.map((x) => (x.code === "F4" ? { ...x, masque: true } : x)) };
  proche(calculerMetres(masque).pieces.find((x) => x.nom === "Salon").murs_nets, 39.29 + 1.85 * 1.45, 0.05, "F4 masquée");
  // Hauteur saisie : la HSP mesurée enlève le « ≈ » des murs bruts.
  const mesure = { ...R, pieces: R.pieces.map((p) => ({ ...p, hsp: 3.1, hsp_statut: "mesuree" })) };
  const mm = calculerMetres(mesure).pieces.find((x) => x.nom === "Chambre");
  proche(mm.murs_bruts, 13.774 * 3.1, 0.01, "HSP mesurée");
  assert.equal(mm.approx.murs_bruts, false);
});

// ── Rendu ──────────────────────────────────────────────────────────────────
const mesurerApprox = (txt, fs) => String(txt).length * fs * 0.58;
const croise = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const chevauchements = (et) => {
  let n = 0;
  for (let i = 0; i < et.length; i++) for (let j = i + 1; j < et.length; j++) if (croise(et[i].boite, et[j].boite)) n++;
  return n;
};

function ctxEnregistreur() {
  const ops = [];
  const etat = { fillStyle: "", strokeStyle: "", font: "", textAlign: "", lineWidth: 1 };
  const ctx = new Proxy(etat, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "ops") return ops;
      // Largeur de texte approchée (Node n'a pas de moteur de polices).
      if (k === "measureText") return (txt) => ({ width: mesurerApprox(txt, parseFloat(/(\d+(\.\d+)?)px/.exec(t.font)?.[1] || 10)) });
      return (...a) => ops.push([k, a, t.fillStyle, t.font]);
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx, ops };
}

test("rendu : sols puis murs, cotes en cm à l'intérieur, nom + surface", () => {
  const { ctx, ops } = ctxEnregistreur();
  dessinerReleve(ctx, { ...R, ouvertures: null }, (x, y) => [x * 100, y * 100]);
  const fills = ops.filter((o) => o[0] === "fill");
  assert.equal(fills.length, 6 + 37, "6 sols + 37 murs");
  assert.ok(fills.slice(0, 6).every((f) => f[2] !== "#3a4250") && fills.slice(6).every((f) => f[2] === "#3a4250"));
  const textes = ops.filter((o) => o[0] === "fillText").map((o) => o[1][0]);
  assert.ok(textes.includes("Chambre") && textes.includes("11,70 m²"));
  const nbCotes = R.pieces.reduce((t, p) => t + cotesInterieures(p).length, 0);
  assert.ok(textes.includes("346") && textes.includes("345"), "cotes de la chambre en cm");
  assert.equal(textes.filter((t) => / m²$/.test(t)).length, 6, "une surface par pièce");
  const cotesDessinees = textes.filter((t) => /^\d+$/.test(t)).length;
  assert.ok(cotesDessinees > nbCotes * 0.8 && cotesDessinees <= nbCotes, `${cotesDessinees}/${nbCotes} cotes dessinées`);
  assert.ok(!ops.some((o) => o[0] === "fillRect"), "points bruts masqués par défaut");
  const { ctx: c2, ops: o2 } = ctxEnregistreur();
  dessinerReleve(c2, R, (x, y) => [x * 100, y * 100], { points: true });
  assert.equal(o2.filter((o) => o[0] === "fillRect").length, Object.values(R.points).reduce((t, l) => t + l.length, 0));
  // Côté court (< 0,30 m) : pas de cote.
  assert.ok(cotesInterieures(piece("Buanderie")).every((c) => c.longueur >= 0.3));
  assert.ok(!cotesInterieures(piece("Chambre")).some((c) => c.texte === "5"));
});

test("étiquettes : dans la pièce, au point le plus éloigné des murs, jamais l'une sur l'autre", () => {
  for (const ech of [100, 40, 21]) {
    const et = miseEnPageEtiquettes(R.pieces, (x, y) => [x * ech, y * ech], mesurerApprox);
    assert.equal(chevauchements(et), 0, `${ech} px/m`);
    if (ech >= 40) assert.ok(et.every((e) => e.tient), `${ech} px/m : toutes les étiquettes tiennent dans leur pièce`);
  }
  // Vue éloignée : une étiquette qui déborde reçoit un fond clair (sinon,
  // texte foncé sur mur anthracite = invisible) ; celles qui tiennent, non.
  const et21 = miseEnPageEtiquettes(R.pieces, (x, y) => [x * 21, y * 21], mesurerApprox);
  const debordent = et21.filter((e) => !e.tient).length;
  assert.ok(debordent > 0, "le cas existe sur la référence à 21 px/m");
  const { ctx, ops } = ctxEnregistreur();
  dessinerReleve(ctx, R, (x, y) => [x * 21, y * 21]);
  assert.equal(ops.filter((o) => o[0] === "fill" && o[2] === "rgba(255,255,255,0.92)").length, debordent);
  // L'ancre est dans la pièce, loin des murs.
  for (const p of R.pieces) assert.ok(pointDansPoly(ancrePiece(p), p.polygone), p.nom);
  // Pièce en L : l'ancre est au cœur de la pièce, pas sur son centre de gravité.
  const L = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]];
  const { point, rayon } = poleInaccessibilite(L);
  assert.ok(pointDansPoly(point, L) && rayon > 0.45, JSON.stringify({ point, rayon }));
});

// ── Lot 2 : ouvertures ─────────────────────────────────────────────────────
// Tableau d'acceptation de la spécification, colonne « après géométrie seule »,
// à ± 10 cm sur la largeur. Écart assumé : la porte palière (P6) et le placard
// (PL), pris pour des fenêtres, sortent « à vérifier » et non « détectés » —
// aucune vitre n'est vue derrière (règle ajoutée après le cas Montillers).
const OUV_ATTENDUES = [
  { code: "P1", type: "porte", cm: 75, entre: ["Chambre", "Salon"], statut: "detecte" },
  { code: "P2", type: "porte", cm: 60, entre: ["Chambre", "Buanderie"], statut: "a_verifier" },
  { code: "P3", type: "porte", cm: 80, entre: ["Cuisine", "Buanderie"], statut: "a_verifier" },
  { code: "P4", type: "porte", cm: 70, entre: ["Cuisine", "Salle d'eau"], statut: "detecte" },
  { code: "P5", type: "porte", cm: 80, entre: ["Cuisine", "Entrée"], statut: "a_verifier" },
  { code: "P6", type: "fenetre", cm: 60, entre: ["Entrée"], statut: "a_verifier" },
  { code: "PL", type: "fenetre", cm: 60, entre: ["Entrée"], statut: "a_verifier" },
  { code: "P7", type: "porte", cm: 60, entre: ["Buanderie", "Salon"], statut: "a_verifier" },
  { code: "B1", type: "porte", cm: 130, entre: ["Salon", "Entrée"], statut: "detecte" },
  { code: "F1", type: "fenetre", cm: 125, entre: ["Chambre"], statut: "detecte" },
  { code: "F3", type: "fenetre", cm: 145, entre: ["Salon"], statut: "detecte" },
  { code: "F4", type: "fenetre", cm: 185, entre: ["Salon"], statut: "detecte" },
];
const nomsDe = (o) => (o.pieces_liees || [o.piece]).map((id) => R.pieces.find((p) => p.id === id).nom).sort().join("/");

test("ouvertures (géométrie seule) : 11 des 12 réelles retrouvées, F2 absente, statuts du tableau", () => {
  const restants = [...R.ouvertures];
  for (const a of OUV_ATTENDUES) {
    const i = restants.findIndex((o) => o.type === a.type && nomsDe(o) === [...a.entre].sort().join("/")
      && Math.abs((o.t1 - o.t0) * 100 - a.cm) <= 10);
    assert.ok(i >= 0, `${a.code} (${a.cm} cm, ${a.entre.join(" / ")}) non retrouvée`);
    assert.equal(restants[i].statut, a.statut, `${a.code} : statut`);
    restants.splice(i, 1);
  }
  // F2 (cuisine, 73 cm) : sa vitre a renvoyé des points, pas de fenêtre « détectée ».
  assert.ok(!R.ouvertures.some((o) => nomsDe(o) === "Cuisine" && o.statut === "detecte"));
  // Les faux candidats (mobilier, miroir, panneau de douche…) : tous « à vérifier ».
  assert.ok(restants.length >= 5 && restants.length <= 10, `${restants.length} faux candidats`);
  assert.ok(restants.every((o) => o.statut === "a_verifier"), JSON.stringify(restants.map((o) => [o.code, o.statut])));
  // Chaque ouverture : un code unique, une épaisseur de mur ≥ 8 cm, charnière par défaut.
  assert.equal(new Set(R.ouvertures.map((o) => o.code)).size, R.ouvertures.length);
  assert.ok(R.ouvertures.every((o) => o.epaisseur >= 0.08 && o.sens.charniere === "t0"));
});

test("ouvertures : glisser, élargir, poser à la main ; les métrés suivent", () => {
  const p1 = R.ouvertures.find((o) => nomsDe(o) === "Chambre/Salon" && o.statut === "detecte");
  const g = geometrieOuverture(R, p1);
  const w = p1.t1 - p1.t0;
  // Glisser : même largeur, bornée au mur.
  const d = glisserOuverture(R, p1, p1.t0 - 0.5);
  proche(d.t1 - d.t0, w, 1e-6, "largeur conservée");
  proche(glisserOuverture(R, p1, 99).t1, g.L, 1e-3, "bornée en fin de mur");
  assert.equal(glisserOuverture(R, p1, -5).t0, 0);
  // Élargir de 20 cm : plinthes −20 cm dans les deux pièces, murs nets −0,20 × 2,04.
  const m0 = calculerMetres(R);
  const R2 = { ...R, ouvertures: R.ouvertures.map((o) => (o.id === p1.id ? largeurOuverture(R, o, w + 0.2) : o)) };
  const m1 = calculerMetres(R2);
  for (const nom of ["Chambre", "Salon"]) {
    const a = m0.pieces.find((l) => l.nom === nom), b = m1.pieces.find((l) => l.nom === nom);
    proche(a.plinthes - b.plinthes, 0.2, 1e-3, `${nom} plinthes`);
    proche(a.murs_nets - b.murs_nets, 0.2 * 2.04, 1e-3, `${nom} murs nets`);
  }
  // Poser à la main sur le mur Chambre/Salon : 83 cm, les deux pièces liées, « à vérifier ».
  const ch = piece("Chambre");
  const n = nouvelleOuverture(R, ch.id, p1.mur, 1.0, { id: "x1" });
  proche(n.t1 - n.t0, 0.83, 1e-6, "largeur par défaut");
  assert.deepEqual(n.pieces_liees.map((id) => R.pieces.find((p) => p.id === id).nom).sort(), ["Chambre", "Salon"]);
  assert.equal(n.statut, "a_verifier");
  // Sur un mur extérieur : seule la pièce.
  const f = R.ouvertures.find((o) => o.type === "fenetre" && o.statut === "detecte" && nomsDe(o) === "Chambre");
  assert.equal(nouvelleOuverture(R, ch.id, f.mur, 1.0).pieces_liees.length, 1);
  // Clic sur une ouverture : elle ; à 1 m dans la pièce : aucune.
  const milieu = [(g.p0[0] + g.p1[0]) / 2, (g.p0[1] + g.p1[1]) / 2];
  assert.equal(ouvertureSousPoint(R, milieu, 0.05).id, p1.id);
  assert.equal(ouvertureSousPoint(R, [milieu[0] + g.n[0], milieu[1] + g.n[1]], 0.05), null);
  // Clic à 5 cm du mur dans la chambre : c'est ce côté de la chambre.
  const cp = coteLePlusProche(R, [milieu[0] + g.n[0] * 0.05, milieu[1] + g.n[1] * 0.05]);
  assert.ok(cp.piece === p1.piece && cp.k === p1.mur, JSON.stringify(cp));
});

test("ouverture ajoutée ou requalifiée : prochain code libre, les autres ne bougent pas", () => {
  const nbP = R.ouvertures.filter((o) => /^P\d+$/.test(o.code)).length;
  assert.equal(prochainCode(R.ouvertures, "porte"), `P${nbP}`.replace(/\d+$/, (d) => String(Math.max(...R.ouvertures.map((o) => Number(/^P(\d+)$/.exec(o.code)?.[1] || 0))) + 1)));
  assert.equal(prochainCode(R.ouvertures, "baie"), "B1");
  assert.equal(prochainCode([], "placard"), "PL1");
});

test("points à valider : ouvertures douteuses, hauteur, alertes ; confirmer et supprimer", () => {
  const pav = pointsAValider(R);
  const nbDouteuses = R.ouvertures.filter((o) => o.statut === "a_verifier").length;
  assert.equal(pav.filter((x) => x.code === "ouverture_a_verifier").length, nbDouteuses);
  assert.ok(pav.some((x) => x.code === "hsp_defaut") && pav.some((x) => x.code === "scan_isole"));
  const o = pav.find((x) => x.code === "ouverture_a_verifier");
  // Confirmer → validée, sort de la liste ; supprimer → retirée du relevé.
  const Rc = traiterPointAValider(R, o, "confirmer");
  assert.equal(Rc.ouvertures.find((x) => x.id === o.cible.id).statut, "valide");
  assert.equal(pointsAValider(Rc).length, pav.length - 1);
  const Rs = traiterPointAValider(R, o, "supprimer");
  assert.ok(!Rs.ouvertures.some((x) => x.id === o.cible.id));
  // Hauteur : confirmer → toutes mesurées, plus de « ≈ » sur les murs bruts.
  const Rh = traiterPointAValider(R, pav.find((x) => x.code === "hsp_defaut"), "confirmer");
  assert.ok(!pointsAValider(Rh).some((x) => x.code === "hsp_defaut"));
  assert.ok(calculerMetres(Rh).pieces.every((l) => !l.approx.murs_bruts));
  // Alerte : confirmer = vue (gardée), supprimer = retirée.
  const al = pav.find((x) => x.code === "scan_isole");
  assert.ok(traiterPointAValider(R, al, "confirmer").alertes.find((a) => a.code === "scan_isole").vue);
  assert.ok(!traiterPointAValider(R, al, "supprimer").alertes.some((a) => a.code === "scan_isole"));
  // Le relevé d'origine n'est jamais modifié (fonctions pures).
  assert.equal(pointsAValider(R).length, pav.length);
});

test("rendu des ouvertures : mur effacé, symbole, code en pastille, masquées absentes", () => {
  const { ctx, ops } = ctxEnregistreur();
  dessinerReleve(ctx, R, (x, y) => [x * 100, y * 100]);
  const textes = ops.filter((o) => o[0] === "fillText").map((o) => o[1][0]);
  for (const o of R.ouvertures) assert.ok(textes.includes(o.code), `pastille ${o.code}`);
  assert.equal(ops.filter((o) => o[0] === "fill" && o[2] === "#ffffff").length, R.ouvertures.length * 2, "trou + pastille par ouverture");
  assert.ok(ops.filter((o) => o[0] === "arc").length >= R.ouvertures.filter((o) => o.type === "porte").length);
  // Une ouverture masquée (faux positif) n'est pas dessinée.
  const { ctx: c2, ops: o2 } = ctxEnregistreur();
  dessinerReleve(c2, { ...R, ouvertures: R.ouvertures.map((o, i) => (i === 0 ? { ...o, masque: true } : o)) }, (x, y) => [x * 100, y * 100]);
  assert.ok(!o2.filter((o) => o[0] === "fillText").map((o) => o[1][0]).includes(R.ouvertures[0].code));
});

// ── DXF à plusieurs versions du plan (plan automatique lancé plusieurs fois) ─
// Cas réel rencontré le 15/10/2026 : 17 pièces + 12 pièces superposées dans le
// même DXF. Reproduit ici sur le relevé de référence : on ajoute à la fin des
// entités une 2ᵉ série de pièces (données fictives dérivées de la référence).
function dxfAvecSecondeVersion(polys) {
  const lignes = dxfTexte.split(/\r?\n/);
  const iEnt = lignes.findIndex((l, i) => l.trim() === "ENTITIES" && lignes[i - 1].trim() === "2");
  const iFin = lignes.findIndex((l, i) => i > iEnt && l.trim() === "ENDSEC");
  const ajout = polys.flatMap((P) => [
    "0", "POLYLINE", "8", "A-AREA-ONE-POLYLINE", "66", "1", "70", "1",
    ...P.flatMap((q) => ["0", "VERTEX", "8", "A-AREA-ONE-POLYLINE", "10", q[0].toFixed(6), "20", q[1].toFixed(6)]),
    "0", "SEQEND",
  ]);
  return [...lignes.slice(0, iFin - 1), ...ajout, ...lignes.slice(iFin - 1)].join("\n");
}
const piecesBrutes = lireDXF(dxfTexte).polylignes.filter((p) => p.calque === "A-AREA-ONE-POLYLINE").map((p) => p.sommets);
const agrandir = (P, k) => {
  const cx = P.reduce((t, q) => t + q[0], 0) / P.length, cy = P.reduce((t, q) => t + q[1], 0) / P.length;
  return P.map((q) => [cx + (q[0] - cx) * k, cy + (q[1] - cy) * k]);
};

test("noms tronqués à 6 lettres (autre projet iMapper) : reconnus par le début du mot", () => {
  assert.equal(traduireNomPiece("chambr").nom, "Chambre");
  assert.equal(traduireNomPiece("Couloi").nom, "Couloir");
  assert.equal(traduireNomPiece("SdB_t3").nom, "Salle de bain");
  assert.equal(traduireNomPiece("Studio").type, "sejour");
  assert.equal(traduireNomPiece("Bureau").nom, "Bureau");
  assert.deepEqual(traduireNomPiece("Pente_"), { nom: "Pente", type: "autre", connu: false });
  assert.equal(traduireNomPiece("Salle").nom, "Salle d'eau");
});

test("DXF à 2 versions : aucun choix silencieux, les versions sont décrites", () => {
  const dxf2 = dxfAvecSecondeVersion(piecesBrutes.slice(0, 5).map((P) => agrandir(P, 1.03)));
  assert.equal(versionsDuPlan(lireDXF(dxf2).polylignes.filter((p) => p.calque === "A-AREA-ONE-POLYLINE").map((p) => p.sommets)).length, 2);
  const r = assemblerReleve({ dxfTexte: dxf2, pdfs, maintenant: "x" });
  assert.equal(r.ok, false);
  assert.equal(r.choix, "version");
  assert.deepEqual(r.versions.map((v) => v.nb), [6, 5]);
  assert.equal(r.versions[0].part_murs, 1, "la version d'origine est posée sur les murs");
  assert.ok(r.versions[1].part_murs < 0.5, "la copie agrandie ne l'est pas");
  // Version 1 choisie : le relevé de référence, intact, avec ses 60 photos.
  const v1 = assemblerReleve({ dxfTexte: dxf2, pdfs, maintenant: "x", version: 1 });
  assert.ok(v1.ok);
  assert.deepEqual(v1.releve.pieces.map((p) => p.nom), R.pieces.map((p) => p.nom));
  assert.equal(v1.releve.pieces.reduce((t, p) => t + p.photos.length, 0), 60);
  assert.ok(v1.releve.alertes.some((a) => a.code === "plusieurs_versions"));
  // Version 2 : 5 pièces, aucune page PDF ne leur correspond → une seule ligne.
  const v2 = assemblerReleve({ dxfTexte: dxf2, pdfs, maintenant: "x", version: 2 });
  assert.equal(v2.releve.pieces.length, 5);
  assert.equal(v2.releve.alertes.filter((a) => a.code === "piece_sans_pdf").length, 1);
  assert.equal(assemblerReleve({ dxfTexte: dxf2, pdfs, version: 3 }).ok, false);
});

test("même pièce à l'identique dans deux versions : la page PDF n'est pas attribuée au hasard", () => {
  const ch = piecesBrutes[0];
  const dxf2 = dxfAvecSecondeVersion([ch]);
  const v1 = assemblerReleve({ dxfTexte: dxf2, pdfs, maintenant: "x", version: 1 }).releve;
  const chambre = v1.pieces.find((p) => p.nom === "Chambre");
  assert.equal(chambre.photos.length, 0, "égalité parfaite : pas de photos attribuées en silence");
  assert.ok(v1.alertes.some((a) => a.code === "pdf_ambigu"));
  // Les 5 autres pièces gardent leurs photos.
  assert.equal(v1.pieces.filter((p) => p.photos.length === 10).length, 5);
});

test("PDF groupé (toutes les pièces dans un fichier) : découpé en une entrée par pièce", () => {
  const plan = [{ str: "Projet — Plan #12", x: 10, y: 800 }, { str: "1:250 A4", x: 400, y: 30 }];
  const pages = [plan, ...pdfJson.pdfs.flatMap((p) => [p.page1, p.page2])];
  const pieces = decouperPdfImapper(pages);
  assert.equal(pieces.length, 6);
  assert.deepEqual(pieces.map((p) => p.page), [1, 3, 5, 7, 9, 11]);
  assert.deepEqual(pieces.map((p) => p.lecture), pdfs.map((p) => p.lecture));
  // PDF d'une seule pièce : même lecture qu'avant.
  assert.equal(decouperPdfImapper([pdfJson.pdfs[0].page1, pdfJson.pdfs[0].page2]).length, 1);
});

// ── Fichiers d'origine (local uniquement, jamais sur GitHub) ───────────────
const dossierPrive = path.join(ici, "fixtures-privees/releve-reference");
if (fs.existsSync(dossierPrive)) {
  test("[privé] vrais PDF : 10 photos JPEG 1200×1600 chacun, logo écarté", () => {
    for (let n = 1; n <= 6; n++) {
      const octets = new Uint8Array(fs.readFileSync(path.join(dossierPrive, `piece_${n}.pdf`)));
      const imgs = extraireJpegsPdf(octets);
      assert.equal(imgs.length, 10, `piece_${n}.pdf`);
      for (const im of imgs) {
        assert.equal(im.largeur, 1200); assert.equal(im.hauteur, 1600);
        assert.ok(im.octets[0] === 0xff && im.octets[1] === 0xd8, "début JPEG");
        const f = im.octets.length;
        assert.ok(im.octets[f - 2] === 0xff && im.octets[f - 1] === 0xd9, "fin JPEG");
      }
    }
  });
  test("[privé] le DXF d'origine donne le même relevé que la version anonymisée", () => {
    const orig = fs.readFileSync(path.join(dossierPrive, "plan.dxf"), "latin1");
    const r2 = assemblerReleve({ dxfTexte: orig, pdfs, maintenant: "2026-10-15T10:00:00Z" }).releve;
    assert.equal(r2.source.projet, "13255");
    assert.deepEqual(r2.pieces, R.pieces);
  });
  test("[privé] photos page par page : 10 sur la page 1 de chaque PDF, rien en page 2", () => {
    const parPage = extraireJpegsParPage(new Uint8Array(fs.readFileSync(path.join(dossierPrive, "piece_1.pdf"))));
    assert.deepEqual(parPage.map((l) => l.length), [10, 0]);
  });
} else {
  console.log("  (jeu privé absent : extraction des photos des vrais PDF non vérifiée ici)");
}

// Relevé réel à 2 versions + PDF groupé de 64 pages (cas du 15/10/2026).
const dossierMulti = path.join(ici, "fixtures-privees/releve-montillers");
let pdfjs = null;
try { pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"); } catch { /* sans dépendances installées */ }
if (fs.existsSync(dossierMulti) && pdfjs) {
  test("[privé] DXF à 2 versions + PDF groupé : versions décrites, toutes les pièces avec leurs photos", async () => {
    const octets = new Uint8Array(fs.readFileSync(path.join(dossierMulti, "pieces.pdf")));
    const doc = await pdfjs.getDocument({ data: octets.slice(), verbosity: 0 }).promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      pages.push((await (await doc.getPage(n)).getTextContent()).items.filter((i) => i.str && i.str.trim())
        .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] })));
    }
    const parPage = extraireJpegsParPage(octets);
    const pieces = decouperPdfImapper(pages);
    assert.equal(pieces.length, 29);
    const pdfsM = pieces.map((p) => ({ nom: `#${p.lecture.piece_num}`, lecture: p.lecture, nbPhotos: parPage[p.page].length }));
    const dxfM = fs.readFileSync(path.join(dossierMulti, "plan.dxf"), "latin1");
    const choix = assemblerReleve({ dxfTexte: dxfM, pdfs: pdfsM });
    assert.equal(choix.choix, "version");
    assert.deepEqual(choix.versions.map((v) => v.nb), [17, 12]);
    assert.equal(choix.versions[1].part_murs, 1);
    for (const v of [1, 2]) {
      const R2 = assemblerReleve({ dxfTexte: dxfM, pdfs: pdfsM, version: v }).releve;
      assert.ok(R2.pieces.every((p) => p.pdf), `version ${v} : toutes les pièces ont leur page PDF`);
      assert.ok(R2.pieces.every((p) => p.photos.length === (p.scan ? 10 : 0)), `version ${v} : 10 photos par pièce scannée`);
      assert.ok(!R2.alertes.some((a) => /pdf_ambigu|pdf_sans_piece|photos_nombre/.test(a.code)), JSON.stringify(R2.alertes));
      const horsOuv = pointsAValider(R2).filter((x) => x.code !== "ouverture_a_verifier").length;
      assert.ok(horsOuv <= 10, `version ${v} : ${horsOuv} points à valider hors ouvertures`);
      for (const ech of [100, 40, 21]) {
        assert.equal(chevauchements(miseEnPageEtiquettes(R2.pieces, (x, y) => [x * ech, y * ech], mesurerApprox)), 0, `version ${v}, ${ech} px/m`);
      }
    }
  });
}

let ok = 0;
for (const [nom, fn] of cas) {
  try { await fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { console.error(`  ✗ ${nom}\n    ${e.message}`); process.exitCode = 1; }
}
console.log(`\n${ok}/${cas.length} vérifications relevé iMapper`);
