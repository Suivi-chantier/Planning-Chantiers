-- ============================================================================
-- Retour arrière du lot 4 de la Refonte Opérations (automatisation ProGBat).
-- À n'exécuter qu'après avoir annulé la demande de fusion du lot 4.
--
-- Rien n'est supprimé :
--   - la tâche planifiée « progbat-devis-statut » est arrêtée (elle ne faisait
--     que lire le statut des devis dans ProGBat) ;
--   - la table des réservations est RENOMMÉE en progbat_ecritures_sauvegarde_refonte
--     (elle garde profero_collaborateurs_seulement) : la trace de chaque
--     écriture ProGBat déclenchée depuis l'application reste consultable ;
--   - les colonnes ajoutées (chantiers.progbat_business_id… ,
--     profero_projets.progbat_devis_statut…) restent en place : l'ancien code
--     ne les lit pas. Elles gardent les identifiants ProGBat déjà créés, qui
--     existent dans ProGBat et ne doivent pas être perdus.
--   - l'index unique clients_progbat_client_id_uidx est conservé (il n'empêche
--     rien à l'ancien code : il interdit seulement deux fiches pour un même
--     client ProGBat).
-- Ce qui a été créé dans ProGBat (clients, chantiers, factures d'acompte en
-- brouillon) n'est PAS annulé par ce script : ProGBat est la comptabilité, on
-- n'y supprime rien depuis l'application.
-- ============================================================================
begin;
select cron.unschedule('progbat-devis-statut');
alter table public.progbat_ecritures rename to progbat_ecritures_sauvegarde_refonte;
commit;
