import assert from "node:assert/strict";
import { appliquerStabiliteForecastV1 } from "../src/Renovation/planningReplanningStabilityV1.js";
import { preparerSimulationReplanningV1 } from "../src/Renovation/planningReplanningAdapterV1.js";
import { planifierPropositionV1 } from "../src/Renovation/planningEngineV1.js";

const travail = (extra = {}) => ({
  id: "C1::T1", chantier_id: "C1", tache_id: "T1", site_id: "OP1",
  candidate_resource_ids: ["R1", "R2"], preferred_resource_ids: ["R1"],
  heures_mo_restantes: 8, crew_size: 1, ordre_groupe: 10, ordre_tache: 0,
  ...extra,
});

// 1. Sans forecast sur le site, aucune préférence existante n'est modifiée.
{
  const input = [travail()];
  const out = appliquerStabiliteForecastV1({ travaux: input, allocationsForecast: [] });
  assert.deepEqual(out.travaux[0].preferred_resource_ids, ["R1"]);
  assert.equal(out.audit.travaux_avec_forecast, 0);
  assert.equal(out.audit.travaux_avec_affinite_site, 0);
}

// 2. Une ressource forecast encore dans le pool devient la préférence SOFT de la tâche.
{
  const out = appliquerStabiliteForecastV1({
    travaux: [travail()],
    allocationsForecast: [{ chantier_id: "C1", tache_id: "T1", date: "2026-08-31", resource_ids: ["R2"], allocation_uid: "A1" }],
  });
  assert.deepEqual(out.travaux[0].candidate_resource_ids, ["R1", "R2"]);
  assert.deepEqual(out.travaux[0].preferred_resource_ids, ["R2"]);
  assert.equal(out.travaux[0].stability_forecast.preference_source, "forecast_tache");
  assert.equal(out.travaux[0].stability_forecast.contrainte_hard, false);
}

// 3. Une ancienne ressource de la tâche hors pool n'est jamais réintroduite.
{
  const out = appliquerStabiliteForecastV1({
    travaux: [travail()],
    allocationsForecast: [{ chantier_id: "C1", tache_id: "T1", date: "2026-08-31", resource_ids: ["R3"], allocation_uid: "A1" }],
  });
  assert.deepEqual(out.travaux[0].candidate_resource_ids, ["R1", "R2"]);
  assert.deepEqual(out.travaux[0].preferred_resource_ids, ["R1"]);
  assert.deepEqual(out.travaux[0].stability_forecast.resource_ids_hors_pool, ["R3"]);
}

// 4. Plusieurs allocations du même travail sont consolidées de manière déterministe.
{
  const out = appliquerStabiliteForecastV1({
    travaux: [travail()],
    allocationsForecast: [
      { chantier_id: "C1", tache_id: "T1", date: "2026-09-01", resource_ids: ["R2"], allocation_uid: "A2" },
      { chantier_id: "C1", tache_id: "T1", date: "2026-08-31", resource_ids: ["R2", "R1"], allocation_uid: "A1" },
    ],
  });
  assert.deepEqual(out.travaux[0].stability_forecast.dates, ["2026-08-31", "2026-09-01"]);
  assert.deepEqual(out.travaux[0].stability_forecast.allocation_uids, ["A1", "A2"]);
  assert.deepEqual(out.travaux[0].preferred_resource_ids, ["R1", "R2"]);
}

// 5. Sans forecast propre à la tâche, une ressource déjà annoncée sur la même opération devient préférence SOFT.
{
  const cible = travail({ id: "C1::T1", chantier_id: "C1", tache_id: "T1", site_id: "OP1" });
  const autreLogement = travail({ id: "C2::T2", chantier_id: "C2", tache_id: "T2", site_id: "OP1" });
  const out = appliquerStabiliteForecastV1({
    travaux: [cible, autreLogement],
    allocationsForecast: [{ chantier_id: "C2", tache_id: "T2", date: "2026-08-31", resource_ids: ["R2"], allocation_uid: "A-C2" }],
  });
  const t = out.travaux.find(x => x.id === "C1::T1");
  assert.deepEqual(t.candidate_resource_ids, ["R1", "R2"]);
  assert.deepEqual(t.preferred_resource_ids, ["R2"]);
  assert.equal(t.stability_forecast.preference_source, "forecast_site");
  assert.deepEqual(t.stability_forecast.site_chantier_ids, ["C2"]);
}

