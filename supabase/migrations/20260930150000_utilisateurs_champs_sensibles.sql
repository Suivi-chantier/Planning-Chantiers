-- ============================================================================
-- CHANTIER 1.0 — utilisateurs : un utilisateur ne peut plus modifier ses
-- propres champs sensibles (rôle, statut actif, branches, email…).
--
-- CLASSEMENT : TRANSVERSE / sécurité.
-- NON DESTRUCTIVE : aucune donnée lue, modifiée ou supprimée ; aucune policy
-- modifiée ; aucune colonne ajoutée ou retirée.
--
-- ÉTAT PRÉCÉDENT (constaté en base le 30/09/2026)
--   Policy utilisateurs_update : USING ((auth.email() = email) OR is_admin()),
--   sans WITH CHECK, aucun déclencheur, droit UPDATE sur toutes les colonnes
--   pour anon et authenticated. Tout compte connecté pouvait donc écrire
--     update utilisateurs set role = 'admin', actif = true
--     where email = auth.email();
--   et devenir administrateur (is_admin() lit ces deux colonnes), y compris
--   un compte désactivé.
--
-- CHANGEMENT
--   1. Déclencheur BEFORE INSERT OR UPDATE sur public.utilisateurs. Liste
--      BLANCHE, fermée par défaut : pour un appelant qui n'est ni serveur ni
--      administrateur actif,
--        - INSERT refusé ;
--        - UPDATE refusé dès qu'une colonne AUTRE QUE nav_order change.
--      Une colonne ajoutée plus tard est donc protégée d'office.
--      Serveur = current_user service_role (API, Edge Functions), postgres ou
--      supabase_admin (migrations, tableau de bord).
--      Administrateur = is_admin() (role = 'admin' ET actif = true), évalué
--      sur l'état AVANT la modification : un compte ne peut pas se promouvoir
--      puis profiter de sa promotion dans la même requête.
--   2. Retrait des droits TRUNCATE, TRIGGER et REFERENCES sur utilisateurs à
--      anon et authenticated : TRUNCATE ignore la RLS et les déclencheurs de
--      ligne. Aucun écran ne s'en sert ; l'API REST ne l'expose pas.
--   3. is_admin() : search_path fixé (public, pg_temp). Corps inchangé.
--
-- LA RLS RESTE LA PREMIÈRE BARRIÈRE (inchangée) : on ne peut toucher que sa
-- propre ligne (ou toutes, si admin). Le déclencheur ajoute la seconde : sur
-- sa propre ligne, seul nav_order est modifiable.
--
-- RETOUR ARRIÈRE : sql/202609_utilisateurs_champs_sensibles_rollback.sql
-- VÉRIFICATION  : node scripts/verif-utilisateurs-champs-sensibles.mjs
-- ============================================================================

create or replace function public.utilisateurs_proteger_champs_sensibles()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Serveur et maintenance : non concernés.
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  -- Administrateur actif (état avant modification). NULL = refus.
  if coalesce(public.is_admin(), false) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'utilisateurs : création réservée aux administrateurs.'
      using errcode = '42501';
  end if;

  -- UPDATE par un non-administrateur : seule nav_order peut changer.
  if (to_jsonb(new) - 'nav_order') is distinct from (to_jsonb(old) - 'nav_order') then
    raise exception 'utilisateurs : seul l''ordre de navigation (nav_order) est modifiable sur son propre profil.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.utilisateurs_proteger_champs_sensibles() from public, anon, authenticated;

create or replace trigger utilisateurs_proteger_champs_sensibles
  before insert or update on public.utilisateurs
  for each row execute function public.utilisateurs_proteger_champs_sensibles();

revoke truncate, trigger, references on table public.utilisateurs from anon, authenticated;

alter function public.is_admin() set search_path = public, pg_temp;
