-- ═══════════════════════════════════════════════════════════════════════════
-- CONTRÔLES (lecture seule) de l'import ponctuel des cadences ProGBat.
-- À exécuter dans l'éditeur SQL Supabase après la migration
-- 20260916150000_progbat_cadence_import.sql. Aucune écriture, aucun import.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Les trois tables et les colonnes de provenance existent-elles ?
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (table_name in ('progbat_cadence_import_plans', 'progbat_cadence_import_runs', 'progbat_cadence_import_items')
    or (table_name = 'bibliotheque_ratios' and column_name like 'cadence%'))
order by table_name, ordinal_position;

-- 2. Contraintes de statut et index attendus
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conname in (
  'bibliotheque_ratios_cadence_source_check',
  'progbat_cadence_import_plans_statut_check',
  'progbat_cadence_import_runs_statut_check',
  'progbat_cadence_import_items_statut_check'
);
select indexname from pg_indexes
where schemaname = 'public' and tablename like 'progbat_cadence_import%'
order by indexname;

-- 3. RPC : présente, security definer, search_path figé, exécutable par le seul service_role
select p.proname, p.prosecdef as security_definer, p.proconfig,
       array(select r.rolname from pg_roles r where has_function_privilege(r.oid, p.oid, 'EXECUTE')
             and r.rolname in ('anon', 'authenticated', 'service_role', 'public')) as roles_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'progbat_cadences_appliquer';

-- 4. RLS : plans invisibles au navigateur ; runs et items en LECTURE SEULE pour le bureau
select c.relname, c.relrowsecurity as rls_active,
       (select count(*) from pg_policy where polrelid = c.oid) as nb_policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like 'progbat_cadence_import%';

select polrelid::regclass as table_name, polname, polcmd,
       pg_get_expr(polqual, polrelid) as using_clause
from pg_policy
where polrelid::regclass::text like 'progbat_cadence_import%';

-- Aucun INSERT/UPDATE/DELETE ne doit apparaître pour anon/authenticated :
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'progbat_cadence_import%'
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by table_name, grantee, privilege_type;

-- 5. Trigger de provenance présent
select tgname, pg_get_triggerdef(oid)
from pg_trigger
where tgrelid = 'public.bibliotheque_ratios'::regclass and not tgisinternal
  and tgname = 'bibliotheque_ratios_cadence_provenance';

-- 6. État des données AVANT tout import (doit rester inchangé tant qu'aucun import
--    n'a été confirmé depuis l'interface) :
--    attendus au 16/09/2026 : 105 ouvrages, 75 liés, 73 identifiants distincts,
--    24 sans cadence, 0 cadence importée, 0 plan, 0 exécution, 0 ligne d'audit.
select 'ouvrages_total' as mesure, count(*)::text as valeur from public.bibliotheque_ratios
union all select 'ouvrages_lies', count(progbat_id)::text from public.bibliotheque_ratios
union all select 'progbat_id_distincts', count(distinct progbat_id)::text from public.bibliotheque_ratios
union all select 'sans_cadence', count(*)::text from public.bibliotheque_ratios where cadence is null
union all select 'cadence_nulle_ou_negative', count(*)::text from public.bibliotheque_ratios where cadence <= 0
union all select 'cadence_source_progbat_import', count(*)::text from public.bibliotheque_ratios where cadence_source = 'progbat_import'
union all select 'plans_enregistres', count(*)::text from public.progbat_cadence_import_plans
union all select 'executions', count(*)::text from public.progbat_cadence_import_runs
union all select 'lignes_audit', count(*)::text from public.progbat_cadence_import_items;

-- 7. Doublons de liaison connus (ProGBat 300 et 312) : doivent apparaître en anomalie
--    dans l'aperçu et ne jamais être importés.
select progbat_id, count(*) as nb_ouvrages,
       array_agg(left(libelle, 40) order by libelle) as libelles,
       array_agg(cadence order by libelle) as cadences
from public.bibliotheque_ratios
where progbat_id is not null
group by progbat_id having count(*) > 1;

-- 8. Chiffrages figés : aucune ligne ne doit avoir été touchée par un import.
--    (les colonnes de snapshot n'ont aucun lien avec l'import : contrôle de non-régression)
select count(*) as lignes_chiffrage, max(updated_at) as derniere_modification
from public.profero_ouvrages_selectionnes;

-- ─── Après un import réel, relecture de l'historique ────────────────────────
-- select id, statut, nb_modifies, created_by_email, started_at, finished_at, error_message
-- from public.progbat_cadence_import_runs order by started_at desc limit 10;
-- select code, cadence_avant, cadence_apres, methode, created_at
-- from public.progbat_cadence_import_items where run_id = '…' order by code;
