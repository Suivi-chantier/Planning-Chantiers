// Lecture des phasages du bloc « Tournée des chantiers » (projet
// organisation-par-jour, tâche 10). Ce n'est PAS un module pur : il lit la
// base. La règle « tâche en retard » reste dans tourneeChantiersV1.mjs
// (etatReelTacheV1 de planningReplanningStateV1.js).
import { supabase } from "../supabase";

/**
 * Phasages des chantiers donnés ({ chantier_id, ouvrages }).
 * @param {string[]} ids identifiants de chantiers
 * @returns {Promise<{ data: Array, error: string|null }>}
 */
export async function lirePhasagesChantiers(ids) {
  const liste = [...new Set((ids || []).filter(Boolean))];
  if (liste.length === 0) return { data: [], error: null };
  const { data, error } = await supabase.from("phasages").select("chantier_id, ouvrages").in("chantier_id", liste);
  if (error) return { data: [], error: error.message || "lecture impossible" };
  return { data: data || [], error: null };
}
