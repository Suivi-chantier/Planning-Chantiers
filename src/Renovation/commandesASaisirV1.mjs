// ─────────────────────────────────────────────────────────────────────────────
// commandesASaisirV1 — bloc « Commandes à saisir » du tableau de bord du jour
// (projet docs/projets/organisation-par-jour.md, tâche 7).
//
// Deux sources, aucun calcul réécrit (règle 9) :
//   1. Demandes de matériel des ouvriers en attente (table `besoins`) : le
//      filtre est CELUI du tableau de bord (tuile « Commandes à passer ») et de
//      la page « Commandes à passer » (onglet « Demandes ouvriers »), désormais
//      défini ici une seule fois (STATUT_BESOIN_EN_ATTENTE) et appliqué par
//      commandesAPasserDonnees.js. Le regroupement en demandes (un envoi = un
//      panier) est la clé de la page (clePanierBesoin), déplacée à l'identique.
//   2. Articles à commander : statsCommandesAPasser (commandesAPasserV1.mjs),
//      mêmes libellés que le bandeau de la page.
//
// Règle 10 : chargement, erreur, « aucune demande en attente », « aucun
// article à commander » explicites ; jamais un 0 à la place d'une donnée qui
// n'a pas pu être lue.
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord.
// Façade front : commandesASaisirV1.js. Vérifié par
// scripts/verif-bloc-commandes-a-saisir.mjs.
// ─────────────────────────────────────────────────────────────────────────────

import { eur } from "../chantierFinance.mjs";

/** Statut d'une demande ouvrier pas encore traitée (filtre du tableau de bord). */
export const STATUT_BESOIN_EN_ATTENTE = "en_attente";

/** Colonnes des demandes lues par la page « Commandes à passer » (et le bloc). */
export const COLONNES_BESOINS_EN_ATTENTE = "id, panier_id, chantier_id, materiau_id, article, quantite, ouvrier_demandeur, notes, priorite, photo_url, created_at";

/** Nombre de demandes listées dans le bloc (les plus récentes). */
export const NB_DEMANDES_APERCU = 5;

/** Libellés du bandeau de la page « Commandes à passer » (repris tels quels). */
export const LIBELLES_STATS_COMMANDES = Object.freeze({
  nbChantiers: "Chantiers en cours",
  nbACommander: "Articles à commander",
  totalHt: "Reste à commander HT (enveloppes des lots)",
});

/**
 * Clé de regroupement d'une demande ouvrier : un envoi = un panier_id ; repli
 * pour les demandes anciennes sans panier. Déplacée à l'identique de
 * PagePlanningCommandes.jsx (useMemo « paniers »).
 */
export function clePanierBesoin(b) {
  return b.panier_id || ("solo_" + b.id);
}

/** Nombre de demandes (paniers) : le badge de l'onglet « Demandes ouvriers ». */
export function nombreDemandesOuvriers(besoins) {
  return new Set((besoins || []).map(clePanierBesoin)).size;
}

/** Nom du chantier d'une demande — même repli que la page. */
export function nomChantierBesoin(b, chantiers) {
  const chantier = (chantiers || []).find(c => c.id === b.chantier_id);
  return chantier?.nom || b.chantier_id || "(sans chantier)";
}

/**
 * Les `n` demandes les plus récentes (la lecture est déjà triée par date de
 * création décroissante) : chantier, article, demandeur, date (AAAA-MM-JJ).
 */
export function apercuDemandesV1(besoins, chantiers, n = NB_DEMANDES_APERCU) {
  return (besoins || []).slice(0, n).map(b => ({
    id: b.id,
    chantier: nomChantierBesoin(b, chantiers),
    article: (b.article || "").trim() || "(article sans libellé)",
    quantite: b.quantite != null && String(b.quantite).trim() !== "" ? String(b.quantite).trim() : null,
    demandeur: (b.ouvrier_demandeur || "").trim() || null,
    date: typeof b.created_at === "string" && b.created_at.length >= 10 ? b.created_at.slice(0, 10) : null,
    urgent: b.priorite === "urgent",
  }));
}

