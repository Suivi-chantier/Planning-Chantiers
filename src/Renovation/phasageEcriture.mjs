// ─────────────────────────────────────────────────────────────────────────────
// phasageEcriture — écriture VERSIONNÉE d'un phasage pour les écrans qui font
// des actions PONCTUELLES : Planning commandes, Validation, helpers planning.
//
// PhasageV2 a sa propre file d'auto-save (phasageSauvegarde.mjs) : un éditeur
// qui écrit à chaque frappe a besoin d'un tampon. Ici, ce serait de trop —
// ces écrans enregistrent sur une action explicite. Ils partagent donc
// seulement un REGISTRE de révisions (une par phasage) et un garde anti-double
// clic.
//
// Le registre est PUR et IMMUABLE : chaque fonction renvoie un nouvel état, ce
// qui rend le comportement de concurrence testable sans navigateur
// (scripts/verif-phasage-ecriture.mjs).
//
// RÈGLE : aucune réécriture de `ouvrages` ou `plan_travaux` ne part sans la
// révision attendue. Le serveur refuse si la ligne a bougé — typiquement
// l'acceptation d'un matériau suggéré — et l'écran demande un rechargement.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "../supabase";
// Le registre est pur et vit à part, pour rester testable en Node.
export * from "./phasageRegistre.mjs";

// ── Appels serveur ──────────────────────────────────────────────────────────

const MESSAGE_GENERIQUE = "L'enregistrement n'a pas abouti. Vérifiez votre connexion et réessayez.";

// Lit la révision courante d'un phasage (par id ou par chantier).
export async function lireRevision({ phasageId = null, chantierId = null }) {
  let q = supabase.from("phasages").select("id, revision");
  q = phasageId ? q.eq("id", phasageId) : q.eq("chantier_id", chantierId);
  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;
  return { id: data.id, revision: data.revision ?? 0 };
}

// Écrit UN phasage avec sa révision attendue.
// Renvoie { ok, code, revision } — code ∈ enregistre | conflit | refuse | erreur.
export async function sauvegarderPhasage({ phasageId, revision, ouvrages = null, plan_travaux = null }) {
  try {
    const { data, error } = await supabase.rpc("conducteur_sauvegarder_phasage_v2", {
      p_phasage_id: phasageId,
      p_revision_attendue: revision,
      p_ouvrages: ouvrages,
      p_plan_travaux: plan_travaux,
    });
    if (error) { console.warn("sauvegarderPhasage:", error.message); return { ok: false, code: "erreur" }; }
    if (!data) { console.warn("sauvegarderPhasage: refusée pour ce compte"); return { ok: false, code: "refuse" }; }
    if (data.ok === true) return { ok: true, code: "enregistre", revision: data.revision };
    return { ok: false, code: data.code === "conflit" ? "conflit" : "erreur", revision: data.revision };
  } catch (e) {
    console.warn("sauvegarderPhasage:", e);
    return { ok: false, code: "erreur" };
  }
}

// Écrit PLUSIEURS phasages en une transaction : tout ou rien.
// `entrees` : [{ phasage_id, revision_attendue, ouvrages?, plan_travaux? }]
// Renvoie { ok, code, revisions, conflits }.
export async function sauvegarderPhasagesLot(entrees) {
  try {
    const { data, error } = await supabase.rpc("conducteur_sauvegarder_phasages_lot", { p_lot: entrees });
    if (error) { console.warn("sauvegarderPhasagesLot:", error.message); return { ok: false, code: "erreur" }; }
    if (!data) { console.warn("sauvegarderPhasagesLot: refusée pour ce compte"); return { ok: false, code: "refuse" }; }
    if (data.ok === true) return { ok: true, code: "enregistre", revisions: data.revisions || {} };
    return { ok: false, code: data.code === "conflit" ? "conflit" : "erreur", conflits: data.conflits || [] };
  } catch (e) {
    console.warn("sauvegarderPhasagesLot:", e);
    return { ok: false, code: "erreur" };
  }
}

export const MESSAGE_ERREUR_ECRITURE = MESSAGE_GENERIQUE;
