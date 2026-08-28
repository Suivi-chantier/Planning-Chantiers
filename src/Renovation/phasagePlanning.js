// ─── PONT PLANNING SEMAINE ↔ PHASAGE ─────────────────────────────────────────
// Permet à la page Planning (semaine) de proposer les tâches du phasage du
// chantier et d'écrire leur date_prevue quand on les place sur un jour.
// Toute écriture RELIT le phasage depuis la DB juste avant (jamais depuis un
// state local potentiellement périmé — même règle que saveMeta/scheduleSave
// de PhasageV2, incident du 2026-06-03) et ne touche qu'UN champ d'UNE tâche.

import { supabase } from "../supabase";
import { statsGroupeChrono } from "../chantierFinance";

// Les heures/capacités par jour dépendent désormais de la parité de la
// semaine ISO (rythme 4j/5j depuis le 24/08/2026) : voir src/rythmeSemaine.js
// (capaciteJour, profilSemaine) — utilisé par la modale du planning et la
// ligne « Charge » de la grille semaine.

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

// ─── OPÉRATION : chargement groupé des phasages des chantiers frères ─────────
// Pour la vue Chemin de fer : à partir des chantiers d'une opération (objets
// de planning_config/chantiers, déjà filtrés par operation_id et dans l'ordre
// du référentiel), charge leurs phasages en UNE requête (.in, patron
// BilanSemaine) et rend une structure par logement prête à afficher.
// LECTURE SEULE — aucune écriture, aucun state.
//
// Retour : {
//   chantiers: [{
//     chantier,            // l'objet chantier tel quel { id, nom, couleur, … }
//     statut,              // "ok" | "v1" (plan_travaux legacy, non représentable)
//                          //        | "sans_phasage"
//     groupes: [{ id, nom, couleur, ordre, groupe_type_id, taches: […],
//                 debut, fin,            // min/max des date_prevue ("" si aucune)
//                 nbTaches, nbTachesDatees,
//                 heuresEstimees, heuresVendues,
//                 avancement, termine }],// statsGroupeChrono (pondéré h. vendues)
//     tachesHorsGroupe,    // tâches sans chrono_groupe_id reconnu (non barrées)
//     bornes: { debut, fin } // bornes datées du logement (null si rien de daté)
//   }],
//   bornes: { debut, fin },  // bornes de l'OPÉRATION (null si rien de daté)
// }
const isISO = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d);

