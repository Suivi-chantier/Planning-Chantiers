-- ============================================================================
-- Multi-ouvrages dans le chiffrage (21/10/2026).
--
-- Un multi-ouvrage regroupe plusieurs lignes d'UNE zone d'un chiffrage en UNE
-- ligne de devis (ex. « Fourniture et mise en place d'une salle de bain
-- type »). C'est une ENVELOPPE D'AFFICHAGE : les ouvrages regroupés restent
-- des lignes normales de profero_ouvrages_selectionnes (quantités, lots,
-- snapshots, coûts inchangés). Aucune ligne « parent » n'est créée dans
-- profero_ouvrages_selectionnes : rien ne peut compter le multi-ouvrage deux fois.
--
-- Le PRIX du multi-ouvrage n'est jamais stocké : il est calculé par
-- src/Renovation/chiffragePricing.mjs (somme des totaux HT des lignes
-- regroupées + ajustement_ht).
--
-- Contenu :
--   1. table profero_multi_ouvrages (RLS bureau + collaborateurs, temps réel) ;
--   2. colonne profero_ouvrages_selectionnes.multi_ouvrage_id (FK set null) ;
--   3. garde : une ligne regroupée appartient au même projet et à la même
--      zone que son multi-ouvrage ;
--   4. RPC creer_multi_ouvrage : création + rattachement des lignes en une
--      seule transaction (pas de multi-ouvrage vide si le rattachement échoue).
--
-- Additive : ne modifie aucune donnée existante, aucune policy existante.
-- Les 965 lignes actuelles gardent multi_ouvrage_id = null : planning,
-- phasage, commandes et états financiers les lisent exactement comme avant.
-- Rejouable.
-- RETOUR ARRIÈRE : sql/202610_multi_ouvrages_chiffrage_rollback.sql
-- VÉRIFICATION  : node scripts/verif-multi-ouvrages.mjs
-- ============================================================================

