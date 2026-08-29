// ─── CHANTIER 05 — PONT ÉTAT RÉEL → ADAPTATEUR MOTEUR V1 ───────────────────
// Module PUR : aucune lecture/écriture Supabase.
//
// Le chantier 04 reste figé : on ne réécrit pas son adaptateur. Cette couche
// construit l'état réel du phasage, vérifie que son reste à faire brut est
// strictement cohérent avec l'adaptateur V1, puis ajoute les préférences SOFT
// de stabilité issues du forecast courant.

import { preparerSimulationPlanningGlobalV1 } from "./planningEngineAdapterV1.js";
import { construireEtatReelPhasagesV1 } from "./planningReplanningStateV1.js";
import { appliquerStabiliteForecastV1 } from "./planningReplanningStabilityV1.js";
import { normaliserRessource, RESOURCE_KINDS } from "./planningResourceModelV1.js";

export const PLANNING_REPLANNING_ADAPTER_VERSION = 1;
const EPS = 0.005;
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const txt = v => String(v ?? "").trim();

function sitesParChantierDepuisReferentiel(chantiers = []) {
  const map = new Map();
  for (const chantier of Array.isArray(chantiers) ? chantiers : []) {
    const chantierId = txt(chantier?.id);
    if (!chantierId) continue;
    const siteId = txt(chantier?.site_id) || txt(chantier?.operation_id) || chantierId;
    map.set(chantierId, siteId);
  }
  return map;
}

function cleTravail(chantierId, tacheId) {
  const c = txt(chantierId), t = txt(tacheId);
  return c && t ? `${c}::${t}` : null;
}

// Cas exceptionnel chantier 05 : un groupe peut être EXTERNE par défaut tout
// en ayant déjà une affectation humaine interne explicite dans le forecast.
// Cette affectation vaut override volontaire, exactement comme `tache.ouvriers`
// dans le phasage. Elle ne doit JAMAIS élargir le pool d'un groupe interne.
function overridesInternesPourGroupesExternes({ preparation, ressources = [] } = {}) {
  const exclusExternes = new Set((preparation?.travaux_exclus || [])
    .filter(x => x?.type === "equipe_groupe_externe")
    .map(x => txt(x?.travail_id))
    .filter(Boolean));
  if (!exclusExternes.size) return new Map();

  const nomParResourceId = new Map((Array.isArray(ressources) ? ressources : [])
    .map(normaliserRessource)
    .filter(r => r.id && r.actif !== false && r.kind === RESOURCE_KINDS.PERSONNE)
    .map(r => [r.id, txt(r.nom_planning || r.nom)]));

  const result = new Map();
  for (const allocation of preparation?.forecastCourant?.allocations_recalculables || []) {
    const key = cleTravail(allocation?.chantier_id, allocation?.tache_id);
    if (!key || !exclusExternes.has(key)) continue;
    const noms = (Array.isArray(allocation?.resource_ids) ? allocation.resource_ids : [])
      .map(id => nomParResourceId.get(txt(id)))
      .filter(Boolean);
    if (!noms.length) continue;
    if (!result.has(key)) result.set(key, new Set());
    noms.forEach(nom => result.get(key).add(nom));
  }
  return new Map([...result].map(([key, noms]) => [key, [...noms].sort()]));
}

function appliquerOverridesExternesAuxPhasages(phasages = [], overrides = new Map()) {
  if (!(overrides instanceof Map) || overrides.size === 0) return phasages;
  return (Array.isArray(phasages) ? phasages : []).map(ph => {
    const chantierId = txt(ph?.chantier_id);
    let changed = false;
    const ouvrages = (Array.isArray(ph?.ouvrages) ? ph.ouvrages : []).map(ouvrage => {
      const taches = (Array.isArray(ouvrage?.taches) ? ouvrage.taches : []).map(tache => {
        const key = cleTravail(chantierId, tache?.id);
        const noms = key ? overrides.get(key) : null;
        if (!noms?.length) return tache;
        changed = true;
        return { ...tache, ouvriers: noms };
      });
      return taches.some((t, i) => t !== ouvrage?.taches?.[i]) ? { ...ouvrage, taches } : ouvrage;
    });
    return changed ? { ...ph, ouvrages } : ph;
  });
}

