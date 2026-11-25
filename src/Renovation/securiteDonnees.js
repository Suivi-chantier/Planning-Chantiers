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

// ─── Fiche d'un chantier (tâche 3) ───────────────────────────────────────────
// Table securite_fiches. Création en brouillon (valeurs par défaut de la base),
// lecture, et enregistrement du contenu préparé par contenuAEnregistrer()
// (module pur securiteFiche.mjs). Aucune suppression.

const COLS_FICHE = "id, chantier_id, version, statut, donnees_base, intervenants, reponses, synthese_risques, validee_le, validee_par, cree_par, maj_par, created_at, updated_at";

/** Fiche d'un chantier → { ligne (null = pas de fiche), erreur }. */
export async function chargerFiche(chantierId) {
  if (!chantierId) return { ligne: null, erreur: "chantier inconnu" };
  try {
    const { data, error } = await supabase.from("securite_fiches").select(COLS_FICHE)
      .eq("chantier_id", String(chantierId)).maybeSingle();
    if (error) return { ligne: null, erreur: error.message };
    return { ligne: data || null, erreur: null };
  } catch (e) {
    return { ligne: null, erreur: e?.message || String(e) };
  }
}

/**
 * Crée la fiche d'un chantier, en brouillon (défauts de la base : version 1,
 * contenu vide). Si une fiche existe déjà (créée entre-temps par quelqu'un
 * d'autre : clé unique sur chantier_id), on relit et on renvoie celle-là.
 * → { ligne, existait, erreur }
 */
export async function creerFiche(chantierId, auteur) {
  if (!chantierId) return { ligne: null, existait: false, erreur: "chantier inconnu" };
  try {
    const { data, error } = await supabase.from("securite_fiches")
      .insert({ chantier_id: String(chantierId), cree_par: auteur || null, maj_par: auteur || null })
      .select(COLS_FICHE).single();
    if (!error) return { ligne: data, existait: false, erreur: null };
    if (error.code === "23505") {
      const r = await chargerFiche(chantierId);
      return { ligne: r.ligne, existait: true, erreur: r.erreur || (r.ligne ? null : error.message) };
    }
    return { ligne: null, existait: false, erreur: error.message };
  } catch (e) {
    return { ligne: null, existait: false, erreur: e?.message || String(e) };
  }
}

/**
 * Enregistre le contenu d'une fiche EN BROUILLON. L'écriture n'a lieu que si
 * la fiche est toujours en brouillon ET n'a pas été modifiée ailleurs depuis
 * la dernière lecture (même updated_at) : sinon rien n'est écrit et l'écran
 * dit pourquoi (jamais d'écrasement silencieux).
 * → { ligne, erreur, conflit }
 */
export async function enregistrerFiche(ficheId, contenu, { updatedAt, auteur } = {}) {
  if (!ficheId) return { ligne: null, erreur: "fiche inconnue", conflit: null };
  try {
    let q = supabase.from("securite_fiches")
      .update({ ...contenu, maj_par: auteur || null })
      .eq("id", ficheId).eq("statut", "brouillon");
    if (updatedAt) q = q.eq("updated_at", updatedAt);
    const { data, error } = await q.select(COLS_FICHE);
    if (error) return { ligne: null, erreur: error.message, conflit: null };
    if (data && data.length === 1) return { ligne: data[0], erreur: null, conflit: null };
    // 0 ligne écrite : relire pour dire pourquoi.
    const { data: actuelle, error: e2 } = await supabase.from("securite_fiches").select(COLS_FICHE).eq("id", ficheId).maybeSingle();
    if (e2) return { ligne: null, erreur: e2.message, conflit: null };
    if (!actuelle) return { ligne: null, erreur: "fiche introuvable (ou non visible avec vos droits)", conflit: null };
    if (actuelle.statut !== "brouillon") return { ligne: actuelle, erreur: "la fiche n'est plus en brouillon", conflit: "statut" };
    return { ligne: actuelle, erreur: "la fiche a été modifiée par quelqu'un d'autre", conflit: "modifiee_ailleurs" };
  } catch (e) {
    return { ligne: null, erreur: e?.message || String(e), conflit: null };
  }
}
