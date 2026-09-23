// Façade front du module « Points d'attention » du Bilan Semaine (chantier 07).
// L'implémentation vit dans pointsAttentionV1.mjs (extension .mjs = parsable
// ESM par Node sans build, pour les tests et les crons /api via
// `await import()`). Le front importe CE fichier :
// src/Renovation/pointsAttentionV1.js.
export * from "./pointsAttentionV1.mjs";
