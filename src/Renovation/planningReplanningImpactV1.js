// ─── CHANTIER 05 — PÉRIMÈTRE D'IMPACT DE REPLANIFICATION V1 ─────────────────
// Module PUR : aucune lecture/écriture Supabase.
//
// Un événement ciblé ne doit pas libérer tout le forecast. On identifie :
// - les tâches directement touchées ;
// - leurs dépendants en aval ;
// - les forecasts devenus structurellement incompatibles (pool / reste réel).
// Les autres tâches peuvent être préservées uniquement si leur forecast couvre
// exactement le reste à faire : pas de faux gel d'un forecast incomplet.

export const PLANNING_REPLANNING_IMPACT_VERSION = 1;
const EPS = 0.01;

const txt = v => String(v ?? "").trim();
const uniq = xs => [...new Set((Array.isArray(xs) ? xs : []).map(txt).filter(Boolean))];
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function workId(chantierId, tacheId) {
  const c = txt(chantierId), t = txt(tacheId);
  return c && t ? `${c}::${t}` : null;
}

function idAllocation(a) {
  return workId(a?.chantier_id, a?.tache_id);
}

function dateDansFenetre(date, debut, fin) {
  const d = txt(date).slice(0, 10);
  const a = txt(debut).slice(0, 10);
  const b = txt(fin || debut).slice(0, 10);
  if (!d || !a) return false;
  return d >= a && d <= (b || a);
}

function moAllocation(a) {
  const ids = uniq(a?.resource_ids);
  if (!ids.length) return null;
  return round2(Math.max(0, num(a?.duree, 0)) * ids.length);
}

function ajouterRaison(map, id, code, details = null) {
  if (!id) return;
  const list = map.get(id) || [];
  if (!list.some(r => r.code === code)) list.push({ code, details });
  map.set(id, list);
}

function reverseDependencies(travaux = []) {
  const reverse = new Map();
  for (const t of Array.isArray(travaux) ? travaux : []) {
    const id = txt(t?.id);
    if (!id) continue;
    for (const pred of uniq(t?.predecesseur_ids)) {
      if (!reverse.has(pred)) reverse.set(pred, new Set());
      reverse.get(pred).add(id);
    }
  }
  return reverse;
}

function propagerAval(impactes, raisons, travaux = []) {
  const reverse = reverseDependencies(travaux);
  const queue = [...impactes];
  while (queue.length) {
    const id = queue.shift();
    for (const dep of reverse.get(id) || []) {
      if (!impactes.has(dep)) {
        impactes.add(dep);
        ajouterRaison(raisons, dep, "dependance_aval_d_un_travail_impacte", { predecesseur_id: id });
        queue.push(dep);
      }
    }
  }
}

function indexForecastParTravail(forecast = []) {
  const map = new Map();
  for (const a of Array.isArray(forecast) ? forecast : []) {
    const id = idAllocation(a);
    if (!id) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(a);
  }
  return map;
}

function sitesMap(travaux = []) {
  return new Map((Array.isArray(travaux) ? travaux : [])
    .filter(t => txt(t?.id))
    .map(t => [txt(t.id), txt(t?.site_id || t?.chantier_id) || null]));
}

function appliquerTrigger({ trigger, travaux, forecast, impactes, raisons }) {
  const type = txt(trigger?.type);
  if (!type || type === "full_recalc") {
    for (const t of travaux) {
      if (!txt(t?.id)) continue;
      impactes.add(txt(t.id));
      ajouterRaison(raisons, txt(t.id), "recalcul_global_demande");
    }
    return "full_recalc";
  }

  if (type === "resource_unavailable") {
    const rid = txt(trigger?.resource_id);
    for (const a of forecast) {
      if (!rid || !uniq(a?.resource_ids).includes(rid)) continue;
      if (!dateDansFenetre(a?.date, trigger?.date_debut, trigger?.date_fin)) continue;
      const id = idAllocation(a);
      if (!id) continue;
      impactes.add(id);
      ajouterRaison(raisons, id, "ressource_indisponible_sur_allocation_forecast", {
        resource_id: rid, date: txt(a?.date).slice(0, 10), allocation_uid: txt(a?.allocation_uid) || null,
      });
    }
    return type;
  }

  if (["task_state_changed", "task_completed_early", "task_overrun"].includes(type)) {
    const ids = uniq(trigger?.travail_ids || [trigger?.travail_id]);
    for (const id of ids) {
      impactes.add(id);
      ajouterRaison(raisons, id, type);
    }
    return type;
  }

  if (type === "site_blocked") {
    const siteId = txt(trigger?.site_id);
    const chantierIds = new Set(uniq(trigger?.chantier_ids));
    const byIdSite = sitesMap(travaux);
    for (const a of forecast) {
      const id = idAllocation(a);
      if (!id) continue;
      const sameScope = (siteId && byIdSite.get(id) === siteId) || chantierIds.has(txt(a?.chantier_id));
      if (!sameScope || !dateDansFenetre(a?.date, trigger?.date_debut, trigger?.date_fin)) continue;
      impactes.add(id);
      ajouterRaison(raisons, id, "site_bloque_sur_allocation_forecast", {
        site_id: siteId || byIdSite.get(id) || null, date: txt(a?.date).slice(0, 10),
      });
    }
    return type;
  }

  // Type inconnu : sécurité = recalcul global plutôt qu'un faux périmètre réduit.
  for (const t of travaux) {
    if (!txt(t?.id)) continue;
    impactes.add(txt(t.id));
    ajouterRaison(raisons, txt(t.id), "trigger_inconnu_repli_recalcul_global", { trigger_type: type });
  }
  return "unknown_fallback_full_recalc";
}

