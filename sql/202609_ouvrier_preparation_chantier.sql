-- =====================================================================
-- PRÉPARATION DE CHANTIER (ouvrier) — socle backend, lecture seule
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller).
-- Idempotent : create or replace function.
--
-- Expose la hiérarchie Chantier → phases chronologiques → ouvrages →
-- tâches et matériaux, construite EN DIRECT depuis le phasage du chantier.
-- Aucune table de préparation, aucun cliché, aucune publication : ce que le
-- conducteur enregistre dans PhasageV2 (auto-save sur phasages.ouvrages et
-- plan_travaux) est visible par cette RPC à l'appel suivant.
--
-- SOURCE DE VÉRITÉ
-- ----------------
--   phases            plan_travaux.meta.chrono_groupes  [{id,nom,ordre,couleur}]
--   rattachement      ouvrages[].taches[].chrono_groupe_id
--   ordre des tâches  ouvrages[].taches[].chrono_ordre
--   ouvrages          phasages.ouvrages[]
--   matériaux         ouvrages[].materiaux_liens[] résolus contre
--                     materiaux_bibliotheque
--
-- VOLONTAIREMENT IGNORÉS — ne jamais les réintroduire ici :
--   - ouvrage.lot_id : c'est un corps d'état (devis), pas une phase
--     d'exécution. L'utiliser comme niveau de phase recréerait la notion
--     concurrente que ce modèle élimine.
--   - tache.phaseId : vestige (25 tâches sur 2 092 dans tout le parc).
--   - les clés v1 de plan_travaux ("demolition", "placo"…) : ancien modèle,
--     jamais converti automatiquement (voir `modele` = legacy_v1).
--
-- SÉCURITÉ
-- --------
-- SECURITY DEFINER : le corps traverse la RLS de phasages (bureau-only) et
-- de materiaux_bibliotheque (bureau-only depuis le 17/09/2026). C'est
-- l'effet recherché — la fonction devient un guichet dont la liste de
-- champs est écrite en dur. Garde d'appelant : mon_role() is null écarte la
-- session anonyme, le profil absent de public.utilisateurs ET le profil
-- inactif (mon_role() ne renvoie le rôle que si actif is true).
--
-- ⚠ AUCUNE DONNÉE FINANCIÈRE NE DOIT SORTIR D'ICI.
--   Les objets lus en portent pourtant : ouvrage.prix_ht,
--   ouvrage.cout_materiaux, tache.heures_vendues, tache.heures_estimees,
--   tache.ratio, materiaux_bibliotheque.prix_unitaire… Le payload est donc
--   construit CHAMP PAR CHAMP, jamais par recopie d'objet : pas de
--   `to_jsonb(o)`, pas de `||` avec un objet source. Toute évolution doit
--   garder cette règle, et scripts/verif-ouvrier-preparation.sql vérifie
--   récursivement les clés RÉELLES du payload.
--
-- Dans cette première version, tout ouvrier actif peut consulter tout
-- chantier — c'est déjà le fonctionnement de l'onglet Chantiers. Le jour où
-- une affectation existera, c'est ici qu'elle se filtrera.
-- =====================================================================

