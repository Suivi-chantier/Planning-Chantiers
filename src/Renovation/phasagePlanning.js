// ─── PONT PLANNING SEMAINE ↔ PHASAGE ─────────────────────────────────────────
// Permet à la page Planning (semaine) de proposer les tâches du phasage du
// chantier et d'écrire leur date_prevue quand on les place sur un jour.
// Toute écriture RELIT le phasage depuis la DB juste avant (jamais depuis un
// state local potentiellement périmé — même règle que saveMeta/scheduleSave
// de PhasageV2, incident du 2026-06-03) et ne touche qu'UN champ d'UNE tâche.

import { supabase } from "../supabase";

// Charge le phasage d'un chantier pour le sélecteur du planning :
// { ouvrages, chronoGroupes } — null si pas de phasage.
export async function loadPhasagePourPlanning(chantierId) {
  if (!chantierId) return null;
  const { data, error } = await supabase.from("phasages")
    .select("ouvrages, plan_travaux").eq("chantier_id", chantierId).maybeSingle();
  if (error || !data) return null;
  return {
    ouvrages: Array.isArray(data.ouvrages) ? data.ouvrages : [],
    chronoGroupes: Array.isArray(data.plan_travaux?.meta?.chrono_groupes)
      ? data.plan_travaux.meta.chrono_groupes : [],
  };
}

// Convertit (week_id "YYYY-Wnn", jour "Lundi"…) en date ISO "YYYY-MM-DD".
const JOURS_SEM = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
export function dateFromWeekJour(weekId, jourName) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(weekId || "");
  if (!m) return "";
  const year = parseInt(m[1], 10), week = parseInt(m[2], 10);
  const idx = JOURS_SEM.indexOf(jourName);
  if (idx < 0) return "";
  const jan4 = new Date(year, 0, 4);
  const mon = new Date(jan4);
  mon.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1) + (week - 1) * 7);
  const d = new Date(mon);
  d.setDate(mon.getDate() + idx);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Tous les jours (ISO) où une tâche du phasage est posée dans le planning
// semaine, toutes semaines confondues (scan des cellules du chantier).
export async function joursPlanifiesPourTache(chantierId, tacheId) {
  if (!chantierId || !tacheId) return [];
  const { data, error } = await supabase.from("planning_cells")
    .select("week_id, jour, taches").eq("chantier_id", chantierId);
  if (error || !data) return [];
  const dates = [];
  data.forEach(cell => {
    if (!(cell.taches || []).some(x => String(x.tache_id || "") === String(tacheId))) return;
    const iso = dateFromWeekJour(cell.week_id, cell.jour);
    if (iso) dates.push(iso);
  });
  return dates;
}

// Synchronise date_prevue d'une tâche avec le planning semaine, selon
// l'invariant : date_prevue = PREMIER jour planifié (une tâche peut être
// posée sur plusieurs jours — les jours suivants sont des continuations et
// ne déplacent pas la date). addDates / removeDates corrigent l'état DB pour
// l'opération en cours quand la cellule n'est pas encore sauvegardée (la
// modale du planning ne persiste la cellule qu'à la fermeture).
// Retourne { changed, date } — date = nouvelle date_prevue si changed.
export async function syncDatePrevueTache(chantierId, tacheId, { addDates = [], removeDates = [] } = {}) {
  const enBase = await joursPlanifiesPourTache(chantierId, tacheId);
  const set = new Set(enBase.filter(d => !removeDates.includes(d)));
  addDates.forEach(d => { if (d) set.add(d); });
  if (set.size > 0) {
    const min = [...set].sort()[0];
    const changed = await setDatePrevueTache(chantierId, tacheId, min);
    return { changed, date: min };
  }
  // Plus posée nulle part : on efface la date seulement si elle vaut encore
  // le jour qu'on vient de retirer (jamais une date posée autrement).
  if (removeDates.length > 0) {
    const changed = await setDatePrevueTache(chantierId, tacheId, null, { onlyIfDate: removeDates[0] });
    return { changed, date: null };
  }
  return { changed: false, date: undefined };
}

// Écrit date_prevue (ISO "YYYY-MM-DD" ou null) sur UNE tâche du phasage.
// options.onlyIfDate : n'écrit que si la date actuelle de la tâche vaut cette
// valeur — sert à effacer la date en retirant la tâche d'un jour SANS écraser
// une re-planification faite ailleurs entre-temps.
// Retourne true si la tâche a été trouvée et mise à jour.
export async function setDatePrevueTache(chantierId, tacheId, dateISO, options = {}) {
  if (!chantierId || !tacheId) return false;
  const { data, error } = await supabase.from("phasages")
    .select("id, ouvrages").eq("chantier_id", chantierId).maybeSingle();
  if (error || !data?.id) return false;
  let found = false;
  const ouvrages = (data.ouvrages || []).map(o => ({
    ...o,
    taches: (o.taches || []).map(t => {
      if (String(t.id) !== String(tacheId)) return t;
      if (options.onlyIfDate !== undefined && (t.date_prevue || "") !== (options.onlyIfDate || "")) return t;
      found = true;
      return { ...t, date_prevue: dateISO || "" };
    }),
  }));
  if (!found) return false;
  const { error: e2 } = await supabase.from("phasages")
    .update({ ouvrages, updated_at: new Date().toISOString() }).eq("id", data.id);
  if (e2) { console.warn("setDatePrevueTache:", e2.message); return false; }
  return true;
}
