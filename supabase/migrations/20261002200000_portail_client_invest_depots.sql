-- ============================================================================
-- Portail client Invest — le client dépose des pièces (02/10/2026).
-- Suite de 20261002180000 (saisie du client). Même principe : le client ne touche à rien en direct.
--
--   • Les pièces qu'on lui demande = celles du dossier de structuration au statut « Demandé »
--     (portail_pieces_demandees()). Il peut aussi déposer un « autre document ».
--   • Le fichier passe par la fonction portail-depot-document (jetons à usage unique, chemin choisi par le
--     serveur : clients/<client>/depots-client/<dépôt>-<nom>, contrôle de la taille et des premiers octets).
--   • Chaque dépôt arrive « à vérifier » (table invest_portail_depots). Un collaborateur l'ouvre, puis l'accepte
--     (la pièce passe à « Reçu » dans le dossier) ou la refuse avec un motif.
--   • Le client n'a AUCUN accès direct à la table, ni au stockage (règle 3a) : il relit seulement ses dépôts
--     par la vue portail_depots.
--
-- RETOUR ARRIÈRE : sql/202610_portail_client_invest_depots_rollback.sql (les fichiers déjà déposés restent dans
--                  le stockage : ils se suppriment depuis le dossier du client).
-- VÉRIFICATION  : node scripts/verif-portail-depots.mjs
-- ============================================================================

create table public.invest_portail_depots (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.invest_clients(id) on delete cascade,
  piece_cle   text,
  libelle     text not null check (length(btrim(libelle)) > 0),
  nom_fichier text not null,
  chemin      text not null unique check (chemin like 'clients/' || client_id::text || '/depots-client/%' and chemin not like '%..%'),
  mime        text,
  taille      bigint check (taille is null or (taille > 0 and taille <= 10485760)),
  statut      text not null default 'en_attente_fichier' check (statut in ('en_attente_fichier', 'a_verifier', 'accepte', 'refuse', 'annule')),
  cree_le     timestamptz not null default now(),
  depose_le   timestamptz,
  traite_par  text,
  traite_le   timestamptz,
  motif       text
);
create index invest_portail_depots_client_idx on public.invest_portail_depots (client_id, statut, cree_le desc);

alter table public.invest_portail_depots enable row level security;
revoke all on public.invest_portail_depots from anon;
grant select, update on public.invest_portail_depots to authenticated;

-- Comme les autres tables Invest : seuls les rôles qui voient le CRM ou la structuration (jamais un ouvrier).
create policy invest_portail_depots_collaborateurs on public.invest_portail_depots
  for select to authenticated using ((select public.invest_peut_voir('crm')) or (select public.invest_peut_voir('structuration')));
create policy invest_portail_depots_traitement on public.invest_portail_depots
  for update to authenticated
  using ((select public.invest_peut_voir('crm')) or (select public.invest_peut_voir('structuration')))
  with check ((select public.invest_peut_voir('crm')) or (select public.invest_peut_voir('structuration')));
create policy profero_collaborateurs_seulement on public.invest_portail_depots
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif()))
  with check ((select public.est_collaborateur_actif()));

-- Ce que le client a déposé (sans le chemin du fichier).
create view public.portail_depots with (security_barrier = true) as
  select d.id, d.piece_cle, d.libelle, d.nom_fichier, d.taille, d.statut, d.depose_le, d.motif
  from public.invest_portail_depots d
  where d.client_id = (select public.portail_client_id())
    and d.statut in ('a_verifier', 'accepte', 'refuse');
revoke all on public.portail_depots from public, anon, authenticated;
grant select on public.portail_depots to authenticated;

-- Les pièces que Profero demande au client : celles du dossier de structuration au statut « Demandé ».
-- Seulement l'identifiant et le libellé : jamais les commentaires ni le reste du dossier.
create or replace function public.portail_pieces_demandees()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare cid uuid := public.portail_client_id(); d jsonb;
begin
  if cid is null then raise exception 'Accès refusé' using errcode = '42501'; end if;
  select s.donnees into d from public.invest_structuration_patrimoniale s where s.client_id = cid order by s.created_at desc limit 1;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', left(x ->> 'id', 60), 'label', left(x ->> 'label', 160)) order by x ->> 'label')
    from jsonb_array_elements(case when jsonb_typeof(d #> '{collecte,documents}') = 'array' then d #> '{collecte,documents}' else '[]'::jsonb end) x
    where x ->> 'statut' = 'Demandé' and coalesce(x ->> 'id', '') <> '' and coalesce(x ->> 'label', '') <> ''
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.portail_pieces_demandees() from public, anon;
grant execute on function public.portail_pieces_demandees() to authenticated;
