-- ─────────────────────────────────────────────────────────────────────────────
-- Fiche sécurité — reprise des chantiers DÉJÀ EN COURS à la mise en service
-- (tâche 7 du projet docs/projets/fiche-securite-chantier.md, spécification :
-- « Chantiers déjà en cours à la mise en service : pas de blocage rétroactif ;
-- une fiche est créée en brouillon avec une alerte »).
--
-- ⚠️  REPRISE DE DONNÉES : NE PAS APPLIQUER sans l'accord de François
--     (arrêt obligatoire, CLAUDE.md). Préparé et essayé dans une transaction
--     annulée le 25/11/2026 : 20 fiches, 20 lignes de journal, 20 étapes.
--
-- Ce que fait le script (uniquement des AJOUTS, rien n'est modifié ni supprimé) :
--   1. une fiche en brouillon (v1, contenu vide) pour chaque chantier
--      « en cours », non archivé, qui n'a pas encore de fiche ;
--   2. une ligne dans l'historique du chantier (chantiers_statut_journal,
--      événement fiche_securite) qui le dit — elle sert aussi de liste des
--      fiches créées par la reprise ;
--   3. l'étape « Fiche sécurité validée » du cycle de vie (non faite).
-- L'alerte est affichée par l'appli (fiche chantier et panneau de
-- l'opération) : « Chantier déjà en cours sans fiche sécurité validée ».
--
-- Retour arrière (si demandé) : les fiches créées portent
-- cree_par = 'Reprise mise en service' et sont listées dans le journal ;
-- tant qu'aucune n'a été remplie, elles peuvent être retirées par un
-- administrateur de la base (aucune règle de l'appli ne permet de supprimer
-- une fiche).
-- ─────────────────────────────────────────────────────────────────────────────
begin;

with cibles as (
  select c.id
  from public.chantiers c
  where c.statut = 'en_cours'
    and c.archive_le is null
    and not exists (select 1 from public.securite_fiches f where f.chantier_id = c.id)
),
fiches as (
  insert into public.securite_fiches (chantier_id, cree_par, maj_par)
  select id, 'Reprise mise en service', 'Reprise mise en service' from cibles
  returning id, chantier_id
),
journal as (
  insert into public.chantiers_statut_journal (chantier_id, evenement, ancien_statut, nouveau_statut, motif, detail, auteur)
  select chantier_id, 'fiche_securite', null, 'brouillon', 'reprise_mise_en_service',
         'Fiche sécurité créée en brouillon à la mise en service : chantier déjà en cours, sans blocage rétroactif (fiche à remplir et valider)',
         'Reprise mise en service'
  from fiches
  returning chantier_id
)
insert into public.chantier_cycle_vie (chantier_id, etape_id, etat, maj_par)
select f.chantier_id, 'fiche_securite',
       jsonb_build_object('fait', false, 'date', now(), 'auteur', 'Reprise mise en service',
                          'fiche', jsonb_build_object('statut', 'brouillon', 'version', 1, 'forcee', false)),
       'Reprise mise en service'
from fiches f
on conflict (chantier_id, etape_id) do nothing;

-- Contrôle avant de valider : autant de fiches que de chantiers en cours.
select
  (select count(*) from public.chantiers where statut = 'en_cours' and archive_le is null) as chantiers_en_cours,
  (select count(*) from public.securite_fiches f join public.chantiers c on c.id = f.chantier_id
    where c.statut = 'en_cours' and c.archive_le is null) as fiches_en_cours,
  (select count(*) from public.securite_fiches where cree_par = 'Reprise mise en service') as fiches_reprise;

commit;
