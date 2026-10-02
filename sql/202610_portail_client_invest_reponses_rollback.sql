-- Retour arrière : portail client Invest — réponses du client (migration 20261002180000).
-- Supprime la table d'attente (les saisies en attente sont perdues), la vue et les fonctions.
-- La vue d'accueil retrouve ses deux colonnes d'origine.
drop view if exists public.portail_client;
create view public.portail_client with (security_barrier = true) as
  select c.prenom, c.nom
  from public.invest_clients c
  where c.id = (select public.portail_client_id());
revoke all on public.portail_client from public, anon, authenticated;
grant select on public.portail_client to authenticated;
drop function if exists public.portail_maj_telephone(text);
drop function if exists public.portail_donnees_dossier();
drop view if exists public.portail_reponses;
drop function if exists public.portail_enregistrer_reponse(text, jsonb, boolean);
drop table if exists public.invest_portail_reponses;
drop function if exists public.portail_nettoyer_reponse(text, jsonb);
drop function if exists public.portail_nettoyer_valeur(jsonb, jsonb);
drop function if exists public.portail_schema_reponses();
