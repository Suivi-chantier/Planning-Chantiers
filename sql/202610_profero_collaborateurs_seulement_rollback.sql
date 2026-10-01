-- ============================================================================
-- RETOUR ARRIÈRE de supabase/migrations/20261001150000_profero_collaborateurs_seulement.sql
--
-- Retire la policy restrictive « profero_collaborateurs_seulement » des 101
-- tables de public et de storage.objects, puis la fonction
-- est_collaborateur_actif(). Les policies métier n'ont jamais été modifiées :
-- l'état d'avant revient exactement. ⚠️ Un compte client redeviendrait
-- capable de lire et d'écrire l'essentiel de la base : à n'utiliser qu'en cas
-- de blocage avéré d'un collaborateur, et AVANT toute ouverture du portail.
-- ============================================================================

do $do$
declare t text;
begin
  for t in select tablename from pg_policies
           where schemaname = 'public' and policyname = 'profero_collaborateurs_seulement' loop
    execute format('drop policy if exists profero_collaborateurs_seulement on public.%I', t);
  end loop;
end
$do$;
drop policy if exists profero_collaborateurs_seulement on storage.objects;
drop function if exists public.est_collaborateur_actif();
