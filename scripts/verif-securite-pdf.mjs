#!/usr/bin/env node
// Vérifie la mise en page du PDF de la fiche de préparation sécurité (tâche 5
// du projet docs/projets/fiche-securite-chantier.md) — module pur
// src/Renovation/securitePdf.mjs :
//   - ordre des sections (identification, données de base, synthèse,
//     points 4 à 12, historique, signatures) dans le modèle et dans le HTML ;
//   - cases cochées, statuts, mesures, justificatifs avec leur date ;
//   - signatures en image, seulement celles de la version et de son empreinte ;
//     signature absente ou image illisible visibles ;
//   - pied de page de la charte, mention « BROUILLON — non validé » ;
//   - chemin de stockage versions/{fiche_id}/v{N}-….pdf ;
//   - branchement de l'écran, du rendu et de la couche données (lecture statique).
//
// Exemples issus des tests, données fictives : chantier, noms, dates et
// documents sont inventés. Aucune base, aucun réseau.
//   node scripts/verif-securite-pdf.mjs
//   node scripts/verif-securite-pdf.mjs --html sortie.html   (écrit l'exemple fictif en HTML)
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  modelePdfFiche, htmlFicheSecuritePdf, cheminPdfVersion, nomFichierPdf, dateFr, dateHeureFr, SECTIONS_PDF, MENTION_BROUILLON, echapperHtml,
} from "../src/Renovation/securitePdf.mjs";
import { FORMAT_CONTENU_VERSION } from "../src/Renovation/securiteVersion.mjs";
import { POINTS_CARTES } from "../src/Renovation/securite/points.mjs";
import { PIED_GAUCHE } from "../src/Renovation/charteDocProfero.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (f) => readFileSync(join(racine, f), "utf8");
const sansCommentaires = (src) => src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

let n = 0;
function test(nom, fn) { fn(); n++; console.log("ok -", nom); }

