-- ============================================================================
-- Refonte du Bilan semaine — étape 1D : relevés journaliers.
--
-- CHANGEMENT (additif) : table chantier_releves_journaliers, un relevé par
-- chantier et par jour (unique chantier_id + date_releve), avec les MÊMES
-- colonnes que chantier_snapshots_hebdo, plus :
--   - statut_completude : complete | incomplete — tous les comptes rendus
--     attendus ce jour-là sont-ils validés ?
--   - cr_attendus : [{ ouvrier, statut }] — ouvriers planifiés sur le chantier
--     ce jour-là, hors absences (statut : valide | non_valide | manquant) ;
--   - cr_manquants : les attendus qui manquent ou ne sont pas validés ;
--   - calcule_le : dernier calcul (un relevé est recalculé à chaque
--     validation, correction ou modification d'avancement datée de ce jour,
--     et par le rattrapage de nuit).
-- Écrit uniquement par le serveur (api/releves-journaliers.js, clé de
-- service) ; l'application le LIT (bureau, pas les ouvriers).
--
-- Le Bilan n'en lit rien à cette étape : les relevés du vendredi
-- (chantier_snapshots_hebdo, chantier_avancement_history) restent la source
-- de l'écran jusqu'à sa refonte (étape 3).
--
-- RETOUR ARRIÈRE : drop table if exists public.chantier_releves_journaliers;
-- Idempotente.
-- ============================================================================

create table if not exists public.chantier_releves_journaliers (
  id                   uuid primary key default gen_random_uuid(),
  chantier_id          text not null,
  chantier_nom         text,
  phasage_id           uuid,
  week_id              text not null,          -- semaine ISO du jour ("2026-W43"), même format que l'app
  date_releve          date not null,
  vendu_ht             numeric,
  mo_prev              numeric,
  mat_prev             numeric,
  mo_reel              numeric,
  mat_reel             numeric,
  fg                   numeric,
  marge                numeric,
  marge_pct            numeric,
  avancement           numeric,                -- null si l'avancement de ce jour est inconnu (avant le journal)
  heures_vendues       numeric,
  heures_reelles       numeric,
  marge_terminaison    numeric,
  reste_a_faire_h      numeric,
  reste_a_faire_eur    numeric,
  situation_a_facturer numeric,
  reste_a_commander    numeric,
  lots                 jsonb,
  warnings             jsonb,
  statut_completude    text not null check (statut_completude in ('complete', 'incomplete')),
  cr_attendus          jsonb not null default '[]'::jsonb,
  cr_manquants         jsonb not null default '[]'::jsonb,
  calcule_le           timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  unique (chantier_id, date_releve)
);
create index if not exists chantier_releves_journaliers_date_idx on public.chantier_releves_journaliers (date_releve);
comment on table public.chantier_releves_journaliers is
  'Relevé financier et d''avancement d''un chantier pour UN jour (état en fin de journée), recalculé à chaque validation / correction / modification d''avancement datée de ce jour (api/releves-journaliers.js) et par le rattrapage de nuit. Mêmes colonnes que chantier_snapshots_hebdo + complétude des comptes rendus.';

alter table public.chantier_releves_journaliers enable row level security;
revoke all on public.chantier_releves_journaliers from authenticated, anon;
grant select on public.chantier_releves_journaliers to authenticated;
grant all on public.chantier_releves_journaliers to service_role;

drop policy if exists bureau_lecture on public.chantier_releves_journaliers;
create policy bureau_lecture on public.chantier_releves_journaliers for select to authenticated
  using (not public.est_ouvrier());
drop policy if exists profero_collaborateurs_seulement on public.chantier_releves_journaliers;
create policy profero_collaborateurs_seulement on public.chantier_releves_journaliers
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));
