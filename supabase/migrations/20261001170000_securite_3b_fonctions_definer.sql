-- Sécurité 3b (périmètre Profero Invest uniquement) : retrait de l'accès API à une
-- fonction de déclencheur Invest. Voir docs/project/SECURITE-3B-FONCTIONS-DEFINER.md.
-- Retour arrière : sql/202610_securite_3b_fonctions_definer_rollback.sql
revoke execute on function public.fn_invest_notify_mission_action_status_change() from public, anon, authenticated;
