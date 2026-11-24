// ─────────────────────────────────────────────────────────────────────────────
// chantiersAVenirDonnees — lectures du bloc « Chantiers à venir » (projet
// docs/projets/organisation-par-jour.md, tâche 8). LECTURE SEULE.
//
//   1. Phasages (repérage) : id, chantier_id, chantier_nom de TOUS les
//      phasages, sans tri, comme la fiche chantier qui les lit tous pour
//      trouverPhasage et le statut affiché.
//   2. Phasages complets des seuls chantiers à venir (ouvrages + plan_travaux).
//   3. Cycle de vie de ces chantiers : chargerCycleVie (cycleVieDonnees.js),
//      la lecture de la fiche chantier et de la synthèse Opérations.
// Les règles viennent de chantiersAVenirV1.mjs (pur).
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "../supabase";
import { chargerCycleVie } from "./cycleVieDonnees.js";
import {
  COLONNES_PHASAGES_REPERAGE, COLONNES_PHASAGES_PREPARATION, reperageChantiersAVenir,
} from "./chantiersAVenirV1.js";

/**
 * → { erreur, phasagesReperage, phasagesComplets, lignesCycleVie }
 * erreur non nulle = une lecture a échoué : le bloc le dit, il n'affiche
 * jamais une liste partielle comme un résultat.
 */
export async function chargerDonneesChantiersAVenir(chantiers) {
  const rep = await supabase.from("phasages").select(COLONNES_PHASAGES_REPERAGE);
  if (rep.error) return { erreur: `phasages : ${rep.error.message}`, phasagesReperage: null, phasagesComplets: null, lignesCycleVie: null };
  const phasagesReperage = rep.data || [];
  const reperes = reperageChantiersAVenir(chantiers, phasagesReperage);
  const idsPhasages = [...new Set(reperes.map((r) => r.phasageId).filter((id) => id != null))];
  const [complets, cv] = await Promise.all([
    idsPhasages.length
      ? supabase.from("phasages").select(COLONNES_PHASAGES_PREPARATION).in("id", idsPhasages)
      : Promise.resolve({ data: [], error: null }),
    chargerCycleVie(reperes.map((r) => r.chantier.id)),
  ]);
  if (complets.error) return { erreur: `phasages : ${complets.error.message}`, phasagesReperage, phasagesComplets: null, lignesCycleVie: null };
  if (cv.erreur) return { erreur: `étapes du cycle de vie : ${cv.erreur}`, phasagesReperage, phasagesComplets: complets.data || [], lignesCycleVie: null };
  return { erreur: null, phasagesReperage, phasagesComplets: complets.data || [], lignesCycleVie: cv.lignes || [] };
}
