// ─────────────────────────────────────────────────────────────────────────────
// materiauxOuvrage — règles pures d'édition des matériaux d'un OUVRAGE de
// phasage (phasages.ouvrages[].materiaux_liens).
//
// Fonctions PURES : aucun réseau, aucun React, aucune horloge. Elles servent
// l'éditeur du conducteur (MateriauxOuvrage.jsx) et sont couvertes par
// scripts/verif-materiaux-liens.mjs.
//
// FORME D'UN LIEN — à ne pas élargir :
//   { materiau_id, quantite, commande_le? }
// `quantite` est la quantité nécessaire pour UNE unité d'ouvrage, jamais la
// quantité totale du chantier. `commande_le` est posé par la page Planning
// commandes ; l'éditeur ne le crée jamais, mais ne doit jamais le perdre.
//
// Le nom, l'unité, la référence, le fournisseur et le prix ne sont JAMAIS
// recopiés ici : ils restent résolus en direct depuis materiaux_bibliotheque.
// Le lien ne porte qu'un identifiant et une quantité.
// ─────────────────────────────────────────────────────────────────────────────

// Comparaison d'identifiants de matériau tolérante au type (uuid string vs
// valeur numérique héritée) — même précaution que le reste de l'application.
export const memeMateriau = (a, b) =>
  a != null && b != null && String(a) === String(b);

// Normalise une quantité saisie. Accepte un nombre ou un texte, la virgule
// comme le point. Renvoie un nombre fini >= 0, ou null si la saisie est
// inexploitable — vide, non numérique, négative, NaN, Infinity.
// null veut dire « ne rien enregistrer » : jamais de NaN en base.
export function normaliserQuantite(saisie) {
  if (saisie === null || saisie === undefined || typeof saisie === "boolean") return null;
  const brut = String(saisie).trim().replace(",", ".");
  if (brut === "") return null;
  // Un signe optionnel, des chiffres, un point décimal — rien d'autre.
  // Le test sur \d écarte les saisies intermédiaires type "." ou "-".
  if (!/^-?\d*\.?\d*$/.test(brut) || !/\d/.test(brut)) return null;
  const n = parseFloat(brut);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return n;
}

export function lienExiste(liens, materiauId) {
  return (Array.isArray(liens) ? liens : [])
    .some(l => l && memeMateriau(l.materiau_id, materiauId));
}

// Ajoute un lien. Renvoie le NOUVEAU tableau, ou null si l'ajout doit être
// refusé : identifiant vide, quantité inexploitable, ou matériau déjà lié
// (un materiau_id ne peut apparaître qu'une fois par ouvrage).
export function ajouterLien(liens, materiauId, quantite) {
  const base = Array.isArray(liens) ? liens : [];
  if (materiauId === null || materiauId === undefined || String(materiauId).trim() === "") return null;
  const q = normaliserQuantite(quantite);
  if (q === null) return null;
  if (lienExiste(base, materiauId)) return null;
  // Une ligne neuve ne porte JAMAIS commande_le : rien n'a été commandé.
  return [...base, { materiau_id: materiauId, quantite: q }];
}

// Change la quantité d'un lien existant. Renvoie le NOUVEAU tableau, ou null
// si la quantité est inexploitable ou le lien absent.
// Les autres champs du lien — commande_le et tout champ inconnu ajouté plus
// tard par une autre partie de l'application — sont conservés tels quels.
export function modifierQuantiteLien(liens, materiauId, quantite) {
  const base = Array.isArray(liens) ? liens : [];
  const q = normaliserQuantite(quantite);
  if (q === null) return null;
  if (!lienExiste(base, materiauId)) return null;
  return base.map(l =>
    (l && memeMateriau(l.materiau_id, materiauId)) ? { ...l, quantite: q } : l);
}

// Retire UN lien. Les autres sont conservés à l'identique, dans l'ordre.
export function retirerLien(liens, materiauId) {
  return (Array.isArray(liens) ? liens : [])
    .filter(l => !(l && memeMateriau(l.materiau_id, materiauId)));
}

// Quantité totale pour le chantier = quantité de l'ouvrage × quantité par
// unité. Renvoie null quand le total n'est pas affichable — quantité
// d'ouvrage absente, nulle ou inexploitable : mieux vaut « — » qu'un zéro
// qui se lirait comme une vraie valeur. Même règle qu'avant l'éditeur.
export function quantiteTotale(quantiteOuvrage, quantiteParUnite) {
  const qo = normaliserQuantite(quantiteOuvrage);
  const qu = normaliserQuantite(quantiteParUnite);
  if (qo === null || qo === 0 || qu === null) return null;
  return qo * qu;
}

// Liens d'un ouvrage, épurés des entrées inutilisables (null, sans
// materiau_id). Ne supprime JAMAIS un lien dont le matériau est absent de la
// bibliothèque : c'est une donnée du chantier, pas une erreur à nettoyer.
export function liensUtilisables(liens) {
  return (Array.isArray(liens) ? liens : [])
    .filter(l => l && l.materiau_id !== null && l.materiau_id !== undefined);
}
