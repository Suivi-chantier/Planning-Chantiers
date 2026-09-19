// ─── COEFFICIENTS DE VENTE — RÈGLES PURES ────────────────────────────────────
// Instance nommée du référentiel de vente générique (referentielVente.mjs) pour
// la table Supabase coefficients_vente : prix matériaux = coût matériaux ×
// coefficient (idem coût direct complémentaire, formule v2 conservée).
// Module PUR : aucun accès Supabase. Testé par scripts/verif-coefficients-vente.mjs.
// Garanties en base : migration 20260916080000_coefficients_vente.sql (un seul
// défaut actif, désactivation sans suppression, RLS écriture admin, colonnes
// bibliotheque_ratios.coef_vente / taux_marge_pct figées comme OBSOLÈTES).

import { arrondirMontant, num, validerValeurCoefficient } from "./chiffragePricing.mjs";
import { creerReferentielVente } from "./referentielVente.mjs";

/** Coefficient créé par la migration : actif et par défaut. */
export const COEFFICIENT_STANDARD = Object.freeze({ libelle: "Coefficient standard", valeur: 1.5 });

/** 1.5 → « 1,50 » ; 1.675 → « 1,675 » (2 à 4 décimales, fr-FR). */
export function formaterCoefficient(valeur) {
  const v = num(valeur);
  if (v == null) return "—";
  return v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export const REFERENTIEL_COEFFICIENTS = creerReferentielVente({
  nom: "coefficient", nomPluriel: "coefficients de vente", genre: "m",
  champValeur: "valeur",
  formaterValeur: formaterCoefficient,
  validerValeur: validerValeurCoefficient,
  messageValeurInvalide: "le coefficient doit être strictement supérieur à zéro.",
  migration: "20260916080000_coefficients_vente.sql",
  reglages: "Réglages → Taux horaires → « Coefficients de vente »",
});

/** « Coefficient standard — 1,50 » (+ « (désactivé) » si demandé et inactif). */
export const libelleCoefficient = REFERENTIEL_COEFFICIENTS.libelle;
export const indexerCoefficients = REFERENTIEL_COEFFICIENTS.indexer;
export const comparerCoefficients = REFERENTIEL_COEFFICIENTS.comparer;
export const coefficientsActifs = REFERENTIEL_COEFFICIENTS.actifs;
export const coefficientParDefaut = REFERENTIEL_COEFFICIENTS.parDefaut;
export const optionsSelectCoefficients = REFERENTIEL_COEFFICIENTS.optionsSelect;
export const coefficientSelectionne = REFERENTIEL_COEFFICIENTS.selectionne;
export const validerCoefficientOuvrage = REFERENTIEL_COEFFICIENTS.validerChoixOuvrage;
export const validerSaisieCoefficient = REFERENTIEL_COEFFICIENTS.validerSaisie;
export const peutDesactiverCoefficient = REFERENTIEL_COEFFICIENTS.peutDesactiver;
export const peutReactiverCoefficient = REFERENTIEL_COEFFICIENTS.peutReactiver;
export const peutDefinirCoefficientDefaut = REFERENTIEL_COEFFICIENTS.peutDefinirDefaut;
export const avertissementModificationCoefficient = REFERENTIEL_COEFFICIENTS.avertissementModification;
export const diagnostiquerCoefficients = REFERENTIEL_COEFFICIENTS.diagnostiquer;
export const messageErreurCoefficients = REFERENTIEL_COEFFICIENTS.messageErreur;

/** « 100,00 € × 1,50 = 150,00 € HT » — explication du prix matériaux d'un ouvrage. */
export function expliquerPrixMateriaux(coutMateriaux, coefficient) {
  const c = num(coutMateriaux), k = num(coefficient);
  if (c == null || c < 0 || k == null || k <= 0) return null;
  const fmt2 = (n) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${fmt2(c)} € × ${formaterCoefficient(k)} = ${fmt2(arrondirMontant(c * k))} € HT`;
}
