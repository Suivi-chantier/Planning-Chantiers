// ─────────────────────────────────────────────────────────────────────────────
// ÉCRAN « CHANTIERS ProGBat ASSOCIÉS » — règles pures.
//
// Ce module ne parle à personne : ni Supabase, ni React, ni réseau. Il répond à
// trois questions, et à rien d'autre :
//   1. comment nommer un chantier ProGBat qui n'a pas de libellé ;
//   2. quels rattachements appartiennent au chantier affiché ;
//   3. lesquels des ~110 chantiers ProGBat proposer, dans quel état.
//
// Pourquoi séparer ça du composant : ce sont exactement les règles qui, si
// elles se trompent, rattachent de l'argent au mauvais chantier. Elles doivent
// être vérifiables sans navigateur — scripts/verif-progbat-yards-ecran.mjs.
//
// Ce module ne rapproche JAMAIS un chantier ProGBat d'un chantier Profero par
// ressemblance de libellé : il ne lit les libellés que pour filtrer une
// recherche tapée à la main et pour trier.
// ─────────────────────────────────────────────────────────────────────────────

/** Libellé d'un chantier ProGBat : celui de ProGBat, sinon son numéro. */
export function libelleYard(label, id) {
  const l = String(label ?? "").trim();
  return l || `Chantier ProGBat n°${id}`;
}

/**
 * Normalisation de recherche : sans casse et sans accents. Une comparaison
 * brute ferait rater « Résidence » tapé sans accent — ce qu'on tape vite.
 */
export function normaliserRecherche(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// Les identifiants viennent de deux mondes (bigint en base, number dans le
// JSON ProGBat) : toute comparaison passe par la même forme texte.
const cle = (v) => String(v ?? "");

const collateur = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/** Rattachements du chantier affiché, triés par libellé. */
export function rattachementsDuChantier(liens, chantierId) {
  return (liens || [])
    .filter((l) => cle(l?.chantier_id) === cle(chantierId))
    .slice()
    .sort((a, b) => collateur.compare(
      libelleYard(a?.progbat_yard_label, a?.progbat_yard_id),
      libelleYard(b?.progbat_yard_label, b?.progbat_yard_id),
    ));
}

/** Map progbat_yard_id → chantier_id, pour les liens des AUTRES chantiers. */
export function yardsPrisAilleurs(liens, chantierId) {
  return new Map(
    (liens || [])
      .filter((l) => cle(l?.chantier_id) !== cle(chantierId))
      .map((l) => [cle(l?.progbat_yard_id), l?.chantier_id]),
  );
}

/**
 * Chantiers ProGBat proposables dans le select.
 *
 * - déjà rattaché AU CHANTIER AFFICHÉ → retiré (le proposer n'a aucun sens) ;
 * - déjà rattaché AILLEURS           → conservé, marqué `pris` (donc affiché
 *   désactivé) : c'est plus utile que de le faire disparaître, on comprend
 *   pourquoi il manque au lieu de le chercher ;
 * - recherche → filtre sur libellé, identifiant et numéro public, sans casse
 *   ni accents.
 */
export function yardsProposables({ yards = [], liens = [], chantierId, recherche = "" } = {}) {
  const dejaIci = new Set(rattachementsDuChantier(liens, chantierId).map((l) => cle(l?.progbat_yard_id)));
  const ailleurs = yardsPrisAilleurs(liens, chantierId);
  const q = normaliserRecherche(recherche);
  return yards
    .filter((y) => !dejaIci.has(cle(y?.id)))
    .filter((y) => !q || [y?.label, y?.id, y?.publicYardNumber]
      .some((v) => normaliserRecherche(v).includes(q)))
    .map((y) => ({ ...y, pris: ailleurs.get(cle(y?.id)) || null }));
}

/**
 * Un rattachement enregistré est-il introuvable dans ProGBat aujourd'hui ?
 * La question n'a de sens que si la liste a pu être LUE : sans liste (erreur
 * réseau, chargement), on ne sait pas — et on ne prétend pas savoir.
 */
export function yardIntrouvable(lien, yards, listeLue) {
  if (!listeLue || !Array.isArray(yards) || yards.length === 0) return false;
  return !yards.some((y) => cle(y?.id) === cle(lien?.progbat_yard_id));
}
