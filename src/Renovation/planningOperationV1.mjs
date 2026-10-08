// ─── PLANIFIER UNE OPÉRATION ENTIÈRE V1 ─────────────────────────────────────
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord.
// Les données arrivent en paramètre (photographie lue par planningOperationDataV1.js).
//
// Besoin : « je viens de créer l'opération FOUGERAY (6 chantiers, phasages
// faits) ; place tout à partir de la date de démarrage que je donne ».
//
// Règles :
// - seuls les chantiers de l'opération sont planifiés ;
// - tout ce qui est déjà posé sur les AUTRES chantiers reste intact et compte
//   comme du temps déjà pris (un ouvrier occupé ailleurs n'est pas disponible) ;
// - sur l'opération, les lignes déjà posées à partir de la date de démarrage et
//   non verrouillées sont remplacées ; les lignes verrouillées, les lignes
//   manuelles (sans tâche du phasage) et tout ce qui précède la date restent ;
// - le calcul est celui du moteur de replanification (chantier 05), sans
//   recalcul parallèle ;
// - aucune tâche ne disparaît en silence : exclusions et non planifiées sont
//   listées avec leur raison, et une fin qu'on ne peut pas calculer reste
//   « au-delà de l'horizon ».

import { preparerSimulationReplanningV1 } from "./planningReplanningAdapterV1.js";
import { planifierReplanningPropositionV1 } from "./planningReplanningEngineV1.js";
import { allocationsDepuisCellules } from "./planningBaselineModelV1.js";
import { normaliserRessource } from "./planningResourceModelV1.js";
import {
  construirePlanApplicationReplanningV1,
  serialiserStableV1,
  weekJourDepuisDateV1,
} from "./planningReplanningApplyPlanV1.js";
import { finPrevisionnelleParChantierV1 } from "./planningFinPrevisionnelleV1.mjs";

export const PLANNING_OPERATION_VERSION = 1;
// Marque posée sur chaque ligne écrite par ce module : permet de retrouver
// (et de retirer) exactement ce que le placement automatique a posé.
export const ORIGINE_LIGNE_OPERATION = "moteur_operation";
export const HORIZONS_OPERATION_JOURS = [182, 366];

const EPS = 0.005;
const txt = v => String(v ?? "").trim();
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const uniq = xs => [...new Set((Array.isArray(xs) ? xs : []).map(txt).filter(Boolean))];
const dateOnly = v => /^\d{4}-\d{2}-\d{2}$/.test(txt(v).slice(0, 10)) ? txt(v).slice(0, 10) : null;
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];

// Raisons moteur qui tiennent seulement à la longueur de la période calculée :
// un horizon plus long peut les résoudre.
const CODES_LIES_HORIZON = new Set([
  "predecesseur_non_termine",
  "delai_technique_hors_horizon",
  "contrainte_date_hors_horizon",
  "capacite_ou_contraintes_horizon",
]);

export function chantiersDeOperationV1(chantiers = [], operationId) {
  const op = txt(operationId);
  if (!op) return [];
  return (Array.isArray(chantiers) ? chantiers : [])
    .filter(c => txt(c?.id) && txt(c?.operation_id) === op && c?.statut !== "termine");
}

// Date ISO d'une cellule (semaine ISO + jour ouvré).
export function dateDepuisCelluleV1(weekId, jour) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(txt(weekId));
  const idx = JOURS.indexOf(txt(jour));
  if (!m || idx < 0) return null;
  const year = Number(m[1]), week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4, 12));
  const lundi = new Date(jan4);
  lundi.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (week - 1) * 7 + idx);
  return lundi.toISOString().slice(0, 10);
}

function indexNomsRessourcesBaseline(ressources = []) {
  // Même clé que l'adaptateur : nom planning en minuscules.
  const map = new Map();
  for (const r of (Array.isArray(ressources) ? ressources : []).map(normaliserRessource)) {
    const k = txt(r.nom_planning || r.nom).toLocaleLowerCase("fr-FR");
    if (r.id && k && !map.has(k)) map.set(k, r);
  }
  return map;
}

// Libellé de l'ouvrage de chaque tâche : plusieurs tâches portent souvent le
// même nom (une « Mise en place de la fenêtre » par fenêtre).
function ouvragesTachesPhasages(phasages = []) {
  const map = new Map();
  for (const ph of Array.isArray(phasages) ? phasages : []) {
    for (const o of Array.isArray(ph?.ouvrages) ? ph.ouvrages : []) {
      const libelle = txt(o?.libelle) || txt(o?.code_ouvrage);
      if (!libelle) continue;
      for (const t of Array.isArray(o?.taches) ? o.taches : []) {
        if (txt(t?.id)) map.set(`${txt(ph.chantier_id)}::${txt(t.id)}`, libelle);
      }
    }
  }
  return map;
}

