create table if not exists public.progbat_library_sync_items (
  id uuid primary key default gen_random_uuid(),
  ouvrage_id uuid not null references public.bibliotheque_ratios(id) on delete cascade,
  action text not null check (action in ('link', 'create')),
  plan_hash text not null,
  statut text not null check (statut in ('linking', 'creating', 'linked', 'created', 'failed', 'uncertain')),
  progbat_target_id bigint,
  progbat_code text,
  created_by uuid,
  created_by_email text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  http_status integer,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists progbat_library_sync_items_ouvrage_idx
  on public.progbat_library_sync_items (ouvrage_id, started_at desc);
create unique index if not exists progbat_library_sync_items_actif_uidx
  on public.progbat_library_sync_items (ouvrage_id)
  where statut in ('linking', 'creating', 'uncertain');
alter table public.progbat_library_sync_items enable row level security;
revoke all on table public.progbat_library_sync_items from public, anon, authenticated;
drop trigger if exists progbat_library_sync_items_set_updated_at on public.progbat_library_sync_items;
create trigger progbat_library_sync_items_set_updated_at
before update on public.progbat_library_sync_items
for each row execute function public.set_updated_at();