export async function loadPhasagesOperation(chantiersOperation) {
  const list = (Array.isArray(chantiersOperation) ? chantiersOperation : []).filter(c => c && c.id);
  const vide = { chantiers: [], bornes: { debut: null, fin: null } };
  if (list.length === 0) return vide;

  const { data, error } = await supabase.from("phasages")
    .select("id, chantier_id, ouvrages, plan_travaux")
    .in("chantier_id", list.map(c => c.id));
  if (error) { console.warn("loadPhasagesOperation:", error.message); return vide; }

  // Index par chantier_id — en cas de doublon (deux phasages sur le même
  // chantier, cas réel réparé par la synchro Admin), on garde le premier.
  const parId = {};
  (data || []).forEach(ph => { if (!parId[ph.chantier_id]) parId[ph.chantier_id] = ph; });

  let debutOp = null, finOp = null;
  const rows = list.map(c => {
    const ph = parId[c.id];
    const base = { chantier: c, groupes: [], tachesHorsGroupe: [], bornes: { debut: null, fin: null } };
    if (!ph) return { ...base, statut: "sans_phasage" };

    // V2 exploitable ⟺ ouvrages non vide (pas de champ data_version : c'est
    // LE test utilisé partout — Equipe, BilanSemaine, DashboardAnalyse).
    const ouvrages = Array.isArray(ph.ouvrages) ? ph.ouvrages : [];
    if (ouvrages.length === 0) return { ...base, statut: "v1" };

    const groupesMeta = Array.isArray(ph.plan_travaux?.meta?.chrono_groupes)
      ? ph.plan_travaux.meta.chrono_groupes : [];
    const groupeIds = new Set(groupesMeta.map(g => g.id));

    // Projection légère d'une tâche : ce que le chemin de fer affiche (barre,
    // survol) sans traîner tout le phasage.
    const projette = (t) => ({
      id: t.id,
      nom: t.nom || "",
      date_prevue: isISO(t.date_prevue) ? t.date_prevue.slice(0, 10) : "",
      avancement: Math.max(0, Math.min(100, parseInt(t.avancement) || 0)),
      heures_estimees: parseFloat(t.heures_estimees) || 0,
      heures_vendues: parseFloat(t.heures_vendues) || 0,
      chrono_groupe_id: t.chrono_groupe_id || null,
      chrono_ordre: t.chrono_ordre ?? null,
      ouvriers: Array.isArray(t.ouvriers) ? t.ouvriers : [],
      externe: !!t.externe,
    });
    const toutes = ouvrages.flatMap(o => (o?.taches || []).map(projette));

    let debutCh = null, finCh = null;
    const majBornes = (d) => {
      if (!d) return;
      if (!debutCh || d < debutCh) debutCh = d;
      if (!finCh || d > finCh) finCh = d;
    };

    const groupes = groupesMeta
      .map(g => {
        const taches = toutes
          .filter(t => t.chrono_groupe_id === g.id)
          .sort((a, b) => (a.chrono_ordre ?? 0) - (b.chrono_ordre ?? 0));
        const datees = taches.map(t => t.date_prevue).filter(Boolean).sort();
        datees.forEach(majBornes);
        return {
          id: g.id,
          nom: g.nom || "",
          couleur: g.couleur || "#5b8af5",
          ordre: g.ordre ?? 0,
          groupe_type_id: g.groupe_type_id || null,
          taches,
          debut: datees[0] || "",
          fin: datees[datees.length - 1] || "",
          nbTaches: taches.length,
          nbTachesDatees: datees.length,
          heuresEstimees: taches.reduce((s, t) => s + t.heures_estimees, 0),
          heuresVendues: taches.reduce((s, t) => s + t.heures_vendues, 0),
          ...statsGroupeChrono(g.id, ouvrages), // { count, avancement, termine }
        };
      })
      .sort((a, b) => a.ordre - b.ordre);

    const tachesHorsGroupe = toutes.filter(t => !t.chrono_groupe_id || !groupeIds.has(t.chrono_groupe_id));
    tachesHorsGroupe.map(t => t.date_prevue).filter(Boolean).forEach(majBornes);

    if (debutCh && (!debutOp || debutCh < debutOp)) debutOp = debutCh;
    if (finCh && (!finOp || finCh > finOp)) finOp = finCh;

    return { ...base, statut: "ok", groupes, tachesHorsGroupe, bornes: { debut: debutCh, fin: finCh } };
  });

  return { chantiers: rows, bornes: { debut: debutOp, fin: finOp } };
}

