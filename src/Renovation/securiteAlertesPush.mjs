// ─────────────────────────────────────────────────────────────────────────────
// securiteAlertesPush — alertes de la fiche sécurité envoyées dans la boîte de
// réception (notifications) par la tâche planifiée du serveur.
// Tâche 7b du projet docs/projets/fiche-securite-chantier.md.
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord. Le
// job api/_cron/cron-alertes-securite.js lit les tables, donne la date de
// Paris, puis demande ici :
//   1. les ENTRÉES de alertesSecurite() (securiteCycleVie.mjs) : fiches par
//      chantier, première date prévue du phasage, justificatifs requis
//      expirés. Les quatre règles (fiche à créer, non validée à 7 jours, à
//      mettre à jour, justificatif expiré) restent écrites UNE fois, dans
//      alertesSecurite() : ce module ne les recalcule pas ;
//   2. les aptitudes médicales expirées (type S2, administrateurs seulement,
//      jamais de nom dans la notification) ;
//   3. le PLAN : ce qui est nouveau (jamais notifié), ce qui est résolu (à
//      oublier, pour pouvoir réalerter si cela revient), et le contenu de la
//      notification regroupée du jour (une par type, comme F1).
//
// Déduplication (même modèle que F1 / D2) : table notifications_etat, une
// ligne par alerte déjà notifiée (type S1, cle_objet « <alerte>:<chantier> » ;
// type S2, « aptitude:<justificatif> »). Une alerte inscrite n'est plus
// renvoyée tant qu'elle reste vraie ; quand elle disparaît (fiche créée,
// validée, justificatif remplacé…), sa ligne est retirée.
//
// Invariant « une impossibilité reste visible » : un chantier planifié dont la
// première date du phasage est inconnue n'est jamais traité comme « pas
// d'alerte à 7 jours » : il est compté à part et cité dans la notification.
// ─────────────────────────────────────────────────────────────────────────────
import { alertesSecurite, TYPES_ALERTE_SECURITE } from "./securiteCycleVie.mjs";
import { justificatifsRequisManquants, estExpire, estJustificatifActif } from "./securiteValidation.mjs";

/** Types du catalogue des notifications (notificationsPushV1.mjs). */
export const TYPE_PUSH_SECURITE = "S1";
export const TYPE_PUSH_APTITUDES = "S2";
export const TYPES_PUSH_SECURITE = Object.freeze([TYPE_PUSH_SECURITE, TYPE_PUSH_APTITUDES]);

/** Les quatre alertes de alertesSecurite() qui partent en notification S1. */
export const ALERTES_NOTIFIEES = Object.freeze(Object.keys(TYPES_ALERTE_SECURITE));

/** Libellés courts d'une ligne de la notification regroupée. */
export const LIBELLES_COURTS = Object.freeze({
  fiche_a_creer: "fiche sécurité à créer",
  fiche_non_validee_j7: "fiche non validée, démarrage dans 7 jours ou moins",
  justificatif_expire: "justificatif requis expiré (chantier en cours)",
  fiche_a_mettre_a_jour: "fiche à mettre à jour",
});

export const LIEN_LISTE_CHANTIERS = "/?page=chantiers";
const TITRE_MAX = 120;
const TEXTE_MAX = 1000;
const LIGNES_MAX = 12;

const estObjet = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
/** Date AAAA-MM-JJ qui existe au calendrier (« 2026-13-45 » refusée). */
const estDateIso = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
const pluriel = (n, s, p) => `${n} ${n > 1 ? p : s}`;
const couper = (s, max) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

// ─── 1. Entrées de alertesSecurite() ────────────────────────────────────────

/**
 * Première date prévue du phasage : la plus petite date_prevue des tâches
 * des ouvrages (même champ que la date de dépose des sanitaires,
 * securitePreRemplissage). null = aucune tâche datée (date inconnue).
 */
export function premiereDatePrevuePhasage(ouvrages) {
  let min = null;
  for (const o of Array.isArray(ouvrages) ? ouvrages : []) {
    for (const t of Array.isArray(o?.taches) ? o.taches : []) {
      const d = String(t?.date_prevue ?? "").slice(0, 10);
      if (estDateIso(d) && (min === null || d < min)) min = d;
    }
  }
  return min;
}

/**
 * Nombre de justificatifs REQUIS expirés d'une fiche : même fonction que la
 * validation de la fiche et que la « mise à jour proposée » (tâche 8) —
 * justificatifsRequisManquants, raison « expire ». Les justificatifs
 * confidentiels n'entrent jamais ici (aptitudes médicales : type S2).
 */
export function nbRequisExpires({ reponses, justificatifs, aujourdhui }) {
  const actifs = (Array.isArray(justificatifs) ? justificatifs : []).filter((j) => estJustificatifActif(j) && j.confidentiel !== true);
  const m = justificatifsRequisManquants({ reponses: estObjet(reponses) ? reponses : {}, justificatifs: actifs, aujourdhui });
  return (m || []).filter((x) => x.raison === "expire").length;
}

