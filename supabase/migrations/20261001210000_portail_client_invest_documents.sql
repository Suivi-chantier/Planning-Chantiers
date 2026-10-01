-- ============================================================================
-- Portail client Invest — étape 3 : documents partagés explicitement.
-- Périmètre : Profero Invest. Décision de Matthieu (01/10/2026) : le client ne
-- reçoit que les documents que Profero partage explicitement. Lecture seule.
--
-- PRINCIPE : le stockage reste fermé (règle 3a : collaborateurs seulement). Le
-- client n'a AUCUN droit sur les fichiers. Il lit la vue portail_documents (nom
-- affiché, date : jamais le chemin) et demande un lien de téléchargement à
-- l'Edge Function portail-document-url, qui revérifie le droit puis délivre un
-- lien signé de 60 secondes.
--
-- 1. public.invest_documents_partages : un partage = un fichier d'un client.
--    Le chemin DOIT être dans le dossier du client (clients/<client_id>/...) :
--    impossible de partager le fichier d'un autre client ou d'un bien.
-- 2. public.portail_documents : vue en lecture seule, pour le seul client de
--    l'appelant ; masquée si le dossier rattaché n'est pas montré.
--
-- SANS EFFET IMMÉDIAT : aucun partage n'existe, aucun client n'existe.
-- RETOUR ARRIÈRE : sql/202610_portail_client_invest_documents_rollback.sql
-- VÉRIFICATION  : node scripts/verif-portail-client-invest.mjs
-- ============================================================================

create table public.invest_documents_partages (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.invest_clients(id) on delete cascade,
  dossier_id  uuid references public.invest_dossiers(id) on delete set null,
  chemin      text not null,
  libelle     text not null check (length(btrim(libelle)) > 0),
  statut      text not null default 'partage' check (statut in ('partage', 'retire')),
  partage_par text,
  partage_le  timestamptz not null default now(),
  retire_le   timestamptz,
  constraint invest_documents_partages_dans_dossier_client
    check (chemin like 'clients/' || client_id::text || '/%' and chemin not like '%..%'),
  constraint invest_documents_partages_unique unique (client_id, chemin)
);
create index invest_documents_partages_client_idx on public.invest_documents_partages (client_id);

alter table public.invest_documents_partages enable row level security;
revoke all on public.invest_documents_partages from public, anon, authenticated;
grant select, insert, update, delete on public.invest_documents_partages to authenticated;

-- Qui partage : ceux qui gèrent les clients dans le CRM (même règle que les dossiers).
create policy invest_documents_partages_crm on public.invest_documents_partages
  for all to authenticated
  using ((select public.invest_peut_voir('crm')))
  with check ((select public.invest_peut_voir('crm')));

-- Règle du dépôt : toute nouvelle table reçoit la restrictive 3a.
create policy profero_collaborateurs_seulement on public.invest_documents_partages
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif()))
  with check ((select public.est_collaborateur_actif()));

create view public.portail_documents with (security_barrier = true) as
  select p.id, p.dossier_id, p.libelle, p.partage_le
  from public.invest_documents_partages p
  where p.statut = 'partage'
    and p.client_id = (select public.portail_client_id())
    and (p.dossier_id is null or exists (
          select 1 from public.invest_dossiers d
          where d.id = p.dossier_id and d.portail_visible is true));

-- Supabase accorde tout par défaut à authenticated sur les nouveaux objets, et une
-- vue simple est modifiable : on retire TOUT avant de n'accorder que la lecture.
revoke all on public.portail_documents from public, anon, authenticated;
grant select on public.portail_documents to authenticated;
