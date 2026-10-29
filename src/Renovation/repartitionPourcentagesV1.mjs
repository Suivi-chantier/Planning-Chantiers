// src/Renovation/repartitionPourcentagesV1.mjs — répartition en % des tâches
// d'origine devis d'un ouvrage (décision de Loris du 29/10/2026).
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord. Les
// ouvrages arrivent en paramètre. Façade front : repartitionPourcentagesV1.js.
//
// RÈGLE
// -----
// Les heures prévues de l'ouvrage font foi (chantierFinance, heuresPrevuesTache) ;
// les tâches d'origine devis s'en partagent la totalité selon leur %. Ces %
// doivent TOUJOURS totaliser 100 % :
//   - le phasage affiche le total par ouvrage ;
//   - une répartition qui ne tombe pas à 100 % ne s'enregistre pas
//     (appliquerRepartition la refuse) ; deux corrections d'un clic :
//     « ajuster la dernière tâche » et « répartir l'écart » ;
//   - supprimer une tâche de la répartition rééquilibre les autres
//     (retirerTacheRepartition, même règle que « répartir l'écart »).
// Hors de ce total : les tâches hors devis (cas C), les tâches « ajoutées en
// cours de chantier » (cas B, poids = leurs heures normales) et les reprises.
// Un ouvrage existant qui ne fait pas 100 % n'est PAS réécrit : le calcul le
// ramène à 100 % (Σ ratios), le phasage le signale avec le bouton de correction.

import { tacheHorsDevis, tacheReprise, tacheAjouteeEnCours, heuresVenduesOuvrage } from "../chantierFinance.mjs";

export const TOLERANCE_POURCENT = 0.01;

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const ratioDe = (v) => { const n = num(v); return n != null && n > 0 ? n : 0; };

// Tâche qui entre dans la répartition en % de son ouvrage.
export const tacheDansRepartition = (t) => !!t && !tacheHorsDevis(t) && !tacheReprise(t) && !tacheAjouteeEnCours(t);

// Lignes éditables : { id, nom, ratio } pour chaque tâche de la répartition
// (ratio null = la tâche n'a pas de % : hors du total, pesée par ses heures
// estimées tant qu'on ne lui en donne pas).
export function lignesRepartition(ouvrage) {
  return (ouvrage?.taches || []).filter(tacheDansRepartition).map(t => ({
    id: t.id, nom: t.nom_perso || t.nom || "(sans nom)", ratio: ratioDe(t.ratio) > 0 ? ratioDe(t.ratio) : null,
  }));
}

const sommer = (lignes) => (lignes || []).reduce((s, l) => s + ratioDe(l.ratio), 0);
const arrondi2 = (n) => Math.round(n * 100) / 100;

// État d'une liste de lignes : total, écart à 100, ok.
export function verifierRepartition(lignes) {
  const total = arrondi2(sommer(lignes));
  return { total, ecart: arrondi2(100 - total), ok: Math.abs(total - 100) <= TOLERANCE_POURCENT };
}

// État de la répartition d'un ouvrage. `applicable` false : aucune tâche n'a
// de % (ancien ouvrage, pesé par heures estimées) — rien à signaler.
export function etatRepartition(ouvrage) {
  const lignes = lignesRepartition(ouvrage);
  const avecRatio = lignes.filter(l => l.ratio != null);
  if (avecRatio.length === 0) return { applicable: false, total: 0, ecart: 100, ok: true, nbTaches: 0 };
  return { applicable: true, ...verifierRepartition(lignes), nbTaches: avecRatio.length };
}

// Ajuste la DERNIÈRE ligne qui porte un % (ordre des tâches) pour que le total
// tombe à 100. Si elle devait passer sous 0, on répartit l'écart à la place.
export function ajusterDerniere(lignes) {
  const out = (lignes || []).map(l => ({ ...l, ratio: ratioDe(l.ratio) > 0 ? ratioDe(l.ratio) : null }));
  let k = -1;
  out.forEach((l, i) => { if (l.ratio != null) k = i; });
  if (k < 0) return repartirEcart(out);
  const autres = out.reduce((s, l, i) => s + (i === k ? 0 : ratioDe(l.ratio)), 0);
  const v = arrondi2(100 - autres);
  if (v <= 0) return repartirEcart(out);
  out[k] = { ...out[k], ratio: v };
  return out;
}

