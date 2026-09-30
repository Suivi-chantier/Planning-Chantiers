-- ============================================================================
-- Chantier 1.1 — Tranche 2c : Foyer & Situation patrimoniale (collecte factuelle).
--
-- ADDITIVE. Crée 5 tables rattachées au CLIENT (= le foyer, invest_clients) :
--   invest_personnes, invest_postes_financiers, invest_engagements,
--   invest_actifs_patrimoniaux, invest_structures.
-- Aucune table existante modifiée hors : liste des types d'événements du
-- journal (+ collecte_ajout, collecte_modification, collecte_verification).
-- invest_structuration_patrimoniale (ancien écran) n'est PAS touchée ; aucune
-- donnée reprise.
--
-- Principes :
--   - les données appartiennent au client et servent plusieurs dossiers
--     successifs ; le Dossier Invest est le CONTEXTE de collecte : une écriture
--     n'est possible que si le client a un dossier en cours (ouvert, actif,
--     suspendu) ; dossier clos = lecture seule ;
--   - provenance commune (source client / profero / reprise, auteur
--     collaborateur, futur auteur client via son identifiant Auth) ;
--   - vérification : non_verifiee / verifiee / a_corriger ; modifier une donnée
--     métier vérifiée la repasse non_verifiee ; seul un collaborateur vérifie ;
--   - pas de suppression depuis le navigateur : on archive (archive_le) ;
--   - journal : ajout, modification, vérification, dans le dossier en cours.
-- Règles d'écriture dans un déclencheur aux droits de l'appelant (même
-- principe que invest_etapes_regles_pilotage) : la maintenance (postgres)
-- y échappe, pas la clé serveur.
--
-- RETOUR ARRIÈRE : sql/202609_invest_situation_patrimoniale_2c_rollback.sql
-- VÉRIFICATION  : node scripts/verif-invest-dossiers-t1.mjs
-- ============================================================================

-- ── Journal : nouveaux types d'événements ───────────────────────────────────
alter table public.invest_dossier_evenements drop constraint if exists invest_dossier_evenements_type_check;
alter table public.invest_dossier_evenements add constraint invest_dossier_evenements_type_check
  check (type in ('dossier_cree','dossier_statut_change','dossier_modifie',
    'lettre_mission_change','conseiller_change','etape_statut_change','etape_balle_change',
    'etape_echeance_change','etape_prochaine_action_change','etape_bloquee','etape_debloquee',
    'reprise_importee','etape_reprise_confirmee',
    'collecte_ajout','collecte_modification','collecte_verification'));

-- ── 1. Personnes du foyer ───────────────────────────────────────────────────
create table if not exists public.invest_personnes (
  id                      uuid primary key default gen_random_uuid(),
  client_id               uuid not null references public.invest_clients(id) on delete restrict,
  lien                    text not null check (lien in ('principal','conjoint','enfant','ascendant','autre')),
  co_emprunteur           boolean not null default false,
  a_charge                boolean not null default false,
  garde_alternee          boolean not null default false,
  civilite                text check (civilite in ('m','mme','autre')),
  prenom                  text,
  nom                     text,
  nom_naissance           text,
  date_naissance          date,
  nationalite             text,
  pays_residence_fiscale  text,
  email                   text,
  telephone               text,
  adresse                 text,
  statut_professionnel    text check (statut_professionnel in ('salarie_cdi','salarie_cdd','fonctionnaire','tns',
                            'dirigeant','retraite','sans_activite','etudiant','autre')),
  profession              text,
  employeur               text,
  date_debut_activite     date,
  ordre                   integer not null default 0,
  constraint invest_personnes_identite check (btrim(coalesce(prenom, '')) <> '' or btrim(coalesce(nom, '')) <> '')
);
-- Un principal et un conjoint ACTIFS au plus par foyer (les archivés ne comptent pas).

