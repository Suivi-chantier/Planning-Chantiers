import assert from "node:assert/strict";
import { identifierImpactReplanningV1 } from "../src/Renovation/planningReplanningImpactV1.js";

const t = (id, extra = {}) => ({
  id, chantier_id: id.split("::")[0], tache_id: id.split("::")[1], site_id: "OP1",
  candidate_resource_ids: ["R1", "R2"], heures_mo_restantes: 8, predecesseur_ids: [], ...extra,
});
const a = (id, date, resources = ["R1"], extra = {}) => ({
  allocation_uid: `A-${id}-${date}`, chantier_id: id.split("::")[0], tache_id: id.split("::")[1],
  date, duree: 8, resource_ids: resources, ...extra,
});

// 1. Sans trigger ciblé : comportement sûr = recalcul global.
{
  const out = identifierImpactReplanningV1({ travaux: [t("C1::T1"), t("C1::T2")], forecast: [] });
  assert.equal(out.mode, "full_recalc");
  assert.deepEqual(out.travail_ids_impactes, ["C1::T1", "C1::T2"]);
}

// 2. Absence R1 mardi : seule la tâche réellement affectée est impactée.
{
  const travaux = [t("C1::T1"), t("C2::T2", { site_id: "OP2" })];
  const forecast = [a("C1::T1", "2026-09-01", ["R1"]), a("C2::T2", "2026-09-01", ["R2"])];
  const out = identifierImpactReplanningV1({
    travaux, forecast,
    trigger: { type: "resource_unavailable", resource_id: "R1", date_debut: "2026-09-01", date_fin: "2026-09-01" },
  });
  assert.deepEqual(out.travail_ids_impactes, ["C1::T1"]);
  assert.equal(out.allocations_preservables.length, 1);
  assert.equal(out.allocations_preservables[0].chantier_id, "C2");
}

// 3. Une absence hors de la date de l'allocation ne libère rien.
{
  const out = identifierImpactReplanningV1({
    travaux: [t("C1::T1")], forecast: [a("C1::T1", "2026-09-02", ["R1"])],
    trigger: { type: "resource_unavailable", resource_id: "R1", date_debut: "2026-09-01", date_fin: "2026-09-01" },
  });
  assert.deepEqual(out.travail_ids_impactes, []);
  assert.equal(out.allocations_preservables.length, 1);
}

// 4. L'impact se propage uniquement vers les dépendants en aval.
{
  const travaux = [
    t("C1::A"),
    t("C1::B", { predecesseur_ids: ["C1::A"] }),
    t("C1::C", { predecesseur_ids: ["C1::B"] }),
    t("C1::X"),
  ];
  const forecast = [a("C1::A", "2026-09-01", ["R1"]), a("C1::B", "2026-09-02", ["R2"]), a("C1::C", "2026-09-03", ["R2"]), a("C1::X", "2026-09-01", ["R2"])];
  const out = identifierImpactReplanningV1({
    travaux, forecast,
    trigger: { type: "resource_unavailable", resource_id: "R1", date_debut: "2026-09-01" },
  });
  assert.deepEqual(out.travail_ids_impactes, ["C1::A", "C1::B", "C1::C"]);
  assert.equal(out.raisons_par_travail["C1::B"][0].code, "dependance_aval_d_un_travail_impacte");
  assert.equal(out.allocations_preservables.some(x => x.tache_id === "X"), true);
}

// 5. Un forecast incomplet par rapport au reste réel n'est jamais gelé.
{
  const out = identifierImpactReplanningV1({
    travaux: [t("C1::T1", { heures_mo_restantes: 10 })],
    forecast: [a("C1::T1", "2026-09-01", ["R1"], { duree: 4 })],
    trigger: { type: "resource_unavailable", resource_id: "R9", date_debut: "2026-09-01" },
  });
  assert.deepEqual(out.travail_ids_impactes, ["C1::T1"]);
  assert.equal(out.raisons_par_travail["C1::T1"].some(r => r.code === "forecast_incomplet_vs_reste_reel"), true);
}

// 6. Un forecast surdimensionné après mise à jour de l'avancement est libéré.
{
  const out = identifierImpactReplanningV1({
    travaux: [t("C1::T1", { heures_mo_restantes: 4 })],
    forecast: [a("C1::T1", "2026-09-01", ["R1"], { duree: 8 })],
    trigger: { type: "task_state_changed", travail_id: "C1::T1" },
  });
  assert.equal(out.raisons_par_travail["C1::T1"].some(r => r.code === "forecast_surdimensionne_vs_reste_reel"), true);
  assert.equal(out.allocations_preservables.length, 0);
}

// 7. Une ressource forecast sortie du pool métier rend la tâche impactée même si le trigger est ailleurs.
{
  const out = identifierImpactReplanningV1({
    travaux: [t("C1::T1", { candidate_resource_ids: ["R1"] })],
    forecast: [a("C1::T1", "2026-09-01", ["R2"])],
    trigger: { type: "resource_unavailable", resource_id: "R9", date_debut: "2026-09-01" },
  });
  assert.deepEqual(out.travail_ids_impactes, ["C1::T1"]);
  assert.equal(out.raisons_par_travail["C1::T1"].some(r => r.code === "forecast_hors_pool_metier"), true);
}

// 8. Trigger inconnu : on préfère un recalcul global explicite à un faux périmètre réduit.
{
  const out = identifierImpactReplanningV1({
    travaux: [t("C1::T1"), t("C2::T2")], forecast: [], trigger: { type: "mystere" },
  });
  assert.equal(out.mode, "unknown_fallback_full_recalc");
  assert.deepEqual(out.travail_ids_impactes, ["C1::T1", "C2::T2"]);
}

console.log("OK — planning replanning impact V1: 8 scénarios");
