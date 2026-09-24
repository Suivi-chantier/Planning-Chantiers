// Façade front du suivi des points d'attention (chantier 07). L'implémentation
// vit dans suiviPointsAttentionV1.mjs (extension .mjs = parsable ESM par Node
// sans build, pour les tests et les crons /api via `await import()`). Le front
// importe CE fichier : src/Renovation/suiviPointsAttentionV1.js.
export * from "./suiviPointsAttentionV1.mjs";
