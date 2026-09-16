// ─── CHIFFRAGE — CALCULS FINANCIERS PURS ─────────────────────────────────────
// Profero est la source de vérité du prix. Ce module ne lit ni n'écrit
// Supabase : il reçoit des objets (ouvrage de bibliothèque, matériaux, lignes
// de profero_ouvrages_selectionnes, projet) et rend des nombres, des
// snapshots et des diagnostics. Testé par scripts/verif-chiffrage-pricing.mjs.
//
// Vocabulaire
//   • cadence (bibliotheque_ratios.cadence) : HEURES PAR UNITÉ d'ouvrage.
//   • taux horaire de VENTE (taux_horaires_vente.taux_ht, € HT/h) : choisi dans
//     chaque fiche ouvrage (bibliotheque_ratios.taux_horaire_vente_id). C'est
//     lui qui fixe le PRIX de la main-d'œuvre. Absent ⇒ prix incalculable.
//   • coût horaire (planning_config.taux_mo_previsionnel, €/h chargé) : sert au
//     COÛT de la main-d'œuvre, donc à la marge. Absent ⇒ marge non calculable
//     (avertissement), le prix reste calculable.
//   • coefficient de vente (coefficients_vente.valeur, ex. 1,50) : choisi dans
//     chaque fiche ouvrage (bibliotheque_ratios.coefficient_vente_id). Appliqué
//     aux MATÉRIAUX (et au coût direct complémentaire, traitement historique
//     conservé) — plus à la main-d'œuvre. Les colonnes bibliotheque_ratios.coef_vente
//     et taux_marge_pct sont OBSOLÈTES (figées en base) et ne sont plus lues.
//   • taux de marge (taux_marge_pct) : en POURCENTAGE du prix de vente HT,
//     désormais toujours DÉRIVÉ du prix et du coût (jamais saisi).
//
// Formules (CALCUL_VERSION 2)
//   coût matériaux u.  = Σ (quantité matériau par unité × prix d'achat)
//   coût MO u.         = cadence × coût horaire chargé
//   coût total u.      = matériaux + MO + coût direct complémentaire
//   prix matériaux u.  = coût matériaux × coefficient
//   prix coût direct u.= coût direct complémentaire × coefficient   (inchangé : il
//                        recevait déjà le coefficient dans l'ancienne formule)
//   prix MO u.         = cadence × taux horaire de vente sélectionné
//   prix de vente HT   = prix matériaux + prix coût direct + prix MO
//   marge €            = prix de vente − coût total
//   taux de marge      = (prix de vente − coût total) / prix de vente × 100
//   taux global devis  = (Σ vente HT − Σ coût) / Σ vente HT   (pondéré, pas une
//                        moyenne des taux)
//   Un ouvrage sans matériau ni coût direct n'a pas besoin de coefficient (la
//   référence existe quand même : NOT NULL en base).
//
// Arrondi : arrondirMontant (2 décimales, demi-centime vers le haut) est
// l'unique politique d'arrondi monétaire ; les pourcentages sont rendus à
// 2 décimales. Aucune fonction ne rend NaN ni Infinity : les cas impossibles
// rendent null accompagnés d'un message d'erreur.

import { parseCodeOuvrage } from "./codeOuvrage.mjs";

export const CALCUL_VERSION = 2;
/** Libellé de la formule figé dans calcul_detail (audit des snapshots). */
export const FORMULE_PRIX = "prix = matériaux × coef + coût direct × coef + cadence × taux horaire de vente";
export const ZONE_DEFAUT = "Logement entier";
export const ZONES_SUGGEREES = Object.freeze([
  "Logement entier", "Entrée", "Séjour", "Cuisine", "Chambre 1", "Chambre 2",
  "Chambre 3", "Salle de bains", "WC", "Dégagement", "Extérieur",
]);
export const TYPES_LOGEMENT = Object.freeze(["Studio", "T1", "T1 bis", "T2", "T3", "T4", "T5", "Autre"]);
export const TVA_TAUX_USUELS = Object.freeze([5.5, 10, 20]);