export function preparerSimulationReplanningV1(options = {}) {
  const startDate = String(options?.startDate || "").slice(0, 10);
  const etatReel = construireEtatReelPhasagesV1(options?.phasages || [], { today: startDate });

  // Première passe inchangée = vérité du chantier 04. Elle sert à détecter les
  // seules exclusions externes pour lesquelles le forecast apporte déjà un
  // override interne explicite. Si aucun override n'existe, aucune seconde
  // interprétation n'est introduite.
  const preparationInitiale = preparerSimulationPlanningGlobalV1(options);
  const overridesExternes = overridesInternesPourGroupesExternes({
    preparation: preparationInitiale,
    ressources: options?.ressources || [],
  });
  const phasagesAvecOverrides = appliquerOverridesExternesAuxPhasages(options?.phasages || [], overridesExternes);
  const preparation = overridesExternes.size
    ? preparerSimulationPlanningGlobalV1({ ...options, phasages: phasagesAvecOverrides })
    : preparationInitiale;

  const etatParId = new Map(etatReel.travaux.map(t => [t.id, t]));
  const sitesParChantier = sitesParChantierDepuisReferentiel(options?.chantiers || []);

  let travauxEnrichis = 0;
  let heuresBrutesVerifiees = 0;

  const travauxEtatReel = preparation.engineInput.travaux.map(travail => {
    const etat = etatParId.get(travail.id) || null;
    if (!etat) throw new Error(`État réel introuvable pour le travail moteur ${travail.id}`);

    const restantAdaptateur = round2(travail?.provenance?.restant_brut_mo || 0);
    const restantEtat = round2(etat.reste_a_faire_heures || 0);
    if (Math.abs(restantAdaptateur - restantEtat) > EPS) {
      throw new Error(`Incohérence reste à faire ${travail.id} : adaptateur=${restantAdaptateur}h, état réel=${restantEtat}h`);
    }

    travauxEnrichis++;
    heuresBrutesVerifiees += restantEtat;
    const overrideExterne = overridesExternes.get(travail.id) || null;
    return {
      ...travail,
      provenance: {
        ...travail.provenance,
        ...(overrideExterne ? {
          override_groupe_externe_forecast: {
            actif: true,
            ressource_noms: overrideExterne,
            source: "forecast_courant_explicitement_affecte",
            contrainte_hard: true,
          },
        } : {}),
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

  const stabilite = appliquerStabiliteForecastV1({
    travaux: travauxEtatReel,
    allocationsForecast: preparation.forecastCourant.allocations_recalculables,
    sitesParChantier,
  });

  return {
    ...preparation,
    engineInput: { ...preparation.engineInput, travaux: stabilite.travaux },
    etatReel,
    stabiliteForecast: stabilite,
    overridesExternesForecast: Object.fromEntries(overridesExternes),
    audit: {
      ...preparation.audit,
      replanning_adapter_version: PLANNING_REPLANNING_ADAPTER_VERSION,
      etat_reel_taches: etatReel.audit.taches_total,
      etat_reel_taches_en_cours: etatReel.audit.taches_en_cours,
      etat_reel_taches_en_retard: etatReel.audit.taches_en_retard,
      etat_reel_travaux_moteur_enrichis: travauxEnrichis,
      etat_reel_heures_brutes_verifiees: round2(heuresBrutesVerifiees),
      overrides_groupes_externes_depuis_forecast: overridesExternes.size,
      stabilite_travaux_avec_forecast: stabilite.audit.travaux_avec_forecast,
      stabilite_preferences_forecast_conservees: stabilite.audit.travaux_avec_preference_forecast_conservee,
      stabilite_preferences_site_appliquees: stabilite.audit.travaux_avec_affinite_site,
      stabilite_ressources_site_compatibles: stabilite.audit.ressources_site_compatibles,
      stabilite_ressources_hors_pool_ignorees: stabilite.audit.ressources_forecast_hors_pool,
    },
    invariants: {
      ...preparation.invariants,
      phasage_source_de_verite: true,
      reste_a_faire_verifie_par_etat_reel: true,
      date_passee_ne_termine_pas_tache: true,
      heures_reelles_ne_reduisent_pas_le_reste: true,
      forecast_est_une_preference_soft: true,
      pool_metier_hard_inchange_par_forecast: true,
      exception_pool: "un groupe externe peut être remplacé uniquement par les ressources internes déjà explicitement affectées dans le forecast courant",
      override_externe_restreint_aux_ressources_forecast: true,
      continuite_operation_filtre_par_pool_metier: true,
      resolution_site: "site_id > operation_id > chantier_id",
    },
  };
}
