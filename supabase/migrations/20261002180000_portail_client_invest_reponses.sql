-- ============================================================================
-- Portail client Invest — le client remplit et corrige SES données (02/10/2026).
-- Décision de Matthieu : fin du « lecture seule d'abord » pour la collecte.
--
-- PRINCIPE (le client n'écrit JAMAIS dans le dossier)
--   • Il saisit son dossier par sections (foyer, flux, patrimoine, dettes, objectifs).
--   • Sa saisie va dans une table d'ATTENTE (invest_portail_reponses), nettoyée côté
--     base : seules les clés et valeurs prévues par portail_schema_reponses() sont
--     conservées (types contrôlés, listes de choix, longueurs et nombres d'éléments plafonnés).
--   • Un collaborateur la lit dans le CRM, la compare au dossier et la VALIDE (ou la
--     refuse) : c'est l'application du dossier qui l'intègre, pas le client.
--
-- ACCÈS DU CLIENT : aucune policy sur la table (la règle 3a le refuse), uniquement
--   portail_enregistrer_reponse(section, donnees, soumettre)  écrit sa propre saisie
--   portail_reponses (vue)                                    relit sa propre saisie
--   portail_donnees_dossier()                                 relit les valeurs connues de Profero,
--                                                             limitées aux champs du schéma (jamais
--                                                             analyses, notes, honoraires)
--   portail_maj_telephone(tel)                                corrige son téléphone
--   L'e-mail est l'identifiant de connexion : il ne se modifie pas ici.
--
-- RETOUR ARRIÈRE : sql/202610_portail_client_invest_reponses_rollback.sql
-- VÉRIFICATION  : node scripts/verif-portail-reponses.mjs
-- ============================================================================

-- Schéma des réponses : SEULE source côté base. src/Portail/portailChamps.mjs le reflète
-- (un test compare les deux). t = type (num, text, enum, bool, date), o = choix, max = éléments.
create or replace function public.portail_schema_reponses()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'foyer', jsonb_build_object(
      'champs', jsonb_build_object(
        'situation_familiale', jsonb_build_object('t','enum','o',jsonb_build_array('Célibataire','Marié(e)','Pacsé(e)','Divorcé(e)','Concubinage','Veuf/veuve')),
        'regime_matrimonial', jsonb_build_object('t','enum','o',jsonb_build_array('Communauté réduite aux acquêts','Séparation de biens','Participation aux acquêts','Communauté universelle','Non applicable')),
        'statut_pro', jsonb_build_object('t','enum','o',jsonb_build_array('Salarié CDI','Salarié CDD','Sportif professionnel','TNS / Indépendant','Chef d''entreprise','Profession libérale','Contrat étranger','Autre')),
        'profession', jsonb_build_object('t','text')),
      'listes', jsonb_build_object('enfants_liste', jsonb_build_object('max',8,'champs', jsonb_build_object(
        'prenom', jsonb_build_object('t','text'),
        'naissance', jsonb_build_object('t','date'),
        'union', jsonb_build_object('t','enum','o',jsonb_build_array('Commun','Union précédente')),
        'a_charge', jsonb_build_object('t','enum','o',jsonb_build_array('Oui','Non')),
        'besoins', jsonb_build_object('t','text'))))),
    'flux', jsonb_build_object(
      'champs', jsonb_build_object(
        'revenus_nets_mois', jsonb_build_object('t','num'), 'revenus_conjoint_mois', jsonb_build_object('t','num'),
        'dividendes_an', jsonb_build_object('t','num'), 'autres_revenus_an', jsonb_build_object('t','num'),
        'revenus_exceptionnels_an', jsonb_build_object('t','num'),
        'charges_logement', jsonb_build_object('t','num'), 'charges_assurances', jsonb_build_object('t','num'),
        'charges_vehicules', jsonb_build_object('t','num'), 'charges_scolarite', jsonb_build_object('t','num'),
        'charges_abonnements', jsonb_build_object('t','num'), 'charges_courantes', jsonb_build_object('t','num'),
        'charges_loisirs', jsonb_build_object('t','num'), 'charges_autres', jsonb_build_object('t','num'),
        'epargne_reelle_mois', jsonb_build_object('t','num')),
      'listes', '{}'::jsonb),
    'patrimoine', jsonb_build_object(
      'champs', jsonb_build_object(
        'residence_principale_statut', jsonb_build_object('t','enum','o',jsonb_build_array('Propriétaire — crédit en cours','Propriétaire — crédit soldé','Locataire','Hébergé(e)')),
        'rp_valeur', jsonb_build_object('t','num'), 'rp_crd', jsonb_build_object('t','num'),
        'aucun_bien', jsonb_build_object('t','bool'),
        'liquidites', jsonb_build_object('t','num'), 'assurance_vie', jsonb_build_object('t','num'), 'pea_cto', jsonb_build_object('t','num'),
        'per', jsonb_build_object('t','num'), 'epargne_salariale', jsonb_build_object('t','num'), 'autres_placements', jsonb_build_object('t','num')),
      'listes', jsonb_build_object('lots', jsonb_build_object('max',10,'champs', jsonb_build_object(
        'adresse', jsonb_build_object('t','text'),
        'type', jsonb_build_object('t','enum','o',jsonb_build_array('Studio','T1','T2','T3','T4','T5+','Commerce','Immeuble','SCPI','Autre')),
        'structure', jsonb_build_object('t','enum','o',jsonb_build_array('PP direct','SCI IR','SCI IS','SARL famille','Holding SAS','Démembrement','Autre')),
        'valeur', jsonb_build_object('t','num'), 'loyer_mois', jsonb_build_object('t','num'),
        'mensualite', jsonb_build_object('t','num'), 'crd', jsonb_build_object('t','num'))))),
    'dettes', jsonb_build_object(
      'champs', jsonb_build_object('aucune_autre_dette', jsonb_build_object('t','bool')),
      'listes', jsonb_build_object('dettes', jsonb_build_object('max',10,'champs', jsonb_build_object(
        'type', jsonb_build_object('t','enum','o',jsonb_build_array('Prêt étudiant','Crédit auto','Crédit consommation','Prêt professionnel','Découvert','Dette familiale','Caution personnelle','Autre')),
        'capital_restant', jsonb_build_object('t','num'), 'mensualite', jsonb_build_object('t','num'), 'taux', jsonb_build_object('t','num'))))),
    'objectifs', jsonb_build_object(
      'champs', jsonb_build_object(
        'profil_tolerance_endettement', jsonb_build_object('t','enum','o',jsonb_build_array('Faible','Moyenne','Élevée')),
        'profil_cashflow_negatif_max', jsonb_build_object('t','num'),
        'profil_appetence_travaux', jsonb_build_object('t','enum','o',jsonb_build_array('Aucune','Limitée','Forte')),
        'profil_appetence_gestion', jsonb_build_object('t','enum','o',jsonb_build_array('Délègue tout','Partage','Gère lui-même'))),
      'listes', jsonb_build_object('objectifs_mesures', jsonb_build_object('max',6,'champs', jsonb_build_object(
        'type', jsonb_build_object('t','enum','o',jsonb_build_array('Créer du patrimoine','Revenus complémentaires','Indépendance financière','Retraite','Résidence principale','Études des enfants','Protéger le conjoint','Transmettre','Réduire la fiscalité','Diversifier','Expatriation','Préparer la cession d''une entreprise','Autre')),
        'libelle', jsonb_build_object('t','text'), 'montant', jsonb_build_object('t','num'), 'echeance', jsonb_build_object('t','num'),
        'priorite', jsonb_build_object('t','enum','o',jsonb_build_array('1','2','3')),
        'flexibilite', jsonb_build_object('t','enum','o',jsonb_build_array('Fixe','Souple','Très souple'))))))
  );
$$;
revoke all on function public.portail_schema_reponses() from public, anon;
grant execute on function public.portail_schema_reponses() to authenticated;

-- Nettoie UNE valeur selon sa définition. Une valeur invalide devient null (elle est écartée).
create or replace function public.portail_nettoyer_valeur(v jsonb, def jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare t text := def->>'t'; s text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if t = 'bool' then
    return case when jsonb_typeof(v) = 'boolean' then v else null end;
  end if;
  if jsonb_typeof(v) not in ('string', 'number') then return null; end if;
  s := btrim(v #>> '{}');
  if t = 'num' then
    s := replace(s, ',', '.');
    if s ~ '^-?[0-9]{1,10}(\.[0-9]{1,4})?$' then return to_jsonb(trim_scale(s::numeric)::text); end if;
    return null;
  elsif t = 'text' then
    s := left(btrim(regexp_replace(s, '[[:cntrl:]]', '', 'g')), 200);
    return case when s = '' then null else to_jsonb(s) end;
  elsif t = 'enum' then
    return case when def->'o' ? s then to_jsonb(s) else null end;
  elsif t = 'date' then
    if s ~ '^\d{4}-\d{2}-\d{2}$' then
      begin perform s::date; return to_jsonb(s); exception when others then return null; end;
    end if;
    return null;
  end if;
  return null;
end;
$$;
revoke all on function public.portail_nettoyer_valeur(jsonb, jsonb) from public, anon, authenticated;

-- Nettoie une section entière : seules les clés du schéma, listes plafonnées, éléments vides écartés.
create or replace function public.portail_nettoyer_reponse(p_section text, p_donnees jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  sch jsonb := public.portail_schema_reponses() -> p_section;
  r jsonb := '{}'::jsonb; f record; g record; item jsonb; propre jsonb; liste jsonb; n int; val jsonb;
begin
  if sch is null then raise exception 'Section inconnue' using errcode = '22023'; end if;
  if p_donnees is null or jsonb_typeof(p_donnees) <> 'object' then raise exception 'Réponse invalide' using errcode = '22023'; end if;
  for f in select key, value from jsonb_each(sch -> 'champs') loop
    val := public.portail_nettoyer_valeur(p_donnees -> f.key, f.value);
    if val is not null then r := r || jsonb_build_object(f.key, val); end if;
  end loop;
  for f in select key, value from jsonb_each(coalesce(sch -> 'listes', '{}'::jsonb)) loop
    liste := '[]'::jsonb; n := 0;
    if jsonb_typeof(p_donnees -> f.key) = 'array' then
      for item in select value from jsonb_array_elements(p_donnees -> f.key) loop
        exit when n >= (f.value ->> 'max')::int;
        if jsonb_typeof(item) = 'object' then
          propre := '{}'::jsonb;
          for g in select key, value from jsonb_each(f.value -> 'champs') loop
            val := public.portail_nettoyer_valeur(item -> g.key, g.value);
            if val is not null then propre := propre || jsonb_build_object(g.key, val); end if;
          end loop;
          if propre <> '{}'::jsonb then liste := liste || jsonb_build_array(propre); n := n + 1; end if;
        end if;
      end loop;
    end if;
    r := r || jsonb_build_object(f.key, liste);
  end loop;
  return r;
end;
$$;
revoke all on function public.portail_nettoyer_reponse(text, jsonb) from public, anon, authenticated;

-- Table d'attente. Le client n'y a AUCUN accès direct.
create table public.invest_portail_reponses (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.invest_clients(id) on delete cascade,
  section       text not null check (section in ('foyer', 'flux', 'patrimoine', 'dettes', 'objectifs')),
  donnees       jsonb not null check (jsonb_typeof(donnees) = 'object' and pg_column_size(donnees) < 30000),
  statut        text not null default 'brouillon' check (statut in ('brouillon', 'soumis', 'valide', 'refuse', 'remplace')),
  cree_le       timestamptz not null default now(),
  modifie_le    timestamptz not null default now(),
  soumis_le     timestamptz,
  traite_par    text,
  traite_le     timestamptz,
  note_traitement text
);
create unique index invest_portail_reponses_brouillon_uniq on public.invest_portail_reponses (client_id, section) where statut = 'brouillon';
create index invest_portail_reponses_client_idx on public.invest_portail_reponses (client_id, section, cree_le desc);

alter table public.invest_portail_reponses enable row level security;
revoke all on public.invest_portail_reponses from anon;
grant select, update on public.invest_portail_reponses to authenticated;

-- Les collaborateurs lisent et traitent (valider / refuser) ; personne n'insère ni ne supprime en direct.
create policy invest_portail_reponses_collaborateurs on public.invest_portail_reponses
  for select to authenticated using ((select public.est_collaborateur_actif()));
create policy invest_portail_reponses_traitement on public.invest_portail_reponses
  for update to authenticated using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));
create policy profero_collaborateurs_seulement on public.invest_portail_reponses
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif()))
  with check ((select public.est_collaborateur_actif()));

