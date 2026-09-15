#!/usr/bin/env node
// Copie les modules purs partagés dans le dossier `lib/` des Edge Functions
// ProGBat (inventaire, synchronisation, devis). Les Edge Functions ne
// peuvent pas importer hors de leur dossier : la copie est la seule façon de
// réutiliser la source unique des règles de prix (chiffragePricing.mjs), de
// code (codeOuvrage.mjs) et du générateur de devis (progbatQuotePayload.mjs).
//   node scripts/sync-progbat-edge-lib.mjs          → copie
//   node scripts/sync-progbat-edge-lib.mjs --check  → échoue si une copie diverge
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(racine, "src", "Renovation");
const FONCTIONS = join(racine, "supabase", "functions");
// Une entrée par Edge Function : fichiers purs à copier dans son dossier lib/.
export const CIBLES = Object.freeze({
  "progbat-library-inventory": ["codeOuvrage.mjs", "chiffragePricing.mjs", "progbatInventaire.mjs"],
  "progbat-library-sync": ["codeOuvrage.mjs", "chiffragePricing.mjs", "progbatInventaire.mjs", "progbatLibrarySync.mjs"],
  "progbat-library-categories": ["codeOuvrage.mjs", "chiffragePricing.mjs", "progbatInventaire.mjs", "progbatCategoryDispatch.mjs"],
  "progbat-quote": ["codeOuvrage.mjs", "chiffragePricing.mjs", "progbatQuotePayload.mjs", "progbatQuoteServeur.mjs"],
});
// Compatibilité : liste plate des fichiers de la première cible (anciens scripts).
export const FICHIERS = CIBLES["progbat-library-inventory"];

const BANNIERE = "// COPIE GÉNÉRÉE — ne pas éditer ici. Source : src/Renovation/%s (node scripts/sync-progbat-edge-lib.mjs)\n";

export function contenuAttendu(nom) {
  return BANNIERE.replace("%s", nom) + readFileSync(join(SRC, nom), "utf8");
}

/** Copies divergentes ou absentes, sous la forme « fonction/lib/fichier ». */
export function verifierCopies() {
  const divergents = [];
  for (const [fn, fichiers] of Object.entries(CIBLES)) {
    for (const nom of fichiers) {
      let actuel = null;
      try { actuel = readFileSync(join(FONCTIONS, fn, "lib", nom), "utf8"); } catch { /* absent */ }
      if (actuel !== contenuAttendu(nom)) divergents.push(`${fn}/lib/${nom}`);
    }
  }
  return divergents;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--check")) {
    const d = verifierCopies();
    if (d.length) { console.error("Copies divergentes : " + d.join(", ") + " → node scripts/sync-progbat-edge-lib.mjs"); process.exit(1); }
    console.log("sync-progbat-edge-lib : copies à jour");
  } else {
    let n = 0;
    for (const [fn, fichiers] of Object.entries(CIBLES)) {
      const dest = join(FONCTIONS, fn, "lib");
      mkdirSync(dest, { recursive: true });
      for (const nom of fichiers) { writeFileSync(join(dest, nom), contenuAttendu(nom), "utf8"); n++; }
    }
    console.log("sync-progbat-edge-lib : " + n + " fichiers copiés dans " + Object.keys(CIBLES).map(f => f + "/lib").join(", "));
  }
}