export function identifierImpactReplanningV1({
  travaux = [],
  forecast = [],
  completedTaskIds = [],
  trigger = null,
} = {}) {
  const jobs = Array.isArray(travaux) ? travaux : [];
  const rows = Array.isArray(forecast) ? forecast : [];
  const travauxParId = new Map(jobs.filter(t => txt(t?.id)).map(t => [txt(t.id), t]));
  const forecastParTravail = indexForecastParTravail(rows);
  const completed = new Set(uniq(completedTaskIds));
  const impactes = new Set();
  const raisons = new Map();

  const mode = appliquerTrigger({ trigger, travaux: jobs, forecast: rows, impactes, raisons });

  // Incompatibilités objectives du forecast courant, indépendantes du trigger.
  for (const [id, allocations] of forecastParTravail) {
    const travail = travauxParId.get(id) || null;
    if (!travail) {
      if (completed.has(id)) {
        impactes.add(id);
        ajouterRaison(raisons, id, "forecast_d_une_tache_desormais_terminee");
      }
      continue;
    }

    const pool = new Set(uniq(travail?.candidate_resource_ids));
    let moForecast = 0;
    let moCalculable = true;
    for (const a of allocations) {
      const mo = moAllocation(a);
      if (mo == null) {
        moCalculable = false;
        impactes.add(id);
        ajouterRaison(raisons, id, "forecast_ressource_non_mappee", { allocation_uid: txt(a?.allocation_uid) || null });
        continue;
      }
      moForecast += mo;
      const horsPool = uniq(a?.resource_ids).filter(rid => pool.size > 0 && !pool.has(rid));
      if (horsPool.length) {
        impactes.add(id);
        ajouterRaison(raisons, id, "forecast_hors_pool_metier", { resource_ids: horsPool });
      }
    }
    if (moCalculable) {
      moForecast = round2(moForecast);
      const reste = round2(Math.max(0, num(travail?.heures_mo_restantes, 0)));
      if (Math.abs(moForecast - reste) > EPS) {
        impactes.add(id);
        ajouterRaison(raisons, id, moForecast > reste ? "forecast_surdimensionne_vs_reste_reel" : "forecast_incomplet_vs_reste_reel", {
          heures_mo_forecast: moForecast, heures_mo_restantes: reste,
        });
      }
    }
  }

  propagerAval(impactes, raisons, jobs);

  const allocationsPreservables = [];
  const allocationsLiberees = [];
  for (const a of rows) {
    const id = idAllocation(a);
    if (!id || impactes.has(id) || !travauxParId.has(id)) allocationsLiberees.push(a);
    else allocationsPreservables.push(a);
  }

  const travauxSansForecast = jobs
    .filter(t => !forecastParTravail.has(txt(t?.id)))
    .map(t => txt(t.id))
    .filter(Boolean);

  return {
    mode,
    trigger: trigger || { type: "full_recalc" },
    travail_ids_impactes: [...impactes].sort(),
    raisons_par_travail: Object.fromEntries([...raisons.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, list]) => [id, list])),
    allocations_preservables: allocationsPreservables,
    allocations_liberees: allocationsLiberees,
    travaux_sans_forecast: travauxSansForecast.sort(),
    audit: {
      travaux_total: jobs.length,
      travaux_impactes: impactes.size,
      travaux_sans_forecast: travauxSansForecast.length,
      allocations_forecast: rows.length,
      allocations_preservables: allocationsPreservables.length,
      allocations_liberees: allocationsLiberees.length,
    },
    invariants: {
      propagation_dependances_uniquement_vers_aval: true,
      forecast_incomplet_non_gele: true,
      forecast_hors_pool_non_gele: true,
      trigger_inconnu_recalcul_global: true,
      aucune_persistance: true,
    },
  };
}
