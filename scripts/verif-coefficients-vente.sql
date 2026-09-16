-- ═══════════════════════════════════════════════════════════════════════════
-- Vérification des garanties BASE des coefficients de vente (coefficients_vente).
-- À exécuter dans l'éditeur SQL Supabase (ou via MCP) : TOUT est annulé à la
-- fin par une exception volontaire « TESTS_OK … » — aucune donnée réelle n'est
-- modifiée, aucun coefficient ni ouvrage n'est créé ou supprimé durablement.
--
-- Couvre : coefficient standard 1,50 actif par défaut, migration de tous les
-- ouvrages, un seul défaut, ajout, modification (libellé, valeur, précision),
-- désactivation/réactivation, refus de désactiver le défaut ou le dernier actif,
-- refus d'un identifiant inexistant ou inactif sur un ouvrage, conservation d'un
-- coefficient désactivé déjà affecté, refus d'une valeur nulle/négative, suppression
-- physique refusée, bascule atomique du défaut, colonnes obsolètes figées,
-- snapshots intacts, RLS (ouvrier, bureau non admin, admin).
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_std     public.coefficients_vente;
  v_new     public.coefficients_vente;
  v_new2    public.coefficients_vente;
  v_ouvrage uuid;
  v_ouv_coef uuid;
  v_nb      integer;
  v_snap_avant jsonb;
  v_snap_apres jsonb;
  v_ok      text[] := '{}';
  v_email_ouvrier text;
  v_email_bureau  text;
  v_email_admin   text;
  v_msg     text;
