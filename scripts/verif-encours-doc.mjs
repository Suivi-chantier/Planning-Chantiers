#!/usr/bin/env node
// Vérifie le gabarit PDF « Encours fournisseurs » (src/Renovation/encoursDoc.js).
// Aucun réseau, aucune base : le module reçoit des montants déjà agrégés
// (données fictives) et on inspecte le HTML produit.
//   node scripts/verif-encours-doc.mjs
import assert from "node:assert/strict";
import { chargerModuleSource } from "./_chargeur.mjs";

const { buildEncoursDocHTML, NOTE_ENCOURS } =
  await chargerModuleSource("../src/Renovation/encoursDoc.js", import.meta.url);

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);
const pos = (h, s) => h.indexOf(s);
const nb = (n) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

// ─── FIXTURES (données fictives) ─────────────────────────────────────────────
const MOIS = [
  {
    label: "octobre 2026", nbFournisseurs: 2, aPayer: 1500, paye: 0, total: 1500,
    fournisseurs: [
      { nom: "FOURNISSEUR A", saisi: 1000, facture: 1200, paye: 0, aPayer: 1200, total: 1200 },
      { nom: "FOURNISSEUR B", saisi: 300, facture: 0, paye: 0, aPayer: 300, total: 300 },
    ],
  },
  {
    label: "septembre 2026", nbFournisseurs: 2, aPayer: 250, paye: 4000, total: 4250,
    fournisseurs: [
      { nom: 'Dupont & Fils <"test">', saisi: 250, facture: 0, paye: 1000, aPayer: 250, total: 1250 },
      { nom: "FOURNISSEUR C", saisi: 0, facture: 0, paye: 3000, aPayer: 0, total: 3000 },
    ],
  },
];
const MC = { label: "septembre 2026", aPayer: 250, paye: 4000, total: 4250 };
const base = { mois: MOIS, moisCourant: MC, logoUrl: "https://exemple.test/logo.png", dateGen: "30 septembre 2026 à 10:00" };

// ─── CAS ─────────────────────────────────────────────────────────────────────
test("gabarit Profero : héros, logo, Barlow, pied confidentiel", () => {
  const h = buildEncoursDocHTML(base);
  assert.ok(h.includes("family=Barlow"));
  assert.ok(h.includes('src="https://exemple.test/logo.png"'));
  assert.ok(h.includes("Document confidentiel"));
  assert.ok(h.includes(">Encours fournisseurs<"));
  assert.ok(h.includes("Généré le 30 septembre 2026 à 10:00"));
});

test("chiffres clés du mois en cours : à payer, payé, total", () => {
  const h = buildEncoursDocHTML(base);
  assert.ok(h.includes("À payer · septembre 2026"));
  assert.ok(h.includes("Payé comptant · septembre 2026"));
  assert.ok(h.includes("Total · septembre 2026"));
  assert.ok(h.includes(nb(4250)));
});

test("synthèse : une ligne par mois + total = somme des mois", () => {
  const h = buildEncoursDocHTML(base);
  const synth = h.slice(pos(h, "Synthèse par mois"), pos(h, "Détail par fournisseur"));
  assert.ok(synth.includes("octobre 2026") && synth.includes("septembre 2026"));
  // 1 500 + 250 à payer, 0 + 4 000 payé, 1 500 + 4 250 total
  assert.ok(synth.includes(nb(1750)));
  assert.ok(synth.includes(nb(4000)));
  assert.ok(synth.includes(nb(5750)));
  assert.ok(synth.includes("les achats réglés comptant"));
});

test("détail : en-tête de mois avec les trois montants, ordre conservé", () => {
  const h = buildEncoursDocHTML(base);
  const d = h.slice(pos(h, "Détail par fournisseur"));
  assert.ok(pos(d, "octobre 2026") < pos(d, "septembre 2026"));
  const sept = d.slice(pos(d, 'class="en-mois-nom bc">septembre 2026'));
  assert.ok(sept.includes(`À payer <b>${nb(250)}</b>`));
  assert.ok(sept.includes(`Payé <b>${nb(4000)}</b>`));
  assert.ok(sept.includes(`Total <b>${nb(4250)}</b>`));
  assert.ok(sept.includes("Total septembre 2026"));
});

test("écart facture − saisi affiché signé, tiret quand non applicable", () => {
  const h = buildEncoursDocHTML(base);
  assert.ok(h.includes(`+${nb(200)}`));
  const ligneB = h.slice(pos(h, ">FOURNISSEUR B<"), pos(h, ">FOURNISSEUR B<") + 600);
  assert.ok(ligneB.includes(">—<"));
});

test("noms échappés (pas d'injection HTML)", () => {
  const h = buildEncoursDocHTML(base);
  assert.ok(h.includes("Dupont &amp; Fils &lt;&quot;test&quot;&gt;"));
  assert.ok(!h.includes('<"test">'));
});

test("filtre fournisseur : repris dans le titre et les chips", () => {
  const h = buildEncoursDocHTML({ ...base, filtreFournisseur: "FOURNISSEUR A" });
  assert.ok(h.includes("Encours FOURNISSEUR A"));
  assert.ok(h.includes("Fournisseur : FOURNISSEUR A"));
});

test("aucune donnée : message explicite, pas de tableau vide", () => {
  const h = buildEncoursDocHTML({ ...base, mois: [] });
  assert.ok(h.includes("Aucune dépense enregistrée."));
  assert.ok(!h.includes('class="en-tab"'));
});

test("note d'explication non vide", () => {
  assert.ok(NOTE_ENCOURS.includes("Total = à payer + payé"));
});

let ko = 0;
for (const [nom, fn] of cas) {
  try { fn(); console.log(`  ok  ${nom}`); }
  catch (e) { ko += 1; console.log(`  KO  ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - ko}/${cas.length} cas passent`);
if (ko) process.exit(1);
