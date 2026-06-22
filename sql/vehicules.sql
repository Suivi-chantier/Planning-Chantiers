-- ─── TABLE VÉHICULES ──────────────────────────────────────────────────────────
-- Parc de véhicules de la société (nom + plaque d'immatriculation).
-- Géré dans Réglages → Véhicules, affecté par cellule dans le Planning semaine.
-- À exécuter dans Supabase SQL Editor.

create table if not exists public.vehicules (
  id              uuid primary key default gen_random_uuid(),
  nom             text not null,
  immatriculation text,
  created_at      timestamptz not null default now()
);

create index if not exists vehicules_nom_idx on public.vehicules (lower(nom));

alter table public.vehicules enable row level security;

-- Policies basiques : lecture/écriture pour les utilisateurs authentifiés.
drop policy if exists "vehicules_select_auth" on public.vehicules;
create policy "vehicules_select_auth"
  on public.vehicules for select
  to authenticated using (true);

drop policy if exists "vehicules_insert_auth" on public.vehicules;
create policy "vehicules_insert_auth"
  on public.vehicules for insert
  to authenticated with check (true);

drop policy if exists "vehicules_update_auth" on public.vehicules;
create policy "vehicules_update_auth"
  on public.vehicules for update
  to authenticated using (true) with check (true);

drop policy if exists "vehicules_delete_auth" on public.vehicules;
create policy "vehicules_delete_auth"
  on public.vehicules for delete
  to authenticated using (true);

-- ─── VÉHICULES AFFECTÉS DANS LE PLANNING ─────────────────────────────────────
-- Tableau JSON de véhicules affectés à une cellule (chantier × jour).
-- Chaque entrée : { id, nom, immatriculation } (snapshot, pas de jointure à l'affichage).
alter table public.planning_cells
  add column if not exists vehicules jsonb not null default '[]'::jsonb;
