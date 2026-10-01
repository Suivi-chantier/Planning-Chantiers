-- ============================================================================
-- RETOUR ARRIÈRE de supabase/migrations/20260930230000_invest_situation_patrimoniale_2c.sql
--
-- ⚠️ DESTRUCTIF pour les données de la Tranche 2c : personnes du foyer, postes
-- financiers, engagements, actifs patrimoniaux et structures sont supprimés.
-- Exporter ces tables avant si des données ont été saisies.
--
-- Les événements « collecte_* » du journal sont CONSERVÉS : la contrainte de
-- type d'avant la 2c est remise en « not valid » (elle refuse toute nouvelle
-- écriture de ces types sans rejeter l'historique). Aucune autre table touchée.
-- ============================================================================

drop table if exists public.invest_engagements;
drop table if exists public.invest_postes_financiers;
drop table if exists public.invest_actifs_patrimoniaux;
drop table if exists public.invest_structures;
drop table if exists public.invest_personnes;

drop function if exists public.invest_collecte_journal();
drop function if exists public.invest_collecte_regles();
drop function if exists public.invest_collecte_avant_ecriture();
drop function if exists public.invest_collecte_meme_client(text, uuid, uuid);
drop function if exists public.invest_collecte_metier(jsonb);
drop function if exists public.invest_collecte_objet(text, jsonb);

alter table public.invest_dossier_evenements drop constraint if exists invest_dossier_evenements_type_check;
alter table public.invest_dossier_evenements add constraint invest_dossier_evenements_type_check
  check (type in ('dossier_cree','dossier_statut_change','dossier_modifie',
    'lettre_mission_change','conseiller_change','etape_statut_change','etape_balle_change',
    'etape_echeance_change','etape_prochaine_action_change','etape_bloquee','etape_debloquee',
    'reprise_importee','etape_reprise_confirmee')) not valid;
