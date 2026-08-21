-- =====================================================================
-- ESPACE OUVRIER — Plans de la page « Plans » dans l'onglet Chantiers
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller).
--
-- Les plans dessinés dans la page Plans du bureau vivent dans la table
-- public.plans (dessin vectoriel jsonb `data` + miniature PNG data-URL
-- `thumbnail`), verrouillée bureau-only par 202607_espace_ouvrier_phase0
-- (policy bureau_all). Un plan ne contient aucune donnée financière : on
-- l'expose aux ouvriers via deux RPC SECURITY DEFINER, sans toucher la
-- policy de la table.
--
--  1) ouvrier_plans_chantier(chantier_id) : liste légère (miniatures),
--     pour la grille de plans du chantier.
--  2) ouvrier_plan_data(plan_id) : le dessin complet d'UN plan, chargé à
--     la demande quand l'ouvrier ouvre la visionneuse (le blob `data`
--     peut peser lourd, on ne le renvoie jamais en liste).
-- =====================================================================

create or replace function public.ouvrier_plans_chantier(p_chantier_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.email() is null or public.mon_role() is null then null
    else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'name', name,
        'thumbnail', thumbnail,
        'updated_at', updated_at
      ) order by updated_at desc)
      from public.plans
      where chantier_id = p_chantier_id
    ), '[]'::jsonb)
  end;
$$;

create or replace function public.ouvrier_plan_data(p_plan_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.email() is null or public.mon_role() is null then null
    else (
      select jsonb_build_object('id', id, 'name', name, 'data', data)
      from public.plans
      where id = p_plan_id
    )
  end;
$$;

revoke all on function public.ouvrier_plans_chantier(text) from public;
revoke all on function public.ouvrier_plans_chantier(text) from anon;
grant execute on function public.ouvrier_plans_chantier(text) to authenticated;

revoke all on function public.ouvrier_plan_data(uuid) from public;
revoke all on function public.ouvrier_plan_data(uuid) from anon;
grant execute on function public.ouvrier_plan_data(uuid) to authenticated;
