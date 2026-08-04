// Façade front du module diagramme financier (Point 5). L'implémentation vit
// dans diagrammeFinancier.mjs (extension .mjs = parsable ESM par Node sans
// build, pour les tests et les crons /api via `await import()`). Le front
// importe CE fichier : src/Renovation/diagrammeFinancier.js.
export * from "./diagrammeFinancier.mjs";
