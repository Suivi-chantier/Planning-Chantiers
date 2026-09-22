-- ═══════════════════════════════════════════════════════════════════════════
-- Taux horaires de VENTE de main-d'œuvre (liste configurable, Réglages → Taux).
--
-- Remplace l'unique taux global par une liste : chaque ouvrage de la
-- bibliothèque référence UN taux (bibliotheque_ratios.taux_horaire_vente_id) et
-- le prix de la main-d'œuvre devient cadence (h/u) × taux HT/h sélectionné.
-- Le coefficient de vente ne s'applique plus qu'aux matériaux (+ coût direct
-- complémentaire, traitement inchangé). Formule complète : chiffragePricing.mjs.
--
-- Nom volontairement distinct de planning_config.taux_horaires (coût horaire
-- RÉEL par ouvrier, pointages) et de taux_mo_previsionnel (coût horaire chargé
-- de référence, conservé pour le calcul de la MARGE).
--
-- Garanties :
--   • libellé non vide, taux_ht numeric(10,2) > 0 (pas de flottant) ;
--   • un seul taux par défaut (index unique partiel), toujours actif (check) ;
--   • le taux par défaut ne peut être ni désactivé ni supprimé ; il ne peut
--     perdre son statut que par la RPC definir_taux_horaire_vente_defaut (bascule
--     atomique vers un autre taux actif) ;
--   • il reste toujours au moins un taux actif ;
--   • aucun taux référencé n'est supprimable (FK RESTRICT + trigger) ;
--   • un ouvrage ne peut recevoir qu'un taux existant ET actif ; un ouvrage
--     conserve son taux si celui-ci est désactivé ensuite ;
--   • tout ouvrage existant est rattaché au taux standard (80 €/h) ; un ouvrage
--     inséré sans taux reçoit le taux par défaut (trigger) ; colonne NOT NULL.
--   • RLS : lecture bureau (non ouvrier, nécessaire au calcul), écriture
--     is_admin() — mêmes rôles que la page Réglages ; aucune suppression client.
--
-- Idempotente et SANS PERTE : aucune ligne de chiffrage n'est recalculée.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1) Table ──────────────────────────────────────────────────────────────
create table if not exists public.taux_horaires_vente (
  id                uuid primary key default gen_random_uuid(),
  libelle           text not null,
  taux_ht           numeric(10,2) not null,               -- € HT par heure, 2 décimales exactes
  est_defaut        boolean not null default false,
  actif             boolean not null default true,
  created_by_email  text default auth.email(),            -- utilisateurs.email de l'auteur (null = migration)
  updated_by_email  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint taux_horaires_vente_libelle_check check (length(btrim(libelle)) > 0),
  constraint taux_horaires_vente_taux_ht_check check (taux_ht > 0),
  constraint taux_horaires_vente_defaut_actif_check check (not est_defaut or actif)
);

comment on table public.taux_horaires_vente is
  'Taux horaires de vente de main-d''œuvre (€ HT/h) proposés dans la fiche ouvrage. Prix MO = cadence × taux. Un seul taux par défaut, toujours actif.';

-- Un seul taux par défaut (toutes les lignes est_defaut = true partagent la même valeur ⇒ une seule autorisée)
create unique index if not exists taux_horaires_vente_un_seul_defaut_uidx
  on public.taux_horaires_vente (est_defaut) where est_defaut;
-- Libellés distincts (insensible à la casse et aux espaces)
create unique index if not exists taux_horaires_vente_libelle_uidx
  on public.taux_horaires_vente (lower(btrim(libelle)));
create index if not exists taux_horaires_vente_actif_idx
  on public.taux_horaires_vente (actif, libelle);

