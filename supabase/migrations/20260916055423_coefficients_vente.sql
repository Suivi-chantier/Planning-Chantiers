-- ═══════════════════════════════════════════════════════════════════════════
-- Coefficients de VENTE (liste configurable, Réglages → Taux horaires).
--
-- Même architecture que taux_horaires_vente (20260915140000) : chaque ouvrage
-- de la bibliothèque référence UN coefficient (bibliotheque_ratios.coefficient_vente_id)
-- appliqué aux matériaux et au coût direct complémentaire (formule v2 conservée) :
--   prix = coût matériaux × coefficient + coût direct × coefficient
--          + cadence × taux horaire de vente
--
-- Garanties :
--   • libellé non vide, valeur numeric(8,4) > 0 (1,25 / 1,50 / 1,675 exacts) ;
--   • un seul coefficient par défaut (index unique partiel), toujours actif ;
--   • le défaut ne peut être ni désactivé ni supprimé ; bascule atomique par la
--     RPC definir_coefficient_vente_defaut ; au moins un coefficient actif ;
--   • aucun coefficient référencé n'est supprimable (FK RESTRICT + trigger) ;
--   • un ouvrage ne peut recevoir qu'un coefficient existant ET actif ; il
--     conserve son coefficient si celui-ci est désactivé ensuite ;
--   • TOUS les ouvrages existants sont rattachés au « Coefficient standard »
--     (1,50), y compris ceux qui portaient un coef_vente différent ; colonne NOT NULL ;
--   • bibliotheque_ratios.coef_vente et taux_marge_pct deviennent OBSOLÈTES :
--     laissées en place (aucune donnée modifiée) mais figées par trigger — plus
--     aucune écriture possible, donc plus de seconde source de vérité. Suppression
--     physique à prévoir dans une migration ultérieure dédiée.
--   • RLS : lecture bureau (non ouvrier), écriture is_admin(), aucune suppression client.
--   • Aucune ligne de chiffrage n'est recalculée : profero_ouvrages_selectionnes
--     reçoit seulement une colonne additive coefficient_vente_id (la valeur figée
--     reste dans la colonne existante coef_vente).
--
-- Idempotente et SANS PERTE.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1) Table ──────────────────────────────────────────────────────────────
create table if not exists public.coefficients_vente (
  id                uuid primary key default gen_random_uuid(),
  libelle           text not null,
  valeur            numeric(8,4) not null,                -- ex : 1.5000, 1.6750 (exact, pas de flottant)
  est_defaut        boolean not null default false,
  actif             boolean not null default true,
  created_by_email  text default auth.email(),
  updated_by_email  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint coefficients_vente_libelle_check check (length(btrim(libelle)) > 0),
  constraint coefficients_vente_valeur_check check (valeur > 0),
  constraint coefficients_vente_defaut_actif_check check (not est_defaut or actif)
);

comment on table public.coefficients_vente is
  'Coefficients de vente proposés dans la fiche ouvrage : prix matériaux = coût matériaux × coefficient (idem coût direct complémentaire). Un seul défaut, toujours actif.';

create unique index if not exists coefficients_vente_un_seul_defaut_uidx
  on public.coefficients_vente (est_defaut) where est_defaut;
create unique index if not exists coefficients_vente_libelle_uidx
  on public.coefficients_vente (lower(btrim(libelle)));
create index if not exists coefficients_vente_actif_idx
  on public.coefficients_vente (actif, libelle);

-- ─── 2) Garde-fous (trigger) ───────────────────────────────────────────────
create or replace function public.coefficients_vente_garde()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  basculement boolean := coalesce(current_setting('profero.coef_defaut_basculement', true), '') = '1';
begin
  if tg_op = 'DELETE' then
    if old.est_defaut then
      raise exception 'Le coefficient par défaut ne peut pas être supprimé.';
    end if;
    if exists (select 1 from public.bibliotheque_ratios where coefficient_vente_id = old.id)
       or exists (select 1 from public.profero_ouvrages_selectionnes where coefficient_vente_id = old.id) then
      raise exception 'Ce coefficient est utilisé par des ouvrages ou des chiffrages : il ne peut pas être supprimé, seulement désactivé.';
    end if;
    return old;
  end if;

  new.libelle := btrim(new.libelle);
  new.updated_at := now();
  new.updated_by_email := coalesce(auth.email(), new.updated_by_email);

  if tg_op = 'UPDATE' then
    if old.est_defaut and not new.est_defaut and not basculement then
      raise exception 'Choisir d''abord un autre coefficient actif comme coefficient par défaut.';
    end if;
    if old.actif and not new.actif and old.est_defaut then
      raise exception 'Le coefficient par défaut ne peut pas être désactivé : définir d''abord un autre coefficient actif par défaut.';
    end if;
    if old.actif and not new.actif
       and not exists (select 1 from public.coefficients_vente where actif and id <> old.id) then
      raise exception 'Il doit rester au moins un coefficient de vente actif.';
    end if;
  end if;
  if new.est_defaut and not new.actif then
    raise exception 'Un coefficient désactivé ne peut pas être le coefficient par défaut.';
  end if;
  return new;
