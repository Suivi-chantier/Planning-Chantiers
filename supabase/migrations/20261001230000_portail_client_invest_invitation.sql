-- ============================================================================
-- Portail client Invest — étape 5 : qui gère les accès clients (invitation).
-- Périmètre : Profero Invest. Décision de Matthieu (01/10/2026) : réservé aux
-- administrateurs et aux commerciaux.
--
-- 1. public.portail_gestionnaire() : vrai si l'appelant est un collaborateur actif
--    dont le rôle est admin ou commercial. Source unique de la règle, utilisée par
--    la base ET par la fonction d'invitation.
-- 2. invest_portail_comptes : les gestionnaires peuvent LIRE les accès et en
--    RÉVOQUER (statut, qui, quand). Ils ne peuvent plus créer, supprimer ni
--    changer le client ou le compte lié : la création passe uniquement par la
--    fonction portail-inviter-client (service_role), qui contrôle l'adresse.
--    (Avant : administrateurs seuls, tous droits.)
--
-- RETOUR ARRIÈRE : sql/202610_portail_client_invest_invitation_rollback.sql
-- VÉRIFICATION  : node scripts/verif-portail-client-invest.mjs
-- ============================================================================

create or replace function public.portail_gestionnaire()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
           select true from public.utilisateurs u
           where lower(btrim(u.email)) = lower(btrim(coalesce(auth.email(), '')))
             and u.actif is true and u.role in ('admin', 'commercial')
           limit 1), false)
     and coalesce(public.est_collaborateur_actif(), false);
$$;
revoke all on function public.portail_gestionnaire() from public, anon;
grant execute on function public.portail_gestionnaire() to authenticated;

drop policy if exists invest_portail_comptes_admin on public.invest_portail_comptes;

create policy invest_portail_comptes_lecture on public.invest_portail_comptes
  for select to authenticated
  using ((select public.portail_gestionnaire()));

create policy invest_portail_comptes_revocation on public.invest_portail_comptes
  for update to authenticated
  using ((select public.portail_gestionnaire()))
  with check ((select public.portail_gestionnaire()));

revoke insert, update, delete on public.invest_portail_comptes from authenticated;
grant update (statut, revoque_par, revoque_le) on public.invest_portail_comptes to authenticated;
