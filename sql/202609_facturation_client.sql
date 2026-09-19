-- ============================================================================
-- FACTURATION CLIENT — registre des factures émises au client, chantier par
-- chantier. À exécuter dans l'éditeur SQL Supabase. Idempotent.
--
-- Modèle : une FACTURE CLIENT est un document réel (le PDF envoyé au client),
-- rattaché à une ÉCHÉANCE de l'échéancier contractuel du chantier (acompte
-- 50 %, démarrage 20 %, situations, solde — voir src/Renovation/
-- facturationClient.mjs). Deux états successifs, jamais confondus :
--   statut = 'emise'     → la facture est partie chez le client ;
--   statut = 'encaissee' → l'argent est arrivé (date + montant reçu).
-- C'est l'ENCAISSEMENT de l'acompte, pas son émission, qui valide l'étape
-- « Acompte encaissé » du cycle de vie.
--
-- L'échéancier lui-même n'est PAS ici : le défaut vit dans planning_config
-- (clé "echeancier_facturation") et la surcharge par chantier dans
-- phasages.plan_travaux.meta.facturation_echeancier — mêmes conventions que
-- le reste du cycle de vie.
--
-- ligne_id est un identifiant TEXTE de l'échéancier (ex. "situation_1"), pas
-- une clé étrangère : l'échéancier est une donnée de configuration, qui peut
-- être ajustée par chantier. Une facture dont la ligne a disparu reste
-- visible dans le bloc « hors échéancier », jamais perdue.
-- ============================================================================

create table if not exists public.chantier_factures_client (
  id                 uuid primary key default gen_random_uuid(),
  chantier_id        text not null,
  phasage_id         uuid,
  ligne_id           text,                       -- id de l'échéance ; null = hors échéancier
  ligne_nom          text,                       -- libellé au moment du rattachement
  numero             text,                       -- numéro de la facture (lu sur le document)
  date_facture       date,
  montant_ht         numeric(12,2),
  montant_tva        numeric(12,2),
  montant_ttc        numeric(12,2),
  pct_du_marche      numeric(6,2),               -- montant_ht / marché HT × 100, au moment de l'import
  statut             text not null default 'emise'
                     check (statut in ('emise', 'encaissee', 'annulee')),
  date_encaissement  date,
  montant_encaisse   numeric(12,2),
  -- Le PDF lui-même : bucket privé "chantier-documents" (URL signée à la
  -- demande), même stockage que les pièces jointes du cycle de vie.
  document_path      text,
  document_nom       text,
  -- Traçabilité de la lecture automatique : ce que le modèle a lu, ce que le
  -- rapprochement a proposé, et si un humain a corrigé. Sert à expliquer une
  -- erreur de rattachement des mois plus tard.
  extraction         jsonb,                      -- sortie brute de la tâche IA
  confiance          numeric(4,2),               -- 0..1 du rapprochement proposé
  rapprochement      text,                       -- 'auto' | 'manuel' | 'corrige'
  raison             text,                       -- phrase explicative affichée
  commentaire        text,
  cree_par           text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_factures_client_chantier
  on public.chantier_factures_client (chantier_id);
create index if not exists idx_factures_client_ligne
  on public.chantier_factures_client (chantier_id, ligne_id);
create index if not exists idx_factures_client_statut
  on public.chantier_factures_client (chantier_id, statut);

-- Un même numéro de facture ne peut pas être importé deux fois sur un
-- chantier (le doublon est déjà signalé côté application, mais la base doit
-- le garantir : deux imports simultanés passeraient la vérification côté
-- client). Les factures sans numéro et les annulées ne sont pas contraintes.
create unique index if not exists uq_factures_client_numero
  on public.chantier_factures_client (chantier_id, lower(btrim(numero)))
  where numero is not null and btrim(numero) <> '' and statut <> 'annulee';

-- ── RLS : bureau uniquement — la facturation ne concerne pas le terrain,
-- même règle que controles_groupe / visites_chantier. ──────────────────────
alter table public.chantier_factures_client enable row level security;

drop policy if exists "factures client bureau" on public.chantier_factures_client;
create policy "factures client bureau" on public.chantier_factures_client
  for all to authenticated
  using (not public.est_ouvrier()) with check (not public.est_ouvrier());

-- ── Filet de sécurité data_history : tout update/delete garde l'état
-- précédent. Nécessite sql/202606_data_history_filet_securite.sql. ─────────
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'log_data_history'
  ) then
    execute 'drop trigger if exists trg_data_history on public.chantier_factures_client';
    execute 'create trigger trg_data_history before update or delete on public.chantier_factures_client
             for each row execute function public.log_data_history()';
  end if;
end $$;

-- ── updated_at ─────────────────────────────────────────────────────────────
create or replace function public.touch_factures_client()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_factures_client on public.chantier_factures_client;
create trigger trg_touch_factures_client before update on public.chantier_factures_client
  for each row execute function public.touch_factures_client();