// ── Exemple issu des tests, données fictives ────────────────────────────────
const FICHE_ID = "0b7e2f4a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const EMP = "a".repeat(64);
const EMP_ANCIENNE = "b".repeat(64);
const SIG_SVG = (couleur) => `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="90"><path d="M10 60 C 40 10, 60 90, 90 40 S 140 20, 160 55 S 220 80, 290 30" stroke="${couleur}" stroke-width="3" fill="none"/></svg>`,
).toString("base64")}`;

const contenu = {
  format: FORMAT_CONTENU_VERSION,
  fiche_id: FICHE_ID,
  version: 2,
  motif_changement: "Nouveau sous-traitant électricité (exemple fictif)",
  chantier: { id: "ch-fictif", nom: "RÉSIDENCE DES TILLEULS APPT 3 (exemple fictif)" },
  operation: { id: "op-fictif", nom: "Tilleuls (exemple fictif)", adresse: "12 rue Imaginaire, 49000 Ville-Fictive" },
  client: "SCI Exemple (fictif)",
  batiment: {
    date_permis_construire: "1972-05-10", avant_1997: true, avant_1949: false, copropriete: true, etage: 2,
    ascenseur_utilisable: false, reperage_amiante_statut: "recu_sans_amiante", notes: "Accès par la cour (exemple fictif)",
  },
  intervenants: [
    { type: "responsable", nom: "Paul Exemple", telephone: "06 00 00 00 01" },
    { type: "entreprise", id: "e1", nom: "Profero", activite: "Entreprise générale", contact: "Paul Exemple", telephone: "06 00 00 00 01" },
    { type: "entreprise", id: "e2", nom: "Élec Fictive", activite: "Électricité", contact: "Léa Test", telephone: "06 00 00 00 02" },
  ],
  donnees_base: {
    lots: ["Démolition", "Plâtrerie", "Électricité"], date_debut: "2026-12-07", date_fin: "2027-02-12",
    date_depose_sanitaires: "2026-12-09", effectif_max: 4, site_occupe: false, acces: "Escalier B, pas d'ascenseur",
  },
  reponses: {
    p4: { statut: "concerne", cases: { reperage_consulte: true, arret_si_decouverte: true }, mesures: "Repérage reçu sans amiante ; consigne d'arrêt rappelée." },
    p5: { statut: "concerne", cases: { zones_listees: true, tremies_protegees: true }, mesures: "PIRL pour les plafonds du séjour." },
    p6: { statut: "concerne", cases: { consignation: true, habilitation_verifiee: true, reseaux_reperes: true, coffret_chantier: true }, mesures: "Consignation par l'électricien avant toute saignée." },
    p7: { statut: "concerne", cases: { aspiration_source: true, masques_ffp3: true }, mesures: "Ponceuse avec aspiration." },
    p8: { statut: "concerne", cases: { aides_manutention: true, port_a_deux: true }, mesures: "Plaques montées à deux, 2e étage sans ascenseur." },
    p9: { statut: "non_concerne" },
    p10: { statut: "concerne", cases: { chaussures: true, gants: true, lunettes: true, masque_ffp3: true }, mesures: "EPI remis le premier jour." },
    p11: { statut: "concerne", cases: { sanitaires_disponibles: true, solution_apres_depose: true }, mesures: "WC du rez-de-chaussée prêtés par la copropriété." },
    p12: { statut: "concerne", cases: { planning_partage: true, accueil_commun: true, case_retiree_test: true }, mesures: "Accueil commun le premier lundi." },
  },
  synthese_risques: ["Chute de hauteur (plafonds)", "Poussières de plâtre et silice", "Électricité : réseaux existants"],
  justificatifs: [
    { id: "j1", point: 4, type_code: "reperage_amiante", fichier_nom: "reperage.pdf", fichier_path: "x", date_document: "2026-11-02", expire_le: null, personne: null, entreprise_nom: null },
    { id: "j2", point: 6, type_code: "habilitation_electrique", fichier_nom: "habilitation-lea.pdf", fichier_path: "x", date_document: "2026-01-15", expire_le: "2029-01-15", personne: "Léa Test", entreprise_nom: "Élec Fictive" },
    { id: "j3", point: 10, type_code: "fiche_remise_epi", fichier_nom: "epi.jpg", fichier_path: "x", date_document: "2026-11-20", expire_le: null, personne: null, entreprise_nom: null },
  ],
};
const versionLigne = { id: "v2", fiche_id: FICHE_ID, version: 2, empreinte: EMP, cree_le: "2026-11-25T13:05:00Z", cree_par: "Paul Exemple", motif_changement: contenu.motif_changement, pdf_path: null };
const versions = [
  { id: "v1", version: 1, empreinte: "c".repeat(64), cree_le: "2026-11-10T08:30:00Z", cree_par: "Paul Exemple", motif_changement: null },
  versionLigne,
  { id: "v3", version: 3, empreinte: "d".repeat(64), cree_le: "2026-12-01T08:30:00Z", cree_par: "Autre", motif_changement: "postérieure" },
];
const signatures = [
  { id: "s0", fiche_id: FICHE_ID, version: 2, type: "chef_equipe", signataire_nom: "Signature périmée", empreinte_version: EMP_ANCIENNE, signe_le: "2026-11-24T09:00:00Z", image: SIG_SVG("#999") },
  { id: "s1", fiche_id: FICHE_ID, version: 2, type: "etablie_par", signataire_nom: "Paul Exemple", signataire_entreprise: "Profero", empreinte_version: EMP, signe_le: "2026-11-25T12:50:00Z", image: SIG_SVG("#1a1f2e") },
  { id: "s2", fiche_id: FICHE_ID, version: 2, type: "chef_equipe", signataire_nom: "Marc Fictif", signataire_entreprise: "Profero", empreinte_version: EMP, signe_le: "2026-11-25T12:58:00Z", image: SIG_SVG("#1a3a8a") },
  { id: "s3", fiche_id: FICHE_ID, version: 1, type: "etablie_par", signataire_nom: "Version 1", empreinte_version: "c".repeat(64), signe_le: "2026-11-10T08:00:00Z", image: SIG_SVG("#999") },
];

const r = modelePdfFiche({ contenu, version: versionLigne, versions, signatures });
assert.ok(r.ok, r.erreur);
const modele = r.modele;
const html = htmlFicheSecuritePdf(modele, { logoUrl: "/logos/profero-reno-h.png" });

const iArg = process.argv.indexOf("--html");
if (iArg > 0 && process.argv[iArg + 1]) {
  const sortie = resolve(process.argv[iArg + 1]);
  const logo = pathToFileURL(join(racine, "public/logos/profero-reno-h.png")).href;
  const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fiche sécurité — exemple issu des tests, données fictives</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&family=Barlow+Condensed:wght@700;800&display=swap" rel="stylesheet">
<style>@page { size: A4; margin: 12mm 10mm 14mm; } body { margin: 0; } .page { width: 794px; margin: 0 auto; -webkit-print-color-adjust: exact; print-color-adjust: exact; }</style></head>
<body>${htmlFicheSecuritePdf(modele, { logoUrl: logo })}</body></html>`;
  writeFileSync(sortie, page);
  console.log(`Exemple issu des tests, données fictives : ${sortie}`);
}