end;
$$;

revoke execute on function public.coefficients_vente_garde() from public, anon, authenticated;
drop trigger if exists coefficients_vente_garde_trg on public.coefficients_vente;
create trigger coefficients_vente_garde_trg
  before insert or update or delete on public.coefficients_vente
  for each row execute function public.coefficients_vente_garde();

-- ─── 3) Bascule atomique du coefficient par défaut ─────────────────────────
-- SECURITY INVOKER : la RLS s'applique à l'appelant ; un non-administrateur ne
-- modifie aucune ligne ⇒ « Modification refusée ».
create or replace function public.definir_coefficient_vente_defaut(p_id uuid)
returns public.coefficients_vente
language plpgsql
security invoker
set search_path = public
as $$
declare
  cible public.coefficients_vente;
  n integer;
begin
  select * into cible from public.coefficients_vente where id = p_id;
  if not found then
    raise exception 'Coefficient de vente introuvable.';
  end if;
  if not cible.actif then
    raise exception 'Un coefficient désactivé ne peut pas devenir le coefficient par défaut : le réactiver d''abord.';
  end if;
  if cible.est_defaut then
    return cible;
  end if;
  perform set_config('profero.coef_defaut_basculement', '1', true);
  update public.coefficients_vente set est_defaut = false where est_defaut and id <> p_id;
  update public.coefficients_vente set est_defaut = true where id = p_id returning * into cible;
  get diagnostics n = row_count;   -- lu AVANT le PERFORM suivant (qui remettrait FOUND à vrai)
  perform set_config('profero.coef_defaut_basculement', '0', true);
  if n <> 1 then
    raise exception 'Modification refusée : réservée aux administrateurs.';
  end if;
  return cible;
end;
$$;

revoke all on function public.definir_coefficient_vente_defaut(uuid) from public, anon;
grant execute on function public.definir_coefficient_vente_defaut(uuid) to authenticated;

-- ─── 4) Coefficient initial : « Coefficient standard — 1,50 », actif et par défaut ─
insert into public.coefficients_vente (libelle, valeur, est_defaut, actif)
select 'Coefficient standard', 1.5000, true, true
where not exists (select 1 from public.coefficients_vente);

update public.coefficients_vente
   set est_defaut = true
 where id = (select id from public.coefficients_vente where actif order by created_at, libelle limit 1)
   and not exists (select 1 from public.coefficients_vente where est_defaut);

-- ─── 5) Bibliothèque d'ouvrages : référence vers le coefficient ────────────
alter table public.bibliotheque_ratios
  add column if not exists coefficient_vente_id uuid references public.coefficients_vente(id) on delete restrict;

comment on column public.bibliotheque_ratios.coefficient_vente_id is
  'Coefficient de vente appliqué aux matériaux (et au coût direct complémentaire) de l''ouvrage. Référence stable : jamais la valeur. Remplace coef_vente (obsolète).';

create or replace function public.bibliotheque_ratios_coefficient_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.coefficients_vente;
begin
  if new.coefficient_vente_id is null then
    if tg_op = 'UPDATE' and old.coefficient_vente_id is not null then
      raise exception 'Coefficient de vente obligatoire : sélectionner un coefficient dans la liste.';
    end if;
    select id into new.coefficient_vente_id
      from public.coefficients_vente where est_defaut and actif limit 1;
    if new.coefficient_vente_id is null then
      raise exception 'Aucun coefficient de vente actif par défaut : en définir un dans Réglages → Taux horaires.';
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' or new.coefficient_vente_id is distinct from old.coefficient_vente_id then
    select * into c from public.coefficients_vente where id = new.coefficient_vente_id;
    if not found then
      raise exception 'Coefficient de vente inexistant (%).', new.coefficient_vente_id;
    end if;
    if not c.actif then
      raise exception 'Le coefficient « % » est désactivé : choisir un coefficient actif.', c.libelle;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.bibliotheque_ratios_coefficient_garde() from public, anon, authenticated;
drop trigger if exists bibliotheque_ratios_coefficient_garde_trg on public.bibliotheque_ratios;
create trigger bibliotheque_ratios_coefficient_garde_trg
  before insert or update of coefficient_vente_id on public.bibliotheque_ratios
  for each row execute function public.bibliotheque_ratios_coefficient_garde();

-- Reprise IMPÉRATIVE : tous les ouvrages → coefficient standard 1,50, y compris
-- ceux qui portaient un coef_vente différent (ils sont remplacés pour les futurs
-- calculs ; les snapshots déjà figés ne bougent pas). Aucune autre colonne touchée.
update public.bibliotheque_ratios
   set coefficient_vente_id = (select id from public.coefficients_vente where est_defaut and actif limit 1)
 where coefficient_vente_id is null;

