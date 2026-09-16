// Façade front du module de facturation client. L'implémentation vit dans
// facturationClient.mjs (extension .mjs = parsable ESM par Node sans build,
// pour les tests et les routes /api via `await import()`). Le front importe
// CE fichier : src/Renovation/facturationClient.js.
export * from "./facturationClient.mjs";