-- ── 2. Structures (avant les actifs, qui peuvent y être détenus) ────────────
create table if not exists public.invest_structures (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.invest_clients(id) on delete restrict,
  type               text not null check (type in ('sci','holding','societe_exploitation','sarl_famille','autre')),
  forme_juridique    text,
  denomination       text not null check (btrim(denomination) <> ''),
  siren              text check (siren is null or siren ~ '^[0-9]{9}$'),
  regime_fiscal      text check (regime_fiscal in ('ir','is')),
  statut             text not null default 'existante' check (statut in ('existante','en_creation','dissoute')),
  date_creation      date,
  capital            numeric(14,2) check (capital is null or capital >= 0),
  activite           text,
  gerant             text,
  -- [{ "personne_id": uuid|null, "nom": text|null, "pourcentage": number|null, "role": text|null }]
  -- Total ≠ 100 % accepté (collecte en cours) : l'écran l'indique, la base ne bloque pas.
  associes           jsonb not null default '[]'::jsonb check (jsonb_typeof(associes) = 'array'),
  dernier_resultat   numeric(14,2),
  dernier_exercice   integer check (dernier_exercice is null or dernier_exercice between 1900 and 2200),
  commentaire        text
);

-- ── 3. Patrimoine déjà détenu (≠ invest_biens, les biens recherchés) ────────
create table if not exists public.invest_actifs_patrimoniaux (
  id                      uuid primary key default gen_random_uuid(),
  client_id               uuid not null references public.invest_clients(id) on delete restrict,
  usage                   text not null check (usage in ('residence_principale','residence_secondaire','locatif',
                            'professionnel','terrain','autre')),
  typologie               text check (typologie in ('appartement','maison','immeuble','local','terrain','parking','autre')),
  libelle                 text,
  adresse                 text,
  date_acquisition        date,
  prix_acquisition        numeric(14,2) check (prix_acquisition is null or prix_acquisition >= 0),
  valeur_estimee          numeric(14,2) check (valeur_estimee is null or valeur_estimee >= 0),
  date_valeur             date,
  source_valorisation     text check (source_valorisation in ('estimation_client','estimation_profero','expertise',
                            'avis_valeur','prix_acquisition','autre')),
  loyer_mensuel           numeric(12,2) check (loyer_mensuel is null or loyer_mensuel >= 0),
  charges_annuelles       numeric(12,2) check (charges_annuelles is null or charges_annuelles >= 0),
  taxe_fonciere_annuelle  numeric(12,2) check (taxe_fonciere_annuelle is null or taxe_fonciere_annuelle >= 0),
  regime_fiscal           text check (regime_fiscal in ('micro_foncier','reel_foncier','lmnp_micro','lmnp_reel','lmp',
                            'sci_ir','sci_is','aucun','autre')),
  mode_detention          text check (mode_detention in ('propre','communaute','indivision','structure','demembrement','autre')),
  structure_id            uuid references public.invest_structures(id) on delete restrict,
  -- [{ "personne_id": uuid, "quote_part": number|null, "droit": "pleine_propriete"|"usufruit"|"nue_propriete"|null }]
  detenteurs              jsonb not null default '[]'::jsonb check (jsonb_typeof(detenteurs) = 'array'),
  travaux                 text,
  travaux_montant         numeric(14,2) check (travaux_montant is null or travaux_montant >= 0),
  commentaire             text,
  statut                  text not null default 'detenu' check (statut in ('detenu','en_vente','vendu')),
  date_vente              date,
  prix_vente              numeric(14,2) check (prix_vente is null or prix_vente >= 0),
  bien_id                 uuid references public.invest_biens(id) on delete set null,
  operation_id            uuid,
  constraint invest_actifs_structure check (mode_detention is distinct from 'structure' or structure_id is not null)
);

