-- ═══════════════════════════════════════════════════════════════════════════
-- FACTURATION ProGBat — stockage des factures et des règlements importés.
--
-- Ce fichier NE crée pas la facturation client : il ÉTEND
-- public.chantier_factures_client (sql/202609_facturation_client.sql) pour y
-- accueillir les factures venues de ProGBat, et ajoute la table des règlements.
-- Aucune donnée existante n'est modifiée : les factures déjà saisies prennent
-- source = 'manuel' par le DEFAULT de la colonne, et rien d'autre ne bouge.
--
-- CE QUE LES DONNÉES RÉELLES ONT ÉTABLI (diagnostic progbat-test-connection)
-- ─────────────────────────────────────────────────────────────────────────
--   • validated = 0 → brouillon, à ignorer ; validated = 1 → facture émise ;
--   • une facture est identifiée par bill.id, JAMAIS par son numéro (code) :
--     deux sociétés, deux exercices ou une renumérotation peuvent répéter un
--     numéro, et ProGBat ne garantit rien là-dessus ;
--   • une facture peut porter un montant NÉGATIF en gardant type = "bill"
--     (avoir) : tous les montants sont stockés SIGNÉS, jamais en valeur
--     absolue ;
--   • status = 1 est corrélé au règlement, mais ce sont les TRANSACTIONS qui
--     font foi : progbat_status n'est jamais une preuve de paiement.
--
-- LES MONTANTS — POURQUOI HT ET TVA RESTENT VIDES CÔTÉ ProGBat
-- ────────────────────────────────────────────────────────────
-- Sur une facture de situation, `atiTotal` est CUMULATIF et `toBePaid` est
-- l'exigible réel après déduction des acomptes. Exemple relevé :
--     atiTotal = 1850,31   deductedAdvance = 925,16   toBePaid = 925,15
-- `netTotal` et `taxes` suivent atiTotal : ils ne décrivent donc PAS le HT et
-- la TVA réellement exigibles sur ce document. Conséquence, assumée :
--     montant_ttc  = toBePaid (signé)          ← le seul montant vrai
--     montant_ht   = null pour source='progbat'
--     montant_tva  = null pour source='progbat'
-- Aucune ventilation HT/TVA n'est reconstituée : une TVA calculée à rebours
-- serait une invention, et elle finirait recopiée dans un tableau comptable.
-- Les montants ProGBat exacts sont tous conservés à part (progbat_*), pour
-- afficher le détail sans jamais le confondre avec un HT facturé.
--
-- ⚠️ À SAVOIR POUR LE LOT SUIVANT : etatFacturation() (facturationClient.mjs)
-- raisonne en HT (montant_ht). Une facture ProGBat, dont le HT est null, y
-- compterait donc pour 0. Ce lot ne touche à rien de tout cela — aucune facture
-- ProGBat n'existe encore et aucun écran ne les lit — mais la synchronisation
-- devra trancher explicitement : soit l'écran ProGBat raisonne en TTC, soit
-- etatFacturation apprend à lire montant_ttc quand le HT manque.
--
-- Idempotente et SANS PERTE. À exécuter dans l'éditeur SQL Supabase.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. COLONNES ProGBat SUR LES FACTURES
-- ───────────────────────────────────────────────────────────────────────────
-- `source` d'abord : c'est elle qui sépare les deux régimes (une facture
-- manuelle ne doit jamais être touchée par la synchronisation, et une facture
-- ProGBat n'obéit pas aux mêmes exigences de montants).
alter table public.chantier_factures_client
  add column if not exists source text not null default 'manuel';

alter table public.chantier_factures_client
  -- Identité ProGBat. progbat_bill_id est LA clé de déduplication.
  add column if not exists progbat_bill_id            bigint,
  add column if not exists progbat_bill_code          text,
  add column if not exists progbat_quote_id           bigint,
  add column if not exists progbat_yard_id            bigint,
  add column if not exists progbat_business_id        bigint,
  -- `type` n'est PAS contraint : ProGBat peut ajouter des valeurs demain, et
  -- une facture refusée à l'import pour un type inconnu serait une perte.
  add column if not exists progbat_type               text,
  add column if not exists progbat_situation_number   integer,
  -- status / validated : entiers bruts, sémantique non documentée côté
  -- ProGBat. Conservés tels quels, jamais interprétés en base.
  add column if not exists progbat_status             integer,
  add column if not exists progbat_validated          integer,
  add column if not exists progbat_revision_number    integer,
  add column if not exists progbat_document_date      date,
  add column if not exists progbat_due_date           date,
  -- Montants ProGBat EXACTS, séparés des montants génériques. Signés.
  add column if not exists progbat_deal_net_total     numeric(14,2),
  add column if not exists progbat_deal_taxes         numeric(14,2),
  add column if not exists progbat_deal_ati_total     numeric(14,2),
  add column if not exists progbat_achievement        numeric(14,2),
  add column if not exists progbat_previous_achievement numeric(14,2),
  add column if not exists progbat_net_total          numeric(14,2),
  add column if not exists progbat_taxes              numeric(14,2),
  add column if not exists progbat_ati_total          numeric(14,2),
  add column if not exists progbat_holdback           numeric(14,2),
  add column if not exists progbat_deducted_advance   numeric(14,2),
  add column if not exists progbat_to_be_paid         numeric(14,2),
  add column if not exists progbat_ati_deductions     numeric(14,2),
  -- Détails : tableaux JSON reconstruits sur liste blanche côté module pur
  -- (taxDetails : level/rate/base/amount ; deductions : label/amount/
  -- afterTaxes/direction/taxRate). Jamais de payload brut.
  add column if not exists progbat_tax_details        jsonb,
  add column if not exists progbat_deductions         jsonb,
  add column if not exists progbat_dgd                boolean,
  add column if not exists progbat_synced_at          timestamptz,
  add column if not exists progbat_pdf_synced_at      timestamptz,
  -- Protection du rapprochement corrigé à la main : une fois qu'un humain a
  -- choisi l'échéance, aucune synchronisation ne la reprend.
  add column if not exists ligne_id_verrouille        boolean not null default false,
  add column if not exists ligne_id_modifie_par       uuid,
  add column if not exists ligne_id_modifie_le        timestamptz;

comment on column public.chantier_factures_client.source is
  'Origine de la facture : ''manuel'' (saisie/import PDF) ou ''progbat'' (synchronisée depuis ProGBat). Une facture manuelle n''est JAMAIS modifiée par la synchronisation.';
comment on column public.chantier_factures_client.progbat_bill_id is
  'bill.id ProGBat — clé de déduplication. Le numéro (code) n''en est pas une.';
comment on column public.chantier_factures_client.montant_ttc is
  'Montant TTC. Pour source=''progbat'' : toBePaid (exigible après déduction des acomptes), signé. montant_ht et montant_tva restent null dans ce cas : netTotal/taxes suivent atiTotal cumulatif et ne décrivent pas le HT/TVA exigibles.';
comment on column public.chantier_factures_client.ligne_id_verrouille is
  'true = l''échéance a été corrigée à la main : la synchronisation ne reprend plus ligne_id, rapprochement ni raison.';

-- ── Contraintes ────────────────────────────────────────────────────────────
-- Chaque contrainte est RETIRÉE puis reposée : la migration reste rejouable, et
-- une version antérieure de ce fichier ne laisse pas une règle périmée en base.
-- Toutes sont vérifiées par les lignes existantes, qui sont toutes manuelles
-- avec des colonnes ProGBat nulles.
alter table public.chantier_factures_client
  drop constraint if exists chantier_factures_client_source_check,
  drop constraint if exists chantier_factures_client_progbat_identite,
  drop constraint if exists chantier_factures_client_progbat_ids_positifs,
  drop constraint if exists chantier_factures_client_progbat_montant,
  drop constraint if exists chantier_factures_client_progbat_invariants,
  drop constraint if exists chantier_factures_client_progbat_json_tableaux;

alter table public.chantier_factures_client
  add constraint chantier_factures_client_source_check
  check (source in ('manuel', 'progbat'));

-- Une facture ProGBat A un bill.id, une facture manuelle n'en a JAMAIS :
-- l'équivalence rend la déduplication non ambiguë dans les deux sens.
alter table public.chantier_factures_client
  add constraint chantier_factures_client_progbat_identite
  check ((source = 'progbat') = (progbat_bill_id is not null));

-- INVARIANTS D'UNE FACTURE ProGBat — la base les garantit, pas seulement le
-- module qui écrit. C'est ce qui empêche une ligne « à moitié ProGBat » de
-- s'installer : un brouillon importé par erreur, un TTC qui aurait cessé de
-- valoir toBePaid après une retouche, ou un HT/TVA reconstitué à la main dont
-- personne ne saurait plus d'où il sort.
--   validated = 1      → un brouillon (validated = 0) n'entre pas ;
--   toBePaid présent   → le seul montant réellement dû ;
--   montant_ttc = toBePaid, au centime près et SANS conversion : les deux
--                        colonnes ne peuvent pas diverger en silence ;
--   montant_ht / montant_tva NULL → aucune ventilation inventée (netTotal et
--                        taxes suivent atiTotal cumulatif ; ils restent lisibles
--                        dans leurs colonnes progbat_*).
-- Les factures manuelles ne sont PAS concernées : leurs exigences (aucune)
-- sont inchangées.
alter table public.chantier_factures_client
  add constraint chantier_factures_client_progbat_invariants
  check (
    source <> 'progbat' or (
      progbat_bill_id is not null and progbat_bill_id > 0
      and progbat_validated = 1
      and progbat_to_be_paid is not null
      and montant_ttc is not null
      and montant_ttc = progbat_to_be_paid
      and montant_ht is null
      and montant_tva is null
    )
  );

-- ProGBat numérote à partir de 1 : un 0 est un champ vide, pas un document.
alter table public.chantier_factures_client
  add constraint chantier_factures_client_progbat_ids_positifs
  check (
    (progbat_bill_id     is null or progbat_bill_id     > 0) and
    (progbat_yard_id     is null or progbat_yard_id     > 0) and
    (progbat_quote_id    is null or progbat_quote_id    > 0) and
    (progbat_business_id is null or progbat_business_id > 0)
  );

-- Détails : des TABLEAUX JSON, ou rien. Un objet ou un scalaire signalerait
-- un payload recopié tel quel.
alter table public.chantier_factures_client
  add constraint chantier_factures_client_progbat_json_tableaux
  check (
    (progbat_tax_details is null or jsonb_typeof(progbat_tax_details) = 'array') and
    (progbat_deductions  is null or jsonb_typeof(progbat_deductions)  = 'array')
  );

-- ── Unicité : deux régimes distincts ───────────────────────────────────────
-- ProGBat : le bill.id, et lui seul. Portée GLOBALE (un bill.id ne peut pas
-- exister sur deux chantiers) — c'est ce qui rend la synchronisation
-- idempotente même si la résolution du chantier change.
create unique index if not exists uq_factures_client_progbat_bill
  on public.chantier_factures_client (progbat_bill_id)
  where progbat_bill_id is not null;

-- Manuel : le numéro par chantier, comme avant. Le nouvel index est créé AVANT
-- que l'ancien ne tombe : à aucun instant les factures manuelles ne sont sans
-- protection. Son prédicat est un sous-ensemble strict de l'ancien, donc sa
-- création ne peut pas échouer sur des doublons.
create unique index if not exists uq_factures_client_numero_manuel
  on public.chantier_factures_client (chantier_id, lower(btrim(numero)))
  where numero is not null and btrim(numero) <> '' and statut <> 'annulee' and source = 'manuel';

-- L'ancien index couvrait aussi les factures ProGBat : deux factures ProGBat
-- au même numéro (renumérotation, avoir portant le numéro de la facture) se
-- seraient refusées l'une l'autre alors qu'elles ont deux bill.id distincts.
drop index if exists public.uq_factures_client_numero;

create index if not exists idx_factures_client_progbat_yard
  on public.chantier_factures_client (progbat_yard_id)
  where progbat_yard_id is not null;
create index if not exists idx_factures_client_source
  on public.chantier_factures_client (source, chantier_id);

-- ── Garde-fou : une facture ProGBat n'appartient pas au navigateur ────────
-- La RLS laisse le bureau écrire dans cette table (import manuel d'un PDF,
-- correction d'une échéance). Ce trigger ajoute la seule frontière qui manque :
-- ce qui vient de ProGBat ne se saisit ni ne se retouche depuis l'application.
--
-- INTERDIT au rôle SQL « authenticated » :
--   • créer une facture source='progbat' — la synchronisation seule les crée ;
--   • changer la source dans un sens ou dans l'autre ;
--   • sur une facture ProGBat, toucher aux champs progbat_*, au numéro, à la
--     date, aux trois montants, au pct_du_marche, au statut, à l'encaissement
--     et au document : tous viennent de ProGBat ou en dépendent, et une
--     retouche serait écrasée à la synchronisation suivante sans que personne
--     ne comprenne pourquoi.
--
-- RESTE PERMIS au bureau sur une facture ProGBat — tout le travail humain :
--   chantier_id, ligne_id, ligne_nom, ligne_id_verrouille, ligne_id_modifie_par,
--   ligne_id_modifie_le, rapprochement, raison, commentaire.
--
-- QUI EST RECONNU COMMENT : current_user est le rôle SQL réel. PostgREST
-- exécute les requêtes du navigateur sous « authenticated » (ou « anon ») ; une
-- Edge Function avec la clé de service est sous « service_role » ; l'éditeur SQL
-- est sous « postgres ». Seuls les deux premiers sont bridés — sinon la
-- synchronisation ne pourrait plus rien écrire. On ne lit PAS
-- request.jwt.claims : c'est une revendication du client, là où le rôle SQL est
-- ce que la base a réellement endossé.
--
-- Les champs gelés sont comparés via jsonb plutôt que colonne par colonne : une
-- colonne progbat_* ajoutée demain est protégée sans retoucher le trigger.
create or replace function public.protege_factures_progbat()
returns trigger language plpgsql as $$
declare
  -- Champs non-progbat_ gelés sur une facture ProGBat.
  champs_geles constant text[] := array[
    'numero', 'date_facture', 'montant_ht', 'montant_tva', 'montant_ttc',
    'pct_du_marche', 'statut', 'date_encaissement', 'montant_encaisse',
    'document_path', 'document_nom'
  ];
  avant jsonb;
  apres jsonb;
begin
  -- Tout rôle autre que ceux du navigateur passe sans contrôle.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- INSERT : OLD n'existe pas, et n'est JAMAIS lu ici.
  if tg_op = 'INSERT' then
    if new.source is not distinct from 'progbat' then
      raise exception 'Une facture ProGBat ne se crée pas depuis l''application : elle vient de la synchronisation.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE — à partir d'ici seulement, OLD est disponible.
  if new.source is distinct from old.source then
    raise exception 'La source d''une facture ne se change pas depuis l''application (facture %).', old.id
      using errcode = 'check_violation';
  end if;

  if old.source is distinct from 'progbat' then
    return new;   -- facture manuelle : rien à geler ici
  end if;

  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into avant
    from jsonb_each(to_jsonb(old)) as e(k, v)
    where k like 'progbat\_%' or k = any(champs_geles);
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into apres
    from jsonb_each(to_jsonb(new)) as e(k, v)
    where k like 'progbat\_%' or k = any(champs_geles);

  if avant is distinct from apres then
    raise exception 'Les données d''une facture ProGBat (montants, numéro, statut, document) ne se modifient pas depuis l''application (facture %). Seuls le chantier, l''échéance et les commentaires sont modifiables.', old.id
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

-- L'ancien garde-fou (BEFORE UPDATE seul, fondé sur request.jwt.claims) est
-- retiré nommément : sur une base qui aurait déjà reçu une version antérieure
-- de ce fichier, il ne doit pas survivre à côté du nouveau.
drop trigger if exists trg_protege_champs_progbat_facture on public.chantier_factures_client;
drop function if exists public.protege_champs_progbat_facture();

drop trigger if exists trg_protege_factures_progbat on public.chantier_factures_client;
create trigger trg_protege_factures_progbat
  before insert or update on public.chantier_factures_client
  for each row execute function public.protege_factures_progbat();

-- ───────────────────────────────────────────────────────────────────────────
-- 2. RÈGLEMENTS
-- ───────────────────────────────────────────────────────────────────────────
-- Une ligne = une affectation de règlement à UNE facture, telle que ProGBat la
-- décrit dans transaction.checking[] (docType = "bill", docId = bill.id,
-- amount signé). Une facture peut en recevoir plusieurs (règlements partiels),
-- et une transaction peut en alimenter plusieurs.
--
-- CE QUI N'ENTRE JAMAIS ICI : bankAccountId, libellé bancaire, IBAN,
-- paymentNumber, payload brut. Le rapprochement d'une facture n'a besoin que
-- d'un identifiant, d'une date, d'un montant et d'un mode.
--
-- montant_encaisse (scalaire, sur la facture) reste en place pour les factures
-- manuelles historiques. Pour source='progbat', l'encaissé sera DÉRIVÉ de la
-- somme des règlements non annulés — jamais recopié dans un champ qui
-- divergerait en silence.
create table if not exists public.chantier_factures_reglements (
  id                      uuid primary key default gen_random_uuid(),
  facture_id              uuid not null
                          references public.chantier_factures_client(id) on delete cascade,
  source                  text not null default 'manuel',
  progbat_transaction_id  bigint,
  progbat_doc_type        text,
  -- transaction.canceled est remonté TEL QUEL : sa sémantique (0/1 ? drapeau ?)
  -- n'est pas documentée par ProGBat et n'a pas été établie sur les données
  -- réelles. `annule` ne s'en déduit donc PAS automatiquement — voir
  -- normaliserReglementProgbat() dans src/Renovation/progbatFacturation.mjs.
  progbat_canceled        integer,
  date_reglement          date,
  -- Signé : un avoir se règle par une transaction négative.
  montant                 numeric(14,2) not null,
  mode                    text,
  annule                  boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'chantier_factures_reglements_source_check'
                   and conrelid = 'public.chantier_factures_reglements'::regclass) then
    alter table public.chantier_factures_reglements
      add constraint chantier_factures_reglements_source_check
      check (source in ('manuel', 'progbat'));
  end if;

  -- Un règlement ProGBat porte forcément sa transaction et un lettrage de
  -- FACTURE : un checking d'un autre docType ne décrit pas un règlement client.
  if not exists (select 1 from pg_constraint
                 where conname = 'chantier_factures_reglements_progbat_identite'
                   and conrelid = 'public.chantier_factures_reglements'::regclass) then
    alter table public.chantier_factures_reglements
      add constraint chantier_factures_reglements_progbat_identite
      check (
        source <> 'progbat'
        or (progbat_transaction_id is not null and progbat_transaction_id > 0
            and progbat_doc_type = 'bill')
      );
  end if;

  -- Symétrie : un règlement saisi à la main ne porte aucun identifiant ProGBat.
  if not exists (select 1 from pg_constraint
                 where conname = 'chantier_factures_reglements_manuel_sans_progbat'
                   and conrelid = 'public.chantier_factures_reglements'::regclass) then
    alter table public.chantier_factures_reglements
      add constraint chantier_factures_reglements_manuel_sans_progbat
      check (source <> 'manuel' or (progbat_transaction_id is null and progbat_doc_type is null));
  end if;
end $$;

-- Une transaction ne peut alimenter qu'une fois la même facture : c'est ce qui
-- rend la synchronisation des règlements idempotente. La paire est volontaire
-- (une transaction peut régler deux factures).
create unique index if not exists uq_factures_reglements_progbat
  on public.chantier_factures_reglements (progbat_transaction_id, facture_id)
  where progbat_transaction_id is not null;

create index if not exists idx_factures_reglements_facture
  on public.chantier_factures_reglements (facture_id);

-- ── Accès : lecture bureau, écriture serveur ───────────────────────────────
-- Aucun écran n'écrit de règlement dans ce lot : `authenticated` n'a donc que
-- SELECT, et aucune policy d'écriture n'existe. L'Edge Function de
-- synchronisation écrira via service_role, qui contourne la RLS.
alter table public.chantier_factures_reglements enable row level security;

drop policy if exists "reglements lecture bureau" on public.chantier_factures_reglements;
create policy "reglements lecture bureau" on public.chantier_factures_reglements
  for select to authenticated
  using (not public.est_ouvrier());

revoke all on table public.chantier_factures_reglements from public, anon, authenticated;
grant select on table public.chantier_factures_reglements to authenticated;

-- ── Filet de sécurité data_history (garde : sql/202606_data_history_…) ─────
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'log_data_history'
  ) then
    execute 'drop trigger if exists trg_data_history on public.chantier_factures_reglements';
    execute 'create trigger trg_data_history before update or delete on public.chantier_factures_reglements
             for each row execute function public.log_data_history()';
  end if;
end $$;

-- ── updated_at (double garde : fonction commune ET colonne présente) ───────
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_updated_at'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'chantier_factures_reglements'
      and column_name = 'updated_at'
  ) then
    execute 'drop trigger if exists chantier_factures_reglements_set_updated_at on public.chantier_factures_reglements';
    execute 'create trigger chantier_factures_reglements_set_updated_at
             before update on public.chantier_factures_reglements
             for each row execute function public.set_updated_at()';
  end if;
end $$;

comment on table public.chantier_factures_reglements is
  'Règlements affectés à une facture client. Pour source=''progbat'' : une ligne de transaction.checking[] (docType="bill", docId=bill.id, montant signé). Lecture bureau, écriture serveur (Edge Function de synchronisation).';

-- ─── Contrôles ─────────────────────────────────────────────────────────────
-- select source, count(*) from public.chantier_factures_client group by 1;
-- select f.numero, f.montant_ttc, sum(r.montant) filter (where not r.annule) as regle
--   from public.chantier_factures_client f
--   left join public.chantier_factures_reglements r on r.facture_id = f.id
--   where f.source = 'progbat' group by f.id, f.numero, f.montant_ttc;
