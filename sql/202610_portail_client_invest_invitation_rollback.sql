-- Retour arrière de 20261001230000 : retour à « administrateurs seuls, tous droits ».
drop policy if exists invest_portail_comptes_lecture on public.invest_portail_comptes;
drop policy if exists invest_portail_comptes_revocation on public.invest_portail_comptes;
create policy invest_portail_comptes_admin on public.invest_portail_comptes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
revoke update (statut, revoque_par, revoque_le) on public.invest_portail_comptes from authenticated;
grant select, insert, update, delete on public.invest_portail_comptes to authenticated;
drop function if exists public.portail_gestionnaire();