function nomsTachesPhasages(phasages = []) {
  const map = new Map();
  for (const ph of Array.isArray(phasages) ? phasages : []) {
    for (const o of Array.isArray(ph?.ouvrages) ? ph.ouvrages : []) {
      for (const t of Array.isArray(o?.taches) ? o.taches : []) {
        if (txt(t?.id)) map.set(`${txt(ph.chantier_id)}::${txt(t.id)}`, txt(t?.nom) || "Tâche sans nom");
      }
    }
  }
  return map;
}

/**
 * Temps déjà pris sur les autres chantiers : chaque ligne posée à partir de la
 * date de démarrage devient une charge FIXE pour le moteur (jamais déplacée).
 * Une ligne sans ouvrier reconnu ne réserve personne : elle est comptée à part.
 */
export function occupationAutresChantiersV1({ cellules = [], idsOperation, ressources = [], chantiers = [], startDate }) {
  const ids = idsOperation instanceof Set ? idsOperation : new Set(uniq(idsOperation));
  const debut = dateOnly(startDate);
  const parNom = indexNomsRessourcesBaseline(ressources);
  const chantierMap = new Map((Array.isArray(chantiers) ? chantiers : []).map(c => [txt(c?.id), c]));
  const site = cid => txt(chantierMap.get(cid)?.site_id) || txt(chantierMap.get(cid)?.operation_id) || cid;
  const autres = (Array.isArray(cellules) ? cellules : [])
    .filter(c => !ids.has(txt(c?.chantier_id)))
    .map(c => ({ ...c, taches: (Array.isArray(c?.taches) ? c.taches : []).filter(l => txt(l?.allocation_uid)) }));
  const allocations = allocationsDepuisCellules(autres, { resourceIndex: parNom })
    .filter(a => a.date && (!debut || a.date >= debut) && num(a.duree, 0) > EPS);
  const avecRessource = [];
  let lignesSansRessource = 0;
  for (const a of allocations) {
    if (!uniq(a.resource_ids).length) { lignesSansRessource++; continue; }
    avecRessource.push({
      allocation_uid: a.allocation_uid,
      tache_id: a.tache_id || null,
      chantier_id: a.chantier_id,
      site_id: site(txt(a.chantier_id)),
      date: a.date,
      duree: a.duree,
      resource_ids: uniq(a.resource_ids),
      locked: true,
      occupation_autre_chantier: true,
    });
  }
  return {
    allocations: avecRessource,
    audit: {
      lignes_autres_chantiers: allocations.length,
      lignes_comptees: avecRessource.length,
      lignes_sans_ouvrier_reconnu: lignesSansRessource,
      heures_reservees: round2(avecRessource.reduce((s, a) => s + num(a.duree, 0) * a.resource_ids.length, 0)),
    },
  };
}

// Ordre des lots proposé : un lot ne démarre dans un logement qu'une fois les
// lots listés terminés DANS CE MÊME LOGEMENT. Les lots d'une même ligne
// peuvent avancer en parallèle. Tiré des notes de planningRulesV1.js.
export const ORDRE_LOTS_DEFAUT_V1 = Object.freeze({
  gt_1785154120513: ["gt_demolition"],
  gt_menuiserie_ext: ["gt_demolition"],
  gt_couverture_ext: ["gt_demolition"],
  gt_reseau_plomberie: ["gt_demolition", "gt_1785154120513"],
  gt_ossature_placo: ["gt_demolition", "gt_1785154120513"],
  gt_reseau_elec: ["gt_demolition", "gt_1785154120513"],
  gt_laine_placo: ["gt_reseau_plomberie", "gt_ossature_placo", "gt_reseau_elec", "gt_menuiserie_ext"],
  gt_peinture: ["gt_laine_placo"],
  gt_sols: ["gt_peinture"],
  gt_appareillage_elec: ["gt_peinture"],
  gt_appareillage_plomberie: ["gt_peinture"],
  gt_finition_generale: ["gt_sols", "gt_appareillage_elec", "gt_appareillage_plomberie"],
});

function fermetureLots(table) {
  const memo = new Map();
  const visiter = (g, pile = new Set()) => {
    if (memo.has(g)) return memo.get(g);
    if (pile.has(g)) return new Set();
    pile.add(g);
    const out = new Set();
    for (const p of uniq(table?.[g])) {
      out.add(p);
      for (const pp of visiter(p, pile)) out.add(pp);
    }
    pile.delete(g);
    memo.set(g, out);
    return out;
  };
  return g => visiter(txt(g));
}

/**
 * Ajoute aux travaux les prédécesseurs imposés par l'ordre des lots, logement
 * par logement. Une tâche hors moteur (externe, écartée) ne bloque personne :
 * elle est supposée faite avant la date de démarrage.
 */
