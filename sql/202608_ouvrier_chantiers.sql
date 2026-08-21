-- =====================================================================
-- ESPACE OUVRIER — Onglet « Chantiers » (liste + détail par chantier)
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller).
--
-- Contexte : les tables phasages (ouvrages, heures_devis, pièces jointes
-- du cycle de vie) et pointages (heures réelles) sont verrouillées
-- bureau-only par 202607_espace_ouvrier_phase0.sql (policy bureau_all).
-- Elles portent des données INTERDITES aux ouvriers : prix_ht, prix_vendu,
-- cout_materiaux, taux_horaire (salaires), montants des situations.
--
-- On n'ouvre donc PAS ces tables en RLS : on expose une RPC SECURITY
-- DEFINER qui renvoie UNIQUEMENT le sous-ensemble autorisé :
--   - ouvrages épurés (id, libellé, heures_devis, tâches id/nom/heures)
--   - pointages épurés (tache_id, heures — JAMAIS taux_horaire)
--   - pièces jointes des étapes NON financières du cycle de vie
--     (métrés, plans d'exécution, installation de chantier) — les devis,
--     PV avec montants et factures de situation sont exclus.
--
-- Le bucket "chantier-documents" est déjà lisible par tout authenticated
-- (202607_bucket_chantier_documents.sql) : les URLs signées fonctionnent.
-- =====================================================================

create or replace function public.ouvrier_chantier_detail(
  p_chantier_id  text,
  p_chantier_nom text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ph record;
  v_ouvrages      jsonb   := '[]'::jsonb;
  v_taches_v1     jsonb   := '[]'::jsonb;
  v_pointages     jsonb   := '[]'::jsonb;
  v_heures_libres numeric := 0;
  v_documents     jsonb   := '[]'::jsonb;
  v_meta_etapes   jsonb;
begin
  -- Garde : réservé aux comptes de l'application (ouvrier ou bureau).
  if auth.email() is null or public.mon_role() is null then
    return null;
  end if;

  -- Phasage : chantier_id exact d'abord, sinon rattachement par nom
  -- (même tolérance que trouverPhasage côté front).
  select id, chantier_nom, ouvrages, plan_travaux into ph
  from public.phasages
  where chantier_id = p_chantier_id
  limit 1;

  if ph.id is null and coalesce(trim(p_chantier_nom), '') <> '' then
    select id, chantier_nom, ouvrages, plan_travaux into ph
    from public.phasages
    where lower(trim(chantier_nom)) = lower(trim(p_chantier_nom))
    limit 1;
  end if;

  -- Pointages du chantier : type 'tache' uniquement, épurés (pas de
  -- taux_horaire, pas d'ouvrier). Les heures « libres » (tache_id null)
  -- sont agrégées à part pour la ligne « hors ouvrages ».
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'tache_id', tache_id,
      'heures', heures,
      'type_pointage', type_pointage
    )) filter (where tache_id is not null), '[]'::jsonb),
    coalesce(sum(heures) filter (where tache_id is null), 0)
  into v_pointages, v_heures_libres
  from public.pointages
  where chantier_id = p_chantier_id and type_pointage = 'tache';

  if ph.id is null then
    return jsonb_build_object(
      'phasage_id', null,
      'ouvrages', '[]'::jsonb,
      'taches_v1', '[]'::jsonb,
      'pointages', v_pointages,
      'heures_libres', v_heures_libres,
      'documents', '[]'::jsonb
    );
  end if;

  -- Ouvrages épurés : ni prix_ht ni cout_materiaux ; tâches réduites à
  -- id/nom/heures_reelles (repli legacy attendu par tacheHeuresReelles).
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o->>'id',
    'libelle', o->>'libelle',
    'heures_devis', o->'heures_devis',
    'taches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t->>'id',
        'nom', t->>'nom',
        'heures_reelles', t->'heures_reelles'
      ))
      from jsonb_array_elements(
        case when jsonb_typeof(o->'taches') = 'array' then o->'taches' else '[]'::jsonb end
      ) t
    ), '[]'::jsonb)
  )), '[]'::jsonb)
  into v_ouvrages
  from jsonb_array_elements(
    case when jsonb_typeof(ph.ouvrages) = 'array' then ph.ouvrages else '[]'::jsonb end
  ) o;

  -- Repli V1 : tâches de plan_travaux[phase][] (hors meta), épurées.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t->>'id',
    'nom', t->>'nom',
    'ouvrage_id', t->>'ouvrage_id',
    'heures_vendues', t->'heures_vendues',
    'heures_reelles', t->'heures_reelles'
  )), '[]'::jsonb)
  into v_taches_v1
  from (
    select e.v from jsonb_each(
      case when jsonb_typeof(ph.plan_travaux) = 'object' then ph.plan_travaux else '{}'::jsonb end
    ) as e(k, v)
    where e.k <> 'meta' and jsonb_typeof(e.v) = 'array'
  ) phases
  cross join lateral jsonb_array_elements(phases.v) t;

  -- Pièces jointes du cycle de vie, étapes NON financières uniquement.
  -- Exclus volontairement : devis_envoye, devis_signe, visite_reception,
  -- remise_cles_doe, situations (montants / documents contractuels).
  v_meta_etapes := ph.plan_travaux->'meta'->'cycle_vie_etapes';
  select coalesce(jsonb_agg(jsonb_build_object(
    'etape_id', e.k,
    'pieces', e.v->'pieces_jointes'
  )), '[]'::jsonb)
  into v_documents
  from jsonb_each(
    case when jsonb_typeof(v_meta_etapes) = 'object' then v_meta_etapes else '{}'::jsonb end
  ) as e(k, v)
  where e.k in ('metres', 'plans_execution', 'installation_chantier')
    and jsonb_typeof(e.v->'pieces_jointes') = 'array'
    and jsonb_array_length(e.v->'pieces_jointes') > 0;

  return jsonb_build_object(
    'phasage_id', ph.id,
    'chantier_nom', ph.chantier_nom,
    'ouvrages', v_ouvrages,
    'taches_v1', v_taches_v1,
    'pointages', v_pointages,
    'heures_libres', v_heures_libres,
    'documents', v_documents
  );
end;
$$;

revoke all on function public.ouvrier_chantier_detail(text, text) from public;
revoke all on function public.ouvrier_chantier_detail(text, text) from anon;
grant execute on function public.ouvrier_chantier_detail(text, text) to authenticated;
