-- =====================================================================
-- QUANTITÉS POSÉES — étape 4 du nouveau compte rendu (bêta « cr_v2 »)
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller),
-- AVANT la nouvelle version de sql/202610_ouvrier_mes_phases.sql (qui lit
-- ces colonnes).
-- Idempotent. Aucune donnée existante modifiée : les trois colonnes sont
-- vides pour tous les pointages actuels, et le restent pour toute tâche
-- suivie en pourcentage. Aucune policy touchée (l'écriture des pointages
-- reste celle de la Validation, avec ses droits actuels).
--
-- Une ligne de pointage d'une tâche suivie en quantité porte :
--   quantite_declaree  ce que l'ouvrier a déclaré (« posé aujourd'hui »),
--                      vide quand la quantité vient d'un % de l'ancien
--                      formulaire converti à la validation ;
--   quantite_validee   ce que le conducteur a retenu (toujours >= 0) ;
--   quantite_unite     l'unité au moment de la validation (m², ml, m³, U),
--                      figée comme le taux horaire : les cadences passées
--                      restent lisibles si l'unité d'un ouvrage change.
--
-- Le CUMUL d'une tâche n'est stocké nulle part : point de départ
-- (phasages.ouvrages[].taches[].quantite_reprise) + somme des
-- quantite_validee de ses pointages. Une dévalidation (« Corriger »), qui
-- supprime les pointages du rapport, le fait donc baisser d'elle-même.
-- =====================================================================

alter table public.pointages add column if not exists quantite_declaree numeric;
alter table public.pointages add column if not exists quantite_validee  numeric;
alter table public.pointages add column if not exists quantite_unite    text;

comment on column public.pointages.quantite_declaree is
  'Quantité posée déclarée par l''ouvrier (nouveau compte rendu), dans quantite_unite. Vide si suivi en pourcentage ou si la quantité vient d''un % converti.';
comment on column public.pointages.quantite_validee is
  'Quantité posée retenue à la validation (>= 0). Cumul d''une tâche = taches[].quantite_reprise + somme de cette colonne.';
comment on column public.pointages.quantite_unite is
  'Unité figée à la validation : m², ml, m³ ou U.';

-- Une quantité validée ou déclarée n'est jamais négative (cadences propres).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pointages_quantites_positives') then
    alter table public.pointages
      add constraint pointages_quantites_positives
      check ((quantite_validee is null or quantite_validee >= 0)
         and (quantite_declaree is null or quantite_declaree >= 0));
  end if;
end $$;

-- =====================================================================
-- VÉRIFICATION — attendu : 3 lignes (les trois colonnes), puis
-- contrainte_presente = true et pointages_avec_quantite = 0 juste après
-- l'application (rien n'est rempli tant qu'aucune quantité n'est validée).
-- =====================================================================
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'pointages' and column_name like 'quantite%';
-- select exists (select 1 from pg_constraint where conname = 'pointages_quantites_positives') as contrainte_presente,
--        (select count(*) from public.pointages where quantite_validee is not null) as pointages_avec_quantite;
