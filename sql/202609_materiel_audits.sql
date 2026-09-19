-- 202609_materiel_audits.sql — Audits mensuels du matériel + échelle d'état à 4 niveaux.
-- À exécuter dans Supabase SQL Editor, APRÈS 202609_inventaire_equipes.sql.
--
-- Audit : une fois par mois, Loris passe en revue le matériel d'un ouvrier :
-- chaque outil est pointé présent ou manquant, et son état est constaté sur
-- l'échelle neuf / bon état / mauvais état / hors service. L'audit fige un
-- instantané (materiel_audits + materiel_audit_lignes) et met à jour la fiche
-- de l'outil (etat, manquant).

-- ─── 1. Échelle d'état : bon/use/hs → neuf/bon/mauvais/hs ────────────────────
alter table public.materiel drop constraint if exists materiel_etat_check;
update public.materiel set etat = 'mauvais' where etat = 'use';
alter table public.materiel
  add constraint materiel_etat_check check (etat in ('neuf','bon','mauvais','hs'));

-- Outil pointé manquant au dernier audit (remis à false si retrouvé ensuite).
alter table public.materiel add column if not exists manquant boolean not null default false;

-- ─── 2. Tables d'audit ───────────────────────────────────────────────────────
create table if not exists public.materiel_audits (
  id             uuid primary key default gen_random_uuid(),
  ouvrier_prenom text not null,              -- prénom planning de l'ouvrier audité
  date_audit     date not null default current_date,
  audite_par     text,                       -- qui a fait l'audit (ex. Loris)
  commentaire    text,
  nb_total       int not null default 0,     -- outils passés en revue
  nb_manquants   int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists materiel_audits_ouvrier_idx
  on public.materiel_audits (ouvrier_prenom, date_audit desc);

create table if not exists public.materiel_audit_lignes (
  id            uuid primary key default gen_random_uuid(),
  audit_id      uuid not null references public.materiel_audits(id) on delete cascade,
  materiel_id   uuid references public.materiel(id) on delete set null,
  code          text not null,               -- snapshot : reste lisible même si l'outil est supprimé
  nom           text not null,
  present       boolean not null default true,
  etat_constate text not null check (etat_constate in ('neuf','bon','mauvais','hs')),
  commentaire   text
);
create index if not exists materiel_audit_lignes_audit_idx
  on public.materiel_audit_lignes (audit_id);

-- Filet de sécurité data_history sur les audits (les lignes suivent en cascade).
drop trigger if exists trg_data_history on public.materiel_audits;
create trigger trg_data_history before update or delete on public.materiel_audits
  for each row execute function public.log_data_history();

-- ─── 3. RLS : bureau uniquement ──────────────────────────────────────────────
alter table public.materiel_audits enable row level security;
alter table public.materiel_audit_lignes enable row level security;
revoke all on table public.materiel_audits from anon;
revoke all on table public.materiel_audit_lignes from anon;

drop policy if exists materiel_audits_bureau_all on public.materiel_audits;
create policy materiel_audits_bureau_all on public.materiel_audits
  for all to authenticated
  using (not public.est_ouvrier()) with check (not public.est_ouvrier());

drop policy if exists materiel_audit_lignes_bureau_all on public.materiel_audit_lignes;
create policy materiel_audit_lignes_bureau_all on public.materiel_audit_lignes
  for all to authenticated
  using (not public.est_ouvrier()) with check (not public.est_ouvrier());
