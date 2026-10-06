-- =====================================================================
-- VÉRIFICATION — bêta « Mes phases » (espace ouvrier)
--   public.ouvrier_mes_phases(text, text, date)
--   public.mes_fonctionnalites_beta(text)
--   public._beta_autorise(text, text)
-- =====================================================================
-- À passer dans le SQL Editor Supabase, bloc par bloc, APRÈS
-- sql/202610_ouvrier_mes_phases.sql.
-- TOUT est en lecture seule ou en transaction explicitement annulée :
-- aucune donnée n'est modifiée, aucun résidu ne subsiste.
--
-- Remplacer avant de lancer :
--   <email-ouvrier-beta>     compte ouvrier actif COCHÉ « Bêta : Mes phases »
--   <email-ouvrier-non-beta> compte ouvrier actif NON coché
--   <email-bureau-actif>     compte bureau actif (admin, conducteur…)
--   <prenom-beta>            prénom-planning de l'ouvrier bêta
--   <chantier_id>            un chantier où il travaille (planning_config/chantiers)
--
-- Le contrôle automatique sur données fictives est
-- scripts/verif-ouvrier-mes-phases.mjs (lancé à chaque PR).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Signatures, sécurité, droits
-- Attendu :
--   ouvrier_mes_phases       security_definer true, stable, exec_anon false, exec_authenticated true
--   mes_fonctionnalites_beta security_definer true, stable, exec_anon false, exec_authenticated true
--   _beta_autorise           exec_anon false, exec_authenticated FALSE (interne)
-- ---------------------------------------------------------------------
select p.proname,
       p.prosecdef                                   as security_definer,
       p.provolatile                                 as volatilite,
       pg_get_function_identity_arguments(p.oid)     as args,
       p.proconfig::text                             as config,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as exec_anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as exec_authenticated
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('ouvrier_mes_phases', 'mes_fonctionnalites_beta', '_beta_autorise')
order by p.proname;


-- ---------------------------------------------------------------------
-- 2) Le réglage bêta tel qu'il est en base (lecture, compte bureau)
-- Attendu : {"mes_phases": ["<prenom-beta>"]} une fois la case cochée
-- dans Réglages → Collaborateurs ; aucune ligne tant que rien n'est coché.
-- ---------------------------------------------------------------------
select key, value from public.planning_config where key = 'fonctionnalites_beta';


-- ---------------------------------------------------------------------
-- 3) AUCUNE DONNÉE FINANCIÈRE — contrôle RÉCURSIF des clés du payload
-- Parcourt tout l'arbre JSON réellement retourné et liste les clés.
-- `cles_interdites` DOIT valoir 'AUCUNE'.
-- (Les clés heures_* sont des durées, pas des montants : elles sont
--  attendues ici, contrairement à la préparation de chantier.)
-- ---------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","email":"<email-ouvrier-beta>"}';

with recursive p as (
  select public.ouvrier_mes_phases('<chantier_id>') as j
),
recursif(v) as (
  select j from p
  union all
  select enfant from recursif
  cross join lateral (
    select value as enfant
      from jsonb_each(case when jsonb_typeof(recursif.v) = 'object' then recursif.v else '{}'::jsonb end)
    union all
    select value
      from jsonb_array_elements(case when jsonb_typeof(recursif.v) = 'array' then recursif.v else '[]'::jsonb end)
  ) e
),
cles as (
  select distinct k
  from recursif,
       lateral jsonb_object_keys(case when jsonb_typeof(recursif.v) = 'object' then recursif.v else '{}'::jsonb end) k
)
select (select string_agg(k, ', ' order by k) from cles) as cles_du_payload,
       (select coalesce(string_agg(k, ', '), 'AUCUNE') from cles
          where k ~* 'prix|cout|coût|marge|taux|coefficient|ratio|montant|euro|fournisseur|fg_')
         as cles_interdites;
rollback;


