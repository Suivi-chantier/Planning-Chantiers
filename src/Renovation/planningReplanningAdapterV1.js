// ─── CHANTIER 05 — PONT ÉTAT RÉEL → ADAPTATEUR MOTEUR V1 ───────────────────
// Module PUR : aucune lecture/écriture Supabase.
//
// Le chantier 04 reste figé : on ne réécrit pas son adaptateur. Cette couche
// construit l'état réel du phasage, vérifie que son reste à faire brut est
// strictement cohérent avec l'adaptateur V1, puis enrichit le contrat moteur.

import { preparerSimulationPlanningGlobalV1 } from "./planningEngineAdapterV1.js";
import { construireEtatReelPhasagesV1 } from "./planningReplanningStateV1.js";

export const PLANNING_REPLANNING_ADAPTER_VERSION = 1;
const EPS = 0.005;
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

export function preparerSimulationReplanningV1(options = {}) {
  const startDate = String(options?.startDate || "").slice(0, 10);
  const etatReel = construireEtatReelPhasagesV1(options?.phasages || [], { today: startDate });
  const preparation = preparerSimulationPlanningGlobalV1(options);
  const etatParId = new Map(etatReel.travaux.map(t => [t.id, t]));

  let travauxEnrichis = 0;
  let heuresBrutesVerifiees = 0;

  const travaux = preparation.engineInput.travaux.map(travail => {
    const etat = etatParId.get(travail.id) || null;
    if (!etat) {
      throw new Error(`État réel introuvable pour le travail moteur ${travail.id}`);
    }

    const restantAdaptateur = round2(travail?.provenance?.restant_brut_mo || 0);
    const restantEtat = round2(etat.reste_a_faire_heures || 0);
    if (Math.abs(restantAdaptateur - restantEtat) > EPS) {
      throw new Error(
        `Incohérence reste à faire ${travail.id} : adaptateur=${restantAdaptateur}h, état réel=${restantEtat}h`
      );
    }

    travauxEnrichis++;
    heuresBrutesVerifiees += restantEtat;
    return {
      ...travail,
      provenance: {
        ...travail.provenance,
        etat_reel: {
          statut: etat.statut_reel,
          avancement: etat.avancement,
          reste_a_faire_heures: etat.reste_a_faire_heures,
          date_prevue: etat.date_prevue,
          en_retard: etat.en_retard,
          source_verite: etat.provenance.source_verite,
          dernier_avancement_connu_le: etat.provenance.dernier_avancement_connu_le,
        },
      },
    };
  });

  return {
    ...preparation,
    engineInput: {
      ...preparation.engineInput,
      travaux,
    },
    etatReel,
    audit: {
      ...preparation.audit,
      replanning_adapter_version: PLANNING_REPLANNING_ADAPTER_VERSION,
      etat_reel_taches: etatReel.audit.taches_total,
      etat_reel_taches_en_cours: etatReel.audit.taches_en_cours,
      etat_reel_taches_en_retard: etatReel.audit.taches_en_retard,
      etat_reel_travaux_moteur_enrichis: travauxEnrichis,
      etat_reel_heures_brutes_verifiees: round2(heuresBrutesVerifiees),
    },
    invariants: {
      ...preparation.invariants,
      phasage_source_de_verite: true,
      reste_a_faire_verifie_par_etat_reel: true,
      date_passee_ne_termine_pas_tache: true,
      heures_reelles_ne_reduisent_pas_le_reste: true,
    },
  };
}
