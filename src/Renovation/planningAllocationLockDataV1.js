import { supabase } from "../supabase";
import { CONSTRAINT_SCOPES, CONSTRAINT_TYPES } from "./planningConstraintModelV1.js";

const txt = v => String(v ?? "").trim();

export async function chargerVerrousAllocationsV1(chantierId) {
  let q = supabase.from("planning_constraints")
    .select("id,chantier_id,allocation_id,label,source,created_at")
    .eq("type", CONSTRAINT_TYPES.ALLOCATION_LOCK)
    .eq("actif", true);
  if (txt(chantierId)) q = q.eq("chantier_id", txt(chantierId));
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export function indexerVerrousAllocationsV1(verrous = []) {
  const map = new Map();
  for (const v of Array.isArray(verrous) ? verrous : []) {
    const uid = txt(v?.allocation_id);
    if (uid && !map.has(uid)) map.set(uid, v);
  }
  return map;
}

export async function estAllocationVerrouilleeV1(allocationUid) {
  const uid = txt(allocationUid);
  if (!uid) return false;
  const { data, error } = await supabase.from("planning_constraints")
    .select("id")
    .eq("type", CONSTRAINT_TYPES.ALLOCATION_LOCK)
    .eq("allocation_id", uid)
    .eq("actif", true)
    .limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

export async function verrouillerAllocationV1({ chantierId, allocationUid, label = null } = {}) {
  const uid = txt(allocationUid);
  const chantier = txt(chantierId);
  if (!uid || !chantier) throw new Error("chantierId et allocationUid obligatoires");
  const { data: existing, error: existingError } = await supabase.from("planning_constraints")
    .select("id,chantier_id,allocation_id,label,source,created_at")
    .eq("type", CONSTRAINT_TYPES.ALLOCATION_LOCK)
    .eq("allocation_id", uid)
    .eq("actif", true)
    .limit(1);
  if (existingError) throw existingError;
  if (existing?.[0]) return existing[0];

  const { data, error } = await supabase.from("planning_constraints").insert({
    type: CONSTRAINT_TYPES.ALLOCATION_LOCK,
    scope: CONSTRAINT_SCOPES.ALLOCATION,
    chantier_id: chantier,
    allocation_id: uid,
    hard: true,
    priority: 0,
    label: label || "Allocation verrouillée manuellement",
    source: "manuel",
    config: { locked_by_user: true },
    actif: true,
  }).select("id,chantier_id,allocation_id,label,source,created_at").single();
  if (error) throw error;
  return data;
}

export async function deverrouillerAllocationV1(allocationUid) {
  const uid = txt(allocationUid);
  if (!uid) return false;
  const { error } = await supabase.from("planning_constraints")
    .delete()
    .eq("type", CONSTRAINT_TYPES.ALLOCATION_LOCK)
    .eq("allocation_id", uid)
    .eq("actif", true);
  if (error) throw error;
  return true;
}
