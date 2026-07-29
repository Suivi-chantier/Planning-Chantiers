-- ============================================================================
-- CONTRÔLES DE FIN DE GROUPE + RÉSERVES (Point 2 b, Prompts 3-4).
-- À exécuter dans l'éditeur SQL Supabase. Idempotent.
--
-- Modèle : un CONTRÔLE = la réalisation du jalon de contrôle d'un groupe
-- (audit par exception : tout est conforme par défaut, on ne stocke QUE les
-- exceptions). Une RÉSERVE = une entité de premier ordre qui vit sa vie :
-- ouverte à un contrôle, levée plus tard (date + auteur + photo de reprise),
-- jamais supprimée une fois levée — c'est l'ancienneté des réserves non
-- levées qui alimente le sommet Qualité du QCD.
-- Le périmètre est le GROUPE d'exécution (meta.chrono_groupes) ; une réserve
-- référence sa tâche par tache_id (jamais par libellé), avec le libellé
-- copié en confort d'affichage (la tâche peut disparaître du phasage).
-- ============================================================================

create table if not exists public.controles_groupe (
  id            uuid primary key default gen_random_uuid(),
  chantier_id   text not null,
  phasage_id    uuid,
  groupe_id     text not null,           -- id du groupe dans meta.chrono_groupes
  groupe_nom    text,                    -- libellé au moment du contrôle
  date_controle timestamptz not null default now(),
  auteur        text,                    -- le conducteur de travaux
  nb_taches     integer not null default 0, -- tâches du groupe au moment du contrôle
  nb_conformes  integer not null default 0, -- = nb_taches - exceptions signalées
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_controles_groupe_chantier
  on public.controles_groupe (chantier_id);
create index if not exists idx_controles_groupe_groupe
  on public.controles_groupe (chantier_id, groupe_id, date_controle desc);

create table if not exists public.reserves (
  id                uuid primary key default gen_random_uuid(),
  chantier_id       text not null,
  phasage_id        uuid,
  groupe_id         text not null,
  controle_id       uuid references public.controles_groupe(id) on delete set null,
  tache_id          text not null,       -- matching par id, JAMAIS par libellé
  tache_nom         text,                -- libellé au moment du signalement
  statut            text not null check (statut in ('reserve', 'nok')),
  commentaire       text,
  photos            jsonb not null default '[]'::jsonb, -- URLs publiques (bucket photos)
  auteur            text,
  created_at        timestamptz not null default now(),
  -- Levée (Prompt 4) : une réserve levée SORT des réserves ouvertes mais
  -- reste dans l'historique — on ne supprime jamais une réserve levée.
  levee_le          timestamptz,         -- null = réserve ouverte
  levee_par         text,
  levee_commentaire text,
  levee_photos      jsonb not null default '[]'::jsonb, -- photos de la reprise
  updated_at        timestamptz not null default now()
);

create index if not exists idx_reserves_chantier on public.reserves (chantier_id);
create index if not exists idx_reserves_groupe   on public.reserves (chantier_id, groupe_id);
create index if not exists idx_reserves_ouvertes on public.reserves (chantier_id) where levee_le is null;

-- ── RLS : bureau uniquement (le contrôle est réalisé par le conducteur),
-- même règle que visites_chantier. ─────────────────────────────────────────
alter table public.controles_groupe enable row level security;
alter table public.reserves enable row level security;

drop policy if exists "controles_groupe bureau" on public.controles_groupe;
create policy "controles_groupe bureau" on public.controles_groupe
  for all to authenticated
  using (not public.est_ouvrier()) with check (not public.est_ouvrier());

drop policy if exists "reserves bureau" on public.reserves;
create policy "reserves bureau" on public.reserves
  for all to authenticated
  using (not public.est_ouvrier()) with check (not public.est_ouvrier());

-- ── Filet de sécurité data_history (contrairement à visites_chantier, ces
-- tables sont couvertes dès le départ : tout update/delete garde l'état
-- précédent). Nécessite sql/202606_data_history_filet_securite.sql. ────────
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'log_data_history'
  ) then
    execute 'drop trigger if exists trg_data_history on public.controles_groupe';
    execute 'create trigger trg_data_history before update or delete on public.controles_groupe
             for each row execute function public.log_data_history()';
    execute 'drop trigger if exists trg_data_history on public.reserves';
    execute 'create trigger trg_data_history before update or delete on public.reserves
             for each row execute function public.log_data_history()';
  end if;
end $$;
