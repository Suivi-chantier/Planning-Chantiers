// ─── PLANNING ENGINE V1 ──────────────────────────────────────────────────────
// Premier noyau déterministe du chantier 04 « Moteur global de planification ».
//
// IMPORTANT : ce module est PUR. Il ne lit et n'écrit aucune donnée Supabase.
// Il transforme un état normalisé en PROPOSITION d'allocations. L'application
// éventuelle au planning fera l'objet d'une étape séparée avec aperçu/diff et
// confirmation humaine.
//
// Unités :
// - `heures_mo_restantes` = heures de main-d'œuvre à produire ;
// - `duree` d'une allocation = durée écoulée pour chaque membre de l'équipe ;
// - MO produite par une allocation = duree × nombre de ressources.

import { normaliserRessource, RESOURCE_KINDS } from "./planningResourceModelV1.js";
import { calculerCapaciteRessourcePourDate, capaciteBasePlanningPourDate } from "./planningResourceCapacityV1.js";
import {
  CONSTRAINT_TYPES,
  contrainteSapplique,
  evaluerContraintesPlanning,
  normaliserContraintePlanning,
} from "./planningConstraintModelV1.js";
import { regleGroupe } from "./planningRulesV1.js";

export const PLANNING_ENGINE_VERSION = 1;
const EPS = 0.005;

