-- ============================================================================
-- CHANTIER 1C · 01 — Helpers de sécurité propres à Profero Invest.
--
-- PÉRIMÈTRE : INVEST ONLY.
--   Trois fonctions NOUVELLES, toutes préfixées `invest_`.
--   `public.mon_role()` et `public.est_ouvrier()` ne sont NI modifiées, NI
--   remplacées, NI supprimées : elles sont définies par une migration
--   Rénovation (sql/202607_espace_ouvrier_phase0.sql) et servent à la RLS de
--   l'espace ouvrier ainsi qu'à celle de ia_jobs. Y toucher modifierait
--   Profero Rénovation.
--
-- ÉTAT PRÉCÉDENT
--   L'autorisation Invest n'existait que dans React : src/access.js +
--   planning_config.access_pages_invest, appliqués par canAccess(). En base,
--   les deux seules policies Invest disaient
--       FOR ALL TO authenticated USING (NOT public.est_ouvrier())
--   soit « tout utilisateur connecté qui n'est pas ouvrier, sur tout ».
--   Aucune notion de rôle Invest, aucune notion de branche. Conséquences
--   mesurées : un commercial lisait le suivi financier, un agent_edl lisait
--   tout le CRM, et un utilisateur Rénovation seul lisait tout Invest.
--
-- CHANGEMENT
--   invest_est_membre()        → compte actif ayant la branche « invest »
--   invest_role_courant()      → son rôle Invest, ou NULL
--   invest_peut_voir(page)     → rejoue canAccess() côté base
--
-- OBJECTIF
--   Donner à Invest ses propres règles d'autorisation, sans dépendre du
--   comportement de Rénovation, et sans dupliquer la matrice : la source
--   d'autorité reste planning_config.access_pages_invest, celle que l'écran
--   Admin → Accès édite déjà.
--
-- IMPACT
--   AUCUN tant qu'aucune policy ne les appelle. Ce fichier est applicable
--   seul, et sans effet observable — c'est voulu : il se vérifie à froid.
--
-- ORDRE D'APPLICATION : après 00, avant 02a.
-- ============================================================================

BEGIN;

-- ── invest_est_membre() ─────────────────────────────────────────────────────
--
-- LE TYPE DE `utilisateurs.branches` EST TOUJOURS INCONNU, et ce n'est pas une
-- hypothèse silencieuse : la table est protégée par la RLS, aucun dump de
-- schéma n'a pu être produit (aucun accès privilégié disponible), et
-- normalizeBranches() dans src/constants.js accepte lui-même TROIS formes —
-- un tableau JS, une chaîne JSON « ["invest"] », et une chaîne littérale
-- Postgres « {renovation,invest} ». Le front ne sait donc pas non plus.
--
-- La comparaison porte sur la représentation textuelle, ce qui compile et
-- fonctionne pour text[], jsonb ET text. Elle n'est pas grossière pour
-- autant : la chaîne est découpée sur tout ce qui n'est pas alphanumérique,
-- puis on cherche le jeton EXACT « invest ». « {renovation,invest} » devient
-- « |renovation|invest| » et correspond ; un hypothétique « investissement »
-- ne correspondrait pas.
--
-- À RESSERRER quand sql/schema_invest.sql existera :
--   • si text[]  →  u.branches @> ARRAY['invest']::text[]
--   • si jsonb   →  u.branches ? 'invest'
-- La requête de contrôle en fin de fichier donne le type réel.
CREATE OR REPLACE FUNCTION public.invest_est_membre()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.utilisateurs u
    WHERE  u.email = auth.email()
      AND  COALESCE(u.actif, false) = true
      AND  ('|' || regexp_replace(u.branches::text, '[^a-zA-Z0-9_]+', '|', 'g') || '|')
           LIKE '%|invest|%'
  );
$$;

COMMENT ON FUNCTION public.invest_est_membre() IS
  'Profero Invest — vrai si l''appelant est un compte actif ayant accès à la '
  'branche Invest. Portillon de toutes les policies invest_*. Ne remplace pas '
  'est_ouvrier(), qui appartient à Profero Rénovation.';

-- ── invest_role_courant() ───────────────────────────────────────────────────
--
-- Volontairement DISTINCTE de mon_role(), qui ignore la branche. Le champ
-- `utilisateurs.role` est UNIQUE et partagé par les deux branches, et
-- « commercial » existe des deux côtés avec des droits différents : un
-- commercial Rénovation ne doit pas hériter des droits d'un commercial Invest.
-- Renvoyer NULL hors branche est ce qui garantit cette cloison.
CREATE OR REPLACE FUNCTION public.invest_role_courant()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.role
  FROM   public.utilisateurs u
  WHERE  u.email = auth.email()
    AND  COALESCE(u.actif, false) = true
    AND  ('|' || regexp_replace(u.branches::text, '[^a-zA-Z0-9_]+', '|', 'g') || '|')
         LIKE '%|invest|%'
  LIMIT  1;
$$;

