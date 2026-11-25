// Lecture de la table achats_lots_termines (étape 1B), avec le client
// Supabase en paramètre : partagée entre le navigateur (achatsLotsTermines.js
// → chargerAchatsTermines) et le serveur (mail récap du vendredi, projet
// docs/projets/organisation-par-jour.md, tâche 15). Code DÉPLACÉ tel quel de
// achatsLotsTermines.js. Extension .mjs = importable par Node. Aucune écriture.

export const COLONNES_ACHATS_TERMINES = "id, chantier_id, lot_id, termine_le, termine_par";

// Toutes les lignes (ou celles d'un chantier). Lecture échouée → erreur
// rendue à l'appelant, qui la signale : une liste vide ne prouve pas
// « aucun lot terminé ».
export async function chargerAchatsTerminesAvec(client, chantierId = null) {
  let q = client.from("achats_lots_termines").select(COLONNES_ACHATS_TERMINES);
  if (chantierId) q = q.eq("chantier_id", chantierId);
  const { data, error } = await q;
  // `error` : l'objet Supabase (error.message), comme une requête directe.
  return { data: data || [], error: error || null };
}

// Index { chantier_id: [lignes] }.
export function achatsTerminesParChantier(lignes) {
  const m = {};
  (lignes || []).forEach(a => { (m[a.chantier_id] ||= []).push(a); });
  return m;
}
