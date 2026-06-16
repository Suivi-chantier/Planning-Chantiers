-- supabase_prospection_v1.sql
-- Création du CRM Prospection Profero Invest
-- À exécuter dans Supabase > SQL Editor

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Table principale : prospects
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.invest_prospects (
  id uuid primary key default gen_random_uuid(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,

  is_deleted boolean not null default false,

  -- Identité
  civilite text,
  nom text not null default '',
  prenom text not null default '',
  societe text,
  telephone text,
  email text,
  adresse text,
  ville text,
  code_postal text,
  pays text default 'France',

  -- Origine et pilotage
  source text,
  responsable text,
  statut text not null default 'nouveau',
  priorite text not null default 'moyenne',
  score text not null default 'B',

  -- Profil prospect
  profil_investisseur text,
  experience text,
  nb_biens integer,
  situation_professionnelle text,
  objectif text,

  -- Projet recherché
  zone_recherche text,
  type_bien text,
  strategie text,
  budget_global numeric,
  budget_travaux numeric,
  apport numeric,
  capacite_emprunt numeric,
  delai_achat text,

  -- Qualification commerciale
  motivation text,
  maturite text,
  probabilite_signature numeric,
  offre_recommandee text,
  honoraires_estimes_ht numeric,
  honoraires_estimes_ttc numeric,
  ca_potentiel_ht numeric,
  objections text,
  besoins text,

  -- Suivi commercial
  prochaine_action text,
  date_prochaine_action date,
  date_relance date,
  date_premier_contact date,

  -- Rendez-vous
  date_rdv date,
  heure_rdv text,
  type_rdv text,
  lieu_rdv text,
  statut_rdv text,
  compte_rendu_rdv text,

  -- Proposition / signature
  date_proposition date,
  statut_proposition text,
  date_signature date,

  -- Perte / sommeil
  date_perte date,
  raison_perte text,

  -- Commentaires et données extensibles
  commentaire text,
  donnees jsonb not null default '{}'::jsonb,

  -- Conversion vers CRM Client
  converted_client_id uuid,
  converted_at timestamptz
);

create index if not exists idx_invest_prospects_statut
  on public.invest_prospects(statut);

create index if not exists idx_invest_prospects_responsable
  on public.invest_prospects(responsable);

create index if not exists idx_invest_prospects_date_prochaine_action
  on public.invest_prospects(date_prochaine_action);

create index if not exists idx_invest_prospects_is_deleted
  on public.invest_prospects(is_deleted);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Historique des actions commerciales
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.invest_prospect_actions (
  id uuid primary key default gen_random_uuid(),

  prospect_id uuid not null references public.invest_prospects(id) on delete cascade,

  created_at timestamptz not null default now(),
  created_by text,

  date_action timestamptz not null default now(),
  type_action text not null default 'note',
  resume text not null default '',
  resultat text,
  prochaine_action text,
  date_prochaine_action date,

  donnees jsonb not null default '{}'::jsonb
);

create index if not exists idx_invest_prospect_actions_prospect_id
  on public.invest_prospect_actions(prospect_id);

create index if not exists idx_invest_prospect_actions_date_action
  on public.invest_prospect_actions(date_action desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trigger updated_at automatique
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_invest_prospects_updated_at on public.invest_prospects;

create trigger trg_invest_prospects_updated_at
before update on public.invest_prospects
for each row
execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Note RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- Cette version ne force pas RLS afin d'éviter les blocages d'écriture dans
-- l'application existante. Si tu actives RLS plus tard, il faudra créer les
-- policies adaptées aux utilisateurs connectés de Profero App.
