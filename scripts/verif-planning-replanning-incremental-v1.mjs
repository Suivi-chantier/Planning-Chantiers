import assert from "node:assert/strict";
import { planifierReplanningIncrementalV1 } from "../src/Renovation/planningReplanningIncrementalV1.js";

const resource = id => ({ id, nom: id, nom_planning: id, kind: "personne", actif: true, capacite_facteur: 1 });
const work = (id, resourceIds, extra = {}) => ({
  id,
  chantier_id: id.split("::")[0],
  tache_id: id.split("::")[1],
  site_id: `SITE-${id.split("::")[0]}`,
  groupe_type_id: "GT1",
  texte: id,
  heures_mo_restantes: 8,
  crew_size: 1,
  candidate_resource_ids: resourceIds,
  preferred_resource_ids: resourceIds,
  predecesseur_ids: [],
  priority: 0,
  ordre_groupe: 10,
  ordre_tache: 0,
  fractionnable: true,
  provenance: { etat_reel: { en_retard: false, avancement: 0, reste_a_faire_heures: 8, source_verite: "phasage" } },
  ...extra,
});
const forecast = (id, date, rid, extra = {}) => ({
  allocation_uid: `F-${id}-${date}`,
  chantier_id: id.split("::")[0],
  tache_id: id.split("::")[1],
  date,
  duree: 8,
  resource_ids: [rid],
  ouvriers_noms: [rid],
  ...extra,
});
const input = (travaux, extra = {}) => ({
  travaux,
  ressources: [resource("R1"), resource("R2"), resource("R3")],
  evenementsRessources: [],
  contraintes: [],
  allocationsExistantes: [],
  completedTaskIds: [],
  startDate: "2026-09-01",
  horizonDays: 4,
  ...extra,
});

// 1. Absence ciblée : l'allocation R2 sans rapport est préservée strictement ; seule R1 bouge.
{
  const a = work("C1::A", ["R1"], { stability_forecast: { dates: ["2026-09-01"], resource_ids_compatibles: ["R1"] } });
  const b = work("C2::B", ["R2"], { stability_forecast: { dates: ["2026-09-01"], resource_ids_compatibles: ["R2"] } });
  const fa = forecast("C1::A", "2026-09-01", "R1");
  const fb = forecast("C2::B", "2026-09-01", "R2");
  const out = planifierReplanningIncrementalV1({
    engineInput: input([a, b], {
      evenementsRessources: [{ id: "ABS", resource_id: "R1", type: "absence", date_debut: "2026-09-01", date_fin: "2026-09-01", toute_journee: true, actif: true, source: "manuel" }],
    }),
    forecast: [fa, fb],
    trigger: { type: "resource_unavailable", resource_id: "R1", date_debut: "2026-09-01", date_fin: "2026-09-01" },
  });
  const preserved = out.allocations_proposees.find(x => x.travail_id === "C2::B");
  const moved = out.allocations_proposees.find(x => x.travail_id === "C1::A");
  assert.equal(preserved.preserved, true);
  assert.equal(preserved.allocation_uid, fb.allocation_uid);
  assert.equal(preserved.date, "2026-09-01");
  assert.deepEqual(preserved.resource_ids, ["R2"]);
  assert.equal(moved.preserved, undefined);
  assert.equal(moved.date, "2026-09-02");
  assert.deepEqual(out.replanning.incremental.travail_ids_impactes, ["C1::A"]);
  assert.equal(out.resume.allocations_preservees, 1);
}

// 2. Un forecast incomplet n'est pas préservé même s'il est hors du trigger direct.
{
  const a = work("C1::A", ["R1"], { stability_forecast: { dates: ["2026-09-01"], resource_ids_compatibles: ["R1"] } });
  const b = work("C2::B", ["R2"], { heures_mo_restantes: 10, provenance: { etat_reel: { en_retard: false, avancement: 0, reste_a_faire_heures: 10, source_verite: "phasage" } } });
  const fa = forecast("C1::A", "2026-09-01", "R1");
  const fb = forecast("C2::B", "2026-09-01", "R2", { duree: 4 });
  const out = planifierReplanningIncrementalV1({
    engineInput: input([a, b], {
      evenementsRessources: [{ id: "ABS", resource_id: "R1", type: "absence", date_debut: "2026-09-01", date_fin: "2026-09-01", toute_journee: true, actif: true, source: "manuel" }],
    }),
    forecast: [fa, fb],
    trigger: { type: "resource_unavailable", resource_id: "R1", date_debut: "2026-09-01" },
  });
  assert.equal(out.replanning.incremental.travail_ids_impactes.includes("C2::B"), true);
  assert.equal(out.allocations_proposees.some(x => x.travail_id === "C2::B" && x.preserved === true), false);
}