/**
 * Lignes lues en base → paramètres de alertesSecurite().
 * @param {object} p
 * @param {Array} p.chantiers      [{ id, nom, statut, archive_le }]
 * @param {Array} p.fiches         lignes securite_fiches (chantier_id, statut, version, validee_le, forcage_le, reponses…)
 * @param {Array} p.phasages       [{ chantier_id, ouvrages }]
 * @param {Array} p.justificatifs  lignes securite_justificatifs (toutes portées)
 * @param {string} p.aujourdhui    AAAA-MM-JJ (Paris)
 */
export function entreesAlertesSecurite({ chantiers = [], fiches = [], phasages = [], justificatifs = [], aujourdhui } = {}) {
  const fichesParChantier = {};
  for (const f of Array.isArray(fiches) ? fiches : []) {
    if (f?.chantier_id != null) fichesParChantier[String(f.chantier_id)] = f;
  }
  const premieresDates = {};
  for (const p of Array.isArray(phasages) ? phasages : []) {
    if (p?.chantier_id == null) continue;
    const id = String(p.chantier_id);
    const d = premiereDatePrevuePhasage(p.ouvrages);
    if (d && (!premieresDates[id] || d < premieresDates[id])) premieresDates[id] = d;
  }
  const justifsParChantier = {};
  for (const j of Array.isArray(justificatifs) ? justificatifs : []) {
    if (j?.portee !== "chantier" || j.chantier_id == null) continue;
    (justifsParChantier[String(j.chantier_id)] ||= []).push(j);
  }
  const expires = {};
  for (const [id, f] of Object.entries(fichesParChantier)) {
    const n = nbRequisExpires({ reponses: f.reponses, justificatifs: justifsParChantier[id] || [], aujourdhui });
    if (n > 0) expires[id] = n;
  }
  return { chantiers: Array.isArray(chantiers) ? chantiers : [], fiches: fichesParChantier, premieresDates, expires, aujourdhui };
}

/** Aptitudes médicales actives expirées (toutes portées). */
export function aptitudesExpirees({ justificatifs = [], aujourdhui } = {}) {
  return (Array.isArray(justificatifs) ? justificatifs : [])
    .filter((j) => j?.type_code === "aptitude_medicale" && estJustificatifActif(j) && estExpire(j, aujourdhui));
}

// ─── 2. Plan d'envoi ────────────────────────────────────────────────────────

export const cleObjetAlerte = (a) => `${a.type}:${a.chantier_id}`;
export const cleObjetAptitude = (j) => `aptitude:${j.id}`;

/** Contenu de la notification S1 regroupée du jour (null = rien de nouveau). */
export function contenuPushSecurite({ nouvelles, nomsChantiers = {}, datesInconnues = 0, dateParis }) {
  const n = Array.isArray(nouvelles) ? nouvelles.length : 0;
  if (!n) return null;
  const nom = (a) => String(nomsChantiers[a.chantier_id] || a.chantier_id);
  const titre = couper(n === 1 ? a1Titre(nouvelles[0], nom) : `${n} alertes fiche sécurité`, TITRE_MAX);
  const finDates = datesInconnues > 0
    ? `${pluriel(datesInconnues, "chantier planifié", "chantiers planifiés")} sans date au phasage : alerte à 7 jours impossible à calculer.`
    : "";
  let texte;
  if (n === 1) {
    texte = [nouvelles[0].texte, finDates].filter(Boolean).join("\n");
  } else {
    // Lignes tant qu'elles tiennent (place gardée pour « … et N autres » et la
    // phrase des dates inconnues) : la fin du texte n'est jamais coupée.
    const reserve = 40 + finDates.length;
    const lignes = [];
    let taille = 0;
    for (const a of nouvelles) {
      const l = `• ${couper(nom(a), 60)} : ${LIBELLES_COURTS[a.type] || a.type}`;
      if (lignes.length >= LIGNES_MAX || taille + l.length + 1 > TEXTE_MAX - reserve) break;
      lignes.push(l); taille += l.length + 1;
    }
    const reste = n - lignes.length;
    if (reste > 0) lignes.push(`… et ${reste} autre${reste > 1 ? "s" : ""}.`);
    if (finDates) lignes.push(finDates);
    texte = lignes.join("\n");
  }
  const chantiersDistincts = new Set(nouvelles.map((a) => a.chantier_id));
  return {
    type: TYPE_PUSH_SECURITE,
    titre,
    texte: couper(texte, TEXTE_MAX),
    // Un seul chantier : sa fiche (bandeau « Fiche sécurité ») ; sinon la liste.
    lien: chantiersDistincts.size === 1 ? nouvelles[0].lien : LIEN_LISTE_CHANTIERS,
    cle_regroupement: `${TYPE_PUSH_SECURITE}-${dateParis}`,
  };
}
const a1Titre = (a, nom) => `${TYPES_ALERTE_SECURITE[a.type] || a.type} — ${nom(a)}`;

