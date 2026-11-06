// Avancement pondéré d'un phasage (repli V1 legacy : tâches de plan_travaux).
// Module PUR (aucun accès base, aucune horloge), déplacé tel quel depuis
// src/constants.js, qui le réexporte. Extension .mjs = importable par Node
// (job serveur api/_cron/cron-factures-a-emettre.js, scripts verif-*).

// Avancement global d'un phasage pondéré par valeur facturable (prix HT).
// On regroupe les tâches par ouvrage (via t.ouvrage_id), on calcule l'avancement
// de chaque groupe (pondéré par heures_estimees, sinon moyenne simple), puis on
// pondère les groupes par leur prix_ht ouvrage. Cascade de fallbacks pour rester
// robuste si certaines données manquent :
//   prix_ht ouvrage → heures_devis ouvrage → Σ prix_ht tâches →
//   Σ heures_vendues tâches → Σ heures_estimees tâches → nombre de tâches.
export function calcAvancementPondere(ouvrages, allTaches) {
  if (!Array.isArray(allTaches) || allTaches.length === 0) return 0;
  // Grouper les tâches par ouvrage_id (les sans-rattachement vont sous "")
  const groupes = new Map();
  allTaches.forEach(t => {
    const k = t?.ouvrage_id || "";
    if (!groupes.has(k)) groupes.set(k, []);
    groupes.get(k).push(t);
  });
  let sumPondere = 0, sumPoids = 0;
  groupes.forEach((taches, ouvrageId) => {
    if (taches.length === 0) return;
    // Avancement du groupe : pondéré par heures_estimees, sinon moyenne simple
    const totalHE = taches.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);
    const av = totalHE > 0
      ? taches.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_estimees) || 0)), 0) / totalHE
      : taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / taches.length;
    // Poids du groupe : cascade prix_ht → heures_devis → prix_ht tâches → heures_vendues → heures_estimees → comptage
    const ouv = ouvrageId ? (ouvrages || []).find(o => o?.id === ouvrageId) : null;
    let poids = parseFloat(ouv?.prix_ht) || 0;
    if (!poids) poids = parseFloat(ouv?.heures_devis) || 0;
    if (!poids) poids = taches.reduce((s, t) => s + (parseFloat(t.prix_ht) || 0), 0);
    if (!poids) poids = taches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
    if (!poids) poids = totalHE;
    if (!poids) poids = taches.length;
    sumPondere += av * poids;
    sumPoids   += poids;
  });
  if (sumPoids === 0) return 0;
  return Math.round(sumPondere / sumPoids);
}
