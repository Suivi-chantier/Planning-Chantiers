-- ============================================================================
-- CHANTIER 1.1 — TRANCHE 1 : Dossier Invest, parcours en 11 étapes, journal,
-- rattachement des tâches de mission.
--
-- CLASSEMENT : INVEST.
-- ADDITIVE : 3 tables nouvelles, 6 colonnes ajoutées à invest_mission_actions
-- (facultatives ou avec valeur par défaut), fonctions et vue nouvelles.
-- Aucune donnée existante lue, modifiée ou supprimée par la migration
-- elle-même ; la reprise est un script séparé
-- (scripts/reprise-invest-dossiers-t1.mjs).
--
-- DÉCISIONS APPLIQUÉES (A1–A14, D1–D5, 30/09/2026)
--   - un client = N dossiers, au plus UN non clos (ouvert/actif/suspendu) ;
--   - 11 étapes par dossier ; 8 à 11 au niveau dossier à titre transitoire
--     (operation_id toujours vide en Tranche 1) ;
--   - statut d'étape piloté par Profero : aucun déclencheur ne le déduit ;
--   - « balle » obligatoire dès qu'une étape est active (A14) ;
--   - journal écrit côté serveur, jamais modifiable depuis le navigateur ;
--   - un client possédant un dossier ne peut plus être supprimé (D3) ;
--   - création client + dossier + 11 étapes atomique (invest_convertir_prospect,
--     invest_ouvrir_dossier) ; les anciens écrans non atomiques sont suivis par
--     la vue invest_controle_dossiers.
--
-- Catalogue de référence : src/Invest/dossiers/parcours.mjs (mêmes clés).
-- RETOUR ARRIÈRE : sql/202609_invest_dossiers_tranche1_rollback.sql
-- VÉRIFICATION  : node scripts/verif-invest-dossiers-t1.mjs
-- ============================================================================

-- ── Libellés (résumés du journal) — identiques au catalogue .mjs ────────────
create or replace function public.invest_libelle_etape(p text)
returns text language sql immutable set search_path = '' as $$
  select case p
    when 'signature' then 'Signature' when 'collecte' then 'Collecte'
    when 'documents' then 'Documents' when 'analyse' then 'Analyse'
    when 'strategie' then 'Stratégie' when 'recherche' then 'Recherche'
    when 'opportunites' then 'Opportunités' when 'financement' then 'Financement'
    when 'structuration' then 'Structuration' when 'acquisition' then 'Acquisition'
    when 'suivi' then 'Suivi' else coalesce(p, '—') end;
$$;

create or replace function public.invest_libelle_statut_etape(p text)
returns text language sql immutable set search_path = '' as $$
  select case p
    when 'a_venir' then 'À venir' when 'en_cours' then 'En cours'
    when 'en_attente' then 'En attente' when 'bloquee' then 'Bloquée'
    when 'terminee' then 'Terminée' when 'non_applicable' then 'Non applicable'
    else coalesce(p, '—') end;
$$;

create or replace function public.invest_libelle_balle(p text)
returns text language sql immutable set search_path = '' as $$
  select case p
    when 'client' then 'Client' when 'profero' then 'Profero' when 'banque' then 'Banque'
    when 'notaire' then 'Notaire' when 'tiers' then 'Tiers' else coalesce(p, '—') end;
$$;

create or replace function public.invest_libelle_statut_dossier(p text)
returns text language sql immutable set search_path = '' as $$
  select case p
    when 'ouvert' then 'Ouvert' when 'actif' then 'Actif' when 'suspendu' then 'Suspendu'
    when 'clos' then 'Clos' when 'abandonne' then 'Abandonné' else coalesce(p, '—') end;
$$;

-- Ancienne step_key → étape canonique. NULL = « à classer » (urbanisme, clés
-- inconnues) : A4, aucune correspondance devinée.
create or replace function public.invest_etape_depuis_step_key(p text)
returns text language sql immutable set search_path = '' as $$
  select case btrim(coalesce(p, ''))
    when 'signature' then 'signature' when 'lancement' then 'collecte'
    when 'recherche' then 'recherche' when 'presentation_bien' then 'opportunites'
    when 'financement' then 'financement' when 'acquisition' then 'acquisition'
    when 'signature_definitive' then 'acquisition' when 'enedis' then 'suivi'
    when 'travaux' then 'suivi' when 'apres_travaux' then 'suivi'
    else null end;
$$;

-- Clés modifiées entre deux états (journal : seulement ce qui change).
create or replace function public.invest_diff(p_de jsonb, p_vers jsonb, p_cles text[], p_cote text)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, case when p_cote = 'avant' then p_de -> k else p_vers -> k end), '{}'::jsonb)
  from unnest(p_cles) k where (p_de -> k) is distinct from (p_vers -> k);
$$;

-- ── Qui agit ? (collaborateur reconnu par sa session, sinon système) ────────
create or replace function public.invest_auteur_courant(
  out auteur_type text, out auteur_utilisateur_id uuid, out auteur_libelle text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(auth.email(), '')));
