-- =====================================================================
-- ESPACE OUVRIER — Bêta « Mes phases » (étape 1, LECTURE SEULE)
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller).
-- Idempotent : create or replace function, aucune donnée modifiée.
-- Ne touche à AUCUNE fonction existante (ouvrier_preparation_chantier,
-- ouvrier_taches_actives, ouvrier_chantier_detail restent intactes) ni à
-- AUCUNE policy (les listes blanches de planning_config sont inchangées).
--
-- Trois fonctions :
--   1. _beta_autorise(code, prenom)        interne, jamais appelable par l'API
--   2. mes_fonctionnalites_beta(p_prenom)   « à quoi ai-je accès ? »
--   3. ouvrier_mes_phases(chantier, prenom, aujourdhui)
--                                           phases → ouvrages → tâches + heures
--
-- ─────────────────────────────────────────────────────────────────────
-- 1) LE RÉGLAGE BÊTA
-- ─────────────────────────────────────────────────────────────────────
-- Stocké dans planning_config, clé « fonctionnalites_beta », rangé PAR CODE
-- de fonctionnalité (d'autres bêtas suivront : le nouveau compte rendu) :
--     { "mes_phases": ["Kev", "Davy"] }
-- Les valeurs sont des prénoms-planning (utilisateurs.prenom_planning),
-- comparés avec norm_prenom() (accents, casse et espaces ignorés).
--
-- Écriture : le bureau seulement, par la policy existante config_bureau_all
-- (l'Admin coche « Bêta : Mes phases » sur la fiche de l'ouvrier).
--
-- Lecture par l'ouvrier : PAS par la liste blanche config_ouvrier_sel.
-- Pourquoi : la clé contient la liste de TOUS les bêta-testeurs ; l'ouvrir
-- en lecture montrerait à chacun qui d'autre est testeur, et l'écran
-- devrait filtrer lui-même. La fonction mes_fonctionnalites_beta() ne
-- renvoie que SES codes, rien d'autre — et ouvrier_mes_phases s'appuie sur
-- la même règle côté serveur : un ouvrier non bêta-testeur qui appellerait
-- la RPC directement n'obtient rien. Les deux fichiers de liste blanche
-- (202609_planning_config_liste_blanche.sql et
-- 202609_planning_config_operations_ouvrier.sql) ne sont donc pas touchés
-- et restent cohérents entre eux.
--
-- ─────────────────────────────────────────────────────────────────────
-- 2) SOURCES DE LA RPC ouvrier_mes_phases
-- ─────────────────────────────────────────────────────────────────────
--   phasage, phases, ouvrages, tâches
--       même résolution et même construction que
--       ouvrier_preparation_chantier (chantier_id exact, sinon homonyme
--       UNIQUE ; chrono_groupes ; « À organiser » pour toute tâche sans
--       groupe valide). Code repris, fonction d'origine non modifiée.
--   heures vendues
--       tâche   : taches[].heures_vendues (tacheHeuresVendues)
--       ouvrage : ouvrages[].heures_devis (heuresVenduesOuvrage — la valeur
--                 de la fiche chantier bureau et de l'onglet Opérations).
--       Aucune répartition inventée : une tâche sans heures vendues dans un
--       ouvrage qui en a reste SANS jauge, l'ouvrage porte les heures.
--   heures validées
--       registre pointages, type 'tache', même chantier, même tache_id —
--       repli sur l'ancien champ taches[].heures_reelles si la tâche n'a
--       AUCUN pointage : c'est la règle de tacheHeuresReelles
--       (chantierFinance), donc le même chiffre que l'onglet Opérations.
--   heures en attente
--       rapports du chantier dont statut <> 'valide', lignes taches[] dont
--       tache_id = id de la tâche, champ heures_reelles. Un rapport qui a
--       déjà des pointages (dévalidation en cours) est écarté : ses heures
--       sont déjà dans le registre, jamais deux fois.
--   mes heures
--       pointages.ouvrier = mon prénom + rapports en attente
--       rapports.ouvrier = mon prénom. Un total, jamais le détail des
--       collègues. L'ancien champ heures_reelles n'est pas attribuable à une
--       personne : il ne compte pas dans « mes heures ».
--   affectation (« est_mienne »)
--       MÊME règle que ouvrier_taches_actives : dernière occurrence de la
--       tâche dans planning_cells dont la date <= p_aujourdhui (ouvriers de
--       la ligne, sinon de la cellule), repli sur taches[].ouvriers du
--       phasage. Comparaison exacte du prénom, comme là-bas.
--   dernier motif de dépassement (ajout du 06/10/2026, étape 2 « cr_v2 »)
--       la ligne de compte rendu la plus récente (submitted_at) du chantier
--       qui porte un motif_depassement pour cette tâche, QUEL QUE SOIT
--       l'ouvrier : { code, date } — jamais le nom de qui l'a donné. Le
--       nouveau compte rendu propose de le reprendre (visible, changeable).
--   tâches hors devis (ajout du 06/10/2026, étape 3b)
--       hors_devis_marque = champ explicite taches[].hors_devis (posé par le
--       conducteur) : seules ces tâches sortent des totaux comparés au vendu
--       et de l'avancement (mesPhasesV1). hors_devis reste l'indicateur
--       d'AFFICHAGE (marquée OU sans heures vendues dans Divers / un ouvrage
--       sans heures vendues). nature et cree_par : tâche ajoutée hors devis
--       initial (« Ajoutée par … · nature »).
--
-- QUI PEUT APPELER (ouvrier) : les bêta-testeurs de « mes_phases » (onglet
-- Phases) OU de « cr_v2 » (nouveau compte rendu, qui en lit les heures
-- vendues / validées / en attente pour la jauge de dépassement).
--
-- Les totaux par ouvrage et par phase, l'avancement pondéré et les statuts
-- ne sont PAS calculés ici : le module pur src/Renovation/mesPhasesV1.mjs
-- les calcule avec les fonctions de chantierFinance (avancementOuvrage,
-- statsGroupeChrono, SEUIL_RATIO_DERIVE). Une seule implémentation des
-- pondérations dans l'application, pas une seconde en SQL.
--
-- ⚠ AUCUNE DONNÉE FINANCIÈRE NE DOIT SORTIR D'ICI.
--   Les objets lus portent prix_ht, cout_materiaux, ratio, taux_horaire…
--   Le payload est construit CHAMP PAR CHAMP (pas de to_jsonb(objet), pas
--   de || avec un objet source). scripts/verif-ouvrier-mes-phases.sql
--   contrôle récursivement les clés RÉELLES du payload.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Helper interne : un prénom a-t-il accès à un code bêta ?
-- ---------------------------------------------------------------------
-- Pas de garde d'appelant ici : la fonction n'est exécutable par AUCUN
-- rôle de l'API (revoke ci-dessous). Seules les deux fonctions SECURITY
-- DEFINER de ce fichier l'appellent, avec les droits de leur propriétaire.
create or replace function public._beta_autorise(p_code text, p_prenom text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select exists (
      select 1
      from jsonb_array_elements_text(
        case when jsonb_typeof(pc.value -> p_code) = 'array'
             then pc.value -> p_code else '[]'::jsonb end
      ) e(prenom)
      where public.norm_prenom(e.prenom) = public.norm_prenom(p_prenom)
        and public.norm_prenom(p_prenom) <> ''
    )
    from public.planning_config pc
    where pc.key = 'fonctionnalites_beta'
      and jsonb_typeof(pc.value) = 'object'
  ), false);
