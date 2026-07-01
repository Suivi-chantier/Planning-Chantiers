-- =====================================================================
-- ESPACE OUVRIER — PHASE 0 : Fondations données & sécurité
-- =====================================================================
-- Ce fichier tient le journal des migrations SQL de la Phase 0, appliquées
-- manuellement dans le SQL Editor Supabase (copier-coller), par étapes.
--
-- Voir le plan complet : public/plan-espace-ouvrier.md
--
-- Ordre d'application :
--   0A  fondations non destructives (colonne + helpers)     [APPLIQUÉ]
--   0C  réécriture des policies RLS (par lots)              [À VENIR]
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
