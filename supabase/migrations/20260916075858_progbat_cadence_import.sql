-- ═══════════════════════════════════════════════════════════════════════════
-- Import PONCTUEL des cadences ProGBat → Profero (bibliotheque_ratios.cadence).
--
--   • Provenance informative sur l'ouvrage : cadence_source ('profero' |
--     'progbat_import'), cadence_imported_at, cadence_import_run_id. La cadence
--     elle-même reste dans la colonne métier existante `cadence` (heures/unité).
--     Une modification manuelle ultérieure de la cadence repasse la provenance
--     à 'profero' (trigger), sauf pendant l'import (réglage de session).
--   • progbat_cadence_import_plans : plan FIGÉ côté serveur après l'analyse
--     (hash SHA-256, items, synthèse, utilisateur). Table serveur uniquement.
--   • progbat_cadence_import_runs  : une ligne par exécution (applied / failed).
--   • progbat_cadence_import_items : audit ligne à ligne (ancienne / nouvelle
--     cadence, méthode, statut). Lecture seule pour le bureau ; écriture
--     uniquement par la procédure serveur.
--   • progbat_cadences_appliquer() : application ATOMIQUE (une transaction,
--     verrou, revalidation de chaque cadence et liaison, audit) — exécutable par
--     le service_role uniquement (Edge Function progbat-library-cadences).
--
-- Aucune écriture vers ProGBat n'existe dans ce flux. Idempotente, sans perte.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Provenance de la cadence ─────────────────────────────────────────────
alter table public.bibliotheque_ratios
  add column if not exists cadence_source text,
  add column if not exists cadence_imported_at timestamptz,
  add column if not exists cadence_import_run_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bibliotheque_ratios_cadence_source_check') then
    alter table public.bibliotheque_ratios
      add constraint bibliotheque_ratios_cadence_source_check
      check (cadence_source is null or cadence_source in ('profero', 'progbat_import'));
  end if;
end $$;

comment on column public.bibliotheque_ratios.cadence_source is
  'Provenance informative de la cadence : profero (saisie/modifiée dans Profero) ou progbat_import (import ponctuel). La cadence reste la valeur de référence Profero quelle que soit la provenance.';
comment on column public.bibliotheque_ratios.cadence_imported_at is 'Date du dernier import ProGBat ayant écrit la cadence (informatif).';
comment on column public.bibliotheque_ratios.cadence_import_run_id is 'progbat_cadence_import_runs.id du dernier import ayant écrit la cadence (informatif).';

