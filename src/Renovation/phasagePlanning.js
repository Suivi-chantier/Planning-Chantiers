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
