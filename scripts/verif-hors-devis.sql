-- =====================================================================
-- VÉRIFICATION — tâches hors devis (étape 3b, livraison 1 : les calculs)
-- =====================================================================
-- À passer dans le SQL Editor Supabase APRÈS :
--   1. sql/202610_ouvrier_mes_phases.sql   (version du 06/10/2026, après-midi)
--   2. sql/202608_ouvrier_chantiers.sql    (ouvrier_chantier_detail)
-- Lecture seule. Le contrôle automatique (instantané réel anonymisé, calculs
-- identiques au chiffre près) est scripts/verif-hors-devis.mjs.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Les deux fonctions sont à jour
-- Attendu : true / true / true / true.
-- ---------------------------------------------------------------------
select
  position('hors_devis_marque' in pg_get_functiondef('public.ouvrier_mes_phases(text,text,date)'::regprocedure)) > 0 as phases_indicateur_explicite,
  position('''nature''' in pg_get_functiondef('public.ouvrier_mes_phases(text,text,date)'::regprocedure)) > 0      as phases_nature,
  position('''cree_par''' in pg_get_functiondef('public.ouvrier_mes_phases(text,text,date)'::regprocedure)) > 0    as phases_auteur,
  position('''hors_devis''' in pg_get_functiondef('public.ouvrier_chantier_detail(text,text)'::regprocedure)) > 0  as operations_indicateur;


-- ---------------------------------------------------------------------
-- 2) Tâches marquées hors devis, et natures renseignées (suivi)
-- Attendu à la mise en ligne : aucune ligne — rien ne change tant que
-- personne ne coche « Hors devis » ou ne choisit une nature dans Phasage V2.
-- ---------------------------------------------------------------------
select ph.chantier_nom,
       left(o.value->>'libelle', 60)         as ouvrage,
       t.value->>'nom'                       as tache,
       coalesce(t.value->>'nature', '—')     as nature,
       coalesce((t.value->>'hors_devis')::boolean, false) as hors_devis,
       coalesce(nullif(o.value->>'heures_devis', '')::numeric, 0) as heures_vendues_ouvrage
from public.phasages ph
cross join lateral jsonb_array_elements(case when jsonb_typeof(ph.ouvrages) = 'array' then ph.ouvrages else '[]'::jsonb end) o(value)
cross join lateral jsonb_array_elements(case when jsonb_typeof(o.value->'taches') = 'array' then o.value->'taches' else '[]'::jsonb end) t(value)
where t.value ? 'hors_devis' or t.value ? 'nature'
order by ph.chantier_nom, ouvrage, tache;
