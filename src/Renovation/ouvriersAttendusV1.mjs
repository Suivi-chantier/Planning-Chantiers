// src/Renovation/ouvriersAttendusV1.mjs — « Ouvriers attendus un jour donné ».
//
// Module PUR (aucun accès Supabase, aucune horloge, aucun effet de bord).
// Règle DÉPLACÉE telle quelle depuis api/_cron/cron-rappel-rapport.js (projet
// docs/projets/notifications-push.md, tâche 4), sans réécriture :
//
//   un ouvrier est ATTENDU un jour donné s'il figure dans au moins une case
//   du planning (planning_cells) de ce jour qui porte une tâche (taches non
//   vide, ou texte « planifié » non vide). Les autres ouvriers ne sont pas
//   attendus (pas de rappel, pas de « manquant »).
//
// Partagé par :
//   - le mail de rappel du compte rendu (cron-rappel-rapport.js), inchangé ;
//   - le point du soir des conducteurs (cron-point-conducteurs.js, C1).
//
// Jours fériés : la règle du rappel n'en gère aucun (un jour férié ouvré est
// traité comme un autre jour ; en pratique, aucune tâche planifiée = personne
// d'attendu). On garde exactement la même règle.

/** Jours du planning (planning_cells.jour), du lundi au vendredi. */
export const JOURS_PLANNING = Object.freeze([null, "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", null]);

/**
 * Identifiant de semaine du planning (« 2026-W45 ») d'une date civile
 * « AAAA-MM-JJ ». Même calcul que l'ancien currentWeekIdParis() du rappel
 * (déplacé ici : seule la date arrive en paramètre au lieu d'être lue sur
 * l'horloge).
 */
export function semaineDuJour(dateIso) {
  const [y, m, d] = String(dateIso).split("-").map(Number);
  // Reconstitue une Date "midi" pour éviter les bascules de jour
  const local = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const jan1  = new Date(Date.UTC(y, 0, 1, 12, 0, 0));
  const dayOfYear = Math.floor((local - jan1) / 86400000) + 1;
  const w = Math.ceil((dayOfYear + jan1.getUTCDay()) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

/** « AAAA-MM-JJ » → « Lundi »… « Vendredi », ou null le week-end. */
export function jourPlanning(dateIso) {
  const [y, m, d] = String(dateIso).split("-").map(Number);
  return JOURS_PLANNING[new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()] ?? null;
}

/** « AAAA-MM-JJ » → « JJ/MM/AAAA » (format de rapports.date_rapport). */
export function dateFrDepuisIso(dateIso) {
  const [y, m, d] = String(dateIso).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Ouvriers attendus : ceux qui ont au moins une tâche dans une case du jour.
 * @param {Array<{ ouvriers?: string[], taches?: any[], planifie?: string }>} cells
 *   cases de planning_cells pour (week_id, jour)
 * @returns {Set<string>} prénoms
 */
export function ouvriersAttendus(cells) {
  const assignes = new Set();
  (cells || []).forEach(cell => {
    const aUneTache = (cell.taches && cell.taches.length > 0)
      || (cell.planifie && cell.planifie.trim().length > 0);
    if (!aUneTache) return;
    (cell.ouvriers || []).forEach(nom => { if (nom) assignes.add(nom); });
  });
  return assignes;
}
