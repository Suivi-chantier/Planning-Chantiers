// ─── CONDITIONS DE VENTE D'UN CHIFFRAGE — RÈGLES PURES ───────────────────────
// Deux niveaux de paramétrage, indépendants l'un de l'autre (coefficient de
// vente / taux horaire de vente) :
//
//   • CHIFFRAGE (profero_projets) : mode_coefficient / mode_taux_horaire =
//     'ouvrage' | 'global'. En mode global, la valeur est FIGÉE sur le projet
//     (coefficient_global_valeur, taux_horaire_global_valeur).
//   • LIGNE (profero_ouvrages_selectionnes) : mode_coefficient_ligne /
//     mode_taux_horaire_ligne = 'heritage' | 'ouvrage' | 'specifique'.
//     En mode 'specifique', la valeur est FIGÉE sur la ligne
//     (coefficient_ligne_valeur, taux_horaire_ligne_valeur).
//
// ORDRE DE PRIORITÉ d'un paramètre pour une ligne (resoudreParametreVente,
// défini dans chiffragePricing.mjs — source unique partagée avec la RPC SQL) :
//   1. dérogation propre à la ligne   (mode 'specifique')
//   2. condition globale du chiffrage (mode 'heritage' + global actif)
//   3. paramètre d'origine de l'ouvrage (mode 'ouvrage', ou 'heritage' sans global)
//
// Chaque ligne conserve séparément :
//   origine    : coefficient_vente_id + coefficient_origine_valeur/libelle,
//                taux_horaire_vente_id + taux_horaire_origine_valeur/libelle ;
//   dérogation : mode_*_ligne + *_ligne_id / *_ligne_valeur / *_ligne_libelle ;
//   appliqué   : coef_vente / taux_horaire_vente (valeurs réellement utilisées),
//                coefficient_source / taux_horaire_source
//                ('ouvrage' | 'global_chiffrage' | 'ligne'),
//                coefficient_global_id / taux_horaire_global_id.
//
// Une modification ultérieure dans les Réglages ne change JAMAIS une valeur
// figée (globale ou de ligne) sans une application volontaire.
//
// Le recalcul d'une ligne existante n'utilise QUE ses données figées (coûts,
// cadence, quantité) — jamais la bibliothèque. Ce module est le miroir exact
// des RPC SQL conditions_chiffrage_evaluer et conditions_ligne_evaluer (même
// arrondi au centime) ; les RPC restent les seules à écrire.
// Testé par scripts/verif-conditions-chiffrage.mjs.

import {
  arrondirMontant, num, tauxMargeReel, validerValeurCoefficient, validerTauxHoraire,
  MODE_LIGNE_HERITAGE, MODE_LIGNE_OUVRAGE, MODE_LIGNE_SPECIFIQUE, MODES_LIGNE,
  SOURCE_OUVRAGE, SOURCE_GLOBAL, SOURCE_LIGNE,
  MODES_LIGNE_DEFAUT, normaliserModeLigne, resoudreParametreVente, lireModesLigne,
} from "./chiffragePricing.mjs";
import { formaterCoefficient } from "./coefficientsVente.mjs";
import { formaterTauxHT } from "./tauxHorairesVente.mjs";

const str = (v) => String(v ?? "").trim();

export const MODE_OUVRAGE = "ouvrage";
export const MODE_GLOBAL = "global";
export {
  MODE_LIGNE_HERITAGE, MODE_LIGNE_OUVRAGE, MODE_LIGNE_SPECIFIQUE, MODES_LIGNE,
  MODES_LIGNE_DEFAUT, SOURCE_OUVRAGE, SOURCE_GLOBAL, SOURCE_LIGNE,
  normaliserModeLigne, resoudreParametreVente, lireModesLigne,
};

/** Conditions d'un nouveau chiffrage : paramètres propres à chaque ouvrage. */
export const CONDITIONS_DEFAUT = Object.freeze({
  coefficient: Object.freeze({ mode: MODE_OUVRAGE, id: null, valeur: null, libelle: null }),
  tauxHoraire: Object.freeze({ mode: MODE_OUVRAGE, id: null, valeur: null, libelle: null }),
});

