-- Chantier 05 — Replanification continue : application transactionnelle V1
--
-- IMPORTANT : cette migration est versionnée dans la branche chantier 05 mais
-- n'est PAS appliquée automatiquement par l'application. Le RPC applique un plan
-- déjà simulé/confirmé et refuse toute écriture si le snapshot a changé.
--
-- Contrat p_request (jsonb) :
-- {
--   "schema_version": 1,
--   "apply_plan_version": 1,
--   "safety_version": 1,
--   "application_autorisable": true,
--   "operations": [...plan_application.operations],
--   "phasage_updates": [...securite_application.phasage_updates]
-- }
--
-- Principes :
-- - SECURITY INVOKER : aucune élévation de privilèges, la RLS bureau reste active ;
-- - une seule transaction PostgreSQL (un appel de fonction = une transaction) ;
-- - compare-before-write exact sur chaque planning_cell existante ;
-- - l'absence attendue d'une cellule est vérifiée avant INSERT ;
-- - tous les phasages concernés sont verrouillés et leur updated_at doit matcher ;
-- - seules les date_prevue ciblées sont patchées dans le JSON courant relu ;
-- - au moindre conflit : exception => rollback intégral ;
-- - aucune suppression de ligne planning_cells : une cellule vide reste une cellule.

create or replace function public.apply_planning_replanning_v1(p_request jsonb)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_operations jsonb := coalesce(p_request->'operations', '[]'::jsonb);
  v_phasage_updates jsonb := coalesce(p_request->'phasage_updates', '[]'::jsonb);
  v_op jsonb;
  v_expected jsonb;
  v_after jsonb;
  v_cell public.planning_cells%rowtype;
  v_cell_after public.planning_cells%rowtype;
  v_current_payload jsonb;
  v_expected_payload jsonb;
  v_existing_id uuid;
  v_updated integer := 0;
  v_inserted integer := 0;
  v_phasages_updated integer := 0;
  v_dates_prevue_updated integer := 0;
  v_dup_uid text;
  v_ph_update jsonb;
  v_ph public.phasages%rowtype;
  v_expected_updated_at timestamptz;
  v_ouvrages jsonb;
  v_rebuilt_ouvrages jsonb;
  v_rebuilt_taches jsonb;
  v_ouvrage jsonb;
  v_tache jsonb;
  v_task_update jsonb;
  v_task_id text;
  v_expected_date text;
  v_after_date text;
  v_actual_date text;
  v_found_count integer;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'planning_replanning_auth_required';
  end if;

  if public.est_ouvrier() then
    raise exception using
      errcode = '42501',
      message = 'planning_replanning_bureau_only';
  end if;

  if jsonb_typeof(p_request) <> 'object' then
    raise exception 'planning_replanning_request_object_required';
  end if;
  if coalesce((p_request->>'schema_version')::integer, 0) <> 1 then
    raise exception 'planning_replanning_schema_version_unsupported';
  end if;
  if coalesce((p_request->>'apply_plan_version')::integer, 0) <> 1 then
    raise exception 'planning_replanning_apply_plan_version_unsupported';
  end if;
  if coalesce((p_request->>'safety_version')::integer, 0) <> 1 then
    raise exception 'planning_replanning_safety_version_unsupported';
  end if;
  if coalesce((p_request->>'application_autorisable')::boolean, false) is not true then
    raise exception 'planning_replanning_application_not_authorized_by_preview';
  end if;
  if jsonb_typeof(v_operations) <> 'array' or jsonb_array_length(v_operations) = 0 then
    raise exception 'planning_replanning_operations_required';
  end if;
  if jsonb_typeof(v_phasage_updates) <> 'array' then
    raise exception 'planning_replanning_phasage_updates_array_required';
  end if;

  -- Sérialise les applications via CE RPC. Les écritures manuelles concurrentes
  -- restent détectées par les compare-before-write / updated_at / UNIQUE DB.
  perform pg_advisory_xact_lock(hashtextextended('planning_replanning_apply_v1', 0));

  -- 1) Verrouiller et valider toutes les cellules existantes AVANT toute écriture.
  -- L'ordre stable limite les risques de deadlock si plusieurs clients appellent
  -- le RPC au même moment.
  for v_op in
    select value
    from jsonb_array_elements(v_operations)
    order by value->>'cell_key'
  loop
    v_expected := coalesce(v_op->'expected_before', '{}'::jsonb);
    v_after := coalesce(v_op->'after', '{}'::jsonb);

    if jsonb_typeof(v_after) <> 'object' then
      raise exception 'planning_replanning_after_object_required: %', v_op->>'cell_key';
    end if;
    if nullif(btrim(v_after->>'week_id'), '') is null
       or nullif(btrim(v_after->>'chantier_id'), '') is null
       or nullif(btrim(v_after->>'jour'), '') is null then
      raise exception 'planning_replanning_after_key_required: %', v_op->>'cell_key';
    end if;
    if jsonb_typeof(coalesce(v_after->'taches','[]'::jsonb)) <> 'array'
       or jsonb_typeof(coalesce(v_after->'ouvriers','[]'::jsonb)) <> 'array'
       or jsonb_typeof(coalesce(v_after->'vehicules','[]'::jsonb)) <> 'array' then
      raise exception 'planning_replanning_after_arrays_invalid: %', v_op->>'cell_key';
    end if;

    if coalesce((v_expected->>'exists')::boolean, false) then
      if nullif(btrim(v_expected->>'id'), '') is null then
        raise exception 'planning_replanning_expected_id_required: %', v_op->>'cell_key';
      end if;

      select * into v_cell
      from public.planning_cells
      where id = (v_expected->>'id')::uuid
      for update;

      if not found then
        raise exception 'planning_replanning_cell_missing: %', v_op->>'cell_key';
      end if;

      if v_cell.week_id is distinct from v_after->>'week_id'
         or v_cell.chantier_id is distinct from v_after->>'chantier_id'
         or v_cell.jour is distinct from v_after->>'jour' then
        raise exception 'planning_replanning_cell_key_conflict: %', v_op->>'cell_key';
      end if;

      v_current_payload := jsonb_build_object(
        'week_id', v_cell.week_id,
        'chantier_id', v_cell.chantier_id,
        'jour', v_cell.jour,
        'planifie', coalesce(v_cell.planifie, ''),
        'reel', coalesce(v_cell.reel, ''),
        'ouvriers', to_jsonb(coalesce(v_cell.ouvriers, array[]::text[])),
        'taches', coalesce(v_cell.taches, '[]'::jsonb),
        'vehicules', coalesce(v_cell.vehicules, '[]'::jsonb)
      );
      v_expected_payload := v_expected->'payload';

      if v_expected_payload is null or v_current_payload is distinct from v_expected_payload then
        raise exception 'planning_replanning_cell_snapshot_conflict: %', v_op->>'cell_key';
      end if;
    else
      -- On ne peut pas verrouiller une ligne absente ; le verrou advisory sérialise
      -- les RPC et la contrainte UNIQUE (week_id,chantier_id,jour) couvre la race
      -- résiduelle avec une écriture directe extérieure à ce RPC.
      select id into v_existing_id
      from public.planning_cells
      where week_id = v_after->>'week_id'
        and chantier_id = v_after->>'chantier_id'
        and jour = v_after->>'jour'
      for update;

      if found then
        raise exception 'planning_replanning_expected_absent_but_exists: %', v_op->>'cell_key';
      end if;
    end if;
  end loop;

  -- 2) Verrouiller et valider les phasages AVANT toute écriture planning.
  for v_ph_update in
    select value
    from jsonb_array_elements(v_phasage_updates)
    order by value->>'phasage_id'
  loop
    if nullif(btrim(v_ph_update->>'phasage_id'), '') is null
       or nullif(btrim(v_ph_update->>'expected_updated_at'), '') is null then
      raise exception 'planning_replanning_phasage_guard_required';
    end if;

    v_expected_updated_at := (v_ph_update->>'expected_updated_at')::timestamptz;

    select * into v_ph
    from public.phasages
    where id = (v_ph_update->>'phasage_id')::uuid
    for update;

    if not found then
      raise exception 'planning_replanning_phasage_missing: %', v_ph_update->>'phasage_id';
    end if;
    if v_ph.chantier_id is distinct from v_ph_update->>'chantier_id' then
      raise exception 'planning_replanning_phasage_chantier_conflict: %', v_ph_update->>'phasage_id';
    end if;
    if v_ph.updated_at is distinct from v_expected_updated_at then
      raise exception 'planning_replanning_phasage_snapshot_conflict: %', v_ph_update->>'phasage_id';
    end if;
  end loop;

  -- 3) Appliquer les cellules. Le trigger allocation_uid peut théoriquement
  -- corriger une entrée invalide ; on relit donc immédiatement et exige que le
  -- payload final soit EXACTEMENT celui demandé, sinon rollback.
  for v_op in
    select value
    from jsonb_array_elements(v_operations)
    order by value->>'cell_key'
  loop
    v_expected := coalesce(v_op->'expected_before', '{}'::jsonb);
    v_after := v_op->'after';

    if coalesce((v_expected->>'exists')::boolean, false) then
      update public.planning_cells
      set
        planifie = coalesce(v_after->>'planifie', ''),
        reel = coalesce(v_after->>'reel', ''),
        ouvriers = coalesce(array(select jsonb_array_elements_text(coalesce(v_after->'ouvriers','[]'::jsonb))), array[]::text[]),
        taches = coalesce(v_after->'taches', '[]'::jsonb),
        vehicules = coalesce(v_after->'vehicules', '[]'::jsonb)
      where id = (v_expected->>'id')::uuid;
      v_updated := v_updated + 1;
    else
      insert into public.planning_cells (week_id, chantier_id, jour, planifie, reel, ouvriers, taches, vehicules)
      values (
        v_after->>'week_id',
        v_after->>'chantier_id',
        v_after->>'jour',
        coalesce(v_after->>'planifie', ''),
        coalesce(v_after->>'reel', ''),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_after->'ouvriers','[]'::jsonb))), array[]::text[]),
        coalesce(v_after->'taches', '[]'::jsonb),
        coalesce(v_after->'vehicules', '[]'::jsonb)
      );
      v_inserted := v_inserted + 1;
    end if;

    select * into v_cell_after
    from public.planning_cells
    where week_id = v_after->>'week_id'
      and chantier_id = v_after->>'chantier_id'
      and jour = v_after->>'jour';

    if not found then
      raise exception 'planning_replanning_cell_write_missing: %', v_op->>'cell_key';
    end if;

    v_current_payload := jsonb_build_object(
      'week_id', v_cell_after.week_id,
      'chantier_id', v_cell_after.chantier_id,
      'jour', v_cell_after.jour,
      'planifie', coalesce(v_cell_after.planifie, ''),
      'reel', coalesce(v_cell_after.reel, ''),
      'ouvriers', to_jsonb(coalesce(v_cell_after.ouvriers, array[]::text[])),
      'taches', coalesce(v_cell_after.taches, '[]'::jsonb),
      'vehicules', coalesce(v_cell_after.vehicules, '[]'::jsonb)
    );

    if v_current_payload is distinct from v_after then
      raise exception 'planning_replanning_cell_postwrite_mismatch: %', v_op->>'cell_key';
    end if;
  end loop;

  -- 4) Défense supplémentaire : allocation_uid doit rester globalement unique.
  select q.uid into v_dup_uid
  from (
    select nullif(btrim(t.value->>'allocation_uid'), '') as uid, count(*) as n
    from public.planning_cells pc
    cross join lateral jsonb_array_elements(coalesce(pc.taches, '[]'::jsonb)) t(value)
    where nullif(btrim(t.value->>'allocation_uid'), '') is not null
    group by 1
    having count(*) > 1
    order by 1
    limit 1
  ) q;

  if v_dup_uid is not null then
    raise exception 'planning_replanning_duplicate_allocation_uid: %', v_dup_uid;
  end if;

  -- 5) Patcher date_prevue dans les phasages verrouillés. On part TOUJOURS du
  -- JSON courant relu/locké, jamais du snapshot envoyé par le client.
  for v_ph_update in
    select value
    from jsonb_array_elements(v_phasage_updates)
    order by value->>'phasage_id'
  loop
    select * into v_ph
    from public.phasages
    where id = (v_ph_update->>'phasage_id')::uuid;

    v_ouvrages := coalesce(v_ph.ouvrages, '[]'::jsonb);

    for v_task_update in
      select value
      from jsonb_array_elements(coalesce(v_ph_update->'task_updates', '[]'::jsonb))
      order by value->>'tache_id'
    loop
      v_task_id := nullif(btrim(v_task_update->>'tache_id'), '');
      if v_task_id is null then
        raise exception 'planning_replanning_task_id_required';
      end if;
      v_expected_date := nullif(left(coalesce(v_task_update->>'expected_date_prevue',''), 10), '');
      v_after_date := nullif(left(coalesce(v_task_update->>'after_date_prevue',''), 10), '');
      v_found_count := 0;
      v_rebuilt_ouvrages := '[]'::jsonb;

      for v_ouvrage in select value from jsonb_array_elements(v_ouvrages)
      loop
        v_rebuilt_taches := '[]'::jsonb;
        for v_tache in select value from jsonb_array_elements(coalesce(v_ouvrage->'taches','[]'::jsonb))
        loop
          if v_tache->>'id' = v_task_id then
            v_found_count := v_found_count + 1;
            v_actual_date := nullif(left(coalesce(v_tache->>'date_prevue',''), 10), '');
            if v_actual_date is distinct from v_expected_date then
              raise exception 'planning_replanning_date_prevue_conflict: %', v_task_id;
            end if;
            v_tache := jsonb_set(
              v_tache,
              '{date_prevue}',
              to_jsonb(coalesce(v_after_date, '')),
              true
            );
          end if;
          v_rebuilt_taches := v_rebuilt_taches || jsonb_build_array(v_tache);
        end loop;
        v_ouvrage := jsonb_set(v_ouvrage, '{taches}', v_rebuilt_taches, true);
        v_rebuilt_ouvrages := v_rebuilt_ouvrages || jsonb_build_array(v_ouvrage);
      end loop;

      if v_found_count = 0 then
        raise exception 'planning_replanning_task_missing_in_phasage: %', v_task_id;
      elsif v_found_count > 1 then
        raise exception 'planning_replanning_task_duplicate_in_phasage: %', v_task_id;
      end if;

      v_ouvrages := v_rebuilt_ouvrages;
      v_dates_prevue_updated := v_dates_prevue_updated + 1;
    end loop;

    if jsonb_array_length(coalesce(v_ph_update->'task_updates','[]'::jsonb)) > 0 then
      update public.phasages
      set ouvrages = v_ouvrages,
          updated_at = now()
      where id = v_ph.id;
      v_phasages_updated := v_phasages_updated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'schema_version', 1,
    'planning_cells_updated', v_updated,
    'planning_cells_inserted', v_inserted,
    'phasages_updated', v_phasages_updated,
    'dates_prevue_updated', v_dates_prevue_updated
  );
end;
$function$;

revoke all on function public.apply_planning_replanning_v1(jsonb) from public;
revoke all on function public.apply_planning_replanning_v1(jsonb) from anon;
grant execute on function public.apply_planning_replanning_v1(jsonb) to authenticated;

comment on function public.apply_planning_replanning_v1(jsonb) is
'Chantier 05 V1 — applique atomiquement un plan de replanification déjà simulé et confirmé. SECURITY INVOKER, compare-before-write planning_cells + garde updated_at phasages, rollback intégral au conflit.';
