-- Suite de 20260916190000_conditions_vente_ligne.sql : les conditions
-- GLOBALES du chiffrage respectent desormais les derogations de ligne.

-- ─── 6) Conditions GLOBALES : respecter les dérogations de ligne ───────────
-- Le hash des lignes intègre désormais les modes et dérogations : un changement
-- de ligne invalide une simulation globale en cours (et réciproquement, la
-- version du projet est incrémentée par les deux RPC).
create or replace function public.conditions_chiffrage_hash(p_projet_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select encode(sha256(convert_to(
    coalesce((select string_agg(concat_ws('|', o.id::text, coalesce(o.prix_unitaire::text, ''), coalesce(o.calcul_version, ''), coalesce(o.quantite, ''),
                                o.mode_coefficient_ligne, coalesce(o.coefficient_ligne_valeur::text, ''),
                                o.mode_taux_horaire_ligne, coalesce(o.taux_horaire_ligne_valeur::text, '')), ',' order by o.id)
              from public.profero_ouvrages_selectionnes o where o.projet_id = p_projet_id), ''), 'UTF8')), 'hex');
$$;
revoke all on function public.conditions_chiffrage_hash(uuid) from public, anon;
grant execute on function public.conditions_chiffrage_hash(uuid) to authenticated;

create or replace function public.conditions_chiffrage_evaluer(
  p_projet_id uuid,
  p_mode_coefficient text,
  p_coefficient_id uuid,
  p_mode_taux text,
  p_taux_id uuid,
  p_appliquer boolean,
  p_version_attendue integer default null,
  p_hash_attendu text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  proj      public.profero_projets;
  coef      public.coefficients_vente;
  taux      public.taux_horaires_vente;
  l         record;
  v_hash    text;
  v_now     timestamptz := now();
  v_iso     text;
  v_version integer;
  v_heures  numeric; v_cout_mat numeric; v_cout_dir numeric; v_cout_tot numeric;
  v_coef_orig numeric; v_taux_orig numeric; v_coef_appl numeric; v_taux_appl numeric;
  v_coef_orig_lib text; v_taux_orig_lib text;
  v_rc jsonb; v_rt jsonb;
  v_prix_mat numeric; v_prix_dir numeric; v_prix_mo numeric; v_prix numeric; v_marge_pct numeric;
  v_q       numeric;
  v_total_avant numeric := 0; v_total_apres numeric := 0;
  v_marge_avant numeric := 0; v_marge_apres numeric := 0; v_marge_connue boolean := true;
  v_nb_recalc integer := 0; v_nb_ignorees integer := 0; v_nb_sans_snapshot integer := 0; v_nb_inchangees integer := 0;
  v_nb_coef_spec integer := 0; v_nb_taux_spec integer := 0; v_nb_mode_ouvrage integer := 0;
  v_lignes  jsonb := '[]'::jsonb;
  v_ignorees jsonb := '[]'::jsonb;
  v_avertissements text[] := '{}';
  v_raison  text;
  v_detail  jsonb;
  v_change  boolean;
  v_mode_coef text := coalesce(p_mode_coefficient, 'ouvrage');
  v_mode_taux text := coalesce(p_mode_taux, 'ouvrage');
begin
  if v_mode_coef not in ('ouvrage', 'global') or v_mode_taux not in ('ouvrage', 'global') then
    raise exception 'Mode invalide (ouvrage ou global attendu).';
  end if;

  if p_appliquer then
    select * into proj from public.profero_projets where id = p_projet_id for update;
  else
    select * into proj from public.profero_projets where id = p_projet_id;
  end if;
  if not found then
    raise exception 'Chiffrage introuvable ou non accessible.';
  end if;
  if proj.statut = 'signe' then
    raise exception 'Chiffrage signé : ses conditions de vente ne sont plus modifiables.';
  end if;
  if proj.progbat_devis_id is not null then
    v_avertissements := array_append(v_avertissements, 'Un brouillon ProGBat existe déjà pour ce logement (id ' || proj.progbat_devis_id || ') : il ne sera PAS actualisé automatiquement.');
  end if;

  if v_mode_coef = 'global' then
    if p_coefficient_id is null then raise exception 'Coefficient global non sélectionné.'; end if;
    select * into coef from public.coefficients_vente where id = p_coefficient_id;
    if not found then raise exception 'Coefficient de vente introuvable.'; end if;
    if not coef.actif and (proj.mode_coefficient <> 'global' or proj.coefficient_global_id is distinct from coef.id) then
      raise exception 'Le coefficient « % » est désactivé : il ne peut pas être sélectionné.', coef.libelle;
    end if;
    if not coef.actif then v_avertissements := array_append(v_avertissements, 'Coefficient « ' || coef.libelle || ' » désactivé dans les Réglages : sa valeur figée reste utilisée.'); end if;
  end if;
  if v_mode_taux = 'global' then
    if p_taux_id is null then raise exception 'Taux horaire global non sélectionné.'; end if;
    select * into taux from public.taux_horaires_vente where id = p_taux_id;
    if not found then raise exception 'Taux horaire de vente introuvable.'; end if;
    if not taux.actif and (proj.mode_taux_horaire <> 'global' or proj.taux_horaire_global_id is distinct from taux.id) then
      raise exception 'Le taux horaire « % » est désactivé : il ne peut pas être sélectionné.', taux.libelle;
    end if;
    if not taux.actif then v_avertissements := array_append(v_avertissements, 'Taux horaire « ' || taux.libelle || ' » désactivé dans les Réglages : sa valeur figée reste utilisée.'); end if;
  end if;

  v_hash := public.conditions_chiffrage_hash(p_projet_id);
  if p_appliquer then
    if p_version_attendue is null or p_version_attendue <> proj.conditions_version then
      raise exception 'Le chiffrage a été modifié depuis la simulation (version % attendue, % actuelle) : relancer la simulation.', p_version_attendue, proj.conditions_version;
    end if;
    if p_hash_attendu is null or p_hash_attendu <> v_hash then
      raise exception 'Les lignes du chiffrage ont changé depuis la simulation : relancer la simulation.';
    end if;
  end if;

  v_iso := to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  for l in
    select * from public.profero_ouvrages_selectionnes where projet_id = p_projet_id order by id
    for update
  loop
    v_q := coalesce(public.safe_numeric(l.quantite), 0);
    if l.mode_coefficient_ligne = 'specifique' then v_nb_coef_spec := v_nb_coef_spec + 1; end if;
    if l.mode_taux_horaire_ligne = 'specifique' then v_nb_taux_spec := v_nb_taux_spec + 1; end if;
    if l.mode_coefficient_ligne = 'ouvrage' or l.mode_taux_horaire_ligne = 'ouvrage' then v_nb_mode_ouvrage := v_nb_mode_ouvrage + 1; end if;
    if l.prix_unitaire is not null then
      v_total_avant := v_total_avant + v_q * l.prix_unitaire;
      if l.cout_total_unitaire is not null then v_marge_avant := v_marge_avant + v_q * (l.prix_unitaire - l.cout_total_unitaire); else v_marge_connue := false; end if;
    end if;

    if l.calcul_version is null then
      v_nb_sans_snapshot := v_nb_sans_snapshot + 1;
      if l.prix_unitaire is not null then
        v_total_apres := v_total_apres + v_q * l.prix_unitaire;
        if l.cout_total_unitaire is not null then v_marge_apres := v_marge_apres + v_q * (l.prix_unitaire - l.cout_total_unitaire); end if;
      end if;
      continue;
    end if;

    v_detail := coalesce(l.calcul_detail, '{}'::jsonb);
    v_raison := null;
    if coalesce(split_part(l.calcul_version, '@', 1), '0')::int < 2 then
      v_raison := 'ancienne formule (v1) : coefficient sur le coût total et taux horaire d''origine inconnu';
    end if;
    v_heures  := nullif(v_detail->>'heures_unitaires', '')::numeric;
    v_cout_mat := l.cout_materiaux_unitaire;
    v_cout_dir := coalesce(l.cout_direct_unitaire, 0);
    v_cout_tot := l.cout_total_unitaire;
    v_coef_orig := coalesce(l.coefficient_origine_valeur, case when l.coefficient_source is null or l.coefficient_source = 'ouvrage' then l.coef_vente end);
    v_taux_orig := coalesce(l.taux_horaire_origine_valeur, case when l.taux_horaire_source is null or l.taux_horaire_source = 'ouvrage' then l.taux_horaire_vente end);
    v_coef_orig_lib := coalesce(l.coefficient_origine_libelle, case when l.coefficient_source is null or l.coefficient_source = 'ouvrage' then v_detail->>'coefficient_vente_libelle' end);
    v_taux_orig_lib := coalesce(l.taux_horaire_origine_libelle, case when l.taux_horaire_source is null or l.taux_horaire_source = 'ouvrage' then v_detail->>'taux_horaire_vente_libelle' end);
    if v_raison is null and (v_heures is null or v_cout_mat is null) then
      v_raison := 'ligne incomplète (cadence ou coût matériaux figé absent)';
    end if;

    -- Résolution à trois niveaux : la dérogation de la ligne et le mode
    -- « ouvrage » l'emportent sur la condition globale demandée.
    v_rc := public.conditions_ligne_resoudre(l.mode_coefficient_ligne, l.coefficient_ligne_id, l.coefficient_ligne_valeur, l.coefficient_ligne_libelle,
              case when v_mode_coef = 'global' then coef.id end, case when v_mode_coef = 'global' then coef.valeur end, case when v_mode_coef = 'global' then coef.libelle end,
              l.coefficient_vente_id, v_coef_orig, v_coef_orig_lib);
    v_rt := public.conditions_ligne_resoudre(l.mode_taux_horaire_ligne, l.taux_horaire_ligne_id, l.taux_horaire_ligne_valeur, l.taux_horaire_ligne_libelle,
              case when v_mode_taux = 'global' then taux.id end, case when v_mode_taux = 'global' then taux.taux_ht end, case when v_mode_taux = 'global' then taux.libelle end,
              l.taux_horaire_vente_id, v_taux_orig, v_taux_orig_lib);
    v_coef_appl := nullif(v_rc->>'valeur', '')::numeric;
    v_taux_appl := nullif(v_rt->>'valeur', '')::numeric;
    if v_raison is null and v_coef_appl is null then
      v_raison := 'coefficient d''origine de l''ouvrage absent de la ligne';
    end if;
    if v_raison is null and v_taux_appl is null then
      v_raison := 'taux horaire d''origine de l''ouvrage absent de la ligne';
    end if;

    if v_raison is not null then
      v_nb_ignorees := v_nb_ignorees + 1;
      v_ignorees := v_ignorees || jsonb_build_object('id', l.id, 'item', l.item, 'raison', v_raison);
      if l.prix_unitaire is not null then
        v_total_apres := v_total_apres + v_q * l.prix_unitaire;
        if l.cout_total_unitaire is not null then v_marge_apres := v_marge_apres + v_q * (l.prix_unitaire - l.cout_total_unitaire); end if;
      end if;
      continue;
    end if;

    v_prix_mat := round(v_cout_mat * v_coef_appl, 2);
    v_prix_dir := round(v_cout_dir * v_coef_appl, 2);
    v_prix_mo  := round(v_heures * v_taux_appl, 2);
    v_prix     := round(v_prix_mat + v_prix_dir + v_prix_mo, 2);
    v_marge_pct := case when v_cout_tot is not null and v_prix > 0 then round((v_prix - v_cout_tot) / v_prix * 100, 2) else null end;

    v_total_apres := v_total_apres + v_q * v_prix;
    if v_cout_tot is not null then v_marge_apres := v_marge_apres + v_q * (v_prix - v_cout_tot); else v_marge_connue := false; end if;

    -- Une ligne dérogatoire dont rien ne change n'est PAS présentée comme modifiée.
    v_change := l.prix_unitaire is distinct from v_prix
             or l.coef_vente is distinct from v_coef_appl
             or l.taux_horaire_vente is distinct from v_taux_appl
             or coalesce(l.coefficient_source, 'ouvrage') is distinct from (v_rc->>'source')
             or coalesce(l.taux_horaire_source, 'ouvrage') is distinct from (v_rt->>'source');
    if not v_change then
      v_nb_inchangees := v_nb_inchangees + 1;
      continue;
    end if;

    v_nb_recalc := v_nb_recalc + 1;
    v_lignes := v_lignes || jsonb_build_object(
      'id', l.id, 'item', l.item, 'zone', l.zone, 'quantite', v_q,
      'prix_avant', l.prix_unitaire, 'prix_apres', v_prix,
      'coef_avant', l.coef_vente, 'coef_apres', v_coef_appl,
      'taux_avant', l.taux_horaire_vente, 'taux_apres', v_taux_appl);

    if p_appliquer then
      update public.profero_ouvrages_selectionnes set
        coef_vente = v_coef_appl,
        taux_horaire_vente = v_taux_appl,
        coefficient_source = v_rc->>'source',
        taux_horaire_source = v_rt->>'source',
        coefficient_global_id = case when v_rc->>'source' = 'global_chiffrage' then (v_rc->>'id')::uuid end,
        taux_horaire_global_id = case when v_rt->>'source' = 'global_chiffrage' then (v_rt->>'id')::uuid end,
        coefficient_origine_valeur = v_coef_orig,
        coefficient_origine_libelle = v_coef_orig_lib,
        taux_horaire_origine_valeur = v_taux_orig,
        taux_horaire_origine_libelle = v_taux_orig_lib,
        prix_unitaire = v_prix,
        taux_marge_pct = v_marge_pct,
        calcul_version = '2@' || v_iso,
        updated_at = v_now,
        calcul_detail = v_detail || jsonb_build_object(
          'version', 2,
          'date', v_iso,
          'coef_vente', v_coef_appl,
          'taux_horaire_vente', v_taux_appl,
          'prix_materiaux_unitaire', v_prix_mat,
          'prix_direct_unitaire', v_prix_dir,
          'prix_main_oeuvre_unitaire', v_prix_mo,
          'coefficient_origine', jsonb_build_object('id', l.coefficient_vente_id, 'valeur', v_coef_orig, 'libelle', v_coef_orig_lib),
          'coefficient_applique', jsonb_build_object('valeur', v_coef_appl, 'source', v_rc->>'source', 'mode', l.mode_coefficient_ligne,
                                                     'global_id', case when v_rc->>'source' = 'global_chiffrage' then v_rc->>'id' end,
                                                     'libelle', v_rc->>'libelle'),
          'taux_origine', jsonb_build_object('id', l.taux_horaire_vente_id, 'valeur', v_taux_orig, 'libelle', v_taux_orig_lib),
          'taux_applique', jsonb_build_object('valeur', v_taux_appl, 'source', v_rt->>'source', 'mode', l.mode_taux_horaire_ligne,
                                              'global_id', case when v_rt->>'source' = 'global_chiffrage' then v_rt->>'id' end,
                                              'libelle', v_rt->>'libelle'),
          'recalcul_conditions_le', v_iso)
      where id = l.id;
    end if;
  end loop;

  v_total_avant := round(v_total_avant, 2);
  v_total_apres := round(v_total_apres, 2);
  v_marge_avant := round(v_marge_avant, 2);
  v_marge_apres := round(v_marge_apres, 2);

  if p_appliquer then
    v_version := proj.conditions_version + 1;
    update public.profero_projets set
      mode_coefficient = v_mode_coef,
      coefficient_global_id = case when v_mode_coef = 'global' then coef.id else null end,
      coefficient_global_valeur = case when v_mode_coef = 'global' then coef.valeur else null end,
      coefficient_global_libelle = case when v_mode_coef = 'global' then coef.libelle else null end,
      mode_taux_horaire = v_mode_taux,
      taux_horaire_global_id = case when v_mode_taux = 'global' then taux.id else null end,
      taux_horaire_global_valeur = case when v_mode_taux = 'global' then taux.taux_ht else null end,
      taux_horaire_global_libelle = case when v_mode_taux = 'global' then taux.libelle else null end,
      conditions_version = v_version,
      updated_at = v_now
    where id = p_projet_id;
    if not found then
      raise exception 'Modification refusée : chiffrage non modifiable pour cet utilisateur.';
    end if;

    insert into public.chiffrage_conditions_historique (
      projet_id, utilisateur_email, date,
      ancien_mode_coefficient, ancien_coefficient_id, ancien_coefficient_valeur, ancien_coefficient_libelle,
      nouveau_mode_coefficient, nouveau_coefficient_id, nouveau_coefficient_valeur, nouveau_coefficient_libelle,
      ancien_mode_taux, ancien_taux_id, ancien_taux_valeur, ancien_taux_libelle,
      nouveau_mode_taux, nouveau_taux_id, nouveau_taux_valeur, nouveau_taux_libelle,
      nb_lignes_recalculees, nb_lignes_ignorees, ancien_total_ht, nouveau_total_ht,
      ancienne_marge, nouvelle_marge, ancienne_marge_pct, nouvelle_marge_pct, version_avant, version_apres)
    values (
      p_projet_id, auth.email(), v_now,
      proj.mode_coefficient, proj.coefficient_global_id, proj.coefficient_global_valeur, proj.coefficient_global_libelle,
      v_mode_coef, case when v_mode_coef = 'global' then coef.id end, case when v_mode_coef = 'global' then coef.valeur end, case when v_mode_coef = 'global' then coef.libelle end,
      proj.mode_taux_horaire, proj.taux_horaire_global_id, proj.taux_horaire_global_valeur, proj.taux_horaire_global_libelle,
      v_mode_taux, case when v_mode_taux = 'global' then taux.id end, case when v_mode_taux = 'global' then taux.taux_ht end, case when v_mode_taux = 'global' then taux.libelle end,
      v_nb_recalc, v_nb_ignorees, v_total_avant, v_total_apres,
      case when v_marge_connue then v_marge_avant end, case when v_marge_connue then v_marge_apres end,
      case when v_marge_connue and v_total_avant > 0 then round(v_marge_avant / v_total_avant * 100, 2) end,
      case when v_marge_connue and v_total_apres > 0 then round(v_marge_apres / v_total_apres * 100, 2) end,
      proj.conditions_version, v_version);
  else
    v_version := proj.conditions_version;
  end if;

  return jsonb_build_object(
    'ok', true,
    'applique', p_appliquer,
    'projet_id', p_projet_id,
    'version', v_version,
    'version_attendue', proj.conditions_version,
    'hash_lignes', v_hash,
    'avant', jsonb_build_object(
      'mode_coefficient', proj.mode_coefficient, 'coefficient_id', proj.coefficient_global_id, 'coefficient_valeur', proj.coefficient_global_valeur, 'coefficient_libelle', proj.coefficient_global_libelle,
      'mode_taux_horaire', proj.mode_taux_horaire, 'taux_id', proj.taux_horaire_global_id, 'taux_valeur', proj.taux_horaire_global_valeur, 'taux_libelle', proj.taux_horaire_global_libelle),
    'apres', jsonb_build_object(
      'mode_coefficient', v_mode_coef, 'coefficient_id', case when v_mode_coef = 'global' then coef.id end, 'coefficient_valeur', case when v_mode_coef = 'global' then coef.valeur end, 'coefficient_libelle', case when v_mode_coef = 'global' then coef.libelle end,
      'mode_taux_horaire', v_mode_taux, 'taux_id', case when v_mode_taux = 'global' then taux.id end, 'taux_valeur', case when v_mode_taux = 'global' then taux.taux_ht end, 'taux_libelle', case when v_mode_taux = 'global' then taux.libelle end),
    'nb_lignes_recalculees', v_nb_recalc,
    'nb_lignes_ignorees', v_nb_ignorees,
    'nb_lignes_sans_snapshot', v_nb_sans_snapshot,
    'nb_lignes_inchangees', v_nb_inchangees,
    'nb_coefficients_specifiques', v_nb_coef_spec,
    'nb_taux_specifiques', v_nb_taux_spec,
    'nb_lignes_mode_ouvrage', v_nb_mode_ouvrage,
    'total_ht_avant', v_total_avant,
    'total_ht_apres', v_total_apres,
    'ecart_ht', round(v_total_apres - v_total_avant, 2),
    'marge_connue', v_marge_connue,
    'marge_avant', case when v_marge_connue then v_marge_avant end,
    'marge_apres', case when v_marge_connue then v_marge_apres end,
    'marge_avant_pct', case when v_marge_connue and v_total_avant > 0 then round(v_marge_avant / v_total_avant * 100, 2) end,
    'marge_apres_pct', case when v_marge_connue and v_total_apres > 0 then round(v_marge_apres / v_total_apres * 100, 2) end,
    'lignes', v_lignes,
    'lignes_ignorees', v_ignorees,
    'avertissements', to_jsonb(v_avertissements),
    'devis_progbat_id', proj.progbat_devis_id,
    'inchanges', jsonb_build_array('coûts matériaux, main-d''œuvre et direct figés', 'quantités et unités', 'cadences', 'compositions et zones', 'ouvrages de la bibliothèque',
                                   'dérogations de ligne (coefficient / taux spécifiques et mode ouvrage)'));
end;
$$;
revoke all on function public.conditions_chiffrage_evaluer(uuid, text, uuid, text, uuid, boolean, integer, text) from public, anon;
grant execute on function public.conditions_chiffrage_evaluer(uuid, text, uuid, text, uuid, boolean, integer, text) to authenticated;
