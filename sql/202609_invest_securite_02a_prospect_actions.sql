-- ============================================================================
-- CHANTIER 1C · 02a — invest_prospect_actions.
--
-- PÉRIMÈTRE : INVEST ONLY. Une seule table.
--
-- ⚠ CE FICHIER NE TOUCHE PAS `invest_prospects`.
--   C'est l'objet même de son existence. L'ancienne migration 02 traitait les
--   deux tables ensemble ; elle a été scindée parce que invest_prospects est
--   en NO-GO tant que l'API Fluidify externe n'est pas identifiée, alors que
--   invest_prospect_actions ne présente aucun risque. Voir le rapport, § N.
--
-- ÉTAT PRÉCÉDENT (mesuré le 04/09/2026, clé anon publique, sans session)
--   414 lignes lisibles sans aucune authentification.
--   INSERT autorisé  (prouvé : code 23505 sur clé primaire dupliquée)
--   UPDATE autorisé  (prouvé : code 23505 sur collision de clé primaire)
--   La table porte les comptes rendus d'appels : `resume`, `resultat`,
--   `prochaine_action`, `type_action`, `donnees`.
--
-- POURQUOI CETTE TABLE EST SÛRE À REFERMER
--   Les 415 lignes portent TOUTES un auteur identifié — trois comptes
--   @groupe-profero.com. AUCUNE n'a created_by = null, là où l'ingestion
--   Fluidify en produit systématiquement (83 lignes sur 83 dans
--   invest_prospects). L'ingestion n'écrit donc pas ici, et refermer cette
--   table ne peut rien casser côté acquisition.
--
-- CHANGEMENT
--   Suppression de toutes les policies en place, RLS activée, une policy
--   adossée à la page « prospection ».
--
--   Le nom des policies existantes est INCONNU : cette table n'a jamais eu de
--   migration versionnée (17 des 19 tables Invest ont été créées à la console,
--   cf. sql/README-schema.md). D'où la boucle de suppression : un
--   DROP POLICY IF EXISTS "nom" ne pourrait pas viser une policy dont
--   personne ne connaît le nom. La liste des tables est écrite en dur et ne
--   contient que cette table Invest.
--
-- OBJECTIF
--   Que la base impose ce que l'interface affiche déjà.
--
-- IMPACT
--   admin, super_admin, commercial : inchangé — les trois ont « prospection »
--     (super_admin après le fichier 00).
--   agent_edl : perd l'accès. Conforme à sa matrice : États des lieux seuls.
--   utilisateur Rénovation seul : perd l'accès. Aucune policy ne regardait la
--     branche jusqu'ici.
--   anon : plus aucun accès, ni lecture ni écriture.
--
-- ORDRE D'APPLICATION : après 01.
-- ============================================================================

BEGIN;

DO $$
DECLARE p record;
BEGIN
  IF to_regclass('public.invest_prospect_actions') IS NULL THEN
    RAISE NOTICE 'invest_prospect_actions absente : rien à faire.';
    RETURN;
  END IF;

  -- On ignore le nom des policies en place : on les retire toutes.
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE  schemaname = 'public' AND tablename = 'invest_prospect_actions'
  LOOP
    RAISE NOTICE 'suppression de la policy % sur invest_prospect_actions', p.policyname;
    EXECUTE format('DROP POLICY %I ON public.invest_prospect_actions', p.policyname);
  END LOOP;

  EXECUTE 'ALTER TABLE public.invest_prospect_actions ENABLE ROW LEVEL SECURITY';
END $$;

-- Forme « (SELECT …) » : Postgres traite l'appel en InitPlan et l'évalue UNE
-- FOIS par requête, non une fois par ligne. Sans cela, la fonction serait
-- appelée 414 fois pour lister l'historique d'un prospect.
CREATE POLICY "invest_prospect_actions_membres"
  ON public.invest_prospect_actions
  FOR ALL TO authenticated
  USING      ((SELECT public.invest_peut_voir('prospection')))
  WITH CHECK ((SELECT public.invest_peut_voir('prospection')));

COMMIT;

-- ── CONTRÔLE ────────────────────────────────────────────────────────────────
-- RLS active et une seule policy, ciblant authenticated :
--
--   SELECT c.relrowsecurity AS rls_active
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname = 'invest_prospect_actions';
--
--   SELECT policyname, roles, cmd, qual, with_check FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'invest_prospect_actions';
--
-- Puis le contre-test anonyme : node scripts/verif-rls-invest.mjs
--
-- ── RETOUR ARRIÈRE ──────────────────────────────────────────────────────────
-- Voir sql/202609_invest_securite_99_rollback.sql
