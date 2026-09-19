// Façade front de la résolution « facture ProGBat → chantier ».
// L'implémentation vit dans progbatLiaison.mjs (extension .mjs = parsable ESM
// par Node sans build, pour les tests et le serveur). Le front importe CE
// fichier : src/Renovation/progbatLiaison.js.
export * from "./progbatLiaison.mjs";
