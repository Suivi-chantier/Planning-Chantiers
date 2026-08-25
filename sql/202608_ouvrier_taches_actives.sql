-- =====================================================================
-- ESPACE OUVRIER — Tâches « À reprendre » (dashboard)
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller).
--
-- Contexte : une tâche du phasage non terminée à la fin de la journée
-- disparaissait de l'espace ouvrier si le conducteur ne la replaçait pas
-- dans le planning semaine. Le phasage reste LA source de vérité de
-- l'état courant (date_prevue, avancement) : cette RPC expose à
-- l'ouvrier connecté ses tâches en retard (date_prevue < aujourd'hui,
-- avancement < 100), sans jamais toucher aux dates ni dupliquer quoi
-- que ce soit.
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
    where coalesce(t->'externe' = 'true'::jsonb, false) = false
      and jsonb_typeof(t->'ouvriers') = 'array'
      and t->'ouvriers' ? v_prenom
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