const posSection = (h, id) => h.indexOf(`data-section="${id}"`);
const carteDuPoint = (h, num) => {
  const debut = h.indexOf(`data-point="${num}"`);
  const fin = h.indexOf("data-point=", debut + 10);
  return h.slice(debut, fin < 0 ? h.indexOf('data-section="historique"') : fin);
};

test("1. ordre des sections : identification, données de base, synthèse, points 4 à 12, historique, signatures", () => {
  assert.deepEqual(SECTIONS_PDF, ["identification", "donnees_base", "synthese", "points", "historique", "signatures"]);
  assert.deepEqual(modele.sections.map((s) => s.id), SECTIONS_PDF);
  const positions = SECTIONS_PDF.map((id) => posSection(html, id));
  positions.forEach((p, i) => assert.ok(p > 0, `section ${SECTIONS_PDF[i]} présente`));
  for (let i = 1; i < positions.length; i++) assert.ok(positions[i] > positions[i - 1], `${SECTIONS_PDF[i]} après ${SECTIONS_PDF[i - 1]}`);
  assert.ok(html.indexOf('class="hero"') < positions[0], "héros avant les sections");
  const pts = POINTS_CARTES.map((p) => html.indexOf(`data-point="${p.numero}"`));
  assert.deepEqual(pts.map((_, i) => i), [...pts.keys()]);
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i] > pts[i - 1], "points 4 à 12 dans l'ordre");
  assert.ok(pts[0] > posSection(html, "points") && pts.at(-1) < posSection(html, "historique"));
});

