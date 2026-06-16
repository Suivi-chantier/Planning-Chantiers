// Registre de pointage — accès et agrégations.
//
// Une écriture dans `pointages` = (ouvrier, tâche, date, heures, taux figé).
// Coût d'une écriture = heures × taux_horaire (figé à la validation, ne se
// recalcule jamais si le taux d'un ouvrier change ensuite).
//
// Usage typique :
//   const pts = await fetchPointages({ chantier_id });
//   const total = sumHeures(filtrerParTache(pts, tache.id));
//   const cout  = sumCoutMO(filtrerParTache(pts, tache.id));
//
// On pré-charge la liste complète du chantier (ou du périmètre voulu) puis
// on filtre/somme en mémoire : plus efficace qu'une requête par tâche.

import { supabase } from "./supabase";

// ── Récupération ──────────────────────────────────────────────────────────

// Tous les paramètres sont optionnels. Au moins un filtre devrait être passé
// pour éviter de tirer toute la table.
export async function fetchPointages({
  chantier_id,
  phasage_id,
  phase_id,
  tache_id,
  ouvrier,
  date,
  dateFrom,
  dateTo,
  rapport_id,
  type_pointage,
} = {}) {
  let q = supabase.from("pointages").select("*");
  if (chantier_id)   q = q.eq("chantier_id", chantier_id);
  if (phasage_id)    q = q.eq("phasage_id", phasage_id);
  if (phase_id)      q = q.eq("phase_id", phase_id);
  if (tache_id)      q = q.eq("tache_id", tache_id);
  if (ouvrier)       q = q.eq("ouvrier", ouvrier);
  if (date)          q = q.eq("date", date);
  if (dateFrom)      q = q.gte("date", dateFrom);
  if (dateTo)        q = q.lte("date", dateTo);
  if (rapport_id)    q = q.eq("rapport_id", rapport_id);
  if (type_pointage) q = q.eq("type_pointage", type_pointage);
  const { data, error } = await q;
  if (error) {
    console.error("fetchPointages:", error);
    return [];
  }
  return data || [];
}

// ── Filtres purs (sur une liste déjà chargée) ─────────────────────────────

export const filtrerParTache    = (pts, tache_id)    => (pts || []).filter(p => p.tache_id === tache_id);
export const filtrerParPhase    = (pts, phase_id)    => (pts || []).filter(p => p.phase_id === phase_id);
export const filtrerParChantier = (pts, chantier_id) => (pts || []).filter(p => p.chantier_id === chantier_id);
export const filtrerParOuvrier  = (pts, ouvrier)     => (pts || []).filter(p => p.ouvrier === ouvrier);
export const filtrerProductives = (pts)              => (pts || []).filter(p => p.type_pointage !== "indirect");
export const filtrerIndirectes  = (pts)              => (pts || []).filter(p => p.type_pointage === "indirect");

// ── Agrégations pures ─────────────────────────────────────────────────────

export function sumHeures(pts) {
  return (pts || []).reduce((s, p) => s + (parseFloat(p.heures) || 0), 0);
}

export function sumCoutMO(pts) {
  return (pts || []).reduce(
    (s, p) => s + ((parseFloat(p.heures) || 0) * (parseFloat(p.taux_horaire) || 0)),
    0,
  );
}

// ── Helpers d'agrégation par tâche (P8/P9) ────────────────────────────────
//
// Ces helpers permettent à chaque écran qui affichait heures_reelles × ouvriers[0]
// de basculer sur le registre tout en gardant un REPLI legacy : si une tâche
// n'a aucun pointage, on retombe sur l'ancien calcul (heures_reelles × taux
// du premier ouvrier), le temps que les pointages remplacent l'historique.

// Indexe les pointages "tâche" (productifs, non-indirects, avec tache_id) par tache_id
export function indexPointagesParTache(points) {
  const m = {};
  (points || []).forEach(p => {
    if (p.type_pointage === "indirect") return;
    if (!p.tache_id) return; // tâche libre : pas d'imputation au plan
    const k = String(p.tache_id);
    if (!m[k]) m[k] = [];
    m[k].push(p);
  });
  return m;
}

// Heures réelles effectives d'une tâche : somme des pointages si présents,
// sinon ancienne valeur du plan (repli legacy).
export function heuresEff(tache, pointagesParTache) {
  if (!tache) return 0;
  const pts = pointagesParTache?.[String(tache.id)];
  if (pts && pts.length > 0) {
    return pts.reduce((s, p) => s + (parseFloat(p.heures) || 0), 0);
  }
  return parseFloat(tache.heures_reelles) || 0;
}

// Coût MO effectif d'une tâche : somme des pointages × taux figé si présents,
// sinon legacy heures_reelles × taux[ouvriers[0]]. Le repli reproduit l'ancien
// comportement faux (1 seul ouvrier) — mais c'est juste pour préserver l'historique
// affiché tant que les anciens chantiers n'ont pas de pointages.
export function coutMOEff(tache, pointagesParTache, tauxHoraires) {
  if (!tache) return 0;
  const pts = pointagesParTache?.[String(tache.id)];
  if (pts && pts.length > 0) {
    return pts.reduce((s, p) => s + ((parseFloat(p.heures) || 0) * (parseFloat(p.taux_horaire) || 0)), 0);
  }
  const pO = (tache.ouvriers || (tache.ouvrier ? [tache.ouvrier] : []))[0] || "";
  return (parseFloat(tache.heures_reelles) || 0) * (pO ? (tauxHoraires?.[pO] || 0) : 0);
}

// Sommes des heures et coûts pour les pointages "libres" (tache_id null, type tache)
// et "indirects" (type indirect) — au niveau chantier, hors tâches du plan.
export function sumLibreEtIndirect(points) {
  let heuresLibre = 0, coutLibre = 0, heuresIndirect = 0, coutIndirect = 0;
  (points || []).forEach(p => {
    const h = parseFloat(p.heures) || 0;
    const c = h * (parseFloat(p.taux_horaire) || 0);
    if (p.type_pointage === "indirect") { heuresIndirect += h; coutIndirect += c; }
    else if (!p.tache_id) { heuresLibre += h; coutLibre += c; }
  });
  return { heuresLibre, coutLibre, heuresIndirect, coutIndirect };
}

// ── Stats composées (récupération + agrégation en un appel) ───────────────

export async function statsTache({ chantier_id, tache_id }) {
  const pts = await fetchPointages({ chantier_id, tache_id });
  return { heures: sumHeures(pts), cout: sumCoutMO(pts), nb: pts.length, pointages: pts };
}

export async function statsPhase({ chantier_id, phase_id }) {
  const pts = await fetchPointages({ chantier_id, phase_id });
  return { heures: sumHeures(pts), cout: sumCoutMO(pts), nb: pts.length, pointages: pts };
}

export async function statsChantier({ chantier_id }) {
  const pts = await fetchPointages({ chantier_id });
  return { heures: sumHeures(pts), cout: sumCoutMO(pts), nb: pts.length, pointages: pts };
}
