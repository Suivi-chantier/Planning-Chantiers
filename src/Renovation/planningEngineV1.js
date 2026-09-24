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
  contraintePersonneActiveLe,
  contraintesApplicablesPlanning,
  estContraintePersonne,
  evaluerContraintesApplicablesPlanning,
  normaliserContraintePlanning,
  porteePreciseRessourceImposee,
  raisonContrainteSansEffetMoteur,
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
    delais_predecesseurs: (Array.isArray(t.delais_predecesseurs) ? t.delais_predecesseurs : [])
      .map(d => ({
        predecesseur_id: str(d?.predecesseur_id),
        delai_jours_calendaires: Math.max(0, Math.round(num(d?.delai_jours_calendaires, 0))),
      }))
      .filter(d => d.predecesseur_id && d.delai_jours_calendaires > 0),
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

// Index construit UNE fois par simulation : les contraintes sont normalisées
// une seule fois, puis filtrées par portée une seule fois par travail (la
// portée ne dépend que du chantier, du groupe et de la tâche). Les boucles
// jour × tâche × ressource ne relisent plus que ces listes courtes.
function indexerContraintesParTravail(constraints, jobs) {
  const index = new Map();
  for (const t of jobs) {
    const applicables = contraintesApplicablesPlanning(constraints, contexteTravail(t));
    const deadline = applicables
      .filter(c => c.type === CONSTRAINT_TYPES.DEADLINE && c.date_fin)
      .map(c => c.date_fin)
      .sort()[0] || null;
    const priorite = applicables
      .filter(c => c.type === CONSTRAINT_TYPES.PRIORITY)
      .reduce((s, c) => s + num(c.priority, 0), 0);
    // Consignes de personne, triées une fois : imposées à portée précise (seules
    // à pouvoir élargir l'équipe), imposées à portée large (restreignent
    // seulement), souhaitées (préférence SOFT, violable avec explication).
    const imposeesPrecises = applicables.filter(porteePreciseRessourceImposee);
    const imposeesLarges = applicables.filter(c =>
      c.type === CONSTRAINT_TYPES.RESOURCE_REQUIRED && c.hard === true && !porteePreciseRessourceImposee(c));
    const souhaitees = applicables.filter(c => estContraintePersonne(c) && c.hard !== true);
    index.set(t.id, { applicables, deadline, priorite, imposeesPrecises, imposeesLarges, souhaitees });
  }
  return index;
}

const MOTIFS_RESSOURCE_IMPOSEE = Object.freeze({
  introuvable: "introuvable ou inactive",
  absente: "absente ou indisponible",
  capacite_pleine: "capacité pleine",
  autre_chantier: "déjà sur un autre chantier",
  creneau_insuffisant: "créneau trop court pour une tâche non fractionnable",
  autre_consigne: "écartée par une autre consigne",
});

function nomsRessources(ids, nomParId) {
  return ids.map(id => nomParId.get(id) || id).join(", ");
}

// Bilan d'une consigne souhaitée (hard=false) pour une allocation proposée :
// respectée ou non, et pourquoi. Une consigne souhaitée n'élargit jamais l'équipe.
function bilanConsignesSouhaitees({ souhaiteesDuJour, selectedIds, candidatesSet, eligiblesIds, connusIds, nomParId }) {
  return souhaiteesDuJour.map(c => {
    const liste = c.config.resource_ids;
    if (c.type === CONSTRAINT_TYPES.RESOURCE_FORBIDDEN) {
      const utilisees = selectedIds.filter(id => liste.includes(id));
      return {
        constraint_id: c.id,
        type: c.type,
        respectee: utilisees.length === 0,
        explication: utilisees.length === 0
          ? `Consigne souhaitée respectée : ${nomsRessources(liste, nomParId)} non utilisé(e)(s).`
          : `Consigne souhaitée non respectée : ${nomsRessources(utilisees, nomParId)} utilisé(e)(s) faute d'autre ressource disponible ce jour.`,
      };
    }
    const respectee = selectedIds.every(id => liste.includes(id));
    if (respectee) {
      return { constraint_id: c.id, type: c.type, respectee, explication: `Consigne souhaitée respectée : ${nomsRessources(selectedIds, nomParId)} placé(e)(s).` };
    }
    const details = liste.filter(id => !selectedIds.includes(id)).map(id => {
      let motif = "non retenu(e)";
      if (!connusIds.has(id)) motif = MOTIFS_RESSOURCE_IMPOSEE.introuvable;
      else if (candidatesSet.size > 0 && !candidatesSet.has(id)) motif = "hors de l'équipe du lot (une consigne souhaitée n'élargit jamais l'équipe ; la rendre obligatoire pour l'imposer)";
      else if (!eligiblesIds.has(id)) motif = "indisponible ce jour (absence, capacité pleine ou autre chantier)";
      return `${nomParId.get(id) || id} ${motif}`;
    });
    const aLaPlace = selectedIds.filter(id => !liste.includes(id));
    return {
      constraint_id: c.id,
      type: c.type,
      respectee,
      explication: `Consigne souhaitée non respectée : ${details.length ? details.join(" ; ") : `équipe de ${selectedIds.length} à compléter`} — ${nomsRessources(aLaPlace, nomParId)} placé(e)(s) à la place.`,
    };
  });
}

