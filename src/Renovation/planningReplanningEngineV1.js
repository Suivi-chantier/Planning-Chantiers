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

export function planifierReplanningPropositionV1(engineInput = {}) {
  const stability = appliquerStabiliteDatesForecastV1({
    travaux: engineInput?.travaux || [],
    contraintes: engineInput?.contraintes || [],
    startDate: engineInput?.startDate,
  });

  const proposition = planifierPropositionV1({
    ...engineInput,
    contraintes: stability.contraintes,
    continuiteMultiJours: true,
  });

  const travailParId = new Map((engineInput?.travaux || []).map(t => [String(t?.id || ""), t]));
  const allocations = proposition.allocations_proposees.map(a => {
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
    ...proposition,
    allocations_proposees: allocations,
    replanning: {
      version: PLANNING_REPLANNING_ENGINE_VERSION,
      stabilite_dates: stability.audit,
      contraintes_ephemeres: stability.contraintes_ephemeres,
      decisions_stabilite_dates: stability.decisions,
      continuite_multi_jours: {
        active: true,
        reference: "jour ouvré précédent selon rythmeSemaine",
        contrainte_hard: false,
      },
    },
    invariants: {
      ...proposition.invariants,
      moteur_chantier_04_delegue_sans_reimplementation: true,
      forecast_est_une_preference_soft: true,
      contraintes_stabilite_non_persistantes: true,
      continuite_multi_jours_soft_active: true,
    },
  };
}
