// ─── DONNÉES RÉELLES → SIMULATION PLANNING GLOBAL V1 ────────────────────────
// Couche de LECTURE uniquement. Elle charge une photographie cohérente de
// l'horizon puis délègue la préparation et la stabilité au chantier 05, tout en
// conservant le moteur du chantier 04 comme noyau d'ordonnancement.
// Aucune écriture de planning n'existe dans ce module.

import { supabase } from "../supabase";
import { preparerSimulationReplanningV1 } from "./planningReplanningAdapterV1.js";
import { planifierReplanningIncrementalV1 } from "./planningReplanningIncrementalV1.js";
import { diffReplanningAvecContinuiteV1 } from "./planningReplanningDiffContinuityV1.js";
import { construirePlanApplicationReplanningV1 } from "./planningReplanningApplyPlanV1.js";
import { evaluerSecuriteApplicationReplanningV1 } from "./planningReplanningApplySafetyV1.js";
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

  const [phasagesRes, cellsRes, cellsAllRes, resourcesRes, eventsRes, constraintsRes, configRes] = await Promise.all([
    supabase.from("phasages")
      .select("id,chantier_id,chantier_nom,ouvrages,plan_travaux,updated_at"),
    supabase.from("planning_cells")
      .select("id,week_id,chantier_id,jour,planifie,reel,taches,ouvriers,vehicules")
      .in("week_id", horizon.week_ids),
    // Lecture légère toutes semaines : uniquement pour les gardes d'application
    // (allocation liée après horizon + invariant date_prevue = premier jour
    // planifié toutes semaines). Le moteur reste alimenté par `cellsRes` horizon.
    supabase.from("planning_cells")
      .select("id,week_id,chantier_id,jour,taches"),
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
    cellulesToutes: verifier(cellsAllRes, "Planning global pour gardes d'application"),
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
      cellules_total_snapshot_securite: raw.cellulesToutes.length,
      ressources: raw.ressources.length,
      evenements_ressources: raw.evenementsRessources.length,
      contraintes: raw.contraintes.length,
      chantiers_config: config.chantiers.length,
      groupes_types_config: config.groupesTypes.length,
      equipes_config: config.equipes.length,
    },
    invariants: {
      lecture_seule: true,
      filtre_cellules_moteur: "planning_cells limité aux week_id chevauchant l'horizon",
      snapshot_cellules_securite: "lecture légère toutes semaines, sans écriture",
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
      chantiers: data.config.chantiers.map(c => ({
        id:c.id, nom:c.nom || c.id, couleur:c.couleur || null,
        statut:c.statut || null, operation_id:c.operation_id || null, site_id:c.site_id || null,
      })),
      ressources: data.ressources.map(r => ({ id:r.id, nom:r.nom, nom_planning:r.nom_planning, kind:r.kind })),
    },
    snapshot_application: {
      cellules: data.cellules,
      cellules_toutes: data.cellulesToutes,
      ressources: data.ressources,
      phasages: data.phasages,
    },
    preparation,
    invariants: { ...data.invariants, aucune_ecriture_persistante: true },
  };
}

/**
 * Point d'entrée lecture seule de la simulation globale.
 * - sans `replanningTrigger` : recalcul global, comportement attendu du panneau ;
 * - avec `replanningTrigger` : recalcul incrémental, le forecast compatible hors
 *   périmètre d'impact est préservé sans être persisté ni verrouillé en base.
 */
export async function simulerPlanningGlobalV1(options = {}) {
  const prepared = await preparerDonneesReellesMoteurV1(options);
  const proposition = planifierReplanningIncrementalV1({
    engineInput: prepared.preparation.engineInput,
    forecast: prepared.preparation.forecastCourant.allocations_recalculables,
    trigger: options?.replanningTrigger || null,
  });
  const diff = diffReplanningAvecContinuiteV1({
    forecast: prepared.preparation.forecastCourant.allocations_recalculables,
    proposition,
    travaux: prepared.preparation.engineInput.travaux,
  });
  const planApplication = construirePlanApplicationReplanningV1({
    cellules: prepared.snapshot_application.cellules,
    forecastCourant: prepared.preparation.forecastCourant,
    proposition,
    ressources: prepared.snapshot_application.ressources,
    startDate: prepared.horizon.start_date,
    horizonDays: prepared.horizon.horizon_days,
  });
  const securiteApplication = evaluerSecuriteApplicationReplanningV1({
    planApplication,
    cellulesToutes: prepared.snapshot_application.cellules_toutes,
    diff,
    phasages: prepared.snapshot_application.phasages,
    startDate: prepared.horizon.start_date,
    horizonDays: prepared.horizon.horizon_days,
  });

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    horizon: prepared.horizon,
    replanning_trigger: options?.replanningTrigger || null,
    replanning_mode: proposition?.replanning?.incremental?.mode || "full_recalc",
    audit_lecture: prepared.audit_lecture,
    audit_adaptateur: prepared.preparation.audit,
    audit_etat_reel: prepared.preparation.etatReel?.audit || null,
    audit_stabilite_forecast: prepared.preparation.stabiliteForecast?.audit || null,
    audit_stabilite_dates: proposition.replanning?.stabilite_dates || null,
    audit_impact_incremental: proposition.replanning?.incremental?.impact_audit || null,
    referentiel: prepared.referentiel,
    forecast_courant: prepared.preparation.forecastCourant,
    travaux_exclus: prepared.preparation.travaux_exclus,
    warnings_adaptateur: prepared.preparation.warnings,
    warnings_etat_reel: prepared.preparation.etatReel?.warnings || [],
    proposition,
    diff_forecast: diff,
    plan_application: planApplication,
    securite_application: securiteApplication,
    invariants: {
      ...prepared.invariants,
      moteur_deterministe: true,
      proposition_uniquement: true,
      application_automatique: false,
      plan_application_est_un_apercu_sans_ecriture: true,
      securite_application_evaluee_avant_toute_future_ecriture: true,
      compare_before_write_requis_avant_toute_future_application: true,
      phasage_updated_at_requis_pour_future_transaction: true,
      diff_par_tache: true,
      diff_explicable_sans_cause_inventee: true,
      phasage_source_de_verite: true,
      reste_a_faire_verifie_par_etat_reel: true,
      forecast_est_une_preference_soft: true,
      contraintes_stabilite_non_persistantes: true,
      mode_incremental_optionnel_sans_ecriture: true,
      continuite_multi_jours_expliquee_depuis_trace_moteur: true,
    },
  };
}
