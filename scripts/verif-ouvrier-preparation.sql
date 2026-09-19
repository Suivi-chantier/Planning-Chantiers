-- =====================================================================
-- VÉRIFICATION — public.ouvrier_preparation_chantier(text)
-- =====================================================================
-- À passer dans le SQL Editor Supabase, bloc par bloc.
-- TOUT est en lecture seule ou en transaction explicitement annulée :
-- aucune donnée métier n'est modifiée, aucun résidu ne subsiste.
--
-- Migration correspondante : sql/202609_ouvrier_preparation_chantier.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Signature, sécurité, droits
-- Attendu : security_definer = true, volatilite = 's' (stable),
--           config = {search_path=public}, exec_anon = false,
--           exec_authenticated = true.
-- ---------------------------------------------------------------------
select p.proname,
       p.prosecdef                                   as security_definer,
       p.provolatile                                 as volatilite,
       pg_get_function_identity_arguments(p.oid)     as args,
       pg_get_function_result(p.oid)                 as retour,
       p.proconfig::text                             as config,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as exec_anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as exec_authenticated
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'ouvrier_preparation_chantier';


-- ---------------------------------------------------------------------
-- 2) AUCUNE DONNÉE FINANCIÈRE — contrôle RÉCURSIF des clés du payload
-- Parcourt tout l'arbre JSON réellement retourné (pas le texte SQL) et
-- liste les clés. `cles_interdites` DOIT valoir 'AUCUNE'.
-- Remplacer l'e-mail et l'identifiant de chantier au besoin.
-- ---------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","email":"<email-ouvrier-actif>"}';

with recursive p as (
  select public.ouvrier_preparation_chantier('<chantier_id>') as j
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
          where k ~* 'prix|cout|coût|marge|taux|coefficient|heures|ratio|montant|euro|vendu|ouvriers|lien_fournisseur|notes|stock|fg_')
         as cles_interdites;
rollback;


-- ---------------------------------------------------------------------
-- 3) Données réelles — intégrité des tâches et des ouvrages
-- Attendu : taches_payload = taches_distinctes (aucune perte, aucun
--           doublon), et ouvrages_distincts = compteurs.ouvrages_uniques.
-- Relevé du 17/09/2026 sur FOURMOND 001 : 106 / 106 / 17.
--                        sur FOURMOND 101 :  93 /  93 / 18.
-- ---------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","email":"<email-ouvrier-actif>"}';

with p as (select public.ouvrier_preparation_chantier('<chantier_id>') as j),
taches as (
  select t->>'id' as id
  from p,
       lateral jsonb_array_elements(p.j->'phases')   ph,
       lateral jsonb_array_elements(ph->'ouvrages')  o,
       lateral jsonb_array_elements(o->'taches')     t
)
select p.j->>'modele'                                   as modele,
       p.j->'compteurs'                                 as compteurs,
       (select count(*) from taches)                    as taches_payload,
       (select count(distinct id) from taches)          as taches_distinctes,
       (select count(distinct o->>'id')
          from p, lateral jsonb_array_elements(p.j->'phases') ph,
               lateral jsonb_array_elements(ph->'ouvrages') o) as ouvrages_distincts,
       (select string_agg(ph->>'nom', ' | ' order by ord)
          from jsonb_array_elements(p.j->'phases') with ordinality x(ph, ord)) as ordre_des_phases
from p;
rollback;


-- ---------------------------------------------------------------------
-- 4) Données réelles — quantités matériaux
-- Attendu : totaux_faux = 0 (quantite_totale = quantite ouvrage ×
--           quantite par unité) et aucun total quand la quantité de
--           l'ouvrage est absente.
-- Relevé du 17/09/2026 sur FOURMOND 001 : 121 liens, 0 faux, 0 introuvable.
-- ---------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","email":"<email-ouvrier-actif>"}';

