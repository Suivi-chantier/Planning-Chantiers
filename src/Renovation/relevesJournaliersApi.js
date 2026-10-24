// src/Renovation/relevesJournaliersApi.js — demande au serveur de recalculer
// le relevé journalier d'un chantier après une écriture (validation de compte
// rendu, correction, modification d'avancement) — refonte du Bilan, 1D.
//
// Jamais bloquant : l'écriture est déjà faite, le relevé se recalcule en
// arrière-plan. Un échec est seulement journalisé : le rattrapage de nuit
// recalcule de toute façon chaque chantier qui a bougé dans la journée.
import { supabase } from "../supabase";

// `date` (AAAA-MM-JJ, optionnelle) : jour touché. Sans date, le serveur prend
// la plus ancienne date des changements d'avancement qui viennent d'être
// écrits pour ce chantier (sinon aujourd'hui).
export async function demanderRecalculReleve({ chantierId, date = null }) {
  if (!chantierId) return;
  try {
    const { data } = await supabase.auth.getSession();
    const jeton = data?.session?.access_token;
    if (!jeton) return;
    const res = await fetch("/api/releves-journaliers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ chantierId, date }),
    });
    if (!res.ok) console.warn("Relevé journalier non recalculé :", res.status);
  } catch (e) {
    console.warn("Relevé journalier non recalculé :", e?.message || e);
  }
}
