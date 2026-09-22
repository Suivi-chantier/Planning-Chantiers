import assert from "node:assert/strict";
import { planifierPropositionV1 } from "../src/Renovation/planningEngineV1.js";
import { planifierReplanningPropositionV1 } from "../src/Renovation/planningReplanningEngineV1.js";

const resource = id => ({ id, nom: id, nom_planning: id, kind: "personne", actif: true, capacite_facteur: 1 });
const work = (extra = {}) => ({
  id: "C1::T1", chantier_id: "C1", tache_id: "T1", site_id: "OP1",
  groupe_type_id: "GT1", texte: "T1", heures_mo_restantes: 4, crew_size: 1,
  candidate_resource_ids: ["R1", "R2"], preferred_resource_ids: ["R2"],
  predecesseur_ids: [], priority: 0, ordre_groupe: 10, ordre_tache: 0, fractionnable: true,
  provenance: { etat_reel: { en_retard: false } },
  ...extra,
});
const allocationExistante = (date, rid = "R1", extra = {}) => ({
  allocation_uid: `EX-${date}-${rid}`, chantier_id: "C0", tache_id: "OLD",
  site_id: "OP1", date, duree: 4, resource_ids: [rid], locked: true, ...extra,
});
const base = extra => ({
  travaux: [work()],
  ressources: [resource("R1"), resource("R2")],
  evenementsRessources: [], contraintes: [], allocationsExistantes: [], completedTaskIds: [],
  startDate: "2026-09-02", horizonDays: 2,
  ...extra,
});

// 1. Chantier 04 inchangé : option absente => la préférence statique R2 reste prioritaire.
{
  const out = planifierPropositionV1(base({ allocationsExistantes: [allocationExistante("2026-09-01", "R1")] }));
  assert.deepEqual(out.allocations_proposees[0].resource_ids, ["R2"]);
  assert.equal(out.input.continuite_multi_jours, false);
}

// 2. Chantier 05 : à ressources éligibles, rester sur le site du jour ouvré précédent prime sur la préférence statique.
{
  const out = planifierPropositionV1(base({
    allocationsExistantes: [allocationExistante("2026-09-01", "R1")],
    continuiteMultiJours: true,
  }));
  assert.deepEqual(out.allocations_proposees[0].resource_ids, ["R1"]);
  assert.deepEqual(out.allocations_proposees[0].explication.continuite_site_jour_precedent, ["R1"]);
  assert.equal(out.allocations_proposees[0].explication.jour_planifiable_precedent, "2026-09-01");
}

// 3. Une affectation explicite déjà communiquée sur cette tâche reste plus forte que la continuité de site générale.
{
  const t = work({
    preferred_resource_ids: ["R2"],
    stability_forecast: { preference_source: "forecast_tache", resource_ids_compatibles: ["R2"], dates: ["2026-09-02"] },
  });
  const out = planifierPropositionV1(base({
    travaux: [t], allocationsExistantes: [allocationExistante("2026-09-01", "R1")], continuiteMultiJours: true,
  }));
  assert.deepEqual(out.allocations_proposees[0].resource_ids, ["R2"]);
}

// 4. La continuité est SOFT : si R1 est absent, R2 prend la relève.
{
  const out = planifierPropositionV1(base({
    allocationsExistantes: [allocationExistante("2026-09-01", "R1")],
    evenementsRessources: [{
      id: "ABS-R1", resource_id: "R1", type: "absence",
      date_debut: "2026-09-02", date_fin: "2026-09-02", toute_journee: true,
      heures_indisponibles: null, capacite_heures: null, actif: true, source: "test", details: {},
    }],
    continuiteMultiJours: true,
  }));
  assert.deepEqual(out.allocations_proposees[0].resource_ids, ["R2"]);
}

// 5. Vendredi → lundi : le week-end est ignoré via rythmeSemaine, pas via une fenêtre arbitraire.
{
  const out = planifierPropositionV1({
    ...base(),
    startDate: "2026-09-07",
    allocationsExistantes: [allocationExistante("2026-09-04", "R1")],
    continuiteMultiJours: true,
  });
  assert.deepEqual(out.allocations_proposees[0].resource_ids, ["R1"]);
  assert.equal(out.allocations_proposees[0].explication.jour_planifiable_precedent, "2026-09-04");
}

// 6. Le pool métier reste HARD : R1 ne peut pas être récupéré s'il n'est plus candidat.
{
  const out = planifierPropositionV1(base({
    travaux: [work({ candidate_resource_ids: ["R2"], preferred_resource_ids: ["R2"] })],
    allocationsExistantes: [allocationExistante("2026-09-01", "R1")],
    continuiteMultiJours: true,
  }));
  assert.deepEqual(out.allocations_proposees[0].resource_ids, ["R2"]);
}

// 7. Le wrapper chantier 05 active bien automatiquement cette préférence.
{
  const out = planifierReplanningPropositionV1(base({ allocationsExistantes: [allocationExistante("2026-09-01", "R1")] }));
  assert.deepEqual(out.allocations_proposees[0].resource_ids, ["R1"]);
  assert.equal(out.replanning.continuite_multi_jours.active, true);
}

// 8. Déterminisme strict.
{
  const input = base({ allocationsExistantes: [allocationExistante("2026-09-01", "R1")] });
  assert.deepEqual(planifierReplanningPropositionV1(input), planifierReplanningPropositionV1(input));
}

console.log("OK — planning replanning multi-day continuity V1: 8 scénarios");
