// ─────────────────────────────────────────────────────────────────────────────
// administratifFournisseursV1 — bloc « Administratif fournisseurs » du tableau
// de bord du jour (projet docs/projets/organisation-par-jour.md, tâche 9).
//
// Deux parties, aucun calcul réécrit (règle 9) :
//   1. Factures à rapprocher : liste de la page « Rapprochement factures »
//      (historiqueRapprochementV1.mjs : même statut « À rapprocher », mêmes
//      montants au même format) ;
//   2. Encours fournisseurs à payer : calcul de la page « Encours
//      fournisseurs », vue « Par échéance de paiement »
//      (encoursFournisseursPageV1.mjs : mêmes cartes « À payer · <mois> » et
//      « Payé comptant · <mois> », même ordre des fournisseurs, même format).
//
// Règle 10 : chargement, erreur PAR PARTIE (une partie illisible n'empêche
// pas l'autre), « aucune facture à rapprocher », « aucun encours à payer »
// explicites ; jamais un 0 € quand la lecture a échoué.
//
// Module PUR : aucun accès Supabase, aucune horloge (le mois en cours arrive
// en paramètre), aucun effet de bord. Façade front : administratifFournisseursV1.js.
// Vérifié par scripts/verif-bloc-administratif-fournisseurs.mjs.
// ─────────────────────────────────────────────────────────────────────────────

import { construireHistoriqueRapprochement, facturesARapprocherV1, fmtEur } from "./historiqueRapprochementV1.mjs";
import {
  itemsEncoursFournisseurs, regrouperEncoursParMois, chiffresMoisCourant, fournisseursTriesDuMois,
  aPayerOf, eur, moisLabel, EXPLICATION_ENCOURS,
} from "./encoursFournisseursPageV1.mjs";

/** Nombre de factures listées (les plus anciennes) et de fournisseurs détaillés. */
export const NB_FACTURES_APERCU = 5;
export const NB_FOURNISSEURS_APERCU = 5;

const s = (n) => (n > 1 ? "s" : "");

/** « 2026-06-30 » → « 30/06/2026 » ; date absente ou invalide → null. */
export const dateCourteFR = (iso) => (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso)
  ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);

/**
 * Partie « Factures à rapprocher ».
 * @param {{ chargement?: boolean, erreur?: string|null, factures?: Array|null }} p
 *   factures : lecture lireFacturesHistorique (rapprochementDonnees.js)
 */
export function partieRapprochementV1({ chargement = false, erreur = null, factures = null } = {}) {
  if (erreur) {
    return { etat: "erreur", message: `Factures à rapprocher illisibles pour le moment (${erreur}). Le nombre de factures à rapprocher n'est pas connu.`, nombre: null, apercu: [], reste: 0 };
  }
  if (chargement || !Array.isArray(factures)) {
    return { etat: "chargement", message: "Chargement des factures à rapprocher…", nombre: null, apercu: [], reste: 0 };
  }
  // Les reçus ne sont jamais « à rapprocher » : seules les factures comptent.
  const liste = facturesARapprocherV1(construireHistoriqueRapprochement({ factures }));
  if (liste.length === 0) {
    return { etat: "vide", message: "Aucune facture à rapprocher.", nombre: 0, apercu: [], reste: 0 };
  }
  const apercu = liste.slice(0, NB_FACTURES_APERCU).map((it) => ({
    id: it.id,
    fournisseur: it.fournisseur || "Fournisseur ?",
    numero: it.numero || null,
    date: dateCourteFR(it.dateISO),
    montant: it.montant != null ? `${fmtEur(it.montant)} € HT` : null,
  }));
  return { etat: "liste", message: null, nombre: liste.length, apercu, reste: liste.length - apercu.length };
}

