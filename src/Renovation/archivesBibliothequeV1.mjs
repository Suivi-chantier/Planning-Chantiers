// ─────────────────────────────────────────────────────────────────────────────
// Archives de la bibliothèque d'ouvrages.
//
// LE PROBLÈME QUE ÇA RÈGLE : on supprimait des ouvrages de bibliothèque pour
// deux raisons très différentes — les REFAIRE, et faire le MÉNAGE. « Dupliquer »
// couvre le premier cas. « Archiver » couvre le second, sans rien détruire.
//
// Archiver NE TOUCHE PAS à la ligne `bibliotheque_ratios` : l'id reste valide,
// les ouvrages de chantier restent reliés, et la jauge d'échantillon continue
// de compter ses ouvrages terminés (cf. echantillonCadencesV1). C'est toute la
// différence avec la suppression, qui laissait 153 ouvrages de chantier
// rattachés à un identifiant introuvable — définitivement irrécupérables.
//
// OÙ C'EST STOCKÉ : dans `planning_config`, table clé/valeur déjà utilisée par
// la page Bibliothèque pour les catégories personnalisées. Même mécanisme,
// même forme de valeur (`{ items: [...] }`). Aucune migration, aucune colonne
// nouvelle, aucune écriture sur `bibliotheque_ratios`.
//
// RÈGLE DE PRUDENCE, ASYMÉTRIQUE ET VOLONTAIRE :
//   si la liste des archivés ne peut pas être lue, ON AFFICHE TOUT.
// Mieux vaut montrer un ouvrage archivé — désagréable — que cacher un ouvrage
// actif, ce qui pousserait quelqu'un à le recréer, et donc à reproduire
// exactement le problème qu'on vient de colmater.
//
// Module de calcul PUR : aucune dépendance Supabase, aucune horloge, aucun
// effet de bord. Les données arrivent en paramètre. Le front importe la façade
// archivesBibliothequeV1.js.
// ─────────────────────────────────────────────────────────────────────────────

export const ARCHIVES_BIBLIOTHEQUE_VERSION = "v1";

/** Clé dédiée dans planning_config. Voisine de bibliotheque_categories_custom. */
export const CLE_ARCHIVES_BIBLIOTHEQUE = "bibliotheque_archives";

/** Bandeau affiché quand la liste des archivés n'a pas pu être lue. */
export const MESSAGE_ARCHIVES_INDISPONIBLES =
  "Liste des archivés indisponible : tous les ouvrages sont affichés.";

const listeSure = v => (Array.isArray(v) ? v : []);
const str = v => (v == null ? "" : String(v).trim());

/**
 * Traduit la réponse Supabase en un état exploitable.
 *
 * @param {*} erreur  l'erreur remontée par la lecture (null si aucune)
 * @param {*} data    la ligne planning_config lue (null si la clé n'existe pas)
 * @returns {{ disponible: boolean, ids: string[], raison: string|null }}
 *
 * Nuance importante, et différente du cas des phasages : ici, AUCUNE LIGNE est
 * une réponse parfaitement légitime — la clé n'a simplement jamais été écrite,
 * donc rien n'est archivé. C'est l'ERREUR, ou une valeur d'une forme
 * inattendue, qui rend la liste indisponible.
 */
export function lireArchivesV1(erreur, data) {
  if (erreur) {
    return { disponible: false, ids: [], raison: "la lecture des archives a échoué" };
  }
  // Clé absente : la fonctionnalité n'a encore jamais servi. Zéro archivé.
  if (data == null) return { disponible: true, ids: [], raison: null };
  if (typeof data !== "object") {
    return { disponible: false, ids: [], raison: "réponse inattendue" };
  }
  // On accepte la ligne complète { value: {...} } comme la valeur seule.
  const valeur = Object.prototype.hasOwnProperty.call(data, "value") ? data.value : data;
  if (valeur == null) return { disponible: true, ids: [], raison: null };
  if (typeof valeur !== "object" || !Array.isArray(valeur.items)) {
    // Valeur corrompue : on ne sait pas ce qui est archivé. On n'invente pas
    // une liste vide, qui masquerait des archivages réels lors du prochain
    // enregistrement.
    return { disponible: false, ids: [], raison: "liste des archives illisible" };
  }
  // Nettoyage : on ne garde que des identifiants exploitables, dédoublonnés.
  const ids = [...new Set(valeur.items.map(str).filter(Boolean))];
  return { disponible: true, ids, raison: null };
}

