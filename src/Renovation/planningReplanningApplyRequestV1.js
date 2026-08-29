// ─── CHANTIER 05 — REQUÊTE D'APPLICATION V1 ─────────────────────────────────
// Module PUR : aucune lecture/écriture Supabase.
//
// Dernière barrière côté application avant un futur appel RPC. Il est impossible
// de construire une requête d'écriture depuis une simulation bloquée.

import { PLANNING_REPLANNING_APPLY_PLAN_VERSION } from "./planningReplanningApplyPlanV1.js";
import { PLANNING_REPLANNING_APPLY_SAFETY_VERSION } from "./planningReplanningApplySafetyV1.js";

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

  const operations = Array.isArray(planApplication.operations) ? planApplication.operations : [];
  const blockers = Array.isArray(securiteApplication.blockers) ? securiteApplication.blockers : [];
  const phasageUpdates = Array.isArray(securiteApplication.phasage_updates) ? securiteApplication.phasage_updates : [];

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

  return {
    schema_version: PLANNING_REPLANNING_APPLY_REQUEST_VERSION,
    apply_plan_version: PLANNING_REPLANNING_APPLY_PLAN_VERSION,
    safety_version: PLANNING_REPLANNING_APPLY_SAFETY_VERSION,
    application_autorisable: true,
    operations: clone(operations),
    phasage_updates: clone(phasageUpdates),
  };
}
