-- Correctif : index couvrant la clé étrangère progbat_cadence_import_runs.plan_id
-- (advisor Supabase « unindexed_foreign_keys »). Idempotent, sans perte.
create index if not exists progbat_cadence_import_runs_plan_idx
  on public.progbat_cadence_import_runs (plan_id);
