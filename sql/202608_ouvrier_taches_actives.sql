-- =====================================================================
-- ESPACE OUVRIER — Tâches « À reprendre » (dashboard)
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller).
-- (create or replace : ré-exécutable sans rien casser.)
--
-- Contexte : une tâche du phasage non terminée à la fin de la journée
-- disparaissait de l'espace ouvrier si le conducteur ne la replaçait pas
-- dans le planning semaine. Cette RPC expose à l'ouvrier connecté ses
-- tâches en retard, sans jamais toucher aux dates ni dupliquer quoi que
-- ce soit.
--
-- Sources de vérité (séparation voulue, ne jamais synchroniser l'une
-- vers l'autre) :
--   - PHASAGE  = état courant de la tâche : date_prevue < aujourd'hui,
--     avancement < 100 décident qu'elle est « à reprendre » ;
--   - PLANNING = affectation opérationnelle par jour : QUI doit la
--     reprendre. Pour la DERNIÈRE occurrence de la tâche dans
--     planning_cells dont la date <= aujourd'hui (jamais une occurrence
--     future) : si la ligne taches[] porte des ouvriers → eux, sinon →
--     les ouvriers de la cellule (même règle que l'interface planning).
--     Sans aucune occurrence passée, repli sur taches[].ouvriers du
--     phasage.
--
-- La table phasages est bureau-only (202607_espace_ouvrier_phase0.sql) :
-- même patron que ouvrier_chantier_detail — SECURITY DEFINER, sous-
-- ensemble épuré SANS prix ni taux horaire (nom, dates, avancement,
-- heures réalisées agrégées depuis pointages).
--
-- p_prenom n'est honoré QUE pour un compte bureau (mode aperçu de
-- l'espace ouvrier) : un ouvrier ne voit jamais que ses propres tâches.
-- =====================================================================

create or replace function public.ouvrier_taches_actives(
  p_aujourdhui date default current_date,
  p_prenom     text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_prenom text;
  v_out    jsonb;
begin
  -- Garde : réservé aux comptes de l'application (ouvrier ou bureau).
  if auth.email() is null or public.mon_role() is null then
    return null;
  end if;

  -- Ouvrier : toujours SON prénom. Bureau : prénom passé (aperçu).
  if public.est_ouvrier() then
    v_prenom := public.mon_prenom_planning();
  else
    v_prenom := coalesce(nullif(trim(p_prenom), ''), public.mon_prenom_planning());
  end if;
  if v_prenom is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(x order by x->>'date_prevue', x->>'nom'), '[]'::jsonb)
  into v_out
  from (
    select jsonb_build_object(
      'chantier_id',  ph.chantier_id,
      'chantier_nom', ph.chantier_nom,
      'tache_id',     t->>'id',
      'nom',          t->>'nom',
      'date_prevue',  left(t->>'date_prevue', 10),
      'avancement',   least(100, greatest(0,
        case when (t->>'avancement') ~ '^[0-9]+(\.[0-9]+)?$'
             then (t->>'avancement')::numeric else 0 end))::int,
      'heures_reelles', coalesce((
        select sum(p.heures)
        from public.pointages p
        where p.chantier_id = ph.chantier_id
          and p.tache_id = t->>'id'
          and p.type_pointage = 'tache'
      ), 0)
    ) as x
    from (
      -- En cas de doublon de phasage sur un chantier, on garde le premier
      -- (même tolérance que loadPhasagesOperation côté front).
      select distinct on (chantier_id) id, chantier_id, chantier_nom, ouvrages
      from public.phasages
      order by chantier_id
    ) ph
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(ph.ouvrages) = 'array' then ph.ouvrages else '[]'::jsonb end
    ) o
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(o->'taches') = 'array' then o->'taches' else '[]'::jsonb end
    ) t
    -- Équipe effective : DERNIÈRE occurrence planning de la tâche (par
    -- tache_id, clé de rapprochement) dont la date <= aujourd'hui.
    -- Ligne avec ouvriers → la ligne ; sinon → la cellule (ouvriers text[]).
    left join lateral (
      select occ.ouvriers_eff
      from (
        select
          to_date(
            left(pc.week_id, 4)
            || lpad(split_part(pc.week_id, 'W', 2), 2, '0')
            || case pc.jour
                 when 'Lundi' then '1' when 'Mardi'    then '2'
                 when 'Mercredi' then '3' when 'Jeudi' then '4'
                 when 'Vendredi' then '5' when 'Samedi' then '6'
                 else '7'
               end,
            'IYYYIWID'
          ) as d,
          case when jsonb_typeof(lt->'ouvriers') = 'array'
                    and jsonb_array_length(lt->'ouvriers') > 0
               then lt->'ouvriers'
               else coalesce(to_jsonb(pc.ouvriers), '[]'::jsonb)
          end as ouvriers_eff
        from public.planning_cells pc
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(pc.taches) = 'array' then pc.taches else '[]'::jsonb end
        ) lt
        where pc.chantier_id = ph.chantier_id
          and lt->>'tache_id' = t->>'id'
          and pc.week_id ~ '^\d{4}-W\d{1,2}$'
          and split_part(pc.week_id, 'W', 2)::int between 1 and 53
          and pc.jour in ('Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche')
      ) occ
      where occ.d <= p_aujourdhui
      order by occ.d desc
      limit 1
    ) plan_occ on true
    where coalesce(t->'externe' = 'true'::jsonb, false) = false
      and coalesce(
            plan_occ.ouvriers_eff,
            case when jsonb_typeof(t->'ouvriers') = 'array'
                 then t->'ouvriers' else '[]'::jsonb end
          ) ? v_prenom
      and (t->>'date_prevue') ~ '^\d{4}-\d{2}-\d{2}'
      and left(t->>'date_prevue', 10)::date < p_aujourdhui
      and (case when (t->>'avancement') ~ '^[0-9]+(\.[0-9]+)?$'
                then (t->>'avancement')::numeric else 0 end) < 100
  ) sub;

  return v_out;
