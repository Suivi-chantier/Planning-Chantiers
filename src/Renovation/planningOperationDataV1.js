// ─── PLANIFIER UNE OPÉRATION — LECTURE / ÉCRITURE SUPABASE ──────────────────
// Toute la logique vit dans planningOperationV1.mjs (pur). Ce module lit une
// photographie, et écrit UNIQUEMENT les journées des chantiers de l'opération
// (planning_cells) puis leurs dates prévues (phasages, en une transaction).
//
// Garde d'écriture : avant d'écrire, les journées de l'opération sont relues
// et doivent être exactement celles du calcul, et le temps déjà pris sur les
// autres chantiers doit être inchangé. Sinon rien n'est écrit : on relance.

import { supabase } from "../supabase";
import { sauvegarderPhasagesLot } from "./phasageEcriture.mjs";
import { metaHorizonMoteurV1, parserConfigMoteurV1 } from "./planningEngineDataHelpersV1.js";
import {
  HORIZONS_OPERATION_JOURS,
  construirePlanEcritureOperationV1,
  construirePlanRetraitOperationV1,
  datesPrevuesApresPlacementV1,
  occupationAutresChantiersV1,
  simulerOperationJusquAuBoutV1,
  verifierCellulesAvantEcritureV1,
} from "./planningOperationV1.mjs";

const PAGE = 1000; // plafond silencieux de l'API : on lit toujours par pages
const PAQUET_ECRITURE = 40;
const COLS_CELLULE = "id,week_id,chantier_id,jour,planifie,reel,taches,ouvriers,vehicules";

function verifier(res, label) {
  if (res?.error) throw new Error(`${label} : ${res.error.message || "erreur Supabase"}`);
  return res?.data || [];
}