-- ---------------------------------------------------------------------
-- 4) Autorisations par profil
-- Attendu :
--   1 ouvrier bêta          → modele 'v2' (ou absent / ambigu / legacy_v1)
--                             et prenom = SON prénom, même si un autre est passé
--   2 ouvrier non bêta      → {"acces_refuse": true}
--   3 bureau actif          → modele + prenom = '<prenom-beta>' (aperçu)
--   4 profil absent         → NULL
--   5 anon                  → « permission denied for function »
--   6 _beta_autorise (API)  → « permission denied for function »
--   7 codes ouvrier bêta    → ["mes_phases"]
--   8 codes non bêta        → [] (ou ses seuls codes)
-- ---------------------------------------------------------------------
begin;
set local role authenticated;
create temp table a(ordre int, profil text, resultat text) on commit drop;
grant all on a to anon;

set local request.jwt.claims = '{"role":"authenticated","email":"<email-ouvrier-beta>"}';
insert into a select 1, 'ouvrier bêta',
  (select j->>'modele' || ' / prenom=' || coalesce(j->>'prenom', 'NULL')
     from (select public.ouvrier_mes_phases('<chantier_id>', 'QuelquUnDAutre') j) x);
insert into a select 7, 'codes ouvrier bêta', public.mes_fonctionnalites_beta('QuelquUnDAutre')::text;
do $d$
begin
  perform public._beta_autorise('mes_phases', 'x');
  insert into a values (6, '_beta_autorise via API', 'EXECUTION ACCEPTEE — ANOMALIE');
exception when others then
  insert into a values (6, '_beta_autorise via API', 'refusee : ' || substr(sqlerrm, 1, 50));
end $d$;

set local request.jwt.claims = '{"role":"authenticated","email":"<email-ouvrier-non-beta>"}';
insert into a select 2, 'ouvrier non bêta', public.ouvrier_mes_phases('<chantier_id>')::text;
insert into a select 8, 'codes non bêta', public.mes_fonctionnalites_beta()::text;

set local request.jwt.claims = '{"role":"authenticated","email":"<email-bureau-actif>"}';
insert into a select 3, 'bureau actif (aperçu)',
  (select j->>'modele' || ' / prenom=' || coalesce(j->>'prenom', 'NULL')
     from (select public.ouvrier_mes_phases('<chantier_id>', '<prenom-beta>') j) x);

set local request.jwt.claims = '{"role":"authenticated","email":"inconnu-non-enregistre@example.com"}';
insert into a select 4, 'profil absent', coalesce(public.ouvrier_mes_phases('<chantier_id>')::text, 'NULL');

set local role anon;
do $d$
begin
  perform public.ouvrier_mes_phases('<chantier_id>');
  insert into a values (5, 'anon', 'EXECUTION ACCEPTEE — ANOMALIE');
exception when others then
  insert into a values (5, 'anon', 'refusee : ' || substr(sqlerrm, 1, 50));
end $d$;

reset role;
select * from a order by ordre;
rollback;


