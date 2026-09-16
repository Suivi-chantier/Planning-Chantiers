-- ═══════════════════════════════════════════════════════════════════════════
-- RATTACHEMENT CHANTIER ProGBat (« yard ») ↔ CHANTIER PROFERO
--
-- Pourquoi cette table alors que chantier_projets existe déjà
-- ──────────────────────────────────────────────────────────
-- Une facture ProGBat porte DEUX identifiants de rattachement : `quoteId` (le
-- devis dont elle découle) et `yardId` (le chantier ProGBat). Les données
-- réelles ont tranché : sur un échantillon de 20 factures, 14 yardId distincts,
-- tous retrouvés dans /company/yards ; une facture sans devis (quoteId = 0)
-- porte quand même un yardId ; plusieurs factures ET plusieurs devis partagent
-- le même yardId. Le chantier ProGBat est donc le rattachement STABLE, là où
-- le devis change à chaque avenant.
--
-- Chemin principal :
--   facture.yardId
--     → chantier_progbat_yards.progbat_yard_id
--     → chantier_id Profero
--
-- Chemin de repli, UNIQUEMENT quand yardId est absent ou vaut 0 :
--   facture.quoteId → progbat_quote_exports → chantier_projets → chantier_id
--
-- chantier_projets n'est donc NI supprimée NI modifiée : elle reste le repli.
--
-- Cardinalité : un chantier Profero peut recevoir PLUSIEURS chantiers ProGBat
-- (un immeuble découpé en plusieurs yards ProGBat) ; un chantier ProGBat
-- n'appartient qu'à UN chantier Profero → unique sur progbat_yard_id seul.
-- Pas d'unique sur chantier_id : ce serait exactement l'inverse de la règle.
--
-- ⚠️ chantier_id est un TEXTE SANS CLÉ ÉTRANGÈRE, et c'est voulu : les
-- chantiers ne sont pas une table, ils vivent dans planning_config sous la clé
-- "chantiers" (tableau JSON [{ id, nom, couleur }], id = slug texte). Toutes
-- les tables métier du dépôt font pareil — chantier_projets, controles_groupe,
-- reserves, chantier_factures_client — et aucune ne peut déclarer de FK vers un
-- chantier.
--
-- ⚠️ Aucune FK non plus vers ProGBat : progbat_yard_id est un identifiant
-- EXTERNE. Rien dans cette base ne liste les chantiers ProGBat, et un yard
-- supprimé chez ProGBat ne doit pas faire disparaître le rattachement en
-- silence — il doit rester visible pour être corrigé à la main.
--
-- Idempotente et SANS PERTE : aucune donnée existante n'est lue ni modifiée.
-- À exécuter dans l'éditeur SQL Supabase.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.chantier_progbat_yards (
  id                         uuid primary key default gen_random_uuid(),
  chantier_id                text   not null,   -- slug de planning_config."chantiers" (voir ci-dessus)
  progbat_yard_id            bigint not null,   -- yard.id ProGBat (= facture.yardId)
  progbat_yard_label         text,              -- libellé au moment du rattachement, pour relire l'écran
  progbat_public_yard_number text,              -- observé null sur toutes les données réelles : nullable
  cree_par                   uuid   not null default auth.uid(),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

-- Un chantier ProGBat n'appartient qu'à UN chantier Profero. C'est la
-- contrainte qui garantit qu'une facture portant un yardId se résout vers un
-- seul chantier, ou vers aucun — jamais vers deux.
-- (L'index unique est créé par la contrainte : ne pas en ajouter un second.)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chantier_progbat_yards_yard_unique'
      and conrelid = 'public.chantier_progbat_yards'::regclass
  ) then
    alter table public.chantier_progbat_yards
      add constraint chantier_progbat_yards_yard_unique unique (progbat_yard_id);
  end if;
end $$;

