// Projection d'une sortie du moteur actuel vers le format de la référence figée
// (main af75749). On retire UNIQUEMENT ce que le correctif « consignes visibles »
// a AJOUTÉ ; tout le reste (allocations, dates, durées, ressources, scores,
// libellés des raisons, tentatives, traces, résumé) doit être identique.
//
// Champs ajoutés :
// - `contraintes_sans_effet` (racine) ;
// - `non_planifies[].raison_code` et `non_planifies[].consigne_bloquante` ;
// - `allocations_proposees[].exception` (ressource imposée hors équipe) ;
// - `allocations_proposees[].explication.consignes_souhaitees` ;
// - les avertissements des types ci-dessous ;
// - trois drapeaux d'`invariants`.

export const TYPES_AVERTISSEMENTS_AJOUTES = new Set([
  "consigne_sans_effet",
  "consigne_ressource_hors_equipe_non_elargie",
  "consigne_ressource_introuvable",
  "consigne_souhaitee_non_respectee",
]);

const INVARIANTS_AJOUTES = [
  "toute_tache_non_planifiee_a_une_raison",
  "equipe_elargie_uniquement_par_ressource_imposee_ciblee",
  "consigne_sans_effet_toujours_signalee",
];

export function projeterSortieVersReference(sortie) {
  if (!sortie || typeof sortie !== "object") return sortie;
  const { contraintes_sans_effet, ...reste } = sortie;
  const invariants = { ...(reste.invariants || {}) };
  INVARIANTS_AJOUTES.forEach(k => { delete invariants[k]; });
  return {
    ...reste,
    allocations_proposees: (reste.allocations_proposees || []).map(a => {
      const { exception, ...alloc } = a;
      if (!alloc.explication || !("consignes_souhaitees" in alloc.explication)) return alloc;
      const { consignes_souhaitees, ...explication } = alloc.explication;
      return { ...alloc, explication };
    }),
    non_planifies: (reste.non_planifies || []).map(np => {
      const { raison_code, consigne_bloquante, ...ligne } = np;
      return ligne;
    }),
    warnings: (reste.warnings || []).filter(w => !TYPES_AVERTISSEMENTS_AJOUTES.has(w?.type)),
    invariants,
  };
}

export function premierEcart(a, b, chemin = "sortie") {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    return `${chemin} : ${JSON.stringify(a)?.slice(0, 200)} ≠ référence ${JSON.stringify(b)?.slice(0, 200)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${chemin} : tableau / objet`;
  const cles = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const k of cles) {
    if (!(k in a)) return `${chemin}.${k} absent de la sortie actuelle`;
    if (!(k in b)) return `${chemin}.${k} absent de la référence`;
    const e = premierEcart(a[k], b[k], `${chemin}.${k}`);
    if (e) return e;
  }
  return null;
}
