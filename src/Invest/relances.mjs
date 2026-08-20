// src/Invest/relances.mjs — Règles de relance, d'une phrase à un calcul.
//
// Extension .mjs : parsable en ESM par Node sans build, pour que la veille
// quotidienne (CommonJS) l'importe via `await import()`. Même convention que
// annuaire.mjs et chantierFinance.mjs. Le front l'utilise pour AFFICHER ce
// qu'une règle va réellement déclencher.
//
// ── Le problème ─────────────────────────────────────────────────────────────
// Les modèles de mission du CRM décrivent le suivi avec précision : « J+2 puis
// J+5 si non reçue », « Hebdomadaire », « Alerte si pièce essentielle
// manquante ». Soixante-six règles de ce genre, stockées en texte libre dans
// `relance_rule`, affichées avec une cloche, recopiées dans les e-mails — et
// lues par aucun moteur. C'était une intention documentée, pas un mécanisme.
//
// ── Ce qui est réellement calculable, et ce qui ne l'est pas ────────────────
// Le relevé des 59 règles distinctes donne trois familles :
//
//   • OFFSETS      « J+3 si mandat non signé », « J+5 / J+10 / J+15 »
//                  → calculable : des jours après une date connue.
//   • RÉCURRENCE   « Hebdomadaire », « Chaque semaine si aucun bien présenté »
//                  → calculable : tous les N jours tant que c'est ouvert.
//   • ÉVÉNEMENT    « Avant dépôt urbanisme », « Dès réception acte »,
//                  « Selon statut bancaire »
//                  → NON calculable : la condition porte sur un fait extérieur
//                    que l'application ne connaît pas. Une trentaine de règles.
//
// On ne prétend pas exécuter la troisième famille. Elle reste affichée comme
// note, et `executable` vaut faux — mieux vaut vingt relances qui partent
// vraiment que soixante-six qui prétendent partir.
//
// ── Condition d'arrêt ───────────────────────────────────────────────────────
// Relancer sur « document non reçu » suppose de savoir s'il est arrivé. Deux
// signaux existent en base, et seulement deux :
//   • action_terminee  → status ∈ (fait, non_concerne). Universel.
//   • document_recu    → justificatif_drive_url renseigné, quand
//                        document_drive_attendu est vrai.
// Toute autre condition retombe sur action_terminee : on relance tant que la
// tâche est ouverte, ce qui est le comportement le moins faux.

/* ============ Analyse d'une règle écrite en français ============ */

const RE_JOURS = /J\s*\+\s*(\d+)/gi;
const RE_HEBDO = /hebdomadaire|chaque semaine/i;
const RE_QUOTIDIEN = /quotidien|chaque jour/i;

// Vocabulaire qui désigne un document attendu plutôt qu'une tâche à faire.
const RE_DOCUMENT = /re[çc]ue?s?\b|absent du drive|non re[çc]u|pi[èe]ce|justificatif|document/i;

export const ARRET_ACTION = "action_terminee";
export const ARRET_DOCUMENT = "document_recu";

/**
 * Traduit `relance_rule` en règle exécutable.
 *
 * Renvoie toujours un objet — jamais null : l'appelant doit pouvoir afficher
 * quelque chose même pour une règle non calculable.
 *
 * @returns {{executable:boolean, offsets:number[], recurrence:number|null,
 *            arret:string, note:string, raison:string}}
 */
export function analyserRelance(texte) {
  const brut = String(texte || "").trim();
  const vide = { executable: false, offsets: [], recurrence: null, arret: ARRET_ACTION, note: brut, raison: "" };

  if (!brut) return { ...vide, raison: "aucune règle" };
  // « 🔔 » seul : reliquat de saisie, pas une règle.
  if (!/[a-zA-Z0-9]/.test(brut)) return { ...vide, raison: "règle vide" };

  const arret = RE_DOCUMENT.test(brut) ? ARRET_DOCUMENT : ARRET_ACTION;

  // Récurrence — prioritaire : « Hebdomadaire » n'a pas d'offset.
  if (RE_HEBDO.test(brut)) return { executable: true, offsets: [], recurrence: 7, arret, note: brut, raison: "" };
  if (RE_QUOTIDIEN.test(brut)) return { executable: true, offsets: [], recurrence: 1, arret, note: brut, raison: "" };

  // Offsets « J+n », dans l'ordre croissant et sans doublon.
  const trouves = [...brut.matchAll(RE_JOURS)].map(m => Number(m[1])).filter(n => n > 0 && n <= 365);
  if (trouves.length) {
    const offsets = [...new Set(trouves)].sort((a, b) => a - b);
    return { executable: true, offsets, recurrence: null, arret, note: brut, raison: "" };
  }

  return { ...vide, arret, raison: "condition sur un événement extérieur" };
}

