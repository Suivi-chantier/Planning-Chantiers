-- ============================================================================
-- Refonte Opérations, lot 2 (06/11/2026) — statuts « À l'étude » et « Perdu »,
-- client et chargé d'affaires, parcours de chiffrage.
-- Fichier projet : docs/projets/refonte-operations.md.
-- Compte rendu   : docs/project/REFONTE-OPERATIONS-COMPTE-RENDU.md.
--
-- Migration PUREMENT ADDITIVE : deux tables créées, des colonnes facultatives
-- (toutes vides) ajoutées à operations et chantiers. Aucune donnée existante
-- n'est lue, réécrite ni supprimée ; aucun statut ne change (les 46 chantiers
-- gardent le leur). Aucune fonction SECURITY DEFINER, aucune policy existante
-- touchée, miroir planning_config inchangé (les nouvelles colonnes n'y sont
-- pas recopiées : les anciens lecteurs n'en ont pas besoin).
--
--   1. public.clients : la fiche client (une ligne par client), saisie sur
--      l'opération et reprise par défaut par ses chantiers. Lecture et
--      écriture réservées au BUREAU (les ouvriers n'y ont aucun accès : e-mail
--      et téléphone des clients). Pas de DELETE (archivage).
--      progbat_client_id : réservé au lot 4 (thirdId ProGBat), vide ici.
--   2. operations.client_id / charge_affaires_id / charge_affaires_nom :
--      valeurs par défaut de l'opération.
--   3. chantiers.client_id / charge_affaires_id / charge_affaires_nom : vide =
--      « comme l'opération » ; rempli = propre au chantier.
--      chantiers.perdu_le / perdu_par / perdu_motif / perdu_motif_detail :
--      bouton « Marquer perdu » (date, auteur, motif). Vidés si la perte est
--      annulée ; la trace reste dans le journal ci-dessous.
--   4. public.chantiers_statut_journal : journal des changements de statut
--      commerciaux (marqué perdu, perte annulée, bascule automatique en
--      Planifié à la signature). Ajout seulement : ni modification ni
--      suppression.
--
-- charge_affaires_id n'a pas de clé étrangère vers utilisateurs : la
-- suppression d'un compte (Administration) ne doit pas être bloquée ni
-- effacer en silence le chargé d'affaires d'un chantier ; l'écran affiche
-- alors « compte introuvable ». charge_affaires_nom garde le nom affiché
-- (la liste des comptes n'est lisible que par un administrateur).
--
-- Retour arrière : sql/202611_refonte_operations_lot2_rollback.sql.
--
-- APPLIQUÉE le 06/11/2026 (version 20261106052752, apply_migration), après un
-- essai complet dans une transaction annulée (46 chantiers / 19 opérations
-- inchangés, miroir planning_config identique, policy restrictive posée sur
-- les deux nouvelles tables). Corps appliqué = ce fichier, aux commentaires près.
-- ============================================================================

-- ─── 1. Fiche client ────────────────────────────────────────────────────────
create table public.clients (
  id                 uuid        primary key default gen_random_uuid(),
  -- 'particulier' ou 'societe' (règle de saisie : src/Renovation/reglesSaisieProgbat.mjs)
  type               text        not null default 'particulier',
  nom                text        not null default '',
  prenom             text        not null default '',
  raison_sociale     text        not null default '',
  contact_nom        text        not null default '',
  adresse            text        not null default '',
  adresse_complement text        not null default '',
  code_postal        text        not null default '',
  ville              text        not null default '',
  pays               text        not null default 'France',
  email              text        not null default '',
  telephone          text        not null default '',
  -- Identifiant ProGBat (`code`) généré sur le modèle « NOM VILLE ».
  code_progbat       text        not null default '',
  -- Lot 4 : thirdId du client ProGBat (vide tant que non créé / non rapproché).
  progbat_client_id  text,
  cree_par           text,
  archive_le         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint clients_type_valide check (type in ('particulier', 'societe'))
);

alter table public.clients enable row level security;
revoke all on public.clients from anon, authenticated;
grant select, insert, update on public.clients to authenticated;
create policy profero_collaborateurs_seulement on public.clients
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif()))
  with check ((select public.est_collaborateur_actif()));
create policy "clients bureau lecture" on public.clients for select to authenticated
  using ((select not public.est_ouvrier()));
create policy "clients bureau creation" on public.clients for insert to authenticated
  with check ((select not public.est_ouvrier()));
create policy "clients bureau modification" on public.clients for update to authenticated
  using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
create trigger clients_set_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

-- ─── 2. Opération : client et chargé d'affaires par défaut ──────────────────
alter table public.operations
  add column client_id           uuid references public.clients(id) on delete restrict,
  add column charge_affaires_id  uuid,
  add column charge_affaires_nom text;
create index operations_client_id_idx on public.operations (client_id);

-- ─── 3. Chantier : client / chargé d'affaires propres, perte ────────────────
alter table public.chantiers
  add column client_id           uuid references public.clients(id) on delete restrict,
  add column charge_affaires_id  uuid,
  add column charge_affaires_nom text,
  add column perdu_le            timestamptz,
  add column perdu_par           text,
  add column perdu_motif         text,
  add column perdu_motif_detail  text;
create index chantiers_client_id_idx on public.chantiers (client_id);

-- ─── 4. Journal des statuts commerciaux ─────────────────────────────────────
create table public.chantiers_statut_journal (
  id              bigint      generated always as identity primary key,
  chantier_id     text        not null references public.chantiers(id) on update cascade on delete restrict,
  -- 'marque_perdu' | 'perte_annulee' | 'bascule_signature'
  evenement       text        not null,
  ancien_statut   text,
  nouveau_statut  text,
  motif           text,
  detail          text,
  auteur          text,
  le              timestamptz not null default now()
);
create index chantiers_statut_journal_chantier_idx on public.chantiers_statut_journal (chantier_id, le);

alter table public.chantiers_statut_journal enable row level security;
revoke all on public.chantiers_statut_journal from anon, authenticated;
-- Ajout et lecture seulement : la trace ne se modifie ni ne s'efface.
grant select, insert on public.chantiers_statut_journal to authenticated;
create policy profero_collaborateurs_seulement on public.chantiers_statut_journal
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif()))
  with check ((select public.est_collaborateur_actif()));
create policy "statut journal bureau lecture" on public.chantiers_statut_journal for select to authenticated
  using ((select not public.est_ouvrier()));
create policy "statut journal bureau ajout" on public.chantiers_statut_journal for insert to authenticated
  with check ((select not public.est_ouvrier()));
