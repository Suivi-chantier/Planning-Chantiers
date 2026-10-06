// ─────────────────────────────────────────────────────────────────────────────
// Validation — lignes d'un rapport, en module PUR (façade lignesValidation.js).
//
// Sorti de Validation.jsx pour que scripts/verif-compte-rendu-v2.mjs exécute le
// VRAI chemin rapport → lignes de validation → pointages, et prouve qu'une
// même journée saisie dans l'ancien formulaire ou dans le v2 donne les mêmes
// pointages. Le mapping des champs historiques est repris À L'IDENTIQUE ; les
// champs du formulaire v2 (bloque, motif, motif_depassement, heures_prevues,
// depassement) sont simplement transportés pour l'affichage.
// ─────────────────────────────────────────────────────────────────────────────

// rapport.taches[] → lignes éditables de la modale de validation.
export function lignesDepuisRapport(rapport) {
  return (rapport?.taches || []).map((t, i) => ({
    rowId: `o${i}`,
    origineIdx: i,
    _origine: true,
    tache_id: t.tache_id || null,
    phase_id: t.phase_id || null,
    planifie: t.planifie || "",
    heures: parseFloat(t.heures_reelles) || 0,
    heures_origine: parseFloat(t.heures_reelles) || 0,
    statut: t.statut || null,
    avancement_declare: t.avancement != null ? parseInt(t.avancement) : null,
    avancement_arbitre: t.avancement != null ? parseInt(t.avancement) : "",  // pré-rempli avec déclaré
    remarque: t.remarque || "",
    photos: t.photos || [],
    bascules: Array.isArray(t.bascules) ? t.bascules : [],
    bascule_depuis: t.bascule_depuis || null,
    _autoMatched: false,
    // ── Formulaire v2 (affichage seulement : n'entrent pas dans les pointages)
    bloque: t.bloque === true,
    motif: t.motif || null,
    motif_depassement: t.motif_depassement || null,
    heures_prevues: t.heures_prevues ?? null,
    depassement: t.depassement || null,
  }));
}

// Lignes de la modale → entrée « taskLines » de buildPointagesRapport.
export const taskLinesPourPointages = (lignes) => (lignes || []).map(li => ({
  tache_id: li.tache_id || null,
  phase_id: li.phase_id || null,
  heures: li.heures,
  avancement_declare: li.avancement_declare,
}));

// Le relevé « X h sur Y h vendues » enregistré à la saisie ne vaut que pour
// la tâche et les heures que l'ouvrier a déclarées. Dès que le conducteur
// réaffecte la ligne à une autre tâche, la découpe en deux ou change ses
// heures, il ne correspond plus : on ne l'affiche pas (jamais un dépassement
// faux). Le MOTIF choisi par l'ouvrier, lui, reste affiché.
export function depassementAffichable(ligne) {
  const d = ligne?.depassement;
  if (!d || !ligne.motif_depassement) return null;
  if (!ligne._origine) return null;                                   // moitié créée par un découpage
  if (String(d.tache_id ?? "") !== String(ligne.tache_id ?? "")) return null; // réaffectée
  if (Math.abs((parseFloat(ligne.heures) || 0) - (parseFloat(ligne.heures_origine) || 0)) > 0.001) return null;
  return d;
}

// Découpage d'une ligne en deux moitiés : le relevé de dépassement est retiré
// des deux (les heures ne sont plus celles déclarées) ; le motif est conservé.
export function decouperLigne(src, nouvelId) {
  const moitie = (parseFloat(src.heures) || 0) / 2;
  const nouvelle = { ...src, rowId: nouvelId, _origine: false, heures: moitie, depassement: null };
  const modif = { ...src, heures: moitie, depassement: null };
  return [modif, nouvelle];
}

// Ligne créée sur le rapport du chantier cible lors d'une bascule d'heures.
// Les champs du formulaire v2 suivent (statut choisi, motifs), sauf le relevé
// de dépassement, qui ne vaut plus sur un autre chantier.
export function ligneBasculee(ligne, { heures, rapport, valideur, le }) {
  return {
    planifie: ligne.planifie || "",
    tache_id: null, phase_id: null,           // à rattacher au plan du chantier cible à sa validation
    statut: ligne.statut || "non_faite",
    remarque: ligne.remarque || "",
    heures_reelles: heures,
    avancement: ligne.avancement_declare != null ? ligne.avancement_declare : 0,
    photos: [],
    ...(ligne.bloque ? { bloque: true } : {}),
    ...(ligne.motif ? { motif: ligne.motif } : {}),
    ...(ligne.motif_depassement ? { motif_depassement: ligne.motif_depassement } : {}),
    bascule_depuis: {
      rapport_id: rapport.id, chantier_id: rapport.chantier_id,
      chantier_nom: rapport.chantier_nom || null, heures, par: valideur, le,
    },
  };
}