COMMENT ON FUNCTION public.invest_role_courant() IS
  'Profero Invest — rôle Invest de l''appelant, NULL s''il n''a pas la branche. '
  'Distincte de mon_role() : le rôle seul ne suffit pas, « commercial » existe '
  'dans les deux branches avec des droits différents.';

-- ── invest_peut_voir(page) ──────────────────────────────────────────────────
--
-- Rejoue canAccess() (src/access.js) dans le MÊME ordre de résolution :
--   1. correspondance exacte de la clé de rôle dans access_pages_invest
--   2. correspondance normalisée (minuscules, espaces → souligné), ce qui
--      couvre les variantes historiques « Admin », « Super Admin »…
--   3. repli : matrice absente → seuls admin et super_admin passent.
--
-- Le repli n'est pas décoratif : sans lui, une clé de configuration effacée
-- ou mal formée verrouillerait TOUT LE MONDE, administrateur compris, et il
-- n'y aurait plus aucun moyen de réparer depuis l'application.
CREATE OR REPLACE FUNCTION public.invest_peut_voir(page text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH r   AS (SELECT public.invest_role_courant() AS role),
       cfg AS (SELECT value FROM public.planning_config
               WHERE key = 'access_pages_invest' LIMIT 1),
       n   AS (SELECT lower(replace(COALESCE((SELECT role FROM r), ''), ' ', '_')) AS role_norm)
  SELECT CASE
    -- Pas membre de la branche Invest : rien, quelle que soit la page.
    WHEN (SELECT role FROM r) IS NULL THEN false
    -- Matrice absente : repli de sécurité.
    WHEN (SELECT value FROM cfg) IS NULL
      THEN (SELECT role FROM r) IN ('admin', 'super_admin')
    -- 1) clé exacte
    WHEN (SELECT value FROM cfg) ? (SELECT role FROM r)
      THEN (SELECT value FROM cfg) -> (SELECT role FROM r) ? page
    -- 2) clé normalisée (variantes historiques)
    WHEN (SELECT value FROM cfg) ? (SELECT role_norm FROM n)
      THEN (SELECT value FROM cfg) -> (SELECT role_norm FROM n) ? page
    -- 3) rôle inconnu de la matrice : repli de sécurité
    ELSE (SELECT role FROM r) IN ('admin', 'super_admin')
  END;
$$;

COMMENT ON FUNCTION public.invest_peut_voir(text) IS
  'Profero Invest — rejoue canAccess() côté base à partir de '
  'planning_config.access_pages_invest. Repli sur admin/super_admin si la '
  'matrice est absente, pour qu''une configuration cassée ne verrouille pas '
  'l''administrateur.';

-- ── Droits d'exécution ──────────────────────────────────────────────────────
-- Exécutables par les sessions authentifiées : la RLS les appelle en leur nom.
-- Jamais par anon — un visiteur n'a aucune raison d'interroger la matrice, et
-- invest_role_courant() ne doit pas devenir un oracle d'existence de comptes.
REVOKE EXECUTE ON FUNCTION public.invest_est_membre()    FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.invest_role_courant()  FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.invest_peut_voir(text) FROM public, anon;

GRANT  EXECUTE ON FUNCTION public.invest_est_membre()    TO authenticated;
GRANT  EXECUTE ON FUNCTION public.invest_role_courant()  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.invest_peut_voir(text) TO authenticated;

COMMIT;

-- ── CONTRÔLES À PASSER AVANT D'ALLER PLUS LOIN ──────────────────────────────
--
-- 1) Type réel de `branches`, pour resserrer les deux fonctions plus tard :
--
--    SELECT column_name, data_type, udt_name
--    FROM   information_schema.columns
--    WHERE  table_schema = 'public' AND table_name = 'utilisateurs'
--      AND  column_name IN ('branches', 'role', 'actif');
--
-- 2) Inventaire des rôles et branches réellement portés par les comptes :
--
--    SELECT role, branches, COUNT(*) FROM public.utilisateurs
--    WHERE actif GROUP BY 1, 2 ORDER BY 1;
--
-- 3) Avec une session de CHAQUE rôle (admin, super_admin, commercial,
--    agent_edl, et un compte Rénovation seul) :
--
--    SELECT public.invest_est_membre()               AS membre,
--           public.invest_role_courant()             AS role,
--           public.invest_peut_voir('crm')           AS crm,
--           public.invest_peut_voir('suivi_financier') AS finance,
--           public.invest_peut_voir('etat_des_lieux')  AS edl;
--
--    Attendu :
--      admin           → t, admin,       t, t, t
--      super_admin     → t, super_admin, t, t, t   (après le fichier 00)
--      commercial      → t, commercial,  t, F, F
--      agent_edl       → t, agent_edl,   f, f, T
--      Rénovation seul → f, NULL,        f, f, f
--
--    ⚠ Si `membre` vaut faux pour un compte Invest, c'est le type de
--    `branches` : NE PAS appliquer les fichiers suivants, corriger d'abord.
