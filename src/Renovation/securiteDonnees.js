// ─────────────────────────────────────────────────────────────────────────────
// securiteDonnees — lecture et écriture de la fiche de préparation sécurité
// côté page Opération (tâche 2 du projet docs/projets/fiche-securite-chantier.md).
//
//   - état des fiches des chantiers d'une opération : vue securite_fiches_etat ;
//   - données du bâtiment : table securite_operations (une ligne par opération,
//     enregistrée par upsert sur operation_id). Aucune suppression.
//
// Chaque fonction renvoie { …, erreur } : une lecture en échec n'est jamais
// confondue avec « aucune donnée » (l'écran affiche « état illisible »).
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "../supabase";

const COLS_ETAT = "fiche_id, chantier_id, version, statut, points_completes, signe_etablie_par, signe_chef_equipe, nb_signatures_accueil, nb_justificatifs_chantier, demarrage_force";
const COLS_BATIMENT = "operation_id, date_permis_construire, avant_1997, avant_1949, copropriete, etage, ascenseur_utilisable, reperage_amiante_statut, notes, maj_par, updated_at";

/** État des fiches de plusieurs chantiers → { parChantier: { [id]: ligne }, erreur }. */
export async function chargerEtatFiches(chantierIds) {
  const ids = [...new Set((chantierIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { parChantier: {}, erreur: null };
  try {
    const { data, error } = await supabase.from("securite_fiches_etat").select(COLS_ETAT).in("chantier_id", ids);
    if (error) return { parChantier: {}, erreur: error.message };
    const parChantier = {};
    (data || []).forEach((l) => { parChantier[l.chantier_id] = l; });
    return { parChantier, erreur: null };
  } catch (e) {
    return { parChantier: {}, erreur: e?.message || String(e) };
  }
}

/** Données du bâtiment d'une opération → { ligne (null = jamais saisie), erreur }. */
export async function chargerBatiment(operationId) {
  if (!operationId) return { ligne: null, erreur: "opération inconnue" };
  try {
    const { data, error } = await supabase.from("securite_operations").select(COLS_BATIMENT)
      .eq("operation_id", String(operationId)).maybeSingle();
    if (error) return { ligne: null, erreur: error.message };
    return { ligne: data || null, erreur: null };
  } catch (e) {
    return { ligne: null, erreur: e?.message || String(e) };
  }
}

/**
 * Enregistre la ligne préparée par preparerEnregistrementBatiment (module pur).
 * Relit la ligne écrite : « avant 1997 / avant 1949 » sont calculés par la base.
 */
export async function enregistrerBatiment(ligne, auteur) {
  try {
    const { data, error } = await supabase.from("securite_operations")
      .upsert({ ...ligne, maj_par: auteur || null }, { onConflict: "operation_id" })
      .select(COLS_BATIMENT).single();
    if (error) return { ligne: null, erreur: error.message };
    return { ligne: data, erreur: null };
  } catch (e) {
    return { ligne: null, erreur: e?.message || String(e) };
  }
}
