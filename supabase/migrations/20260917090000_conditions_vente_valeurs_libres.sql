-- ═══════════════════════════════════════════════════════════════════════════
-- Coefficient et taux horaire de VENTE : valeurs libres partout
--
-- Les listes déroulantes disparaissent des trois endroits où un coefficient ou
-- un taux horaire de vente se choisissait :
--   • fiche ouvrage (bibliotheque_ratios)          → valeur saisie sur la fiche
--   • conditions globales d'un chiffrage           → valeur saisie sur le projet
--   • dérogation d'une ligne de devis              → valeur saisie sur la ligne
--
-- Les référentiels (coefficients_vente, taux_horaires_vente) RESTENT : ils ne
-- servent plus qu'à proposer une valeur par défaut dans les champs, jamais à
-- imposer un choix. Les colonnes d'identifiant sont conservées telles quelles
-- (historique lisible) mais ne sont plus écrites.
--
-- Ce que ça change côté règles :
--   • plus de notion d'option « désactivée » sur un ouvrage, un chiffrage ou une
--     ligne : la valeur saisie est toujours utilisable ;
--   • une valeur reste FIGÉE là où elle est écrite — modifier le référentiel
--     n'a jamais d'effet rétroactif (c'était déjà le cas, ça l'est encore plus) ;
--   • les RPC reçoivent une valeur numérique au lieu d'un identifiant ; elles
--     continuent de calculer elles-mêmes prix et marge depuis les SEULES données
--     figées des lignes (le navigateur n'envoie jamais de prix ni de marge).
--
-- Reprise SANS PERTE : chaque ouvrage récupère la valeur du coefficient / taux
-- qu'il référençait ; aucune ligne de chiffrage n'est recalculée.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1) Bibliothèque d'ouvrages : valeurs saisies sur la fiche ─────────────
alter table public.bibliotheque_ratios
  add column if not exists coefficient_vente_valeur  numeric(8,4),
  add column if not exists taux_horaire_vente_valeur numeric(10,2);

comment on column public.bibliotheque_ratios.coefficient_vente_valeur is
  'Coefficient de vente SAISI sur la fiche, appliqué aux matériaux (et au coût direct) de l''ouvrage. Remplace coefficient_vente_id (conservé pour l''historique, plus écrit).';
comment on column public.bibliotheque_ratios.taux_horaire_vente_valeur is
  'Taux horaire de vente SAISI sur la fiche (€ HT/h, prix MO = cadence × taux). Remplace taux_horaire_vente_id (conservé pour l''historique, plus écrit).';

-- Reprise : valeur du coefficient / taux actuellement référencé, à défaut celle
-- du défaut actif. Aucune autre colonne n'est touchée, aucun prix n'est recalculé.
update public.bibliotheque_ratios b
   set coefficient_vente_valeur = coalesce(
         (select c.valeur from public.coefficients_vente c where c.id = b.coefficient_vente_id),
         (select c.valeur from public.coefficients_vente c where c.est_defaut and c.actif limit 1),
         (select c.valeur from public.coefficients_vente c where c.actif order by c.created_at, c.libelle limit 1))
 where b.coefficient_vente_valeur is null;

update public.bibliotheque_ratios b
   set taux_horaire_vente_valeur = coalesce(
         (select t.taux_ht from public.taux_horaires_vente t where t.id = b.taux_horaire_vente_id),
         (select t.taux_ht from public.taux_horaires_vente t where t.est_defaut and t.actif limit 1),
         (select t.taux_ht from public.taux_horaires_vente t where t.actif order by t.created_at, t.libelle limit 1))
 where b.taux_horaire_vente_valeur is null;

do $$
declare n integer;
begin
  select count(*) into n from public.bibliotheque_ratios
   where coefficient_vente_valeur is null or taux_horaire_vente_valeur is null;
  if n > 0 then
    raise exception 'Reprise incomplète : % ouvrage(s) sans coefficient ou sans taux horaire. Vérifier qu''il existe au moins un coefficient et un taux actifs dans les Réglages.', n;
  end if;
end $$;

-- Les anciens gardes imposaient un identifiant de référentiel existant et actif :
-- ils n'ont plus lieu d'être. Les colonnes d'identifiant deviennent facultatives.
drop trigger if exists bibliotheque_ratios_coefficient_garde_trg on public.bibliotheque_ratios;
drop trigger if exists bibliotheque_ratios_taux_horaire_garde_trg on public.bibliotheque_ratios;
drop function if exists public.bibliotheque_ratios_coefficient_garde();
drop function if exists public.bibliotheque_ratios_taux_horaire_garde();

alter table public.bibliotheque_ratios alter column coefficient_vente_id  drop not null;
alter table public.bibliotheque_ratios alter column taux_horaire_vente_id drop not null;

-- Nouveau garde : valeurs strictement positives ; un ouvrage créé sans valeur
-- reçoit celle par défaut des Réglages (le champ de l'interface est pré-rempli,
-- ceci ne couvre que les écritures faites ailleurs).
create or replace function public.bibliotheque_ratios_valeurs_vente_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.coefficient_vente_valeur is null then
    select c.valeur into new.coefficient_vente_valeur
      from public.coefficients_vente c where c.est_defaut and c.actif limit 1;
    if new.coefficient_vente_valeur is null then
      raise exception 'Coefficient de vente obligatoire : saisir une valeur sur la fiche de l''ouvrage.';
    end if;
  end if;
  if new.taux_horaire_vente_valeur is null then
    select t.taux_ht into new.taux_horaire_vente_valeur
      from public.taux_horaires_vente t where t.est_defaut and t.actif limit 1;
    if new.taux_horaire_vente_valeur is null then
      raise exception 'Taux horaire de main-d''œuvre obligatoire : saisir une valeur sur la fiche de l''ouvrage.';
    end if;
  end if;
  if new.coefficient_vente_valeur <= 0 then
    raise exception 'Coefficient de vente invalide (nul ou négatif) : %.', new.coefficient_vente_valeur;
  end if;
  if new.taux_horaire_vente_valeur <= 0 then
    raise exception 'Taux horaire de main-d''œuvre invalide (nul ou négatif) : %.', new.taux_horaire_vente_valeur;
  end if;
  return new;
