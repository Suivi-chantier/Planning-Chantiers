// src/Renovation/achatsLotsTermines.js — lecture / écriture de la table
// achats_lots_termines (étape 1B) : un lot d'un chantier dont les achats de
// matériaux sont terminés a un reste à commander de 0. Aucun calcul ici : le
// reste vit dans chantierFinance.mjs (resteACommanderEnveloppes).
import { supabase } from "../supabase";

import { chargerAchatsTerminesAvec, achatsTerminesParChantier } from "./achatsLotsTerminesLecture.mjs";

// Lecture et index : achatsLotsTerminesLecture.mjs (client en paramètre,
// partagé avec le serveur depuis la tâche 15 du projet organisation-par-jour).
// Toutes les lignes (ou celles d'un chantier). Lecture échouée → erreur
// rendue à l'appelant, qui la signale : une liste vide ne prouve pas
// « aucun lot terminé ».
export function chargerAchatsTermines(chantierId = null) {
  return chargerAchatsTerminesAvec(supabase, chantierId);
}

// Index { chantier_id: [lignes] }.
export { achatsTerminesParChantier };

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
