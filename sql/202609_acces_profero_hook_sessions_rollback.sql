-- ============================================================================
-- RETOUR ARRIÈRE de supabase/migrations/20260930170000_acces_profero_hook_sessions.sql
--
-- ⚠️ ORDRE IMPÉRATIF : DÉSACTIVER D'ABORD le hook dans le tableau de bord
-- (Authentication → Hooks → Custom Access Token → désactiver). Supprimer la
-- fonction pendant que le hook est actif bloquerait TOUTES les connexions.
--
-- Rouvre la faille : un compte désactivé peut de nouveau obtenir des jetons.
-- Aucune donnée n'est touchée ; les sessions déjà supprimées ne reviennent pas.
-- ============================================================================

drop trigger if exists utilisateurs_revoquer_sessions on public.utilisateurs;
drop function if exists public.utilisateurs_revoquer_sessions();
drop function if exists public.acces_profero_hook(jsonb);
drop function if exists public.acces_client_invest_autorise(uuid);
drop function if exists public.acces_collaborateur_autorise(text);
