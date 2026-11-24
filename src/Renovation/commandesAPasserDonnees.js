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
// Aucun calcul ici : le modèle et les stats sont dans commandesAPasserV1.mjs,
// le filtre des demandes en attente dans commandesASaisirV1.mjs.
// Lecture seule.
import { supabase } from "../supabase";
import { loadLots } from "../constants";
import { lireToutParTranches } from "./lectureParTranches";
import { chargerTousLesMateriaux } from "./chargerMateriaux";
import { chargerAchatsTermines, achatsTerminesParChantier } from "./achatsLotsTermines";
import { STATUT_BESOIN_EN_ATTENTE, COLONNES_BESOINS_EN_ATTENTE } from "./commandesASaisirV1.js";

/** Colonnes de la bibliothèque lues par la page (valorisation des matériaux liés). */
export const COLONNES_MATERIAUX_COMMANDES = "id, nom, reference, unite, prix_unitaire, fournisseur, fournisseur_id, lien_fournisseur, photo_url";

/** Phasages (ouvrages et matériaux liés). Rend { data, error }. */
export function lirePhasagesCommandes() {
  return supabase
    .from("phasages")
    .select("id, chantier_id, chantier_nom, ouvrages");
}

/**
 * Lignes de commande existantes (+ en-tête commande). Par tranches : plus de
 * 1 000 lignes en base, une lecture d'un coup serait tronquée sans erreur (et
 * le reste à commander avec). Rend { data, error }.
 */
export function lireLignesCommandes() {
  return lireToutParTranches((a, b) => supabase
    .from("commande_lignes")
    .select("id, libelle, reference, quantite, unite, prix_unitaire, prix_total, materiau_id, lot_id, nature, ouvrage_id, chantier_id, phasage_id, commande:commandes(id, doc_numero, numero_en_attente, date_doc, fournisseur_nom, statut_completude, statut_facturation, type_evenement)")
    .order("id").range(a, b));
}

/** Bibliothèque matériaux en entier (par tranches, chargerMateriaux.js). */
export function lireMateriauxCommandes() {
  return chargerTousLesMateriaux(COLONNES_MATERIAUX_COMMANDES);
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

const messageErreur = (e) => (e ? (typeof e === "string" ? e : e.message || String(e)) : null);

/**
 * Toutes les entrées de modeleCommandesAPasser (hors chantiers, déjà chargés
 * par l'application), avec les mêmes lectures que la page.
 * @returns {Promise<{ erreur: string|null, phasages, lignesCmd, achatsParCh, materiaux, lots }>}
 *   `erreur` : première lecture en échec (la page les ignore ; le bloc
 *   l'affiche plutôt qu'un chiffre faux).
 */
export async function chargerDonneesCommandesAPasser() {
  const [ph, lc, ach, mat, lots] = await Promise.all([
    lirePhasagesCommandes(), lireLignesCommandes(), chargerAchatsTermines(), lireMateriauxCommandes(), loadLots(),
  ]);
  const erreur = [ph, lc, ach, mat].map(r => messageErreur(r.error)).filter(Boolean)[0] || null;
  return {
    erreur,
    phasages: ph.data || [], lignesCmd: lc.data || [],
    achatsParCh: achatsTerminesParChantier(ach.data), materiaux: mat.data || [], lots,
  };
}
