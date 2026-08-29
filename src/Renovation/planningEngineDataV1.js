// ─── DONNÉES RÉELLES → SIMULATION PLANNING GLOBAL V1 ────────────────────────
// Couche de LECTURE uniquement. Elle charge une photographie cohérente de
// l'horizon puis délègue la préparation au pont de replanification, qui conserve
// le moteur du chantier 04 intact tout en raccordant l'état réel du phasage.
// Aucune écriture de planning n'existe dans ce module.

import { supabase } from "../supabase";
import { preparerSimulationReplanningV1 } from "./planningReplanningAdapterV1.js";
import { planifierPropositionV1 } from "./planningEngineV1.js";
import { diffForecastPropositionV1 } from "./planningEngineDiffV1.js";
import { metaHorizonMoteurV1, parserConfigMoteurV1 } from "./planningEngineDataHelpersV1.js";

const CONFIG_KEYS = ["chantiers", "groupes_types", "equipes"];

function verifier(res, label) {
  if (res?.error) {
    const e = new Error(`${label} : ${res.error.message || "erreur Supabase"}`);
    e.cause = res.error;
    throw e;
  }
  return res?.data || [];
}

/**
 * Charge le snapshot brut nécessaire à la simulation globale.
 * Aucune fonction de ce module ne persiste de donnée.
 */
export async function chargerDonneesSimulationPlanningGlobalV1({ startDate, horizonDays = 42 } = {}) {
  const horizon = metaHorizonMoteurV1(startDate, horizonDays);

  const [phasagesRes, cellsRes, resourcesRes, eventsRes, constraintsRes, configRes] = await Promise.all([
    supabase.from("phasages")
      .select("id,chantier_id,chantier_nom,ouvrages,plan_travaux,updated_at"),
    supabase.from("planning_cells")
      .select("id,week_id,chantier_id,jour,taches,ouvriers")
      .in("week_id", horizon.week_ids),
    supabase.from("planning_resources")
      .select("id,nom,nom_planning,kind,actif,capacite_facteur,utilisateur_id,auth_user_id")
      .eq("actif", true)
      .order("nom_planning"),
    supabase.from("planning_resource_events")
      .select("id,resource_id,type,date_debut,date_fin,toute_journee,heures_indisponibles,capacite_heures,motif,motif_code,source,details,actif")
      .eq("actif", true)
      .lte("date_debut", horizon.end_date)
      .gte("date_fin", horizon.start_date),
    supabase.from("planning_constraints")
      .select("id,type,scope,chantier_id,groupe_type_id,tache_id,allocation_id,hard,priority,date_debut,date_fin,config,label,source,actif,created_at,updated_at")
      .eq("actif", true),
    supabase.from("planning_config")
      .select("key,value")
      .in("key", CONFIG_KEYS),
  ]);

  const configRows = verifier(configRes, "Configuration planning");
  const config = parserConfigMoteurV1(configRows);
  const raw = {
    phasages: verifier(phasagesRes, "Phasages"),
    cellules: verifier(cellsRes, "Planning courant"),
    ressources: verifier(resourcesRes, "Ressources"),
    evenementsRessources: verifier(eventsRes, "Événements ressources"),
    contraintes: verifier(constraintsRes, "Contraintes planning"),
    config,
  };

  return {
    horizon,
    ...raw,
    audit_lecture: {
      phasages: raw.phasages.length,
      cellules: raw.cellules.length,
      ressources: raw.ressources.length,
      evenements_ressources: raw.evenementsRessources.length,
      contraintes: raw.contraintes.length,
      chantiers_config: config.chantiers.length,
      groupes_types_config: config.groupesTypes.length,
      equipes_config: config.equipes.length,
    },
    invariants: {
      lecture_seule: true,
      filtre_cellules: "planning_cells limité aux week_id chevauchant l'horizon",
      filtre_evenements: "date_debut <= fin horizon ET date_fin >= début horizon",
    },
  };
}

/**
 * Prépare seulement le contrat moteur depuis les données réelles.
 * Le pont chantier 05 vérifie la cohérence état réel ↔ reste à faire du moteur.
 */
export async function preparerDonneesReellesMoteurV1(options = {}) {
  const data = await chargerDonneesSimulationPlanningGlobalV1(options);
  const preparation = preparerSimulationReplanningV1({
    phasages: data.phasages,
    chantiers: data.config.chantiers,
    cellules: data.cellules,
    ressources: data.ressources,
    evenementsRessources: data.evenementsRessources,
    contraintes: data.contraintes,
    groupesTypes: data.config.groupesTypes,
    equipes: data.config.equipes,
    startDate: data.horizon.start_date,
    horizonDays: data.horizon.horizon_days,
  });
  return {
    horizon: data.horizon,
    audit_lecture: data.audit_lecture,
    referentiel: {
      chantiers: data.config.chantiers.map(c => ({ id:c.id, nom:c.nom || c.id, couleur:c.couleur || null, statut:c.statut || null })),
      ressources: data.ressources.map(r => ({ id:r.id, nom:r.nom, nom_planning:r.nom_planning, kind:r.kind })),
    },
    preparation,
    invariants: { ...data.invariants, aucune_ecriture_persistante: true },
  };
}

/**
 * Point d'entrée lecture seule de la simulation globale.
 * Le moteur du chantier 04 reste inchangé ; la provenance état réel est ajoutée
 * en amont pour préparer la replanification continue du chantier 05.
 */
export async function simulerPlanningGlobalV1(options = {}) {
  const prepared = await preparerDonneesReellesMoteurV1(options);
  const proposition = planifierPropositionV1(prepared.preparation.engineInput);
  const diff = diffForecastPropositionV1({
    forecast: prepared.preparation.forecastCourant.allocations_recalculables,
    proposition: proposition.allocations_proposees,
    nonPlanifies: proposition.non_planifies,
  });
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    horizon: prepared.horizon,
    audit_lecture: prepared.audit_lecture,
    audit_adaptateur: prepared.preparation.audit,
    audit_etat_reel: prepared.preparation.etatReel?.audit || null,
    referentiel: prepared.referentiel,
    forecast_courant: prepared.preparation.forecastCourant,
    travaux_exclus: prepared.preparation.travaux_exclus,
    warnings_adaptateur: prepared.preparation.warnings,
    warnings_etat_reel: prepared.preparation.etatReel?.warnings || [],
    proposition,
    diff_forecast: diff,
    invariants: {
      ...prepared.invariants,
      moteur_deterministe: true,
      proposition_uniquement: true,
      application_automatique: false,
      diff_par_tache: true,
      phasage_source_de_verite: true,
      reste_a_faire_verifie_par_etat_reel: true,
    },
  };
}
