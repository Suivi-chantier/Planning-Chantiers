#!/usr/bin/env node
import assert from "node:assert/strict";
import { chargerModuleSource } from "./_chargeur.mjs";

// L'audit importe planningModelV1 (qui importe codeOuvrage.mjs) : le chargeur
// partagé réécrit ces imports relatifs pour rester exécutable sans changer la
// configuration ESM globale du projet.
const { auditerBibliothequeV2 } = await chargerModuleSource("../src/Renovation/planningModelAuditV1.js", import.meta.url);

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
