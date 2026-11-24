// ─────────────────────────────────────────────────────────────────────────────
// tourneeChantiersV1 — bloc « Tournée des chantiers » du tableau de bord du
// jour (projet docs/projets/organisation-par-jour.md, tâche 10).
//
// Trois parties, aucun calcul réécrit (règle 9) :
//   1. Niveau d'alerte des chantiers : MÊME chaîne que la page Alertes
//      (calculerAlertesEcranV1 → alertesMargesV2 → alertesV1), mêmes
//      semaines, mêmes relevés, mêmes exclusions, même état « relevé pas
//      encore disponible » (etatAlertesV1), mêmes libellés et couleurs
//      (PRESENTATION_NIVEAUX_ALERTE_V1, partagée avec la page) ;
//   2. Retours du terrain de la semaine : MÊME calcul que la page Retours du
//      terrain (retoursTerrain de retoursTerrainV1.mjs), même semaine, tous
//      chantiers : tâches « Bloqué » / « Pas commencé » (« Non faite » de
//      l'ancien formulaire) puis dépassements des heures prévues ;
//   3. Tâches de phasage en retard : règle existante de l'application,
//      `en_retard` d'etatReelTacheV1 (planningReplanningStateV1.js, état réel
//      du phasage) : tâche datée (date_prevue) avant la date du jour et pas
//      terminée — seule une progression (avancement) à 100 % termine une
//      tâche. C'est la même règle que l'icône « En retard : date passée et
//      tâche non terminée » de la page Phasage (PhasageV2.jsx, overdueT).
//
// Règle 10 : chargement, erreur PAR PARTIE (une partie illisible n'empêche
// pas les autres), vides explicites (« aucun chantier en alerte », « aucun
// retour bloqué cette semaine », « aucune tâche de phasage en retard ») et
// « relevé pas encore disponible » quand le niveau d'alerte ne peut pas être
// calculé faute de relevé.
//
// Module PUR : aucun accès Supabase, aucune horloge (la date du jour arrive en
// paramètre), aucun effet de bord. Façade front : tourneeChantiersV1.js.
// Vérifié par scripts/verif-bloc-tournee-chantiers.mjs.
// ─────────────────────────────────────────────────────────────────────────────

import { calculerAlertesEcranV1, CHANTIERS_EXCLUS_ALERTES_V1, PRESENTATION_NIVEAUX_ALERTE_V1 } from "./alertesEcranV1.mjs";
import { etatAlertesV1, estExcluV1, NIVEAU_CRITIQUE, NIVEAU_A_SURVEILLER, NIVEAU_INFO, ETAT_RELEVE_ABSENT } from "./alertesV1.mjs";
import { retoursTerrain } from "./retoursTerrainV1.mjs";
import { nomTache } from "./libellesPhasageV1.mjs";
import { estChantierActif } from "./chantierActif.mjs";
import { construireEtatReelPhasagesV1 } from "./planningReplanningStateV1.js";

/** Nombre de lignes montrées par partie avant « et N autres ». */
export const NB_APERCU_TOURNEE = 5;

const s = (n) => (n > 1 ? "s" : "");
const str = (v) => (v == null ? "" : String(v).trim());
const estDateIso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(str(v));
/** « et 3 autres » ; rien sous 1. */
export const etNAutres = (n) => (n > 0 ? `et ${n} autre${s(n)}` : null);

/** « 2026-11-19 » → « 19/11/2026 » ; illisible → la valeur telle quelle. */
export const dateFR = (iso) => (estDateIso(str(iso).slice(0, 10))
  ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : str(iso));

