-- Retour arrière de supabase/migrations/20261021120000_multi_ouvrages_chiffrage.sql
-- DESTRUCTIF pour les multi-ouvrages (libellés commerciaux, ajustements) :
-- les lignes regroupées, elles, restent intactes (elles redeviennent des
-- lignes ordinaires du devis, sans ajustement).
drop function if exists public.creer_multi_ouvrage(uuid, text, text, text, uuid, uuid[]);
drop trigger if exists profero_ligne_multi_garde on public.profero_ouvrages_selectionnes;
drop function if exists public.profero_ligne_multi_garde();
drop index if exists public.profero_ouvrages_selectionnes_multi_idx;
alter table public.profero_ouvrages_selectionnes drop column if exists multi_ouvrage_id;
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profero_multi_ouvrages') then
    alter publication supabase_realtime drop table public.profero_multi_ouvrages;
  end if;
end $$;
drop table if exists public.profero_multi_ouvrages;
