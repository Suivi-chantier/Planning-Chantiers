// ─── ADAPTATEUR PROFERO → PLANNING ENGINE V1 ──────────────────────────────────
// Module PUR : aucune lecture/écriture Supabase.
//
// Il transforme les données réelles de l'application (phasages, planning
// courant, ressources, équipes et contraintes) en contrat d'entrée du moteur
// déterministe. Les allocations futures déverrouillées ne sont PAS considérées
// comme de la charge fixe : elles constituent le forecast courant à comparer à
// la proposition. Les allocations manuelles et verrouillées restent figées.

import { allocationsDepuisCellules } from "./planningBaselineModelV1.js";
import { normaliserEquipeLegacy, normaliserNomRessource, normaliserRessource } from "./planningResourceModelV1.js";
import { CONSTRAINT_TYPES, normaliserContraintePlanning } from "./planningConstraintModelV1.js";
import { calculerRangs, predecesseursEffectifs } from "./rang.js";
import { regleGroupe } from "./planningRulesV1.js";
import { CONFIANCE_GROUPE_V1, infererGroupeExecutionV1 } from "./planningGroupInferenceV1.js";

export const PLANNING_ENGINE_ADAPTER_VERSION = 1;
const EPS = 0.005;

const txt = v => String(v ?? "").trim();
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (v, min, max) => Math.max(min, Math.min(max, num(v, min)));
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const uniq = xs => [...new Set((Array.isArray(xs) ? xs : []).map(txt).filter(Boolean))];
const dateOnly = v => /^\d{4}-\d{2}-\d{2}$/.test(txt(v).slice(0, 10)) ? txt(v).slice(0, 10) : null;

export function cleTravailMoteurV1(chantierId, tacheId) {
  return `${txt(chantierId)}::${txt(tacheId)}`;
}

export function heuresPlanifieesTacheV1(tache) {
  const vendues = Math.max(0, num(tache?.heures_vendues, 0));
  const estimees = Math.max(0, num(tache?.heures_estimees, 0));
  return vendues > EPS ? vendues : estimees;
}

export function heuresMoRestantesTacheV1(tache) {
  const total = heuresPlanifieesTacheV1(tache);
  const avancement = clamp(tache?.avancement, 0, 100);
  return round2(total * (1 - avancement / 100));
}

function indexRessources(ressources = []) {
  const normalisees = (Array.isArray(ressources) ? ressources : [])
    .map(normaliserRessource)
    .filter(r => r.id);
  const parNom = new Map();
  const parNomBaseline = new Map();
  for (const r of normalisees) {
    const nom = r.nom_planning || r.nom;
    const k = normaliserNomRessource(nom);
    if (k && !parNom.has(k)) parNom.set(k, r);
    const kb = txt(nom).toLocaleLowerCase("fr-FR");
    if (kb && !parNomBaseline.has(kb)) parNomBaseline.set(kb, r);
  }
  return { normalisees, parNom, parNomBaseline };
}

function idsPourNoms(noms, index) {
  const ids = [];
  const nonMappes = [];
  for (const nom of uniq(noms)) {
    const r = index.get(normaliserNomRessource(nom));
    if (r?.id) ids.push(r.id);
    else nonMappes.push(nom);
  }
  return { ids: uniq(ids), nonMappes };
}

function extraireAllocationsCourantes(cellules, resourceIndexBaseline, warnings) {
  const nettoyees = [];
  for (const cell of Array.isArray(cellules) ? cellules : []) {
    const bonnes = [];
    for (const ligne of Array.isArray(cell?.taches) ? cell.taches : []) {
      if (!txt(ligne?.allocation_uid)) {
        warnings.push({
          type: "allocation_sans_uid",
          chantier_id: txt(cell?.chantier_id) || null,
          explication: "Allocation ignorée par le moteur car allocation_uid est absent.",
        });
        continue;
      }
      bonnes.push(ligne);
    }
    nettoyees.push({ ...cell, taches: bonnes });
  }
  return allocationsDepuisCellules(nettoyees, { resourceIndex: resourceIndexBaseline });
}

