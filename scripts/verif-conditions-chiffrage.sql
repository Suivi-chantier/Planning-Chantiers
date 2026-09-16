-- ═══════════════════════════════════════════════════════════════════════════
-- Vérification des garanties BASE des conditions de vente d'un chiffrage
-- (RPC simuler_conditions_chiffrage / appliquer_conditions_chiffrage).
-- À exécuter dans l'éditeur SQL Supabase (ou via MCP) : TOUT est annulé à la
-- fin par une exception volontaire « TESTS_OK … » — aucun projet, aucune ligne,
-- aucun coefficient ni taux réel n'est modifié durablement.
--
-- Couvre : simulation sans écriture ; comptage des lignes recalculées /
-- ignorées (v1, prix saisi) ; totaux et marges avant/après ; refus si version
-- ou hash périmés (double clic, deux onglets, ligne modifiée entre simulation
-- et confirmation) ; application atomique (lignes + projet + historique) ;
-- valeurs figées insensibles aux Réglages ; coefficient/taux désactivé refusé
-- pour une nouvelle sélection mais conservé s'il est déjà celui du chiffrage ;
-- retour aux paramètres de chaque ouvrage depuis l'origine figée ; origine
-- absente ⇒ ligne signalée, jamais inventée ; chiffrage signé refusé ; mode
-- invalide refusé ; RLS (ouvrier sans accès, bureau autorisé, historique en
-- lecture/insert seulement) ; aucune autre ligne / aucun autre projet touché.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_coef_std  public.coefficients_vente;
  v_taux_std  public.taux_horaires_vente;
  v_coef13    public.coefficients_vente;
  v_coef_off  public.coefficients_vente;
  v_taux70    public.taux_horaires_vente;
  v_projet    uuid;
  v_autre     uuid;
  v_l_v2      uuid;   -- ligne v2 recalculable : coût mat 20, cadence 3 h, coef 1,5, taux 80 ⇒ 270 (qté 2)
  v_l_v1      uuid;   -- ligne v1 (ancienne formule) : jamais recalculée
  v_l_saisie  uuid;   -- ligne à prix saisi : hors périmètre
  v_l_autre   uuid;   -- ligne d'un AUTRE projet : jamais touchée
  v_res       jsonb;
  v_res2      jsonb;
  v_hash      text;
  v_version   integer;
  v_nb        integer;
  v_num       numeric;
  v_txt       text;
  v_l         public.profero_ouvrages_selectionnes;
  v_p         public.profero_projets;
  v_h         public.chiffrage_conditions_historique;
  v_ok        text[] := '{}';
  v_email_ouvrier text;
  v_email_bureau  text;
  v_msg       text;
  v_autres_avant text;