-- ─── 2) Garde-fous (trigger) ───────────────────────────────────────────────
create or replace function public.taux_horaires_vente_garde()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  basculement boolean := coalesce(current_setting('profero.taux_defaut_basculement', true), '') = '1';
begin
  if tg_op = 'DELETE' then
    if old.est_defaut then
      raise exception 'Le taux par défaut ne peut pas être supprimé.';
    end if;
    if exists (select 1 from public.bibliotheque_ratios where taux_horaire_vente_id = old.id)
       or exists (select 1 from public.profero_ouvrages_selectionnes where taux_horaire_vente_id = old.id) then
      raise exception 'Ce taux est utilisé par des ouvrages ou des chiffrages : il ne peut pas être supprimé, seulement désactivé.';
    end if;
    return old;
  end if;

  new.libelle := btrim(new.libelle);
  new.updated_at := now();
  new.updated_by_email := coalesce(auth.email(), new.updated_by_email);

  if tg_op = 'UPDATE' then
    if old.est_defaut and not new.est_defaut and not basculement then
      raise exception 'Choisir d''abord un autre taux actif comme taux par défaut.';
    end if;
    if old.actif and not new.actif and old.est_defaut then
      raise exception 'Le taux par défaut ne peut pas être désactivé : définir d''abord un autre taux actif par défaut.';
    end if;
    if old.actif and not new.actif
       and not exists (select 1 from public.taux_horaires_vente where actif and id <> old.id) then
      raise exception 'Il doit rester au moins un taux horaire actif.';
    end if;
  end if;
  if new.est_defaut and not new.actif then
    raise exception 'Un taux désactivé ne peut pas être le taux par défaut.';
  end if;
  return new;
end;
$$;

revoke execute on function public.taux_horaires_vente_garde() from public, anon, authenticated;
drop trigger if exists taux_horaires_vente_garde_trg on public.taux_horaires_vente;
create trigger taux_horaires_vente_garde_trg
  before insert or update or delete on public.taux_horaires_vente
  for each row execute function public.taux_horaires_vente_garde();

-- ─── 3) Bascule atomique du taux par défaut ────────────────────────────────
-- SECURITY INVOKER : la RLS s'applique à l'appelant. Un non-administrateur ne
-- met à jour aucune ligne ⇒ « Modification refusée », rien n'est changé.
create or replace function public.definir_taux_horaire_vente_defaut(p_id uuid)
returns public.taux_horaires_vente
language plpgsql
security invoker
set search_path = public
as $$
declare
  cible public.taux_horaires_vente;
  n integer;
begin
  select * into cible from public.taux_horaires_vente where id = p_id;
  if not found then
    raise exception 'Taux horaire introuvable.';
  end if;
  if not cible.actif then
    raise exception 'Un taux désactivé ne peut pas devenir le taux par défaut : le réactiver d''abord.';
  end if;
  if cible.est_defaut then
    return cible;
  end if;
  perform set_config('profero.taux_defaut_basculement', '1', true);
  update public.taux_horaires_vente set est_defaut = false where est_defaut and id <> p_id;
  update public.taux_horaires_vente set est_defaut = true where id = p_id returning * into cible;
  get diagnostics n = row_count;   -- lu AVANT le PERFORM suivant (qui remettrait FOUND à vrai)
  perform set_config('profero.taux_defaut_basculement', '0', true);
  if n <> 1 then
    raise exception 'Modification refusée : réservée aux administrateurs.';
  end if;
  return cible;
end;
$$;

revoke all on function public.definir_taux_horaire_vente_defaut(uuid) from public, anon;
grant execute on function public.definir_taux_horaire_vente_defaut(uuid) to authenticated;

-- ─── 4) Taux initial : « Taux standard — 80,00 € HT/h », actif et par défaut ─
insert into public.taux_horaires_vente (libelle, taux_ht, est_defaut, actif)
select 'Taux standard', 80.00, true, true
where not exists (select 1 from public.taux_horaires_vente);

-- Repassage : si la table existait sans taux par défaut, le plus ancien taux actif le devient.
update public.taux_horaires_vente
   set est_defaut = true
 where id = (select id from public.taux_horaires_vente where actif order by created_at, libelle limit 1)
   and not exists (select 1 from public.taux_horaires_vente where est_defaut);

-- ─── 5) Bibliothèque d'ouvrages : référence vers le taux ───────────────────
alter table public.bibliotheque_ratios
  add column if not exists taux_horaire_vente_id uuid references public.taux_horaires_vente(id) on delete restrict;

comment on column public.bibliotheque_ratios.taux_horaire_vente_id is
  'Taux horaire de vente appliqué à la main-d''œuvre de l''ouvrage (prix MO = cadence × taux_ht). Référence stable : jamais la valeur.';

