// ─── CHANTIER 05 — STABILITÉ DU FORECAST V1 ─────────────────────────────────
// Module PUR : aucune lecture/écriture Supabase.
//
// Le forecast courant est une ancienne intention, jamais une vérité ni une
// contrainte HARD. Lorsqu'une affectation actuelle reste compatible avec le pool
// métier courant, elle devient une préférence SOFT pour éviter les permutations
// arbitraires de ressources lors d'un recalcul.

export const PLANNING_REPLANNING_STABILITY_VERSION = 1;

const txt = v => String(v ?? "").trim();
const uniq = xs => [...new Set((Array.isArray(xs) ? xs : []).map(txt).filter(Boolean))];

function cle(chantierId, tacheId) {
  return `${txt(chantierId)}::${txt(tacheId)}`;
}

function indexForecast(allocations = []) {
  const map = new Map();
  for (const a of Array.isArray(allocations) ? allocations : []) {
    const chantierId = txt(a?.chantier_id);
    const tacheId = txt(a?.tache_id);
    if (!chantierId || !tacheId) continue;
    const key = cle(chantierId, tacheId);
    const prev = map.get(key) || { resource_ids: [], dates: [], allocation_uids: [] };
    prev.resource_ids.push(...uniq(a?.resource_ids));
    if (txt(a?.date)) prev.dates.push(txt(a.date).slice(0, 10));
    if (txt(a?.allocation_uid)) prev.allocation_uids.push(txt(a.allocation_uid));
    map.set(key, prev);
  }
  for (const [key, value] of map) {
    map.set(key, {
      resource_ids: uniq(value.resource_ids).sort(),
      dates: uniq(value.dates).sort(),
      allocation_uids: uniq(value.allocation_uids).sort(),
    });
  }
  return map;
}

export function appliquerStabiliteForecastV1({ travaux = [], allocationsForecast = [] } = {}) {
  const forecastParTache = indexForecast(allocationsForecast);
  let travauxAvecForecast = 0;
  let travauxAvecPreferenceConservee = 0;
  let ressourcesForecastCompatibles = 0;
  let ressourcesForecastHorsPool = 0;

  const next = (Array.isArray(travaux) ? travaux : []).map(travail => {
    const key = cle(travail?.chantier_id, travail?.tache_id);
    const forecast = forecastParTache.get(key) || null;
    if (!forecast) return { ...travail };
    travauxAvecForecast++;

    const candidates = new Set(uniq(travail?.candidate_resource_ids));
    const compatibles = forecast.resource_ids.filter(id => candidates.has(id));
    const horsPool = forecast.resource_ids.filter(id => !candidates.has(id));
    ressourcesForecastCompatibles += compatibles.length;
    ressourcesForecastHorsPool += horsPool.length;

    // La préférence forecast remplace la préférence statique seulement si elle
    // est encore compatible. Le pool candidat HARD est strictement inchangé.
    const preferred = compatibles.length
      ? compatibles
      : uniq(travail?.preferred_resource_ids).filter(id => candidates.has(id));
    if (compatibles.length) travauxAvecPreferenceConservee++;

    return {
      ...travail,
      preferred_resource_ids: preferred,
      stability_forecast: {
        source: "forecast_courant_recalculable",
        allocation_uids: forecast.allocation_uids,
        dates: forecast.dates,
        resource_ids_historiques: forecast.resource_ids,
        resource_ids_compatibles: compatibles,
        resource_ids_hors_pool: horsPool,
        preference_appliquee: compatibles.length > 0,
        contrainte_hard: false,
      },
    };
  });

  return {
    travaux: next,
    audit: {
      travaux_total: next.length,
      travaux_avec_forecast: travauxAvecForecast,
      travaux_avec_preference_forecast_conservee: travauxAvecPreferenceConservee,
      ressources_forecast_compatibles: ressourcesForecastCompatibles,
      ressources_forecast_hors_pool: ressourcesForecastHorsPool,
    },
    invariants: {
      forecast_est_une_preference_soft: true,
      candidate_resource_ids_inchange: true,
      ressource_hors_pool_jamais_reintroduite: true,
      absence_forecast_ne_change_pas_le_moteur: true,
    },
  };
}
