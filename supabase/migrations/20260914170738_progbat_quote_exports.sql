create table if not exists public.progbat_quote_exports (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.profero_projets(id) on delete cascade,
  payload_hash        text not null,
  statut              text not null default 'preparing',
  progbat_quote_id    bigint,
  progbat_quote_code  text,
  created_by          uuid,
  created_by_email    text,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  http_status         integer,
  error_message       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'progbat_quote_exports_statut_check') then
    alter table public.progbat_quote_exports
      add constraint progbat_quote_exports_statut_check
      check (statut in ('preparing', 'creating', 'created', 'failed', 'uncertain'));
  end if;
end $$;

create unique index if not exists progbat_quote_exports_actif_uidx
  on public.progbat_quote_exports(project_id)
  where statut in ('creating', 'created', 'uncertain');

create index if not exists progbat_quote_exports_project_idx
  on public.progbat_quote_exports(project_id, started_at desc);

drop trigger if exists progbat_quote_exports_set_updated_at on public.progbat_quote_exports;
create trigger progbat_quote_exports_set_updated_at
  before update on public.progbat_quote_exports
  for each row execute function public.set_updated_at();

alter table public.progbat_quote_exports enable row level security;
revoke all on table public.progbat_quote_exports from public, anon, authenticated;

comment on table public.progbat_quote_exports is
  'Tentatives de création de devis brouillon ProGBat par logement (réservation avant POST, statuts preparing/creating/created/failed/uncertain). Table serveur : accès via Edge Function progbat-quote uniquement.';