/** Lecture des conditions FIGÉES d'une ligne profero_projets (mode ouvrage si champs absents). */
export function lireConditionsProjet(projet) {
  const p = projet || {};
  const coefGlobal = p.mode_coefficient === MODE_GLOBAL && num(p.coefficient_global_valeur) > 0;
  const tauxGlobal = p.mode_taux_horaire === MODE_GLOBAL && num(p.taux_horaire_global_valeur) > 0;
  return {
    coefficient: coefGlobal
      ? { mode: MODE_GLOBAL, id: p.coefficient_global_id != null ? String(p.coefficient_global_id) : null, valeur: num(p.coefficient_global_valeur), libelle: str(p.coefficient_global_libelle) || null }
      : { ...CONDITIONS_DEFAUT.coefficient },
    tauxHoraire: tauxGlobal
      ? { mode: MODE_GLOBAL, id: p.taux_horaire_global_id != null ? String(p.taux_horaire_global_id) : null, valeur: num(p.taux_horaire_global_valeur), libelle: str(p.taux_horaire_global_libelle) || null }
      : { ...CONDITIONS_DEFAUT.tauxHoraire },
  };
}

/** Les conditions imposent-elles quelque chose ? */
export function conditionsActives(conditions) {
  const c = conditions || CONDITIONS_DEFAUT;
  return c.coefficient?.mode === MODE_GLOBAL || c.tauxHoraire?.mode === MODE_GLOBAL;
}

/** Condition globale exploitable ({ id, valeur, libelle }) ou null. */
function globaleDe(cond) {
  if (!cond || cond.mode !== MODE_GLOBAL) return null;
  const valeur = num(cond.valeur);
  if (valeur == null || valeur <= 0) return null;
  return { id: cond.id != null ? String(cond.id) : null, valeur, libelle: str(cond.libelle) || null };
}

/**
 * Un chiffrage peut-il changer de conditions (globales ou de ligne) ? Signé ⇒ non.
 * Un brouillon ProGBat existant n'interdit pas, mais est signalé (il ne sera
 * jamais actualisé automatiquement).
 */
export function chiffrageModifiable(projet) {
  const p = projet || {};
  if (p.statut === "signe") return { ok: false, motif: "Chiffrage signé : ses conditions de vente ne sont plus modifiables.", avertissements: [] };
  const avertissements = [];
  if (str(p.progbat_devis_id)) avertissements.push(`Un brouillon ProGBat existe déjà pour ce logement (id ${str(p.progbat_devis_id)}) : il ne sera pas actualisé automatiquement.`);
  if (p.statut === "devis_envoye") avertissements.push("Le devis a déjà été envoyé au client : les nouvelles conditions ne s'appliquent qu'au chiffrage Profero.");
  return { ok: true, motif: null, avertissements };
}

/**
 * Applique les conditions à un calcul d'ouvrage (bibliothèque) : rend les valeurs
 * à utiliser pour le prix + la description de l'origine et de la source.
 * @param origine  { coefficient: {id, valeur, libelle, valide}, tauxHoraire: {...} } (résolus sur l'ouvrage)
 * @param modes    modes de la ligne (héritage par défaut)
 */
export function resoudreConditionsLigne(origine, conditions, modes = null) {
  const c = conditions || CONDITIONS_DEFAUT;
  const m = modes || MODES_LIGNE_DEFAUT;
  const oc = origine?.coefficient || {}, ot = origine?.tauxHoraire || {};
  const brut = (o) => (o.valide ? { id: o.id ?? null, valeur: o.valeur, libelle: o.libelle ?? null } : null);
  const coef = resoudreParametreVente({ mode: m.coefficient?.mode, specifique: m.coefficient, globale: globaleDe(c.coefficient), origine: brut(oc) });
  const taux = resoudreParametreVente({ mode: m.tauxHoraire?.mode, specifique: m.tauxHoraire, globale: globaleDe(c.tauxHoraire), origine: brut(ot) });
  const vue = (r, o) => ({
    valeur: r.valeur, mode: r.mode, source: r.source,
    globalId: r.source === SOURCE_GLOBAL ? r.id : null,
    libelle: r.libelle ?? (o.libelle ?? null),
    specifique: r.specifique,
    origine: { id: o.id ?? null, valeur: o.valide ? o.valeur : null, libelle: o.libelle ?? null },
  });
  return { coefficient: vue(coef, oc), tauxHoraire: vue(taux, ot) };
}

// ─── Recalcul ciblé d'une ligne existante (miroir des RPC) ───────────────────
function versionCalcul(ligne) {
  const v = parseInt(String(ligne?.calcul_version || "0").split("@")[0], 10);
  return Number.isFinite(v) ? v : 0;
}

/** Une ligne porte-t-elle un prix saisi à la main (aucun calcul figé) ? */
export function ligneAPrixManuel(ligne) {
  return !str(ligne?.calcul_version);
}

