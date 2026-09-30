-- ============================================================================
-- CHANTIER 1.0 — Accès Profero : un compte désactivé n'a plus AUCUN accès.
--
-- CLASSEMENT : TRANSVERSE / sécurité.
-- NON DESTRUCTIVE À L'APPLICATION : aucune donnée lue ou écrite par la
-- migration elle-même, aucune policy modifiée, aucune session supprimée
-- (les sessions existantes des comptes déjà désactivés restent en place ;
-- leur nettoyage est une décision séparée).
--
-- ÉTAT PRÉCÉDENT (constaté le 30/09/2026)
--   Supabase Auth délivre des jetons sans jamais lire public.utilisateurs :
--   actif = false n'était vérifié que par le navigateur (au chargement) et par
--   quelques fonctions SQL. Les sessions Supabase n'expirent pas : un onglet
--   ou une PWA restés ouverts renouvellent leur jeton indéfiniment.
--
-- CHANGEMENT
--   1. public.acces_profero_hook(event) — « Custom Access Token Hook ».
--      Appelé par Supabase Auth avant CHAQUE jeton (connexion, renouvellement,
--      lien d'invitation ou de réinitialisation). Fermé par défaut :
--        - population « collaborateur » : public.utilisateurs, actif = true ;
--        - population « client_invest » : emplacement réservé au Chantier 1.1
--          (renvoie toujours false aujourd'hui) ;
--        - une identité relève d'UNE population ; aucune, les deux, ou une
--          erreur → refus 403.
--      Le jeton accordé porte la claim profero_population (collaborateur |
--      client_invest), posée par le serveur : utilisable plus tard par la RLS
--      pour isoler clients et collaborateurs.
--      ⚠️ SANS EFFET tant que le hook n'est pas activé dans le tableau de bord
--      (docs/project/HOOK-ACCES-PROFERO.md).
--   2. Déclencheur utilisateurs_revoquer_sessions : quand un profil passe de
--      actif = true à autre chose, ou est supprimé, et qu'aucun profil actif
--      ne reste pour cette adresse, les sessions Auth du compte sont supprimées
--      (refresh tokens en cascade). Au mieux : si la suppression échoue, la
--      désactivation n'est PAS bloquée (avertissement) — le hook reste la
--      garantie.
--
-- RETOUR ARRIÈRE : sql/202609_acces_profero_hook_sessions_rollback.sql
--   (DÉSACTIVER LE HOOK DANS LE TABLEAU DE BORD AVANT, sinon plus aucune
--   connexion possible).
-- VÉRIFICATION  : node scripts/verif-acces-profero-hook.mjs
-- ============================================================================

-- ── Population 1 : collaborateurs Profero ───────────────────────────────────
-- Autorisé si au moins un profil actif ET aucun profil non actif pour cette
-- adresse (doublons : l'ambiguïté vaut refus).
create or replace function public.acces_collaborateur_autorise(p_email text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(p_email, '') <> ''
     and exists (
       select 1 from public.utilisateurs u
       where lower(btrim(u.email)) = p_email and u.actif is true)
     and not exists (
       select 1 from public.utilisateurs u
       where lower(btrim(u.email)) = p_email and u.actif is not true);
$$;

-- ── Population 2 : clients Invest (Chantier 1.1) ────────────────────────────
-- Emplacement réservé. Le Chantier 1.1 remplacera ce corps par une lecture de
-- SA table clients, par IDENTIFIANT Auth (jamais par email, jamais dans
-- public.utilisateurs), fermée par défaut. Tant qu'il n'existe aucun client :
-- false.
create or replace function public.acces_client_invest_autorise(p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select false;
$$;

-- ── Le hook ─────────────────────────────────────────────────────────────────
create or replace function public.acces_profero_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_refus constant jsonb := jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Accès Profero refusé : compte désactivé ou non autorisé.'));
  v_user_id uuid;
  v_email   text;
  v_collab  boolean;
  v_client  boolean;
begin
  v_user_id := (event ->> 'user_id')::uuid;
  if v_user_id is null or jsonb_typeof(event -> 'claims') is distinct from 'object' then
    return v_refus;
  end if;

  select lower(btrim(u.email)) into v_email from auth.users u where u.id = v_user_id;

  v_collab := coalesce(public.acces_collaborateur_autorise(v_email), false);
  v_client := coalesce(public.acces_client_invest_autorise(v_user_id), false);

  if v_collab and not v_client then
    return jsonb_set(event, '{claims,profero_population}', '"collaborateur"');
  end if;
  if v_client and not v_collab then
    return jsonb_set(event, '{claims,profero_population}', '"client_invest"');
  end if;
  return v_refus;
exception when others then
  return v_refus;
end;
$$;

-- Seul Supabase Auth appelle le hook ; personne n'appelle les deux autres
-- directement (le hook s'exécute en tant que propriétaire, postgres).
revoke all on function public.acces_profero_hook(jsonb) from public, anon, authenticated;
revoke all on function public.acces_collaborateur_autorise(text) from public, anon, authenticated;
revoke all on function public.acces_client_invest_autorise(uuid) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.acces_profero_hook(jsonb) to supabase_auth_admin;

-- ── Sessions supprimées à la désactivation ou à la suppression du profil ─────
create or replace function public.utilisateurs_revoquer_sessions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(old.email));
begin
  if tg_op = 'UPDATE' and not (old.actif is true and new.actif is not true) then
    return null;
  end if;
  if coalesce(v_email, '') = '' then
    return null;
  end if;
  -- Un autre profil actif pour la même adresse : le compte garde son accès.
  if exists (select 1 from public.utilisateurs u
             where lower(btrim(u.email)) = v_email and u.actif is true) then
    return null;
  end if;

  begin
    delete from auth.sessions s
    using auth.users au
    where s.user_id = au.id and lower(btrim(au.email)) = v_email;
  exception when others then
    raise warning 'utilisateurs_revoquer_sessions : sessions non supprimées (%) ; le hook d''accès reste la garantie.', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.utilisateurs_revoquer_sessions() from public, anon, authenticated;

create or replace trigger utilisateurs_revoquer_sessions
  after update of actif or delete on public.utilisateurs
  for each row execute function public.utilisateurs_revoquer_sessions();