export function appliquerOrdreLotsV1(travaux = [], table = ORDRE_LOTS_DEFAUT_V1) {
  const amont = fermetureLots(table || {});
  const parChantierGroupe = new Map();
  for (const t of travaux) {
    const k = `${t.chantier_id}::${t.groupe_type_id || ""}`;
    if (!parChantierGroupe.has(k)) parChantierGroupe.set(k, []);
    parChantierGroupe.get(k).push(t.id);
  }
  let liensAjoutes = 0;
  let travauxTouches = 0;
  const out = travaux.map(t => {
    if (!t.groupe_type_id) return t;
    const ajouts = [];
    for (const g of amont(t.groupe_type_id)) for (const id of parChantierGroupe.get(`${t.chantier_id}::${g}`) || []) ajouts.push(id);
    const ids = uniq([...(t.predecesseur_ids || []), ...ajouts]);
    const nouveaux = ids.length - uniq(t.predecesseur_ids).length;
    if (!nouveaux) return t;
    liensAjoutes += nouveaux;
    travauxTouches++;
    return { ...t, predecesseur_ids: ids, provenance: { ...(t.provenance || {}), ordre_lots_operation: true } };
  });
  return { travaux: out, audit: { liens_ajoutes: liensAjoutes, travaux_touches: travauxTouches } };
}

/**
 * Simule le placement d'une opération sur UN horizon.
 * snapshot = { phasages, chantiers, cellules, ressources, evenementsRessources,
 *              contraintes, groupesTypes, equipes }
 * `cellules` doit couvrir au moins l'horizon (toutes les cellules, tous chantiers).
 */
export function simulerOperationV1({ snapshot = {}, operationId, startDate, horizonDays = 182, ordreLots = ORDRE_LOTS_DEFAUT_V1 } = {}) {
  const debut = dateOnly(startDate);
  if (!debut) throw new Error("Date de démarrage invalide.");
  const chantiersOp = chantiersDeOperationV1(snapshot.chantiers, operationId);
  if (!chantiersOp.length) throw new Error("Cette opération n'a aucun chantier en cours.");
  const ids = new Set(chantiersOp.map(c => txt(c.id)));

  const phasagesOp = (snapshot.phasages || []).filter(p => ids.has(txt(p?.chantier_id)));
  const cellulesOp = (snapshot.cellules || []).filter(c => ids.has(txt(c?.chantier_id)));
  const sansPhasage = chantiersOp
    .filter(c => !phasagesOp.some(p => txt(p.chantier_id) === txt(c.id) && Array.isArray(p.ouvrages) && p.ouvrages.length))
    .map(c => txt(c.id));

  const preparation = preparerSimulationReplanningV1({
    phasages: phasagesOp,
    chantiers: snapshot.chantiers || [],
    cellules: cellulesOp,
    ressources: snapshot.ressources || [],
    evenementsRessources: snapshot.evenementsRessources || [],
    contraintes: snapshot.contraintes || [],
    groupesTypes: snapshot.groupesTypes || [],
    equipes: snapshot.equipes || [],
    startDate: debut,
    horizonDays,
  });

  const occupation = occupationAutresChantiersV1({
    cellules: snapshot.cellules || [],
    idsOperation: ids,
    ressources: snapshot.ressources || [],
    chantiers: snapshot.chantiers || [],
    startDate: debut,
  });

  const lots = ordreLots ? appliquerOrdreLotsV1(preparation.engineInput.travaux, ordreLots) : null;
  const engineInput = {
    ...preparation.engineInput,
    ...(lots ? { travaux: lots.travaux } : {}),
    allocationsExistantes: [
      ...(preparation.engineInput.allocationsExistantes || []),
      ...occupation.allocations,
    ],
  };
  const proposition = planifierReplanningPropositionV1(engineInput);

  return {
    schema_version: 1,
    version: PLANNING_OPERATION_VERSION,
    operation_id: txt(operationId),
    start_date: debut,
    horizon_days: horizonDays,
    chantiers: chantiersOp.map(c => ({ id: txt(c.id), nom: txt(c.nom) || txt(c.id) })),
    chantiers_sans_phasage: sansPhasage,
    noms_taches: Object.fromEntries(nomsTachesPhasages(phasagesOp)),
    ouvrages_taches: Object.fromEntries(ouvragesTachesPhasages(phasagesOp)),
    preparation,
    occupation: occupation.audit,
    ordre_lots: lots ? { actif: true, ...lots.audit } : { actif: false },
    proposition,
  };
}

/**
 * Simule en allongeant la période si nécessaire : 26 semaines, puis 52 si des
 * tâches restent bloquées pour une raison qui tient à la période.
 */
export function simulerOperationJusquAuBoutV1({ snapshot, operationId, startDate, horizons = HORIZONS_OPERATION_JOURS, ordreLots = ORDRE_LOTS_DEFAUT_V1 } = {}) {
  const liste = [...new Set(horizons.map(h => Math.max(7, Math.min(366, Math.round(num(h, 182))))))].sort((a, b) => a - b);
  let res = null;
  for (const h of liste) {
    res = simulerOperationV1({ snapshot, operationId, startDate, horizonDays: h, ordreLots });
    const lies = (res.proposition.non_planifies || []).filter(np => CODES_LIES_HORIZON.has(np.raison_code));
    if (!lies.length) break;
  }
  return res;
}

