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
//
// Depuis la tâche 15 (organisation-par-jour), le code vit dans
// chargerMateriauxLecture.mjs (client Supabase en paramètre), pour que le
// serveur lise la bibliothèque exactement comme le navigateur.
import { supabase } from "../supabase";
import { chargerTousLesMateriauxAvec } from "./chargerMateriauxLecture.mjs";

/**
 * @param {string} colonnes  colonnes à lire (garder la liste courte : 23 000 lignes)
 * @param {{ tri?: "nom" }} options  tri local après lecture (la lecture suit l'id)
 * @returns {Promise<{ data: Array|null, error: any }>}
 */
export function chargerTousLesMateriaux(colonnes, options = {}) {
  return chargerTousLesMateriauxAvec(supabase, colonnes, options);
}