/** Une ligne est-elle calculée avec l'ancienne formule (v1) ? */
export function ligneEstV1(ligne) {
  return !ligneAPrixManuel(ligne) && versionCalcul(ligne) < 2;
}

/** Valeurs d'origine figées sur une ligne (lignes v2 antérieures aux conditions : appliqué = origine). */
export function origineLigne(ligne) {
  const l = ligne || {}, d = l.calcul_detail || {};
  const coefSrc = l.coefficient_source ?? null, tauxSrc = l.taux_horaire_source ?? null;
  const heriteCoef = coefSrc == null || coefSrc === SOURCE_OUVRAGE;
  const heriteTaux = tauxSrc == null || tauxSrc === SOURCE_OUVRAGE;
  return {
    coefficient: {
      id: l.coefficient_vente_id ?? d.coefficient_origine?.id ?? null,
      valeur: num(l.coefficient_origine_valeur) ?? (heriteCoef ? num(l.coef_vente) : null) ?? num(d.coefficient_origine?.valeur),
      libelle: str(l.coefficient_origine_libelle) || (heriteCoef ? str(d.coefficient_vente_libelle) : "") || str(d.coefficient_origine?.libelle) || null,
    },
    tauxHoraire: {
      id: l.taux_horaire_vente_id ?? d.taux_origine?.id ?? null,
      valeur: num(l.taux_horaire_origine_valeur) ?? (heriteTaux ? num(l.taux_horaire_vente) : null) ?? num(d.taux_origine?.valeur),
      libelle: str(l.taux_horaire_origine_libelle) || (heriteTaux ? str(d.taux_horaire_vente_libelle) : "") || str(d.taux_origine?.libelle) || null,
    },
  };
}

/**
 * Valeurs RÉELLEMENT appliquées à une ligne existante, depuis ses seules
 * données figées. `modes` permet de simuler un autre choix sans rien écrire.
 * @returns {{ coefficient: resolution, tauxHoraire: resolution }}
 */
export function resoudreValeursLigne(ligne, conditions, modes = null) {
  const c = conditions || CONDITIONS_DEFAUT;
  const m = modes || lireModesLigne(ligne);
  const orig = origineLigne(ligne);
  const brut = (o) => (o.valeur != null && o.valeur > 0 ? { id: o.id ?? null, valeur: o.valeur, libelle: o.libelle ?? null } : null);
  return {
    coefficient: resoudreParametreVente({ mode: m.coefficient?.mode, specifique: m.coefficient, globale: globaleDe(c.coefficient), origine: brut(orig.coefficient) }),
    tauxHoraire: resoudreParametreVente({ mode: m.tauxHoraire?.mode, specifique: m.tauxHoraire, globale: globaleDe(c.tauxHoraire), origine: brut(orig.tauxHoraire) }),
  };
}

/** Patch normalisant les colonnes de mode / dérogation d'une ligne. */
function patchModes(m) {
  const bloc = (x, prefixeMode, prefixe) => {
    const mode = normaliserModeLigne(x?.mode);
    const spec = mode === MODE_LIGNE_SPECIFIQUE;
    return {
      [prefixeMode]: mode,
      [`${prefixe}_id`]: spec ? (x.id != null ? String(x.id) : null) : null,
      [`${prefixe}_valeur`]: spec ? num(x.valeur) : null,
      [`${prefixe}_libelle`]: spec ? (str(x.libelle) || null) : null,
    };
  };
  return {
    ...bloc(m.coefficient, "mode_coefficient_ligne", "coefficient_ligne"),
    ...bloc(m.tauxHoraire, "mode_taux_horaire_ligne", "taux_horaire_ligne"),
  };
}

/**
 * Recalcule UNE ligne depuis ses seules données figées, en appliquant l'ordre
 * de priorité (dérogation de ligne > condition globale > ouvrage).
 * Rend { ok: false, raison } si la ligne ne peut pas être recalculée (prix
 * saisi sans données figées, v1 non autorisée, origine absente…) — elle doit
 * alors rester intacte.
 * @param modes                 modes à simuler (défaut : ceux de la ligne)
 * @param autoriserV1           accepter de convertir une ligne v1 vers la formule actuelle
 * @param autoriserPrixManuel   accepter de remplacer un prix saisi par un prix calculé
 */
