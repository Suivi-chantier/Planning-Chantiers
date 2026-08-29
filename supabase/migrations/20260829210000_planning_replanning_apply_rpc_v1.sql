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
--   "phasage_guard_version": 1,
--   "application_autorisable": true,
--   "start_date": "YYYY-MM-DD",
--   "horizon_end": "YYYY-MM-DD",
--   "operations": [...plan_application.operations],
--   "phasage_guards": [...securite_application.phasage_guards],
--   "phasage_updates": [...securite_application.phasage_updates]
-- }
--
-- Principes :
-- - SECURITY INVOKER : aucune élévation de privilèges, la RLS bureau reste active ;
-- - une seule transaction PostgreSQL (un appel de fonction = une transaction) ;
-- - compare-before-write exact sur chaque planning_cell existante ;
-- - tous les phasages touchés sont verrouillés/versionnés, même sans date_prevue modifiée ;
-- - reel/vehicules et lignes hors scope moteur sont immuables côté serveur ;
-- - une allocation manuelle ou verrouillée ne peut jamais être déclarée recalculable ;
-- - une tâche liée encore ouverte ne peut pas perdre tout forecast futur ;
-- - date_prevue est recalculée côté DB depuis le planning final toutes semaines ;
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
  v_phasage_guards jsonb := coalesce(p_request->'phasage_guards', '[]'::jsonb);
  v_phasage_updates jsonb := coalesce(p_request->'phasage_updates', '[]'::jsonb);
  v_op jsonb;
  v_expected jsonb;
  v_after jsonb;
  v_recalc_uids jsonb;
  v_proposed_uids jsonb;
  v_cell public.planning_cells%rowtype;
  v_cell_after public.planning_cells%rowtype;
  v_current_payload jsonb;
  v_expected_payload jsonb;
  v_existing_id uuid;
  v_updated integer := 0;
  v_inserted integer := 0;
  v_phasages_updated integer := 0;
  v_dates_prevue_updated integer := 0;
  v_phasages_locked integer := 0;
  v_dup_uid text;
  v_guard jsonb;
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
  v_count integer;
  v_uid text;
  v_worker text;
  v_line jsonb;
  v_expected_planifie text;
  v_start_date date;
  v_horizon_end date;
  v_db_date date;
  v_has_future boolean;
  v_task_avancement numeric;
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
  if coalesce((p_request->>'phasage_guard_version')::integer, 0) <> 1 then
    raise exception 'planning_replanning_phasage_guard_version_unsupported';
  end if;
  if coalesce((p_request->>'application_autorisable')::boolean, false) is not true then
    raise exception 'planning_replanning_application_not_authorized_by_preview';
  end if;
  if jsonb_typeof(v_operations) <> 'array' or jsonb_array_length(v_operations) = 0 then
    raise exception 'planning_replanning_operations_required';
  end if;
  if jsonb_typeof(v_phasage_guards) <> 'array' then
    raise exception 'planning_replanning_phasage_guards_array_required';
  end if;
  if jsonb_typeof(v_phasage_updates) <> 'array' then
    raise exception 'planning_replanning_phasage_updates_array_required';
  end if;

  begin
    v_start_date := (p_request->>'start_date')::date;
    v_horizon_end := (p_request->>'horizon_end')::date;
  exception when others then
    raise exception 'planning_replanning_horizon_dates_invalid';
  end;
  if v_start_date is null or v_horizon_end is null or v_horizon_end < v_start_date then
    raise exception 'planning_replanning_horizon_dates_invalid';
  end if;

  -- Sérialise les applications via CE RPC. Les écritures manuelles concurrentes
  -- restent détectées par les compare-before-write / updated_at / UNIQUE DB.
  perform pg_advisory_xact_lock(hashtextextended('planning_replanning_apply_v1', 0));

  -- Les gardes doivent être uniques. Un chantier touché ne peut pas être associé
  -- à plusieurs versions de phasage dans le même appel.
  select count(*) into v_count
  from (
    select value->>'phasage_id'
    from jsonb_array_elements(v_phasage_guards)
    group by 1 having count(*) > 1
  ) q;
  if v_count > 0 then
    raise exception 'planning_replanning_duplicate_phasage_guard_id';
  end if;

  select count(*) into v_count
  from (
    select value->>'chantier_id'
    from jsonb_array_elements(v_phasage_guards)
    group by 1 having count(*) > 1
  ) q;
  if v_count > 0 then
    raise exception 'planning_replanning_duplicate_phasage_guard_chantier';
  end if;

  -- 1) Verrouiller et valider toutes les cellules existantes AVANT toute écriture.
  -- Le payload attendu reste la source de vérité de concurrence, mais le serveur
  -- vérifie aussi que le client n'élargit pas discrètement le périmètre métier.
  for v_op in
    select value
    from jsonb_array_elements(v_operations)
    order by value->>'cell_key'
  loop
    v_expected := coalesce(v_op->'expected_before', '{}'::jsonb);
    v_after := coalesce(v_op->'after', '{}'::jsonb);
    v_recalc_uids := coalesce(v_op->'allocation_uids_recalculables_retires_de_cette_cellule', '[]'::jsonb);
    v_proposed_uids := coalesce(v_op->'allocation_uids_proposes_dans_cette_cellule', '[]'::jsonb);

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
       or jsonb_typeof(coalesce(v_after->'vehicules','[]'::jsonb)) <> 'array'
       or jsonb_typeof(v_recalc_uids) <> 'array'
       or jsonb_typeof(v_proposed_uids) <> 'array' then
      raise exception 'planning_replanning_after_arrays_invalid: %', v_op->>'cell_key';
    end if;

    -- Aucun UID vide/dupliqué dans les métadonnées d'opération.
    select count(*) into v_count
    from (
      select value as uid from jsonb_array_elements_text(v_recalc_uids)
      group by 1 having count(*) > 1 or nullif(btrim(value), '') is null
    ) q;
    if v_count > 0 then
      raise exception 'planning_replanning_recalc_uid_invalid: %', v_op->>'cell_key';
    end if;
    select count(*) into v_count
    from (
      select value as uid from jsonb_array_elements_text(v_proposed_uids)
      group by 1 having count(*) > 1 or nullif(btrim(value), '') is null
    ) q;
    if v_count > 0 then
      raise exception 'planning_replanning_proposed_uid_invalid: %', v_op->>'cell_key';
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

      -- Champs hors moteur : jamais mutables via ce RPC.
      if coalesce(v_after->>'reel','') is distinct from coalesce(v_expected_payload->>'reel','') then
        raise exception 'planning_replanning_reel_immutable: %', v_op->>'cell_key';
      end if;
      if coalesce(v_after->'vehicules','[]'::jsonb) is distinct from coalesce(v_expected_payload->'vehicules','[]'::jsonb) then
        raise exception 'planning_replanning_vehicules_immutable: %', v_op->>'cell_key';
      end if;

      -- Chaque UID déclaré recalculable doit exister exactement une fois dans la
      -- cellule source, être lié à une tâche et ne jamais être verrouillé.
      for v_uid in select value from jsonb_array_elements_text(v_recalc_uids)
      loop
        select count(*) into v_count
        from jsonb_array_elements(coalesce(v_expected_payload->'taches','[]'::jsonb)) t
        where t.value->>'allocation_uid' = v_uid;
        if v_count <> 1 then
          raise exception 'planning_replanning_recalc_uid_source_mismatch: %', v_uid;
        end if;

        select value into v_line
        from jsonb_array_elements(coalesce(v_expected_payload->'taches','[]'::jsonb))
        where value->>'allocation_uid' = v_uid;
        if nullif(btrim(v_line->>'tache_id'), '') is null then
          raise exception 'planning_replanning_manual_allocation_not_recalculable: %', v_uid;
        end if;
        if exists (
          select 1 from public.planning_constraints c
          where c.actif = true
            and c.type = 'allocation_lock'
            and c.allocation_id = v_uid
        ) then
          raise exception 'planning_replanning_locked_allocation_not_recalculable: %', v_uid;
        end if;
      end loop;

      -- Toute ligne non déclarée recalculable doit survivre octet-logiquement.
      for v_line in select value from jsonb_array_elements(coalesce(v_expected_payload->'taches','[]'::jsonb))
      loop
        v_uid := nullif(btrim(v_line->>'allocation_uid'), '');
        if v_uid is null then
          raise exception 'planning_replanning_before_line_uid_required: %', v_op->>'cell_key';
        end if;
        if not exists (select 1 from jsonb_array_elements_text(v_recalc_uids) x where x.value = v_uid) then
          select count(*) into v_count
          from jsonb_array_elements(coalesce(v_after->'taches','[]'::jsonb)) t
          where t.value = v_line;
          if v_count <> 1 then
            raise exception 'planning_replanning_preserved_line_changed_or_missing: %', v_uid;
          end if;

          -- Une ligne préservée sans équipe propre dépend de cell.ouvriers : la
          -- cellule ne peut donc pas élargir/réduire son équipe implicitement.
          if jsonb_typeof(v_line->'ouvriers') <> 'array'
             or jsonb_array_length(coalesce(v_line->'ouvriers','[]'::jsonb)) = 0 then
            if coalesce(v_after->'ouvriers','[]'::jsonb) is distinct from coalesce(v_expected_payload->'ouvriers','[]'::jsonb) then
              raise exception 'planning_replanning_preserved_fallback_workers_changed: %', v_uid;
            end if;
          end if;
        end if;
      end loop;
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

      if coalesce(v_after->>'reel','') <> '' then
        raise exception 'planning_replanning_insert_reel_must_be_empty: %', v_op->>'cell_key';
      end if;
      if jsonb_array_length(coalesce(v_after->'vehicules','[]'::jsonb)) <> 0 then
        raise exception 'planning_replanning_insert_vehicules_must_be_empty: %', v_op->>'cell_key';
      end if;
      if jsonb_array_length(v_recalc_uids) <> 0 then
        raise exception 'planning_replanning_insert_cannot_remove_source_uids: %', v_op->>'cell_key';
      end if;
      v_expected_payload := null;
    end if;

    -- Les lignes nouvelles/recalculées de l'état après doivent être exactement
    -- celles déclarées par la proposition. Une ligne manuelle ne peut apparaître.
    for v_line in select value from jsonb_array_elements(coalesce(v_after->'taches','[]'::jsonb))
    loop
      v_uid := nullif(btrim(v_line->>'allocation_uid'), '');
      if v_uid is null then
        raise exception 'planning_replanning_after_line_uid_required: %', v_op->>'cell_key';
      end if;

      if v_expected_payload is null
         or not exists (
           select 1
           from jsonb_array_elements(coalesce(v_expected_payload->'taches','[]'::jsonb)) b
           where b.value->>'allocation_uid' = v_uid
             and not exists (select 1 from jsonb_array_elements_text(v_recalc_uids) x where x.value = v_uid)
         ) then
        if not exists (select 1 from jsonb_array_elements_text(v_proposed_uids) x where x.value = v_uid) then
          raise exception 'planning_replanning_after_line_not_declared_proposed: %', v_uid;
        end if;
        if nullif(btrim(v_line->>'tache_id'), '') is null then
          raise exception 'planning_replanning_proposed_line_must_be_linked: %', v_uid;
        end if;
      end if;

      -- Toute ressource explicite d'une ligne doit appartenir à cell.ouvriers.
      if jsonb_typeof(v_line->'ouvriers') = 'array' then
        for v_worker in select value from jsonb_array_elements_text(v_line->'ouvriers')
        loop
          if not exists (select 1 from jsonb_array_elements_text(coalesce(v_after->'ouvriers','[]'::jsonb)) x where x.value = v_worker) then
            raise exception 'planning_replanning_task_worker_missing_from_cell: % / %', v_uid, v_worker;
          end if;
        end loop;
      end if;
    end loop;

    -- Chaque UID déclaré proposé doit apparaître exactement une fois dans l'état après.
    for v_uid in select value from jsonb_array_elements_text(v_proposed_uids)
    loop
      select count(*) into v_count
      from jsonb_array_elements(coalesce(v_after->'taches','[]'::jsonb)) t
      where t.value->>'allocation_uid' = v_uid;
      if v_count <> 1 then
        raise exception 'planning_replanning_proposed_uid_after_mismatch: %', v_uid;
      end if;
    end loop;

    -- Un nouvel ouvrier de cellule doit être explicitement porté par une ligne.
    for v_worker in select value from jsonb_array_elements_text(coalesce(v_after->'ouvriers','[]'::jsonb))
    loop
      if v_expected_payload is null
         or not exists (select 1 from jsonb_array_elements_text(coalesce(v_expected_payload->'ouvriers','[]'::jsonb)) x where x.value = v_worker) then
        if not exists (
          select 1
          from jsonb_array_elements(coalesce(v_after->'taches','[]'::jsonb)) t
          cross join lateral jsonb_array_elements_text(
            case when jsonb_typeof(t.value->'ouvriers') = 'array' then t.value->'ouvriers' else '[]'::jsonb end
          ) ow(value)
          where ow.value = v_worker
        ) then
          raise exception 'planning_replanning_new_cell_worker_without_task: %', v_worker;
        end if;
      end if;
    end loop;

    -- planifie est un dérivé déterministe des textes uniquement si les tâches ont changé.
    select coalesce(string_agg(t.value->>'text', E'\n' order by t.ord), '') into v_expected_planifie
    from jsonb_array_elements(coalesce(v_after->'taches','[]'::jsonb)) with ordinality t(value, ord)
    where nullif(btrim(coalesce(t.value->>'text','')), '') is not null;

    if v_expected_payload is not null
       and coalesce(v_after->'taches','[]'::jsonb) = coalesce(v_expected_payload->'taches','[]'::jsonb) then
      if coalesce(v_after->>'planifie','') is distinct from coalesce(v_expected_payload->>'planifie','') then
        raise exception 'planning_replanning_planifie_changed_without_task_change: %', v_op->>'cell_key';
      end if;
    elsif coalesce(v_after->>'planifie','') is distinct from coalesce(v_expected_planifie,'') then
      raise exception 'planning_replanning_planifie_not_derived_from_tasks: %', v_op->>'cell_key';
    end if;

    -- Toute opération contenant une tâche liée doit avoir une garde phasage pour
    -- son chantier, indépendamment de la présence d'un patch date_prevue.
    if exists (
      select 1 from jsonb_array_elements(coalesce(v_after->'taches','[]'::jsonb)) t
      where nullif(btrim(t.value->>'tache_id'), '') is not null
    ) or (v_expected_payload is not null and exists (
      select 1 from jsonb_array_elements(coalesce(v_expected_payload->'taches','[]'::jsonb)) t
      where nullif(btrim(t.value->>'tache_id'), '') is not null
    )) then
      select count(*) into v_count
      from jsonb_array_elements(v_phasage_guards) g
      where g.value->>'chantier_id' = v_after->>'chantier_id';
      if v_count <> 1 then
        raise exception 'planning_replanning_touched_chantier_guard_required: %', v_after->>'chantier_id';
      end if;
    end if;
  end loop;

  -- 2) Verrouiller et valider TOUS les phasages touchés AVANT toute écriture.
  for v_guard in
    select value
    from jsonb_array_elements(v_phasage_guards)
    order by value->>'phasage_id'
  loop
    if nullif(btrim(v_guard->>'phasage_id'), '') is null
       or nullif(btrim(v_guard->>'chantier_id'), '') is null
       or nullif(btrim(v_guard->>'expected_updated_at'), '') is null then
      raise exception 'planning_replanning_phasage_guard_required';
    end if;
    v_expected_updated_at := (v_guard->>'expected_updated_at')::timestamptz;

    select * into v_ph
    from public.phasages
    where id = (v_guard->>'phasage_id')::uuid
    for update;

    if not found then
      raise exception 'planning_replanning_phasage_missing: %', v_guard->>'phasage_id';
    end if;
    if v_ph.chantier_id is distinct from v_guard->>'chantier_id' then
      raise exception 'planning_replanning_phasage_chantier_conflict: %', v_guard->>'phasage_id';
    end if;
    if v_ph.updated_at is distinct from v_expected_updated_at then
      raise exception 'planning_replanning_phasage_snapshot_conflict: %', v_guard->>'phasage_id';
    end if;
    v_phasages_locked := v_phasages_locked + 1;
  end loop;

  -- Toute demande de patch date_prevue doit réutiliser exactement une garde.
  for v_ph_update in select value from jsonb_array_elements(v_phasage_updates)
  loop
    if nullif(btrim(v_ph_update->>'phasage_id'), '') is null
       or nullif(btrim(v_ph_update->>'chantier_id'), '') is null
       or nullif(btrim(v_ph_update->>'expected_updated_at'), '') is null then
      raise exception 'planning_replanning_phasage_update_guard_required';
    end if;
    select count(*) into v_count
    from jsonb_array_elements(v_phasage_guards) g
    where g.value->>'phasage_id' = v_ph_update->>'phasage_id'
      and g.value->>'chantier_id' = v_ph_update->>'chantier_id'
      and (g.value->>'expected_updated_at')::timestamptz = (v_ph_update->>'expected_updated_at')::timestamptz;
    if v_count <> 1 then
      raise exception 'planning_replanning_phasage_update_without_matching_guard: %', v_ph_update->>'phasage_id';
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
        '',
        coalesce(array(select jsonb_array_elements_text(coalesce(v_after->'ouvriers','[]'::jsonb))), array[]::text[]),
        coalesce(v_after->'taches', '[]'::jsonb),
        '[]'::jsonb
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

  -- 5) Une allocation recalculable liée à une tâche encore ouverte doit conserver
  -- au moins un forecast à partir de start_date. Cette vérification est faite
  -- APRÈS les écritures mais dans la même transaction : échec = rollback total.
  for v_op in select value from jsonb_array_elements(v_operations)
  loop
    v_expected := coalesce(v_op->'expected_before', '{}'::jsonb);
    if coalesce((v_expected->>'exists')::boolean, false) is not true then
      continue;
    end if;
    v_expected_payload := v_expected->'payload';
    v_recalc_uids := coalesce(v_op->'allocation_uids_recalculables_retires_de_cette_cellule', '[]'::jsonb);

    for v_uid in select value from jsonb_array_elements_text(v_recalc_uids)
    loop
      select value->>'tache_id' into v_task_id
      from jsonb_array_elements(coalesce(v_expected_payload->'taches','[]'::jsonb))
      where value->>'allocation_uid' = v_uid;

      if nullif(btrim(v_task_id), '') is null then
        raise exception 'planning_replanning_recalc_task_id_missing_after_write: %', v_uid;
      end if;

      select exists (
        select 1
        from public.planning_cells pc
        where pc.chantier_id = v_expected_payload->>'chantier_id'
          and pc.week_id ~ '^\d{4}-W\d{2}$'
          and pc.jour in ('Lundi','Mardi','Mercredi','Jeudi','Vendredi')
          and to_date(
            pc.week_id || '-' || case pc.jour
              when 'Lundi' then '1' when 'Mardi' then '2' when 'Mercredi' then '3'
              when 'Jeudi' then '4' when 'Vendredi' then '5' end,
            'IYYY-"W"IW-ID'
          ) >= v_start_date
          and exists (
            select 1 from jsonb_array_elements(coalesce(pc.taches,'[]'::jsonb)) t
            where t.value->>'tache_id' = v_task_id
          )
      ) into v_has_future;

      if not v_has_future then
        select p.* into v_ph
        from public.phasages p
        join lateral jsonb_array_elements(v_phasage_guards) g on g.value->>'phasage_id' = p.id::text
        where g.value->>'chantier_id' = v_expected_payload->>'chantier_id'
        limit 1;
        if not found then
          raise exception 'planning_replanning_open_task_guard_missing_after_write: %', v_task_id;
        end if;

        select case
          when coalesce(t.value->>'avancement','') ~ '^\s*\d+(\.\d+)?\s*$' then (t.value->>'avancement')::numeric
          else 0
        end into v_task_avancement
        from jsonb_array_elements(coalesce(v_ph.ouvrages,'[]'::jsonb)) o
        cross join lateral jsonb_array_elements(coalesce(o.value->'taches','[]'::jsonb)) t
        where t.value->>'id' = v_task_id;

        if not found then
          raise exception 'planning_replanning_open_task_missing_in_guarded_phasage: %', v_task_id;
        end if;
        if coalesce(v_task_avancement,0) < 100 then
          raise exception 'planning_replanning_open_task_forecast_lost: %', v_task_id;
        end if;
      end if;
    end loop;
  end loop;

  -- 6) Patcher date_prevue dans les phasages verrouillés. On part TOUJOURS du
  -- JSON courant relu/locké. La date cible est en plus recalculée côté DB depuis
  -- planning_cells après écriture, toutes semaines confondues.
  for v_ph_update in
    select value
    from jsonb_array_elements(v_phasage_updates)
    order by value->>'phasage_id'
  loop
    select * into v_ph
    from public.phasages
    where id = (v_ph_update->>'phasage_id')::uuid;

    if not found then
      raise exception 'planning_replanning_phasage_missing_after_guard: %', v_ph_update->>'phasage_id';
    end if;

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

      -- Calcul autoritatif DB : premier jour où cette tâche existe dans le planning,
      -- y compris historique passé, exactement comme la sémantique actuelle.
      select min(to_date(
        pc.week_id || '-' || case pc.jour
          when 'Lundi' then '1' when 'Mardi' then '2' when 'Mercredi' then '3'
          when 'Jeudi' then '4' when 'Vendredi' then '5' end,
        'IYYY-"W"IW-ID'
      )) into v_db_date
      from public.planning_cells pc
      where pc.chantier_id = v_ph.chantier_id
        and pc.week_id ~ '^\d{4}-W\d{2}$'
        and pc.jour in ('Lundi','Mardi','Mercredi','Jeudi','Vendredi')
        and exists (
          select 1 from jsonb_array_elements(coalesce(pc.taches,'[]'::jsonb)) t
          where t.value->>'tache_id' = v_task_id
        );

      if v_after_date is distinct from case when v_db_date is null then null else to_char(v_db_date, 'YYYY-MM-DD') end then
        raise exception 'planning_replanning_date_prevue_not_db_derived: %', v_task_id;
      end if;

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
              to_jsonb(coalesce(case when v_db_date is null then null else to_char(v_db_date, 'YYYY-MM-DD') end, '')),
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
    'phasages_locked', v_phasages_locked,
    'phasages_updated', v_phasages_updated,
    'dates_prevue_updated', v_dates_prevue_updated
  );
end;
$function$;

revoke all on function public.apply_planning_replanning_v1(jsonb) from public;
revoke all on function public.apply_planning_replanning_v1(jsonb) from anon;
grant execute on function public.apply_planning_replanning_v1(jsonb) to authenticated;

comment on function public.apply_planning_replanning_v1(jsonb) is
'Chantier 05 V1 — applique atomiquement un plan déjà simulé/confirmé. SECURITY INVOKER ; compare-before-write exact ; tous phasages touchés gardés par updated_at ; reel/vehicules et lignes hors scope immuables ; locks respectés ; tâche ouverte ne perd pas son forecast futur ; date_prevue recalculée côté DB ; rollback intégral au conflit.';
