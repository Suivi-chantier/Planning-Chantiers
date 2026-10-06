-- =====================================================================
-- VÉRIFICATION — bêta « Nouveau compte rendu » (cr_v2), étape 2
-- =====================================================================
-- À passer dans le SQL Editor Supabase APRÈS :
--   1. sql/202610_compte_rendu_v2.sql
--   2. sql/202610_ouvrier_mes_phases.sql (version du 06/10/2026)
-- Lecture seule. Le contrôle automatique sur données fictives (équivalence
-- des pointages v1 / v2, cas limites) est scripts/verif-compte-rendu-v2.mjs.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Les deux colonnes existent, facultatives
-- Attendu : 2 lignes, is_nullable = YES.
-- ---------------------------------------------------------------------
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'rapports'
  and column_name in ('formulaire_version', 'saisie_debut_le')
order by column_name;


-- ---------------------------------------------------------------------
-- 2) ouvrier_mes_phases ouverte aux testeurs cr_v2 + dernier motif
-- Attendu : ouvre_cr_v2 = true, dernier_motif = true.
-- ---------------------------------------------------------------------
select position('''cr_v2''' in pg_get_functiondef(p.oid)) > 0                   as ouvre_cr_v2,
       position('dernier_motif_depassement' in pg_get_functiondef(p.oid)) > 0  as dernier_motif
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'ouvrier_mes_phases';


-- ---------------------------------------------------------------------
-- 3) Suivi des rapports bêta (à relancer pendant le test)
-- Une ligne par rapport du formulaire v2 : temps de remplissage, nombre de
-- lignes, lignes envoyées avec exactement la durée prévue, Bloqué, motifs.
-- ---------------------------------------------------------------------
select r.date_rapport, r.ouvrier, r.chantier_nom, r.statut,
       to_char(r.submitted_at - r.saisie_debut_le, 'HH24:MI')                     as temps_remplissage,
       jsonb_array_length(r.taches)                                               as lignes,
       (select count(*) from jsonb_array_elements(r.taches) l
         where l ? 'heures_prevues'
           and (l->>'heures_prevues')::numeric = (l->>'heures_reelles')::numeric) as lignes_duree_prevue_exacte,
       (select count(*) from jsonb_array_elements(r.taches) l where l ? 'heures_prevues') as lignes_avec_duree_prevue,
       (select count(*) from jsonb_array_elements(r.taches) l where (l->>'bloque')::boolean) as lignes_bloquees,
       (select string_agg(l->>'motif', ', ') from jsonb_array_elements(r.taches) l where l ? 'motif') as motifs,
       (select string_agg(l->>'motif_depassement', ', ') from jsonb_array_elements(r.taches) l where l ? 'motif_depassement') as motifs_depassement
from public.rapports r
where r.formulaire_version = 'v2'
order by r.submitted_at desc
limit 50;


-- ---------------------------------------------------------------------
-- 4) Équivalence sur données réelles, après validation d'un rapport bêta :
-- les pointages d'un rapport v2 validé = ses lignes (heures > 0, fusion par
-- tâche) + heures indirectes + quote-part de trajet. Attendu : ecart = 0.00
-- pour chaque rapport validé (hors corrections faites par le conducteur).
-- ---------------------------------------------------------------------
select r.id, r.date_rapport, r.ouvrier, r.chantier_nom,
       round(coalesce((select sum((l->>'heures_reelles')::numeric) from jsonb_array_elements(r.taches) l), 0)
           + coalesce((select sum((h->>'heures')::numeric) from jsonb_array_elements(coalesce(r.heures_indirectes, '[]'::jsonb)) h), 0), 2)
                                                                                    as declare_hors_trajet,
       round(coalesce((select sum(p.heures) from public.pointages p
                        where p.rapport_id = r.id
                          and coalesce(p.motif_indirect, '') not like 'Trajet%'), 0), 2) as pointe_hors_trajet,
       round(coalesce((select sum((l->>'heures_reelles')::numeric) from jsonb_array_elements(r.taches) l), 0)
           + coalesce((select sum((h->>'heures')::numeric) from jsonb_array_elements(coalesce(r.heures_indirectes, '[]'::jsonb)) h), 0)
           - coalesce((select sum(p.heures) from public.pointages p
                        where p.rapport_id = r.id
                          and coalesce(p.motif_indirect, '') not like 'Trajet%'), 0), 2) as ecart
from public.rapports r
where r.formulaire_version = 'v2' and r.statut = 'valide'
order by r.valide_le desc
limit 50;
