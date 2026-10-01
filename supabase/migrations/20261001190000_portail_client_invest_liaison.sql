-- ============================================================================
-- Portail client Invest — étape 1 : lien compte de connexion ↔ client.
-- Périmètre : Profero Invest uniquement. Décidé avec Matthieu le 01/10/2026
-- (plan : docs/project/PORTAIL-CLIENT-INVEST-PLAN.md).
--
-- CHANGEMENT
--   1. public.invest_portail_comptes : un compte Auth = un client (auth_user_id
--      unique) ; un client peut avoir plusieurs comptes (couple). Statut
--      actif / revoque. Gérée par les administrateurs seulement.
--   2. public.acces_client_invest_autorise(uuid) : lit cette table PAR
--      IDENTIFIANT Auth, fermée par défaut (contrat du hook d'accès).
--   3. public.portail_client_id() : le client de l'appelant, ou null. Sert aux
--      futures policies de lecture du portail. Ne renvoie que l'appelant.
--   4. Révocation (statut -> revoque, ou suppression de la ligne) : les
--      sessions Auth du compte sont supprimées.
--
-- SANS EFFET IMMÉDIAT : la table est vide, donc aucun compte n'est accepté
-- comme client ; aucune policy client n'est ouverte (étape 3). La règle 3a
-- (collaborateurs seulement) continue de refuser tout client sur les autres
-- tables.
--
-- RETOUR ARRIÈRE : sql/202610_portail_client_invest_liaison_rollback.sql
-- VÉRIFICATION  : node scripts/verif-portail-client-invest.mjs
-- ============================================================================

create table public.invest_portail_comptes (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.invest_clients(id) on delete cascade,
  auth_user_id  uuid not null unique references auth.users(id) on delete cascade,
  statut        text not null default 'actif' check (statut in ('actif', 'revoque')),
  invite_par    text,
  invite_le     timestamptz not null default now(),
  revoque_par   text,
  revoque_le    timestamptz
);
create index invest_portail_comptes_client_idx on public.invest_portail_comptes (client_id);

alter table public.invest_portail_comptes enable row level security;
revoke all on public.invest_portail_comptes from anon;
grant select, insert, update, delete on public.invest_portail_comptes to authenticated;

create policy invest_portail_comptes_admin on public.invest_portail_comptes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Règle du dépôt : toute nouvelle table reçoit la restrictive 3a.
create policy profero_collaborateurs_seulement on public.invest_portail_comptes
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif()))
  with check ((select public.est_collaborateur_actif()));

-- Hook d'accès : population client_invest. Contrat : identifiant Auth, fermé
-- par défaut, sql stable, search_path vide, sans security definer.
create or replace function public.acces_client_invest_autorise(p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_user_id is not null
     and exists (
       select 1 from public.invest_portail_comptes c
       where c.auth_user_id = p_user_id and c.statut = 'actif');
$$;
revoke all on function public.acces_client_invest_autorise(uuid) from public, anon, authenticated;

-- Le client de l'appelant. Exige le jeton étiqueté par le hook ET un lien actif.
create or replace function public.portail_client_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.client_id
  from public.invest_portail_comptes c
  where c.auth_user_id = auth.uid()
    and c.statut = 'actif'
    and coalesce(auth.jwt() ->> 'profero_population', '') = 'client_invest'
  limit 1;
$$;
revoke all on function public.portail_client_id() from public, anon;
grant execute on function public.portail_client_id() to authenticated;

-- Sessions supprimées à la révocation ou à la suppression du lien.
create or replace function public.invest_portail_revoquer_sessions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and not (old.statut = 'actif' and new.statut <> 'actif') then
    return null;
  end if;
  begin
    delete from auth.sessions s where s.user_id = old.auth_user_id;
  exception when others then
    raise warning 'invest_portail_revoquer_sessions : sessions non supprimées (%) ; le hook d''accès reste la garantie.', sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.invest_portail_revoquer_sessions() from public, anon, authenticated;

create trigger invest_portail_revoquer_sessions
  after update of statut or delete on public.invest_portail_comptes
  for each row execute function public.invest_portail_revoquer_sessions();
