-- ============================================================================
-- CHANTIER 1C · 05 — invest_suivi_financier.
--
-- PÉRIMÈTRE : INVEST ONLY. Une table, une ligne, une policy.
--
-- ── L'ÉTAT PRÉCÉDENT LE PLUS GRAVE DU CHANTIER ──────────────────────────────
--
--   La table ne contient qu'UNE ligne, id = 'global' (colonne de type TEXT,
--   pas uuid), dont le champ `data` jsonb porte L'INTÉGRALITÉ du suivi
--   financier Profero Invest : chiffre d'affaires, forfait fixe HT par client,
--   commission sur gain de négociation, TVA collectée, TVA déductible, TVA
--   nette, impôt sur les sociétés, trésorerie, mois validés.
--
--   Mesuré le 04/09/2026 avec la seule clé anon publique, sans session :
--     • SELECT : la ligne sort en entier, tout le contenu ;
--     • INSERT : autorisé — code 23505, échec par unicité de clé seulement,
--                donc la RLS avait laissé passer l'écriture.
--
--   Autrement dit : la totalité du suivi financier était lisible, et
--   modifiable, par n'importe qui disposant de la clé publique du bundle
--   JavaScript. C'est la raison pour laquelle ce fichier est prioritaire et
--   isolé : une table, une policy, une relecture de trente secondes.
--
-- CHANGEMENT
--   RLS activée, une policy unique adossée à la page « suivi_financier ».
--
-- OBJECTIF — RÈGLE MÉTIER EXISTANTE, NON INVENTÉE
--   planning_config.access_pages_invest accorde « suivi_financier » à `admin`
--   et `super_admin` (ce dernier après le fichier 00), et le refuse à
--   `commercial` et `agent_edl`. La policy est la traduction littérale de
--   canAccess(rolePages, role, 'suivi_financier') telle qu'elle est déjà
--   appliquée par l'interface.
--
-- IMPACT
--   admin, super_admin : inchangé — lecture ET enregistrement conservés.
--   commercial : plus d'accès en base. Il n'avait déjà pas l'onglet.
--   agent_edl : plus d'accès.
--   utilisateur Rénovation seul : plus d'accès.
--   anon : plus aucun accès.
--
-- ── CE QUE CETTE POLICY NE PROTÈGE PAS, ET C'EST ASSUMÉ ─────────────────────
--   Les honoraires par client se recalculent depuis invest_clients et les
--   constantes HONORAIRE_BASE_CONTRAT_HT / HONORAIRE_CONSEIL_MOYEN_HT du code.
--   Fermer cette table protège l'AGRÉGAT (CA, TVA, trésorerie, objectifs),
--   pas le calcul unitaire. Un commercial conserve invest_clients, ce qui est
--   conforme à son accès CRM. Le resserrer davantage demanderait de retirer
--   des colonnes à invest_clients, ce qui casserait le CRM.
--
-- ORDRE D'APPLICATION : après 01. Indépendant de 02a, 03, 04, 06.
--   Recommandé en PREMIER des fichiers de policies : gain maximal, risque
--   minimal, régression immédiatement visible si elle survient.
-- ============================================================================

BEGIN;

DO $$
DECLARE p record;
BEGIN
  IF to_regclass('public.invest_suivi_financier') IS NULL THEN
    RAISE NOTICE 'invest_suivi_financier absente : rien à faire.';
    RETURN;
  END IF;

  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE  schemaname = 'public' AND tablename = 'invest_suivi_financier'
  LOOP
    RAISE NOTICE 'suppression de la policy % sur invest_suivi_financier', p.policyname;
    EXECUTE format('DROP POLICY %I ON public.invest_suivi_financier', p.policyname);
  END LOOP;

  EXECUTE 'ALTER TABLE public.invest_suivi_financier ENABLE ROW LEVEL SECURITY';
END $$;

CREATE POLICY "invest_suivi_financier_pilotes"
  ON public.invest_suivi_financier
  FOR ALL TO authenticated
  USING      ((SELECT public.invest_peut_voir('suivi_financier')))
  WITH CHECK ((SELECT public.invest_peut_voir('suivi_financier')));

COMMIT;

-- ── CONTRÔLE ────────────────────────────────────────────────────────────────
-- Avec un admin :   SELECT id, updated_at FROM public.invest_suivi_financier;
--                   → doit renvoyer la ligne 'global'
-- Avec un commercial : la même requête doit renvoyer 0 ligne.
-- En anon (script)   : node scripts/verif-rls-invest.mjs
--
-- Puis, dans l'application, avec un admin : ouvrir le Suivi financier,
-- modifier une valeur, enregistrer, recharger. L'upsert de la ligne 'global'
-- doit passer — c'est le WITH CHECK qui est éprouvé là.
--
-- ── RETOUR ARRIÈRE ──────────────────────────────────────────────────────────
-- Voir sql/202609_invest_securite_99_rollback.sql
