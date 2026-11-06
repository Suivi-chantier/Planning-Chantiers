-- ============================================================================
-- RETOUR ARRIÈRE — Refonte Opérations, lot 1
-- Migration : supabase/migrations/20261106045027_refonte_operations_lot1.sql
--
-- Principe : les blocs planning_config "chantiers" et "operations" sont restés
-- en place et ont été tenus à jour en continu par le miroir (tables → bloc).
-- Revenir en arrière = rendre au bloc son rôle de source unique :
--   1. revenir au code d'avant (annuler la demande de fusion du lot 1 :
--      l'application relit alors planning_config comme avant) ;
--   2. exécuter CE script, qui débranche les synchronisations.
-- Le bloc contient alors l'état le plus récent (y compris les modifications
-- faites après la mise en ligne). Rien n'est perdu.
--
-- Ce script NE SUPPRIME AUCUNE DONNÉE : les tables operations, chantiers et
-- planning_config_sauvegarde_refonte restent en place (simplement plus
-- utilisées). Les supprimer est une décision séparée.
--
-- Option (section 3, commentée) : remettre les blocs EXACTEMENT dans l'état
-- d'avant la reprise, depuis la sauvegarde datée. À n'utiliser que si le
-- contenu actuel est jugé faux : cela efface les modifications faites depuis.
-- ============================================================================

begin;

-- 1. Débrancher les synchronisations (les fonctions restent, inertes).
alter table public.planning_config disable trigger planning_config_vers_tables;
alter table public.chantiers  disable trigger chantiers_miroir_config;
alter table public.operations disable trigger operations_miroir_config;

-- 2. Contrôle : le bloc contient bien tous les chantiers non archivés.
select
  (select jsonb_array_length(value) from public.planning_config where key = 'chantiers')            as chantiers_dans_bloc,
  (select count(*) from public.chantiers where archive_le is null)                                     as chantiers_en_table,
  (select jsonb_array_length(value -> 'items') from public.planning_config where key = 'operations') as operations_dans_bloc,
  (select count(*) from public.operations where archive_le is null)                                    as operations_en_table;

-- 3. OPTION — restaurer les blocs d'avant la reprise (décommenter).
-- update public.planning_config pc
--    set value = s.value, updated_at = now()
--   from public.planning_config_sauvegarde_refonte s
--  where s.key = pc.key
--    and s.key in ('chantiers', 'operations')
--    and s.motif like 'lot1 :%';

commit;

-- Pour rebrancher plus tard (annuler ce retour arrière) :
--   alter table public.planning_config enable trigger planning_config_vers_tables;
--   alter table public.chantiers  enable trigger chantiers_miroir_config;
--   alter table public.operations enable trigger operations_miroir_config;
--   select public.refonte_resynchroniser_depuis_config();