/**
 * Lecture métier du résultat : par chantier (début, fin ou « au-delà »),
 * tâches non placées (avec nom et raison), tâches écartées par les données.
 */
export function resumerSimulationOperationV1(sim) {
  const nomsTaches = new Map(Object.entries(sim?.noms_taches || {}));
  const nomTache = (chantierId, tacheId) => nomsTaches.get(`${txt(chantierId)}::${txt(tacheId)}`) || "Tâche sans nom";
  const proposition = sim?.proposition || {};
  const fins = finPrevisionnelleParChantierV1(proposition);
  const finParChantier = new Map((fins.chantiers || []).map(c => [c.chantier_id, c]));
  const allocations = proposition.allocations_proposees || [];
  const exclus = sim?.preparation?.travaux_exclus || [];
  const travaux = sim?.preparation?.engineInput?.travaux || [];

  const chantiers = (sim?.chantiers || []).map(c => {
    const f = finParChantier.get(c.id) || null;
    const allocs = allocations.filter(a => txt(a.chantier_id) === c.id);
    const dates = allocs.map(a => a.date).filter(Boolean).sort();
    const nonPlanifies = (proposition.non_planifies || []).filter(np => txt(np.chantier_id) === c.id);
    const exclusCh = exclus.filter(x => txt(x.chantier_id) === c.id);
    const aPlanifier = round2(travaux.filter(t => t.chantier_id === c.id).reduce((s, t) => s + num(t.heures_mo_restantes, 0), 0));
    const sansPhasage = (sim?.chantiers_sans_phasage || []).includes(c.id);
    const complet = !sansPhasage && nonPlanifies.length === 0 && exclusCh.length === 0;
    return {
      chantier_id: c.id,
      nom: c.nom,
      sans_phasage: sansPhasage,
      debut: dates[0] || null,
      // Une fin n'existe que si TOUT est placé : sinon seulement un minimum.
      fin: complet && dates.length ? dates[dates.length - 1] : null,
      dernier_jour_place: dates[dates.length - 1] || null,
      complet,
      // Tout le travail confié au moteur est posé ; il peut rester des tâches
      // écartées (externes…) : la fin COMPLÈTE reste alors inconnue.
      travail_moteur_place: !sansPhasage && nonPlanifies.length === 0,
      jours_places: new Set(dates).size,
      heures_a_placer: aPlanifier,
      heures_placees: round2(allocs.reduce((s, a) => s + num(a.heures_mo, 0), 0)),
      taches_non_placees: nonPlanifies.length,
      taches_ecartees: exclusCh.length,
      fin_moteur: f,
    };
  });

  const nonPlaces = (proposition.non_planifies || []).map(np => ({
    chantier_id: np.chantier_id,
    tache_id: np.tache_id,
    nom: nomTache(np.chantier_id, np.tache_id),
    heures: round2(np.heures_mo_restantes),
    raison: np.raison,
    raison_code: np.raison_code,
    liee_a_la_periode: CODES_LIES_HORIZON.has(np.raison_code),
  }));
  const ecartees = exclus.map(x => ({
    chantier_id: x.chantier_id,
    tache_id: x.tache_id,
    nom: x.tache_id ? nomTache(x.chantier_id, x.tache_id) : "Tâche sans identifiant",
    type: x.type,
    explication: x.explication,
  }));

  const toutesDates = allocations.map(a => a.date).filter(Boolean).sort();
  const complet = chantiers.every(c => c.complet);
  const ouvriers = new Map();
  for (const a of allocations) for (const rid of a.resource_ids || []) ouvriers.set(rid, round2((ouvriers.get(rid) || 0) + num(a.duree, 0)));

  return {
    start_date: sim?.start_date || null,
    horizon_days: sim?.horizon_days || null,
    debut: toutesDates[0] || null,
    fin: complet && toutesDates.length ? toutesDates[toutesDates.length - 1] : null,
    dernier_jour_place: toutesDates[toutesDates.length - 1] || null,
    complet,
    travail_moteur_place: chantiers.every(c => c.travail_moteur_place),
    heures_a_placer: round2(chantiers.reduce((s, c) => s + c.heures_a_placer, 0)),
    heures_placees: round2(allocations.reduce((s, a) => s + num(a.heures_mo, 0), 0)),
    jours_places: new Set(toutesDates).size,
    chantiers,
    non_places: nonPlaces,
    ecartees,
    heures_par_ouvrier: [...ouvriers.entries()].map(([resource_id, heures]) => ({ resource_id, heures }))
      .sort((a, b) => b.heures - a.heures || a.resource_id.localeCompare(b.resource_id)),
    occupation: sim?.occupation || null,
  };
}

