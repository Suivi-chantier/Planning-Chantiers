// ─── CHANTIER 05 — STABILITÉ DU FORECAST V1 ─────────────────────────────────
// Module PUR : aucune lecture/écriture Supabase.
//
// Le forecast courant est une ancienne intention, jamais une vérité ni une
// contrainte HARD. Lorsqu'une affectation actuelle reste compatible avec le pool
// métier courant, elle devient une préférence SOFT pour éviter les permutations
// arbitraires de ressources lors d'un recalcul.
//
// Ordre de préférence déterministe :
// 1. ressources déjà prévues sur CETTE tâche ;
// 2. à défaut, ressources déjà prévues sur le MÊME site/opération ;
// 3. à défaut, préférences statiques du groupe métier.
// Dans tous les cas `candidate_resource_ids` reste le pool HARD inchangé.
//
// La forme d'équipe (crew_size) peut, elle, être reprise du forecast uniquement
// si TOUTES les allocations de la tâche ont une taille identique et si aucune
// ressource forecast ne sort du pool HARD. Cela évite de confondre une liste de
// ressources de référence du phasage avec une obligation de présence simultanée.

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
    const prev = map.get(key) || { resource_ids: [], dates: [], allocation_uids: [], crew_sizes: [] };
    const resourceIds = uniq(a?.resource_ids);
    prev.resource_ids.push(...resourceIds);
    if (resourceIds.length) prev.crew_sizes.push(resourceIds.length);
    if (txt(a?.date)) prev.dates.push(txt(a.date).slice(0, 10));
    if (txt(a?.allocation_uid)) prev.allocation_uids.push(txt(a.allocation_uid));
    map.set(key, prev);
  }
  for (const [key, value] of map) {
    const crewSizes = [...new Set(value.crew_sizes)].sort((a, b) => a - b);
    map.set(key, {
      resource_ids: uniq(value.resource_ids).sort(),
      dates: uniq(value.dates).sort(),
      allocation_uids: uniq(value.allocation_uids).sort(),
      crew_sizes: crewSizes,
      crew_size_stable: crewSizes.length === 1 ? crewSizes[0] : null,
    });
  }
  return map;
}

function normaliserSitesExternes(sitesParChantier) {
  if (sitesParChantier instanceof Map) {
    return new Map([...sitesParChantier.entries()]
      .map(([chantierId, siteId]) => [txt(chantierId), txt(siteId)])
      .filter(([chantierId, siteId]) => chantierId && siteId));
  }
  if (sitesParChantier && typeof sitesParChantier === "object" && !Array.isArray(sitesParChantier)) {
    return new Map(Object.entries(sitesParChantier)
      .map(([chantierId, siteId]) => [txt(chantierId), txt(siteId)])
      .filter(([chantierId, siteId]) => chantierId && siteId));
  }
  return new Map();
}

function indexSitesTravaux(travaux = [], sitesParChantier = null) {
  const map = normaliserSitesExternes(sitesParChantier);
  for (const t of Array.isArray(travaux) ? travaux : []) {
    const chantierId = txt(t?.chantier_id);
    const siteId = txt(t?.site_id || t?.chantier_id);
    if (chantierId && siteId && !map.has(chantierId)) map.set(chantierId, siteId);
  }
  return map;
}

function indexForecastParSite(allocations = [], siteParChantier = new Map()) {
  const map = new Map();
  for (const a of Array.isArray(allocations) ? allocations : []) {
    const chantierId = txt(a?.chantier_id);
    const siteId = siteParChantier.get(chantierId) || chantierId || null;
    if (!siteId) continue;
    const prev = map.get(siteId) || { resource_ids: [], dates: [], allocation_uids: [], chantier_ids: [] };
    prev.resource_ids.push(...uniq(a?.resource_ids));
    if (txt(a?.date)) prev.dates.push(txt(a.date).slice(0, 10));
    if (txt(a?.allocation_uid)) prev.allocation_uids.push(txt(a.allocation_uid));
    if (chantierId) prev.chantier_ids.push(chantierId);
    map.set(siteId, prev);
  }
  for (const [siteId, value] of map) {
    map.set(siteId, {
      resource_ids: uniq(value.resource_ids).sort(),
      dates: uniq(value.dates).sort(),
      allocation_uids: uniq(value.allocation_uids).sort(),
      chantier_ids: uniq(value.chantier_ids).sort(),
    });
  }
  return map;
}

