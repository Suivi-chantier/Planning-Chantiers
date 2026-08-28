#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  CONSTRAINT_SCOPES,
  CONSTRAINT_TYPES,
  contrainteSapplique,
  evaluerContraintesPlanning,
  maturiteContraintePlanning,
  normaliserContraintePlanning,
} from "../src/Renovation/planningConstraintModelV1.js";

const chantier = "chantier_tourbouton";
const task = "task_pose_bloc";
const steven = "res_steven";
const davy = "res_davy";

// Normalisation + maturité.
const notBefore = normaliserContraintePlanning({
  id: "c_not_before",
  type: CONSTRAINT_TYPES.NOT_BEFORE,
  scope: CONSTRAINT_SCOPES.TACHE,
  chantier_id: chantier,
  tache_id: task,
  date_debut: "2026-09-10T12:00:00Z",
});
assert.equal(notBefore.date_debut, "2026-09-10");
assert.equal(notBefore.hard, true);
assert.equal(maturiteContraintePlanning(notBefore).valide, true);
assert.equal(maturiteContraintePlanning({ type: CONSTRAINT_TYPES.NOT_BEFORE, scope: CONSTRAINT_SCOPES.TACHE, tache_id: task }).valide, false);

// Scope : une contrainte tâche ne s'applique qu'à la bonne tâche.
assert.equal(contrainteSapplique(notBefore, { chantier_id: chantier, tache_id: task }), true);
assert.equal(contrainteSapplique(notBefore, { chantier_id: chantier, tache_id: "other" }), false);

// Démarrage au plus tôt : blocage avant, autorisé à partir de la date.
let result = evaluerContraintesPlanning({ contraintes: [notBefore], context: { chantier_id: chantier, tache_id: task }, dateISO: "2026-09-09" });
assert.equal(result.eligible, false);
assert.equal(result.blocks[0].type, CONSTRAINT_TYPES.NOT_BEFORE);
result = evaluerContraintesPlanning({ contraintes: [notBefore], context: { chantier_id: chantier, tache_id: task }, dateISO: "2026-09-10" });
assert.equal(result.eligible, true);

// Deadline : après échéance, violation mais jamais blocage définitif.
const deadline = {
  id: "c_deadline",
  type: CONSTRAINT_TYPES.DEADLINE,
  scope: CONSTRAINT_SCOPES.CHANTIER,
  chantier_id: chantier,
  date_fin: "2026-09-15",
};
result = evaluerContraintesPlanning({ contraintes: [deadline], context: { chantier_id: chantier, tache_id: task }, dateISO: "2026-09-16" });
assert.equal(result.eligible, true);
assert.equal(result.violations.length, 1);

// Fenêtre fixe : impossible avant/après, possible dedans ; dépassement signalé.
const fixed = {
  id: "c_fixed",
  type: CONSTRAINT_TYPES.FIXED_DATE,
  scope: CONSTRAINT_SCOPES.TACHE,
  chantier_id: chantier,
  tache_id: task,
  date_debut: "2026-09-12",
  date_fin: "2026-09-13",
};
assert.equal(evaluerContraintesPlanning({ contraintes: [fixed], context: { chantier_id: chantier, tache_id: task }, dateISO: "2026-09-12" }).eligible, true);
result = evaluerContraintesPlanning({ contraintes: [fixed], context: { chantier_id: chantier, tache_id: task }, dateISO: "2026-09-14" });
assert.equal(result.eligible, false);
assert.equal(result.violations.length, 1);

// Ressource requise / interdite.
const required = {
  id: "c_req",
  type: CONSTRAINT_TYPES.RESOURCE_REQUIRED,
  scope: CONSTRAINT_SCOPES.TACHE,
  chantier_id: chantier,
  tache_id: task,
  config: { resource_ids: [steven, steven] },
};
assert.deepEqual(normaliserContraintePlanning(required).config.resource_ids, [steven]);
assert.equal(evaluerContraintesPlanning({ contraintes: [required], context: { chantier_id: chantier, tache_id: task }, dateISO: "2026-09-12", resourceId: steven }).eligible, true);
assert.equal(evaluerContraintesPlanning({ contraintes: [required], context: { chantier_id: chantier, tache_id: task }, dateISO: "2026-09-12", resourceId: davy }).eligible, false);

const forbidden = {
  id: "c_forbid",
  type: CONSTRAINT_TYPES.RESOURCE_FORBIDDEN,
  scope: CONSTRAINT_SCOPES.TACHE,
  chantier_id: chantier,
  tache_id: task,
  config: { resource_ids: [davy] },
};
assert.equal(evaluerContraintesPlanning({ contraintes: [forbidden], context: { chantier_id: chantier, tache_id: task }, dateISO: "2026-09-12", resourceId: davy }).eligible, false);
assert.equal(evaluerContraintesPlanning({ contraintes: [forbidden], context: { chantier_id: chantier, tache_id: task }, dateISO: "2026-09-12", resourceId: steven }).eligible, true);

// Lock allocation et priorité soft.
const lock = {
  id: "c_lock",
  type: CONSTRAINT_TYPES.ALLOCATION_LOCK,
  scope: CONSTRAINT_SCOPES.ALLOCATION,
  allocation_id: "alloc_1",
};
const priority = {
  id: "c_priority",
  type: CONSTRAINT_TYPES.PRIORITY,
  scope: CONSTRAINT_SCOPES.CHANTIER,
  chantier_id: chantier,
  priority: 25,
  hard: false,
};
result = evaluerContraintesPlanning({
  contraintes: [lock, priority],
  context: { chantier_id: chantier, tache_id: task, allocation_id: "alloc_1" },
  dateISO: "2026-09-12",
});
assert.equal(result.locked, true);
assert.equal(result.score, 25);
assert.equal(result.eligible, true);

// Contrainte inactive : aucun effet.
result = evaluerContraintesPlanning({
  contraintes: [{ ...notBefore, actif: false }],
  context: { chantier_id: chantier, tache_id: task },
  dateISO: "2026-09-01",
});
assert.equal(result.eligible, true);
assert.equal(result.applied_constraint_ids.length, 0);

console.log("planningConstraintModelV1 fixtures: OK");