-- ---------------------------------------------------------------------
-- 5) Données réelles — mêmes chiffres que la fiche chantier
-- Recalcule INDÉPENDAMMENT, depuis les tables, les heures validées
-- (registre « tâche », repli sur l'ancien suivi), les heures vendues
-- (heures_devis des ouvrages) et les heures du prénom, puis les compare
-- au payload. Attendu : les trois colonnes ecart_* valent 0.
-- Relevé du 05/10/2026 (transaction annulée) sur TOM & CAMILLE R+2,
-- aperçu de Davy : 123 tâches, 11 phases, 457,2 h validées, 216,3 h
-- vendues, 116 h pour Davy — identiques au recalcul.
-- ---------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","email":"<email-bureau-actif>"}';

with p as (select public.ouvrier_mes_phases('<chantier_id>', '<prenom-beta>') j),
t as (
  select x from p,
    lateral jsonb_array_elements(p.j->'phases') ph,
    lateral jsonb_array_elements(ph->'ouvrages') o,
    lateral jsonb_array_elements(o->'taches') x
),
ouv_distincts as (
  select distinct on (o->>'id') (o->>'heures_vendues_ouvrage')::numeric hd
  from p, lateral jsonb_array_elements(p.j->'phases') ph, lateral jsonb_array_elements(ph->'ouvrages') o
),
ph as (select ouvrages from public.phasages where chantier_id = '<chantier_id>' limit 1),
tt as (
  select tt.value t
  from ph, lateral jsonb_array_elements(ph.ouvrages) o(value),
       lateral jsonb_array_elements(coalesce(o.value->'taches', '[]'::jsonb)) tt(value)
),
pt as (
  select tache_id, sum(heures) h, sum(heures) filter (where ouvrier = '<prenom-beta>') hm
  from public.pointages
  where chantier_id = '<chantier_id>' and type_pointage = 'tache' and tache_id is not null
  group by tache_id
),
recalc as (
  select sum(coalesce(pt.h, case when jsonb_typeof(tt.t->'heures_reelles') = 'number'
                                 then (tt.t->>'heures_reelles')::numeric else 0 end)) validees,
         sum(coalesce(pt.hm, 0)) miennes_registre,
         count(*) nb
  from tt left join pt on pt.tache_id = tt.t->>'id'
)
select
  (select count(*) from t)                                                   as taches_payload,
  (select nb from recalc)                                                    as taches_phasage,
  (select round(sum((x->>'heures_validees')::numeric), 2) from t)
    - (select round(validees, 2) from recalc)                                as ecart_validees,
  (select round(sum(hd), 2) from ouv_distincts)
    - (select round(sum(coalesce(nullif(o->>'heures_devis', '')::numeric, 0)), 2)
         from ph, lateral jsonb_array_elements(ph.ouvrages) o)               as ecart_vendues,
  (select round(sum((x->>'mes_heures')::numeric), 2) from t)
    - (select round(miennes_registre, 2) from recalc)
    - (select coalesce(round(sum(case when (l->>'heures_reelles') ~ '^-?[0-9]+([.,][0-9]+)?$'
                                       then replace(l->>'heures_reelles', ',', '.')::numeric else 0 end), 2), 0)
         from public.rapports r, lateral jsonb_array_elements(coalesce(r.taches, '[]'::jsonb)) l
        where r.chantier_id = '<chantier_id>' and r.ouvrier = '<prenom-beta>'
          and coalesce(r.statut, 'en_attente') <> 'valide'
          and coalesce(l->>'tache_id', '') <> ''
          and not exists (select 1 from public.pointages pp where pp.rapport_id = r.id)) as ecart_miennes
from (select 1) un;
rollback;


-- ---------------------------------------------------------------------
-- 6) Lien comptes rendus ↔ tâches (état du parc, lecture seule)
-- Les heures « en attente » ne peuvent se rattacher à une tâche que si la
-- ligne du compte rendu porte un tache_id. Attendu le 05/10/2026 : 100 %
-- des tache_id présents retrouvent leur tâche dans le phasage du même
-- chantier ; les comptes rendus en attente (avril → juin 2026) n'en
-- portent aucun.
-- ---------------------------------------------------------------------
with l as (
  select r.statut, r.chantier_id, x->>'tache_id' tid
  from public.rapports r, lateral jsonb_array_elements(coalesce(r.taches, '[]'::jsonb)) x
),
ids as (
  select distinct ph.chantier_id, tt->>'id' tid
  from public.phasages ph,
       lateral jsonb_array_elements(coalesce(ph.ouvrages, '[]'::jsonb)) o,
       lateral jsonb_array_elements(coalesce(o->'taches', '[]'::jsonb)) tt
)
select coalesce(statut, 'en_attente') as statut,
       count(*)                                             as lignes,
       count(*) filter (where coalesce(tid, '') <> '')      as avec_tache_id,
       count(*) filter (where coalesce(tid, '') <> ''
         and exists (select 1 from ids where ids.chantier_id = l.chantier_id and ids.tid = l.tid)) as tache_retrouvee
from l
group by 1
order by 1;
