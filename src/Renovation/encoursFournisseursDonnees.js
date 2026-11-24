// src/Renovation/encoursFournisseursDonnees.js — lectures Supabase de la page
// « Encours fournisseurs » (vue « Par échéance de paiement »).
//
// Partagé par (MÊME CHIFFRE = MÊME SERVICE) :
//   - la page « Encours fournisseurs » (PageEncoursFournisseurs.jsx) ;
//   - le bloc du jour « Administratif fournisseurs » (projet
//     docs/projets/organisation-par-jour.md, tâche 9).
// Requêtes déplacées À L'IDENTIQUE de PageEncoursFournisseurs.jsx (mêmes
// tables, colonnes, filtres, limites). Aucun calcul ici : il est dans
// encoursFournisseursPageV1.mjs. Lecture seule.
//
// N.B. : le mail du vendredi et la notification F2
// (api/cron-encours-fournisseurs.js) ont leurs propres lectures et leur propre
// calcul (encoursFournisseursV1.mjs) ; ils ne passent pas par ici.
import { supabase } from "../supabase";

/**
 * Les quatre lectures de la page, en parallèle.
 * Rend { fournisseurs, commandes, factures, facturesBl } (tableaux, vides si la
 * lecture a échoué — comportement de la page, inchangé) et `erreur` (message de
 * la première lecture en échec, sinon null) pour qui doit la signaler.
 */
export async function chargerDonneesEncoursFournisseurs() {
  const [fournRes, cRes, fRes, blRes] = await Promise.all([
    supabase.from("fournisseurs").select("id, nom, mode_paiement"),
    supabase.from("commandes")
      .select("id, fournisseur_id, fournisseur_nom, doc_type, doc_numero, montant_ht, date_doc, created_at, statut_facturation, source, lignes:commande_lignes(prix_total)")
      .is("facture_id", null).limit(5000),
    supabase.from("factures")
      .select("id, numero, fournisseur_id, fournisseur_nom, montant_ht, date_facture, date_echeance, created_at, statut")
      .neq("statut", "archivee").limit(2000),
    supabase.from("facture_bl").select("facture_id, commande_id, bl_numero, montant_ht, statut").limit(10000),
  ]);
  const erreur = [fournRes, cRes, fRes, blRes].map((r) => r?.error).find(Boolean);
  return {
    fournisseurs: fournRes.data || [],
    commandes: cRes.data || [],
    factures: fRes.data || [],
    facturesBl: blRes.data || [],
    erreur: erreur ? (erreur.message || String(erreur)) : null,
  };
}