/** Un ouvrage est-il archivé ? Une liste indisponible ne masque JAMAIS rien. */
export function estArchiveV1(archives, id) {
  if (!archives || archives.disponible !== true) return false;
  const cible = str(id);
  if (!cible) return false;
  return listeSure(archives.ids).includes(cible);
}

/**
 * Retire les ouvrages archivés d'une liste de CHOIX.
 * À n'utiliser QUE là où l'on choisit un ouvrage à ajouter à un chantier ou à
 * un devis. Partout où l'on affiche un ouvrage déjà utilisé, on lit la ligne
 * telle quelle : un archivé reste parfaitement lisible.
 */
export function filtrerPourChoixV1(ouvrages, archives) {
  const liste = listeSure(ouvrages);
  // Liste indisponible => on affiche tout. Cacher un ouvrage ACTIF est le
  // risque à éviter ; montrer un archivé n'en est pas un.
  if (!archives || archives.disponible !== true) return liste;
  const exclus = new Set(listeSure(archives.ids));
  if (exclus.size === 0) return liste;
  return liste.filter(o => !exclus.has(str(o?.id)));
}

/** Les ouvrages archivés d'une liste (pour l'affichage du filtre « archivés »). */
export function seulementArchivesV1(ouvrages, archives) {
  const liste = listeSure(ouvrages);
  if (!archives || archives.disponible !== true) return [];
  const inclus = new Set(listeSure(archives.ids));
  return liste.filter(o => inclus.has(str(o?.id)));
}

/**
 * Nouvelle liste d'ids après archivage.
 * @returns {string[]|null} null = écriture INTERDITE.
 *
 * Le null est la protection centrale : si la relecture n'a pas abouti,
 * `archives.ids` vaut [] — écrire cette liste vide effacerait tous les
 * archivages faits par les autres. On refuse plutôt que d'écraser.
 */
export function ajouterArchiveV1(archives, id) {
  const cible = str(id);
  if (!cible) return null;
  if (!archives || archives.disponible !== true) return null;
  const ids = listeSure(archives.ids).map(str).filter(Boolean);
  if (ids.includes(cible)) return [...ids]; // déjà archivé : liste inchangée
  return [...ids, cible];
}

/** Nouvelle liste d'ids après désarchivage. null = écriture INTERDITE. */
export function retirerArchiveV1(archives, id) {
  const cible = str(id);
  if (!cible) return null;
  if (!archives || archives.disponible !== true) return null;
  const ids = listeSure(archives.ids).map(str).filter(Boolean);
  return ids.filter(x => x !== cible);
}

/** La valeur à écrire dans planning_config — même forme que les catégories. */
export function valeurAEcrireV1(ids) {
  return { items: [...new Set(listeSure(ids).map(str).filter(Boolean))] };
}

// ── Libellés (purs, sans ICU) ───────────────────────────────────────────────
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/** Libellé du filtre, qui dit combien d'ouvrages sont concernés. */
export function libelleFiltreArchivesV1(archives) {
  if (!archives || archives.disponible !== true) return "Afficher les archivés";
  const n = listeSure(archives.ids).length;
  if (n === 0) return "Afficher les archivés";
  return `Afficher les archivés (${n})`;
}

/**
 * Les deux voies proposées quand la suppression est bloquée par l'usage.
 * Le message de blocage (usageBibliothequeV1) dit pourquoi on ne supprime pas ;
 * celui-ci dit quoi faire à la place. Sans cette seconde phrase, l'utilisateur
 * contourne le blocage en recréant l'ouvrage — ce qui recrée le problème.
 */
export function messageVoiesAlternativesV1() {
  return "« Dupliquer » crée une variante sans toucher à l'original. "
    + "« Archiver » le retire des listes de choix sans rien supprimer : "
    + "son historique et ses liens avec les chantiers sont conservés.";
}
