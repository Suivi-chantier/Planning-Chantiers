// referenceFinanciere — I/O de la référence financière FIGÉE (Point 5, P3).
//
// La table chantier_reference_financiere est INSERT-ONLY (voir
// sql/202608_reference_financiere.sql) :
//  - référence COURANTE = la ligne la plus récente du chantier ;
//  - re-basage = nouvel INSERT, l'ancienne référence n'est JAMAIS modifiée ;
//  - aucun UPDATE → pas de course d'écriture (piège saveMeta évité par
//    conception), historique garanti.
// La référence ne se recalcule JAMAIS toute seule : seul l'utilisateur, via
// une action explicite avec récapitulatif, déclenche prendreReference().
// Les calculs (séries prévues, récap) vivent dans diagrammeFinancier.mjs —
// ce fichier ne fait que charger et insérer.
import { supabase } from "../supabase";

// Références d'un chantier, de la plus récente à la plus ancienne.
// → { courante, historique, erreur } — courante = null si aucune référence
// (le chantier fonctionne alors normalement, diagramme en réel seul).
export async function loadReferenceFinanciere(chantierId) {
  if (!chantierId) return { courante: null, historique: [], erreur: null };
  const { data, error } = await supabase
    .from("chantier_reference_financiere")
    .select("id, chantier_id, chantier_nom, phasage_id, libelle, auteur, date_prise, series, recap, warnings")
    .eq("chantier_id", chantierId)
    .order("date_prise", { ascending: false });
  if (error) {
    console.warn("loadReferenceFinanciere:", error.message);
    return { courante: null, historique: [], erreur: error.message };
  }
  const rows = data || [];
  return { courante: rows[0] || null, historique: rows.slice(1), erreur: null };
}

// Références courantes de PLUSIEURS chantiers en UNE requête (patron .in,
// comme loadPhasagesOperation) — pour le consolidé (Prompt 5).
// → { parChantier: { [chantier_id]: ligne courante }, erreur }
export async function loadReferencesFinancieres(chantierIds) {
  const ids = (chantierIds || []).filter(Boolean);
  if (ids.length === 0) return { parChantier: {}, erreur: null };
  const { data, error } = await supabase
    .from("chantier_reference_financiere")
    .select("id, chantier_id, libelle, auteur, date_prise, series, recap")
    .in("chantier_id", ids)
    .order("date_prise", { ascending: false });
  if (error) {
    console.warn("loadReferencesFinancieres:", error.message);
    return { parChantier: {}, erreur: error.message };
  }
  const parChantier = {};
  (data || []).forEach((r) => {
    // Trié DESC : la première ligne rencontrée par chantier est la courante.
    if (!parChantier[r.chantier_id]) parChantier[r.chantier_id] = r;
  });
  return { parChantier, erreur: null };
}

// Prend (ou reprend) la référence : INSERT d'une nouvelle ligne. L'appelant a
// déjà montré le récapitulatif et obtenu la confirmation de l'utilisateur.
// `series` = résultat de seriesPrevuesChantier, `recap` = recapReference.
export async function prendreReference({
  chantierId, chantierNom = null, phasageId = null,
  libelle, auteur = null, series, recap = null, warnings = null,
}) {
  if (!chantierId || !libelle || !series) {
    return { ok: false, erreur: "chantierId, libelle et series sont requis." };
  }
  const { data, error } = await supabase
    .from("chantier_reference_financiere")
    .insert({
      chantier_id: chantierId, chantier_nom: chantierNom, phasage_id: phasageId,
      libelle, auteur, series, recap, warnings,
    })
    .select("id, libelle, auteur, date_prise, series, recap")
    .maybeSingle();
  if (error) {
    console.warn("prendreReference:", error.message);
    return { ok: false, erreur: error.message };
  }
  return { ok: true, reference: data };
}