do $$
declare n integer;
begin
  select count(*) into n from public.bibliotheque_ratios where coefficient_vente_id is null;
  if n > 0 then raise exception 'Reprise incomplète : % ouvrage(s) sans coefficient', n; end if;
end $$;

alter table public.bibliotheque_ratios
  alter column coefficient_vente_id set not null;

create index if not exists bibliotheque_ratios_coefficient_vente_idx
  on public.bibliotheque_ratios (coefficient_vente_id);

-- ─── 6) Colonnes obsolètes figées : coef_vente et taux_marge_pct ───────────
-- Les valeurs existantes sont conservées (audit) mais plus aucune écriture n'est
-- acceptée : le coefficient se choisit UNIQUEMENT par coefficient_vente_id et la
-- marge est dérivée du prix. Suppression des colonnes dans une migration ultérieure.
create or replace function public.bibliotheque_ratios_colonnes_obsoletes_garde()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.coef_vente is not null or new.taux_marge_pct is not null then
      raise exception 'Colonnes obsolètes : le coefficient se choisit via coefficient_vente_id (coef_vente / taux_marge_pct ne sont plus enregistrés).';
    end if;
  elsif new.coef_vente is distinct from old.coef_vente or new.taux_marge_pct is distinct from old.taux_marge_pct then
    raise exception 'Colonnes obsolètes : coef_vente et taux_marge_pct ne sont plus modifiables, utiliser coefficient_vente_id.';
  end if;
  return new;
end;
$$;

revoke execute on function public.bibliotheque_ratios_colonnes_obsoletes_garde() from public, anon, authenticated;
drop trigger if exists bibliotheque_ratios_colonnes_obsoletes_garde_trg on public.bibliotheque_ratios;
create trigger bibliotheque_ratios_colonnes_obsoletes_garde_trg
  before insert or update of coef_vente, taux_marge_pct on public.bibliotheque_ratios
  for each row execute function public.bibliotheque_ratios_colonnes_obsoletes_garde();

comment on column public.bibliotheque_ratios.coef_vente is
  'OBSOLÈTE depuis le 16/09/2026 (figée par trigger, lecture seule) : remplacée par coefficient_vente_id → coefficients_vente.valeur. À supprimer dans une migration ultérieure.';
comment on column public.bibliotheque_ratios.taux_marge_pct is
  'OBSOLÈTE depuis le 16/09/2026 (figée par trigger, lecture seule) : la marge est dérivée du prix de vente et du coût. À supprimer dans une migration ultérieure.';

-- ─── 7) Lignes de chiffrage : identifiant du coefficient figé ──────────────
-- La VALEUR figée reste dans la colonne existante coef_vente (déjà écrite par les
-- snapshots) ; on ajoute seulement l'identifiant. Les lignes existantes ne changent pas.
alter table public.profero_ouvrages_selectionnes
  add column if not exists coefficient_vente_id uuid references public.coefficients_vente(id) on delete set null;

create index if not exists profero_ouvrages_selectionnes_coefficient_vente_idx
  on public.profero_ouvrages_selectionnes (coefficient_vente_id) where coefficient_vente_id is not null;

comment on column public.profero_ouvrages_selectionnes.coef_vente is
  'Coefficient de vente FIGÉ à l''ajout de la ligne (valeur numérique réellement utilisée). Jamais recalculé.';
comment on column public.profero_ouvrages_selectionnes.coefficient_vente_id is
  'Coefficient de vente (coefficients_vente) utilisé à l''ajout de la ligne : traçabilité ; la valeur figée reste coef_vente.';

-- ─── 8) RLS ────────────────────────────────────────────────────────────────
alter table public.coefficients_vente enable row level security;
revoke all on table public.coefficients_vente from anon;
grant select, insert, update on table public.coefficients_vente to authenticated;
revoke delete on table public.coefficients_vente from authenticated;

drop policy if exists coefficients_vente_bureau_select on public.coefficients_vente;
create policy coefficients_vente_bureau_select on public.coefficients_vente
  for select to authenticated using (not est_ouvrier());
drop policy if exists coefficients_vente_admin_insert on public.coefficients_vente;
create policy coefficients_vente_admin_insert on public.coefficients_vente
  for insert to authenticated with check (is_admin());
drop policy if exists coefficients_vente_admin_update on public.coefficients_vente;
create policy coefficients_vente_admin_update on public.coefficients_vente
  for update to authenticated using (is_admin()) with check (is_admin());
-- Aucune policy DELETE : suppression impossible depuis le navigateur.

-- ─── 9) Realtime ───────────────────────────────────────────────────────────
do $$
begin
  alter publication supabase_realtime add table public.coefficients_vente;
exception when others then null;
end $$;

-- ─── 10) Contrôle ──────────────────────────────────────────────────────────
-- select libelle, valeur, est_defaut, actif from public.coefficients_vente;
-- select count(*) filter (where coefficient_vente_id is null) sans_coef, count(*) total from public.bibliotheque_ratios;
