// ─────────────────────────────────────────────────────────────────────────────
// Suivi d'une tâche EN QUANTITÉ (m², ml, m³, unités) — module PUR, règle
// UNIQUE (façade suiviQuantite.js). Utilisé par le compte rendu de l'ouvrier,
// l'onglet Phases, la Validation et Phasage V2 : aucune autre implémentation.
//
// 1. MODE DE SUIVI (modeSuivi)
//    En quantité si l'unité de l'ouvrage est m² (ou « m2 »), ml, m³ (ou
//    « m3 ») ou U, ET que la quantité prévue est > 1. Sinon en pourcentage,
//    comme avant : quantité ≤ 1 ou absente, tâche marquée « Hors devis »,
//    ouvrage « Divers / hors devis », case « Suivi en % » cochée.
//    Quantité prévue = « Quantité de la tâche » (taches[].quantite) si
//    renseignée, sinon la quantité de l'ouvrage. Les données ne sont jamais
//    modifiées : « m2 » est LU comme « m² ».
//
// 2. CUMUL — jamais stocké, toujours recalculé :
//      cumul = point de départ + somme des quantités validées (pointages)
//    Point de départ (taches[].quantite_reprise) : avancement × quantité
//    prévue au moment de la PREMIÈRE validation d'une quantité sur la tâche,
//    figé ensuite (« allumage » tâche par tâche). Tant qu'il n'est pas posé,
//    la tâche se comporte partout comme avant ; seul l'ouvrier du nouveau
//    compte rendu voit déjà « posé aujourd'hui », avec un point de départ
//    provisoire (même formule).
//
// 3. AVANCEMENT — « terminée » prime sur le calcul :
//      avancement = 100 si la tâche est marquée terminée
//                   (taches[].quantite_terminee), sinon
//                   min(100, arrondi(cumul / quantité prévue × 100)).
//    Une quantité déclarée plus tard (reprise) ne fait jamais repasser une
//    tâche terminée sous 100 % ; l'écart reste lisible : « terminée à
//    70 / 85 m² ».
//
// 4. Une quantité VALIDÉE est toujours ≥ 0 (cadences propres) : une erreur
//    se corrige par « Corriger » sur le rapport fautif, ou par « Déjà posé
//    hors comptes rendus » (le point de départ) dans Phasage V2.
// ─────────────────────────────────────────────────────────────────────────────

export const MODE_QUANTITE = "quantite";
export const MODE_POURCENT = "pourcent";
const DIVERS = "divers / hors devis";

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
export const arrondi2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// « m2 » et « m² » sont la même unité ; « m3 » s'affiche « m³ ». null si
// l'unité ne se suit pas en quantité (vide, forfait, « ens »…).
export function normaliserUnite(u) {
  const s = String(u ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (s === "m²" || s === "m2") return "m²";
  if (s === "m³" || s === "m3") return "m³";
  if (s === "ml") return "ml";
  if (s === "u") return "U";
  return null;
}

// Quantité prévue de la tâche : la sienne si renseignée (> 0), sinon celle
// de l'ouvrage. null si aucune.
export function quantitePrevue(tache, ouvrage) {
  const qt = num(tache?.quantite);
  if (qt != null && qt > 0) return qt;
  const qo = num(ouvrage?.quantite);
  return qo != null && qo > 0 ? qo : null;
}

// Mode de suivi d'une tâche.
//   tache   : { quantite?, suivi_pourcent?, hors_devis? }  (hors_devis : le
//             marquage EXPLICITE du conducteur, jamais une déduction)
//   ouvrage : { unite, quantite, libelle }
// Rend { mode, unite, quantite, raison }.
export function modeSuivi(tache, ouvrage) {
  const unite = normaliserUnite(ouvrage?.unite);
  const quantite = quantitePrevue(tache, ouvrage);
  const pourcent = (raison) => ({ mode: MODE_POURCENT, unite, quantite, raison });
  if (tache?.suivi_pourcent === true) return pourcent("force");
  if (tache?.hors_devis === true) return pourcent("hors_devis");
  if (String(ouvrage?.libelle ?? "").trim().toLowerCase() === DIVERS) return pourcent("divers");
  if (!unite) return pourcent("unite");
  if (quantite == null || quantite <= 1) return pourcent("quantite");
  return { mode: MODE_QUANTITE, unite, quantite, raison: null };
}

// Le point de départ a-t-il été posé (tâche « allumée ») ?
export const estAllumee = (tache) => num(tache?.quantite_reprise) != null;
export const estTerminee = (tache) => !!tache?.quantite_terminee;

// Point de départ : figé s'il existe, sinon provisoire (avancement × quantité).
export function pointDeDepart(tache, quantite) {
  const r = num(tache?.quantite_reprise);
  if (r != null) return Math.max(0, r);
  const av = Math.max(0, Math.min(100, num(tache?.avancement) ?? 0));
  return arrondi2((av / 100) * (num(quantite) ?? 0));
}

// Avancement d'une tâche en quantité (règle 3).
export function avancementQuantite({ cumul, quantite, terminee = false }) {
  if (terminee) return 100;
  const q = num(quantite);
  if (!q || q <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((num(cumul) ?? 0) / q) * 100)));
}