create or replace function public.ouvrier_preparation_chantier(p_chantier_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ph              record;
  v_chantier_nom  text;
  v_nb_homonymes  int    := 0;
  v_ouvrages      jsonb  := '[]'::jsonb;
  v_plan          jsonb  := '{}'::jsonb;
  v_groupes       jsonb  := '[]'::jsonb;
  v_modele        text;
  v_nb_ouvrages   int    := 0;
  v_nb_v1         int    := 0;
  v_phases        jsonb  := '[]'::jsonb;
  v_compteurs     jsonb;
begin
  -- ── Garde d'appelant ────────────────────────────────────────────────
  -- Un compte sans profil applicatif, ou dont le profil est inactif, n'a
  -- rien à voir ici. mon_role() couvre les deux cas d'un seul test.
  if auth.email() is null or public.mon_role() is null then
    return null;
  end if;

  if coalesce(trim(p_chantier_id), '') = '' then
    return null;
  end if;

  -- Nom du chantier depuis le référentiel planning_config/chantiers : il sert
  -- au payload et, si besoin, au repli de résolution.
  select c.value->>'nom' into v_chantier_nom
  from public.planning_config pc
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(pc.value) = 'array' then pc.value else '[]'::jsonb end
  ) c(value)
  where pc.key = 'chantiers'
    and c.value->>'id' = p_chantier_id
  limit 1;

  -- ── Résolution du phasage — même mécanisme que ouvrier_chantier_detail ──
  -- 1) chantier_id exact.
  select p.id, p.chantier_nom, p.ouvrages, p.plan_travaux
    into ph
  from public.phasages p
  where p.chantier_id = p_chantier_id
  limit 1;

  -- 2) repli par nom, réservé aux données historiques sans chantier_id.
  --    Contrairement au repli historique, on ne prend PAS « le premier » :
  --    plusieurs phasages homonymes seraient un choix arbitraire, donc un
  --    risque d'afficher le mauvais chantier à une équipe. On le dit.
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
        'chantier_id', p_chantier_id,
        'chantier_nom', v_chantier_nom,
        'phasage_id', null,
        'modele', 'ambigu',
        'phases', '[]'::jsonb,
        'compteurs', jsonb_build_object(
          'phases', 0, 'ouvrages_uniques', 0, 'taches', 0, 'taches_a_organiser', 0)
      );
    end if;
  end if;

  -- ── Aucun phasage ───────────────────────────────────────────────────
  if ph.id is null then
    return jsonb_build_object(
      'chantier_id', p_chantier_id,
      'chantier_nom', v_chantier_nom,
      'phasage_id', null,
      'modele', 'absent',
      'phases', '[]'::jsonb,
      'compteurs', jsonb_build_object(
        'phases', 0, 'ouvrages_uniques', 0, 'taches', 0, 'taches_a_organiser', 0)
    );
  end if;

  v_ouvrages := case when jsonb_typeof(ph.ouvrages) = 'array' then ph.ouvrages else '[]'::jsonb end;
  v_plan     := case when jsonb_typeof(ph.plan_travaux) = 'object' then ph.plan_travaux else '{}'::jsonb end;
  v_groupes  := case when jsonb_typeof(v_plan->'meta'->'chrono_groupes') = 'array'
                     then v_plan->'meta'->'chrono_groupes' else '[]'::jsonb end;

  v_nb_ouvrages := jsonb_array_length(v_ouvrages);

  -- Tâches de l'ANCIEN modèle, comptées seulement pour qualifier le phasage.
  select coalesce(sum(jsonb_array_length(e.value)), 0) into v_nb_v1
  from jsonb_each(v_plan) e(key, value)
  where e.key <> 'meta' and jsonb_typeof(e.value) = 'array';

  -- ── Qualification du modèle ─────────────────────────────────────────
  if v_nb_ouvrages > 0 then
    v_modele := 'v2';
  elsif v_nb_v1 > 0 then
    -- Rien n'est converti : la v1 n'a ni ouvrage ni groupe chronologique,
    -- une conversion automatique inventerait une structure. L'interface
    -- dira que le phasage doit être repris.
    v_modele := 'legacy_v1';
  else
    v_modele := 'vide';
  end if;

  if v_modele <> 'v2' then
    return jsonb_build_object(
      'chantier_id', p_chantier_id,
      'chantier_nom', coalesce(v_chantier_nom, ph.chantier_nom),
      'phasage_id', ph.id,
      'modele', v_modele,
      'phases', '[]'::jsonb,
      'compteurs', jsonb_build_object(
        'phases', 0, 'ouvrages_uniques', 0,
        'taches', case when v_modele = 'legacy_v1' then v_nb_v1 else 0 end,
        'taches_a_organiser', 0)
    );
  end if;

  -- ── Construction du payload v2 ──────────────────────────────────────
  with
  -- Groupes déclarés du chantier. rang_source = position d'origine, qui
  -- départage deux groupes de même `ordre` de façon stable.
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
  -- Ouvrages. rang_ouvrage sert de clé interne : il reste valable même si
  -- un ouvrage n'a pas d'id, et il conserve l'ordre du phasage.
  ouv as (
    select
      o.ordinality as rang_ouvrage,
      o.value      as data,
      case when (o.value->>'quantite') ~ '^-?[0-9]+([.,][0-9]+)?$'
           then replace(o.value->>'quantite', ',', '.')::numeric else null end as quantite
    from jsonb_array_elements(v_ouvrages) with ordinality o(value, ordinality)
  ),
  -- Toutes les tâches, avec leur groupe d'appartenance RÉSOLU : un
  -- chrono_groupe_id absent OU pointant vers un groupe supprimé bascule
  -- dans « À organiser ». Une tâche ne peut donc jamais disparaître.
  tache as (
    select
      ouv.rang_ouvrage,
      t.ordinality as rang_tache,
      t.value      as data,
      case when exists (select 1 from grp where grp.id = t.value->>'chrono_groupe_id')
           then t.value->>'chrono_groupe_id' else '_a_organiser' end as groupe_id,
      case when (t.value->>'chrono_ordre') ~ '^-?[0-9]+(\.[0-9]+)?$'
           then (t.value->>'chrono_ordre')::numeric else null end as chrono_ordre
    from ouv
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(ouv.data->'taches') = 'array' then ouv.data->'taches' else '[]'::jsonb end
    ) with ordinality t(value, ordinality)
  ),
  -- Couples (phase, ouvrage) à produire. Un ouvrage dont les tâches sont
  -- réparties sur plusieurs phases apparaît dans chacune. Un ouvrage SANS
  -- aucune tâche — même sans matériau — reste visible dans « À organiser ».
  paire as (
    select distinct groupe_id, rang_ouvrage from tache
    union
    select '_a_organiser', ouv.rang_ouvrage
    from ouv
    where not exists (select 1 from tache t where t.rang_ouvrage = ouv.rang_ouvrage)
  ),
  -- Matériaux de l'ouvrage, résolus contre la bibliothèque. Champs choisis
  -- un par un : ni prix_unitaire, ni lien_fournisseur, ni notes, ni
  -- stock_min, ni categorie. Une ligne dont le matériau a disparu est
  -- CONSERVÉE, marquée introuvable.
  mat as (
    select
      ouv.rang_ouvrage,
      jsonb_agg(
        jsonb_build_object(
          'materiau_id',        ml.value->>'materiau_id',
          'nom',                coalesce(mb.nom, 'Matériau introuvable'),
          'reference',          mb.reference,
          'unite',              mb.unite,
          'fournisseur',        mb.fournisseur,
          'quantite_par_unite', qu.v,
          'quantite_totale',
            case when ouv.quantite is null or ouv.quantite = 0 or qu.v is null
                 then null else ouv.quantite * qu.v end,
          'commande_le',        ml.value->>'commande_le',
          'introuvable',        (mb.id is null)
        )
        order by ml.ordinality
      ) as liste
    from ouv
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(ouv.data->'materiaux_liens') = 'array'
           then ouv.data->'materiaux_liens' else '[]'::jsonb end
    ) with ordinality ml(value, ordinality)
    cross join lateral (
      select case when (ml.value->>'quantite') ~ '^-?[0-9]+([.,][0-9]+)?$'
                  then replace(ml.value->>'quantite', ',', '.')::numeric else null end as v
    ) qu
    left join public.materiaux_bibliotheque mb
      on mb.id::text = ml.value->>'materiau_id'
    where coalesce(trim(ml.value->>'materiau_id'), '') <> ''
    group by ouv.rang_ouvrage
  ),
  -- Un ouvrage, tel qu'il apparaît DANS UNE phase : ses tâches de cette
  -- phase seulement, mais ses matériaux en entier — d'où materiaux_portee.
  ouvrage_json as (
    select
      p.groupe_id,
      p.rang_ouvrage,
      jsonb_build_object(
        'id',           ouv.data->>'id',
        'code_ouvrage', ouv.data->>'code_ouvrage',
        'libelle',      coalesce(nullif(trim(ouv.data->>'libelle'), ''), '(sans nom)'),
        'quantite',     ouv.quantite,
        'unite',        nullif(trim(ouv.data->>'unite'), ''),
        'taches',       coalesce(tj.liste, '[]'::jsonb),
        'materiaux',    coalesce(mat.liste, '[]'::jsonb),
        -- Les matériaux valent pour l'OUVRAGE ENTIER, pas pour les seules
        -- tâches de cette phase. L'interface devra l'écrire en toutes
        -- lettres : « Matériaux prévus pour l'ensemble de cet ouvrage ».
        'materiaux_portee', 'ouvrage_complet'
      ) as data
    from paire p
    join ouv on ouv.rang_ouvrage = p.rang_ouvrage
    left join mat on mat.rang_ouvrage = p.rang_ouvrage
    left join lateral (
      select jsonb_agg(
               jsonb_build_object(
                 'id',         t.data->>'id',
                 'nom',        coalesce(nullif(trim(t.data->>'nom'), ''), '(sans nom)'),
                 'ordre',      t.chrono_ordre,
                 'avancement',
                   case when (t.data->>'avancement') ~ '^-?[0-9]+(\.[0-9]+)?$'
                        then (t.data->>'avancement')::numeric else null end
               )
               -- chrono_ordre absent en dernier ; rang_tache départage.
               order by t.chrono_ordre nulls last, t.rang_tache
             ) as liste
      from tache t
      where t.rang_ouvrage = p.rang_ouvrage and t.groupe_id = p.groupe_id
    ) tj on true
  ),
  -- Phases du payload : TOUS les groupes déclarés par le conducteur, même
  -- vides (une phase sans tâche est une information : rien n'y est encore
  -- prévu), plus « À organiser » SI et SEULEMENT SI quelque chose y tombe.
  phase_liste as (
    select g.id, g.nom, g.ordre, g.couleur, false as synthetique, g.rang_source
    from grp g
    union all
    select '_a_organiser', 'À organiser', 999999::numeric, '#94a3b8', true, 1000000::bigint
    where exists (select 1 from paire p where p.groupe_id = '_a_organiser')
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id',          pl.id,
        'nom',         pl.nom,
        'ordre',       pl.ordre,
        'couleur',     pl.couleur,
        'synthetique', pl.synthetique,
        'ouvrages',    coalesce(oj.liste, '[]'::jsonb)
      )
      order by pl.ordre, pl.rang_source
    ), '[]'::jsonb),
    jsonb_build_object(
      'phases',             (select count(*) from phase_liste),
      -- Identifiants DISTINCTS : un ouvrage présent dans trois phases
      -- compte pour un, et ses matériaux ne sont jamais additionnés trois
      -- fois.
      'ouvrages_uniques',   (select count(distinct rang_ouvrage) from paire),
      'taches',             (select count(*) from tache),
      'taches_a_organiser', (select count(*) from tache where groupe_id = '_a_organiser')
    )
  into v_phases, v_compteurs
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
    'phases',       coalesce(v_phases, '[]'::jsonb),
    'compteurs',    v_compteurs
  );
end;
$$;

-- Droits d'exécution : explicites, jamais hérités.
-- anon n'a rien à faire ici : la préparation est un écran de compte connecté.
revoke all on function public.ouvrier_preparation_chantier(text) from public;
revoke all on function public.ouvrier_preparation_chantier(text) from anon;
grant execute on function public.ouvrier_preparation_chantier(text) to authenticated;

comment on function public.ouvrier_preparation_chantier(text) is
  'Préparation de chantier (espace ouvrier) : phases chronologiques → ouvrages → tâches et matériaux, lus en direct depuis phasages. Aucune donnée financière. Réservée aux comptes applicatifs actifs (mon_role()).';

-- =====================================================================
-- VÉRIFICATION — voir scripts/verif-ouvrier-preparation.sql
-- (contrôle récursif des clés du payload, comptages sur données réelles,
--  cas limites en transaction annulée, autorisations par profil).
-- =====================================================================
