-- ============================================================================
-- RETOUR ARRIÈRE de supabase/migrations/20260930150000_utilisateurs_champs_sensibles.sql
--
-- À n'exécuter qu'en cas de régression constatée : rouvre la faille
-- (auto-promotion administrateur). Aucune donnée n'est touchée.
-- ============================================================================

drop trigger if exists utilisateurs_proteger_champs_sensibles on public.utilisateurs;
drop function if exists public.utilisateurs_proteger_champs_sensibles();

grant truncate, trigger, references on table public.utilisateurs to anon, authenticated;

alter function public.is_admin() reset search_path;
