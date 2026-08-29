// ─── CHANTIER 05 — SÉCURITÉ D'APPLICATION V1 ────────────────────────────────
// Module PUR : aucune lecture/écriture Supabase.
//
// Évalue si un plan d'application de replanification peut, un jour, être envoyé
// à une transaction DB. Il ne modifie rien. Il ajoute notamment les gardes qui
// nécessitent une vue plus large que l'horizon moteur :
// - aucune tâche actuellement forecastée ne doit disparaître sans remplacement ;
// - aucune tâche touchée ne doit avoir une allocation liée après l'horizon ;
// - aucun changement inexpliqué ;
// - toute tâche liée doit exister dans le phasage ;
// - les futures dates_prevue sont calculées selon l'invariant historique :
//   premier jour planifié toutes semaines confondues, y compris le passé.

export const PLANNING_REPLANNING_APPLY_SAFETY_VERSION = 1;

const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
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
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function dateDepuisWeekJourApplicationV1(weekId, jour) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(txt(weekId));
  const idx = JOURS.indexOf(txt(jour));
  if (!m || idx < 0) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4, 12));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1) + (week - 1) * 7);
  monday.setUTCDate(monday.getUTCDate() + idx);
  return monday.toISOString().slice(0, 10);
}

function cleCellule(cell) {
  const w = txt(cell?.week_id), c = txt(cell?.chantier_id), j = txt(cell?.jour);
  return w && c && j ? `${w}::${c}::${j}` : null;
}

function cleTravail(chantierId, tacheId) {
  const c = txt(chantierId), t = txt(tacheId);
  return c && t ? `${c}::${t}` : null;
}

function lignesLiees(cell) {
  return (Array.isArray(cell?.taches) ? cell.taches : [])
    .filter(t => txt(t?.tache_id));
}

function indexPhasage(phasages = []) {
  const tasks = new Map();
  const phByChantier = new Map();
  for (const ph of Array.isArray(phasages) ? phasages : []) {
    const chantierId = txt(ph?.chantier_id);
    if (!chantierId || phByChantier.has(chantierId)) continue;
    phByChantier.set(chantierId, ph);
    for (const ouvrage of Array.isArray(ph?.ouvrages) ? ph.ouvrages : []) {
      for (const t of Array.isArray(ouvrage?.taches) ? ouvrage.taches : []) {
        const key = cleTravail(chantierId, t?.id);
        if (!key || tasks.has(key)) continue;
        tasks.set(key, {
          phasage_id: txt(ph?.id) || null,
          chantier_id: chantierId,
          expected_updated_at: ph?.updated_at || null,
          tache_id: txt(t.id),
          date_prevue: dateOnly(t?.date_prevue),
        });
      }
    }
  }
  return { tasks, phByChantier };
}

function workKeysTouches(planApplication = {}) {
  const out = new Set();
  for (const op of Array.isArray(planApplication?.operations) ? planApplication.operations : []) {
    const before = op?.expected_before?.payload;
    const after = op?.after;
    for (const cell of [before, after]) {
      if (!cell) continue;
      for (const line of lignesLiees(cell)) {
        const key = cleTravail(cell?.chantier_id, line?.tache_id);
        if (key) out.add(key);
      }
    }
  }
  return out;
}

function construireCellulesApres(cellulesToutes = [], planApplication = {}) {
  const map = new Map();
  for (const cell of Array.isArray(cellulesToutes) ? cellulesToutes : []) {
    const key = cleCellule(cell);
    if (key && !map.has(key)) map.set(key, cell);
  }
  for (const op of Array.isArray(planApplication?.operations) ? planApplication.operations : []) {
    if (!txt(op?.cell_key) || !op?.after) continue;
    map.set(txt(op.cell_key), op.after);
  }
  return map;
}

function premieresDatesParTravail(cellMap, workKeys) {
  const result = new Map();
  for (const cell of cellMap.values()) {
    const date = dateDepuisWeekJourApplicationV1(cell?.week_id, cell?.jour);
    if (!date) continue;
    for (const line of lignesLiees(cell)) {
      const key = cleTravail(cell?.chantier_id, line?.tache_id);
      if (!key || !workKeys.has(key)) continue;
      const prev = result.get(key);
      if (!prev || date < prev) result.set(key, date);
    }
  }
  return result;
}

function blocker(code, label, details = null) {
  return { code, label, details };
}

