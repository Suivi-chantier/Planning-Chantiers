// ─── CHANTIER 05 — SENSIBILITÉ D'HORIZON V1 ─────────────────────────────────
// Module PUR : aucune lecture/écriture Supabase.
//
// Il rejoue exactement la chaîne chantier 05 sur plusieurs horizons à partir
// d'un même snapshot maximal. L'objectif est de distinguer les forecasts qui
// disparaissent uniquement parce que l'horizon est trop court de ceux qui sont
// bloqués par une donnée/dépendance réelle. Aucun résultat n'est persisté.

import { preparerSimulationReplanningV1 } from "./planningReplanningAdapterV1.js";
import { planifierReplanningIncrementalV1 } from "./planningReplanningIncrementalV1.js";
import { diffReplanningAvecContinuiteV1 } from "./planningReplanningDiffContinuityV1.js";
import { construirePlanApplicationReplanningV1 } from "./planningReplanningApplyPlanV1.js";
import { evaluerSecuriteApplicationReplanningV1 } from "./planningReplanningApplySafetyV1.js";
import { metaHorizonMoteurV1 } from "./planningEngineDataHelpersV1.js";

export const PLANNING_REPLANNING_HORIZON_SENSITIVITY_VERSION = 1;

const txt = v => String(v ?? "").trim();
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const uniq = xs => [...new Set((Array.isArray(xs) ? xs : []).map(txt).filter(Boolean))];
const dateOnly = v => {
  const s = txt(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

function horizonsNormalises(horizons = [42, 56, 84]) {
  return [...new Set((Array.isArray(horizons) ? horizons : [])
    .map(v => Math.max(1, Math.min(366, Math.round(num(v, 0)))))
    .filter(Boolean))]
    .sort((a, b) => a - b);
}

function chevaucheEvenement(event, horizon) {
  const debut = dateOnly(event?.date_debut);
  const fin = dateOnly(event?.date_fin) || debut;
  if (!debut || !fin) return false;
  return debut <= horizon.end_date && fin >= horizon.start_date;
}

export function filtrerSnapshotPourHorizonReplanningV1(snapshot = {}, { startDate, horizonDays } = {}) {
  const horizon = metaHorizonMoteurV1(startDate, horizonDays);
  const weeks = new Set(horizon.week_ids);
  return {
    horizon,
    cellules: (Array.isArray(snapshot?.cellules) ? snapshot.cellules : [])
      .filter(cell => weeks.has(txt(cell?.week_id))),
    evenementsRessources: (Array.isArray(snapshot?.evenementsRessources) ? snapshot.evenementsRessources : [])
      .filter(event => chevaucheEvenement(event, horizon)),
  };
}

function classerNonReplanifies(diff = {}) {
  const rows = (Array.isArray(diff?.changements) ? diff.changements : [])
    .filter(c => c?.statut === "non_replanifié");
  const horizonOuCapacite = [];
  const donneeOuDependance = [];
  for (const row of rows) {
    const codes = (Array.isArray(row?.raisons) ? row.raisons : []).map(r => txt(r?.code));
    const purHorizon = codes.includes("non_planifiable_dans_horizon")
      && !codes.some(c => c.startsWith("forecast_non_conservable_") || c === "attente_predecesseur_exclu");
    (purHorizon ? horizonOuCapacite : donneeOuDependance).push(row);
  }
  return {
    total: rows.length,
    travail_ids: rows.map(r => txt(r?.travail_id)).filter(Boolean).sort(),
    horizon_ou_capacite: horizonOuCapacite.length,
    horizon_ou_capacite_ids: horizonOuCapacite.map(r => txt(r?.travail_id)).filter(Boolean).sort(),
    donnee_ou_dependance: donneeOuDependance.length,
    donnee_ou_dependance_ids: donneeOuDependance.map(r => txt(r?.travail_id)).filter(Boolean).sort(),
  };
}

function simulerHorizon(snapshot, startDate, horizonDays) {
  const filtered = filtrerSnapshotPourHorizonReplanningV1(snapshot, { startDate, horizonDays });
  const preparation = preparerSimulationReplanningV1({
    phasages: snapshot?.phasages || [],
    chantiers: snapshot?.chantiers || [],
    cellules: filtered.cellules,
    ressources: snapshot?.ressources || [],
    evenementsRessources: filtered.evenementsRessources,
    contraintes: snapshot?.contraintes || [],
    groupesTypes: snapshot?.groupesTypes || [],
    equipes: snapshot?.equipes || [],
    startDate: filtered.horizon.start_date,
    horizonDays: filtered.horizon.horizon_days,
  });
  const proposition = planifierReplanningIncrementalV1({
    engineInput: preparation.engineInput,
    forecast: preparation.forecastCourant.allocations_recalculables,
    trigger: null,
  });
  const diff = diffReplanningAvecContinuiteV1({
    forecast: preparation.forecastCourant.allocations_recalculables,
    proposition,
    travaux: preparation.engineInput.travaux,
  });
  const planApplication = construirePlanApplicationReplanningV1({
    cellules: filtered.cellules,
    forecastCourant: preparation.forecastCourant,
    proposition,
    ressources: snapshot?.ressources || [],
    startDate: filtered.horizon.start_date,
    horizonDays: filtered.horizon.horizon_days,
  });
  const securite = evaluerSecuriteApplicationReplanningV1({
    planApplication,
    cellulesToutes: snapshot?.cellulesToutes || snapshot?.cellules || [],
    diff,
    phasages: snapshot?.phasages || [],
    startDate: filtered.horizon.start_date,
    horizonDays: filtered.horizon.horizon_days,
  });
  const nonReplanifies = classerNonReplanifies(diff);
  return {
    horizon_days: filtered.horizon.horizon_days,
    start_date: filtered.horizon.start_date,
    end_date: filtered.horizon.end_date,
    week_ids: filtered.horizon.week_ids,
    cellules_chargees: filtered.cellules.length,
    evenements_ressources: filtered.evenementsRessources.length,
    proposition_resume: proposition?.resume || null,
    diff_resume: diff?.resume || null,
    securite_resume: securite?.resume || null,
    application_autorisable: securite?.application_autorisable === true,
    blocker_codes: uniq((securite?.blockers || []).map(b => b?.code)).sort(),
    non_replanifies: nonReplanifies,
  };
}

export function simulerSensibiliteHorizonsReplanningDepuisSnapshotV1({
  snapshot = {},
  startDate,
  horizons = [42, 56, 84],
  baseHorizonDays = 42,
} = {}) {
  const list = horizonsNormalises(horizons);
  if (!list.length) throw new Error("Au moins un horizon est requis pour la sensibilité de replanification");
  const start = dateOnly(startDate);
  if (!start) throw new Error("startDate ISO requis pour la sensibilité de replanification");
  const results = list.map(days => simulerHorizon(snapshot, start, days));
  const base = results.find(r => r.horizon_days === Number(baseHorizonDays)) || results[0];
  const baseIds = new Set(base.non_replanifies.travail_ids);

  const comparaison = results.map(result => {
    const currentIds = new Set(result.non_replanifies.travail_ids);
    const resolus = [...baseIds].filter(id => !currentIds.has(id)).sort();
    const encoreBloques = [...baseIds].filter(id => currentIds.has(id)).sort();
    const nouveaux = result.non_replanifies.travail_ids.filter(id => !baseIds.has(id)).sort();
    return {
      horizon_days: result.horizon_days,
      resolus_depuis_base: resolus.length,
      resolus_depuis_base_ids: resolus,
      encore_bloques_depuis_base: encoreBloques.length,
      encore_bloques_depuis_base_ids: encoreBloques,
      nouveaux_non_replanifies_hors_base: nouveaux.length,
      nouveaux_non_replanifies_hors_base_ids: nouveaux,
    };
  });

  return {
    version: PLANNING_REPLANNING_HORIZON_SENSITIVITY_VERSION,
    start_date: start,
    horizons: list,
    base_horizon_days: base.horizon_days,
    resultats: results,
    comparaison,
    resume: {
      non_replanifies_base: base.non_replanifies.total,
      horizon_ou_capacite_base: base.non_replanifies.horizon_ou_capacite,
      donnee_ou_dependance_base: base.non_replanifies.donnee_ou_dependance,
      meilleur_horizon_days: results.at(-1)?.horizon_days || base.horizon_days,
      resolus_au_plus_long: comparaison.at(-1)?.resolus_depuis_base || 0,
      encore_bloques_au_plus_long: comparaison.at(-1)?.encore_bloques_depuis_base || 0,
    },
    invariants: {
      aucune_ecriture_persistante: true,
      meme_snapshot_source_pour_tous_les_horizons: true,
      meme_moteur_chantier05: true,
      comparaison_base_limitee_aux_forecasts_visibles_dans_horizon_base: true,
      extension_horizon_peut_introduire_de_nouveaux_forecasts_a_comparer: true,
      donnee_ou_dependance_ne_devient_pas_horizon_par_allongement: true,
    },
  };
}