// ─── Utilitaires ─────────────────────────────────────────────────────────────
const str = (v) => String(v ?? "").trim();
export function num(v) {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Arrondi monétaire unique : 2 décimales, demi-centime vers le haut (en valeur absolue). */
export function arrondirMontant(n) {
  const v = num(n);
  if (v == null) return null;
  const signe = v < 0 ? -1 : 1;
  return signe * Math.round((Math.abs(v) + 1e-9) * 100) / 100;
}
/** Arrondi d'un pourcentage à 2 décimales. */
export function arrondirPct(n) {
  return arrondirMontant(n);
}

/** « m2 » → « m² », « u » → « U » ; le reste inchangé. */
export function normaliserUnite(u) {
  const s = str(u) || "U";
  if (/^m2$/i.test(s)) return "m²";
  if (/^u$/i.test(s)) return "U";
  return s;
}

function indexerMateriaux(materiaux) {
  if (materiaux instanceof Map) return materiaux;
  const map = new Map();
  if (Array.isArray(materiaux)) materiaux.forEach(m => { if (m && m.id != null) map.set(String(m.id), m); });
  else if (materiaux && typeof materiaux === "object") Object.entries(materiaux).forEach(([k, m]) => map.set(String(k), m));
  return map;
}

// ─── Taux de marge ───────────────────────────────────────────────────────────
/** @returns {{ valide: boolean, valeur: number|null, erreur: string|null }} */
export function validerTauxMarge(taux) {
  if (taux == null || (typeof taux === "string" && taux.trim() === "")) {
    return { valide: false, valeur: null, erreur: "Taux de marge non renseigné" };
  }
  const t = num(taux);
  if (t == null) return { valide: false, valeur: null, erreur: "Taux de marge invalide" };
  if (t < 0) return { valide: false, valeur: null, erreur: "Taux de marge négatif" };
  if (t >= 100) return { valide: false, valeur: null, erreur: "Taux de marge ≥ 100 % impossible (le prix de vente serait infini)" };
  return { valide: true, valeur: t, erreur: null };
}

/**
 * Prix de vente HT = coût total / (1 − taux / 100).
 * Ex : 1 000 € à 30 % ⇒ 1 428,57 €. Rend null si le coût ou le taux est invalide.
 */
export function prixVenteDepuisMarge(coutTotal, tauxPct) {
  const c = num(coutTotal);
  const t = validerTauxMarge(tauxPct);
  if (c == null || c < 0 || !t.valide) return null;
  return arrondirMontant(c / (1 - t.valeur / 100));
}

// ─── Coefficient de vente (saisie métier : « × 1,5 ») ────────────────────────
/** @returns {{ valide: boolean, valeur: number|null, erreur: string|null }} — coefficient ≥ 1. */
export function validerCoefficient(coef) {
  if (coef == null || (typeof coef === "string" && coef.trim() === "")) {
    return { valide: false, valeur: null, erreur: "Coefficient de vente non renseigné" };
  }
  const c = num(coef);
  if (c == null) return { valide: false, valeur: null, erreur: "Coefficient de vente invalide" };
  if (c < 1) return { valide: false, valeur: null, erreur: "Coefficient de vente < 1 : le prix serait inférieur au coût" };
  return { valide: true, valeur: c, erreur: null };
}

/** Prix de vente HT = coût total × coefficient (ex : 32,16 × 1,5 = 48,24). */
export function prixVenteDepuisCoefficient(coutTotal, coef) {
  const c = num(coutTotal);
  const k = validerCoefficient(coef);
  if (c == null || c < 0 || !k.valide) return null;
  return arrondirMontant(c * k.valeur);
}

/** Taux de marge (% du prix de vente) équivalent à un coefficient : ×1,5 ⇒ 33,33 %, ×2 ⇒ 50 %. */
export function tauxMargeDepuisCoefficient(coef) {
  const k = validerCoefficient(coef);
  if (!k.valide) return null;
  return arrondirPct((1 - 1 / k.valeur) * 100);
}

/** Coefficient équivalent à un taux de marge sur prix de vente : 33,33 % ⇒ ×1,5, 50 % ⇒ ×2. */
export function coefficientDepuisTauxMarge(tauxPct) {
  const t = validerTauxMarge(tauxPct);
  if (!t.valide) return null;
  return Math.round((1 / (1 - t.valeur / 100)) * 10000) / 10000;
}

/** Marge en euros = prix de vente − coût total (null si l'un des deux manque). */
export function margeEuros(prixVente, coutTotal) {
  const p = num(prixVente), c = num(coutTotal);
  if (p == null || c == null) return null;
  return arrondirMontant(p - c);
}

/** Taux de marge réel (%) = (prix − coût) / prix × 100 ; null si prix ≤ 0. */
export function tauxMargeReel(prixVente, coutTotal) {
  const p = num(prixVente), c = num(coutTotal);
  if (p == null || c == null || p <= 0) return null;
  return arrondirPct((p - c) / p * 100);
}

// ─── Coûts unitaires d'un ouvrage de bibliothèque ────────────────────────────
/**
 * Coût matériaux pour 1 unité d'ouvrage.
 * @param ouvrage  bibliotheque_ratios { materiaux_liens: [{ materiau_id, quantite }] }
 * @param materiaux  tableau ou Map de materiaux_bibliotheque { id, nom, unite, prix_unitaire }
 */
export function coutMateriauxUnitaire(ouvrage, materiaux) {
  const index = indexerMateriaux(materiaux);
  const liens = (Array.isArray(ouvrage?.materiaux_liens) ? ouvrage.materiaux_liens : []).filter(l => l && l.materiau_id != null);
  const erreurs = [];
  const lignes = [];
  let total = 0;
  liens.forEach(l => {
    const mat = index.get(String(l.materiau_id));
    if (!mat) { erreurs.push(`Matériau introuvable dans la bibliothèque (id ${l.materiau_id})`); return; }
    const prix = num(mat.prix_unitaire);
    const q = num(l.quantite);
    if (prix == null) erreurs.push(`Matériau sans prix : ${mat.nom || l.materiau_id}`);
    if (q == null) erreurs.push(`Quantité par unité manquante : ${mat.nom || l.materiau_id}`);
    const ligne = { materiau_id: l.materiau_id, nom: mat.nom || "", unite: mat.unite || "", quantite: q, prix_unitaire: prix, total: (prix != null && q != null) ? arrondirMontant(prix * q) : null };
    lignes.push(ligne);
    if (ligne.total != null) total += prix * q;
  });
  return { montant: erreurs.length === 0 ? arrondirMontant(total) : null, lignes, erreurs, nbLiens: liens.length };
}

/**
 * Coût de main-d'œuvre pour 1 unité = cadence (h/unité) × coût horaire (€/h).
 */
export function coutMainOeuvreUnitaire(ouvrage, coutHoraire) {
  const erreurs = [];
  const h = num(ouvrage?.cadence);
  const c = num(coutHoraire);
  if (h == null || h <= 0) erreurs.push("Cadence (heures par unité) absente");
  if (c == null || c <= 0) erreurs.push("Coût horaire de référence non configuré (Admin → Taux → taux horaire moyen)");
  return {
    heures: h != null && h > 0 ? h : null,
    coutHoraire: c != null && c > 0 ? c : null,
    montant: erreurs.length === 0 ? arrondirMontant(h * c) : null,
    erreurs,
  };
}

/** Coût total unitaire = matériaux + MO + coût direct complémentaire (null si un terme calculable manque). */
export function coutTotalUnitaire({ coutMateriaux, coutMainOeuvre, coutDirect = 0 }) {
  const m = num(coutMateriaux), mo = num(coutMainOeuvre), d = num(coutDirect) ?? 0;
  if (m == null || mo == null) return null;
  return arrondirMontant(m + mo + d);
}

// ─── Référentiels de vente (taux horaires, coefficients) ─────────────────────
function indexerParId(liste) {
  if (liste instanceof Map) return liste;
  const map = new Map();
  if (Array.isArray(liste)) liste.forEach(t => { if (t && t.id != null) map.set(String(t.id), t); });
  else if (liste && typeof liste === "object") Object.entries(liste).forEach(([k, t]) => map.set(String(k), t));
  return map;
}
const indexerTauxHoraires = indexerParId;

/** Une valeur de coefficient de vente est-elle valide ? Strictement positive, finie, 4 décimales max (arrondie). */
export function validerValeurCoefficient(v) {
  if (v == null || (typeof v === "string" && v.trim() === "")) {
    return { valide: false, valeur: null, erreur: "Coefficient non renseigné" };
  }
  const c = num(v);
  if (c == null) return { valide: false, valeur: null, erreur: "Coefficient invalide" };
  if (c <= 0) return { valide: false, valeur: null, erreur: "Coefficient nul ou négatif" };
  return { valide: true, valeur: Math.round(c * 10000) / 10000, erreur: null };
}

/**
 * Résout le coefficient de vente d'un ouvrage.
 *   • ouvrage.coefficient_vente_valeur : VALEUR SAISIE sur la fiche (source principale) ;
 *   • repli historique : ouvrage.coefficient_vente_id cherché dans ctx.coefficientsVente,
 *     ouvrage.coefficient_vente (objet joint) ou ctx.coefficientVente (objet ou nombre, tests).
 * Un coefficient DÉSACTIVÉ reste utilisable (l'ouvrage le conserve) : avertissement, pas erreur.
 * bibliotheque_ratios.coef_vente (obsolète) n'est JAMAIS lu.
 * @returns {{ valide, id, libelle, valeur, actif, saisie, erreur, avertissement }}
 */
export function resoudreCoefficientVente(ouvrage, { coefficientsVente = null, coefficientVente = null } = {}) {
  // Valeur tapée sur la fiche de l'ouvrage : elle prime sur tout référentiel.
  if (ouvrage?.coefficient_vente_valeur != null && String(ouvrage.coefficient_vente_valeur).trim() !== "") {
    const vs = validerValeurCoefficient(ouvrage.coefficient_vente_valeur);
    if (vs.valide) return { valide: true, id: null, libelle: null, valeur: vs.valeur, actif: true, saisie: true, erreur: null, avertissement: null };
    return { valide: false, id: null, libelle: null, valeur: null, actif: null, saisie: true, erreur: `Coefficient de vente de l'ouvrage invalide : ${vs.erreur}`, avertissement: null };
  }
  const id = ouvrage?.coefficient_vente_id != null ? String(ouvrage.coefficient_vente_id) : null;
  const index = indexerParId(coefficientsVente);
  let ligne = id ? index.get(id) ?? null : null;
  if (!ligne && ouvrage?.coefficient_vente && typeof ouvrage.coefficient_vente === "object") ligne = ouvrage.coefficient_vente;
  if (!ligne && coefficientVente != null) ligne = typeof coefficientVente === "object" ? coefficientVente : { id: id ?? null, libelle: "Coefficient", valeur: coefficientVente, actif: true };
  if (!ligne) {
    return {
      valide: false, id, libelle: null, valeur: null, actif: null, avertissement: null,
      saisie: false,
      erreur: id
        ? "Coefficient de vente introuvable dans la liste des coefficients (Réglages → Taux horaires)"
        : "Coefficient de vente non renseigné sur la fiche de l'ouvrage (Bibliothèque)",
    };
  }
  const v = validerValeurCoefficient(ligne.valeur);
  if (!v.valide) return { valide: false, id: ligne.id != null ? String(ligne.id) : id, libelle: str(ligne.libelle) || null, valeur: null, actif: ligne.actif !== false, erreur: `Coefficient « ${str(ligne.libelle)} » invalide : ${v.erreur}`, avertissement: null };
  const actif = ligne.actif !== false;
  return {
    valide: true,
    id: ligne.id != null ? String(ligne.id) : id,
    libelle: str(ligne.libelle) || null,
    valeur: v.valeur,
    actif,
    erreur: null,
    avertissement: actif ? null : `Coefficient « ${str(ligne.libelle)} » désactivé : l'ouvrage le conserve, en choisir un autre pour les futurs chiffrages`,
  };
}

/** Une valeur de taux (€ HT/h) est-elle valide ? Strictement positive, finie, 2 décimales max tolérées (arrondie). */
export function validerTauxHoraire(taux) {
  if (taux == null || (typeof taux === "string" && taux.trim() === "")) {
    return { valide: false, valeur: null, erreur: "Taux horaire non renseigné" };
  }
  const t = num(taux);
  if (t == null) return { valide: false, valeur: null, erreur: "Taux horaire invalide" };
  if (t <= 0) return { valide: false, valeur: null, erreur: "Taux horaire nul ou négatif" };
  return { valide: true, valeur: arrondirMontant(t), erreur: null };
}

/**
 * Résout le taux horaire de vente d'un ouvrage.
 *   • ouvrage.taux_horaire_vente_valeur : VALEUR SAISIE sur la fiche (source principale) ;
 *   • repli historique : ouvrage.taux_horaire_vente_id cherché dans ctx.tauxHoraires,
 *     ouvrage.taux_horaire_vente (objet joint) ou ctx.tauxHoraire (objet ou nombre, tests).
 * Un taux DÉSACTIVÉ reste utilisable (l'ouvrage garde son taux) : avertissement, pas erreur.
 * @returns {{ valide, id, libelle, valeur, actif, saisie, erreur, avertissement }}
 */
export function resoudreTauxHoraire(ouvrage, { tauxHoraires = null, tauxHoraire = null } = {}) {
  // Valeur tapée sur la fiche de l'ouvrage : elle prime sur tout référentiel.
  if (ouvrage?.taux_horaire_vente_valeur != null && String(ouvrage.taux_horaire_vente_valeur).trim() !== "") {
    const vs = validerTauxHoraire(ouvrage.taux_horaire_vente_valeur);
    if (vs.valide) return { valide: true, id: null, libelle: null, valeur: vs.valeur, actif: true, saisie: true, erreur: null, avertissement: null };
    return { valide: false, id: null, libelle: null, valeur: null, actif: null, saisie: true, erreur: `Taux horaire de vente de l'ouvrage invalide : ${vs.erreur}`, avertissement: null };
  }
  const id = ouvrage?.taux_horaire_vente_id != null ? String(ouvrage.taux_horaire_vente_id) : null;
  const index = indexerTauxHoraires(tauxHoraires);
  let ligne = id ? index.get(id) ?? null : null;
  if (!ligne && ouvrage?.taux_horaire_vente && typeof ouvrage.taux_horaire_vente === "object") ligne = ouvrage.taux_horaire_vente;
  if (!ligne && tauxHoraire != null) ligne = typeof tauxHoraire === "object" ? tauxHoraire : { id: id ?? null, libelle: "Taux horaire", taux_ht: tauxHoraire, actif: true };
  if (!ligne) {
    return {
      valide: false, id, libelle: null, valeur: null, actif: null, avertissement: null,
      saisie: false,
      erreur: id
        ? "Taux horaire de main-d'œuvre introuvable dans la liste des taux (Réglages → Taux horaires)"
        : "Taux horaire de main-d'œuvre non renseigné sur la fiche de l'ouvrage (Bibliothèque)",
    };
  }
  const v = validerTauxHoraire(ligne.taux_ht);
  if (!v.valide) return { valide: false, id: ligne.id != null ? String(ligne.id) : id, libelle: str(ligne.libelle) || null, valeur: null, actif: ligne.actif !== false, erreur: `Taux horaire « ${str(ligne.libelle)} » invalide : ${v.erreur}`, avertissement: null };
  const actif = ligne.actif !== false;
  return {
    valide: true,
    id: ligne.id != null ? String(ligne.id) : id,
    libelle: str(ligne.libelle) || null,
    valeur: v.valeur,
    actif,
    erreur: null,
    avertissement: actif ? null : `Taux horaire « ${str(ligne.libelle)} » désactivé : l'ouvrage le conserve, en choisir un autre pour les futurs chiffrages`,
  };
}

/** Prix de vente de la main-d'œuvre pour 1 unité = cadence (h/u) × taux horaire de vente (€ HT/h). */
export function prixMainOeuvreUnitaire(cadence, tauxHoraire) {
  const h = num(cadence), t = num(tauxHoraire);
  if (h == null || h <= 0 || t == null || t <= 0) return null;
  return arrondirMontant(h * t);
}

/** Prix de vente des matériaux pour 1 unité = coût matériaux × coefficient (≥ 1). */
export function prixMateriauxUnitaire(coutMateriaux, coef) {
  const c = num(coutMateriaux);
  const k = validerCoefficient(coef);
  if (c == null || c < 0 || !k.valide) return null;
  return arrondirMontant(c * k.valeur);
}

/**
 * Calcul complet d'un ouvrage de bibliothèque.
 * @param ouvrage  ligne bibliotheque_ratios (libelle, unite, cadence, materiaux_liens,
 *                 main_oeuvre_seule, cout_direct_unitaire, taux_horaire_vente_id,
 *                 coefficient_vente_id)
 * @param ctx      { materiaux, coutHoraire, tauxHoraires, coefficientsVente, tauxHoraire?, coefficientVente? }
 *                 tauxHoraires      = lignes taux_horaires_vente (tableau ou Map) ;
 *                 coefficientsVente = lignes coefficients_vente (tableau ou Map) ;
 *                 coutHoraire       = coût horaire chargé (marge uniquement, non bloquant).
 */
// ─── Résolution d'un paramètre de vente : trois niveaux ──────────────────────
// Un paramètre de vente (coefficient OU taux horaire) appliqué à UNE ligne de
// chiffrage peut venir de trois endroits, dans cet ordre de priorité :
//   1. dérogation propre à la ligne   (mode « specifique », valeur figée sur la ligne)
//   2. condition globale du chiffrage (mode « heritage » + coefficient/taux global figé sur le projet)
//   3. paramètre d'origine de l'ouvrage (mode « ouvrage », ou « heritage » sans condition globale)
// Le mode « ouvrage » force volontairement le paramètre de l'ouvrage MÊME si une
// condition globale existe. Les deux paramètres (coefficient, taux) sont
// totalement indépendants : chaque ligne a son propre mode pour chacun.
// Cette fonction est la SOURCE UNIQUE de la règle : interface, simulation, RPC
// SQL (conditions_ligne_resoudre) et tests en sont le miroir exact.
export const MODE_LIGNE_HERITAGE = "heritage";
export const MODE_LIGNE_OUVRAGE = "ouvrage";
export const MODE_LIGNE_SPECIFIQUE = "specifique";
export const MODES_LIGNE = Object.freeze([MODE_LIGNE_HERITAGE, MODE_LIGNE_OUVRAGE, MODE_LIGNE_SPECIFIQUE]);

/** Provenance de la valeur réellement appliquée (colonnes coefficient_source / taux_horaire_source). */
export const SOURCE_OUVRAGE = "ouvrage";
export const SOURCE_GLOBAL = "global_chiffrage";
export const SOURCE_LIGNE = "ligne";

/** Mode de ligne valide, sinon « heritage ». */
export function normaliserModeLigne(mode) {
  const m = str(mode);
  return MODES_LIGNE.includes(m) ? m : MODE_LIGNE_HERITAGE;
}

/** { id, valeur, libelle } si la valeur est strictement positive, sinon null (jamais inventée). */
function valeurVente(source) {
  if (!source) return null;
  const valeur = num(source.valeur);
  if (valeur == null || valeur <= 0) return null;
  return { id: source.id != null ? String(source.id) : null, valeur, libelle: str(source.libelle) || null };
}

/**
 * Valeur réellement appliquée à une ligne pour UN paramètre de vente.
 * @param mode       'heritage' | 'ouvrage' | 'specifique' (mode de la ligne)
 * @param specifique dérogation figée sur la ligne  { id, valeur, libelle }
 * @param globale    condition globale figée sur le chiffrage { id, valeur, libelle }
 * @param origine    paramètre figé de l'ouvrage    { id, valeur, libelle }
 * @returns {{ mode, valeur, source, id, libelle, valide, specifique, globale, origine }}
 */
export function resoudreParametreVente({ mode = MODE_LIGNE_HERITAGE, specifique = null, globale = null, origine = null } = {}) {
  const m = normaliserModeLigne(mode);
  const spec = valeurVente(specifique), glob = valeurVente(globale), orig = valeurVente(origine);
  let choix = null, source = SOURCE_OUVRAGE;
  if (m === MODE_LIGNE_SPECIFIQUE) { choix = spec; source = SOURCE_LIGNE; }
  else if (m === MODE_LIGNE_OUVRAGE) { choix = orig; source = SOURCE_OUVRAGE; }
  else if (glob) { choix = glob; source = SOURCE_GLOBAL; }
  else { choix = orig; source = SOURCE_OUVRAGE; }
  return {
    mode: m,
    valeur: choix ? choix.valeur : null,
    source,
    id: choix ? choix.id : null,
    libelle: choix ? choix.libelle : null,
    valide: choix != null,
    specifique: spec, globale: glob, origine: orig,
  };
}

/**
 * Conditions GLOBALES d'un chiffrage (voir conditionsChiffrage.mjs) : un
 * coefficient et/ou un taux horaire global, figés sur le projet. Ils ne
 * s'appliquent qu'aux lignes en mode « heritage ». L'origine (valeur de
 * l'ouvrage) reste figée sur la ligne pour permettre le retour en arrière.
 */
function conditionGlobale(cond) {
  if (!cond || cond.mode !== "global") return null;
  const valeur = num(cond.valeur);
  if (valeur == null || valeur <= 0) return null;
  return { id: cond.id != null ? String(cond.id) : null, valeur, libelle: str(cond.libelle) || null };
}

/**
 * Modes et dérogations d'une ligne (colonnes mode_*_ligne / *_ligne_valeur),
 * avec repli sur calcul_detail pour les lignes figées avant la migration.
 * Une ligne sans mode enregistré est en « heritage » : comportement d'avant.
 */
export function lireModesLigne(ligne) {
  const l = ligne || {}, d = l.calcul_detail || {};
  const dc = d.coefficient_applique || {}, dt = d.taux_applique || {};
  const lire = (mode, id, valeur, libelle, modeDetail, detail) => {
    const m = normaliserModeLigne(mode ?? modeDetail);
    if (m !== MODE_LIGNE_SPECIFIQUE) return { mode: m, id: null, valeur: null, libelle: null };
    const v = num(valeur) ?? num(detail?.valeur);
    if (v == null || v <= 0) return { mode: MODE_LIGNE_HERITAGE, id: null, valeur: null, libelle: null };
    return { mode: m, id: (id ?? detail?.ligne_id ?? null) != null ? String(id ?? detail?.ligne_id) : null, valeur: v, libelle: str(libelle) || str(detail?.libelle) || null };
  };
  return {
    coefficient: lire(l.mode_coefficient_ligne, l.coefficient_ligne_id, l.coefficient_ligne_valeur, l.coefficient_ligne_libelle, dc.mode, dc.specifique),
    tauxHoraire: lire(l.mode_taux_horaire_ligne, l.taux_horaire_ligne_id, l.taux_horaire_ligne_valeur, l.taux_horaire_ligne_libelle, dt.mode, dt.specifique),
  };
}

/** Modes par défaut d'une NOUVELLE ligne : héritage des deux paramètres, aucune dérogation. */
export const MODES_LIGNE_DEFAUT = Object.freeze({
  coefficient: Object.freeze({ mode: MODE_LIGNE_HERITAGE, id: null, valeur: null, libelle: null }),
  tauxHoraire: Object.freeze({ mode: MODE_LIGNE_HERITAGE, id: null, valeur: null, libelle: null }),
});

export function calculerOuvrage(ouvrage, { materiaux = [], coutHoraire = null, tauxHoraires = null, tauxHoraire = null, coefficientsVente = null, coefficientVente = null, conditions = null, modesLigne = null } = {}) {
  const erreurs = [];
  const condCoef = conditionGlobale(conditions?.coefficient);
  const condTaux = conditionGlobale(conditions?.tauxHoraire);
  // Modes de la LIGNE (derogations). Absents = heritage : comportement d'avant.
  const modes = modesLigne && (modesLigne.coefficient || modesLigne.tauxHoraire) ? modesLigne : MODES_LIGNE_DEFAUT;
  const modeCoef = modes.coefficient || MODES_LIGNE_DEFAUT.coefficient;
  const modeTaux = modes.tauxHoraire || MODES_LIGNE_DEFAUT.tauxHoraire;
  const avertissements = [];
  const code = parseCodeOuvrage(ouvrage?.libelle);
  const mainOeuvreSeule = ouvrage?.main_oeuvre_seule === true;

  const mat = coutMateriauxUnitaire(ouvrage, materiaux);
  const mo = coutMainOeuvreUnitaire(ouvrage, coutHoraire);
  erreurs.push(...mat.erreurs);
  // Cadence absente : bloquant (prix MO impossible). Coût horaire chargé
  // absent : la MARGE seule est indisponible ⇒ avertissement.
  mo.erreurs.forEach(e => {
    if (/cadence/i.test(e)) erreurs.push(e);
    else avertissements.push("Coût horaire chargé de référence non configuré (Réglages → Taux) : coût et marge non calculables");
  });

  if (mat.nbLiens === 0 && !mainOeuvreSeule) {
    erreurs.push("Aucun matériau lié — cocher « main-d'œuvre seule » si l'ouvrage n'en comporte pas");
  }
  if (mat.nbLiens > 0 && mainOeuvreSeule) {
    avertissements.push("Marqué « main-d'œuvre seule » alors que des matériaux sont liés : ils sont comptés dans le coût");
  }

  const coutDirect = num(ouvrage?.cout_direct_unitaire);
  if (coutDirect != null && coutDirect < 0) erreurs.push("Coût direct complémentaire négatif");
  const coutDirectU = coutDirect != null && coutDirect >= 0 ? arrondirMontant(coutDirect) : 0;

  // Taux horaire de VENTE : fixe le prix de la main-d'œuvre.
  // Origine = taux de l'ouvrage (figé pour traçabilité / retour arrière) ;
  // appliqué = dérogation de ligne > taux global du chiffrage > origine.
  const tauxOrigine = resoudreTauxHoraire(ouvrage, { tauxHoraires, tauxHoraire });
  const tauxRes = resoudreParametreVente({
    mode: modeTaux.mode, specifique: modeTaux, globale: condTaux,
    origine: tauxOrigine.valide ? { id: tauxOrigine.id, valeur: tauxOrigine.valeur, libelle: tauxOrigine.libelle } : null,
  });
  const taux = tauxRes.source === SOURCE_OUVRAGE
    ? { ...tauxOrigine, source: SOURCE_OUVRAGE }
    : { valide: tauxRes.valide, id: tauxRes.id, libelle: tauxRes.libelle, valeur: tauxRes.valeur, actif: true, erreur: null, avertissement: null, source: tauxRes.source };
  if (!tauxOrigine.valide) {
    // Le taux d'origine n'est bloquant que si c'est lui qui est appliqué.
    if (tauxRes.source === SOURCE_OUVRAGE) erreurs.push(tauxOrigine.erreur);
    else avertissements.push(`${tauxOrigine.erreur} — taux d'origine non figé : retour aux paramètres de l'ouvrage impossible pour cette ligne`);
  } else if (tauxOrigine.avertissement && tauxRes.source === SOURCE_OUVRAGE) avertissements.push(tauxOrigine.avertissement);
  if (modeTaux.mode === MODE_LIGNE_SPECIFIQUE && !tauxRes.valide) erreurs.push("Taux horaire spécifique à cette ligne absent ou invalide");

  // Coefficient de vente : référence coefficient_vente_id résolue dans la liste
  // coefficients_vente. Appliqué aux matériaux (+ coût direct, traitement
  // historique conservé). Inutile si l'ouvrage n'a ni matériau ni coût direct.
  // Les colonnes obsolètes coef_vente / taux_marge_pct ne sont jamais lues.
  const coefRequis = mat.nbLiens > 0 || coutDirectU > 0;
  const coefOrigine = resoudreCoefficientVente(ouvrage, { coefficientsVente, coefficientVente });
  const coefResolu = resoudreParametreVente({
    mode: modeCoef.mode, specifique: modeCoef, globale: condCoef,
    origine: coefOrigine.valide ? { id: coefOrigine.id, valeur: coefOrigine.valeur, libelle: coefOrigine.libelle } : null,
  });
  const coefRes = coefResolu.source === SOURCE_OUVRAGE
    ? { ...coefOrigine, source: SOURCE_OUVRAGE }
    : { valide: coefResolu.valide, id: coefResolu.id, libelle: coefResolu.libelle, valeur: coefResolu.valeur, actif: true, erreur: null, avertissement: null, source: coefResolu.source };
  if (coefResolu.source !== SOURCE_OUVRAGE && !coefOrigine.valide && coefRequis) {
    avertissements.push(`${coefOrigine.erreur} — coefficient d'origine non figé : retour aux paramètres de l'ouvrage impossible pour cette ligne`);
  }
  if (modeCoef.mode === MODE_LIGNE_SPECIFIQUE && !coefResolu.valide && coefRequis) erreurs.push("Coefficient spécifique à cette ligne absent ou invalide");
  let coef;
  let modePrix;
  if (coefRes.valide) {
    modePrix = "coefficient";
    coef = { valide: true, valeur: coefRes.valeur };
    if (coefRes.avertissement) avertissements.push(coefRes.avertissement);
  } else if (coefRequis) {
    modePrix = null;
    coef = { valide: false, valeur: null };
    erreurs.push(coefRes.erreur);
  } else {
    modePrix = "sans_materiaux";
    coef = { valide: true, valeur: 1 };   // rien à multiplier
  }

  const prixMO = taux.valide ? prixMainOeuvreUnitaire(ouvrage?.cadence, taux.valeur) : null;
  const prixMat = mat.montant != null && coef.valide ? prixMateriauxUnitaire(mat.montant, coef.valeur) : null;
  const prixDirect = coef.valide ? arrondirMontant(coutDirectU * coef.valeur) : null;
  const coutTotal = coutTotalUnitaire({ coutMateriaux: mat.montant, coutMainOeuvre: mo.montant, coutDirect: coutDirectU });
  const prixVente = prixMO != null && prixMat != null && prixDirect != null ? arrondirMontant(prixMat + prixDirect + prixMO) : null;

  return {
    modePrix,
    coefVente: coef.valide ? coef.valeur : null,
    coefficient: coefRes,
    code: code?.code ?? null,
    libelle: str(ouvrage?.libelle),
    libelleCourt: code?.reste ?? str(ouvrage?.libelle),
    unite: normaliserUnite(ouvrage?.unite),
    mainOeuvreSeule,
    materiaux: mat,
    mainOeuvre: { ...mo, tauxVente: taux.valeur, tauxId: taux.id, tauxLibelle: taux.libelle, tauxActif: taux.actif },
    tauxHoraire: taux,
    // Origine (ouvrage) et application (ouvrage | global_chiffrage), figées sur la ligne
    conditions: {
      coefficient: {
        valeur: coef.valide ? coef.valeur : null,
        mode: coefResolu.mode,
        source: coefResolu.source,
        globalId: coefResolu.source === SOURCE_GLOBAL ? coefResolu.id : null,
        libelle: coefResolu.libelle ?? (coefOrigine.libelle ?? null),
        specifique: coefResolu.specifique,
        origine: { id: coefOrigine.id ?? null, valeur: coefOrigine.valide ? coefOrigine.valeur : null, libelle: coefOrigine.libelle ?? null },
      },
      tauxHoraire: {
        valeur: taux.valide ? taux.valeur : null,
        mode: tauxRes.mode,
        source: tauxRes.source,
        globalId: tauxRes.source === SOURCE_GLOBAL ? tauxRes.id : null,
        libelle: tauxRes.libelle ?? (tauxOrigine.libelle ?? null),
        specifique: tauxRes.specifique,
        origine: { id: tauxOrigine.id ?? null, valeur: tauxOrigine.valide ? tauxOrigine.valeur : null, libelle: tauxOrigine.libelle ?? null },
      },
    },
    coutMateriauxUnitaire: mat.montant,
    coutMainOeuvreUnitaire: mo.montant,
    coutDirectUnitaire: coutDirectU,
    coutTotalUnitaire: coutTotal,
    prixMateriauxUnitaire: prixMat,
    prixDirectUnitaire: prixDirect,
    prixMainOeuvreUnitaire: prixMO,
    // Marge dérivée du prix et du coût (null si le coût horaire chargé manque)
    tauxMargePct: tauxMargeReel(prixVente, coutTotal),
    prixVenteUnitaire: prixVente,
    margeUnitaire: margeEuros(prixVente, coutTotal),
    tauxMargeReel: tauxMargeReel(prixVente, coutTotal),
    erreurs,
    avertissements,
    complet: erreurs.length === 0 && prixVente != null,
  };
}

// ─── Snapshot d'une ligne de chiffrage ───────────────────────────────────────
/**
 * Champs à écrire dans profero_ouvrages_selectionnes quand un ouvrage est
 * ajouté à un projet. Le snapshot est FIGÉ : une modification ultérieure de la
 * bibliothèque ne le touche jamais (voir differencesSnapshot / appliquerActualisation
 * pour une actualisation explicite, ligne par ligne).
 * `prix_unitaire` reste le prix de vente HT unitaire (compatibilité exports).
 */
export function creerSnapshotOuvrage(ouvrage, calcul, { zone = ZONE_DEFAUT, tvaPct = null, quantite = "", date = new Date() } = {}) {
  const c = calcul || calculerOuvrage(ouvrage);
  const iso = date instanceof Date ? date.toISOString() : String(date);
  const cc = c.conditions?.coefficient || {}, ct = c.conditions?.tauxHoraire || {};
  return {
    bibliotheque_id: ouvrage?.id ?? null,
    code_ouvrage: c.code,
    item: c.libelle,
    unite: c.unite,
    zone: str(zone) || ZONE_DEFAUT,
    quantite: quantite ?? "",
    cout_materiaux_unitaire: c.coutMateriauxUnitaire,
    cout_main_oeuvre_unitaire: c.coutMainOeuvreUnitaire,
    cout_direct_unitaire: c.coutDirectUnitaire,
    cout_total_unitaire: c.coutTotalUnitaire,
    taux_marge_pct: c.tauxMargePct,
    // Coefficient FIGÉ : coef_vente = valeur réellement APPLIQUÉE ;
    // coefficient_vente_id + coefficient_origine_* = coefficient de l'OUVRAGE
    // (origine) ; coefficient_source / coefficient_global_id = provenance.
    coef_vente: c.coefVente,
    coefficient_vente_id: cc.origine?.id ?? null,
    coefficient_source: cc.source ?? SOURCE_OUVRAGE,
    coefficient_origine_valeur: cc.origine?.valeur ?? null,
    coefficient_origine_libelle: cc.origine?.libelle ?? null,
    coefficient_global_id: cc.globalId ?? null,
    // Mode de la LIGNE (heritage par défaut) et dérogation figée le cas échéant
    mode_coefficient_ligne: cc.mode ?? MODE_LIGNE_HERITAGE,
    coefficient_ligne_id: cc.mode === MODE_LIGNE_SPECIFIQUE ? (cc.specifique?.id ?? null) : null,
    coefficient_ligne_valeur: cc.mode === MODE_LIGNE_SPECIFIQUE ? (cc.specifique?.valeur ?? null) : null,
    coefficient_ligne_libelle: cc.mode === MODE_LIGNE_SPECIFIQUE ? (cc.specifique?.libelle ?? null) : null,
    // Taux horaire de vente FIGÉ : même découpage origine / appliqué (le prix ne
    // bouge plus si le taux est modifié ensuite dans Réglages)
    taux_horaire_vente_id: ct.origine?.id ?? null,
    taux_horaire_vente: c.tauxHoraire?.valeur ?? null,
    taux_horaire_source: ct.source ?? SOURCE_OUVRAGE,
    taux_horaire_origine_valeur: ct.origine?.valeur ?? null,
    taux_horaire_origine_libelle: ct.origine?.libelle ?? null,
    taux_horaire_global_id: ct.globalId ?? null,
    mode_taux_horaire_ligne: ct.mode ?? MODE_LIGNE_HERITAGE,
    taux_horaire_ligne_id: ct.mode === MODE_LIGNE_SPECIFIQUE ? (ct.specifique?.id ?? null) : null,
    taux_horaire_ligne_valeur: ct.mode === MODE_LIGNE_SPECIFIQUE ? (ct.specifique?.valeur ?? null) : null,
    taux_horaire_ligne_libelle: ct.mode === MODE_LIGNE_SPECIFIQUE ? (ct.specifique?.libelle ?? null) : null,
    prix_unitaire: c.prixVenteUnitaire,
    tva_pct: num(tvaPct),
    calcul_version: `${CALCUL_VERSION}@${iso}`,
    calcul_detail: {
      version: CALCUL_VERSION,
      formule: FORMULE_PRIX,
      date: iso,
      mode_prix: c.modePrix,
      coef_vente: c.coefVente,
      coefficient_vente_id: cc.origine?.id ?? null,
      coefficient_vente_libelle: cc.origine?.libelle ?? null,
      coefficient_vente: cc.origine?.valeur ?? null,
      coefficient_origine: { id: cc.origine?.id ?? null, valeur: cc.origine?.valeur ?? null, libelle: cc.origine?.libelle ?? null },
      coefficient_applique: { valeur: c.coefVente, source: cc.source ?? SOURCE_OUVRAGE, global_id: cc.globalId ?? null, libelle: cc.libelle ?? null, mode: cc.mode ?? MODE_LIGNE_HERITAGE, specifique: cc.mode === MODE_LIGNE_SPECIFIQUE ? (cc.specifique ?? null) : null },
      cout_horaire: c.mainOeuvre.coutHoraire,
      heures_unitaires: c.mainOeuvre.heures,
      taux_horaire_vente_id: ct.origine?.id ?? null,
      taux_horaire_vente_libelle: ct.origine?.libelle ?? null,
      taux_horaire_vente: c.tauxHoraire?.valeur ?? null,
      taux_origine: { id: ct.origine?.id ?? null, valeur: ct.origine?.valeur ?? null, libelle: ct.origine?.libelle ?? null },
      taux_applique: { valeur: c.tauxHoraire?.valeur ?? null, source: ct.source ?? SOURCE_OUVRAGE, global_id: ct.globalId ?? null, libelle: ct.libelle ?? null, mode: ct.mode ?? MODE_LIGNE_HERITAGE, specifique: ct.mode === MODE_LIGNE_SPECIFIQUE ? (ct.specifique ?? null) : null },
      prix_materiaux_unitaire: c.prixMateriauxUnitaire,
      prix_direct_unitaire: c.prixDirectUnitaire,
      prix_main_oeuvre_unitaire: c.prixMainOeuvreUnitaire,
      main_oeuvre_seule: c.mainOeuvreSeule,
      materiaux: c.materiaux.lignes,
      erreurs: c.erreurs,
      avertissements: c.avertissements,
      complet: c.complet,
    },
  };
}

/** Une ligne porte-t-elle un snapshot financier (issue de la bibliothèque v3) ? */
export function ligneEstSnapshot(ligne) {
  return !!str(ligne?.calcul_version);
}

const CHAMPS_SNAPSHOT = [
  ["item", "Libellé"],
  ["unite", "Unité"],
  ["cout_materiaux_unitaire", "Coût matériaux u."],
  ["cout_main_oeuvre_unitaire", "Coût main-d'œuvre u."],
  ["cout_direct_unitaire", "Coût direct u."],
  ["cout_total_unitaire", "Coût total u."],
  ["coef_vente", "Coefficient de vente"],
  ["taux_horaire_vente", "Taux horaire de vente (€/h)"],
  ["taux_marge_pct", "Taux de marge (%)"],
  ["prix_unitaire", "Prix de vente HT u."],
];
/** Colonnes de snapshot absentes des anciennes lignes : pas de fausse différence si la ligne ne les porte pas. */
const CHAMPS_SNAPSHOT_OPTIONNELS = ["coef_vente", "taux_horaire_vente"];

/**
 * Différences entre le snapshot d'une ligne et le calcul actuel de la
 * bibliothèque. Vide ⇒ rien à actualiser.
 * @returns {Array<{ champ, label, avant, apres }>}
 */
export function differencesSnapshot(ligne, ouvrage, calcul) {
  const neuf = creerSnapshotOuvrage(ouvrage, calcul, { zone: ligne?.zone, tvaPct: ligne?.tva_pct, quantite: ligne?.quantite });
  const diffs = [];
  CHAMPS_SNAPSHOT.forEach(([champ, label]) => {
    // Anciennes lignes sans la colonne : on n'affiche pas une fausse différence
    if (CHAMPS_SNAPSHOT_OPTIONNELS.includes(champ) && !(champ in (ligne || {}))) return;
    const avant = typeof neuf[champ] === "number" || neuf[champ] === null ? num(ligne?.[champ]) : str(ligne?.[champ]);
    const apres = typeof neuf[champ] === "number" || neuf[champ] === null ? num(neuf[champ]) : str(neuf[champ]);
    const egal = (avant == null && apres == null) || (avant != null && apres != null && (typeof avant === "number" ? Math.abs(avant - apres) < 0.005 : avant === apres));
    if (!egal) diffs.push({ champ, label, avant, apres });
  });
  return diffs;
}

/**
 * Nouveaux champs d'une ligne actualisée depuis la bibliothèque : le snapshot
 * est recalculé, la zone, la quantité, la TVA et l'ordre sont conservés.
 * N'écrit rien : l'appelant met à jour UNIQUEMENT cette ligne, après confirmation.
 */
export function appliquerActualisation(ligne, ouvrage, calcul, { date = new Date() } = {}) {
  const snap = creerSnapshotOuvrage(ouvrage, calcul, { zone: ligne?.zone, tvaPct: ligne?.tva_pct, quantite: ligne?.quantite, date });
  const { quantite, zone, tva_pct, ...reste } = snap; // conservés tels quels sur la ligne
  return reste;
}

// ─── Totaux d'un devis ───────────────────────────────────────────────────────
/** Total HT d'une ligne = quantité × prix de vente HT unitaire (null si pas de prix). */
export function totalLigneHT(ligne) {
  const q = num(ligne?.quantite), pu = num(ligne?.prix_unitaire);
  if (pu == null) return null;
  return arrondirMontant((q ?? 0) * pu);
}

/**
 * Totaux d'un devis (toutes les lignes d'un projet).
 * Le taux de marge global est PONDÉRÉ : (Σ vente − Σ coût) / Σ vente.
 * Les lignes sans snapshot de coût (anciennes lignes à prix saisi) rendent les
 * coûts « incomplets » : la marge n'est alors pas affichée comme fiable.
 * @param options.tvaPctDefaut  TVA du projet, appliquée aux lignes sans tva_pct
 */
export function totauxDevis(lignes = [], { tvaPctDefaut = null, budgetClient = null } = {}) {
  let venteHT = 0, coutMateriaux = 0, coutMainOeuvre = 0, coutDirect = 0, coutTotal = 0, tva = 0;
  let nbSansPrix = 0, coutsIncomplets = false, tvaIncomplete = false, nbAvecCout = 0;
  const tvaDetail = {};
  (lignes || []).forEach(l => {
    const q = num(l?.quantite) ?? 0;
    const pu = num(l?.prix_unitaire);
    if (pu == null) { nbSansPrix++; return; }
    const ht = q * pu;
    venteHT += ht;
    const ct = num(l?.cout_total_unitaire);
    if (ct == null) coutsIncomplets = true;
    else {
      nbAvecCout++;
      coutTotal += q * ct;
      coutMateriaux += q * (num(l?.cout_materiaux_unitaire) ?? 0);
      coutMainOeuvre += q * (num(l?.cout_main_oeuvre_unitaire) ?? 0);
      coutDirect += q * (num(l?.cout_direct_unitaire) ?? 0);
    }
    const pct = num(l?.tva_pct) ?? num(tvaPctDefaut);
    if (pct == null) tvaIncomplete = true;
    else { tva += ht * pct / 100; tvaDetail[pct] = (tvaDetail[pct] || 0) + ht * pct / 100; }
  });
  const venteArr = arrondirMontant(venteHT);
  const coutArr = arrondirMontant(coutTotal);
  const tvaArr = tvaIncomplete ? null : arrondirMontant(tva);
  const budget = num(budgetClient);
  return {
    nbLignes: (lignes || []).length,
    nbLignesSansPrix: nbSansPrix,
    nbLignesAvecCout: nbAvecCout,
    coutsIncomplets,
    coutMateriaux: arrondirMontant(coutMateriaux),
    coutMainOeuvre: arrondirMontant(coutMainOeuvre),
    coutDirect: arrondirMontant(coutDirect),
    coutTotal: coutArr,
    venteHT: venteArr,
    marge: coutsIncomplets ? null : margeEuros(venteArr, coutArr),
    tauxMargeReel: coutsIncomplets ? null : tauxMargeReel(venteArr, coutArr),
    tvaIncomplete,
    tva: tvaArr,
    tvaDetail: Object.fromEntries(Object.entries(tvaDetail).map(([k, v]) => [k, arrondirMontant(v)])),
    ttc: tvaArr == null ? null : arrondirMontant(venteArr + tvaArr),
    budgetClient: budget,
    ecartBudget: budget != null && venteArr > 0 ? arrondirMontant(venteArr - budget) : null,
  };
}

// ─── Organisation LOT → ZONE → OUVRAGES ──────────────────────────────────────
function rangZone(zone) {
  const i = ZONES_SUGGEREES.indexOf(zone);
  return i === -1 ? ZONES_SUGGEREES.length : i;
}
function comparerLignes(a, b) {
  const oa = num(a?.ordre), ob = num(b?.ordre);
  if (oa != null && ob != null && oa !== ob) return oa - ob;
  if (oa != null && ob == null) return -1;
  if (oa == null && ob != null) return 1;
  const ca = parseCodeOuvrage(a?.code_ouvrage || a?.item), cb = parseCodeOuvrage(b?.code_ouvrage || b?.item);
  if (ca && cb) {
    if (ca.prefixe !== cb.prefixe) return ca.prefixe.localeCompare(cb.prefixe);
    if (ca.numeroValeur !== cb.numeroValeur) return ca.numeroValeur - cb.numeroValeur;
  }
  const ta = str(a?.created_at), tb = str(b?.created_at);
  if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
  return str(a?.item).localeCompare(str(b?.item));
}

/**
 * Regroupe les lignes : [{ lot, total, zones: [{ zone, total, lignes }] }].
 * @param lotsOrdre  libellés de lots dans l'ordre d'affichage souhaité
 */
export function grouperParLotZone(lignes = [], lotsOrdre = []) {
  const parLot = new Map();
  (lignes || []).forEach(l => {
    const lot = str(l?.category) || "Autre";
    const zone = str(l?.zone) || ZONE_DEFAUT;
    if (!parLot.has(lot)) parLot.set(lot, new Map());
    const zones = parLot.get(lot);
    if (!zones.has(zone)) zones.set(zone, []);
    zones.get(zone).push(l);
  });
  const ordreLot = (lot) => { const i = (lotsOrdre || []).indexOf(lot); return i === -1 ? 9999 : i; };
  return [...parLot.entries()]
    .sort(([a], [b]) => ordreLot(a) - ordreLot(b) || a.localeCompare(b))
    .map(([lot, zones]) => {
      const zonesArr = [...zones.entries()]
        .sort(([a], [b]) => rangZone(a) - rangZone(b) || a.localeCompare(b))
        .map(([zone, ls]) => {
          const tri = [...ls].sort(comparerLignes);
          const total = tri.reduce((s, l) => s + (totalLigneHT(l) ?? 0), 0);
          return { zone, lignes: tri, total: arrondirMontant(total) };
        });
      return { lot, zones: zonesArr, total: arrondirMontant(zonesArr.reduce((s, z) => s + z.total, 0)) };
    });
}

/**
 * Structure neutre préparée pour le futur devis ProGBat (niveau 1 = lot,
 * niveau 2 = zone, lignes = ouvrages). Aucun appel réseau ici.
 */
export function structureDevisProGBat(lignes = [], { lotsOrdre = [], tvaPctDefaut = null } = {}) {
  return grouperParLotZone(lignes, lotsOrdre).map(g => ({
    type: "lot", libelle: g.lot, total_ht: g.total,
    enfants: g.zones.map(z => ({
      type: "zone", libelle: z.zone, total_ht: z.total,
      lignes: z.lignes.map(l => ({
        ligne_id: l.id ?? null,
        bibliotheque_id: l.bibliotheque_id ?? null,
        progbat_ligne_id: l.progbat_ligne_id ?? null,
        code: l.code_ouvrage || parseCodeOuvrage(l.item)?.code || null,
        libelle: str(l.item),
        quantite: num(l.quantite) ?? 0,
        unite: normaliserUnite(l.unite),
        prix_unitaire_ht: num(l.prix_unitaire),
        total_ht: totalLigneHT(l),
        tva_pct: num(l.tva_pct) ?? num(tvaPctDefaut),
      })),
    })),
  }));
}

// ─── Projet : logement & préparation du devis ────────────────────────────────
/**
 * Lecture du logement d'un projet, avec repli sur l'ancien tableau `logements`.
 *   • champs renseignés ⇒ source "champs" ;
 *   • une seule valeur dans `logements` ⇒ type repris en repli (source "legacy") ;
 *   • plusieurs valeurs ⇒ aVerifier = true : on NE découpe PAS le projet.
 */
export function lireLogementProjet(projet) {
  const reference = str(projet?.logement_reference);
  let type = str(projet?.type_logement);
  const legacy = (Array.isArray(projet?.logements) ? projet.logements : []).map(str).filter(Boolean);
  let source = reference || type ? "champs" : "vide";
  let repli = false;
  let aVerifier = false;
  let message = null;
  if (legacy.length > 1) {
    aVerifier = true;
    message = `Ancien projet à plusieurs logements (${legacy.join(" · ")}) : un projet = un logement = un devis. Créer un projet par logement (bouton Dupliquer) puis vérifier ce projet.`;
  } else if (legacy.length === 1) {
    if (!type) { type = legacy[0]; repli = true; source = "legacy"; message = `Type de logement repris de l'ancienne composition (${legacy[0]}) : à confirmer.`; }
  }
  return { reference, type, legacy, source, repli, aVerifier, message };
}

/**
 * Le devis est-il prêt à être préparé (futur brouillon ProGBat) ?
 * Bloquants = données indispensables ; avertissements = à compléter idéalement.
 */
export function verifierPreparationDevis(projet = {}, lignes = [], totaux = null) {
  const t = totaux || totauxDevis(lignes, { tvaPctDefaut: projet?.tva_pct });
  const bloquants = [];
  const avertissements = [];
  const logement = lireLogementProjet(projet);
  if (!str(projet.client_nom) && !str(projet.client_societe)) bloquants.push("Nom du client (ou société) manquant");
  if (!str(projet.chantier_adresse) && !str(projet.adresse_bien)) bloquants.push("Adresse du chantier manquante");
  if (!logement.reference) bloquants.push("Référence du logement manquante (ex : Appartement 101)");
  if (!logement.type) bloquants.push("Type de logement manquant");
  if (logement.aVerifier) bloquants.push("Ancien projet multi-logements : à découper manuellement (un projet par logement)");
  if (num(projet.tva_pct) == null) bloquants.push("Taux de TVA du devis non choisi");
  if ((lignes || []).length === 0) bloquants.push("Aucun ouvrage dans le devis");
  if (t.nbLignesSansPrix > 0) bloquants.push(`${t.nbLignesSansPrix} ligne${t.nbLignesSansPrix > 1 ? "s" : ""} sans prix de vente`);
  if (!str(projet.chantier_code_postal) || !str(projet.chantier_ville)) avertissements.push("Code postal / ville du chantier à structurer");
  if (!str(projet.client_email) && !str(projet.client_telephone)) avertissements.push("Aucun contact client (e-mail ou téléphone)");
  if (!str(projet.devis_objet)) avertissements.push("Objet du devis vide");
  if (!str(projet.devis_validite)) avertissements.push("Date de validité du devis non renseignée");
  if (logement.repli) avertissements.push(logement.message);
  if (t.coutsIncomplets) avertissements.push("Certaines lignes n'ont pas de coût figé (anciennes lignes à prix saisi) : la marge globale n'est pas fiable");
  if (t.tvaIncomplete && num(projet.tva_pct) != null) avertissements.push("Certaines lignes n'ont pas de TVA : le taux du projet leur est appliqué");
  return { pret: bloquants.length === 0, bloquants, avertissements, logement, totaux: t };
}
