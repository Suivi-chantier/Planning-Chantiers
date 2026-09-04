-- ============================================================================
-- CHANTIER 1C · 99 — RETOUR ARRIÈRE.
--
-- PÉRIMÈTRE : INVEST ONLY. Ne touche AUCUN élément Profero Rénovation :
--   ni table, ni policy, ni fonction (mon_role, est_ouvrier sont seulement
--   APPELÉES, jamais redéfinies), ni clé de planning_config autre que
--   access_pages_invest.
--
-- ⚠ AVERTISSEMENT — CE FICHIER REMET LA BASE DANS UN ÉTAT PERMISSIF.
--   Il rétablit l'accès « tout authentifié qui n'est pas ouvrier », qui était
--   l'intention documentée des deux migrations Invest existantes. Il ne
--   rétablit PAS l'exposition anonyme : les policies permissives d'origine sur
--   les tables créées à la console n'ont jamais été versionnées, leurs noms et
--   leurs expressions sont inconnus, et les recréer à l'aveugle serait pire
--   que le mal. Après ce rollback, anon reste donc fermé — c'est volontaire.
--
--   Conséquence à connaître : le rollback ne rend PAS le suivi financier
--   lisible à un commercial. Il rend les tables lisibles à tout compte
--   authentifié non-ouvrier, des deux branches. C'est un filet pour une
--   fenêtre de bascule, pas une position tenable.
--
-- USAGE
--   Section 1 seule → annuler une régression sur les policies.
--   Section 2       → annuler aussi la matrice super_admin.
--   Section 3       → nettoyage complet des helpers (rarement utile).
--
--   Les trois sections sont indépendantes. N'exécuter que ce qui est
--   nécessaire, et de préférence table par table plutôt que le lot entier.
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION 1 — Policies                                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Retire les policies créées par les fichiers 02a à 06 et remet « bureau_all »
-- sur chaque table traitée.
--
-- `invest_prospects` N'APPARAÎT PAS dans cette liste : le chantier 1C ne l'a
-- pas touchée (NO-GO Fluidify), il n'y a donc rien à y annuler.

BEGIN;

DO $$
DECLARE t text; p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'invest_prospect_actions',
    'invest_clients', 'invest_notes', 'invest_propositions',
    'invest_mission_actions', 'invest_action_notifications',
    'invest_biens', 'invest_planning', 'invest_morning_routine_items',
    'invest_suivi_financier',
    'invest_structuration_patrimoniale', 'invest_urbanisme_dossiers',
    'invest_etats_des_lieux', 'invest_drive_links',
    'sourcing_annonces', 'sourcing_criteres', 'sourcing_logs'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

    -- On ne retire que NOS policies, identifiées par leur suffixe. Une policy
    -- ajoutée par ailleurs entre-temps est laissée en place.
    FOR p IN
      SELECT policyname FROM pg_policies
      WHERE  schemaname = 'public' AND tablename = t
        AND  (policyname LIKE '%_membres' OR policyname LIKE '%_pilotes')
    LOOP
      RAISE NOTICE 'rollback : suppression de % sur %', p.policyname, t;
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;

    -- Rétablit l'intention documentée des migrations Invest existantes.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'bureau_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY "bureau_all" ON public.%I '
        'FOR ALL TO authenticated '
        'USING (NOT public.est_ouvrier()) '
        'WITH CHECK (NOT public.est_ouvrier())', t
      );
    END IF;
  END LOOP;
END $$;

COMMIT;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION 2 — Matrice super_admin                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Rétablit la valeur relevée le 04/09/2026 avant le fichier 00 : 8 pages.
-- Ne modifie que la clé `super_admin` de access_pages_invest ; les 10 autres
-- rôles et les 31 autres clés de planning_config restent intacts.
--
-- À n'exécuter que si la décision métier « super_admin = accès complet » est
-- revenue en arrière. Décommenter pour agir.

-- UPDATE public.planning_config
-- SET    value = value || jsonb_build_object(
--          'super_admin',
--          jsonb_build_array('dashboard','crm','biens','simulateur','admin',
--                            'finance','suivi_financier','structuration')
--        ),
--        updated_at = now()
-- WHERE  key = 'access_pages_invest';


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION 3 — Helpers Invest                                               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Les laisser en place est sans effet : après la section 1, plus aucune policy
-- ne les appelle. Ne les supprimer que pour un nettoyage complet, et APRÈS la
-- section 1 — l'ordre inverse ferait échouer les policies qui les référencent.

-- DROP FUNCTION IF EXISTS public.invest_peut_voir(text);
-- DROP FUNCTION IF EXISTS public.invest_role_courant();
-- DROP FUNCTION IF EXISTS public.invest_est_membre();


-- ── CONTRÔLE APRÈS ROLLBACK ─────────────────────────────────────────────────
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public'
--     AND (tablename LIKE 'invest_%' OR tablename LIKE 'sourcing_%')
--   ORDER BY tablename;
--
-- Puis vérifier dans l'application que le rôle qui posait problème fonctionne
-- de nouveau, et rouvrir le sujet plutôt que de laisser l'état permissif.