// ─── OPÉRATION : décaler un groupe d'un logement (vue Chemin de fer) ─────────
// Même mécanisme que shiftGroupe de la vue Chronologique (PhasageV2) : décale
// date_prevue de TOUTES les tâches datées du groupe, plus les jalons datés du
// groupe — mais paramétré par chantierId (la vue manipule plusieurs chantiers,
// on écrit dans LE BON phasage, jamais via le saveMeta du Phasage qui est lié
// au chantier affiché).
// Règles d'écriture (incident du 2026-06-03) :
//  - on RELIT le phasage depuis la DB juste avant d'écrire (jamais un state) ;
//  - tâches (colonne ouvrages) + jalons (colonne plan_travaux) partent dans
//    UN SEUL update — pas de double écriture qui pourrait se perdre un patch ;
//  - garde optimiste `expectedDebut` : si le début du groupe en base ne vaut
//    plus ce que la vue affichait, on n'écrit RIEN ({ ok:false, reason:
//    "conflit" }) et l'appelant recharge.
// `jours` : décalage signé. `ouvres:true` → en jours OUVRÉS (jamais de date
// week-end, invisible dans le Gantt) ; sinon calendaires (±7 = même jour de
// semaine). Aucun effet domino : seul CE groupe de CE chantier bouge.
// Retourne { ok, taches } ou { ok:false, reason }.
export async function shiftGroupePhasage(chantierId, groupeId, { jours = 0, ouvres = false, expectedDebut } = {}) {
  if (!chantierId || !groupeId || !jours) return { ok: false, reason: "paramètres invalides" };

  const shiftISO = (s) => {
    const d = new Date(`${s.slice(0, 10)}T00:00:00`);
    if (isNaN(d.getTime())) return s;
    if (ouvres) {
      const step = jours >= 0 ? 1 : -1;
      let left = Math.abs(jours);
      while (left > 0) {
        d.setDate(d.getDate() + step);
        const w = d.getDay();
        if (w !== 0 && w !== 6) left--;
      }
    } else {
      d.setDate(d.getDate() + jours);
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const { data, error } = await supabase.from("phasages")
    .select("id, ouvrages, plan_travaux").eq("chantier_id", chantierId).maybeSingle();
  if (error || !data?.id) return { ok: false, reason: "phasage introuvable" };

  const ouvrages = Array.isArray(data.ouvrages) ? data.ouvrages : [];
  const datees = ouvrages.flatMap(o => o?.taches || [])
    .filter(t => t?.chrono_groupe_id === groupeId && isISO(t.date_prevue))
    .map(t => t.date_prevue.slice(0, 10)).sort();
  if (datees.length === 0) return { ok: false, reason: "aucune tâche datée dans ce groupe" };
  if (expectedDebut !== undefined && datees[0] !== expectedDebut) return { ok: false, reason: "conflit" };

  let taches = 0;
  const nextOuvrages = ouvrages.map(o => ({
    ...o,
    taches: (o?.taches || []).map(t => {
      if (t?.chrono_groupe_id !== groupeId || !isISO(t.date_prevue)) return t;
      taches++;
      return { ...t, date_prevue: shiftISO(t.date_prevue) };
    }),
  }));

  const patch = { ouvrages: nextOuvrages, updated_at: new Date().toISOString() };
  const plan = data.plan_travaux || {};
  const jalons = Array.isArray(plan.meta?.chrono_jalons) ? plan.meta.chrono_jalons : [];
  if (jalons.some(j => (j?.groupe_id ?? null) === groupeId && isISO(j.date))) {
    const nextJalons = jalons.map(j =>
      (j?.groupe_id ?? null) === groupeId && isISO(j.date) ? { ...j, date: shiftISO(j.date) } : j
    );
    patch.plan_travaux = { ...plan, meta: { ...(plan.meta || {}), chrono_jalons: nextJalons } };
  }

  const { error: e2 } = await supabase.from("phasages").update(patch).eq("id", data.id);
  if (e2) { console.warn("shiftGroupePhasage:", e2.message); return { ok: false, reason: e2.message }; }
  return { ok: true, taches };
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

// Toutes les lignes du planning semaine liées à des tâches du phasage d'un
// chantier, indexées par tache_id :
// { [tacheId]: [{ weekId, jour, date, duree, nb }] }.
// `duree` = heures de la journée, `nb` = ouvriers dessus (une ligne sans
// ouvrier assigné vaut pour tous les ouvriers de la cellule) : la
// main-d'œuvre consommée par la ligne est duree × nb. Sert à proposer la
// durée RESTANTE d'une tâche étalée sur plusieurs jours.
export async function planningParTache(chantierId) {
  if (!chantierId) return {};
  const { data, error } = await supabase.from("planning_cells")
    .select("week_id, jour, taches, ouvriers").eq("chantier_id", chantierId);
  if (error || !data) return {};
  const map = {};
  data.forEach(cell => {
    (cell.taches || []).forEach(x => {
      if (!x.tache_id) return;
      const key = String(x.tache_id);
      if (!map[key]) map[key] = [];
      map[key].push({
        weekId: cell.week_id, jour: cell.jour,
        date: dateFromWeekJour(cell.week_id, cell.jour),
        allocation_uid: x.allocation_uid || null,
        legacy_id: x.id || null,
        duree: parseFloat(x.duree) || 0,
        nb: (x.ouvriers && x.ouvriers.length) || (cell.ouvriers && cell.ouvriers.length) || 1,
      });
    });
  });
  return map;
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
