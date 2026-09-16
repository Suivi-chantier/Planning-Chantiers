-- ═══════════════════════════════════════════════════════════════════════════
-- LIAISON CHANTIER ↔ LOGEMENT (profero_projets) — le maillon manquant entre
-- une facture ProGBat et un chantier Profero.
--
-- Le chemin complet, une fois cette table en place :
--   facture ProGBat.quoteId
--     → progbat_quote_exports.progbat_quote_id  (déjà en place)
--     → progbat_quote_exports.project_id
--     → chantier_projets.chantier_id            ← CE QUI MANQUAIT
--
-- Le rattachement est EXPLICITE et posé à la main. Aucun rapprochement par
-- nom, adresse ou montant : deux logements d'un même immeuble portent la même
-- adresse et souvent le même client, un rapprochement automatique se
-- tromperait de chantier en silence. plans.projet_id/plans.chantier_id n'est
-- pas non plus une source : ce lien est posé par plan, facultatif, et deux
-- plans d'un même projet peuvent pointer vers deux chantiers différents.
--
-- Cardinalité : un chantier porte PLUSIEURS logements (un immeuble = N T2/T3),
-- un logement n'appartient qu'à UN chantier → contrainte unique sur projet_id.
--
-- ⚠️ chantier_id est un TEXTE SANS CLÉ ÉTRANGÈRE, et c'est voulu : les
-- chantiers ne sont pas une table. Ils vivent dans planning_config sous la clé
-- "chantiers" (tableau JSON [{ id, nom, couleur }], id = slug texte). Toutes
-- les tables métier du dépôt font pareil — controles_groupe, reserves,
-- visites_chantier, chantier_factures_client — et aucune ne peut déclarer de
-- FK vers un chantier. Une ligne dont le chantier a disparu de la
-- configuration reste donc visible : c'est le comportement existant, pas une
-- régression introduite ici.
--
-- Idempotente et SANS PERTE : aucune donnée existante n'est lue ni modifiée.
-- À exécuter dans l'éditeur SQL Supabase.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.chantier_projets (
  id             uuid primary key default gen_random_uuid(),
  chantier_id    text not null,                    -- slug de planning_config."chantiers" (voir ci-dessus)
  projet_id      uuid not null
                 references public.profero_projets(id) on delete cascade,
  cree_par       uuid not null default auth.uid(), -- auth.users.id de qui a rattaché
  cree_par_email text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Un logement appartient à UN SEUL chantier. C'est la contrainte qui empêche
-- qu'une facture ProGBat se résolve vers deux chantiers : la résolution est
-- soit unique, soit absente, jamais ambiguë.
-- (L'index unique est créé par la contrainte : ne pas en ajouter un second.)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chantier_projets_projet_unique'
      and conrelid = 'public.chantier_projets'::regclass
  ) then
    alter table public.chantier_projets
      add constraint chantier_projets_projet_unique unique (projet_id);
  end if;
end $$;

-- `not null` ne suffit pas : une chaîne vide passerait, et créerait un
-- rattachement vers aucun chantier — invisible dans l'écran, mais bien présent
-- en base et capable de faire « résoudre » une facture vers le vide.
-- Posé en `alter` guardé plutôt qu'en ligne dans le create : la contrainte
-- s'ajoute aussi à une table déjà créée par une exécution précédente.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chantier_projets_chantier_non_vide'
      and conrelid = 'public.chantier_projets'::regclass
  ) then
    alter table public.chantier_projets
      add constraint chantier_projets_chantier_non_vide check (btrim(chantier_id) <> '');
  end if;
end $$;

-- Sens de lecture le plus fréquent : « quels logements pour ce chantier ? ».
-- (chantier_id n'est couvert par aucune contrainte, donc par aucun index.)
create index if not exists chantier_projets_chantier_idx
  on public.chantier_projets (chantier_id);

-- ─── RLS : bureau, comme toute donnée de chantier ──────────────────────────
-- Même règle que chantier_factures_client, controles_groupe et reserves : les
-- utilisateurs authentifiés du bureau lisent et écrivent, les ouvriers non.
alter table public.chantier_projets enable row level security;

drop policy if exists "chantier_projets bureau" on public.chantier_projets;
create policy "chantier_projets bureau" on public.chantier_projets
  for all to authenticated
  using (not public.est_ouvrier()) with check (not public.est_ouvrier());

-- Privilèges SQL, explicites — la RLS ne filtre que ce que les privilèges
-- autorisent déjà. Supabase accorde par défaut TOUS les droits à `anon` et
-- `authenticated` sur les tables de `public` : la RLS suffit à bloquer `anon`
-- (aucune policy ne le vise), mais on retire quand même ses droits, comme sur
-- materiel et materiel_audits — une policy ajoutée par erreur plus tard ne
-- pourrait pas ouvrir la table à un visiteur non authentifié.
revoke all on table public.chantier_projets from public, anon;
-- Ce dont le navigateur a réellement besoin : lire, rattacher, détacher.
-- (update n'est pas utilisé par l'écran, mais reste accordé pour que le
-- trigger set_updated_at et une correction ponctuelle restent possibles.)
grant select, insert, update, delete on table public.chantier_projets to authenticated;

-- ─── Filet de sécurité data_history : tout update/delete garde l'état
-- précédent. Nécessite sql/202606_data_history_filet_securite.sql. ─────────
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'log_data_history'
  ) then
    execute 'drop trigger if exists trg_data_history on public.chantier_projets';
    execute 'create trigger trg_data_history before update or delete on public.chantier_projets
             for each row execute function public.log_data_history()';
  end if;
