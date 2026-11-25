// src/Renovation/encoursFournisseursDonnees.js — lectures Supabase de la page
// « Encours fournisseurs » (vue « Par échéance de paiement »), avec le client
// du navigateur.
//
// Partagé par (MÊME CHIFFRE = MÊME SERVICE) :
//   - la page « Encours fournisseurs » (PageEncoursFournisseurs.jsx) ;
//   - le bloc du jour « Administratif fournisseurs » (projet
//     docs/projets/organisation-par-jour.md, tâche 9).
// Les requêtes elles-mêmes vivent dans encoursFournisseursLecture.mjs (tâche
// 14), pour que le mail du vendredi et la notification F2
// (api/cron-encours-fournisseurs.js) lisent EXACTEMENT les mêmes données avec
// le client du serveur. Aucun calcul ici : il est dans
// encoursFournisseursPageV1.mjs. Lecture seule.
import { supabase } from "../supabase";
import { lireDonneesEncoursFournisseurs } from "./encoursFournisseursLecture.mjs";

/**
 * Les quatre lectures de la page, en parallèle.
 * Rend { fournisseurs, commandes, factures, facturesBl } (tableaux, vides si la
 * lecture a échoué) et `erreur` (message de
 * la première lecture en échec, sinon null) pour qui doit la signaler.
 */
export function chargerDonneesEncoursFournisseurs() {
  return lireDonneesEncoursFournisseurs(supabase);
}
