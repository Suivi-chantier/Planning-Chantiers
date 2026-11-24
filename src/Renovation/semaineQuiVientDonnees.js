// src/Renovation/semaineQuiVientDonnees.js — « La semaine qui vient » :
// lancement du moteur de planning (lecture seule, simulerPlanningGlobalV1) sur
// la semaine qui suit, puis assemblage pur (planningSemaineSuivanteV1.mjs).
//
// Partagé par la page « Bilan de semaine » (BilanPeriode.jsx) et le bloc du
// tableau de bord « Planning de la semaine suivante » (projet
// docs/projets/organisation-par-jour.md, tâche 11) : MÊME CHIFFRE = MÊME
// SERVICE. Déplacé de BilanPeriode.jsx à l'identique (même appel du moteur,
// même horizon de 42 jours à partir du lundi de la semaine qui vient).
import { simulerPlanningGlobalV1 } from "./planningEngineDataV1.js";
import { assemblerSemaineQuiVientV1, HORIZON_SEMAINE_QUI_VIENT_JOURS } from "./planningSemaineSuivanteV1.js";

/**
 * @param {{ debut: string, fin: string }} fenetre  fenetreSemaineSuivanteV1(...)
 * @returns {Promise<{ decoupe: object, referentiel: object|null, fins: Map }>}
 *   rejetée si le moteur ne peut pas lire ses données (message lisible).
 */
export async function chargerSemaineQuiVient(fenetre) {
  if (!fenetre?.debut) throw new Error("semaine illisible : la semaine suivante ne peut pas être déterminée");
  const out = await simulerPlanningGlobalV1({ startDate: fenetre.debut, horizonDays: HORIZON_SEMAINE_QUI_VIENT_JOURS });
  return assemblerSemaineQuiVientV1({ resultatMoteur: out, fenetre });
}
