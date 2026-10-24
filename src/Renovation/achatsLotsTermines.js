// src/Renovation/achatsLotsTermines.js — lecture / écriture de la table
// achats_lots_termines (étape 1B) : un lot d'un chantier dont les achats de
// matériaux sont terminés a un reste à commander de 0. Aucun calcul ici : le
// reste vit dans chantierFinance.mjs (resteACommanderEnveloppes).
import { supabase } from "../supabase";

// Toutes les lignes (ou celles d'un chantier). Lecture échouée → erreur
// rendue à l'appelant, qui la signale : une liste vide ne prouve pas
// « aucun lot terminé ».
export async function chargerAchatsTermines(chantierId = null) {
  let q = supabase.from("achats_lots_termines").select("id, chantier_id, lot_id, termine_le, termine_par");
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

export async function marquerAchatsTermines({ chantierId, lotId, auteur = null }) {
  const { error } = await supabase.from("achats_lots_termines")
    .upsert({ chantier_id: chantierId, lot_id: lotId, termine_le: new Date().toISOString(), termine_par: auteur },
      { onConflict: "chantier_id,lot_id" });
  return { ok: !error, error: error ? error.message : null };
}

export async function annulerAchatsTermines({ chantierId, lotId }) {
  const { error } = await supabase.from("achats_lots_termines")
    .delete().eq("chantier_id", chantierId).eq("lot_id", lotId);
  return { ok: !error, error: error ? error.message : null };
}
