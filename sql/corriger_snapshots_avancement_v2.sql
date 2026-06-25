-- ============================================================================
-- CORRECTION des snapshots d'avancement (chantier_avancement_history) en V2
-- ----------------------------------------------------------------------------
-- Le Bilan semaine compare "maintenant" (V2) au dernier snapshot AVANT cette
-- semaine. Les snapshots existants ont été calculés en V1 (plan_travaux).
-- Ce script recalcule, pour CHAQUE chantier, le dernier snapshot d'avant cette
-- semaine en V2, à partir de l'état des ouvrages HISTORISÉ à la date du snapshot
-- (phasages_history), avec repli sur les ouvrages actuels si pas d'historique.
--
-- Étapes : (0) fonctions, (1) APERÇU lecture seule, (2) APPLICATION.
-- ============================================================================

-- ── (0) Fonctions utilitaires ───────────────────────────────────────────────
-- Cast numérique sûr (0 si non numérique / null).
create or replace function public.safe_num(t text)
returns numeric language sql immutable as $$
  select case when t ~ '^\s*-?[0-9]+([.,][0-9]+)?\s*$'
              then replace(btrim(t), ',', '.')::numeric else 0 end;
$$;

-- Avancement V2 d'un tableau d'ouvrages : avancement d'un ouvrage pondéré par
-- heures_estimees (sinon moyenne simple), avancement chantier pondéré par
-- prix_ht (sinon moyenne simple). Même formule que la page Phasage V2.
create or replace function public.v2_avancement(ouvrages jsonb)
returns integer language sql immutable as $$
  with o as (
    select
      public.safe_num(ouv->>'prix_ht') as prix_ht,
      (select count(*) from jsonb_array_elements(
         case when jsonb_typeof(ouv->'taches')='array' then ouv->'taches' else '[]'::jsonb end)) as nb,
      coalesce((
        select case
          when sum(public.safe_num(t->>'heures_estimees')) > 0
            then sum(public.safe_num(t->>'avancement') * public.safe_num(t->>'heures_estimees'))
                 / sum(public.safe_num(t->>'heures_estimees'))
          when count(*) > 0 then avg(public.safe_num(t->>'avancement'))
          else 0 end
        from jsonb_array_elements(
          case when jsonb_typeof(ouv->'taches')='array' then ouv->'taches' else '[]'::jsonb end) t
      ), 0) as av
    from jsonb_array_elements(
      case when jsonb_typeof(ouvrages)='array' then ouvrages else '[]'::jsonb end) ouv
  )
  select coalesce(round(case
    when (select count(*) from o where nb > 0) = 0 then 0
    when (select sum(prix_ht) from o where nb > 0) > 0
      then (select sum(av*prix_ht) from o where nb > 0) / (select sum(prix_ht) from o where nb > 0)
    else (select avg(av) from o where nb > 0)
  end), 0)::int;
$$;

-- ── Source commune : dernier snapshot d'avant cette semaine + ouvrages d'alors
-- (vue temporaire via CTE réutilisée dans l'aperçu ET l'update)
-- NB : date_trunc('week', current_date) = lundi de la semaine en cours.


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ (1) APERÇU — lecture seule : V1 actuel vs V2 recalculé                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
with cible as (
  select distinct on (chantier_id) id, chantier_id, chantier_nom, phasage_id, date_snapshot, avancement
  from public.chantier_avancement_history
  where date_snapshot < date_trunc('week', current_date)::date
  order by chantier_id, date_snapshot desc
),
src as (
  select c.*,
    coalesce(
      (select h.ouvrages from public.phasages_history h
         where h.phasage_id = c.phasage_id and h.saved_at::date <= c.date_snapshot
         order by h.saved_at desc limit 1),
      (select p.ouvrages from public.phasages p where p.id = c.phasage_id)
    ) as ouvrages_alors
  from cible c
)
select
  chantier_nom,
  date_snapshot,
  avancement                              as avancement_v1_actuel,
  public.v2_avancement(ouvrages_alors)    as avancement_v2_recalcule
from src
order by chantier_nom;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ (2) APPLICATION — décommente pour corriger les snapshots                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
/*
with cible as (
  select distinct on (chantier_id) id, chantier_id, phasage_id, date_snapshot
  from public.chantier_avancement_history
  where date_snapshot < date_trunc('week', current_date)::date
  order by chantier_id, date_snapshot desc
),
src as (
  select c.id, c.phasage_id, c.date_snapshot,
    coalesce(
      (select h.ouvrages from public.phasages_history h
         where h.phasage_id = c.phasage_id and h.saved_at::date <= c.date_snapshot
         order by h.saved_at desc limit 1),
      (select p.ouvrages from public.phasages p where p.id = c.phasage_id)
    ) as ouvrages_alors
  from cible c
)
update public.chantier_avancement_history h
set avancement = public.v2_avancement(src.ouvrages_alors)
from src
where h.id = src.id
  and public.v2_avancement(src.ouvrages_alors) is distinct from h.avancement;
*/
