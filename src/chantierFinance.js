// Façade front du module de calcul chantier. L'implémentation vit dans
// chantierFinance.mjs (extension .mjs = parsable ESM par Node sans build,
// pour que les crons /api l'importent via `await import()`). Le front et
// toutes les pages importent CE fichier : src/chantierFinance.js.
export * from "./chantierFinance.mjs";