end $$;

-- ─── updated_at ────────────────────────────────────────────────────────────
-- Double garde : la fonction commune doit exister ET la table doit porter la
-- colonne updated_at. Sans la colonne, le trigger lèverait « record "new" has
-- no field "updated_at" » à la première écriture — pas à la migration, ce qui
-- est bien pire. Le cas se présente si une table chantier_projets antérieure,
-- sans cette colonne, existe déjà (create table if not exists ne l'ajoute pas).
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_updated_at'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'chantier_projets' and column_name = 'updated_at'
  ) then
    execute 'drop trigger if exists chantier_projets_set_updated_at on public.chantier_projets';
    execute 'create trigger chantier_projets_set_updated_at
             before update on public.chantier_projets
             for each row execute function public.set_updated_at()';
  end if;
end $$;

comment on table public.chantier_projets is
  'Rattachement EXPLICITE d''un logement (profero_projets) à un chantier (slug planning_config."chantiers"). Un logement = un seul chantier ; un chantier = N logements. Maillon final de la résolution facture ProGBat → chantier.';

-- ═══════════════════════════════════════════════════════════════════════════
-- LECTURE DES DEVIS ProGBat EXPORTABLES (pour l'écran de rattachement)
--
-- progbat_quote_exports est une table SERVEUR : RLS activée sans aucune policy
-- et privilèges retirés à anon/authenticated (voir 202609_progbat_quote_exports
-- .sql), afin que le navigateur ne puisse ni lire ni écrire les réservations
-- de création de devis. L'écran de rattachement a pourtant besoin de savoir
-- QUELS logements ont un devis ProGBat, et avec quel identifiant.
--
-- On ouvre donc une porte étroite plutôt que la table : une fonction
-- SECURITY DEFINER qui ne renvoie que l'identifiant du devis, son code et son
-- statut — jamais le payload_hash, l'auteur, ni les messages d'erreur. Le
-- contrôle de rôle est explicite (bureau uniquement), comme dans les RPC de
-- l'espace ouvrier.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.progbat_devis_exportables()
returns table (
  projet_id          uuid,
  progbat_quote_id   bigint,
  progbat_quote_code text,
  statut             text,
  exporte_le         timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.project_id, e.progbat_quote_id, e.progbat_quote_code, e.statut, e.finished_at
  from public.progbat_quote_exports e
  -- Garde d'appelant. SECURITY DEFINER veut dire que le corps s'exécute avec
  -- les droits du propriétaire : sans ces deux lignes, n'importe quel appelant
  -- parvenant à exécuter la fonction lirait la table. auth.uid() is not null
  -- écarte l'anonyme (est_ouvrier() renvoie false pour lui, donc ne le filtre
  -- PAS : c'est bien auth.uid() qui fait ce travail).
  where auth.uid() is not null
    and public.est_ouvrier() = false
    -- Seuls les devis réellement créés dans ProGBat. 'uncertain' est exclu :
    -- ce statut signifie « on ne sait pas si le devis existe » (2xx sans id,
    -- délai, 5xx) et ne porte donc jamais d'identifiant exploitable — l'exclure
    -- rend l'intention explicite plutôt que de la laisser dépendre d'un
    -- identifiant nul. 'preparing', 'creating' et 'failed' n'ont rien créé.
    and e.statut = 'created'
    and e.progbat_quote_id is not null
    and e.progbat_quote_id > 0;          -- ceinture : pas d'identifiant exploitable, pas de référence
$$;

revoke all on function public.progbat_devis_exportables() from public, anon;
grant execute on function public.progbat_devis_exportables() to authenticated;

comment on function public.progbat_devis_exportables() is
  'Devis ProGBat réellement créés (statut created, identifiant connu), pour l''écran de rattachement chantier ↔ logement. Lecture seule, bureau authentifié uniquement, expose le strict minimum de progbat_quote_exports.';

-- ─── Contrôle ──────────────────────────────────────────────────────────────
-- select * from public.progbat_devis_exportables();
-- select chantier_id, count(*) from public.chantier_projets group by 1 order by 2 desc;
