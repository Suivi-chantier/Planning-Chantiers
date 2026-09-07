-- =====================================================================
-- ESPACE OUVRIER — Chef d'équipe : lecture du planning de toutes les équipes
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller).
-- (create or replace + drop policy if exists : ré-exécutable sans rien casser.)
--
-- Journal d'application :
--   [ ] 1  extension unaccent + normalisation des prénoms
--   [ ] 2  helper est_responsable()
--   [ ] 3  policy SELECT supplémentaire sur planning_cells (chefs)
--   [ ] 4  RPC mon_profil_espace() (profil en un aller-retour)
--   [ ] 5  correctif sécurité : whitelist de clés planning_config (anon + ouvrier)
--
-- Principe : AUCUN nouveau rôle. Le chef d'équipe garde role = 'ouvrier' ;
-- sa qualité de chef est DÉRIVÉE de planning_config/equipes (champ
-- `responsable` = prénom-planning), côté SQL uniquement. La frontière RLS
-- de la Phase 0 (est_ouvrier() / bureau) reste intacte : un chef reste
-- incapable de lire commandes, factures, pointages, phasages, taux…
--
-- planning_cells a été inspectée avant d'écrire la policy (bloc 3) :
-- colonnes = id, week_id, chantier_id, jour, planifie, reel, ouvriers[],
-- created_at, taches (jsonb), vehicules (jsonb). Aucun montant, prix ou
-- heures vendues → l'ouverture directe de la table en SELECT est sûre
-- (elle est d'ailleurs déjà entièrement lisible par anon pour le
-- formulaire public — policy cells_anon_sel de la Phase 0).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1 — Normalisation des prénoms-planning
-- Alignée sur normaliserNomRessource (src/Renovation/planningResourceModelV1.js) :
-- accents supprimés + minuscules + espaces écrasés + trim. Un espace ou
-- une majuscule ne doit jamais faire perdre ses droits à un chef.
-- ---------------------------------------------------------------------

-- Supabase installe les extensions dans le schéma "extensions".
create extension if not exists unaccent with schema extensions;

-- Le search_path inclut "extensions" pour que la forme à un argument
-- unaccent(text) retrouve son dictionnaire quel que soit le schéma.
create or replace function public.norm_prenom(t text)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select lower(regexp_replace(trim(unaccent(coalesce(t, ''))), '\s+', ' ', 'g'));
$$;

revoke all on function public.norm_prenom(text) from public;
revoke all on function public.norm_prenom(text) from anon;
grant execute on function public.norm_prenom(text) to authenticated;


-- ---------------------------------------------------------------------
-- 2 — est_responsable()
-- Vrai si le prénom-planning de l'appelant figure comme `responsable`
-- d'au moins une équipe de planning_config/equipes.
-- Fail-closed : clé absente, items absent/malformé, responsable vide ou
-- prenom_planning NULL → false, jamais d'erreur.
-- ---------------------------------------------------------------------

create or replace function public.est_responsable()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.planning_config pc
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(pc.value->'items') = 'array'
             then pc.value->'items' else '[]'::jsonb end
      ) e
      where pc.key = 'equipes'
        and public.norm_prenom(e->>'responsable') <> ''
        and public.norm_prenom(e->>'responsable')
            = public.norm_prenom(public.mon_prenom_planning())
    ),
    false
  );
$$;

revoke all on function public.est_responsable() from public;
revoke all on function public.est_responsable() from anon;
grant execute on function public.est_responsable() to authenticated;


