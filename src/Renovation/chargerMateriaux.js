// Lecture de la bibliothèque matériaux (materiaux_bibliotheque) en entier.
//
// L'API Supabase plafonne chaque réponse à 1 000 lignes SANS le signaler. Depuis
// l'import du catalogue SIDER (plus de 23 000 articles), un simple
// `.from("materiaux_bibliotheque").select(...)` ne renvoie donc qu'une partie de
// la bibliothèque : des articles liés à des ouvrages, des besoins ou des
// commandes devenaient introuvables, et des prix d'ouvrages faux.
//
// Toute lecture « de toute la bibliothèque » passe par ici. Les tranches de
// 1 000 sont lues par vagues parallèles jusqu'à la première tranche incomplète.
// Si une seule tranche échoue, la lecture renvoie une erreur plutôt qu'une
// liste partielle.
import { supabase } from "../supabase";
import { TAILLE_TRANCHE, assemblerTranches } from "./materiauxCatalogueV1.js";

const TRANCHES_PAR_VAGUE = 8;

/**
 * @param {string} colonnes  colonnes à lire (garder la liste courte : 23 000 lignes)
 * @param {{ tri?: "nom" }} options  tri local après lecture (la lecture suit l'id)
 * @returns {Promise<{ data: Array|null, error: any }>}
 */
export async function chargerTousLesMateriaux(colonnes, { tri } = {}) {
  const resultats = [];
  for (let vague = 0; ; vague++) {
    const lots = await Promise.all(
      Array.from({ length: TRANCHES_PAR_VAGUE }, (_, i) => {
        const debut = (vague * TRANCHES_PAR_VAGUE + i) * TAILLE_TRANCHE;
        return supabase.from("materiaux_bibliotheque")
          .select(colonnes)
          .order("id", { ascending: true })
          .range(debut, debut + TAILLE_TRANCHE - 1);
      })
    );
    resultats.push(...lots);
    if (lots.some(r => r.error)) break;
    // Une tranche incomplète marque la fin de la table.
    if (lots.some(r => (r.data || []).length < TAILLE_TRANCHE)) break;
  }
  const out = assemblerTranches(resultats);
  if (out.error) {
    console.error("Lecture de la bibliothèque matériaux incomplète :", out.error);
    return out;
  }
  if (tri === "nom") out.data.sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
  return out;
}
