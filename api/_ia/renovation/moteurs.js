// api/_ia/renovation/moteurs.js — Pont vers les modules de calcul de src/.
//
// L'assistant ne calcule RIEN lui-même. Chaque chiffre qu'il transmet au
// modèle sort d'un module déjà utilisé par l'application :
//   chantierFinance.mjs          → avancement, vendu, marge, heures, reste à faire
//                                  (le module du relevé hebdo et de la fiche chantier)
//   alertesV1.mjs                → tri des alertes, motifs, drapeau de fiabilité
//                                  (le moteur de la page Alertes)
//   pointsAttentionDonneesV1.mjs → dédoublonnage des relevés hebdomadaires
//   avancementDonneesLiees.mjs   → dernière situation ProGBat
//                                  (colonne « Facturé ProGBat » des États financiers)
//   bilanSemaineProchaineV1.mjs  → lundi d'une semaine ISO (nommage des semaines)
//
// Extension .mjs : ces modules sont en ESM et api/ est en CommonJS, d'où
// `await import()` — exactement comme api/cron-snapshot-hebdo.js et
// api/_ia/invest/moteur.js. Chemins littéraux : le traceur de fichiers de
// Vercel les embarque dans la fonction.

let _cache = null;

async function moteurs() {
  if (!_cache) {
    const [finance, alertes, donneesAttention, donneesLiees, semaines] = await Promise.all([
      import("../../../src/chantierFinance.mjs"),
      import("../../../src/Renovation/alertesV1.mjs"),
      import("../../../src/Renovation/pointsAttentionDonneesV1.mjs"),
      import("../../../src/Renovation/avancementDonneesLiees.mjs"),
      import("../../../src/Renovation/bilanSemaineProchaineV1.mjs"),
    ]);
    _cache = { finance, alertes, donneesAttention, donneesLiees, semaines };
  }
  return _cache;
}

module.exports = { moteurs };
