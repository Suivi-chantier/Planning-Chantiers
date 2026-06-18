-- ============================================================================
-- DIAGNOSTIC : migration Phasage V1 (plan_travaux) -> Phasage V2 (ouvrages.taches)
-- ----------------------------------------------------------------------------
-- À lancer dans Supabase (SQL Editor). Lecture seule, ne modifie rien.
--
-- Objectif : pour chaque chantier, mesurer
--   - combien de tâches de suivi vivent dans plan_travaux (le travail fait en V1)
--   - combien d'ouvrages / tâches existent côté V2 (ouvrages)
--   - combien de tâches du plan se "rebranchent" automatiquement sur une tâche
--     d'ouvrage (match par ouvrage_id+nom, fallback libellé+nom)
--   - combien resteraient ORPHELINES (tâches ajoutées à la main en V1, sans
--     ouvrage correspondant) -> c'est le seul point qui demande une décision.
-- ============================================================================

with
-- Tâches du plan V1 (plan_travaux : { phaseId: [tache,...], ..., meta:{} })
pt as (
  select
    p.id                                                  as phasage_id,
    coalesce(p.chantier_nom, p.chantier_id)               as chantier,
    t.value->>'ouvrage_id'                                as ouvrage_id,
    lower(trim(coalesce(t.value->>'ouvrage_libelle',''))) as ouvrage_libelle,
    lower(trim(coalesce(t.value->>'nom','')))           as nom,
    -- "a du suivi" = avancement > 0, OU ouvriers assignés, OU heures réelles saisies
    case
      when coalesce(nullif(t.value->>'avancement',''),'0') ~ '^[0-9.]+$'
           and (t.value->>'avancement')::numeric > 0 then true
      when jsonb_typeof(t.value->'ouvriers') = 'array'
           and jsonb_array_length(t.value->'ouvriers') > 0 then true
      when jsonb_typeof(t.value->'heures_reelles') = 'number'
           and (t.value->>'heures_reelles')::numeric > 0 then true
      when jsonb_typeof(t.value->'heures_reelles') = 'array'
           and jsonb_array_length(t.value->'heures_reelles') > 0 then true
      else false
    end                                                 as a_du_suivi
  from phasages p
  cross join lateral jsonb_each(coalesce(p.plan_travaux, '{}'::jsonb)) ph(phase_key, phase_val)
  cross join lateral jsonb_array_elements(
      case when jsonb_typeof(ph.phase_val) = 'array' then ph.phase_val else '[]'::jsonb end
  ) t(value)
  where ph.phase_key <> 'meta'
),
-- Tâches issues des ouvrages V2 (la cible du repli)
ov as (
  select
    p.id                                       as phasage_id,
    o.value->>'id'                             as ouvrage_id,
    lower(trim(coalesce(o.value->>'libelle',''))) as ouvrage_libelle,
    lower(trim(coalesce(tt.value->>'nom',''))) as nom
  from phasages p
  cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.ouvrages) = 'array' then p.ouvrages else '[]'::jsonb end
  ) o(value)
  cross join lateral jsonb_array_elements(
      case when jsonb_typeof(o.value->'taches') = 'array' then o.value->'taches' else '[]'::jsonb end
  ) tt(value)
),
-- Matchabilité de chaque tâche du plan
match as (
  select
    pt.phasage_id,
    pt.chantier,
    pt.a_du_suivi,
    exists (
      select 1 from ov
      where ov.phasage_id = pt.phasage_id
        and ov.nom = pt.nom
        and (
          (pt.ouvrage_id is not null and ov.ouvrage_id = pt.ouvrage_id)
          or (pt.ouvrage_id is null and ov.ouvrage_libelle = pt.ouvrage_libelle)
        )
    ) as matchable
  from pt
)
select
  m.chantier,
  m.phasage_id,
  count(*)                                                    as taches_plan_v1,
  count(*) filter (where m.a_du_suivi)                        as taches_avec_suivi,
  count(*) filter (where m.matchable)                         as taches_rebranchables,
  count(*) filter (where not m.matchable)                     as taches_orphelines,
  count(*) filter (where m.a_du_suivi and not m.matchable)    as orphelines_avec_suivi,  -- <- point d'attention
  (select count(*) from ov where ov.phasage_id = m.phasage_id) as taches_cote_ouvrages
from match m
group by m.chantier, m.phasage_id
order by orphelines_avec_suivi desc, taches_avec_suivi desc;