// Champs comparés avant écriture (même définition que le plan d'application).
export function payloadCelluleOperationV1(cell = {}) {
  return {
    week_id: txt(cell?.week_id),
    chantier_id: txt(cell?.chantier_id),
    jour: txt(cell?.jour),
    planifie: String(cell?.planifie ?? ""),
    reel: String(cell?.reel ?? ""),
    ouvriers: uniq(cell?.ouvriers),
    taches: JSON.parse(JSON.stringify(Array.isArray(cell?.taches) ? cell.taches : [])),
    vehicules: JSON.parse(JSON.stringify(Array.isArray(cell?.vehicules) ? cell.vehicules : [])),
  };
}

/**
 * Plan d'écriture des journées de l'opération. Réutilise le plan d'application
 * du chantier 05 (lignes conservées, identités, compare-before-write) et
 * marque chaque ligne posée avec ORIGINE_LIGNE_OPERATION.
 * Bloque (blocages[]) plutôt que d'écrire un état incohérent.
 */
export function construirePlanEcritureOperationV1({ sim, cellulesOperationToutes = [], placeLe = null, aujourdhui = null } = {}) {
  const blocages = [];
  const ids = new Set((sim?.chantiers || []).map(c => c.id));
  const debut = sim?.start_date;
  const horizon = sim?.horizon_days;
  const fin = (sim?.proposition?.horizon_end) || null;

  // Lignes de l'opération posées APRÈS la période calculée : elles feraient
  // doublon avec le nouveau placement. Jamais effacées en silence.
  const lignesApres = [];
  for (const c of cellulesOperationToutes) {
    if (!ids.has(txt(c?.chantier_id))) continue;
    const d = dateDepuisCelluleV1(c.week_id, c.jour);
    if (!d || !fin || d <= fin) continue;
    for (const l of Array.isArray(c?.taches) ? c.taches : []) if (txt(l?.tache_id)) lignesApres.push({ date: d, chantier_id: c.chantier_id, tache_id: l.tache_id });
  }
  if (lignesApres.length) blocages.push({
    code: "lignes_apres_periode",
    explication: `${lignesApres.length} ligne(s) de l'opération sont déjà posées après le ${fin} : retirez-les ou choisissez une autre date avant de placer.`,
  });
  // Lignes de l'opération entre aujourd'hui et la date de démarrage : ce sont
  // des journées à venir, pas du travail fait. Le moteur reposerait ces tâches
  // en entier après la date : elles seraient en double.
  const jour = dateOnly(aujourdhui);
  if (jour && jour < debut) {
    const entre = [];
    for (const c of cellulesOperationToutes) {
      if (!ids.has(txt(c?.chantier_id))) continue;
      const d = dateDepuisCelluleV1(c.week_id, c.jour);
      if (!d || d < jour || d >= debut) continue;
      for (const l of Array.isArray(c?.taches) ? c.taches : []) if (txt(l?.tache_id)) entre.push(d);
    }
    if (entre.length) blocages.push({
      code: "lignes_avant_demarrage",
      explication: `${entre.length} ligne(s) de l'opération sont déjà posées entre aujourd'hui et la date de démarrage (à partir du ${entre.sort()[0]}) : ces tâches seraient posées en double. Retirez d'abord le placement existant, ou choisissez une date de démarrage plus tôt.`,
    });
  }
  const sansUid = cellulesOperationToutes.filter(c => ids.has(txt(c?.chantier_id)))
    .flatMap(c => (Array.isArray(c?.taches) ? c.taches : []).filter(l => !txt(l?.allocation_uid)).map(() => c));
  if (sansUid.length) blocages.push({
    code: "lignes_sans_identifiant",
    explication: `${sansUid.length} ligne(s) de l'opération n'ont pas d'identifiant : ouvrez ces journées dans le planning et enregistrez-les une fois avant de placer.`,
  });

  const cellulesPeriode = cellulesOperationToutes.filter(c => {
    if (!ids.has(txt(c?.chantier_id))) return false;
    const d = dateDepuisCelluleV1(c.week_id, c.jour);
    return d && d >= debut && (!fin || d <= fin);
  });

  let plan = null;
  if (!sansUid.length) {
    try {
      plan = construirePlanApplicationReplanningV1({
        cellules: cellulesPeriode,
        forecastCourant: sim.preparation.forecastCourant,
        proposition: sim.proposition,
        ressources: sim.preparation.engineInput.ressources,
        startDate: debut,
        horizonDays: horizon,
      });
    } catch (e) {
      blocages.push({ code: "plan_incoherent", explication: `Écriture impossible : ${e?.message || e}` });
    }
  }

  const uidsProposes = new Set((plan?.operations || []).flatMap(o => o.allocation_uids_proposes_dans_cette_cellule || []));
  const operations = (plan?.operations || []).map(op => ({
    ...op,
    after: {
      ...op.after,
      taches: op.after.taches.map(l => uidsProposes.has(txt(l.allocation_uid))
        // `id` : identifiant de ligne attendu par l'écran Planning (clé, déplacement).
        ? { id: txt(l.id) || txt(l.allocation_uid), ...l, origine: ORIGINE_LIGNE_OPERATION, ...(placeLe ? { place_le: placeLe } : {}) }
        : l),
    },
  }));

  // Lignes retirées par le recalcul : (chantier, tâche) → dates retirées.
  const avantParCle = new Map(cellulesPeriode.map(c => [`${c.week_id}::${c.chantier_id}::${c.jour}`, c]));
  const retirees = [];
  for (const op of operations) {
    const avant = avantParCle.get(op.cell_key);
    const date = avant ? dateDepuisCelluleV1(avant.week_id, avant.jour) : null;
    const uids = new Set(op.allocation_uids_recalculables_retires_de_cette_cellule || []);
    for (const l of avant?.taches || []) if (uids.has(txt(l.allocation_uid)) && txt(l.tache_id)) retirees.push({ chantier_id: avant.chantier_id, tache_id: txt(l.tache_id), date });
  }

  return {
    ok: blocages.length === 0 && !!plan,
    blocages,
    operations,
    lignes_retirees: retirees,
    resume: plan ? {
      journees_ecrites: operations.length,
      journees_creees: operations.filter(o => o.type === "insert").length,
      journees_modifiees: operations.filter(o => o.type === "update").length,
      lignes_posees: uidsProposes.size,
      lignes_remplacees: retirees.length,
      lignes_conservees: plan.resume?.allocations_hors_scope_preservees || 0,
    } : null,
  };
}

