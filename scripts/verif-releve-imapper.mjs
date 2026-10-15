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
  decouperPdfImapper, extraireJpegsParPage, versionsDuPlan,
} from "../src/Renovation/releveImapper.mjs";
import { dessinerReleve } from "../src/Renovation/releveRendu.mjs";

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
  assert.equal(R.ouvertures, null, "lot 1 : ouvertures pas encore relevées (null, pas [])");
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
test("lot 1 : plinthes et murs nets NON calculés tant que les ouvertures manquent", () => {
  const m = calculerMetres(R);
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
  const pav = pointsAValider(R).map((x) => x.code);
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
function ctxEnregistreur() {
  const ops = [];
  const etat = { fillStyle: "", strokeStyle: "", font: "", textAlign: "", lineWidth: 1 };
  const ctx = new Proxy(etat, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "ops") return ops;
      return (...a) => ops.push([k, a, t.fillStyle, t.font]);
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx, ops };
}

test("rendu : sols puis murs, cotes en cm à l'intérieur, nom + surface", () => {
  const { ctx, ops } = ctxEnregistreur();
  dessinerReleve(ctx, R, (x, y) => [x * 100, y * 100]);
  const fills = ops.filter((o) => o[0] === "fill");
  assert.equal(fills.length, 6 + 37, "6 sols + 37 murs");
  assert.ok(fills.slice(0, 6).every((f) => f[2] !== "#3a4250") && fills.slice(6).every((f) => f[2] === "#3a4250"));
  const textes = ops.filter((o) => o[0] === "fillText").map((o) => o[1][0]);
  assert.ok(textes.includes("Chambre") && textes.includes("11,70 m²"));
  const nbCotes = R.pieces.reduce((t, p) => t + cotesInterieures(p).length, 0);
  assert.ok(textes.includes("346") && textes.includes("345"), "cotes de la chambre en cm");
  assert.equal(textes.length, nbCotes + 12, "cotes ≥ 0,30 m + 2 étiquettes par pièce");
  assert.ok(!ops.some((o) => o[0] === "fillRect"), "points bruts masqués par défaut");
  const { ctx: c2, ops: o2 } = ctxEnregistreur();
  dessinerReleve(c2, R, (x, y) => [x * 100, y * 100], { points: true });
  assert.equal(o2.filter((o) => o[0] === "fillRect").length, Object.values(R.points).reduce((t, l) => t + l.length, 0));
  // Côté court (< 0,30 m) : pas de cote.
  assert.ok(cotesInterieures(piece("Buanderie")).every((c) => c.longueur >= 0.3));
  assert.ok(!cotesInterieures(piece("Chambre")).some((c) => c.texte === "5"));
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
      assert.ok(pointsAValider(R2).length <= 10, `version ${v} : ${pointsAValider(R2).length} points à valider`);
    }
  });
}

let ok = 0;
for (const [nom, fn] of cas) {
  try { await fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { console.error(`  ✗ ${nom}\n    ${e.message}`); process.exitCode = 1; }
}
console.log(`\n${ok}/${cas.length} vérifications relevé iMapper`);
