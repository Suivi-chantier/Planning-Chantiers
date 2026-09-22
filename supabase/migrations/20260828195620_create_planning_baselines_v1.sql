create table public.planning_baselines (
  id uuid primary key default gen_random_uuid(),
  chantier_id text not null,
  version integer not null check (version >= 1),
  label text,
  source text not null default 'manual_freeze',
  note text,
  snapshot jsonb not null,
  allocation_count integer not null default 0 check (allocation_count >= 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint planning_baselines_chantier_version_key unique (chantier_id, version),
  constraint planning_baselines_snapshot_object_chk check (jsonb_typeof(snapshot) = 'object')
);

create index planning_baselines_chantier_version_idx
  on public.planning_baselines (chantier_id, version desc);

alter table public.planning_baselines enable row level security;

revoke all on table public.planning_baselines from anon;
revoke all on table public.planning_baselines from authenticated;
grant select, insert on table public.planning_baselines to authenticated;

create policy planning_baselines_bureau_select
  on public.planning_baselines
  for select
  to authenticated
  using (not public.est_ouvrier());

create policy planning_baselines_bureau_insert
  on public.planning_baselines
  for insert
  to authenticated
  with check (
    not public.est_ouvrier()
    and (created_by is null or created_by = (select auth.uid()))
  );
