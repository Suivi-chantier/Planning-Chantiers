// ─────────────────────────────────────────────────────────────────────────────
// alertesChantiersPushV1 — décisions des notifications C4, C5 et D1 (projet
// docs/projets/notifications-push.md, tâche 6).
//
//   C4 : un chantier PASSE en alerte critique      (aucun ou à surveiller → critique)
//   C5 : un chantier PASSE en alerte « à surveiller » (aucun → à surveiller)
//   D1 : la marge à terminaison d'un chantier DEVIENT négative (≥ 0 → < 0)
//
// RÈGLE 2 : on notifie un CHANGEMENT d'état, jamais un état qui dure. Une
// amélioration ne déclenche rien ; l'état stocké est simplement mis à jour,
// pour qu'une rechute future soit notifiée.
//
// RÈGLE 3 : aucune détection ici. Le niveau vient du résultat d'alertesV1
// (calculé par alertesEcranV1, la chaîne de la page Alertes) ; la marge à
// terminaison est la colonne marge_terminaison du relevé journalier retenu,
// celle qu'affichent la page Alertes et le Bilan semaine. Rien n'est recalculé.
//
// RANGEMENT DANS public.notifications_etat (table générique de la tâche 7) :
//   - type « C4 », cle_objet = id du chantier, etat = dernier NIVEAU vu
//     (« critique », « a_surveiller » ou « aucun »). Une seule ligne par
//     chantier porte le niveau, pour C4 ET C5 : ce sont deux seuils d'une même
//     échelle, deux lignes pourraient se contredire.
//   - type « D1 », cle_objet = id du chantier, etat = dernier SIGNE connu de
//     la marge à terminaison (« negative » ou « positive »). Une marge
//     INCONNUE n'est ni l'un ni l'autre : elle n'écrase pas le dernier signe
//     connu et ne déclenche rien ; elle est comptée « inconnue » dans la
//     réponse du job (une impossibilité reste visible).
//   - notifie_le : date de la dernière notification de ce chantier pour ce
//     type ; maj_le : dernier passage qui a changé l'état.
//
// PREMIER PASSAGE : aucune ligne C4 / C5 / D1 en base → on enregistre l'état
// de tous les chantiers SANS RIEN ENVOYER (sinon tous les chantiers déjà en
// alerte partiraient d'un coup). De même, un chantier vu pour la première fois
// (aucune ligne à son nom) est enregistré sans notification : on ne connaît
// pas son état d'avant.
//
// RÈGLE 5 : une seule notification par type et par passage, qui regroupe les
// chantiers (« 2 chantiers passent en critique : X, Y »), clé de regroupement
// « <type>-<date de Paris> ». Un seul chantier : lien vers sa fiche. Plusieurs :
// page Alertes (C4, C5) ou Bilan semaine (D1, la page qui montre la marge à
// terminaison de chaque chantier).
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord.
// ─────────────────────────────────────────────────────────────────────────────

import { NIVEAU_CRITIQUE, NIVEAU_A_SURVEILLER, estExcluV1 } from "./alertesV1.mjs";
import { formaterEurosV1 } from "./pointsAttentionV1.mjs";
import { lienPage } from "../../supabase/functions/_partage/notificationsPushV1.mjs";

export const ALERTES_CHANTIERS_PUSH_VERSION = "v1";

/** Types de notifications_etat utilisés (le niveau est rangé sous C4). */
export const TYPE_ETAT_NIVEAU = "C4";
export const TYPE_ETAT_MARGE = "D1";
export const TYPES_ETAT_ALERTES = Object.freeze(["C4", "C5", "D1"]);

export const NIVEAU_AUCUN = "aucun";
export const MARGE_NEGATIVE = "negative";
export const MARGE_POSITIVE = "positive";
export const MARGE_INCONNUE = "inconnue";

// Échelle de gravité : seule une montée sur cette échelle est notifiée.
const RANG_NIVEAU = Object.freeze({ [NIVEAU_AUCUN]: 0, [NIVEAU_A_SURVEILLER]: 1, [NIVEAU_CRITIQUE]: 2 });

const LIMITE_TITRE = 120;
const LIMITE_TEXTE = 1000; // send-push refuse au-delà

const str = (v) => (v == null ? "" : String(v).trim());
const nombreOuNull = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Niveau de notification d'une alerte : « info » ou pas d'alerte → « aucun ». */
export function niveauNotificationV1(alerte) {
  const n = alerte?.niveau;
  return n === NIVEAU_CRITIQUE || n === NIVEAU_A_SURVEILLER ? n : NIVEAU_AUCUN;
}

