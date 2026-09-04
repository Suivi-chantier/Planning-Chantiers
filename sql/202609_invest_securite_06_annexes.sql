-- ============================================================================
-- CHANTIER 1C · 06 — Structuration, urbanisme, états des lieux, Drive,
--                    sourcing.
--
-- PÉRIMÈTRE : INVEST ONLY. Sept tables.
--
-- ⚠ CE FICHIER REMPLACE DEUX POLICIES EXISTANTES NOMMÉES « bureau_all »,
--   sur invest_urbanisme_dossiers et invest_etats_des_lieux. Elles ont été
--   créées par des migrations INVEST versionnées
--   (sql/202608_invest_urbanisme.sql, sql/202608_invest_etats_des_lieux.sql) :
--   les remplacer ne touche donc pas Profero Rénovation.
--
--   La fonction public.est_ouvrier() qu'elles appellent n'est NI modifiée, NI
--   supprimée : elle reste utilisée par la RLS de l'espace ouvrier Rénovation
--   et par les tables ouvrier_*. On cesse simplement de s'en servir côté
--   Invest, où elle ne suffisait pas — « n'est pas un ouvrier » laissait
--   passer un agent_edl, un commercial et un utilisateur Rénovation seul.
--
-- ÉTAT PRÉCÉDENT (mesuré le 04/09/2026, clé anon, sans session)
--   invest_structuration_patrimoniale : 7 lignes LISIBLES en anon, INSERT et
--       UPDATE autorisés (23505). Porte `donnees` et `analyse_data` : profils
--       patrimoniaux nominatifs.
--   invest_drive_links                : 13 lignes LISIBLES en anon, INSERT et
--       UPDATE autorisés (23505). Porte les noms et URL des documents Drive.
--   invest_urbanisme_dossiers         : policy « bureau_all » — anon
--       correctement refusé, mais aucune distinction de rôle ni de branche.
--   invest_etats_des_lieux            : idem.
--   sourcing_annonces / _criteres / _logs : tables vides, état RLS non
--       observable depuis l'extérieur ; traitées par précaution.
--
-- CHANGEMENT
--   RLS activée partout, policies adossées à la page correspondante.
--
--   invest_drive_links reçoit un traitement à part : la table mélange les
--   dossiers du CRM, des biens et de l'urbanisme dans une seule colonne texte
--   `folder` (« clients/<id> », « clients/<id>/mission/<id> »), sans
--   contrainte en base sur cette convention. Un filtrage par préfixe serait
--   plus fin mais reposerait sur une convention que rien ne garantit : on s'en
--   tient au portillon de branche, et on affinera quand sql/schema_invest.sql
--   documentera la table.
--
-- IMPACT
--   admin, super_admin : accès complet aux sept tables (super_admin après le
--     fichier 00, qui lui rend sourcing, urbanisme et états des lieux).
--   commercial : conserve la structuration et les liens Drive. Perd
--     l'urbanisme, les états des lieux et le sourcing — conforme à sa matrice.
--   agent_edl : CONSERVE les états des lieux (sa seule page) et les liens
--     Drive. Perd la structuration, l'urbanisme et le sourcing.
--   utilisateur Rénovation seul : perd tout.
--   anon : plus aucun accès.
--
-- ORDRE D'APPLICATION : après 01. Indépendant de 02a, 03, 04, 05.
-- ============================================================================

BEGIN;

DO $$
DECLARE t text; p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'invest_structuration_patrimoniale',
    'invest_urbanisme_dossiers',
    'invest_etats_des_lieux',
    'invest_drive_links',
    'sourcing_annonces',
    'sourcing_criteres',
    'sourcing_logs'
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

-- ── Structuration patrimoniale ──────────────────────────────────────────────
CREATE POLICY "invest_structuration_membres"
  ON public.invest_structuration_patrimoniale
  FOR ALL TO authenticated
  USING      ((SELECT public.invest_peut_voir('structuration')))
  WITH CHECK ((SELECT public.invest_peut_voir('structuration')));

-- ── Urbanisme — remplace « bureau_all » ─────────────────────────────────────
CREATE POLICY "invest_urbanisme_membres"
  ON public.invest_urbanisme_dossiers
  FOR ALL TO authenticated
  USING      ((SELECT public.invest_peut_voir('urbanisme')))
  WITH CHECK ((SELECT public.invest_peut_voir('urbanisme')));

-- ── États des lieux — remplace « bureau_all » ───────────────────────────────
-- C'est la seule page d'agent_edl : cette policy est celle qui lui conserve
-- son métier.
CREATE POLICY "invest_edl_membres"
  ON public.invest_etats_des_lieux
  FOR ALL TO authenticated
  USING      ((SELECT public.invest_peut_voir('etat_des_lieux')))
  WITH CHECK ((SELECT public.invest_peut_voir('etat_des_lieux')));

-- ── Liens Google Drive — portillon de branche ───────────────────────────────
CREATE POLICY "invest_drive_links_membres"
  ON public.invest_drive_links
  FOR ALL TO authenticated
  USING      ((SELECT public.invest_est_membre()))
  WITH CHECK ((SELECT public.invest_est_membre()));

-- ── Sourcing — trois tables, même règle ─────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sourcing_annonces', 'sourcing_criteres', 'sourcing_logs']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format(
      'CREATE POLICY %I ON public.%I '
      'FOR ALL TO authenticated '
      'USING ((SELECT public.invest_peut_voir(''sourcing''))) '
      'WITH CHECK ((SELECT public.invest_peut_voir(''sourcing'')))',
      t || '_membres', t
    );
  END LOOP;
END $$;

COMMIT;

-- ── CONTRÔLE ────────────────────────────────────────────────────────────────
-- Avec un agent_edl :
--   SELECT count(*) FROM public.invest_etats_des_lieux;              -- accessible
--   SELECT count(*) FROM public.invest_structuration_patrimoniale;   -- 0 ligne
--
-- Avec un super_admin, après le fichier 00 :
--   SELECT public.invest_peut_voir('urbanisme'),
--          public.invest_peut_voir('sourcing'),
--          public.invest_peut_voir('etat_des_lieux');   -- t, t, t
--
-- ── NON TRAITÉ ICI, VOLONTAIREMENT ──────────────────────────────────────────
-- Les policies du bucket Storage « invest-documents » ouvrent encore la
-- lecture à TOUT compte authenticated, sans distinction de rôle ni de branche
-- (sql/202608_invest_etats_des_lieux.sql). Les resserrer sur
-- invest_est_membre() est un chantier distinct, à faire après avoir vérifié
-- que les URL signées de l'EDL et de l'Urbanisme continuent de fonctionner.
--
-- Le bucket « photos » de Profero Rénovation laisse lister ses dossiers en
-- anon. RENOVATION — NO TOUCH : signalé, non traité.
--
-- ── RETOUR ARRIÈRE ──────────────────────────────────────────────────────────
-- Voir sql/202609_invest_securite_99_rollback.sql
