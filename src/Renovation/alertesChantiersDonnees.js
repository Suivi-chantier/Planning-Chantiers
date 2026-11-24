// Lecture des données de la page Alertes, partagée avec le bloc « Tournée des
// chantiers » du tableau de bord du jour (projet organisation-par-jour,
// tâche 10). Ce n'est PAS un module pur : il lit l'horloge de l'appareil et la
// base. Le calcul reste dans alertesEcranV1.mjs (calculerAlertesEcranV1).
//
// Semaines comparées : la semaine ISO courante de l'appareil et la précédente
// (semainesAlertesV1), comme le Bilan Semaine et le serveur des notifications.
// Correction (24/11/2026) : la page passait l'objet { year, week } rendu par
// getCurrentWeek() comme numéro de semaine (« 2026-W[object Object] ») ; la
// période de lecture valait alors { debut: null, fin: null } et la lecture des
// relevés échouait (« Le relevé n'a pas pu être lu »). La semaine est
// maintenant lue comme dans les autres pages (Retours du terrain, Bilan).
//
// Relevés : chantier_releves_journaliers, du dimanche de la semaine précédente
// moins 27 jours au dimanche de la semaine courante (periodeRelevesAlertesV1),
// lecture allégée des seuls relevés retenus (chargerRelevesRetenusV2).
// Rend { data, error } comme Supabase.
import { getCurrentWeek, getWeekId } from "../constants";
import { semainesAlertesV1, periodeRelevesAlertesV1 } from "./alertesEcranV1.js";
import { chargerRelevesRetenusV2 } from "./chargerRelevesAlertes";

/** [semaine courante, semaine précédente] selon l'horloge de l'appareil. */
export function semainesAlertesCourantes() {
  const { year, week } = getCurrentWeek();
  return semainesAlertesV1(getWeekId(year, week));
}

/** Relevés journaliers retenus pour ces semaines ({ data, error }). */
export async function chargerRelevesAlertesSemaines(semaines) {
  const { debut, fin } = periodeRelevesAlertesV1(semaines);
  return chargerRelevesRetenusV2({ debut, fin, weekIds: semaines });
}
