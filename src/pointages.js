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
// Les agrégations pures (index par tâche, sommes, libres/indirects) vivent
// dans le module de calcul unique src/chantierFinance.js : on les ré-exporte
// ici pour garder les imports historiques valides sans dupliquer les formules.
import {
  indexPointagesParTache,
  sumLibreEtIndirect,
  sumHeures,
  sumCoutMO,
} from "./chantierFinance.mjs";

export { indexPointagesParTache, sumLibreEtIndirect, sumHeures, sumCoutMO };

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

// ── Helpers d'agrégation par tâche (P8/P9) ────────────────────────────────
//
// Ces helpers permettent à chaque écran qui affichait heures_reelles × ouvriers[0]
// de basculer sur le registre tout en gardant un REPLI legacy : si une tâche
// n'a aucun pointage, on retombe sur l'ancien calcul (heures_reelles × taux
// du premier ouvrier), le temps que les pointages remplacent l'historique.
// ⚠️ Ce repli ouvriers[0] diffère volontairement de celui de PhasageV2 (tous
// les ouvriers assignés) — il ne sert plus qu'aux écrans V1 legacy.

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

// ── Construction des lignes de pointages d'un rapport ─────────────────────
//
// Source unique de vérité pour transformer un rapport validé en écritures
// `pointages`. Utilisée à la validation (Validation.jsx) ET par l'outil de
// ré-génération (Admin → Pointages), pour éviter toute divergence de logique.
//
// Règles encapsulées :
//  1. FUSION des tâches doublons — plusieurs lignes du même rapport pointant la
//     même tâche du plan (même `phase_id::tache_id`) sont additionnées. Sinon
//     deux pointages partageraient (rapport_id, tache_id, ouvrier, date) et
//     violeraient l'index unique `uniq_pointages_rapport_tache` : l'INSERT du
//     lot entier échouerait (23505) → rapport « validé » mais sans aucune heure.
//     Les tâches libres (tache_id null) ne sont pas couvertes par l'index → on
//     les garde distinctes.
//  2. Trajet réparti en CENTIMES exacts (plus grand reste) entre les chantiers
//     du jour, PONDÉRÉ par le temps passé sur chaque chantier — un chantier à 0h
//     ne porte aucun trajet ; deux chantiers à 5h partagent le trajet moitié-
//     moitié. La somme des quote-parts = exactement le trajet total du jour
//     (fini les journées à 9,99 / 10,01 h dues à l'arrondi numeric(6,2)).
//
// Renvoie le tableau des lignes prêtes pour `insert`.
export function buildPointagesRapport({
  chantier_id, ouvrier, dateISO, taux = 0, phasage_id = null, rapport_id, valide_par = null,
  taskLines = [],       // [{ tache_id, phase_id, heures, avancement_declare }]
  indirectLines = [],   // [{ motif, heures }]
  trajetMinTotal = 0,   // minutes de trajet total du jour (posé identiquement sur chaque rapport)
  nbChantiersDuJour = 1,
  rangRapport = 0,      // index de CE rapport dans le tri stable des rapports du même jour
  heuresParRapportDuJour = null, // [h0, h1, …] heures travaillées de chaque rapport du jour (tri stable) → pondération du trajet. À défaut : parts égales.
}) {
  const base = { chantier_id, phasage_id, ouvrier, date: dateISO, taux_horaire: taux, rapport_id, valide_par };

  // 1) Tâches — fusion des doublons par (phase_id::tache_id). Tâches libres à part.
  const fusion = new Map();
  const libres = [];
  (taskLines || []).forEach(li => {
    const h = parseFloat(li.heures) || 0;
    if (h <= 0) return;
    const av = li.avancement_declare != null && li.avancement_declare !== "" ? parseInt(li.avancement_declare) : null;
    const entry = { tache_id: li.tache_id || null, phase_id: li.phase_id || null, h, av };
    if (!entry.tache_id) { libres.push(entry); return; }
    const key = `${entry.phase_id || ""}::${entry.tache_id}`;
    const cur = fusion.get(key);
    if (cur) {
      cur.h += h;
      if (av != null) cur.av = cur.av == null ? av : Math.max(cur.av, av);
    } else {
      fusion.set(key, entry);
    }
  });
  const mkTache = (e) => ({
    ...base, phase_id: e.phase_id, tache_id: e.tache_id,
    heures: e.h, avancement_declare: e.av, type_pointage: "tache",
  });
  const lignesTaches = [...[...fusion.values()].map(mkTache), ...libres.map(mkTache)];

  // 2) Heures indirectes saisies (motif + heures).
  const lignesIndirectes = (indirectLines || [])
    .filter(li => (parseFloat(li.heures) || 0) > 0 && (li.motif || "").trim())
    .map(li => ({
      ...base, phase_id: null, tache_id: null,
      heures: parseFloat(li.heures), avancement_declare: null,
      type_pointage: "indirect", motif_indirect: li.motif.trim(),
    }));

  // 3) Trajet — quote-part exacte en centimes, PONDÉRÉE par le temps passé sur
  //    chaque chantier du jour (plus grand reste). Un rapport à 0h ne porte
  //    aucun trajet ; à défaut d'infos horaires on retombe sur des parts égales.
  const nb = Math.max(1, nbChantiersDuJour);
  const heuresJour = Array.isArray(heuresParRapportDuJour) && heuresParRapportDuJour.length
    ? heuresParRapportDuJour
    : Array(nb).fill(1); // pas d'infos → parts égales (comportement historique)
  const centsParRapport = repartTrajetCents(trajetMinTotal, heuresJour);
  const trajetH = (centsParRapport[rangRapport] || 0) / 100;
  const lignesTrajet = trajetH > 0 ? [{
    ...base, phase_id: null, tache_id: null,
    heures: trajetH, avancement_declare: null,
    type_pointage: "indirect", motif_indirect: nb > 1 ? "Trajet (quote-part)" : "Trajet",
  }] : [];

  return [...lignesTaches, ...lignesIndirectes, ...lignesTrajet];
}

