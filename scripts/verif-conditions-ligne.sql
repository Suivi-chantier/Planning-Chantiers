-- ═══════════════════════════════════════════════════════════════════════════
-- Vérification des garanties BASE des conditions de vente d'UNE LIGNE
-- (RPC simuler_conditions_ligne / appliquer_conditions_ligne).
-- À exécuter dans l'éditeur SQL Supabase (ou via MCP) : TOUT est annulé à la
-- fin par une exception volontaire « TESTS_OK … » — aucun projet, aucune ligne,
-- aucun coefficient ni taux réel n'est modifié durablement.
--
-- Couvre : simulation sans écriture ; ordre de priorité (dérogation > global >
-- ouvrage) ; indépendance coefficient / taux ; recalcul depuis les seules
-- données figées ; retour à l'héritage et au paramètre de l'ouvrage ; prix
-- saisi manuellement (confirmation obligatoire, ancien prix audité) ; ligne v1
-- (conversion explicite, blocage si données insuffisantes) ; concurrence
-- (version, hash, double clic, deux onglets, option désactivée après la
-- simulation, ligne modifiée entre les deux étapes) ; sécurité (ligne d'un
-- autre projet, identifiants inexistants, option désactivée, aucune valeur
-- numérique acceptée du navigateur, chiffrage signé, RLS ouvrier / bureau,
-- historique non falsifiable) ; rollback complet ; interaction avec les
-- conditions globales (dérogations conservées, comptage exact) ; aucune autre
-- ligne ni aucun autre chiffrage modifié.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_coef_std  public.coefficients_vente;
  v_taux_std  public.taux_horaires_vente;
  v_coef13    public.coefficients_vente;
  v_coef18    public.coefficients_vente;
  v_coef_off  public.coefficients_vente;
  v_taux70    public.taux_horaires_vente;
  v_taux90    public.taux_horaires_vente;
  v_taux_off  public.taux_horaires_vente;
  v_projet    uuid;
  v_autre     uuid;
  v_l_v2      uuid;   -- coût mat 20, cadence 3 h, coef ouvrage 1,5, taux ouvrage 80, prix 270, qté 2
  v_l_v1      uuid;   -- ancienne formule
  v_l_saisie  uuid;   -- prix saisi, aucune donnée figée
  v_l_autre   uuid;   -- ligne d'un AUTRE projet
  v_res       jsonb;
  v_res2      jsonb;
  v_hash      text;
  v_version   integer;
  v_nb        integer;
  v_txt       text;
  v_l         public.profero_ouvrages_selectionnes;
  v_p         public.profero_projets;
  v_h         public.chiffrage_ligne_conditions_historique;
  v_ok        text[] := '{}';
  v_email_ouvrier text;
  v_email_bureau  text;
  v_uid_bureau    uuid;
  v_uid_ouvrier   uuid;
  v_msg       text;
  v_autres_avant text;
