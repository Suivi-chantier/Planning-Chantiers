-- ============================================================================
-- Refonte Opérations, lot 5 — accès : ajouter la page « operations » aux rôles
-- qui voyaient « chantiers » (planning_config.access_pages_renovation).
--
-- Appliqué en base le 06/11/2026 (projet yooksnzhlffqgpzkcjhl), AVANT la
-- fusion du lot 5 : ajouter une page à des rôles est compatible avec l'ancien
-- code (Opérations existe déjà) et avec le nouveau (Opérations devient la
-- porte d'entrée, la liste Chantiers sort du menu).
--
-- Ne retire RIEN : « chantiers » reste dans chaque liste (c'est le droit
-- d'ouvrir la fiche chantier). Seule la ligne access_pages_renovation est
-- modifiée. Aucune policy, aucune fonction, aucun rôle n'est touché.
--
-- Sauvegarde : ligne copiée dans planning_config_sauvegarde_refonte (id 4,
-- motif « lot5 : avant ajout de operations… ») avant la modification.
-- Retour arrière : sql/202611_refonte_operations_lot5_acces_rollback.sql
--
-- Idempotent : un rôle qui a déjà « operations » n'est pas modifié ; la
-- sauvegarde n'est prise qu'une fois.
-- ============================================================================

begin;

-- 1. Sauvegarde datée de la ligne (une seule fois).
insert into public.planning_config_sauvegarde_refonte (key, value, updated_at, motif)
select pc.key, pc.value, pc.updated_at,
       'lot5 : avant ajout de operations aux rôles qui ont chantiers (06/11/2026)'
  from public.planning_config pc
 where pc.key = 'access_pages_renovation'
   and not exists (select 1 from public.planning_config_sauvegarde_refonte s
                    where s.key = 'access_pages_renovation' and s.motif like 'lot5 :%');

-- 2. Ajout de « operations » en fin de liste, seulement là où « chantiers »
--    est présent et « operations » absent. L'ordre des autres pages est gardé.
update public.planning_config pc
   set value = (
         select jsonb_object_agg(
                  r.role,
                  case when jsonb_typeof(r.pages) = 'array'
                        and r.pages ? 'chantiers'
                        and not (r.pages ? 'operations')
                       then r.pages || '["operations"]'::jsonb
                       else r.pages end)
           from jsonb_each(pc.value) as r(role, pages)),
       updated_at = now()
 where pc.key = 'access_pages_renovation'
   and exists (select 1 from jsonb_each(pc.value) as r(role, pages)
                where jsonb_typeof(r.pages) = 'array'
                  and r.pages ? 'chantiers' and not (r.pages ? 'operations'));

-- 3. Contrôle : rôle par rôle, chantiers / operations.
select r.role, r.pages ? 'chantiers' as chantiers, r.pages ? 'operations' as operations
  from public.planning_config pc, jsonb_each(pc.value) as r(role, pages)
 where pc.key = 'access_pages_renovation'
 order by r.role;

commit;
