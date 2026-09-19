// ─────────────────────────────────────────────────────────────────────────────
// ouvrierOperations — regroupement Opération → Chantiers pour l'espace ouvrier.
//
// Fonctions PURES : aucun appel réseau, aucun React, aucune horloge. Tout
// arrive en argument, ce qui rend le regroupement testable sans navigateur
// (scripts/verif-ouvrier-operations.mjs).
//
// Les deux référentiels viennent de planning_config :
//   operations : [{ id, nom, adresse, couleur }]   (clé "operations")
//   chantiers  : [{ id, nom, couleur, statut, operation_id? }] (clé "chantiers")
// Le lien vit sur le chantier (operation_id, optionnel). Ce module ne fait que
// LIRE cette relation : il ne calcule aucun chiffre, aucune donnée financière,
// et ne connaît ni prix, ni heures, ni avancement.
// ─────────────────────────────────────────────────────────────────────────────

// Statuts de chantier, dans l'ordre d'affichage voulu. Mêmes identifiants que
// PageChantiers (bureau) et que l'onglet Chantiers de l'espace ouvrier : on ne
// crée pas de statut, on se contente de compter ceux qui existent.
export const ORDRE_STATUTS = ["en_cours", "planifie", "en_pause", "termine"];

// Statut effectif d'un chantier : un statut absent ou inconnu vaut "en_cours"
// (même repli que l'affichage existant, pour ne pas faire disparaître un
// chantier d'un compteur à cause d'une valeur non renseignée).
export function statutChantier(chantier) {
  const s = chantier?.statut;
  return ORDRE_STATUTS.includes(s) ? s : "en_cours";
}

// Compte les chantiers par statut. Renvoie uniquement les statuts présents,
// dans l'ordre d'ORDRE_STATUTS : [{ statut, n }].
export function compterStatuts(chantiers = []) {
  const n = {};
  chantiers.forEach((c) => {
    const s = statutChantier(c);
    n[s] = (n[s] || 0) + 1;
  });
  return ORDRE_STATUTS.filter((s) => n[s] > 0).map((s) => ({ statut: s, n: n[s] }));
}

// Regroupe les chantiers sous leurs opérations.
//
// Règles (décidées pour cette première tranche) :
//  - un chantier appartient à l'opération dont l'id vaut son operation_id ;
//  - un chantier SANS operation_id ("" , null, absent) est « hors opération » ;
//  - un chantier dont l'operation_id ne correspond à AUCUNE opération connue
//    est lui aussi « hors opération » — il reste donc toujours joignable,
//    jamais masqué par une référence cassée ;
//  - une opération sans aucun chantier n'est pas renvoyée : elle n'aurait rien
//    à montrer à un ouvrier ;
//  - l'ordre des opérations et celui des chantiers sont conservés tels quels.
//
// Renvoie { operations: [{ ...operation, chantiers, statuts }], horsOperation }.
export function grouperParOperation(operations = [], chantiers = []) {
  const parOperation = new Map();
  (operations || []).forEach((o) => {
    if (o && o.id) parOperation.set(o.id, []);
  });

  const horsOperation = [];
  (chantiers || []).forEach((c) => {
    if (!c) return;
    const lien = c.operation_id || "";
    if (lien && parOperation.has(lien)) parOperation.get(lien).push(c);
    else horsOperation.push(c);
  });

  const groupes = (operations || [])
    .filter((o) => o && o.id && parOperation.get(o.id).length > 0)
    .map((o) => {
      const liste = parOperation.get(o.id);
      return { ...o, chantiers: liste, statuts: compterStatuts(liste) };
    });

  return { operations: groupes, horsOperation };
}
