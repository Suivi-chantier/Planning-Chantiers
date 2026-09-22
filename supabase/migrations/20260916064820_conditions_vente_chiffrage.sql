-- ═══════════════════════════════════════════════════════════════════════════
-- Conditions de vente d'un chiffrage : coefficient global et/ou taux horaire
-- global, propres au chiffrage (profero_projets), jamais à la bibliothèque.
--
-- • profero_projets : mode_coefficient (ouvrage | global) + coefficient global
--   FIGÉ (id, valeur, libellé) ; mode_taux_horaire + taux global FIGÉ ;
--   conditions_version (concurrence optimiste).
-- • profero_ouvrages_selectionnes : sur chaque ligne, valeurs D'ORIGINE de
--   l'ouvrage (coefficient_origine_valeur/libelle, taux_horaire_origine_valeur/
--   libelle — les identifiants d'origine sont les colonnes existantes
--   coefficient_vente_id / taux_horaire_vente_id) et valeurs APPLIQUÉES
--   (colonnes existantes coef_vente / taux_horaire_vente + source + id global).
-- • chiffrage_conditions_historique : audit de chaque changement.
-- • RPC simuler_conditions_chiffrage (aucune écriture) et
--   appliquer_conditions_chiffrage (atomique : contrôle de version + hash des
--   lignes, verrou FOR UPDATE, recalcul ciblé depuis les seules données figées,
--   mise à jour du projet, historique) — SECURITY INVOKER, la RLS bureau_all
--   des tables s'applique à l'appelant.
--
-- Recalcul ciblé (formule v2 conservée, coût direct × coefficient) :
--   prix matériaux = round(coût matériaux figé × coefficient appliqué, 2)
--   prix coût direct = round(coût direct figé × coefficient appliqué, 2)
--   prix MO        = round(cadence figée × taux appliqué, 2)
--   prix unitaire  = round(somme, 2)
-- Une ligne v1 (ancienne formule, sans taux d'origine) ou sans valeur d'origine
-- n'est JAMAIS recalculée : elle est signalée et laissée intacte.
--
-- Idempotente et SANS PERTE : aucune ligne existante n'est modifiée par la migration.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1) Projet (chiffrage) ─────────────────────────────────────────────────
alter table public.profero_projets
  add column if not exists mode_coefficient          text not null default 'ouvrage',
  add column if not exists coefficient_global_id     uuid references public.coefficients_vente(id) on delete restrict,
  add column if not exists coefficient_global_valeur numeric(8,4),
  add column if not exists coefficient_global_libelle text,
  add column if not exists mode_taux_horaire         text not null default 'ouvrage',
  add column if not exists taux_horaire_global_id    uuid references public.taux_horaires_vente(id) on delete restrict,
  add column if not exists taux_horaire_global_valeur numeric(10,2),
  add column if not exists taux_horaire_global_libelle text,
  add column if not exists conditions_version        integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profero_projets_mode_coefficient_check') then
    alter table public.profero_projets add constraint profero_projets_mode_coefficient_check
      check (mode_coefficient in ('ouvrage', 'global'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profero_projets_mode_taux_horaire_check') then
    alter table public.profero_projets add constraint profero_projets_mode_taux_horaire_check
      check (mode_taux_horaire in ('ouvrage', 'global'));
  end if;
  -- mode global ⇒ valeur figée présente ; mode ouvrage ⇒ champs globaux NULL
  if not exists (select 1 from pg_constraint where conname = 'profero_projets_coefficient_global_coherence_check') then
    alter table public.profero_projets add constraint profero_projets_coefficient_global_coherence_check
      check ((mode_coefficient = 'global' and coefficient_global_id is not null and coefficient_global_valeur > 0)
          or (mode_coefficient = 'ouvrage' and coefficient_global_id is null and coefficient_global_valeur is null and coefficient_global_libelle is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profero_projets_taux_global_coherence_check') then
    alter table public.profero_projets add constraint profero_projets_taux_global_coherence_check
      check ((mode_taux_horaire = 'global' and taux_horaire_global_id is not null and taux_horaire_global_valeur > 0)
          or (mode_taux_horaire = 'ouvrage' and taux_horaire_global_id is null and taux_horaire_global_valeur is null and taux_horaire_global_libelle is null));
  end if;
end $$;

create index if not exists profero_projets_coefficient_global_idx on public.profero_projets (coefficient_global_id) where coefficient_global_id is not null;
create index if not exists profero_projets_taux_horaire_global_idx on public.profero_projets (taux_horaire_global_id) where taux_horaire_global_id is not null;

comment on column public.profero_projets.mode_coefficient is 'ouvrage = coefficient de chaque ouvrage ; global = coefficient_global_* (FIGÉ) appliqué à toutes les lignes de ce chiffrage.';
comment on column public.profero_projets.mode_taux_horaire is 'ouvrage = taux horaire de chaque ouvrage ; global = taux_horaire_global_* (FIGÉ) appliqué à toutes les lignes de ce chiffrage.';
comment on column public.profero_projets.conditions_version is 'Incrémentée par appliquer_conditions_chiffrage ; l''application est refusée si la version attendue ne correspond plus (concurrence).';

-- ─── 2) Lignes : origine et application ────────────────────────────────────
alter table public.profero_ouvrages_selectionnes
  add column if not exists coefficient_source          text,             -- 'ouvrage' | 'global_chiffrage' (null = ligne antérieure)
  add column if not exists coefficient_origine_valeur  numeric(8,4),     -- coefficient de l'ouvrage au moment du figeage
  add column if not exists coefficient_origine_libelle text,
  add column if not exists coefficient_global_id       uuid references public.coefficients_vente(id) on delete set null,
  add column if not exists taux_horaire_source         text,             -- 'ouvrage' | 'global_chiffrage'
  add column if not exists taux_horaire_origine_valeur numeric(10,2),
  add column if not exists taux_horaire_origine_libelle text,
  add column if not exists taux_horaire_global_id      uuid references public.taux_horaires_vente(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profero_ouvrages_selectionnes_coefficient_source_check') then
    alter table public.profero_ouvrages_selectionnes add constraint profero_ouvrages_selectionnes_coefficient_source_check
      check (coefficient_source is null or coefficient_source in ('ouvrage', 'global_chiffrage'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profero_ouvrages_selectionnes_taux_source_check') then
    alter table public.profero_ouvrages_selectionnes add constraint profero_ouvrages_selectionnes_taux_source_check
      check (taux_horaire_source is null or taux_horaire_source in ('ouvrage', 'global_chiffrage'));
  end if;
end $$;

create index if not exists profero_ouvrages_selectionnes_coefficient_global_idx on public.profero_ouvrages_selectionnes (coefficient_global_id) where coefficient_global_id is not null;
create index if not exists profero_ouvrages_selectionnes_taux_global_idx on public.profero_ouvrages_selectionnes (taux_horaire_global_id) where taux_horaire_global_id is not null;

comment on column public.profero_ouvrages_selectionnes.coef_vente is 'Coefficient RÉELLEMENT APPLIQUÉ à la ligne (figé). Origine : coefficient_vente_id + coefficient_origine_valeur/libelle ; source : coefficient_source.';
comment on column public.profero_ouvrages_selectionnes.taux_horaire_vente is 'Taux horaire RÉELLEMENT APPLIQUÉ à la ligne (figé). Origine : taux_horaire_vente_id + taux_horaire_origine_valeur/libelle ; source : taux_horaire_source.';
comment on column public.profero_ouvrages_selectionnes.coefficient_vente_id is 'Coefficient D''ORIGINE de l''ouvrage au moment du figeage (référence).';
comment on column public.profero_ouvrages_selectionnes.taux_horaire_vente_id is 'Taux horaire D''ORIGINE de l''ouvrage au moment du figeage (référence).';

-- ─── 3) Historique ─────────────────────────────────────────────────────────
create table if not exists public.chiffrage_conditions_historique (
  id                       uuid primary key default gen_random_uuid(),
  projet_id                uuid not null references public.profero_projets(id) on delete cascade,
  utilisateur_email        text,
  date                     timestamptz not null default now(),
  ancien_mode_coefficient  text,
  ancien_coefficient_id    uuid,
  ancien_coefficient_valeur numeric(8,4),
  ancien_coefficient_libelle text,
  nouveau_mode_coefficient text,
  nouveau_coefficient_id   uuid,
  nouveau_coefficient_valeur numeric(8,4),
  nouveau_coefficient_libelle text,
  ancien_mode_taux         text,
  ancien_taux_id           uuid,
  ancien_taux_valeur       numeric(10,2),
  ancien_taux_libelle      text,
  nouveau_mode_taux        text,
  nouveau_taux_id          uuid,
  nouveau_taux_valeur      numeric(10,2),
  nouveau_taux_libelle     text,
  nb_lignes_recalculees    integer not null default 0,
  nb_lignes_ignorees       integer not null default 0,
  ancien_total_ht          numeric(14,2),
  nouveau_total_ht         numeric(14,2),
  ancienne_marge           numeric(14,2),
  nouvelle_marge           numeric(14,2),
  ancienne_marge_pct       numeric(8,2),
  nouvelle_marge_pct       numeric(8,2),
  version_avant            integer,
  version_apres            integer
);
create index if not exists chiffrage_conditions_historique_projet_idx on public.chiffrage_conditions_historique (projet_id, date desc);
comment on table public.chiffrage_conditions_historique is 'Audit des changements de conditions de vente d''un chiffrage (écrit par appliquer_conditions_chiffrage). Jamais modifié ni supprimé depuis le navigateur.';

alter table public.chiffrage_conditions_historique enable row level security;
revoke all on table public.chiffrage_conditions_historique from anon;
grant select, insert on table public.chiffrage_conditions_historique to authenticated;
revoke update, delete on table public.chiffrage_conditions_historique from authenticated;
drop policy if exists chiffrage_conditions_historique_bureau_select on public.chiffrage_conditions_historique;
create policy chiffrage_conditions_historique_bureau_select on public.chiffrage_conditions_historique
  for select to authenticated using (not est_ouvrier());
drop policy if exists chiffrage_conditions_historique_bureau_insert on public.chiffrage_conditions_historique;
create policy chiffrage_conditions_historique_bureau_insert on public.chiffrage_conditions_historique
  for insert to authenticated with check (not est_ouvrier());

-- ─── 4) Hash des lignes (état figé) ────────────────────────────────────────
-- Change dès qu'une ligne est ajoutée, retirée ou que son prix / sa version de
-- calcul change : l'application est refusée si le hash de la simulation diffère.
create or replace function public.conditions_chiffrage_hash(p_projet_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select encode(sha256(convert_to(
    coalesce((select string_agg(o.id::text || '|' || coalesce(o.prix_unitaire::text, '') || '|' || coalesce(o.calcul_version, '') || '|' || coalesce(o.quantite, ''), ',' order by o.id)
              from public.profero_ouvrages_selectionnes o where o.projet_id = p_projet_id), ''), 'UTF8')), 'hex');
$$;
revoke all on function public.conditions_chiffrage_hash(uuid) from public, anon;
grant execute on function public.conditions_chiffrage_hash(uuid) to authenticated;

-- ─── 5) Cœur : évaluation (simulation) et application ──────────────────────
create or replace function public.conditions_chiffrage_evaluer(
  p_projet_id uuid,
  p_mode_coefficient text,
  p_coefficient_id uuid,
  p_mode_taux text,
  p_taux_id uuid,
  p_appliquer boolean,
  p_version_attendue integer default null,
  p_hash_attendu text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  proj      public.profero_projets;
  coef      public.coefficients_vente;
  taux      public.taux_horaires_vente;
  l         record;
  v_hash    text;
  v_now     timestamptz := now();
  v_iso     text;
  v_version integer;
  v_heures  numeric; v_cout_mat numeric; v_cout_dir numeric; v_cout_mo numeric; v_cout_tot numeric;
  v_coef_orig numeric; v_taux_orig numeric; v_coef_appl numeric; v_taux_appl numeric;
  v_coef_orig_lib text; v_taux_orig_lib text;
  v_prix_mat numeric; v_prix_dir numeric; v_prix_mo numeric; v_prix numeric; v_marge_pct numeric;
  v_q       numeric;
  v_total_avant numeric := 0; v_total_apres numeric := 0;
  v_marge_avant numeric := 0; v_marge_apres numeric := 0; v_marge_connue boolean := true;
  v_nb_recalc integer := 0; v_nb_ignorees integer := 0; v_nb_sans_snapshot integer := 0;
  v_lignes  jsonb := '[]'::jsonb;
  v_ignorees jsonb := '[]'::jsonb;
  v_avertissements text[] := '{}';
  v_raison  text;
  v_detail  jsonb;
  v_mode_coef text := coalesce(p_mode_coefficient, 'ouvrage');
  v_mode_taux text := coalesce(p_mode_taux, 'ouvrage');
begin
  if v_mode_coef not in ('ouvrage', 'global') or v_mode_taux not in ('ouvrage', 'global') then
    raise exception 'Mode invalide (ouvrage ou global attendu).';
  end if;

  -- Projet (verrouillé si application) ; la RLS filtre les projets non accessibles
  if p_appliquer then
    select * into proj from public.profero_projets where id = p_projet_id for update;
  else
    select * into proj from public.profero_projets where id = p_projet_id;
  end if;
  if not found then
    raise exception 'Chiffrage introuvable ou non accessible.';
  end if;
  if proj.statut = 'signe' then
    raise exception 'Chiffrage signé : ses conditions de vente ne sont plus modifiables.';
  end if;
  if proj.progbat_devis_id is not null then
    v_avertissements := array_append(v_avertissements, 'Un brouillon ProGBat existe déjà pour ce logement (id ' || proj.progbat_devis_id || ') : il ne sera PAS actualisé automatiquement.');
  end if;

  -- Références globales : existantes, actives (pour une nouvelle sélection), valeurs FIGÉES maintenant
  if v_mode_coef = 'global' then
    if p_coefficient_id is null then raise exception 'Coefficient global non sélectionné.'; end if;
    select * into coef from public.coefficients_vente where id = p_coefficient_id;
    if not found then raise exception 'Coefficient de vente introuvable.'; end if;
    if not coef.actif and (proj.mode_coefficient <> 'global' or proj.coefficient_global_id is distinct from coef.id) then
      raise exception 'Le coefficient « % » est désactivé : il ne peut pas être sélectionné.', coef.libelle;
    end if;
    if not coef.actif then v_avertissements := array_append(v_avertissements, 'Coefficient « ' || coef.libelle || ' » désactivé dans les Réglages : sa valeur figée reste utilisée.'); end if;
  end if;
  if v_mode_taux = 'global' then
    if p_taux_id is null then raise exception 'Taux horaire global non sélectionné.'; end if;
    select * into taux from public.taux_horaires_vente where id = p_taux_id;
    if not found then raise exception 'Taux horaire de vente introuvable.'; end if;
    if not taux.actif and (proj.mode_taux_horaire <> 'global' or proj.taux_horaire_global_id is distinct from taux.id) then
      raise exception 'Le taux horaire « % » est désactivé : il ne peut pas être sélectionné.', taux.libelle;
    end if;
    if not taux.actif then v_avertissements := array_append(v_avertissements, 'Taux horaire « ' || taux.libelle || ' » désactivé dans les Réglages : sa valeur figée reste utilisée.'); end if;
  end if;

  -- Concurrence : version du projet + hash des lignes
  v_hash := public.conditions_chiffrage_hash(p_projet_id);
  if p_appliquer then
    if p_version_attendue is null or p_version_attendue <> proj.conditions_version then
      raise exception 'Le chiffrage a été modifié depuis la simulation (version % attendue, % actuelle) : relancer la simulation.', p_version_attendue, proj.conditions_version;
    end if;
    if p_hash_attendu is null or p_hash_attendu <> v_hash then
      raise exception 'Les lignes du chiffrage ont changé depuis la simulation : relancer la simulation.';
    end if;
  end if;

  v_iso := to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  -- Lignes : recalcul ciblé depuis les SEULES données figées
  for l in
    select * from public.profero_ouvrages_selectionnes where projet_id = p_projet_id order by id
    for update
  loop
    v_q := coalesce(public.safe_numeric(l.quantite), 0);
    -- Totaux « avant » (toutes les lignes avec prix)
    if l.prix_unitaire is not null then
      v_total_avant := v_total_avant + v_q * l.prix_unitaire;
      if l.cout_total_unitaire is not null then v_marge_avant := v_marge_avant + v_q * (l.prix_unitaire - l.cout_total_unitaire); else v_marge_connue := false; end if;
    end if;

    if l.calcul_version is null then
      -- Ancienne ligne à prix saisi : hors périmètre, inchangée
      v_nb_sans_snapshot := v_nb_sans_snapshot + 1;
      if l.prix_unitaire is not null then
        v_total_apres := v_total_apres + v_q * l.prix_unitaire;
        if l.cout_total_unitaire is not null then v_marge_apres := v_marge_apres + v_q * (l.prix_unitaire - l.cout_total_unitaire); end if;
      end if;
      continue;
    end if;

    v_detail := coalesce(l.calcul_detail, '{}'::jsonb);
    v_raison := null;
    if coalesce(split_part(l.calcul_version, '@', 1), '0')::int < 2 then
      v_raison := 'ancienne formule (v1) : coefficient sur le coût total et taux horaire d''origine inconnu';
    end if;
    v_heures  := nullif(v_detail->>'heures_unitaires', '')::numeric;
    v_cout_mat := l.cout_materiaux_unitaire;
    v_cout_dir := coalesce(l.cout_direct_unitaire, 0);
    v_cout_mo  := l.cout_main_oeuvre_unitaire;
    v_cout_tot := l.cout_total_unitaire;
    v_coef_orig := coalesce(l.coefficient_origine_valeur, case when l.coefficient_source is null or l.coefficient_source = 'ouvrage' then l.coef_vente end);
    v_taux_orig := coalesce(l.taux_horaire_origine_valeur, case when l.taux_horaire_source is null or l.taux_horaire_source = 'ouvrage' then l.taux_horaire_vente end);
    v_coef_orig_lib := coalesce(l.coefficient_origine_libelle, case when l.coefficient_source is null or l.coefficient_source = 'ouvrage' then v_detail->>'coefficient_vente_libelle' end);
    v_taux_orig_lib := coalesce(l.taux_horaire_origine_libelle, case when l.taux_horaire_source is null or l.taux_horaire_source = 'ouvrage' then v_detail->>'taux_horaire_vente_libelle' end);
    if v_raison is null and (v_heures is null or v_cout_mat is null) then
      v_raison := 'ligne incomplète (cadence ou coût matériaux figé absent)';
    end if;
    if v_raison is null and v_mode_coef = 'ouvrage' and v_coef_orig is null then
      v_raison := 'coefficient d''origine de l''ouvrage absent de la ligne';
    end if;
    if v_raison is null and v_mode_taux = 'ouvrage' and v_taux_orig is null then
      v_raison := 'taux horaire d''origine de l''ouvrage absent de la ligne';
    end if;

    if v_raison is not null then
      v_nb_ignorees := v_nb_ignorees + 1;
      v_ignorees := v_ignorees || jsonb_build_object('id', l.id, 'item', l.item, 'raison', v_raison);
      if l.prix_unitaire is not null then
        v_total_apres := v_total_apres + v_q * l.prix_unitaire;
        if l.cout_total_unitaire is not null then v_marge_apres := v_marge_apres + v_q * (l.prix_unitaire - l.cout_total_unitaire); end if;
      end if;
      continue;
    end if;

    v_coef_appl := case when v_mode_coef = 'global' then coef.valeur else v_coef_orig end;
    v_taux_appl := case when v_mode_taux = 'global' then taux.taux_ht else v_taux_orig end;
    v_prix_mat := round(v_cout_mat * v_coef_appl, 2);
    v_prix_dir := round(v_cout_dir * v_coef_appl, 2);
    v_prix_mo  := round(v_heures * v_taux_appl, 2);
    v_prix     := round(v_prix_mat + v_prix_dir + v_prix_mo, 2);
    v_marge_pct := case when v_cout_tot is not null and v_prix > 0 then round((v_prix - v_cout_tot) / v_prix * 100, 2) else null end;

    v_nb_recalc := v_nb_recalc + 1;
    v_total_apres := v_total_apres + v_q * v_prix;
    if v_cout_tot is not null then v_marge_apres := v_marge_apres + v_q * (v_prix - v_cout_tot); else v_marge_connue := false; end if;
    v_lignes := v_lignes || jsonb_build_object(
      'id', l.id, 'item', l.item, 'zone', l.zone, 'quantite', v_q,
      'prix_avant', l.prix_unitaire, 'prix_apres', v_prix,
      'coef_avant', l.coef_vente, 'coef_apres', v_coef_appl,
      'taux_avant', l.taux_horaire_vente, 'taux_apres', v_taux_appl);

    if p_appliquer then
      update public.profero_ouvrages_selectionnes set
        coef_vente = v_coef_appl,
        taux_horaire_vente = v_taux_appl,
        coefficient_source = case when v_mode_coef = 'global' then 'global_chiffrage' else 'ouvrage' end,
        taux_horaire_source = case when v_mode_taux = 'global' then 'global_chiffrage' else 'ouvrage' end,
        coefficient_global_id = case when v_mode_coef = 'global' then coef.id else null end,
        taux_horaire_global_id = case when v_mode_taux = 'global' then taux.id else null end,
        coefficient_origine_valeur = v_coef_orig,
        coefficient_origine_libelle = v_coef_orig_lib,
        taux_horaire_origine_valeur = v_taux_orig,
        taux_horaire_origine_libelle = v_taux_orig_lib,
        prix_unitaire = v_prix,
        taux_marge_pct = v_marge_pct,
        calcul_version = '2@' || v_iso,
        updated_at = v_now,
        calcul_detail = v_detail || jsonb_build_object(
          'version', 2,
          'date', v_iso,
          'coef_vente', v_coef_appl,
          'taux_horaire_vente', v_taux_appl,
          'prix_materiaux_unitaire', v_prix_mat,
          'prix_direct_unitaire', v_prix_dir,
          'prix_main_oeuvre_unitaire', v_prix_mo,
          'coefficient_origine', jsonb_build_object('id', l.coefficient_vente_id, 'valeur', v_coef_orig, 'libelle', v_coef_orig_lib),
          'coefficient_applique', jsonb_build_object('valeur', v_coef_appl, 'source', case when v_mode_coef = 'global' then 'global_chiffrage' else 'ouvrage' end,
                                                     'global_id', case when v_mode_coef = 'global' then coef.id else null end,
                                                     'libelle', case when v_mode_coef = 'global' then coef.libelle else v_coef_orig_lib end),
          'taux_origine', jsonb_build_object('id', l.taux_horaire_vente_id, 'valeur', v_taux_orig, 'libelle', v_taux_orig_lib),
          'taux_applique', jsonb_build_object('valeur', v_taux_appl, 'source', case when v_mode_taux = 'global' then 'global_chiffrage' else 'ouvrage' end,
                                              'global_id', case when v_mode_taux = 'global' then taux.id else null end,
                                              'libelle', case when v_mode_taux = 'global' then taux.libelle else v_taux_orig_lib end),
          'recalcul_conditions_le', v_iso)
      where id = l.id;
    end if;
  end loop;

  v_total_avant := round(v_total_avant, 2);
  v_total_apres := round(v_total_apres, 2);
  v_marge_avant := round(v_marge_avant, 2);
  v_marge_apres := round(v_marge_apres, 2);

  if p_appliquer then
    v_version := proj.conditions_version + 1;
    update public.profero_projets set
      mode_coefficient = v_mode_coef,
      coefficient_global_id = case when v_mode_coef = 'global' then coef.id else null end,
      coefficient_global_valeur = case when v_mode_coef = 'global' then coef.valeur else null end,
      coefficient_global_libelle = case when v_mode_coef = 'global' then coef.libelle else null end,
      mode_taux_horaire = v_mode_taux,
      taux_horaire_global_id = case when v_mode_taux = 'global' then taux.id else null end,
      taux_horaire_global_valeur = case when v_mode_taux = 'global' then taux.taux_ht else null end,
      taux_horaire_global_libelle = case when v_mode_taux = 'global' then taux.libelle else null end,
      conditions_version = v_version,
      updated_at = v_now
    where id = p_projet_id;
    if not found then
      raise exception 'Modification refusée : chiffrage non modifiable pour cet utilisateur.';
    end if;

    insert into public.chiffrage_conditions_historique (
      projet_id, utilisateur_email, date,
      ancien_mode_coefficient, ancien_coefficient_id, ancien_coefficient_valeur, ancien_coefficient_libelle,
      nouveau_mode_coefficient, nouveau_coefficient_id, nouveau_coefficient_valeur, nouveau_coefficient_libelle,
      ancien_mode_taux, ancien_taux_id, ancien_taux_valeur, ancien_taux_libelle,
      nouveau_mode_taux, nouveau_taux_id, nouveau_taux_valeur, nouveau_taux_libelle,
      nb_lignes_recalculees, nb_lignes_ignorees, ancien_total_ht, nouveau_total_ht,
      ancienne_marge, nouvelle_marge, ancienne_marge_pct, nouvelle_marge_pct, version_avant, version_apres)
    values (
      p_projet_id, auth.email(), v_now,
      proj.mode_coefficient, proj.coefficient_global_id, proj.coefficient_global_valeur, proj.coefficient_global_libelle,
      v_mode_coef, case when v_mode_coef = 'global' then coef.id end, case when v_mode_coef = 'global' then coef.valeur end, case when v_mode_coef = 'global' then coef.libelle end,
      proj.mode_taux_horaire, proj.taux_horaire_global_id, proj.taux_horaire_global_valeur, proj.taux_horaire_global_libelle,
      v_mode_taux, case when v_mode_taux = 'global' then taux.id end, case when v_mode_taux = 'global' then taux.taux_ht end, case when v_mode_taux = 'global' then taux.libelle end,
      v_nb_recalc, v_nb_ignorees, v_total_avant, v_total_apres,
      case when v_marge_connue then v_marge_avant end, case when v_marge_connue then v_marge_apres end,
      case when v_marge_connue and v_total_avant > 0 then round(v_marge_avant / v_total_avant * 100, 2) end,
      case when v_marge_connue and v_total_apres > 0 then round(v_marge_apres / v_total_apres * 100, 2) end,
      proj.conditions_version, v_version);
  else
    v_version := proj.conditions_version;
  end if;

  return jsonb_build_object(
    'ok', true,
    'applique', p_appliquer,
    'projet_id', p_projet_id,
    'version', v_version,
    'version_attendue', proj.conditions_version,
    'hash_lignes', v_hash,
    'avant', jsonb_build_object(
      'mode_coefficient', proj.mode_coefficient, 'coefficient_id', proj.coefficient_global_id, 'coefficient_valeur', proj.coefficient_global_valeur, 'coefficient_libelle', proj.coefficient_global_libelle,
      'mode_taux_horaire', proj.mode_taux_horaire, 'taux_id', proj.taux_horaire_global_id, 'taux_valeur', proj.taux_horaire_global_valeur, 'taux_libelle', proj.taux_horaire_global_libelle),
    'apres', jsonb_build_object(
      'mode_coefficient', v_mode_coef, 'coefficient_id', case when v_mode_coef = 'global' then coef.id end, 'coefficient_valeur', case when v_mode_coef = 'global' then coef.valeur end, 'coefficient_libelle', case when v_mode_coef = 'global' then coef.libelle end,
      'mode_taux_horaire', v_mode_taux, 'taux_id', case when v_mode_taux = 'global' then taux.id end, 'taux_valeur', case when v_mode_taux = 'global' then taux.taux_ht end, 'taux_libelle', case when v_mode_taux = 'global' then taux.libelle end),
    'nb_lignes_recalculees', v_nb_recalc,
    'nb_lignes_ignorees', v_nb_ignorees,
    'nb_lignes_sans_snapshot', v_nb_sans_snapshot,
    'total_ht_avant', v_total_avant,
    'total_ht_apres', v_total_apres,
    'ecart_ht', round(v_total_apres - v_total_avant, 2),
    'marge_connue', v_marge_connue,
    'marge_avant', case when v_marge_connue then v_marge_avant end,
    'marge_apres', case when v_marge_connue then v_marge_apres end,
    'marge_avant_pct', case when v_marge_connue and v_total_avant > 0 then round(v_marge_avant / v_total_avant * 100, 2) end,
    'marge_apres_pct', case when v_marge_connue and v_total_apres > 0 then round(v_marge_apres / v_total_apres * 100, 2) end,
    'lignes', v_lignes,
    'lignes_ignorees', v_ignorees,
    'avertissements', to_jsonb(v_avertissements),
    'devis_progbat_id', proj.progbat_devis_id,
    'inchanges', jsonb_build_array('coûts matériaux, main-d''œuvre et direct figés', 'quantités et unités', 'cadences', 'compositions et zones', 'ouvrages de la bibliothèque'));
end;
$$;
-- Les enveloppes ci-dessous sont SECURITY INVOKER : l'appelant exécute lui-même le
-- cœur (également SECURITY INVOKER, RLS bureau_all appliquée). Un appel direct du
-- cœur n'ouvre rien de plus que les enveloppes (mêmes contrôles de version/hash).
revoke all on function public.conditions_chiffrage_evaluer(uuid, text, uuid, text, uuid, boolean, integer, text) from public, anon;
grant execute on function public.conditions_chiffrage_evaluer(uuid, text, uuid, text, uuid, boolean, integer, text) to authenticated;

-- Simulation : AUCUNE écriture (la fonction est marquée VOLATILE pour rester
-- appelable en RPC, mais p_appliquer = false n'exécute aucun UPDATE/INSERT).
create or replace function public.simuler_conditions_chiffrage(
  p_projet_id uuid, p_mode_coefficient text, p_coefficient_id uuid, p_mode_taux text, p_taux_id uuid)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select public.conditions_chiffrage_evaluer(p_projet_id, p_mode_coefficient, p_coefficient_id, p_mode_taux, p_taux_id, false, null, null);
$$;
revoke all on function public.simuler_conditions_chiffrage(uuid, text, uuid, text, uuid) from public, anon;
grant execute on function public.simuler_conditions_chiffrage(uuid, text, uuid, text, uuid) to authenticated;

-- Application atomique : version + hash contrôlés, tout ou rien.
create or replace function public.appliquer_conditions_chiffrage(
  p_projet_id uuid, p_mode_coefficient text, p_coefficient_id uuid, p_mode_taux text, p_taux_id uuid,
  p_version_attendue integer, p_hash_attendu text)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select public.conditions_chiffrage_evaluer(p_projet_id, p_mode_coefficient, p_coefficient_id, p_mode_taux, p_taux_id, true, p_version_attendue, p_hash_attendu);
$$;
revoke all on function public.appliquer_conditions_chiffrage(uuid, text, uuid, text, uuid, integer, text) from public, anon;
grant execute on function public.appliquer_conditions_chiffrage(uuid, text, uuid, text, uuid, integer, text) to authenticated;