/** Signe de la marge à terminaison : négative, positive (≥ 0) ou inconnue. */
export function signeMargeV1(margeTerminaison) {
  const m = nombreOuNull(margeTerminaison);
  if (m == null) return MARGE_INCONNUE;
  return m < 0 ? MARGE_NEGATIVE : MARGE_POSITIVE;
}

/**
 * État actuel de chaque chantier vu par la page Alertes cette semaine.
 * @param {{ resultat: object, courants: Array, exclusions?: Array }} p
 *   resultat / courants : sortie de calculerAlertesEcranV1.
 * Un chantier exclu (DÉPOT) ou repris n'a pas d'état : il n'est jamais notifié.
 * Un chantier sans relevé n'est pas dans `courants` : son état stocké reste tel quel.
 */
export function etatsChantiersV1({ resultat, courants, exclusions = [] } = {}) {
  const alertesParId = new Map((resultat?.alertes || []).map((a) => [str(a.chantierId), a]));
  const etats = [];
  const vus = new Set();
  for (const snap of courants || []) {
    const id = str(snap?.chantier_id);
    if (!id || vus.has(id)) continue;
    if (estExcluV1(snap, exclusions) || snap.chantier_repris === true) continue;
    vus.add(id);
    const alerte = alertesParId.get(id) || null;
    etats.push({
      chantierId: id,
      nom: str(snap.chantier_nom) || id,
      niveau: niveauNotificationV1(alerte),
      marge: signeMargeV1(snap.marge_terminaison),
      margeTerminaison: nombreOuNull(snap.marge_terminaison),
      avancement: nombreOuNull(snap.avancement),
      dateReleve: str(snap.date_releve).slice(0, 10) || null,
    });
  }
  return etats;
}

function listeTronquee(lignes) {
  const sortie = [];
  let taille = 0;
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    const ajout = (sortie.length ? 1 : 0) + l.length;
    if (taille + ajout + (i < lignes.length - 1 ? 20 : 0) > LIMITE_TEXTE) {
      const restants = lignes.length - i;
      sortie.push(`… et ${restants} autre${restants > 1 ? "s" : ""}`);
      break;
    }
    sortie.push(l);
    taille += ajout;
  }
  return sortie.join("\n").slice(0, LIMITE_TEXTE);
}

const tronquerTitre = (t) => (t.length > LIMITE_TITRE ? `${t.slice(0, LIMITE_TITRE - 1)}…` : t);

/** Clé de regroupement : une notification par type et par jour de Paris. */
export const cleRegroupementAlertesV1 = (type, dateParis) => `${type}-${dateParis}`;

/**
 * Contenu de LA notification d'un type pour ce passage.
 * @param {"C4"|"C5"|"D1"} type
 * @param {Array} chantiers  états (etatsChantiersV1) qui viennent de s'aggraver
 * @param {string} dateParis AAAA-MM-JJ
 */
export function contenuNotificationAlertesV1(type, chantiers, dateParis) {
  const liste = chantiers || [];
  if (!liste.length) return null;
  const n = liste.length;
  const un = n === 1 ? liste[0] : null;
  let titre, lignes, lienMulti;
  if (type === "D1") {
    titre = un ? `Marge à terminaison négative : ${un.nom}` : `${n} chantiers passent en marge à terminaison négative`;
    lignes = liste.map((c) => `${c.nom} · marge à terminaison ${formaterEurosV1(c.margeTerminaison)}`
      + (c.avancement != null ? ` · avancement ${c.avancement} %` : ""));
    lienMulti = lienPage("bilan-semaine");
  } else if (type === "C4") {
    titre = un ? `Chantier passé en critique : ${un.nom}` : `${n} chantiers passent en critique`;
    lignes = liste.map((c) => c.nom);
    lienMulti = lienPage("alertes");
  } else if (type === "C5") {
    titre = un ? `Chantier à surveiller : ${un.nom}` : `${n} chantiers passent « à surveiller »`;
    lignes = liste.map((c) => c.nom);
    lienMulti = lienPage("alertes");
  } else {
    return null;
  }
  return {
    type,
    titre: tronquerTitre(titre),
    texte: listeTronquee(lignes),
    lien: un ? lienPage("chantiers", { chantier: un.chantierId }) : lienMulti,
    cle_regroupement: cleRegroupementAlertesV1(type, dateParis),
    chantiers: liste.map((c) => c.chantierId),
  };
}