-- ---------------------------------------------------------------------
-- 3 — Policy SELECT supplémentaire sur planning_cells (chefs d'équipe)
-- S'AJOUTE à cells_ouvrier_sel (cumul en OR) : un chef voit toutes les
-- cellules, un ouvrier non-chef reste limité aux siennes. Les policies
-- existantes de la Phase 0 ne sont PAS modifiées.
-- ---------------------------------------------------------------------

drop policy if exists "cells_responsable_sel" on public.planning_cells;
create policy "cells_responsable_sel" on public.planning_cells
  for select to authenticated
  using (public.est_ouvrier() and public.est_responsable());


-- ---------------------------------------------------------------------
-- 4 — RPC mon_profil_espace()
-- Profil de l'espace ouvrier en un seul aller-retour, appelée au montage
-- d'EspaceOuvrier : rôle, prénom-planning, qualité de chef, et la liste
-- des équipes dont l'appelant est responsable (id, nom, couleur).
-- Le front ne recalcule JAMAIS la qualité de chef : elle vient d'ici.
-- ---------------------------------------------------------------------

create or replace function public.mon_profil_espace()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'role',            public.mon_role(),
    'prenom_planning', public.mon_prenom_planning(),
    'est_responsable', public.est_responsable(),
    'equipes_responsable', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',      e->>'id',
        'nom',     e->>'nom',
        'couleur', e->>'couleur'
      ))
      from public.planning_config pc
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(pc.value->'items') = 'array'
             then pc.value->'items' else '[]'::jsonb end
      ) e
      where pc.key = 'equipes'
        and public.norm_prenom(e->>'responsable') <> ''
        and public.norm_prenom(e->>'responsable')
            = public.norm_prenom(public.mon_prenom_planning())
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.mon_profil_espace() from public;
revoke all on function public.mon_profil_espace() from anon;
grant execute on function public.mon_profil_espace() to authenticated;


-- ---------------------------------------------------------------------
-- 5 — CORRECTIF SÉCURITÉ : whitelist de clés sur planning_config
-- Les policies Phase 0 config_anon_sel (using true) et config_ouvrier_sel
-- (toutes clés) exposaient taux_horaires, taux_mo_previsionnel,
-- dashboard_finance_*, etats_financiers, bloc_notes/bloc_todos,
-- ouvrier_emails… à tout ouvrier ET au formulaire public anonyme.
-- On les remplace par des whitelists strictes des clés réellement lues :
--   anon (formulaire public RapportMobile — select * puis filtre par clé) :
--     chantiers, ouvriers, heures_par_jour, espace_ouvrier_actif
--   ouvrier (EspaceOuvrier : Planning/Dashboard/Chantiers/Commande +
--   RapportMobile embarqué + loadEquipes) :
--     les mêmes + chantier_adresses + equipes
-- Les écrans pré-connexion (login, création mdp) ne lisent pas la table.
-- Le bureau (config_bureau_all) n'est pas touché.
-- ---------------------------------------------------------------------

drop policy if exists "config_anon_sel" on public.planning_config;
create policy "config_anon_sel" on public.planning_config
  for select to anon
  using (key in ('chantiers', 'ouvriers', 'heures_par_jour', 'espace_ouvrier_actif'));

drop policy if exists "config_ouvrier_sel" on public.planning_config;
create policy "config_ouvrier_sel" on public.planning_config
  for select to authenticated
  using (
    public.est_ouvrier()
    and key in ('chantiers', 'chantier_adresses', 'ouvriers',
                'heures_par_jour', 'espace_ouvrier_actif', 'equipes')
  );


-- =====================================================================
-- REQUÊTES DE CONTRÔLE (lecture seule, à exécuter après la migration)
-- =====================================================================
-- a) Les responsables déclarés dans la config et leur normalisation :
-- select e->>'nom' as equipe,
--        e->>'responsable' as responsable,
--        public.norm_prenom(e->>'responsable') as normalise
-- from public.planning_config pc
-- cross join lateral jsonb_array_elements(pc.value->'items') e
-- where pc.key = 'equipes';
--
-- b) Les policies effectives sur planning_cells et planning_config :
-- select tablename, policyname, roles, cmd
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('planning_cells', 'planning_config')
-- order by tablename, policyname;
--
-- c) Vérifier qu'un compte anon ne voit plus les clés sensibles
--    (à lancer depuis l'app en anonyme, ou : set role anon; puis)
-- -- select key from public.planning_config order by key;
-- -- reset role;