/** Contenu de la notification S2 (administrateurs) : jamais de nom de personne. */
export function contenuPushAptitudes({ nouvelles, dateParis }) {
  const n = Array.isArray(nouvelles) ? nouvelles.length : 0;
  if (!n) return null;
  return {
    type: TYPE_PUSH_APTITUDES,
    titre: n === 1 ? "1 aptitude médicale expirée" : `${n} aptitudes médicales expirées`,
    texte: `${n === 1 ? "Une aptitude médicale a expiré" : `${n} aptitudes médicales ont expiré`} : visite à renouveler. Détail réservé aux administrateurs, dans les justificatifs de l'entreprise.`,
    lien: "/",
    cle_regroupement: `${TYPE_PUSH_APTITUDES}-${dateParis}`,
  };
}

/**
 * Plan complet d'un passage.
 * @param {object} p
 * @param {Array}  p.alertes        sortie de alertesSecurite()
 * @param {Array}  p.aptitudes      sortie de aptitudesExpirees()
 * @param {Array}  p.etatsStockes   lignes notifications_etat { type, cle_objet } (types S1 et S2)
 * @param {object} p.nomsChantiers  { [id]: nom }
 * @param {string} p.dateParis      AAAA-MM-JJ
 * @returns {{ s1, s2, aOublier, datesInconnues }}
 *   s1 / s2 : { actuelles, nouvelles, contenu, aInscrire: [cle_objet] }
 *   aOublier : [{ type, cle_objet }] alertes inscrites qui ne sont plus vraies
 */
export function planPushSecurite({ alertes = [], aptitudes = [], etatsStockes = [], nomsChantiers = {}, dateParis } = {}) {
  const stockes = { [TYPE_PUSH_SECURITE]: new Set(), [TYPE_PUSH_APTITUDES]: new Set() };
  for (const e of Array.isArray(etatsStockes) ? etatsStockes : []) {
    if (stockes[e?.type]) stockes[e.type].add(String(e.cle_objet));
  }
  const liste = Array.isArray(alertes) ? alertes : [];
  const datesInconnues = liste.filter((a) => a.type === "date_inconnue");
  const actuellesS1 = liste.filter((a) => ALERTES_NOTIFIEES.includes(a.type));
  const nouvellesS1 = actuellesS1.filter((a) => !stockes.S1.has(cleObjetAlerte(a)));
  const actuellesS2 = Array.isArray(aptitudes) ? aptitudes : [];
  const nouvellesS2 = actuellesS2.filter((j) => !stockes.S2.has(cleObjetAptitude(j)));

  const vraiesS1 = new Set(actuellesS1.map(cleObjetAlerte));
  const vraiesS2 = new Set(actuellesS2.map(cleObjetAptitude));
  const aOublier = [
    ...[...stockes.S1].filter((c) => !vraiesS1.has(c)).map((cle_objet) => ({ type: TYPE_PUSH_SECURITE, cle_objet })),
    ...[...stockes.S2].filter((c) => !vraiesS2.has(c)).map((cle_objet) => ({ type: TYPE_PUSH_APTITUDES, cle_objet })),
  ];
  return {
    s1: {
      actuelles: actuellesS1.length,
      nouvelles: nouvellesS1,
      contenu: contenuPushSecurite({ nouvelles: nouvellesS1, nomsChantiers, datesInconnues: datesInconnues.length, dateParis }),
      aInscrire: nouvellesS1.map(cleObjetAlerte),
    },
    s2: {
      actuelles: actuellesS2.length,
      nouvelles: nouvellesS2,
      contenu: contenuPushAptitudes({ nouvelles: nouvellesS2, dateParis }),
      aInscrire: nouvellesS2.map(cleObjetAptitude),
    },
    aOublier,
    datesInconnues: datesInconnues.map((a) => a.chantier_id),
  };
}

/** Raccourci : lignes lues → alertes → plan (ce que fait le job). */
export function calculerPlanSecurite({ chantiers, fiches, phasages, justificatifs, etatsStockes, dateParis }) {
  const entrees = entreesAlertesSecurite({ chantiers, fiches, phasages, justificatifs, aujourdhui: dateParis });
  const alertes = alertesSecurite(entrees);
  const aptitudes = aptitudesExpirees({ justificatifs, aujourdhui: dateParis });
  const nomsChantiers = Object.fromEntries((chantiers || []).filter((c) => c?.id != null).map((c) => [String(c.id), c.nom || String(c.id)]));
  return { alertes, ...planPushSecurite({ alertes, aptitudes, etatsStockes, nomsChantiers, dateParis }) };
}
