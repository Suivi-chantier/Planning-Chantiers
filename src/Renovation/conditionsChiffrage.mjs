// ─── CONDITIONS DE VENTE D'UN CHIFFRAGE — RÈGLES PURES ───────────────────────
// Un chiffrage (profero_projets) peut imposer, indépendamment l'un de l'autre :
//   • un coefficient de vente GLOBAL (mode_coefficient = 'global') ;
//   • un taux horaire de vente GLOBAL (mode_taux_horaire = 'global').
// Les valeurs sont FIGÉES sur le projet (coefficient_global_valeur, taux_horaire_
// global_valeur) : une modification ultérieure dans les Réglages ne change rien
// tant que l'utilisateur n'actualise pas volontairement.
//
// Chaque ligne conserve séparément :
//   origine  : coefficient_vente_id + coefficient_origine_valeur/libelle,
//              taux_horaire_vente_id + taux_horaire_origine_valeur/libelle ;
//   appliqué : coef_vente / taux_horaire_vente (valeurs réellement utilisées),
//              coefficient_source / taux_horaire_source ('ouvrage' | 'global_chiffrage'),
//              coefficient_global_id / taux_horaire_global_id.
//
// Le recalcul d'une ligne existante n'utilise QUE ses données figées (coûts,
// cadence, quantité) — jamais la bibliothèque. Ce module est le miroir exact de
// la RPC SQL conditions_chiffrage_evaluer (même arrondi au centime) ; la RPC
// reste la seule à écrire. Testé par scripts/verif-conditions-chiffrage.mjs.

import { arrondirMontant, num, tauxMargeReel, margeEuros } from "./chiffragePricing.mjs";
import { formaterCoefficient } from "./coefficientsVente.mjs";
import { formaterTauxHT } from "./tauxHorairesVente.mjs";

const str = (v) => String(v ?? "").trim();

export const MODE_OUVRAGE = "ouvrage";
export const MODE_GLOBAL = "global";
export const SOURCE_OUVRAGE = "ouvrage";
export const SOURCE_GLOBAL = "global_chiffrage";

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

/**
 * Un chiffrage peut-il changer de conditions ? Signé ⇒ non. Un brouillon ProGBat
 * existant n'interdit pas, mais est signalé (il ne sera jamais actualisé).
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
 */
export function resoudreConditionsLigne(origine, conditions) {
  const c = conditions || CONDITIONS_DEFAUT;
  const coefGlobal = c.coefficient?.mode === MODE_GLOBAL && num(c.coefficient.valeur) > 0;
  const tauxGlobal = c.tauxHoraire?.mode === MODE_GLOBAL && num(c.tauxHoraire.valeur) > 0;
  const oc = origine?.coefficient || {}, ot = origine?.tauxHoraire || {};
  return {
    coefficient: {
      valeur: coefGlobal ? num(c.coefficient.valeur) : (oc.valide ? oc.valeur : null),
      source: coefGlobal ? SOURCE_GLOBAL : SOURCE_OUVRAGE,
      globalId: coefGlobal ? c.coefficient.id : null,
      libelle: coefGlobal ? c.coefficient.libelle : (oc.libelle ?? null),
      origine: { id: oc.id ?? null, valeur: oc.valide ? oc.valeur : null, libelle: oc.libelle ?? null },
    },
    tauxHoraire: {
      valeur: tauxGlobal ? num(c.tauxHoraire.valeur) : (ot.valide ? ot.valeur : null),
      source: tauxGlobal ? SOURCE_GLOBAL : SOURCE_OUVRAGE,
      globalId: tauxGlobal ? c.tauxHoraire.id : null,
      libelle: tauxGlobal ? c.tauxHoraire.libelle : (ot.libelle ?? null),
      origine: { id: ot.id ?? null, valeur: ot.valide ? ot.valeur : null, libelle: ot.libelle ?? null },
    },
  };
}

// ─── Recalcul ciblé d'une ligne existante (miroir de la RPC) ─────────────────
function versionCalcul(ligne) {
  const v = parseInt(String(ligne?.calcul_version || "0").split("@")[0], 10);
  return Number.isFinite(v) ? v : 0;
}

