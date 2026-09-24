// Redirige le moteur vers l'enveloppe de comparaison (sauf l'import « ?reel »
// fait par l'enveloppe elle-même pour atteindre le vrai moteur).
const ENVELOPPE = new URL("./enveloppe.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  const resolu = await nextResolve(specifier, context);
  const url = new URL(resolu.url);
  if (url.protocol === "file:"
      && url.pathname.endsWith("/src/Renovation/planningEngineV1.js")
      && !url.search.includes("reel")) {
    return { ...resolu, url: ENVELOPPE, shortCircuit: true };
  }
  return resolu;
}
