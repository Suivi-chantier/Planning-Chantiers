// Lectures de la page « Retours du terrain », sorties du composant telles
// quelles (projet organisation-par-jour, tâche 10) pour que la page et le bloc
// « Tournée des chantiers » du tableau de bord lisent EXACTEMENT les mêmes
// comptes rendus et les mêmes phasages. Ce n'est PAS un module pur (base,
// horloge) ; le calcul reste dans retoursTerrainV1.mjs (retoursTerrain).
import { supabase } from "../supabase";
import { getCurrentWeek, getWeekId } from "../constants";
import { ajouterJoursV1 } from "./bilanSemaineProchaineV1.mjs";

/** Semaine ISO courante de l'appareil, « AAAA-Www » (semaine ouverte par défaut sur la page). */
export function semaineCouranteRetoursTerrain() {
  const { year, week } = getCurrentWeek();
  return getWeekId(year, week);
}

// Les deux écritures de date_rapport rencontrées en base (« 12/10/2026 » et ISO).
export const ecrituresDate = (iso) => { const [a, m, j] = iso.split("-"); return [`${j}/${m}/${a}`, iso]; };

/**
 * Comptes rendus de la semaine commençant le lundi donné, et phasages des
 * chantiers concernés.
 * @param {string} lundi « AAAA-MM-JJ »
 * @returns {Promise<{ statut: "ok"|"erreur", rapports: Array, phasages: Array|null, erreur?: string }>}
 *   phasages = null : phasages illisibles (les retours restent affichés ; seuls
 *   l'ouvrage et le devenir des nouvelles tâches manquent, signalé).
 */
export async function chargerRetoursTerrainSemaine(lundi) {
  const jours = Array.from({ length: 7 }, (_, i) => ajouterJoursV1(lundi, i));
  const { data: rapports, error } = await supabase.from("rapports")
    .select("id, ouvrier, chantier_id, chantier_nom, date_rapport, statut, taches, formulaire_version")
    .in("date_rapport", jours.flatMap(ecrituresDate));
  if (error) return { statut: "erreur", rapports: [], phasages: [], erreur: error.message || "lecture impossible" };
  const ids = [...new Set((rapports || []).map(r => r.chantier_id).filter(Boolean))];
  let phasages = [];
  if (ids.length > 0) {
    const { data: ph, error: e2 } = await supabase.from("phasages").select("chantier_id, ouvrages").in("chantier_id", ids);
    phasages = e2 ? null : (ph || []);
  }
  return { statut: "ok", rapports: rapports || [], phasages };
}