-- ── 4. Revenus, charges, actifs financiers ──────────────────────────────────
create table if not exists public.invest_postes_financiers (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.invest_clients(id) on delete restrict,
  personne_id     uuid references public.invest_personnes(id) on delete restrict,
  famille         text not null check (famille in ('revenu','charge','actif_financier')),
  categorie       text not null,
  libelle         text,
  montant         numeric(14,2) not null check (montant >= 0),
  -- Flux (revenu, charge) : périodicité obligatoire. Stock (actif financier) : aucune.
  periodicite     text check (periodicite in ('mensuelle','annuelle')),
  -- Revenus seulement. Saisie : net avant impôt ; « non précisée » pour l'historique.
  base_revenu     text check (base_revenu in ('net_avant_impot','net_apres_impot','non_precisee')),
  etablissement   text,
  date_valeur     date,
  commentaire     text,
  constraint invest_postes_categorie check (
    (famille = 'revenu' and categorie in ('salaire','tns','dividendes','retraite','allocation','pension_recue','autre'))
    or (famille = 'charge' and categorie in ('charge_fixe','loyer_residence','impot','autre'))
    or (famille = 'actif_financier' and categorie in ('epargne_disponible','assurance_vie','pea','cto','per',
        'epargne_salariale','scpi','crypto','autre'))),
  constraint invest_postes_periodicite check (
    (famille in ('revenu','charge') and periodicite is not null) or (famille = 'actif_financier' and periodicite is null)),
  constraint invest_postes_base check ((famille = 'revenu') = (base_revenu is not null))
);

-- ── 5. Dettes et engagements ────────────────────────────────────────────────
create table if not exists public.invest_engagements (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references public.invest_clients(id) on delete restrict,
  type                 text not null check (type in ('credit_immobilier','credit_consommation','pret_personnel','revolving',
                         'pret_familial','pension_versee','caution','hors_bilan_autre')),
  preteur_beneficiaire text,
  libelle              text,
  mensualite           numeric(12,2) check (mensualite is null or mensualite >= 0),
  assurance_mensuelle  numeric(12,2) check (assurance_mensuelle is null or assurance_mensuelle >= 0),
  capital_initial      numeric(14,2) check (capital_initial is null or capital_initial >= 0),
  capital_restant_du   numeric(14,2) check (capital_restant_du is null or capital_restant_du >= 0),
  crd_date             date,
  taux                 numeric(6,3) check (taux is null or taux >= 0),
  type_taux            text check (type_taux in ('fixe','variable','capee','zero','autre')),
  duree_mois           integer check (duree_mois is null or duree_mois > 0),
  date_debut           date,
  date_fin             date,
  montant_garanti      numeric(14,2) check (montant_garanti is null or montant_garanti >= 0),
  personne_id          uuid references public.invest_personnes(id) on delete restrict,
  co_emprunteurs       uuid[] not null default '{}',
  asset_id             uuid references public.invest_actifs_patrimoniaux(id) on delete restrict,
  solde                boolean not null default false,
  commentaire          text,
  constraint invest_engagements_dates check (date_fin is null or date_debut is null or date_fin >= date_debut)
);

-- ── Colonnes communes : provenance, vérification, archivage, contexte ───────
do $$
declare t text;
begin
  foreach t in array array['invest_personnes','invest_structures','invest_actifs_patrimoniaux',
                           'invest_postes_financiers','invest_engagements'] loop
    execute format($f$
      alter table public.%1$I
        add column if not exists dossier_id uuid references public.invest_dossiers(id) on delete set null,
        add column if not exists source text not null default 'profero',
        add column if not exists cree_par_id uuid references public.utilisateurs(id) on delete set null,
        add column if not exists cree_par_auth_id uuid,
        add column if not exists modifie_par_id uuid references public.utilisateurs(id) on delete set null,
        add column if not exists modifie_par_auth_id uuid,
        add column if not exists created_at timestamptz not null default now(),
        add column if not exists updated_at timestamptz not null default now(),
        add column if not exists verification_statut text not null default 'non_verifiee',
        add column if not exists verifie_par_id uuid references public.utilisateurs(id) on delete set null,
        add column if not exists verifie_le timestamptz,
        add column if not exists verification_commentaire text,
        add column if not exists archive_le timestamptz$f$, t);
    execute format('alter table public.%1$I drop constraint if exists %1$s_source_check', t);
    execute format($f$alter table public.%1$I add constraint %1$s_source_check check (source in ('client','profero','reprise'))$f$, t);
    execute format('alter table public.%1$I drop constraint if exists %1$s_verification_check', t);
    execute format($f$alter table public.%1$I add constraint %1$s_verification_check
      check (verification_statut in ('non_verifiee','verifiee','a_corriger'))$f$, t);
    execute format('create index if not exists %1$s_client_idx on public.%1$I (client_id) where archive_le is null', t);
  end loop;
