// ─── CHANTIER 05 — MOTEUR DE REPLANIFICATION CONTINUE V1 ────────────────────
// Module PUR : aucune lecture/écriture Supabase.
//
// Il ne remplace pas le moteur du chantier 04. Il prépare seulement les
// préférences de stabilité propres au chantier 05, puis délègue l'ordonnancement
// à planifierPropositionV1. La continuité multi-jours est activée ici uniquement :
// le moteur V1 direct conserve son comportement chantier 04 par défaut.

import { planifierPropositionV1 } from "./planningEngineV1.js";
import { appliquerStabiliteDatesForecastV1 } from "./planningReplanningDateStabilityV1.js";
import { calculerCapaciteRessourcePourDate, capaciteBasePlanningPourDate } from "./planningResourceCapacityV1.js";
import { evaluerContraintesPlanning } from "./planningConstraintModelV1.js";
import { normaliserRessource, RESOURCE_KINDS } from "./planningResourceModelV1.js";

export const PLANNING_REPLANNING_ENGINE_VERSION = 1;
const EPS = 0.005;
const txt = v => String(v ?? "").trim();
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const uniq = xs => [...new Set((Array.isArray(xs) ? xs : []).map(txt).filter(Boolean))];
const dateOnly = v => {
  const s = txt(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function enrichirNonPlanifiesAvecBlocagesConnus(nonPlanifies = [], engineInput = {}) {
  const travaux = Array.isArray(engineInput?.travaux) ? engineInput.travaux : [];
  const idsTravaux = new Set(travaux.map(t => txt(t?.id)).filter(Boolean));
  const completed = new Set((engineInput?.completedTaskIds || []).map(txt).filter(Boolean));
  const travailParId = new Map(travaux.map(t => [txt(t?.id), t]));
  const exclusions = new Map((engineInput?.replanning_exclusions || [])
    .filter(x => txt(x?.travail_id))
    .map(x => [txt(x.travail_id), x]));

  return (Array.isArray(nonPlanifies) ? nonPlanifies : []).map(row => {
    const travailId = txt(row?.travail_id);
    const travail = travailParId.get(travailId);
    if (!travail) return row;
    const missing = uniq(travail?.predecesseur_ids)
      .filter(id => !idsTravaux.has(id) && !completed.has(id));
    if (!missing.length) return row;

    const connus = missing
      .map(id => ({ id, exclusion: exclusions.get(id) || null }))
      .filter(x => x.exclusion);
    if (!connus.length) return row;

    const inconnus = missing.filter(id => !exclusions.has(id));
    const blocages = connus.map(({ id, exclusion }) => ({
      travail_id: id,
      type: exclusion.type,
      explication: exclusion.explication,
      chantier_id: exclusion.chantier_id || null,
      tache_id: exclusion.tache_id || null,
      avancement: exclusion.avancement ?? null,
      source_verite: exclusion.source_verite || null,
    }));

    if (inconnus.length) {
      return {
        ...row,
        blocages_predecesseurs_connus: blocages,
        predecesseurs_encore_inconnus: inconnus,
      };
    }

    const tousSansCharge = blocages.every(b => b.type === "charge_reference_manquante");
    return {
      ...row,
      raison: tousSansCharge
        ? `Prédécesseur(s) encore ouvert(s) mais sans charge de référence quantifiable : ${missing.join(", ")}`
        : `Prédécesseur(s) exclu(s) de la planification par une règle connue : ${missing.join(", ")}`,
      raison_code: tousSansCharge
        ? "predecesseur_charge_reference_manquante"
        : "predecesseur_exclu_regle_connue",
      blocages_predecesseurs_connus: blocages,
      predecesseurs_encore_inconnus: [],
    };
  });
}

function keyLoad(resourceId, date) {
  return `${txt(resourceId)}@@${date}`;
}

function construireChargesFinales(engineInput, allocationsProposees) {
  const loads = new Map();
  const rows = [
    ...(Array.isArray(engineInput?.allocationsExistantes) ? engineInput.allocationsExistantes : []),
    ...(Array.isArray(allocationsProposees) ? allocationsProposees : []),
  ];
  for (const row of rows) {
    const date = dateOnly(row?.date);
    const duree = Math.max(0, num(row?.duree, 0));
    if (!date || duree <= EPS) continue;
    const siteId = txt(row?.site_id || row?.chantier_id) || null;
    for (const resourceId of uniq(row?.resource_ids)) {
      const key = keyLoad(resourceId, date);
      const prev = loads.get(key) || { heures: 0, sites: new Set() };
      prev.heures = round2(prev.heures + duree);
      if (siteId) prev.sites.add(siteId);
      loads.set(key, prev);
    }
  }
  return loads;
}

function datesFinTravaux(allocations = []) {
  const out = new Map();
  for (const row of Array.isArray(allocations) ? allocations : []) {
    const id = txt(row?.travail_id);
    const date = dateOnly(row?.date);
    if (!id || !date) continue;
    const prev = out.get(id);
    if (!prev || date > prev) out.set(id, date);
  }
  return out;
}

function contexteTravail(travail) {
  return {
    chantier_id: txt(travail?.chantier_id) || null,
    groupe_type_id: txt(travail?.groupe_type_id) || null,
    tache_id: txt(travail?.tache_id) || null,
  };
}

function predecesseursPretsLe(travail, date, completedIds, finishDates, travauxIds) {
  for (const pred of uniq(travail?.predecesseur_ids)) {
    if (completedIds.has(pred)) continue;
    if (!travauxIds.has(pred)) return false;
    const finish = finishDates.get(pred);
    if (!finish || finish > date) return false;
  }
  return true;
}

/**
 * Diagnostic purement explicatif du chantier 05.
 * Il ne replanifie rien : il observe la proposition finale et vérifie si, entre
 * l'ancre du forecast et la première date proposée, le pool HARD contenait
 * encore assez de ressources avec capacité résiduelle sur chaque jour possible.
 * Si un seul jour conserve une équipe complète, le diagnostic n'est PAS confirmé.
 */
export function diagnostiquerRetardsCapaciteResiduelleV1({ engineInput = {}, proposition = {}, decisionsDates = [] } = {}) {
  const travaux = Array.isArray(engineInput?.travaux) ? engineInput.travaux : [];
  const travailParId = new Map(travaux.map(t => [txt(t?.id), t]));
  const travauxIds = new Set(travailParId.keys());
  const completedIds = new Set((engineInput?.completedTaskIds || []).map(txt).filter(Boolean));
  const resources = (Array.isArray(engineInput?.ressources) ? engineInput.ressources : [])
    .map(normaliserRessource)
    .filter(r => r.id && r.actif !== false && r.kind === RESOURCE_KINDS.PERSONNE);
  const resourceById = new Map(resources.map(r => [r.id, r]));
  const contraintes = Array.isArray(engineInput?.contraintes) ? engineInput.contraintes : [];
  const evenements = Array.isArray(engineInput?.evenementsRessources) ? engineInput.evenementsRessources : [];
  const allocations = Array.isArray(proposition?.allocations_proposees) ? proposition.allocations_proposees : [];
  const loads = construireChargesFinales(engineInput, allocations);
  const finishDates = datesFinTravaux(allocations);
  const decisionById = new Map((Array.isArray(decisionsDates) ? decisionsDates : [])
    .filter(d => txt(d?.travail_id))
    .map(d => [txt(d.travail_id), d]));
  const firstDateById = new Map();
  for (const row of allocations) {
    const id = txt(row?.travail_id);
    const date = dateOnly(row?.date);
    if (!id || !date) continue;
    const prev = firstDateById.get(id);
    if (!prev || date < prev) firstDateById.set(id, date);
  }

  const diagnostics = [];
  for (const travail of travaux) {
    const id = txt(travail?.id);
    const decision = decisionById.get(id) || null;
    const anchor = dateOnly(decision?.date_ancrage || travail?.stability_forecast?.dates?.[0]);
    const proposedDate = firstDateById.get(id) || null;
    if (!anchor || !proposedDate || proposedDate <= anchor) continue;

    const candidateIds = uniq(travail?.candidate_resource_ids);
    const candidates = (candidateIds.length ? candidateIds.map(rid => resourceById.get(rid)).filter(Boolean) : resources);
    const crewSize = Math.max(1, Math.round(num(travail?.crew_size, 1)));
    if (!candidates.length) continue;

    const requiredElapsed = Math.max(0, num(travail?.heures_mo_restantes, 0)) / crewSize;
    const jours = [];
    let date = anchor;
    let guard = 0;
    while (date < proposedDate && guard++ < 366) {
      if (capaciteBasePlanningPourDate(date) > EPS) {
        if (!predecesseursPretsLe(travail, date, completedIds, finishDates, travauxIds)) {
          jours.push({ date, statut: "attente_predecesseur", ressources_disponibles: null, crew_size: crewSize });
        } else {
          const globalEval = evaluerContraintesPlanning({
            contraintes,
            context: contexteTravail(travail),
            dateISO: date,
          });
          if (!globalEval.eligible) {
            jours.push({ date, statut: "contrainte_date", ressources_disponibles: null, crew_size: crewSize, violations: globalEval.violations || [] });
          } else {
            const disponibles = [];
            const indisponibles = [];
            for (const resource of candidates) {
              const load = loads.get(keyLoad(resource.id, date)) || { heures: 0, sites: new Set() };
              const siteId = txt(travail?.site_id || travail?.chantier_id);
              const conflitSite = load.sites.size > 0 && !load.sites.has(siteId);
              if (conflitSite) {
                indisponibles.push({ resource_id: resource.id, raison: "autre_site", charge_h: load.heures });
                continue;
              }
              const cap = calculerCapaciteRessourcePourDate({
                resource,
                dateISO: date,
                evenements,
                heuresDejaAllouees: load.heures,
              });
              const resourceEval = evaluerContraintesPlanning({
                contraintes,
                context: contexteTravail(travail),
                dateISO: date,
                resourceId: resource.id,
              });
              const assezPourNonFractionnable = travail?.fractionnable !== false || cap.capacite_disponible + EPS >= requiredElapsed;
              if (resourceEval.eligible && cap.capacite_disponible > EPS && assezPourNonFractionnable) {
                disponibles.push({ resource_id: resource.id, capacite_residuelle_h: round2(cap.capacite_disponible), charge_h: round2(load.heures) });
              } else {
                indisponibles.push({
                  resource_id: resource.id,
                  raison: !resourceEval.eligible ? "contrainte_ressource" : "capacite_insuffisante",
                  capacite_residuelle_h: round2(cap.capacite_disponible),
                  charge_h: round2(load.heures),
                });
              }
            }
            jours.push({
              date,
              statut: disponibles.length >= crewSize ? "equipe_complete_residuelle" : "equipe_complete_indisponible",
              ressources_disponibles: disponibles.length,
              crew_size: crewSize,
              disponibles,
              indisponibles,
            });
          }
        }
      }
      date = addDays(date, 1);
    }

    const joursEligibles = jours.filter(j => ["equipe_complete_residuelle", "equipe_complete_indisponible"].includes(j.statut));
    const joursSansEquipe = joursEligibles.filter(j => j.statut === "equipe_complete_indisponible");
    const confirme = joursEligibles.length > 0
      && joursSansEquipe.length === joursEligibles.length
      && jours.every(j => j.statut !== "contrainte_date");

    diagnostics.push({
      travail_id: id,
      chantier_id: txt(travail?.chantier_id) || null,
      tache_id: txt(travail?.tache_id) || null,
      date_ancrage: anchor,
      date_proposee: proposedDate,
      raison_stabilite_date: txt(decision?.raison) || null,
      crew_size: crewSize,
      candidate_resource_ids: candidates.map(r => r.id),
      jours,
      jours_eligibles: joursEligibles.length,
      jours_sans_equipe_complete: joursSansEquipe.map(j => j.date),
      capacite_residuelle_confirme_retard: confirme,
      interpretation: confirme
        ? "Dans la proposition calculée, aucun jour planifiable avant la date retenue ne conserve une équipe complète dans le pool HARD avec capacité résiduelle compatible."
        : "La capacité résiduelle seule ne suffit pas à expliquer ce décalage ; conserver le changement à vérifier.",
    });
  }

  return diagnostics.sort((a, b) => a.travail_id.localeCompare(b.travail_id));
}

export function planifierReplanningPropositionV1(engineInput = {}) {
  const stability = appliquerStabiliteDatesForecastV1({
    travaux: engineInput?.travaux || [],
    contraintes: engineInput?.contraintes || [],
    startDate: engineInput?.startDate,
  });

  const propositionBase = planifierPropositionV1({
    ...engineInput,
    contraintes: stability.contraintes,
    continuiteMultiJours: true,
  });
  const nonPlanifies = enrichirNonPlanifiesAvecBlocagesConnus(propositionBase.non_planifies, engineInput);
  const diagnosticsCapacite = diagnostiquerRetardsCapaciteResiduelleV1({
    engineInput: { ...engineInput, contraintes: stability.contraintes },
    proposition: propositionBase,
    decisionsDates: stability.decisions,
  });

  const travailParId = new Map((engineInput?.travaux || []).map(t => [String(t?.id || ""), t]));
  const allocations = propositionBase.allocations_proposees.map(a => {
    const travail = travailParId.get(String(a.travail_id)) || null;
    const anchor = travail?.stability_forecast?.dates?.[0] || null;
    const forecastResources = travail?.stability_forecast?.resource_ids_compatibles || [];
    return {
      ...a,
      explication: {
        ...a.explication,
        stabilite_forecast: anchor || forecastResources.length ? {
          date_ancrage: anchor,
          date_conservee: Boolean(anchor && a.date === anchor),
          resource_ids_preferes: forecastResources,
          anciennes_affectations_contrainte_hard: false,
        } : null,
      },
    };
  });

  return {
    ...propositionBase,
    allocations_proposees: allocations,
    non_planifies: nonPlanifies,
    replanning: {
      version: PLANNING_REPLANNING_ENGINE_VERSION,
      stabilite_dates: stability.audit,
      contraintes_ephemeres: stability.contraintes_ephemeres,
      decisions_stabilite_dates: stability.decisions,
      diagnostics_capacite_residuelle: diagnosticsCapacite,
      exclusions_connues: engineInput?.replanning_exclusions || [],
      continuite_multi_jours: {
        active: true,
        reference: "jour ouvré précédent selon rythmeSemaine",
        contrainte_hard: false,
      },
    },
    invariants: {
      ...propositionBase.invariants,
      moteur_chantier_04_delegue_sans_reimplementation: true,
      forecast_est_une_preference_soft: true,
      contraintes_stabilite_non_persistantes: true,
      continuite_multi_jours_soft_active: true,
      predecesseur_exclu_reste_bloquant: true,
      exclusion_connue_ne_devient_jamais_completion: true,
      diagnostic_retard_capacite_est_observation_post_calcul: true,
      diagnostic_capacite_nexplique_pas_si_un_creneau_residuel_existe: true,
    },
  };
}