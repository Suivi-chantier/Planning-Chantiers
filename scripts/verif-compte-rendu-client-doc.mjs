#!/usr/bin/env node
// Vérifie le gabarit PDF « Compte rendu de chantier » envoyé au client
// (src/Renovation/compteRenduClientDoc.js).
// Aucun réseau, aucune base : le module est alimenté par des données fictives
// en dur et on inspecte le HTML produit.
//   node scripts/verif-compte-rendu-client-doc.mjs
import assert from "node:assert/strict";
import { chargerModuleSource } from "./_chargeur.mjs";

const { buildCompteRenduClientDocHTML, dateCompteRendu, avancementCompteRendu } =
  await chargerModuleSource("../src/Renovation/compteRenduClientDoc.js", import.meta.url);

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);
const compte = (h, s) => h.split(s).length - 1;

// ─── FIXTURES (données fictives) ─────────────────────────────────────────────
const COMPLET = {
  chantierNom: "CHANTIER TEST",
  clientNom: "M. Fictif",
  adresse: "1 rue de l'Exemple, 49000 Angers",
  dateISO: "2026-09-28",
  avancement: "45",
  resume: "Cette semaine, l'équipe a réalisé 2 tâches sur le chantier.",
  prochaineEtape: "Pose des doublages\nPuis bandes",
  remarques: "Livraison des menuiseries décalée.",
  taches: ["Démolition cloisons", "  ", "Évacuation gravats"],
  photos: ["data:image/jpeg;base64,AAAA", "", "https://exemple.test/p2.jpg"],
  logoUrl: "https://app.test/logos/profero-reno-h.png",
};
const HTML = buildCompteRenduClientDocHTML(COMPLET);

// ─── 1. ENVELOPPE COMMUNE ────────────────────────────────────────────────────
test("1. gabarit commun Profero (héros, Barlow, jaune marque, pied)", () => {
  assert.ok(HTML.includes("family=Barlow"), "police Barlow chargée");
  assert.ok(HTML.includes("linear-gradient(135deg,#161b28"), "héros sombre en dégradé");
  assert.ok(HTML.includes("#FFC200"), "jaune marque");
  assert.ok(HTML.includes("Profero — Rénovation &amp; réhabilitation"), "pied commun");
  assert.ok(HTML.includes("Document confidentiel"), "mention confidentielle");
  assert.ok(HTML.includes(`src="${COMPLET.logoUrl}"`), "logo Profero");
  assert.ok(HTML.includes("size:A4"), "A4");
  // L'ancien gabarit (Arial + bandeau noir #0a0a0a + jaune #f5c400) a disparu.
  assert.ok(!HTML.includes("#0a0a0a"), "plus de bandeau noir de l'ancien PDF");
  assert.ok(!HTML.includes("#f5c400"), "plus de l'ancien jaune");
});

// ─── 2. HÉROS ────────────────────────────────────────────────────────────────
test("2. héros : titre, adresse, date, client, pastille avancement", () => {
  assert.ok(HTML.includes("Compte rendu de chantier"), "eyebrow");
  assert.ok(HTML.includes(">CHANTIER TEST<"), "nom du chantier en titre");
  assert.ok(HTML.includes("1 rue de l'Exemple, 49000 Angers"), "adresse en sous-titre");
  assert.ok(HTML.includes("Compte rendu du lundi 28 septembre 2026"), "date lisible");
  assert.ok(HTML.includes("Client : M. Fictif"), "client en chip");
  assert.ok(HTML.includes("2 tâches réalisées"), "nombre de tâches (lignes vides ignorées)");
  assert.ok(HTML.includes("2 photos"), "nombre de photos (entrées vides ignorées)");
  assert.ok(HTML.includes(">45 %<"), "pastille avancement");
  assert.ok(HTML.includes("width:45%;"), "jauge d'avancement");
});

// ─── 3. SECTIONS ─────────────────────────────────────────────────────────────
test("3. sections dans l'ordre, textes gardés", () => {
  const ordre = ["Résumé de la semaine", "Travaux réalisés", "Prochaine étape", "Remarques", "Photos du chantier"]
    .map(t => HTML.indexOf(`>${t}<`));
  ordre.forEach((p, i) => assert.ok(p > 0, `section ${i + 1} présente`));
  assert.deepEqual([...ordre].sort((a, b) => a - b), ordre, "ordre des sections");
  assert.ok(HTML.includes("Pose des doublages<br/>Puis bandes"), "retours à la ligne gardés");
  assert.equal(compte(HTML, `<li class="step">`), 2, "une puce par tâche retenue");
  assert.equal(compte(HTML, `<div class="cr-photo">`), 2, "une vignette par photo");
});

