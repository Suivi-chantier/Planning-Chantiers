-- =====================================================================
-- planning_config — LISTE BLANCHE DE CLÉS pour anon et ouvrier
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller).
-- Idempotent : ré-exécutable sans rien casser.
--
-- POURQUOI CETTE LISTE BLANCHE EXISTE
-- -----------------------------------
-- planning_config est une table clé/valeur FOURRE-TOUT : elle mélange des
-- réglages d'affichage anodins (chantiers, adresses, équipes) et des données
-- strictement bureau (taux_horaires = salaires, etats_financiers,
-- situations_seuils, dashboard_finance_*, societe, access_* …).
-- Une policy qui raisonne uniquement sur le RÔLE — « l'ouvrier peut lire
-- planning_config » — donne donc accès aux salaires et aux états financiers.
-- La seule granularité correcte sur cette table est la CLÉ, pas la table.
--
-- Règle : anon et ouvrier ne lisent QUE les clés listées ici ; tout le reste
-- est refusé par défaut. Ajouter une clé à cette liste est une décision de
-- sécurité — elle doit correspondre à un usage ouvrier RÉEL et ne contenir
-- ni montant, ni salaire, ni donnée financière.
--
-- CE QUE CE FICHIER CORRIGE
-- -------------------------
-- La production porte déjà ces deux listes blanches (appliquées à la main
-- dans la console). Le DÉPÔT, lui, décrivait encore l'état d'origine de
-- sql/202607_espace_ouvrier_phase0.sql (§0C-3) :
--     create policy "config_ouvrier_sel" … using (est_ouvrier());     -- TOUTES les clés
--     create policy "config_anon_sel"    … using (true);              -- TOUTES les clés
-- Autrement dit, ré-exécuter le playbook phase0 (il est fait pour être
-- rejoué) ROUVRIRAIT la fuite en silence. Ce fichier devient la source de
-- vérité de ces deux policies et referme cette régression possible.
--
-- PÉRIMÈTRE
-- ---------
-- - Ne touche PAS la policy "config_bureau_all" : le bureau conserve son
--   accès complet, en lecture comme en écriture.
-- - Ne change AUCUN droit d'écriture : les deux policies recréées sont des
--   policies SELECT uniquement. anon et ouvrier n'écrivent jamais dans
--   planning_config, ni avant ni après.
-- - Ne modifie AUCUNE donnée.
-- - Réutilise le helper de rôle existant public.est_ouvrier()
--   (sql/202607_espace_ouvrier_phase0.sql §0A) — aucun second système
--   d'autorisation n'est introduit.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) OUVRIER (authenticated, role = 'ouvrier')
-- ---------------------------------------------------------------------
-- Clés autorisées, et le consommateur qui les justifie :
--   chantiers           → OuvrierChantiers / OuvrierDashboard / OuvrierPlanning /
--                         OuvrierCommande / RapportMobile : nom et couleur du
--                         chantier. Contient id, nom, couleur, statut,
--                         operation_id — aucun montant.
--   chantier_adresses   → NavButtons (ouvrierNav.jsx) : itinéraire Maps/Waze
--                         vers le chantier du jour. Adresses de chantiers où
--                         l'ouvrier se rend déjà.
--   ouvriers            → RapportMobile : liste des prénoms du planning.
--                         Des prénoms, rien d'autre — surtout PAS taux_horaires.
--   heures_par_jour     → RapportMobile : heures attendues par jour de semaine,
--                         pour le compteur de journée. Des durées, pas des euros.
--   espace_ouvrier_actif→ RapportMobile : booléen d'affichage du bandeau
--                         « connectez-vous » du formulaire public.
--   equipes             → OuvrierPlanning (loadEquipes) : puces de filtre par
--                         équipe et vue du chef d'équipe. Noms d'équipes et
--                         prénoms de collègues — aucune donnée de paie.
--
-- Volontairement ABSENTE : 'operations'. Aucun écran ouvrier ne la lit
-- aujourd'hui. À ajouter ici — et seulement ici — le jour où un écran
-- « Mes opérations » existera.
drop policy if exists "config_ouvrier_sel" on public.planning_config;
create policy "config_ouvrier_sel" on public.planning_config
  for select to authenticated
  using (
    public.est_ouvrier()
    and key = any (array[
      'chantiers',
      'chantier_adresses',
      'ouvriers',
      'heures_par_jour',
      'espace_ouvrier_actif',
      'equipes'
    ])
  );

-- ---------------------------------------------------------------------
-- 2) ANON (formulaire public /rapport, non authentifié)
-- ---------------------------------------------------------------------
-- La clé anon Supabase est embarquée dans le bundle front : elle est publique
-- de fait. Sans cette seconde liste blanche, n'importe qui — un ouvrier y
-- compris — contournerait la restriction ci-dessus en interrogeant la table
-- en anon. Les deux policies doivent donc être restreintes ensemble.
--
-- Périmètre réel du formulaire public (RapportMobile.jsx, monté avant toute
-- authentification sur /rapport) : chantiers, ouvriers, heures_par_jour,
-- espace_ouvrier_actif. Pas d'adresses ni d'équipes : le formulaire public
-- ne propose ni itinéraire ni filtre d'équipe.
drop policy if exists "config_anon_sel" on public.planning_config;
create policy "config_anon_sel" on public.planning_config
  for select to anon
  using (
    key = any (array[
      'chantiers',
      'ouvriers',
      'heures_par_jour',
      'espace_ouvrier_actif'
    ])
  );

commit;

-- =====================================================================
-- VÉRIFICATION (à passer après application — lecture seule, annulée)
-- =====================================================================
-- Attendu : ouvrier = 6 clés, anon = 4 clés, bureau = toutes les clés.
--
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"role":"authenticated","email":"<email-ouvrier>"}';
--   select string_agg(key, ', ' order by key) from planning_config;
-- rollback;
--
-- begin;
--   set local role anon;
--   select string_agg(key, ', ' order by key) from planning_config;
-- rollback;
-- =====================================================================