begin
  select * into v_coef_std from public.coefficients_vente where libelle = 'Coefficient standard';
  select * into v_taux_std from public.taux_horaires_vente where libelle = 'Taux standard';
  if v_coef_std.id is null or v_taux_std.id is null then raise exception 'ECHEC 0 : référentiels standard absents'; end if;
  insert into public.coefficients_vente (libelle, valeur) values ('TEST coefficient client', 1.3) returning * into v_coef13;
  insert into public.coefficients_vente (libelle, valeur) values ('TEST coefficient désactivé', 1.8) returning * into v_coef_off;
  update public.coefficients_vente set actif = false where id = v_coef_off.id returning * into v_coef_off;
  insert into public.taux_horaires_vente (libelle, taux_ht) values ('TEST taux négocié', 70) returning * into v_taux70;

  -- Empreinte des AUTRES lignes (hors projets de test) : doit rester identique
  select md5(coalesce(string_agg(id::text || coalesce(prix_unitaire::text, '') || coalesce(calcul_version, '') || coalesce(coef_vente::text, ''), ',' order by id), '')) into v_autres_avant
    from public.profero_ouvrages_selectionnes;

  insert into public.profero_projets (client_nom, statut) values ('TEST conditions', 'chiffrage') returning id into v_projet;
  insert into public.profero_projets (client_nom, statut) values ('TEST autre projet', 'chiffrage') returning id into v_autre;
  insert into public.profero_ouvrages_selectionnes (projet_id, category, item, zone, quantite, unite, prix_unitaire,
      cout_materiaux_unitaire, cout_main_oeuvre_unitaire, cout_direct_unitaire, cout_total_unitaire, taux_marge_pct,
      coef_vente, coefficient_vente_id, taux_horaire_vente_id, taux_horaire_vente, calcul_version, calcul_detail)
    values (v_projet, 'Plaquiste', 'TEST cloison', 'Cuisine', '2', 'm²', 270,
      20, 120, 0, 140, 48.15, 1.5, v_coef_std.id, v_taux_std.id, 80, '2@2026-09-16T08:00:00.000Z',
      jsonb_build_object('version', 2, 'heures_unitaires', 3, 'cout_horaire', 40, 'coefficient_vente_libelle', 'Coefficient standard', 'taux_horaire_vente_libelle', 'Taux standard', 'coef_vente', 1.5, 'taux_horaire_vente', 80))
    returning id into v_l_v2;
  insert into public.profero_ouvrages_selectionnes (projet_id, category, item, zone, quantite, unite, prix_unitaire,
      cout_materiaux_unitaire, cout_main_oeuvre_unitaire, cout_total_unitaire, coef_vente, calcul_version, calcul_detail)
    values (v_projet, 'Sol', 'TEST ancien v1', 'Séjour', '1', 'm²', 49.85, 20, 12.16, 32.16, 1.55, '1@2026-09-14T12:44:32.841Z', '{"version":1}'::jsonb)
    returning id into v_l_v1;
  insert into public.profero_ouvrages_selectionnes (projet_id, category, item, zone, quantite, unite, prix_unitaire)
    values (v_projet, 'Démolition', 'TEST prix saisi', 'Logement entier', '3', 'U', 100) returning id into v_l_saisie;
  insert into public.profero_ouvrages_selectionnes (projet_id, category, item, zone, quantite, unite, prix_unitaire,
      cout_materiaux_unitaire, cout_main_oeuvre_unitaire, cout_direct_unitaire, cout_total_unitaire,
      coef_vente, coefficient_vente_id, taux_horaire_vente_id, taux_horaire_vente, calcul_version, calcul_detail)
    values (v_autre, 'Plaquiste', 'TEST autre projet', 'Cuisine', '1', 'm²', 270, 20, 120, 0, 140, 1.5, v_coef_std.id, v_taux_std.id, 80, '2@2026-09-16T08:00:00.000Z',
      jsonb_build_object('version', 2, 'heures_unitaires', 3)) returning id into v_l_autre;

  -- ── 1. Simulation : aucune écriture, comptages et totaux ──────────────────
  v_res := public.simuler_conditions_chiffrage(v_projet, 'global', v_coef13.id, 'global', v_taux70.id);
  if (v_res->>'applique')::boolean then raise exception 'ECHEC 1 : simulation marquée appliquée'; end if;
  if (v_res->>'nb_lignes_recalculees')::int <> 1 or (v_res->>'nb_lignes_ignorees')::int <> 1 or (v_res->>'nb_lignes_sans_snapshot')::int <> 1 then
    raise exception 'ECHEC 1 : comptages % / % / %', v_res->>'nb_lignes_recalculees', v_res->>'nb_lignes_ignorees', v_res->>'nb_lignes_sans_snapshot';
  end if;
  -- avant : 2×270 + 49,85 + 300 = 889,85 ; après : 2×(20×1,3 + 3×70 = 236) + 49,85 + 300 = 821,85
  if (v_res->>'total_ht_avant')::numeric <> 889.85 or (v_res->>'total_ht_apres')::numeric <> 821.85 or (v_res->>'ecart_ht')::numeric <> -68.00 then
    raise exception 'ECHEC 1 : totaux % → % (écart %)', v_res->>'total_ht_avant', v_res->>'total_ht_apres', v_res->>'ecart_ht';
  end if;
  if (v_res->>'marge_connue')::boolean then raise exception 'ECHEC 1 : marge annoncée connue malgré une ligne sans coût'; end if;
  if (v_res->'lignes_ignorees'->0->>'raison') not like 'ancienne formule (v1)%' then raise exception 'ECHEC 1 : raison v1 : %', v_res->'lignes_ignorees'->0->>'raison'; end if;
  if (v_res->'lignes'->0->>'prix_apres')::numeric <> 236 then raise exception 'ECHEC 1 : prix simulé %', v_res->'lignes'->0->>'prix_apres'; end if;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v2;
  select * into v_p from public.profero_projets where id = v_projet;
  if v_l.prix_unitaire <> 270 or v_l.coef_vente <> 1.5 or v_p.conditions_version <> 0 or v_p.mode_coefficient <> 'ouvrage' then raise exception 'ECHEC 1 : la simulation a écrit'; end if;
  select count(*) into v_nb from public.chiffrage_conditions_historique where projet_id = v_projet;
  if v_nb <> 0 then raise exception 'ECHEC 1 : historique écrit par la simulation'; end if;
  v_ok := array_append(v_ok, '1 simulation sans écriture (1 recalculée, 1 v1 ignorée, 1 prix saisi ; 889,85 → 821,85)');

  v_hash := v_res->>'hash_lignes';
  v_version := (v_res->>'version_attendue')::int;
  if length(v_hash) <> 64 or v_version <> 0 then raise exception 'ECHEC 2 : hash/version % / %', v_hash, v_version; end if;

  -- ── 2. Concurrence : version ou hash périmés ⇒ refus, rien d'écrit ─────────
  begin
    perform public.appliquer_conditions_chiffrage(v_projet, 'global', v_coef13.id, 'global', v_taux70.id, 7, v_hash);
    raise exception 'ECHEC 2a : version périmée acceptée';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Le chiffrage a été modifié depuis la simulation%' then raise exception 'ECHEC 2a : %', v_msg; end if;
  end;
  begin
    perform public.appliquer_conditions_chiffrage(v_projet, 'global', v_coef13.id, 'global', v_taux70.id, v_version, 'deadbeef');
    raise exception 'ECHEC 2b : hash périmé accepté';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Les lignes du chiffrage ont changé%' then raise exception 'ECHEC 2b : %', v_msg; end if;
  end;
  -- Une ligne change entre simulation et confirmation (quantité) ⇒ hash différent ⇒ refus
  update public.profero_ouvrages_selectionnes set quantite = '5' where id = v_l_saisie;
  if public.conditions_chiffrage_hash(v_projet) = v_hash then raise exception 'ECHEC 2c : hash insensible à une ligne modifiée'; end if;
  begin
    perform public.appliquer_conditions_chiffrage(v_projet, 'global', v_coef13.id, 'global', v_taux70.id, v_version, v_hash);
    raise exception 'ECHEC 2c : application acceptée après modification d''une ligne';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Les lignes du chiffrage ont changé%' then raise exception 'ECHEC 2c : %', v_msg; end if;
  end;
  update public.profero_ouvrages_selectionnes set quantite = '3' where id = v_l_saisie;
  select * into v_p from public.profero_projets where id = v_projet;
  if v_p.conditions_version <> 0 then raise exception 'ECHEC 2 : version modifiée malgré les refus'; end if;
  v_ok := array_append(v_ok, '2 version périmée, hash périmé, ligne modifiée entre simulation et confirmation ⇒ refusés sans écriture');

  -- ── 3. Application atomique ────────────────────────────────────────────────
  v_res := public.simuler_conditions_chiffrage(v_projet, 'global', v_coef13.id, 'global', v_taux70.id);
  v_res2 := public.appliquer_conditions_chiffrage(v_projet, 'global', v_coef13.id, 'global', v_taux70.id, (v_res->>'version_attendue')::int, v_res->>'hash_lignes');
  if not (v_res2->>'applique')::boolean or (v_res2->>'version')::int <> 1 then raise exception 'ECHEC 3 : résultat %', v_res2->>'version'; end if;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v2;
  if v_l.prix_unitaire <> 236 or v_l.coef_vente <> 1.3 or v_l.taux_horaire_vente <> 70 then raise exception 'ECHEC 3 : ligne % / % / %', v_l.prix_unitaire, v_l.coef_vente, v_l.taux_horaire_vente; end if;
  if v_l.coefficient_source <> 'global_chiffrage' or v_l.taux_horaire_source <> 'global_chiffrage' or v_l.coefficient_global_id <> v_coef13.id or v_l.taux_horaire_global_id <> v_taux70.id then raise exception 'ECHEC 3 : source/global'; end if;
  if v_l.coefficient_origine_valeur <> 1.5 or v_l.taux_horaire_origine_valeur <> 80 or v_l.coefficient_vente_id <> v_coef_std.id or v_l.taux_horaire_vente_id <> v_taux_std.id
     or v_l.coefficient_origine_libelle <> 'Coefficient standard' or v_l.taux_horaire_origine_libelle <> 'Taux standard' then raise exception 'ECHEC 3 : origine non figée'; end if;
  if v_l.cout_materiaux_unitaire <> 20 or v_l.cout_main_oeuvre_unitaire <> 120 or v_l.cout_total_unitaire <> 140 or v_l.quantite <> '2' or v_l.unite <> 'm²' or v_l.zone <> 'Cuisine' then raise exception 'ECHEC 3 : données figées modifiées'; end if;
  if (v_l.calcul_detail->>'heures_unitaires')::numeric <> 3 or (v_l.calcul_detail->>'prix_materiaux_unitaire')::numeric <> 26 or (v_l.calcul_detail->>'prix_main_oeuvre_unitaire')::numeric <> 210
     or v_l.calcul_detail->'coefficient_applique'->>'source' <> 'global_chiffrage' or (v_l.calcul_detail->'coefficient_origine'->>'valeur')::numeric <> 1.5 or (v_l.calcul_detail->'taux_applique'->>'valeur')::numeric <> 70 then
    raise exception 'ECHEC 3 : calcul_detail %', v_l.calcul_detail; end if;
  if v_l.taux_marge_pct <> round((236 - 140) / 236.0 * 100, 2) or v_l.calcul_version not like '2@%' then raise exception 'ECHEC 3 : marge/version'; end if;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v1;
  if v_l.prix_unitaire <> 49.85 or v_l.coef_vente <> 1.55 or v_l.calcul_version not like '1@%' or v_l.coefficient_source is not null then raise exception 'ECHEC 3 : ligne v1 modifiée'; end if;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_saisie;
  if v_l.prix_unitaire <> 100 or v_l.calcul_version is not null then raise exception 'ECHEC 3 : ligne à prix saisi modifiée'; end if;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_autre;
  if v_l.prix_unitaire <> 270 or v_l.coef_vente <> 1.5 or v_l.coefficient_source is not null then raise exception 'ECHEC 3 : ligne d''un autre projet modifiée'; end if;
  select * into v_p from public.profero_projets where id = v_projet;
  if v_p.mode_coefficient <> 'global' or v_p.coefficient_global_id <> v_coef13.id or v_p.coefficient_global_valeur <> 1.3 or v_p.coefficient_global_libelle <> 'TEST coefficient client'
     or v_p.mode_taux_horaire <> 'global' or v_p.taux_horaire_global_id <> v_taux70.id or v_p.taux_horaire_global_valeur <> 70 or v_p.conditions_version <> 1 then raise exception 'ECHEC 3 : projet %', to_jsonb(v_p); end if;
  select * into v_p from public.profero_projets where id = v_autre;
  if v_p.mode_coefficient <> 'ouvrage' or v_p.conditions_version <> 0 then raise exception 'ECHEC 3 : autre projet modifié'; end if;
  select * into v_h from public.chiffrage_conditions_historique where projet_id = v_projet;
  select count(*) into v_nb from public.chiffrage_conditions_historique where projet_id = v_projet;
  if v_nb <> 1 or v_h.ancien_mode_coefficient <> 'ouvrage' or v_h.nouveau_mode_coefficient <> 'global' or v_h.nouveau_coefficient_valeur <> 1.3 or v_h.nouveau_taux_valeur <> 70
     or v_h.nb_lignes_recalculees <> 1 or v_h.nb_lignes_ignorees <> 1 or v_h.ancien_total_ht <> 889.85 or v_h.nouveau_total_ht <> 821.85 or v_h.version_avant <> 0 or v_h.version_apres <> 1 then
    raise exception 'ECHEC 3 : historique %', to_jsonb(v_h); end if;
  v_ok := array_append(v_ok, '3 application atomique : ligne v2 recalculée (270 → 236, origine 1,5/80 figée), v1 et prix saisi intacts, autre projet intact, projet figé, historique complet');

  -- ── 4. Double clic / deuxième onglet : même simulation rejouée ⇒ refus ─────
  begin
    perform public.appliquer_conditions_chiffrage(v_projet, 'global', v_coef13.id, 'global', v_taux70.id, (v_res->>'version_attendue')::int, v_res->>'hash_lignes');
    raise exception 'ECHEC 4 : double application acceptée';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Le chiffrage a été modifié depuis la simulation%' then raise exception 'ECHEC 4 : %', v_msg; end if;
  end;
  select count(*) into v_nb from public.chiffrage_conditions_historique where projet_id = v_projet;
  if v_nb <> 1 then raise exception 'ECHEC 4 : historique dupliqué'; end if;
  v_ok := array_append(v_ok, '4 double clic / second onglet refusé (version + hash), historique non dupliqué');

  -- ── 5. Réglages modifiés ensuite : le chiffrage garde ses valeurs figées ────
  update public.coefficients_vente set valeur = 1.35 where id = v_coef13.id;
  update public.taux_horaires_vente set taux_ht = 75 where id = v_taux70.id;
  select * into v_p from public.profero_projets where id = v_projet;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v2;
  if v_p.coefficient_global_valeur <> 1.3 or v_p.taux_horaire_global_valeur <> 70 or v_l.prix_unitaire <> 236 or v_l.coef_vente <> 1.3 then raise exception 'ECHEC 5 : valeurs figées altérées par les Réglages'; end if;
  -- Mise à jour VOLONTAIRE : nouvelle application (même id) ⇒ nouvelle valeur figée, historique
  v_res := public.simuler_conditions_chiffrage(v_projet, 'global', v_coef13.id, 'global', v_taux70.id);
  if (v_res->'apres'->>'coefficient_valeur')::numeric <> 1.35 or (v_res->>'total_ht_apres')::numeric <> 2 * (20 * 1.35 + 3 * 75) + 49.85 + 300 then raise exception 'ECHEC 5 : simulation MAJ volontaire %', v_res->>'total_ht_apres'; end if;
  v_res2 := public.appliquer_conditions_chiffrage(v_projet, 'global', v_coef13.id, 'global', v_taux70.id, (v_res->>'version_attendue')::int, v_res->>'hash_lignes');
  select * into v_p from public.profero_projets where id = v_projet;
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v2;
  if v_p.coefficient_global_valeur <> 1.35 or v_p.taux_horaire_global_valeur <> 75 or v_p.conditions_version <> 2 or v_l.prix_unitaire <> 252 or v_l.coefficient_origine_valeur <> 1.5 then raise exception 'ECHEC 5 : MAJ volontaire % / %', v_l.prix_unitaire, v_p.conditions_version; end if;
  v_ok := array_append(v_ok, '5 Réglages modifiés ⇒ rien ne bouge ; mise à jour volontaire ⇒ nouvelle valeur figée (236 → 252), version 2');

  -- ── 6. Désactivé : refusé pour une nouvelle sélection, conservé si déjà figé ─
  begin
    perform public.simuler_conditions_chiffrage(v_projet, 'global', v_coef_off.id, 'ouvrage', null);
    raise exception 'ECHEC 6a : coefficient désactivé accepté';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Le coefficient « TEST coefficient désactivé » est désactivé%' then raise exception 'ECHEC 6a : %', v_msg; end if;
  end;
  update public.coefficients_vente set actif = false where id = v_coef13.id;   -- le coefficient FIGÉ du chiffrage est désactivé
  v_res := public.simuler_conditions_chiffrage(v_projet, 'global', v_coef13.id, 'global', v_taux70.id);   -- même id : toléré, signalé
  if not (v_res->'avertissements')::text like '%désactivé dans les Réglages%' then raise exception 'ECHEC 6b : désactivé non signalé %', v_res->'avertissements'; end if;
  begin
    perform public.simuler_conditions_chiffrage(v_autre, 'global', v_coef13.id, 'ouvrage', null);   -- autre chiffrage : nouvelle sélection ⇒ refus
    raise exception 'ECHEC 6c : coefficient désactivé accepté sur un autre chiffrage';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Le coefficient « TEST coefficient client » est désactivé%' then raise exception 'ECHEC 6c : %', v_msg; end if;
  end;
  update public.coefficients_vente set actif = true where id = v_coef13.id;
  begin
    perform public.simuler_conditions_chiffrage(v_projet, 'global', gen_random_uuid(), 'ouvrage', null);
    raise exception 'ECHEC 6d : coefficient inexistant accepté';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'Coefficient de vente introuvable.' then raise exception 'ECHEC 6d : %', v_msg; end if;
  end;
  begin
    perform public.simuler_conditions_chiffrage(v_projet, 'global', null, 'ouvrage', null);
    raise exception 'ECHEC 6e : global sans identifiant accepté';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'Coefficient global non sélectionné.' then raise exception 'ECHEC 6e : %', v_msg; end if;
  end;
  begin
    perform public.simuler_conditions_chiffrage(v_projet, 'partout', null, 'ouvrage', null);
    raise exception 'ECHEC 6f : mode invalide accepté';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Mode invalide%' then raise exception 'ECHEC 6f : %', v_msg; end if;
  end;
  v_ok := array_append(v_ok, '6 désactivé : refusé en nouvelle sélection, conservé + signalé s''il est déjà figé ; inexistant, id manquant, mode invalide refusés');

  -- ── 7. Retour aux paramètres de chaque ouvrage (origine figée) ──────────────
  v_res := public.simuler_conditions_chiffrage(v_projet, 'ouvrage', null, 'ouvrage', null);
  if (v_res->'lignes'->0->>'prix_apres')::numeric <> 270 then raise exception 'ECHEC 7 : retour simulé %', v_res->'lignes'->0->>'prix_apres'; end if;
  v_res2 := public.appliquer_conditions_chiffrage(v_projet, 'ouvrage', null, 'ouvrage', null, (v_res->>'version_attendue')::int, v_res->>'hash_lignes');
  select * into v_l from public.profero_ouvrages_selectionnes where id = v_l_v2;
  if v_l.prix_unitaire <> 270 or v_l.coef_vente <> 1.5 or v_l.taux_horaire_vente <> 80 or v_l.coefficient_source <> 'ouvrage' or v_l.taux_horaire_source <> 'ouvrage'
     or v_l.coefficient_global_id is not null or v_l.taux_horaire_global_id is not null or v_l.coefficient_origine_valeur <> 1.5 or v_l.taux_horaire_origine_valeur <> 80 then
    raise exception 'ECHEC 7 : retour ligne %', to_jsonb(v_l); end if;
  select * into v_p from public.profero_projets where id = v_projet;
  if v_p.mode_coefficient <> 'ouvrage' or v_p.coefficient_global_id is not null or v_p.coefficient_global_valeur is not null or v_p.coefficient_global_libelle is not null
     or v_p.mode_taux_horaire <> 'ouvrage' or v_p.taux_horaire_global_id is not null or v_p.conditions_version <> 3 then raise exception 'ECHEC 7 : retour projet %', to_jsonb(v_p); end if;
  select count(*) into v_nb from public.chiffrage_conditions_historique where projet_id = v_projet;
  if v_nb <> 3 then raise exception 'ECHEC 7 : historique % entrées', v_nb; end if;
  v_ok := array_append(v_ok, '7 retour aux paramètres de chaque ouvrage : 252 → 270 depuis l''origine figée, champs globaux vidés, 3 entrées d''historique');

  -- ── 8. Origine absente : retour impossible sur cette ligne, signalée ────────
  v_res := public.simuler_conditions_chiffrage(v_projet, 'global', v_coef13.id, 'ouvrage', null);
  v_res2 := public.appliquer_conditions_chiffrage(v_projet, 'global', v_coef13.id, 'ouvrage', null, (v_res->>'version_attendue')::int, v_res->>'hash_lignes');
  update public.profero_ouvrages_selectionnes set coefficient_origine_valeur = null, calcul_detail = calcul_detail - 'coefficient_vente_libelle' - 'coefficient_origine' where id = v_l_v2;
  v_res := public.simuler_conditions_chiffrage(v_projet, 'ouvrage', null, 'ouvrage', null);
  if (v_res->>'nb_lignes_recalculees')::int <> 0 or (v_res->>'nb_lignes_ignorees')::int <> 2 then raise exception 'ECHEC 8 : % / %', v_res->>'nb_lignes_recalculees', v_res->>'nb_lignes_ignorees'; end if;
  if not (v_res->'lignes_ignorees')::text like '%coefficient d''origine de l''ouvrage absent%' then raise exception 'ECHEC 8 : raison %', v_res->'lignes_ignorees'; end if;
  -- …mais un taux global reste applicable à cette ligne (le coefficient d'origine n'est pas requis)
  v_res := public.simuler_conditions_chiffrage(v_projet, 'global', v_coef13.id, 'global', v_taux70.id);
  if (v_res->>'nb_lignes_recalculees')::int <> 1 then raise exception 'ECHEC 8b'; end if;
  v_ok := array_append(v_ok, '8 origine absente ⇒ retour ouvrage refusé pour la ligne (signalée, rien d''inventé), global toujours applicable');

  -- ── 9. Chiffrage signé : interdit ───────────────────────────────────────────
  update public.profero_projets set statut = 'signe' where id = v_projet;
  begin
    perform public.simuler_conditions_chiffrage(v_projet, 'ouvrage', null, 'ouvrage', null);
    raise exception 'ECHEC 9 : chiffrage signé modifiable';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Chiffrage signé%' then raise exception 'ECHEC 9 : %', v_msg; end if;
  end;
  update public.profero_projets set statut = 'chiffrage', progbat_devis_id = '453' where id = v_projet;
  v_res := public.simuler_conditions_chiffrage(v_projet, 'ouvrage', null, 'global', v_taux70.id);
  if not (v_res->'avertissements')::text like '%brouillon ProGBat existe déjà%ne sera PAS actualisé%' then raise exception 'ECHEC 9b : devis ProGBat non signalé'; end if;
  if v_res->>'devis_progbat_id' <> '453' then raise exception 'ECHEC 9b : id devis'; end if;
  update public.profero_projets set progbat_devis_id = null where id = v_projet;
  v_ok := array_append(v_ok, '9 chiffrage signé refusé ; brouillon ProGBat existant signalé (jamais modifié)');

  -- ── 10. Contraintes : cohérence des colonnes du projet ──────────────────────
  begin
    update public.profero_projets set mode_coefficient = 'global' where id = v_autre;   -- sans id/valeur (projet en mode ouvrage)
    raise exception 'ECHEC 10 : global sans valeur accepté';
  exception when check_violation then null;
  end;
  begin
    update public.profero_ouvrages_selectionnes set coefficient_source = 'bibliotheque' where id = v_l_v2;
    raise exception 'ECHEC 10 : source inconnue acceptée';
  exception when check_violation then null;
  end;
  v_ok := array_append(v_ok, '10 contraintes : mode global sans valeur figée refusé, source de ligne inconnue refusée');

  -- ── 11. RLS ─────────────────────────────────────────────────────────────────
  select email into v_email_ouvrier from public.utilisateurs where role = 'ouvrier' and actif limit 1;
  select email into v_email_bureau  from public.utilisateurs where role in ('commercial', 'comptable', 'agent_edl') and actif limit 1;
  if v_email_ouvrier is not null then
    perform set_config('request.jwt.claims', json_build_object('email', v_email_ouvrier, 'role', 'authenticated')::text, true);
    begin
      set local role authenticated;
      perform public.simuler_conditions_chiffrage(v_projet, 'ouvrage', null, 'ouvrage', null);
      reset role;
      raise exception 'ECHEC 11a : ouvrier autorisé';
    exception when others then
      reset role;
      get stacked diagnostics v_msg = message_text;
      if v_msg <> 'Chiffrage introuvable ou non accessible.' then raise exception 'ECHEC 11a : %', v_msg; end if;
    end;
    set local role authenticated;
    select count(*) into v_nb from public.chiffrage_conditions_historique where projet_id = v_projet;
    reset role;
    if v_nb <> 0 then raise exception 'ECHEC 11a : ouvrier lit l''historique'; end if;
    v_ok := array_append(v_ok, '11a ouvrier : chiffrage inaccessible, historique invisible');
  end if;
  if v_email_bureau is not null then
    perform set_config('request.jwt.claims', json_build_object('email', v_email_bureau, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_res := public.simuler_conditions_chiffrage(v_projet, 'ouvrage', null, 'global', v_taux70.id);
    v_res2 := public.appliquer_conditions_chiffrage(v_projet, 'ouvrage', null, 'global', v_taux70.id, (v_res->>'version_attendue')::int, v_res->>'hash_lignes');
    select count(*) into v_nb from public.chiffrage_conditions_historique where projet_id = v_projet and utilisateur_email = v_email_bureau;
    reset role;
    if not (v_res2->>'applique')::boolean or v_nb <> 1 then raise exception 'ECHEC 11b : bureau % / %', v_res2->>'applique', v_nb; end if;
    select * into v_p from public.profero_projets where id = v_projet;
    if v_p.mode_taux_horaire <> 'global' or v_p.taux_horaire_global_valeur <> 75 then raise exception 'ECHEC 11b : projet non mis à jour par le bureau'; end if;
    begin
      set local role authenticated;
      update public.chiffrage_conditions_historique set nouveau_total_ht = 0 where projet_id = v_projet;
      reset role;
      raise exception 'ECHEC 11c : historique modifiable';
    exception when insufficient_privilege then reset role;
    end;
    begin
      set local role authenticated;
      delete from public.chiffrage_conditions_historique where projet_id = v_projet;
      reset role;
      raise exception 'ECHEC 11c : historique supprimable';
    exception when insufficient_privilege then reset role;
    end;
    begin
      set local role authenticated;
      perform public.conditions_chiffrage_evaluer(v_projet, 'ouvrage', null, 'ouvrage', null, true, 0, 'x');
      reset role;
      raise exception 'ECHEC 11d : appel direct du cœur avec version périmée accepté';
    exception when others then
      reset role;
      get stacked diagnostics v_msg = message_text;
      if v_msg not like 'Le chiffrage a été modifié depuis la simulation%' then raise exception 'ECHEC 11d : %', v_msg; end if;
    end;
    v_ok := array_append(v_ok, '11b-d bureau : simulation + application autorisées (auteur tracé), historique ni modifiable ni supprimable, cœur direct soumis aux mêmes contrôles');
  end if;

  -- ── 12. Aucune autre ligne touchée ──────────────────────────────────────────
  select md5(coalesce(string_agg(id::text || coalesce(prix_unitaire::text, '') || coalesce(calcul_version, '') || coalesce(coef_vente::text, ''), ',' order by id), '')) into v_txt
    from public.profero_ouvrages_selectionnes where projet_id not in (v_projet, v_autre);
  if v_txt <> v_autres_avant then raise exception 'ECHEC 12 : d''autres lignes ont changé'; end if;
  v_ok := array_append(v_ok, '12 aucune ligne d''un autre chiffrage modifiée');

  raise exception 'TESTS_OK (%): %', array_length(v_ok, 1), array_to_string(v_ok, ' | ');
end $$;
