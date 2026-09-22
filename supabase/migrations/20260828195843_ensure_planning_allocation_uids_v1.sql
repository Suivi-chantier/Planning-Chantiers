create or replace function public.ensure_planning_cell_allocation_uids_v1()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  item jsonb;
  rebuilt jsonb := '[]'::jsonb;
  seen text[] := array[]::text[];
  uid text;
begin
  if new.taches is null or jsonb_typeof(new.taches) <> 'array' then
    return new;
  end if;

  for item in select value from jsonb_array_elements(new.taches)
  loop
    if jsonb_typeof(item) <> 'object' then
      rebuilt := rebuilt || jsonb_build_array(item);
      continue;
    end if;

    uid := nullif(btrim(item->>'allocation_uid'), '');
    if uid is null or uid = any(seen) then
      uid := gen_random_uuid()::text;
      item := jsonb_set(item, '{allocation_uid}', to_jsonb(uid), true);
    end if;
    seen := array_append(seen, uid);
    rebuilt := rebuilt || jsonb_build_array(item);
  end loop;

  new.taches := rebuilt;
  return new;
end;
$$;

revoke all on function public.ensure_planning_cell_allocation_uids_v1() from public;

drop trigger if exists planning_cells_ensure_allocation_uids_v1 on public.planning_cells;
create trigger planning_cells_ensure_allocation_uids_v1
before insert or update of taches on public.planning_cells
for each row
execute function public.ensure_planning_cell_allocation_uids_v1();

insert into public.data_history(table_name,row_id,op,chantier_id,row_data,changed_by,prev_updated_at)
select 'planning_cells', c.id::text, 'UPDATE', c.chantier_id, to_jsonb(c),
       'planning-baseline-v1-pre-allocation-uid-backfill-2026-08-28', null
from public.planning_cells c;

update public.planning_cells
set taches = taches
where jsonb_typeof(coalesce(taches,'[]'::jsonb)) = 'array'
  and jsonb_array_length(coalesce(taches,'[]'::jsonb)) > 0;
