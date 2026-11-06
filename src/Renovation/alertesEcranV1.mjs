// ─────────────────────────────────────────────────────────────────────────────
// alertesEcranV1 — la chaîne de calcul de la page Alertes, sortie du composant
// React (projet docs/projets/notifications-push.md, tâche 6, règle 3).
//
// POURQUOI CE MODULE. Jusqu'ici, le choix des deux semaines, la fenêtre de
// lecture des relevés journaliers, le filtre « chantier actif » et l'appel
// alertesMargesV2 → alertesV1 vivaient dans PageAlertes.jsx. Le job serveur
// des notifications C4 / C5 / D1 doit obtenir EXACTEMENT les mêmes niveaux que
// l'écran : on déplace ce code ici, SANS le réécrire, et l'écran comme le
// serveur l'appellent. Une seule chaîne, une seule vérité.
//
// Rien de nouveau n'est détecté ici : la détection reste dans
// alertesMargesV2 / pointsAttentionV1, le classement dans alertesV1.
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord. La
// semaine courante, les relevés, les seuils et le référentiel des chantiers
// arrivent en paramètre. Façade front : alertesEcranV1.js.
// ─────────────────────────────────────────────────────────────────────────────

import { preparerSemainesRelevesJournaliersV2, dimancheSemaineISOV2 } from "./pointsAttentionDonneesV1.mjs";
import { alertesMargesV2 } from "./alertesMargesV2.mjs";
import { alertesV1 } from "./alertesV1.mjs";
import { estChantierActif } from "./chantierActif.mjs";
import { lundiSemaineISOv1, ajouterJoursV1 } from "./bilanSemaineProchaineV1.mjs";
import { getISOWeek } from "../rythmeSemaine.mjs";

export const ALERTES_ECRAN_VERSION = "v1";

// Chantiers jamais affichés (DÉPOT est le stock interne). MÊME LISTE que
// CHANTIERS_EXCLUS de PageAlertes.jsx, qui garde sa copie littérale (contrôlée
// par scripts/verif-renovation-copilot-v1.mjs) ; l'égalité est vérifiée par
// scripts/verif-alertes-chantiers.mjs.
export const CHANTIERS_EXCLUS_ALERTES_V1 = Object.freeze(["DÉPOT"]);

// Fenêtre de lecture : du dimanche de la semaine précédente moins 27 jours
// (un chantier à l'arrêt garde son dernier relevé) au dimanche de la semaine
// courante.
const JOURS_AVANT_PRECEDENTE = -27;

const weekIdDe = (iso) => {
  if (!iso) return null;
  const { year, week } = getISOWeek(iso);
  return `${year}-W${String(week).padStart(2, "0")}`;
};

/**
 * Semaine ISO « AAAA-Www » d'une date « AAAA-MM-JJ » (serveur : date de Paris).
 */
export function semaineDeLaDateV1(dateISO) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dateISO || "").slice(0, 10)) ? weekIdDe(String(dateISO).slice(0, 10)) : null;
}

/**
 * Les deux semaines comparées : [courante, précédente] (même mécanisme que le
 * Bilan Semaine). Semaine illisible → [courante] seule.
 */
export function semainesAlertesV1(semaineCourante) {
  const lundi = lundiSemaineISOv1(semaineCourante);
  const precedente = lundi ? weekIdDe(ajouterJoursV1(lundi, -7)) : null;
  return precedente ? [semaineCourante, precedente] : [semaineCourante];
}

/** Période de lecture des relevés journaliers : { debut, fin } (AAAA-MM-JJ). */
export function periodeRelevesAlertesV1(semaines) {
  const fin = dimancheSemaineISOV2(semaines[0]);
  const debut = ajouterJoursV1(dimancheSemaineISOV2(semaines[semaines.length - 1]), JOURS_AVANT_PRECEDENTE);
  return { debut, fin };
}

/**
 * Le calcul de la page Alertes.
 * @param {object} p
 * @param {Array}  p.lignes               relevés journaliers lus (chargerRelevesRetenusV2 ou équivalent)
 * @param {Array}  p.semaines             [courante, précédente] (semainesAlertesV1)
 * @param {object} [p.seuilsMarges]       planning_config.seuils_marges (null = défauts)
 * @param {Array}  [p.referentielChantiers] chantiers (non archivés) ; null = aucun filtre
 * @param {Array}  [p.exclusions]         chantiers jamais affichés
 * @returns {{ resultat: object, courants: Array, precedents: Array }}
 */
export function calculerAlertesEcranV1({ lignes, semaines, seuilsMarges = null, referentielChantiers = null, exclusions = CHANTIERS_EXCLUS_ALERTES_V1 } = {}) {
  // preparerSemainesRelevesJournaliersV2 rend UN TABLEAU par semaine demandée,
  // dans l'ordre de `weekIds` : [0] = semaine courante, [1] = précédente.
  const [courantsBruts, precedentsBruts] = preparerSemainesRelevesJournaliersV2({ lignes, weekIds: semaines });
  // Règle unique estChantierActif() : un relevé d'un chantier connu mais
  // hors des listes (lot 2 : à l'étude, perdu) ne donne pas d'alerte. Un
  // chantier absent du référentiel garde ses alertes (comme avant).
  const parId = new Map((referentielChantiers || []).map(c => [String(c?.id), c]));
  const garder = (s) => { const c = parId.get(String(s?.chantier_id)); return !c || estChantierActif(c, { inclureTermines: true }); };
  const courants = (courantsBruts || []).filter(garder);
  const precedents = (precedentsBruts || []).filter(garder);
  // Détection : alertes des marges (étape 2) ; classement : alertesV1.
  const pointsAttention = alertesMargesV2({
    snapshotsCourants: courants || [], snapshotsPrecedents: precedents || [], seuils: seuilsMarges,
  });
  const resultat = alertesV1({
    snapshotsCourants: courants || [],
    snapshotsPrecedents: precedents || [],
    pointsAttention,
    exclusions: [...(exclusions || [])],
  });
  return { resultat, courants, precedents };
}
