-- ============================================================================
-- APPLICATION : migration Phasage V1 (plan_travaux) -> V2 (ouvrages.taches)
-- ----------------------------------------------------------------------------
-- À lancer APRÈS validation du dry-run (migration_phasage_v2_dryrun.sql).
--
-- Sécurité :
--   - ne touche QUE le champ `ouvrages` ; `plan_travaux` reste intact
--     (la page Phasage V1 continue de fonctionner à l'identique) ;
--   - le trigger phasages_history snapshote l'ancien état avant chaque écriture ;
--   - l'ÉTAPE 0 ci-dessous crée en plus une copie complète de la table.
--
-- Ordre d'exécution : ÉTAPE 0, puis ÉTAPE 1, puis ÉTAPE 2 (vérif).
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ÉTAPE 0 — SAUVEGARDE MANUELLE (à lancer en premier, une seule fois)        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Copie intégrale de la table avant toute modification. Pour restaurer en cas
-- de besoin : voir ÉTAPE 3 (rollback) en bas de fichier.
create table if not exists public.phasages_backup_premig_v2 as
  select * from public.phasages;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ÉTAPE 1 — MIGRATION (écrit dans phasages.ouvrages)                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
with
plan_tasks as (
  select
    p.id as phasage_id,
    t.value as task,
    nullif(t.value->>'ouvrage_id','') as src_ouvrage_id,
    lower(trim(coalesce(t.value->>'ouvrage_libelle',''))) as src_ouvrage_libelle
  from phasages p
  cross join lateral jsonb_each(coalesce(p.plan_travaux,'{}'::jsonb)) ph(phase_key, phase_val)
  cross join lateral jsonb_array_elements(
      case when jsonb_typeof(ph.phase_val)='array' then ph.phase_val else '[]'::jsonb end) t(value)
  where ph.phase_key <> 'meta'
),
ex_ouvrages as (
  select
    p.id as phasage_id, o.ord as ord, o.value as ouvrage,
    coalesce(o.value->>'id','') as o_id,
    lower(trim(coalesce(o.value->>'libelle',''))) as o_libelle
  from phasages p
  cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.ouvrages)='array' then p.ouvrages else '[]'::jsonb end
  ) with ordinality o(value, ord)
),
resolved as (
  select pt.phasage_id, pt.task,
    coalesce(
      (select eo.ord from ex_ouvrages eo
        where eo.phasage_id=pt.phasage_id and pt.src_ouvrage_id is not null
          and eo.o_id=pt.src_ouvrage_id limit 1),
      (select eo.ord from ex_ouvrages eo
        where eo.phasage_id=pt.phasage_id and pt.src_ouvrage_libelle<>''
          and eo.o_libelle=pt.src_ouvrage_libelle limit 1)
    ) as target_ord
  from plan_tasks pt
),
v2_tache as (
  select r.phasage_id, r.target_ord,
    jsonb_build_object(
      'id', gen_random_uuid()::text,
      'nom', coalesce(r.task->>'nom',''),
      'heures_estimees', case when jsonb_typeof(r.task->'heures_estimees')='number'
                              then r.task->'heures_estimees' else 'null'::jsonb end,
      'heures_reelles', case
          when jsonb_typeof(r.task->'heures_reelles')='number' then r.task->'heures_reelles'
          when jsonb_typeof(r.task->'heures_reelles')='array' then to_jsonb((
               select coalesce(sum(e::numeric),0) from jsonb_array_elements_text(r.task->'heures_reelles') e
               where e ~ '^\s*[0-9]+([.,][0-9]+)?\s*$'))
          else 'null'::jsonb end,
      'avancement', case when coalesce(r.task->>'avancement','') ~ '^\s*[0-9]+([.,][0-9]+)?\s*$'
                         then to_jsonb((r.task->>'avancement')::numeric) else to_jsonb(0) end,
      'ouvriers', case when jsonb_typeof(r.task->'ouvriers')='array' then r.task->'ouvriers' else '[]'::jsonb end
    ) as tache
  from resolved r
),
taches_by_ord as (
  select phasage_id, target_ord, jsonb_agg(tache) as taches
  from v2_tache group by phasage_id, target_ord
),
rebuilt_ex as (
  select eo.phasage_id, eo.ord,
    case when tbo.taches is not null
         then jsonb_set(eo.ouvrage,'{taches}',tbo.taches) else eo.ouvrage end as ouvrage
  from ex_ouvrages eo
  left join taches_by_ord tbo on tbo.phasage_id=eo.phasage_id and tbo.target_ord=eo.ord
),
divers as (
  select tbo.phasage_id,
    jsonb_build_object(
      'id', gen_random_uuid()::text, 'libelle','Divers / hors devis',
      'lot_id', null,'heures_devis',null,'quantite',null,'unite','U',
      'prix_ht',null,'cout_materiaux',null,'taches',tbo.taches) as ouvrage
  from taches_by_ord tbo where tbo.target_ord is null
),
final_ouvrages as (
  select p.id as phasage_id,
    coalesce((select jsonb_agg(r.ouvrage order by r.ord) from rebuilt_ex r where r.phasage_id=p.id),'[]'::jsonb)
    || coalesce((select jsonb_agg(d.ouvrage) from divers d where d.phasage_id=p.id),'[]'::jsonb) as ouvrages_new
  from phasages p
)
update public.phasages p
set ouvrages = fo.ouvrages_new,
    updated_at = now()
from final_ouvrages fo
where fo.phasage_id = p.id
  -- on ne migre QUE les chantiers ayant des données V1 à reprendre
  and p.id in (select distinct phasage_id from plan_tasks)
  -- et seulement si le résultat diffère réellement (pas de no-op)
  and p.ouvrages is distinct from fo.ouvrages_new;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ÉTAPE 2 — VÉRIFICATION post-migration                                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Compare le nb de tâches côté ouvrages (V2) avec le nb de tâches V1 d'origine.
-- Attendu : taches_v2 >= taches_v1_origine pour chaque chantier.
select
  p.chantier_nom,
  (select count(*) from jsonb_array_elements(coalesce(p.ouvrages,'[]'::jsonb)) o
     cross join jsonb_array_elements(coalesce(o->'taches','[]'::jsonb)) t)            as taches_v2,
  (select count(*) from jsonb_each(coalesce(p.plan_travaux,'{}'::jsonb)) ph
     cross join jsonb_array_elements(
        case when jsonb_typeof(ph.value)='array' then ph.value else '[]'::jsonb end) t
     where ph.key <> 'meta')                                                          as taches_v1_origine
from phasages p
where p.plan_travaux is not null
order by taches_v2 desc;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ÉTAPE 3 — ROLLBACK (uniquement si besoin d'annuler)                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Restaure l'état d'avant migration depuis la copie de l'ÉTAPE 0 :
--
--   update public.phasages p
--   set ouvrages = b.ouvrages, updated_at = now()
--   from public.phasages_backup_premig_v2 b
--   where b.id = p.id;
