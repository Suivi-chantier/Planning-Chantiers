create table if not exists public.planning_constraints (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('not_before','deadline','fixed_date','resource_required','resource_forbidden','allocation_lock','priority')),
  scope text not null default 'chantier' check (scope in ('global','chantier','groupe','tache','allocation')),
  chantier_id text,
  groupe_type_id text,
  tache_id text,
  allocation_id text,
  hard boolean not null default true,
  priority numeric not null default 0,
  date_debut date,
  date_fin date,
  config jsonb not null default '{}'::jsonb,
  label text,
  source text not null default 'manuel' check (source in ('manuel','assistant','systeme','import')),
  actif boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planning_constraints_date_order check (date_fin is null or date_debut is null or date_fin >= date_debut),
  constraint planning_constraints_scope_target check (
    (scope = 'global')
    or (scope = 'chantier' and chantier_id is not null)
    or (scope = 'groupe' and groupe_type_id is not null)
    or (scope = 'tache' and tache_id is not null)
    or (scope = 'allocation' and allocation_id is not null)
  ),
  constraint planning_constraints_type_payload check (
    (type = 'not_before' and date_debut is not null)
    or (type = 'deadline' and date_fin is not null)
    or (type = 'fixed_date' and date_debut is not null)
    or (type in ('resource_required','resource_forbidden') and jsonb_typeof(config->'resource_ids') = 'array' and jsonb_array_length(config->'resource_ids') > 0)
    or (type = 'allocation_lock' and allocation_id is not null)
    or (type = 'priority')
  )
);

create index if not exists planning_constraints_chantier_idx on public.planning_constraints (chantier_id) where actif;
create index if not exists planning_constraints_tache_idx on public.planning_constraints (tache_id) where actif;
create index if not exists planning_constraints_allocation_idx on public.planning_constraints (allocation_id) where actif;
create index if not exists planning_constraints_type_idx on public.planning_constraints (type) where actif;

alter table public.planning_constraints enable row level security;

revoke all on table public.planning_constraints from anon;
grant select, insert, update, delete on table public.planning_constraints to authenticated;

drop policy if exists planning_constraints_bureau_select on public.planning_constraints;
create policy planning_constraints_bureau_select on public.planning_constraints
  for select to authenticated
  using (not public.est_ouvrier());

drop policy if exists planning_constraints_bureau_insert on public.planning_constraints;
create policy planning_constraints_bureau_insert on public.planning_constraints
  for insert to authenticated
  with check (not public.est_ouvrier());

drop policy if exists planning_constraints_bureau_update on public.planning_constraints;
create policy planning_constraints_bureau_update on public.planning_constraints
  for update to authenticated
  using (not public.est_ouvrier())
  with check (not public.est_ouvrier());

drop policy if exists planning_constraints_bureau_delete on public.planning_constraints;
create policy planning_constraints_bureau_delete on public.planning_constraints
  for delete to authenticated
  using (not public.est_ouvrier());

comment on table public.planning_constraints is 'Contraintes persistantes du planificateur deterministe Profero V1. Distinctes du calendrier de disponibilite des ressources.';
comment on column public.planning_constraints.config is 'Configuration typee par contrainte, notamment resource_ids pour les contraintes de ressource.';
