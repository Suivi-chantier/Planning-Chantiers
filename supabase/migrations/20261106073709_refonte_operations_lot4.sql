-- ============================================================================
-- Refonte Opérations, lot 4 (06/11/2026) — automatisation ProGBat : client,
-- chantier ProGBat, facture d'acompte, statut du devis.
-- Fichier projet : docs/projets/refonte-operations.md.
-- Compte rendu   : docs/project/REFONTE-OPERATIONS-COMPTE-RENDU.md.
--
-- Migration PUREMENT ADDITIVE : une table et des colonnes vides créées, une
-- tâche planifiée ajoutée. Aucune donnée existante lue, réécrite ni
-- supprimée ; aucune fonction SECURITY DEFINER, aucune policy existante
-- touchée.
--
--   1. public.progbat_ecritures : réservation anti-doublon de CHAQUE écriture
--      vers ProGBat déclenchée par un bouton (client, chantier ProGBat,
--      facture d'acompte). Même principe que progbat_quote_exports : une
--      ligne « creating » est réservée AVANT l'appel ; l'index unique partiel
--      (cible, cle) refuse une seconde réservation tant qu'une tentative est
--      en cours, réussie ou incertaine. Écrite et lue UNIQUEMENT par le
--      serveur (Edge Function progbat-operations, clé service) : aucune
--      policy permissive, seulement profero_collaborateurs_seulement.
--   2. public.chantiers : progbat_business_id / progbat_yard_id /
--      progbat_business_code (le « chantier ProGBat » créé ou relié).
--   3. public.profero_projets : progbat_business_id / progbat_yard_id (texte,
--      comme progbat_client_id : lus tels quels par le générateur du devis),
--      statut du devis lu dans ProGBat, facture d'acompte créée.
--   4. public.clients : index UNIQUE sur progbat_client_id (renseigné) —
--      demande de Loris du 06/11 : on choisit un client ProGBat EXISTANT pour
--      créer la fiche locale ; un même client ProGBat ne peut jamais avoir
--      deux fiches dans l'application (0 fiche reliée au 06/11 : aucun conflit).
--   5. Tâche planifiée « progbat-devis-statut » : toutes les heures (minute
--      37) de 6 h à 19 h UTC, appelle l'Edge Function progbat-devis-statut-cron
--      avec le même secret serveur que la synchronisation des factures. Elle
--      ne fait que LIRE les devis dans ProGBat et écrire leur statut dans
--      profero_projets.
--
-- Réglage (ni table ni colonne) : clé planning_config
-- « progbat_correspondance_managers » = { correspondances: { <utilisateurs.id>: <managerId ProGBat> } }.
-- ABSENTE = chantiers ProGBat créés sans responsable (l'écran le dit).
--
-- Retour arrière : sql/202611_refonte_operations_lot4_rollback.sql.
--
-- APPLIQUÉE le 06/11/2026 (version 20261106073709, apply_migration), après un
-- essai complet dans une transaction annulée (policy restrictive posée, tâche
-- planifiée créée, une réservation d'essai insérée puis une seconde refusée
-- par l'index unique ; 46 chantiers / 88 chiffrages inchangés). Corps
-- appliqué = ce fichier, aux commentaires près.
-- ============================================================================

-- ─── 1. Réservations des écritures ProGBat ──────────────────────────────────
create table public.progbat_ecritures (
  id                uuid        primary key default gen_random_uuid(),
  -- client (POST /company/thirds) · chantier (POST /company/business) ·
  -- acompte (POST /company/quotes/{id}/advance-bill)
  cible             text        not null check (cible in ('client', 'chantier', 'acompte')),
  -- clients.id · chantiers.id · identifiant ProGBat du devis
  cle               text        not null,
  statut            text        not null check (statut in ('creating', 'created', 'failed', 'uncertain')),
  payload_hash      text,
  progbat_id        bigint,
  progbat_code      text,
  http_status       integer,
  message           text,
  details           jsonb       not null default '{}'::jsonb,
  created_by        uuid,
  created_by_email  text,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index progbat_ecritures_actif_uidx on public.progbat_ecritures (cible, cle)
  where statut in ('creating', 'created', 'uncertain');
create index progbat_ecritures_cle_idx on public.progbat_ecritures (cible, cle, started_at desc);

alter table public.progbat_ecritures enable row level security;
revoke all on public.progbat_ecritures from anon, authenticated;
create policy profero_collaborateurs_seulement on public.progbat_ecritures
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif()))
  with check ((select public.est_collaborateur_actif()));
create trigger progbat_ecritures_set_updated_at before update on public.progbat_ecritures
  for each row execute function public.set_updated_at();

-- ─── 2. Chantier ProGBat sur le chantier ────────────────────────────────────
alter table public.chantiers
  add column progbat_business_id   bigint,
  add column progbat_yard_id       bigint,
  add column progbat_business_code text;

-- ─── 3. Chiffrage : chantier ProGBat, statut du devis, acompte ──────────────
alter table public.profero_projets
  add column progbat_business_id        text,
  add column progbat_yard_id            text,
  add column progbat_devis_statut       integer,
  add column progbat_devis_statut_le    date,
  add column progbat_devis_statut_lu_le timestamptz,
  add column progbat_acompte_bill_id    text,
  add column progbat_acompte_code       text;

-- ─── 4. Un client ProGBat = une seule fiche client locale ───────────────────
create unique index clients_progbat_client_id_uidx on public.clients (progbat_client_id)
  where progbat_client_id is not null;

-- ─── 5. Tâche planifiée : statut des devis (lecture ProGBat) ────────────────
select cron.schedule(
  'progbat-devis-statut',
  '37 6-19 * * *',
  $cron$
  select net.http_post(
    url := 'https://yooksnzhlffqgpzkcjhl.supabase.co/functions/v1/progbat-devis-statut-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-progbat-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'progbat_billing_cron_secret')
    ),
    body := '{"action":"statuts"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
