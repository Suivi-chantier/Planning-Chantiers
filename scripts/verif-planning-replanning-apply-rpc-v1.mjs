import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sql = await readFile(resolve(here, "../supabase/migrations/20260829210000_planning_replanning_apply_rpc_v1.sql"), "utf8");
const lower = sql.toLowerCase();

// 1. Le RPC ne doit jamais contourner les politiques RLS bureau.
assert.equal(lower.includes("security invoker"), true, "le RPC doit rester SECURITY INVOKER");
assert.equal(lower.includes("security definer"), false, "SECURITY DEFINER interdit pour ce RPC");
assert.equal(lower.includes("auth.uid() is null"), true);
assert.equal(lower.includes("public.est_ouvrier()"), true);

// 2. Un appel = une transaction, avec sérialisation des appels concurrents.
assert.equal(lower.includes("pg_advisory_xact_lock"), true);
assert.equal(lower.includes("for update"), true, "les snapshots existants doivent être verrouillés avant mutation");

// 3. Compare-before-write planning_cells : payload complet, pas un simple hash.
for (const field of ["week_id", "chantier_id", "jour", "planifie", "reel", "ouvriers", "taches", "vehicules"]) {
  assert.equal(lower.includes(`'${field}'`), true, `champ compare-before-write manquant: ${field}`);
}
assert.equal(lower.includes("planning_replanning_cell_snapshot_conflict"), true);
assert.equal(lower.includes("planning_replanning_expected_absent_but_exists"), true);
assert.equal(lower.includes("planning_replanning_cell_postwrite_mismatch"), true);

// 4. Aucune suppression de cellule : les déplacements se font par UPDATE/INSERT.
assert.equal(/delete\s+from\s+public\.planning_cells/i.test(sql), false);
assert.equal(/update\s+public\.planning_cells/i.test(sql), true);
assert.equal(/insert\s+into\s+public\.planning_cells/i.test(sql), true);

// 5. Tous les phasages touchés sont versionnés, même sans patch date_prevue.
assert.equal(lower.includes("phasage_guard_version"), true);
assert.equal(lower.includes("v_phasage_guards"), true);
assert.equal(lower.includes("planning_replanning_touched_chantier_guard_required"), true);
assert.equal(lower.includes("planning_replanning_phasage_snapshot_conflict"), true);
assert.equal(lower.includes("planning_replanning_phasage_update_without_matching_guard"), true);
assert.equal(lower.includes("phasages_locked"), true);

// 6. Les champs hors périmètre moteur sont immuables côté serveur.
assert.equal(lower.includes("planning_replanning_reel_immutable"), true);
assert.equal(lower.includes("planning_replanning_vehicules_immutable"), true);
assert.equal(lower.includes("planning_replanning_insert_reel_must_be_empty"), true);
assert.equal(lower.includes("planning_replanning_insert_vehicules_must_be_empty"), true);

// 7. Une ligne manuelle/verrouillée ne peut pas être déguisée en allocation recalculable.
assert.equal(lower.includes("planning_replanning_manual_allocation_not_recalculable"), true);
assert.equal(lower.includes("planning_replanning_locked_allocation_not_recalculable"), true);
assert.equal(lower.includes("public.planning_constraints"), true);
assert.equal(lower.includes("allocation_lock"), true);
assert.equal(lower.includes("allocation_uids_recalculables_retires_de_cette_cellule"), true);
assert.equal(lower.includes("allocation_uids_proposes_dans_cette_cellule"), true);

// 8. Toute ligne hors scope reste strictement identique ; les fallbacks legacy
// ne peuvent pas changer implicitement d'équipe.
assert.equal(lower.includes("planning_replanning_preserved_line_changed_or_missing"), true);
assert.equal(lower.includes("planning_replanning_preserved_fallback_workers_changed"), true);
assert.equal(lower.includes("planning_replanning_after_line_not_declared_proposed"), true);
assert.equal(lower.includes("planning_replanning_proposed_line_must_be_linked"), true);

// 9. planifie et cell.ouvriers sont bornés par les lignes réellement envoyées.
assert.equal(lower.includes("planning_replanning_planifie_not_derived_from_tasks"), true);
assert.equal(lower.includes("planning_replanning_planifie_changed_without_task_change"), true);
assert.equal(lower.includes("planning_replanning_task_worker_missing_from_cell"), true);
assert.equal(lower.includes("planning_replanning_new_cell_worker_without_task"), true);

// 10. Une tâche liée encore ouverte ne peut jamais perdre tout forecast futur.
assert.equal(lower.includes("start_date"), true);
assert.equal(lower.includes("horizon_end"), true);
assert.equal(lower.includes("planning_replanning_open_task_forecast_lost"), true);
assert.equal(lower.includes("v_task_avancement"), true);
assert.equal(lower.includes(">= v_start_date"), true);

// 11. date_prevue est calculée par PostgreSQL depuis le planning final, toutes
// semaines confondues, puis comparée à la valeur demandée par le client.
assert.equal(lower.includes("planning_replanning_date_prevue_conflict"), true);
assert.equal(lower.includes("planning_replanning_date_prevue_not_db_derived"), true);
assert.equal(lower.includes("'{date_prevue}'"), true);
assert.equal(lower.includes("to_date("), true);
assert.equal(lower.includes("'iyyy-\"w\"iw-id'"), true);
assert.equal(lower.includes("min(to_date"), true);
assert.equal(lower.includes("planning_replanning_task_duplicate_in_phasage"), true);

// 12. L'identité allocation_uid est contrôlée globalement après application.
assert.equal(lower.includes("planning_replanning_duplicate_allocation_uid"), true);
assert.equal(lower.includes("having count(*) > 1"), true);

// 13. Le RPC refuse un aperçu qui ne s'est pas déclaré autorisable et verrouille
// toutes les versions de contrat.
assert.equal(lower.includes("application_autorisable"), true);
assert.equal(lower.includes("planning_replanning_application_not_authorized_by_preview"), true);
assert.equal(lower.includes("apply_plan_version"), true);
assert.equal(lower.includes("safety_version"), true);
assert.equal(lower.includes("planning_replanning_phasage_guard_version_unsupported"), true);

// 14. Aucun privilège anon/public : seul authenticated reçoit EXECUTE, toujours
// sous RLS grâce à SECURITY INVOKER.
assert.equal(lower.includes("revoke all on function public.apply_planning_replanning_v1(jsonb) from public"), true);
assert.equal(lower.includes("revoke all on function public.apply_planning_replanning_v1(jsonb) from anon"), true);
assert.equal(lower.includes("grant execute on function public.apply_planning_replanning_v1(jsonb) to authenticated"), true);

console.log("OK — planning replanning apply RPC V1: 14 garde-fous SQL verrouillés");
