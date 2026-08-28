#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function loadModule(rel) {
  const url = new URL(rel, import.meta.url);
  const source = await readFile(url, "utf8");
  const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  return import(dataUrl);
}

// L'audit importe planningModelV1 via un import relatif ; on le charge donc via
// un petit module miroir avec les deux sources concaténées pour garder ce test
// exécutable sans changer la configuration ESM globale du projet.
const modelSource = await readFile(new URL("../src/Renovation/planningModelV1.js", import.meta.url), "utf8");
let auditSource = await readFile(new URL("../src/Renovation/planningModelAuditV1.js", import.meta.url), "utf8");
const modelDataUrl = `data:text/javascript;base64,${Buffer.from(modelSource).toString("base64")}`;
auditSource = auditSource.replace('"./planningModelV1.js"', JSON.stringify(modelDataUrl));
const auditDataUrl = `data:text/javascript;base64,${Buffer.from(auditSource).toString("base64")}`;
const { auditerBibliothequeV2 } = await import(auditDataUrl);

const base = {
  identifiant: "ouvrages_v2_test",
  libelle: "E-007 : Test",
  sous_taches: [
    { id: "st_unique", nom: "A", lotId: "electricite", groupe_type_id: "gt_reseau_elec", ratio: 100, dependance_mode: "parallel", predecesseur_ids: [] },
  ],
};

const ok = auditerBibliothequeV2([{ ...base, id: "o1" }]);
assert.equal(ok.ok, true);
assert.equal(ok.stats.ids_uniques, 1);
assert.equal(ok.stats.ids_dupliques, 0);

const collision = auditerBibliothequeV2([
  { ...base, id: "o1" },
  { ...base, id: "o2", identifiant: "ouvrages_v2_test2", libelle: "E-008 : Test 2" },
]);
assert.equal(collision.ok, false);
assert.equal(collision.stats.ids_dupliques, 1);
assert.equal(collision.ids_dupliques[0].id, "st_unique");
assert.equal(collision.ids_dupliques[0].occurrences, 2);

console.log("planningModelAuditV1 fixtures: OK");
