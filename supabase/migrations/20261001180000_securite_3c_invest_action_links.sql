-- Sécurité 3c (Profero Invest uniquement) : fermeture de l'accès anonyme à
-- invest_dashboard_action_links. Les comptes connectés gardent leur accès
-- (la restrictive profero_collaborateurs_seulement continue de s'appliquer).
-- Retour arrière : sql/202610_securite_3c_invest_action_links_rollback.sql
drop policy if exists invest_dashboard_action_links_all_app on public.invest_dashboard_action_links;
create policy invest_dashboard_action_links_all_app on public.invest_dashboard_action_links
  for all to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
revoke all on public.invest_dashboard_action_links from anon;