export function recalculerLigneConditions(ligne, conditions, { date = new Date(), modes = null, autoriserV1 = false, autoriserPrixManuel = false } = {}) {
  const l = ligne || {}, d = l.calcul_detail || {};
  const c = conditions || CONDITIONS_DEFAUT;
  const m = modes || lireModesLigne(l);
  const prixManuel = ligneAPrixManuel(l);
  const v1 = ligneEstV1(l);
  const base = { prixManuel, v1, conversionV1: false };
  if (prixManuel && !autoriserPrixManuel) return { ok: false, ...base, raison: "ancienne ligne à prix saisi (sans snapshot) : hors périmètre", horsPerimetre: true };
  if (v1 && !autoriserV1) return { ok: false, ...base, raison: "ancienne formule (v1) : coefficient sur le coût total et taux horaire d'origine inconnu" };
  const heures = num(d.heures_unitaires);
  const coutMat = num(l.cout_materiaux_unitaire);
  const coutDir = num(l.cout_direct_unitaire) ?? 0;
  const coutTot = num(l.cout_total_unitaire);
  if (heures == null || coutMat == null) {
    const manque = [heures == null ? "la cadence figée (heures par unité)" : null, coutMat == null ? "le coût matériaux figé" : null].filter(Boolean).join(" et ");
    return { ok: false, ...base, raison: prixManuel ? `prix saisi sans calcul figé : ${manque} manque${manque.includes(" et ") ? "nt" : ""} sur cette ligne` : "ligne incomplète (cadence ou coût matériaux figé absent)", manque };
  }
  const res = resoudreValeursLigne(l, c, m);
  if (!res.coefficient.valide) {
    return { ok: false, ...base, raison: res.coefficient.mode === MODE_LIGNE_SPECIFIQUE ? "coefficient spécifique absent de la ligne" : "coefficient d'origine de l'ouvrage absent de la ligne" };
  }
  if (!res.tauxHoraire.valide) {
    return { ok: false, ...base, raison: res.tauxHoraire.mode === MODE_LIGNE_SPECIFIQUE ? "taux horaire spécifique absent de la ligne" : "taux horaire d'origine de l'ouvrage absent de la ligne" };
  }
  const orig = origineLigne(l);
  const coefAppl = res.coefficient.valeur, tauxAppl = res.tauxHoraire.valeur;
  const prixMat = arrondirMontant(coutMat * coefAppl);
  const prixDir = arrondirMontant(coutDir * coefAppl);
  const prixMO = arrondirMontant(heures * tauxAppl);
  const prix = arrondirMontant(prixMat + prixDir + prixMO);
  const iso = date instanceof Date ? date.toISOString() : String(date);
  const prixAvant = num(l.prix_unitaire);
  const change = prixAvant !== prix
    || num(l.coef_vente) !== coefAppl || num(l.taux_horaire_vente) !== tauxAppl
    || (l.coefficient_source ?? SOURCE_OUVRAGE) !== res.coefficient.source
    || (l.taux_horaire_source ?? SOURCE_OUVRAGE) !== res.tauxHoraire.source
    || normaliserModeLigne(l.mode_coefficient_ligne) !== res.coefficient.mode
    || normaliserModeLigne(l.mode_taux_horaire_ligne) !== res.tauxHoraire.mode;
  return {
    ok: true,
    ...base,
    conversionV1: v1,
    change,
    prixAvant,
    margeAvant: tauxMargeReel(prixAvant, coutTot),
    resolution: res,
    patch: {
      coef_vente: coefAppl,
      taux_horaire_vente: tauxAppl,
      coefficient_source: res.coefficient.source,
      taux_horaire_source: res.tauxHoraire.source,
      coefficient_global_id: res.coefficient.source === SOURCE_GLOBAL ? res.coefficient.id : null,
      taux_horaire_global_id: res.tauxHoraire.source === SOURCE_GLOBAL ? res.tauxHoraire.id : null,
      coefficient_origine_valeur: orig.coefficient.valeur,
      coefficient_origine_libelle: orig.coefficient.libelle,
      taux_horaire_origine_valeur: orig.tauxHoraire.valeur,
      taux_horaire_origine_libelle: orig.tauxHoraire.libelle,
      ...patchModes({ coefficient: res.coefficient.mode === MODE_LIGNE_SPECIFIQUE ? { mode: MODE_LIGNE_SPECIFIQUE, ...res.coefficient.specifique } : { mode: res.coefficient.mode },
                      tauxHoraire: res.tauxHoraire.mode === MODE_LIGNE_SPECIFIQUE ? { mode: MODE_LIGNE_SPECIFIQUE, ...res.tauxHoraire.specifique } : { mode: res.tauxHoraire.mode } }),
      prix_unitaire: prix,
      taux_marge_pct: tauxMargeReel(prix, coutTot),
      calcul_version: `2@${iso}`,
      calcul_detail: {
        ...d,
        version: 2,
        date: iso,
        coef_vente: coefAppl,
        taux_horaire_vente: tauxAppl,
        prix_materiaux_unitaire: prixMat,
        prix_direct_unitaire: prixDir,
        prix_main_oeuvre_unitaire: prixMO,
        coefficient_origine: { id: orig.coefficient.id, valeur: orig.coefficient.valeur, libelle: orig.coefficient.libelle },
        coefficient_applique: {
          valeur: coefAppl, source: res.coefficient.source, mode: res.coefficient.mode,
          global_id: res.coefficient.source === SOURCE_GLOBAL ? res.coefficient.id : null,
          libelle: res.coefficient.libelle, specifique: res.coefficient.mode === MODE_LIGNE_SPECIFIQUE ? res.coefficient.specifique : null,
        },
        taux_origine: { id: orig.tauxHoraire.id, valeur: orig.tauxHoraire.valeur, libelle: orig.tauxHoraire.libelle },
        taux_applique: {
          valeur: tauxAppl, source: res.tauxHoraire.source, mode: res.tauxHoraire.mode,
          global_id: res.tauxHoraire.source === SOURCE_GLOBAL ? res.tauxHoraire.id : null,
          libelle: res.tauxHoraire.libelle, specifique: res.tauxHoraire.mode === MODE_LIGNE_SPECIFIQUE ? res.tauxHoraire.specifique : null,
        },
        recalcul_conditions_le: iso,
        ...(v1 ? { converti_v1_le: iso } : {}),
        ...(prixManuel ? { prix_manuel_remplace: prixAvant, prix_manuel_remplace_le: iso } : {}),
      },
    },
  };
}