function construirePreferencesGroupes({ groupesTypes = [], equipes = [], ressources = [], parNom }) {
  const equipesNormalisees = new Map();
  for (const e of Array.isArray(equipes) ? equipes : []) {
    const eq = normaliserEquipeLegacy(e, ressources);
    if (eq.id) equipesNormalisees.set(eq.id, eq);
  }
  const result = new Map();
  for (const gt of Array.isArray(groupesTypes) ? groupesTypes : []) {
    const id = txt(gt?.id);
    if (!id) continue;
    let preferred = [];
    let nonMappes = [];
    const eq = equipesNormalisees.get(txt(gt?.equipe_id)) || null;
    let candidates = uniq(eq?.resource_ids);
    const prios = uniq(gt?.ouvriers_prio);
    if (prios.length) {
      const mapped = idsPourNoms(prios, parNom);
      nonMappes = mapped.nonMappes;
      if (candidates.length) {
        const allowed = new Set(candidates);
        preferred = mapped.ids.filter(id => allowed.has(id));
      } else if (!eq) {
        // Groupe sans équipe explicite : des priorités mappées constituent le
        // seul pool déterministe disponible, plutôt qu'un fallback global.
        candidates = mapped.ids;
        preferred = mapped.ids;
      }
    } else {
      preferred = candidates;
    }
    result.set(id, {
      groupe_type: gt,
      candidate_resource_ids: candidates,
      preferred_resource_ids: preferred,
      noms_non_mappes: nonMappes,
      equipe_externe: eq?.externe === true,
      equipe_id: eq?.id || null,
    });
  }
  return result;
}

function groupePourTache(tache, groupesParId, groupesTypesParId) {
  const direct = txt(tache?.groupe_type_id);
  if (direct) {
    return {
      groupe_type_id: direct,
      groupe_type: groupesTypesParId.get(direct) || null,
      groupe_chrono: groupesParId.get(txt(tache?.chrono_groupe_id)) || null,
      provenance: "tache",
    };
  }
  const gc = groupesParId.get(txt(tache?.chrono_groupe_id));
  const viaChrono = txt(gc?.groupe_type_id);
  if (viaChrono) {
    return {
      groupe_type_id: viaChrono,
      groupe_type: groupesTypesParId.get(viaChrono) || null,
      groupe_chrono: gc,
      provenance: "chrono_groupe",
    };
  }
  return {
    groupe_type_id: null,
    groupe_type: null,
    groupe_chrono: gc || null,
    provenance: "non_resolu",
  };
}

function dependanceAvecDelaiNonSupporte(tache) {
  return (Array.isArray(tache?.dependances) ? tache.dependances : []).find(d =>
    txt(d?.contrainte || "hard") === "hard" && num(d?.delai_min_calendaire, 0) > EPS
  ) || null;
}

function allocationMo(a) {
  const n = (Array.isArray(a?.resource_ids) && a.resource_ids.length)
    ? a.resource_ids.length
    : (Array.isArray(a?.ouvriers_noms) ? a.ouvriers_noms.length : 0);
  return n > 0 ? round2(Math.max(0, num(a?.duree, 0)) * n) : 0;
}

function comparerWarning(a, b) {
  return `${a.type || ""}|${a.chantier_id || ""}|${a.tache_id || ""}|${a.allocation_uid || ""}|${a.explication || ""}`
    .localeCompare(`${b.type || ""}|${b.chantier_id || ""}|${b.tache_id || ""}|${b.allocation_uid || ""}|${b.explication || ""}`);
}

/**
 * Prépare un snapshot déterministe prêt à être donné à planifierPropositionV1.
 * Cette fonction ne modifie aucun de ses arguments.
 */
