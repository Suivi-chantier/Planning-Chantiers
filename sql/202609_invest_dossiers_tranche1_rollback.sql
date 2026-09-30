-- ============================================================================
-- RETOUR ARRIÈRE de supabase/migrations/20260930190000_invest_dossiers_tranche1.sql
--
-- ⚠️ DESTRUCTIF pour les données de la Tranche 1 : dossiers, étapes et journal
-- sont supprimés. À n'exécuter qu'avant la bascule des écrans, et après avoir
-- exporté ces tables si des dossiers ont été saisis.
--
-- Les tâches de mission, clients, notes et propositions ne sont PAS touchés :
-- seules les colonnes ajoutées par la Tranche 1 sont retirées.
-- ============================================================================

drop view if exists public.invest_controle_dossiers;

drop trigger if exists invest_mission_actions_rattacher on public.invest_mission_actions;
drop function if exists public.invest_mission_actions_rattacher();

drop function if exists public.invest_convertir_prospect(uuid, jsonb, jsonb);
drop function if exists public.invest_ouvrir_dossier(uuid, jsonb);
drop function if exists public.invest_rattacher_actions_dossier(uuid);

alter table public.invest_mission_actions
  drop column if exists responsable_id,
  drop column if exists acteur_type,
  drop column if exists nature,
  drop column if exists etape,
  drop column if exists operation_id,
  drop column if exists dossier_id;

drop table if exists public.invest_dossier_evenements;
drop table if exists public.invest_dossier_etapes;
drop table if exists public.invest_dossiers;
drop sequence if exists public.invest_dossier_reference_seq;

drop function if exists public.invest_etapes_journal();
drop function if exists public.invest_etapes_avant_ecriture();
drop function if exists public.invest_dossiers_journal();
drop function if exists public.invest_dossiers_avant_ecriture();
drop function if exists public.invest_evenements_immuables();
drop function if exists public.invest_journaliser(uuid, uuid, text, text, jsonb, jsonb, uuid, uuid);
drop function if exists public.invest_auteur_courant();
drop function if exists public.invest_diff(jsonb, jsonb, text[], text);
drop function if exists public.invest_etape_depuis_step_key(text);
drop function if exists public.invest_libelle_statut_dossier(text);
drop function if exists public.invest_libelle_balle(text);
drop function if exists public.invest_libelle_statut_etape(text);
drop function if exists public.invest_libelle_etape(text);
