// src/Renovation/commandesAPasserDonnees.js — lectures Supabase de la page
// « Commandes à passer » et des demandes de matériel des ouvriers.
//
// Partagé par (MÊME CHIFFRE = MÊME SERVICE) :
//   - la page « Commandes à passer » (PagePlanningCommandes.jsx) ;
//   - le tableau de bord (Dashboard.jsx, tuile « Commandes à passer » :
//     compterBesoinsEnAttente) ;
//   - le bloc du jour « Commandes à saisir » (projet
//     docs/projets/organisation-par-jour.md, tâche 7).
// Requêtes déplacées À L'IDENTIQUE de PagePlanningCommandes.jsx et de
// Dashboard.jsx (mêmes tables, colonnes, filtres, tris, lecture par tranches).
// Depuis la tâche 15, les lectures de la liste « à commander » vivent dans
// commandesAPasserLecture.mjs (client Supabase en paramètre), partagé avec
// le mail récap du vendredi (api/_cron/cron-recap-commandes.js) : ici, on
// leur passe le client du navigateur.
// Aucun calcul ici : le modèle et les stats sont dans commandesAPasserV1.mjs,
// le filtre des demandes en attente dans commandesASaisirV1.mjs.
// Lecture seule.
import { supabase } from "../supabase";
import { STATUT_BESOIN_EN_ATTENTE, COLONNES_BESOINS_EN_ATTENTE } from "./commandesASaisirV1.js";
import {
  COLONNES_MATERIAUX_COMMANDES, lirePhasagesCommandesAvec, lireLignesCommandesAvec,
  lireMateriauxCommandesAvec, lireDonneesCommandesAPasser,
} from "./commandesAPasserLecture.mjs";

/** Colonnes de la bibliothèque lues par la page (valorisation des matériaux liés). */
export { COLONNES_MATERIAUX_COMMANDES };

/** Phasages (ouvrages et matériaux liés). Rend { data, error }. */
export function lirePhasagesCommandes() {
  return lirePhasagesCommandesAvec(supabase);
}

/**
 * Lignes de commande existantes (+ en-tête commande), par tranches
 * (lireToutParTranches). Rend { data, error }.
 */
export function lireLignesCommandes() {
  return lireLignesCommandesAvec(supabase);
}

/** Bibliothèque matériaux en entier (par tranches, chargerTousLesMateriaux). */
export function lireMateriauxCommandes() {
  return lireMateriauxCommandesAvec(supabase);
}

/** Demandes ouvrier en attente (onglet « Demandes ouvriers »), plus récentes d'abord. */
export function lireBesoinsEnAttente() {
  return supabase
    .from("besoins")
    .select(COLONNES_BESOINS_EN_ATTENTE)
    .eq("statut", STATUT_BESOIN_EN_ATTENTE)
    .order("created_at", { ascending: false });
}

/**
 * Nombre de besoins ouvrier en attente (nouveau modèle) = demandes à
 * transformer en commande : la tuile « Commandes à passer » du tableau de
 * bord. Rend { count, error }.
 */
export function compterBesoinsEnAttente() {
  return supabase.from("besoins").select("id", { count: "exact", head: true }).eq("statut", STATUT_BESOIN_EN_ATTENTE);
}

/**
 * Toutes les entrées de modeleCommandesAPasser (hors chantiers, déjà chargés
 * par l'application), avec les mêmes lectures que la page
 * (commandesAPasserLecture.mjs, client du navigateur).
 * @returns {Promise<{ erreur: string|null, phasages, lignesCmd, achatsParCh, materiaux, lots }>}
 *   `erreur` : première lecture en échec (la page les ignore ; le bloc
 *   l'affiche plutôt qu'un chiffre faux).
 */
export function chargerDonneesCommandesAPasser() {
  return lireDonneesCommandesAPasser(supabase);
}
