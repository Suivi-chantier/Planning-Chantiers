-- ═══════════════════════════════════════════════════════════════════════════
-- Conditions de vente d'UNE LIGNE de chiffrage : coefficient et/ou taux horaire
-- propres à un seul ouvrage sélectionné, sans toucher aux autres lignes, aux
-- autres chiffrages ni à la bibliothèque.
--
-- Trois modes par paramètre et par ligne (mode_coefficient_ligne,
-- mode_taux_horaire_ligne), totalement indépendants l'un de l'autre :
--   heritage    → condition globale du chiffrage si elle existe, sinon ouvrage
--   ouvrage     → force le paramètre d'origine de l'ouvrage MÊME si un global existe
--   specifique  → valeur choisie dans les Réglages et FIGÉE sur la ligne
--
-- ORDRE DE PRIORITÉ (fonction conditions_ligne_resoudre, miroir exact de
-- resoudreParametreVente dans src/Renovation/chiffragePricing.mjs) :
--   1. dérogation de la ligne   2. condition globale   3. paramètre de l'ouvrage
--
-- Recalcul (formule v2, données FIGÉES de la ligne uniquement) :
--   prix matériaux  = round(coût matériaux figé × coefficient appliqué, 2)
--   prix coût direct= round(coût direct figé    × coefficient appliqué, 2)
--   prix MO         = round(cadence figée       × taux appliqué, 2)
--   prix unitaire   = round(somme, 2)
-- Le coefficient ne touche JAMAIS la main-d'œuvre, le taux JAMAIS les matériaux.
--
-- Rien n'est jamais rechargé depuis la bibliothèque (coûts, cadence, matériaux,
-- quantité, unité, coefficient / taux actuels de l'ouvrage).
--
-- Idempotente et SANS PERTE : aucune ligne existante n'est modifiée.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1) Colonnes de ligne : mode + dérogation figée ────────────────────────
alter table public.profero_ouvrages_selectionnes
  add column if not exists mode_coefficient_ligne     text not null default 'heritage',
  add column if not exists coefficient_ligne_id       uuid references public.coefficients_vente(id) on delete restrict,
  add column if not exists coefficient_ligne_valeur   numeric(8,4),
  add column if not exists coefficient_ligne_libelle  text,
  add column if not exists mode_taux_horaire_ligne    text not null default 'heritage',
  add column if not exists taux_horaire_ligne_id      uuid references public.taux_horaires_vente(id) on delete restrict,
  add column if not exists taux_horaire_ligne_valeur  numeric(10,2),
  add column if not exists taux_horaire_ligne_libelle text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profero_ouvrages_selectionnes_mode_coefficient_ligne_check') then
    alter table public.profero_ouvrages_selectionnes add constraint profero_ouvrages_selectionnes_mode_coefficient_ligne_check
      check (mode_coefficient_ligne in ('heritage', 'ouvrage', 'specifique'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profero_ouvrages_selectionnes_mode_taux_ligne_check') then
    alter table public.profero_ouvrages_selectionnes add constraint profero_ouvrages_selectionnes_mode_taux_ligne_check
      check (mode_taux_horaire_ligne in ('heritage', 'ouvrage', 'specifique'));
  end if;
  -- specifique ⇒ identifiant ET valeur strictement positive obligatoires ;
  -- heritage / ouvrage ⇒ aucun champ de dérogation (pas de seconde vérité).
  if not exists (select 1 from pg_constraint where conname = 'profero_ouvrages_selectionnes_coefficient_ligne_coherence_check') then
    alter table public.profero_ouvrages_selectionnes add constraint profero_ouvrages_selectionnes_coefficient_ligne_coherence_check
      check ((mode_coefficient_ligne = 'specifique' and coefficient_ligne_id is not null and coefficient_ligne_valeur > 0)
          or (mode_coefficient_ligne in ('heritage', 'ouvrage') and coefficient_ligne_id is null and coefficient_ligne_valeur is null and coefficient_ligne_libelle is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profero_ouvrages_selectionnes_taux_ligne_coherence_check') then
    alter table public.profero_ouvrages_selectionnes add constraint profero_ouvrages_selectionnes_taux_ligne_coherence_check
      check ((mode_taux_horaire_ligne = 'specifique' and taux_horaire_ligne_id is not null and taux_horaire_ligne_valeur > 0)
          or (mode_taux_horaire_ligne in ('heritage', 'ouvrage') and taux_horaire_ligne_id is null and taux_horaire_ligne_valeur is null and taux_horaire_ligne_libelle is null));
  end if;
end $$;

-- La provenance de la valeur appliquée accepte désormais « ligne ».
alter table public.profero_ouvrages_selectionnes drop constraint if exists profero_ouvrages_selectionnes_coefficient_source_check;
alter table public.profero_ouvrages_selectionnes add constraint profero_ouvrages_selectionnes_coefficient_source_check
  check (coefficient_source is null or coefficient_source in ('ouvrage', 'global_chiffrage', 'ligne'));
alter table public.profero_ouvrages_selectionnes drop constraint if exists profero_ouvrages_selectionnes_taux_source_check;
alter table public.profero_ouvrages_selectionnes add constraint profero_ouvrages_selectionnes_taux_source_check
  check (taux_horaire_source is null or taux_horaire_source in ('ouvrage', 'global_chiffrage', 'ligne'));

create index if not exists profero_ouvrages_selectionnes_coefficient_ligne_idx on public.profero_ouvrages_selectionnes (coefficient_ligne_id) where coefficient_ligne_id is not null;
create index if not exists profero_ouvrages_selectionnes_taux_ligne_idx on public.profero_ouvrages_selectionnes (taux_horaire_ligne_id) where taux_horaire_ligne_id is not null;
-- Lignes dérogatoires d'un chiffrage (comptage dans la simulation globale)
create index if not exists profero_ouvrages_selectionnes_derogations_idx on public.profero_ouvrages_selectionnes (projet_id)
  where mode_coefficient_ligne <> 'heritage' or mode_taux_horaire_ligne <> 'heritage';

comment on column public.profero_ouvrages_selectionnes.mode_coefficient_ligne is 'heritage = condition globale du chiffrage sinon ouvrage ; ouvrage = force le coefficient d''origine de l''ouvrage ; specifique = coefficient_ligne_* (FIGÉ sur cette ligne).';
comment on column public.profero_ouvrages_selectionnes.mode_taux_horaire_ligne is 'heritage = condition globale du chiffrage sinon ouvrage ; ouvrage = force le taux d''origine de l''ouvrage ; specifique = taux_horaire_ligne_* (FIGÉ sur cette ligne).';
comment on column public.profero_ouvrages_selectionnes.coefficient_ligne_valeur is 'Coefficient FIGÉ sur la ligne (mode specifique) : une modification ultérieure dans les Réglages ne le change jamais.';
comment on column public.profero_ouvrages_selectionnes.taux_horaire_ligne_valeur is 'Taux horaire FIGÉ sur la ligne (mode specifique) : une modification ultérieure dans les Réglages ne le change jamais.';

-- ─── 2) Audit dédié aux changements de ligne ───────────────────────────────
create table if not exists public.chiffrage_ligne_conditions_historique (
  id                        uuid primary key default gen_random_uuid(),
  projet_id                 uuid not null references public.profero_projets(id) on delete cascade,
  ligne_id                  uuid,
  bibliotheque_id           uuid,
  item                      text,
  zone                      text,
  utilisateur_email         text,
  date                      timestamptz not null default now(),
  ancien_mode_coefficient   text,
  nouveau_mode_coefficient  text,
  ancien_coefficient_id     uuid,
  nouveau_coefficient_id    uuid,
  ancien_coefficient        numeric(8,4),
  nouveau_coefficient       numeric(8,4),
  ancien_coefficient_libelle text,
  nouveau_coefficient_libelle text,
  ancienne_source_coefficient text,
  nouvelle_source_coefficient text,
  ancien_mode_taux          text,
  nouveau_mode_taux         text,
  ancien_taux_id            uuid,
  nouveau_taux_id           uuid,
  ancien_taux               numeric(10,2),
  nouveau_taux              numeric(10,2),
  ancien_taux_libelle       text,
  nouveau_taux_libelle      text,
  ancienne_source_taux      text,
  nouvelle_source_taux      text,
  ancien_prix_unitaire      numeric(14,2),
  nouveau_prix_unitaire     numeric(14,2),
  ancienne_marge_pct        numeric(8,2),
  nouvelle_marge_pct        numeric(8,2),
  ancienne_marge_unitaire   numeric(14,2),
  nouvelle_marge_unitaire   numeric(14,2),
  prix_manuel_remplace      boolean not null default false,
  conversion_v1             boolean not null default false,
  ancienne_calcul_version   text,
  nouvelle_calcul_version   text,
  version_avant             integer,
  version_apres             integer
);
create index if not exists chiffrage_ligne_conditions_historique_projet_idx on public.chiffrage_ligne_conditions_historique (projet_id, date desc);
create index if not exists chiffrage_ligne_conditions_historique_ligne_idx on public.chiffrage_ligne_conditions_historique (ligne_id, date desc);
comment on table public.chiffrage_ligne_conditions_historique is 'Audit des changements de conditions de vente d''UNE ligne de chiffrage (écrit par appliquer_conditions_ligne). Jamais modifié ni supprimé depuis le navigateur.';

alter table public.chiffrage_ligne_conditions_historique enable row level security;
revoke all on table public.chiffrage_ligne_conditions_historique from anon;
grant select, insert on table public.chiffrage_ligne_conditions_historique to authenticated;
revoke update, delete on table public.chiffrage_ligne_conditions_historique from authenticated;
drop policy if exists chiffrage_ligne_conditions_historique_bureau_select on public.chiffrage_ligne_conditions_historique;
create policy chiffrage_ligne_conditions_historique_bureau_select on public.chiffrage_ligne_conditions_historique
  for select to authenticated using (not est_ouvrier());
drop policy if exists chiffrage_ligne_conditions_historique_bureau_insert on public.chiffrage_ligne_conditions_historique;
create policy chiffrage_ligne_conditions_historique_bureau_insert on public.chiffrage_ligne_conditions_historique
  for insert to authenticated with check (not est_ouvrier());

-- ─── 3) Résolveur : source UNIQUE de l'ordre de priorité ───────────────────
-- Miroir exact de resoudreParametreVente (src/Renovation/chiffragePricing.mjs).
create or replace function public.conditions_ligne_resoudre(
  p_mode text,
  p_spec_id uuid, p_spec_valeur numeric, p_spec_libelle text,
  p_glob_id uuid, p_glob_valeur numeric, p_glob_libelle text,
  p_orig_id uuid, p_orig_valeur numeric, p_orig_libelle text
) returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_mode text := coalesce(nullif(p_mode, ''), 'heritage');
  v_id uuid; v_valeur numeric; v_libelle text; v_source text;
begin
  if v_mode not in ('heritage', 'ouvrage', 'specifique') then v_mode := 'heritage'; end if;
  if v_mode = 'specifique' then
    v_source := 'ligne';
    if p_spec_valeur is not null and p_spec_valeur > 0 then
      v_id := p_spec_id; v_valeur := p_spec_valeur; v_libelle := p_spec_libelle;
    end if;
  elsif v_mode = 'ouvrage' then
    v_source := 'ouvrage';
    if p_orig_valeur is not null and p_orig_valeur > 0 then
      v_id := p_orig_id; v_valeur := p_orig_valeur; v_libelle := p_orig_libelle;
    end if;
  elsif p_glob_valeur is not null and p_glob_valeur > 0 then
    v_source := 'global_chiffrage';
    v_id := p_glob_id; v_valeur := p_glob_valeur; v_libelle := p_glob_libelle;
  else
    v_source := 'ouvrage';
    if p_orig_valeur is not null and p_orig_valeur > 0 then
      v_id := p_orig_id; v_valeur := p_orig_valeur; v_libelle := p_orig_libelle;
    end if;
  end if;
  return jsonb_build_object('mode', v_mode, 'valeur', v_valeur, 'source', v_source,
                            'id', v_id, 'libelle', v_libelle, 'valide', v_valeur is not null);
end;
$$;
revoke all on function public.conditions_ligne_resoudre(text, uuid, numeric, text, uuid, numeric, text, uuid, numeric, text) from public, anon;
grant execute on function public.conditions_ligne_resoudre(text, uuid, numeric, text, uuid, numeric, text, uuid, numeric, text) to authenticated;

-- ─── 4) Hash de l'état d'une ligne + des options demandées ─────────────────
-- Couvre : données figées de la ligne, prix actuel, modes actuels, paramètres
-- globaux du chiffrage, options demandées ET valeur/activité actuelles des
-- options dans les Réglages (une option désactivée après la simulation ou une
-- valeur modifiée entre-temps invalide la confirmation).
create or replace function public.conditions_ligne_hash(
  p_ligne_id uuid, p_mode_coefficient text, p_coefficient_id uuid, p_mode_taux text, p_taux_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select encode(sha256(convert_to(concat_ws('|',
    l.id::text, coalesce(l.prix_unitaire::text, ''), coalesce(l.calcul_version, ''), coalesce(l.quantite, ''),
    coalesce(l.cout_materiaux_unitaire::text, ''), coalesce(l.cout_direct_unitaire::text, ''), coalesce(l.cout_total_unitaire::text, ''),
    coalesce(l.calcul_detail->>'heures_unitaires', ''),
    coalesce(l.coef_vente::text, ''), coalesce(l.taux_horaire_vente::text, ''),
    coalesce(l.coefficient_source, ''), coalesce(l.taux_horaire_source, ''),
    coalesce(l.coefficient_origine_valeur::text, ''), coalesce(l.taux_horaire_origine_valeur::text, ''),
    l.mode_coefficient_ligne, coalesce(l.coefficient_ligne_id::text, ''), coalesce(l.coefficient_ligne_valeur::text, ''),
    l.mode_taux_horaire_ligne, coalesce(l.taux_horaire_ligne_id::text, ''), coalesce(l.taux_horaire_ligne_valeur::text, ''),
    p.mode_coefficient, coalesce(p.coefficient_global_id::text, ''), coalesce(p.coefficient_global_valeur::text, ''),
    p.mode_taux_horaire, coalesce(p.taux_horaire_global_id::text, ''), coalesce(p.taux_horaire_global_valeur::text, ''),
    p.conditions_version::text,
    coalesce(p_mode_coefficient, ''), coalesce(p_coefficient_id::text, ''), coalesce(p_mode_taux, ''), coalesce(p_taux_id::text, ''),
    coalesce((select c.valeur::text || ':' || c.actif::text from public.coefficients_vente c where c.id = p_coefficient_id), ''),
    coalesce((select t.taux_ht::text || ':' || t.actif::text from public.taux_horaires_vente t where t.id = p_taux_id), '')
  ), 'UTF8')), 'hex')
  from public.profero_ouvrages_selectionnes l
  join public.profero_projets p on p.id = l.projet_id
  where l.id = p_ligne_id;
$$;
revoke all on function public.conditions_ligne_hash(uuid, text, uuid, text, uuid) from public, anon;
grant execute on function public.conditions_ligne_hash(uuid, text, uuid, text, uuid) to authenticated;