-- Toute modification de la cadence hors import ⇒ provenance « profero ».
create or replace function public.bibliotheque_ratios_cadence_provenance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('profero.cadence_import', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.cadence is not null and new.cadence_source is null then new.cadence_source := 'profero'; end if;
    return new;
  end if;
  if new.cadence is distinct from old.cadence then
    new.cadence_source := 'profero';
  end if;
  return new;
end $$;

drop trigger if exists bibliotheque_ratios_cadence_provenance on public.bibliotheque_ratios;
create trigger bibliotheque_ratios_cadence_provenance
  before insert or update of cadence on public.bibliotheque_ratios
  for each row execute function public.bibliotheque_ratios_cadence_provenance();

-- ─── 2. Plans d'import figés (serveur uniquement) ────────────────────────────
create table if not exists public.progbat_cadence_import_plans (
  id                uuid primary key default gen_random_uuid(),
  plan_hash         text not null,                              -- SHA-256 des items « a_importer » (ouvrage, progbat_id, avant, après)
  statut            text not null default 'prepared',
  methode           text,
  prepared_by       uuid,
  prepared_by_email text,
  prepared_at       timestamptz not null default now(),
  applied_at        timestamptz,
  run_id            uuid,
  nb_a_importer     integer not null default 0,
  compteurs         jsonb not null default '{}'::jsonb,
  synthese          jsonb not null default '{}'::jsonb,
  items             jsonb not null default '[]'::jsonb,         -- toutes les lignes analysées (statut, avant, après, méthode, avertissements)
  error_code        text,
  error_message     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'progbat_cadence_import_plans_statut_check') then
    alter table public.progbat_cadence_import_plans
      add constraint progbat_cadence_import_plans_statut_check
      check (statut in ('prepared', 'applied', 'rejected', 'expired'));
  end if;
end $$;

create index if not exists progbat_cadence_import_plans_prepared_idx
  on public.progbat_cadence_import_plans (prepared_at desc);

drop trigger if exists progbat_cadence_import_plans_set_updated_at on public.progbat_cadence_import_plans;
create trigger progbat_cadence_import_plans_set_updated_at
  before update on public.progbat_cadence_import_plans
  for each row execute function public.set_updated_at();

alter table public.progbat_cadence_import_plans enable row level security;
revoke all on table public.progbat_cadence_import_plans from public, anon, authenticated;

comment on table public.progbat_cadence_import_plans is
  'Plans d''import de cadences ProGBat figés côté serveur après analyse (hash, items, utilisateur). Table serveur : Edge Function progbat-library-cadences uniquement.';

-- ─── 3. Exécutions (audit, lecture seule bureau) ─────────────────────────────
create table if not exists public.progbat_cadence_import_runs (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid references public.progbat_cadence_import_plans(id) on delete set null,
  plan_hash         text not null,
  statut            text not null,
  methode           text,
  created_by        uuid,
  created_by_email  text,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  nb_modifies       integer not null default 0,
  error_code        text,
  error_message     text,                                       -- message nettoyé (jamais de corps brut ni de secret)
  created_at        timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'progbat_cadence_import_runs_statut_check') then
    alter table public.progbat_cadence_import_runs
      add constraint progbat_cadence_import_runs_statut_check
      check (statut in ('applying', 'applied', 'failed'));
  end if;
end $$;

create index if not exists progbat_cadence_import_runs_started_idx
  on public.progbat_cadence_import_runs (started_at desc);

alter table public.progbat_cadence_import_runs enable row level security;
revoke all on table public.progbat_cadence_import_runs from public, anon, authenticated;
grant select on table public.progbat_cadence_import_runs to authenticated;
drop policy if exists progbat_cadence_import_runs_lecture_bureau on public.progbat_cadence_import_runs;
create policy progbat_cadence_import_runs_lecture_bureau
  on public.progbat_cadence_import_runs for select to authenticated
  using (not public.est_ouvrier());

comment on table public.progbat_cadence_import_runs is
  'Exécutions de l''import ponctuel des cadences ProGBat (applied / failed). Lecture seule pour le bureau ; écriture par la procédure serveur uniquement.';

-- ─── 4. Audit ligne à ligne (lecture seule bureau) ───────────────────────────
create table if not exists public.progbat_cadence_import_items (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.progbat_cadence_import_runs(id) on delete cascade,
  ouvrage_id        uuid not null,                              -- pas de FK : l'historique survit à la suppression de l'ouvrage
  code              text,
  libelle           text,
  progbat_id        text,
  cadence_avant     double precision,
  cadence_apres     double precision,
  methode           text,
  statut            text not null,
  avertissements    jsonb not null default '[]'::jsonb,
  error_message     text,
  plan_hash         text,
  created_by        uuid,
  created_by_email  text,
  created_at        timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'progbat_cadence_import_items_statut_check') then
    alter table public.progbat_cadence_import_items
      add constraint progbat_cadence_import_items_statut_check
      check (statut in ('applied', 'skipped', 'failed'));
  end if;
end $$;

create index if not exists progbat_cadence_import_items_run_idx on public.progbat_cadence_import_items (run_id);
create index if not exists progbat_cadence_import_items_ouvrage_idx on public.progbat_cadence_import_items (ouvrage_id, created_at desc);

alter table public.progbat_cadence_import_items enable row level security;
revoke all on table public.progbat_cadence_import_items from public, anon, authenticated;
grant select on table public.progbat_cadence_import_items to authenticated;
drop policy if exists progbat_cadence_import_items_lecture_bureau on public.progbat_cadence_import_items;
create policy progbat_cadence_import_items_lecture_bureau
  on public.progbat_cadence_import_items for select to authenticated
  using (not public.est_ouvrier());

comment on table public.progbat_cadence_import_items is
  'Audit de l''import des cadences ProGBat : ancienne et nouvelle cadence par ouvrage, méthode, utilisateur, hash du plan. Lecture seule ; jamais insérable depuis le navigateur.';

-- ─── 5. Application atomique ─────────────────────────────────────────────────
-- Une seule transaction : verrou exclusif d'import, plan verrouillé FOR UPDATE,
-- revalidation de CHAQUE ouvrage (liaison progbat_id et cadence inchangées
-- depuis l'analyse), mise à jour, audit. La moindre incohérence lève une
-- exception ⇒ tout est annulé (aucune mise à jour partielle).
create or replace function public.progbat_cadences_appliquer(
  p_plan_id    uuid,
  p_plan_hash  text,
  p_user_id    uuid,
  p_user_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan   public.progbat_cadence_import_plans%rowtype;
  v_item   jsonb;
  v_run_id uuid;
  v_ouv    record;
  v_avant  double precision;
  v_apres  double precision;
  v_nb     integer := 0;
  v_ouvrage_id uuid;
begin
  if not pg_try_advisory_xact_lock(hashtext('progbat_cadences_import')) then
    raise exception 'IMPORT_EN_COURS';
  end if;

  select * into v_plan from public.progbat_cadence_import_plans where id = p_plan_id for update;
  if not found then raise exception 'PLAN_INTROUVABLE'; end if;
  if v_plan.plan_hash <> lower(coalesce(p_plan_hash, '')) then raise exception 'HASH_DIFFERENT'; end if;
  if v_plan.statut <> 'prepared' then raise exception 'PLAN_DEJA_TRAITE:%', v_plan.statut; end if;
  if v_plan.prepared_at < now() - interval '30 minutes' then raise exception 'PLAN_EXPIRE'; end if;

  insert into public.progbat_cadence_import_runs (plan_id, plan_hash, statut, methode, created_by, created_by_email)
  values (v_plan.id, v_plan.plan_hash, 'applying', v_plan.methode, p_user_id, p_user_email)
  returning id into v_run_id;

  -- Le trigger de provenance laisse passer 'progbat_import' pendant cette transaction.
  perform set_config('profero.cadence_import', 'on', true);

  for v_item in
    select value from jsonb_array_elements(coalesce(v_plan.items, '[]'::jsonb)) where value->>'statut' = 'a_importer'
  loop
    v_ouvrage_id := (v_item->>'ouvrage_id')::uuid;
    v_avant := nullif(v_item->>'cadence_avant', '')::double precision;
    v_apres := nullif(v_item->>'cadence_apres', '')::double precision;
    if v_apres is null or v_apres <= 0 then raise exception 'CADENCE_INVALIDE:%', v_ouvrage_id; end if;

    select id, cadence, progbat_id, libelle into v_ouv
    from public.bibliotheque_ratios where id = v_ouvrage_id for update;
    if not found then raise exception 'OUVRAGE_INTROUVABLE:%', v_ouvrage_id; end if;

    if coalesce(v_ouv.progbat_id, '') <> coalesce(v_item->>'progbat_id', '') then
      raise exception 'LIAISON_MODIFIEE:%', v_ouvrage_id;
    end if;
    if (v_ouv.cadence is null) <> (v_avant is null)
       or (v_ouv.cadence is not null and abs(v_ouv.cadence - v_avant) > 0.00005) then
      raise exception 'CADENCE_MODIFIEE:%', v_ouvrage_id;
    end if;

    update public.bibliotheque_ratios
       set cadence = v_apres,
           cadence_source = 'progbat_import',
           cadence_imported_at = now(),
           cadence_import_run_id = v_run_id,
           updated_at = now()
     where id = v_ouvrage_id;

    insert into public.progbat_cadence_import_items
      (run_id, ouvrage_id, code, libelle, progbat_id, cadence_avant, cadence_apres, methode, statut, avertissements, plan_hash, created_by, created_by_email)
    values
      (v_run_id, v_ouvrage_id, v_item->>'code', v_ouv.libelle, v_item->>'progbat_id', v_ouv.cadence, v_apres,
       coalesce(v_item->>'methode', v_plan.methode), 'applied', coalesce(v_item->'avertissements', '[]'::jsonb), v_plan.plan_hash, p_user_id, p_user_email);
    v_nb := v_nb + 1;
  end loop;

  update public.progbat_cadence_import_runs
     set statut = 'applied', finished_at = now(), nb_modifies = v_nb
   where id = v_run_id;
  update public.progbat_cadence_import_plans
     set statut = 'applied', applied_at = now(), run_id = v_run_id
   where id = v_plan.id;

  return jsonb_build_object('ok', true, 'run_id', v_run_id, 'nb_modifies', v_nb);
end $$;

revoke all on function public.progbat_cadences_appliquer(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.progbat_cadences_appliquer(uuid, text, uuid, text) to service_role;

comment on function public.progbat_cadences_appliquer(uuid, text, uuid, text) is
  'Applique un plan d''import de cadences ProGBat en une transaction (verrou, hash, revalidation liaison + cadence de chaque ouvrage, audit). service_role uniquement.';

-- ─── Contrôle ──────────────────────────────────────────────────────────────
-- select id, statut, nb_modifies, created_by_email, started_at, finished_at, error_message
-- from public.progbat_cadence_import_runs order by started_at desc limit 10;
-- select code, cadence_avant, cadence_apres, methode, created_at
-- from public.progbat_cadence_import_items where run_id = '…' order by code;
