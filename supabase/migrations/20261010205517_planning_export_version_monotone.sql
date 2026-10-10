-- Chaque écriture doit recevoir une version différente, même à horloge égale.
create or replace function public.planning_export_tracabilite() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  if tg_op = 'UPDATE' then
    new.updated_at := greatest(new.updated_at, old.updated_at + interval '1 microsecond');
  end if;
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke all on function public.planning_export_tracabilite() from public,anon,authenticated;