end $$;

create unique index if not exists invest_personnes_un_principal on public.invest_personnes (client_id)
  where lien = 'principal' and archive_le is null;
create unique index if not exists invest_personnes_un_conjoint on public.invest_personnes (client_id)
  where lien = 'conjoint' and archive_le is null;

-- ── Libellés du journal ─────────────────────────────────────────────────────
create or replace function public.invest_collecte_objet(p_table text, j jsonb)
returns text language sql immutable set search_path = '' as $$
  select case p_table
    when 'invest_personnes' then 'Foyer : ' || btrim(coalesce(j->>'prenom','') || ' ' || coalesce(j->>'nom','')) || ' (' || coalesce(j->>'lien','?') || ')'
    when 'invest_postes_financiers' then
      case j->>'famille' when 'revenu' then 'Revenu' when 'charge' then 'Charge' else 'Actif financier' end
      || ' : ' || coalesce(nullif(btrim(j->>'libelle'),''), j->>'categorie') || ' ' || coalesce(j->>'montant','?') || ' €'
      || case j->>'periodicite' when 'mensuelle' then '/mois' when 'annuelle' then '/an' else '' end
    when 'invest_engagements' then 'Engagement : ' || coalesce(j->>'type','?')
      || coalesce(' ' || nullif(btrim(j->>'preteur_beneficiaire'),''), '')
    when 'invest_actifs_patrimoniaux' then 'Patrimoine immobilier : ' || coalesce(nullif(btrim(j->>'libelle'),''), j->>'usage')
      || coalesce(' — ' || nullif(btrim(j->>'adresse'),''), '')
    when 'invest_structures' then 'Structure : ' || coalesce(j->>'denomination','?')
    else p_table end;
$$;

