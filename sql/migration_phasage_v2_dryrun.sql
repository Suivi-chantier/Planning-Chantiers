-- ============================================================================
-- DRY-RUN : migration Phasage V1 (plan_travaux) -> V2 (ouvrages.taches)
-- ----------------------------------------------------------------------------
-- N'ÉCRIT RIEN. Produit, pour chaque chantier, le `ouvrages` JSON qui SERAIT
-- écrit, plus un comparatif avant/après. À relire avant de lancer l'UPDATE
-- (fichier migration_phasage_v2_apply.sql).
--
-- Règles (validées avec le gérant) :
--  - chaque tâche de plan_travaux est rattachée à son ouvrage par ouvrage_id,
--    repli sur ouvrage_libelle ;
--  - un ouvrage qui a au moins une tâche V1 voit ses `taches` REMPLACÉES par
--    la liste V1 (avec suivi) ; un ouvrage jamais touché garde ses tâches ;
--  - les tâches sans ouvrage rattachable vont dans un ouvrage
--    « Divers / hors devis » créé par chantier ;
--  - heures_reelles au format tableau (V1 hebdo) -> somme scalaire.
-- ============================================================================

with
-- 1. Tâches du plan V1, à plat
plan_tasks as (
  select
    p.id                                                  as phasage_id,
    t.value                                               as task,
    nullif(t.value->>'ouvrage_id','')                     as src_ouvrage_id,
    lower(trim(coalesce(t.value->>'ouvrage_libelle','')))  as src_ouvrage_libelle
  from phasages p
  cross join lateral jsonb_each(coalesce(p.plan_travaux,'{}'::jsonb)) ph(phase_key, phase_val)
  cross join lateral jsonb_array_elements(
      case when jsonb_typeof(ph.phase_val)='array' then ph.phase_val else '[]'::jsonb end
  ) t(value)
  where ph.phase_key <> 'meta'
),
-- 2. Ouvrages existants, à plat, avec leur position (ord)
ex_ouvrages as (
  select
    p.id                                              as phasage_id,
    o.ord                                             as ord,
    o.value                                           as ouvrage,
    coalesce(o.value->>'id','')                       as o_id,
    lower(trim(coalesce(o.value->>'libelle','')))     as o_libelle
  from phasages p
  cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.ouvrages)='array' then p.ouvrages else '[]'::jsonb end
  ) with ordinality o(value, ord)
),
-- 3. Résolution : à quel ouvrage (ord) rattacher chaque tâche ? null => Divers
resolved as (
  select
    pt.phasage_id,
    pt.task,
    coalesce(
      (select eo.ord from ex_ouvrages eo
        where eo.phasage_id = pt.phasage_id
          and pt.src_ouvrage_id is not null
          and eo.o_id = pt.src_ouvrage_id
        limit 1),
      (select eo.ord from ex_ouvrages eo
        where eo.phasage_id = pt.phasage_id
          and pt.src_ouvrage_libelle <> ''
          and eo.o_libelle = pt.src_ouvrage_libelle
        limit 1)
    ) as target_ord
  from plan_tasks pt
),
-- 4. Conversion d'une tâche V1 -> tâche V2 (normalisation heures_reelles)
v2_tache as (
  select
    r.phasage_id,
    r.target_ord,
    jsonb_build_object(
      'id',              gen_random_uuid()::text,
      'nom',             coalesce(r.task->>'nom',''),
      'heures_estimees', case when jsonb_typeof(r.task->'heures_estimees')='number'
                              then r.task->'heures_estimees' else 'null'::jsonb end,
      'heures_reelles',  case
                            when jsonb_typeof(r.task->'heures_reelles')='number'
                              then r.task->'heures_reelles'
                            when jsonb_typeof(r.task->'heures_reelles')='array'
                              then to_jsonb((
                                   select coalesce(sum(e::numeric),0)
                                   from jsonb_array_elements_text(r.task->'heures_reelles') e
                                   where e ~ '^\s*[0-9]+([.,][0-9]+)?\s*$'))
                            else 'null'::jsonb end,
      'avancement',      case when coalesce(r.task->>'avancement','') ~ '^\s*[0-9]+([.,][0-9]+)?\s*$'
                              then to_jsonb((r.task->>'avancement')::numeric) else to_jsonb(0) end,
      'ouvriers',        case when jsonb_typeof(r.task->'ouvriers')='array'
                              then r.task->'ouvriers' else '[]'::jsonb end
    ) as tache
  from resolved r
),
-- 5. Agrégat des tâches par ouvrage cible (et par Divers quand target_ord null)
taches_by_ord as (
  select phasage_id, target_ord, jsonb_agg(tache) as taches
  from v2_tache
  group by phasage_id, target_ord
),
-- 6. Ouvrages existants reconstruits : taches remplacées si tâches V1 présentes
rebuilt_ex as (
  select
    eo.phasage_id,
    eo.ord,
    case when tbo.taches is not null
         then jsonb_set(eo.ouvrage, '{taches}', tbo.taches)
         else eo.ouvrage
    end as ouvrage
  from ex_ouvrages eo
  left join taches_by_ord tbo
    on tbo.phasage_id = eo.phasage_id and tbo.target_ord = eo.ord
),
-- 7. Ouvrage « Divers / hors devis » par chantier (tâches non rattachables)
divers as (
  select
    tbo.phasage_id,
    jsonb_build_object(
      'id',             gen_random_uuid()::text,
      'libelle',        'Divers / hors devis',
      'lot_id',         null,
      'heures_devis',   null,
      'quantite',       null,
      'unite',          'U',
      'prix_ht',        null,
      'cout_materiaux', null,
      'taches',         tbo.taches
    ) as ouvrage
  from taches_by_ord tbo
  where tbo.target_ord is null
),
-- 8. Nouveau tableau ouvrages = existants reconstruits (ordre préservé) + Divers
final_ouvrages as (
  select
    p.id as phasage_id,
    coalesce((select jsonb_agg(r.ouvrage order by r.ord)
                from rebuilt_ex r where r.phasage_id = p.id), '[]'::jsonb)
    ||
    coalesce((select jsonb_agg(d.ouvrage)
                from divers d where d.phasage_id = p.id), '[]'::jsonb)
    as ouvrages_new
  from phasages p
)
-- ── APERÇU ──────────────────────────────────────────────────────────────────
select
  p.chantier_nom,
  jsonb_array_length(coalesce(p.ouvrages,'[]'::jsonb))                       as ouvrages_avant,
  jsonb_array_length(fo.ouvrages_new)                                        as ouvrages_apres,
  (select count(*) from jsonb_array_elements(coalesce(p.ouvrages,'[]'::jsonb)) o
     cross join jsonb_array_elements(coalesce(o->'taches','[]'::jsonb)) t)   as taches_avant,
  (select count(*) from jsonb_array_elements(fo.ouvrages_new) o
     cross join jsonb_array_elements(coalesce(o->'taches','[]'::jsonb)) t)   as taches_apres,
  -- décommente la ligne suivante pour inspecter le JSON complet d'un chantier :
  -- fo.ouvrages_new,
  exists (select 1 from divers d where d.phasage_id = p.id)                  as a_un_divers
from final_ouvrages fo
join phasages p on p.id = fo.phasage_id
order by taches_apres desc;
