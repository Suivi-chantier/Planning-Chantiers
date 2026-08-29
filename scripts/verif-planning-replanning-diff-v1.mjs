import assert from "node:assert/strict";
import { diffReplanningV1 } from "../src/Renovation/planningReplanningDiffV1.js";

const forecast = (extra = {}) => ({
  allocation_uid: "CUR-1", chantier_id: "C1", tache_id: "T1", date: "2026-09-01",
  duree: 4, resource_ids: ["R1"], ouvriers_noms: [], ...extra,
});
const proposed = (extra = {}) => ({
  allocation_uid: "PROP-1", travail_id: "C1::T1", chantier_id: "C1", tache_id: "T1",
  date: "2026-09-01", duree: 4, resource_ids: ["R1"], heures_mo: 4, texte: "T1",
  explication: {}, ...extra,
});
const travail = (extra = {}) => ({
  id: "C1::T1", chantier_id: "C1", tache_id: "T1", site_id: "OP1",
  candidate_resource_ids: ["R1", "R2"], preferred_resource_ids: ["R1"],
  provenance: { etat_reel: { avancement: 50, reste_a_faire_heures: 4, source_verite: "phasage", en_retard: false, date_prevue: null } },
  ...extra,
});

const codes = c => c.raisons.map(r => r.code);

// 1. Forecast strictement compatible : le diff explique qu'il a été conservé.
{
  const out = diffReplanningV1({
    forecast: [forecast()],
    proposition: { allocations_proposees: [proposed()], non_planifies: [], replanning: { decisions_stabilite_dates: [] } },
    travaux: [travail()],
  });
  assert.equal(out.changements[0].statut, "inchangé");
  assert.deepEqual(codes(out.changements[0]), ["forecast_compatible_conserve"]);
  assert.equal(out.changements[0].qualite_explication, "explique");
}

// 2. Tâche sans forecast courant et réellement en retard : réinjection explicite.
{
  const out = diffReplanningV1({
    forecast: [],
    proposition: { allocations_proposees: [proposed()], non_planifies: [], replanning: { decisions_stabilite_dates: [] } },
    travaux: [travail({ provenance: { etat_reel: { avancement: 60, reste_a_faire_heures: 4, source_verite: "phasage", en_retard: true, date_prevue: "2026-08-30" } } })],
  });
  assert.equal(out.changements[0].statut, "nouveau");
  assert.equal(codes(out.changements[0]).includes("tache_en_retard_reinjectee"), true);
}

// 3. Une ancienne ressource sortie du pool explique le restaffing.
{
  const out = diffReplanningV1({
    forecast: [forecast({ resource_ids: ["R2"] })],
    proposition: { allocations_proposees: [proposed({ resource_ids: ["R1"] })], non_planifies: [], replanning: { decisions_stabilite_dates: [] } },
    travaux: [travail({
      candidate_resource_ids: ["R1"], preferred_resource_ids: ["R1"],
      stability_forecast: { preference_source: "groupe_metier", resource_ids_hors_pool: ["R2"], resource_ids_compatibles: [] },
    })],
  });
  assert.equal(out.changements[0].details.includes("ressources"), true);
  assert.equal(codes(out.changements[0]).includes("ancienne_ressource_hors_pool_metier"), true);
}

// 4. Une ressource retenue pour continuité d'opération est visible dans l'explication.
{
  const out = diffReplanningV1({
    forecast: [forecast({ resource_ids: ["R1"] })],
    proposition: { allocations_proposees: [proposed({ resource_ids: ["R2"] })], non_planifies: [], replanning: { decisions_stabilite_dates: [] } },
    travaux: [travail({
      stability_forecast: {
        preference_source: "forecast_site", site_id: "OP1",
        site_resource_ids_compatibles: ["R2"], resource_ids_hors_pool: [], resource_ids_compatibles: [],
      },
    })],
  });
  assert.equal(codes(out.changements[0]).includes("continuite_operation"), true);
}

// 5. Une date avancée à cause d'une deadline explicite porte cette raison.
{
  const out = diffReplanningV1({
    forecast: [forecast({ date: "2026-09-02" })],
    proposition: {
      allocations_proposees: [proposed({ date: "2026-09-01" })], non_planifies: [],
      replanning: { decisions_stabilite_dates: [{ travail_id: "C1::T1", raison: "deadline_avant_forecast", deadline: "2026-09-01", preference_appliquee: false, date_ancrage: "2026-09-02" }] },
    },
    travaux: [travail()],
  });
  assert.equal(codes(out.changements[0]).includes("deadline_avant_forecast"), true);
}

// 6. Une tâche non replanifiable reprend la raison exacte fournie par le moteur.
{
  const out = diffReplanningV1({
    forecast: [forecast()],
    proposition: {
      allocations_proposees: [],
      non_planifies: [{ travail_id: "C1::T1", chantier_id: "C1", tache_id: "T1", heures_mo_restantes: 4, raison: "Prédécesseur(s) non terminé(s) dans l'horizon", tentatives: { dates_bloquees: 0, dates_sans_equipe: 0 } }],
      replanning: { decisions_stabilite_dates: [] },
    },
    travaux: [travail()],
  });
  assert.equal(out.changements[0].statut, "non_replanifié");
  assert.equal(codes(out.changements[0]).includes("non_planifiable_dans_horizon"), true);
  assert.equal(out.changements[0].raisons.find(r => r.code === "non_planifiable_dans_horizon").label.includes("Prédécesseur"), true);
}