export const resteAPoser = (quantite, total) => Math.max(0, arrondi2((num(quantite) ?? 0) - (num(total) ?? 0)));

// Quantité validée : jamais négative, arrondie au centième.
export const quantiteValide = (v) => Math.max(0, arrondi2(num(v) ?? 0));

// « 51 », « 51,5 », « 12,25 »
export function fmtQuantite(n) {
  const v = arrondi2(n);
  return Number.isInteger(v) ? String(v) : String(v).replace(".", ",");
}
// « 51 / 85 m² »
export const libelleQuantite = (cumul, quantite, unite) =>
  `${fmtQuantite(cumul)} / ${fmtQuantite(quantite)} ${unite || ""}`.trim();

// « terminée à 70 / 85 m² » — vide si la tâche n'est pas terminée ou si le
// cumul atteint la quantité prévue.
export function ecartTerminee({ terminee, cumul, quantite, unite }) {
  if (!terminee || (num(cumul) ?? 0) >= (num(quantite) ?? 0) - 1e-9) return "";
  return `terminée à ${libelleQuantite(cumul, quantite, unite)}`;
}

// Ancien formulaire (ou carte en %) sur une tâche allumée : le % déclaré
// devient une quantité ajoutée au cumul (jamais négative).
export function conversionPourcent({ pourcent, quantite, cumulAvant }) {
  const p = Math.max(0, Math.min(100, num(pourcent) ?? 0));
  return quantiteValide((p / 100) * (num(quantite) ?? 0) - (num(cumulAvant) ?? 0));
}

// Phasage V2 : après une modification de la tâche (quantité, « Suivi en % »,
// point de départ, « terminée »), l'avancement à écrire — seulement pour une
// tâche en quantité DÉJÀ allumée (null sinon : rien à recalculer).
export function avancementRecalcule(tache, ouvrage, validee) {
  const s = etatSuivi(tache, ouvrage, { validee });
  return s.mode === MODE_QUANTITE && s.allumee ? s.avancement : null;
}

// Somme des quantités validées d'une liste de pointages, et par tâche.
export const sommeQuantitesValidees = (pointages) =>
  arrondi2((pointages || []).reduce((s, p) => s + (num(p?.quantite_validee) ?? 0), 0));
export function sommesParTache(pointages) {
  const m = {};
  (pointages || []).forEach(p => {
    if (!p?.tache_id || num(p.quantite_validee) == null) return;
    const k = String(p.tache_id);
    m[k] = arrondi2((m[k] || 0) + num(p.quantite_validee));
  });
  return m;
}

// État complet d'une tâche (onglet Phases, carte de l'ouvrier, Validation).
//   validee : somme des quantités validées (pointages) ; attente : somme des
//   quantités déclarées dans les comptes rendus pas encore validés.
export function etatSuivi(tache, ouvrage, { validee = 0, attente = 0 } = {}) {
  const m = modeSuivi(tache, ouvrage);
  if (m.mode !== MODE_QUANTITE) return { ...m, allumee: false };
  const depart = pointDeDepart(tache, m.quantite);
  const cumul = arrondi2(depart + (num(validee) ?? 0));
  const terminee = estTerminee(tache);
  return {
    ...m,
    allumee: estAllumee(tache),
    depart, validee: arrondi2(num(validee) ?? 0), attente: arrondi2(num(attente) ?? 0),
    cumul, terminee,
    avancement: avancementQuantite({ cumul, quantite: m.quantite, terminee }),
    ecart: ecartTerminee({ terminee, cumul, quantite: m.quantite, unite: m.unite }),
  };
}
