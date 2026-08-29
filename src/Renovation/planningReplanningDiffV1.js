// ─── CHANTIER 05 — DIFF EXPLICABLE DE REPLANIFICATION V1 ────────────────────
// Module PUR : aucune lecture/écriture Supabase.
//
// Le diff du chantier 04 reste la source pour détecter les différences métier.
// Cette couche ajoute des raisons démontrables à partir de l'état réel, des
// préférences de stabilité et des traces du moteur. Si une cause ne peut pas
// être prouvée avec les données disponibles, elle reste explicitement à vérifier.

import { diffForecastPropositionV1 } from "./planningEngineDiffV1.js";

export const PLANNING_REPLANNING_DIFF_VERSION = 1;

const txt = v => String(v ?? "").trim();
const uniq = xs => [...new Set((Array.isArray(xs) ? xs : []).map(txt).filter(Boolean))];

function indexTravaux(travaux = []) {
  return new Map((Array.isArray(travaux) ? travaux : [])
    .filter(t => txt(t?.id))
    .map(t => [txt(t.id), t]));
}

function indexAllocationsProposees(allocations = []) {
  const map = new Map();
  for (const a of Array.isArray(allocations) ? allocations : []) {
    const id = txt(a?.travail_id);
    if (!id) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(a);
  }
  return map;
}

function indexNonPlanifies(nonPlanifies = []) {
  return new Map((Array.isArray(nonPlanifies) ? nonPlanifies : [])
    .filter(x => txt(x?.travail_id))
    .map(x => [txt(x.travail_id), x]));
}

function indexDecisionsDates(proposition = {}) {
  return new Map((proposition?.replanning?.decisions_stabilite_dates || [])
    .filter(d => txt(d?.travail_id))
    .map(d => [txt(d.travail_id), d]));
}

function raison(code, label, details = null, niveau = "info") {
  return { code, label, details, niveau };
}

function raisonsPourChangement({ changement, travail, proposedRows, nonPlanifie, decisionDate }) {
  const raisons = [];
  const etat = travail?.provenance?.etat_reel || null;
  const stability = travail?.stability_forecast || null;

  if (changement.statut === "inchangé") {
    raisons.push(raison(
      "forecast_compatible_conserve",
      "Le forecast actuel reste compatible avec le réel et a été conservé.",
      stability?.preference_source ? { preference_source: stability.preference_source } : null
    ));
    return raisons;
  }

  if (changement.statut === "nouveau") {
    if (etat?.en_retard) {
      raisons.push(raison(
        "tache_en_retard_reinjectee",
        "Tâche non terminée et déjà en retard : son reste à faire réintègre le planning futur.",
        { avancement: etat.avancement, reste_a_faire_heures: etat.reste_a_faire_heures, ancienne_date_prevue: etat.date_prevue },
        "important"
      ));
    } else {
      raisons.push(raison(
        "tache_sans_planification_courante",
        "La tâche possède un reste à faire mais aucune planification actuelle dans l'horizon.",
        etat ? { avancement: etat.avancement, reste_a_faire_heures: etat.reste_a_faire_heures } : null
      ));
    }
  }

  if (changement.details.includes("heures_mo") && etat) {
    raisons.push(raison(
      "reste_a_faire_recalcule_depuis_phasage",
      "La charge proposée est recalculée depuis l'avancement réel du phasage.",
      { avancement: etat.avancement, reste_a_faire_heures: etat.reste_a_faire_heures, source_verite: etat.source_verite || "phasage" }
    ));
  }

  if (changement.details.includes("ressources")) {
    const horsPool = uniq(stability?.resource_ids_hors_pool || []);
    if (horsPool.length) {
      raisons.push(raison(
        "ancienne_ressource_hors_pool_metier",
        "Une ancienne affectation n'appartient plus au pool métier HARD de la tâche et ne peut pas être conservée.",
        { resource_ids: horsPool },
        "important"
      ));
    }

    if (stability?.preference_source === "forecast_site") {
      const siteCompatibles = uniq(stability?.site_resource_ids_compatibles || []);
      const proposedResources = uniq(proposedRows.flatMap(a => a?.resource_ids || []));
      const retenues = proposedResources.filter(id => siteCompatibles.includes(id));
      if (retenues.length) {
        raisons.push(raison(
          "continuite_operation",
          "La proposition favorise une ressource déjà prévue sur la même opération, sans élargir le pool métier.",
          { site_id: stability.site_id || travail?.site_id || null, resource_ids: retenues }
        ));
      }
    }

    if (stability?.preference_source === "forecast_tache" && stability?.resource_ids_compatibles?.length) {
      const prev = uniq(stability.resource_ids_compatibles);
      const proposedResources = uniq(proposedRows.flatMap(a => a?.resource_ids || []));
      if (!prev.every(id => proposedResources.includes(id))) {
        raisons.push(raison(
          "affectation_forecast_non_conservable",
          "L'affectation actuelle était une préférence, mais elle n'a pas pu être conservée dans la proposition.",
          { resource_ids_preferes: prev, resource_ids_proposes: proposedResources },
          "attention"
        ));
      }
    }
  }

  const avance = (changement.impact?.decalage_debut_jours ?? 0) < 0;
  const retarde = (changement.impact?.decalage_debut_jours ?? 0) > 0;
  if (avance) {
    if (etat?.en_retard) {
      raisons.push(raison(
        "retard_reel_a_rattraper",
        "Le réel indique une tâche en retard : la stabilité de l'ancienne date est levée pour utiliser une capacité plus tôt.",
        { ancienne_date_prevue: etat.date_prevue },
        "important"
      ));
    }
    const dateReason = txt(decisionDate?.raison);
    if (dateReason === "priorite_travail_explicitement_positive" || dateReason === "priorite_contrainte_explicitement_positive") {
      raisons.push(raison("priorite_explicitement_superieure", "Une priorité métier explicite autorise l'avancement par rapport au forecast.", null, "important"));
    } else if (dateReason === "deadline_avant_forecast") {
      raisons.push(raison("deadline_avant_forecast", "La deadline explicite est antérieure à la date du forecast et autorise l'avancement.", { deadline: decisionDate?.deadline || null }, "important"));
    } else if (dateReason === "date_fixe_explicitement_avant_forecast") {
      raisons.push(raison("date_fixe_avant_forecast", "Une date fixe explicite prime sur l'ancienne date du forecast.", { constraint_id: decisionDate?.constraint_id || null }, "important"));
    }
  }

  if (retarde && decisionDate?.preference_appliquee && decisionDate?.date_ancrage) {
    raisons.push(raison(
      "date_forecast_devenue_incompatible",
      "La date du forecast a été conservée comme minimum, mais la tâche n'a pas pu être exécutée à cette date et a été repoussée.",
      { date_ancrage: decisionDate.date_ancrage },
      "attention"
    ));
  }

  if (changement.statut === "non_replanifié" && nonPlanifie) {
    raisons.push(raison(
      "non_planifiable_dans_horizon",
      nonPlanifie.raison || "La tâche ne peut pas être planifiée dans l'horizon courant.",
      { heures_mo_restantes: nonPlanifie.heures_mo_restantes, tentatives: nonPlanifie.tentatives || null },
      "important"
    ));
  }

  return raisons;
}

