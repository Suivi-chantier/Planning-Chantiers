// ─────────────────────────────────────────────────────────────────────────────
// encoursFournisseursMailV2 — ce qu'annoncent le mail du vendredi et la
// notification F2 « Encours fournisseurs : X € HT à payer »
// (api/cron-encours-fournisseurs.js), tiré du calcul de la PAGE « Encours
// fournisseurs » (projet docs/projets/organisation-par-jour.md, tâche 14 ;
// décision de Loris du 24/11/2026 : « oui il faut »).
//
// Même chiffre = même service + même explication : aucun calcul ici, tout
// vient de encoursFournisseursPageV1.mjs (page, bloc du jour) et de
// administratifFournisseursV1.mjs (mois suivants du bloc du jour).
//
// Chiffre annoncé : « À payer · <mois en cours> », la première carte de la
// page (et la métrique du bloc « Administratif fournisseurs »). L'ancien
// « Total à payer (6 derniers mois) » n'existe pas sur la page : il n'est plus
// annoncé. Le détail du mail garde sa forme (6 mois d'échéance, du plus
// récent au plus ancien, fournisseurs avec saisi / facturé / écart / à payer) :
// ce sont les 6 premières lignes de mois de la page, avec leurs montants.
//
// Le mois en cours est passé en paramètre (« AAAA-MM », date de Paris côté
// serveur) : le serveur tourne en UTC, la page à l'heure de l'appareil.
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord.
// Remplace, pour le mail et la notification, encoursFournisseursV1.mjs (non
// modifié, plus appelé par le job).
// Vérifié par scripts/verif-notifications-direction.mjs.
// ─────────────────────────────────────────────────────────────────────────────

import {
  itemsEncoursFournisseurs, regrouperEncoursParMois, chiffresMoisCourant, fournisseursTriesDuMois, aPayerOf,
  moisLabel, eur, EXPLICATION_ENCOURS,
} from "./encoursFournisseursPageV1.mjs";
import { partieEncoursV1 } from "./administratifFournisseursV1.mjs";

/** Nombre de mois détaillés dans le mail (inchangé). */
export const NB_MOIS_MAIL = 6;

/** Montant au format de la page : « 12 450,00 » (même fonction que la page). */
export const eurMail = eur;

/**
 * Contenu chiffré du mail et de la notification F2.
 * @param {{ donnees: { fournisseurs, commandes, factures, facturesBl }, moisCourant: string }} p
 *   donnees : lireDonneesEncoursFournisseurs (encoursFournisseursLecture.mjs),
 *   les lectures de la page ; moisCourant : « AAAA-MM » (date de Paris).
 * @returns {{
 *   moisCourant: { cle, libelle, aPayer: number, paye: number },
 *   mois: Array<{ mois, libelle, aPayer, paye, total, fourns: Array<{ nom, saisi, facture, paye, aPayer }> }>,
 *   suivants: Array<{ mois, libelle, aPayer: string }>,
 *   nbMoisPage: number, explication: string }}
 */
export function encoursDuMailV2({ donnees, moisCourant } = {}) {
  if (!/^\d{4}-\d{2}$/.test(String(moisCourant || ""))) {
    throw new Error(`Mois en cours invalide (« ${moisCourant} ») : attendu AAAA-MM.`);
  }
  if (!donnees) throw new Error("Données de l'encours absentes.");
  const { moisMap, moisList } = regrouperEncoursParMois(itemsEncoursFournisseurs(donnees));
  // Cartes « À payer · <mois> » et « Payé comptant · <mois> » : même fonction
  // que la page.
  const ceMois = chiffresMoisCourant(moisMap, moisCourant);
  // Mois d'échéance suivants : même fonction que le bloc du jour.
  const { suivants } = partieEncoursV1({ donnees, moisCourant });
  const mois = moisList.slice(0, NB_MOIS_MAIL).map((g) => ({
    mois: g.mois,
    libelle: moisLabel(g.mois),
    aPayer: g.aPayer,
    paye: g.paye,
    total: g.total,
    fourns: fournisseursTriesDuMois(g).map((pf) => ({ nom: pf.nom, saisi: pf.saisi, facture: pf.facture, paye: pf.paye, aPayer: aPayerOf(pf) })),
  }));
  return {
    moisCourant: ceMois,
    mois,
    suivants,
    nbMoisPage: moisList.length,
    explication: EXPLICATION_ENCOURS,
  };
}