export function appliquerStabiliteForecastV1({ travaux = [], allocationsForecast = [], sitesParChantier = null } = {}) {
  const forecastParTache = indexForecast(allocationsForecast);
  const siteParChantier = indexSitesTravaux(travaux, sitesParChantier);
  const forecastParSite = indexForecastParSite(allocationsForecast, siteParChantier);

  let travauxAvecForecast = 0;
  let travauxAvecPreferenceConservee = 0;
  let travauxAvecAffiniteSite = 0;
  let travauxAvecCrewSizeConservee = 0;
  let ressourcesForecastCompatibles = 0;
  let ressourcesForecastHorsPool = 0;
  let ressourcesSiteCompatibles = 0;

  const next = (Array.isArray(travaux) ? travaux : []).map(travail => {
    const key = cle(travail?.chantier_id, travail?.tache_id);
    const forecast = forecastParTache.get(key) || null;
    const siteId = txt(travail?.site_id || siteParChantier.get(txt(travail?.chantier_id)) || travail?.chantier_id) || null;
    const siteForecast = siteId ? forecastParSite.get(siteId) || null : null;
    const candidatesList = uniq(travail?.candidate_resource_ids);
    const candidates = new Set(candidatesList);
    const staticPreferred = uniq(travail?.preferred_resource_ids).filter(id => candidates.has(id));

    const compatiblesTache = forecast ? forecast.resource_ids.filter(id => candidates.has(id)) : [];
    const horsPoolTache = forecast ? forecast.resource_ids.filter(id => !candidates.has(id)) : [];
    const compatiblesSite = siteForecast ? siteForecast.resource_ids.filter(id => candidates.has(id)) : [];

    if (forecast) travauxAvecForecast++;
    ressourcesForecastCompatibles += compatiblesTache.length;
    ressourcesForecastHorsPool += horsPoolTache.length;
    ressourcesSiteCompatibles += compatiblesSite.length;

    let preferred = staticPreferred;
    let preferenceSource = "groupe_metier";
    if (compatiblesTache.length) {
      preferred = compatiblesTache;
      preferenceSource = "forecast_tache";
      travauxAvecPreferenceConservee++;
    } else if (compatiblesSite.length) {
      preferred = compatiblesSite;
      preferenceSource = "forecast_site";
      travauxAvecAffiniteSite++;
    }

    // Une taille d'équipe forecast n'est fiable que si elle est stable sur
    // toutes les allocations de la tâche ET si 100 % des ressources historiques
    // sont encore compatibles avec le pool HARD actuel.
    const crewSizeForecast = forecast?.crew_size_stable || null;
    const crewSizeApplicable = Boolean(
      crewSizeForecast
      && horsPoolTache.length === 0
      && compatiblesTache.length >= crewSizeForecast
    );
    const crewSize = crewSizeApplicable ? crewSizeForecast : travail?.crew_size;
    if (crewSizeApplicable && Number(crewSize) !== Number(travail?.crew_size)) travauxAvecCrewSizeConservee++;

    const hasStabilityContext = Boolean(forecast || siteForecast);
    if (!hasStabilityContext) return { ...travail };

    return {
      ...travail,
      crew_size: crewSize,
      preferred_resource_ids: preferred,
      stability_forecast: {
        source: "forecast_courant_recalculable",
        preference_source: preferenceSource,
        allocation_uids: forecast?.allocation_uids || [],
        dates: forecast?.dates || [],
        resource_ids_historiques: forecast?.resource_ids || [],
        resource_ids_compatibles: compatiblesTache,
        resource_ids_hors_pool: horsPoolTache,
        crew_sizes_historiques: forecast?.crew_sizes || [],
        crew_size_historique_stable: crewSizeForecast,
        crew_size_appliquee: crewSizeApplicable ? crewSizeForecast : null,
        crew_size_originale: travail?.crew_size ?? null,
        site_id: siteId,
        site_allocation_uids: siteForecast?.allocation_uids || [],
        site_dates: siteForecast?.dates || [],
        site_chantier_ids: siteForecast?.chantier_ids || [],
        site_resource_ids_historiques: siteForecast?.resource_ids || [],
        site_resource_ids_compatibles: compatiblesSite,
        preference_appliquee: preferenceSource !== "groupe_metier",
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
      travaux_avec_affinite_site: travauxAvecAffiniteSite,
      travaux_avec_crew_size_forecast_conservee: travauxAvecCrewSizeConservee,
      ressources_forecast_compatibles: ressourcesForecastCompatibles,
      ressources_forecast_hors_pool: ressourcesForecastHorsPool,
      ressources_site_compatibles: ressourcesSiteCompatibles,
    },
    invariants: {
      forecast_est_une_preference_soft: true,
      candidate_resource_ids_inchange: true,
      ressource_hors_pool_jamais_reintroduite: true,
      crew_size_forecast_uniquement_si_stable_et_100pct_compatible: true,
      preference_tache_avant_preference_site: true,
      preference_site_filtree_par_pool_metier: true,
      resolution_site_utilise_referentiel_operation: true,
      absence_forecast_site_ne_change_pas_le_moteur: true,
    },
  };
}