// 3. Un dépendant d'une tâche impactée est libéré lui aussi ; un travail indépendant reste préservé.
{
  const a = work("C1::A", ["R1"], { stability_forecast: { dates: ["2026-09-01"], resource_ids_compatibles: ["R1"] } });
  const b = work("C1::B", ["R2"], { predecesseur_ids: ["C1::A"], stability_forecast: { dates: ["2026-09-02"], resource_ids_compatibles: ["R2"] } });
  const x = work("C2::X", ["R3"], { stability_forecast: { dates: ["2026-09-01"], resource_ids_compatibles: ["R3"] } });
  const out = planifierReplanningIncrementalV1({
    engineInput: input([a, b, x], {
      evenementsRessources: [{ id: "ABS", resource_id: "R1", type: "absence", date_debut: "2026-09-01", date_fin: "2026-09-01", toute_journee: true, actif: true, source: "manuel" }],
    }),
    forecast: [forecast("C1::A", "2026-09-01", "R1"), forecast("C1::B", "2026-09-02", "R2"), forecast("C2::X", "2026-09-01", "R3")],
    trigger: { type: "resource_unavailable", resource_id: "R1", date_debut: "2026-09-01" },
  });
  assert.deepEqual(out.replanning.incremental.travail_ids_impactes, ["C1::A", "C1::B"]);
  assert.equal(out.allocations_proposees.find(x => x.travail_id === "C2::X").preserved, true);
  assert.equal(out.allocations_proposees.find(x => x.travail_id === "C1::B").preserved, undefined);
}

// 4. Un prédécesseur préservé garde sa vraie date de fin : son dépendant recalculé ne peut pas passer avant.
{
  const a = work("C1::A", ["R1"]);
  const b = work("C1::B", ["R2"], { predecesseur_ids: ["C1::A"] });
  const out = planifierReplanningIncrementalV1({
    engineInput: input([a, b]),
    forecast: [forecast("C1::A", "2026-09-02", "R1")],
    trigger: { type: "task_state_changed", travail_id: "C1::B" },
  });
  const pa = out.allocations_proposees.find(x => x.travail_id === "C1::A");
  const pb = out.allocations_proposees.find(x => x.travail_id === "C1::B");
  assert.equal(pa.preserved, true);
  assert.equal(pa.date, "2026-09-02");
  assert.equal(pb.date >= "2026-09-02", true);
  assert.equal(out.replanning.incremental.contraintes_dependances_preservees, 1);
}

// 5. Sans trigger ciblé, on retrouve volontairement le recalcul global et aucune allocation n'est gelée.
{
  const a = work("C1::A", ["R1"], { stability_forecast: { dates: ["2026-09-02"], resource_ids_compatibles: ["R1"] } });
  const out = planifierReplanningIncrementalV1({
    engineInput: input([a]),
    forecast: [forecast("C1::A", "2026-09-02", "R1")],
    trigger: null,
  });
  assert.equal(out.replanning.incremental.mode, "full_recalc");
  assert.equal(out.replanning.incremental.allocations_preservees, 0);
}

// 6. Même entrée + même trigger => résultat strictement déterministe.
{
  const a = work("C1::A", ["R1"], { stability_forecast: { dates: ["2026-09-01"], resource_ids_compatibles: ["R1"] } });
  const b = work("C2::B", ["R2"], { stability_forecast: { dates: ["2026-09-01"], resource_ids_compatibles: ["R2"] } });
  const args = {
    engineInput: input([a, b], {
      evenementsRessources: [{ id: "ABS", resource_id: "R1", type: "absence", date_debut: "2026-09-01", date_fin: "2026-09-01", toute_journee: true, actif: true, source: "manuel" }],
    }),
    forecast: [forecast("C1::A", "2026-09-01", "R1"), forecast("C2::B", "2026-09-01", "R2")],
    trigger: { type: "resource_unavailable", resource_id: "R1", date_debut: "2026-09-01" },
  };
  assert.deepEqual(planifierReplanningIncrementalV1(args), planifierReplanningIncrementalV1(args));
}

console.log("OK — planning replanning incremental V1: 6 scénarios");
