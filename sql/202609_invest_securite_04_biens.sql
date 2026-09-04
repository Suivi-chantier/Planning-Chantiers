-- ============================================================================
-- CHANTIER 1C · 04 — Biens, planning, routine du matin.
--
-- PÉRIMÈTRE : INVEST ONLY. Trois tables.
--
-- ÉTAT PRÉCÉDENT (mesuré le 04/09/2026, clé anon, sans session)
--   invest_biens                 : lecture anon déjà refusée, aucun filtrage
--                                  par rôle ni par branche.
--   invest_planning              : 1 ligne LISIBLE en anon, INSERT autorisé
--                                  (code 23505).
--   invest_morning_routine_items : lecture anon déjà refusée.
--
-- ── LE POINT DE VIGILANCE DE TOUT LE CHANTIER ───────────────────────────────
--
--   `invest_biens` porte la clause la plus large des migrations, et ce n'est
--   PAS un relâchement : sept pages la lisent réellement. Relevé par
--   inspection des `.from("invest_biens")` module par module :
--
--     biens           Biens.jsx           lit et écrit
--     crm             CRM.jsx             lit et écrit
--     simulateur      Simulateur.jsx      lit et écrit
--     sourcing        Sourcing.jsx        lit et écrit
--     dashboard       Dashboard.jsx       lit et écrit
--     etat_des_lieux  edlStore.js         LIT SEULEMENT
--     urbanisme       Urbanisme.jsx       LIT SEULEMENT
--
--   Le cas décisif est `etat_des_lieux`. edlStore.listerBiensPourEDL() fait
--       .from("invest_biens").select("id,reference_interne,adresse,code_postal,ville")
--   pour alimenter le sélecteur de bien à la création d'un état des lieux.
--   Sans « etat_des_lieux » dans le USING, un compte agent_edl — dont la
--   matrice n'accorde QUE cette page — ne pourrait plus rattacher un EDL à un
--   bien. C'est exactement la régression que la consigne demande d'éviter.
--
--   En revanche l'EDL et l'Urbanisme ne font que LIRE : ni l'un ni l'autre ne
--   figure dans WITH CHECK. agent_edl peut donc choisir un bien, pas le
--   modifier.
--
-- CHANGEMENT
--   RLS activée sur les trois tables, policies adossées aux pages réelles,
--   avec une asymétrie assumée entre lecture et écriture sur invest_biens.
--
-- IMPACT
--   admin, super_admin : inchangé.
--   commercial : conserve biens, crm, simulateur. Perd invest_planning et la
--     routine du matin, faute de la page « dashboard » — cohérent, il n'a pas
--     cet onglet dans l'interface.
--   agent_edl : CONSERVE la lecture de invest_biens. Ne peut pas l'écrire.
--   utilisateur Rénovation seul : perd tout.
--   anon : plus aucun accès.
--
-- ORDRE D'APPLICATION : après 01. Indépendant de 02a, 03, 05, 06.
-- ============================================================================

BEGIN;

DO $$
DECLARE t text; p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'invest_biens', 'invest_planning', 'invest_morning_routine_items'
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

-- ── invest_biens ────────────────────────────────────────────────────────────
CREATE POLICY "invest_biens_membres"
  ON public.invest_biens
  FOR ALL TO authenticated
  -- LECTURE : les sept pages qui lisent la table.
  USING (
        (SELECT public.invest_peut_voir('biens'))
    OR  (SELECT public.invest_peut_voir('crm'))
    OR  (SELECT public.invest_peut_voir('simulateur'))
    OR  (SELECT public.invest_peut_voir('sourcing'))
    OR  (SELECT public.invest_peut_voir('dashboard'))
    OR  (SELECT public.invest_peut_voir('etat_des_lieux'))   -- sélecteur EDL
    OR  (SELECT public.invest_peut_voir('urbanisme'))        -- lecture seule
  )
  -- ÉCRITURE : les cinq pages qui éditent réellement un bien. L'EDL et
  -- l'Urbanisme en sont volontairement exclus.
  WITH CHECK (
        (SELECT public.invest_peut_voir('biens'))
    OR  (SELECT public.invest_peut_voir('crm'))
    OR  (SELECT public.invest_peut_voir('simulateur'))
    OR  (SELECT public.invest_peut_voir('sourcing'))
    OR  (SELECT public.invest_peut_voir('dashboard'))
  );

-- ── invest_planning — RDV, lus par le tableau de bord ───────────────────────
CREATE POLICY "invest_planning_membres"
  ON public.invest_planning
  FOR ALL TO authenticated
  USING (
        (SELECT public.invest_peut_voir('dashboard'))
    OR  (SELECT public.invest_peut_voir('crm'))
  )
  WITH CHECK (
        (SELECT public.invest_peut_voir('dashboard'))
    OR  (SELECT public.invest_peut_voir('crm'))
  );

-- ── invest_morning_routine_items — tableau de bord seul ─────────────────────
CREATE POLICY "invest_morning_routine_membres"
  ON public.invest_morning_routine_items
  FOR ALL TO authenticated
  USING      ((SELECT public.invest_peut_voir('dashboard')))
  WITH CHECK ((SELECT public.invest_peut_voir('dashboard')));

COMMIT;

-- ── CONTRÔLE — LE TEST QUI COMPTE LE PLUS DE TOUT LE CHANTIER ───────────────
-- Avec une session de rôle agent_edl :
--
--   SELECT public.invest_peut_voir('etat_des_lieux') AS doit_etre_vrai,
--          public.invest_peut_voir('biens')          AS doit_etre_faux;
--
--   SELECT count(*) FROM public.invest_biens;   -- doit renvoyer > 0
--
-- Puis, dans l'application : créer un état des lieux et rattacher un bien.
--
-- ── RETOUR ARRIÈRE ──────────────────────────────────────────────────────────
-- Voir sql/202609_invest_securite_99_rollback.sql
