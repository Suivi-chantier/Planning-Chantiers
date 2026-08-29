import assert from "node:assert/strict";
import { construireRequeteApplicationReplanningV1 } from "../src/Renovation/planningReplanningApplyRequestV1.js";

const plan = (extra = {}) => ({
  apply_plan_version: 1,
  start_date: "2026-08-31",
  horizon_end: "2026-10-11",
  operations: [{ cell_key:"2026-W36::C1::Lundi", expected_before:{ exists:true }, after:{ week_id:"2026-W36", chantier_id:"C1", jour:"Lundi" } }],
  ...extra,
});
const safety = (extra = {}) => ({
  version: 1,
  start_date: "2026-08-31",
  horizon_end: "2026-10-11",
  application_autorisable: true,
  blockers: [],
  phasage_updates: [{ phasage_id:"P1", expected_updated_at:"2026-08-29T12:00:00Z", task_updates:[] }],
  resume: { cellules_a_ecrire:1 },
  ...extra,
});

// 1. Cas autorisé : contrat RPC minimal et versions figées.
{
  const out = construireRequeteApplicationReplanningV1({ planApplication:plan(), securiteApplication:safety() });
  assert.equal(out.schema_version, 1);
  assert.equal(out.apply_plan_version, 1);
  assert.equal(out.safety_version, 1);
  assert.equal(out.application_autorisable, true);
  assert.equal(out.operations.length, 1);
  assert.equal(out.phasage_updates.length, 1);
}

// 2. Un blocker métier empêche même la construction de la requête.
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan(),
  securiteApplication:safety({
    application_autorisable:false,
    blockers:[{ code:"forecast_courant_sans_remplacement" }],
  }),
}), /forecast_courant_sans_remplacement/);

// 3. Impossible de mentir avec application_autorisable=true + blockers présents.
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan(),
  securiteApplication:safety({ blockers:[{ code:"conflit" }] }),
}), /blockers non vides/);

// 4. Les horizons doivent provenir de la même simulation.
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan(),
  securiteApplication:safety({ horizon_end:"2026-10-12" }),
}), /Horizon/);

// 5. Le compteur sécurité doit correspondre exactement aux opérations envoyées.
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan(),
  securiteApplication:safety({ resume:{ cellules_a_ecrire:2 } }),
}), /nombre d'opérations/);

// 6. Une simulation sans mutation ne peut jamais produire un appel RPC.
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan({ operations:[] }),
  securiteApplication:safety({ application_autorisable:true, resume:{ cellules_a_ecrire:0 } }),
}), /Aucune opération/);

// 7. Les versions sont verrouillées des deux côtés.
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan({ apply_plan_version:2 }), securiteApplication:safety(),
}), /Version du plan/);
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan(), securiteApplication:safety({ version:2 }),
}), /Version de sécurité/);

console.log("OK — planning replanning apply request V1: 7 scénarios");