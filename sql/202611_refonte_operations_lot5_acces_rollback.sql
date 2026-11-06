-- ============================================================================
-- RETOUR ARRIÈRE — Refonte Opérations, lot 5 (accès)
-- Annule sql/202611_refonte_operations_lot5_acces.sql.
--
-- Principe : on retire « operations » UNIQUEMENT des rôles qui ne l'avaient
-- pas dans la sauvegarde (planning_config_sauvegarde_refonte, motif
-- « lot5 : … ») : admin, comptable, commercial, conducteur, super_admin au
-- 06/11/2026 (admin la retrouve de toute façon par l'attribution automatique
-- de loadAccessConfig). Les autres réglages faits depuis dans Réglages → Accès sont
-- conservés. Aucune ligne n'est supprimée.
--
-- À combiner avec l'annulation de la demande de fusion du lot 5 (la liste
-- Chantiers revient alors dans le menu). Sans annuler le code, retirer
-- « operations » laisserait ces rôles sans porte d'entrée vers leurs
-- chantiers (seulement les liens des Alertes / Notes des ouvriers) : ne pas
-- exécuter ce script seul.
--
-- Option (section 2, commentée) : remettre la ligne EXACTEMENT comme avant le
-- lot 5. Efface toute modification d'accès faite depuis.
-- ============================================================================

begin;

-- 1. Retirer « operations » des rôles qui ne l'avaient pas avant le lot 5.
update public.planning_config pc
   set value = (
         select jsonb_object_agg(
                  r.role,
                  case when jsonb_typeof(r.pages) = 'array'
                        and coalesce(jsonb_typeof(s.value -> r.role), '') = 'array'
                        and not ((s.value -> r.role) ? 'operations')
                       then r.pages - 'operations'
                       else r.pages end)
           from jsonb_each(pc.value) as r(role, pages)),
       updated_at = now()
  from (select value from public.planning_config_sauvegarde_refonte
         where key = 'access_pages_renovation' and motif like 'lot5 :%'
         order by sauvegarde_le desc limit 1) as s
 where pc.key = 'access_pages_renovation';

-- 2. OPTION — restauration exacte de la ligne sauvegardée (décommenter).
-- update public.planning_config pc
--    set value = s.value, updated_at = now()
--   from (select value from public.planning_config_sauvegarde_refonte
--          where key = 'access_pages_renovation' and motif like 'lot5 :%'
--          order by sauvegarde_le desc limit 1) as s
--  where pc.key = 'access_pages_renovation';

-- 3. Contrôle.
select r.role, r.pages ? 'chantiers' as chantiers, r.pages ? 'operations' as operations
  from public.planning_config pc, jsonb_each(pc.value) as r(role, pages)
 where pc.key = 'access_pages_renovation'
 order by r.role;

commit;
