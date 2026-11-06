-- ============================================================================
-- Refonte Opérations, lot 6 (06/11/2026) — rôle « Chargé d'affaires »
-- (identifiant technique charge_affaires).
-- Fichier projet : docs/projets/refonte-operations.md.
-- Compte rendu   : docs/project/REFONTE-OPERATIONS-COMPTE-RENDU.md.
--
-- Le chargé d'affaires est un collaborateur de bureau comme le commercial :
-- est_collaborateur_actif() ne regarde pas le rôle (fiche active suffit),
-- est_ouvrier() ne vaut vrai que pour « ouvrier ». Aucune fonction ni
-- contrainte n'a besoin de changer (pas de CHECK sur utilisateurs.role).
--
-- Cette migration ajoute SEULEMENT deux policies RESTRICTIVES sur
-- public.chantier_cycle_vie : un compte dont le rôle est charge_affaires ne
-- peut créer ou modifier que les étapes des phases ÉTUDE et CONTRAT du cycle
-- de vie (liste ci-dessous = ETAPES_VALIDABLES_CHARGE_AFFAIRES de
-- src/Renovation/roleChargeAffaires.mjs, comparée par
-- scripts/verif-refonte-lot6.mjs). Les autres phases, et la déclaration de la
-- phase à la main (pseudo-étape « _phase_declaree »), lui restent en lecture.
-- Pour tout autre rôle la condition est vraie : rien ne change.
--
-- Restrictive = ET avec les policies existantes, qui ne sont pas touchées.
-- Aucune donnée lue, réécrite ni supprimée ; aucune fonction SECURITY
-- DEFINER créée ou modifiée (mon_role() existe déjà, inchangée) ; aucun
-- droit nouveau : on ne fait que retirer au nouveau rôle l'écriture des
-- phases Préparation, Travaux et Réception.
--
-- Retour arrière : sql/202611_refonte_operations_lot6_rollback.sql.
--
-- APPLIQUÉE le 06/11/2026 (version 20261106071527, apply_migration), après un
-- essai complet dans une transaction annulée avec un compte charge_affaires
-- fictif (collaborateur actif = vrai, ouvrier = faux ; lecture chantiers 46,
-- opérations 19, chiffrages 88 ; « Devis signé » créé et modifié ; « Plans
-- techniques », déclaration de phase et renommage d'étape refusés ; un
-- administrateur écrit toujours « Plans techniques »). Corps appliqué = ce
-- fichier, aux commentaires près.
-- ============================================================================

create policy "cycle vie charge affaires etude contrat ajout"
  on public.chantier_cycle_vie
  as restrictive
  for insert
  to authenticated
  with check (
    (select public.mon_role()) is distinct from 'charge_affaires'
    or etape_id = any (array[
      'visite_chiffrage', 'chiffrage_realise', 'devis_envoye', 'relance_devis',
      'devis_signe', 'acompte_encaisse', 'relance_acompte', 'autorisation_recue'
    ]::text[])
  );

create policy "cycle vie charge affaires etude contrat modification"
  on public.chantier_cycle_vie
  as restrictive
  for update
  to authenticated
  using (
    (select public.mon_role()) is distinct from 'charge_affaires'
    or etape_id = any (array[
      'visite_chiffrage', 'chiffrage_realise', 'devis_envoye', 'relance_devis',
      'devis_signe', 'acompte_encaisse', 'relance_acompte', 'autorisation_recue'
    ]::text[])
  )
  with check (
    (select public.mon_role()) is distinct from 'charge_affaires'
    or etape_id = any (array[
      'visite_chiffrage', 'chiffrage_realise', 'devis_envoye', 'relance_devis',
      'devis_signe', 'acompte_encaisse', 'relance_acompte', 'autorisation_recue'
    ]::text[])
  );
