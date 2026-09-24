// Enveloppe de comparaison avant / après du moteur de planning.
// Chaque appel à planifierPropositionV1 est rejoué sur la copie figée de
// référence (main af75749). Les deux sorties doivent être identiques, une fois
// retirés UNIQUEMENT les champs ajoutés par le correctif « consignes visibles »
// (voir projection.mjs). Le bilan est écrit en JSON dans le fichier désigné par
// COMPARAISON_MOTEUR_SORTIE à la fin du processus.
import { appendFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import * as reel from "../../src/Renovation/planningEngineV1.js?reel";
import { planifierPropositionV1 as reference } from "../_reference-moteur-af75749/planningEngineV1.mjs";
import { premierEcart, projeterSortieVersReference } from "./projection.mjs";

export * from "../../src/Renovation/planningEngineV1.js?reel";

const bilan = { appels: 0, identiques: 0, erreurs_identiques: 0, differents: [] };

export function planifierPropositionV1(args) {
  bilan.appels++;
  const copie = structuredClone(args);
  let nouvelle, erreurNouvelle = null;
  try { nouvelle = reel.planifierPropositionV1(args); } catch (e) { erreurNouvelle = e; }
  let ancienne, erreurAncienne = null;
  try { ancienne = reference(copie); } catch (e) { erreurAncienne = e; }

  if (erreurNouvelle || erreurAncienne) {
    if (erreurNouvelle && erreurAncienne && erreurNouvelle.message === erreurAncienne.message) bilan.erreurs_identiques++;
    else bilan.differents.push({ appel: bilan.appels, ecart: `erreur : ${erreurNouvelle?.message || "aucune"} / référence : ${erreurAncienne?.message || "aucune"}` });
    if (erreurNouvelle) throw erreurNouvelle;
    return nouvelle;
  }
  const projetee = projeterSortieVersReference(nouvelle);
  if (isDeepStrictEqual(projetee, ancienne)) bilan.identiques++;
  else bilan.differents.push({ appel: bilan.appels, ecart: premierEcart(projetee, ancienne) });
  return nouvelle;
}

process.on("exit", () => {
  const sortie = process.env.COMPARAISON_MOTEUR_SORTIE;
  if (sortie) appendFileSync(sortie, `${JSON.stringify({ script: process.argv[1], ...bilan })}\n`);
});
