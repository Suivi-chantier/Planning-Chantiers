-- Retour arrière de 20261001200000.
drop view if exists public.portail_evenements;
drop view if exists public.portail_taches;
drop view if exists public.portail_etapes;
drop view if exists public.portail_dossier;
alter table public.invest_mission_actions drop column if exists visible_client;