function predInconnus(travail, idsTravaux, completedIds) {
  return travail.predecesseur_ids.filter(id => !idsTravaux.has(id) && !completedIds.has(id));
}

function predsTermines(travail, etats, completedIds) {
  return travail.predecesseur_ids.every(id => completedIds.has(id) || etats.get(id)?.termine === true);
}

function delaisPredecesseursRespectes(travail, date, etats) {
  return travail.delais_predecesseurs.every(dep => {
    const fin = etats.get(dep.predecesseur_id)?.finish_date || null;
    return Boolean(fin && date >= dateAddDays(fin, dep.delai_jours_calendaires));
  });
}

function prochainDelaiTechnique(travail, etats) {
  return travail.delais_predecesseurs
    .map(dep => {
      const fin = etats.get(dep.predecesseur_id)?.finish_date || null;
      return fin ? {
        predecesseur_id: dep.predecesseur_id,
        date_eligible: dateAddDays(fin, dep.delai_jours_calendaires),
      } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.date_eligible.localeCompare(a.date_eligible))[0] || null;
}

function scorerTravail({ travail, date, contraintesTravail, dernierJourParTravail }) {
  let score = travail.priority + contraintesTravail.priorite;
  const last = dernierJourParTravail.get(travail.id) || null;
  if (last) {
    const delta = dateDiffDays(date, last);
    if (delta === 0) score += 300;
    else if (delta <= 3) score += 180;
    else if (delta <= 7) score += 80;
  }
  const deadline = contraintesTravail.deadline;
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

function choisirEquipe({ travail, date, ressources, evenements, contraintesTravail, charge, requiredElapsed = null, continuiteMultiJours = false }) {
  const candidatesSet = new Set(travail.candidate_resource_ids);
  // Exception humaine explicite : une ressource imposée (resource_required
  // obligatoire, portée tâche ou lot + chantier, dans sa période) entre dans les
  // candidats MÊME hors de l'équipe du lot. Rien d'autre n'élargit l'équipe.
  const imposeesDuJour = contraintesTravail.imposeesPrecises.filter(c => contraintePersonneActiveLe(c, date));
  const elargis = new Set(imposeesDuJour.flatMap(c => c.config.resource_ids));
  const souhaiteesDuJour = contraintesTravail.souhaitees.filter(c => contraintePersonneActiveLe(c, date));
  const allCandidates = ressources.filter(r =>
    r.actif !== false
    && r.kind === RESOURCE_KINDS.PERSONNE
    && (candidatesSet.size === 0 || candidatesSet.has(r.id) || elargis.has(r.id))
  );
  // Pourquoi une ressource imposée n'a pas pu être retenue ce jour-là.
  const ecartsImposees = new Map();
  const noterEcart = (rid, motif) => { if (elargis.has(rid)) ecartsImposees.set(rid, motif); };
  if (elargis.size) {
    const presents = new Set(allCandidates.map(r => r.id));
    for (const rid of elargis) if (!presents.has(rid)) noterEcart(rid, "introuvable");
  }
  const previousPlanningDate = continuiteMultiJours ? jourPlanifiablePrecedent(date) : null;
  const preferenceSource = str(travail?.stability_forecast?.preference_source);

  const scored = [];
  for (const r of allCandidates) {
    const load = chargePour(charge, r.id, date);
    // Contrat chantier 04 : une ressource reste sur un seul site physique par
    // journée. Deux logements/chantiers d'une même opération peuvent partager
    // le même `site_id`; un changement de site est différé au prochain jour.
    if (load.sites.size > 0 && !load.sites.has(travail.site_id)) { noterEcart(r.id, "autre_chantier"); continue; }
    const capacite = calculerCapaciteRessourcePourDate({
      resource: r,
      dateISO: date,
      evenements,
      heuresDejaAllouees: load.heures,
    });
    if (capacite.capacite_disponible <= EPS) {
      noterEcart(r.id, capacite.capacite_apres_exceptions <= EPS ? "absente" : "capacite_pleine");
      continue;
    }
    // Une tâche non fractionnable exige un créneau complet pour chaque membre
    // de l'équipe. On élimine donc ici les ressources qui forceraient un split.
    if (!travail.fractionnable && requiredElapsed != null && capacite.capacite_disponible + EPS < requiredElapsed) {
      noterEcart(r.id, "creneau_insuffisant");
      continue;
    }

    const cEval = evaluerContraintesApplicablesPlanning({
      applicables: contraintesTravail.applicables,
      dateISO: date,
      resourceId: r.id,
    });
    if (!cEval.eligible) { noterEcart(r.id, "autre_consigne"); continue; }
    // Consigne souhaitée : nombre de préférences SOFT qu'utiliser r violerait.
    const souhaiteesEcartees = souhaiteesDuJour.filter(c =>
      (c.type === CONSTRAINT_TYPES.RESOURCE_FORBIDDEN) === c.config.resource_ids.includes(r.id)).length;

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
      souhaiteesEcartees,
    });
  }

  if (continuiteMultiJours) {
    // Hiérarchie SOFT explicite, sans coefficient arbitraire :
    // affectation de tâche déjà communiquée > continuité aujourd'hui >
    // continuité avec le jour ouvré précédent > affinité site forecast >
    // préférence statique du groupe > capacité disponible.
    // Une consigne souhaitée par un humain passe avant les préférences automatiques.
    scored.sort((a, b) =>
      (a.souhaiteesEcartees - b.souhaiteesEcartees)
      || (Number(b.preferenceTache) - Number(a.preferenceTache))
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
      (a.souhaiteesEcartees - b.souhaiteesEcartees)
      || (b.score - a.score)
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
      imposeesDuJour,
      ecartsImposees,
    };
  }
  const horsEquipe = candidatesSet.size === 0 ? [] : selected.map(x => x.resource.id).filter(id => !candidatesSet.has(id));
  return {
    ok: true,
    selected,
    candidates: scored,
    previousPlanningDate,
    candidatesSet,
    imposeesDuJour,
    souhaiteesDuJour,
    horsEquipe,
  };
}

