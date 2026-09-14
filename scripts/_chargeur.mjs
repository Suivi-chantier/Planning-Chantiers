// scripts/_chargeur.mjs — charge un module source de src/ dans Node sans build.
//
// Le dépôt n'a pas "type": "module" : un fichier .js avec `export` n'est pas
// importable directement par Node. Les scripts de vérification lisaient donc
// la source et l'importaient via une data-URL. Cela ne marche que pour un
// module SANS import relatif (une data-URL n'a pas de base de résolution).
//
// Ce chargeur généralise l'astuce : les imports relatifs de la source sont
// réécrits en URL absolues — `file://` pour les .mjs (Node les charge tels
// quels), data-URL récursive pour les .js. Aucun changement de configuration
// ESM du projet n'est nécessaire.
import { readFile } from "node:fs/promises";

const RE_IMPORT = /(?:from\s*|import\s*\(\s*|import\s+)(["'])((?:\.{1,2}\/)[^"']+)\1/g;

async function sourceVersDataUrl(fileUrl, cache) {
  const key = fileUrl.href;
  if (cache.has(key)) return cache.get(key);
  let src = await readFile(fileUrl, "utf8");
  const specs = [...new Set([...src.matchAll(RE_IMPORT)].map(m => m[2]))];
  for (const spec of specs) {
    const cible = new URL(spec, fileUrl);
    const remplacement = cible.pathname.endsWith(".mjs") ? cible.href : await sourceVersDataUrl(cible, cache);
    src = src.split(`"${spec}"`).join(JSON.stringify(remplacement)).split(`'${spec}'`).join(JSON.stringify(remplacement));
  }
  const dataUrl = `data:text/javascript;base64,${Buffer.from(src).toString("base64")}`;
  cache.set(key, dataUrl);
  return dataUrl;
}

/**
 * @param {string} relatif  chemin relatif au script appelant (ex : "../src/Renovation/planningModelV1.js")
 * @param {string} importMetaUrl  `import.meta.url` du script appelant
 */
export async function chargerModuleSource(relatif, importMetaUrl) {
  const url = new URL(relatif, importMetaUrl);
  if (url.pathname.endsWith(".mjs")) return import(url.href);
  return import(await sourceVersDataUrl(url, new Map()));
}