/** Valeurs d'origine figées sur une ligne (lignes v2 antérieures aux conditions : appliqué = origine). */
export function origineLigne(ligne) {
  const l = ligne || {}, d = l.calcul_detail || {};
  const coefSrc = l.coefficient_source ?? null, tauxSrc = l.taux_horaire_source ?? null;
  return {
    coefficient: {
      id: l.coefficient_vente_id ?? d.coefficient_origine?.id ?? null,
      valeur: num(l.coefficient_origine_valeur) ?? (coefSrc == null || coefSrc === SOURCE_OUVRAGE ? num(l.coef_vente) : null) ?? num(d.coefficient_origine?.valeur),
      libelle: str(l.coefficient_origine_libelle) || (coefSrc == null || coefSrc === SOURCE_OUVRAGE ? str(d.coefficient_vente_libelle) : "") || str(d.coefficient_origine?.libelle) || null,
    },
    tauxHoraire: {
      id: l.taux_horaire_vente_id ?? d.taux_origine?.id ?? null,
      valeur: num(l.taux_horaire_origine_valeur) ?? (tauxSrc == null || tauxSrc === SOURCE_OUVRAGE ? num(l.taux_horaire_vente) : null) ?? num(d.taux_origine?.valeur),
      libelle: str(l.taux_horaire_origine_libelle) || (tauxSrc == null || tauxSrc === SOURCE_OUVRAGE ? str(d.taux_horaire_vente_libelle) : "") || str(d.taux_origine?.libelle) || null,
    },
  };
}

/**
 * Recalcule UNE ligne depuis ses seules données figées. Rend { ok, raison } si
 * la ligne ne peut pas être recalculée (v1, incomplète, origine absente) — elle
 * doit alors rester intacte. Sinon rend le patch à écrire.
 */
export function recalculerLigneConditions(ligne, conditions, { date = new Date() } = {}) {
  const l = ligne || {}, d = l.calcul_detail || {};
  const c = conditions || CONDITIONS_DEFAUT;
  if (!str(l.calcul_version)) return { ok: false, raison: "ancienne ligne à prix saisi (sans snapshot) : hors périmètre", horsPerimetre: true };
  if (versionCalcul(l) < 2) return { ok: false, raison: "ancienne formule (v1) : coefficient sur le coût total et taux horaire d'origine inconnu" };
  const heures = num(d.heures_unitaires);
  const coutMat = num(l.cout_materiaux_unitaire);
  const coutDir = num(l.cout_direct_unitaire) ?? 0;
  const coutTot = num(l.cout_total_unitaire);
  if (heures == null || coutMat == null) return { ok: false, raison: "ligne incomplète (cadence ou coût matériaux figé absent)" };
  const orig = origineLigne(l);
  const coefGlobal = c.coefficient?.mode === MODE_GLOBAL && num(c.coefficient.valeur) > 0;
  const tauxGlobal = c.tauxHoraire?.mode === MODE_GLOBAL && num(c.tauxHoraire.valeur) > 0;
  if (!coefGlobal && orig.coefficient.valeur == null) return { ok: false, raison: "coefficient d'origine de l'ouvrage absent de la ligne" };
  if (!tauxGlobal && orig.tauxHoraire.valeur == null) return { ok: false, raison: "taux horaire d'origine de l'ouvrage absent de la ligne" };
  const coefAppl = coefGlobal ? num(c.coefficient.valeur) : orig.coefficient.valeur;
  const tauxAppl = tauxGlobal ? num(c.tauxHoraire.valeur) : orig.tauxHoraire.valeur;
  const prixMat = arrondirMontant(coutMat * coefAppl);
  const prixDir = arrondirMontant(coutDir * coefAppl);
  const prixMO = arrondirMontant(heures * tauxAppl);
  const prix = arrondirMontant(prixMat + prixDir + prixMO);
  const iso = date instanceof Date ? date.toISOString() : String(date);
  const coefLib = coefGlobal ? c.coefficient.libelle : orig.coefficient.libelle;
  const tauxLib = tauxGlobal ? c.tauxHoraire.libelle : orig.tauxHoraire.libelle;
  return {
    ok: true,
    prixAvant: num(l.prix_unitaire),
    patch: {
      coef_vente: coefAppl,
      taux_horaire_vente: tauxAppl,
      coefficient_source: coefGlobal ? SOURCE_GLOBAL : SOURCE_OUVRAGE,
      taux_horaire_source: tauxGlobal ? SOURCE_GLOBAL : SOURCE_OUVRAGE,
      coefficient_global_id: coefGlobal ? c.coefficient.id : null,
      taux_horaire_global_id: tauxGlobal ? c.tauxHoraire.id : null,
      coefficient_origine_valeur: orig.coefficient.valeur,
      coefficient_origine_libelle: orig.coefficient.libelle,
      taux_horaire_origine_valeur: orig.tauxHoraire.valeur,
      taux_horaire_origine_libelle: orig.tauxHoraire.libelle,
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
        coefficient_applique: { valeur: coefAppl, source: coefGlobal ? SOURCE_GLOBAL : SOURCE_OUVRAGE, global_id: coefGlobal ? c.coefficient.id : null, libelle: coefLib },
        taux_origine: { id: orig.tauxHoraire.id, valeur: orig.tauxHoraire.valeur, libelle: orig.tauxHoraire.libelle },
        taux_applique: { valeur: tauxAppl, source: tauxGlobal ? SOURCE_GLOBAL : SOURCE_OUVRAGE, global_id: tauxGlobal ? c.tauxHoraire.id : null, libelle: tauxLib },
        recalcul_conditions_le: iso,
      },
    },
  };
}

