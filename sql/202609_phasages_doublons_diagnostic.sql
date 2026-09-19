-- =====================================================================
-- PHASAGES — doublons par chantier : diagnostic, puis nettoyage guidé
-- =====================================================================
-- À exécuter dans le SQL Editor Supabase, SECTION PAR SECTION, en lisant le
-- résultat de chacune avant de passer à la suivante.
--
-- Les sections 1 et 2 sont en LECTURE SEULE. La section 3 supprime, et
-- seulement sous conditions strictes ; elle est dans une transaction qu'il
-- faut valider à la main.
--
-- POURQUOI CE SCRIPT
-- ------------------
-- Régression livrée le 17/09 (commit e3b680b) et corrigée depuis : à
-- l'ouverture de l'éditeur de phasage, la normalisation des ids des tâches
-- importées de la v1 réécrivait le phasage. Elle passait par ensurePhasage(),
-- qui testait l'état React `phasage` — encore null à cet instant, car
-- setPhasage() ne met pas l'état à jour dans le même tick. Conclusion de la
-- fonction : « ce chantier n'a pas de phasage », et elle en INSÉRAIT un
-- second.
--
-- La ligne créée reste VIDE : l'écriture qui suit porte la révision de
-- l'ancienne ligne, la RPC la refuse en « conflit », et rien n'est écrit
-- dedans. Symptômes vus par l'utilisateur : « Sauvegarde suspendue » sans
-- aucune modification externe, puis « Le rechargement n'a pas abouti »
-- (le rechargement lisait par chantier_id avec maybeSingle(), qui échoue dès
-- qu'il y a deux lignes).
--
-- Seuls sont concernés les chantiers dont des tâches n'avaient pas d'id
-- (import v1) ET ouverts dans l'éditeur entre le 17/09 et le correctif.
-- =====================================================================


-- ---------------------------------------------------------------------
-- SECTION 1 — LECTURE SEULE : quels chantiers portent plusieurs phasages ?
-- ---------------------------------------------------------------------
-- Lire cette liste en entier. Une ligne « nb_ouvrages = 0, revision = 0 »
-- à côté d'une ligne fournie = la coquille créée par la régression.
-- Deux lignes fournies = un cas ancien, à arbitrer À LA MAIN (ne rien
-- supprimer : voir la note en fin de script).
select
  p.chantier_id,
  count(*) over (partition by p.chantier_id) as lignes_pour_ce_chantier,
  p.id,
  p.chantier_nom,
  p.revision,
  jsonb_array_length(coalesce(p.ouvrages, '[]'::jsonb))            as nb_ouvrages,
  coalesce(jsonb_array_length(coalesce(p.ouvrages, '[]'::jsonb)), 0) = 0
    and coalesce(p.plan_travaux, '{}'::jsonb) = '{}'::jsonb        as parait_vide,
  p.updated_at
from public.phasages p
where p.chantier_id in (
  select chantier_id from public.phasages group by chantier_id having count(*) > 1
)
order by p.chantier_id, nb_ouvrages desc, p.revision desc;


-- ---------------------------------------------------------------------
-- SECTION 2 — LECTURE SEULE : ce que la section 3 supprimerait
-- ---------------------------------------------------------------------
-- Conditions cumulatives, toutes vérifiées ligne par ligne :
--   • le chantier a une AUTRE ligne qui porte du travail ;
--   • celle-ci est vide : aucun ouvrage, plan_travaux vide ;
--   • elle n'a jamais été modifiée (revision = 0) ;
--   • rien ne la référence ailleurs.
-- Si cette requête ne renvoie rien, il n'y a aucun résidu à nettoyer.
with vides as (
  select p.*
  from public.phasages p
  where coalesce(jsonb_array_length(coalesce(p.ouvrages, '[]'::jsonb)), 0) = 0
    and coalesce(p.plan_travaux, '{}'::jsonb) = '{}'::jsonb
    and p.revision = 0
    and exists (
      select 1 from public.phasages q
      where q.chantier_id = p.chantier_id
        and q.id <> p.id
        and coalesce(jsonb_array_length(coalesce(q.ouvrages, '[]'::jsonb)), 0) > 0
    )
)
select
  v.id, v.chantier_id, v.chantier_nom, v.revision, v.updated_at,
  (select count(*) from public.commande_lignes  cl where cl.phasage_id = v.id) as refs_commande_lignes,
  (select count(*) from public.controles_groupe cg where cg.phasage_id = v.id) as refs_controles,
  (select count(*) from public.chantier_reference_financiere rf where rf.phasage_id = v.id) as refs_reference_fin,
  (select count(*) from public.reserves                 r  where r.phasage_id  = v.id) as refs_reserves,
  (select count(*) from public.chantier_factures_client fc where fc.phasage_id = v.id) as refs_factures
from vides v
order by v.chantier_id;


-- ---------------------------------------------------------------------
-- SECTION 3 — SUPPRESSION (transaction à valider à la main)
-- ---------------------------------------------------------------------
-- N'exécuter qu'APRÈS avoir lu la section 2 et reconnu chaque ligne.
-- Le DELETE revérifie lui-même toutes les conditions : il ne peut pas
-- emporter une ligne qui porte du travail, même si la base a changé entre
-- les deux requêtes. La suppression est historisée par data_history.
--
-- Lancer d'abord le bloc tel quel : le ROLLBACK annule tout et le SELECT
-- montre ce qui AURAIT été supprimé. Ne remplacer rollback par commit
-- qu'une fois ce résultat validé.

begin;

delete from public.phasages p
where coalesce(jsonb_array_length(coalesce(p.ouvrages, '[]'::jsonb)), 0) = 0
  and coalesce(p.plan_travaux, '{}'::jsonb) = '{}'::jsonb
  and p.revision = 0
  and exists (
    select 1 from public.phasages q
    where q.chantier_id = p.chantier_id
      and q.id <> p.id
      and coalesce(jsonb_array_length(coalesce(q.ouvrages, '[]'::jsonb)), 0) > 0
  )
  and not exists (select 1 from public.commande_lignes      cl where cl.phasage_id = p.id)
  and not exists (select 1 from public.controles_groupe     cg where cg.phasage_id = p.id)
  and not exists (select 1 from public.chantier_reference_financiere rf where rf.phasage_id = p.id)
  and not exists (select 1 from public.reserves                 r  where r.phasage_id  = p.id)
  and not exists (select 1 from public.chantier_factures_client fc where fc.phasage_id = p.id)
returning p.id, p.chantier_id, p.chantier_nom;

-- Contrôle : plus aucun chantier ne doit porter de coquille vide en double.
select chantier_id, count(*) as restant
from public.phasages
group by chantier_id having count(*) > 1
order by chantier_id;

rollback;   -- ← remplacer par  commit;  une fois le résultat ci-dessus validé


-- =====================================================================
-- NOTE — les doublons ANCIENS (deux lignes fournies)
-- =====================================================================
-- Ce script ne les touche pas et ne doit pas les toucher : les deux lignes
-- portent du travail, et choisir laquelle garder est une décision métier.
-- L'éditeur, lui, ne plante plus : il ouvre la plus fournie et écrit dans
-- celle-là (choisirPhasage, src/Renovation/phasageRegistre.mjs).
--
-- Un index unique sur chantier_id empêcherait toute nouvelle duplication,
-- mais il ÉCHOUERA tant que ces cas anciens existent, et il ferait échouer
-- des créations légitimes de façon opaque côté écran. À envisager seulement
-- après arbitrage de ces cas, et jamais dans le même passage que ce
-- nettoyage :
--   create unique index concurrently phasages_chantier_unique
--     on public.phasages(chantier_id);
-- =====================================================================