const str = v => String(v ?? "").trim();
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const uniq = xs => [...new Set((Array.isArray(xs) ? xs : []).map(str).filter(Boolean))];
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function dateOnly(v) {
  const s = str(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function dateAddDays(iso, delta) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateDiffDays(a, b) {
  const da = new Date(`${a}T12:00:00`);
  const db = new Date(`${b}T12:00:00`);
  return Math.round((da - db) / 86400000);
}

function jourPlanifiablePrecedent(date) {
  let d = dateAddDays(date, -1);
  for (let i = 0; i < 7; i++) {
    if (capaciteBasePlanningPourDate(d) > EPS) return d;
    d = dateAddDays(d, -1);
  }
  return null;
}

export function normaliserTravailMoteurV1(value, index = 0) {
  const t = value && typeof value === "object" ? value : {};
  const groupe = str(t.groupe_type_id) || null;
  const groupRule = regleGroupe(groupe);
  const heures = Math.max(0, num(t.heures_mo_restantes ?? t.heures_restantes ?? t.remaining_mo_hours, 0));
  const crew = Math.max(1, Math.round(num(t.crew_size ?? t.taille_equipe, 1)));
  return {
    ...t,
    id: str(t.id || t.tache_id) || `travail_${index + 1}`,
    tache_id: str(t.tache_id || t.id) || null,
    chantier_id: str(t.chantier_id) || null,
    site_id: str(t.site_id || t.operation_id || t.chantier_id) || null,
    groupe_type_id: groupe,
    texte: str(t.texte || t.text || t.nom) || "Tâche sans libellé",
    heures_mo_restantes: round2(heures),
    crew_size: crew,
    candidate_resource_ids: uniq(t.candidate_resource_ids || t.resource_ids_candidats),
    preferred_resource_ids: uniq(t.preferred_resource_ids || t.resource_ids_preferes),
    predecesseur_ids: uniq(t.predecesseur_ids || t.predecesseurs),
    priority: num(t.priority, 0),
    ordre_groupe: num(t.ordre_groupe, groupRule?.ordre ?? 9999),
    ordre_tache: num(t.ordre_tache ?? t.chrono_ordre, index),
    fractionnable: t.fractionnable !== false && groupRule?.fractionnable_default !== false,
  };
}

export function normaliserAllocationExistanteV1(value, index = 0) {
  const a = value && typeof value === "object" ? value : {};
  return {
    ...a,
    allocation_uid: str(a.allocation_uid || a.id) || `allocation_existante_${index + 1}`,
    tache_id: str(a.tache_id) || null,
    chantier_id: str(a.chantier_id) || null,
    site_id: str(a.site_id || a.operation_id || a.chantier_id) || null,
    date: dateOnly(a.date),
    duree: Math.max(0, num(a.duree, 0)),
    resource_ids: uniq(a.resource_ids || a.ouvriers_resource_ids),
    locked: a.locked === true,
  };
}

function keyCharge(resourceId, date) {
  return `${resourceId}@@${date}`;
}

function ajouterCharge(map, resourceId, date, heures, chantierId = null, siteId = null) {
  const key = keyCharge(resourceId, date);
  const prev = map.get(key) || { heures: 0, chantiers: new Set(), sites: new Set() };
  prev.heures = round2(prev.heures + Math.max(0, num(heures, 0)));
  if (chantierId) prev.chantiers.add(String(chantierId));
  const site = str(siteId || chantierId);
  if (site) prev.sites.add(site);
  map.set(key, prev);
}

export function construireChargeExistanteV1(allocations = []) {
  const map = new Map();
  (Array.isArray(allocations) ? allocations : [])
    .map(normaliserAllocationExistanteV1)
    .filter(a => a.date && a.duree > EPS)
    .forEach(a => a.resource_ids.forEach(rid => ajouterCharge(map, rid, a.date, a.duree, a.chantier_id, a.site_id)));
  return map;
}

function contexteTravail(t) {
  return {
    chantier_id: t.chantier_id,
    groupe_type_id: t.groupe_type_id,
    tache_id: t.tache_id,
  };
}

function contraintesPourTravail(contraintes, travail) {
  const ctx = contexteTravail(travail);
  return (Array.isArray(contraintes) ? contraintes : [])
    .map(normaliserContraintePlanning)
    .filter(c => contrainteSapplique(c, ctx));
}

function deadlineTravail(contraintes, travail) {
  const dates = contraintesPourTravail(contraintes, travail)
    .filter(c => c.type === CONSTRAINT_TYPES.DEADLINE && c.date_fin)
    .map(c => c.date_fin)
    .sort();
  return dates[0] || null;
}

function prioriteContrainte(contraintes, travail) {
  return contraintesPourTravail(contraintes, travail)
    .filter(c => c.type === CONSTRAINT_TYPES.PRIORITY)
    .reduce((s, c) => s + num(c.priority, 0), 0);
}

function predInconnus(travail, idsTravaux, completedIds) {
  return travail.predecesseur_ids.filter(id => !idsTravaux.has(id) && !completedIds.has(id));
}

function predsTermines(travail, etats, completedIds) {
  return travail.predecesseur_ids.every(id => completedIds.has(id) || etats.get(id)?.termine === true);
}

function dernierJourTravail(travailId, allocationsProposees) {
  const dates = allocationsProposees.filter(a => a.travail_id === travailId).map(a => a.date).sort();
  return dates.at(-1) || null;
}

function scorerTravail({ travail, date, contraintes, allocationsProposees }) {
  let score = travail.priority + prioriteContrainte(contraintes, travail);
  const last = dernierJourTravail(travail.id, allocationsProposees);
  if (last) {
    const delta = dateDiffDays(date, last);
    if (delta === 0) score += 300;
    else if (delta <= 3) score += 180;
    else if (delta <= 7) score += 80;
  }
  const deadline = deadlineTravail(contraintes, travail);
  if (deadline) {
    const jours = dateDiffDays(deadline, date);
    if (jours < 0) score += 1000 + Math.abs(jours) * 20;
    else score += Math.max(0, 300 - jours * 5);
  }
  score += Math.max(0, 150 - Math.min(150, travail.ordre_groupe));
  return score;
}

function chargePour(charge, resourceId, date) {
  return charge.get(keyCharge(resourceId, date)) || { heures: 0, chantiers: new Set(), sites: new Set() };
}

function choisirEquipe({ travail, date, ressources, evenements, contraintes, charge, requiredElapsed = null, continuiteMultiJours = false }) {
  const candidatesSet = new Set(travail.candidate_resource_ids);
  const allCandidates = ressources.filter(r =>
    r.actif !== false
    && r.kind === RESOURCE_KINDS.PERSONNE
    && (candidatesSet.size === 0 || candidatesSet.has(r.id))
  );
  const previousPlanningDate = continuiteMultiJours ? jourPlanifiablePrecedent(date) : null;
  const preferenceSource = str(travail?.stability_forecast?.preference_source);

  const scored = [];
  for (const r of allCandidates) {
    const load = chargePour(charge, r.id, date);
    // Contrat chantier 04 : une ressource reste sur un seul site physique par
    // journée. Deux logements/chantiers d'une même opération peuvent partager
    // le même `site_id`; un changement de site est différé au prochain jour.
    if (load.sites.size > 0 && !load.sites.has(travail.site_id)) continue;
    const capacite = calculerCapaciteRessourcePourDate({
      resource: r,
      dateISO: date,
      evenements,
      heuresDejaAllouees: load.heures,
    });
    if (capacite.capacite_disponible <= EPS) continue;
    // Une tâche non fractionnable exige un créneau complet pour chaque membre
    // de l'équipe. On élimine donc ici les ressources qui forceraient un split.
    if (!travail.fractionnable && requiredElapsed != null && capacite.capacite_disponible + EPS < requiredElapsed) continue;

    const cEval = evaluerContraintesPlanning({
      contraintes,
      context: contexteTravail(travail),
      dateISO: date,
      resourceId: r.id,
    });
    if (!cEval.eligible) continue;

    const preferred = travail.preferred_resource_ids.includes(r.id);
    const sameChantierToday = load.chantiers.has(travail.chantier_id);
    const sameSiteToday = !sameChantierToday && load.sites.has(travail.site_id);
    const previousLoad = previousPlanningDate ? chargePour(charge, r.id, previousPlanningDate) : null;
    const previousSameSite = Boolean(previousLoad?.sites?.has(travail.site_id));
    const preferenceTache = preferred && preferenceSource === "forecast_tache";
    const preferenceSite = preferred && preferenceSource === "forecast_site";
    const preferenceGroupe = preferred && !preferenceTache && !preferenceSite;

    let score = capacite.capacite_disponible;
    if (preferred) score += 1000;
    if (sameChantierToday) score += 350;
    else if (sameSiteToday) score += 220;

    scored.push({
      resource: r,
      capacite,
      constraintEval: cEval,
      score,
      preferenceTache,
      preferenceSite,
      preferenceGroupe,
      sameChantierToday,
      sameSiteToday,
      previousSameSite,
      previousPlanningDate,
    });
  }

  if (continuiteMultiJours) {
    // Hiérarchie SOFT explicite, sans coefficient arbitraire :
    // affectation de tâche déjà communiquée > continuité aujourd'hui >
    // continuité avec le jour ouvré précédent > affinité site forecast >
    // préférence statique du groupe > capacité disponible.
    scored.sort((a, b) =>
      (Number(b.preferenceTache) - Number(a.preferenceTache))
      || (Number(b.sameChantierToday) - Number(a.sameChantierToday))
      || (Number(b.sameSiteToday) - Number(a.sameSiteToday))
      || (Number(b.previousSameSite) - Number(a.previousSameSite))
      || (Number(b.preferenceSite) - Number(a.preferenceSite))
      || (Number(b.preferenceGroupe) - Number(a.preferenceGroupe))
      || (b.capacite.capacite_disponible - a.capacite.capacite_disponible)
      || String(a.resource.id).localeCompare(String(b.resource.id))
    );
  } else {
    scored.sort((a, b) =>
      (b.score - a.score)
      || (b.capacite.capacite_disponible - a.capacite.capacite_disponible)
      || String(a.resource.id).localeCompare(String(b.resource.id))
    );
  }

  const selected = scored.slice(0, travail.crew_size);
  if (selected.length < travail.crew_size) {
    return {
      ok: false,
      reason: `Équipe insuffisante : ${selected.length}/${travail.crew_size} ressource(s) disponible(s)`,
      candidates: scored,
    };
  }
  return { ok: true, selected, candidates: scored, previousPlanningDate };
}

function raisonNonPlanifie({ travail, idsTravaux, completedIds, etats, contraintes, horizonEnd }) {
  const missing = predInconnus(travail, idsTravaux, completedIds);
  if (missing.length) return `Prédécesseur(s) introuvable(s) : ${missing.join(", ")}`;
  if (!predsTermines(travail, etats, completedIds)) return "Prédécesseur(s) non terminé(s) dans l'horizon";
  const applicable = contraintesPourTravail(contraintes, travail);
  const fixedFuture = applicable
    .filter(c => [CONSTRAINT_TYPES.NOT_BEFORE, CONSTRAINT_TYPES.FIXED_DATE].includes(c.type) && c.date_debut > horizonEnd)
    .sort((a, b) => a.date_debut.localeCompare(b.date_debut))[0];
  if (fixedFuture) return `Contrainte de date hors horizon : ${fixedFuture.date_debut}`;
  return "Capacité / ressources insuffisantes ou contraintes incompatibles dans l'horizon";
}

/**
 * Calcule une proposition globale multi-chantiers.
 *
 * Le moteur ne modifie jamais les allocations existantes et ne persiste rien.
 * Il consomme leur charge pour ne pas sur-allouer les ressources.
 *
 * `continuiteMultiJours` est une extension optionnelle du chantier 05. Sa valeur
 * par défaut reste false afin de figer le comportement historique du chantier 04.
 */
export function planifierPropositionV1({
  travaux = [],
  ressources = [],
  evenementsRessources = [],
  contraintes = [],
  allocationsExistantes = [],
  completedTaskIds = [],
  startDate,
  horizonDays = 42,
  continuiteMultiJours = false,
} = {}) {
  const debut = dateOnly(startDate);
  if (!debut) throw new Error("startDate ISO requis pour le moteur de planification");

  const jobs = (Array.isArray(travaux) ? travaux : []).map(normaliserTravailMoteurV1);
  const resourceList = (Array.isArray(ressources) ? ressources : [])
    .map(normaliserRessource)
    .filter(r => r.id);
  const constraints = (Array.isArray(contraintes) ? contraintes : []).map(normaliserContraintePlanning);
  const existing = (Array.isArray(allocationsExistantes) ? allocationsExistantes : []).map(normaliserAllocationExistanteV1);
  const completedIds = new Set(uniq(completedTaskIds));
  const idsTravaux = new Set(jobs.map(t => t.id));

  const duplicateIds = jobs.map(t => t.id).filter((id, i, arr) => arr.indexOf(id) !== i);
  if (duplicateIds.length) throw new Error(`IDs de travaux dupliqués : ${uniq(duplicateIds).join(", ")}`);

  const etats = new Map(jobs.map(t => [t.id, {
    restant_mo: t.heures_mo_restantes,
    termine: t.heures_mo_restantes <= EPS,
    finish_date: t.heures_mo_restantes <= EPS ? debut : null,
  }]));
  const charge = construireChargeExistanteV1(existing);
  const allocations = [];
  const warnings = [];
  const decisionTrace = [];
  const attempts = new Map(jobs.map(t => [t.id, { dates_bloquees: 0, dates_sans_equipe: 0 }]));

  const horizon = Math.max(1, Math.min(366, Math.round(num(horizonDays, 42))));
  const horizonEnd = dateAddDays(debut, horizon - 1);

  for (let dayIndex = 0; dayIndex < horizon; dayIndex++) {
    const date = dateAddDays(debut, dayIndex);
    const allocatedToday = new Set();

    let progress = true;
    while (progress) {
      progress = false;
      const eligible = [];

      for (const t of jobs) {
        const state = etats.get(t.id);
        if (!state || state.termine || allocatedToday.has(t.id)) continue;
        const missing = predInconnus(t, idsTravaux, completedIds);
        if (missing.length || !predsTermines(t, etats, completedIds)) continue;

        const dateEval = evaluerContraintesPlanning({
          contraintes: constraints,
          context: contexteTravail(t),
          dateISO: date,
        });
        if (!dateEval.eligible) {
          attempts.get(t.id).dates_bloquees++;
          continue;
        }

        eligible.push({
          travail: t,
          dateEval,
          score: scorerTravail({ travail: t, date, contraintes: constraints, allocationsProposees: allocations }),
        });
      }

      eligible.sort((a, b) =>
        (b.score - a.score)
        || (a.travail.ordre_groupe - b.travail.ordre_groupe)
        || (a.travail.ordre_tache - b.travail.ordre_tache)
        || a.travail.id.localeCompare(b.travail.id)
      );

      for (const candidate of eligible) {
        const t = candidate.travail;
        const state = etats.get(t.id);
        if (!state || state.termine || allocatedToday.has(t.id)) continue;

        const requiredElapsed = state.restant_mo / t.crew_size;
        const crew = choisirEquipe({
          travail: t,
          date,
          ressources: resourceList,
          evenements: evenementsRessources,
          contraintes: constraints,
          charge,
          requiredElapsed,
          continuiteMultiJours,
        });
        if (!crew.ok) {
          attempts.get(t.id).dates_sans_equipe++;
          continue;
        }

        const maxElapsed = Math.min(...crew.selected.map(x => x.capacite.capacite_disponible));
        const elapsed = round2(Math.min(maxElapsed, requiredElapsed));
        if (elapsed <= EPS) continue;

        const resourceIds = crew.selected.map(x => x.resource.id);
        const produced = round2(elapsed * resourceIds.length);
        const switchedResources = crew.selected
          .filter(x => {
            const load = chargePour(charge, x.resource.id, date);
            return load.sites.size > 0 && !load.sites.has(t.site_id);
          })
          .map(x => x.resource.id);
        const continuedFromPreviousDay = crew.selected
          .filter(x => x.previousSameSite)
          .map(x => x.resource.id);

        const allocation = {
          allocation_uid: `proposal_${PLANNING_ENGINE_VERSION}_${t.id}_${date}_${allocations.length + 1}`,
          proposal: true,
          travail_id: t.id,
          tache_id: t.tache_id,
          chantier_id: t.chantier_id,
          site_id: t.site_id,
          groupe_type_id: t.groupe_type_id,
          texte: t.texte,
          date,
          duree: elapsed,
          resource_ids: resourceIds,
          heures_mo: produced,
          explication: {
            restant_avant_mo: round2(state.restant_mo),
            capacite_limitante_h: round2(maxElapsed),
            taille_equipe: resourceIds.length,
            score_travail: round2(candidate.score),
            priorite_metier: t.priority,
            priorite_contraintes: prioriteContrainte(constraints, t),
            contraintes_appliquees: candidate.dateEval.applied_constraint_ids,
            violations: candidate.dateEval.violations,
            site_id: t.site_id,
            changement_chantier_ressources: switchedResources,
            continuite_multi_jours_active: continuiteMultiJours === true,
            jour_planifiable_precedent: crew.previousPlanningDate || null,
            continuite_site_jour_precedent: continuedFromPreviousDay,
            fractionnable: t.fractionnable,
            formule: "MO produite = durée allocation × nombre de ressources ; durée plafonnée par la capacité disponible la plus faible de l'équipe",
          },
        };
        allocations.push(allocation);
        resourceIds.forEach(rid => ajouterCharge(charge, rid, date, elapsed, t.chantier_id, t.site_id));
        state.restant_mo = round2(Math.max(0, state.restant_mo - produced));
        state.termine = state.restant_mo <= EPS;
        if (state.termine) state.finish_date = date;
        allocatedToday.add(t.id);
        progress = true;

        if (switchedResources.length) {
          warnings.push({
            type: "changement_chantier_meme_jour",
            travail_id: t.id,
            date,
            resource_ids: switchedResources,
            explication: "Anomalie de continuité : une ressource sélectionnée appartenait déjà à un autre site le même jour.",
          });
        }
        decisionTrace.push({
          ordre: decisionTrace.length + 1,
          travail_id: t.id,
          date,
          allocation_uid: allocation.allocation_uid,
          raison: `Travail éligible ; ${resourceIds.length} ressource(s) sélectionnée(s) ; ${produced} h MO proposées`,
        });
        break;
      }
    }
  }

  const nonPlanifies = jobs
    .filter(t => !etats.get(t.id)?.termine)
    .map(t => ({
      travail_id: t.id,
      tache_id: t.tache_id,
      chantier_id: t.chantier_id,
      heures_mo_restantes: round2(etats.get(t.id)?.restant_mo || 0),
      raison: raisonNonPlanifie({ travail: t, idsTravaux, completedIds, etats, contraintes: constraints, horizonEnd }),
      tentatives: attempts.get(t.id),
    }));

  const plannedMO = round2(allocations.reduce((s, a) => s + a.heures_mo, 0));
  const requestedMO = round2(jobs.reduce((s, t) => s + t.heures_mo_restantes, 0));

  return {
    version: PLANNING_ENGINE_VERSION,
    start_date: debut,
    horizon_end: horizonEnd,
    input: {
      travaux: jobs.length,
      ressources: resourceList.length,
      allocations_existantes: existing.length,
      contraintes: constraints.length,
      heures_mo_demandees: requestedMO,
      continuite_multi_jours: continuiteMultiJours === true,
    },
    allocations_proposees: allocations,
    non_planifies: nonPlanifies,
    warnings,
    decision_trace: decisionTrace,
    resume: {
      travaux_planifies: jobs.length - nonPlanifies.length,
      travaux_non_planifies: nonPlanifies.length,
      allocations_proposees: allocations.length,
      heures_mo_proposees: plannedMO,
      heures_mo_non_planifiees: round2(Math.max(0, requestedMO - plannedMO)),
      dates_utilisees: uniq(allocations.map(a => a.date)).sort(),
    },
    invariants: {
      aucune_ecriture_persistante: true,
      allocations_existantes_preservees: true,
      moteur_deterministe_a_entrees_identiques: true,
      un_seul_site_par_ressource_et_par_jour: true,
      continuite_multi_jours_optionnelle: true,
    },
  };
}