-- Clés techniques : leur changement n'est pas une modification de la donnée.
create or replace function public.invest_collecte_metier(j jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select j - array['id','client_id','dossier_id','source','cree_par_id','cree_par_auth_id','modifie_par_id',
    'modifie_par_auth_id','created_at','updated_at','verification_statut','verifie_par_id','verifie_le',
    'verification_commentaire','archive_le'];
$$;

-- Un identifiant référencé appartient-il bien au même foyer ?
create or replace function public.invest_collecte_meme_client(p_table text, p_id uuid, p_client uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  if p_id is null then return true; end if;
  execute format('select client_id from public.%I where id = $1', p_table) into v using p_id;
  return v is not distinct from p_client;
end;
$$;

-- ── Avant écriture (droits du propriétaire) : auteur, contexte, vérification ─
create or replace function public.invest_collecte_avant_ecriture()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  a record;
  n jsonb := to_jsonb(new);
  v_auth uuid := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;
  v_dossier uuid;
  x jsonb;
begin
  select * into a from public.invest_auteur_courant();
  if tg_op = 'UPDATE' and new.client_id is distinct from old.client_id then
    raise exception 'Une donnée patrimoniale ne change pas de foyer.' using errcode = '23514';
  end if;
  -- Références : toujours du même foyer.
  if not public.invest_collecte_meme_client('invest_personnes', nullif(n->>'personne_id','')::uuid, new.client_id)
     or not public.invest_collecte_meme_client('invest_actifs_patrimoniaux', nullif(n->>'asset_id','')::uuid, new.client_id)
     or not public.invest_collecte_meme_client('invest_structures', nullif(n->>'structure_id','')::uuid, new.client_id) then
    raise exception 'Référence à une personne, un actif ou une structure d''un autre foyer.' using errcode = '23514';
  end if;
  -- Lecture par le JSON de la ligne : ce déclencheur sert aux cinq tables.
  if exists (select 1 from jsonb_array_elements_text(coalesce(n->'co_emprunteurs', '[]'::jsonb)) p
             where not public.invest_collecte_meme_client('invest_personnes', p::uuid, new.client_id)) then
    raise exception 'Co-emprunteur d''un autre foyer.' using errcode = '23514';
  end if;
  for x in select * from jsonb_array_elements(coalesce(n->'detenteurs', '[]'::jsonb) || coalesce(n->'associes', '[]'::jsonb)) loop
    if not public.invest_collecte_meme_client('invest_personnes', nullif(x->>'personne_id','')::uuid, new.client_id) then
      raise exception 'Détenteur ou associé d''un autre foyer.' using errcode = '23514';
    end if;
  end loop;

  -- Contexte : le dossier en cours du client (au plus un).
  select d.id into v_dossier from public.invest_dossiers d
  where d.client_id = new.client_id and d.statut in ('ouvert','actif','suspendu');
  if v_dossier is not null then new.dossier_id := v_dossier; end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.cree_par_id := a.auteur_utilisateur_id;
    new.cree_par_auth_id := case when a.auteur_type = 'collaborateur' then null else v_auth end;
    if new.verification_statut <> 'non_verifiee' then
      new.verifie_par_id := a.auteur_utilisateur_id; new.verifie_le := now();
    end if;
  else
    new.created_at := old.created_at; new.cree_par_id := old.cree_par_id;
    new.cree_par_auth_id := old.cree_par_auth_id; new.source := old.source;
    -- Donnée métier modifiée alors qu'elle était vérifiée : à revérifier.
    if old.verification_statut = 'verifiee' and new.verification_statut is not distinct from old.verification_statut
       and public.invest_collecte_metier(to_jsonb(new)) is distinct from public.invest_collecte_metier(to_jsonb(old)) then
      new.verification_statut := 'non_verifiee'; new.verifie_par_id := null; new.verifie_le := null;
    end if;
    if new.verification_statut is distinct from old.verification_statut then
      if new.verification_statut = 'non_verifiee' then
        new.verifie_par_id := null; new.verifie_le := null;
      else
        new.verifie_par_id := a.auteur_utilisateur_id; new.verifie_le := now();
      end if;
    end if;
  end if;
  new.modifie_par_id := a.auteur_utilisateur_id;
  new.modifie_par_auth_id := case when a.auteur_type = 'collaborateur' then null else v_auth end;
  new.updated_at := now();
  return new;
end;
$$;

-- ── Règles (droits de l'appelant ; la maintenance y échappe) ────────────────
-- INVARIANT (cf. Tranche 2a) : une fonction SECURITY DEFINER appartenant à
-- postgres qui écrirait dans ces tables contournerait ces règles.
create or replace function public.invest_collecte_regles()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;
  if not exists (select 1 from public.invest_dossiers d
                 where d.client_id = new.client_id and d.statut in ('ouvert','actif','suspendu')) then
    raise exception 'La situation patrimoniale se complète dans un Dossier Invest en cours : aucun dossier en cours pour ce client (un dossier clos reste lisible, pas modifiable).'
      using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' and new.verification_statut <> 'non_verifiee')
     or (tg_op = 'UPDATE' and new.verification_statut is distinct from old.verification_statut and new.verification_statut <> 'non_verifiee') then
    if new.verifie_par_id is null then
      raise exception 'Seul un collaborateur Profero peut vérifier une donnée.' using errcode = '42501';
    end if;
    if new.verification_statut = 'a_corriger' and btrim(coalesce(new.verification_commentaire, '')) = '' then
      raise exception 'Indiquez ce qui est à corriger (commentaire de vérification).' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.archive_le is not null and new.archive_le is not null
     and public.invest_collecte_metier(to_jsonb(new)) is distinct from public.invest_collecte_metier(to_jsonb(old)) then
    raise exception 'Une donnée archivée ne se modifie plus.' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ── Journal (dans le dossier en cours) ──────────────────────────────────────
create or replace function public.invest_collecte_journal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb;
  objet text := public.invest_collecte_objet(tg_table_name, n);
  cles text[];
begin
  if new.dossier_id is null then return null; end if;
  if tg_op = 'INSERT' then
    perform public.invest_journaliser(new.dossier_id, new.client_id, 'collecte_ajout',
      format('Situation patrimoniale — ajout : %s.', objet), null,
      jsonb_build_object('table', tg_table_name, 'id', new.id, 'source', new.source));
    return null;
  end if;
  o := to_jsonb(old);
  select array_agg(k order by k) into cles
  from jsonb_object_keys(public.invest_collecte_metier(n)) k
  where (public.invest_collecte_metier(n) -> k) is distinct from (public.invest_collecte_metier(o) -> k);
  if cles is not null then
    perform public.invest_journaliser(new.dossier_id, new.client_id, 'collecte_modification',
      format('Situation patrimoniale — modification : %s (%s).', objet, array_to_string(cles, ', ')),
      jsonb_build_object('table', tg_table_name, 'id', new.id) || public.invest_diff(public.invest_collecte_metier(o), public.invest_collecte_metier(n), cles, 'avant'),
      jsonb_build_object('table', tg_table_name, 'id', new.id) || public.invest_diff(public.invest_collecte_metier(o), public.invest_collecte_metier(n), cles, 'apres'));
  end if;
  if new.archive_le is distinct from old.archive_le then
    perform public.invest_journaliser(new.dossier_id, new.client_id, 'collecte_modification',
      format('Situation patrimoniale — %s : %s.', case when new.archive_le is null then 'désarchivage' else 'archivage' end, objet),
      jsonb_build_object('table', tg_table_name, 'id', new.id, 'archive_le', old.archive_le),
      jsonb_build_object('table', tg_table_name, 'id', new.id, 'archive_le', new.archive_le));
  end if;
  if new.verification_statut is distinct from old.verification_statut
     and not (new.verification_statut = 'non_verifiee' and cles is not null) then
    perform public.invest_journaliser(new.dossier_id, new.client_id, 'collecte_verification',
      format('Situation patrimoniale — vérification : %s → %s%s.', objet,
        case new.verification_statut when 'verifiee' then 'vérifiée' when 'a_corriger' then 'à corriger' else 'non vérifiée' end,
        coalesce(' (' || nullif(btrim(new.verification_commentaire), '') || ')', '')),
      jsonb_build_object('table', tg_table_name, 'id', new.id, 'verification_statut', old.verification_statut),
      jsonb_build_object('table', tg_table_name, 'id', new.id, 'verification_statut', new.verification_statut));
  end if;
  return null;
end;
$$;

-- ── Déclencheurs, accès ─────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['invest_personnes','invest_structures','invest_actifs_patrimoniaux',
                           'invest_postes_financiers','invest_engagements'] loop
    execute format('create or replace trigger invest_collecte_avant_ecriture before insert or update on public.%I
      for each row execute function public.invest_collecte_avant_ecriture()', t);
    execute format('create or replace trigger invest_collecte_regles before insert or update on public.%I
      for each row execute function public.invest_collecte_regles()', t);
    execute format('create or replace trigger invest_collecte_journal after insert or update on public.%I
      for each row execute function public.invest_collecte_journal()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_lecture on public.%1$I', t);
    execute format($p$create policy %1$s_lecture on public.%1$I for select to authenticated using (
      (select public.invest_peut_voir('crm')) or (select public.invest_peut_voir('structuration'))
      or (select public.invest_peut_voir('dashboard')))$p$, t);
    execute format('drop policy if exists %1$s_creation on public.%1$I', t);
    execute format($p$create policy %1$s_creation on public.%1$I for insert to authenticated with check (
      (select public.invest_peut_voir('crm')) or (select public.invest_peut_voir('structuration')))$p$, t);
    execute format('drop policy if exists %1$s_modification on public.%1$I', t);
    execute format($p$create policy %1$s_modification on public.%1$I for update to authenticated
      using ((select public.invest_peut_voir('crm')) or (select public.invest_peut_voir('structuration')))
      with check ((select public.invest_peut_voir('crm')) or (select public.invest_peut_voir('structuration')))$p$, t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke delete, truncate, references, trigger on table public.%I from authenticated', t);
  end loop;
end $$;

revoke all on function public.invest_collecte_avant_ecriture() from public, anon, authenticated;
revoke all on function public.invest_collecte_journal() from public, anon, authenticated;
revoke all on function public.invest_collecte_meme_client(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.invest_collecte_regles() from public, anon;
revoke execute on function public.invest_collecte_objet(text, jsonb) from public, anon;
revoke execute on function public.invest_collecte_metier(jsonb) from public, anon;