/**
 * Simulation complète (aucune écriture) : lignes recalculées, ignorées (avec
 * raison), hors périmètre, totaux et marges avant / après.
 */
export function simulerConditions(lignes = [], conditions, { date = new Date() } = {}) {
  let totalAvant = 0, totalApres = 0, margeAvant = 0, margeApres = 0, margeConnue = true;
  const recalculees = [], ignorees = [];
  let sansSnapshot = 0;
  (lignes || []).forEach(l => {
    const q = num(l?.quantite) ?? 0;
    const pu = num(l?.prix_unitaire), ct = num(l?.cout_total_unitaire);
    if (pu != null) { totalAvant += q * pu; if (ct != null) margeAvant += q * (pu - ct); else margeConnue = false; }
    const r = recalculerLigneConditions(l, conditions, { date });
    if (!r.ok) {
      if (r.horsPerimetre) sansSnapshot++; else ignorees.push({ id: l.id, item: l.item, raison: r.raison });
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
    recalculees, ignorees,
    totalHTAvant: tA, totalHTApres: tB, ecartHT: arrondirMontant(tB - tA),
    margeConnue,
    margeAvant: margeConnue ? mA : null, margeApres: margeConnue ? mB : null,
    margeAvantPct: margeConnue && tA > 0 ? arrondirMontant(mA / tA * 100) : null,
    margeApresPct: margeConnue && tB > 0 ? arrondirMontant(mB / tB * 100) : null,
  };
}

// ─── Affichage ───────────────────────────────────────────────────────────────
/** Libellé d'une condition : « Par ouvrage » ou « Coefficient client — 1,30 ». */
export function libelleCondition(cond, type) {
  if (!cond || cond.mode !== MODE_GLOBAL) return type === "coefficient" ? "Coefficient de chaque ouvrage" : "Taux horaire de chaque ouvrage";
  const val = type === "coefficient" ? formaterCoefficient(cond.valeur) : formaterTauxHT(cond.valeur);
  return `${cond.libelle || (type === "coefficient" ? "Coefficient" : "Taux")} — ${val}`;
}

/**
 * Textes à afficher sur une ligne pour expliquer les paramètres réellement
 * utilisés, sans jamais laisser croire que la bibliothèque a changé.
 */
export function decrireConditionsLigne(ligne) {
  const l = ligne || {}, d = l.calcul_detail || {};
  const coefAppl = num(l.coef_vente) ?? num(d.coefficient_applique?.valeur);
  const tauxAppl = num(l.taux_horaire_vente) ?? num(d.taux_applique?.valeur);
  const coefSrc = l.coefficient_source ?? d.coefficient_applique?.source ?? (coefAppl != null ? SOURCE_OUVRAGE : null);
  const tauxSrc = l.taux_horaire_source ?? d.taux_applique?.source ?? (tauxAppl != null ? SOURCE_OUVRAGE : null);
  const orig = origineLigne(l);
  const lignesTexte = [];
  if (coefAppl != null) {
    if (coefSrc === SOURCE_GLOBAL) {
      lignesTexte.push(`Coefficient appliqué : ${formaterCoefficient(coefAppl)} — condition globale du chiffrage`);
      if (orig.coefficient.valeur != null) lignesTexte.push(`Coefficient d'origine : ${formaterCoefficient(orig.coefficient.valeur)}`);
    } else lignesTexte.push(`Coefficient ouvrage : ${formaterCoefficient(coefAppl)}`);
  }
  if (tauxAppl != null) {
    if (tauxSrc === SOURCE_GLOBAL) {
      lignesTexte.push(`Taux horaire appliqué : ${formaterTauxHT(tauxAppl)} — condition globale du chiffrage`);
      if (orig.tauxHoraire.valeur != null) lignesTexte.push(`Taux d'origine : ${formaterTauxHT(orig.tauxHoraire.valeur)}`);
    } else lignesTexte.push(`Taux horaire ouvrage : ${formaterTauxHT(tauxAppl)}`);
  }
  const global = coefSrc === SOURCE_GLOBAL || tauxSrc === SOURCE_GLOBAL;
  return {
    coefficient: { valeur: coefAppl, source: coefSrc, origine: orig.coefficient.valeur, libelle: l.coefficient_origine_libelle ?? null },
    tauxHoraire: { valeur: tauxAppl, source: tauxSrc, origine: orig.tauxHoraire.valeur },
    global,
    court: [coefAppl != null ? `× ${formaterCoefficient(coefAppl)}` : null, tauxAppl != null ? `${formaterTauxHT(tauxAppl).replace(" HT/h", "/h")}` : null].filter(Boolean).join(" · ") + (global ? " · global" : ""),
    lignes: lignesTexte,
  };
}

/**
 * Une valeur plus récente existe-t-elle dans les Réglages pour une condition
 * globale figée ? Rend null si rien à signaler.
 */
export function valeurPlusRecente(cond, liste, champValeur) {
  if (!cond || cond.mode !== MODE_GLOBAL || cond.id == null) return null;
  const actuel = (liste || []).find(x => String(x?.id) === String(cond.id));
  if (!actuel) return { type: "introuvable", message: "Cette option n'existe plus dans les Réglages : la valeur figée reste utilisée." };
  const v = num(actuel[champValeur]);
  const notes = [];
  if (actuel.actif === false) notes.push("désactivée dans les Réglages");
  if (v != null && Math.abs(v - num(cond.valeur)) >= 0.00005) return { type: "valeur", actuelle: v, figee: num(cond.valeur), libelle: actuel.libelle, desactive: actuel.actif === false, message: `Valeur plus récente dans les Réglages : ${champValeur === "taux_ht" ? formaterTauxHT(v) : formaterCoefficient(v)} (figé : ${champValeur === "taux_ht" ? formaterTauxHT(cond.valeur) : formaterCoefficient(cond.valeur)}).` };
  if (notes.length) return { type: "desactive", message: `Option ${notes.join(", ")} : la valeur figée reste utilisée.` };
  return null;
}

/** Résumé d'un résultat de RPC (simulation) pour la confirmation. */
export function resumerSimulation(res) {
  if (!res) return null;
  return {
    nbRecalculees: num(res.nb_lignes_recalculees) ?? 0,
    nbIgnorees: num(res.nb_lignes_ignorees) ?? 0,
    nbSansSnapshot: num(res.nb_lignes_sans_snapshot) ?? 0,
    totalAvant: num(res.total_ht_avant), totalApres: num(res.total_ht_apres), ecart: num(res.ecart_ht),
    margeAvant: num(res.marge_avant), margeApres: num(res.marge_apres), margeAvantPct: num(res.marge_avant_pct), margeApresPct: num(res.marge_apres_pct),
    avertissements: Array.isArray(res.avertissements) ? res.avertissements : [],
    ignorees: Array.isArray(res.lignes_ignorees) ? res.lignes_ignorees : [],
    version: num(res.version_attendue) ?? num(res.version), hash: res.hash_lignes,
    avant: res.avant || {}, apres: res.apres || {},
  };
}