// Toute tâche non planifiée sort avec un code ET un libellé, jamais en silence.
// Les libellés des cas historiques sont conservés mot pour mot.
function raisonNonPlanifie({ travail, idsTravaux, completedIds, etats, contraintesTravail, horizonEnd, suiviImposees, connusIds, nomParId }) {
  const missing = predInconnus(travail, idsTravaux, completedIds);
  if (missing.length) return { code: "predecesseur_introuvable", libelle: `Prédécesseur(s) introuvable(s) : ${missing.join(", ")}` };
  if (!predsTermines(travail, etats, completedIds)) return { code: "predecesseur_non_termine", libelle: "Prédécesseur(s) non terminé(s) dans l'horizon" };
  const delai = prochainDelaiTechnique(travail, etats);
  if (delai && delai.date_eligible > horizonEnd) {
    return { code: "delai_technique_hors_horizon", libelle: `Délai technique après ${delai.predecesseur_id} : tâche éligible à partir du ${delai.date_eligible}` };
  }
  const fixedFuture = contraintesTravail.applicables
    .filter(c => [CONSTRAINT_TYPES.NOT_BEFORE, CONSTRAINT_TYPES.FIXED_DATE].includes(c.type) && c.date_debut > horizonEnd)
    .sort((a, b) => a.date_debut.localeCompare(b.date_debut))[0];
  if (fixedFuture) return { code: "contrainte_date_hors_horizon", libelle: `Contrainte de date hors horizon : ${fixedFuture.date_debut}` };

  // Ressource imposée hors équipe : la consigne a été tentée, dire pourquoi elle a échoué.
  const suivi = suiviImposees.get(travail.id) || null;
  if (suivi && suivi.jours > 0) {
    const ids = [...suivi.constraint_ids];
    const rids = [...suivi.resource_ids];
    const consigne = { constraint_ids: ids, resource_ids: rids, jours_examines: suivi.jours, motifs: Object.fromEntries(suivi.motifs) };
    const noms = nomsRessources(rids, nomParId);
    if (rids.every(id => !connusIds.has(id))) {
      return {
        code: "ressource_imposee_introuvable",
        libelle: `Consigne ${ids.join(", ")} : ressource imposée ${noms} introuvable ou inactive — la tâche ne peut pas être placée tant que la consigne est active.`,
        consigne,
      };
    }
    if (suivi.motifs.size === 0) {
      return {
        code: "ressource_imposee_equipe_incomplete",
        libelle: `Consigne ${ids.join(", ")} : ${noms} imposé(e)(s), mais l'équipe demandée (${travail.crew_size} personne(s)) ne peut pas être complétée avec les seules ressources imposées.`,
        consigne,
      };
    }
    const detail = [...suivi.motifs].map(([motif, n]) => `${MOTIFS_RESSOURCE_IMPOSEE[motif] || motif} : ${n} j`).join(" ; ");
    return {
      code: "ressource_imposee_indisponible",
      libelle: `Consigne ${ids.join(", ")} : ${noms} imposé(e)(s) mais indisponible(s) sur ${suivi.jours > 1 ? `les ${suivi.jours} jours travaillés examinés` : "le seul jour travaillé examiné"} (${detail}).`,
      consigne,
    };
  }
  const pool = new Set(travail.candidate_resource_ids);
  const horsEquipe = pool.size === 0 ? null : contraintesTravail.imposeesLarges
    .find(c => c.config.resource_ids.every(id => !pool.has(id)));
  if (horsEquipe) {
    return {
      code: "ressource_imposee_hors_equipe",
      libelle: `Consigne ${horsEquipe.id} : ${nomsRessources(horsEquipe.config.resource_ids, nomParId)} hors de l'équipe du lot, et la portée de la consigne est trop large pour élargir l'équipe (préciser la tâche, ou le lot et le chantier).`,
      consigne: { constraint_ids: [horsEquipe.id], resource_ids: horsEquipe.config.resource_ids },
    };
  }
  return { code: "capacite_ou_contraintes_horizon", libelle: "Capacité / ressources insuffisantes ou contraintes incompatibles dans l'horizon" };
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
  // Consignes que le moteur ne sait pas appliquer : rejetées explicitement,
  // listées dans `contraintes_sans_effet` ET dans `warnings`.
  const contraintesSansEffet = [];
  const constraintsMoteur = constraints.filter(c => {
    const rejet = raisonContrainteSansEffetMoteur(c);
    if (!rejet) return true;
    contraintesSansEffet.push({ constraint_id: c.id, type: c.type, code: rejet.code, explication: rejet.explication });
    return false;
  });
  const existing = (Array.isArray(allocationsExistantes) ? allocationsExistantes : []).map(normaliserAllocationExistanteV1);
  const completedIds = new Set(uniq(completedTaskIds));
  const idsTravaux = new Set(jobs.map(t => t.id));

  const duplicateIds = jobs.map(t => t.id).filter((id, i, arr) => arr.indexOf(id) !== i);
  if (duplicateIds.length) throw new Error(`IDs de travaux dupliqués : ${uniq(duplicateIds).join(", ")}`);
  const contraintesParTravail = indexerContraintesParTravail(constraintsMoteur, jobs);
  const dernierJourParTravail = new Map();
  const connusIds = new Set(resourceList.filter(r => r.actif !== false && r.kind === RESOURCE_KINDS.PERSONNE).map(r => r.id));
  const nomParId = new Map(resourceList.map(r => [r.id, str(r.nom_planning || r.nom) || r.id]));
  const suiviImposees = new Map();
  const souhaiteesNonRespectees = new Map();

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

  for (const rejet of contraintesSansEffet) {
    warnings.push({
      type: "consigne_sans_effet",
      constraint_id: rejet.constraint_id,
      contrainte_type: rejet.type,
      code: rejet.code,
      explication: rejet.explication,
    });
  }
  for (const t of jobs) {
    const ct = contraintesParTravail.get(t.id);
    const pool = new Set(t.candidate_resource_ids);
    for (const c of ct.imposeesLarges) {
      const hors = pool.size === 0 ? [] : c.config.resource_ids.filter(id => !pool.has(id));
      if (hors.length) warnings.push({
        type: "consigne_ressource_hors_equipe_non_elargie",
        constraint_id: c.id,
        travail_id: t.id,
        resource_ids: hors,
        explication: `${nomsRessources(hors, nomParId)} hors de l'équipe du lot : la portée de la consigne est trop large pour élargir l'équipe (préciser la tâche, ou le lot et le chantier).`,
      });
    }
    for (const c of ct.imposeesPrecises) {
      const inconnues = c.config.resource_ids.filter(id => !connusIds.has(id));
      if (inconnues.length) warnings.push({
        type: "consigne_ressource_introuvable",
        constraint_id: c.id,
        travail_id: t.id,
        resource_ids: inconnues,
        explication: `Ressource imposée ${inconnues.join(", ")} introuvable ou inactive : la consigne ne peut pas être honorée par cette ressource.`,
      });
    }
  }

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
        if (missing.length || !predsTermines(t, etats, completedIds) || !delaisPredecesseursRespectes(t, date, etats)) continue;

        const contraintesTravail = contraintesParTravail.get(t.id);
        const dateEval = evaluerContraintesApplicablesPlanning({
          applicables: contraintesTravail.applicables,
          dateISO: date,
        });
        if (!dateEval.eligible) {
          attempts.get(t.id).dates_bloquees++;
          continue;
        }

        eligible.push({
          travail: t,
          dateEval,
          score: scorerTravail({ travail: t, date, contraintesTravail, dernierJourParTravail }),
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
          contraintesTravail: contraintesParTravail.get(t.id),
          charge,
          requiredElapsed,
          continuiteMultiJours,
        });
        if (!crew.ok) {
          attempts.get(t.id).dates_sans_equipe++;
          // Suivi d'une ressource imposée, sur les seuls jours travaillés.
          if (crew.imposeesDuJour.length && capaciteBasePlanningPourDate(date) > EPS) {
            const suivi = suiviImposees.get(t.id) || { jours: 0, constraint_ids: new Set(), resource_ids: new Set(), motifs: new Map() };
            suivi.jours++;
            crew.imposeesDuJour.forEach(c => {
              suivi.constraint_ids.add(c.id);
              c.config.resource_ids.forEach(id => suivi.resource_ids.add(id));
            });
            for (const motif of new Set(crew.ecartsImposees.values())) suivi.motifs.set(motif, (suivi.motifs.get(motif) || 0) + 1);
            suiviImposees.set(t.id, suivi);
          }
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
            priorite_contraintes: contraintesParTravail.get(t.id).priorite,
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
        if (crew.horsEquipe.length) {
          allocation.exception = {
            type: CONSTRAINT_TYPES.RESOURCE_REQUIRED,
            constraint_ids: crew.imposeesDuJour
              .filter(c => c.config.resource_ids.some(id => crew.horsEquipe.includes(id)))
              .map(c => c.id),
            resource_ids_hors_equipe: crew.horsEquipe,
            explication: `${nomsRessources(crew.horsEquipe, nomParId)} placé(e)(s) hors de l'équipe du lot par une consigne obligatoire (ressource imposée) : exception humaine explicite, limitée à la portée et à la période de la consigne.`,
          };
        }
        if (crew.souhaiteesDuJour.length) {
          const bilan = bilanConsignesSouhaitees({
            souhaiteesDuJour: crew.souhaiteesDuJour,
            selectedIds: resourceIds,
            candidatesSet: crew.candidatesSet,
            eligiblesIds: new Set(crew.candidates.map(x => x.resource.id)),
            connusIds,
            nomParId,
          });
          allocation.explication.consignes_souhaitees = bilan;
          for (const b of bilan.filter(x => !x.respectee)) {
            const key = `${b.constraint_id}@@${t.id}`;
            const prev = souhaiteesNonRespectees.get(key) || {
              type: "consigne_souhaitee_non_respectee",
              constraint_id: b.constraint_id,
              travail_id: t.id,
              chantier_id: t.chantier_id,
              tache_id: t.tache_id,
              dates: [],
              explication: b.explication,
            };
            prev.dates.push(date);
            souhaiteesNonRespectees.set(key, prev);
          }
        }
        allocations.push(allocation);
        const dernierJour = dernierJourParTravail.get(t.id);
        if (!dernierJour || date > dernierJour) dernierJourParTravail.set(t.id, date);
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

  warnings.push(...souhaiteesNonRespectees.values());

  const nonPlanifies = jobs
    .filter(t => !etats.get(t.id)?.termine)
    .map(t => {
      const raison = raisonNonPlanifie({
        travail: t,
        idsTravaux,
        completedIds,
        etats,
        contraintesTravail: contraintesParTravail.get(t.id),
        horizonEnd,
        suiviImposees,
        connusIds,
        nomParId,
      });
      return {
        travail_id: t.id,
        tache_id: t.tache_id,
        chantier_id: t.chantier_id,
        heures_mo_restantes: round2(etats.get(t.id)?.restant_mo || 0),
        raison: raison.libelle,
        raison_code: raison.code,
        ...(raison.consigne ? { consigne_bloquante: raison.consigne } : {}),
        tentatives: attempts.get(t.id),
      };
    });

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
    contraintes_sans_effet: contraintesSansEffet,
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
      toute_tache_non_planifiee_a_une_raison: nonPlanifies.every(np => str(np.raison) !== "" && str(np.raison_code) !== ""),
      equipe_elargie_uniquement_par_ressource_imposee_ciblee: true,
      consigne_sans_effet_toujours_signalee: true,
    },
  };
}
