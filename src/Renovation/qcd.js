// Façade front du module QCD. L'implémentation vit dans qcd.mjs (extension
// .mjs = parsable ESM par Node sans build, pour les tests et les crons /api
// via `await import()`). Le front importe CE fichier : src/Renovation/qcd.js.
export * from "./qcd.mjs";
