// Lecture de la bibliothèque matériaux (materiaux_bibliotheque) en entier,
// avec le client Supabase en paramètre : partagée entre le navigateur
// (chargerMateriaux.js → chargerTousLesMateriaux) et le serveur (mail récap
// du vendredi, projet docs/projets/organisation-par-jour.md, tâche 15).
// Code DÉPLACÉ tel quel de chargerMateriaux.js ; seul le client arrive en
// paramètre. Extension .mjs = importable par Node. Aucune écriture.
//
// L'API Supabase plafonne chaque réponse à 1 000 lignes SANS le signaler.
// Les tranches de 1 000 sont lues par vagues parallèles jusqu'à la première
// tranche incomplète. Si une seule tranche échoue, la lecture renvoie une
// erreur plutôt qu'une liste partielle.
import { TAILLE_TRANCHE, assemblerTranches } from "./materiauxCatalogueV1.mjs";

export const TRANCHES_PAR_VAGUE = 8;

/**
 * @param {object} client    client Supabase (navigateur ou serveur)
 * @param {string} colonnes  colonnes à lire (garder la liste courte : 23 000 lignes)
 * @param {{ tri?: "nom" }} options  tri local après lecture (la lecture suit l'id)
 * @returns {Promise<{ data: Array|null, error: any }>}
 */
export async function chargerTousLesMateriauxAvec(client, colonnes, { tri } = {}) {
  const resultats = [];
  for (let vague = 0; ; vague++) {
    const lots = await Promise.all(
      Array.from({ length: TRANCHES_PAR_VAGUE }, (_, i) => {
        const debut = (vague * TRANCHES_PAR_VAGUE + i) * TAILLE_TRANCHE;
        return client.from("materiaux_bibliotheque")
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
