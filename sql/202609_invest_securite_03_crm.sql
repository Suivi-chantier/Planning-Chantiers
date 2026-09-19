-- ============================================================================
-- CHANTIER 1C · 03 — CRM : clients, notes, propositions, actions de mission,
--                    notifications.
--
-- PÉRIMÈTRE : INVEST ONLY. Cinq tables. `invest_prospects` NON INCLUSE.
--
-- ÉTAT PRÉCÉDENT (mesuré le 04/09/2026, clé anon, sans session)
--   invest_clients              : lecture anon DÉJÀ refusée — mais aucun
--                                 filtrage par rôle : tout authentifié
--                                 non-ouvrier lisait tout, y compris un
--                                 utilisateur Rénovation seul.
--   invest_notes                : idem.
--   invest_propositions         : idem.
--   invest_mission_actions      : 285 lignes LISIBLES en anon, INSERT et
--                                 UPDATE autorisés (codes 23514 puis 23505).
--                                 Porte responsable_email et notification_body.
--   invest_action_notifications :  75 lignes LISIBLES en anon, INSERT et
--                                 UPDATE autorisés (23505).
--
-- CHANGEMENT
--   RLS activée sur les cinq tables, policies adossées aux pages qui lisent
--   et écrivent réellement chaque table.
--
--   La distinction USING / WITH CHECK n'est pas cosmétique : elle vient du
--   relevé des `.from(...).insert|update|upsert|delete` module par module.
--     invest_clients      ← écrit par CRM.jsx, Dashboard.jsx,
--                             Prospection.jsx (conversion), Structuration.jsx
--     invest_notes        ← écrit par CRM.jsx seul
--     invest_propositions ← écrit par CRM.jsx et Biens.jsx
--     invest_mission_actions ← écrit par CRM.jsx ET Dashboard.jsx
--     invest_action_notifications ← écrit par notifications.jsx
--
--   Le cas des notifications mérite son exception. ClocheNotifications est
--   montée dans la barre latérale de PageInvest sans condition d'accès
--   (PageInvest.jsx:449) : elle est donc visible et cliquable par TOUT
--   utilisateur Invest, agent_edl compris, et « marquer comme lue » écrit en
--   base. L'adosser à « crm » couperait la cloche pour agent_edl. On la gate
--   donc sur invest_est_membre().
--
-- OBJECTIF
--   Que la base impose ce que l'interface affiche déjà, sans casser les
--   chemins d'écriture existants.
--
-- IMPACT
--   admin, super_admin, commercial : inchangé, tous ont « crm ».
--   agent_edl : perd clients, notes, propositions et actions de mission —
--     conforme à sa matrice. CONSERVE la cloche de notifications.
--   utilisateur Rénovation seul : perd tout.
--   anon : plus aucun accès.
--
-- ORDRE D'APPLICATION : après 01. Indépendant de 02a, 04, 05, 06.
-- ============================================================================

BEGIN;

DO $$
DECLARE t text; p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'invest_clients', 'invest_notes', 'invest_propositions',
    'invest_mission_actions', 'invest_action_notifications'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '% absente : ignorée.', t;
      CONTINUE;
    END IF;

    FOR p IN
      SELECT policyname FROM pg_policies
      WHERE  schemaname = 'public' AND tablename = t
    LOOP
      RAISE NOTICE 'suppression de la policy % sur %', p.policyname, t;
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ── invest_clients — le pivot : cinq pages la lisent ────────────────────────
-- Une clause trop étroite priverait la Structuration et le Suivi financier
-- des libellés de clients, et la Prospection de sa cible de conversion.
CREATE POLICY "invest_clients_membres"
  ON public.invest_clients
  FOR ALL TO authenticated
  USING (
        (SELECT public.invest_peut_voir('crm'))
    OR  (SELECT public.invest_peut_voir('structuration'))
    OR  (SELECT public.invest_peut_voir('prospection'))
    OR  (SELECT public.invest_peut_voir('suivi_financier'))
    OR  (SELECT public.invest_peut_voir('dashboard'))
  )
  -- Le Suivi financier ne fait que LIRE invest_clients (jointure de libellés) :
  -- il n'a pas besoin du droit d'écriture.
  WITH CHECK (
        (SELECT public.invest_peut_voir('crm'))
    OR  (SELECT public.invest_peut_voir('structuration'))
    OR  (SELECT public.invest_peut_voir('prospection'))
    OR  (SELECT public.invest_peut_voir('dashboard'))
  );

-- ── invest_notes — CRM seul ─────────────────────────────────────────────────
CREATE POLICY "invest_notes_membres"
  ON public.invest_notes
  FOR ALL TO authenticated
  USING      ((SELECT public.invest_peut_voir('crm')))
  WITH CHECK ((SELECT public.invest_peut_voir('crm')));

-- ── invest_propositions — liaison client ↔ bien, éditée des deux côtés ──────
CREATE POLICY "invest_propositions_membres"
  ON public.invest_propositions
  FOR ALL TO authenticated
  USING (
        (SELECT public.invest_peut_voir('crm'))
    OR  (SELECT public.invest_peut_voir('biens'))
    OR  (SELECT public.invest_peut_voir('dashboard'))
  )
  WITH CHECK (
        (SELECT public.invest_peut_voir('crm'))
    OR  (SELECT public.invest_peut_voir('biens'))
  );

-- ── invest_mission_actions — écrite par le CRM ET le tableau de bord ────────
-- Le tableau de bord fait avancer les étapes de mission (Dashboard.jsx écrit
-- deux fois dans cette table) : « dashboard » doit figurer dans WITH CHECK,
-- sans quoi la routine du matin échouerait en silence.
CREATE POLICY "invest_mission_actions_membres"
  ON public.invest_mission_actions
  FOR ALL TO authenticated
  USING (
        (SELECT public.invest_peut_voir('crm'))
    OR  (SELECT public.invest_peut_voir('dashboard'))
  )
  WITH CHECK (
        (SELECT public.invest_peut_voir('crm'))
    OR  (SELECT public.invest_peut_voir('dashboard'))
  );

-- ── invest_action_notifications — la cloche est globale ─────────────────────
-- Montée sans condition dans la barre latérale : tout membre Invest la voit,
-- et « marquer comme lue » écrit. Gate de branche, pas de page.
CREATE POLICY "invest_action_notifications_membres"
  ON public.invest_action_notifications
  FOR ALL TO authenticated
  USING      ((SELECT public.invest_est_membre()))
  WITH CHECK ((SELECT public.invest_est_membre()));

COMMIT;

-- ── CONTRÔLE ────────────────────────────────────────────────────────────────
--   SELECT tablename, policyname, roles, cmd FROM pg_policies
--   WHERE schemaname = 'public' AND tablename LIKE 'invest_%'
--   ORDER BY tablename;
--
-- ── RETOUR ARRIÈRE ──────────────────────────────────────────────────────────
-- Voir sql/202609_invest_securite_99_rollback.sql
