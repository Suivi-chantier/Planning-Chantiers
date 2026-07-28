// Façade front du référentiel du cycle de vie chantier. L'implémentation vit
// dans cycleVie.mjs (extension .mjs = parsable ESM par Node sans build, pour
// les tests et les crons /api via `await import()`). Le front importe CE
// fichier : src/Renovation/cycleVie.js.
export * from "./cycleVie.mjs";
