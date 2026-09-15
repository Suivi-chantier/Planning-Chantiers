-- Audit serveur du classement des ouvrages ProGBat par famille métier.
-- Ces deux tables sont privées : seule l'Edge Function (service_role) y accède.
create table if not exists public.progbat_library_category_sync_items (
  id uuid primary key default gen_random_uuid(),
  ouvrage_id uuid not null references public.bibliotheque_ratios(id) on delete cascade,
  ouvrage_ids uuid[] not null default '{}',
  progbat_structure_id bigint not null,
  family_label text not null,
  progbat_family_id bigint,
  previous_family_ids bigint[] not null default '{}',
  plan_hash text not null,
  statut text not null check (statut in ('categorizing', 'categorized', 'failed', 'uncertain')),
  created_by uuid,
  created_by_email text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  http_status integer,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists progbat_library_category_sync_structure_idx
  on public.progbat_library_category_sync_items (progbat_structure_id, started_at desc);
create unique index if not exists progbat_library_category_sync_active_uidx
  on public.progbat_library_category_sync_items (progbat_structure_id)
  where statut in ('categorizing', 'uncertain');

alter table public.progbat_library_category_sync_items enable row level security;
revoke all on table public.progbat_library_category_sync_items from public, anon, authenticated;

drop trigger if exists progbat_library_category_sync_set_updated_at on public.progbat_library_category_sync_items;
create trigger progbat_library_category_sync_set_updated_at
before update on public.progbat_library_category_sync_items
for each row execute function public.set_updated_at();

create table if not exists public.progbat_library_family_sync_items (
  id uuid primary key default gen_random_uuid(),
  family_label text not null,
  plan_hash text not null,
  statut text not null check (statut in ('creating', 'created', 'failed', 'uncertain')),
  progbat_family_id bigint,
  created_by uuid,
  created_by_email text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  http_status integer,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists progbat_library_family_sync_label_idx
  on public.progbat_library_family_sync_items (lower(family_label), started_at desc);
create unique index if not exists progbat_library_family_sync_active_uidx
  on public.progbat_library_family_sync_items (lower(family_label))
  where statut in ('creating', 'uncertain');

alter table public.progbat_library_family_sync_items enable row level security;
revoke all on table public.progbat_library_family_sync_items from public, anon, authenticated;

drop trigger if exists progbat_library_family_sync_set_updated_at on public.progbat_library_family_sync_items;
create trigger progbat_library_family_sync_set_updated_at
before update on public.progbat_library_family_sync_items
for each row execute function public.set_updated_at();
