-- Chantier 03 — Planning de référence & allocations V1
-- Migration idempotente : baseline immuable + identité stable des allocations.

create extension if not exists pgcrypto;

create table if not exists public.planning_baselines (
  id uuid primary key default gen_random_uuid(),
  chantier_id text not null,
  version integer not null,
  label text,
  source text not null default 'manual_freeze',
  note text,
  snapshot jsonb not null,
  allocation_count integer not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint planning_baselines_chantier_version_key unique (chantier_id, version),
  constraint planning_baselines_version_positive check (version > 0),
  constraint planning_baselines_snapshot_object check (jsonb_typeof(snapshot) = 'object'),
  constraint planning_baselines_allocation_count_nonnegative check (allocation_count >= 0)
);

create index if not exists planning_baselines_chantier_version_idx
  on public.planning_baselines (chantier_id, version desc);

alter table public.planning_baselines enable row level security;

revoke all on table public.planning_baselines from anon;
grant select, insert on table public.planning_baselines to authenticated;

drop policy if exists planning_baselines_bureau_select on public.planning_baselines;
create policy planning_baselines_bureau_select
on public.planning_baselines
for select
to authenticated
using (not public.est_ouvrier());

drop policy if exists planning_baselines_bureau_insert on public.planning_baselines;
create policy planning_baselines_bureau_insert
on public.planning_baselines
for insert
to authenticated
with check (
  not public.est_ouvrier()
  and (created_by is null or created_by = auth.uid())
);

-- Les baselines sont volontairement append-only côté client :
-- aucune policy UPDATE/DELETE n'est créée.

create or replace function public.ensure_planning_cell_allocation_uids_v1()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  item jsonb;
  rebuilt jsonb := '[]'::jsonb;
  seen text[] := array[]::text[];
  uid text;
begin
  if new.taches is null or jsonb_typeof(new.taches) <> 'array' then
    return new;
  end if;

  for item in select value from jsonb_array_elements(new.taches)
  loop
    if jsonb_typeof(item) <> 'object' then
      rebuilt := rebuilt || jsonb_build_array(item);
      continue;
    end if;

    uid := nullif(btrim(item->>'allocation_uid'), '');
    if uid is null or uid = any(seen) then
      uid := gen_random_uuid()::text;
      item := jsonb_set(item, '{allocation_uid}', to_jsonb(uid), true);
    end if;
    seen := array_append(seen, uid);
    rebuilt := rebuilt || jsonb_build_array(item);
  end loop;

  new.taches := rebuilt;
  return new;
end;
$function$;

drop trigger if exists planning_cells_ensure_allocation_uids_v1 on public.planning_cells;
create trigger planning_cells_ensure_allocation_uids_v1
before insert or update of taches on public.planning_cells
for each row execute function public.ensure_planning_cell_allocation_uids_v1();

-- Backfill idempotent des anciennes cellules : chaque ligne reçoit un UID,
-- les doublons éventuels dans une même cellule sont régénérés.
do $block$
declare
  r record;
  item jsonb;
  rebuilt jsonb;
  seen text[];
  uid text;
begin
  for r in
    select id, taches
    from public.planning_cells
    where taches is not null and jsonb_typeof(taches) = 'array'
  loop
    rebuilt := '[]'::jsonb;
    seen := array[]::text[];

    for item in select value from jsonb_array_elements(r.taches)
    loop
      if jsonb_typeof(item) <> 'object' then
        rebuilt := rebuilt || jsonb_build_array(item);
        continue;
      end if;

      uid := nullif(btrim(item->>'allocation_uid'), '');
      if uid is null or uid = any(seen) then
        uid := gen_random_uuid()::text;
        item := jsonb_set(item, '{allocation_uid}', to_jsonb(uid), true);
      end if;
      seen := array_append(seen, uid);
      rebuilt := rebuilt || jsonb_build_array(item);
    end loop;

    if rebuilt is distinct from r.taches then
      update public.planning_cells set taches = rebuilt where id = r.id;
    end if;
  end loop;
end;
$block$;