with p as (select public.ouvrier_preparation_chantier('<chantier_id>') as j),
pay as (
  select distinct
    o->>'id'                            as ouvrage_id,
    (o->>'quantite')::numeric           as q_ouvrage,
    m->>'materiau_id'                   as materiau_id,
    (m->>'quantite_par_unite')::numeric as q_unite,
    (m->>'quantite_totale')::numeric    as q_totale,
    (m->>'introuvable')::boolean        as introuvable
  from p,
       lateral jsonb_array_elements(p.j->'phases')  ph,
       lateral jsonb_array_elements(ph->'ouvrages') o,
       lateral jsonb_array_elements(o->'materiaux') m
)
select count(*)                                                                      as liens_payload,
       count(*) filter (where q_totale is not null
                          and abs(q_totale - q_ouvrage * q_unite) > 1e-9)             as totaux_faux,
       count(*) filter (where q_ouvrage is null and q_totale is not null)             as totaux_sans_quantite_ouvrage,
       count(*) filter (where introuvable)                                            as materiaux_introuvables
from pay;
rollback;


-- ---------------------------------------------------------------------
-- 5) Cas limites — données ARTIFICIELLES, transaction annulée
-- Couvre : tâche sans groupe, tâche à groupe inconnu, chantier sans
-- groupe, ouvrage sans tâche (avec et sans matériau), ouvrage réparti sur
-- deux phases, matériau introuvable, quantité d'ouvrage absente, phasage
-- v1 pur, phasage vide, chantier absent.
--
-- Attendu (relevé du 17/09/2026) :
--   A → v2   phases 3  taches 4  ouvrages_uniques 5  a_organiser 2
--            « Premiere[1] | Deuxieme[1] | À organiser[4] »
--   B → v2   phases 1  « À organiser[1] »          (aucun groupe déclaré)
--   C → legacy_v1   phases []   taches 2           (rien n'est converti)
--   D → vide        phases []
--   E → absent      phases []
-- ---------------------------------------------------------------------
begin;
create temp table ref on commit drop as
  select (select id from public.materiaux_bibliotheque order by nom limit 1) as mid;

insert into public.phasages(chantier_id, chantier_nom, ouvrages, plan_travaux) values
('__test_prep_a__','Test A',
 jsonb_build_array(
   -- o1 : deux tâches dans deux phases + un matériau résolu + un introuvable.
   --      Porte volontairement prix_ht / cout_materiaux : ils ne doivent PAS sortir.
   jsonb_build_object('id','o1','libelle','Multi-phases','code_ouvrage','MU-001','quantite',10,'unite','m²',
     'prix_ht',1000,'cout_materiaux',300,
     'taches', jsonb_build_array(
        jsonb_build_object('id','t1','nom','Pose','chrono_groupe_id','g1','chrono_ordre',2,'avancement',40,'heures_vendues',5),
        jsonb_build_object('id','t2','nom','Finition','chrono_groupe_id','g2','chrono_ordre',1,'avancement',0)),
     'materiaux_liens', jsonb_build_array(
        jsonb_build_object('materiau_id',(select mid from ref)::text,'quantite',0.5,'commande_le','2026-09-10'),
        jsonb_build_object('materiau_id','00000000-0000-0000-0000-000000000000','quantite',2))),
   -- o2 : tâche SANS groupe + quantité d'ouvrage absente.
   jsonb_build_object('id','o2','libelle','Sans groupe, sans quantite','unite','U',
     'taches', jsonb_build_array(jsonb_build_object('id','t3','nom','Orpheline','chrono_ordre',1)),
     'materiaux_liens', jsonb_build_array(jsonb_build_object('materiau_id',(select mid from ref)::text,'quantite',3))),
   -- o3 : tâche rattachée à un groupe qui n'existe plus.
   jsonb_build_object('id','o3','libelle','Groupe inconnu','quantite',5,
     'taches', jsonb_build_array(jsonb_build_object('id','t4','nom','Perdue','chrono_groupe_id','g_supprime'))),
   -- o4 : ni tâche ni matériau — doit rester visible.
   jsonb_build_object('id','o4','libelle','Ni tache ni materiau','quantite',2),
   -- o5 : pas de tâche, mais des matériaux.
   jsonb_build_object('id','o5','libelle','Materiau sans tache','quantite',4,
     'materiaux_liens', jsonb_build_array(jsonb_build_object('materiau_id',(select mid from ref)::text,'quantite',1.5)))),
 -- Groupes déclarés dans le DÉSORDRE : le tri doit les remettre d'aplomb.
 jsonb_build_object('meta', jsonb_build_object('chrono_groupes', jsonb_build_array(
   jsonb_build_object('id','g2','nom','Deuxieme','ordre',20,'couleur','#222222'),
   jsonb_build_object('id','g1','nom','Premiere','ordre',10,'couleur','#111111'))))),
('__test_prep_b__','Test B',
 jsonb_build_array(jsonb_build_object('id','ob','libelle','Sans aucun groupe','quantite',3,
   'taches', jsonb_build_array(jsonb_build_object('id','tb','nom','Tache B','chrono_ordre',1)))),
 jsonb_build_object('meta', jsonb_build_object())),
('__test_prep_c__','Test C', '[]'::jsonb,
 jsonb_build_object('meta', jsonb_build_object(), 'demolition', jsonb_build_array(
   jsonb_build_object('id','v1a','nom','Vieille tache'), jsonb_build_object('id','v1b','nom','Autre')))),
('__test_prep_d__','Test D', '[]'::jsonb, jsonb_build_object('meta', jsonb_build_object()));

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","email":"<email-ouvrier-actif>"}';

select cas,
       j->>'modele'      as modele,
       j->'compteurs'    as compteurs,
       (select string_agg(ph->>'nom' || '[' || jsonb_array_length(ph->'ouvrages') || ']', ' | ' order by ord)
          from jsonb_array_elements(j->'phases') with ordinality x(ph, ord)) as phases
from (
  select 'A' as cas, public.ouvrier_preparation_chantier('__test_prep_a__') as j
  union all select 'B', public.ouvrier_preparation_chantier('__test_prep_b__')
  union all select 'C', public.ouvrier_preparation_chantier('__test_prep_c__')
  union all select 'D', public.ouvrier_preparation_chantier('__test_prep_d__')
  union all select 'E', public.ouvrier_preparation_chantier('__chantier_inexistant__')
) q
order by cas;
rollback;

-- Contrôle d'absence de résidu APRÈS le rollback ci-dessus.
-- Attendu : residus_test = 0.
select count(*) as phasages_total,
       count(*) filter (where chantier_id like '\_\_test\_prep%') as residus_test
from public.phasages;


-- ---------------------------------------------------------------------
-- 6) Autorisations par profil
-- Attendu : ouvrier actif et bureau actif → payload ('v2') ;
--           profil absent, bureau inactif, ouvrier inactif → NULL ;
--           anon → « permission denied for function ».
-- ---------------------------------------------------------------------
begin;
set local role authenticated;
create temp table a(ordre int, profil text, resultat text) on commit drop;
grant all on a to anon;