/**
 * Compare-before-write : toutes les journées relues doivent être EXACTEMENT
 * celles du calcul. Une seule différence = rien n'est écrit.
 */
export function verifierCellulesAvantEcritureV1(operations = [], cellulesRelues = []) {
  const relues = new Map((Array.isArray(cellulesRelues) ? cellulesRelues : [])
    .map(c => [`${txt(c.week_id)}::${txt(c.chantier_id)}::${txt(c.jour)}`, c]));
  const conflits = [];
  for (const op of Array.isArray(operations) ? operations : []) {
    const actuelle = relues.get(op.cell_key) || null;
    const attendu = op.expected_before || { exists: false };
    if (!attendu.exists) {
      // Une journée vide mais présente (ex. ouvriers seuls) est un changement.
      if (actuelle) conflits.push(op.cell_key);
      continue;
    }
    if (!actuelle || serialiserStableV1(payloadCelluleOperationV1(actuelle)) !== serialiserStableV1(attendu.payload)) conflits.push(op.cell_key);
  }
  return { ok: conflits.length === 0, conflits };
}

/**
 * Dates prévues du phasage après écriture : date_prevue = PREMIER jour posé
 * (invariant du planning). Une tâche qui n'est plus posée nulle part perd sa
 * date seulement si celle-ci venait d'une ligne retirée par ce placement.
 * Renvoie les ouvrages modifiés, ou null si rien ne change.
 */
export function datesPrevuesApresPlacementV1({ phasage, cellulesChantierApres = [], lignesRetirees = [] } = {}) {
  const chantierId = txt(phasage?.chantier_id);
  const premiere = new Map();
  for (const c of Array.isArray(cellulesChantierApres) ? cellulesChantierApres : []) {
    if (txt(c?.chantier_id) !== chantierId) continue;
    const d = dateDepuisCelluleV1(c.week_id, c.jour);
    if (!d) continue;
    for (const l of Array.isArray(c?.taches) ? c.taches : []) {
      const tid = txt(l?.tache_id);
      if (tid && (!premiere.has(tid) || d < premiere.get(tid))) premiere.set(tid, d);
    }
  }
  const retireesParTache = new Map();
  for (const r of lignesRetirees) {
    if (txt(r.chantier_id) !== chantierId) continue;
    if (!retireesParTache.has(r.tache_id)) retireesParTache.set(r.tache_id, new Set());
    retireesParTache.get(r.tache_id).add(r.date);
  }
  let changements = 0;
  const ouvrages = (Array.isArray(phasage?.ouvrages) ? phasage.ouvrages : []).map(o => ({
    ...o,
    taches: (Array.isArray(o?.taches) ? o.taches : []).map(t => {
      const tid = txt(t?.id);
      if (!tid) return t;
      const actuelle = dateOnly(t?.date_prevue) || "";
      let cible = actuelle;
      if (premiere.has(tid)) cible = premiere.get(tid);
      else if (actuelle && retireesParTache.get(tid)?.has(actuelle)) cible = "";
      if (cible === actuelle) return t;
      changements++;
      return { ...t, date_prevue: cible };
    }),
  }));
  return changements ? { ouvrages, changements } : null;
}