end;
$$;
revoke execute on function public.bibliotheque_ratios_valeurs_vente_garde() from public, anon, authenticated;
drop trigger if exists bibliotheque_ratios_valeurs_vente_garde_trg on public.bibliotheque_ratios;
create trigger bibliotheque_ratios_valeurs_vente_garde_trg
  before insert or update of coefficient_vente_valeur, taux_horaire_vente_valeur on public.bibliotheque_ratios
  for each row execute function public.bibliotheque_ratios_valeurs_vente_garde();

alter table public.bibliotheque_ratios alter column coefficient_vente_valeur  set not null;
alter table public.bibliotheque_ratios alter column taux_horaire_vente_valeur set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bibliotheque_ratios_valeurs_vente_positives_check') then
    alter table public.bibliotheque_ratios add constraint bibliotheque_ratios_valeurs_vente_positives_check
      check (coefficient_vente_valeur > 0 and taux_horaire_vente_valeur > 0);
  end if;
end $$;

-- ─── 2) Lignes de chiffrage : la dérogation n'a plus d'identifiant ─────────
-- Mode « specifique » ⇒ une VALEUR strictement positive suffit (l'identifiant
-- reste accepté sur les lignes déjà enregistrées, il n'est simplement plus exigé).
alter table public.profero_ouvrages_selectionnes
  drop constraint if exists profero_ouvrages_selectionnes_coefficient_ligne_coherence_check;
alter table public.profero_ouvrages_selectionnes
  add constraint profero_ouvrages_selectionnes_coefficient_ligne_coherence_check
  check ((mode_coefficient_ligne = 'specifique' and coefficient_ligne_valeur > 0)
      or (mode_coefficient_ligne in ('heritage', 'ouvrage') and coefficient_ligne_id is null and coefficient_ligne_valeur is null and coefficient_ligne_libelle is null));

alter table public.profero_ouvrages_selectionnes
  drop constraint if exists profero_ouvrages_selectionnes_taux_ligne_coherence_check;
alter table public.profero_ouvrages_selectionnes
  add constraint profero_ouvrages_selectionnes_taux_ligne_coherence_check
  check ((mode_taux_horaire_ligne = 'specifique' and taux_horaire_ligne_valeur > 0)
      or (mode_taux_horaire_ligne in ('heritage', 'ouvrage') and taux_horaire_ligne_id is null and taux_horaire_ligne_valeur is null and taux_horaire_ligne_libelle is null));

comment on column public.profero_ouvrages_selectionnes.coefficient_ligne_valeur is
  'Coefficient SAISI et FIGÉ sur la ligne (mode specifique). Aucun lien avec les Réglages : les modifier ne le change jamais.';
comment on column public.profero_ouvrages_selectionnes.taux_horaire_ligne_valeur is
  'Taux horaire SAISI et FIGÉ sur la ligne (mode specifique). Aucun lien avec les Réglages : les modifier ne le change jamais.';

-- ─── 3) RPC : les identifiants laissent place aux valeurs ──────────────────
-- Les nouvelles fonctions prennent une VALEUR numérique là où les anciennes
-- prenaient un identifiant. Les deux versions COEXISTENT volontairement : elles
-- se distinguent par le nom de leurs paramètres (p_coefficient_valeur vs
-- p_coefficient_id), donc un navigateur encore sur l'ancienne version de
-- l'application continue de fonctionner pendant le déploiement.
--
-- NETTOYAGE ultérieur (une fois tout le monde sur la nouvelle version) :
--   drop function public.simuler_conditions_chiffrage(uuid, text, uuid, text, uuid);
--   drop function public.appliquer_conditions_chiffrage(uuid, text, uuid, text, uuid, integer, text);
--   drop function public.conditions_chiffrage_evaluer(uuid, text, uuid, text, uuid, boolean, integer, text);
--   drop function public.simuler_conditions_ligne(uuid, uuid, text, uuid, text, uuid);
--   drop function public.appliquer_conditions_ligne(uuid, uuid, text, uuid, text, uuid, integer, text, boolean, boolean);
--   drop function public.conditions_ligne_evaluer(uuid, uuid, text, uuid, text, uuid, boolean, integer, text, boolean, boolean);
--   drop function public.conditions_ligne_hash(uuid, text, uuid, text, uuid);

-- ─── 3a) Hash d'une ligne + des valeurs demandées ──────────────────────────
create or replace function public.conditions_ligne_hash(
  p_ligne_id uuid, p_mode_coefficient text, p_coefficient_valeur numeric, p_mode_taux text, p_taux_valeur numeric)
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
    coalesce(p_mode_coefficient, ''), coalesce(round(p_coefficient_valeur, 4)::text, ''),
    coalesce(p_mode_taux, ''), coalesce(round(p_taux_valeur, 2)::text, '')
  ), 'UTF8')), 'hex')
  from public.profero_ouvrages_selectionnes l
  join public.profero_projets p on p.id = l.projet_id
  where l.id = p_ligne_id;
$$;
revoke all on function public.conditions_ligne_hash(uuid, text, numeric, text, numeric) from public, anon;
grant execute on function public.conditions_ligne_hash(uuid, text, numeric, text, numeric) to authenticated;