begin
  -- La RPC exige un utilisateur authentifié : on se présente comme un compte
  -- bureau réel (aucun droit supplémentaire : les RPC sont SECURITY INVOKER).
  select a.id, u.email into v_uid_bureau, v_email_bureau from public.utilisateurs u join auth.users a on a.email = u.email
    where u.role in ('commercial', 'comptable', 'agent_edl') and u.actif limit 1;
  if v_uid_bureau is null then raise exception 'ECHEC 0 : aucun compte bureau pour exécuter les tests'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_bureau, 'email', v_email_bureau, 'role', 'authenticated')::text, true);

  select * into v_coef_std from public.coefficients_vente where libelle = 'Coefficient standard';
  select * into v_taux_std from public.taux_horaires_vente where libelle = 'Taux standard';
  if v_coef_std.id is null or v_taux_std.id is null then raise exception 'ECHEC 0 : référentiels standard absents'; end if;
  insert into public.coefficients_vente (libelle, valeur) values ('TEST coef 1.3', 1.3) returning * into v_coef13;
  insert into public.coefficients_vente (libelle, valeur) values ('TEST coef 1.8', 1.8) returning * into v_coef18;
  insert into public.coefficients_vente (libelle, valeur) values ('TEST coef désactivé', 1.9) returning * into v_coef_off;
  update public.coefficients_vente set actif = false where id = v_coef_off.id returning * into v_coef_off;
  insert into public.taux_horaires_vente (libelle, taux_ht) values ('TEST taux 70', 70) returning * into v_taux70;
  insert into public.taux_horaires_vente (libelle, taux_ht) values ('TEST taux 90', 90) returning * into v_taux90;
  insert into public.taux_horaires_vente (libelle, taux_ht) values ('TEST taux désactivé', 60) returning * into v_taux_off;
  update public.taux_horaires_vente set actif = false where id = v_taux_off.id returning * into v_taux_off;

  -- Empreinte des AUTRES lignes (hors projets de test) : doit rester identique
  select md5(coalesce(string_agg(id::text || coalesce(prix_unitaire::text, '') || coalesce(calcul_version, '') || coalesce(coef_vente::text, '') || mode_coefficient_ligne || mode_taux_horaire_ligne, ',' order by id), '')) into v_autres_avant
    from public.profero_ouvrages_selectionnes;

  insert into public.profero_projets (client_nom, statut) values ('TEST conditions ligne', 'chiffrage') returning id into v_projet;
  insert into public.profero_projets (client_nom, statut) values ('TEST autre projet ligne', 'chiffrage') returning id into v_autre;
  -- Conditions GLOBALES du chiffrage : coefficient 1,3 et taux 70 figés
  update public.profero_projets set
    mode_coefficient = 'global', coefficient_global_id = v_coef13.id, coefficient_global_valeur = 1.3, coefficient_global_libelle = v_coef13.libelle,
    mode_taux_horaire = 'global', taux_horaire_global_id = v_taux70.id, taux_horaire_global_valeur = 70, taux_horaire_global_libelle = v_taux70.libelle
  where id = v_projet;

  insert into public.profero_ouvrages_selectionnes (projet_id, category, item, zone, quantite, unite, prix_unitaire,
      cout_materiaux_unitaire, cout_main_oeuvre_unitaire, cout_direct_unitaire, cout_total_unitaire, taux_marge_pct,
      coef_vente, coefficient_vente_id, coefficient_source, coefficient_origine_valeur, coefficient_origine_libelle,
      taux_horaire_vente_id, taux_horaire_vente, taux_horaire_source, taux_horaire_origine_valeur, taux_horaire_origine_libelle,
      calcul_version, calcul_detail)
    values (v_projet, 'Plaquiste', 'TEST cloison', 'Cuisine', '2', 'm²', 236,
      20, 120, 0, 140, 40.68, 1.3, v_coef_std.id, 'global_chiffrage', 1.5, 'Coefficient standard',
      v_taux_std.id, 70, 'global_chiffrage', 80, 'Taux standard',
      '2@2026-09-16T08:00:00.000Z',
      jsonb_build_object('version', 2, 'heures_unitaires', 3, 'cout_horaire', 40))
    returning id into v_l_v2;
  insert into public.profero_ouvrages_selectionnes (projet_id, category, item, zone, quantite, unite, prix_unitaire,
      cout_materiaux_unitaire, cout_main_oeuvre_unitaire, cout_total_unitaire, coef_vente, calcul_version, calcul_detail)
    values (v_projet, 'Sol', 'TEST ancien v1', 'Séjour', '1', 'm²', 49.85, 22, 10.16, 32.16, 1.55, '1@2026-09-14T12:44:32.841Z',
      jsonb_build_object('version', 1, 'heures_unitaires', 0.25))
    returning id into v_l_v1;
  insert into public.profero_ouvrages_selectionnes (projet_id, category, item, zone, quantite, unite, prix_unitaire)
    values (v_projet, 'Démolition', 'TEST prix saisi', 'Logement entier', '3', 'U', 450) returning id into v_l_saisie;
  insert into public.profero_ouvrages_selectionnes (projet_id, category, item, zone, quantite, unite, prix_unitaire,
      cout_materiaux_unitaire, cout_main_oeuvre_unitaire, cout_direct_unitaire, cout_total_unitaire,
      coef_vente, coefficient_vente_id, taux_horaire_vente_id, taux_horaire_vente, calcul_version, calcul_detail)
    values (v_autre, 'Plaquiste', 'TEST autre projet', 'Cuisine', '1', 'm²', 270, 20, 120, 0, 140, 1.5, v_coef_std.id, v_taux_std.id, 80, '2@2026-09-16T08:00:00.000Z',
      jsonb_build_object('version', 2, 'heures_unitaires', 3)) returning id into v_l_autre;

  -- ── 0. Aucune valeur numérique n'est acceptée du navigateur ────────────────
  select pg_get_function_identity_arguments(p.oid) into v_txt from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'appliquer_conditions_ligne';
  if v_txt ~ 'numeric|double|real|money' then raise exception 'ECHEC 0 : la RPC accepte une valeur numérique du navigateur (%)', v_txt; end if;
  if v_txt !~ 'p_mode_coefficient text' or v_txt !~ 'p_coefficient_id uuid' then raise exception 'ECHEC 0 : signature inattendue (%)', v_txt; end if;
  v_ok := array_append(v_ok, '0 la RPC n''accepte que des modes et des identifiants (aucun coefficient, taux, prix ni marge numérique)');

  -- ── 1. Simulation : aucune écriture, valeurs héritées du chiffrage ─────────
  v_res := public.simuler_conditions_ligne(v_projet, v_l_v2, 'heritage', null, 'heritage', null);
  if not (v_res->>'possible')::boolean or (v_res->>'change')::boolean then raise exception 'ECHEC 1 : simulation neutre %', v_res; end if;
  if (v_res->'apres'->>'coefficient')::numeric <> 1.3 or (v_res->'apres'->>'taux')::numeric <> 70 or (v_res->'apres'->>'prix_unitaire')::numeric <> 236 then
    raise exception 'ECHEC 1 : héritage %', v_res->'apres'; end if;
  if v_res->'apres'->>'coefficient_source' <> 'global_chiffrage' or v_res->'apres'->>'taux_source' <> 'global_chiffrage' then raise exception 'ECHEC 1 : source'; end if;
  v_hash := v_res->>'hash_ligne'; v_version := (v_res->>'version_attendue')::int;
  if length(v_hash) <> 64 or v_version <> 0 then raise exception 'ECHEC 1 : hash/version % / %', v_hash, v_version; end if;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v2;
  if v_l.prix_unitaire <> 236 or v_l.mode_coefficient_ligne <> 'heritage' then raise exception 'ECHEC 1 : la simulation a écrit'; end if;
  -- Dérogation coefficient : 20 × 1,8 + 3 × 70 = 246 (le taux reste hérité)
  v_res := public.simuler_conditions_ligne(v_projet, v_l_v2, 'specifique', v_coef18.id, 'heritage', null);
  if (v_res->'apres'->>'prix_unitaire')::numeric <> 246 or (v_res->'apres'->>'coefficient')::numeric <> 1.8 or (v_res->'apres'->>'taux')::numeric <> 70
     or v_res->'apres'->>'coefficient_source' <> 'ligne' or v_res->'apres'->>'taux_source' <> 'global_chiffrage' or not (v_res->>'change')::boolean then
    raise exception 'ECHEC 1b : %', v_res->'apres'; end if;
  if (v_res->'avant'->>'prix_unitaire')::numeric <> 236 or (v_res->'apres'->>'prix_materiaux_unitaire')::numeric <> 36 or (v_res->'apres'->>'prix_main_oeuvre_unitaire')::numeric <> 210 then
    raise exception 'ECHEC 1b : aperçu avant/après %', v_res; end if;
  -- Mode ouvrage : force 1,5 malgré le coefficient global 1,3 ⇒ 30 + 210 = 240
  v_res := public.simuler_conditions_ligne(v_projet, v_l_v2, 'ouvrage', null, 'heritage', null);
  if (v_res->'apres'->>'prix_unitaire')::numeric <> 240 or (v_res->'apres'->>'coefficient')::numeric <> 1.5 or v_res->'apres'->>'coefficient_source' <> 'ouvrage' then
    raise exception 'ECHEC 1c : mode ouvrage %', v_res->'apres'; end if;
  -- Taux spécifique seul : 26 + 3 × 90 = 296
  v_res := public.simuler_conditions_ligne(v_projet, v_l_v2, 'heritage', null, 'specifique', v_taux90.id);
  if (v_res->'apres'->>'prix_unitaire')::numeric <> 296 or (v_res->'apres'->>'coefficient')::numeric <> 1.3 then raise exception 'ECHEC 1d : %', v_res->'apres'; end if;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v2;
  if v_l.prix_unitaire <> 236 or v_l.mode_coefficient_ligne <> 'heritage' or v_l.mode_taux_horaire_ligne <> 'heritage' then raise exception 'ECHEC 1 : simulations ⇒ écriture'; end if;
  v_ok := array_append(v_ok, '1 simulation sans écriture : héritage 236, coef spécifique 246, mode ouvrage 240, taux spécifique 296 (priorité ligne > global > ouvrage, paramètres indépendants)');

  -- ── 2. Sécurité : ligne d'un autre projet, identifiants, options désactivées ──
  begin
    perform public.simuler_conditions_ligne(v_projet, v_l_autre, 'heritage', null, 'heritage', null);
    raise exception 'ECHEC 2a : ligne d''un autre projet acceptée';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Cette ligne appartient à un autre chiffrage%' then raise exception 'ECHEC 2a : %', v_msg; end if;
  end;
  begin
    perform public.simuler_conditions_ligne(v_projet, v_l_v2, 'specifique', gen_random_uuid(), 'heritage', null);
    raise exception 'ECHEC 2b : coefficient inexistant accepté';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'Coefficient de vente introuvable.' then raise exception 'ECHEC 2b : %', v_msg; end if;
  end;
  begin
    perform public.simuler_conditions_ligne(v_projet, v_l_v2, 'heritage', null, 'specifique', gen_random_uuid());
    raise exception 'ECHEC 2c : taux inexistant accepté';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'Taux horaire de vente introuvable.' then raise exception 'ECHEC 2c : %', v_msg; end if;
  end;
  begin
    perform public.simuler_conditions_ligne(v_projet, v_l_v2, 'specifique', v_coef_off.id, 'heritage', null);
    raise exception 'ECHEC 2d : coefficient désactivé accepté';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Le coefficient%est désactivé%' then raise exception 'ECHEC 2d : %', v_msg; end if;
  end;
  begin
    perform public.simuler_conditions_ligne(v_projet, v_l_v2, 'heritage', null, 'specifique', v_taux_off.id);
    raise exception 'ECHEC 2e : taux désactivé accepté';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Le taux horaire%est désactivé%' then raise exception 'ECHEC 2e : %', v_msg; end if;
  end;
  begin
    perform public.simuler_conditions_ligne(v_projet, v_l_v2, 'globale', null, 'heritage', null);
    raise exception 'ECHEC 2f : mode invalide accepté';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Mode invalide%' then raise exception 'ECHEC 2f : %', v_msg; end if;
  end;
  begin
    perform public.simuler_conditions_ligne(v_projet, v_l_v2, 'specifique', null, 'heritage', null);
    raise exception 'ECHEC 2g : mode spécifique sans identifiant accepté';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Coefficient spécifique non sélectionné%' then raise exception 'ECHEC 2g : %', v_msg; end if;
  end;
  begin
    perform public.simuler_conditions_ligne(v_projet, gen_random_uuid(), 'heritage', null, 'heritage', null);
    raise exception 'ECHEC 2h : ligne inexistante acceptée';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'Ligne introuvable ou non accessible.' then raise exception 'ECHEC 2h : %', v_msg; end if;
  end;
  v_ok := array_append(v_ok, '2 refusés : ligne d''un autre projet, coefficient/taux inexistant, option désactivée, mode invalide, spécifique sans identifiant, ligne inexistante');

  -- ── 3. Concurrence : version, hash, double clic, deux onglets ──────────────
  v_res := public.simuler_conditions_ligne(v_projet, v_l_v2, 'specifique', v_coef18.id, 'heritage', null);
  v_hash := v_res->>'hash_ligne'; v_version := (v_res->>'version_attendue')::int;
  begin
    perform public.appliquer_conditions_ligne(v_projet, v_l_v2, 'specifique', v_coef18.id, 'heritage', null, 7, v_hash, false, false);
    raise exception 'ECHEC 3a : version périmée acceptée';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Le chiffrage a été modifié depuis la simulation%' then raise exception 'ECHEC 3a : %', v_msg; end if;
  end;
  begin
    perform public.appliquer_conditions_ligne(v_projet, v_l_v2, 'specifique', v_coef18.id, 'heritage', null, v_version, 'deadbeef', false, false);
    raise exception 'ECHEC 3b : hash périmé accepté';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Cette ligne (ou une option choisie) a changé%' then raise exception 'ECHEC 3b : %', v_msg; end if;
  end;
  -- La ligne change entre simulation et confirmation (quantité) ⇒ hash différent
  update public.profero_ouvrages_selectionnes set quantite = '5' where id = v_l_v2;
  if public.conditions_ligne_hash(v_l_v2, 'specifique', v_coef18.id, 'heritage', null) = v_hash then raise exception 'ECHEC 3c : hash insensible à la ligne'; end if;
  update public.profero_ouvrages_selectionnes set quantite = '2' where id = v_l_v2;
  -- L'option choisie est modifiée dans les Réglages entre les deux étapes ⇒ hash différent
  update public.coefficients_vente set valeur = 1.85 where id = v_coef18.id;
  if public.conditions_ligne_hash(v_l_v2, 'specifique', v_coef18.id, 'heritage', null) = v_hash then raise exception 'ECHEC 3d : hash insensible à la valeur de l''option'; end if;
  update public.coefficients_vente set actif = false where id = v_coef18.id;
  if public.conditions_ligne_hash(v_l_v2, 'specifique', v_coef18.id, 'heritage', null) = v_hash then raise exception 'ECHEC 3e : hash insensible à la désactivation'; end if;
  update public.coefficients_vente set valeur = 1.8, actif = true where id = v_coef18.id;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v2;
  select * into v_p from public.profero_projets where id = v_projet;
  if v_l.mode_coefficient_ligne <> 'heritage' or v_p.conditions_version <> 0 then raise exception 'ECHEC 3 : écriture malgré les refus'; end if;
  v_ok := array_append(v_ok, '3 version périmée, hash périmé, ligne modifiée, valeur ou activité de l''option modifiée entre simulation et confirmation ⇒ refusés sans écriture');

  -- ── 4. Application atomique d'une dérogation de coefficient ────────────────
  v_res := public.simuler_conditions_ligne(v_projet, v_l_v2, 'specifique', v_coef18.id, 'heritage', null);
  v_res2 := public.appliquer_conditions_ligne(v_projet, v_l_v2, 'specifique', v_coef18.id, 'heritage', null,
              (v_res->>'version_attendue')::int, v_res->>'hash_ligne', false, false);
  if not (v_res2->>'applique')::boolean or (v_res2->>'version')::int <> 1 then raise exception 'ECHEC 4 : %', v_res2; end if;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v2;
  if v_l.prix_unitaire <> 246 or v_l.coef_vente <> 1.8 or v_l.taux_horaire_vente <> 70 then raise exception 'ECHEC 4 : valeurs % / % / %', v_l.prix_unitaire, v_l.coef_vente, v_l.taux_horaire_vente; end if;
  if v_l.mode_coefficient_ligne <> 'specifique' or v_l.coefficient_ligne_id <> v_coef18.id or v_l.coefficient_ligne_valeur <> 1.8 or v_l.coefficient_ligne_libelle <> v_coef18.libelle then
    raise exception 'ECHEC 4 : dérogation non figée %', to_jsonb(v_l); end if;
  if v_l.mode_taux_horaire_ligne <> 'heritage' or v_l.taux_horaire_ligne_id is not null or v_l.taux_horaire_ligne_valeur is not null then raise exception 'ECHEC 4 : champs de dérogation parasites'; end if;
  if v_l.coefficient_source <> 'ligne' or v_l.taux_horaire_source <> 'global_chiffrage' or v_l.coefficient_global_id is not null then raise exception 'ECHEC 4 : sources'; end if;
  if v_l.coefficient_origine_valeur <> 1.5 or v_l.taux_horaire_origine_valeur <> 80 then raise exception 'ECHEC 4 : origine de l''ouvrage perdue'; end if;
  -- Données figées jamais rechargées ni réécrites
  if v_l.cout_materiaux_unitaire <> 20 or v_l.cout_main_oeuvre_unitaire <> 120 or v_l.cout_total_unitaire <> 140 or v_l.quantite <> '2' or v_l.unite <> 'm²' or v_l.zone <> 'Cuisine'
     or (v_l.calcul_detail->>'heures_unitaires')::numeric <> 3 then raise exception 'ECHEC 4 : données figées touchées'; end if;
  if (v_l.calcul_detail->>'prix_materiaux_unitaire')::numeric <> 36 or (v_l.calcul_detail->>'prix_main_oeuvre_unitaire')::numeric <> 210
     or v_l.calcul_detail->'coefficient_applique'->>'source' <> 'ligne' or v_l.calcul_detail->'coefficient_applique'->>'mode' <> 'specifique'
     or (v_l.calcul_detail->'coefficient_applique'->'specifique'->>'valeur')::numeric <> 1.8 then raise exception 'ECHEC 4 : calcul_detail %', v_l.calcul_detail; end if;
  if v_l.taux_marge_pct <> round((246 - 140) / 246.0 * 100, 2) then raise exception 'ECHEC 4 : marge'; end if;
  -- Les AUTRES lignes du même chiffrage sont intactes
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v1;
  if v_l.prix_unitaire <> 49.85 or v_l.calcul_version not like '1@%' or v_l.mode_coefficient_ligne <> 'heritage' then raise exception 'ECHEC 4 : ligne v1 modifiée'; end if;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_saisie;
  if v_l.prix_unitaire <> 450 or v_l.calcul_version is not null then raise exception 'ECHEC 4 : ligne à prix saisi modifiée'; end if;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_autre;
  if v_l.prix_unitaire <> 270 or v_l.mode_coefficient_ligne <> 'heritage' then raise exception 'ECHEC 4 : ligne d''un autre projet modifiée'; end if;
  select * into v_p from public.profero_projets where id = v_autre;
  if v_p.conditions_version <> 0 then raise exception 'ECHEC 4 : autre projet modifié'; end if;
  -- Historique complet
  select count(*) into v_nb from public.chiffrage_ligne_conditions_historique where ligne_id = v_l_v2;
  select * into v_h from public.chiffrage_ligne_conditions_historique where ligne_id = v_l_v2;
  if v_nb <> 1 or v_h.ancien_mode_coefficient <> 'heritage' or v_h.nouveau_mode_coefficient <> 'specifique'
     or v_h.ancien_coefficient <> 1.3 or v_h.nouveau_coefficient <> 1.8 or v_h.nouveau_coefficient_id <> v_coef18.id
     or v_h.ancien_mode_taux <> 'heritage' or v_h.nouveau_mode_taux <> 'heritage' or v_h.ancien_taux <> 70 or v_h.nouveau_taux <> 70
     or v_h.ancienne_source_coefficient <> 'global_chiffrage' or v_h.nouvelle_source_coefficient <> 'ligne'
     or v_h.ancien_prix_unitaire <> 236 or v_h.nouveau_prix_unitaire <> 246
     or v_h.prix_manuel_remplace or v_h.conversion_v1 or v_h.version_avant <> 0 or v_h.version_apres <> 1
     or v_h.projet_id <> v_projet or v_h.item <> 'TEST cloison' then
    raise exception 'ECHEC 4 : historique %', to_jsonb(v_h); end if;
  v_ok := array_append(v_ok, '4 application atomique : dérogation figée (1,8), taux resté hérité (70), prix 236 → 246, origine ouvrage 1,5/80 conservée, autres lignes et autre projet intacts, historique complet');

  -- ── 5. Double clic / deuxième onglet : même simulation rejouée ⇒ refus ─────
  begin
    perform public.appliquer_conditions_ligne(v_projet, v_l_v2, 'specifique', v_coef18.id, 'heritage', null,
              (v_res->>'version_attendue')::int, v_res->>'hash_ligne', false, false);
    raise exception 'ECHEC 5 : double application acceptée';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Le chiffrage a été modifié depuis la simulation%' then raise exception 'ECHEC 5 : %', v_msg; end if;
  end;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v2;
  select count(*) into v_nb from public.chiffrage_ligne_conditions_historique where ligne_id = v_l_v2;
  if v_l.prix_unitaire <> 246 or v_nb <> 1 then raise exception 'ECHEC 5 : double application partielle'; end if;
  -- Aucun changement à appliquer ⇒ refus explicite (pas d'écriture inutile)
  v_res := public.simuler_conditions_ligne(v_projet, v_l_v2, 'specifique', v_coef18.id, 'heritage', null);
  if (v_res->>'change')::boolean then raise exception 'ECHEC 5b : changement annoncé à tort'; end if;
  begin
    perform public.appliquer_conditions_ligne(v_projet, v_l_v2, 'specifique', v_coef18.id, 'heritage', null,
              (v_res->>'version_attendue')::int, v_res->>'hash_ligne', false, false);
    raise exception 'ECHEC 5b : application sans changement acceptée';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Aucun changement à appliquer%' then raise exception 'ECHEC 5b : %', v_msg; end if;
  end;
  v_ok := array_append(v_ok, '5 double clic / deuxième onglet refusés (version consommée), application sans changement refusée');

  -- ── 6. Valeur figée : modifier les Réglages ne change PAS la ligne ─────────
  update public.coefficients_vente set valeur = 2.5 where id = v_coef18.id;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v2;
  if v_l.coefficient_ligne_valeur <> 1.8 or v_l.coef_vente <> 1.8 or v_l.prix_unitaire <> 246 then raise exception 'ECHEC 6 : valeur figée suivie'; end if;
  -- Et une simulation qui garde la même option réutilise la valeur FIGÉE (1,8), pas 2,5
  v_res := public.simuler_conditions_ligne(v_projet, v_l_v2, 'specifique', v_coef18.id, 'specifique', v_taux90.id);
  if (v_res->'apres'->>'coefficient')::numeric <> 1.8 then raise exception 'ECHEC 6 : la valeur des Réglages a été reprise (%)', v_res->'apres'; end if;
  if (v_res->'apres'->>'prix_unitaire')::numeric <> 36 + 270 then raise exception 'ECHEC 6 : prix %', v_res->'apres'; end if;
  update public.coefficients_vente set valeur = 1.8 where id = v_coef18.id;
  v_ok := array_append(v_ok, '6 une modification du coefficient dans les Réglages ne touche pas la ligne : la valeur figée (1,8) reste utilisée');

  -- ── 7. Deux dérogations, puis retour individuel à l'héritage ───────────────
  v_res := public.simuler_conditions_ligne(v_projet, v_l_v2, 'specifique', v_coef18.id, 'specifique', v_taux90.id);
  v_res2 := public.appliquer_conditions_ligne(v_projet, v_l_v2, 'specifique', v_coef18.id, 'specifique', v_taux90.id,
              (v_res->>'version_attendue')::int, v_res->>'hash_ligne', false, false);
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v2;
  if v_l.prix_unitaire <> 306 or v_l.taux_horaire_vente <> 90 or v_l.taux_horaire_ligne_valeur <> 90 or v_l.taux_horaire_source <> 'ligne' then
    raise exception 'ECHEC 7 : deux dérogations %', to_jsonb(v_l); end if;
  -- Retour à l'héritage du COEFFICIENT seul : 20 × 1,3 + 3 × 90 = 296
  v_res := public.simuler_conditions_ligne(v_projet, v_l_v2, 'heritage', null, 'specifique', v_taux90.id);
  v_res2 := public.appliquer_conditions_ligne(v_projet, v_l_v2, 'heritage', null, 'specifique', v_taux90.id,
              (v_res->>'version_attendue')::int, v_res->>'hash_ligne', false, false);
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v2;
  if v_l.prix_unitaire <> 296 or v_l.coef_vente <> 1.3 or v_l.mode_coefficient_ligne <> 'heritage' or v_l.coefficient_ligne_id is not null
     or v_l.mode_taux_horaire_ligne <> 'specifique' or v_l.taux_horaire_ligne_valeur <> 90 then
    raise exception 'ECHEC 7 : retour héritage %', to_jsonb(v_l); end if;
  -- « Utiliser le paramètre de l'ouvrage » sur le taux : 26 + 3 × 80 = 266
  v_res := public.simuler_conditions_ligne(v_projet, v_l_v2, 'heritage', null, 'ouvrage', null);
  v_res2 := public.appliquer_conditions_ligne(v_projet, v_l_v2, 'heritage', null, 'ouvrage', null,
              (v_res->>'version_attendue')::int, v_res->>'hash_ligne', false, false);
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v2;
  if v_l.prix_unitaire <> 266 or v_l.taux_horaire_vente <> 80 or v_l.mode_taux_horaire_ligne <> 'ouvrage' or v_l.taux_horaire_source <> 'ouvrage'
     or v_l.taux_horaire_ligne_valeur is not null then raise exception 'ECHEC 7 : mode ouvrage %', to_jsonb(v_l); end if;
  v_ok := array_append(v_ok, '7 deux dérogations (306), retour individuel à l''héritage du coefficient (296), passage du taux au paramètre de l''ouvrage (266)');

  -- ── 8. Prix saisi manuellement ─────────────────────────────────────────────
  v_res := public.simuler_conditions_ligne(v_projet, v_l_saisie, 'specifique', v_coef18.id, 'specifique', v_taux90.id);
  if (v_res->>'possible')::boolean then raise exception 'ECHEC 8 : ligne sans données figées jugée calculable'; end if;
  if not (v_res->>'prix_manuel')::boolean then raise exception 'ECHEC 8 : prix manuel non détecté'; end if;
  if v_res->>'blocage' not like '%prix saisi à la main%cadence figée%coût matériaux figé%' then raise exception 'ECHEC 8 : blocage peu explicite (%)', v_res->>'blocage'; end if;
  begin
    perform public.appliquer_conditions_ligne(v_projet, v_l_saisie, 'specifique', v_coef18.id, 'specifique', v_taux90.id,
              (v_res->>'version_attendue')::int, v_res->>'hash_ligne', true, true);
    raise exception 'ECHEC 8 : ligne sans données figées convertie';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%prix saisi à la main%' then raise exception 'ECHEC 8 : %', v_msg; end if;
  end;
  -- Une ligne à prix saisi QUI porte des données figées : conversion possible,
  -- mais uniquement après confirmation explicite, l'ancien prix étant audité.
  update public.profero_ouvrages_selectionnes set cout_materiaux_unitaire = 20, cout_main_oeuvre_unitaire = 120, cout_direct_unitaire = 0,
    cout_total_unitaire = 140, coefficient_vente_id = v_coef_std.id, coefficient_origine_valeur = 1.5, taux_horaire_vente_id = v_taux_std.id,
    taux_horaire_origine_valeur = 80, calcul_detail = jsonb_build_object('heures_unitaires', 3)
    where id = v_l_saisie;
  v_res := public.simuler_conditions_ligne(v_projet, v_l_saisie, 'heritage', null, 'heritage', null);
  if not (v_res->>'possible')::boolean or not (v_res->>'prix_manuel')::boolean then raise exception 'ECHEC 8b : %', v_res; end if;
  if (v_res->'avant'->>'prix_unitaire')::numeric <> 450 or (v_res->'apres'->>'prix_unitaire')::numeric <> 236 then raise exception 'ECHEC 8b : simulation %', v_res; end if;
  if not (v_res->'confirmations_requises' ? 'prix_manuel') then raise exception 'ECHEC 8b : confirmation non demandée'; end if;
  begin
    perform public.appliquer_conditions_ligne(v_projet, v_l_saisie, 'heritage', null, 'heritage', null,
              (v_res->>'version_attendue')::int, v_res->>'hash_ligne', false, false);
    raise exception 'ECHEC 8c : conversion silencieuse du prix manuel';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%prix de vente saisi manuellement%confirmée explicitement%' then raise exception 'ECHEC 8c : %', v_msg; end if;
  end;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_saisie;
  if v_l.prix_unitaire <> 450 or v_l.calcul_version is not null then raise exception 'ECHEC 8c : ligne modifiée malgré le refus'; end if;
  v_res2 := public.appliquer_conditions_ligne(v_projet, v_l_saisie, 'heritage', null, 'heritage', null,
              (v_res->>'version_attendue')::int, v_res->>'hash_ligne', true, false);
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_saisie;
  if v_l.prix_unitaire <> 236 or v_l.calcul_version not like '2@%' or (v_l.calcul_detail->>'prix_manuel_remplace')::numeric <> 450 then
    raise exception 'ECHEC 8d : conversion %', to_jsonb(v_l); end if;
  select * into v_h from public.chiffrage_ligne_conditions_historique where ligne_id = v_l_saisie;
  if not v_h.prix_manuel_remplace or v_h.ancien_prix_unitaire <> 450 or v_h.nouveau_prix_unitaire <> 236 or v_h.ancienne_calcul_version is not null then
    raise exception 'ECHEC 8d : audit du prix manuel %', to_jsonb(v_h); end if;
  v_ok := array_append(v_ok, '8 prix manuel : détecté, bloqué si les données figées manquent (message explicite), jamais converti sans confirmation, ancien prix 450 conservé dans l''audit');

  -- ── 9. Ligne v1 ────────────────────────────────────────────────────────────
  v_res := public.simuler_conditions_ligne(v_projet, v_l_v1, 'heritage', null, 'heritage', null);
  if not (v_res->>'possible')::boolean or not (v_res->>'conversion_v1')::boolean then raise exception 'ECHEC 9 : v1 %', v_res; end if;
  -- 22 × 1,3 + 0,25 × 70 = 28,60 + 17,50 = 46,10
  if (v_res->'apres'->>'prix_unitaire')::numeric <> 46.10 then raise exception 'ECHEC 9 : prix v1 %', v_res->'apres'; end if;
  begin
    perform public.appliquer_conditions_ligne(v_projet, v_l_v1, 'heritage', null, 'heritage', null,
              (v_res->>'version_attendue')::int, v_res->>'hash_ligne', false, false);
    raise exception 'ECHEC 9 : conversion v1 silencieuse';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%ancienne formule de calcul (v1)%confirmé explicitement%' then raise exception 'ECHEC 9 : %', v_msg; end if;
  end;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v1;
  if v_l.prix_unitaire <> 49.85 or v_l.calcul_version not like '1@%' then raise exception 'ECHEC 9 : ligne v1 modifiée malgré le refus'; end if;
  -- Ligne v1 SANS cadence figée : bloquée, jamais devinée
  update public.profero_ouvrages_selectionnes set calcul_detail = '{"version":1}'::jsonb where id = v_l_v1;
  v_res := public.simuler_conditions_ligne(v_projet, v_l_v1, 'heritage', null, 'heritage', null);
  if (v_res->>'possible')::boolean then raise exception 'ECHEC 9b : v1 incomplète jugée calculable'; end if;
  if v_res->>'blocage' not like '%cadence figée%' then raise exception 'ECHEC 9b : blocage (%)', v_res->>'blocage'; end if;
  update public.profero_ouvrages_selectionnes set calcul_detail = jsonb_build_object('version', 1, 'heures_unitaires', 0.25) where id = v_l_v1;
  -- Conversion confirmée
  v_res := public.simuler_conditions_ligne(v_projet, v_l_v1, 'heritage', null, 'specifique', v_taux90.id);
  v_res2 := public.appliquer_conditions_ligne(v_projet, v_l_v1, 'heritage', null, 'specifique', v_taux90.id,
              (v_res->>'version_attendue')::int, v_res->>'hash_ligne', false, true);
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v1;
  -- 22 × 1,3 + 0,25 × 90 = 28,60 + 22,50 = 51,10
  if v_l.prix_unitaire <> 51.10 or v_l.calcul_version not like '2@%' or v_l.calcul_detail->>'converti_v1_le' is null then
    raise exception 'ECHEC 9c : conversion v1 %', to_jsonb(v_l); end if;
  select * into v_h from public.chiffrage_ligne_conditions_historique where ligne_id = v_l_v1;
  if not v_h.conversion_v1 or v_h.ancienne_calcul_version not like '1@%' or v_h.nouvelle_calcul_version not like '2@%' then
    raise exception 'ECHEC 9c : audit v1 %', to_jsonb(v_h); end if;
  v_ok := array_append(v_ok, '9 ligne v1 : simulation explicite (46,10), jamais convertie sans confirmation, bloquée sans cadence figée, conversion confirmée auditée (51,10)');

  -- ── 10. Conditions GLOBALES : les dérogations ne suivent pas ───────────────
  -- État : v_l_v2 coefficient hérité + taux mode ouvrage ; v_l_v1 et v_l_saisie hérités.
  -- On repose une dérogation de coefficient sur v_l_v1 pour le comptage.
  v_res := public.simuler_conditions_ligne(v_projet, v_l_v1, 'specifique', v_coef18.id, 'specifique', v_taux90.id);
  v_res2 := public.appliquer_conditions_ligne(v_projet, v_l_v1, 'specifique', v_coef18.id, 'specifique', v_taux90.id,
              (v_res->>'version_attendue')::int, v_res->>'hash_ligne', false, false);
  -- Nouveau coefficient global 1,5 (standard) et taux global 90
  v_res := public.simuler_conditions_chiffrage(v_projet, 'global', v_coef_std.id, 'global', v_taux90.id);
  if (v_res->>'nb_coefficients_specifiques')::int <> 1 or (v_res->>'nb_taux_specifiques')::int <> 1 or (v_res->>'nb_lignes_mode_ouvrage')::int <> 1 then
    raise exception 'ECHEC 10 : comptage des dérogations %', v_res; end if;
  v_res2 := public.appliquer_conditions_chiffrage(v_projet, 'global', v_coef_std.id, 'global', v_taux90.id,
              (v_res->>'version_attendue')::int, v_res->>'hash_lignes');
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v1;
  if v_l.coef_vente <> 1.8 or v_l.taux_horaire_vente <> 90 or v_l.coefficient_source <> 'ligne' or v_l.taux_horaire_source <> 'ligne' or v_l.prix_unitaire <> 62.10 then
    raise exception 'ECHEC 10 : dérogations de ligne écrasées par le global %', to_jsonb(v_l); end if;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v2;
  -- coefficient hérité ⇒ 1,5 (nouveau global) ; taux forcé sur l'ouvrage ⇒ 80
  -- 20 × 1,5 + 3 × 80 = 30 + 240 = 270
  if v_l.coef_vente <> 1.5 or v_l.taux_horaire_vente <> 80 or v_l.coefficient_source <> 'global_chiffrage' or v_l.taux_horaire_source <> 'ouvrage' or v_l.prix_unitaire <> 270 then
    raise exception 'ECHEC 10 : héritage / mode ouvrage %', to_jsonb(v_l); end if;
  v_ok := array_append(v_ok, '10 conditions globales : lignes héritées recalculées, coefficient et taux spécifiques conservés, mode ouvrage conservé, comptage exact (1/1/1)');

  -- ── 11. Chiffrage signé : toute modification refusée ───────────────────────
  update public.profero_projets set statut = 'signe' where id = v_projet;
  begin
    perform public.simuler_conditions_ligne(v_projet, v_l_v2, 'specifique', v_coef18.id, 'heritage', null);
    raise exception 'ECHEC 11 : chiffrage signé accepté';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Chiffrage signé%' then raise exception 'ECHEC 11 : %', v_msg; end if;
  end;
  update public.profero_projets set statut = 'chiffrage' where id = v_projet;
  v_ok := array_append(v_ok, '11 chiffrage signé : simulation et application refusées avec la raison');

  -- ── 12. RLS : ouvrier sans accès, bureau autorisé, historique non falsifiable ──
  select a.id, u.email into v_uid_ouvrier, v_email_ouvrier from public.utilisateurs u join auth.users a on a.email = u.email
    where u.role = 'ouvrier' and u.actif limit 1;
  if v_email_ouvrier is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid_ouvrier, 'email', v_email_ouvrier, 'role', 'authenticated')::text, true);
    begin
      set local role authenticated;
      perform public.simuler_conditions_ligne(v_projet, v_l_v2, 'specifique', v_coef18.id, 'heritage', null);
      reset role;
      raise exception 'ECHEC 12a : ouvrier autorisé';
    exception when others then
      reset role;
      get stacked diagnostics v_msg = message_text;
      if v_msg <> 'Chiffrage introuvable ou non accessible.' then raise exception 'ECHEC 12a : %', v_msg; end if;
    end;
    set local role authenticated;
    select count(*) into v_nb from public.chiffrage_ligne_conditions_historique where projet_id = v_projet;
    reset role;
    if v_nb <> 0 then raise exception 'ECHEC 12a : ouvrier lit l''historique'; end if;
    v_ok := array_append(v_ok, '12a ouvrier : chiffrage inaccessible, historique invisible');
  end if;
  if v_email_bureau is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid_bureau, 'email', v_email_bureau, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_res := public.simuler_conditions_ligne(v_projet, v_l_v2, 'ouvrage', null, 'ouvrage', null);
    v_res2 := public.appliquer_conditions_ligne(v_projet, v_l_v2, 'ouvrage', null, 'ouvrage', null,
                (v_res->>'version_attendue')::int, v_res->>'hash_ligne', false, false);
    reset role;
    -- L'auteur du DERNIER changement est bien le compte bureau qui vient d'appliquer
    select * into v_h from public.chiffrage_ligne_conditions_historique where ligne_id = v_l_v2 order by date desc, version_apres desc limit 1;
    if not (v_res2->>'applique')::boolean or v_h.utilisateur_email is distinct from v_email_bureau or v_h.nouveau_mode_coefficient <> 'ouvrage' then
      raise exception 'ECHEC 12b : bureau % / %', v_res2->>'applique', to_jsonb(v_h); end if;
    select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v2;
    if v_l.coef_vente <> 1.5 or v_l.taux_horaire_vente <> 80 or v_l.coefficient_source <> 'ouvrage' then raise exception 'ECHEC 12b : application bureau %', to_jsonb(v_l); end if;
    begin
      set local role authenticated;
      update public.chiffrage_ligne_conditions_historique set nouveau_prix_unitaire = 0 where ligne_id = v_l_v2;
      reset role;
      raise exception 'ECHEC 12c : historique modifiable';
    exception when insufficient_privilege then reset role;
    end;
    begin
      set local role authenticated;
      delete from public.chiffrage_ligne_conditions_historique where ligne_id = v_l_v2;
      reset role;
      raise exception 'ECHEC 12c : historique supprimable';
    exception when insufficient_privilege then reset role;
    end;
    begin
      set local role authenticated;
      perform public.conditions_ligne_evaluer(v_projet, v_l_v2, 'heritage', null, 'heritage', null, true, 0, 'x', false, false);
      reset role;
      raise exception 'ECHEC 12d : appel direct du cœur avec version périmée accepté';
    exception when others then
      reset role;
      get stacked diagnostics v_msg = message_text;
      if v_msg not like 'Le chiffrage a été modifié depuis la simulation%' then raise exception 'ECHEC 12d : %', v_msg; end if;
    end;
    v_ok := array_append(v_ok, '12b-d bureau : simulation + application autorisées (auteur tracé), historique ni modifiable ni supprimable, cœur direct soumis aux mêmes contrôles');
  end if;

  -- ── 13. Contraintes : pas de seconde source de vérité ──────────────────────
  begin
    update public.profero_ouvrages_selectionnes set mode_coefficient_ligne = 'specifique', coefficient_ligne_id = null, coefficient_ligne_valeur = null where id = v_l_v2;
    raise exception 'ECHEC 13a : mode spécifique sans valeur accepté';
  exception when check_violation then null;
  end;
  begin
    update public.profero_ouvrages_selectionnes set mode_coefficient_ligne = 'heritage', coefficient_ligne_id = v_coef18.id, coefficient_ligne_valeur = 1.8 where id = v_l_v2;
    raise exception 'ECHEC 13b : dérogation résiduelle en mode héritage acceptée';
  exception when check_violation then null;
  end;
  begin
    update public.profero_ouvrages_selectionnes set mode_taux_horaire_ligne = 'inconnu' where id = v_l_v2;
    raise exception 'ECHEC 13c : mode invalide accepté en base';
  exception when check_violation then null;
  end;
  begin
    update public.profero_ouvrages_selectionnes set mode_coefficient_ligne = 'specifique', coefficient_ligne_id = v_coef18.id, coefficient_ligne_valeur = -1 where id = v_l_v2;
    raise exception 'ECHEC 13d : valeur négative acceptée';
  exception when check_violation then null;
  end;
  begin
    delete from public.coefficients_vente where id = v_coef18.id;
    raise exception 'ECHEC 13e : coefficient référencé supprimable';
  exception when foreign_key_violation then null; when insufficient_privilege then null;
  end;
  v_ok := array_append(v_ok, '13 contraintes : mode limité aux 3 valeurs, spécifique ⇒ identifiant + valeur > 0, héritage/ouvrage ⇒ champs NULL, clé étrangère protégée');

  -- ── 14. Aucune autre ligne touchée ─────────────────────────────────────────
  select md5(coalesce(string_agg(id::text || coalesce(prix_unitaire::text, '') || coalesce(calcul_version, '') || coalesce(coef_vente::text, '') || mode_coefficient_ligne || mode_taux_horaire_ligne, ',' order by id), '')) into v_txt
    from public.profero_ouvrages_selectionnes where projet_id not in (v_projet, v_autre);
  if v_txt <> v_autres_avant then raise exception 'ECHEC 14 : d''autres lignes ont changé'; end if;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_autre;
  if v_l.prix_unitaire <> 270 or v_l.mode_coefficient_ligne <> 'heritage' or v_l.coefficient_source is not null then raise exception 'ECHEC 14 : autre projet modifié'; end if;
  v_ok := array_append(v_ok, '14 aucune ligne ni aucun chiffrage hors périmètre modifié');

  raise exception 'TESTS_OK (%): %', array_length(v_ok, 1), array_to_string(v_ok, ' | ');
end $$;