/**
 * Simulation d'un changement de conditions GLOBALES (aucune écriture) : lignes
 * réellement modifiées, lignes ignorées (avec raison), lignes hors périmètre,
 * dérogations conservées, totaux et marges avant / après.
 * Les lignes en mode 'specifique' ou 'ouvrage' ne suivent pas le changement
 * global du paramètre concerné : elles ne sont pas comptées comme modifiées.
 */
export function simulerConditions(lignes = [], conditions, { date = new Date() } = {}) {
  let totalAvant = 0, totalApres = 0, margeAvant = 0, margeApres = 0, margeConnue = true;
  const recalculees = [], ignorees = [];
  let sansSnapshot = 0, inchangees = 0;
  let coefSpecifiques = 0, tauxSpecifiques = 0, lignesOuvrage = 0;
  (lignes || []).forEach(l => {
    const q = num(l?.quantite) ?? 0;
    const pu = num(l?.prix_unitaire), ct = num(l?.cout_total_unitaire);
    if (pu != null) { totalAvant += q * pu; if (ct != null) margeAvant += q * (pu - ct); else margeConnue = false; }
    const modes = lireModesLigne(l);
    if (modes.coefficient.mode === MODE_LIGNE_SPECIFIQUE) coefSpecifiques++;
    if (modes.tauxHoraire.mode === MODE_LIGNE_SPECIFIQUE) tauxSpecifiques++;
    if (modes.coefficient.mode === MODE_LIGNE_OUVRAGE || modes.tauxHoraire.mode === MODE_LIGNE_OUVRAGE) lignesOuvrage++;
    const r = recalculerLigneConditions(l, conditions, { date });
    if (!r.ok || !r.change) {
      if (!r.ok) { if (r.horsPerimetre) sansSnapshot++; else ignorees.push({ id: l.id, item: l.item, raison: r.raison }); }
      else inchangees++;
      if (pu != null) { totalApres += q * pu; if (ct != null) margeApres += q * (pu - ct); }
      return;
    }
    recalculees.push({ id: l.id, item: l.item, zone: l.zone, quantite: q, prixAvant: pu, prixApres: r.patch.prix_unitaire, patch: r.patch });
    totalApres += q * r.patch.prix_unitaire;
    if (ct != null) margeApres += q * (r.patch.prix_unitaire - ct); else margeConnue = false;
  });
  const tA = arrondirMontant(totalAvant), tB = arrondirMontant(totalApres);
  const mA = arrondirMontant(margeAvant), mB = arrondirMontant(margeApres);
  return {
    nbLignesRecalculees: recalculees.length,
    nbLignesIgnorees: ignorees.length,
    nbLignesSansSnapshot: sansSnapshot,
    nbLignesInchangees: inchangees,
    nbCoefficientsSpecifiques: coefSpecifiques,
    nbTauxSpecifiques: tauxSpecifiques,
    nbLignesModeOuvrage: lignesOuvrage,
    recalculees, ignorees,
    totalHTAvant: tA, totalHTApres: tB, ecartHT: arrondirMontant(tB - tA),
    margeConnue,
    margeAvant: margeConnue ? mA : null, margeApres: margeConnue ? mB : null,
    margeAvantPct: margeConnue && tA > 0 ? arrondirMontant(mA / tA * 100) : null,
    margeApresPct: margeConnue && tB > 0 ? arrondirMontant(mB / tB * 100) : null,
  };
}

