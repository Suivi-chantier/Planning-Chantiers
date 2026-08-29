import assert from "node:assert/strict";
import { construireRequeteApplicationReplanningV1 } from "../src/Renovation/planningReplanningApplyRequestV1.js";

const plan = (extra = {}) => ({
  apply_plan_version: 1,
  start_date: "2026-08-31",
  horizon_end: "2026-10-11",
  operations: [{ cell_key:"2026-W36::C1::Lundi", expected_before:{ exists:true }, after:{ week_id:"2026-W36", chantier_id:"C1", jour:"Lundi" } }],
  ...extra,
});
const guard = (extra = {}) => ({
  phasage_id:"P1", chantier_id:"C1", expected_updated_at:"2026-08-29T12:00:00Z", ...extra,
});
const safety = (extra = {}) => ({
  version: 1,
  phasage_guard_version: 1,
  start_date: "2026-08-31",
  horizon_end: "2026-10-11",
  application_autorisable: true,
  blockers: [],
  phasage_guards: [guard()],
  phasage_updates: [{ phasage_id:"P1", chantier_id:"C1", expected_updated_at:"2026-08-29T12:00:00Z", task_updates:[] }],
  resume: { cellules_a_ecrire:1, travaux_touches:1, phasages_a_verrouiller:1 },
  ...extra,
});

// 1. Cas autorisé : contrat RPC minimal et versions figées.
{
  const out = construireRequeteApplicationReplanningV1({ planApplication:plan(), securiteApplication:safety() });
  assert.equal(out.schema_version, 1);
  assert.equal(out.apply_plan_version, 1);
  assert.equal(out.safety_version, 1);
  assert.equal(out.phasage_guard_version, 1);
  assert.equal(out.application_autorisable, true);
  assert.equal(out.start_date, "2026-08-31");
  assert.equal(out.horizon_end, "2026-10-11");
  assert.equal(out.operations.length, 1);
  assert.equal(out.phasage_guards.length, 1);
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

// 4. Les horizons doivent provenir de la même simulation et être des bornes ISO cohérentes.
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan(),
  securiteApplication:safety({ horizon_end:"2026-10-12" }),
}), /Horizon/);
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan({ start_date:"31-08-2026" }),
  securiteApplication:safety({ start_date:"31-08-2026" }),
}), /Bornes d'horizon/);
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan({ start_date:"2026-10-12" }),
  securiteApplication:safety({ start_date:"2026-10-12" }),
}), /Bornes d'horizon/);

// 5. Le compteur sécurité doit correspondre exactement aux opérations envoyées.
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan(),
  securiteApplication:safety({ resume:{ cellules_a_ecrire:2, travaux_touches:1, phasages_a_verrouiller:1 } }),
}), /nombre d'opérations/);

// 6. Une simulation sans mutation ne peut jamais produire un appel RPC.
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan({ operations:[] }),
  securiteApplication:safety({ application_autorisable:true, resume:{ cellules_a_ecrire:0, travaux_touches:0, phasages_a_verrouiller:0 }, phasage_guards:[], phasage_updates:[] }),
}), /Aucune opération/);

// 7. Les trois versions sont verrouillées.
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan({ apply_plan_version:2 }), securiteApplication:safety(),
}), /Version du plan/);
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan(), securiteApplication:safety({ version:2 }),
}), /Version de sécurité/);
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan(), securiteApplication:safety({ phasage_guard_version:2 }),
}), /Version des gardes phasage/);

// 8. Une tâche liée touchée ne peut jamais produire une requête sans garde phasage.
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan(),
  securiteApplication:safety({ phasage_guards:[], resume:{ cellules_a_ecrire:1, travaux_touches:1, phasages_a_verrouiller:0 } }),
}), /Gardes phasage requises/);

// 9. Le compteur de gardes doit correspondre au tableau transmis.
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan(),
  securiteApplication:safety({ resume:{ cellules_a_ecrire:1, travaux_touches:1, phasages_a_verrouiller:2 } }),
}), /nombre de gardes phasage/);

// 10. Toute mise à jour date_prevue doit être couverte par une garde identique.
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan(),
  securiteApplication:safety({ phasage_updates:[{ phasage_id:"P2", chantier_id:"C2", expected_updated_at:"2026-08-29T12:00:00Z", task_updates:[] }] }),
}), /sans garde/);
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan(),
  securiteApplication:safety({ phasage_updates:[{ phasage_id:"P1", chantier_id:"C1", expected_updated_at:"2026-08-30T12:00:00Z", task_updates:[] }] }),
}), /incohérente avec sa garde/);

// 11. Une garde incomplète ou dupliquée est refusée avant le RPC.
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan(),
  securiteApplication:safety({ phasage_guards:[guard({ expected_updated_at:"" })] }),
}), /Garde phasage incomplète/);
assert.throws(() => construireRequeteApplicationReplanningV1({
  planApplication:plan(),
  securiteApplication:safety({ phasage_guards:[guard(), guard()], resume:{ cellules_a_ecrire:1, travaux_touches:1, phasages_a_verrouiller:2 } }),
}), /dupliquée/);

console.log("OK — planning replanning apply request V1: 11 scénarios + bornes horizon");