set local request.jwt.claims = '{"role":"authenticated","email":"<email-ouvrier-actif>"}';
insert into a select 1,'ouvrier actif', coalesce(public.ouvrier_preparation_chantier('<chantier_id>')->>'modele','NULL');
set local request.jwt.claims = '{"role":"authenticated","email":"<email-bureau-actif>"}';
insert into a select 2,'bureau actif', coalesce(public.ouvrier_preparation_chantier('<chantier_id>')->>'modele','NULL');
set local request.jwt.claims = '{"role":"authenticated","email":"inconnu-non-enregistre@example.com"}';
insert into a select 3,'profil absent', coalesce(public.ouvrier_preparation_chantier('<chantier_id>')::text,'NULL');
set local request.jwt.claims = '{"role":"authenticated","email":"<email-bureau-inactif>"}';
insert into a select 4,'bureau inactif', coalesce(public.ouvrier_preparation_chantier('<chantier_id>')::text,'NULL');
set local request.jwt.claims = '{"role":"authenticated","email":"<email-ouvrier-inactif>"}';
insert into a select 5,'ouvrier inactif', coalesce(public.ouvrier_preparation_chantier('<chantier_id>')::text,'NULL');

set local role anon;
do $d$
begin
  perform public.ouvrier_preparation_chantier('<chantier_id>');
  insert into a values (6,'anon','EXECUTION ACCEPTEE — ANOMALIE');
exception when others then
  insert into a values (6,'anon','refusee : ' || substr(sqlerrm, 1, 50));
end $d$;

reset role;
select * from a order by ordre;
rollback;