// Répartit l'écart à 100 entre les lignes qui portent un %, au prorata de leur
// % (au centième, total exactement 100 : méthode du plus fort reste). Aucune
// ligne avec un % : parts égales entre toutes les lignes.
export function repartirEcart(lignes) {
  const out = (lignes || []).map(l => ({ ...l, ratio: ratioDe(l.ratio) > 0 ? ratioDe(l.ratio) : null }));
  if (out.length === 0) return out;
  let idx = out.map((l, i) => (l.ratio != null ? i : -1)).filter(i => i >= 0);
  let poids = idx.map(i => out[i].ratio);
  if (idx.length === 0) { idx = out.map((_, i) => i); poids = idx.map(() => 1); }
  const parts = partsCentiemes(10000, poids);
  idx.forEach((i, k) => { out[i] = { ...out[i], ratio: parts[k] / 100 }; });
  return out;
}

// Partage `cible` (entier) selon `poids`, en entiers dont la somme vaut
// exactement `cible` (plus fort reste).
function partsCentiemes(cible, poids) {
  const somme = poids.reduce((s, x) => s + x, 0);
  const p = somme > 0 ? poids : poids.map(() => 1);
  const tot = somme > 0 ? somme : p.length;
  const bruts = p.map(x => cible * x / tot);
  const parts = bruts.map(v => Math.floor(v + 1e-9));
  const reste = cible - parts.reduce((s, x) => s + x, 0);
  bruts.map((v, i) => ({ i, f: v - parts[i] }))
    .sort((a, b) => b.f - a.f || a.i - b.i)
    .slice(0, Math.max(0, reste))
    .forEach(({ i }) => { parts[i] += 1; });
  return parts;
}

// Applique une répartition à l'ouvrage. Refusée si le total n'est pas 100 %.
// Les tâches de la liste reçoivent leur % (null si vide) et, quand l'ouvrage a
// des heures prévues, leurs heures prévues et estimées (heures de l'ouvrage ×
// %, au centième, total exact) — pour que planning et espace ouvrier lisent
// les mêmes heures que le calcul. Les autres tâches ne bougent pas.
export function appliquerRepartition(ouvrage, lignes) {
  const v = verifierRepartition(lignes);
  if (!v.ok) {
    return { ok: false, raison: `Le total des % fait ${String(v.total).replace(".", ",")} % : il doit faire exactement 100 %.`, ...v };
  }
  const parId = new Map((lignes || []).map(l => [String(l.id), ratioDe(l.ratio) > 0 ? ratioDe(l.ratio) : null]));
  const H = heuresVenduesOuvrage(ouvrage);
  const avecRatio = (ouvrage?.taches || []).filter(t => parId.has(String(t.id)) && parId.get(String(t.id)) != null);
  const heures = H > 0 ? partsCentiemes(Math.round(H * 100), avecRatio.map(t => parId.get(String(t.id)))).map(c => c / 100) : null;
  const heuresDe = new Map(avecRatio.map((t, k) => [String(t.id), heures ? heures[k] : null]));
  const taches = (ouvrage?.taches || []).map(t => {
    if (!parId.has(String(t.id))) return t;
    const ratio = parId.get(String(t.id));
    const h = heuresDe.get(String(t.id));
    return { ...t, ratio, ...(h != null ? { heures_vendues: h, heures_estimees: h } : {}) };
  });
  return { ok: true, ouvrage: { ...ouvrage, taches }, ...v };
}

// Supprime une tâche. Si elle portait un % de la répartition, les autres %
// sont rééquilibrés (répartir l'écart) pour retomber à 100 %.
export function retirerTacheRepartition(ouvrage, tacheId) {
  const t = (ouvrage?.taches || []).find(x => String(x.id) === String(tacheId));
  const sans = { ...ouvrage, taches: (ouvrage?.taches || []).filter(x => String(x.id) !== String(tacheId)) };
  if (!t || !tacheDansRepartition(t) || !(ratioDe(t.ratio) > 0)) return sans;
  const lignes = lignesRepartition(sans);
  if (!lignes.some(l => l.ratio != null)) return sans;
  const r = appliquerRepartition(sans, repartirEcart(lignes));
  return r.ok ? r.ouvrage : sans;
}

// Ouvrages dont la répartition ne fait pas 100 %, pour signalement / rapport.
export function ouvragesHorsCent(ouvrages) {
  return (ouvrages || []).map(o => ({ o, e: etatRepartition(o) }))
    .filter(x => x.e.applicable && !x.e.ok)
    .map(x => ({ id: x.o.id, libelle: x.o.libelle || "(sans libellé)", total: x.e.total }));
}
