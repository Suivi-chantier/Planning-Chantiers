#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  datePlanningDepuisWeekJour,
  enrichirCelluleAllocationUids,
  allocationsDepuisCellules,
  creerSnapshotPlanningReferenceV1,
  diffPlanningReferenceV1,
  coucheTemporelleAllocation,
  estAllocationRecalculableV1,
  grouperAllocationsParTache,
} from "../src/Renovation/planningBaselineModelV1.js";

assert.equal(datePlanningDepuisWeekJour("2026-W36", "Lundi"), "2026-08-31");
assert.equal(datePlanningDepuisWeekJour("2026-W36", "Vendredi"), "2026-09-04");

let seq = 0;
const uid = () => `u-${++seq}`;
const cellA = {
  week_id: "2026-W36", chantier_id: "ch-1", jour: "Lundi", ouvriers: ["Steven", "Mohamed"],
  taches: [
    { id: "legacy-shared", tache_id: "t1", text: "Réseau", duree: 4, ouvriers: ["Steven"] },
    { id: "legacy-shared", text: "Tâche manuelle", duree: 2, ouvriers: [] },
  ],
};
const enriched = enrichirCelluleAllocationUids(cellA, { genererUid: uid });
assert.equal(enriched.changed, true);
assert.equal(enriched.cellule.taches[0].allocation_uid, "u-1");
assert.equal(enriched.cellule.taches[1].allocation_uid, "u-2");
assert.equal(enriched.cellule.taches[0].id, "legacy-shared");
assert.equal(enriched.cellule.taches[1].id, "legacy-shared");

const resourceIndex = new Map([
  ["steven", { id: "r-steven" }],
  ["mohamed", { id: "r-mohamed" }],
]);
const allocations = allocationsDepuisCellules([enriched.cellule], { resourceIndex, genererUid: uid });
assert.equal(allocations.length, 2);
const a1 = allocations.find(a => a.tache_id === "t1");
const manual = allocations.find(a => !a.tache_id);
assert.equal(a1.date, "2026-08-31");
assert.deepEqual(a1.resource_ids, ["r-steven"]);
assert.deepEqual(manual.ouvriers_noms.sort(), ["Mohamed", "Steven"]);
assert.equal(manual.source, "manuel");

const snapshot = creerSnapshotPlanningReferenceV1({ chantier_id: "ch-1", allocations, created_at: "2026-08-28T18:00:00Z" });
assert.equal(snapshot.schema_version, 1);
assert.equal(snapshot.allocation_count, 2);

const courant = allocations.map(a => ({ ...a }));
courant[0] = { ...courant[0], date: "2026-09-01", duree: courant[0].duree + 1, resource_ids: ["r-mohamed"], ouvriers_noms: ["Mohamed"] };
courant.pop();
courant.push({
  allocation_uid: "u-new", legacy_id: "x", tache_id: "t2", chantier_id: "ch-1",
  week_id: "2026-W36", jour: "Mercredi", date: "2026-09-02", duree: 3,
  ouvriers_noms: ["Steven"], resource_ids: ["r-steven"], texte: "Nouvelle", source: "phasage",
});
const diff = diffPlanningReferenceV1(allocations, courant);
assert.equal(diff.resume.total, 3);
assert.equal(diff.resume.changed, 1);
assert.equal(diff.resume.moved, 1);
assert.equal(diff.resume.resized, 1);
assert.equal(diff.resume.restaffed, 1);
assert.equal(diff.resume.removed, 1);
assert.equal(diff.resume.added, 1);

assert.equal(coucheTemporelleAllocation("2026-08-27", "2026-08-28"), "past");
assert.equal(coucheTemporelleAllocation("2026-08-28", "2026-08-28"), "today");
assert.equal(coucheTemporelleAllocation("2026-08-29", "2026-08-28"), "future");
assert.equal(estAllocationRecalculableV1({ date: "2026-08-29" }, { cutoffISO: "2026-08-28" }), true);
assert.equal(estAllocationRecalculableV1({ date: "2026-08-29" }, { cutoffISO: "2026-08-28", locked: true }), false);
assert.equal(estAllocationRecalculableV1({ date: "2026-08-28" }, { cutoffISO: "2026-08-28" }), false);

const split = [
  { allocation_uid:"s1", tache_id:"same-task", date:"2026-09-01" },
  { allocation_uid:"s2", tache_id:"same-task", date:"2026-09-02" },
];
assert.equal(grouperAllocationsParTache(split).get("same-task").length, 2);

assert.throws(() => allocationsDepuisCellules([
  { chantier_id:"c", week_id:"2026-W36", jour:"Lundi", taches:[{allocation_uid:"dup",id:"a"}] },
  { chantier_id:"c", week_id:"2026-W36", jour:"Mardi", taches:[{allocation_uid:"dup",id:"b"}] },
]), /dupliqué/);

console.log("Planning Baseline V1 fixtures: OK");