/**
 * Le plan d'un passage : quoi notifier, quoi enregistrer.
 * @param {object} p
 * @param {Array}  p.etats         etatsChantiersV1
 * @param {Array}  p.etatsStockes  lignes notifications_etat des types C4, C5, D1 ({ type, cle_objet, etat })
 * @param {string} p.dateParis     AAAA-MM-JJ
 * @returns {{
 *   premierPassage: boolean,
 *   notifications: Array<object>,            // une par type au plus (C4, C5, D1)
 *   aggravations: { C4: Array, C5: Array, D1: Array },
 *   ecritures: Array<{ type, cle_objet, etat, notifiePar: string|null }>,
 *   comptes: object,
 * }}
 *  `notifiePar` = type de la notification qui porte ce changement (C4, C5 ou
 *  D1), null pour un simple enregistrement (amélioration, état nouveau,
 *  premier passage).
 */
export function planAlertesChantiersV1({ etats, etatsStockes, dateParis } = {}) {
  const stockes = (etatsStockes || []).filter((l) => TYPES_ETAT_ALERTES.includes(l?.type));
  const premierPassage = stockes.length === 0;
  const niveauStocke = new Map();
  const margeStockee = new Map();
  for (const l of stockes) {
    if (l.type === TYPE_ETAT_NIVEAU && l.etat in RANG_NIVEAU) niveauStocke.set(str(l.cle_objet), l.etat);
    if (l.type === TYPE_ETAT_MARGE && (l.etat === MARGE_NEGATIVE || l.etat === MARGE_POSITIVE)) margeStockee.set(str(l.cle_objet), l.etat);
  }

  const aggravations = { C4: [], C5: [], D1: [] };
  const ecritures = [];
  const comptes = {
    chantiers: 0,
    niveaux: { [NIVEAU_CRITIQUE]: 0, [NIVEAU_A_SURVEILLER]: 0, [NIVEAU_AUCUN]: 0 },
    marges: { [MARGE_NEGATIVE]: 0, [MARGE_POSITIVE]: 0, [MARGE_INCONNUE]: 0 },
    ameliorations: 0,
    nouveaux: 0,
  };

  for (const e of etats || []) {
    comptes.chantiers++;
    comptes.niveaux[e.niveau] = (comptes.niveaux[e.niveau] || 0) + 1;
    comptes.marges[e.marge] = (comptes.marges[e.marge] || 0) + 1;

    // ── Niveau (C4 / C5) ──────────────────────────────────────────────────
    const avant = niveauStocke.get(e.chantierId);
    if (avant === undefined) {
      if (!premierPassage) comptes.nouveaux++;
      ecritures.push({ type: TYPE_ETAT_NIVEAU, cle_objet: e.chantierId, etat: e.niveau, notifiePar: null });
    } else if (avant !== e.niveau) {
      let notifiePar = null;
      if (RANG_NIVEAU[e.niveau] > RANG_NIVEAU[avant]) {
        notifiePar = e.niveau === NIVEAU_CRITIQUE ? "C4" : "C5";
        aggravations[notifiePar].push(e);
      } else {
        comptes.ameliorations++;
      }
      ecritures.push({ type: TYPE_ETAT_NIVEAU, cle_objet: e.chantierId, etat: e.niveau, notifiePar });
    }

    // ── Marge à terminaison (D1) ──────────────────────────────────────────
    if (e.marge === MARGE_INCONNUE) continue; // ni oui ni non : rien n'est écrit, rien ne part
    const margeAvant = margeStockee.get(e.chantierId);
    if (margeAvant === undefined) {
      ecritures.push({ type: TYPE_ETAT_MARGE, cle_objet: e.chantierId, etat: e.marge, notifiePar: null });
    } else if (margeAvant !== e.marge) {
      let notifiePar = null;
      if (margeAvant === MARGE_POSITIVE && e.marge === MARGE_NEGATIVE) {
        notifiePar = "D1";
        aggravations.D1.push(e);
      } else {
        comptes.ameliorations++;
      }
      ecritures.push({ type: TYPE_ETAT_MARGE, cle_objet: e.chantierId, etat: e.marge, notifiePar });
    }
  }

  // Premier passage : aucune ligne n'existait, donc aucune aggravation n'a pu
  // être trouvée ci-dessus. Rien n'est envoyé ; tout est enregistré.
  const notifications = premierPassage ? [] : ["C4", "C5", "D1"]
    .map((t) => contenuNotificationAlertesV1(t, aggravations[t], dateParis))
    .filter(Boolean);

  return { premierPassage, notifications, aggravations, ecritures, comptes };
}
