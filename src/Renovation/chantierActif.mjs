// ─────────────────────────────────────────────────────────────────────────────
// chantierActif — LA règle unique « ce chantier apparaît-il dans cette liste ? »
// Refonte Opérations, lot 1 (docs/projets/refonte-operations.md).
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord. La
// façade chantierActif.js le rend au front ; les tâches serveur (api/)
// importent directement ce .mjs.
//
// Toutes les pages qui listent des chantiers passent par estChantierActif() ou
// filtrerChantiersActifs(). Aucune page ne refiltre le statut à la main
// (contrôlé par scripts/verif-chantier-actif.mjs).
//
// Deux usages, une seule règle :
//   - estChantierActif(c)                            → chantiers « en vie » :
//       pas terminé (planning hebdo, Bilan, espace ouvrier « autres chantiers »,
//       simulation d'opération…). C'est le filtre historique
//       `statut !== "termine"`, désormais écrit une seule fois.
//   - estChantierActif(c, { inclureTermines: true }) → listes qui montraient
//       DÉJÀ les chantiers terminés (tableau de bord, commandes, états
//       financiers, validation des heures…) : comportement inchangé.
// Dans les deux cas, un chantier archivé (« supprimé » depuis
// l'Administration) ou hors exploitation n'apparaît jamais.
//
// Lot 2 : "a_l_etude" et "perdu" sont dans STATUTS_HORS_EXPLOITATION. Ils
// disparaissent de TOUTES les pages qui passent par ce module, sans toucher
// aux pages. Seules les pages à liste complète les montrent : Opérations,
// Chantiers (gestion), Chiffrage et Réglages.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Statuts connus, dans l'ordre du cycle. Absent = « Planifié ».
 * Lot 2 : « À l'étude » (avant la signature) et « Perdu » (affaire non
 * signée). Libellés et couleurs : statutsChantier.mjs.
 */
export const STATUTS_CHANTIER = Object.freeze(["a_l_etude", "planifie", "en_cours", "en_pause", "termine", "perdu"]);

/** Chantier en cours de chiffrage, pas encore signé. */
export const STATUT_A_L_ETUDE = "a_l_etude";
/** Affaire non signée, marquée perdue (motif obligatoire). */
export const STATUT_PERDU = "perdu";

/** Statut d'un chantier soldé. */
export const STATUT_TERMINE = "termine";

/**
 * Statuts qui ne sortent jamais de la page Opérations (et des pages à liste
 * complète). Vide au lot 1 ; lot 2 : à l'étude et perdu.
 */
export const STATUTS_HORS_EXPLOITATION = Object.freeze([STATUT_A_L_ETUDE, STATUT_PERDU]);

/** Statut nettoyé ("" ou absent → null). */
export function statutDuChantier(chantier) {
  const s = chantier && typeof chantier.statut === "string" ? chantier.statut.trim() : "";
  return s || null;
}

/** Le chantier est-il marqué Terminé ? */
export function estChantierTermine(chantier) {
  return statutDuChantier(chantier) === STATUT_TERMINE;
}

/** Le chantier n'existe-t-il que dans Opérations (lot 2 : à l'étude, perdu) ? */
export function estChantierHorsExploitation(chantier) {
  const s = statutDuChantier(chantier);
  return s != null && STATUTS_HORS_EXPLOITATION.includes(s);
}

/**
 * Archivé = « supprimé » depuis l'Administration (archive_le, jamais effacé en
 * base). `archive` (vrai) est l'ancien drapeau que trois écrans ouvriers
 * testaient déjà (jamais posé dans les données au 06/11/2026) : même sens.
 */
export function estChantierArchive(chantier) {
  return !!(chantier && (chantier.archive_le || chantier.archive));
}

/**
 * LA règle. `inclureTermines` : la liste montrait déjà les chantiers terminés.
 * Un objet sans identifiant n'est jamais un chantier affichable.
 */
export function estChantierActif(chantier, { inclureTermines = false } = {}) {
  if (!chantier || typeof chantier !== "object") return false;
  if (chantier.id == null || String(chantier.id).trim() === "") return false;
  if (estChantierArchive(chantier)) return false;
  if (estChantierHorsExploitation(chantier)) return false;
  if (!inclureTermines && estChantierTermine(chantier)) return false;
  return true;
}

/** Filtre une liste (non-tableau → liste vide). Conserve l'ordre. */
export function filtrerChantiersActifs(chantiers, options) {
  return Array.isArray(chantiers) ? chantiers.filter((c) => estChantierActif(c, options)) : [];
}
