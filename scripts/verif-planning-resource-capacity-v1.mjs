#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  capaciteBasePlanningPourDate,
  calculerCapaciteRessourcePourDate,
} from "../src/Renovation/planningResourceCapacityV1.js";

// Semaine 35/2026 impaire = 4 jours : vendredi non travaillé.
assert.equal(capaciteBasePlanningPourDate("2026-08-28"), 0);
// Semaine 36/2026 paire = 5 jours : 7 h planifiables lun-jeu, 6 h vendredi.
assert.equal(capaciteBasePlanningPourDate("2026-08-31"), 7);
assert.equal(capaciteBasePlanningPourDate("2026-09-04"), 6);
assert.equal(capaciteBasePlanningPourDate("2026-09-05"), 0);

const resource = { id: "res_test", nom: "Test", nom_planning: "Test", actif: true };
const normal = calculerCapaciteRessourcePourDate({ resource, dateISO: "2026-08-31", heuresDejaAllouees: 2 });
assert.equal(normal.capacite_base, 7);
assert.equal(normal.capacite_disponible, 5);

const absent = calculerCapaciteRessourcePourDate({
  resource,
  dateISO: "2026-08-31",
  evenements: [{ id: "a1", resource_id: "res_test", type: "absence", date: "2026-08-31", motif: "Congé" }],
});
assert.equal(absent.capacite_disponible, 0);
assert.equal(absent.indisponible, true);

console.log("planningResourceCapacityV1 fixtures: OK");
