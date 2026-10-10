create table public.planning_semaine_export (
  week_id text primary key check (week_id ~ '^20[0-9]{2}-W(0[1-9]|[1-4][0-9]|5[0-3])$'),
  objectifs jsonb not null default '[]'::jsonb check (jsonb_typeof(objectifs) = 'array' and jsonb_array_length(objectifs) <= 8),
  remarques text not null default '',
  analyse_job_id uuid references public.ia_jobs(id) on delete set null,
  modifications_manuelles boolean not null default false,
  points_attention jsonb not null default '[]'::jsonb,
  message_analyse text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.planning_semaine_export enable row level security;
revoke all on public.planning_semaine_export from anon, authenticated;
grant select, insert, update on public.planning_semaine_export to authenticated;
grant all on public.planning_semaine_export to service_role;
create policy profero_collaborateurs_seulement on public.planning_semaine_export as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));
create policy planning_export_bureau on public.planning_semaine_export for all to authenticated
  using ((select public.mon_role()) in ('admin','conducteur')) with check ((select public.mon_role()) in ('admin','conducteur'));
create function public.planning_export_tracabilite() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke all on function public.planning_export_tracabilite() from public,anon,authenticated;
create trigger planning_export_tracabilite before insert or update on public.planning_semaine_export
  for each row execute function public.planning_export_tracabilite();
