// Façade front de la préparation des relevés hebdomadaires (chantier 07).
// L'implémentation vit dans pointsAttentionDonneesV1.mjs (extension .mjs =
// parsable ESM par Node sans build, pour les tests et les crons /api via
// `await import()`). Le front importe CE fichier :
// src/Renovation/pointsAttentionDonneesV1.js.
export * from "./pointsAttentionDonneesV1.mjs";
