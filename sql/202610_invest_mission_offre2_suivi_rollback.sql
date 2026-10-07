-- Retour arrière de 20261007120000_invest_mission_offre2_suivi.sql : retire les deux colonnes facultatives.
-- Seules les saisies de suivi (travaux, transmission, détails d'acquisition) sont perdues ; tout le reste est intact.
alter table public.invest_dossier_acquisitions drop constraint if exists invest_dossier_acquisitions_suivi_objet;
alter table public.invest_dossier_acquisitions drop column if exists suivi;
alter table public.invest_dossiers drop constraint if exists invest_dossiers_suivi_offre2_objet;
alter table public.invest_dossiers drop column if exists suivi_offre2;
