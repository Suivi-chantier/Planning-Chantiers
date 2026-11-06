-- ============================================================================
-- Refonte Opérations, lot 2 — RETOUR ARRIÈRE (à lancer seulement sur décision).
--
-- Principe « aucune suppression de donnée » : ce script NE SUPPRIME RIEN. Il
-- remet l'application dans l'état du lot 1 côté comportement :
--   - les chantiers « À l'étude » repassent sans statut (affichés « Planifié »)
--     et les « Perdus » sont archivés (retirés des listes, récupérables) ;
--     leur statut d'origine est d'abord noté dans le journal ;
--   - les tables clients / chantiers_statut_journal et les colonnes ajoutées
--     restent en place (simplement plus lues par l'ancien code).
-- Combiné à l'annulation de la demande de fusion du lot 2 (le code du lot 1
-- ignore ces colonnes), on retrouve exactement le comportement du lot 1.
--
-- Avant de lancer : compter les lignes touchées
--   select statut, count(*) from public.chantiers
--    where statut in ('a_l_etude', 'perdu') group by statut;
-- ============================================================================
begin;

insert into public.chantiers_statut_journal (chantier_id, evenement, ancien_statut, nouveau_statut, motif, auteur)
select id, 'retour_arriere_lot2', statut,
       case when statut = 'perdu' then 'perdu (archivé)' else null end,
       'Retour arrière du lot 2', 'script de retour arrière'
  from public.chantiers
 where statut in ('a_l_etude', 'perdu');

update public.chantiers set archive_le = coalesce(archive_le, now())
 where statut = 'perdu';
update public.chantiers set statut = null
 where statut = 'a_l_etude';

commit;