/** Message lisible d'une erreur de RPC (les exceptions plpgsql arrivent en `message`). */
export function messageErreurRpc(error) {
  const m = String(error?.message || error || "").trim();
  if (!m) return "Erreur inconnue.";
  if (/permission denied|row-level security|violates row-level/i.test(m)) return "Droits insuffisants : vous ne pouvez pas modifier ce chiffrage.";
  return m.replace(/^.*?(?=Chiffrage|Cette|Ligne|Le |La |Les |Coefficient|Taux|Mode|Modification|Aucun|Utilisateur)/, "");
}

// ─── Affichage ───────────────────────────────────────────────────────────────
/** Libellé d'une condition globale : « Par ouvrage » ou « Coefficient global 1,30 ». */
export function libelleCondition(cond, type) {
  if (!cond || cond.mode !== MODE_GLOBAL) return type === "coefficient" ? "Coefficient de chaque ouvrage" : "Taux horaire de chaque ouvrage";
  const val = type === "coefficient" ? formaterCoefficient(cond.valeur) : formaterTauxHT(cond.valeur);
  // Valeur saisie : aucun libellé de référentiel à afficher, la valeur suffit.
  return cond.libelle ? `${cond.libelle} — ${val}` : `${type === "coefficient" ? "Coefficient global" : "Taux horaire global"} ${val}`;
}

/** Phrase d'origine d'une valeur appliquée (provenance lisible). */
export function libelleSource(source) {
  if (source === SOURCE_LIGNE) return "dérogation propre à cette ligne";
  if (source === SOURCE_GLOBAL) return "condition globale du chiffrage";
  return "paramètre de l'ouvrage";
}

const fmtValeur = (type, v) => (type === "coefficient" ? formaterCoefficient(v) : formaterTauxHT(v));

/**
 * Textes à afficher sur une ligne pour expliquer les paramètres réellement
 * utilisés, sans jamais laisser croire que la bibliothèque a changé.
 */
export function decrireConditionsLigne(ligne) {
  const l = ligne || {}, d = l.calcul_detail || {};
  const modes = lireModesLigne(l);
  const coefAppl = num(l.coef_vente) ?? num(d.coefficient_applique?.valeur);
  const tauxAppl = num(l.taux_horaire_vente) ?? num(d.taux_applique?.valeur);
  const coefSrc = l.coefficient_source ?? d.coefficient_applique?.source ?? (coefAppl != null ? SOURCE_OUVRAGE : null);
  const tauxSrc = l.taux_horaire_source ?? d.taux_applique?.source ?? (tauxAppl != null ? SOURCE_OUVRAGE : null);
  const orig = origineLigne(l);
  const lignesTexte = [];
  const decrire = (type, valeur, source, origine) => {
    if (valeur == null) return;
    const nom = type === "coefficient" ? "Coefficient" : "Taux horaire";
    lignesTexte.push(`${nom} appliqué : ${fmtValeur(type, valeur)}`);
    lignesTexte.push(`Origine : ${libelleSource(source)}`);
    if (source !== SOURCE_OUVRAGE && origine != null) lignesTexte.push(`${nom} de l'ouvrage : ${fmtValeur(type, origine)}`);
  };
  decrire("coefficient", coefAppl, coefSrc, orig.coefficient.valeur);
  decrire("taux", tauxAppl, tauxSrc, orig.tauxHoraire.valeur);
  const global = coefSrc === SOURCE_GLOBAL || tauxSrc === SOURCE_GLOBAL;
  const derogation = coefSrc === SOURCE_LIGNE || tauxSrc === SOURCE_LIGNE
    || modes.coefficient.mode !== MODE_LIGNE_HERITAGE || modes.tauxHoraire.mode !== MODE_LIGNE_HERITAGE;
  return {
    coefficient: { valeur: coefAppl, source: coefSrc, mode: modes.coefficient.mode, origine: orig.coefficient.valeur, libelle: l.coefficient_origine_libelle ?? null },
    tauxHoraire: { valeur: tauxAppl, source: tauxSrc, mode: modes.tauxHoraire.mode, origine: orig.tauxHoraire.valeur },
    global,
    derogation,
    badge: derogation ? "Conditions spécifiques" : null,
    court: [coefAppl != null ? `× ${formaterCoefficient(coefAppl)}` : null, tauxAppl != null ? `${formaterTauxHT(tauxAppl).replace(" HT/h", "/h")}` : null].filter(Boolean).join(" · ")
      + (derogation ? " · ligne" : global ? " · global" : ""),
    lignes: lignesTexte,
  };
}