export function preparerSimulationPlanningGlobalV1({
  phasages = [],
  chantiers = [],
  cellules = [],
  ressources = [],
  evenementsRessources = [],
  contraintes = [],
  groupesTypes = [],
  equipes = [],
  startDate,
  horizonDays = 42,
} = {}) {
  const debut = dateOnly(startDate);
  if (!debut) throw new Error("startDate ISO requis pour préparer la simulation globale");

  const warnings = [];
  const travauxExclus = [];
  const { normalisees: resources, parNom, parNomBaseline } = indexRessources(ressources);
  const constraints = (Array.isArray(contraintes) ? contraintes : [])
    .map(normaliserContraintePlanning)
    .filter(c => c.actif !== false);
  const lockIds = new Set(constraints
    .filter(c => c.type === CONSTRAINT_TYPES.ALLOCATION_LOCK)
    .map(c => txt(c.allocation_id)).filter(Boolean));

  const allocationsCourantes = extraireAllocationsCourantes(cellules, parNomBaseline, warnings);
  const allocationsFixes = [];
  const allocationsRecalculables = [];
  const allocationsHorsHorizonPasse = [];
  const moVerrouilleeParTache = new Map();

  for (const a of allocationsCourantes) {
    if (!a.date || a.date < debut) {
      allocationsHorsHorizonPasse.push(a);
      continue;
    }
    const locked = lockIds.has(txt(a.allocation_uid));
    const manuel = !txt(a.tache_id);
    const enriched = { ...a, locked };
    if (locked || manuel) {
      allocationsFixes.push(enriched);
      if (locked && a.tache_id) {
        const key = cleTravailMoteurV1(a.chantier_id, a.tache_id);
        const mo = allocationMo(a);
        if (mo > 0) moVerrouilleeParTache.set(key, round2((moVerrouilleeParTache.get(key) || 0) + mo));
        else warnings.push({
          type: "allocation_verrouillee_sans_ressource",
          chantier_id: a.chantier_id,
          tache_id: a.tache_id,
          allocation_uid: a.allocation_uid,
          explication: "La MO réservée par cette allocation verrouillée ne peut pas être calculée faute de ressource mappée.",
        });
      }
    } else {
      allocationsRecalculables.push(enriched);
    }

    if ((a.ouvriers_noms || []).length && !(a.resource_ids || []).length) {
      warnings.push({
        type: "allocation_ressource_non_mappee",
        chantier_id: a.chantier_id,
        tache_id: a.tache_id,
        allocation_uid: a.allocation_uid,
        explication: `Aucune ressource stable trouvée pour : ${(a.ouvriers_noms || []).join(", ")}`,
      });
    }
  }

  const chantierMap = new Map((Array.isArray(chantiers) ? chantiers : [])
    .filter(c => txt(c?.id))
    .map(c => [txt(c.id), c]));
  const configChantiersDisponible = chantierMap.size > 0;
  const groupesTypesParId = new Map((Array.isArray(groupesTypes) ? groupesTypes : [])
    .filter(g => txt(g?.id))
    .map(g => [txt(g.id), g]));
  const prefsGroupes = construirePreferencesGroupes({ groupesTypes, equipes, ressources: resources, parNom });

  const travaux = [];
  const completedTaskIds = [];
  let phasagesUtilises = 0;
  let tachesLegacyDependances = 0;
  let tachesDependancesExplicites = 0;
  let groupesTypesResolus = 0;
  let groupesTypesInferes = 0;
  let groupesTypesManquants = 0;
  let heuresMoRestantesBrutes = 0;
  let heuresMoReserveesVerrous = 0;

  for (const ph of Array.isArray(phasages) ? phasages : []) {
    const chantierId = txt(ph?.chantier_id);
    if (!chantierId) continue;
    const chantier = chantierMap.get(chantierId);
    if (configChantiersDisponible && !chantier) {
      warnings.push({ type: "phasage_hors_referentiel", chantier_id: chantierId, explication: "Phasage ignoré car son chantier n'existe plus dans le référentiel courant." });
      continue;
    }
    if (chantier?.statut === "termine") continue;

    const ouvrages = Array.isArray(ph?.ouvrages) ? ph.ouvrages : [];
    if (!ouvrages.length) continue;
    phasagesUtilises++;
    const groupes = Array.isArray(ph?.plan_travaux?.meta?.chrono_groupes) ? ph.plan_travaux.meta.chrono_groupes : [];
    const groupesParId = new Map(groupes.filter(g => txt(g?.id)).map(g => [txt(g.id), g]));
    const preds = predecesseursEffectifs(ouvrages, groupes);
    const rangs = calculerRangs(ouvrages, groupes);
    const incoh = rangs?.incoherences || {};
    if ((incoh.cycles || []).length || (incoh.introuvables || []).length || (incoh.bloquees || []).length) {
      warnings.push({
        type: "graphe_dependances_incoherent",
        chantier_id: chantierId,
        explication: `${(incoh.cycles || []).length} cycle(s), ${(incoh.introuvables || []).length} prédécesseur(s) introuvable(s), ${(incoh.bloquees || []).length} tâche(s) bloquée(s).`,
      });
    }

    const flat = [];
    ouvrages.forEach((ouvrage, ouvrageIndex) => {
      (Array.isArray(ouvrage?.taches) ? ouvrage.taches : []).forEach((tache, tacheIndex) => {
        if (!txt(tache?.id)) return;
        flat.push({ ouvrage, ouvrageIndex, tache, tacheIndex });
      });
    });

    for (const { tache } of flat) {
      const id = cleTravailMoteurV1(chantierId, tache.id);
      if (clamp(tache?.avancement, 0, 100) >= 100 - EPS) completedTaskIds.push(id);
    }

    for (const { ouvrage, tache, tacheIndex } of flat) {
      const tacheId = txt(tache.id);
      const travailId = cleTravailMoteurV1(chantierId, tacheId);
      const avancement = clamp(tache?.avancement, 0, 100);
      const totalPlanifie = heuresPlanifieesTacheV1(tache);
      const restantBrut = heuresMoRestantesTacheV1(tache);
      if (avancement >= 100 - EPS || restantBrut <= EPS || totalPlanifie <= EPS) continue;
      heuresMoRestantesBrutes += restantBrut;

      const sourcePred = preds.get(tacheId) || { ids: [], source: "hors_chaine" };
      if (sourcePred.source === "explicite") tachesDependancesExplicites++;
      else if (sourcePred.source === "defaut") tachesLegacyDependances++;

      let groupe = groupePourTache(tache, groupesParId, groupesTypesParId);
      if (!groupe.groupe_type_id) {
        const inference = infererGroupeExecutionV1({
          code: ouvrage?.code_ouvrage || ouvrage?.code || ouvrage?.identifiant || null,
          nom: tache?.nom,
          lotId: ouvrage?.lot_id || ouvrage?.lotId || null,
          position: tacheIndex + 1,
        });
        if (inference?.groupe_type_id && inference.confiance === CONFIANCE_GROUPE_V1.CERTAIN) {
          groupe = {
            ...groupe,
            groupe_type_id: inference.groupe_type_id,
            groupe_type: groupesTypesParId.get(inference.groupe_type_id) || null,
            provenance: "inference_certaine",
            inference,
          };
          groupesTypesInferes++;
        }
      }
      if (groupe.groupe_type_id) groupesTypesResolus++;
      else groupesTypesManquants++;

      const delay = dependanceAvecDelaiNonSupporte(tache);
      if (delay) {
        travauxExclus.push({
          travail_id: travailId,
          chantier_id: chantierId,
          tache_id: tacheId,
          type: "delai_technique_non_supporte",
          explication: `Délai technique de ${delay.delai_min_calendaire} ${delay.unite_delai || "heures"} : le moteur V1 ne le contourne pas silencieusement.`,
        });
        continue;
      }
      if (tache?.externe === true) {
        travauxExclus.push({
          travail_id: travailId,
          chantier_id: chantierId,
          tache_id: tacheId,
          type: "intervention_externe",
          explication: "Intervention externe : elle doit être positionnée/contrainte explicitement, jamais affectée automatiquement à un salarié Profero.",
        });
        continue;
      }

      const moVerrouillee = moVerrouilleeParTache.get(travailId) || 0;
      const restant = round2(Math.max(0, restantBrut - moVerrouillee));
      heuresMoReserveesVerrous += Math.min(restantBrut, moVerrouillee);
      if (restant <= EPS) continue;

      const nomsTache = uniq(tache?.ouvriers);
      const mappingTache = idsPourNoms(nomsTache, parNom);
      if (mappingTache.nonMappes.length) warnings.push({
        type: "tache_ouvrier_non_mappe",
        chantier_id: chantierId,
        tache_id: tacheId,
        explication: `Ouvrier(s) du phasage sans ressource stable : ${mappingTache.nonMappes.join(", ")}`,
      });

      // Ancien phasage sans groupe d'exécution ET sans ressource identifiable :
      // ne jamais inventer une affectation parmi tous les salariés. On préfère
      // une exclusion visible à une proposition faussement précise.
      if (!groupe.groupe_type_id && mappingTache.ids.length === 0) {
        travauxExclus.push({
          travail_id: travailId,
          chantier_id: chantierId,
          tache_id: tacheId,
          type: "contexte_affectation_insuffisant",
          explication: "Tâche legacy sans groupe métier résolu ni ouvrier mappé : affectation automatique volontairement désactivée.",
        });
        continue;
      }

      const prefGroupe = prefsGroupes.get(groupe.groupe_type_id) || null;
      // Une équipe de groupe marquée externe ne doit jamais se dégrader en
      // « n'importe quel salarié interne ». Une affectation explicite sur la
      // tâche reste un override volontaire et autorise la planification interne.
      if (prefGroupe?.equipe_externe && mappingTache.ids.length === 0) {
        travauxExclus.push({
          travail_id: travailId,
          chantier_id: chantierId,
          tache_id: tacheId,
          type: "equipe_groupe_externe",
          explication: "Le groupe d'exécution utilise une équipe externe par défaut et aucun salarié interne n'est explicitement affecté à cette tâche.",
        });
        continue;
      }
      if (!nomsTache.length && prefGroupe?.noms_non_mappes?.length) warnings.push({
        type: "groupe_ouvrier_prio_non_mappe",
        chantier_id: chantierId,
        tache_id: tacheId,
        explication: `Préférence groupe non mappée : ${prefGroupe.noms_non_mappes.join(", ")}`,
      });
      const candidatesGroupe = uniq(prefGroupe?.candidate_resource_ids);
      if (groupe.groupe_type_id && !prefGroupe?.equipe_externe && candidatesGroupe.length === 0) {
        travauxExclus.push({
          travail_id: travailId,
          chantier_id: chantierId,
          tache_id: tacheId,
          type: "groupe_sans_pool_ressources",
          explication: "Le groupe métier est résolu mais aucun pool interne de ressources n'est configuré : le moteur refuse de choisir parmi tous les salariés.",
        });
        continue;
      }

      // Contrat V1 : le groupe métier définit un pool HARD. Les priorités du
      // groupe ne font qu'ordonner les membres de ce pool. Les anciens noms
      // `tache.ouvriers` ne peuvent jamais élargir un groupe actuel ; ils restent
      // le seul pool prudent uniquement pour une tâche legacy sans groupe, ou
      // l'override explicite d'un groupe externe.
      const candidates = prefGroupe?.equipe_externe
        ? mappingTache.ids
        : (groupe.groupe_type_id ? candidatesGroupe : mappingTache.ids);
      const preferredGroupe = uniq(prefGroupe?.preferred_resource_ids).filter(id => candidates.includes(id));
      const preferred = preferredGroupe.length ? preferredGroupe : candidates;

      const regle = regleGroupe(groupe.groupe_type_id);
      const ordreGroupe = num(groupe.groupe_chrono?.ordre, num(groupe.groupe_type?.ordre, regle?.ordre ?? 9999));
      const ordreTache = num(tache?.chrono_ordre, tacheIndex);
      const predIds = uniq(sourcePred.ids).map(pid => cleTravailMoteurV1(chantierId, pid));

      travaux.push({
        id: travailId,
        tache_id: tacheId,
        chantier_id: chantierId,
        groupe_type_id: groupe.groupe_type_id,
        texte: txt(tache?.nom) || "Tâche sans libellé",
        heures_mo_restantes: restant,
        crew_size: Math.max(1, nomsTache.length || 1),
        candidate_resource_ids: candidates,
        preferred_resource_ids: preferred,
        predecesseur_ids: predIds,
        priority: 0,
        ordre_groupe: ordreGroupe,
        ordre_tache: ordreTache,
        fractionnable: typeof tache?.fractionnable === "boolean" ? tache.fractionnable : (regle?.fractionnable_default !== false),
        provenance: {
          phasage_id: txt(ph?.id) || null,
          ouvrage_id: txt(ouvrage?.id) || null,
          code_ouvrage: txt(ouvrage?.code_ouvrage) || null,
          dependances: sourcePred.source,
          groupe_type: groupe.provenance,
          heures_planifiees_total: totalPlanifie,
          avancement,
          restant_brut_mo: restantBrut,
          mo_reservee_verrou: moVerrouillee,
        },
      });
    }
  }

  // Les locks ont déjà servi à figer les allocations existantes. Ils ne doivent
  // pas être réinterprétés comme contrainte de création d'une nouvelle allocation.
  const contraintesMoteur = constraints.filter(c => c.type !== CONSTRAINT_TYPES.ALLOCATION_LOCK);
  const fixedEngine = allocationsFixes
    .filter(a => a.date && a.date >= debut)
    .map(a => ({
      allocation_uid: a.allocation_uid,
      tache_id: a.tache_id,
      chantier_id: a.chantier_id,
      date: a.date,
      duree: a.duree,
      resource_ids: a.resource_ids || [],
      locked: a.locked === true,
    }));

  const totalRestant = round2(travaux.reduce((s, t) => s + t.heures_mo_restantes, 0));
  const audit = {
    adapter_version: PLANNING_ENGINE_ADAPTER_VERSION,
    phasages_utilises: phasagesUtilises,
    travaux_moteur: travaux.length,
    travaux_exclus: travauxExclus.length,
    taches_terminees_connues: completedTaskIds.length,
    dependances_legacy_defaut: tachesLegacyDependances,
    dependances_explicites: tachesDependancesExplicites,
    groupes_types_resolus: groupesTypesResolus,
    groupes_types_inferes: groupesTypesInferes,
    groupes_types_non_resolus: groupesTypesManquants,
    allocations_courantes: allocationsCourantes.length,
    allocations_fixes: allocationsFixes.length,
    allocations_recalculables_courantes: allocationsRecalculables.length,
    allocations_passees_ignorees: allocationsHorsHorizonPasse.length,
    heures_mo_restantes_brutes: round2(heuresMoRestantesBrutes),
    heures_mo_reservees_par_verrous: round2(heuresMoReserveesVerrous),
    heures_mo_a_planifier: totalRestant,
  };

  warnings.sort(comparerWarning);
  travauxExclus.sort((a, b) => `${a.chantier_id}|${a.tache_id}`.localeCompare(`${b.chantier_id}|${b.tache_id}`));

  return {
    engineInput: {
      travaux,
      ressources: resources,
      evenementsRessources: Array.isArray(evenementsRessources) ? evenementsRessources.map(e => ({ ...e })) : [],
      contraintes: contraintesMoteur,
      allocationsExistantes: fixedEngine,
      completedTaskIds: uniq(completedTaskIds),
      startDate: debut,
      horizonDays,
    },
    forecastCourant: {
      allocations_recalculables: allocationsRecalculables,
      allocations_fixes: allocationsFixes,
    },
    travaux_exclus: travauxExclus,
    warnings,
    audit,
    invariants: {
      aucune_ecriture_persistante: true,
      allocations_futures_deverrouillees_recalculables: true,
      allocations_manuelles_ou_verrouillees_fixes: true,
      groupes_externes_sans_override_exclus: true,
      formule_restant_mo: "MO restante = (heures vendues si > 0, sinon heures estimées) × (1 - avancement/100) - MO déjà réservée par les allocations futures verrouillées",
    },
  };
}