// ─── CHANTIER 05 — MOTEUR DE REPLANIFICATION CONTINUE V1 ────────────────────
// Module PUR : aucune lecture/écriture Supabase.
//
// Il ne remplace pas le moteur du chantier 04. Il prépare seulement les
// préférences de stabilité propres au chantier 05, puis délègue l'ordonnancement
// à planifierPropositionV1. La continuité multi-jours est activée ici uniquement :
// le moteur V1 direct conserve son comportement chantier 04 par défaut.

import { planifierPropositionV1 } from "./planningEngineV1.js";
import { appliquerStabiliteDatesForecastV1 } from "./planningReplanningDateStabilityV1.js";

export const PLANNING_REPLANNING_ENGINE_VERSION = 1;
const txt = v => String(v ?? "").trim();
const uniq = xs => [...new Set((Array.isArray(xs) ? xs : []).map(txt).filter(Boolean))];

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
    },
  };
}