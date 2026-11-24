// ─────────────────────────────────────────────────────────────────────────────
// encoursFournisseursLecture — LES lectures de la page « Encours fournisseurs »
// (vue « Par échéance de paiement »), partagées entre le navigateur et le
// serveur (projet docs/projets/organisation-par-jour.md, tâche 14).
//
// Utilisées par (MÊME CHIFFRE = MÊME SERVICE) :
//   - la page « Encours fournisseurs » et le bloc du jour « Administratif
//     fournisseurs », via encoursFournisseursDonnees.js (client du navigateur) ;
//   - le mail du vendredi et la notification F2
//     (api/cron-encours-fournisseurs.js, client service du serveur).
// Requêtes déplacées À L'IDENTIQUE de encoursFournisseursDonnees.js (tâche 9) :
// mêmes tables, colonnes, filtres, limites. Aucun calcul ici : il est dans
// encoursFournisseursPageV1.mjs.
//
// Ce n'est PAS un module de calcul : il lit la base, avec le client Supabase
// passé en paramètre (il n'en crée aucun et n'importe pas celui du
// navigateur). Extension .mjs pour être chargé tel quel par Node
// (`await import()` depuis api/). Aucune horloge, aucune écriture.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les quatre lectures de la page, en parallèle.
 * @param {object} client client Supabase (navigateur ou serveur)
 * @returns {Promise<{ fournisseurs: Array, commandes: Array, factures: Array, facturesBl: Array, erreur: string|null }>}
 *   tableaux (vides si la lecture a échoué — comportement de la page,
 *   inchangé) et `erreur` (message de la première lecture en échec, sinon
 *   null) pour qui doit la signaler.
 */
export async function lireDonneesEncoursFournisseurs(client) {
  const [fournRes, cRes, fRes, blRes] = await Promise.all([
    client.from("fournisseurs").select("id, nom, mode_paiement"),
    client.from("commandes")
      .select("id, fournisseur_id, fournisseur_nom, doc_type, doc_numero, montant_ht, date_doc, created_at, statut_facturation, source, lignes:commande_lignes(prix_total)")
      .is("facture_id", null).limit(5000),
    client.from("factures")
      .select("id, numero, fournisseur_id, fournisseur_nom, montant_ht, date_facture, date_echeance, created_at, statut")
      .neq("statut", "archivee").limit(2000),
    client.from("facture_bl").select("facture_id, commande_id, bl_numero, montant_ht, statut").limit(10000),
  ]);
  const erreur = [fournRes, cRes, fRes, blRes].map((r) => r?.error).find(Boolean);
  return {
    fournisseurs: fournRes?.data || [],
    commandes: cRes?.data || [],
    factures: fRes?.data || [],
    facturesBl: blRes?.data || [],
    erreur: erreur ? (erreur.message || String(erreur)) : null,
  };
}
