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

// 5. Les phasages sont protégés par updated_at et seule la date_prevue ciblée
// est reconstruite depuis le JSON courant verrouillé.
assert.equal(lower.includes("planning_replanning_phasage_snapshot_conflict"), true);
assert.equal(lower.includes("expected_updated_at"), true);
assert.equal(lower.includes("planning_replanning_date_prevue_conflict"), true);
assert.equal(lower.includes("'{date_prevue}'"), true);
assert.equal(lower.includes("planning_replanning_task_duplicate_in_phasage"), true);

// 6. L'identité allocation_uid est contrôlée globalement après application.
assert.equal(lower.includes("planning_replanning_duplicate_allocation_uid"), true);
assert.equal(lower.includes("having count(*) > 1"), true);

// 7. Le RPC refuse un aperçu qui ne s'est pas déclaré autorisable et verrouille
// ses versions de contrat.
assert.equal(lower.includes("application_autorisable"), true);
assert.equal(lower.includes("planning_replanning_application_not_authorized_by_preview"), true);
assert.equal(lower.includes("apply_plan_version"), true);
assert.equal(lower.includes("safety_version"), true);

// 8. Aucun privilège anon/public : seul authenticated reçoit EXECUTE, toujours
// sous RLS grâce à SECURITY INVOKER.
assert.equal(lower.includes("revoke all on function public.apply_planning_replanning_v1(jsonb) from public"), true);
assert.equal(lower.includes("revoke all on function public.apply_planning_replanning_v1(jsonb) from anon"), true);
assert.equal(lower.includes("grant execute on function public.apply_planning_replanning_v1(jsonb) to authenticated"), true);

console.log("OK — planning replanning apply RPC V1: 8 garde-fous SQL verrouillés");