export function diffReplanningV1({ forecast = [], proposition = {}, travaux = [] } = {}) {
  const allocations = proposition?.allocations_proposees || [];
  const nonPlanifies = proposition?.non_planifies || [];
  const base = diffForecastPropositionV1({ forecast, proposition: allocations, nonPlanifies });
  const travauxParId = indexTravaux(travaux);
  const allocationsParTravail = indexAllocationsProposees(allocations);
  const nonPlanifiesParTravail = indexNonPlanifies(nonPlanifies);
  const decisionsDates = indexDecisionsDates(proposition);

  const changements = base.changements.map(changement => {
    const travail = travauxParId.get(changement.travail_id) || null;
    const proposedRows = allocationsParTravail.get(changement.travail_id) || [];
    const nonPlanifie = nonPlanifiesParTravail.get(changement.travail_id) || null;
    const decisionDate = decisionsDates.get(changement.travail_id) || null;
    const raisons = raisonsPourChangement({ changement, travail, proposedRows, nonPlanifie, decisionDate });
    const modifie = changement.statut !== "inchangé";
    const explique = !modifie || raisons.length > 0;
    return {
      ...changement,
      raisons,
      qualite_explication: explique ? "explique" : "a_verifier",
      changement_a_verifier: modifie && !explique,
    };
  });

  const idsAVerifier = changements.filter(c => c.changement_a_verifier).map(c => c.travail_id);
  const raisonCounts = new Map();
  changements.forEach(c => c.raisons.forEach(r => raisonCounts.set(r.code, (raisonCounts.get(r.code) || 0) + 1)));

  return {
    ...base,
    changements,
    resume: {
      ...base.resume,
      changements_expliques: changements.filter(c => c.statut !== "inchangé" && c.qualite_explication === "explique").length,
      changements_a_verifier: idsAVerifier.length,
    },
    raisons_resume: [...raisonCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    travaux_a_verifier: idsAVerifier,
    explication: {
      ...base.explication,
      principe_replanning: "Une raison n'est affichée que si elle est démontrable depuis le phasage, le pool métier, les préférences de stabilité ou la trace du moteur. Sinon le changement reste à vérifier.",
    },
    invariants: {
      aucune_invention_de_cause: true,
      phasage_source_du_reste_a_faire: true,
      forecast_est_une_preference_pas_une_verite: true,
    },
  };
}