async function lireToutesPages(construire, label) {
  const out = [];
  for (let debut = 0; ; debut += PAGE) {
    const rows = verifier(await construire().range(debut, debut + PAGE - 1), label);
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function lireCellulesSemaines(weekIds) {
  return lireToutesPages(
    () => supabase.from("planning_cells").select(COLS_CELLULE).in("week_id", weekIds).order("id"),
    "Planning",
  );
}

async function lireCellulesChantiers(ids) {
  return lireToutesPages(
    () => supabase.from("planning_cells").select(COLS_CELLULE).in("chantier_id", ids).order("id"),
    "Planning de l'opération",
  );
}

/**
 * Photographie pour simuler l'opération : tout ce qui est nécessaire jusqu'au
 * plus long horizon possible (52 semaines), lu une seule fois.
 */
export async function chargerSnapshotOperationV1({ operationId, startDate }) {
  const horizonMax = metaHorizonMoteurV1(startDate, Math.max(...HORIZONS_OPERATION_JOURS));
  const configRows = verifier(await supabase.from("planning_config").select("key,value")
    .in("key", ["chantiers", "groupes_types", "equipes"]), "Configuration planning");
  const config = parserConfigMoteurV1(configRows);
  const idsOp = config.chantiers.filter(c => c?.operation_id === operationId && c?.statut !== "termine").map(c => c.id);
  if (!idsOp.length) throw new Error("Cette opération n'a aucun chantier en cours.");

  const [phasagesRes, cellules, cellulesOperation, ressourcesRes, evenementsRes, contraintesRes] = await Promise.all([
    supabase.from("phasages").select("id,chantier_id,chantier_nom,ouvrages,plan_travaux,updated_at,revision").in("chantier_id", idsOp),
    lireCellulesSemaines(horizonMax.week_ids),
    lireCellulesChantiers(idsOp),
    supabase.from("planning_resources")
      .select("id,nom,nom_planning,kind,actif,capacite_facteur,utilisateur_id,auth_user_id")
      .eq("actif", true).order("nom_planning"),
    supabase.from("planning_resource_events")
      .select("id,resource_id,type,date_debut,date_fin,toute_journee,heures_indisponibles,capacite_heures,motif,motif_code,source,details,actif")
      .eq("actif", true).lte("date_debut", horizonMax.end_date).gte("date_fin", horizonMax.start_date),
    supabase.from("planning_constraints")
      .select("id,type,scope,chantier_id,groupe_type_id,tache_id,allocation_id,hard,priority,date_debut,date_fin,config,label,source,actif,created_at,updated_at")
      .eq("actif", true),
  ]);

  return {
    snapshot: {
      phasages: verifier(phasagesRes, "Phasages"),
      chantiers: config.chantiers,
      cellules,
      ressources: verifier(ressourcesRes, "Ressources"),
      evenementsRessources: verifier(evenementsRes, "Absences"),
      contraintes: verifier(contraintesRes, "Consignes planning"),
      groupesTypes: config.groupesTypes,
      equipes: config.equipes,
    },
    cellulesOperation,
    idsOperation: idsOp,
  };
}

/** Simulation seule : aucune écriture. */
export async function simulerOperationDepuisBaseV1({ operationId, startDate }) {
  const data = await chargerSnapshotOperationV1({ operationId, startDate });
  const sim = simulerOperationJusquAuBoutV1({ snapshot: data.snapshot, operationId, startDate });
  return { ...data, sim };
}

async function ecrireCellules(operations) {
  let ecrites = 0;
  for (let i = 0; i < operations.length; i += PAQUET_ECRITURE) {
    const paquet = operations.slice(i, i + PAQUET_ECRITURE).map(op => ({ ...op.after }));
    const { error } = await supabase.from("planning_cells").upsert(paquet, { onConflict: "week_id,chantier_id,jour" });
    if (error) {
      const e = new Error(`Écriture du planning interrompue après ${ecrites} journée(s) sur ${operations.length} : ${error.message}`);
      e.ecrites = ecrites;
      throw e;
    }
    ecrites += paquet.length;
  }
  return ecrites;
}

// Dates prévues des phasages, en une transaction (tout ou rien). Recalculées
// sur l'état relu après écriture ; un conflit de révision est retenté une fois.
async function recalerDatesPrevues({ idsOperation, lignesRetirees }) {
  for (let essai = 0; essai < 2; essai++) {
    const [phasages, cellules] = await Promise.all([
      supabase.from("phasages").select("id,chantier_id,revision,ouvrages").in("chantier_id", idsOperation).then(r => verifier(r, "Phasages")),
      lireCellulesChantiers(idsOperation),
    ]);
    const lot = [];
    let changements = 0;
    for (const ph of phasages) {
      const res = datesPrevuesApresPlacementV1({ phasage: ph, cellulesChantierApres: cellules, lignesRetirees });
      if (!res) continue;
      changements += res.changements;
      lot.push({ phasage_id: ph.id, revision_attendue: ph.revision ?? 0, ouvrages: res.ouvrages });
    }
    if (!lot.length) return { ok: true, changements: 0 };
    const out = await sauvegarderPhasagesLot(lot);
    if (out.ok) return { ok: true, changements };
    if (out.code !== "conflit") return { ok: false, code: out.code };
  }
  return { ok: false, code: "conflit" };
}

/**
 * Écrit le placement simulé. `simulation` = retour de simulerOperationDepuisBaseV1.
 * Renvoie { ok, journees, lignes, dates } ou { ok:false, raison, detail }.
 */
export async function placerOperationV1({ simulation, placeLe }) {
  const { sim, idsOperation, snapshot } = simulation;
  // 1. Relire et vérifier que rien n'a bougé depuis la simulation.
  const [cellulesOpNow, cellulesHorizonNow] = await Promise.all([
    lireCellulesChantiers(idsOperation),
    lireCellulesSemaines(metaHorizonMoteurV1(sim.start_date, Math.max(...HORIZONS_OPERATION_JOURS)).week_ids),
  ]);
  const plan = construirePlanEcritureOperationV1({ sim, cellulesOperationToutes: simulation.cellulesOperation, placeLe, aujourdhui: placeLe });
  if (!plan.ok) return { ok: false, raison: "blocage", detail: plan.blocages };
  const verif = verifierCellulesAvantEcritureV1(plan.operations, cellulesOpNow);
  if (!verif.ok) return { ok: false, raison: "planning_modifie", detail: verif.conflits };
  const occAvant = occupationAutresChantiersV1({ cellules: snapshot.cellules, idsOperation, ressources: snapshot.ressources, chantiers: snapshot.chantiers, startDate: sim.start_date });
  const occApres = occupationAutresChantiersV1({ cellules: cellulesHorizonNow, idsOperation, ressources: snapshot.ressources, chantiers: snapshot.chantiers, startDate: sim.start_date });
  const empreinte = o => o.allocations.map(a => `${a.allocation_uid}|${a.date}|${a.duree}|${a.resource_ids.join(",")}`).sort().join(";");
  if (empreinte(occAvant) !== empreinte(occApres)) return { ok: false, raison: "autres_chantiers_modifies" };

  // 2. Écrire les journées de l'opération.
  const journees = await ecrireCellules(plan.operations);
  // 3. Dates prévues du phasage = premier jour posé.
  const dates = await recalerDatesPrevues({ idsOperation, lignesRetirees: plan.lignes_retirees });
  return { ok: true, journees, lignes: plan.resume?.lignes_posees || 0, dates };
}

/** Retire toutes les lignes posées par le placement automatique de l'opération. */
export async function retirerPlacementOperationV1({ idsOperation }) {
  const cellules = await lireCellulesChantiers(idsOperation);
  const plan = construirePlanRetraitOperationV1({ cellulesOperationToutes: cellules, idsChantiers: idsOperation });
  if (!plan.operations.length) return { ok: true, journees: 0, lignes: 0, dates: { ok: true, changements: 0 } };
  const journees = await ecrireCellules(plan.operations);
  const dates = await recalerDatesPrevues({ idsOperation, lignesRetirees: plan.lignes_retirees });
  return { ok: true, journees, lignes: plan.lignes_retirees.length, dates };
}

/** Lignes déjà posées par le placement automatique (pour l'écran). */
export async function lireCellulesOperationV1(idsOperation) {
  return lireCellulesChantiers(idsOperation);
}
