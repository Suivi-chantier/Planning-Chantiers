// ─── CHANTIER 05 — REQUÊTE D'APPLICATION V1 ─────────────────────────────────
// Module PUR : aucune lecture/écriture Supabase.
//
// Dernière barrière côté application avant un futur appel RPC. Il est impossible
// de construire une requête d'écriture depuis une simulation bloquée.

import { PLANNING_REPLANNING_APPLY_PLAN_VERSION } from "./planningReplanningApplyPlanV1.js";
import { PLANNING_REPLANNING_APPLY_SAFETY_VERSION } from "./planningReplanningApplySafetyV1.js";
import { PLANNING_REPLANNING_PHASAGE_GUARDS_VERSION } from "./planningReplanningPhasageGuardsV1.js";

export const PLANNING_REPLANNING_APPLY_REQUEST_VERSION = 1;

const txt = v => String(v ?? "").trim();
const clone = v => JSON.parse(JSON.stringify(v));

export function construireRequeteApplicationReplanningV1({
  planApplication,
  securiteApplication,
} = {}) {
  if (!planApplication || typeof planApplication !== "object") {
    throw new Error("plan_application requis");
  }
  if (!securiteApplication || typeof securiteApplication !== "object") {
    throw new Error("securite_application requise");
  }
  if (Number(planApplication.apply_plan_version) !== PLANNING_REPLANNING_APPLY_PLAN_VERSION) {
    throw new Error("Version du plan d'application incompatible");
  }
  if (Number(securiteApplication.version) !== PLANNING_REPLANNING_APPLY_SAFETY_VERSION) {
    throw new Error("Version de sécurité d'application incompatible");
  }
  if (Number(securiteApplication.phasage_guard_version) !== PLANNING_REPLANNING_PHASAGE_GUARDS_VERSION) {
    throw new Error("Version des gardes phasage incompatible");
  }

  const operations = Array.isArray(planApplication.operations) ? planApplication.operations : [];
  const blockers = Array.isArray(securiteApplication.blockers) ? securiteApplication.blockers : [];
  const phasageUpdates = Array.isArray(securiteApplication.phasage_updates) ? securiteApplication.phasage_updates : [];
  const phasageGuards = Array.isArray(securiteApplication.phasage_guards) ? securiteApplication.phasage_guards : [];

  if (securiteApplication.application_autorisable !== true) {
    const codes = blockers.map(x => txt(x?.code)).filter(Boolean);
    throw new Error(`Application bloquée${codes.length ? ` : ${codes.join(", ")}` : ""}`);
  }
  if (blockers.length) {
    throw new Error("Application déclarée autorisable mais blockers non vides");
  }
  if (!operations.length) {
    throw new Error("Aucune opération à appliquer");
  }
  if (Number(securiteApplication?.resume?.cellules_a_ecrire) !== operations.length) {
    throw new Error("Incohérence entre sécurité et nombre d'opérations du plan");
  }
  if (txt(planApplication.start_date) !== txt(securiteApplication.start_date)
      || txt(planApplication.horizon_end) !== txt(securiteApplication.horizon_end)) {
    throw new Error("Horizon du plan et horizon de sécurité incohérents");
  }

  const travauxTouches = Number(securiteApplication?.resume?.travaux_touches) || 0;
  if (travauxTouches > 0 && phasageGuards.length === 0) {
    throw new Error("Gardes phasage requises pour toute application touchant des tâches liées");
  }
  if (Number(securiteApplication?.resume?.phasages_a_verrouiller) !== phasageGuards.length) {
    throw new Error("Incohérence entre sécurité et nombre de gardes phasage");
  }

  const guardsById = new Map();
  for (const guard of phasageGuards) {
    const id = txt(guard?.phasage_id);
    const chantier = txt(guard?.chantier_id);
    const updatedAt = txt(guard?.expected_updated_at);
    if (!id || !chantier || !updatedAt) throw new Error("Garde phasage incomplète");
    if (guardsById.has(id)) throw new Error(`Garde phasage dupliquée : ${id}`);
    guardsById.set(id, guard);
  }
  for (const update of phasageUpdates) {
    const id = txt(update?.phasage_id);
    const guard = guardsById.get(id);
    if (!guard) throw new Error(`Mise à jour phasage sans garde : ${id || "id absent"}`);
    if (txt(update?.chantier_id) !== txt(guard?.chantier_id)
        || txt(update?.expected_updated_at) !== txt(guard?.expected_updated_at)) {
      throw new Error(`Mise à jour phasage incohérente avec sa garde : ${id}`);
    }
  }

  return {
    schema_version: PLANNING_REPLANNING_APPLY_REQUEST_VERSION,
    apply_plan_version: PLANNING_REPLANNING_APPLY_PLAN_VERSION,
    safety_version: PLANNING_REPLANNING_APPLY_SAFETY_VERSION,
    phasage_guard_version: PLANNING_REPLANNING_PHASAGE_GUARDS_VERSION,
    application_autorisable: true,
    operations: clone(operations),
    phasage_guards: clone(phasageGuards),
    phasage_updates: clone(phasageUpdates),
  };
}
