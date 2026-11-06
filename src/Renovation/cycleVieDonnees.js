// ─────────────────────────────────────────────────────────────────────────────
// cycleVieDonnees — lecture et écriture du cycle de vie du chantier (table
// chantier_cycle_vie), du journal des relances (relances_cycle_vie) et du
// réglage des relances (planning_config « relances_cycle_vie »).
// Refonte Opérations, lot 3. SEUL endroit du front qui touche ces tables.
//
// Écriture ÉTAPE PAR ÉTAPE : une ligne par chantier et par étape. L'updater
// reçoit l'état FRAIS relu en base (jamais l'état affiché), puis on écrit la
// seule ligne de cette étape : deux personnes qui valident deux étapes
// différentes ne s'écrasent pas. Aucune suppression.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "../supabase";
import { etatPourEcriture, ETAPE_PHASE_DECLAREE, etatsAnciens, CORRESPONDANCE_ANCIENNES_ETAPES } from "./cycleVieReprise.js";
import { CLE_REGLAGES_RELANCES, lireReglagesRelances } from "./relancesCycleVie.js";

const COLS = "chantier_id, etape_id, etat, maj_par, updated_at";

/** Lignes du cycle de vie de plusieurs chantiers → { lignes, erreur }. */
export async function chargerCycleVie(chantierIds) {
  const ids = [...new Set((chantierIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { lignes: [], erreur: null };
  const { data, error } = await supabase.from("chantier_cycle_vie").select(COLS).in("chantier_id", ids);
  if (error) return { lignes: [], erreur: error.message };
  return { lignes: data || [], erreur: null };
}

/** Lignes de l'étape `etapeId` sur une liste de chantiers (étape partagée). */
export async function chargerEtapeSurChantiers(etapeId, chantierIds) {
  const ids = [...new Set((chantierIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { lignes: [], erreur: null };
  const { data, error } = await supabase.from("chantier_cycle_vie").select(COLS)
    .eq("etape_id", etapeId).in("chantier_id", ids);
  if (error) return { lignes: [], erreur: error.message };
  return { lignes: data || [], erreur: null };
}

/**
 * Écrit l'état d'UNE étape. `updater(courant)` reçoit l'état frais : la ligne
 * de la table, sinon l'ancien état repris du phasage (`metaFraiche` relue par
 * l'appelant ou null) — ainsi les pièces jointes d'une étape reprise suivent.
 * Renvoie { ok, etat?, erreur? }.
 */
export async function ecrireEtapeCycleVie({ chantierId, etapeId, updater, auteur = "", lireMetaPhasage = null }) {
  if (!chantierId || !etapeId) return { ok: false, erreur: "Chantier ou étape inconnu." };
  const { data: ligne, error: errLecture } = await supabase.from("chantier_cycle_vie")
    .select("etat").eq("chantier_id", chantierId).eq("etape_id", etapeId).maybeSingle();
  if (errLecture) return { ok: false, erreur: errLecture.message };
  let courant = ligne?.etat || null;
  if (!courant && lireMetaPhasage) {
    // Reprise : on part de l'ancienne étape équivalente (jamais modifiée).
    try {
      const meta = await lireMetaPhasage();
      const anciens = etatsAnciens(meta);
      const ancienId = Object.keys(CORRESPONDANCE_ANCIENNES_ETAPES).find((k) => CORRESPONDANCE_ANCIENNES_ETAPES[k] === etapeId);
      if (ancienId && anciens[ancienId]) courant = anciens[ancienId];
    } catch { /* sans reprise : on part d'un état vide */ }
  }
  const nouveau = etatPourEcriture(typeof updater === "function" ? updater(courant || {}) : updater);
  const { error } = await supabase.from("chantier_cycle_vie").upsert(
    { chantier_id: chantierId, etape_id: etapeId, etat: nouveau, maj_par: auteur || null },
    { onConflict: "chantier_id,etape_id" },
  );
  if (error) return { ok: false, erreur: error.message };
  return { ok: true, etat: nouveau };
}

/** Phase déclarée à la main (null = retour à l'automatique). */
export function ecrirePhaseDeclaree({ chantierId, phaseId, auteur }) {
  return ecrireEtapeCycleVie({
    chantierId, etapeId: ETAPE_PHASE_DECLAREE, auteur,
    updater: () => ({ phaseId: phaseId || null, auteur: auteur || "", date: new Date().toISOString() }),
  });
}

/** Journal des relances (bureau, lecture seule) → { lignes, erreur }. */
export async function chargerRelances(chantierIds) {
  const ids = [...new Set((chantierIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { lignes: [], erreur: null };
  const { data, error } = await supabase.from("relances_cycle_vie")
    .select("chantier_id, type, reference, periode, statut, envoye_le, destinataire")
    .in("chantier_id", ids);
  if (error) return { lignes: [], erreur: error.message };
  return { lignes: data || [], erreur: null };
}

/** Réglage des relances → { reglages, brut, erreur } (absent = éteint, 7 jours). */
export async function chargerReglagesRelances() {
  const { data, error } = await supabase.from("planning_config").select("value").eq("key", CLE_REGLAGES_RELANCES).maybeSingle();
  if (error) return { reglages: lireReglagesRelances(null), brut: null, erreur: error.message };
  return { reglages: lireReglagesRelances(data?.value), brut: data?.value || null, erreur: null };
}

export async function enregistrerReglagesRelances({ actif, delaiJours, auteur }) {
  const r = lireReglagesRelances({ actif: actif === true, delai_jours: delaiJours });
  const value = { actif: r.actif, delai_jours: r.delaiJours, modifie_par: auteur || null, modifie_le: new Date().toISOString() };
  const { error } = await supabase.from("planning_config")
    .upsert({ key: CLE_REGLAGES_RELANCES, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return error ? { ok: false, erreur: error.message } : { ok: true, reglages: r };
}
