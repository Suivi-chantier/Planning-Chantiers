-- ============================================================================
-- Refonte du Bilan semaine — étape 1B : nature des coûts et enveloppe
-- matériaux par lot.
--
-- CHANGEMENT (additif, aucune donnée supprimée ni réécrite hors la colonne
-- ajoutée) :
--   1. commande_lignes.nature : materiaux (par défaut) | sous_traitance |
--      location | dechets | autre. Les 1 692 lignes existantes reçoivent
--      « materiaux » (valeur par défaut de la colonne) : aucun chiffre ne bouge
--      tant qu'on ne requalifie pas une ligne.
--   2. Table achats_lots_termines : un lot d'un chantier marqué « achats
--      terminés » (date + auteur). Supprimer la ligne = démarquer (réversible) ;
--      l'historique universel (data_history) garde la trace de chaque
--      démarquage. Unique (chantier_id, lot_id).
--      Droits : mêmes policies que commande_lignes — bureau_all (pas un
--      compte ouvrier) + profero_collaborateurs_seulement (restrictive).
--
-- RETOUR ARRIÈRE :
--   drop table if exists public.achats_lots_termines;
--   alter table public.commande_lignes drop constraint if exists commande_lignes_nature_check;
--   alter table public.commande_lignes drop column if exists nature;
--
-- Idempotente : réexécutable sans effet.
-- ============================================================================

-- ── 1. Nature des coûts ─────────────────────────────────────────────────────
alter table public.commande_lignes
  add column if not exists nature text not null default 'materiaux';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'commande_lignes_nature_check') then
    alter table public.commande_lignes
      add constraint commande_lignes_nature_check
      check (nature in ('materiaux', 'sous_traitance', 'location', 'dechets', 'autre'));
  end if;
end $$;

comment on column public.commande_lignes.nature is
  'Nature du coût : materiaux (défaut) | sous_traitance | location | dechets | autre. Toutes comptent dans le coût réel du chantier ; seules les lignes materiaux consomment l''enveloppe matériaux du lot (chantierFinance.mjs, resteACommanderEnveloppes).';

-- ── 2. Lots « achats terminés » ─────────────────────────────────────────────
create table if not exists public.achats_lots_termines (
  id           uuid primary key default gen_random_uuid(),
  chantier_id  text not null,
  lot_id       text not null,
  termine_le   timestamptz not null default now(),
  termine_par  text,
  unique (chantier_id, lot_id)
);
comment on table public.achats_lots_termines is
  'Lots d''un chantier dont les achats de matériaux sont terminés : leur reste à commander vaut 0. Supprimer la ligne = démarquer.';

alter table public.achats_lots_termines enable row level security;
grant select, insert, update, delete on public.achats_lots_termines to authenticated;
grant all on public.achats_lots_termines to service_role;

drop policy if exists bureau_all on public.achats_lots_termines;
create policy bureau_all on public.achats_lots_termines for all to authenticated
  using (not public.est_ouvrier()) with check (not public.est_ouvrier());

drop policy if exists profero_collaborateurs_seulement on public.achats_lots_termines;
create policy profero_collaborateurs_seulement on public.achats_lots_termines
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));

-- Historique universel : chaque démarquage (suppression) est conservé.
drop trigger if exists trg_data_history on public.achats_lots_termines;
create trigger trg_data_history before update or delete on public.achats_lots_termines
  for each row execute function public.log_data_history();

-- ── Contrôle ────────────────────────────────────────────────────────────────
--   select nature, count(*) from public.commande_lignes group by 1;   -- 1 692 « materiaux »
--   select count(*) from public.achats_lots_termines;                 -- 0