-- ── 1. Table des multi-ouvrages ─────────────────────────────────────────────
create table if not exists public.profero_multi_ouvrages (
  id                   uuid primary key default gen_random_uuid(),
  projet_id            uuid not null references public.profero_projets(id) on delete cascade,
  libelle_commercial   text not null check (btrim(libelle_commercial) <> ''),
  -- Lot sous lequel la ligne est rangée dans le devis. Rangement UNIQUEMENT :
  -- chaque ligne regroupée garde son propre lot (category) pour le planning.
  lot_affichage        text not null check (btrim(lot_affichage) <> ''),
  zone                 text not null check (btrim(zone) <> ''),
  principal_ligne_id   uuid,
  -- Ajustement HT (positif ou négatif) pour obtenir un prix rond. Visible dans
  -- la marge interne, jamais sur le devis client.
  ajustement_ht        numeric not null default 0,
  ordre                integer,
  -- Ouvrage ProGBat « MULTI-… » utilisé au dernier export, et empreinte de la
  -- composition (liste triée progbat_id + quantité). Écrits par l'Edge
  -- Function progbat-quote uniquement.
  progbat_structure_id text,
  progbat_signature    text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- La FK vers la ligne principale est posée après la création de la colonne
-- multi_ouvrage_id (les deux tables se référencent).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profero_multi_ouvrages_principal_fk') then
    alter table public.profero_multi_ouvrages
      add constraint profero_multi_ouvrages_principal_fk
      foreign key (principal_ligne_id) references public.profero_ouvrages_selectionnes(id) on delete set null;
  end if;
end $$;

create index if not exists profero_multi_ouvrages_projet_idx on public.profero_multi_ouvrages (projet_id);
create index if not exists profero_multi_ouvrages_signature_idx on public.profero_multi_ouvrages (progbat_signature) where progbat_signature is not null;

drop trigger if exists profero_multi_ouvrages_updated_at on public.profero_multi_ouvrages;
create trigger profero_multi_ouvrages_updated_at
  before update on public.profero_multi_ouvrages
  for each row execute function public.set_updated_at();

alter table public.profero_multi_ouvrages enable row level security;

-- Mêmes règles que les autres tables du chiffrage (profero_ouvrages_selectionnes).
drop policy if exists bureau_all on public.profero_multi_ouvrages;
create policy bureau_all on public.profero_multi_ouvrages
  as permissive for all to authenticated
  using (not public.est_ouvrier()) with check (not public.est_ouvrier());

drop policy if exists profero_collaborateurs_seulement on public.profero_multi_ouvrages;
create policy profero_collaborateurs_seulement on public.profero_multi_ouvrages
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profero_multi_ouvrages') then
    alter publication supabase_realtime add table public.profero_multi_ouvrages;
  end if;
end $$;

-- ── 2. Rattachement d'une ligne ─────────────────────────────────────────────
alter table public.profero_ouvrages_selectionnes
  add column if not exists multi_ouvrage_id uuid references public.profero_multi_ouvrages(id) on delete set null;

create index if not exists profero_ouvrages_selectionnes_multi_idx
  on public.profero_ouvrages_selectionnes (multi_ouvrage_id) where multi_ouvrage_id is not null;

-- ── 3. Garde : même projet, même zone ───────────────────────────────────────
-- Zone vide d'une ligne = « Logement entier » (ZONE_DEFAUT de chiffragePricing.mjs).
create or replace function public.profero_ligne_multi_garde()
returns trigger language plpgsql set search_path = public as $$
declare
  m record;
begin
  if new.multi_ouvrage_id is null then return new; end if;
  select projet_id, zone into m from public.profero_multi_ouvrages where id = new.multi_ouvrage_id;
  if not found then
    raise exception 'Multi-ouvrage introuvable' using errcode = '23503';
  end if;
  if m.projet_id is distinct from new.projet_id then
    raise exception 'Un ouvrage ne peut être regroupé que dans un multi-ouvrage de son propre chiffrage' using errcode = '23514';
  end if;
  if coalesce(nullif(btrim(new.zone), ''), 'Logement entier') <> btrim(m.zone) then
    raise exception 'Un ouvrage regroupé doit rester dans la zone « % » de son multi-ouvrage : le retirer du multi-ouvrage avant de changer sa zone', m.zone using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists profero_ligne_multi_garde on public.profero_ouvrages_selectionnes;
create trigger profero_ligne_multi_garde
  before insert or update of multi_ouvrage_id, zone, projet_id on public.profero_ouvrages_selectionnes
  for each row execute function public.profero_ligne_multi_garde();

-- ── 4. Création atomique ────────────────────────────────────────────────────
-- SECURITY INVOKER : la RLS de l'appelant s'applique (bureau collaborateur).
-- Refuse : moins de 2 lignes, ligne d'un autre projet ou d'une autre zone,
-- ligne déjà regroupée, TVA différentes, principal hors sélection.
create or replace function public.creer_multi_ouvrage(
  p_projet_id uuid,
  p_libelle_commercial text,
  p_lot_affichage text,
  p_zone text,
  p_principal_ligne_id uuid,
  p_ligne_ids uuid[]
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_nb int;
  v_zone text := btrim(coalesce(p_zone, ''));
  v_tva_projet numeric;
  v_nb_tva int;
  v_id uuid;
  v_ordre int;
begin
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_ligne_ids, '{}'::uuid[])) as x where x is not null;
  if coalesce(array_length(v_ids, 1), 0) < 2 then
    raise exception 'Un multi-ouvrage regroupe au moins 2 ouvrages' using errcode = '22023';
  end if;
  if btrim(coalesce(p_libelle_commercial, '')) = '' then
    raise exception 'Libellé commercial obligatoire' using errcode = '22023';
  end if;
  if btrim(coalesce(p_lot_affichage, '')) = '' then
    raise exception 'Lot d''affichage obligatoire' using errcode = '22023';
  end if;
  if v_zone = '' then
    raise exception 'Zone obligatoire' using errcode = '22023';
  end if;
  if p_principal_ligne_id is null or not (p_principal_ligne_id = any(v_ids)) then
    raise exception 'L''ouvrage principal doit faire partie des ouvrages regroupés' using errcode = '22023';
  end if;

  -- Verrou des lignes visées : deux regroupements simultanés ne peuvent pas
  -- prendre la même ligne.
  perform 1 from public.profero_ouvrages_selectionnes where id = any(v_ids) for update;

  select count(*) into v_nb from public.profero_ouvrages_selectionnes
   where id = any(v_ids) and projet_id = p_projet_id;
  if v_nb <> array_length(v_ids, 1) then
    raise exception 'Certains ouvrages n''appartiennent pas à ce chiffrage' using errcode = '22023';
  end if;
  if exists (select 1 from public.profero_ouvrages_selectionnes
              where id = any(v_ids) and coalesce(nullif(btrim(zone), ''), 'Logement entier') <> v_zone) then
    raise exception 'Seuls les ouvrages de la zone « % » peuvent être regroupés ensemble', v_zone using errcode = '22023';
  end if;
  if exists (select 1 from public.profero_ouvrages_selectionnes where id = any(v_ids) and multi_ouvrage_id is not null) then
    raise exception 'Un ouvrage sélectionné appartient déjà à un multi-ouvrage' using errcode = '22023';
  end if;

  select tva_pct into v_tva_projet from public.profero_projets where id = p_projet_id;
  select count(distinct coalesce(tva_pct, v_tva_projet)) into v_nb_tva
    from public.profero_ouvrages_selectionnes where id = any(v_ids);
  if v_nb_tva > 1 then
    raise exception 'Les ouvrages sélectionnés n''ont pas le même taux de TVA : une ligne de devis n''a qu''un taux' using errcode = '22023';
  end if;

  select coalesce(max(ordre), -1) + 1 into v_ordre from public.profero_multi_ouvrages where projet_id = p_projet_id and zone = v_zone;

  insert into public.profero_multi_ouvrages (projet_id, libelle_commercial, lot_affichage, zone, principal_ligne_id, ordre)
  values (p_projet_id, btrim(p_libelle_commercial), btrim(p_lot_affichage), v_zone, p_principal_ligne_id, v_ordre)
  returning id into v_id;

  update public.profero_ouvrages_selectionnes set multi_ouvrage_id = v_id where id = any(v_ids);
  return v_id;
end $$;

revoke all on function public.creer_multi_ouvrage(uuid, text, text, text, uuid, uuid[]) from public, anon;
grant execute on function public.creer_multi_ouvrage(uuid, text, text, text, uuid, uuid[]) to authenticated;
