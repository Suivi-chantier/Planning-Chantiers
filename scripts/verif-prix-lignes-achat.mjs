#!/usr/bin/env node
// Vérifie src/Renovation/prixLignesAchat.mjs : prix HT des lignes d'un document
// d'achat lu par l'IA, et répartition d'une remise globale.
//
// Cas 1 = ticket Leroy Merlin du 14/10/2026 (preuve d'achat n° 1105426005283),
// chiffres recopiés du document : la remise fidélité y est déjà déduite ligne
// par ligne, rien ne doit bouger. Les autres cas sont des données fictives.
//   node scripts/verif-prix-lignes-achat.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  nombre, totalLigneHT, sommeLignesHT, ecartLignesDocument, repartirRemiseGlobale,
} from "../src/Renovation/prixLignesAchat.mjs";

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);
const somme = (lignes) => Math.round(lignes.reduce((s, l) => s + l.prix_total, 0) * 100) / 100;

test("1. ticket Leroy Merlin 14/10 : remise déjà déduite ligne par ligne, prix inchangés", () => {
  const lignes = [
    { designation: "24 VIS TFB TX 6X120", quantite: "1", prix_unitaire: 11.92, prix_total: 11.92 },
    { designation: "JOINT ETANCHEITE EXPANSIF 30MM", quantite: "1", prix_unitaire: 14.17, prix_total: 14.17 },
    { designation: "JOINT ETANCHEITE EXPANSIF 15MM", quantite: "2", prix_unitaire: 8.925, prix_total: 17.85 },
  ];
  const r = repartirRemiseGlobale(lignes, 43.94);
  assert.equal(r.remise, null);
  assert.equal(r.lignes, lignes, "mêmes lignes, non recopiées");
  assert.equal(r.ecart.statut, "egal");
  assert.deepEqual(r.lignes.map(l => l.prix_total), [11.92, 14.17, 17.85]);
});

test("2. remise fidélité NON déduite des lignes (données fictives) : répartie au prorata", () => {
  const lignes = [
    { quantite: 2, prix_unitaire: 40, prix_total: 80 },
    { quantite: 1, prix_total: 104.98 },
  ];
  const r = repartirRemiseGlobale(lignes, 166.48);
  assert.ok(r.remise);
  assert.equal(r.remise.avant, 184.98);
  assert.equal(r.remise.apres, 166.48);
  assert.equal(r.remise.coefficient, 0.9);
  assert.equal(somme(r.lignes), 166.48, "somme exactement égale au total HT");
  assert.equal(r.lignes[0].prix_total, 72);
  assert.equal(r.lignes[0].prix_unitaire, 36, "PU recalculé = total / quantité");
  assert.equal(r.ecart.statut, "egal");
});

test("3. centime d'arrondi reporté sur la plus grosse ligne (données fictives)", () => {
  const lignes = [{ prix_total: 10 }, { prix_total: 10 }, { prix_total: 10.01 }];
  const r = repartirRemiseGlobale(lignes, 20);
  assert.equal(somme(r.lignes), 20);
  assert.ok(r.lignes.every(l => Math.abs(l.prix_total - 6.67) <= 0.011));
});

test("4. lignes sous le total : rien n'est touché, l'écart est signalé", () => {
  const lignes = [{ prix_total: 30 }, { prix_total: 10 }];
  const r = repartirRemiseGlobale(lignes, 50);
  assert.equal(r.remise, null);
  assert.equal(r.lignes, lignes);
  assert.equal(r.ecart.statut, "lignes_en_dessous");
  assert.equal(r.ecart.ecart, -10);
});

test("5. une ligne sans prix : somme inconnue (pas 0), aucune répartition", () => {
  const lignes = [{ prix_total: 30 }, { prix_unitaire: null, prix_total: "" }];
  assert.equal(sommeLignesHT(lignes), null);
  const r = repartirRemiseGlobale(lignes, 20);
  assert.equal(r.remise, null);
  assert.equal(r.ecart.statut, "inconnu");
});

test("6. total du document absent : inconnu, rien n'est touché", () => {
  const lignes = [{ prix_total: 30 }];
  assert.equal(repartirRemiseGlobale(lignes, null).ecart.statut, "inconnu");
  assert.equal(repartirRemiseGlobale(lignes, "").remise, null);
});

test("7. écart invraisemblable (plus de 50 %) : pas traité comme une remise", () => {
  const lignes = [{ prix_total: 100 }];
  const r = repartirRemiseGlobale(lignes, 40);
  assert.equal(r.remise, null);
  assert.equal(r.lignes, lignes);
  assert.equal(r.ecart.statut, "lignes_au_dessus");
});

test("8. tolérance de 2 centimes : arrondis du document acceptés", () => {
  const r = repartirRemiseGlobale([{ prix_total: 11.925 }, { prix_total: 14.175 }], 26.09);
  assert.equal(r.remise, null);
  assert.equal(r.ecart.statut, "egal");
});

test("9. valeurs saisies à l'écran (chaînes, virgules, unités)", () => {
  assert.equal(nombre("12,5 m²"), 12.5);
  assert.equal(nombre(""), null);
  assert.equal(nombre("abc"), null);
  assert.equal(totalLigneHT({ quantite: "3", prix_unitaire: "2,50", prix_total: "" }), 7.5);
  assert.equal(totalLigneHT({ prix_unitaire: "4" }), 4, "quantité absente = 1");
  const e = ecartLignesDocument([{ prix_total: "10,73" }, { prix_total: "12,75" }], "43,94");
  assert.equal(e.statut, "lignes_en_dessous");
});

test("10. module pur : ni Supabase, ni horloge, ni réseau", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/Renovation/prixLignesAchat.mjs", import.meta.url)), "utf8");
  const code = src.split("\n").filter(l => !l.trimStart().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /\bimport\b/);
  assert.doesNotMatch(code, /supabase|Date\.now|new Date|fetch\(/);
  const facade = readFileSync(fileURLToPath(new URL("../src/Renovation/prixLignesAchat.js", import.meta.url)), "utf8");
  assert.match(facade, /export \* from "\.\/prixLignesAchat\.mjs"/);
});

test("11. les deux écrans de saisie passent par le module", () => {
  for (const f of ["CaptureCommandeMobile.jsx", "Commandes.jsx"]) {
    const src = readFileSync(fileURLToPath(new URL(`../src/Renovation/${f}`, import.meta.url)), "utf8");
    assert.match(src, /repartirRemiseGlobale\(/, `${f} répartit la remise via le module`);
  }
});

let ko = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`OK  ${nom}`); }
  catch (e) { ko++; console.error(`KO  ${nom}\n    ${e.message}`); }
}
console.log(`\n${cas.length - ko}/${cas.length} vérifications passées`);
if (ko) process.exit(1);