// 7. Un changement dont la cause n'est pas démontrable reste à vérifier au lieu d'être inventé.
{
  const out = diffReplanningV1({
    forecast: [forecast({ date: "2026-09-01" })],
    proposition: { allocations_proposees: [proposed({ date: "2026-09-02" })], non_planifies: [], replanning: { decisions_stabilite_dates: [] } },
    travaux: [{ id: "C1::T1", chantier_id: "C1", tache_id: "T1" }],
  });
  assert.equal(out.changements[0].statut, "modifié");
  assert.deepEqual(out.changements[0].raisons, []);
  assert.equal(out.changements[0].qualite_explication, "a_verifier");
  assert.equal(out.resume.changements_a_verifier, 1);
  assert.deepEqual(out.travaux_a_verifier, ["C1::T1"]);
}

// 8. Un forecast retiré parce que la tâche est incomplète mais sans charge de référence porte cette cause exacte.
{
  const out = diffReplanningV1({
    forecast: [forecast()],
    proposition: {
      allocations_proposees: [], non_planifies: [],
      replanning: {
        decisions_stabilite_dates: [],
        exclusions_connues: [{ travail_id: "C1::T1", chantier_id: "C1", tache_id: "T1", type: "charge_reference_manquante", avancement: 60, source_verite: "phasage", forecast_existant: true }],
      },
    },
    travaux: [],
  });
  assert.equal(codes(out.changements[0]).includes("forecast_non_conservable_charge_manquante"), true);
  assert.equal(out.changements[0].changement_a_verifier, false);
}

// 9. Un forecast legacy sans groupe/pool fiable est expliqué, mais son ancienne équipe n'est pas promue en règle HARD.
{
  const out = diffReplanningV1({
    forecast: [forecast()],
    proposition: {
      allocations_proposees: [], non_planifies: [],
      replanning: {
        decisions_stabilite_dates: [],
        exclusions_connues: [{ travail_id: "C1::T1", chantier_id: "C1", tache_id: "T1", type: "contexte_affectation_insuffisant" }],
      },
    },
    travaux: [],
  });
  assert.equal(codes(out.changements[0]).includes("forecast_non_conservable_groupe_non_resolu"), true);
  assert.equal(out.changements[0].changement_a_verifier, false);
}

// 10. Un successeur bloqué par un prédécesseur connu et exclu n'est plus présenté comme un mystère.
{
  const out = diffReplanningV1({
    forecast: [forecast()],
    proposition: {
      allocations_proposees: [],
      non_planifies: [{
        travail_id: "C1::T1", chantier_id: "C1", tache_id: "T1", heures_mo_restantes: 4,
        raison: "Prédécesseur encore ouvert mais sans charge de référence quantifiable",
        raison_code: "predecesseur_charge_reference_manquante",
        blocages_predecesseurs_connus: [{ travail_id: "C1::T0", type: "charge_reference_manquante", avancement: 80 }],
      }],
      replanning: { decisions_stabilite_dates: [], exclusions_connues: [] },
    },
    travaux: [travail()],
  });
  assert.equal(codes(out.changements[0]).includes("attente_predecesseur_exclu"), true);
  assert.equal(codes(out.changements[0]).includes("non_planifiable_dans_horizon"), false);
}

// 11. Un retard n'est expliqué par la capacité que si le diagnostic borné confirme
// qu'aucun jour planifiable intermédiaire ne conserve une équipe complète.
{
  const out = diffReplanningV1({
    forecast: [forecast({ date: "2026-09-01", resource_ids:["R1","R2"], duree:1 })],
    proposition: {
      allocations_proposees: [proposed({ date:"2026-09-03", resource_ids:["R1","R2"], duree:1, heures_mo:2 })],
      non_planifies: [],
      replanning: {
        decisions_stabilite_dates: [{ travail_id:"C1::T1", date_ancrage:"2026-09-01", raison:"date_forecast_deja_atteinte", preference_appliquee:false }],
        diagnostics_capacite_residuelle: [{
          travail_id:"C1::T1", date_ancrage:"2026-09-01", date_proposee:"2026-09-03", crew_size:2,
          candidate_resource_ids:["R1","R2"], jours_sans_equipe_complete:["2026-09-01","2026-09-02"],
          capacite_residuelle_confirme_retard:true, raison_stabilite_date:"date_forecast_deja_atteinte",
        }],
      },
    },
    travaux: [travail({ candidate_resource_ids:["R1","R2"], preferred_resource_ids:["R1","R2"] })],
  });
  assert.equal(codes(out.changements[0]).includes("capacite_equipe_saturee_avant_date_proposee"), true);
  assert.equal(out.changements[0].changement_a_verifier, false);
}

console.log("OK — planning replanning diff V1: 11 scénarios");