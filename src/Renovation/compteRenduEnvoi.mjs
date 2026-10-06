// ─────────────────────────────────────────────────────────────────────────────
// Compte rendu du soir — SOCLE COMMUN aux deux formulaires (ancien et bêta v2).
//
// Module PUR (aucun accès Supabase, aucune horloge). Façade : compteRenduEnvoi.js.
// Tout ce qui décide du CONTENU d'un rapport vit ici, une seule fois :
//   - quelles tâches partent (filtrerTachesRemplies) ;
//   - le total de la journée (totalJournee) — le MÊME pour le compteur affiché
//     et pour le contrôle à l'envoi ;
//   - le regroupement en un rapport par chantier et l'écriture des lignes.
// Les écritures en base (insert, nouvelle tentative, vérification finale)
// restent dans RapportMobile.soumettre, communes aux deux variantes.
//
// ⚠️ NON-RÉGRESSION : serialiserLigneV1 et construireRapports reproduisent À
// L'IDENTIQUE le code qui vivait dans RapportMobile.soumettre (jusqu'au
// 06/10/2026). scripts/verif-compte-rendu-v2.mjs compare leur sortie à une
// copie figée de cet ancien code.
// ─────────────────────────────────────────────────────────────────────────────

// Tâche « À reprendre » jamais touchée (voir RapportMobile) — elle n'est ni
// gardée à la reprise d'un brouillon ni envoyée. Une ligne qui porte un motif
// ou le drapeau Bloqué (formulaire v2) a été touchée.
export const aReprendreIntacte = (t) => t.aReprendre && !t.statut
  && !String(t.heures_reelles ?? "").trim() && !t.remarque?.trim()
  && (t.avancement === undefined || t.avancement === null || t.avancement === "")
  && !t.motif && !t.bloque;

// Les tâches qui partent : un intitulé, et pas une « À reprendre » intacte.
export const filtrerTachesRemplies = (taches) =>
  (taches || []).filter(t => String(t.planifie ?? "").trim() && !aReprendreIntacte(t));

// Heures indirectes complètes (motif + heures > 0) — les seules envoyées.
export const filtrerIndirectesRemplies = (heuresIndirectes) =>
  (heuresIndirectes || []).filter(h => (h.motif || "").trim() && (parseFloat(h.heures) || 0) > 0);

// Lignes commencées mais incomplètes (motif sans heures, heures sans motif, ou
// sans chantier) : l'envoi est refusé tant qu'elles existent.
export const filtrerIndirectesInvalides = (heuresIndirectes) =>
  (heuresIndirectes || []).filter(h =>
    ((h.motif || "").trim() || (parseFloat(h.heures) || 0) > 0)
    && (!(h.motif || "").trim() || !((parseFloat(h.heures) || 0) > 0) || !h.chantier_id));

// Total de la journée = tâches envoyées + trajets + heures indirectes envoyées.
// C'est EXACTEMENT ce que contrôle l'envoi (cible du jour) ; le compteur
// affiché l'utilise aussi, pour ne plus jamais afficher un autre total.
export function totalJournee({ taches, trajetMatin, trajetSoir, heuresIndirectes }) {
  const tachesH = filtrerTachesRemplies(taches).reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0);
  const indirectesH = filtrerIndirectesRemplies(heuresIndirectes).reduce((s, h) => s + (parseFloat(h.heures) || 0), 0);
  const trajetMin = (parseInt(trajetMatin) || 0) + (parseInt(trajetSoir) || 0);
  return { tachesH, indirectesH, trajetMin, totalH: tachesH + trajetMin / 60 + indirectesH };
}

// Écart à la cible au centième d'heure près (même tolérance qu'avant).
export const cibleAtteinte = (totalH, cibleHeures) => Math.abs(totalH - cibleHeures) <= 0.01;

// Une ligne telle que l'ANCIEN formulaire l'écrit dans rapports.taches.
export function serialiserLigneV1(t) {
  return {
    planifie: t.planifie,
    tache_id: t.tache_id || null,
    phase_id: t.phase_id || null,
    statut: t.statut || "non_faite",
    remarque: t.remarque,
    heures_reelles: parseFloat(t.heures_reelles) || 0,
    avancement: parseInt(t.avancement) || 0,
    photos: t.photos || [],
  };
}

// Regroupe les tâches et heures indirectes en UN rapport par chantier, dans
// l'ordre d'apparition, et construit chaque rapport prêt pour l'insert.
//   serialiser : serialiserLigneV1 (ancien) ou serialiserLigneV2 (bêta)
//   extra      : colonnes ajoutées au rapport (v2 : formulaire_version,
//                saisie_debut_le) — {} pour l'ancien formulaire.
export function construireRapports({
  taches, heuresIndirectes, planData, serialiser = serialiserLigneV1,
  ouvrier, dateKey, weekId, remarque, photosChantier, trajetMatin, trajetSoir, extra = {},
}) {
  const tachesRemplies = filtrerTachesRemplies(taches);
  const indirectesRemplies = filtrerIndirectesRemplies(heuresIndirectes);
  const parChantier = {};
  tachesRemplies.forEach(t => {
    const k = t.chantier_id || "divers";
    if (!parChantier[k]) parChantier[k] = { chantier_id: t.chantier_id, chantier_nom: t.chantier_nom || "Divers", taches: [], heures_indirectes: [] };
    parChantier[k].taches.push(serialiser(t));
  });
  indirectesRemplies.forEach(h => {
    const k = h.chantier_id || "divers";
    if (!parChantier[k]) {
      const ch = planData?.chantiersData?.find(c => c.id === h.chantier_id);
      parChantier[k] = { chantier_id: h.chantier_id, chantier_nom: ch?.nom || h.chantier_id || "Divers", taches: [], heures_indirectes: [] };
    }
    parChantier[k].heures_indirectes.push({
      motif: (h.motif || "").trim(),
      heures: parseFloat(h.heures) || 0,
    });
  });
  return Object.keys(parChantier).map(k => {
    const grp = parChantier[k];
    return {
      ouvrier: String(ouvrier ?? "").trim(),
      chantier_id: grp.chantier_id,
      chantier_nom: grp.chantier_nom,
      date_rapport: dateKey,
      semaine: weekId,
      taches: grp.taches,
      heures_indirectes: grp.heures_indirectes || [],
      remarque,
      photos_chantier: (photosChantier || {})[grp.chantier_id] || [],
      trajet_matin_min: parseInt(trajetMatin) || 0,
      trajet_soir_min: parseInt(trajetSoir) || 0,
      ...extra,
    };
  });
}

// Colonnes du rapport qu'on peut retirer si la base ne les connaît pas encore
// (code 42703) — l'envoi passe quand même, sans elles.
export const COLONNES_FACULTATIVES = Object.freeze([
  "trajet_matin_min", "trajet_soir_min", "photos_chantier", "heures_indirectes",
  "formulaire_version", "saisie_debut_le",
]);
