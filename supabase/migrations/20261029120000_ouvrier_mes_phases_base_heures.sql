-- ============================================================================
-- Écran ouvrier : même avancement d'ouvrage que le bureau (29/10/2026).
--
-- Accord de Loris du 29/10/2026 (mêmes conditions que l'accord CR-3) :
-- ouvrier_mes_phases renvoie, pour chaque tâche d'origine devis, des heures
-- prévues calculées comme au bureau (chantierFinance.heuresPrevuesTache) :
-- heures de l'ouvrage × % de la tâche ÷ somme des % des tâches d'origine
-- devis (ramenés à 100 %). Les tâches hors devis, de reprise et « ajoutées en
-- cours de chantier » gardent leurs heures estimées, comme au bureau. L'écran
-- pondère l'avancement d'un ouvrage par ces heures : il retrouve le chiffre du
-- bureau.
--
-- Ce qui ne change pas : aucun nouveau champ renvoyé (seule la VALEUR de
-- heures_estimees change pour les tâches d'origine devis), jamais de % ni de
-- montant, mêmes appelants (create or replace garde les droits : authenticated
-- et service_role), mêmes contrôles d'accès (bêta, est_ouvrier). Corps = corps
-- de production du 29/10/2026 (pg_get_functiondef) + les deux ajouts marqués
-- « 29/10/2026 » (colonne somme_ratios_base de ouv, calcul de heures_estimees).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ouvrier_mes_phases(p_chantier_id text, p_prenom text DEFAULT NULL::text, p_aujourdhui date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_pieces        jsonb  := '[]'::jsonb;
  v_lots          jsonb  := '[]'::jsonb;
begin
  if auth.email() is null or public.mon_role() is null then
    return null;
  end if;
  if coalesce(trim(p_chantier_id), '') = '' then
    return null;
  end if;

  if public.est_ouvrier() then
    v_prenom := public.mon_prenom_planning();
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
           then replace(o.value->>'heures_devis', ',', '.')::numeric else 0 end as heures_devis,
      -- 29/10/2026 : somme des % des tâches d'origine devis (hors hors devis,
      -- reprises et tâches ajoutées en cours de chantier), pour répartir les
      -- heures de l'ouvrage comme le bureau (chantierFinance.baseHeuresOuvrage).
      -- Sert au calcul ci-dessous ; les % ne sortent jamais de la fonction.
      (select coalesce(sum(x.r), 0)
         from jsonb_array_elements(case when jsonb_typeof(o.value->'taches') = 'array'
                                        then o.value->'taches' else '[]'::jsonb end) tt(v)
         cross join lateral (select case when (tt.v->>'ratio') ~ '^[0-9]+([.,][0-9]+)?$' then replace(tt.v->>'ratio', ',', '.')::numeric else 0 end as r) x
        where x.r > 0
          and not coalesce(tt.v->'hors_devis' = 'true'::jsonb, false)
                and coalesce(tt.v->>'nature', '') <> 'reprise'
                and not coalesce(tt.v->'ajoutee_en_cours' = 'true'::jsonb, false)) as somme_ratios_base
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
  reg as (
    select p.tache_id,
           sum(coalesce(p.heures, 0))                                         as heures,
           sum(coalesce(p.heures, 0)) filter (where p.ouvrier = v_prenom)     as miennes,
           count(*)                                                           as nb,
           coalesce(sum(p.quantite_validee), 0)                               as quantite
    from public.pointages p
    where p.chantier_id = p_chantier_id
      and p.type_pointage = 'tache'
      and p.tache_id is not null
    group by p.tache_id
  ),
  attente as (
    select l.value->>'tache_id' as tache_id,
           sum(h.v)                                        as heures,
           sum(h.v) filter (where r.ouvrier = v_prenom)    as miennes,
           sum(h.q)                                        as quantite
    from public.rapports r
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r.taches) = 'array' then r.taches else '[]'::jsonb end
    ) l(value)
    cross join lateral (
      select case when (l.value->>'heures_reelles') ~ '^-?[0-9]+([.,][0-9]+)?$'
                  then replace(l.value->>'heures_reelles', ',', '.')::numeric else 0 end as v,
             case when (l.value->>'quantite_jour') ~ '^[0-9]+([.,][0-9]+)?$'
                  then replace(l.value->>'quantite_jour', ',', '.')::numeric else 0 end as q
    ) h
    where r.chantier_id = p_chantier_id
      and coalesce(r.statut, 'en_attente') <> 'valide'
      and coalesce(l.value->>'tache_id', '') <> ''
      and not exists (select 1 from public.pointages pp where pp.rapport_id = r.id)
    group by l.value->>'tache_id'
  ),
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
  tache_json as (
    select
      t.groupe_id, t.rang_ouvrage, t.rang_tache, t.chrono_ordre,
      jsonb_build_object(
        'id',          t.tache_id,
        'nom',         coalesce(nullif(trim(t.data->>'nom'), ''), '(sans nom)'),
        'nom_perso',   nullif(trim(t.data->>'nom_perso'), ''),
        'piece_id',    nullif(trim(t.data->>'piece_id'), ''),
        'ouvrage_id',  ouv.data->>'id',
        'phase_id',    t.groupe_id,
        'ordre',       t.chrono_ordre,
        'date_prevue', case when (t.data->>'date_prevue') ~ '^\d{4}-\d{2}-\d{2}'
                            then left(t.data->>'date_prevue', 10) else null end,
        'avancement',  least(100, greatest(0,
                         case when (t.data->>'avancement') ~ '^-?[0-9]+(\.[0-9]+)?$'
                              then (t.data->>'avancement')::numeric else 0 end)),
        -- 29/10/2026 : même base que le bureau (chantierFinance.heuresPrevuesTache) :
        -- une tâche d'origine devis reçoit heures de l'ouvrage × son % ÷ la somme
        -- des % (ramenés à 100 %) ; les autres gardent leurs heures estimées.
        -- Seule la durée qui en résulte est renvoyée, jamais le %.
        'heures_estimees', case
          when ouv.heures_devis > 0 and ouv.somme_ratios_base > 0
               and case when (t.data->>'ratio') ~ '^[0-9]+([.,][0-9]+)?$' then replace(t.data->>'ratio', ',', '.')::numeric else 0 end > 0
               and not coalesce(t.data->'hors_devis' = 'true'::jsonb, false)
                and coalesce(t.data->>'nature', '') <> 'reprise'
                and not coalesce(t.data->'ajoutee_en_cours' = 'true'::jsonb, false)
            then round(ouv.heures_devis * (case when (t.data->>'ratio') ~ '^[0-9]+([.,][0-9]+)?$' then replace(t.data->>'ratio', ',', '.')::numeric else 0 end) / ouv.somme_ratios_base, 6)
          when (t.data->>'heures_estimees') ~ '^-?[0-9]+([.,][0-9]+)?$'
            then replace(t.data->>'heures_estimees', ',', '.')::numeric
          else null end,
        'ouvriers',    eq.liste,
        'est_mienne',  (v_prenom is not null and eq.liste ? v_prenom),
        'heures_vendues',  t.heures_vendues,
        'heures_validees', case when coalesce(reg.nb, 0) > 0 then reg.heures else t.heures_legacy end,
        'heures_validees_source', case when coalesce(reg.nb, 0) > 0 then 'registre'
                                       when t.heures_legacy > 0 then 'ancien_suivi'
                                       else 'registre' end,
        'heures_en_attente', coalesce(att.heures, 0),
        'mes_heures',  coalesce(reg.miennes, 0) + coalesce(att.miennes, 0),
        'hors_devis',  (coalesce(t.data->'hors_devis' = 'true'::jsonb, false)
                        or (t.heures_vendues = 0 and (ouv.heures_devis = 0
                            or ouv.data->>'libelle' ilike 'divers%hors devis%'))),
        'hors_devis_marque', coalesce(t.data->'hors_devis' = 'true'::jsonb, false),
        'nature',      nullif(trim(t.data->>'nature'), ''),
        'cree_par',    nullif(trim(t.data->>'cree_par'), ''),
        'quantite',    case when (t.data->>'quantite') ~ '^[0-9]+([.,][0-9]+)?$'
                            then replace(t.data->>'quantite', ',', '.')::numeric else null end,
        'suivi_pourcent', coalesce(t.data->'suivi_pourcent' = 'true'::jsonb, false),
        'quantite_reprise', case when (t.data->>'quantite_reprise') ~ '^[0-9]+([.,][0-9]+)?$'
                                 then replace(t.data->>'quantite_reprise', ',', '.')::numeric else null end,
        'quantite_terminee', coalesce(jsonb_typeof(t.data->'quantite_terminee') = 'object'
                                      or t.data->'quantite_terminee' = 'true'::jsonb, false),
        'quantite_validee',    coalesce(reg.quantite, 0),
        'quantite_en_attente', coalesce(att.quantite, 0),
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
        'libelle_perso', nullif(trim(ouv.data->>'libelle_perso'), ''),
        'lot_id',        nullif(trim(ouv.data->>'lot_id'), ''),
        'code',          nullif(trim(ouv.data->>'code_ouvrage'), ''),
        'quantite',      ouv.quantite,
        'unite',         nullif(trim(ouv.data->>'unite'), ''),
        'heures_vendues_ouvrage', ouv.heures_devis,
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

  -- CR-3 : pièces du chantier (CR-2) et lots de travaux (Admin → Lots), pour
  -- la vue phasage du compte rendu. Lecture seule, ajoutée à la réponse.
  select coalesce(jsonb_agg(jsonb_build_object('id', trim(x.p->>'id'), 'nom', trim(x.p->>'nom')) order by x.ord), '[]'::jsonb)
    into v_pieces
  from jsonb_array_elements(
    case when jsonb_typeof(v_plan->'meta'->'pieces') = 'array' then v_plan->'meta'->'pieces' else '[]'::jsonb end
  ) with ordinality x(p, ord)
  where coalesce(trim(x.p->>'id'), '') <> '' and coalesce(trim(x.p->>'nom'), '') <> '';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.l->>'id', 'label', x.l->>'label', 'couleur', coalesce(x.l->>'couleur', x.l->>'color')) order by x.ord), '[]'::jsonb)
    into v_lots
  from public.planning_config pc
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(pc.value->'items') = 'array' then pc.value->'items' else '[]'::jsonb end
  ) with ordinality x(l, ord)
  where pc.key = 'lots_travaux' and coalesce(trim(x.l->>'id'), '') <> '';

  return jsonb_build_object(
    'chantier_id',  p_chantier_id,
    'chantier_nom', coalesce(v_chantier_nom, ph.chantier_nom),
    'phasage_id',   ph.id,
    'modele',       'v2',
    'pieces',       v_pieces,
    'lots',         v_lots,
    'prenom',       v_prenom,
    'aujourdhui',   p_aujourdhui,
    'phases',       coalesce(v_phases, '[]'::jsonb)
  );
end;
$function$
;
