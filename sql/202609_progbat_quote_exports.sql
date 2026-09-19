-- ═══════════════════════════════════════════════════════════════════════════
-- ProGBat — suivi des créations de devis brouillon (progbat_quote_exports).
--   Une ligne = une tentative de création d'un brouillon ProGBat pour un
--   logement (profero_projets). La ligne est RÉSERVÉE (statut creating) par
--   l'Edge Function `progbat-quote` AVANT l'appel POST /v2/company/quotes, puis
--   passée à created / failed / uncertain.
--
-- Anti-doublon : index unique partiel sur project_id pour les statuts
-- creating / created / uncertain → deux créations concurrentes (double clic,
-- deux onglets, rafraîchissement) ne peuvent pas réserver toutes les deux ;
-- un devis créé ou un état incertain bloque définitivement une nouvelle
-- création tant qu'il n'est pas traité manuellement. Les échecs (failed) ne
-- bloquent pas : une nouvelle tentative reste possible.
--
-- Accès : table réservée au serveur (service_role via l'Edge Function). RLS
-- activée SANS policy et privilèges retirés à anon / authenticated : aucune
-- lecture ni écriture directe depuis le navigateur.
--
-- Idempotente et SANS PERTE. À exécuter dans l'éditeur SQL Supabase.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.progbat_quote_exports (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.profero_projets(id) on delete cascade,
  payload_hash        text not null,                       -- SHA-256 de la sérialisation canonique du payload envoyé
  statut              text not null default 'preparing',
  progbat_quote_id    bigint,                              -- QuoteResponse.id (entier ProGBat)
  progbat_quote_code  text,                                -- QuoteResponse.code
  created_by          uuid,                                -- auth.users.id de l'utilisateur ayant déclenché la création
  created_by_email    text,
  started_at          timestamptz not null default now(),  -- réservation (avant le POST)
  finished_at         timestamptz,                         -- réussite ou échec
  http_status         integer,                             -- code HTTP ProGBat (0 = délai / réseau)
  error_message       text,                                -- message nettoyé (jamais de corps brut ni de secret)
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

-- Un seul export « vivant » par logement : réservation en cours, devis créé ou état incertain.
create unique index if not exists progbat_quote_exports_actif_uidx
  on public.progbat_quote_exports(project_id)
  where statut in ('creating', 'created', 'uncertain');

create index if not exists progbat_quote_exports_project_idx
  on public.progbat_quote_exports(project_id, started_at desc);

-- updated_at automatique (fonction commune déjà présente : public.set_updated_at)
drop trigger if exists progbat_quote_exports_set_updated_at on public.progbat_quote_exports;
create trigger progbat_quote_exports_set_updated_at
  before update on public.progbat_quote_exports
  for each row execute function public.set_updated_at();

-- ─── Accès : serveur uniquement ────────────────────────────────────────────
alter table public.progbat_quote_exports enable row level security;
-- Aucune policy : avec la RLS activée, anon et authenticated ne voient ni
-- n'écrivent rien ; le service_role (Edge Function) contourne la RLS.
revoke all on table public.progbat_quote_exports from public, anon, authenticated;

comment on table public.progbat_quote_exports is
  'Tentatives de création de devis brouillon ProGBat par logement (réservation avant POST, statuts preparing/creating/created/failed/uncertain). Table serveur : accès via Edge Function progbat-quote uniquement.';

-- ─── Contrôle ──────────────────────────────────────────────────────────────
-- select project_id, statut, progbat_quote_id, http_status, started_at, finished_at
-- from public.progbat_quote_exports order by started_at desc limit 20;