test("2. charte : héros bleu nuit avec logo, accents jaunes, cartes blanches, pied de page en dernier", () => {
  assert.match(html, /<img class="logo" src="\/logos\/profero-reno-h\.png"/);
  assert.match(html, /\.fiche-secu \.hero \{[^}]*border-radius: 16px; background: linear-gradient\(135deg,#161b28/);
  assert.match(html, /#FFC200/);
  assert.match(html, /\.fiche-secu \.carte \{[^}]*background: #fff/);
  const pied = html.lastIndexOf('<div class="pied">');
  assert.ok(pied > posSection(html, "signatures"), "pied après les signatures");
  assert.ok(html.slice(pied).includes(echapperHtml(PIED_GAUCHE)), "« Profero — Rénovation & réhabilitation » au pied");
  assert.ok(!/rgba\([^)]*,\s*0\)|transparent\)/.test(html), "aucun dégradé vers le transparent");
});

test("3. identification et données de base reprises du contenu figé (bâtiment compris)", () => {
  for (const t of ["RÉSIDENCE DES TILLEULS APPT 3", "12 rue Imaginaire", "SCI Exemple (fictif)", "Paul Exemple", "06 00 00 00 01", "Élec Fictive"]) assert.ok(html.includes(t), t);
  for (const t of ["Démolition, Plâtrerie, Électricité", "07/12/2026", "12/02/2027", "09/12/2026", "Escalier B"]) assert.ok(html.includes(t), t);
  for (const t of ["10/05/1972", "Reçu — sans amiante", "2e étage"]) assert.ok(html.includes(t), t);
  const db = modele.sections[1];
  assert.equal(db.lignes.find((l) => l.libelle === "Logement occupé").valeur, "non");
  assert.equal(db.lignes.find((l) => l.libelle === "Observations").valeur, "non renseigné", "absent = non renseigné, jamais « non »");
  assert.equal(db.lignes.find((l) => l.libelle === "Effectif maximum").valeur, "4");
});

test("4. points 4 à 12 : statut, cases cochées, mesures", () => {
  const p5 = carteDuPoint(html, 5);
  assert.equal((p5.match(/class="case coche"/g) || []).length, 2, "p5 : 2 cases cochées");
  assert.equal((p5.match(/class="case non-coche"/g) || []).length, POINTS_CARTES.find((p) => p.numero === 5).cases.length - 2);
  assert.match(p5, /class="statut concerne">Concerné</);
  assert.match(p5, /PIRL pour les plafonds du séjour/);
  const p9 = carteDuPoint(html, 9);
  assert.match(p9, /class="statut non_concerne">Non concerné</);
  assert.ok(!/class="case/.test(p9), "point non concerné : pas de cases");
  const p12 = carteDuPoint(html, 12);
  assert.match(p12, /case retirée de la configuration \(case_retiree_test\)/, "case inconnue conservée visible");
  const m = modele.sections[3].cartes;
  assert.equal(m.length, 9);
  assert.deepEqual(m.find((c) => c.numero === 6).cases.filter((c) => c.cochee).map((c) => c.code), ["consignation", "habilitation_verifiee", "reseaux_reperes", "coffret_chantier"]);
  // Point sans réponse : « À compléter » visible.
  const sans = modelePdfFiche({ contenu: { ...contenu, reponses: {} }, version: versionLigne, versions, signatures });
  const h2 = htmlFicheSecuritePdf(sans.modele);
  assert.equal((h2.match(/class="statut a_completer">À compléter</g) || []).length, 9);
});

test("5. justificatifs joints listés sous leur point avec leur date", () => {
  assert.match(carteDuPoint(html, 4), /Repérage amiante avant travaux<\/b> — reperage\.pdf · du 02\/11\/2026/);
  assert.match(carteDuPoint(html, 6), /Habilitation électrique<\/b> — habilitation-lea\.pdf · du 15\/01\/2026 · expire le 15\/01\/2029 · Léa Test \(Élec Fictive\)/);
  assert.match(carteDuPoint(html, 5), /aucun justificatif joint/);
});

test("6. signatures en image : seulement celles de cette version et de son empreinte", () => {
  const sig = html.slice(posSection(html, "signatures"));
  assert.equal((sig.match(/<img class="image-signature" src="data:image\//g) || []).length, 2);
  assert.ok(sig.includes("Paul Exemple") && sig.includes("Marc Fictif"));
  assert.ok(!html.includes("Signature périmée"), "signature sur un contenu antérieur non reprise");
  assert.ok(!sig.includes("Version 1"), "signature d'une autre version non reprise");
  assert.ok(sig.indexOf('data-signature="etablie_par"') < sig.indexOf('data-signature="chef_equipe"'));
  assert.match(sig, /25\/11\/2026 à 13:50/, "heure de Paris");
  // Signature requise absente, image illisible : visibles.
  const r2 = modelePdfFiche({ contenu, version: versionLigne, versions, signatures: [{ ...signatures[1], image: null }] });
  const h2 = htmlFicheSecuritePdf(r2.modele);
  assert.match(h2, /data-signature="chef_equipe"><div class="t">Chef d'équipe<\/div><div class="etat">non signée</);
  assert.match(h2, /image de signature illisible/);
});

test("7. historique des versions : jusqu'à la version du PDF, motif et empreinte", () => {
  const h = modele.sections[4].lignes;
  assert.deepEqual(h.map((l) => l.version), [1, 2], "une version postérieure ne change pas le PDF");
  assert.equal(h[0].motif, "première version");
  assert.match(h[1].motif, /Nouveau sous-traitant/);
  assert.equal(h[1].le, "25/11/2026 à 14:05");
  assert.match(html, /Version 2 validée le 25\/11\/2026 à 14:05/);
  assert.match(html, /Empreinte aaaaaaaaaaaa…/);
});

test("8. aperçu de brouillon : « BROUILLON — non validé » en haut, dans le héros, l'historique et au pied", () => {
  assert.ok(!html.includes(MENTION_BROUILLON), "version validée : aucune mention brouillon");
  const b = modelePdfFiche({ contenu: { ...contenu, version: 3 }, versions, signatures, brouillon: true, empreinte: null, apercuLe: "2026-11-26T09:00:00Z" });
  assert.ok(b.ok, b.erreur);
  const hb = htmlFicheSecuritePdf(b.modele);
  assert.ok(hb.indexOf("brouillon-bandeau") < hb.indexOf('class="hero"'));
  assert.ok((hb.match(/BROUILLON — non validé/g) || []).length >= 4);
  assert.match(hb.slice(hb.lastIndexOf('<div class="pied">')), /BROUILLON — non validé/);
  assert.deepEqual(b.modele.sections[4].lignes.map((l) => [l.version, l.enCours]), [[1, false], [2, false], [3, true]]);
  assert.equal((hb.match(/class="etat">non signée</g) || []).length, 2, "sans empreinte : aucune signature reprise");
});

test("9. impossibilités : contenu absent, format inconnu, version différente, bâtiment jamais saisi", () => {
  assert.equal(modelePdfFiche({ contenu: null, version: versionLigne }).ok, false);
  assert.match(modelePdfFiche({ contenu: { ...contenu, format: "autre" }, version: versionLigne }).erreur, /format du contenu inconnu/);
  assert.match(modelePdfFiche({ contenu, version: { ...versionLigne, version: 1 } }).erreur, /pas de la v1/);
  assert.match(modelePdfFiche({ contenu }).erreur, /ligne de version absente/);
  const r3 = modelePdfFiche({ contenu: { ...contenu, batiment: null, client: null, intervenants: [] }, version: versionLigne });
  const h3 = htmlFicheSecuritePdf(r3.modele);
  assert.match(h3, /données du bâtiment jamais saisies sur l'opération/);
  assert.match(h3, /aucun client renseigné/);
  assert.match(h3, /aucune entreprise renseignée/);
});

test("10. texte échappé, dates, chemin de stockage et nom de fichier", () => {
  const r4 = modelePdfFiche({ contenu: { ...contenu, chantier: { id: "x", nom: "<script>alert(1)</script>" } }, version: versionLigne });
  const h4 = htmlFicheSecuritePdf(r4.modele);
  assert.ok(!h4.includes("<script>") && h4.includes("&lt;script&gt;"));
  assert.equal(dateFr("2026-11-25"), "25/11/2026");
  assert.equal(dateFr(null), "non renseigné");
  assert.equal(dateHeureFr("2026-07-01T10:00:00Z"), "01/07/2026 à 12:00", "heure d'été de Paris");
  const c = cheminPdfVersion({ ficheId: FICHE_ID, version: 2, horodatage: 1764075900000, alea: "ab12cd34" });
  assert.equal(c, `versions/${FICHE_ID}/v2-fiche-securite-1764075900000-ab12cd34.pdf`);
  assert.match(c, /^versions\/[0-9a-f-]{36}\/v\d+-.+\.pdf$/);
  assert.throws(() => cheminPdfVersion({ ficheId: "../x", version: 2, horodatage: 1, alea: "a" }));
  assert.throws(() => cheminPdfVersion({ ficheId: FICHE_ID, version: 0, horodatage: 1, alea: "a" }));
  assert.equal(nomFichierPdf({ chantierNom: "Résidence des Tilleuls / APPT 3", version: 2 }), "Fiche-securite-Residence-des-Tilleuls-APPT-3-v2.pdf");
  assert.match(nomFichierPdf({ chantierNom: "X", version: 1, brouillon: true }), /-v1-BROUILLON\.pdf$/);
});

test("11. module pur, façade, rendu, couche données et écran branchés", () => {
  const pur = sansCommentaires(lire("src/Renovation/securitePdf.mjs"));
  assert.ok(!/supabase|new Date\(\)|Date\.now|Math\.random|fetch\(|localStorage|window\.|document\.|crypto\./.test(pur), "securitePdf.mjs : module pur");
  assert.match(lire("src/Renovation/securitePdf.js"), /export \* from "\.\/securitePdf\.mjs";/);

  const rendu = sansCommentaires(lire("src/Renovation/securitePdfRendu.js"));
  assert.match(rendu, /import\("html2pdf\.js"\)/, "même technique que les autres exports (html2pdf)");
  assert.match(rendu, /modelePdfFiche\(\{ contenu: d\.version\.contenu, version: d\.version/, "PDF construit à partir du contenu figé");
  assert.match(rendu, /strict: true/, "PDF stocké : une image de signature illisible fait échouer");
  assert.match(rendu, /brouillon: true/);
  assert.ok(!/storage\.from|supabase/.test(rendu), "stockage via la couche données");

  const donnees = sansCommentaires(lire("src/Renovation/securiteDonnees.js"));
  assert.match(donnees, /deposerPreuveSecurite\(blob, chemin, "application\/pdf"\)/);
  assert.match(donnees, /cheminPdfVersion\(\{ ficheId: ligne\.fiche_id, version: ligne\.version/);
  assert.match(donnees, /\.update\(\{ pdf_path: chemin \}\)\.eq\("id", ligne\.id\)\.is\("pdf_path", null\)/, "pdf_path une seule fois");
  assert.match(donnees, /h !== v\.data\.empreinte/, "contenu contrôlé contre son empreinte");
  const stockage = sansCommentaires(lire("src/Renovation/storageChantier.js"));
  assert.match(stockage.slice(stockage.indexOf("deposerPreuveSecurite")), /upsert: false/, "jamais de remplacement");

  const ecran = sansCommentaires(lire("src/Renovation/FicheSecuriteChantier.jsx"));
  assert.match(ecran, /charger\(\);\s*await genererPdf\(numero\);/, "PDF généré juste après la validation");
  assert.match(ecran, /PDF non généré/);
  assert.match(ecran, /Générer le PDF/);
  assert.match(ecran, /Télécharger le PDF/);
  assert.match(ecran, /Aperçu PDF \(brouillon\)/);
  assert.ok(!/storage\.from/.test(ecran));
  assert.ok(!/securite/i.test(lire("src/access.js")), "aucune page « sécurité » dans access.js");
});

console.log(`\n${n} vérifications « Fiche sécurité : PDF » réussies (exemples issus des tests, données fictives).`);