/**
 * Partie « Encours fournisseurs à payer ».
 * @param {{ chargement?: boolean, erreur?: string|null, donnees?: object|null, moisCourant: string }} p
 *   donnees : lectures chargerDonneesEncoursFournisseurs (encoursFournisseursDonnees.js)
 *   moisCourant : « AAAA-MM » (cleMoisCourant de la date du jour, comme la page)
 */
export function partieEncoursV1({ chargement = false, erreur = null, donnees = null, moisCourant } = {}) {
  const libelleMois = moisLabel(moisCourant);
  const base = { explication: EXPLICATION_ENCOURS, libelleMois };
  if (erreur) {
    return { ...base, etat: "erreur", message: `Encours fournisseurs illisible pour le moment (${erreur}). Le montant à payer n'est pas connu.`, tuiles: [], fournisseurs: [], reste: 0, suivants: [], aPayer: null };
  }
  if (chargement || !donnees) {
    return { ...base, etat: "chargement", message: "Chargement de l'encours fournisseurs…", tuiles: [], fournisseurs: [], reste: 0, suivants: [], aPayer: null };
  }
  const { moisMap } = regrouperEncoursParMois(itemsEncoursFournisseurs(donnees));
  const ceMois = chiffresMoisCourant(moisMap, moisCourant);
  // Cartes du haut de la page, mêmes libellés.
  const tuiles = [
    { cle: "aPayer", libelle: `À payer · ${ceMois.libelle}`, valeur: `${eur(ceMois.aPayer)} €` },
    { cle: "paye", libelle: `Payé comptant · ${ceMois.libelle}`, valeur: `${eur(ceMois.paye)} €` },
  ];
  // Fournisseurs du mois à payer, dans l'ordre de la page (plus gros d'abord).
  const aPayerDuMois = fournisseursTriesDuMois(moisMap.get(moisCourant)).filter((pf) => aPayerOf(pf) > 0);
  const fournisseurs = aPayerDuMois.slice(0, NB_FOURNISSEURS_APERCU).map((pf) => ({ nom: pf.nom, aPayer: `${eur(aPayerOf(pf))} €` }));
  // Mois d'échéance suivants (lignes de mois de la page), du plus proche au plus lointain.
  const suivants = [...moisMap.values()]
    .filter((g) => g.mois > moisCourant && g.mois !== "____" && g.aPayer > 0)
    .sort((a, b) => a.mois.localeCompare(b.mois))
    .map((g) => ({ mois: g.mois, libelle: moisLabel(g.mois), aPayer: `${eur(g.aPayer)} €` }));
  const rien = ceMois.aPayer <= 0 && suivants.length === 0;
  return {
    ...base,
    etat: rien ? "vide" : "liste",
    message: rien ? `Aucun encours à payer en ${ceMois.libelle} ni sur les mois suivants.` : (ceMois.aPayer <= 0 ? `Aucun encours à payer en ${ceMois.libelle}.` : null),
    tuiles, fournisseurs, reste: aPayerDuMois.length - fournisseurs.length, suivants, aPayer: ceMois.aPayer,
  };
}

/**
 * État affichable du bloc et métrique clé de l'en-tête.
 * Métrique : le montant à payer du mois en cours (chiffre de la première carte
 * de la page Encours), le plus utile pour l'administratif du jour ; le nombre
 * de factures à rapprocher reste visible en tête de la première partie.
 */
export function etatBlocAdministratifFournisseursV1({ rapprochement = {}, encours = {}, moisCourant } = {}) {
  const r = partieRapprochementV1(rapprochement);
  const e = partieEncoursV1({ ...encours, moisCourant });
  const metrique = e.etat === "erreur" ? "encours illisible"
    : e.etat === "chargement" ? "…"
    : e.etat === "vide" ? "rien à payer"
    : `${eur(e.aPayer)} € à payer ce mois`;
  const libelleNombre = r.nombre == null ? null : r.nombre === 0 ? "aucune" : `${r.nombre} facture${s(r.nombre)}`;
  return { metrique, rapprochement: r, encours: e, libelleNombre };
}
