import assert from "node:assert/strict";
import { appliquerStabiliteDatesForecastV1 } from "../src/Renovation/planningReplanningDateStabilityV1.js";
import { planifierReplanningPropositionV1 } from "../src/Renovation/planningReplanningEngineV1.js";

const travail = (extra = {}) => ({
  id: "C1::T1", chantier_id: "C1", tache_id: "T1", site_id: "OP1",
  groupe_type_id: "GT1", texte: "T1", heures_mo_restantes: 4,
  crew_size: 1, candidate_resource_ids: ["R1"], preferred_resource_ids: ["R1"],
  predecesseur_ids: [], priority: 0, ordre_groupe: 10, ordre_tache: 0, fractionnable: true,
  provenance: { etat_reel: { en_retard: false } },
  stability_forecast: { dates: ["2026-09-01"], resource_ids_compatibles: ["R1"] },
  ...extra,
});

// 1. Forecast futur compatible => NOT_BEFORE éphémère.
{
  const out = appliquerStabiliteDatesForecastV1({ travaux: [travail()], contraintes: [], startDate: "2026-08-31" });
  assert.equal(out.contraintes_ephemeres.length, 1);
  assert.equal(out.contraintes_ephemeres[0].type, "not_before");
  assert.equal(out.contraintes_ephemeres[0].date_debut, "2026-09-01");
  assert.equal(out.contraintes_ephemeres[0].config.ephemeral, true);
  assert.equal(out.decisions[0].raison, "forecast_compatible_conserve");
}

// 2. Une tâche réellement en retard casse la préférence : elle peut être avancée.
{
  const out = appliquerStabiliteDatesForecastV1({
    travaux: [travail({ provenance: { etat_reel: { en_retard: true } } })],
    contraintes: [], startDate: "2026-08-31",
  });
  assert.equal(out.contraintes_ephemeres.length, 0);
  assert.equal(out.decisions[0].raison, "retard_reel_prioritaire");
}

// 3. Une priorité métier explicite positive casse la préférence de stabilité.
{
  const out = appliquerStabiliteDatesForecastV1({
    travaux: [travail({ priority: 10 })], contraintes: [], startDate: "2026-08-31",
  });
  assert.equal(out.contraintes_ephemeres.length, 0);
  assert.equal(out.decisions[0].raison, "priorite_travail_explicitement_positive");
}

// 4. Une contrainte PRIORITY positive casse également la préférence.
{
  const out = appliquerStabiliteDatesForecastV1({
    travaux: [travail()],
    contraintes: [{ id: "P1", type: "priority", scope: "tache", chantier_id: "C1", tache_id: "T1", priority: 5, hard: false, actif: true }],
    startDate: "2026-08-31",
  });
  assert.equal(out.contraintes_ephemeres.length, 0);
  assert.equal(out.decisions[0].raison, "priorite_contrainte_explicitement_positive");
}

// 5. Une deadline avant la date forecast autorise l'avance.
{
  const out = appliquerStabiliteDatesForecastV1({
    travaux: [travail()],
    contraintes: [{ id: "D1", type: "deadline", scope: "tache", chantier_id: "C1", tache_id: "T1", date_fin: "2026-08-31", hard: true, actif: true }],
    startDate: "2026-08-31",
  });
  assert.equal(out.contraintes_ephemeres.length, 0);
  assert.equal(out.decisions[0].raison, "deadline_avant_forecast");
}

// 6. Une date fixe explicite antérieure au forecast prime sur l'ancienne intention.
{
  const out = appliquerStabiliteDatesForecastV1({
    travaux: [travail()],
    contraintes: [{ id: "F1", type: "fixed_date", scope: "tache", chantier_id: "C1", tache_id: "T1", date_debut: "2026-08-31", hard: true, actif: true }],
    startDate: "2026-08-31",
  });
  assert.equal(out.contraintes_ephemeres.length, 0);
  assert.equal(out.decisions[0].raison, "date_fixe_explicitement_avant_forecast");
}

const resource = { id: "R1", nom: "R1", nom_planning: "R1", kind: "personne", actif: true, capacite_facteur: 1 };
const engineInput = overrides => ({
  travaux: [travail()],
  ressources: [resource],
  evenementsRessources: [],
  contraintes: [],
  allocationsExistantes: [],
  completedTaskIds: [],
  startDate: "2026-08-31",
  horizonDays: 4,
  ...overrides,
});

// 7. Intégration : capacité libre le lundi, mais forecast mardi => on conserve mardi.
{
  const out = planifierReplanningPropositionV1(engineInput());
  assert.equal(out.allocations_proposees[0].date, "2026-09-01");
  assert.equal(out.allocations_proposees[0].explication.stabilite_forecast.date_conservee, true);
  assert.equal(out.replanning.stabilite_dates.dates_forecast_conservees, 1);
}

// 8. Si R1 est absent le mardi, la tâche glisse au mercredi : la stabilité n'est pas un verrou impossible.
{
  const out = planifierReplanningPropositionV1(engineInput({
    evenementsRessources: [{
      id: "ABS1", resource_id: "R1", type: "absence",
      date_debut: "2026-09-01", date_fin: "2026-09-01",
      toute_journee: true, heures_indisponibles: null, actif: true, source: "manuel",
    }],
  }));
  assert.equal(out.allocations_proposees[0].date, "2026-09-02");
  assert.equal(out.allocations_proposees[0].explication.stabilite_forecast.date_conservee, false);
}

// 9. Si le réel indique du retard, le moteur récupère immédiatement la capacité du lundi.
{
  const urgent = travail({ provenance: { etat_reel: { en_retard: true } } });
  const out = planifierReplanningPropositionV1(engineInput({ travaux: [urgent] }));
  assert.equal(out.allocations_proposees[0].date, "2026-08-31");
}

// 10. Déterminisme strict.
{
  const input = engineInput();
  assert.deepEqual(planifierReplanningPropositionV1(input), planifierReplanningPropositionV1(input));
}

console.log("OK — planning replanning date stability V1: 10 scénarios");