test("3b. titre « Photos » jamais seul en bas de page", () => {
  const img = (i) => `https://exemple.test/p${i}.jpg`;
  const h = buildCompteRenduClientDocHTML({ ...COMPLET, photos: [1, 2, 3, 4, 5].map(img) });
  const tete = h.indexOf(`<div class="cr-photos-tete">`), suite = h.indexOf("cr-photos cr-photos-suite");
  assert.ok(tete > 0 && suite > tete, "bloc de tête puis suite");
  assert.ok(/\.cr-photos-tete\{[^}]*page-break-inside:avoid/.test(h), "tête insécable");
  const dansTete = h.slice(tete, suite);
  assert.ok(dansTete.includes(">Photos du chantier<"), "le titre est dans la tête");
  assert.equal(compte(dansTete, `<div class="cr-photo">`), 3, "une rangée complète avec le titre");
  assert.equal(compte(h, `<div class="cr-photo">`), 5, "aucune photo perdue");
  assert.ok(h.indexOf(img(3)) < h.indexOf(img(4)), "ordre des photos conservé");
  const trois = buildCompteRenduClientDocHTML({ ...COMPLET, photos: [1, 2, 3].map(img) });
  assert.ok(!trois.includes("cr-photos-suite\""), "pas de suite vide pour 3 photos");
});

// ─── 4. AVANCEMENT INCONNU ≠ 0 % ─────────────────────────────────────────────
test("4. un avancement non renseigné ne s'imprime jamais « 0 % »", () => {
  for (const v of ["", "  ", null, undefined, "abc"]) {
    assert.equal(avancementCompteRendu(v), null, `valeur ${JSON.stringify(v)}`);
    const h = buildCompteRenduClientDocHTML({ ...COMPLET, avancement: v });
    assert.ok(!h.includes(">Avancement<"), `pas de pastille pour ${JSON.stringify(v)}`);
  }
  assert.equal(avancementCompteRendu("0"), 0, "0 saisi reste 0");
  assert.ok(buildCompteRenduClientDocHTML({ ...COMPLET, avancement: "0" }).includes(">0 %<"), "0 % saisi affiché");
  assert.equal(avancementCompteRendu("150"), 100, "borné à 100");
  assert.equal(avancementCompteRendu("-5"), 0, "borné à 0");
  assert.equal(avancementCompteRendu("42,6"), 43, "virgule décimale");
});

// ─── 5. SECTIONS VIDES ───────────────────────────────────────────────────────
test("5. section vide = section absente ; document vide annoncé", () => {
  const h = buildCompteRenduClientDocHTML({ chantierNom: "CHANTIER TEST", dateISO: "2026-09-28" });
  for (const t of ["Résumé de la semaine", "Travaux réalisés", "Prochaine étape", "Remarques", "Photos du chantier"]) {
    assert.ok(!h.includes(`>${t}<`), `pas de section « ${t} »`);
  }
  assert.ok(h.includes("Aucun contenu renseigné pour ce compte rendu."), "document vide annoncé");
  assert.ok(!h.includes("Client :"), "pas de chip client vide");
});

// ─── 6. DATES ────────────────────────────────────────────────────────────────
test("6. date lue en heure locale, valeur illisible rendue telle quelle", () => {
  assert.equal(dateCompteRendu("2026-01-01"), "jeudi 1 janvier 2026", "pas de décalage UTC");
  assert.equal(dateCompteRendu(""), "", "vide reste vide (jamais « aujourd'hui »)");
  assert.equal(dateCompteRendu("n'importe"), "n'importe", "illisible rendu tel quel");
});

// ─── 7. ÉCHAPPEMENT ──────────────────────────────────────────────────────────
test("7. texte saisi échappé partout", () => {
  const piege = `<script>alert(1)</script>"`;
  const h = buildCompteRenduClientDocHTML({
    ...COMPLET, chantierNom: piege, clientNom: piege, adresse: piege,
    resume: piege, prochaineEtape: piege, remarques: piege, taches: [piege],
    photos: [`x" onerror="alert(1)`],
  });
  assert.ok(!h.includes("<script>alert"), "aucune balise injectée");
  assert.ok(!h.includes(`onerror="alert`), "aucun attribut injecté");
  assert.ok(h.includes("&lt;script&gt;"), "texte conservé, échappé");
});

let echecs = 0;
for (const [nom, fn] of cas) {
  try {
    await fn();
    console.log(`  ok   ${nom}`);
  } catch (e) {
    echecs++;
    console.error(`  ÉCHEC ${nom}\n        ${String(e?.message || e).split("\n").join("\n        ")}`);
  }
}
console.log(`\nverif-compte-rendu-client-doc : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
