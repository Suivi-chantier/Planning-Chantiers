-- =====================================================================
-- SÉCURITÉ — mon_role() / est_ouvrier() : fermer la porte du profil absent
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller).
-- Idempotent : create or replace function, ré-exécutable sans rien casser.
--
-- LA FAILLE CORRIGÉE
-- ------------------
-- 66 policies sur 54 tables accordent l'accès bureau avec le prédicat
-- « not est_ouvrier() ». Or est_ouvrier() enveloppait sa sous-requête dans
-- un coalesce(..., false) : un compte authentifié SANS ligne dans
-- public.utilisateurs n'était pas un ouvrier, donc était traité comme le
-- bureau. Un tel compte lisait ET écrivait tout : salaires (pointages),
-- chiffrages, factures, historique. Vérifié : lecture des 1 475 pointages
-- et INSERT accepté dans planning_config.
--
-- Deuxième défaut, même cause : ni mon_role() ni est_ouvrier() ne
-- regardaient utilisateurs.actif. Désactiver un compte ne lui retirait
-- donc aucun droit en base.
--
-- Le piège le plus dangereux était le geste le plus naturel : SUPPRIMER la
-- ligne d'une personne dans public.utilisateurs pour lui retirer l'accès
-- la faisait passer d'ouvrier à bureau complet. Révoquer = promouvoir.
--
-- LE TROISIÈME ÉTAT « NULL » EST UNE BARRIÈRE DE SÉCURITÉ VOLONTAIRE
-- -----------------------------------------------------------------
-- est_ouvrier() est désormais TERNAIRE, et c'est le cœur du correctif :
--
--     Profil          mon_role()      est_ouvrier()
--     ------------    ------------    -------------
--     ouvrier actif   'ouvrier'       true
--     bureau actif    son rôle        false
--     profil absent   NULL            NULL      ← refusé des deux côtés
--     profil inactif  NULL            NULL      ← refusé des deux côtés
--
-- En logique ternaire SQL, une policy dont le prédicat vaut NULL REFUSE la
-- ligne (NULL n'est pas vrai). Un profil absent ou inactif est donc rejeté
-- des deux familles de policies à la fois, sans toucher une seule d'entre
-- elles :
--   • bureau   : « not est_ouvrier() »   → not NULL → NULL → refusé
--   • ouvrier  : « est_ouvrier() and … » → NULL and … → NULL → refusé
--   • RPC      : « if mon_role() is null then return null » → refusé
--   • progbat_devis_exportables : « est_ouvrier() = false » → NULL → 0 ligne
--
-- ⚠ NE JAMAIS « CORRIGER » CE NULL EN false NI EN true.
--   - coalesce(..., false) est la faille d'origine : il rend bureau tout
--     compte inconnu.
--   - coalesce(..., true) serait pire : il rendrait OUVRIER tout compte
--     inconnu, lui ouvrant les policies « est_ouvrier() and … »
--     (planning_cells, rapports, besoins, materiel, planning_config).
--   Le NULL est le seul état qui échoue en sécurité des deux côtés.
--
-- PÉRIMÈTRE
-- ---------
-- - AUCUNE policy modifiée : la correction est centralisée dans les deux
--   helpers, et les 66 policies en héritent telles quelles.
-- - AUCUNE donnée modifiée, aucun compte supprimé ni désactivé.
-- - Signatures, types de retour, volatilité (stable), SECURITY DEFINER et
--   search_path conservés à l'identique. Les droits d'exécution existants
--   sont préservés : create or replace ne réinitialise pas les grants.
-- - mon_prenom_planning() est laissé tel quel : il n'accorde rien seul, il
--   n'est jamais utilisé qu'en compagnie de est_ouvrier() dans les policies
--   ouvrières, lesquelles échouent désormais en NULL avant lui.
--
-- EFFET DE BORD ASSUMÉ
-- --------------------
-- Les comptes déjà désactivés (utilisateurs.actif = false) perdent tout
-- accès en base à l'application de ce fichier. C'est l'objet même du
-- correctif. Au moment de l'écriture : 2 comptes concernés, dont 1 compte
-- bureau. Les réactiver (actif = true) rend l'accès immédiatement.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) mon_role() — le rôle d'un profil EXISTANT et ACTIF, sinon NULL
-- ---------------------------------------------------------------------
-- NULL signifie « aucun profil applicatif utilisable pour cet appelant ».
-- Les RPC ouvrières testent déjà « mon_role() is null » et refusent alors
-- l'appel : elles héritent gratuitement de la correction.
create or replace function public.mon_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.role
  from public.utilisateurs u
  where u.email = auth.email()
    and u.actif is true
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- 2) est_ouvrier() — dérivé de mon_role(), donc ternaire
-- ---------------------------------------------------------------------
-- Une seule source de vérité : si mon_role() renvoie NULL (profil absent
-- ou inactif), la comparaison renvoie NULL et la barrière joue.
create or replace function public.est_ouvrier()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mon_role() = 'ouvrier';
$$;

commit;

-- =====================================================================
-- VÉRIFICATION (lecture seule ; à passer après application)
-- =====================================================================
-- Attendu, pour chacun des quatre profils :
--   ouvrier actif  → mon_role='ouvrier', est_ouvrier=true,  6 clés config
--   bureau actif   → mon_role=<rôle>,    est_ouvrier=false, 35 clés config
--   profil absent  → mon_role=NULL,      est_ouvrier=NULL,  0 ligne partout
--   profil inactif → mon_role=NULL,      est_ouvrier=NULL,  0 ligne partout
--
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"role":"authenticated","email":"<email>"}';
--   select public.mon_role() as mon_role,
--          public.est_ouvrier() as est_ouvrier,
--          (select count(*) from public.planning_config) as config,
--          (select count(*) from public.pointages)       as pointages,
--          (select count(*) from public.profero_projets) as chiffrages;
-- rollback;
-- =====================================================================
