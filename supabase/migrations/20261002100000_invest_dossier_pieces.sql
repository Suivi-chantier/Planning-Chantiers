-- ============================================================================
-- Fiche Mission Invest — onglet Documents : pièces du client et documents Profero.
-- Périmètre : Profero Invest. Décisions de Matthieu (02/10/2026) : liste préremplie à
-- l'ouverture d'une mission ; deux parties (pièces à fournir par le client / documents
-- produits par Profero, dont le rapport de restitution) ; client en lecture seule d'abord.
--
-- 1. public.invest_dossier_pieces : une ligne = une pièce attendue du client OU un document
--    Profero, rattachée à UNE mission. Le fichier (optionnel) est dans le bucket invest-documents,
--    sous clients/<client>/mission/<dossier>/ : impossible de rattacher le fichier d'une autre mission.
--    client_id est toujours déduit de la mission (jamais saisi).
-- 2. Liste standard (SQL = source unique) : socle pour toutes les missions ; liste étendue et
--    documents de restitution pour l'Offre 3 (audit patrimonial).
-- 3. public.invest_dossier_pieces_preparer(dossier) : prépare la liste d'une mission existante
--    (bouton du CRM). Un déclencheur la prépare aussi à la création de toute nouvelle mission.
--    Rien n'est jamais écrasé : on ajoute seulement ce qui manque.
--
-- Accès : CRM (invest_peut_voir('crm')) + restrictive « collaborateurs seulement ». Aucun accès
-- client ni anonyme. Les missions existantes ne sont PAS modifiées tant qu'on ne prépare pas leur liste.
--
-- RETOUR ARRIÈRE : sql/202610_invest_dossier_pieces_rollback.sql
-- VÉRIFICATION  : node scripts/verif-invest-documents-mission.mjs
-- ============================================================================

create table public.invest_dossier_pieces (
  id          uuid primary key default gen_random_uuid(),
  dossier_id  uuid not null references public.invest_dossiers(id) on delete cascade,
  client_id   uuid not null references public.invest_clients(id) on delete cascade,
  genre       text not null check (genre in ('piece_client', 'document_profero')),
  categorie   text not null check (length(btrim(categorie)) > 0),
  libelle     text not null check (length(btrim(libelle)) > 0),
  obligatoire boolean not null default false,
  statut      text not null,
  chemin      text,
  nom_fichier text,
  demande_le  date,
  recu_le     date,
  valide_le   date,
  valide_par  text,
  commentaire text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint invest_dossier_pieces_statut_par_genre check (
    (genre = 'piece_client' and statut in ('a_demander', 'demandee', 'recue', 'validee', 'sans_objet'))
    or (genre = 'document_profero' and statut in ('a_produire', 'depose', 'remis_client'))),
  constraint invest_dossier_pieces_chemin_dans_mission check (
    chemin is null or (chemin like 'clients/' || client_id::text || '/mission/' || dossier_id::text || '/%' and chemin not like '%..%')),
  constraint invest_dossier_pieces_unique unique (dossier_id, genre, libelle)
);
create index invest_dossier_pieces_dossier_idx on public.invest_dossier_pieces (dossier_id);
create index invest_dossier_pieces_client_idx on public.invest_dossier_pieces (client_id);

-- client_id toujours celui de la mission.
create or replace function public.invest_dossier_pieces_client()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select d.client_id into new.client_id from public.invest_dossiers d where d.id = new.dossier_id;
  if new.client_id is null then raise exception 'Mission introuvable'; end if;
  return new;
end;
$$;
revoke all on function public.invest_dossier_pieces_client() from public, anon, authenticated;
create trigger invest_dossier_pieces_client
  before insert or update of dossier_id, client_id on public.invest_dossier_pieces
  for each row execute function public.invest_dossier_pieces_client();

alter table public.invest_dossier_pieces enable row level security;
revoke all on public.invest_dossier_pieces from public, anon, authenticated;
grant select, insert, update, delete on public.invest_dossier_pieces to authenticated;

create policy invest_dossier_pieces_crm on public.invest_dossier_pieces
  for all to authenticated
  using ((select public.invest_peut_voir('crm')))
  with check ((select public.invest_peut_voir('crm')));
-- Règle du dépôt : toute nouvelle table reçoit la restrictive 3a.
create policy profero_collaborateurs_seulement on public.invest_dossier_pieces
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif()))
  with check ((select public.est_collaborateur_actif()));

