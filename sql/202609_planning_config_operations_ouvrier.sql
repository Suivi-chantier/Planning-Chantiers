-- =====================================================================
-- planning_config — ajouter la clé « operations » à la liste blanche OUVRIER
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller).
-- Idempotent : drop policy if exists + create policy, dans une transaction.
--
-- POURQUOI
-- --------
-- L'onglet « Opérations » de l'espace ouvrier (OuvrierChantiers.jsx) affiche
-- désormais les opérations avant les chantiers. Il lit pour cela la clé
-- planning_config/operations, de forme { items: [{ id, nom, adresse,
-- couleur }] } — un simple référentiel de libellés : un nom, une adresse
-- postale et une couleur d'affichage. Aucun montant, aucune marge, aucun
-- taux : rien qui justifie de la garder hors de portée du terrain.
--
-- Sans cette clé, l'écran fonctionne quand même — tous les chantiers
-- basculent en « Chantiers hors opération » — mais la hiérarchie
-- Opération → Chantier reste invisible.
--
-- PÉRIMÈTRE
-- ---------
-- - SEULE la policy ouvrière est recréée, et elle passe de 6 à exactement
--   7 clés. Aucune autre clé n'est exposée.
-- - config_anon_sel n'est PAS touchée : le formulaire public garde ses 4
--   clés (chantiers, ouvriers, heures_par_jour, espace_ouvrier_actif) et
--   ne voit toujours pas les opérations.
-- - config_bureau_all n'est PAS touchée : le bureau garde son accès
--   complet, lecture et écriture.
-- - AUCUN droit d'écriture ajouté : la policy est en SELECT seul, les
--   ouvriers n'écrivent jamais dans planning_config.
-- - AUCUNE donnée modifiée.
-- - Réutilise le helper existant public.est_ouvrier(), corrigé le
--   17/09/2026 (ternaire : NULL pour un profil absent ou inactif, donc
--   refusé). Ce correctif n'est pas touché ici.
--
-- Ce fichier prend la suite de sql/202609_planning_config_liste_blanche.sql,
-- qui reste la référence pour la justification clé par clé et pour la
-- policy anon.
-- =====================================================================

begin;

-- Liste blanche OUVRIER — 7 clés, et leur consommateur :
--   chantiers            → tous les écrans ouvriers (nom, couleur, statut)
--   chantier_adresses    → NavButtons (itinéraire Maps/Waze)
--   ouvriers             → RapportMobile (prénoms du planning)
--   heures_par_jour      → RapportMobile (compteur de journée)
--   espace_ouvrier_actif → RapportMobile (bandeau du formulaire public)
--   equipes              → OuvrierPlanning (filtres et vue chef d'équipe)
--   operations           → OuvrierChantiers, niveau 1 et 2  ← AJOUT
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
      'equipes',
      'operations'
    ])
  );

commit;

-- =====================================================================
-- VÉRIFICATION (lecture seule, transaction annulée)
-- =====================================================================
-- Attendu : ouvrier actif = 7 clés dont operations ; anon = 4 clés ;
-- bureau actif = toutes ; profil absent ou inactif = 0.
--
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"role":"authenticated","email":"<email>"}';
--   select count(*), string_agg(key, ', ' order by key) from planning_config;
-- rollback;
-- =====================================================================
