// ─────────────────────────────────────────────────────────────────────────────
// Matériaux d'un ouvrage : à commander, marqués commandés, date de besoin.
//
// UNE seule règle, lue par la page « Commandes à passer » ET par la section
// « La semaine qui vient » du Bilan (même chiffre = même service) :
//   - matériaux prévus = liens matériaux de l'ouvrage connus de la bibliothèque ;
//   - déjà commandés = une ligne de commande saisie sur l'ouvrage (ou, sans
//     ouvrage, sur le même matériau et le même chantier) ;
//   - à commander = prévus sans ligne de commande NI marque « commandé le » ;
//   - marqués commandés = marque « commandé le » posée par « Passer commande »,
//     sans ligne de commande saisie (la saisie réelle se fait à réception) :
//     c'est une livraison attendue ;
//   - date de besoin = la date prévue la plus proche parmi les tâches ;
//   - ouvrage terminé (toutes ses tâches à 100 % dans le phasage) : ses
//     matériaux sans ligne de commande ni marque ne sont plus à commander
//     (on n'en a plus besoin) ; ils sont rendus à part (`plusNecessaires`).
//     En euros, c'est l'enveloppe de l'ouvrage qui sort du reste à commander
//     (resteACommanderEnveloppes, chantierFinance.mjs).
//
// Module PUR : aucune dépendance Supabase, aucune horloge, aucun effet de bord.
// ─────────────────────────────────────────────────────────────────────────────

import { ouvrageTermine, lignesSaisiesOuvrage } from "../chantierFinance.mjs";

const str = v => (v == null ? "" : String(v).trim());
const listeSure = v => (Array.isArray(v) ? v : []);

/**
 * @param {object} args
 * @param {object} args.ouvrage      ouvrage du phasage (id, materiaux_liens, taches)
 * @param {string} args.chantierId
 * @param {Array}  args.lignesCmd    lignes de commande (ouvrage_id, materiau_id, chantier_id)
 * @param {Function} [args.estConnu] matériau présent dans la bibliothèque ?
 * @returns {{ liens: Array, lignesOuvrage: Array, aCommander: Array, marques: Array, plusNecessaires: Array, termine: boolean, dateBesoin: string|null }}
 *   liens / aCommander / marques / plusNecessaires : les liens matériaux bruts de l'ouvrage.
 */
export function etatMateriauxOuvrageV1({ ouvrage, chantierId, lignesCmd = [], estConnu = () => true } = {}) {
  const o = ouvrage || {};
  const tousLiens = listeSure(o.materiaux_liens);
  const liens = tousLiens.filter(ml => ml && ml.materiau_id != null && estConnu(ml.materiau_id));
  const lignesOuvrage = lignesSaisiesOuvrage(o, lignesCmd, chantierId);
  const commandes = new Set(lignesOuvrage.map(l => (l.materiau_id != null ? String(l.materiau_id) : null)).filter(Boolean));
  const termine = ouvrageTermine(o);
  const nonCommandes = liens.filter(ml => !commandes.has(String(ml.materiau_id)) && !ml.commande_le);
  const aCommander = termine ? [] : nonCommandes;
  const plusNecessaires = termine ? nonCommandes : [];
  const marques = liens.filter(ml => ml.commande_le && !commandes.has(String(ml.materiau_id)));
  let dateBesoin = null;
  for (const t of listeSure(o.taches)) {
    const d = str(t && t.date_prevue).slice(0, 10);
    if (d && (!dateBesoin || d < dateBesoin)) dateBesoin = d;
  }
  return { liens, lignesOuvrage, aCommander, marques, plusNecessaires, termine, dateBesoin };
}