/* ============ Ce qui est dû aujourd'hui ============ */

function jourISO(d) { return new Date(d).toISOString().slice(0, 10); }

function ajouterJours(iso, n) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1) + n * 86400000).toISOString().slice(0, 10);
}

function ecartJours(aIso, bIso) {
  const ms = (iso) => {
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    return Date.UTC(y, (m || 1) - 1, d || 1);
  };
  return Math.round((ms(bIso) - ms(aIso)) / 86400000);
}

const TERMINEE = ["fait", "non_concerne"];

/**
 * La condition d'arrêt est-elle atteinte ? Si oui, plus aucune relance.
 */
export function relanceArretee(action, arret) {
  if (TERMINEE.includes(action?.status)) return true;
  if (arret === ARRET_DOCUMENT) {
    // Le document n'est un signal que s'il était attendu. Sinon on retombe sur
    // « tant que la tâche est ouverte », déjà testé ci-dessus.
    if (action?.document_drive_attendu && action?.justificatif_drive_url) return true;
  }
  return false;
}

/**
 * Une relance doit-elle partir aujourd'hui pour cette action ?
 *
 * @param {object} action  ligne invest_mission_actions
 * @param {string} today   date du jour, ISO court
 * @returns {{due:boolean, echeance:string, rang:number, motif:string}|null}
 */
export function relanceDue(action, today = jourISO(new Date())) {
  if (!action) return null;
  // Interrupteur explicite posé à la création de l'action.
  if (action.due_reminder_enabled === false) return null;

  const regle = analyserRelance(action.relance_rule);
  if (!regle.executable) return null;
  if (relanceArretee(action, regle.arret)) return null;

  // Les offsets se comptent depuis l'échéance de l'action : « J+3 si mandat non
  // signé » veut dire trois jours après la date à laquelle il aurait dû l'être.
  const base = action.due_date;
  if (!base) return null;

  const dejaEnvoyee = action.last_reminder_sent_at
    ? jourISO(action.last_reminder_sent_at) : null;

  if (regle.recurrence) {
    // Première relance à base + recurrence, puis tous les `recurrence` jours.
    const depuis = ecartJours(base, today);
    if (depuis < regle.recurrence) return null;
    // Une seule par période : si la dernière date de moins d'une période, on attend.
    if (dejaEnvoyee && ecartJours(dejaEnvoyee, today) < regle.recurrence) return null;
    return {
      due: true, echeance: today,
      rang: Math.floor(depuis / regle.recurrence),
      motif: `relance périodique (tous les ${regle.recurrence} jours)`,
    };
  }

  // Offsets : on cherche le plus grand palier atteint et non encore couvert.
  //
  // Le rattrapage compte : si personne n'a lancé le cron pendant une semaine,
  // une action qui a franchi J+2 ET J+5 doit produire UNE relance — celle de
  // J+5, la plus avancée — et non deux, ni celle de J+2.
  let palier = null;
  for (const offset of regle.offsets) {
    const dateOffset = ajouterJours(base, offset);
    if (dateOffset > today) break;                       // pas encore atteint
    if (dejaEnvoyee && dateOffset <= dejaEnvoyee) continue; // déjà couvert
    palier = { offset, dateOffset };
  }
  if (!palier) return null;

  return {
    due: true,
    echeance: palier.dateOffset,
    rang: regle.offsets.indexOf(palier.offset) + 1,
    motif: `relance J+${palier.offset}${regle.offsets.length > 1 ? ` (${regle.offsets.indexOf(palier.offset) + 1}ᵉ sur ${regle.offsets.length})` : ""}`,
  };
}

/**
 * Phrase lisible décrivant ce qu'une règle va réellement faire — affichée à
 * côté de la règle brute, pour que l'écart entre l'intention écrite et le
 * comportement réel soit visible sans lire le code.
 */
export function decrireRelance(texte) {
  const r = analyserRelance(texte);
  if (!r.executable) {
    return r.raison === "aucune règle" ? "" : `note seule — ${r.raison}`;
  }
  const arret = r.arret === ARRET_DOCUMENT
    ? "jusqu'au dépôt du justificatif"
    : "jusqu'à clôture de la tâche";
  if (r.recurrence) {
    return `relance tous les ${r.recurrence} jours après l'échéance, ${arret}`;
  }
  const liste = r.offsets.map(o => `J+${o}`).join(", ");
  return `relance à ${liste} après l'échéance, ${arret}`;
}