-- Contrôle à l'écriture : taux existant et actif quand il est choisi ou changé ;
-- un ouvrage inséré sans taux reçoit le taux par défaut ; un ouvrage garde son
-- taux (même désactivé ensuite) tant qu'il n'en change pas.
create or replace function public.bibliotheque_ratios_taux_horaire_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.taux_horaires_vente;
begin
  if new.taux_horaire_vente_id is null then
    if tg_op = 'UPDATE' and old.taux_horaire_vente_id is not null then
      raise exception 'Taux horaire de main-d''œuvre obligatoire : sélectionner un taux dans la liste.';
    end if;
    select id into new.taux_horaire_vente_id
      from public.taux_horaires_vente where est_defaut and actif limit 1;
    if new.taux_horaire_vente_id is null then
      raise exception 'Aucun taux horaire actif par défaut : en définir un dans Réglages → Taux horaires.';
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' or new.taux_horaire_vente_id is distinct from old.taux_horaire_vente_id then
    select * into t from public.taux_horaires_vente where id = new.taux_horaire_vente_id;
    if not found then
      raise exception 'Taux horaire inexistant (%).', new.taux_horaire_vente_id;
    end if;
    if not t.actif then
      raise exception 'Le taux horaire « % » est désactivé : choisir un taux actif.', t.libelle;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.bibliotheque_ratios_taux_horaire_garde() from public, anon, authenticated;
drop trigger if exists bibliotheque_ratios_taux_horaire_garde_trg on public.bibliotheque_ratios;
create trigger bibliotheque_ratios_taux_horaire_garde_trg
  before insert or update of taux_horaire_vente_id on public.bibliotheque_ratios
  for each row execute function public.bibliotheque_ratios_taux_horaire_garde();

-- Reprise : TOUS les ouvrages existants sans taux → taux par défaut (80 €/h).
-- Aucune autre colonne n'est touchée (le trigger ne se déclenche que sur cette colonne).
update public.bibliotheque_ratios
   set taux_horaire_vente_id = (select id from public.taux_horaires_vente where est_defaut and actif limit 1)
 where taux_horaire_vente_id is null;

alter table public.bibliotheque_ratios
  alter column taux_horaire_vente_id set not null;

create index if not exists bibliotheque_ratios_taux_horaire_vente_idx
  on public.bibliotheque_ratios (taux_horaire_vente_id);

-- ─── 6) Lignes de chiffrage : taux figé (identifiant + valeur) ─────────────
-- Colonnes additives, laissées NULL sur les lignes existantes : rien n'est recalculé.
alter table public.profero_ouvrages_selectionnes
  add column if not exists taux_horaire_vente_id uuid references public.taux_horaires_vente(id) on delete set null,
  add column if not exists taux_horaire_vente    numeric(10,2);   -- € HT/h utilisé au moment du figeage

create index if not exists profero_ouvrages_selectionnes_taux_horaire_vente_idx
  on public.profero_ouvrages_selectionnes (taux_horaire_vente_id) where taux_horaire_vente_id is not null;

comment on column public.profero_ouvrages_selectionnes.taux_horaire_vente is
  'Taux horaire de vente (€ HT/h) figé à l''ajout de la ligne. Une modification ultérieure du taux dans Réglages ne le change jamais.';

-- ─── 7) RLS ────────────────────────────────────────────────────────────────
alter table public.taux_horaires_vente enable row level security;
revoke all on table public.taux_horaires_vente from anon;
grant select, insert, update on table public.taux_horaires_vente to authenticated;
revoke delete on table public.taux_horaires_vente from authenticated;

drop policy if exists taux_horaires_vente_bureau_select on public.taux_horaires_vente;
create policy taux_horaires_vente_bureau_select on public.taux_horaires_vente
  for select to authenticated using (not est_ouvrier());
drop policy if exists taux_horaires_vente_admin_insert on public.taux_horaires_vente;
create policy taux_horaires_vente_admin_insert on public.taux_horaires_vente
  for insert to authenticated with check (is_admin());
drop policy if exists taux_horaires_vente_admin_update on public.taux_horaires_vente;
create policy taux_horaires_vente_admin_update on public.taux_horaires_vente
  for update to authenticated using (is_admin()) with check (is_admin());
-- Aucune policy DELETE : suppression impossible depuis le navigateur.

-- ─── 8) Realtime (la Bibliothèque et le Chiffrage se rafraîchissent) ───────
do $$
begin
  alter publication supabase_realtime add table public.taux_horaires_vente;
exception when others then null;
end $$;

-- ─── 9) Contrôle ───────────────────────────────────────────────────────────
-- select libelle, taux_ht, est_defaut, actif from public.taux_horaires_vente order by libelle;
-- select count(*) filter (where taux_horaire_vente_id is null) as sans_taux, count(*) as total from public.bibliotheque_ratios;