// 6. L'affinité de site ne traverse jamais le pool métier courant.
{
  const cible = travail({
    id: "C1::T1", chantier_id: "C1", tache_id: "T1", site_id: "OP1",
    candidate_resource_ids: ["R1"], preferred_resource_ids: ["R1"],
  });
  const autreMetier = travail({ id: "C2::T2", chantier_id: "C2", tache_id: "T2", site_id: "OP1" });
  const out = appliquerStabiliteForecastV1({
    travaux: [cible, autreMetier],
    allocationsForecast: [{ chantier_id: "C2", tache_id: "T2", date: "2026-08-31", resource_ids: ["R2"], allocation_uid: "A-C2" }],
  });
  const t = out.travaux.find(x => x.id === "C1::T1");
  assert.deepEqual(t.candidate_resource_ids, ["R1"]);
  assert.deepEqual(t.preferred_resource_ids, ["R1"]);
  assert.deepEqual(t.stability_forecast.site_resource_ids_compatibles, []);
  assert.equal(t.stability_forecast.preference_source, "groupe_metier");
}

// 7. Une affectation propre à la tâche prime toujours sur l'affinité générale du site.
{
  const cible = travail({ id: "C1::T1", chantier_id: "C1", tache_id: "T1", site_id: "OP1" });
  const autreLogement = travail({ id: "C2::T2", chantier_id: "C2", tache_id: "T2", site_id: "OP1" });
  const out = appliquerStabiliteForecastV1({
    travaux: [cible, autreLogement],
    allocationsForecast: [
      { chantier_id: "C1", tache_id: "T1", date: "2026-09-01", resource_ids: ["R1"], allocation_uid: "A-C1" },
      { chantier_id: "C2", tache_id: "T2", date: "2026-08-31", resource_ids: ["R2"], allocation_uid: "A-C2" },
    ],
  });
  const t = out.travaux.find(x => x.id === "C1::T1");
  assert.deepEqual(t.preferred_resource_ids, ["R1"]);
  assert.equal(t.stability_forecast.preference_source, "forecast_tache");
}

const res = id => ({ id, nom: id, nom_planning: id, kind: "personne", actif: true, capacite_facteur: 1 });
const task = () => ({
  id: "T1", nom: "T1", heures_vendues: 8, heures_estimees: 8, avancement: 0,
  chrono_groupe_id: "G1", chrono_ordre: 0, ouvriers: [],
});
const phasage = () => ({
  id: "PH1", chantier_id: "C1", ouvrages: [{ id: "O1", code_ouvrage: "E-001", taches: [task()] }],
  plan_travaux: { meta: { chrono_groupes: [{ id: "G1", ordre: 10, groupe_type_id: "GT1" }] } },
});
const base = cellules => ({
  phasages: [phasage()],
  chantiers: [{ id: "C1", nom: "C1", statut: "en_cours", operation_id: "OP1" }],
  cellules,
  ressources: [res("R1"), res("R2")],
  evenementsRessources: [], contraintes: [],
  groupesTypes: [{ id: "GT1", ordre: 10, equipe_id: "EQ1", ouvriers_prio: ["R1"] }],
  equipes: [{ id: "EQ1", nom: "EQ1", responsable: "R1", membres: [{ ouvrier: "R2", date_dispo: null }], externe: false }],
  startDate: "2026-08-31", horizonDays: 2,
});

// 8. Intégration : à compétences égales, le moteur conserve R2 si R2 était déjà communiqué sur la tâche.
{
  const cell = {
    id: "CELL1", week_id: "2026-W36", chantier_id: "C1", jour: "Lundi", ouvriers: ["R2"],
    taches: [{ allocation_uid: "A1", tache_id: "T1", text: "T1", duree: 8, ouvriers: ["R2"] }],
  };
  const prep = preparerSimulationReplanningV1(base([cell]));
  assert.deepEqual([...prep.engineInput.travaux[0].candidate_resource_ids].sort(), ["R1", "R2"]);
  assert.deepEqual(prep.engineInput.travaux[0].preferred_resource_ids, ["R2"]);
  const proposition = planifierPropositionV1(prep.engineInput);
  assert.deepEqual(proposition.allocations_proposees[0].resource_ids, ["R2"]);
}

// 9. Si l'ancienne ressource sort du pool métier, elle n'est pas utilisée malgré le forecast.
{
  const input = base([{
    id: "CELL1", week_id: "2026-W36", chantier_id: "C1", jour: "Lundi", ouvriers: ["R2"],
    taches: [{ allocation_uid: "A1", tache_id: "T1", text: "T1", duree: 8, ouvriers: ["R2"] }],
  }]);
  input.equipes = [{ id: "EQ1", nom: "EQ1", responsable: "R1", membres: [], externe: false }];
  const prep = preparerSimulationReplanningV1(input);
  assert.deepEqual(prep.engineInput.travaux[0].candidate_resource_ids, ["R1"]);
  assert.deepEqual(prep.engineInput.travaux[0].preferred_resource_ids, ["R1"]);
  assert.deepEqual(prep.engineInput.travaux[0].stability_forecast.resource_ids_hors_pool, ["R2"]);
  const proposition = planifierPropositionV1(prep.engineInput);
  assert.deepEqual(proposition.allocations_proposees[0].resource_ids, ["R1"]);
}

console.log("OK — planning replanning stability V1: 9 scénarios");
