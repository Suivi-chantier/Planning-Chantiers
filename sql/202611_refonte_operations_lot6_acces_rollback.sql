-- ============================================================================
-- RETOUR ARRIÈRE — Refonte Opérations, lot 6 (accès du rôle chargé d'affaires)
-- Annule sql/202611_refonte_operations_lot6_acces.sql.
--
-- Retire la clé « charge_affaires » de access_pages_renovation et l'entrée
-- « charge_affaires » de access_roles_renovation. Les réglages faits depuis
-- sur les autres rôles sont conservés. Aucune ligne n'est supprimée.
--
-- AVANT de l'exécuter : remettre un autre rôle aux comptes qui auraient reçu
-- « Chargé d'affaires » (sinon ils n'ont plus aucune page bureau) :
--   select email, nom from public.utilisateurs where role = 'charge_affaires';
--
-- Option (section 3, commentée) : remettre les deux lignes EXACTEMENT comme
-- avant le lot 6 (sauvegarde motif « lot6 : … »). Efface toute modification
-- d'accès faite depuis.
-- ============================================================================

begin;

-- 1. Pages : retrait de la seule clé du rôle.
update public.planning_config
   set value = value - 'charge_affaires', updated_at = now()
 where key = 'access_pages_renovation'
   and value ? 'charge_affaires';

-- 2. Liste des rôles : retrait de la seule entrée du rôle, ordre gardé.
update public.planning_config pc
   set value = jsonb_set(pc.value, '{items}',
         coalesce((select jsonb_agg(r.item order by r.n)
                     from jsonb_array_elements(pc.value -> 'items') with ordinality as r(item, n)
                    where r.item ->> 'id' is distinct from 'charge_affaires'), '[]'::jsonb)),
       updated_at = now()
 where pc.key = 'access_roles_renovation'
   and exists (select 1 from jsonb_array_elements(coalesce(pc.value -> 'items', '[]'::jsonb)) as r(item)
                where r.item ->> 'id' = 'charge_affaires');

-- 3. OPTION — restauration exacte des lignes sauvegardées (décommenter).
-- update public.planning_config pc
--    set value = s.value, updated_at = now()
--   from (select distinct on (key) key, value from public.planning_config_sauvegarde_refonte
--          where motif like 'lot6 :%' order by key, sauvegarde_le desc) as s
--  where pc.key = s.key;

-- 4. Contrôle.
select pc.key, pc.value ? 'charge_affaires' as pages_du_role,
       exists (select 1 from jsonb_array_elements(coalesce(pc.value -> 'items', '[]'::jsonb)) as r(item)
                where r.item ->> 'id' = 'charge_affaires') as dans_liste_roles
  from public.planning_config pc
 where pc.key in ('access_pages_renovation', 'access_roles_renovation');

commit;
