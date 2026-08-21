// scripts/verif-portees-invest.mjs — Identifiants référencés hors de leur portée.
//
// Pourquoi ce script existe : QUATRE fois pendant la remise à niveau, du code a
// été déployé avec un identifiant qui n'existait pas au moment du rendu.
// `vite build` est passé les quatre fois sans un mot, et l'application levait
// un ReferenceError au premier affichage du composant — donc en production, sur
// l'écran de quelqu'un.
//
//   useRef        manquant dans les imports de Dashboard.jsx
//   supabase      manquant dans Urbanisme.jsx
//   Landmark      manquant dans les imports lucide de Biens.jsx
//   biensStock    déclaré dans FicheFDU, utilisé dans OngletDemande — deux
//                 composants de premier niveau, aucune fermeture lexicale.
//                 « biensStock is not defined », onglet Urbanisme inutilisable.
//
// verif-imports-invest.mjs ne compare qu'une liste fermée de noms connus : il a
// attrapé les trois premiers, pas le quatrième. Une variable hors portée demande
// une vraie analyse de portées, pas une liste.
//
// Méthode : @babel/parser lit le JSX, @babel/traverse construit les portées.
// Pour chaque référence, on demande à Babel si le binding existe. Les deux
// paquets sont déjà présents (dépendances de @vitejs/plugin-react) — aucune
// installation.
//
// Usage :  node scripts/verif-portees.mjs [fichier…]
//          sans argument : tout src/, récursivement.
//
// Le balayage complet vaut la peine : lancé sur src/ entier la première fois,
// il n'a laissé qu'un seul faux positif — un global navigateur absent de la
// liste. Le reste du code était sain, ce qui rend les vrais signalements
// crédibles.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const traverseMod = require("@babel/traverse");
const traverse = traverseMod.default || traverseMod;

// Globaux du navigateur et du langage. Une omission ici produit un faux
// positif, et un contrôle qui crie au loup finit ignoré — la liste est donc
// large, quitte à laisser passer un vrai global mal orthographié.
const GLOBAUX = new Set([
  "window", "document", "navigator", "location", "history", "console", "fetch",
  "localStorage", "sessionStorage", "indexedDB", "caches", "crypto",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "requestAnimationFrame", "cancelAnimationFrame", "queueMicrotask",
  "Promise", "Array", "Object", "String", "Number", "Boolean", "Math", "JSON",
  "Date", "RegExp", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "BigInt",
  "Error", "TypeError", "RangeError", "SyntaxError", "Intl", "Proxy", "Reflect",
  "isNaN", "isFinite", "parseInt", "parseFloat", "encodeURIComponent",
  "decodeURIComponent", "encodeURI", "decodeURI", "structuredClone",
  "Blob", "File", "FileReader", "FormData", "Image", "URL", "URLSearchParams",
  "Headers", "Request", "Response", "AbortController", "TextEncoder",
  "TextDecoder", "atob", "btoa", "alert", "confirm", "prompt", "print",
  "Event", "CustomEvent", "MutationObserver", "IntersectionObserver",
  "ResizeObserver", "getComputedStyle", "matchMedia", "Node", "Element",
  "HTMLElement", "CanvasRenderingContext2D", "DOMParser", "XMLHttpRequest",
  "globalThis", "process", "Uint8Array", "ArrayBuffer", "DataView", "Infinity",
  "NaN", "undefined", "arguments", "eval", "module", "require", "exports",
  "performance", "screen", "open", "close", "scrollTo", "getSelection",
  "Function", "reportError", "AbortSignal", "createImageBitmap",
  "OffscreenCanvas", "ImageData", "MediaQueryList", "Notification", "WebSocket",
  "IntersectionObserverEntry", "ClipboardItem", "BroadcastChannel", "Worker",
]);

function parcourir(dossier) {
  const sorties = [];
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, e.name);
    if (e.isDirectory()) sorties.push(...parcourir(chemin));
    else if (/\.(jsx|js|mjs)$/.test(e.name)) sorties.push(chemin);
  }
  return sorties.sort();
}

const cibles = process.argv.slice(2).length ? process.argv.slice(2) : parcourir("src");

let problemes = 0;
let analyses = 0;

for (const chemin of cibles) {
  let ast;
  try {
    ast = parser.parse(readFileSync(chemin, "utf8"), {
      sourceType: "module",
      plugins: ["jsx", "classProperties", "optionalChaining", "nullishCoalescingOperator", "logicalAssignment"],
      errorRecovery: true,
    });
  } catch (e) {
    console.log(`  ⚠ ${chemin} : non analysable — ${e.message.split("\n")[0]}`);
    continue;
  }
  analyses++;

  // Un même nom peut manquer à plusieurs endroits : on regroupe par nom pour ne
  // pas noyer le rapport, en gardant la première ligne comme repère.
  const manquants = new Map();

  traverse(ast, {
    ReferencedIdentifier(chemin_) {
      const nom = chemin_.node.name;
      if (GLOBAUX.has(nom)) return;
      // Babel tranche : le nom est-il lié dans une portée englobante ?
      // noGlobals=true, sinon tout nom non lié passerait pour un global.
      if (chemin_.scope.hasBinding(nom, /* noGlobals */ true)) return;
      if (!manquants.has(nom)) {
        manquants.set(nom, { ligne: chemin_.node.loc?.start.line ?? 0, nb: 0 });
      }
      manquants.get(nom).nb++;
    },
  });

  for (const [nom, info] of [...manquants].sort((a, b) => a[1].ligne - b[1].ligne)) {
    console.log(`  ✗ ${chemin}:${info.ligne} — « ${nom} » référencé mais non déclaré`
      + (info.nb > 1 ? `  (${info.nb} occurrences)` : ""));
    problemes++;
  }
}

console.log("\n" + "═".repeat(66));
console.log(problemes === 0
  ? `✓ ${analyses} fichiers analysés, aucun identifiant hors portée.`
  : `✗ ${problemes} identifiant(s) hors portée — ReferenceError au rendu.`);
process.exit(problemes === 0 ? 0 : 1);