-- ─── 3b) Conditions GLOBALES d'un chiffrage (valeurs saisies) ──────────────
create or replace function public.conditions_chiffrage_evaluer(
  p_projet_id uuid,
  p_mode_coefficient text,
  p_coefficient_valeur numeric,
  p_mode_taux text,
  p_taux_valeur numeric,
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
  v_coef_glob numeric; v_taux_glob numeric;   -- valeurs globales SAISIES (null si mode ouvrage)
  l         record;
  v_hash    text;
  v_now     timestamptz := now();
  v_iso     text;
  v_version integer;
  v_heures  numeric; v_cout_mat numeric; v_cout_dir numeric; v_cout_tot numeric;
  v_coef_orig numeric; v_taux_orig numeric; v_coef_appl numeric; v_taux_appl numeric;
  v_coef_orig_lib text; v_taux_orig_lib text;
  v_rc jsonb; v_rt jsonb;
  v_prix_mat numeric; v_prix_dir numeric; v_prix_mo numeric; v_prix numeric; v_marge_pct numeric;
  v_q       numeric;
  v_total_avant numeric := 0; v_total_apres numeric := 0;
  v_marge_avant numeric := 0; v_marge_apres numeric := 0; v_marge_connue boolean := true;
  v_nb_recalc integer := 0; v_nb_ignorees integer := 0; v_nb_sans_snapshot integer := 0; v_nb_inchangees integer := 0;
  v_nb_coef_spec integer := 0; v_nb_taux_spec integer := 0; v_nb_mode_ouvrage integer := 0;
  v_lignes  jsonb := '[]'::jsonb;
  v_ignorees jsonb := '[]'::jsonb;
  v_avertissements text[] := '{}';
  v_raison  text;
  v_detail  jsonb;
  v_change  boolean;
  v_mode_coef text := coalesce(p_mode_coefficient, 'ouvrage');
  v_mode_taux text := coalesce(p_mode_taux, 'ouvrage');
begin
  if v_mode_coef not in ('ouvrage', 'global') or v_mode_taux not in ('ouvrage', 'global') then
    raise exception 'Mode invalide (ouvrage ou global attendu).';
  end if;

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

  -- Valeurs globales SAISIES : strictement positives, arrondies comme les colonnes.
  if v_mode_coef = 'global' then
    if p_coefficient_valeur is null then raise exception 'Coefficient global non renseigné.'; end if;
    if p_coefficient_valeur <= 0 then raise exception 'Coefficient global invalide (nul ou négatif).'; end if;
    v_coef_glob := round(p_coefficient_valeur, 4);
  end if;
  if v_mode_taux = 'global' then
    if p_taux_valeur is null then raise exception 'Taux horaire global non renseigné.'; end if;
    if p_taux_valeur <= 0 then raise exception 'Taux horaire global invalide (nul ou négatif).'; end if;
    v_taux_glob := round(p_taux_valeur, 2);
  end if;

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

  for l in
    select * from public.profero_ouvrages_selectionnes where projet_id = p_projet_id order by id
    for update
  loop
    v_q := coalesce(public.safe_numeric(l.quantite), 0);
    if l.mode_coefficient_ligne = 'specifique' then v_nb_coef_spec := v_nb_coef_spec + 1; end if;
    if l.mode_taux_horaire_ligne = 'specifique' then v_nb_taux_spec := v_nb_taux_spec + 1; end if;
    if l.mode_coefficient_ligne = 'ouvrage' or l.mode_taux_horaire_ligne = 'ouvrage' then v_nb_mode_ouvrage := v_nb_mode_ouvrage + 1; end if;
    if l.prix_unitaire is not null then
      v_total_avant := v_total_avant + v_q * l.prix_unitaire;
      if l.cout_total_unitaire is not null then v_marge_avant := v_marge_avant + v_q * (l.prix_unitaire - l.cout_total_unitaire); else v_marge_connue := false; end if;
    end if;

    if l.calcul_version is null then
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
    v_cout_tot := l.cout_total_unitaire;
    v_coef_orig := coalesce(l.coefficient_origine_valeur, case when l.coefficient_source is null or l.coefficient_source = 'ouvrage' then l.coef_vente end);
    v_taux_orig := coalesce(l.taux_horaire_origine_valeur, case when l.taux_horaire_source is null or l.taux_horaire_source = 'ouvrage' then l.taux_horaire_vente end);
    v_coef_orig_lib := coalesce(l.coefficient_origine_libelle, case when l.coefficient_source is null or l.coefficient_source = 'ouvrage' then v_detail->>'coefficient_vente_libelle' end);
    v_taux_orig_lib := coalesce(l.taux_horaire_origine_libelle, case when l.taux_horaire_source is null or l.taux_horaire_source = 'ouvrage' then v_detail->>'taux_horaire_vente_libelle' end);
    if v_raison is null and (v_heures is null or v_cout_mat is null) then
      v_raison := 'ligne incomplète (cadence ou coût matériaux figé absent)';
    end if;

    -- Résolution à trois niveaux : la dérogation de la ligne et le mode
    -- « ouvrage » l'emportent sur la condition globale demandée.
    v_rc := public.conditions_ligne_resoudre(l.mode_coefficient_ligne, l.coefficient_ligne_id, l.coefficient_ligne_valeur, l.coefficient_ligne_libelle,
              null::uuid, v_coef_glob, null::text,
              l.coefficient_vente_id, v_coef_orig, v_coef_orig_lib);
    v_rt := public.conditions_ligne_resoudre(l.mode_taux_horaire_ligne, l.taux_horaire_ligne_id, l.taux_horaire_ligne_valeur, l.taux_horaire_ligne_libelle,
              null::uuid, v_taux_glob, null::text,
              l.taux_horaire_vente_id, v_taux_orig, v_taux_orig_lib);
    v_coef_appl := nullif(v_rc->>'valeur', '')::numeric;
    v_taux_appl := nullif(v_rt->>'valeur', '')::numeric;
    if v_raison is null and v_coef_appl is null then
      v_raison := 'coefficient d''origine de l''ouvrage absent de la ligne';
    end if;
    if v_raison is null and v_taux_appl is null then
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

    v_prix_mat := round(v_cout_mat * v_coef_appl, 2);
    v_prix_dir := round(v_cout_dir * v_coef_appl, 2);
    v_prix_mo  := round(v_heures * v_taux_appl, 2);
    v_prix     := round(v_prix_mat + v_prix_dir + v_prix_mo, 2);
    v_marge_pct := case when v_cout_tot is not null and v_prix > 0 then round((v_prix - v_cout_tot) / v_prix * 100, 2) else null end;

    v_total_apres := v_total_apres + v_q * v_prix;
    if v_cout_tot is not null then v_marge_apres := v_marge_apres + v_q * (v_prix - v_cout_tot); else v_marge_connue := false; end if;

    -- Une ligne dérogatoire dont rien ne change n'est PAS présentée comme modifiée.
    v_change := l.prix_unitaire is distinct from v_prix
             or l.coef_vente is distinct from v_coef_appl
             or l.taux_horaire_vente is distinct from v_taux_appl
             or coalesce(l.coefficient_source, 'ouvrage') is distinct from (v_rc->>'source')
             or coalesce(l.taux_horaire_source, 'ouvrage') is distinct from (v_rt->>'source');
    if not v_change then
      v_nb_inchangees := v_nb_inchangees + 1;
      continue;
    end if;

    v_nb_recalc := v_nb_recalc + 1;
    v_lignes := v_lignes || jsonb_build_object(
      'id', l.id, 'item', l.item, 'zone', l.zone, 'quantite', v_q,
      'prix_avant', l.prix_unitaire, 'prix_apres', v_prix,
      'coef_avant', l.coef_vente, 'coef_apres', v_coef_appl,
      'taux_avant', l.taux_horaire_vente, 'taux_apres', v_taux_appl);

    if p_appliquer then
      update public.profero_ouvrages_selectionnes set
        coef_vente = v_coef_appl,
        taux_horaire_vente = v_taux_appl,
        coefficient_source = v_rc->>'source',
        taux_horaire_source = v_rt->>'source',
        coefficient_global_id = case when v_rc->>'source' = 'global_chiffrage' then (v_rc->>'id')::uuid end,
        taux_horaire_global_id = case when v_rt->>'source' = 'global_chiffrage' then (v_rt->>'id')::uuid end,
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
          'coefficient_applique', jsonb_build_object('valeur', v_coef_appl, 'source', v_rc->>'source', 'mode', l.mode_coefficient_ligne,
                                                     'global_id', case when v_rc->>'source' = 'global_chiffrage' then v_rc->>'id' end,
                                                     'libelle', v_rc->>'libelle'),
          'taux_origine', jsonb_build_object('id', l.taux_horaire_vente_id, 'valeur', v_taux_orig, 'libelle', v_taux_orig_lib),
          'taux_applique', jsonb_build_object('valeur', v_taux_appl, 'source', v_rt->>'source', 'mode', l.mode_taux_horaire_ligne,
                                              'global_id', case when v_rt->>'source' = 'global_chiffrage' then v_rt->>'id' end,
                                              'libelle', v_rt->>'libelle'),
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
      coefficient_global_id = null::uuid,
      coefficient_global_valeur = v_coef_glob,
      coefficient_global_libelle = null::text,
      mode_taux_horaire = v_mode_taux,
      taux_horaire_global_id = null::uuid,
      taux_horaire_global_valeur = v_taux_glob,
      taux_horaire_global_libelle = null::text,
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
      v_mode_coef, null::uuid, v_coef_glob, null::text,
      proj.mode_taux_horaire, proj.taux_horaire_global_id, proj.taux_horaire_global_valeur, proj.taux_horaire_global_libelle,
      v_mode_taux, null::uuid, v_taux_glob, null::text,
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
      'mode_coefficient', v_mode_coef, 'coefficient_id', null::uuid, 'coefficient_valeur', v_coef_glob, 'coefficient_libelle', null::text,
      'mode_taux_horaire', v_mode_taux, 'taux_id', null::uuid, 'taux_valeur', v_taux_glob, 'taux_libelle', null::text),
    'nb_lignes_recalculees', v_nb_recalc,
    'nb_lignes_ignorees', v_nb_ignorees,
    'nb_lignes_sans_snapshot', v_nb_sans_snapshot,
    'nb_lignes_inchangees', v_nb_inchangees,
    'nb_coefficients_specifiques', v_nb_coef_spec,
    'nb_taux_specifiques', v_nb_taux_spec,
    'nb_lignes_mode_ouvrage', v_nb_mode_ouvrage,
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
    'inchanges', jsonb_build_array('coûts matériaux, main-d''œuvre et direct figés', 'quantités et unités', 'cadences', 'compositions et zones', 'ouvrages de la bibliothèque',
                                   'dérogations de ligne (coefficient / taux spécifiques et mode ouvrage)'));