/** Tuiles du bandeau de la page, mêmes libellés et même format (eur). */
export function tuilesStatsCommandesV1(stats) {
  return [
    { cle: "nbChantiers", libelle: LIBELLES_STATS_COMMANDES.nbChantiers, valeur: String(stats.nbChantiers) },
    { cle: "nbACommander", libelle: LIBELLES_STATS_COMMANDES.nbACommander, valeur: String(stats.nbACommander) },
    { cle: "totalHt", libelle: LIBELLES_STATS_COMMANDES.totalHt, valeur: eur(stats.totalHt) },
  ];
}

const s = (n) => (n > 1 ? "s" : "");

/**
 * État affichable du bloc.
 * @param {{
 *   compte:   { chargement?: boolean, erreur?: string|null, nombre?: number|null },
 *   besoins:  { chargement?: boolean, erreur?: string|null, lignes?: Array|null },
 *   commandes:{ chargement?: boolean, erreur?: string|null, modele?: Array|null, stats?: object|null },
 *   chantiers?: Array,
 * }} p
 *   compte  : nombre d'articles demandés en attente (lecture du tableau de bord)
 *   besoins : lignes en attente (lecture de la page), pour les demandes et l'aperçu
 *   commandes : modèle et stats de la page Commandes à passer
 */
export function etatBlocCommandesASaisirV1({ compte = {}, besoins = {}, commandes = {}, chantiers = [] } = {}) {
  // ── Demandes des ouvriers ──
  let demandes;
  if (compte.erreur) {
    demandes = { etat: "erreur", message: `Demandes des ouvriers illisibles pour le moment (${compte.erreur}). Le nombre en attente n'est pas connu.`, nombre: null, nbDemandes: null, apercu: [], reste: 0 };
  } else if (compte.chargement || compte.nombre == null) {
    demandes = { etat: "chargement", message: "Chargement des demandes des ouvriers…", nombre: null, nbDemandes: null, apercu: [], reste: 0 };
  } else if (compte.nombre === 0) {
    demandes = { etat: "vide", message: "Aucune demande en attente.", nombre: 0, nbDemandes: 0, apercu: [], reste: 0 };
  } else {
    const n = compte.nombre;
    const base = { etat: "liste", nombre: n };
    if (besoins.erreur) {
      demandes = { ...base, message: `Détail des demandes illisible pour le moment (${besoins.erreur}).`, nbDemandes: null, apercu: [], reste: 0 };
    } else if (besoins.chargement || !Array.isArray(besoins.lignes)) {
      demandes = { ...base, message: "Chargement du détail des demandes…", nbDemandes: null, apercu: [], reste: 0 };
    } else {
      const apercu = apercuDemandesV1(besoins.lignes, chantiers);
      demandes = { ...base, message: null, nbDemandes: nombreDemandesOuvriers(besoins.lignes), apercu, reste: Math.max(0, n - apercu.length) };
    }
  }

  // ── Articles à commander ──
  let articles;
  if (commandes.erreur) {
    articles = { etat: "erreur", message: `Articles à commander illisibles pour le moment (${commandes.erreur}). Ouvrez la page Commandes à passer pour réessayer.`, tuiles: [] };
  } else if (commandes.chargement || !Array.isArray(commandes.modele) || !commandes.stats) {
    articles = { etat: "chargement", message: "Chargement des articles à commander…", tuiles: [] };
  } else if (commandes.modele.length === 0) {
    articles = { etat: "vide", message: "Aucun article à commander : aucun chantier avec des matériaux prévus au phasage.", tuiles: [] };
  } else if (commandes.stats.nbACommander === 0) {
    articles = { etat: "vide", message: "Aucun article à commander.", tuiles: tuilesStatsCommandesV1(commandes.stats) };
  } else {
    articles = { etat: "liste", message: null, tuiles: tuilesStatsCommandesV1(commandes.stats) };
  }

  // Métrique clé (en-tête) : demandes en attente.
  const metrique = demandes.etat === "erreur" ? "illisible"
    : demandes.etat === "chargement" ? "…"
    : demandes.nombre === 0 ? "aucune demande"
    : `${demandes.nombre} en attente`;

  return { metrique, demandes, articles, libelleNombre: demandes.nombre != null ? `${demandes.nombre} article${s(demandes.nombre)} demandé${s(demandes.nombre)}` : null };
}
