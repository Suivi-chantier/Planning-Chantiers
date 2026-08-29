import assert from "node:assert/strict";
import { appliquerStabiliteForecastV1 } from "../src/Renovation/planningReplanningStabilityV1.js";

const cible = {
  id: "C1::T1", chantier_id: "C1", tache_id: "T1", site_id: "OP1",
  candidate_resource_ids: ["R1", "R2"], preferred_resource_ids: ["R1"],
  heures_mo_restantes: 8, crew_size: 1,
};

const forecastFrereSansTravailActif = [{
  chantier_id: "C2", tache_id: "T-TERMINEE-OU-HORS-MOTEUR", date: "2026-09-01",
  resource_ids: ["R2"], allocation_uid: "A-C2",
}];

// 1. Le référentiel operation_id suffit : C2 n'a pas besoin d'avoir un travail actif.
{
  const out = appliquerStabiliteForecastV1({
    travaux: [cible],
    allocationsForecast: forecastFrereSansTravailActif,
    sitesParChantier: new Map([["C1", "OP1"], ["C2", "OP1"]]),
  });
  assert.deepEqual(out.travaux[0].preferred_resource_ids, ["R2"]);
  assert.equal(out.travaux[0].stability_forecast.preference_source, "forecast_site");
  assert.deepEqual(out.travaux[0].stability_forecast.site_chantier_ids, ["C2"]);
}

// 2. Sans regroupement d'opération, C2 reste un autre site et ne doit pas influencer C1.
{
  const out = appliquerStabiliteForecastV1({
    travaux: [cible],
    allocationsForecast: forecastFrereSansTravailActif,
    sitesParChantier: { C1: "C1", C2: "C2" },
  });
  assert.deepEqual(out.travaux[0].preferred_resource_ids, ["R1"]);
  assert.equal(out.travaux[0].stability_forecast, undefined);
}

// 3. Même avec le bon operation_id, une ressource hors pool n'entre jamais dans les candidats.
{
  const out = appliquerStabiliteForecastV1({
    travaux: [{ ...cible, candidate_resource_ids: ["R1"], preferred_resource_ids: ["R1"] }],
    allocationsForecast: forecastFrereSansTravailActif,
    sitesParChantier: { C1: "OP1", C2: "OP1" },
  });
  assert.deepEqual(out.travaux[0].candidate_resource_ids, ["R1"]);
  assert.deepEqual(out.travaux[0].preferred_resource_ids, ["R1"]);
  assert.equal(out.travaux[0].stability_forecast.preference_source, "groupe_metier");
  assert.deepEqual(out.travaux[0].stability_forecast.site_resource_ids_compatibles, []);
}

console.log("OK — planning replanning site resolution V1: 3 scénarios");