end;
$$;

revoke all on function public.ouvrier_taches_actives(date, text) from public;
revoke all on function public.ouvrier_taches_actives(date, text) from anon;
grant execute on function public.ouvrier_taches_actives(date, text) to authenticated;


-- =====================================================================
-- REQUÊTE DE CONTRÔLE (lecture seule, à exécuter après la migration)
-- =====================================================================
-- Sur les tâches du phasage NON terminées dont une occurrence planning
-- tombait HIER, compare :
--   total          : tâches non terminées planifiées hier ;
--   ancienne_logique : celles qu'au moins un ouvrier voyait via l'ancien
--                      filtre (taches[].ouvriers du phasage non vide) ;
--   nouvelle_logique : celles visibles avec l'équipe effective planning
--                      (ligne → cellule → repli phasage).
-- Les tâches « récupérées » = nouvelle_logique - ancienne_logique.
-- =====================================================================
with occurrences as (
  select
    pc.chantier_id,
    lt->>'tache_id' as tache_id,
    to_date(
      left(pc.week_id, 4) || lpad(split_part(pc.week_id, 'W', 2), 2, '0')
      || case pc.jour
           when 'Lundi' then '1' when 'Mardi' then '2' when 'Mercredi' then '3'
           when 'Jeudi' then '4' when 'Vendredi' then '5' when 'Samedi' then '6'
           else '7'
         end,
      'IYYYIWID'
    ) as d,
    case when jsonb_typeof(lt->'ouvriers') = 'array'
              and jsonb_array_length(lt->'ouvriers') > 0
         then lt->'ouvriers'
         else coalesce(to_jsonb(pc.ouvriers), '[]'::jsonb)
    end as ouvriers_eff
  from public.planning_cells pc
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(pc.taches) = 'array' then pc.taches else '[]'::jsonb end
  ) lt
  where lt->>'tache_id' is not null
    and pc.week_id ~ '^\d{4}-W\d{1,2}$'
    and split_part(pc.week_id, 'W', 2)::int between 1 and 53
    and pc.jour in ('Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche')
),
taches_hier as (
  select
    ph.chantier_id,
    t->>'id'  as tache_id,
    t->>'nom' as nom,
    case when jsonb_typeof(t->'ouvriers') = 'array'
         then t->'ouvriers' else '[]'::jsonb end as ouvriers_phasage
  from (
    select distinct on (chantier_id) chantier_id, ouvrages
    from public.phasages order by chantier_id
  ) ph
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(ph.ouvrages) = 'array' then ph.ouvrages else '[]'::jsonb end
  ) o
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(o->'taches') = 'array' then o->'taches' else '[]'::jsonb end
  ) t
  where coalesce(t->'externe' = 'true'::jsonb, false) = false
    and (case when (t->>'avancement') ~ '^[0-9]+(\.[0-9]+)?$'
              then (t->>'avancement')::numeric else 0 end) < 100
    and exists (
      select 1 from occurrences oc
      where oc.chantier_id = ph.chantier_id
        and oc.tache_id = t->>'id'
        and oc.d = current_date - 1
    )
),
eval as (
  select
    th.*,
    jsonb_array_length(th.ouvriers_phasage) > 0 as visible_ancienne,
    coalesce(jsonb_array_length((
      select oc.ouvriers_eff from occurrences oc
      where oc.chantier_id = th.chantier_id
        and oc.tache_id = th.tache_id
        and oc.d <= current_date
      order by oc.d desc limit 1
    )), jsonb_array_length(th.ouvriers_phasage)) > 0 as visible_nouvelle
  from taches_hier th
)
select
  count(*)                                    as total_non_terminees_hier,
  count(*) filter (where visible_ancienne)    as visibles_ancienne_logique,
  count(*) filter (where visible_nouvelle)    as visibles_nouvelle_logique,
  count(*) filter (where visible_nouvelle and not visible_ancienne) as recuperees
from eval;