begin
  if v_email <> '' then
    select 'collaborateur', u.id, coalesce(nullif(btrim(u.nom), ''), u.email)
      into auteur_type, auteur_utilisateur_id, auteur_libelle
    from public.utilisateurs u
    where lower(btrim(u.email)) = v_email and u.actif is true
    order by u.id limit 1;
    if found then return; end if;
  end if;
  auteur_type := 'systeme';
  auteur_utilisateur_id := null;
  auteur_libelle := coalesce(nullif(current_setting('invest.auteur_libelle', true), ''), 'Système');
end;
$$;

-- ── Tables ──────────────────────────────────────────────────────────────────
create sequence if not exists public.invest_dossier_reference_seq;

create table if not exists public.invest_dossiers (
  id                        uuid primary key default gen_random_uuid(),
  client_id                 uuid not null references public.invest_clients(id) on delete restrict,
  reference                 text not null unique,
  libelle                   text not null check (btrim(libelle) <> ''),
  type_mission              text not null default 'accompagnement_acquisition'
                            check (type_mission in ('accompagnement_acquisition','audit_patrimonial','conseil','autre')),
  statut                    text not null default 'ouvert'
                            check (statut in ('ouvert','actif','suspendu','clos','abandonne')),
  motif_cloture             text,
  conseiller_id             uuid references public.utilisateurs(id) on delete set null,
  lettre_mission_statut     text not null default 'a_emettre'
                            check (lettre_mission_statut in ('a_emettre','envoyee','signee','non_applicable','inconnu')),
  lettre_mission_signee_le  date,
  honoraires_prevus_ht      numeric(12,2) check (honoraires_prevus_ht is null or honoraires_prevus_ht >= 0),
  date_ouverture            date,
  date_cloture              date,
  origine                   text not null
                            check (origine in ('creation_crm','conversion_prospect','reprise_existant')),
  prospect_id               uuid references public.invest_prospects(id) on delete set null,
  portail_visible           boolean not null default false,
  reprise                   jsonb,
  cree_par_id               uuid references public.utilisateurs(id) on delete set null,
  modifie_par_id            uuid references public.utilisateurs(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- Seule la reprise peut ignorer la date d'ouverture (inconnue : jamais inventée).
  constraint invest_dossiers_date_ouverture check (date_ouverture is not null or origine = 'reprise_existant'),
  constraint invest_dossiers_motif_cloture check (
    statut not in ('clos','abandonne') or btrim(coalesce(motif_cloture, '')) <> ''),
  constraint invest_dossiers_dates check (
    date_cloture is null or date_ouverture is null or date_cloture >= date_ouverture),
  constraint invest_dossiers_lettre_date check (
    lettre_mission_signee_le is null or lettre_mission_statut = 'signee')
);

-- D2 : au plus un dossier non clos par client ; plusieurs dossiers clos permis.
create unique index if not exists invest_dossiers_un_non_clos_par_client
  on public.invest_dossiers (client_id) where statut in ('ouvert','actif','suspendu');
create index if not exists invest_dossiers_client_idx on public.invest_dossiers (client_id);

create table if not exists public.invest_dossier_etapes (
  id                    uuid primary key default gen_random_uuid(),
  dossier_id            uuid not null references public.invest_dossiers(id) on delete cascade,
  -- Tranche 5 : clé étrangère vers invest_operations. Toujours vide ici (D1).
  operation_id          uuid,
  etape                 text not null check (etape in ('signature','collecte','documents','analyse','strategie',
                          'recherche','opportunites','financement','structuration','acquisition','suivi')),
  statut                text not null default 'a_venir'
                        check (statut in ('a_venir','en_cours','en_attente','bloquee','terminee','non_applicable')),
  balle                 text check (balle in ('client','profero','banque','notaire','tiers')),
  balle_utilisateur_id  uuid references public.utilisateurs(id) on delete set null,
  balle_tiers_libelle   text,
  prochaine_action      text,
  prochaine_action_id   uuid references public.invest_mission_actions(id) on delete set null,
  echeance              date,
  date_debut            date,
  date_fin              date,
  blocage_motif         text,
  bloquee_depuis        date,
  commentaire           text,
  reprise_a_confirmer   boolean not null default false,
  modifie_par_id        uuid references public.utilisateurs(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint invest_etapes_operation_t1 check (operation_id is null),
  -- A14 : quelqu'un doit agir ⇔ l'étape est active.
  constraint invest_etapes_balle check ((statut in ('en_cours','en_attente','bloquee')) = (balle is not null)),
  constraint invest_etapes_balle_utilisateur check (balle_utilisateur_id is null or balle = 'profero'),
  constraint invest_etapes_balle_tiers check (balle_tiers_libelle is null or balle in ('banque','notaire','tiers')),
  constraint invest_etapes_blocage check ((statut = 'bloquee') = (btrim(coalesce(blocage_motif, '')) <> '')),
  constraint invest_etapes_bloquee_depuis check (statut <> 'bloquee' or bloquee_depuis is not null),
  constraint invest_etapes_dates check (date_fin is null or date_debut is null or date_fin >= date_debut)
);

create unique index if not exists invest_etapes_une_par_dossier
  on public.invest_dossier_etapes (dossier_id, etape) where operation_id is null;

create table if not exists public.invest_dossier_evenements (
  id                     uuid primary key default gen_random_uuid(),
  dossier_id             uuid not null references public.invest_dossiers(id) on delete cascade,
  client_id              uuid not null references public.invest_clients(id) on delete restrict,
  operation_id           uuid,
  etape_id               uuid references public.invest_dossier_etapes(id) on delete set null,
  mission_action_id      uuid references public.invest_mission_actions(id) on delete set null,
  objet_type             text,
  objet_id               uuid,
  type                   text not null check (type in ('dossier_cree','dossier_statut_change','dossier_modifie',
                           'lettre_mission_change','conseiller_change','etape_statut_change','etape_balle_change',
                           'etape_echeance_change','etape_prochaine_action_change','etape_bloquee','etape_debloquee',
                           'reprise_importee')),
  avant                  jsonb,
  apres                  jsonb,
  resume                 text not null check (btrim(resume) <> ''),
  auteur_type            text not null check (auteur_type in ('collaborateur','client','systeme')),
  auteur_utilisateur_id  uuid references public.utilisateurs(id) on delete set null,
  auteur_auth_user_id    uuid,
  auteur_libelle         text not null,
  visible_client         boolean not null default false,
  survenu_le             timestamptz not null default now()
);
create index if not exists invest_evenements_dossier_idx on public.invest_dossier_evenements (dossier_id, survenu_le desc);

-- ── invest_mission_actions : ajouts uniquement ──────────────────────────────
alter table public.invest_mission_actions
  add column if not exists dossier_id     uuid references public.invest_dossiers(id) on delete restrict,
  add column if not exists operation_id   uuid,
  add column if not exists etape          text check (etape in ('signature','collecte','documents','analyse','strategie',
                                            'recherche','opportunites','financement','structuration','acquisition','suivi')),
  add column if not exists nature         text not null default 'tache'
                                          check (nature in ('tache','echeance','condition_suspensive')),
  add column if not exists acteur_type    text not null default 'profero'
                                          check (acteur_type in ('client','profero','banque','notaire','tiers')),
  add column if not exists responsable_id uuid references public.utilisateurs(id) on delete set null;
create index if not exists idx_invest_mission_actions_dossier on public.invest_mission_actions (dossier_id, etape);

-- ── Journal : écriture serveur uniquement ───────────────────────────────────
create or replace function public.invest_journaliser(
  p_dossier_id uuid, p_client_id uuid, p_type text, p_resume text,
  p_avant jsonb default null, p_apres jsonb default null,
  p_etape_id uuid default null, p_mission_action_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from public.invest_auteur_courant();
  insert into public.invest_dossier_evenements
    (dossier_id, client_id, etape_id, mission_action_id, type, avant, apres, resume,
     auteur_type, auteur_utilisateur_id, auteur_libelle)
  values (p_dossier_id, p_client_id, p_etape_id, p_mission_action_id, p_type,
          nullif(p_avant, '{}'::jsonb), nullif(p_apres, '{}'::jsonb), p_resume,
          a.auteur_type, a.auteur_utilisateur_id, a.auteur_libelle);
end;
$$;

-- Le journal ne se modifie ni ne se supprime (sauf maintenance postgres).
create or replace function public.invest_evenements_immuables()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'Le journal du dossier ne se modifie pas et ne se supprime pas.' using errcode = '42501';
end;
$$;
create or replace trigger invest_evenements_immuables
  before update or delete on public.invest_dossier_evenements
  for each row execute function public.invest_evenements_immuables();

-- ── invest_dossiers : avant écriture (référence, horodatage, auteur) ────────
create or replace function public.invest_dossiers_avant_ecriture()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from public.invest_auteur_courant();
  if tg_op = 'INSERT' then
    if new.reference is null or btrim(new.reference) = '' then
      new.reference := 'INV-' || to_char(coalesce(new.date_ouverture, current_date), 'YYYY') || '-'
        || lpad(nextval('public.invest_dossier_reference_seq')::text, 4, '0');
    end if;
    new.cree_par_id := coalesce(new.cree_par_id, a.auteur_utilisateur_id);
  else
    new.created_at := old.created_at;
    if new.statut in ('clos','abandonne') and old.statut not in ('clos','abandonne') and new.date_cloture is null then
      new.date_cloture := current_date;
    elsif new.statut not in ('clos','abandonne') and old.statut in ('clos','abandonne') then
      new.date_cloture := null;
    end if;
  end if;
  new.modifie_par_id := a.auteur_utilisateur_id;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger invest_dossiers_avant_ecriture
  before insert or update on public.invest_dossiers
  for each row execute function public.invest_dossiers_avant_ecriture();

create or replace function public.invest_dossiers_journal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  o jsonb; n jsonb;
  v_de text; v_vers text;
  cles_modif constant text[] := array['libelle','type_mission','honoraires_prevus_ht','date_ouverture',
                                      'date_cloture','portail_visible','motif_cloture'];
begin
  if tg_op = 'INSERT' then
    perform public.invest_journaliser(new.id, new.client_id, 'dossier_cree',
      format('Dossier %s ouvert — %s.', new.reference, new.libelle), null,
      jsonb_build_object('statut', new.statut, 'origine', new.origine, 'conseiller_id', new.conseiller_id));
    return null;
  end if;
  o := to_jsonb(old); n := to_jsonb(new);
  if new.statut is distinct from old.statut then
    perform public.invest_journaliser(new.id, new.client_id, 'dossier_statut_change',
      format('Statut du dossier : %s → %s%s.', public.invest_libelle_statut_dossier(old.statut),
        public.invest_libelle_statut_dossier(new.statut),
        case when new.motif_cloture is not null and new.statut in ('clos','abandonne')
             then ' (' || new.motif_cloture || ')' else '' end),
      jsonb_build_object('statut', old.statut), jsonb_build_object('statut', new.statut, 'motif_cloture', new.motif_cloture));
  end if;
  if new.lettre_mission_statut is distinct from old.lettre_mission_statut
     or new.lettre_mission_signee_le is distinct from old.lettre_mission_signee_le then
    perform public.invest_journaliser(new.id, new.client_id, 'lettre_mission_change',
      format('Lettre de mission : %s → %s%s.', old.lettre_mission_statut, new.lettre_mission_statut,
        case when new.lettre_mission_signee_le is not null then ' (signée le ' || to_char(new.lettre_mission_signee_le, 'DD/MM/YYYY') || ')' else '' end),
      public.invest_diff(o, n, array['lettre_mission_statut','lettre_mission_signee_le'], 'avant'),
      public.invest_diff(o, n, array['lettre_mission_statut','lettre_mission_signee_le'], 'apres'));
  end if;
  if new.conseiller_id is distinct from old.conseiller_id then
    select nom into v_de from public.utilisateurs where id = old.conseiller_id;
    select nom into v_vers from public.utilisateurs where id = new.conseiller_id;
    perform public.invest_journaliser(new.id, new.client_id, 'conseiller_change',
      format('Conseiller : %s → %s.', coalesce(v_de, 'aucun'), coalesce(v_vers, 'aucun')),
      jsonb_build_object('conseiller_id', old.conseiller_id), jsonb_build_object('conseiller_id', new.conseiller_id));
  end if;
  if public.invest_diff(o, n, cles_modif, 'apres') <> '{}'::jsonb
     and not (new.statut is distinct from old.statut
              and public.invest_diff(o, n, cles_modif, 'apres') - 'date_cloture' - 'motif_cloture' = '{}'::jsonb) then
    perform public.invest_journaliser(new.id, new.client_id, 'dossier_modifie',
      'Dossier modifié : ' || (select string_agg(k, ', ' order by k)
        from jsonb_object_keys(public.invest_diff(o, n, cles_modif, 'apres')) k) || '.',
      public.invest_diff(o, n, cles_modif, 'avant'), public.invest_diff(o, n, cles_modif, 'apres'));
  end if;
  return null;
end;
$$;
create or replace trigger invest_dossiers_journal
  after insert or update on public.invest_dossiers
  for each row execute function public.invest_dossiers_journal();

-- ── invest_dossier_etapes : avant écriture (dates, blocage, balle) ──────────
create or replace function public.invest_etapes_avant_ecriture()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  a record;
  v_dossier_action uuid;
begin
  select * into a from public.invest_auteur_courant();
  if new.prochaine_action_id is not null then
    select dossier_id into v_dossier_action from public.invest_mission_actions where id = new.prochaine_action_id;
    if v_dossier_action is distinct from new.dossier_id then
      raise exception 'La prochaine action doit être une tâche de ce dossier.' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.dossier_id is distinct from old.dossier_id or new.etape is distinct from old.etape then
      raise exception 'Une étape ne change ni de dossier ni de nature.' using errcode = '23514';
    end if;
    new.created_at := old.created_at;
    if new.statut is distinct from old.statut then
      -- Dates : celles du geste réel, jamais une date devinée.
      if new.statut in ('en_cours','en_attente','bloquee') and new.date_debut is null then
        new.date_debut := current_date;
      end if;
      if new.statut = 'terminee' and new.date_fin is null then
        new.date_fin := current_date;
      elsif new.statut <> 'terminee' and old.statut = 'terminee' then
        new.date_fin := null;
      end if;
      if new.statut = 'bloquee' and new.bloquee_depuis is null then
        new.bloquee_depuis := current_date;
      end if;
      if old.statut = 'bloquee' and new.statut <> 'bloquee' then
        new.blocage_motif := null;
        new.bloquee_depuis := null;
      end if;
      -- Plus personne n'a la balle quand l'étape n'est plus active.
      if new.statut not in ('en_cours','en_attente','bloquee') then
        new.balle := null; new.balle_utilisateur_id := null; new.balle_tiers_libelle := null;
      end if;
    end if;
  end if;
  new.modifie_par_id := a.auteur_utilisateur_id;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger invest_etapes_avant_ecriture
  before insert or update on public.invest_dossier_etapes
  for each row execute function public.invest_etapes_avant_ecriture();

create or replace function public.invest_etapes_journal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid;
  o jsonb := to_jsonb(old); n jsonb := to_jsonb(new);
  lib text := public.invest_libelle_etape(new.etape);
  v_de text; v_vers text;
begin
  select client_id into v_client from public.invest_dossiers where id = new.dossier_id;
  if new.statut is distinct from old.statut then
    if new.statut = 'bloquee' then
      perform public.invest_journaliser(new.dossier_id, v_client, 'etape_bloquee',
        format('%s bloquée : %s.', lib, new.blocage_motif),
        jsonb_build_object('statut', old.statut), jsonb_build_object('statut', new.statut, 'blocage_motif', new.blocage_motif), new.id);
    elsif old.statut = 'bloquee' then
      perform public.invest_journaliser(new.dossier_id, v_client, 'etape_debloquee',
        format('%s débloquée (%s).', lib, public.invest_libelle_statut_etape(new.statut)),
        jsonb_build_object('statut', old.statut, 'blocage_motif', old.blocage_motif), jsonb_build_object('statut', new.statut), new.id);
    else
      perform public.invest_journaliser(new.dossier_id, v_client, 'etape_statut_change',
        format('%s : %s → %s.', lib, public.invest_libelle_statut_etape(old.statut), public.invest_libelle_statut_etape(new.statut)),
        public.invest_diff(o, n, array['statut','date_debut','date_fin'], 'avant'),
        public.invest_diff(o, n, array['statut','date_debut','date_fin'], 'apres'), new.id);
    end if;
  end if;
  if new.balle is not null and (new.balle is distinct from old.balle
      or new.balle_utilisateur_id is distinct from old.balle_utilisateur_id
      or new.balle_tiers_libelle is distinct from old.balle_tiers_libelle) then
    select nom into v_de from public.utilisateurs where id = old.balle_utilisateur_id;
    select nom into v_vers from public.utilisateurs where id = new.balle_utilisateur_id;
    perform public.invest_journaliser(new.dossier_id, v_client, 'etape_balle_change',
      format('%s : balle %s → %s.', lib,
        coalesce(public.invest_libelle_balle(old.balle) || coalesce(' (' || coalesce(v_de, old.balle_tiers_libelle) || ')', ''), 'personne'),
        public.invest_libelle_balle(new.balle) || coalesce(' (' || coalesce(v_vers, new.balle_tiers_libelle) || ')', '')),
      public.invest_diff(o, n, array['balle','balle_utilisateur_id','balle_tiers_libelle'], 'avant'),
      public.invest_diff(o, n, array['balle','balle_utilisateur_id','balle_tiers_libelle'], 'apres'), new.id);
  end if;
  if new.echeance is distinct from old.echeance then
    perform public.invest_journaliser(new.dossier_id, v_client, 'etape_echeance_change',
      format('%s : échéance %s → %s.', lib,
        coalesce(to_char(old.echeance, 'DD/MM/YYYY'), 'aucune'), coalesce(to_char(new.echeance, 'DD/MM/YYYY'), 'aucune')),
      jsonb_build_object('echeance', old.echeance), jsonb_build_object('echeance', new.echeance), new.id);
  end if;
  if new.prochaine_action is distinct from old.prochaine_action
     or new.prochaine_action_id is distinct from old.prochaine_action_id then
    perform public.invest_journaliser(new.dossier_id, v_client, 'etape_prochaine_action_change',
      format('%s : prochaine action « %s ».', lib, coalesce(new.prochaine_action, 'aucune')),
      public.invest_diff(o, n, array['prochaine_action','prochaine_action_id'], 'avant'),
      public.invest_diff(o, n, array['prochaine_action','prochaine_action_id'], 'apres'), new.id, new.prochaine_action_id);
  end if;
  return null;
end;
$$;
create or replace trigger invest_etapes_journal
  after update on public.invest_dossier_etapes
  for each row execute function public.invest_etapes_journal();

-- ── invest_mission_actions : rattachement automatique (compatibilité) ───────
-- Les anciens écrans n'envoient ni dossier ni étape : on complète ce qui est
-- CERTAIN, sans jamais bloquer l'enregistrement. Ce qui ne peut pas être
-- complété reste vide et apparaît dans invest_controle_dossiers.
create or replace function public.invest_mission_actions_rattacher()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid;
  v_nb int;
begin
  -- Cohérence : un dossier fourni doit être celui du client (erreur explicite).
  if new.dossier_id is not null then
    select client_id into v_client from public.invest_dossiers where id = new.dossier_id;
    if v_client is distinct from new.client_id then
      raise exception 'Cette tâche ne peut pas être rattachée au dossier d''un autre client.' using errcode = '23514';
    end if;
  end if;
  begin
    if new.dossier_id is null and new.client_id is not null then
      select d.id into new.dossier_id from public.invest_dossiers d
      where d.client_id = new.client_id and d.statut in ('ouvert','actif','suspendu');
    end if;
    if tg_op = 'INSERT' then
      if new.etape is null then new.etape := public.invest_etape_depuis_step_key(new.step_key); end if;
    elsif new.step_key is distinct from old.step_key and new.etape is not distinct from old.etape
          and (old.etape is null or old.etape = public.invest_etape_depuis_step_key(old.step_key)) then
      new.etape := public.invest_etape_depuis_step_key(new.step_key);
    end if;
    if new.responsable_id is null and btrim(coalesce(new.responsable_email, '')) <> ''
       and (tg_op = 'INSERT' or new.responsable_email is distinct from old.responsable_email) then
      select count(*) into v_nb from public.utilisateurs u
      where lower(btrim(u.email)) = lower(btrim(new.responsable_email)) and u.actif is true;
      if v_nb = 1 then
        select u.id into new.responsable_id from public.utilisateurs u
        where lower(btrim(u.email)) = lower(btrim(new.responsable_email)) and u.actif is true;
      end if;
    end if;
  exception when others then
    raise warning 'invest_mission_actions_rattacher : rattachement incomplet (%) — voir invest_controle_dossiers.', sqlerrm;
  end;
  return new;
end;
$$;
create or replace trigger invest_mission_actions_rattacher
  before insert or update of step_key, client_id, responsable_email, dossier_id on public.invest_mission_actions
  for each row execute function public.invest_mission_actions_rattacher();

-- ── Création atomique ───────────────────────────────────────────────────────
-- Ouvre un dossier et ses 11 étapes pour un client existant. Tout ou rien :
-- une erreur annule le dossier, les étapes, le journal et l'activation.
create or replace function public.invest_ouvrir_dossier(p_client_id uuid, p_options jsonb default '{}'::jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  o jsonb := coalesce(p_options, '{}'::jsonb);
  v_client record;
  v_existant text;
  v_dossier uuid;
  v_conseiller uuid := nullif(o ->> 'conseiller_id', '')::uuid;
  v_origine text := coalesce(nullif(o ->> 'origine', ''), 'creation_crm');
  v_nb int;
begin
  if v_origine not in ('creation_crm','conversion_prospect') then
    raise exception 'Origine « % » non autorisée ici (la reprise a son propre script).', v_origine using errcode = '22023';
  end if;
  select id, statut, nom, prenom into v_client from public.invest_clients where id = p_client_id for update;
  if not found then
    raise exception 'Client introuvable ou non accessible.' using errcode = 'P0002';
  end if;
  select reference into v_existant from public.invest_dossiers
  where client_id = p_client_id and statut in ('ouvert','actif','suspendu');
  if found then
    raise exception 'Ce client a déjà un dossier en cours (%). Clôturez-le avant d''en ouvrir un autre.', v_existant
      using errcode = '23505';
  end if;

  insert into public.invest_dossiers (client_id, libelle, type_mission, statut, conseiller_id,
    lettre_mission_statut, honoraires_prevus_ht, date_ouverture, origine, prospect_id)
  values (p_client_id,
    coalesce(nullif(btrim(o ->> 'libelle'), ''), 'Dossier Invest ' || to_char(current_date, 'YYYY')),
    coalesce(nullif(o ->> 'type_mission', ''), 'accompagnement_acquisition'),
    coalesce(nullif(o ->> 'statut', ''), 'ouvert'),
    v_conseiller,
    coalesce(nullif(o ->> 'lettre_mission_statut', ''), 'a_emettre'),
    nullif(o ->> 'honoraires_prevus_ht', '')::numeric,
    current_date, v_origine, nullif(o ->> 'prospect_id', '')::uuid)
  returning id into v_dossier;

  insert into public.invest_dossier_etapes (dossier_id, etape, statut, balle, balle_utilisateur_id, date_debut)
  select v_dossier, e.cle,
         case when e.cle = 'signature' then 'en_cours' else 'a_venir' end,
         case when e.cle = 'signature' then 'profero' end,
         case when e.cle = 'signature' then v_conseiller end,
         case when e.cle = 'signature' then current_date end
  from unnest(array['signature','collecte','documents','analyse','strategie','recherche',
                    'opportunites','financement','structuration','acquisition','suivi']) as e(cle);

  select count(*) into v_nb from public.invest_dossier_etapes where dossier_id = v_dossier and operation_id is null;
  if v_nb <> 11 then
    raise exception 'Parcours incomplet (% étapes sur 11) : dossier non créé.', v_nb;
  end if;

  if coalesce((o ->> 'activer_client')::boolean, true)
     and (v_client.statut is null or lower(v_client.statut) = 'prospect') then
    update public.invest_clients set statut = 'Actif', updated_at = now() where id = p_client_id;
  end if;
  if coalesce((o ->> 'rattacher_actions')::boolean, true) then
    update public.invest_mission_actions set dossier_id = v_dossier
    where client_id = p_client_id and dossier_id is null;
  end if;
  return v_dossier;
end;
$$;

-- Conversion d'un prospect : client + dossier + 11 étapes + marquage du
-- prospect, en UNE transaction. Pas de dossier = pas de conversion.
create or replace function public.invest_convertir_prospect(
  p_prospect_id uuid, p_client jsonb, p_options jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  c jsonb := coalesce(p_client, '{}'::jsonb);
  v_prospect record;
  v_client uuid;
  v_dossier uuid;
begin
  select id, converted_client_id into v_prospect from public.invest_prospects where id = p_prospect_id for update;
  if not found then
    raise exception 'Prospect introuvable ou non accessible.' using errcode = 'P0002';
  end if;
  if v_prospect.converted_client_id is not null
     and exists (select 1 from public.invest_clients where id = v_prospect.converted_client_id) then
    raise exception 'Ce prospect a déjà été converti.' using errcode = '23505';
  end if;
  if btrim(coalesce(c ->> 'nom', '')) = '' then
    raise exception 'Le nom du client est obligatoire.' using errcode = '23502';
  end if;

  insert into public.invest_clients (nom, prenom, email, telephone, conseiller, source, budget,
    notes_rapides, date_premier_contact, date_signature, statut, etape, strategie_data)
  values (btrim(c ->> 'nom'), nullif(btrim(c ->> 'prenom'), ''), nullif(btrim(c ->> 'email'), ''),
    nullif(btrim(c ->> 'telephone'), ''), nullif(btrim(c ->> 'conseiller'), ''), nullif(btrim(c ->> 'source'), ''),
    nullif(c ->> 'budget', '')::numeric, nullif(c ->> 'notes_rapides', ''),
    nullif(c ->> 'date_premier_contact', '')::date, nullif(c ->> 'date_signature', '')::date,
    'Actif', '1 Signature contrat',
    case when jsonb_typeof(c -> 'strategie_data') = 'object' then c -> 'strategie_data' else '{}'::jsonb end)
  returning id into v_client;

  v_dossier := public.invest_ouvrir_dossier(v_client,
    coalesce(p_options, '{}'::jsonb) || jsonb_build_object('origine', 'conversion_prospect', 'prospect_id', p_prospect_id));

  update public.invest_prospects
  set statut = 'converti', converted_client_id = v_client, converted_at = now(), updated_at = now()
  where id = p_prospect_id;

  return jsonb_build_object('client_id', v_client, 'dossier_id', v_dossier);
end;
$$;

-- Rattrapage explicite : rattache au dossier les tâches du client restées sans
-- dossier (créées par un ancien écran avant l'ouverture du dossier).
create or replace function public.invest_rattacher_actions_dossier(p_dossier_id uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_client uuid; v_nb int;
begin
  select client_id into v_client from public.invest_dossiers where id = p_dossier_id;
  if not found then raise exception 'Dossier introuvable ou non accessible.' using errcode = 'P0002'; end if;
  update public.invest_mission_actions set dossier_id = p_dossier_id
  where client_id = v_client and dossier_id is null;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

-- ── Contrôle de transition : ce que les anciens écrans n'ont pas pu faire ───
create or replace view public.invest_controle_dossiers with (security_invoker = true) as
  select 'client_actif_sans_dossier'::text as anomalie, c.id as client_id, null::uuid as dossier_id,
         null::uuid as mission_action_id, coalesce(c.prenom || ' ', '') || c.nom as detail
  from public.invest_clients c
  where lower(coalesce(c.statut, '')) = 'actif'
    and not exists (select 1 from public.invest_dossiers d where d.client_id = c.id and d.statut in ('ouvert','actif','suspendu'))
  union all
  select 'prospect_converti_sans_dossier', p.converted_client_id, null, null, coalesce(p.prenom || ' ', '') || p.nom
  from public.invest_prospects p
  where p.converted_client_id is not null
    and exists (select 1 from public.invest_clients c where c.id = p.converted_client_id)
    and not exists (select 1 from public.invest_dossiers d where d.client_id = p.converted_client_id)
  union all
  select 'action_sans_dossier', a.client_id, null, a.id, a.step_key || ' — ' || a.action_title
  from public.invest_mission_actions a where a.dossier_id is null
  union all
  select 'action_etape_a_classer', a.client_id, a.dossier_id, a.id, a.step_key || ' — ' || a.action_title
  from public.invest_mission_actions a where a.etape is null
  union all
  select 'dossier_parcours_incomplet', d.client_id, d.id, null,
         d.reference || ' : ' || (select count(*) from public.invest_dossier_etapes e
                                  where e.dossier_id = d.id and e.operation_id is null) || ' étape(s) sur 11'
  from public.invest_dossiers d
  where (select count(*) from public.invest_dossier_etapes e where e.dossier_id = d.id and e.operation_id is null) <> 11
  union all
  select 'dossier_sans_conseiller', d.client_id, d.id, null, d.reference
  from public.invest_dossiers d where d.statut in ('ouvert','actif') and d.conseiller_id is null
  union all
  select 'lettre_mission_' || case when d.lettre_mission_statut = 'inconnu' then 'statut_inconnu' else 'signee_sans_date' end,
         d.client_id, d.id, null, d.reference
  from public.invest_dossiers d
  where d.lettre_mission_statut = 'inconnu' or (d.lettre_mission_statut = 'signee' and d.lettre_mission_signee_le is null)
  union all
  select 'etapes_reprise_a_confirmer', d.client_id, d.id, null,
         d.reference || ' : ' || count(*) || ' étape(s) à confirmer'
  from public.invest_dossiers d join public.invest_dossier_etapes e on e.dossier_id = d.id
  where e.reprise_a_confirmer group by d.id, d.client_id, d.reference;

-- ── Accès : fermé par défaut ────────────────────────────────────────────────
alter table public.invest_dossiers enable row level security;
alter table public.invest_dossier_etapes enable row level security;
alter table public.invest_dossier_evenements enable row level security;

-- Lecture : mêmes pages que invest_clients. Écriture : crm, structuration,
-- prospection. Aucune suppression depuis le navigateur.
create policy invest_dossiers_lecture on public.invest_dossiers for select to authenticated using (
  (select public.invest_peut_voir('crm')) or (select public.invest_peut_voir('structuration'))
  or (select public.invest_peut_voir('prospection')) or (select public.invest_peut_voir('suivi_financier'))
  or (select public.invest_peut_voir('dashboard')));
create policy invest_dossiers_creation on public.invest_dossiers for insert to authenticated with check (
  (select public.invest_peut_voir('crm')) or (select public.invest_peut_voir('structuration'))
  or (select public.invest_peut_voir('prospection')));
create policy invest_dossiers_modification on public.invest_dossiers for update to authenticated
  using ((select public.invest_peut_voir('crm')) or (select public.invest_peut_voir('structuration'))
         or (select public.invest_peut_voir('prospection')))
  with check ((select public.invest_peut_voir('crm')) or (select public.invest_peut_voir('structuration'))
         or (select public.invest_peut_voir('prospection')));

create policy invest_etapes_lecture on public.invest_dossier_etapes for select to authenticated using (
  (select public.invest_peut_voir('crm')) or (select public.invest_peut_voir('structuration'))
  or (select public.invest_peut_voir('prospection')) or (select public.invest_peut_voir('suivi_financier'))
  or (select public.invest_peut_voir('dashboard')));
create policy invest_etapes_creation on public.invest_dossier_etapes for insert to authenticated with check (
  (select public.invest_peut_voir('crm')) or (select public.invest_peut_voir('structuration'))
  or (select public.invest_peut_voir('prospection')));
create policy invest_etapes_modification on public.invest_dossier_etapes for update to authenticated
  using ((select public.invest_peut_voir('crm')) or (select public.invest_peut_voir('structuration'))
         or (select public.invest_peut_voir('prospection')))
  with check ((select public.invest_peut_voir('crm')) or (select public.invest_peut_voir('structuration'))
         or (select public.invest_peut_voir('prospection')));

create policy invest_evenements_lecture on public.invest_dossier_evenements for select to authenticated using (
  (select public.invest_peut_voir('crm')) or (select public.invest_peut_voir('structuration'))
  or (select public.invest_peut_voir('prospection')) or (select public.invest_peut_voir('suivi_financier'))
  or (select public.invest_peut_voir('dashboard')));

revoke all on table public.invest_dossiers, public.invest_dossier_etapes, public.invest_dossier_evenements from anon;
revoke delete, truncate, references, trigger on table public.invest_dossiers, public.invest_dossier_etapes from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.invest_dossier_evenements from authenticated;
revoke all on table public.invest_controle_dossiers from anon;
grant select on table public.invest_controle_dossiers to authenticated;
revoke all on sequence public.invest_dossier_reference_seq from anon, authenticated;

-- Fonctions internes : personne ne les appelle directement.
revoke all on function public.invest_auteur_courant() from public, anon, authenticated;
revoke all on function public.invest_journaliser(uuid, uuid, text, text, jsonb, jsonb, uuid, uuid) from public, anon, authenticated;
revoke all on function public.invest_evenements_immuables() from public, anon, authenticated;
revoke all on function public.invest_dossiers_avant_ecriture() from public, anon, authenticated;
revoke all on function public.invest_dossiers_journal() from public, anon, authenticated;
revoke all on function public.invest_etapes_avant_ecriture() from public, anon, authenticated;
revoke all on function public.invest_etapes_journal() from public, anon, authenticated;
revoke all on function public.invest_mission_actions_rattacher() from public, anon, authenticated;
-- Fonctions métier : collaborateurs connectés, sous la RLS (security invoker).
revoke all on function public.invest_ouvrir_dossier(uuid, jsonb) from public, anon;
revoke all on function public.invest_convertir_prospect(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.invest_rattacher_actions_dossier(uuid) from public, anon;
grant execute on function public.invest_ouvrir_dossier(uuid, jsonb) to authenticated;
grant execute on function public.invest_convertir_prospect(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.invest_rattacher_actions_dossier(uuid) to authenticated;
