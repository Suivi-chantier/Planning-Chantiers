-- ─── TABLE COMMANDES_PASSEES ─────────────────────────────────────────────────
-- À exécuter dans Supabase SQL Editor.
-- Trace une entrée par groupe fournisseur à chaque passage de commande.

create table if not exists public.commandes_passees (
  id              uuid primary key default gen_random_uuid(),
  chantier_id     text,
  phasage_id      uuid references public.phasages(id) on delete set null,
  phase_id        text,
  phase_label     text,
  date_commande   timestamptz not null default now(),
  fournisseur_id  uuid references public.fournisseurs(id) on delete set null,
  fournisseur_nom text,
  articles        jsonb,
  total_ht        numeric,
  mail_envoye     boolean not null default false,
  notes           text
);

create index if not exists commandes_passees_phasage_id_idx
  on public.commandes_passees (phasage_id);
create index if not exists commandes_passees_phase_id_idx
  on public.commandes_passees (phasage_id, phase_id);
create index if not exists commandes_passees_date_idx
  on public.commandes_passees (date_commande desc);

alter table public.commandes_passees enable row level security;

drop policy if exists "commandes_passees_select_auth" on public.commandes_passees;
create policy "commandes_passees_select_auth"
  on public.commandes_passees for select
  to authenticated using (true);

drop policy if exists "commandes_passees_insert_auth" on public.commandes_passees;
create policy "commandes_passees_insert_auth"
  on public.commandes_passees for insert
  to authenticated with check (true);

drop policy if exists "commandes_passees_update_auth" on public.commandes_passees;
create policy "commandes_passees_update_auth"
  on public.commandes_passees for update
  to authenticated using (true) with check (true);

drop policy if exists "commandes_passees_delete_auth" on public.commandes_passees;
create policy "commandes_passees_delete_auth"
  on public.commandes_passees for delete
  to authenticated using (true);