end;
$$;
revoke all on function public.conditions_chiffrage_evaluer(uuid, text, numeric, text, numeric, boolean, integer, text) from public, anon;
grant execute on function public.conditions_chiffrage_evaluer(uuid, text, numeric, text, numeric, boolean, integer, text) to authenticated;

-- Simulation : AUCUNE écriture.
create or replace function public.simuler_conditions_chiffrage(
  p_projet_id uuid, p_mode_coefficient text, p_coefficient_valeur numeric, p_mode_taux text, p_taux_valeur numeric)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select public.conditions_chiffrage_evaluer(p_projet_id, p_mode_coefficient, p_coefficient_valeur, p_mode_taux, p_taux_valeur, false, null, null);
$$;
revoke all on function public.simuler_conditions_chiffrage(uuid, text, numeric, text, numeric) from public, anon;
grant execute on function public.simuler_conditions_chiffrage(uuid, text, numeric, text, numeric) to authenticated;

-- Application atomique : version + hash contrôlés, tout ou rien.
create or replace function public.appliquer_conditions_chiffrage(
  p_projet_id uuid, p_mode_coefficient text, p_coefficient_valeur numeric, p_mode_taux text, p_taux_valeur numeric,
  p_version_attendue integer, p_hash_attendu text)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select public.conditions_chiffrage_evaluer(p_projet_id, p_mode_coefficient, p_coefficient_valeur, p_mode_taux, p_taux_valeur, true, p_version_attendue, p_hash_attendu);
$$;
revoke all on function public.appliquer_conditions_chiffrage(uuid, text, numeric, text, numeric, integer, text) from public, anon;
grant execute on function public.appliquer_conditions_chiffrage(uuid, text, numeric, text, numeric, integer, text) to authenticated;

