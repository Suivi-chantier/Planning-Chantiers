import { supabase } from "../supabase";
import { normaliserNomRessource } from "./planningResourceModelV1.js";

// Couche de lecture partagée. En cas d'indisponibilité de la nouvelle couche,
// les appelants peuvent conserver le comportement historique basé uniquement
// sur rythmeSemaine.
export async function chargerRessourcesPlanningV1() {
  const { data, error } = await supabase
    .from("planning_resources")
    .select("id, nom, nom_planning, kind, actif, capacite_facteur, utilisateur_id, auth_user_id")
    .order("nom_planning");
  if (error) throw error;
  return data || [];
}

export async function chargerEvenementsRessourcesPourDateV1(dateISO) {
  const date = String(dateISO || "").slice(0, 10);
  if (!date) return [];
  const { data, error } = await supabase
    .from("planning_resource_events")
    .select("id, resource_id, type, date_debut, date_fin, toute_journee, heures_indisponibles, capacite_heures, motif, source, actif")
    .eq("actif", true)
    .lte("date_debut", date)
    .gte("date_fin", date);
  if (error) throw error;
  return data || [];
}

export function indexerRessourcesParNomPlanningV1(ressources = []) {
  const map = new Map();
  for (const r of Array.isArray(ressources) ? ressources : []) {
    const key = normaliserNomRessource(r?.nom_planning || r?.nom);
    if (!key || map.has(key)) continue;
    map.set(key, r);
  }
  return map;
}

export function ressourcePourNomPlanningV1(index, nomPlanning) {
  if (!(index instanceof Map)) return null;
  const key = normaliserNomRessource(nomPlanning);
  return key ? (index.get(key) || null) : null;
}
