// ─────────────────────────────────────────────────────────────────────────────
// Répartition des heures vendues d'un ouvrage sur ses tâches (Phasage V2).
// Module PUR, déplacé tel quel de PhasageV2.jsx (06/10/2026) pour être testé.
// ─────────────────────────────────────────────────────────────────────────────
import { tacheHorsDevis } from "../chantierFinance.mjs";

// Répartit un total d'heures entre des tâches selon leur poids. Base de
// pondération en cascade : ratio (copié de la biblio) → heures_estimees →
// parts égales. Renvoie un tableau de valeurs EXACTES (2 décimales, non
// arrondies) aligné sur `taches`. Si `total` est vide, renvoie des null.
export function repartirHeures(total, taches) {
  const t = Array.isArray(taches) ? taches : [];
  const tot = parseFloat(total);
  if (isNaN(tot) || t.length === 0) return t.map(() => null);
  let poids = t.map(x => parseFloat(x.ratio) || 0);
  let somme = poids.reduce((s, p) => s + p, 0);
  if (somme <= 0) {
    poids = t.map(x => parseFloat(x.heures_estimees) || 0);
    somme = poids.reduce((s, p) => s + p, 0);
  }
  if (somme <= 0) {
    poids = t.map(() => 1);
    somme = t.length;
  }
  return poids.map(p => parseFloat((tot * p / somme).toFixed(2)));
}

// Répartition sur les tâches d'un ouvrage SANS les tâches hors devis (travail
// non vendu) : elles gardent leur valeur et ne reçoivent jamais d'heures
// vendues. Sans tâche hors devis : exactement repartirHeures, comme avant.
export function repartirHeuresVendues(total, taches) {
  const t = Array.isArray(taches) ? taches : [];
  const idx = [];
  t.forEach((x, i) => { if (!tacheHorsDevis(x)) idx.push(i); });
  const parts = repartirHeures(total, idx.map(i => t[i]));
  const out = t.map(x => x.heures_vendues);
  idx.forEach((i, k) => { out[i] = parts[k]; });
  return out;
}
