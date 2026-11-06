-- ============================================================================
-- Refonte Opérations, lot 6 — accès : ajouter le rôle « Chargé d'affaires »
-- (charge_affaires) à la configuration enregistrée en base.
--
--   - planning_config.access_roles_renovation : le rôle est ajouté en fin de
--     liste (sans cela, Réglages → Utilisateurs / Accès ne le proposent pas :
--     la liste enregistrée remplace la liste par défaut).
--   - planning_config.access_pages_renovation : le rôle reçoit ses pages
--     « operations », « chantiers » (fiche chantier), « info-client »
--     (Chiffrage) et « journal-maj ». Aucune page financière globale, aucune
--     administration.
--
-- Ne retire RIEN aux autres rôles : seule une clé est ajoutée à chaque ligne.
-- Idempotent : si le rôle est déjà présent, la ligne n'est pas modifiée.
-- N'attribue le rôle à AUCUN utilisateur (choix de Loris, Réglages →
-- Utilisateurs). Aucune policy, fonction ou table touchée.
--
-- Sauvegarde : les deux lignes copiées dans planning_config_sauvegarde_refonte
-- (motif « lot6 : … ») avant modification, une seule fois.
-- Retour arrière : sql/202611_refonte_operations_lot6_acces_rollback.sql
-- ============================================================================

begin;

-- 1. Sauvegarde datée des deux lignes (une seule fois).
insert into public.planning_config_sauvegarde_refonte (key, value, updated_at, motif)
select pc.key, pc.value, pc.updated_at,
       'lot6 : avant ajout du rôle charge_affaires (06/11/2026)'
  from public.planning_config pc
 where pc.key in ('access_roles_renovation', 'access_pages_renovation')
   and not exists (select 1 from public.planning_config_sauvegarde_refonte s
                    where s.key = pc.key and s.motif like 'lot6 :%');

-- 2. Liste des rôles : ajout en fin de liste si absent.
update public.planning_config pc
   set value = jsonb_set(pc.value, '{items}',
         coalesce(pc.value -> 'items', '[]'::jsonb)
         || '[{"id": "charge_affaires", "label": "Chargé d''affaires", "color": "#14b8a6"}]'::jsonb),
       updated_at = now()
 where pc.key = 'access_roles_renovation'
   and not exists (select 1 from jsonb_array_elements(coalesce(pc.value -> 'items', '[]'::jsonb)) as r(item)
                    where r.item ->> 'id' = 'charge_affaires');

-- 3. Pages du rôle : nouvelle clé, les autres rôles ne sont pas touchés.
update public.planning_config pc
   set value = pc.value || '{"charge_affaires": ["operations", "chantiers", "info-client", "journal-maj"]}'::jsonb,
       updated_at = now()
 where pc.key = 'access_pages_renovation'
   and not (pc.value ? 'charge_affaires');

-- 4. Contrôle : nombre de pages par rôle.
select r.role, jsonb_array_length(r.pages) as nb_pages, r.pages
  from public.planning_config pc, jsonb_each(pc.value) as r(role, pages)
 where pc.key = 'access_pages_renovation'
 order by r.role;

commit;