export function evaluerSecuriteApplicationReplanningV1({
  planApplication = {},
  cellulesToutes = [],
  diff = {},
  phasages = [],
  startDate,
  horizonDays = 42,
} = {}) {
  const start = dateOnly(startDate);
  if (!start) throw new Error("startDate ISO requis pour la sécurité d'application");
  const horizon = Math.max(1, Math.min(366, Math.round(num(horizonDays, 42))));
  const end = addDays(start, horizon - 1);
  const workKeys = workKeysTouches(planApplication);
  const blockers = [];
  const warnings = [];

  const nonReplanifies = (Array.isArray(diff?.changements) ? diff.changements : [])
    .filter(c => c?.statut === "non_replanifié");
  if (nonReplanifies.length) {
    blockers.push(blocker(
      "forecast_courant_sans_remplacement",
      `${nonReplanifies.length} tâche(s) actuellement planifiée(s) n'ont aucun remplacement proposé.`,
      { travaux: nonReplanifies.map(c => c.travail_id).filter(Boolean) }
    ));
  }

  const aVerifier = (Array.isArray(diff?.changements) ? diff.changements : [])
    .filter(c => c?.changement_a_verifier === true);
  if (aVerifier.length) {
    blockers.push(blocker(
      "changement_inexplique",
      `${aVerifier.length} changement(s) restent à vérifier avant application.`,
      { travaux: aVerifier.map(c => c.travail_id).filter(Boolean) }
    ));
  }

  const allocationsHorsHorizon = [];
  for (const cell of Array.isArray(cellulesToutes) ? cellulesToutes : []) {
    const date = dateDepuisWeekJourApplicationV1(cell?.week_id, cell?.jour);
    if (!date || date <= end) continue;
    for (const line of lignesLiees(cell)) {
      const key = cleTravail(cell?.chantier_id, line?.tache_id);
      if (!key || !workKeys.has(key)) continue;
      allocationsHorsHorizon.push({
        travail_id: key,
        allocation_uid: txt(line?.allocation_uid) || null,
        date,
        week_id: txt(cell?.week_id),
        jour: txt(cell?.jour),
      });
    }
  }
  if (allocationsHorsHorizon.length) {
    blockers.push(blocker(
      "allocation_liee_hors_horizon",
      `${allocationsHorsHorizon.length} allocation(s) de tâche touchée(s) existent après l'horizon d'application.`,
      { allocations: allocationsHorsHorizon }
    ));
  }

  const { tasks: phasageTasks } = indexPhasage(phasages);
  const missingPhasage = [...workKeys].filter(key => !phasageTasks.has(key));
  if (missingPhasage.length) {
    blockers.push(blocker(
      "tache_phasage_introuvable",
      `${missingPhasage.length} tâche(s) liée(s) du plan n'existent plus dans le phasage chargé.`,
      { travaux: missingPhasage }
    ));
  }

  const cellsAfter = construireCellulesApres(cellulesToutes, planApplication);
  const earliest = premieresDatesParTravail(cellsAfter, workKeys);
  const phasageUpdatesById = new Map();
  for (const key of [...workKeys].sort()) {
    const current = phasageTasks.get(key);
    if (!current) continue;
    const desired = earliest.get(key) || null;
    if ((current.date_prevue || null) === desired) continue;
    const phId = current.phasage_id;
    if (!phId) {
      blockers.push(blocker("phasage_sans_id", `Phasage sans id pour ${key}.`, { travail_id:key }));
      continue;
    }
    if (!phasageUpdatesById.has(phId)) {
      phasageUpdatesById.set(phId, {
        phasage_id: phId,
        chantier_id: current.chantier_id,
        expected_updated_at: current.expected_updated_at,
        task_updates: [],
      });
    }
    phasageUpdatesById.get(phId).task_updates.push({
      travail_id: key,
      tache_id: current.tache_id,
      expected_date_prevue: current.date_prevue || null,
      after_date_prevue: desired,
    });
  }

  const phasageUpdates = [...phasageUpdatesById.values()]
    .map(row => ({ ...row, task_updates: row.task_updates.sort((a,b) => a.travail_id.localeCompare(b.travail_id)) }))
    .sort((a,b) => a.chantier_id.localeCompare(b.chantier_id));

  const incompleteChantiers = (Array.isArray(diff?.par_chantier) ? diff.par_chantier : [])
    .filter(c => c?.proposition_complete === false).length;
  if (incompleteChantiers) {
    warnings.push({
      code: "proposition_chantier_incomplete",
      label: `${incompleteChantiers} chantier(s) restent incomplets dans l'horizon ; cela ne supprime pas à lui seul un forecast existant si la garde non-replanifiée est satisfaite.`,
    });
  }

  const operations = Array.isArray(planApplication?.operations) ? planApplication.operations.length : 0;
  const applicationAutorisable = blockers.length === 0 && operations > 0;

  return {
    version: PLANNING_REPLANNING_APPLY_SAFETY_VERSION,
    start_date: start,
    horizon_end: end,
    application_autorisable: applicationAutorisable,
    aucune_mutation_necessaire: operations === 0,
    blockers,
    warnings,
    phasage_updates: phasageUpdates,
    resume: {
      cellules_a_ecrire: operations,
      travaux_touches: workKeys.size,
      blockers: blockers.length,
      changements_non_replanifies: nonReplanifies.length,
      changements_a_verifier: aVerifier.length,
      allocations_hors_horizon_bloquantes: allocationsHorsHorizon.length,
      phasages_a_mettre_a_jour: phasageUpdates.length,
      dates_prevue_a_modifier: phasageUpdates.reduce((s,p) => s + p.task_updates.length, 0),
    },
    preconditions_transaction: {
      planning_cells_compare_before_write_exact: true,
      phasages_compare_updated_at: true,
      phasages_patch_date_prevue_uniquement_sur_etat_relu: true,
      transaction_unique_obligatoire: true,
      conflit_annule_toute_transaction: true,
    },
    invariants: {
      aucune_ecriture_persistante: true,
      forecast_sans_remplacement_bloque_application: true,
      allocation_liee_apres_horizon_bloque_application: true,
      changement_inexplique_bloque_application: true,
      date_prevue_premier_jour_planifie_toutes_semaines: true,
      historique_passe_non_supprime: true,
    },
  };
}