/** Jours calendaires entre deux dates « AAAA-MM-JJ » (b − a). */
export function joursEntre(a, b) {
  if (!estDateIso(a) || !estDateIso(b)) return null;
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/**
 * Chantiers « en cours » de la tournée : en vie au sens de la règle unique
 * estChantierActif (ni terminé, ni archivé, ni à l'étude / perdu), hors
 * chantiers jamais affichés par la page Alertes (DÉPOT, stock interne).
 */
export function chantiersEnCoursTourneeV1(chantiers, exclusions = CHANTIERS_EXCLUS_ALERTES_V1) {
  return (Array.isArray(chantiers) ? chantiers : [])
    .filter((c) => estChantierActif(c) && !estExcluV1({ chantier_id: c.id, chantier_nom: c.nom }, exclusions));
}

// ── 1. Niveau d'alerte ───────────────────────────────────────────────────────

/**
 * Partie « Niveau d'alerte des chantiers ».
 * @param {object} p
 * @param {boolean} [p.chargement]
 * @param {string|null} [p.erreur]          lecture des relevés en échec
 * @param {Array|null} [p.lignes]           relevés lus (chargerRelevesAlertesSemaines)
 * @param {string[]} p.semaines             [courante, précédente] (semainesAlertesV1)
 * @param {object|null} [p.seuilsMarges]    réglages des marges (comme la page)
 * @param {Array|null} [p.referentielChantiers] chantiers non archivés (référentiel de la page)
 * @param {Array} [p.exclusions]            chantiers jamais affichés
 */
export function partieAlertesTourneeV1({ chargement = false, erreur = null, lignes = null, semaines = [], seuilsMarges = null, referentielChantiers = null, exclusions = CHANTIERS_EXCLUS_ALERTES_V1 } = {}) {
  const vide = { chantiers: [], totaux: null, sansReleve: [], nbEnAlerte: null };
  if (erreur) {
    return { ...vide, etat: "erreur", message: `Le relevé n'a pas pu être lu (${erreur}). Les niveaux d'alerte ne sont pas connus : ce n'est pas « aucune alerte ».` };
  }
  if (chargement || !Array.isArray(lignes)) {
    return { ...vide, etat: "chargement", message: "Lecture des relevés journaliers…" };
  }
  // MÊME calcul que la page Alertes.
  const { resultat, courants } = calculerAlertesEcranV1({ lignes, semaines, seuilsMarges, referentielChantiers, exclusions });
  const etatPage = etatAlertesV1(resultat);
  // Chantiers en cours sans relevé retenu cette semaine : leur niveau d'alerte
  // ne peut pas être calculé (jamais présenté comme « sans alerte »).
  const avecReleve = new Set((courants || []).map((c) => str(c?.chantier_id)));
  const sansReleve = chantiersEnCoursTourneeV1(referentielChantiers, exclusions)
    .filter((c) => !avecReleve.has(str(c.id)))
    .map((c) => ({ id: c.id, nom: str(c.nom) || str(c.id) }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  if (etatPage.statut === ETAT_RELEVE_ABSENT) {
    return { ...vide, etat: "releve_absent", message: etatPage.message, sansReleve: [] };
  }
  const chantiers = resultat.alertes.map((a) => {
    const pres = PRESENTATION_NIVEAUX_ALERTE_V1[a.niveau] || PRESENTATION_NIVEAUX_ALERTE_V1[NIVEAU_INFO];
    return { id: a.chantierId, nom: a.nom, niveau: a.niveau, libelle: pres.label, couleur: pres.texte, fond: pres.fond, bord: pres.bord };
  });
  const totaux = resultat.totaux;
  const nbEnAlerte = totaux.critique + totaux.aSurveiller;
  return {
    etat: chantiers.length === 0 ? "vide" : "liste",
    message: chantiers.length === 0 ? "Aucun chantier en alerte sur le relevé de cette semaine." : etatPage.message,
    chantiers, totaux, nbEnAlerte, sansReleve,
    margeSurestimee: resultat.margeSurestimee.length,
  };
}

/** Les chantiers d'un niveau, dans l'ordre de la page Alertes. */
export const chantiersDuNiveau = (partie, niveau) => (partie?.chantiers || []).filter((c) => c.niveau === niveau);
export { NIVEAU_CRITIQUE, NIVEAU_A_SURVEILLER, NIVEAU_INFO };

// ── 2. Retours du terrain ────────────────────────────────────────────────────

/**
 * Partie « Retours du terrain » de la semaine en cours.
 * @param {object} p
 * @param {string|null} [p.erreur]    comptes rendus illisibles
 * @param {Array|null} [p.rapports]   comptes rendus de la semaine (chargerRetoursTerrainSemaine)
 * @param {Array|null} [p.phasages]   phasages des chantiers concernés ; null = illisibles (comme la page)
 * @param {string} p.debut            lundi « AAAA-MM-JJ »
 * @param {string} p.fin              dimanche « AAAA-MM-JJ »
 */
export function partieRetoursTourneeV1({ chargement = false, erreur = null, rapports = null, phasages = [], debut, fin } = {}) {
  const vide = { lignes: [], reste: 0, nbBloque: null, nbPasCommence: null, nbDepassements: null, nbRapports: null, messagesVides: [], phasagesIllisibles: false };
  if (erreur) {
    return { ...vide, etat: "erreur", message: `Les comptes rendus n'ont pas pu être lus (${erreur}). Ce n'est pas « aucun retour ».` };
  }
  if (chargement || !Array.isArray(rapports)) {
    return { ...vide, etat: "chargement", message: "Lecture des comptes rendus…" };
  }
  if (rapports.length === 0) {
    return { ...vide, etat: "aucun_compte_rendu", nbRapports: 0, message: "Aucun compte rendu pour cette semaine : il n'y a rien à lire." };
  }
  // MÊME calcul que la page (tous chantiers).
  const res = retoursTerrain({ rapports, phasages: phasages || [], debut, fin, chantierId: null });
  const lignesNonFaites = res.nonFaites.map((it) => ({
    cle: it.cle, type: it.bloque ? "bloque" : "pas_commence", etiquette: it.statut_label, detail: it.motif_label,
    chantierId: it.chantier_id, chantier: it.chantier_nom, tache: it.tache, date: it.date,
  }));
  const lignesDepassements = res.depassements.map((it) => ({
    cle: it.cle, type: "depassement", etiquette: "Dépassement", detail: it.motif_label,
    chantierId: it.chantier_id, chantier: it.chantier_nom, tache: it.tache, date: it.date, releve: it.releve,
  }));
  // Bloqué d'abord, puis pas commencé, puis dépassements (chacun du plus récent au plus ancien, ordre de la page).
  const toutes = [
    ...lignesNonFaites.filter((l) => l.type === "bloque"),
    ...lignesNonFaites.filter((l) => l.type !== "bloque"),
    ...lignesDepassements,
  ];
  const lignes = toutes.slice(0, NB_APERCU_TOURNEE);
  const messagesVides = [];
  if (lignesNonFaites.length === 0) messagesVides.push("Aucun retour bloqué ou pas commencé cette semaine.");
  if (lignesDepassements.length === 0) messagesVides.push("Aucun dépassement signalé cette semaine.");
  return {
    etat: toutes.length === 0 ? "vide" : "liste",
    message: null,
    lignes, reste: toutes.length - lignes.length,
    nbBloque: lignesNonFaites.filter((l) => l.type === "bloque").length,
    nbPasCommence: lignesNonFaites.filter((l) => l.type !== "bloque").length,
    nbDepassements: lignesDepassements.length,
    nbRapports: rapports.length,
    messagesVides,
    phasagesIllisibles: phasages === null,
  };
}

// ── 3. Tâches de phasage en retard ───────────────────────────────────────────

/**
 * Tâches de phasage en retard à la date du jour, pour les chantiers donnés.
 * Règle EXISTANTE (aucun statut inventé) : etatReelTacheV1(...).en_retard
 * = date_prevue < dateIso ET avancement < 100 % (seule une progression à
 * 100 % termine une tâche). Une tâche sans date prévue n'est jamais en retard.
 * Tri : la plus en retard d'abord, puis chantier, puis tâche.
 * @param {{ phasages: Array, chantiers: Array, dateIso: string }} p
 */
export function tachesPhasageEnRetardV1({ phasages = [], chantiers = [], dateIso } = {}) {
  if (!estDateIso(dateIso)) return [];
  const parId = new Map((chantiers || []).map((c) => [str(c?.id), c]));
  const retenus = (phasages || []).filter((ph) => parId.has(str(ph?.chantier_id)));
  // Nom affiché de la tâche (nom personnalisé du phasage s'il existe).
  const noms = new Map();
  retenus.forEach((ph) => (Array.isArray(ph?.ouvrages) ? ph.ouvrages : []).forEach((o) =>
    (Array.isArray(o?.taches) ? o.taches : []).forEach((t) => {
      const cle = `${str(ph.chantier_id)}::${str(t?.id)}`;
      if (!noms.has(cle)) noms.set(cle, nomTache(t));
    })));
  const { travaux } = construireEtatReelPhasagesV1(retenus, { today: dateIso });
  return travaux
    .filter((t) => t.en_retard)
    .map((t) => {
      const c = parId.get(str(t.chantier_id));
      return {
        cle: t.id, chantierId: t.chantier_id, chantier: str(c?.nom) || str(t.chantier_id),
        tache: noms.get(t.id) || t.nom || "(sans nom)", datePrevue: t.date_prevue,
        joursRetard: joursEntre(t.date_prevue, dateIso), avancement: t.avancement,
      };
    })
    .sort((a, b) => a.datePrevue.localeCompare(b.datePrevue) || a.chantier.localeCompare(b.chantier, "fr") || a.tache.localeCompare(b.tache, "fr"));
}

/**
 * Partie « Tâches de phasage en retard ».
 * @param {{ chargement?: boolean, erreur?: string|null, phasages?: Array|null, chantiers?: Array, dateIso: string }} p
 */
export function partiePhasageTourneeV1({ chargement = false, erreur = null, phasages = null, chantiers = [], dateIso } = {}) {
  const vide = { lignes: [], reste: 0, nombre: null, nbChantiers: null, parChantier: [] };
  if (erreur) {
    return { ...vide, etat: "erreur", message: `Les phasages n'ont pas pu être lus (${erreur}). Les tâches en retard ne sont pas connues.` };
  }
  if (!estDateIso(dateIso)) {
    return { ...vide, etat: "erreur", message: "Date du jour inconnue : les tâches en retard ne peuvent pas être calculées." };
  }
  if (chargement || !Array.isArray(phasages)) {
    return { ...vide, etat: "chargement", message: "Lecture des phasages…" };
  }
  const toutes = tachesPhasageEnRetardV1({ phasages, chantiers, dateIso });
  if (toutes.length === 0) {
    return { ...vide, etat: "vide", nombre: 0, nbChantiers: 0, message: "Aucune tâche de phasage en retard." };
  }
  const lignes = toutes.slice(0, NB_APERCU_TOURNEE).map((t) => ({ ...t, date: dateFR(t.datePrevue) }));
  // Nombre de tâches en retard par chantier (le plus chargé d'abord).
  const compte = new Map();
  toutes.forEach((t) => {
    const e = compte.get(t.chantierId) || { chantierId: t.chantierId, chantier: t.chantier, nombre: 0 };
    e.nombre += 1;
    compte.set(t.chantierId, e);
  });
  const parChantier = [...compte.values()].sort((a, b) => b.nombre - a.nombre || a.chantier.localeCompare(b.chantier, "fr"));
  return {
    etat: "liste", message: null, lignes, reste: toutes.length - lignes.length,
    nombre: toutes.length, nbChantiers: parChantier.length, parChantier,
  };
}

// ── Bloc ─────────────────────────────────────────────────────────────────────

/**
 * État affichable du bloc et métrique clé de l'en-tête (téléphone).
 * Métrique : le nombre de chantiers en alerte (critiques + à surveiller,
 * comme les deux sections ouvertes de la page Alertes) — c'est ce qui décide
 * de l'ordre de la tournée. Les retours et retards gardent leur nombre en tête
 * de leur partie.
 */
export function etatBlocTourneeChantiersV1({ alertes = {}, retours = {}, phasage = {} } = {}) {
  const a = partieAlertesTourneeV1(alertes);
  const r = partieRetoursTourneeV1(retours);
  const p = partiePhasageTourneeV1(phasage);
  const metrique = a.etat === "erreur" ? "alertes illisibles"
    : a.etat === "chargement" ? "…"
    : a.etat === "releve_absent" ? "relevé pas encore disponible"
    : a.nbEnAlerte === 0 ? "aucun chantier en alerte"
    : `${a.nbEnAlerte} chantier${s(a.nbEnAlerte)} en alerte`;
  return { metrique, alertes: a, retours: r, phasage: p };
}
