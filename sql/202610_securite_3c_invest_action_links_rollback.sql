drop policy if exists invest_dashboard_action_links_all_app on public.invest_dashboard_action_links;
create policy invest_dashboard_action_links_all_app on public.invest_dashboard_action_links
  for all to public
  using (auth.role() = any (array['authenticated','anon']))
  with check (auth.role() = any (array['authenticated','anon']));
grant all on public.invest_dashboard_action_links to anon;
