// src/Renovation/rapprochementDonnees.js — lectures Supabase de l'historique
// de la page « Rapprochement factures » (écran d'accueil).
//
// Partagé par (MÊME CHIFFRE = MÊME SERVICE) :
//   - la page « Rapprochement factures » (RapprochementFactures.jsx) ;
//   - le bloc du jour « Administratif fournisseurs » (projet
//     docs/projets/organisation-par-jour.md, tâche 9), qui ne lit que les
//     factures (lireFacturesHistorique) : les reçus ne sont jamais « à
//     rapprocher ».
// Requêtes déplacées À L'IDENTIQUE de RapprochementFactures.jsx (mêmes
// tables, colonnes, filtres, tris, limites). Aucun calcul ici : la liste et
// les statuts sont dans historiqueRapprochementV1.mjs. Lecture seule.
import { supabase } from "../supabase";
import { idsFournisseurs30j } from "./historiqueRapprochementV1.js";

/** Factures de l'historique, plus récentes d'abord (1 000 au plus). Rend { data, error }. */
export function lireFacturesHistorique() {
  return supabase.from("factures")
    .select("id, fournisseur_id, fournisseur_nom, numero, date_facture, periode, montant_ht, statut, type_document, facture_origine_id, photo_url, fichiers, created_at")
    .order("created_at", { ascending: false }).limit(1000);
}

/**
 * Lectures de l'historique complet (factures + reçus comptant / factures
 * directes 30j). Rend { fournisseurs, factures, commandes } (tableaux, vides si
 * la lecture a échoué — comportement de la page, inchangé).
 */
export async function chargerHistoriqueRapprochement() {
  // Fournisseurs en mode "30j" (facturés directement : une facture par achat,
  // payée à 30 jours). Leurs saisies valent facture -> à afficher ici.
  const { data: fournData } = await supabase.from("fournisseurs").select("id, mode_paiement");
  const ids30j = idsFournisseurs30j(fournData);

  // Commandes à afficher comme documents de dépense : payées comptant, OU
  // facture directe d'un fournisseur 30j. Jamais celles rattachées à une facture.
  let cq = supabase.from("commandes")
    .select("id, fournisseur_id, fournisseur_nom, doc_numero, doc_type, type_evenement, date_doc, montant_ht, statut_completude, statut_facturation, photo_url, notes, created_at, lignes:commande_lignes(id, libelle, quantite, unite, prix_unitaire, prix_total, chantier_id, lot_id)")
    .is("facture_id", null);
  cq = ids30j.length
    ? cq.or(`statut_facturation.eq.facture,fournisseur_id.in.(${ids30j.join(",")})`)
    : cq.eq("statut_facturation", "facture");

  const [fRes, cRes] = await Promise.all([
    lireFacturesHistorique(),
    cq.order("created_at", { ascending: false }).limit(1000),
  ]);
  return { fournisseurs: fournData || [], factures: fRes.data || [], commandes: cRes.data || [] };
}