// Répartit le trajet total (minutes) entre les rapports d'un même jour, en
// CENTIMES d'heure, pondéré par le temps travaillé de chaque rapport.
// Renvoie un tableau de centimes aligné sur `heuresParRapport` (même ordre).
//   • poids = heures travaillées → un rapport à 0h reçoit 0 (trajet non compté).
//   • plus grand reste → la somme des centimes = exactement le trajet total.
//   • journée entière à 0h (cas dégénéré : trajet sans heures) → parts égales,
//     pour ne pas perdre le trajet.
export function repartTrajetCents(trajetMin, heuresParRapport) {
  const hrs = (heuresParRapport || []).map(h => Math.max(0, parseFloat(h) || 0));
  const n = hrs.length;
  const out = new Array(n).fill(0);
  const totalCents = Math.round(((parseInt(trajetMin) || 0) / 60) * 100);
  if (n === 0 || totalCents <= 0) return out;

  const totalH = hrs.reduce((s, h) => s + h, 0);
  const poids = totalH > 0 ? hrs : hrs.map(() => 1);
  const totalPoids = totalH > 0 ? totalH : n;

  const exact = poids.map(p => (totalCents * p) / totalPoids);
  const cents = exact.map(Math.floor);
  let reste = totalCents - cents.reduce((s, c) => s + c, 0);
  // Les centimes restants vont aux rapports dont la partie fractionnaire est la
  // plus grande (départage stable par index). Un rapport à poids nul a une
  // fraction nulle → il ne reçoit jamais de centime.
  const ordre = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < ordre.length && reste > 0; k++) {
    cents[ordre[k].i] += 1;
    reste -= 1;
  }
  return cents;
}

// Heures DÉCLARÉES d'un rapport hors trajet : tâches + heures indirectes saisies.
// Sert de poids à la répartition pondérée du trajet.
export function heuresDeclareesRapport(r) {
  return (r?.taches || []).reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0)
    + (r?.heures_indirectes || []).reduce((s, h) => s + (parseFloat(h.heures) || 0), 0);
}

// Rang stable d'un rapport parmi les rapports du même ouvrier/jour (tri par id).
// Sert à la répartition déterministe du trajet, indépendante de l'ordre de
// validation.
export function rangRapportDuJour(rapport, rapportsMemeJour) {
  return [...(rapportsMemeJour || [])]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .findIndex(r => r.id === rapport.id);
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
