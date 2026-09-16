-- Correctif de l'import des cadences ProGBat : index couvrant la clé étrangère
-- progbat_cadence_import_runs.plan_id (advisor Supabase « unindexed_foreign_keys »).
-- La migration 20260916150000_progbat_cadence_import.sql n'est PAS modifiée.
-- Idempotent, sans perte, sur des tables vides à ce jour.

create index if not exists progbat_cadence_import_runs_plan_idx
  on public.progbat_cadence_import_runs (plan_id);
