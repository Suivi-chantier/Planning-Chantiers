import assert from "node:assert/strict";
import { capaciteBasePlanningPourDate } from "../src/Renovation/planningResourceCapacityV1.js";
import {
  diagnostiquerRetardsCapaciteResiduelleV1,
  planifierReplanningPropositionV1,
} from "../src/Renovation/planningReplanningEngineV1.js";

const START = "2026-08-31";
const cap = capaciteBasePlanningPourDate(START);
assert.equal(cap > 0, true, "la date fixture doit être planifiable");

const resources = [
  { id:"R1", nom:"R1", nom_planning:"R1", kind:"personne", actif:true, capacite_facteur:1 },
  { id:"R2", nom:"R2", nom_planning:"R2", kind:"personne", actif:true, capacite_facteur:1 },
];
const work = {
  id:"C1::T1", chantier_id:"C1", tache_id:"T1", site_id:"S1", groupe_type_id:"gt_test",
  texte:"T1", heures_mo_restantes:2, crew_size:2,
  candidate_resource_ids:["R1","R2"], preferred_resource_ids:["R1","R2"],
  predecesseur_ids:[], priority:0, ordre_groupe:100, ordre_tache:1, fractionnable:true,
  stability_forecast:{ dates:[START], resource_ids_compatibles:["R1","R2"], preference_source:"forecast_tache" },
};
const decision = { travail_id:"C1::T1", date_ancrage:START, preference_appliquee:false, raison:"date_forecast_deja_atteinte" };
const baseInput = {
  travaux:[work], ressources:resources, evenementsRessources:[], contraintes:[], completedTaskIds:[],
  allocationsExistantes:[], startDate:START, horizonDays:4,
};

// 1. Les deux ressources sont totalement occupées le jour du forecast : la tâche
// part au prochain jour planifiable et le diagnostic confirme l'absence d'équipe complète.
{
  const input = {
    ...baseInput,
    allocationsExistantes:[
      { allocation_uid:"F1", chantier_id:"C1", site_id:"S1", date:START, duree:cap, resource_ids:["R1"], locked:true },
      { allocation_uid:"F2", chantier_id:"C1", site_id:"S1", date:START, duree:cap, resource_ids:["R2"], locked:true },
    ],
  };
  const out = planifierReplanningPropositionV1(input);
  const row = out.allocations_proposees.find(x => x.travail_id === "C1::T1");
  assert.equal(row?.date, "2026-09-01");
  const diag = out.replanning.diagnostics_capacite_residuelle.find(x => x.travail_id === "C1::T1");
  assert.equal(diag?.capacite_residuelle_confirme_retard, true);
  assert.deepEqual(diag?.jours_sans_equipe_complete, [START]);
  assert.equal(diag?.jours[0]?.ressources_disponibles, 0);
}

// 2. Contre-exemple : si la proposition synthétique laisse encore une équipe complète
// le jour d'ancrage, la capacité résiduelle ne doit PAS être utilisée comme explication.
{
  const proposition = {
    allocations_proposees:[{
      allocation_uid:"P1", travail_id:"C1::T1", chantier_id:"C1", tache_id:"T1", site_id:"S1",
      date:"2026-09-01", duree:1, resource_ids:["R1","R2"], heures_mo:2,
    }],
  };
  const out = diagnostiquerRetardsCapaciteResiduelleV1({
    engineInput:baseInput,
    proposition,
    decisionsDates:[decision],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].capacite_residuelle_confirme_retard, false);
  assert.equal(out[0].jours[0].statut, "equipe_complete_residuelle");
  assert.equal(out[0].jours[0].ressources_disponibles, 2);
}

console.log("OK — planning replanning capacity diagnostic V1: 2 scénarios");