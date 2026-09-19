// ─── TAUX HORAIRES DE VENTE — RÈGLES PURES ───────────────────────────────────
// Instance nommée du référentiel de vente générique (referentielVente.mjs) pour
// la table Supabase taux_horaires_vente (€ HT/h, prix MO = cadence × taux).
// Module PUR : aucun accès Supabase. Testé par scripts/verif-taux-horaires-vente.mjs.
// Les garanties fortes vivent en base (migration 20260915140000) : un seul
// défaut, défaut toujours actif, défaut ni désactivable ni supprimable, au moins
// un actif, taux inactif/inexistant refusé sur un ouvrage, RLS écriture admin.

import { arrondirMontant, num, validerTauxHoraire } from "./chiffragePricing.mjs";
import { creerReferentielVente } from "./referentielVente.mjs";

/** Taux créé par la migration : actif et par défaut. */
export const TAUX_STANDARD = Object.freeze({ libelle: "Taux standard", taux_ht: 80 });

/** 80 → « 80,00 € HT/h » (2 décimales, fr-FR). */
export function formaterTauxHT(taux) {
  const t = num(taux);
  if (t == null) return "—";
  return `${t.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € HT/h`;
}

export const REFERENTIEL_TAUX = creerReferentielVente({
  nom: "taux horaire", nomPluriel: "taux horaires", genre: "m",
  champValeur: "taux_ht",
  formaterValeur: formaterTauxHT,
  validerValeur: validerTauxHoraire,
  messageValeurInvalide: "le taux HT/h doit être strictement supérieur à zéro.",
  migration: "20260915140000_taux_horaires_vente.sql",
  reglages: "Réglages → Taux horaires → « Taux horaires de main-d'œuvre »",
});

/** « Taux standard — 80,00 € HT/h » (+ « (désactivé) » si demandé et inactif). */
export const libelleTaux = REFERENTIEL_TAUX.libelle;
export const indexerTaux = REFERENTIEL_TAUX.indexer;
export const comparerTaux = REFERENTIEL_TAUX.comparer;
export const tauxActifs = REFERENTIEL_TAUX.actifs;
export const tauxParDefaut = REFERENTIEL_TAUX.parDefaut;
export const optionsSelectTaux = REFERENTIEL_TAUX.optionsSelect;
export const tauxSelectionne = REFERENTIEL_TAUX.selectionne;
export const validerTauxOuvrage = REFERENTIEL_TAUX.validerChoixOuvrage;
export const validerSaisieTaux = REFERENTIEL_TAUX.validerSaisie;
export const peutDesactiver = REFERENTIEL_TAUX.peutDesactiver;
export const peutReactiver = REFERENTIEL_TAUX.peutReactiver;
export const peutDefinirDefaut = REFERENTIEL_TAUX.peutDefinirDefaut;
export const avertissementModificationTaux = REFERENTIEL_TAUX.avertissementModification;
export const diagnostiquerListe = REFERENTIEL_TAUX.diagnostiquer;
export const messageErreurSupabase = REFERENTIEL_TAUX.messageErreur;

/** « 2,50 h × 80,00 €/h = 200,00 € HT » — explication du prix MO d'un ouvrage. */
export function expliquerPrixMainOeuvre(cadence, tauxHT) {
  const h = num(cadence), t = num(tauxHT);
  if (h == null || h <= 0 || t == null || t <= 0) return null;
  const fmt2 = (n) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${fmt2(h)} h × ${fmt2(t)} €/h = ${fmt2(arrondirMontant(h * t))} € HT`;
}
