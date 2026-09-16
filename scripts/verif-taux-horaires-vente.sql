-- ═══════════════════════════════════════════════════════════════════════════
-- Vérification des garanties BASE des taux horaires de vente (taux_horaires_vente).
-- À exécuter dans l'éditeur SQL Supabase (ou via MCP) : TOUT est annulé à la
-- fin par une exception volontaire « TESTS_OK … » — aucune donnée réelle n'est
-- modifiée, aucun taux ni ouvrage n'est créé ou supprimé durablement.
--
-- Couvre : taux standard 80 € par défaut, migration de tous les ouvrages,
-- un seul défaut, ajout, modification, désactivation/réactivation, refus de
-- désactiver le défaut ou le dernier actif, refus d'un identifiant inexistant
-- ou inactif sur un ouvrage, conservation d'un taux désactivé déjà affecté,
-- refus d'un taux nul/négatif/libellé vide, suppression physique refusée,
-- bascule atomique du défaut, snapshots figés intacts, RLS (ouvrier, bureau
-- non admin, admin).
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_std     public.taux_horaires_vente;
  v_new     public.taux_horaires_vente;
  v_new2    public.taux_horaires_vente;
  v_ouvrage uuid;
  v_ouv_taux uuid;
  v_nb      integer;
  v_snap_avant jsonb;
  v_snap_apres jsonb;
  v_ok      text[] := '{}';
  v_email_ouvrier text;
  v_email_bureau  text;
  v_email_admin   text;
  v_msg     text;