$$;

revoke all on function public._beta_autorise(text, text) from public;
revoke all on function public._beta_autorise(text, text) from anon;
revoke all on function public._beta_autorise(text, text) from authenticated;


-- ---------------------------------------------------------------------
-- 2. « Ai-je accès ? » — codes bêta actifs pour l'appelant
-- ---------------------------------------------------------------------
-- Ouvrier : toujours SON prénom-planning, p_prenom ignoré.
-- Bureau  : p_prenom honoré (aperçu « vue collaborateur » de l'Admin).
-- Renvoie un tableau JSON de codes, ex. ["mes_phases"]. Jamais la liste
-- des autres testeurs.
create or replace function public.mes_fonctionnalites_beta(p_prenom text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_prenom text;
  v_out    jsonb;
begin
  if auth.email() is null or public.mon_role() is null then
    return '[]'::jsonb;
  end if;

  if public.est_ouvrier() then
    v_prenom := public.mon_prenom_planning();
  else
    v_prenom := nullif(trim(p_prenom), '');
  end if;
  if v_prenom is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(k.code order by k.code), '[]'::jsonb)
    into v_out
  from public.planning_config pc
  cross join lateral jsonb_object_keys(
    case when jsonb_typeof(pc.value) = 'object' then pc.value else '{}'::jsonb end
  ) k(code)
  where pc.key = 'fonctionnalites_beta'
    and public._beta_autorise(k.code, v_prenom);

  return coalesce(v_out, '[]'::jsonb);
end;
$$;

revoke all on function public.mes_fonctionnalites_beta(text) from public;
revoke all on function public.mes_fonctionnalites_beta(text) from anon;
grant execute on function public.mes_fonctionnalites_beta(text) to authenticated;

comment on function public.mes_fonctionnalites_beta(text) is
  'Codes des fonctionnalités bêta ouvertes à l''appelant (ouvrier : son prénom-planning ; bureau : p_prenom, pour l''aperçu). Réglage : planning_config/fonctionnalites_beta.';


-- ---------------------------------------------------------------------
-- 3. Mes phases — phases → ouvrages → tâches, avec les heures
-- ---------------------------------------------------------------------
create or replace function public.ouvrier_mes_phases(
  p_chantier_id text,
  p_prenom      text default null,
  p_aujourdhui  date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ph              record;
  v_prenom        text;
  v_chantier_nom  text;
  v_nb_homonymes  int    := 0;
  v_ouvrages      jsonb  := '[]'::jsonb;
  v_plan          jsonb  := '{}'::jsonb;
  v_groupes       jsonb  := '[]'::jsonb;
  v_modele        text;
  v_nb_v1         int    := 0;
  v_phases        jsonb  := '[]'::jsonb;
begin
  -- ── Garde d'appelant (identique aux autres RPC ouvrier) ─────────────
  if auth.email() is null or public.mon_role() is null then
    return null;
  end if;
  if coalesce(trim(p_chantier_id), '') = '' then
    return null;
  end if;

  -- Ouvrier : toujours SON prénom. Bureau : prénom passé (aperçu Admin).
  if public.est_ouvrier() then
    v_prenom := public.mon_prenom_planning();
    -- Bêta : un ouvrier hors liste n'obtient rien, même en appelant la RPC
    -- directement. Le bureau n'est pas filtré (aperçu, contrôle).
    if not (public._beta_autorise('mes_phases', v_prenom)
            or public._beta_autorise('cr_v2', v_prenom)) then
      return jsonb_build_object('chantier_id', p_chantier_id, 'acces_refuse', true);
    end if;
  else
    v_prenom := nullif(trim(p_prenom), '');
  end if;

  select c.value->>'nom' into v_chantier_nom
  from public.planning_config pc
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(pc.value) = 'array' then pc.value else '[]'::jsonb end
  ) c(value)
  where pc.key = 'chantiers'
    and c.value->>'id' = p_chantier_id
  limit 1;

  -- ── Résolution du phasage — reprise de ouvrier_preparation_chantier ──
  select p.id, p.chantier_nom, p.ouvrages, p.plan_travaux
    into ph
  from public.phasages p
  where p.chantier_id = p_chantier_id
  limit 1;

  if ph.id is null and coalesce(trim(v_chantier_nom), '') <> '' then
    select count(*) into v_nb_homonymes
    from public.phasages p
    where lower(trim(p.chantier_nom)) = lower(trim(v_chantier_nom));

    if v_nb_homonymes = 1 then
      select p.id, p.chantier_nom, p.ouvrages, p.plan_travaux
        into ph
      from public.phasages p
      where lower(trim(p.chantier_nom)) = lower(trim(v_chantier_nom))
      limit 1;
    elsif v_nb_homonymes > 1 then
      return jsonb_build_object(
        'chantier_id', p_chantier_id, 'chantier_nom', v_chantier_nom,
        'phasage_id', null, 'modele', 'ambigu', 'prenom', v_prenom,
        'phases', '[]'::jsonb);
    end if;
  end if;

  if ph.id is null then
    return jsonb_build_object(
      'chantier_id', p_chantier_id, 'chantier_nom', v_chantier_nom,
      'phasage_id', null, 'modele', 'absent', 'prenom', v_prenom,
      'phases', '[]'::jsonb);
  end if;

  v_ouvrages := case when jsonb_typeof(ph.ouvrages) = 'array' then ph.ouvrages else '[]'::jsonb end;
  v_plan     := case when jsonb_typeof(ph.plan_travaux) = 'object' then ph.plan_travaux else '{}'::jsonb end;
  v_groupes  := case when jsonb_typeof(v_plan->'meta'->'chrono_groupes') = 'array'
                     then v_plan->'meta'->'chrono_groupes' else '[]'::jsonb end;

  select coalesce(sum(jsonb_array_length(e.value)), 0) into v_nb_v1
  from jsonb_each(v_plan) e(key, value)
  where e.key <> 'meta' and jsonb_typeof(e.value) = 'array';

  if jsonb_array_length(v_ouvrages) > 0 then
    v_modele := 'v2';
  elsif v_nb_v1 > 0 then
    v_modele := 'legacy_v1';
  else
    v_modele := 'vide';
  end if;

  if v_modele <> 'v2' then
    return jsonb_build_object(
      'chantier_id', p_chantier_id,
      'chantier_nom', coalesce(v_chantier_nom, ph.chantier_nom),
      'phasage_id', ph.id, 'modele', v_modele, 'prenom', v_prenom,
      'phases', '[]'::jsonb);
  end if;

  -- ── Construction v2 ─────────────────────────────────────────────────
  with
  grp as (
    select
      g.value->>'id'                                            as id,
      coalesce(nullif(trim(g.value->>'nom'), ''), 'Groupe')      as nom,
      case when (g.value->>'ordre') ~ '^-?[0-9]+(\.[0-9]+)?$'
           then (g.value->>'ordre')::numeric else 999998 end     as ordre,
      coalesce(nullif(trim(g.value->>'couleur'), ''), '#94a3b8') as couleur,
      g.ordinality                                               as rang_source
    from jsonb_array_elements(v_groupes) with ordinality g(value, ordinality)
    where coalesce(trim(g.value->>'id'), '') <> ''
  ),
  ouv as (
    select
      o.ordinality as rang_ouvrage,
      o.value      as data,
      case when (o.value->>'quantite') ~ '^-?[0-9]+([.,][0-9]+)?$'
           then replace(o.value->>'quantite', ',', '.')::numeric else null end as quantite,
      case when (o.value->>'heures_devis') ~ '^-?[0-9]+([.,][0-9]+)?$'
           then replace(o.value->>'heures_devis', ',', '.')::numeric else 0 end as heures_devis
    from jsonb_array_elements(v_ouvrages) with ordinality o(value, ordinality)
  ),
  tache as (
    select
      ouv.rang_ouvrage,
      t.ordinality as rang_tache,
      t.value      as data,
      t.value->>'id' as tache_id,
      case when exists (select 1 from grp where grp.id = t.value->>'chrono_groupe_id')
           then t.value->>'chrono_groupe_id' else '_a_organiser' end as groupe_id,
      case when (t.value->>'chrono_ordre') ~ '^-?[0-9]+(\.[0-9]+)?$'
           then (t.value->>'chrono_ordre')::numeric else null end as chrono_ordre,
      case when (t.value->>'heures_vendues') ~ '^-?[0-9]+([.,][0-9]+)?$'
           then replace(t.value->>'heures_vendues', ',', '.')::numeric else 0 end as heures_vendues,
      -- Repli legacy de tacheHeuresReelles : nombre, ou tableau de nombres.
      case
        when jsonb_typeof(t.value->'heures_reelles') = 'array' then (
          select coalesce(sum(case when v ~ '^-?[0-9]+([.,][0-9]+)?$'
                                   then replace(v, ',', '.')::numeric else 0 end), 0)
          from jsonb_array_elements_text(t.value->'heures_reelles') x(v))
        when (t.value->>'heures_reelles') ~ '^-?[0-9]+([.,][0-9]+)?$'
          then replace(t.value->>'heures_reelles', ',', '.')::numeric
        else 0 end as heures_legacy
    from ouv
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(ouv.data->'taches') = 'array' then ouv.data->'taches' else '[]'::jsonb end
    ) with ordinality t(value, ordinality)
  ),
  -- Registre : pointages « tâche » du chantier, par tâche.
  reg as (
    select p.tache_id,
           sum(coalesce(p.heures, 0))                                         as heures,
           sum(coalesce(p.heures, 0)) filter (where p.ouvrier = v_prenom)     as miennes,
           count(*)                                                           as nb
    from public.pointages p
    where p.chantier_id = p_chantier_id
      and p.type_pointage = 'tache'
      and p.tache_id is not null
    group by p.tache_id
  ),
  -- Comptes rendus pas encore validés, par tâche (lien rapports.taches[].tache_id).
  attente as (
    select l.value->>'tache_id' as tache_id,
           sum(h.v)                                        as heures,
           sum(h.v) filter (where r.ouvrier = v_prenom)    as miennes
    from public.rapports r
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r.taches) = 'array' then r.taches else '[]'::jsonb end
    ) l(value)
    cross join lateral (
      select case when (l.value->>'heures_reelles') ~ '^-?[0-9]+([.,][0-9]+)?$'
                  then replace(l.value->>'heures_reelles', ',', '.')::numeric else 0 end as v
    ) h
    where r.chantier_id = p_chantier_id
      and coalesce(r.statut, 'en_attente') <> 'valide'
      and coalesce(l.value->>'tache_id', '') <> ''
      and not exists (select 1 from public.pointages pp where pp.rapport_id = r.id)
    group by l.value->>'tache_id'
  ),
  -- Équipe effective : dernière occurrence planning <= aujourd'hui
  -- (règle de ouvrier_taches_actives), repli sur le phasage.
  occ as (
    select distinct on (lt->>'tache_id')
      lt->>'tache_id' as tache_id,
      case when jsonb_typeof(lt->'ouvriers') = 'array' and jsonb_array_length(lt->'ouvriers') > 0
           then lt->'ouvriers'
           else coalesce(to_jsonb(pc.ouvriers), '[]'::jsonb) end as ouvriers_eff
    from public.planning_cells pc
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(pc.taches) = 'array' then pc.taches else '[]'::jsonb end
    ) lt
    cross join lateral (
      select to_date(
        left(pc.week_id, 4) || lpad(split_part(pc.week_id, 'W', 2), 2, '0')
        || case pc.jour when 'Lundi' then '1' when 'Mardi' then '2' when 'Mercredi' then '3'
                        when 'Jeudi' then '4' when 'Vendredi' then '5' when 'Samedi' then '6'
                        else '7' end,
        'IYYYIWID') as d
    ) dd
    where pc.chantier_id = p_chantier_id
      and coalesce(lt->>'tache_id', '') <> ''
      and pc.week_id ~ '^\d{4}-W\d{1,2}$'
      and split_part(pc.week_id, 'W', 2)::int between 1 and 53
      and pc.jour in ('Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche')
      and dd.d <= p_aujourdhui
    order by lt->>'tache_id', dd.d desc
  ),
  -- Dernier motif de dépassement donné pour chaque tâche (tout ouvrier,
  -- aucun nom en sortie). date_rapport est stockée au format FR ou ISO.
  dernier_motif as (
    select distinct on (l.value->>'tache_id')
      l.value->>'tache_id'          as tache_id,
      l.value->>'motif_depassement' as code,
      case
        when r.date_rapport ~ '^\d{4}-\d{2}-\d{2}' then left(r.date_rapport, 10)
        when r.date_rapport ~ '^\d{1,2}/\d{1,2}/\d{4}$'
          then to_char(to_date(r.date_rapport, 'DD/MM/YYYY'), 'YYYY-MM-DD')
        else null end               as date
    from public.rapports r
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r.taches) = 'array' then r.taches else '[]'::jsonb end
    ) l(value)
    where r.chantier_id = p_chantier_id
      and coalesce(l.value->>'tache_id', '') <> ''
      and coalesce(l.value->>'motif_depassement', '') <> ''
    order by l.value->>'tache_id', r.submitted_at desc nulls last
  ),
  -- Une tâche, telle qu'elle sort : champs choisis un par un.
  tache_json as (
    select
      t.groupe_id, t.rang_ouvrage, t.rang_tache, t.chrono_ordre,
      jsonb_build_object(
        'id',          t.tache_id,
        'nom',         coalesce(nullif(trim(t.data->>'nom'), ''), '(sans nom)'),
        'ouvrage_id',  ouv.data->>'id',
        'phase_id',    t.groupe_id,
        'ordre',       t.chrono_ordre,
        'date_prevue', case when (t.data->>'date_prevue') ~ '^\d{4}-\d{2}-\d{2}'
                            then left(t.data->>'date_prevue', 10) else null end,
        'avancement',  least(100, greatest(0,
                         case when (t.data->>'avancement') ~ '^-?[0-9]+(\.[0-9]+)?$'
                              then (t.data->>'avancement')::numeric else 0 end)),
        -- Poids de l'avancement d'un ouvrage (avancementOuvrage) : une durée,
        -- pas un montant.
        'heures_estimees', case when (t.data->>'heures_estimees') ~ '^-?[0-9]+([.,][0-9]+)?$'
                                then replace(t.data->>'heures_estimees', ',', '.')::numeric else null end,
        'ouvriers',    eq.liste,
        'est_mienne',  (v_prenom is not null and eq.liste ? v_prenom),
        'heures_vendues',  t.heures_vendues,
        'heures_validees', case when coalesce(reg.nb, 0) > 0 then reg.heures else t.heures_legacy end,
        'heures_validees_source', case when coalesce(reg.nb, 0) > 0 then 'registre'
                                       when t.heures_legacy > 0 then 'ancien_suivi'
                                       else 'registre' end,
        'heures_en_attente', coalesce(att.heures, 0),
        'mes_heures',  coalesce(reg.miennes, 0) + coalesce(att.miennes, 0),
        -- Hors devis (AFFICHAGE : pastille, pas de jauge) : tâche marquée par
        -- le conducteur, ou sans heures vendues dans un ouvrage qui n'en a pas
        -- (ou « Divers / hors devis »).
        'hors_devis',  (coalesce(t.data->'hors_devis' = 'true'::jsonb, false)
                        or (t.heures_vendues = 0 and (ouv.heures_devis = 0
                            or ouv.data->>'libelle' ilike 'divers%hors devis%'))),
        -- Marquée EXPLICITEMENT hors devis (Phasage V2, Validation) : seules
        -- ces tâches sortent des totaux comparés au vendu et de l'avancement.
        'hors_devis_marque', coalesce(t.data->'hors_devis' = 'true'::jsonb, false),
        -- Nature et auteur d'une tâche ajoutée hors du devis initial.
        'nature',      nullif(trim(t.data->>'nature'), ''),
        'cree_par',    nullif(trim(t.data->>'cree_par'), ''),
        'dernier_motif_depassement', case when dm.code is null then null
                                          else jsonb_build_object('code', dm.code, 'date', dm.date) end
      ) as data
    from tache t
    join ouv on ouv.rang_ouvrage = t.rang_ouvrage
    left join reg     on reg.tache_id = t.tache_id
    left join attente att on att.tache_id = t.tache_id
    left join occ     on occ.tache_id = t.tache_id
    left join dernier_motif dm on dm.tache_id = t.tache_id
    cross join lateral (
      select case
               when occ.ouvriers_eff is not null then occ.ouvriers_eff
               when jsonb_typeof(t.data->'ouvriers') = 'array' then t.data->'ouvriers'
               else '[]'::jsonb end as liste
    ) eq
  ),
  paire as (
    select distinct groupe_id, rang_ouvrage from tache
    union
    select '_a_organiser', ouv.rang_ouvrage
    from ouv
    where not exists (select 1 from tache t where t.rang_ouvrage = ouv.rang_ouvrage)
  ),
  ouvrage_json as (
    select
      p.groupe_id,
      p.rang_ouvrage,
      jsonb_build_object(
        'id',            ouv.data->>'id',
        'libelle',       coalesce(nullif(trim(ouv.data->>'libelle'), ''), '(sans nom)'),
        'quantite',      ouv.quantite,
        'unite',         nullif(trim(ouv.data->>'unite'), ''),
        -- Heures vendues de l'OUVRAGE ENTIER (heures_devis), toutes phases.
        'heures_vendues_ouvrage', ouv.heures_devis,
        -- true = toutes les tâches de l'ouvrage sont dans CETTE phase.
        'ouvrage_complet', not exists (
            select 1 from tache t2
            where t2.rang_ouvrage = p.rang_ouvrage and t2.groupe_id <> p.groupe_id),
        'taches',        coalesce(tj.liste, '[]'::jsonb)
      ) as data
    from paire p
    join ouv on ouv.rang_ouvrage = p.rang_ouvrage
    left join lateral (
      select jsonb_agg(x.data order by x.chrono_ordre nulls last, x.rang_tache) as liste
      from tache_json x
      where x.rang_ouvrage = p.rang_ouvrage and x.groupe_id = p.groupe_id
    ) tj on true
  ),
  phase_liste as (
    select g.id, g.nom, g.ordre, g.couleur, false as synthetique, g.rang_source
    from grp g
    union all
    select '_a_organiser', 'À organiser', 999999::numeric, '#94a3b8', true, 1000000::bigint
    where exists (select 1 from paire p where p.groupe_id = '_a_organiser')
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',          pl.id,
             'nom',         pl.nom,
             'ordre',       pl.ordre,
             'couleur',     pl.couleur,
             'synthetique', pl.synthetique,
             'ouvrages',    coalesce(oj.liste, '[]'::jsonb)
           )
           order by pl.ordre, pl.rang_source
         ), '[]'::jsonb)
    into v_phases
  from phase_liste pl
  left join lateral (
    select jsonb_agg(o.data order by o.rang_ouvrage) as liste
    from ouvrage_json o
    where o.groupe_id = pl.id
  ) oj on true;

  return jsonb_build_object(
    'chantier_id',  p_chantier_id,
    'chantier_nom', coalesce(v_chantier_nom, ph.chantier_nom),
    'phasage_id',   ph.id,
    'modele',       'v2',
    'prenom',       v_prenom,
    'aujourdhui',   p_aujourdhui,
    'phases',       coalesce(v_phases, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.ouvrier_mes_phases(text, text, date) from public;
revoke all on function public.ouvrier_mes_phases(text, text, date) from anon;
grant execute on function public.ouvrier_mes_phases(text, text, date) to authenticated;

comment on function public.ouvrier_mes_phases(text, text, date) is
  'Bêta « Mes phases » (espace ouvrier) : phases → ouvrages → tâches avec heures vendues / validées / en attente / miennes. Aucune donnée financière. Ouvrier : réservé aux bêta-testeurs mes_phases ou cr_v2 (planning_config/fonctionnalites_beta).';

-- =====================================================================
-- VÉRIFICATION — voir scripts/verif-ouvrier-mes-phases.sql
-- =====================================================================