-- Le client enregistre (brouillon) ou soumet SA saisie. Aucun identifiant de client en paramètre.
create or replace function public.portail_enregistrer_reponse(p_section text, p_donnees jsonb, p_soumettre boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare cid uuid := public.portail_client_id(); propre jsonb; rid uuid;
begin
  if cid is null then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if p_section is null or p_section not in ('foyer', 'flux', 'patrimoine', 'dettes', 'objectifs') then
    raise exception 'Section inconnue' using errcode = '22023';
  end if;
  propre := public.portail_nettoyer_reponse(p_section, p_donnees);
  select id into rid from public.invest_portail_reponses where client_id = cid and section = p_section and statut = 'brouillon' for update;
  if rid is null then
    insert into public.invest_portail_reponses (client_id, section, donnees) values (cid, p_section, propre) returning id into rid;
  else
    update public.invest_portail_reponses set donnees = propre, modifie_le = now() where id = rid;
  end if;
  if coalesce(p_soumettre, false) then
    update public.invest_portail_reponses set statut = 'remplace' where client_id = cid and section = p_section and statut = 'soumis';
    update public.invest_portail_reponses set statut = 'soumis', soumis_le = now(), modifie_le = now() where id = rid;
  end if;
  return jsonb_build_object('id', rid, 'statut', case when coalesce(p_soumettre, false) then 'soumis' else 'brouillon' end);
end;
$$;
revoke all on function public.portail_enregistrer_reponse(text, jsonb, boolean) from public, anon;
grant execute on function public.portail_enregistrer_reponse(text, jsonb, boolean) to authenticated;

-- Ce que le client a saisi : le brouillon en cours s'il existe, sinon la dernière réponse de chaque section.
create view public.portail_reponses with (security_barrier = true) as
  select distinct on (r.section) r.section, r.statut, r.donnees, r.soumis_le, r.traite_le, r.note_traitement, r.modifie_le
  from public.invest_portail_reponses r
  where r.client_id = (select public.portail_client_id())
    and r.statut in ('brouillon', 'soumis', 'valide', 'refuse')
  order by r.section, case r.statut when 'brouillon' then 0 else 1 end, r.cree_le desc;
revoke all on public.portail_reponses from public, anon, authenticated;
grant select on public.portail_reponses to authenticated;

-- Les valeurs que Profero connaît déjà, pour que le client les relise et les corrige.
-- Limité aux champs du schéma : jamais les analyses, notes, honoraires ni la conformité.
create or replace function public.portail_donnees_dossier()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare cid uuid := public.portail_client_id(); d jsonb; c jsonb;
begin
  if cid is null then raise exception 'Accès refusé' using errcode = '42501'; end if;
  select s.donnees into d from public.invest_structuration_patrimoniale s where s.client_id = cid order by s.created_at desc limit 1;
  if d is null then return '{}'::jsonb; end if;
  c := d -> 'collecte';
  return jsonb_build_object(
    'foyer', public.portail_nettoyer_reponse('foyer', jsonb_build_object(
      'situation_familiale', c #> '{profil,situation_familiale}', 'regime_matrimonial', c #> '{profil,regime_matrimonial}',
      'statut_pro', c #> '{profil,statut_pro}', 'profession', c #> '{profil,profession}', 'enfants_liste', c -> 'enfants_liste')),
    'flux', public.portail_nettoyer_reponse('flux', jsonb_build_object(
      'revenus_nets_mois', c #> '{profil,revenus_nets_mois}', 'revenus_conjoint_mois', c #> '{profil,revenus_conjoint_mois}',
      'dividendes_an', c #> '{profil,dividendes_an}', 'autres_revenus_an', c #> '{profil,autres_revenus_an}',
      'revenus_exceptionnels_an', c #> '{profil,revenus_exceptionnels_an}',
      'charges_logement', c #> '{charges,logement}', 'charges_assurances', c #> '{charges,assurances}', 'charges_vehicules', c #> '{charges,vehicules}',
      'charges_scolarite', c #> '{charges,scolarite}', 'charges_abonnements', c #> '{charges,abonnements}', 'charges_courantes', c #> '{charges,courantes}',
      'charges_loisirs', c #> '{charges,loisirs}', 'charges_autres', c #> '{charges,autres}', 'epargne_reelle_mois', c #> '{charges,epargne_reelle_mois}')),
    'patrimoine', public.portail_nettoyer_reponse('patrimoine', jsonb_build_object(
      'residence_principale_statut', c #> '{patrimoine,residence_principale_statut}', 'rp_valeur', c #> '{patrimoine,rp_valeur}', 'rp_crd', c #> '{patrimoine,rp_crd}',
      'aucun_bien', c #> '{patrimoine,aucun_bien}', 'liquidites', c #> '{patrimoine_financier,liquidites}', 'assurance_vie', c #> '{patrimoine_financier,assurance_vie}',
      'pea_cto', c #> '{patrimoine_financier,pea_cto}', 'per', c #> '{patrimoine_financier,per}', 'epargne_salariale', c #> '{patrimoine_financier,epargne_salariale}',
      'autres_placements', c #> '{patrimoine_financier,autres}', 'lots', c #> '{patrimoine,lots}')),
    'dettes', public.portail_nettoyer_reponse('dettes', jsonb_build_object('aucune_autre_dette', c #> '{patrimoine,aucune_autre_dette}', 'dettes', c -> 'dettes')),
    'objectifs', public.portail_nettoyer_reponse('objectifs', jsonb_build_object(
      'profil_tolerance_endettement', c #> '{profil_immo,tolerance_endettement}', 'profil_cashflow_negatif_max', c #> '{profil_immo,cashflow_negatif_max}',
      'profil_appetence_travaux', c #> '{profil_immo,appetence_travaux}', 'profil_appetence_gestion', c #> '{profil_immo,appetence_gestion}',
      'objectifs_mesures', c -> 'objectifs_mesures')));
end;
$$;
revoke all on function public.portail_donnees_dossier() from public, anon;
grant execute on function public.portail_donnees_dossier() to authenticated;

-- Le client corrige son téléphone (l'e-mail est son identifiant de connexion : non modifiable ici).
create or replace function public.portail_maj_telephone(p_telephone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare cid uuid := public.portail_client_id(); t text := btrim(coalesce(p_telephone, ''));
begin
  if cid is null then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if t !~ '^[0-9+ ().-]{6,25}$' then raise exception 'Numéro de téléphone invalide' using errcode = '22023'; end if;
  update public.invest_clients set telephone = t where id = cid;
end;
$$;
revoke all on function public.portail_maj_telephone(text) from public, anon;
grant execute on function public.portail_maj_telephone(text) to authenticated;

-- Le client voit son téléphone (pour le corriger). Colonne ajoutée à la fin : droits conservés.
create or replace view public.portail_client with (security_barrier = true) as
  select c.prenom, c.nom, c.telephone
  from public.invest_clients c
  where c.id = (select public.portail_client_id());
revoke all on public.portail_client from public, anon, authenticated;
grant select on public.portail_client to authenticated;
