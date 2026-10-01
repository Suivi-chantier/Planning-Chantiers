-- Retour arrière de 20261001190000 : rétablit le hook « aucun client » et retire la table.
create or replace function public.acces_client_invest_autorise(p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select false;
$$;
revoke all on function public.acces_client_invest_autorise(uuid) from public, anon, authenticated;

drop trigger if exists invest_portail_revoquer_sessions on public.invest_portail_comptes;
drop function if exists public.invest_portail_revoquer_sessions();
drop function if exists public.portail_client_id();
drop table if exists public.invest_portail_comptes;