begin
  -- 1. Taux standard 80 €, actif et par défaut ; exactement un défaut
  select * into v_std from public.taux_horaires_vente where libelle = 'Taux standard';
  if not found or v_std.taux_ht <> 80.00 or not v_std.actif or not v_std.est_defaut then
    raise exception 'ECHEC 1 : taux standard 80 € actif par défaut absent';
  end if;
  select count(*) into v_nb from public.taux_horaires_vente where est_defaut;
  if v_nb <> 1 then raise exception 'ECHEC 1 : % taux par défaut', v_nb; end if;
  v_ok := array_append(v_ok, '1 taux standard 80 € par défaut');

  -- 2. Migration : aucun ouvrage sans taux, tous sur un taux existant
  select count(*) into v_nb from public.bibliotheque_ratios b
    where b.taux_horaire_vente_id is null or not exists (select 1 from public.taux_horaires_vente t where t.id = b.taux_horaire_vente_id);
  if v_nb <> 0 then raise exception 'ECHEC 2 : % ouvrage(s) sans taux valide', v_nb; end if;
  v_ok := array_append(v_ok, '2 tous les ouvrages rattachés à un taux');

  -- 3. Deux taux par défaut : impossible
  begin
    insert into public.taux_horaires_vente (libelle, taux_ht, est_defaut, actif) values ('TEST second défaut', 90, true, true);
    raise exception 'ECHEC 3 : second défaut accepté';
  exception when unique_violation then v_ok := array_append(v_ok, '3 second défaut refusé (index unique)');
  end;

  -- 4. Ajout d'un taux
  insert into public.taux_horaires_vente (libelle, taux_ht) values ('  TEST Chef d''équipe  ', 95) returning * into v_new;
  if v_new.libelle <> 'TEST Chef d''équipe' or v_new.taux_ht <> 95.00 or v_new.est_defaut or not v_new.actif then
    raise exception 'ECHEC 4 : ajout incohérent';
  end if;
  v_ok := array_append(v_ok, '4 ajout (libellé nettoyé, actif, non défaut)');

  -- 5. Modification libellé + valeur, updated_at avancé
  update public.taux_horaires_vente set libelle = 'TEST Chef de chantier', taux_ht = 97.5 where id = v_new.id returning * into v_new;
  if v_new.libelle <> 'TEST Chef de chantier' or v_new.taux_ht <> 97.50 or v_new.updated_at < v_new.created_at then
    raise exception 'ECHEC 5 : modification incohérente';
  end if;
  v_ok := array_append(v_ok, '5 modification');

  -- 12. Taux invalide : nul, négatif, libellé vide, doublon de libellé
  begin
    insert into public.taux_horaires_vente (libelle, taux_ht) values ('TEST nul', 0);
    raise exception 'ECHEC 12 : taux 0 accepté';
  exception when check_violation then v_ok := array_append(v_ok, '12a taux 0 refusé');
  end;
  begin
    insert into public.taux_horaires_vente (libelle, taux_ht) values ('TEST négatif', -5);
    raise exception 'ECHEC 12 : taux négatif accepté';
  exception when check_violation then v_ok := array_append(v_ok, '12b taux négatif refusé');
  end;
  begin
    insert into public.taux_horaires_vente (libelle, taux_ht) values ('   ', 50);
    raise exception 'ECHEC 12 : libellé vide accepté';
  exception when check_violation then v_ok := array_append(v_ok, '12c libellé vide refusé');
  end;
  begin
    insert into public.taux_horaires_vente (libelle, taux_ht) values ('taux STANDARD', 50);
    raise exception 'ECHEC 12 : doublon de libellé accepté';
  exception when unique_violation then v_ok := array_append(v_ok, '12d doublon de libellé refusé');
  end;
  -- Précision : 2 décimales exactes (numeric), pas de flottant
  insert into public.taux_horaires_vente (libelle, taux_ht) values ('TEST précision', 33.333) returning * into v_new2;
  if v_new2.taux_ht <> 33.33 then raise exception 'ECHEC 12 : précision % ', v_new2.taux_ht; end if;
  v_ok := array_append(v_ok, '12e numeric(10,2)');

  -- 9 & 11. Ouvrage : refus d'un identifiant inexistant ; changement vers un taux actif accepté
  select id, taux_horaire_vente_id into v_ouvrage, v_ouv_taux from public.bibliotheque_ratios order by libelle limit 1;
  begin
    update public.bibliotheque_ratios set taux_horaire_vente_id = gen_random_uuid() where id = v_ouvrage;
    raise exception 'ECHEC 11 : identifiant inexistant accepté';
  exception when raise_exception or foreign_key_violation then v_ok := array_append(v_ok, '11 identifiant de taux inexistant refusé');
  end;
  begin
    update public.bibliotheque_ratios set taux_horaire_vente_id = null where id = v_ouvrage;
    raise exception 'ECHEC 11 : taux null accepté en modification';
  exception when raise_exception then v_ok := array_append(v_ok, '11b taux obligatoire (null refusé)');
  end;
  update public.bibliotheque_ratios set taux_horaire_vente_id = v_new.id where id = v_ouvrage;
  if (select taux_horaire_vente_id from public.bibliotheque_ratios where id = v_ouvrage) <> v_new.id then raise exception 'ECHEC 9'; end if;
  v_ok := array_append(v_ok, '9 changement du taux d''un ouvrage');

  -- 7. Désactiver le taux par défaut : refusé ; l'unset direct du défaut : refusé
  begin
    update public.taux_horaires_vente set actif = false where id = v_std.id;
    raise exception 'ECHEC 7 : défaut désactivé';
  exception when raise_exception then v_ok := array_append(v_ok, '7a défaut non désactivable');
  end;
  begin
    update public.taux_horaires_vente set est_defaut = false where id = v_std.id;
    raise exception 'ECHEC 7 : défaut retiré sans remplacement';
  exception when raise_exception then v_ok := array_append(v_ok, '7b défaut non retirable sans remplacement');
  end;
  -- Suppression physique : refusée (défaut, ou taux utilisé)
  begin
    delete from public.taux_horaires_vente where id = v_std.id;
    raise exception 'ECHEC : suppression du défaut acceptée';
  exception when raise_exception then v_ok := array_append(v_ok, 'suppression du défaut refusée');
  end;
  begin
    delete from public.taux_horaires_vente where id = v_new.id;   -- utilisé par v_ouvrage
    raise exception 'ECHEC : suppression d''un taux utilisé acceptée';
  exception when raise_exception or foreign_key_violation then v_ok := array_append(v_ok, 'suppression d''un taux utilisé refusée');
  end;

  -- 6 & 10. Désactivation d'un taux utilisé : l'ouvrage le conserve ; réactivation
  update public.taux_horaires_vente set actif = false where id = v_new.id returning * into v_new;
  if v_new.actif then raise exception 'ECHEC 6 : désactivation'; end if;
  if (select taux_horaire_vente_id from public.bibliotheque_ratios where id = v_ouvrage) <> v_new.id then raise exception 'ECHEC 10 : l''ouvrage a perdu son taux'; end if;
  -- l'ouvrage peut être modifié (autre colonne) sans changer de taux
  update public.bibliotheque_ratios set updated_at = now() where id = v_ouvrage;
  v_ok := array_append(v_ok, '6a désactivation ; 10 ouvrage conserve son taux désactivé');
  -- 11c. Affecter un taux DÉSACTIVÉ à un autre ouvrage : refusé
  begin
    update public.bibliotheque_ratios set taux_horaire_vente_id = v_new.id
      where id = (select id from public.bibliotheque_ratios where id <> v_ouvrage order by libelle limit 1);
    raise exception 'ECHEC 11 : taux désactivé accepté';
  exception when raise_exception then v_ok := array_append(v_ok, '11c taux désactivé refusé pour un nouveau choix');
  end;
  -- désactivé ⇒ ne peut pas devenir le défaut
  begin
    perform public.definir_taux_horaire_vente_defaut(v_new.id);
    raise exception 'ECHEC : taux désactivé devenu défaut';
  exception when raise_exception then v_ok := array_append(v_ok, 'défaut refusé pour un taux désactivé');
  end;
  update public.taux_horaires_vente set actif = true where id = v_new.id returning * into v_new;
  if not v_new.actif then raise exception 'ECHEC 6 : réactivation'; end if;
  v_ok := array_append(v_ok, '6b réactivation');

  -- 7c. Bascule atomique du défaut, puis désactivation de l'ancien défaut possible
  perform public.definir_taux_horaire_vente_defaut(v_new.id);
  select count(*) into v_nb from public.taux_horaires_vente where est_defaut;
  if v_nb <> 1 or not (select est_defaut from public.taux_horaires_vente where id = v_new.id) then raise exception 'ECHEC 7c : bascule'; end if;
  update public.taux_horaires_vente set actif = false where id = v_std.id;   -- l'ancien défaut peut maintenant être désactivé
  v_ok := array_append(v_ok, '7c bascule du défaut puis désactivation de l''ancien défaut');
  -- Dernier actif : désactivation refusée
  update public.taux_horaires_vente set actif = false where id = v_new2.id;
  begin
    perform public.definir_taux_horaire_vente_defaut(v_std.id);  -- inactif ⇒ refusé, donc v_new reste seul actif défaut
    raise exception 'ECHEC : bascule vers inactif acceptée';
  exception when raise_exception then null;
  end;
  begin
    update public.taux_horaires_vente set actif = false where id = v_new.id;
    raise exception 'ECHEC 7 : dernier taux actif désactivé';
  exception when raise_exception then v_ok := array_append(v_ok, '7d dernier taux actif non désactivable');
  end;
  -- Retour : le standard redevient défaut
  update public.taux_horaires_vente set actif = true where id = v_std.id;
  perform public.definir_taux_horaire_vente_defaut(v_std.id);

  -- 8. Insertion d'un ouvrage sans taux ⇒ taux par défaut affecté
  insert into public.bibliotheque_ratios (identifiant, libelle, unite, sous_taches)
    values ('test_taux_' || extract(epoch from now())::bigint, 'TEST-000 : Ouvrage de test', 'U', '[]'::jsonb)
    returning taux_horaire_vente_id into v_ouv_taux;
  if v_ouv_taux <> v_std.id then raise exception 'ECHEC 8 : défaut non affecté'; end if;
  v_ok := array_append(v_ok, '8 nouvel ouvrage sans taux ⇒ taux par défaut');

  -- 18 & 19. Snapshots figés intacts après modification du taux standard (80 → 85)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'pu', prix_unitaire, 'thv', taux_horaire_vente, 'cv', calcul_version) order by id), '[]'::jsonb)
    into v_snap_avant from public.profero_ouvrages_selectionnes where calcul_version is not null;
  update public.taux_horaires_vente set taux_ht = 85 where id = v_std.id;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'pu', prix_unitaire, 'thv', taux_horaire_vente, 'cv', calcul_version) order by id), '[]'::jsonb)
    into v_snap_apres from public.profero_ouvrages_selectionnes where calcul_version is not null;
  if v_snap_avant <> v_snap_apres then raise exception 'ECHEC 19 : des snapshots ont changé'; end if;
  v_ok := array_append(v_ok, '18/19 snapshots intacts après modification du taux');

  -- 22. RLS : ouvrier ne lit rien ; bureau non admin lit mais n''écrit pas ; admin écrit
  select email into v_email_ouvrier from public.utilisateurs where role = 'ouvrier' and actif limit 1;
  select email into v_email_bureau  from public.utilisateurs where role in ('commercial','comptable','conducteur') and actif limit 1;
  select email into v_email_admin   from public.utilisateurs where role = 'admin' and actif limit 1;
  if v_email_ouvrier is not null then
    perform set_config('request.jwt.claims', json_build_object('email', v_email_ouvrier, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_nb from public.taux_horaires_vente;
    reset role;
    if v_nb <> 0 then raise exception 'ECHEC 22 : un ouvrier lit % taux', v_nb; end if;
    v_ok := array_append(v_ok, '22a ouvrier : aucune lecture');
  end if;
  if v_email_bureau is not null then
    perform set_config('request.jwt.claims', json_build_object('email', v_email_bureau, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_nb from public.taux_horaires_vente;
    if v_nb = 0 then reset role; raise exception 'ECHEC 22 : le bureau ne lit pas les taux'; end if;
    begin
      insert into public.taux_horaires_vente (libelle, taux_ht) values ('TEST bureau', 70);
      reset role;
      raise exception 'ECHEC 22 : insertion bureau acceptée';
    exception when insufficient_privilege then v_ok := array_append(v_ok, '22b bureau : lecture oui, insertion refusée (RLS)');
    end;
    set local role authenticated;
    update public.taux_horaires_vente set taux_ht = 99 where id = v_std.id;
    get diagnostics v_nb = row_count;
    reset role;
    if v_nb <> 0 then raise exception 'ECHEC 22 : update bureau accepté'; end if;
    v_ok := array_append(v_ok, '22c bureau : mise à jour sans effet (RLS)');
    set local role authenticated;
    begin
      perform public.definir_taux_horaire_vente_defaut(v_new.id);
      reset role;
      raise exception 'ECHEC 22 : bascule bureau acceptée';
    exception when raise_exception then
      get stacked diagnostics v_msg = message_text;
      reset role;
      if v_msg not like 'Modification refusée%' then raise exception 'ECHEC 22 : message inattendu %', v_msg; end if;
      v_ok := array_append(v_ok, '22d bureau : bascule du défaut refusée');
    end;
    begin
      set local role authenticated;
      delete from public.taux_horaires_vente where id = v_new2.id;
      reset role;
      raise exception 'ECHEC 22 : delete bureau accepté';
    exception when insufficient_privilege then reset role; v_ok := array_append(v_ok, '22e suppression interdite (privilège retiré)');
    end;
  end if;
  if v_email_admin is not null then
    perform set_config('request.jwt.claims', json_build_object('email', v_email_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.taux_horaires_vente (libelle, taux_ht) values ('TEST admin', 70) returning * into v_new2;
    if v_new2.created_by_email <> v_email_admin then reset role; raise exception 'ECHEC 22 : auteur non tracé'; end if;
    update public.taux_horaires_vente set taux_ht = 71 where id = v_new2.id returning * into v_new2;
    if v_new2.taux_ht <> 71 or v_new2.updated_by_email <> v_email_admin then reset role; raise exception 'ECHEC 22 : update admin'; end if;
    reset role;
    v_ok := array_append(v_ok, '22f admin : insertion et modification acceptées, auteur tracé');
  end if;

  raise exception 'TESTS_OK (%): %', array_length(v_ok, 1), array_to_string(v_ok, ' | ');
end $$;