-- ── Liste standard ──────────────────────────────────────────────────────────
-- Interne : sans contrôle de droit (appelée par le déclencheur et par la fonction publique).
create or replace function public.invest_dossier_pieces_semer(p_dossier_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_client uuid; v_type text; n integer := 0; m integer;
begin
  select client_id, type_mission into v_client, v_type from public.invest_dossiers where id = p_dossier_id;
  if v_client is null then return 0; end if;

  -- Pièces du client : socle (toutes les missions)
  insert into public.invest_dossier_pieces (dossier_id, client_id, genre, categorie, libelle, obligatoire, statut)
  select p_dossier_id, v_client, 'piece_client', c, l, o, 'a_demander' from (values
    ('identite',    'Pièce d''identité valide', true),
    ('identite',    'Justificatif de domicile de moins de 3 mois', true),
    ('identite',    'Livret de famille / justificatif de situation familiale', false),
    ('revenus',     '2 derniers avis d''imposition', true),
    ('revenus',     '3 derniers bulletins de salaire', false),
    ('revenus',     'Contrat de travail / attestation employeur', false),
    ('engagements', 'Liste des crédits en cours', true),
    ('engagements', 'Échéanciers / tableaux d''amortissement des prêts', true),
    ('bancaire',    'Relevés bancaires des 3 derniers mois', true),
    ('bancaire',    'Justificatif d''épargne disponible / apport', true),
    ('bancaire',    'RIB', false)
  ) as t(c, l, o)
  on conflict (dossier_id, genre, libelle) do nothing;
  get diagnostics m = row_count; n := n + m;

  -- Pièces du client : audit patrimonial (Offre 3) en plus
  if v_type = 'audit_patrimonial' then
    insert into public.invest_dossier_pieces (dossier_id, client_id, genre, categorie, libelle, obligatoire, statut)
    select p_dossier_id, v_client, 'piece_client', c, l, o, 'a_demander' from (values
      ('identite',    'Contrat de mariage / PACS / jugement de divorce', false),
      ('revenus',     '2 ou 3 derniers bilans comptables', false),
      ('revenus',     'Dernière liasse fiscale', false),
      ('revenus',     'Attestation de rémunération et dividendes', false),
      ('revenus',     'Attestation URSSAF', false),
      ('revenus',     'Extrait Kbis / statuts de société professionnelle', false),
      ('engagements', 'Baux et quittances de résidence principale', false),
      ('engagements', 'Justificatifs de pensions versées ou reçues', false),
      ('engagements', 'Charges fixes mensuelles principales', false),
      ('engagements', 'Cautions bancaires / garanties / avals', false),
      ('immobilier',  'Actes de propriété de tous les biens', true),
      ('immobilier',  'Tableaux d''amortissement des crédits immobiliers', true),
      ('immobilier',  'Baux locatifs et justificatifs de loyers', true),
      ('immobilier',  'Taxes foncières des biens détenus', true),
      ('immobilier',  'Charges de copropriété et derniers PV d''AG', false),
      ('immobilier',  'Diagnostics, DPE et DDT', false),
      ('immobilier',  'Assurances PNO / GLI', false),
      ('immobilier',  'Déclarations ou résultats locatifs / LMNP / foncier', false),
      ('financier',   'Relevés livrets et épargne', true),
      ('financier',   'Relevés assurance-vie', false),
      ('financier',   'Comptes-titres / PEA', false),
      ('financier',   'SCPI / OPCI / actifs immobiliers papier', false),
      ('financier',   'PER / épargne retraite / épargne salariale', false),
      ('financier',   'Produits défiscalisants en cours', false),
      ('bancaire',    'Justificatifs d''épargne programmée', false),
      ('bancaire',    'Bonus / primes / revenus exceptionnels', false),
      ('bancaire',    'Trésorerie de société mobilisable', false),
      ('bancaire',    'Relevé de situation bancaire / simulation existante', false),
      ('bancaire',    'Assurance habitation résidence principale', false),
      ('structures',  'Statuts SCI / sociétés de détention', false),
      ('structures',  'Kbis / RIB / PV d''AG des SCI', false),
      ('structures',  'Bilans et liasses fiscales des SCI / holdings', false),
      ('structures',  'Organigramme de détention actuel', false),
      ('structures',  'Déclaration IFI / éléments d''assiette', false),
      ('structures',  'Déficits fonciers / amortissements reportables', false),
      ('mission',     'Consentement RGPD / certification des informations', true)
    ) as t(c, l, o)
    on conflict (dossier_id, genre, libelle) do nothing;
    get diagnostics m = row_count; n := n + m;
  end if;

  -- Documents Profero : la lettre de mission toujours ; la restitution en Offre 3
  insert into public.invest_dossier_pieces (dossier_id, client_id, genre, categorie, libelle, obligatoire, statut)
  select p_dossier_id, v_client, 'document_profero', c, l, o, 'a_produire' from (values
    ('lettre_mission', 'Lettre de mission signée', true)
  ) as t(c, l, o)
  on conflict (dossier_id, genre, libelle) do nothing;
  get diagnostics m = row_count; n := n + m;
  if v_type = 'audit_patrimonial' then
    insert into public.invest_dossier_pieces (dossier_id, client_id, genre, categorie, libelle, obligatoire, statut)
    select p_dossier_id, v_client, 'document_profero', c, l, o, 'a_produire' from (values
      ('rapport_restitution', 'Rapport de restitution', true),
      ('compte_rendu',        'Compte rendu de la réunion de restitution', false)
    ) as t(c, l, o)
    on conflict (dossier_id, genre, libelle) do nothing;
    get diagnostics m = row_count; n := n + m;
  end if;
  return n;
end;
$$;
revoke all on function public.invest_dossier_pieces_semer(uuid) from public, anon, authenticated;

-- Publique : même contrôle que l'écriture dans la table.
create or replace function public.invest_dossier_pieces_preparer(p_dossier_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  -- Mêmes deux conditions que l'écriture dans la table : droit CRM ET jeton de collaborateur (3a).
  if not (coalesce(public.invest_peut_voir('crm'), false) and coalesce(public.est_collaborateur_actif(), false)) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return public.invest_dossier_pieces_semer(p_dossier_id);
end;
$$;
revoke all on function public.invest_dossier_pieces_preparer(uuid) from public, anon;
grant execute on function public.invest_dossier_pieces_preparer(uuid) to authenticated;

-- Toute NOUVELLE mission reçoit sa liste. Un incident ici ne doit jamais empêcher d'ouvrir une mission.
create or replace function public.invest_dossiers_semer_pieces()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform public.invest_dossier_pieces_semer(new.id);
  exception when others then
    raise warning 'invest_dossiers_semer_pieces : liste de pièces non préparée (%)', sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.invest_dossiers_semer_pieces() from public, anon, authenticated;
create trigger invest_dossiers_semer_pieces
  after insert on public.invest_dossiers
  for each row execute function public.invest_dossiers_semer_pieces();
