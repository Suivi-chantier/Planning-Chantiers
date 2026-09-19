// ─────────────────────────────────────────────────────────────────────────────
// preparationChantier — règles d'AFFICHAGE de la préparation ouvrière.
//
// Fonctions PURES : aucun réseau, aucun React, aucune horloge. Elles prennent
// le payload de la RPC public.ouvrier_preparation_chantier(text) et décident
// quoi montrer. Couvertes par scripts/verif-preparation-chantier.mjs.
//
// ⚠ CE MODULE NE CALCULE AUCUN AVANCEMENT ET N'ÉCRIT RIEN.
//   Il ne fait pas de moyenne de pourcentages : un « 50 % » obtenu en
//   moyennant des tâches de tailles différentes serait faux et donnerait de
//   fausses certitudes sur le chantier. On s'en tient à un comptage factuel,
//   « tâches terminées / tâches totales ».
//
// ⚠ AUCUNE DONNÉE FINANCIÈRE.
//   La RPC n'en renvoie déjà pas ; clesFinancieres() sert de second filet,
//   utilisable en test comme en garde-fou, au cas où la RPC évoluerait.
// ─────────────────────────────────────────────────────────────────────────────

// Identifiant de la phase synthétique produite par la RPC.
export const PHASE_A_ORGANISER = "_a_organiser";

// États d'une TÂCHE. L'avancement est le seul signal disponible.
export const ETAT_TACHE = {
  a_faire:  { cle: "a_faire",  label: "À faire",   couleur: "#8a9ab0" },
  en_cours: { cle: "en_cours", label: "En cours",  couleur: "#e0a800" },
  terminee: { cle: "terminee", label: "Terminée",  couleur: "#22c55e" },
};

// États d'un OUVRAGE, dérivés de ses tâches DANS LA PHASE affichée.
export const ETAT_OUVRAGE = {
  a_faire:      { cle: "a_faire",      label: "À faire",      couleur: "#8a9ab0" },
  en_cours:     { cle: "en_cours",     label: "En cours",     couleur: "#e0a800" },
  termine:      { cle: "termine",      label: "Terminé",      couleur: "#22c55e" },
  a_organiser:  { cle: "a_organiser",  label: "À organiser",  couleur: "#94a3b8" },
};