begin
  select * into v_std from public.coefficients_vente where libelle = 'Coefficient standard';
  if not found or v_std.valeur <> 1.5000 or not v_std.actif or not v_std.est_defaut then
    raise exception 'ECHEC 1/4 : coefficient standard 1,50 actif par défaut absent';
  end if;
  select count(*) into v_nb from public.coefficients_vente where est_defaut;
  if v_nb <> 1 then raise exception 'ECHEC 4 : % coefficients par défaut', v_nb; end if;
  v_ok := array_append(v_ok, '1/4 coefficient standard 1,50 actif par défaut');

  select count(*) into v_nb from public.bibliotheque_ratios b
    where b.coefficient_vente_id is null or not exists (select 1 from public.coefficients_vente c where c.id = b.coefficient_vente_id);
  if v_nb <> 0 then raise exception 'ECHEC 3 : % ouvrage(s) sans coefficient valide', v_nb; end if;
  select count(*) into v_nb from public.bibliotheque_ratios where coefficient_vente_id <> v_std.id;
  if v_nb <> 0 then raise exception 'ECHEC 2 : % ouvrage(s) hors coefficient standard', v_nb; end if;
  v_ok := array_append(v_ok, '2/3 tous les ouvrages rattachés au coefficient standard');

  begin
    insert into public.coefficients_vente (libelle, valeur, est_defaut, actif) values ('TEST second défaut', 1.3, true, true);
    raise exception 'ECHEC 5 : second défaut accepté';
  exception when unique_violation then v_ok := array_append(v_ok, '5 second défaut refusé (index unique)');
  end;

  insert into public.coefficients_vente (libelle, valeur) values ('  TEST Coefficient réduit  ', 1.3) returning * into v_new;
  if v_new.libelle <> 'TEST Coefficient réduit' or v_new.valeur <> 1.3000 or v_new.est_defaut or not v_new.actif then
    raise exception 'ECHEC 8 : ajout incohérent';
  end if;
  v_ok := array_append(v_ok, '8 ajout (libellé nettoyé, actif, non défaut)');

  update public.coefficients_vente set libelle = 'TEST Coefficient renforcé' where id = v_new.id returning * into v_new;
  if v_new.libelle <> 'TEST Coefficient renforcé' then raise exception 'ECHEC 9 : libellé'; end if;
  update public.coefficients_vente set valeur = 1.675 where id = v_new.id returning * into v_new;
  if v_new.valeur <> 1.6750 or v_new.updated_at < v_new.created_at then raise exception 'ECHEC 10 : valeur'; end if;
  v_ok := array_append(v_ok, '9/10 modification du libellé puis de la valeur (1,675 exact)');

  begin
    insert into public.coefficients_vente (libelle, valeur) values ('TEST nul', 0);
    raise exception 'ECHEC 12 : valeur 0 acceptée';
  exception when check_violation then v_ok := array_append(v_ok, '12a valeur 0 refusée');
  end;
  begin
    insert into public.coefficients_vente (libelle, valeur) values ('TEST négatif', -1.5);
    raise exception 'ECHEC 12 : valeur négative acceptée';
  exception when check_violation then v_ok := array_append(v_ok, '12b valeur négative refusée');
  end;
  begin
    insert into public.coefficients_vente (libelle, valeur) values ('   ', 1.2);
    raise exception 'ECHEC : libellé vide accepté';
  exception when check_violation then v_ok := array_append(v_ok, 'libellé vide refusé');
  end;
  begin
    insert into public.coefficients_vente (libelle, valeur) values ('coefficient STANDARD', 1.2);
    raise exception 'ECHEC : doublon de libellé accepté';
  exception when unique_violation then v_ok := array_append(v_ok, 'doublon de libellé refusé');
  end;
  insert into public.coefficients_vente (libelle, valeur) values ('TEST précision', 1.23456) returning * into v_new2;
  if v_new2.valeur <> 1.2346 then raise exception 'ECHEC : précision %', v_new2.valeur; end if;
  v_ok := array_append(v_ok, 'numeric(8,4) : 1,25 / 1,50 / 1,675 exacts');

  select id, coefficient_vente_id into v_ouvrage, v_ouv_coef from public.bibliotheque_ratios order by libelle limit 1;
  begin
    update public.bibliotheque_ratios set coefficient_vente_id = gen_random_uuid() where id = v_ouvrage;
    raise exception 'ECHEC 13 : identifiant inexistant accepté';
  exception when raise_exception or foreign_key_violation then v_ok := array_append(v_ok, '13 identifiant de coefficient inexistant refusé');
  end;
  begin
    update public.bibliotheque_ratios set coefficient_vente_id = null where id = v_ouvrage;
    raise exception 'ECHEC : coefficient null accepté en modification';
  exception when raise_exception then v_ok := array_append(v_ok, 'coefficient obligatoire (null refusé)');
  end;
  update public.bibliotheque_ratios set coefficient_vente_id = v_new.id where id = v_ouvrage;
  if (select coefficient_vente_id from public.bibliotheque_ratios where id = v_ouvrage) <> v_new.id then raise exception 'ECHEC 18'; end if;
  v_ok := array_append(v_ok, '18 changement du coefficient d''un ouvrage');

  -- Colonnes obsolètes figées : coef_vente / taux_marge_pct ne sont plus modifiables
  begin
    update public.bibliotheque_ratios set coef_vente = 1.9 where id = v_ouvrage;
    raise exception 'ECHEC : coef_vente (obsolète) modifiable';
  exception when raise_exception then v_ok := array_append(v_ok, 'coef_vente obsolète : écriture refusée');
  end;
  begin
    update public.bibliotheque_ratios set taux_marge_pct = 40 where id = v_ouvrage;
    raise exception 'ECHEC : taux_marge_pct (obsolète) modifiable';
  exception when raise_exception then v_ok := array_append(v_ok, 'taux_marge_pct obsolète : écriture refusée');
  end;
  begin
    insert into public.bibliotheque_ratios (identifiant, libelle, unite, sous_taches, coef_vente)
      values ('test_coef_' || extract(epoch from now())::bigint, 'TEST-000 : Ouvrage de test', 'U', '[]'::jsonb, 1.4);
    raise exception 'ECHEC : insertion avec coef_vente acceptée';
  exception when raise_exception then v_ok := array_append(v_ok, 'insertion avec coef_vente refusée');
  end;
  -- Une mise à jour SANS toucher ces colonnes reste possible (l'ouvrage garde ses anciennes valeurs)
  update public.bibliotheque_ratios set updated_at = now() where id = v_ouvrage;

  begin
    update public.coefficients_vente set actif = false where id = v_std.id;
    raise exception 'ECHEC 6 : défaut désactivé';
  exception when raise_exception then v_ok := array_append(v_ok, '6a défaut non désactivable');
  end;
  begin
    update public.coefficients_vente set est_defaut = false where id = v_std.id;
    raise exception 'ECHEC 6 : défaut retiré sans remplacement';
  exception when raise_exception then v_ok := array_append(v_ok, '6b défaut non retirable sans remplacement');
  end;
  begin
    delete from public.coefficients_vente where id = v_std.id;
    raise exception 'ECHEC : suppression du défaut acceptée';
  exception when raise_exception then v_ok := array_append(v_ok, 'suppression du défaut refusée');
  end;
  begin
    delete from public.coefficients_vente where id = v_new.id;
    raise exception 'ECHEC : suppression d''un coefficient utilisé acceptée';
  exception when raise_exception or foreign_key_violation then v_ok := array_append(v_ok, 'suppression d''un coefficient utilisé refusée');
  end;

  update public.coefficients_vente set actif = false where id = v_new.id returning * into v_new;
  if v_new.actif then raise exception 'ECHEC 11 : désactivation'; end if;
  if (select coefficient_vente_id from public.bibliotheque_ratios where id = v_ouvrage) <> v_new.id then raise exception 'ECHEC 15 : l''ouvrage a perdu son coefficient'; end if;
  update public.bibliotheque_ratios set updated_at = now() where id = v_ouvrage;
  v_ok := array_append(v_ok, '11a désactivation ; 15 ouvrage conserve son coefficient désactivé');
  begin
    update public.bibliotheque_ratios set coefficient_vente_id = v_new.id
      where id = (select id from public.bibliotheque_ratios where id <> v_ouvrage order by libelle limit 1);
    raise exception 'ECHEC 14 : coefficient désactivé accepté';
  exception when raise_exception then v_ok := array_append(v_ok, '14 coefficient désactivé refusé pour une nouvelle sélection');
  end;
  begin
    perform public.definir_coefficient_vente_defaut(v_new.id);
    raise exception 'ECHEC : coefficient désactivé devenu défaut';
  exception when raise_exception then v_ok := array_append(v_ok, 'défaut refusé pour un coefficient désactivé');
  end;
  update public.coefficients_vente set actif = true where id = v_new.id returning * into v_new;
  if not v_new.actif then raise exception 'ECHEC 11 : réactivation'; end if;
  v_ok := array_append(v_ok, '11b réactivation');

  perform public.definir_coefficient_vente_defaut(v_new.id);
  select count(*) into v_nb from public.coefficients_vente where est_defaut;
  if v_nb <> 1 or not (select est_defaut from public.coefficients_vente where id = v_new.id) then raise exception 'ECHEC : bascule'; end if;
  update public.coefficients_vente set actif = false where id = v_std.id;
  v_ok := array_append(v_ok, 'bascule atomique du défaut puis désactivation de l''ancien défaut');
  update public.coefficients_vente set actif = false where id = v_new2.id;
  begin
    update public.coefficients_vente set actif = false where id = v_new.id;
    raise exception 'ECHEC 7 : dernier coefficient actif désactivé';
  exception when raise_exception then v_ok := array_append(v_ok, '7 dernier coefficient actif non désactivable');
  end;
  update public.coefficients_vente set actif = true where id = v_std.id;
  perform public.definir_coefficient_vente_defaut(v_std.id);

  insert into public.bibliotheque_ratios (identifiant, libelle, unite, sous_taches)
    values ('test_coef_' || extract(epoch from now())::bigint, 'TEST-000 : Ouvrage de test', 'U', '[]'::jsonb)
    returning coefficient_vente_id into v_ouv_coef;
  if v_ouv_coef <> v_std.id then raise exception 'ECHEC 16 : défaut non affecté'; end if;
  v_ok := array_append(v_ok, '16 nouvel ouvrage sans coefficient ⇒ coefficient par défaut');

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'pu', prix_unitaire, 'coef', coef_vente, 'cid', coefficient_vente_id, 'cv', calcul_version, 'cd', calcul_detail) order by id), '[]'::jsonb)
    into v_snap_avant from public.profero_ouvrages_selectionnes where calcul_version is not null;
  update public.coefficients_vente set valeur = 1.6 where id = v_std.id;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'pu', prix_unitaire, 'coef', coef_vente, 'cid', coefficient_vente_id, 'cv', calcul_version, 'cd', calcul_detail) order by id), '[]'::jsonb)
    into v_snap_apres from public.profero_ouvrages_selectionnes where calcul_version is not null;
  if v_snap_avant <> v_snap_apres then raise exception 'ECHEC 26/27 : des snapshots ont changé'; end if;
  v_ok := array_append(v_ok, '26/27 snapshots intacts après modification du coefficient');

  select email into v_email_ouvrier from public.utilisateurs where role = 'ouvrier' and actif limit 1;
  select email into v_email_bureau  from public.utilisateurs where role in ('commercial','comptable','conducteur') and actif limit 1;
  select email into v_email_admin   from public.utilisateurs where role = 'admin' and actif limit 1;
  if v_email_ouvrier is not null then
    perform set_config('request.jwt.claims', json_build_object('email', v_email_ouvrier, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_nb from public.coefficients_vente;
    reset role;
    if v_nb <> 0 then raise exception 'ECHEC 31 : un ouvrier lit % coefficients', v_nb; end if;
    v_ok := array_append(v_ok, '31a ouvrier : aucune lecture');
  end if;
  if v_email_bureau is not null then
    perform set_config('request.jwt.claims', json_build_object('email', v_email_bureau, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_nb from public.coefficients_vente;
    if v_nb = 0 then reset role; raise exception 'ECHEC 31 : le bureau ne lit pas les coefficients'; end if;
    begin
      insert into public.coefficients_vente (libelle, valeur) values ('TEST bureau', 1.4);
      reset role;
      raise exception 'ECHEC 31 : insertion bureau acceptée';
    exception when insufficient_privilege then v_ok := array_append(v_ok, '31b bureau : lecture oui, insertion refusée (RLS)');
    end;
    set local role authenticated;
    update public.coefficients_vente set valeur = 9 where id = v_std.id;
    get diagnostics v_nb = row_count;
    reset role;
    if v_nb <> 0 then raise exception 'ECHEC 31 : update bureau accepté'; end if;
    v_ok := array_append(v_ok, '31c bureau : mise à jour sans effet (RLS)');
    set local role authenticated;
    begin
      perform public.definir_coefficient_vente_defaut(v_new.id);
      reset role;
      raise exception 'ECHEC 31 : bascule bureau acceptée';
    exception when raise_exception then
      get stacked diagnostics v_msg = message_text;
      reset role;
      if v_msg not like 'Modification refusée%' then raise exception 'ECHEC 31 : message inattendu %', v_msg; end if;
      v_ok := array_append(v_ok, '31d bureau : bascule du défaut refusée');
    end;
    begin
      set local role authenticated;
      delete from public.coefficients_vente where id = v_new2.id;
      reset role;
      raise exception 'ECHEC 31 : delete bureau accepté';
    exception when insufficient_privilege then reset role; v_ok := array_append(v_ok, '31e suppression interdite (privilège retiré)');
    end;
  end if;
  if v_email_admin is not null then
    perform set_config('request.jwt.claims', json_build_object('email', v_email_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.coefficients_vente (libelle, valeur) values ('TEST admin', 1.4) returning * into v_new2;
    if v_new2.created_by_email <> v_email_admin then reset role; raise exception 'ECHEC 31 : auteur non tracé'; end if;
    update public.coefficients_vente set valeur = 1.45 where id = v_new2.id returning * into v_new2;
    if v_new2.valeur <> 1.4500 or v_new2.updated_by_email <> v_email_admin then reset role; raise exception 'ECHEC 31 : update admin'; end if;
    reset role;
    v_ok := array_append(v_ok, '31f admin : insertion et modification acceptées, auteur tracé');
  end if;

  raise exception 'TESTS_OK (%): %', array_length(v_ok, 1), array_to_string(v_ok, ' | ');
end $$;
