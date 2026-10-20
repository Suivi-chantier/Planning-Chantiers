// Prix HT des lignes d'un document d'achat lu par l'IA (ticket, BL, bon de commande).
//
// Module PUR : aucune horloge, aucun accès Supabase, aucun effet de bord.
//
// Pourquoi ce module : la répartition d'une remise globale (remise fidélité…)
// était confiée à l'IA. Sur un ticket où la remise est DÉJÀ déduite ligne par
// ligne, l'IA la retranchait une seconde fois, puis bricolait la dernière ligne
// pour retomber sur le total : total juste, lignes fausses (ticket Leroy Merlin
// du 14/10/2026). L'IA recopie désormais le HT imprimé de chaque ligne, et le
// calcul se fait ici, à partir d'un seul fait vérifiable : la somme des lignes
// dépasse-t-elle le Total HT du document ?

export const TOLERANCE_HT = 0.02;
// En dessous, l'écart n'est plus une remise plausible : on ne touche à rien.
export const COEFFICIENT_REMISE_MIN = 0.5;

// "12,5 m²" -> 12.5 ; "" / null / non numérique -> null
export function nombre(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const arrondi = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

// Total HT d'une ligne : prix_total, sinon prix_unitaire × quantité (1 par défaut).
export function totalLigneHT(l) {
  const total = nombre(l?.prix_total);
  if (total != null) return total;
  const pu = nombre(l?.prix_unitaire);
  if (pu == null) return null;
  return pu * (nombre(l?.quantite) ?? 1);
}

// Somme des lignes, ou null si une ligne n'a aucun prix (somme inconnue, pas 0).
export function sommeLignesHT(lignes) {
  if (!Array.isArray(lignes) || !lignes.length) return null;
  let s = 0;
  for (const l of lignes) {
    const t = totalLigneHT(l);
    if (t == null) return null;
    s += t;
  }
  return arrondi(s, 2);
}

/**
 * Compare la somme des lignes au Total HT du document.
 * statut : "inconnu" (une des deux valeurs manque), "egal", "lignes_au_dessus"
 * (remise globale non déduite des lignes), "lignes_en_dessous" (ligne oubliée ?).
 */
export function ecartLignesDocument(lignes, montantHT) {
  const somme = sommeLignesHT(lignes);
  const total = nombre(montantHT);
  if (somme == null || total == null) return { statut: "inconnu", somme, total, ecart: null };
  const ecart = arrondi(somme - total, 2);
  if (Math.abs(ecart) <= TOLERANCE_HT) return { statut: "egal", somme, total, ecart };
  return { statut: ecart > 0 ? "lignes_au_dessus" : "lignes_en_dessous", somme, total, ecart };
}

/**
 * Répartit une remise globale sur les lignes, et SEULEMENT si les lignes
 * dépassent le Total HT du document (remise non déduite ligne par ligne).
 * Si la somme des lignes égale déjà le total, rien n'est touché.
 * Chaque ligne est réduite au prorata ; le centime d'arrondi va sur la plus
 * grosse ligne pour que la somme soit exactement le Total HT.
 * Retour : { lignes, remise } — remise = null si rien n'a été appliqué.
 */
export function repartirRemiseGlobale(lignes, montantHT) {
  const e = ecartLignesDocument(lignes, montantHT);
  if (e.statut !== "lignes_au_dessus" || e.somme <= 0) return { lignes, remise: null, ecart: e };
  const coefficient = e.total / e.somme;
  if (coefficient < COEFFICIENT_REMISE_MIN) return { lignes, remise: null, ecart: e };

  const totaux = lignes.map(l => arrondi(totalLigneHT(l) * coefficient, 2));
  const residu = arrondi(e.total - totaux.reduce((a, b) => a + b, 0), 2);
  if (residu !== 0) {
    let iMax = 0;
    totaux.forEach((t, i) => { if (t > totaux[iMax]) iMax = i; });
    totaux[iMax] = arrondi(totaux[iMax] + residu, 2);
  }
  const nouvelles = lignes.map((l, i) => {
    const q = nombre(l.quantite);
    return {
      ...l,
      prix_total: totaux[i],
      prix_unitaire: q && q > 0 ? arrondi(totaux[i] / q, 4) : totaux[i],
    };
  });
  return {
    lignes: nouvelles,
    remise: { coefficient: arrondi(coefficient, 4), avant: e.somme, apres: e.total, montant: e.ecart },
    ecart: ecartLignesDocument(nouvelles, montantHT),
  };
}
