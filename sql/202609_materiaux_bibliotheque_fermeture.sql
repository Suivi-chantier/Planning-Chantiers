-- =====================================================================
-- materiaux_bibliotheque — FERMETURE : bureau uniquement
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller).
-- Idempotent : drop policy if exists + create policy, dans une transaction.
--
-- ⚠ TEMPS 2 SUR 2 — NE PAS APPLIQUER AVANT LE DÉPLOIEMENT DU FRONTEND.
-- Prérequis, dans cet ordre :
--   1. sql/202609_catalogue_materiaux_demande.sql appliqué (la RPC existe) ;
--   2. le frontend qui appelle catalogue_materiaux_demande() est EN LIGNE.
-- Appliquer ce fichier avant (2) mettrait en panne l'onglet « Commande » de
-- l'espace ouvrier ET le tiroir « besoin de commande » du formulaire public
-- /rapport : les deux liraient une table devenue vide pour eux.
--
-- CE QUE CE FICHIER CORRIGE
-- -------------------------
-- Deux policies créées à la main dans la console, absentes du dépôt :
--
--   anon_read_materiaux_bibliotheque   for select to anon using (true)
--       → les 565 lignes COMPLÈTES lisibles sans aucune authentification,
--         prix_unitaire et fournisseur compris. Vérifié : 565 lignes en anon.
--
--   materiaux_bibliotheque_all         for all to public
--                                      using (auth.role() = 'authenticated')
--       → ALL, donc INSERT / UPDATE / DELETE, pour TOUT compte authentifié,
--         ouvriers compris. Vérifié par test (transaction annulée) : un
--         ouvrier actif a pu exécuter un UPDATE sur la bibliothèque.
--         Ce n'était pas une policy « bureau » : c'était une policy
--         « n'importe qui de connecté ».
--
-- LA RÈGLE À TENIR
-- ----------------
-- ⚠ NE JAMAIS ROUVRIR CETTE TABLE EN DIRECT À `anon` NI AUX OUVRIERS.
--   La RLS filtre des LIGNES, jamais des COLONNES : toute policy de lecture
--   sur cette table expose prix_unitaire, fournisseur, lien_fournisseur,
--   stock_min et notes. Il n'existe pas de version « allégée » d'une policy.
--   Le terrain et le public passent par public.catalogue_materiaux_demande(),
--   qui est SECURITY DEFINER et dont la liste de colonnes est écrite en dur.
--   Si un écran ouvrier manque d'un champ, on AJOUTE la colonne à la RPC —
--   on ne rouvre pas la table.
--
-- PÉRIMÈTRE
-- ---------
-- - Ne modifie AUCUNE ligne, AUCUN prix, AUCUN fournisseur.
-- - Ne touche à AUCUNE autre table ni policy.
-- - Ne change AUCUN grant : les grants de table restent ceux par défaut de
--   Supabase ; c'est la RLS qui décide, comme partout ailleurs dans ce projet.
-- - Ne touche pas aux helpers de rôle.
-- - La RPC du temps 1 n'est pas modifiée : SECURITY DEFINER, elle traverse
--   la RLS et continue de répondre à anon comme aux ouvriers.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Suppression des deux policies permissives créées en console
-- ---------------------------------------------------------------------
drop policy if exists "anon_read_materiaux_bibliotheque" on public.materiaux_bibliotheque;
drop policy if exists "materiaux_bibliotheque_all"       on public.materiaux_bibliotheque;

-- ---------------------------------------------------------------------
-- 2) Policy BUREAU explicite — le seul accès direct restant
-- ---------------------------------------------------------------------
-- Le prédicat est écrit en deux morceaux volontairement redondants :
--   mon_role() is not null  → il existe un profil applicatif ACTIF
--                             (mon_role() renvoie NULL pour un profil absent
--                              ou dont utilisateurs.actif est false) ;
--   not est_ouvrier()       → ce profil n'est pas un compte de terrain.
-- est_ouvrier() étant ternaire depuis le 17/09/2026, « not est_ouvrier() »
-- suffirait seul à refuser un profil absent ou inactif (NULL → refusé).
-- La première condition est conservée pour que l'intention reste lisible
-- sans avoir à connaître la logique ternaire, et pour que la policy reste
-- correcte même si est_ouvrier() changeait un jour de comportement.
--
-- CRUD complet conservé pour le bureau : PageBibliothequeMateriaux crée,
-- modifie et supprime des matériaux, Bibliotheque et PhasageV2 les lisent.
create policy "materiaux_bibliotheque_bureau" on public.materiaux_bibliotheque
  for all to authenticated
  using      (public.mon_role() is not null and not public.est_ouvrier())
  with check (public.mon_role() is not null and not public.est_ouvrier());

-- Aucune policy pour anon. Aucune policy pour les ouvriers. C'est voulu :
-- leur unique chemin est la RPC catalogue_materiaux_demande().

commit;

-- =====================================================================
-- VÉRIFICATION (lecture seule, transaction annulée)
-- =====================================================================
-- Attendu sur la TABLE en direct :
--   anon            → 0 ligne
--   ouvrier actif   → 0 ligne, écriture refusée
--   profil absent   → 0 ligne
--   profil inactif  → 0 ligne
--   bureau actif    → toutes les lignes, CRUD conservé
--
-- Attendu sur la RPC (inchangée) : le même catalogue de 6 colonnes pour
-- tous les profils, anon compris.
--
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"role":"authenticated","email":"<email>"}';
--   select count(*) from public.materiaux_bibliotheque;              -- table
--   select count(*) from public.catalogue_materiaux_demande();       -- RPC
-- rollback;
-- =====================================================================
