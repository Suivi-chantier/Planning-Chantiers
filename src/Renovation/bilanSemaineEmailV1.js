// Façade front du résumé e-mail du Bilan Semaine (chantier 07).
// L'implémentation vit dans bilanSemaineEmailV1.mjs (extension .mjs = parsable
// ESM par Node sans build, pour les tests et les crons /api via
// `await import()`). Le front importe CE fichier :
// src/Renovation/bilanSemaineEmailV1.js.
export * from "./bilanSemaineEmailV1.mjs";