-- ─── 3c) Conditions d'UNE LIGNE (valeur saisie) ────────────────────────────
create or replace function public.conditions_ligne_evaluer(
  p_projet_id uuid,
  p_ligne_id uuid,
  p_mode_coefficient text,
  p_coefficient_valeur numeric,
  p_mode_taux text,
  p_taux_valeur numeric,
  p_appliquer boolean,
  p_version_attendue integer default null,
  p_hash_attendu text default null,
  p_confirmer_prix_manuel boolean default false,
  p_confirmer_conversion_v1 boolean default false
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  proj    public.profero_projets;
  l       public.profero_ouvrages_selectionnes;
  v_mode_coef text := coalesce(nullif(p_mode_coefficient, ''), 'heritage');
  v_mode_taux text := coalesce(nullif(p_mode_taux, ''), 'heritage');
  v_hash  text;
  v_now   timestamptz := now();
  v_iso   text;
  v_version integer;
  v_detail jsonb;
  v_heures numeric; v_cout_mat numeric; v_cout_dir numeric; v_cout_tot numeric;
  v_coef_orig numeric; v_coef_orig_lib text; v_coef_orig_id uuid;
  v_taux_orig numeric; v_taux_orig_lib text; v_taux_orig_id uuid;
  v_spec_coef_valeur numeric; v_spec_coef_lib text;
  v_spec_taux_valeur numeric; v_spec_taux_lib text;
  v_rc jsonb; v_rt jsonb;
  v_coef_appl numeric; v_taux_appl numeric;
  v_prix_mat numeric; v_prix_dir numeric; v_prix_mo numeric; v_prix numeric;
  v_marge_pct numeric; v_marge_u numeric;
  v_q numeric;
  v_prix_manuel boolean; v_v1 boolean;
  v_possible boolean := true; v_blocage text;
  v_confirmations text[] := '{}';
  v_avertissements text[] := '{}';
  v_change boolean;
  v_total_avant numeric; v_total_apres numeric;
  v_mode_coef_avant text; v_mode_taux_avant text;
begin
  if auth.uid() is null then raise exception 'Utilisateur non authentifié : modification impossible.'; end if;
  if v_mode_coef not in ('heritage', 'ouvrage', 'specifique') or v_mode_taux not in ('heritage', 'ouvrage', 'specifique') then
    raise exception 'Mode invalide (heritage, ouvrage ou specifique attendu).';
  end if;

  -- Projet puis ligne, toujours dans cet ordre (pas d'interblocage). La RLS
  -- bureau_all filtre : un ouvrier ne voit ni projet ni ligne.
  if p_appliquer then
    select * into proj from public.profero_projets where id = p_projet_id for update;
  else
    select * into proj from public.profero_projets where id = p_projet_id;
  end if;
  if not found then raise exception 'Chiffrage introuvable ou non accessible.'; end if;
  if proj.statut = 'signe' then raise exception 'Chiffrage signé : ses conditions de vente ne sont plus modifiables.'; end if;

  if p_appliquer then
    select * into l from public.profero_ouvrages_selectionnes where id = p_ligne_id for update;
  else
    select * into l from public.profero_ouvrages_selectionnes where id = p_ligne_id;
  end if;
  if not found then raise exception 'Ligne introuvable ou non accessible.'; end if;
  if l.projet_id is distinct from p_projet_id then
    raise exception 'Cette ligne appartient à un autre chiffrage : modification refusée.';
  end if;

  if proj.progbat_devis_id is not null then
    v_avertissements := array_append(v_avertissements, 'Un brouillon ProGBat existe déjà pour ce logement (id ' || proj.progbat_devis_id || ') : il ne sera PAS actualisé automatiquement.');
  end if;

  -- Dérogations demandées : VALEURS SAISIES, strictement positives, arrondies
  -- comme les colonnes. Aucune liste, donc aucun libellé de référentiel.
  if v_mode_coef = 'specifique' then
    if p_coefficient_valeur is null then raise exception 'Coefficient spécifique non renseigné.'; end if;
    if p_coefficient_valeur <= 0 then raise exception 'Coefficient spécifique invalide (nul ou négatif).'; end if;
    v_spec_coef_valeur := round(p_coefficient_valeur, 4);
    v_spec_coef_lib := null;
  end if;
  if v_mode_taux = 'specifique' then
    if p_taux_valeur is null then raise exception 'Taux horaire spécifique non renseigné.'; end if;
    if p_taux_valeur <= 0 then raise exception 'Taux horaire spécifique invalide (nul ou négatif).'; end if;
    v_spec_taux_valeur := round(p_taux_valeur, 2);
    v_spec_taux_lib := null;
  end if;

  -- Concurrence : version du projet + hash (ligne figée, prix, modes, globaux,
  -- options demandées et leur valeur actuelle dans les Réglages).
  v_hash := public.conditions_ligne_hash(p_ligne_id, v_mode_coef, v_spec_coef_valeur, v_mode_taux, v_spec_taux_valeur);
  if p_appliquer then
    if p_version_attendue is null or p_version_attendue <> proj.conditions_version then
      raise exception 'Le chiffrage a été modifié depuis la simulation (version % attendue, % actuelle) : relancer la simulation.', p_version_attendue, proj.conditions_version;
    end if;
    if p_hash_attendu is null or p_hash_attendu <> v_hash then
      raise exception 'Cette ligne (ou une option choisie) a changé depuis la simulation : relancer la simulation.';
    end if;
  end if;

  -- État figé de la ligne
  v_detail := coalesce(l.calcul_detail, '{}'::jsonb);
  v_q := coalesce(public.safe_numeric(l.quantite), 0);
  v_prix_manuel := coalesce(l.calcul_version, '') = '';
  v_v1 := not v_prix_manuel and coalesce(split_part(l.calcul_version, '@', 1), '0')::int < 2;
  v_heures := nullif(v_detail->>'heures_unitaires', '')::numeric;
  v_cout_mat := l.cout_materiaux_unitaire;
  v_cout_dir := coalesce(l.cout_direct_unitaire, 0);
  v_cout_tot := l.cout_total_unitaire;
  v_mode_coef_avant := l.mode_coefficient_ligne;
  v_mode_taux_avant := l.mode_taux_horaire_ligne;

  -- Origine FIGÉE de l'ouvrage (jamais rechargée depuis la bibliothèque)
  v_coef_orig_id  := l.coefficient_vente_id;
  v_coef_orig     := coalesce(l.coefficient_origine_valeur, case when l.coefficient_source is null or l.coefficient_source = 'ouvrage' then l.coef_vente end);
  v_coef_orig_lib := coalesce(l.coefficient_origine_libelle, case when l.coefficient_source is null or l.coefficient_source = 'ouvrage' then v_detail->>'coefficient_vente_libelle' end);
  v_taux_orig_id  := l.taux_horaire_vente_id;
  v_taux_orig     := coalesce(l.taux_horaire_origine_valeur, case when l.taux_horaire_source is null or l.taux_horaire_source = 'ouvrage' then l.taux_horaire_vente end);
  v_taux_orig_lib := coalesce(l.taux_horaire_origine_libelle, case when l.taux_horaire_source is null or l.taux_horaire_source = 'ouvrage' then v_detail->>'taux_horaire_vente_libelle' end);

  v_rc := public.conditions_ligne_resoudre(v_mode_coef, null::uuid, v_spec_coef_valeur, v_spec_coef_lib,
            case when proj.mode_coefficient = 'global' then proj.coefficient_global_id end, case when proj.mode_coefficient = 'global' then proj.coefficient_global_valeur end, case when proj.mode_coefficient = 'global' then proj.coefficient_global_libelle end,
            v_coef_orig_id, v_coef_orig, v_coef_orig_lib);
  v_rt := public.conditions_ligne_resoudre(v_mode_taux, null::uuid, v_spec_taux_valeur, v_spec_taux_lib,
            case when proj.mode_taux_horaire = 'global' then proj.taux_horaire_global_id end, case when proj.mode_taux_horaire = 'global' then proj.taux_horaire_global_valeur end, case when proj.mode_taux_horaire = 'global' then proj.taux_horaire_global_libelle end,
            v_taux_orig_id, v_taux_orig, v_taux_orig_lib);
  v_coef_appl := nullif(v_rc->>'valeur', '')::numeric;
  v_taux_appl := nullif(v_rt->>'valeur', '')::numeric;

  -- Blocages : on n'invente jamais un coût, une cadence, un coefficient ni un taux.
  if v_heures is null or v_cout_mat is null then
    v_possible := false;
    v_blocage := case when v_prix_manuel
      then 'Cette ligne n''a aucun calcul figé (prix saisi à la main) : ' else 'Ligne incomplète : ' end
      || concat_ws(' et ',
           case when v_heures is null then 'la cadence figée (heures par unité) est absente' end,
           case when v_cout_mat is null then 'le coût matériaux figé est absent' end)
      || '. Ajouter l''ouvrage depuis la bibliothèque (ou l''actualiser) pour disposer des données de calcul.';
  elsif v_coef_appl is null then
    v_possible := false;
    v_blocage := case when v_mode_coef = 'specifique' then 'Coefficient spécifique absent ou invalide.'
                      else 'Le coefficient d''origine de l''ouvrage n''est pas figé sur cette ligne : choisir un coefficient spécifique, ou actualiser la ligne depuis la bibliothèque.' end;
  elsif v_taux_appl is null then
    v_possible := false;
    v_blocage := case when v_mode_taux = 'specifique' then 'Taux horaire spécifique absent ou invalide.'
                      else 'Le taux horaire d''origine de l''ouvrage n''est pas figé sur cette ligne : choisir un taux spécifique, ou actualiser la ligne depuis la bibliothèque.' end;
  end if;

  if v_possible then
    v_prix_mat := round(v_cout_mat * v_coef_appl, 2);
    v_prix_dir := round(v_cout_dir * v_coef_appl, 2);
    v_prix_mo  := round(v_heures * v_taux_appl, 2);
    v_prix     := round(v_prix_mat + v_prix_dir + v_prix_mo, 2);
    v_marge_u  := case when v_cout_tot is not null then round(v_prix - v_cout_tot, 2) end;
    v_marge_pct := case when v_cout_tot is not null and v_prix > 0 then round((v_prix - v_cout_tot) / v_prix * 100, 2) end;
    if v_prix_manuel then v_confirmations := array_append(v_confirmations, 'prix_manuel'); end if;
    if v_v1 then v_confirmations := array_append(v_confirmations, 'conversion_v1'); end if;
  end if;

  v_change := v_possible and (
       l.prix_unitaire is distinct from v_prix
    or l.coef_vente is distinct from v_coef_appl
    or l.taux_horaire_vente is distinct from v_taux_appl
    or coalesce(l.coefficient_source, 'ouvrage') is distinct from (v_rc->>'source')
    or coalesce(l.taux_horaire_source, 'ouvrage') is distinct from (v_rt->>'source')
    or v_mode_coef_avant is distinct from v_mode_coef
    or v_mode_taux_avant is distinct from v_mode_taux);

  v_total_avant := round(v_q * coalesce(l.prix_unitaire, 0), 2);
  v_total_apres := case when v_possible then round(v_q * v_prix, 2) else v_total_avant end;
  v_iso := to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_version := proj.conditions_version;

  -- ─── Application ───────────────────────────────────────────────────────
  if p_appliquer then
    if not v_possible then raise exception '%', v_blocage; end if;
    if v_prix_manuel and not coalesce(p_confirmer_prix_manuel, false) then
      raise exception 'Cette ligne utilise un prix de vente saisi manuellement : la conversion en prix calculé doit être confirmée explicitement.';
    end if;
    if v_v1 and not coalesce(p_confirmer_conversion_v1, false) then
      raise exception 'Cette ligne utilise l''ancienne formule de calcul (v1) : le passage au calcul actuel doit être confirmé explicitement.';
    end if;
    if not v_change then raise exception 'Aucun changement à appliquer sur cette ligne.'; end if;

    update public.profero_ouvrages_selectionnes set
      mode_coefficient_ligne = v_mode_coef,
      coefficient_ligne_id = null::uuid,
      coefficient_ligne_valeur = case when v_mode_coef = 'specifique' then v_spec_coef_valeur end,
      coefficient_ligne_libelle = case when v_mode_coef = 'specifique' then v_spec_coef_lib end,
      mode_taux_horaire_ligne = v_mode_taux,
      taux_horaire_ligne_id = null::uuid,
      taux_horaire_ligne_valeur = case when v_mode_taux = 'specifique' then v_spec_taux_valeur end,
      taux_horaire_ligne_libelle = case when v_mode_taux = 'specifique' then v_spec_taux_lib end,
      coef_vente = v_coef_appl,
      taux_horaire_vente = v_taux_appl,
      coefficient_source = v_rc->>'source',
      taux_horaire_source = v_rt->>'source',
      coefficient_global_id = case when v_rc->>'source' = 'global_chiffrage' then (v_rc->>'id')::uuid end,
      taux_horaire_global_id = case when v_rt->>'source' = 'global_chiffrage' then (v_rt->>'id')::uuid end,
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
        'coefficient_origine', jsonb_build_object('id', v_coef_orig_id, 'valeur', v_coef_orig, 'libelle', v_coef_orig_lib),
        'coefficient_applique', jsonb_build_object('valeur', v_coef_appl, 'source', v_rc->>'source', 'mode', v_mode_coef,
                                                   'global_id', case when v_rc->>'source' = 'global_chiffrage' then v_rc->>'id' end,
                                                   'libelle', v_rc->>'libelle',
                                                   'specifique', case when v_mode_coef = 'specifique' then jsonb_build_object('id', null, 'valeur', v_spec_coef_valeur, 'libelle', v_spec_coef_lib) end),
        'taux_origine', jsonb_build_object('id', v_taux_orig_id, 'valeur', v_taux_orig, 'libelle', v_taux_orig_lib),
        'taux_applique', jsonb_build_object('valeur', v_taux_appl, 'source', v_rt->>'source', 'mode', v_mode_taux,
                                            'global_id', case when v_rt->>'source' = 'global_chiffrage' then v_rt->>'id' end,
                                            'libelle', v_rt->>'libelle',
                                            'specifique', case when v_mode_taux = 'specifique' then jsonb_build_object('id', null, 'valeur', v_spec_taux_valeur, 'libelle', v_spec_taux_lib) end),
        'recalcul_conditions_ligne_le', v_iso)
        || case when v_v1 then jsonb_build_object('converti_v1_le', v_iso) else '{}'::jsonb end
        || case when v_prix_manuel then jsonb_build_object('prix_manuel_remplace', l.prix_unitaire, 'prix_manuel_remplace_le', v_iso) else '{}'::jsonb end
    where id = p_ligne_id and projet_id = p_projet_id;
    if not found then raise exception 'Modification refusée : ligne non modifiable pour cet utilisateur.'; end if;

    v_version := proj.conditions_version + 1;
    update public.profero_projets set conditions_version = v_version, updated_at = v_now where id = p_projet_id;
    if not found then raise exception 'Modification refusée : chiffrage non modifiable pour cet utilisateur.'; end if;

    insert into public.chiffrage_ligne_conditions_historique (
      projet_id, ligne_id, bibliotheque_id, item, zone, utilisateur_email, date,
      ancien_mode_coefficient, nouveau_mode_coefficient, ancien_coefficient_id, nouveau_coefficient_id,
      ancien_coefficient, nouveau_coefficient, ancien_coefficient_libelle, nouveau_coefficient_libelle,
      ancienne_source_coefficient, nouvelle_source_coefficient,
      ancien_mode_taux, nouveau_mode_taux, ancien_taux_id, nouveau_taux_id,
      ancien_taux, nouveau_taux, ancien_taux_libelle, nouveau_taux_libelle,
      ancienne_source_taux, nouvelle_source_taux,
      ancien_prix_unitaire, nouveau_prix_unitaire, ancienne_marge_pct, nouvelle_marge_pct,
      ancienne_marge_unitaire, nouvelle_marge_unitaire,
      prix_manuel_remplace, conversion_v1, ancienne_calcul_version, nouvelle_calcul_version,
      version_avant, version_apres)
    values (
      p_projet_id, p_ligne_id, l.bibliotheque_id, l.item, l.zone, auth.email(), v_now,
      v_mode_coef_avant, v_mode_coef, l.coefficient_ligne_id, null::uuid,
      l.coef_vente, v_coef_appl, l.coefficient_ligne_libelle, case when v_mode_coef = 'specifique' then v_spec_coef_lib end,
      l.coefficient_source, v_rc->>'source',
      v_mode_taux_avant, v_mode_taux, l.taux_horaire_ligne_id, null::uuid,
      l.taux_horaire_vente, v_taux_appl, l.taux_horaire_ligne_libelle, case when v_mode_taux = 'specifique' then v_spec_taux_lib end,
      l.taux_horaire_source, v_rt->>'source',
      l.prix_unitaire, v_prix, l.taux_marge_pct, v_marge_pct,
      case when l.prix_unitaire is not null and v_cout_tot is not null then round(l.prix_unitaire - v_cout_tot, 2) end, v_marge_u,
      v_prix_manuel, v_v1, l.calcul_version, '2@' || v_iso,
      proj.conditions_version, v_version);
  end if;

  return jsonb_build_object(
    'ok', true,
    'applique', p_appliquer,
    'projet_id', p_projet_id,
    'ligne_id', p_ligne_id,
    'item', l.item, 'zone', l.zone, 'quantite', v_q,
    'version', v_version,
    'version_attendue', proj.conditions_version,
    'hash_ligne', v_hash,
    'possible', v_possible,
    'blocage', v_blocage,
    'prix_manuel', v_prix_manuel,
    'conversion_v1', v_v1,
    'confirmations_requises', to_jsonb(v_confirmations),
    'change', v_change,
    'avant', jsonb_build_object(
      'mode_coefficient', v_mode_coef_avant, 'coefficient', l.coef_vente, 'coefficient_libelle', coalesce(l.coefficient_ligne_libelle, v_detail->'coefficient_applique'->>'libelle', v_coef_orig_lib), 'coefficient_source', coalesce(l.coefficient_source, 'ouvrage'),
      'mode_taux', v_mode_taux_avant, 'taux', l.taux_horaire_vente, 'taux_libelle', coalesce(l.taux_horaire_ligne_libelle, v_detail->'taux_applique'->>'libelle', v_taux_orig_lib), 'taux_source', coalesce(l.taux_horaire_source, 'ouvrage'),
      'prix_unitaire', l.prix_unitaire, 'taux_marge_pct', l.taux_marge_pct,
      'marge_unitaire', case when l.prix_unitaire is not null and v_cout_tot is not null then round(l.prix_unitaire - v_cout_tot, 2) end,
      'total_ht', v_total_avant),
    'apres', jsonb_build_object(
      'mode_coefficient', v_mode_coef, 'coefficient', v_coef_appl, 'coefficient_libelle', v_rc->>'libelle', 'coefficient_source', v_rc->>'source',
      'mode_taux', v_mode_taux, 'taux', v_taux_appl, 'taux_libelle', v_rt->>'libelle', 'taux_source', v_rt->>'source',
      'prix_unitaire', v_prix, 'taux_marge_pct', v_marge_pct, 'marge_unitaire', v_marge_u, 'total_ht', v_total_apres,
      'prix_materiaux_unitaire', v_prix_mat, 'prix_direct_unitaire', v_prix_dir, 'prix_main_oeuvre_unitaire', v_prix_mo),
    'origine', jsonb_build_object('coefficient', v_coef_orig, 'coefficient_libelle', v_coef_orig_lib, 'taux', v_taux_orig, 'taux_libelle', v_taux_orig_lib),
    'globale', jsonb_build_object(
      'mode_coefficient', proj.mode_coefficient, 'coefficient', proj.coefficient_global_valeur, 'coefficient_libelle', proj.coefficient_global_libelle,
      'mode_taux_horaire', proj.mode_taux_horaire, 'taux', proj.taux_horaire_global_valeur, 'taux_libelle', proj.taux_horaire_global_libelle),
    'total_projet_avant', (select round(coalesce(sum(coalesce(public.safe_numeric(o.quantite), 0) * o.prix_unitaire), 0), 2) from public.profero_ouvrages_selectionnes o where o.projet_id = p_projet_id and o.prix_unitaire is not null),
    'avertissements', to_jsonb(v_avertissements),
    'devis_progbat_id', proj.progbat_devis_id,
    'inchanges', jsonb_build_array('coûts matériaux, main-d''œuvre et direct figés', 'cadence figée', 'quantité et unité', 'zone et TVA', 'autres lignes du chiffrage', 'autres chiffrages', 'ouvrages de la bibliothèque'));
end;
$$;
revoke all on function public.conditions_ligne_evaluer(uuid, uuid, text, numeric, text, numeric, boolean, integer, text, boolean, boolean) from public, anon;
grant execute on function public.conditions_ligne_evaluer(uuid, uuid, text, numeric, text, numeric, boolean, integer, text, boolean, boolean) to authenticated;

-- Simulation d'UNE ligne : aucune écriture.
create or replace function public.simuler_conditions_ligne(
  p_projet_id uuid, p_ligne_id uuid, p_mode_coefficient text, p_coefficient_valeur numeric, p_mode_taux text, p_taux_valeur numeric)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select public.conditions_ligne_evaluer(p_projet_id, p_ligne_id, p_mode_coefficient, p_coefficient_valeur, p_mode_taux, p_taux_valeur, false, null, null, false, false);
$$;
revoke all on function public.simuler_conditions_ligne(uuid, uuid, text, numeric, text, numeric) from public, anon;
grant execute on function public.simuler_conditions_ligne(uuid, uuid, text, numeric, text, numeric) to authenticated;

-- Application atomique d'UNE ligne : version + hash contrôlés, tout ou rien.
-- Le navigateur transmet un mode et, en mode « specifique », la valeur saisie ;
-- jamais un prix ni une marge, qui restent calculés ici depuis les données figées.
create or replace function public.appliquer_conditions_ligne(
  p_projet_id uuid, p_ligne_id uuid, p_mode_coefficient text, p_coefficient_valeur numeric, p_mode_taux text, p_taux_valeur numeric,
  p_version_attendue integer, p_hash_attendu text,
  p_confirmer_prix_manuel boolean default false, p_confirmer_conversion_v1 boolean default false)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select public.conditions_ligne_evaluer(p_projet_id, p_ligne_id, p_mode_coefficient, p_coefficient_valeur, p_mode_taux, p_taux_valeur, true,
                                         p_version_attendue, p_hash_attendu, p_confirmer_prix_manuel, p_confirmer_conversion_v1);
$$;
revoke all on function public.appliquer_conditions_ligne(uuid, uuid, text, numeric, text, numeric, integer, text, boolean, boolean) from public, anon;
grant execute on function public.appliquer_conditions_ligne(uuid, uuid, text, numeric, text, numeric, integer, text, boolean, boolean) to authenticated;

-- ─── 4) Contrôles après exécution (à lancer à la main si besoin) ───────────
-- select count(*) filter (where coefficient_vente_valeur is null) sans_coef,
--        count(*) filter (where taux_horaire_vente_valeur is null) sans_taux,
--        count(*) total from public.bibliotheque_ratios;
-- select libelle, coefficient_vente_valeur, taux_horaire_vente_valeur from public.bibliotheque_ratios order by libelle limit 20;