// ─── Champ « conditions » d'une ligne (coefficient / taux horaire) ──────────
// Il n'y a plus de liste : un paramètre de ligne se règle par un MODE
// (hériter du chiffrage / forcer l'ouvrage / valeur saisie) et, en mode
// « specifique », par une valeur TAPÉE À LA MAIN, figée sur la ligne.
// Les référentiels (Réglages) ne servent plus qu'à proposer une valeur de
// départ dans le champ libre — ils n'imposent plus rien.
export const VALEUR_HERITAGE = MODE_LIGNE_HERITAGE;
export const VALEUR_OUVRAGE = MODE_LIGNE_OUVRAGE;

/** Valeur par défaut d'un référentiel (le défaut actif, sinon le premier actif). */
export function valeurParDefautReferentiel(referentiel, champValeur) {
  const liste = Array.isArray(referentiel) ? referentiel : [];
  const actifs = liste.filter(r => r && r.actif !== false);
  const choisi = actifs.find(r => r.est_defaut) || actifs[0] || null;
  const v = num(choisi?.[champValeur]);
  return v != null && v > 0 ? v : null;
}

/**
 * Tout ce qu'il faut pour afficher et régler UN paramètre de vente d'une ligne
 * avec un champ libre : mode courant, valeur saisie, valeur réellement
 * appliquée et sa provenance, et la valeur à pré-remplir dans le champ.
 *
 * @param type        "coefficient" | "taux"
 * @param ligne       ligne profero_ouvrages_selectionnes (données figées)
 * @param conditions  conditions globales du chiffrage
 * @param modes       modes à refléter (défaut : ceux de la ligne)
 * @param referentiel lignes coefficients_vente / taux_horaires_vente — UNIQUEMENT
 *                    pour proposer une valeur de départ (jamais imposée)
 */
export function champConditionLigne({ type, ligne = null, conditions = null, modes = null, referentiel = [] } = {}) {
  const estCoef = type === "coefficient";
  const nom = estCoef ? "coefficient" : "taux horaire";
  const c = conditions || CONDITIONS_DEFAUT;
  const m = modes || lireModesLigne(ligne);
  const cond = estCoef ? m.coefficient : m.tauxHoraire;
  const globale = globaleDe(estCoef ? c.coefficient : c.tauxHoraire);
  const orig = origineLigne(ligne)[estCoef ? "coefficient" : "tauxHoraire"];
  const saisie = (estCoef ? validerValeurCoefficient : validerTauxHoraire)(cond.valeur);

  const resolution = resoudreParametreVente({
    mode: cond.mode,
    specifique: { id: null, valeur: saisie.valide ? saisie.valeur : null, libelle: null },
    globale,
    origine: orig.valeur != null && orig.valeur > 0 ? { id: orig.id, valeur: orig.valeur, libelle: orig.libelle } : null,
  });

  // Champ pré-rempli : la valeur déjà figée sur la ligne, sinon celle qui
  // s'applique aujourd'hui (global puis ouvrage), sinon le défaut des Réglages.
  const suggestion = [
    saisie.valide ? saisie.valeur : null,
    resolution.valide ? resolution.valeur : null,
    globale ? globale.valeur : null,
    orig.valeur,
    valeurParDefautReferentiel(referentiel, estCoef ? "valeur" : "taux_ht"),
  ].find(v => num(v) != null && num(v) > 0) ?? null;

  return {
    mode: cond.mode,
    valeur: saisie.valide ? saisie.valeur : null,
    erreurValeur: cond.mode === MODE_LIGNE_SPECIFIQUE && !saisie.valide ? saisie.erreur : null,
    globale, origine: orig,
    ouvrageDisponible: orig.valeur != null && orig.valeur > 0,
    suggestion: num(suggestion),
    applique: resolution,
    texteHeritage: globale
      ? `Hériter du chiffrage — ${fmtValeur(type, globale.valeur)}`
      : orig.valeur != null
        ? `Hériter du chiffrage — ${nom} de l'ouvrage ${fmtValeur(type, orig.valeur)}`
        : `Hériter du chiffrage — aucun ${nom} disponible`,
    texteOuvrage: orig.valeur != null
      ? `${nom.charAt(0).toUpperCase()}${nom.slice(1)} de l'ouvrage — ${fmtValeur(type, orig.valeur)}`
      : `${nom.charAt(0).toUpperCase()}${nom.slice(1)} de l'ouvrage — non figé sur cette ligne`,
    texteApplique: resolution.valide
      ? `${estCoef ? "Coefficient" : "Taux horaire"} appliqué : ${fmtValeur(type, resolution.valeur)}`
      : `${estCoef ? "Coefficient" : "Taux horaire"} non déterminable`,
    texteOrigine: `Origine : ${libelleSource(resolution.source)}`,
  };
}