/**
 * Retrait du placement automatique : enlève de l'opération toutes les lignes
 * marquées ORIGINE_LIGNE_OPERATION (à partir d'une date si fournie).
 * Rien d'autre n'est touché.
 */
export function construirePlanRetraitOperationV1({ cellulesOperationToutes = [], idsChantiers = [], aPartirDu = null } = {}) {
  const ids = new Set(uniq(idsChantiers));
  const depuis = dateOnly(aPartirDu);
  const operations = [];
  const retirees = [];
  for (const c of cellulesOperationToutes) {
    if (!ids.has(txt(c?.chantier_id))) continue;
    const d = dateDepuisCelluleV1(c.week_id, c.jour);
    if (depuis && (!d || d < depuis)) continue;
    const lignes = Array.isArray(c?.taches) ? c.taches : [];
    const gardees = lignes.filter(l => l?.origine !== ORIGINE_LIGNE_OPERATION);
    if (gardees.length === lignes.length) continue;
    lignes.filter(l => l?.origine === ORIGINE_LIGNE_OPERATION && txt(l.tache_id))
      .forEach(l => retirees.push({ chantier_id: txt(c.chantier_id), tache_id: txt(l.tache_id), date: d }));
    const ouvriersGardes = uniq(gardees.flatMap(l => uniq(l?.ouvriers)));
    const lignesSansOuvrier = gardees.some(l => !uniq(l?.ouvriers).length);
    const before = payloadCelluleOperationV1(c);
    operations.push({
      cell_key: `${txt(c.week_id)}::${txt(c.chantier_id)}::${txt(c.jour)}`,
      type: "update",
      expected_before: { exists: true, id: txt(c.id) || null, payload: before },
      after: {
        ...before,
        taches: gardees,
        planifie: gardees.map(l => txt(l?.text)).filter(Boolean).join("\n"),
        ouvriers: lignesSansOuvrier ? before.ouvriers : ouvriersGardes,
      },
    });
  }
  return { operations, lignes_retirees: retirees };
}

export function lignesPoseesParOperationV1(cellulesOperationToutes = [], idsChantiers = []) {
  const ids = new Set(uniq(idsChantiers));
  let n = 0;
  const dates = [];
  for (const c of cellulesOperationToutes) {
    if (!ids.has(txt(c?.chantier_id))) continue;
    for (const l of Array.isArray(c?.taches) ? c.taches : []) {
      if (l?.origine !== ORIGINE_LIGNE_OPERATION) continue;
      n++;
      const d = dateDepuisCelluleV1(c.week_id, c.jour);
      if (d) dates.push(d);
    }
  }
  dates.sort();
  return { lignes: n, premier_jour: dates[0] || null, dernier_jour: dates[dates.length - 1] || null };
}

