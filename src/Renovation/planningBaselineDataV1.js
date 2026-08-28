import { supabase } from "../supabase";
import { chargerRessourcesPlanningV1, indexerRessourcesParNomPlanningV1 } from "./planningResourceDataV1.js";
import {
  allocationsDepuisCellules,
  creerSnapshotPlanningReferenceV1,
  diffPlanningReferenceV1,
} from "./planningBaselineModelV1.js";

const txt = v => String(v ?? "").trim();

export async function chargerDonneesPlanningBaselineV1() {
  const [cellsRes, baselinesRes, resources] = await Promise.all([
    supabase.from("planning_cells")
      .select("id,week_id,chantier_id,jour,taches,ouvriers")
      .order("week_id", { ascending:true }),
    supabase.from("planning_baselines")
      .select("id,chantier_id,version,label,source,note,snapshot,allocation_count,created_by,created_at")
      .order("chantier_id", { ascending:true })
      .order("version", { ascending:false }),
    chargerRessourcesPlanningV1(),
  ]);
  if (cellsRes.error) throw cellsRes.error;
  if (baselinesRes.error) throw baselinesRes.error;
  return {
    cells: cellsRes.data || [],
    baselines: baselinesRes.data || [],
    resources,
    resourceIndex: indexerRessourcesParNomPlanningV1(resources),
  };
}

export function indexerCellulesParChantierV1(cells = []) {
  const map = new Map();
  for (const cell of Array.isArray(cells) ? cells : []) {
    const key = txt(cell?.chantier_id);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(cell);
  }
  return map;
}

export function indexerDerniereBaselineParChantierV1(baselines = []) {
  const map = new Map();
  for (const b of Array.isArray(baselines) ? baselines : []) {
    const key = txt(b?.chantier_id);
    if (!key) continue;
    const cur = map.get(key);
    if (!cur || Number(b.version || 0) > Number(cur.version || 0)) map.set(key, b);
  }
  return map;
}

export function allocationsCourantesChantierV1(cells, chantierId, resourceIndex = new Map()) {
  const selected = (Array.isArray(cells) ? cells : []).filter(c => txt(c?.chantier_id) === txt(chantierId));
  // Depuis le backfill DB, allocation_uid est garanti par trigger. Si une ligne
  // ancienne ou externe échappe néanmoins à la règle, on refuse de figer une
  // identité inventée uniquement en mémoire.
  const sansUid = selected.flatMap(c => (Array.isArray(c.taches) ? c.taches : []))
    .filter(t => !txt(t?.allocation_uid));
  if (sansUid.length) throw new Error(`${sansUid.length} allocation(s) sans allocation_uid : recharge le planning avant de figer la référence.`);
  return allocationsDepuisCellules(selected, { resourceIndex });
}

export function etatBaselineChantierV1({ chantierId, cells = [], baseline = null, resourceIndex = new Map() } = {}) {
  const courant = allocationsCourantesChantierV1(cells, chantierId, resourceIndex);
  const reference = Array.isArray(baseline?.snapshot?.allocations) ? baseline.snapshot.allocations : [];
  const diff = baseline ? diffPlanningReferenceV1(reference, courant) : null;
  return {
    chantier_id: chantierId,
    courant,
    baseline,
    reference,
    diff,
    sans_duree: courant.filter(a => !(Number(a.duree) > 0)).length,
    lignes_manuelles: courant.filter(a => !a.tache_id).length,
  };
}

export async function creerBaselineChantierV1({ chantierId, cells, resourceIndex, derniereBaseline = null, note = null, label = null } = {}) {
  const id = txt(chantierId);
  if (!id) throw new Error("chantierId obligatoire");
  const allocations = allocationsCourantesChantierV1(cells, id, resourceIndex);
  const version = Number(derniereBaseline?.version || 0) + 1;
  const source = version === 1 ? "manual_freeze" : "manual_rebaseline";
  const snapshot = creerSnapshotPlanningReferenceV1({
    chantier_id: id,
    allocations,
    source,
    note,
  });
  const payload = {
    chantier_id: id,
    version,
    label: label || `Référence V${version}`,
    source,
    note: note || null,
    snapshot,
    allocation_count: allocations.length,
  };
  const { data, error } = await supabase.from("planning_baselines")
    .insert(payload)
    .select("id,chantier_id,version,label,source,note,snapshot,allocation_count,created_by,created_at")
    .single();
  if (error) {
    // Deux clics concurrents peuvent viser la même version : on ne remplace
    // jamais une baseline existante. Le caller recharge et laisse l'utilisateur
    // choisir explicitement s'il veut créer la version suivante.
    if (String(error.code) === "23505") throw new Error("Une nouvelle version de référence vient déjà d'être créée. Actualise avant de recommencer.");
    throw error;
  }
  return data;
}
