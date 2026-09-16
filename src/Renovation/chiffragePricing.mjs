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
//   • coefficient de vente (bibliotheque_ratios.coef_vente, ex. 1,35) : appliqué
//     aux MATÉRIAUX (et au coût direct complémentaire, traitement historique
//     conservé) — plus à la main-d'œuvre.
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
//   Anciens ouvrages sans coef_vente : coefficient dérivé de taux_marge_pct
//   (repli, équivalent : 1 / (1 − taux/100)). Un ouvrage sans matériau ni coût
//   direct n'a pas besoin de coefficient.
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

// ─── Taux horaire de vente ───────────────────────────────────────────────────
function indexerTauxHoraires(tauxHoraires) {
  if (tauxHoraires instanceof Map) return tauxHoraires;
  const map = new Map();
  if (Array.isArray(tauxHoraires)) tauxHoraires.forEach(t => { if (t && t.id != null) map.set(String(t.id), t); });
  else if (tauxHoraires && typeof tauxHoraires === "object") Object.entries(tauxHoraires).forEach(([k, t]) => map.set(String(k), t));
  return map;
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
 *   • ouvrage.taux_horaire_vente_id cherché dans ctx.tauxHoraires (lignes taux_horaires_vente) ;
 *   • repli : ouvrage.taux_horaire_vente (objet joint) ou ctx.tauxHoraire (objet ou nombre, tests).
 * Un taux DÉSACTIVÉ reste utilisable (l'ouvrage garde son taux) : avertissement, pas erreur.
 * @returns {{ valide, id, libelle, valeur, actif, erreur, avertissement }}
 */
export function resoudreTauxHoraire(ouvrage, { tauxHoraires = null, tauxHoraire = null } = {}) {
  const id = ouvrage?.taux_horaire_vente_id != null ? String(ouvrage.taux_horaire_vente_id) : null;
  const index = indexerTauxHoraires(tauxHoraires);
  let ligne = id ? index.get(id) ?? null : null;
  if (!ligne && ouvrage?.taux_horaire_vente && typeof ouvrage.taux_horaire_vente === "object") ligne = ouvrage.taux_horaire_vente;
  if (!ligne && tauxHoraire != null) ligne = typeof tauxHoraire === "object" ? tauxHoraire : { id: id ?? null, libelle: "Taux horaire", taux_ht: tauxHoraire, actif: true };
  if (!ligne) {
    return {
      valide: false, id, libelle: null, valeur: null, actif: null, avertissement: null,
      erreur: id
        ? "Taux horaire de main-d'œuvre introuvable dans la liste des taux (Réglages → Taux horaires)"
        : "Taux horaire de main-d'œuvre non sélectionné",
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
 *                 coef_vente, taux_marge_pct, main_oeuvre_seule, cout_direct_unitaire,
 *                 taux_horaire_vente_id)
 * @param ctx      { materiaux, coutHoraire, tauxHoraires, tauxHoraire? }
 *                 tauxHoraires = lignes taux_horaires_vente (tableau ou Map) ;
 *                 coutHoraire  = coût horaire chargé (marge uniquement, non bloquant).
 */
export function calculerOuvrage(ouvrage, { materiaux = [], coutHoraire = null, tauxHoraires = null, tauxHoraire = null } = {}) {
  const erreurs = [];
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
  const taux = resoudreTauxHoraire(ouvrage, { tauxHoraires, tauxHoraire });
  if (!taux.valide) erreurs.push(taux.erreur);
  else if (taux.avertissement) avertissements.push(taux.avertissement);

  // Coefficient de vente : appliqué aux matériaux (+ coût direct, traitement
  // historique conservé). Repli : anciens ouvrages n'ayant qu'un taux de
  // marge (% du prix de vente) ⇒ coefficient équivalent. Inutile si l'ouvrage
  // n'a ni matériau ni coût direct.
  const coefRequis = mat.nbLiens > 0 || coutDirectU > 0;
  let coef = validerCoefficient(ouvrage?.coef_vente);
  let modePrix;
  if (coef.valide) {
    modePrix = "coefficient";
  } else if (ouvrage?.coef_vente != null && String(ouvrage.coef_vente).trim() !== "") {
    modePrix = "coefficient";
    erreurs.push(coef.erreur);
  } else {
    const marge = validerTauxMarge(ouvrage?.taux_marge_pct);
    if (marge.valide) {
      modePrix = "taux";
      coef = { valide: true, valeur: coefficientDepuisTauxMarge(marge.valeur), erreur: null };
    } else if (coefRequis) {
      modePrix = null;
      erreurs.push("Coefficient matériaux non renseigné (ex : 1,35 = coût matériaux × 1,35)");
    } else {
      modePrix = "sans_materiaux";
      coef = { valide: true, valeur: 1, erreur: null };   // rien à multiplier
    }
  }

  const prixMO = taux.valide ? prixMainOeuvreUnitaire(ouvrage?.cadence, taux.valeur) : null;
  const prixMat = mat.montant != null && coef.valide ? prixMateriauxUnitaire(mat.montant, coef.valeur) : null;
  const prixDirect = coef.valide ? arrondirMontant(coutDirectU * coef.valeur) : null;
  const coutTotal = coutTotalUnitaire({ coutMateriaux: mat.montant, coutMainOeuvre: mo.montant, coutDirect: coutDirectU });
  const prixVente = prixMO != null && prixMat != null && prixDirect != null ? arrondirMontant(prixMat + prixDirect + prixMO) : null;

  return {
    modePrix,
    coefVente: coef.valide ? coef.valeur : null,
    code: code?.code ?? null,
    libelle: str(ouvrage?.libelle),
    libelleCourt: code?.reste ?? str(ouvrage?.libelle),
    unite: normaliserUnite(ouvrage?.unite),
    mainOeuvreSeule,
    materiaux: mat,
    mainOeuvre: { ...mo, tauxVente: taux.valeur, tauxId: taux.id, tauxLibelle: taux.libelle, tauxActif: taux.actif },
    tauxHoraire: taux,
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
    coef_vente: c.coefVente,
    // Taux horaire de vente FIGÉ : identifiant (traçabilité) + valeur (le prix ne
    // bouge plus si le taux est modifié ensuite dans Réglages)
    taux_horaire_vente_id: c.tauxHoraire?.id ?? null,
    taux_horaire_vente: c.tauxHoraire?.valeur ?? null,
    prix_unitaire: c.prixVenteUnitaire,
    tva_pct: num(tvaPct),
    calcul_version: `${CALCUL_VERSION}@${iso}`,
    calcul_detail: {
      version: CALCUL_VERSION,
      formule: FORMULE_PRIX,
      date: iso,
      mode_prix: c.modePrix,
      coef_vente: c.coefVente,
      cout_horaire: c.mainOeuvre.coutHoraire,
      heures_unitaires: c.mainOeuvre.heures,
      taux_horaire_vente_id: c.tauxHoraire?.id ?? null,
      taux_horaire_vente_libelle: c.tauxHoraire?.libelle ?? null,
      taux_horaire_vente: c.tauxHoraire?.valeur ?? null,
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
  ["coef_vente", "Coefficient matériaux"],
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