/** Résumé d'un résultat de RPC (simulation des conditions GLOBALES) pour la confirmation. */
export function resumerSimulation(res) {
  if (!res) return null;
  return {
    nbRecalculees: num(res.nb_lignes_recalculees) ?? 0,
    nbIgnorees: num(res.nb_lignes_ignorees) ?? 0,
    nbSansSnapshot: num(res.nb_lignes_sans_snapshot) ?? 0,
    nbInchangees: num(res.nb_lignes_inchangees) ?? 0,
    nbCoefSpecifiques: num(res.nb_coefficients_specifiques) ?? 0,
    nbTauxSpecifiques: num(res.nb_taux_specifiques) ?? 0,
    nbModeOuvrage: num(res.nb_lignes_mode_ouvrage) ?? 0,
    totalAvant: num(res.total_ht_avant), totalApres: num(res.total_ht_apres), ecart: num(res.ecart_ht),
    margeAvant: num(res.marge_avant), margeApres: num(res.marge_apres), margeAvantPct: num(res.marge_avant_pct), margeApresPct: num(res.marge_apres_pct),
    avertissements: Array.isArray(res.avertissements) ? res.avertissements : [],
    ignorees: Array.isArray(res.lignes_ignorees) ? res.lignes_ignorees : [],
    version: num(res.version_attendue) ?? num(res.version), hash: res.hash_lignes,
    avant: res.avant || {}, apres: res.apres || {},
  };
}

/** Résumé d'un résultat de RPC de LIGNE (simuler_conditions_ligne). */
export function resumerSimulationLigne(res) {
  if (!res) return null;
  const av = res.avant || {}, ap = res.apres || {};
  return {
    ligneId: res.ligne_id ?? null,
    item: res.item ?? null,
    zone: res.zone ?? null,
    quantite: num(res.quantite),
    possible: res.possible === true,
    blocage: res.blocage ?? null,
    prixManuel: res.prix_manuel === true,
    conversionV1: res.conversion_v1 === true,
    confirmationRequise: Array.isArray(res.confirmations_requises) ? res.confirmations_requises : [],
    change: res.change === true,
    avant: {
      mode_coefficient: av.mode_coefficient ?? MODE_LIGNE_HERITAGE, coefficient: num(av.coefficient), coefficient_libelle: av.coefficient_libelle ?? null, coefficient_source: av.coefficient_source ?? null,
      mode_taux: av.mode_taux ?? MODE_LIGNE_HERITAGE, taux: num(av.taux), taux_libelle: av.taux_libelle ?? null, taux_source: av.taux_source ?? null,
      prix: num(av.prix_unitaire), marge_pct: num(av.taux_marge_pct), marge: num(av.marge_unitaire), total: num(av.total_ht),
    },
    apres: {
      mode_coefficient: ap.mode_coefficient ?? MODE_LIGNE_HERITAGE, coefficient: num(ap.coefficient), coefficient_libelle: ap.coefficient_libelle ?? null, coefficient_source: ap.coefficient_source ?? null,
      mode_taux: ap.mode_taux ?? MODE_LIGNE_HERITAGE, taux: num(ap.taux), taux_libelle: ap.taux_libelle ?? null, taux_source: ap.taux_source ?? null,
      prix: num(ap.prix_unitaire), marge_pct: num(ap.taux_marge_pct), marge: num(ap.marge_unitaire), total: num(ap.total_ht),
      prix_materiaux: num(ap.prix_materiaux_unitaire), prix_direct: num(ap.prix_direct_unitaire), prix_main_oeuvre: num(ap.prix_main_oeuvre_unitaire),
    },
    totalProjetAvant: num(res.total_projet_avant), totalProjetApres: num(res.total_projet_apres),
    avertissements: Array.isArray(res.avertissements) ? res.avertissements : [],
    version: num(res.version_attendue) ?? num(res.version), hash: res.hash_ligne,
  };
}
