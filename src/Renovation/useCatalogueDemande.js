// Catalogue des demandes de matériel (espace ouvrier « Commande » et tiroir
// « besoin de commande » du formulaire /rapport).
//
// Passe TOUJOURS par la RPC catalogue_materiaux_demande (aucun prix, aucun
// fournisseur — voir sql/202609_catalogue_materiaux_demande.sql). Ne PAS
// ajouter de repli vers la table materiaux_bibliotheque.
//
// Depuis l'import SIDER, le catalogue dépasse 23 000 articles : l'API n'en
// renvoyait que 1 000 (les premiers de l'alphabet), et le téléphone affichait
// tout d'un bloc. La recherche et le filtre de catégorie sont donc faits PAR LA
// BASE, et au plus PLAFOND_LISTE_CHOIX articles sont affichés, avec le total.
import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import {
  TAILLE_TRANCHE, PLAFOND_LISTE_CHOIX, COLONNES_RECHERCHE_CATALOGUE,
  filtreRecherche, categoriesDistinctes, assemblerTranches,
} from "./materiauxCatalogueV1.js";

const RPC = "catalogue_materiaux_demande";
const CLE_CACHE_CATEGORIES = "catalogue_demande_categories_v1";
const DELAI_SAISIE_MS = 300;

// Liste des catégories : lue une fois par session (colonne categorie seule,
// par tranches), puis gardée en mémoire et en sessionStorage.
let categoriesEnMemoire = null;
async function chargerCategories() {
  if (categoriesEnMemoire) return categoriesEnMemoire;
  try {
    const brut = sessionStorage.getItem(CLE_CACHE_CATEGORIES);
    if (brut) { categoriesEnMemoire = JSON.parse(brut); return categoriesEnMemoire; }
  } catch (_) { /* stockage indisponible : on relit */ }
  const { count, error } = await supabase.rpc(RPC, {}, { count: "exact", head: true });
  if (error || !Number.isInteger(count)) return null;
  const tranches = [];
  for (let debut = 0; debut < count; debut += TAILLE_TRANCHE) {
    tranches.push(supabase.rpc(RPC).select("id, categorie").order("id").range(debut, debut + TAILLE_TRANCHE - 1));
  }
  const out = assemblerTranches(await Promise.all(tranches));
  if (out.error) return null;
  categoriesEnMemoire = categoriesDistinctes(out.data);
  try { sessionStorage.setItem(CLE_CACHE_CATEGORIES, JSON.stringify(categoriesEnMemoire)); } catch (_) {}
  return categoriesEnMemoire;
}

/**
 * @returns {{ articles, total, loading, erreur, categories }}
 *   categories : null tant qu'elles ne sont pas lues (on n'affiche alors que « Tous »).
 */
export function useCatalogueDemande({ recherche, categorie }) {
  const [etat, setEtat] = useState({ articles: [], total: null, loading: true, erreur: null });
  const [categories, setCategories] = useState(categoriesEnMemoire);

  useEffect(() => {
    let annule = false;
    chargerCategories().then(c => { if (!annule && c) setCategories(c); });
    return () => { annule = true; };
  }, []);

  useEffect(() => {
    let annule = false;
    setEtat(e => ({ ...e, loading: true }));
    const minuteur = setTimeout(async () => {
      let q = supabase.rpc(RPC, {}, { count: "exact" });
      const filtre = filtreRecherche(recherche, COLONNES_RECHERCHE_CATALOGUE);
      if (filtre) q = q.or(filtre);
      if (categorie && categorie !== "Tous") q = q.eq("categorie", categorie);
      const { data, count, error } = await q.order("nom").order("id").range(0, PLAFOND_LISTE_CHOIX - 1);
      if (annule) return;
      if (error) console.error(`${RPC}:`, error);
      setEtat({
        articles: Array.isArray(data) ? data : [],
        total: error ? null : count,
        loading: false,
        erreur: error ? "Le catalogue n'a pas pu être chargé. Vérifie ta connexion et réessaie." : null,
      });
    }, recherche ? DELAI_SAISIE_MS : 0);
    return () => { annule = true; clearTimeout(minuteur); };
  }, [recherche, categorie]);

  return { ...etat, categories };
}