// Avancement exploitable d'une tâche, ou null. Une valeur absente, non
// numérique, NaN ou infinie vaut « pas d'information », jamais 0 affiché.
export function avancementTache(tache) {
  const brut = tache?.avancement;
  if (brut === null || brut === undefined || typeof brut === "boolean") return null;
  const n = typeof brut === "number" ? brut : parseFloat(String(brut).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return n;
}

export function etatTache(tache) {
  const a = avancementTache(tache);
  if (a === null || a <= 0) return ETAT_TACHE.a_faire;
  if (a >= 100) return ETAT_TACHE.terminee;
  return ETAT_TACHE.en_cours;
}

// L'avancement chiffré ne s'affiche QUE s'il apporte une information : entre
// 1 et 99. « 0 % » et « 100 % » sont déjà dits par l'état.
export function avancementAffichable(tache) {
  const a = avancementTache(tache);
  if (a === null || a <= 0 || a >= 100) return null;
  return Math.round(a);
}

// Comptage factuel des tâches d'une phase : { total, terminees }.
export function compterTaches(phase) {
  let total = 0, terminees = 0;
  (phase?.ouvrages || []).forEach(o => {
    (o?.taches || []).forEach(t => {
      total += 1;
      if (etatTache(t).cle === "terminee") terminees += 1;
    });
  });
  return { total, terminees };
}

// État d'un ouvrage tel qu'il apparaît DANS UNE phase.
//  - aucune tâche              → À organiser
//  - toutes à 100              → Terminé
//  - au moins une entre 1 et 99→ En cours
//  - toutes à 0 ou sans valeur → À faire
// Cas non prévu par l'énoncé et tranché ici : un mélange de tâches à 0 et de
// tâches à 100, sans aucune en cours, compte comme EN COURS — le travail a
// commencé, l'annoncer « à faire » tromperait l'équipe.
export function etatOuvrage(ouvrage) {
  const taches = ouvrage?.taches || [];
  if (taches.length === 0) return ETAT_OUVRAGE.a_organiser;
  const etats = taches.map(t => etatTache(t).cle);
  if (etats.every(e => e === "terminee")) return ETAT_OUVRAGE.termine;
  if (etats.some(e => e === "en_cours")) return ETAT_OUVRAGE.en_cours;
  if (etats.some(e => e === "terminee")) return ETAT_OUVRAGE.en_cours;
  return ETAT_OUVRAGE.a_faire;
}

// Phases réellement montrables : une phase sans aucun ouvrage n'a rien à
// dire au terrain. Filtrage UNIQUEMENT visuel — la RPC n'est pas touchée, et
// « À organiser » est conservée dès qu'elle porte un ouvrage.
export function phasesVisibles(payload) {
  const phases = Array.isArray(payload?.phases) ? payload.phases : [];
  return phases.filter(p => Array.isArray(p?.ouvrages) && p.ouvrages.length > 0);
}

// Phase dépliée à l'ouverture :
//   1. la première qui contient au moins une tâche non terminée ;
//   2. sinon la première phase visible ;
//   3. sinon null (aucune phase à montrer).
export function phaseParDefaut(payload) {
  const visibles = phasesVisibles(payload);
  if (visibles.length === 0) return null;
  const enCours = visibles.find(p =>
    (p.ouvrages || []).some(o => (o.taches || []).some(t => etatTache(t).cle !== "terminee")));
  return (enCours || visibles[0]).id;
}

// Quantité lisible, ou null si elle n'est pas affichable. Ne renvoie JAMAIS
// « NaN » ni « Infinity » — l'appelant affiche alors son propre libellé
// (« Quantité totale à définir »).
export function formaterQuantite(valeur) {
  if (valeur === null || valeur === undefined || typeof valeur === "boolean") return null;
  const n = typeof valeur === "number" ? valeur : parseFloat(String(valeur).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  // Arrondi à 2 décimales, zéros de fin retirés, virgule décimale française.
  const arrondi = Math.round(n * 100) / 100;
  return String(arrondi).replace(".", ",");
}

// Les cinq (six) états possibles du champ `modele`. Chaque état a son écran :
// aucun ne doit tomber dans un cas par défaut silencieux.
export const ETATS_MODELE = {
  v2: null, // seul cas où la préparation s'affiche
  legacy_v1: {
    titre: "Préparation indisponible",
    texte: "Le phasage de ce chantier utilise une ancienne version. Il doit être repris par le conducteur de travaux.",
    ton: "info",
  },
  vide: {
    titre: "Préparation non renseignée",
    texte: "Aucun ouvrage ni aucune tâche n'est encore défini pour ce chantier.",
    ton: "info",
  },
  absent: {
    titre: "Aucun phasage trouvé",
    texte: "La préparation de ce chantier n'a pas encore été créée.",
    ton: "info",
  },
  ambigu: {
    titre: "Chantier à vérifier",
    texte: "Plusieurs phasages correspondent à ce chantier. Prévenez le conducteur de travaux.",
    ton: "alerte",
  },
};

// Écran à afficher pour un payload. null = afficher la préparation.
// Un `modele` inconnu est traité comme une anomalie, jamais ignoré.
export function ecranModele(payload) {
  const m = payload?.modele;
  if (m === "v2") return null;
  if (Object.prototype.hasOwnProperty.call(ETATS_MODELE, m)) return ETATS_MODELE[m];
  return {
    titre: "Préparation indisponible",
    texte: "Les données de ce chantier n'ont pas pu être interprétées. Prévenez le conducteur de travaux.",
    ton: "alerte",
  };
}

// Second filet : parcourt RÉCURSIVEMENT un payload et renvoie les clés dont
// le nom évoque une donnée financière. Doit toujours renvoyer [].
const MOTIF_FINANCIER = /prix|cout|coût|marge|taux|coefficient|heures|ratio|montant|euro|vendu|tarif|remise/i;
export function clesFinancieres(valeur, vues = new Set()) {
  if (!valeur || typeof valeur !== "object") return [];
  if (Array.isArray(valeur)) return valeur.flatMap(v => clesFinancieres(v, vues));
  const trouvees = [];
  Object.keys(valeur).forEach(k => {
    if (MOTIF_FINANCIER.test(k)) { if (!vues.has(k)) { vues.add(k); trouvees.push(k); } }
    trouvees.push(...clesFinancieres(valeur[k], vues));
  });
  return trouvees;
}
