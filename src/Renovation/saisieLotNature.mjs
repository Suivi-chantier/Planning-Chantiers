// src/Renovation/saisieLotNature.mjs — règles de saisie d'une ligne de
// commande (étape 1B de la refonte du Bilan semaine). Module pur.
//   - une ligne rattachée à un chantier DOIT avoir un lot : sans lot, ses
//     matériaux ne peuvent être déduits d'aucune enveloppe de lot ;
//   - la nature vaut « materiaux » par défaut (sous_traitance, location,
//     dechets, autre au choix).
import { NATURES_COUT, NATURE_DEFAUT } from "../chantierFinance.mjs";

export { NATURES_COUT, NATURE_DEFAUT };

// Indices des lignes rattachées à un chantier sans lot. `chantierDe(ligne, i)`
// rend le chantier EFFECTIF de la ligne (ex. chantier par défaut de la saisie).
export function lignesChantierSansLot(lignes, chantierDe = (l) => l?.chantier_id) {
  const out = [];
  (lignes || []).forEach((l, i) => {
    if (chantierDe(l, i) && !l?.lot_id) out.push(i);
  });
  return out;
}

export function messageLotObligatoire(nb) {
  return nb > 1
    ? `${nb} lignes sont rattachées à un chantier sans lot. Choisis le lot de chaque ligne : sans lot, ses matériaux ne sont déduits d'aucune enveloppe et le reste à commander est faux.`
    : "Une ligne est rattachée à un chantier sans lot. Choisis son lot : sans lot, ses matériaux ne sont déduits d'aucune enveloppe et le reste à commander est faux.";
}

// Nature à enregistrer (valeur inconnue ou vide → matériaux).
export const natureSaisie = (v) => (NATURES_COUT.some(n => n.id === v) ? v : NATURE_DEFAUT);
