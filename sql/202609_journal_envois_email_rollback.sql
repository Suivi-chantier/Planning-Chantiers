-- ============================================================================
-- ROLLBACK — sql/202609_journal_envois_email.sql
--
-- Supprime la fonction de purge et la table du journal des envois.
-- ⚠ Détruit l'historique d'observation : exporter d'abord si le bilan n'a
--   pas encore été produit.
--
-- Sans effet sur les envois : /api/send-email ignore l'échec d'écriture du
-- journal et continue d'envoyer (le journal ne bloque jamais un envoi).
-- ============================================================================

BEGIN;
DROP FUNCTION IF EXISTS public.purger_journal_envois_email(interval);
DROP TABLE IF EXISTS public.journal_envois_email;
COMMIT;