// Date de démarrage proposée : premier jour ouvré (lun→ven) à partir de `iso`.
export function premierJourOuvreV1(iso) {
  const d0 = dateOnly(iso);
  if (!d0) return null;
  const d = new Date(`${d0}T12:00:00Z`);
  for (let i = 0; i < 7; i++) {
    const wd = d.getUTCDay();
    if (wd >= 1 && wd <= 5) return d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d0;
}

export { weekJourDepuisDateV1 };

/**
 * Par logement : chaque lot avec son premier et son dernier jour posés, ses
 * heures et ses ouvriers — pour vérifier l'enchaînement d'un coup d'œil.
 */
export function lotsParChantierV1(sim, groupesTypes = []) {
  const gts = new Map((Array.isArray(groupesTypes) ? groupesTypes : []).map(g => [txt(g?.id), g]));
  const parCh = new Map();
  for (const a of sim?.proposition?.allocations_proposees || []) {
    const cid = txt(a.chantier_id);
    const gid = txt(a.groupe_type_id) || "sans_lot";
    if (!parCh.has(cid)) parCh.set(cid, new Map());
    const lots = parCh.get(cid);
    const l = lots.get(gid) || { groupe_type_id: gid === "sans_lot" ? null : gid, debut: a.date, fin: a.date, heures: 0, ressources: new Set() };
    if (a.date < l.debut) l.debut = a.date;
    if (a.date > l.fin) l.fin = a.date;
    l.heures = round2(l.heures + num(a.heures_mo, 0));
    (a.resource_ids || []).forEach(r => l.ressources.add(r));
    lots.set(gid, l);
  }
  const out = {};
  for (const [cid, lots] of parCh) {
    out[cid] = [...lots.values()].map(l => {
      const gt = gts.get(txt(l.groupe_type_id));
      return {
        groupe_type_id: l.groupe_type_id,
        nom: txt(gt?.nom) || "Sans lot",
        ordre: num(gt?.ordre, 9999),
        debut: l.debut,
        fin: l.fin,
        heures: l.heures,
        resource_ids: [...l.ressources].sort(),
      };
    }).sort((a, b) => a.ordre - b.ordre || a.debut.localeCompare(b.debut));
  }
  return out;
}

/** Ordre des lots en phrases, pour l'afficher tel qu'il est appliqué. */
export function ordreLotsLisibleV1(table = ORDRE_LOTS_DEFAUT_V1, groupesTypes = []) {
  const gts = new Map((Array.isArray(groupesTypes) ? groupesTypes : []).map(g => [txt(g?.id), g]));
  const nom = id => txt(gts.get(id)?.nom) || id;
  return Object.entries(table || {})
    .map(([g, avant]) => ({ groupe_type_id: g, ordre: num(gts.get(g)?.ordre, 9999), lot: nom(g), apres: uniq(avant).map(nom) }))
    .sort((a, b) => a.ordre - b.ordre);
}

/**
 * Aperçu tâche par tâche d'un logement : chaque tâche du moteur avec son
 * premier et son dernier jour posés, ses heures et ses ouvriers. Tri : lot
 * (ordre du référentiel), puis premier jour, puis ordre du phasage. Une tâche
 * non placée garde debut/fin à null et porte sa raison.
 */
export function tachesParChantierV1(sim, groupesTypes = []) {
  const gts = new Map((Array.isArray(groupesTypes) ? groupesTypes : []).map(g => [txt(g?.id), g]));
  const parTravail = new Map();
  for (const a of sim?.proposition?.allocations_proposees || []) {
    const id = txt(a.travail_id) || `${txt(a.chantier_id)}::${txt(a.tache_id)}`;
    const e = parTravail.get(id) || { dates: new Set(), heures: 0, ressources: new Set() };
    e.dates.add(a.date);
    e.heures = round2(e.heures + num(a.heures_mo, 0));
    (a.resource_ids || []).forEach(r => e.ressources.add(r));
    parTravail.set(id, e);
  }
  const nonPlaces = new Map((sim?.proposition?.non_planifies || []).map(np => [txt(np.travail_id), np]));
  const out = {};
  for (const t of sim?.preparation?.engineInput?.travaux || []) {
    const e = parTravail.get(t.id);
    const dates = e ? [...e.dates].sort() : [];
    const gt = gts.get(txt(t.groupe_type_id));
    const np = nonPlaces.get(t.id);
    (out[t.chantier_id] ||= []).push({
      tache_id: t.tache_id,
      nom: txt(t.texte) || "Tâche sans nom",
      ouvrage: txt(sim?.ouvrages_taches?.[t.id]) || null,
      groupe_type_id: t.groupe_type_id || null,
      lot: txt(gt?.nom) || "Sans lot",
      lot_ordre: num(gt?.ordre, num(t.ordre_groupe, 9999)),
      ordre_tache: num(t.ordre_tache, 0),
      debut: dates[0] || null,
      fin: dates[dates.length - 1] || null,
      jours: dates.length,
      dates,
      heures_placees: e ? e.heures : 0,
      heures_a_placer: round2(num(t.heures_mo_restantes, 0)),
      resource_ids: e ? [...e.ressources].sort() : [],
      placee: !np,
      raison: np ? np.raison : null,
    });
  }
  for (const liste of Object.values(out)) {
    liste.sort((a, b) => (a.lot_ordre - b.lot_ordre)
      || ((a.debut || "9999") < (b.debut || "9999") ? -1 : (a.debut || "9999") > (b.debut || "9999") ? 1 : 0)
      || (a.ordre_tache - b.ordre_tache)
      || a.nom.localeCompare(b.nom));
  }
  return out;
}

/**
 * Aperçu semaine par semaine, au format de la grille Planning :
 * [{ week_id, jours: [{ jour, date }], cellules: { chantier_id: { jour: [lignes] } } }]
 * Une ligne = { tache_id, nom, duree, resource_ids, groupe_type_id }.
 */
export function semainesSimulationV1(sim) {
  const semaines = new Map();
  for (const a of sim?.proposition?.allocations_proposees || []) {
    let wj;
    try { wj = weekJourDepuisDateV1(a.date); } catch { continue; }
    if (!semaines.has(wj.week_id)) {
      semaines.set(wj.week_id, {
        week_id: wj.week_id,
        jours: JOURS.map(jour => ({ jour, date: dateDepuisCelluleV1(wj.week_id, jour) })),
        cellules: {},
      });
    }
    const s = semaines.get(wj.week_id);
    const parJour = (s.cellules[txt(a.chantier_id)] ||= {});
    (parJour[wj.jour] ||= []).push({
      tache_id: txt(a.tache_id),
      nom: txt(a.texte) || "Tâche sans nom",
      ouvrage: txt(sim?.ouvrages_taches?.[txt(a.travail_id)]) || null,
      duree: round2(num(a.duree, 0)),
      resource_ids: uniq(a.resource_ids),
      groupe_type_id: a.groupe_type_id || null,
    });
  }
  return [...semaines.values()].sort((a, b) => a.jours[0].date.localeCompare(b.jours[0].date));
}
