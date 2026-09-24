// Projection d'une sortie du moteur actuel vers le format de la référence figée.
// Pour l'instant : aucune différence attendue, la sortie est rendue telle quelle.
export function projeterSortieVersReference(sortie) {
  return sortie;
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