-- `not null` ne suffit pas : une chaîne vide passerait et créerait un
-- rattachement vers aucun chantier — invisible dans l'écran, mais bien présent
-- en base et capable de faire « résoudre » une facture vers le vide.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chantier_progbat_yards_chantier_non_vide'
      and conrelid = 'public.chantier_progbat_yards'::regclass
  ) then
    alter table public.chantier_progbat_yards
      add constraint chantier_progbat_yards_chantier_non_vide check (btrim(chantier_id) <> '');
  end if;
end $$;

-- ProGBat numérote à partir de 1. Une facture réelle porte yardId = 0 : c'est
-- un champ VIDE, pas un chantier. Interdire 0 et les négatifs en base évite
-- qu'un rattachement « vers le yard 0 » capture toutes ces factures.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chantier_progbat_yards_yard_positif'
      and conrelid = 'public.chantier_progbat_yards'::regclass
  ) then
    alter table public.chantier_progbat_yards
      add constraint chantier_progbat_yards_yard_positif check (progbat_yard_id > 0);
  end if;
end $$;

-- Sens de lecture le plus fréquent : « quels chantiers ProGBat pour ce
-- chantier ? ». chantier_id n'est couvert par aucune contrainte (et ne doit
-- pas l'être), donc par aucun index : celui-ci est le seul.
create index if not exists chantier_progbat_yards_chantier_idx
  on public.chantier_progbat_yards (chantier_id);

-- ─── RLS : bureau, comme toute donnée de chantier ──────────────────────────
-- Même règle que chantier_projets, chantier_factures_client et controles_groupe.
alter table public.chantier_progbat_yards enable row level security;

drop policy if exists "chantier_progbat_yards bureau" on public.chantier_progbat_yards;
create policy "chantier_progbat_yards bureau" on public.chantier_progbat_yards
  for all to authenticated
  using (not public.est_ouvrier()) with check (not public.est_ouvrier());

-- Privilèges SQL, explicites — la RLS ne filtre que ce que les privilèges
-- autorisent déjà. Supabase accorde par défaut TOUS les droits à `anon` et
-- `authenticated` sur les tables de `public` : la RLS suffit à bloquer `anon`
-- (aucune policy ne le vise), mais on retire quand même ses droits — une
-- policy ajoutée par erreur plus tard ne pourrait pas ouvrir la table à un
-- visiteur non authentifié.
revoke all on table public.chantier_progbat_yards from public, anon;
grant select, insert, update, delete on table public.chantier_progbat_yards to authenticated;

-- ─── Filet de sécurité data_history : tout update/delete garde l'état
-- précédent. Nécessite sql/202606_data_history_filet_securite.sql. ─────────
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'log_data_history'
  ) then
    execute 'drop trigger if exists trg_data_history on public.chantier_progbat_yards';
    execute 'create trigger trg_data_history before update or delete on public.chantier_progbat_yards
             for each row execute function public.log_data_history()';
  end if;
end $$;

-- ─── updated_at ────────────────────────────────────────────────────────────
-- Double garde, comme sur chantier_projets : la fonction commune doit exister
-- ET la table doit porter la colonne updated_at. Sans la colonne, le trigger
-- lèverait « record "new" has no field "updated_at" » à la première écriture —
-- pas à la migration, ce qui est bien pire.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_updated_at'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'chantier_progbat_yards' and column_name = 'updated_at'
  ) then
    execute 'drop trigger if exists chantier_progbat_yards_set_updated_at on public.chantier_progbat_yards';
    execute 'create trigger chantier_progbat_yards_set_updated_at
             before update on public.chantier_progbat_yards
             for each row execute function public.set_updated_at()';
  end if;
end $$;

comment on table public.chantier_progbat_yards is
  'Rattachement EXPLICITE d''un chantier ProGBat (yard.id = facture.yardId) à un chantier Profero (slug planning_config."chantiers"). Un yard = un seul chantier ; un chantier = N yards. Source principale de la résolution facture ProGBat → chantier ; chantier_projets reste le repli quand la facture n''a pas de yardId.';

-- ─── Contrôle ──────────────────────────────────────────────────────────────
-- select chantier_id, count(*) from public.chantier_progbat_yards group by 1 order by 2 desc;
-- select * from public.chantier_progbat_yards order by progbat_yard_label;
