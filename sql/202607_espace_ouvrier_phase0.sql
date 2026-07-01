-- =====================================================================
-- ESPACE OUVRIER — PHASE 0 : Fondations données & sécurité
-- =====================================================================
-- Ce fichier tient le journal des migrations SQL de la Phase 0, appliquées
-- manuellement dans le SQL Editor Supabase (copier-coller), par étapes.
--
-- Voir le plan complet : public/plan-espace-ouvrier.md
--
-- Ordre d'application :
--   0A    fondations non destructives (colonne + helpers)   [APPLIQUÉ]
--   0C-1  verrouillage tables financières/sensibles          [APPLIQUÉ]
--   0C-2  verrouillage autres tables bureau-only            [APPLIQUÉ]
--   0C-3  policies anon + ouvrier (config/cells/rapports/besoins) [APPLIQUÉ]
--   → PHASE 0 TERMINÉE (bureau + formulaire public testés OK).
--
-- Modèle : chaque policy s'appuie sur public.est_ouvrier().
--   bureau  (authenticated non-ouvrier) : accès conservé (not est_ouvrier())
--   ouvrier : bloqué, sauf policies dédiées filtrées (0C-3)
--   anon    : fermé, sauf 4 chemins du formulaire public (0C-3)
-- Hors périmètre 0C : tables invest_*, cr_*, bucket storage "photos".
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0A — Fondations (NON DESTRUCTIF) — APPLIQUÉ
-- Ajoute la colonne prenom_planning + les helpers de rôle.
-- Ne modifie AUCUNE policy.
-- ---------------------------------------------------------------------

-- 1) Colonne prenom_planning sur utilisateurs (nullable, clé de jointure métier)
alter table public.utilisateurs
  add column if not exists prenom_planning text;

-- Unicité "un prénom-planning = une personne", NULL multiple autorisé
-- (comptes existants non reliés) via index partiel.
create unique index if not exists utilisateurs_prenom_planning_uniq
  on public.utilisateurs (prenom_planning)
  where prenom_planning is not null;

-- 2) Helpers de rôle (SECURITY DEFINER : lisent utilisateurs sans déclencher
--    la RLS de utilisateurs → pas de récursion). Ne renvoient que des infos
--    sur le compte de l'appelant (auth.email() courant).

create or replace function public.mon_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.utilisateurs where email = auth.email() limit 1;
$$;

create or replace function public.est_ouvrier()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'ouvrier' from public.utilisateurs where email = auth.email() limit 1),
    false
  );
$$;

create or replace function public.mon_prenom_planning()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select prenom_planning from public.utilisateurs where email = auth.email() limit 1;
$$;


-- ---------------------------------------------------------------------
-- 0C-1 — Verrouillage bureau-only des tables financières/sensibles — APPLIQUÉ
-- Bureau (authenticated non-ouvrier) : accès complet. anon + ouvrier : rien.
-- Aucune de ces tables n'est lue par le formulaire public.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  t text;
  cibles text[] := array[
    'pointages','data_history',
    'phasages','phasages_history','phasages_backup_premig_v2',
    'commandes','commande_lignes','factures','facture_bl',
    'commandes_detail','commandes_passees','fournisseurs'
  ];
begin
  foreach t in array cibles loop
    for r in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', r.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "bureau_all" on public.%I for all to authenticated ' ||
      'using (not public.est_ouvrier()) with check (not public.est_ouvrier())',
      t
    );
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 0C-2 — Verrouillage bureau-only (reste des tables rénovation) — APPLIQUÉ
-- (invest_*, cr_*, materiaux_bibliotheque, utilisateurs : NON touchées)
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  t text;
  cibles text[] := array[
    'bibliotheque_ratios','chantier_avancement_history','chantier_notes',
    'clotures_journee','planning_chantiers','planning_commandes',
    'planning_mensuel','planning_notes','plans','visites_chantier',
    'profero_categories_ouvrages','profero_cotes',
    'profero_ouvrages_selectionnes','profero_plans','profero_projets',
    'vehicules','sourcing_annonces','sourcing_criteres','sourcing_logs'
  ];
begin
  foreach t in array cibles loop
    for r in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', r.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "bureau_all" on public.%I for all to authenticated ' ||
      'using (not public.est_ouvrier()) with check (not public.est_ouvrier())',
      t
    );
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 0C-3 — Policies fines pour les 4 tables à chemins anon/ouvrier — APPLIQUÉ
-- Préserve le formulaire public (SELECT config/cells + INSERT rapports/besoins
-- en anon) et ouvre l'accès ouvrier filtré (utilisé dès la Phase 1+).
-- ---------------------------------------------------------------------

-- 1) Purge des policies existantes de ces 4 tables
do $$
declare
  r record;
  t text;
  cibles text[] := array['planning_config','planning_cells','rapports','besoins'];
begin
  foreach t in array cibles loop
    for r in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', r.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- 2) planning_config
create policy "config_bureau_all" on public.planning_config
  for all to authenticated
  using (not public.est_ouvrier()) with check (not public.est_ouvrier());
create policy "config_ouvrier_sel" on public.planning_config
  for select to authenticated
  using (public.est_ouvrier());
create policy "config_anon_sel" on public.planning_config
  for select to anon
  using (true);

-- 3) planning_cells
create policy "cells_bureau_all" on public.planning_cells
  for all to authenticated
  using (not public.est_ouvrier()) with check (not public.est_ouvrier());
create policy "cells_ouvrier_sel" on public.planning_cells
  for select to authenticated
  using (public.est_ouvrier() and public.mon_prenom_planning() = any(ouvriers));
create policy "cells_anon_sel" on public.planning_cells
  for select to anon
  using (true);

-- 4) rapports
create policy "rapports_bureau_all" on public.rapports
  for all to authenticated
  using (not public.est_ouvrier()) with check (not public.est_ouvrier());
create policy "rapports_ouvrier_sel" on public.rapports
  for select to authenticated
  using (public.est_ouvrier() and ouvrier = public.mon_prenom_planning());
create policy "rapports_ouvrier_ins" on public.rapports
  for insert to authenticated
  with check (public.est_ouvrier() and ouvrier = public.mon_prenom_planning());
create policy "rapports_anon_ins" on public.rapports
  for insert to anon
  with check (true);

-- 5) besoins
create policy "besoins_bureau_all" on public.besoins
  for all to authenticated
  using (not public.est_ouvrier()) with check (not public.est_ouvrier());
create policy "besoins_ouvrier_sel" on public.besoins
  for select to authenticated
  using (public.est_ouvrier() and ouvrier_demandeur = public.mon_prenom_planning());
create policy "besoins_ouvrier_ins" on public.besoins
  for insert to authenticated
  with check (public.est_ouvrier() and ouvrier_demandeur = public.mon_prenom_planning());
create policy "besoins_anon_ins" on public.besoins
  for insert to anon
  with check (true);
