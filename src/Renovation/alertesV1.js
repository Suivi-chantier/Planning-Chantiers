// Façade front du moteur d'alertes (chantier 09).
// L'implémentation vit dans alertesV1.mjs (extension .mjs = parsable ESM par
// Node sans build, pour le script de vérification et un futur cron).
// Les écrans importent CE fichier : src/Renovation/alertesV1.js.
export * from "./alertesV1.mjs";
