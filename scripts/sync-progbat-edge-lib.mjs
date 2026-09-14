#!/usr/bin/env node
// Copie les modules purs partagés dans le dossier `lib/` de l'Edge Function
// progbat-library-inventory. Les Edge Functions ne peuvent pas importer hors
// de leur dossier : la copie est la seule façon de réutiliser la source unique
// des règles de prix (chiffragePricing.mjs) et de code (codeOuvrage.mjs).
//   node scripts/sync-progbat-edge-lib.mjs          → copie
//   node scripts/sync-progbat-edge-lib.mjs --check  → échoue si une copie diverge
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(racine, "src", "Renovation");
const DEST = join(racine, "supabase", "functions", "progbat-library-inventory", "lib");
export const FICHIERS = ["codeOuvrage.mjs", "chiffragePricing.mjs", "progbatInventaire.mjs"];

const BANNIERE = "// COPIE GÉNÉRÉE — ne pas éditer ici. Source : src/Renovation/%s (node scripts/sync-progbat-edge-lib.mjs)\n";

export function contenuAttendu(nom) {
  return BANNIERE.replace("%s", nom) + readFileSync(join(SRC, nom), "utf8");
}

export function verifierCopies() {
  const divergents = [];
  for (const nom of FICHIERS) {
    let actuel = null;
    try { actuel = readFileSync(join(DEST, nom), "utf8"); } catch { /* absent */ }
    if (actuel !== contenuAttendu(nom)) divergents.push(nom);
  }
  return divergents;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--check")) {
    const d = verifierCopies();
    if (d.length) { console.error("Copies divergentes : " + d.join(", ") + " → node scripts/sync-progbat-edge-lib.mjs"); process.exit(1); }
    console.log("sync-progbat-edge-lib : copies à jour");
  } else {
    mkdirSync(DEST, { recursive: true });
    for (const nom of FICHIERS) writeFileSync(join(DEST, nom), contenuAttendu(nom), "utf8");
    console.log("sync-progbat-edge-lib : " + FICHIERS.length + " fichiers copiés dans " + DEST);
  }
}
