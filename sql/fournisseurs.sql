-- ─── TABLE FOURNISSEURS ───────────────────────────────────────────────────────
-- À exécuter dans Supabase SQL Editor.

create table if not exists public.fournisseurs (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null,
  email       text,
  mail_type   text,
  created_at  timestamptz not null default now()
);

create index if not exists fournisseurs_nom_idx on public.fournisseurs (lower(nom));

alter table public.fournisseurs enable row level security;

-- Policies basiques : lecture/écriture pour les utilisateurs authentifiés.
-- Ajuster si l'application a un modèle RLS plus strict.
drop policy if exists "fournisseurs_select_auth" on public.fournisseurs;
create policy "fournisseurs_select_auth"
  on public.fournisseurs for select
  to authenticated using (true);

drop policy if exists "fournisseurs_insert_auth" on public.fournisseurs;
create policy "fournisseurs_insert_auth"
  on public.fournisseurs for insert
  to authenticated with check (true);

drop policy if exists "fournisseurs_update_auth" on public.fournisseurs;
create policy "fournisseurs_update_auth"
  on public.fournisseurs for update
  to authenticated using (true) with check (true);

drop policy if exists "fournisseurs_delete_auth" on public.fournisseurs;
create policy "fournisseurs_delete_auth"
  on public.fournisseurs for delete
  to authenticated using (true);

-- ─── LIEN MATÉRIAUX → FOURNISSEURS ───────────────────────────────────────────
-- La table existante s'appelle materiaux_bibliotheque.
alter table public.materiaux_bibliotheque
  add column if not exists fournisseur_id uuid
    references public.fournisseurs(id) on delete set null;

create index if not exists materiaux_bibliotheque_fournisseur_id_idx
  on public.materiaux_bibliotheque (fournisseur_id);
