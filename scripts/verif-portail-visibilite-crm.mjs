#!/usr/bin/env node
// Vérifie les cases « visible par le client » de la fiche dossier Invest.
// Exemple issu des tests, données fictives : aucune donnée réelle.
//   node scripts/verif-portail-visibilite-crm.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tachesFiche } from "../src/Invest/dossiers/ficheDossierVue.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const FICHE = readFileSync(join(racine, "src/Invest/dossiers/FicheDossier.jsx"), "utf8");
const DOCS = readFileSync(join(racine, "src/Invest/_shared.jsx"), "utf8");
const D = "d1";
const base = (o) => ({ id: o.id, dossier_id: D, action_title: o.id, status: "a_faire", due_date: "2027-01-01", etape: "recherche", ...o });
let n = 0;
const test = (nom, fn) => { try { fn(); n++; console.log(`  ✔ ${nom}`); } catch (e) { console.log(`  ✘ ${nom}\n      ${e.message.split("\n")[0]}`); process.exitCode = 1; } };

const t = tachesFiche([base({ id: "a", visible_client: true }), base({ id: "b", visible_client: false }),
  base({ id: "c" }), base({ id: "d", visible_client: null }), base({ id: "e", visible_client: "true" })], D, "2026-10-01");
const par = Object.fromEntries(t.aFaire.map((x) => [x.id, x.visibleClient]));

test("1. seul `true` rend une tâche visible : faux, absent, null et texte restent masqués", () => {
  assert.deepEqual(par, { a: true, b: false, c: false, d: false, e: false });
});
test("2. la lecture des tâches demande la colonne visible_client", () => {
  assert.match(FICHE, /from\("invest_mission_actions"\)\.select\("[^"]*visible_client[^"]*"\)/);
});
test("3. la bascule d'une tâche n'écrit QUE visible_client", () => {
  assert.match(FICHE, /from\("invest_mission_actions"\)\.update\(\{ visible_client: !x\.visibleClient \}\)/);
});
test("4. la bascule du dossier n'écrit QUE portail_visible, avec confirmation avant de montrer", () => {
  assert.match(FICHE, /from\("invest_dossiers"\)\.update\(\{ portail_visible: voulu \}\)/);
  assert.match(FICHE, /if \(voulu && !window\.confirm\(/);
});
test("5. les cases ne sont proposées que sur un dossier modifiable et en cours", () => {
  assert.match(FICHE, /const peutMontrer = fiche\.modifiable && fiche\.dossier\.id === fiche\.dossierEnCours\?\.id;/);
  assert.match(FICHE, /\{m && <button[\s\S]{0,160}\{fiche\.dossier\.portail_visible === true \? "Masquer" : "Montrer au client"\}/);
});
test("6. l'état par défaut affiché est « Non visible » (jamais visible sans `true`)", () => {
  assert.match(FICHE, /portail_visible === true \? "Dossier visible par le client" : "Non visible par le client"/);
});
test("7. le texte d'information promet seulement titre, statut, progression, jamais honoraires ni notes", () => {
  assert.match(FICHE, /Jamais les honoraires ni les notes internes/);
});

test("8. partage de documents : proposé seulement pour un dossier « clients/<id> » (jamais un bien)", () => {
  assert.match(DOCS, /const clientPartageId = String\(folder \|\| ""\)\.match\(\/\^clients\\\//);
  assert.match(DOCS, /\{clientPartageId && \(\(\) => \{ const actif/);
});
test("9. partager demande confirmation ; retirer non ; seul le statut ou une nouvelle ligne est écrit", () => {
  assert.match(DOCS, /if \(!partageActif && !window\.confirm\(/);
  assert.match(DOCS, /from\("invest_documents_partages"\)\s*\.update\(partageActif \? \{ statut: "retire"/);
  assert.match(DOCS, /\.insert\(\{ client_id: clientPartageId, chemin, libelle, partage_par/);
});
test("10. supprimer un fichier partagé le retire aussi du partage", () => {
  assert.match(DOCS, /Un fichier supprimé ne doit plus rester partagé avec le client/);
});

console.log(`\n${n}/10 contrôles conformes`);
