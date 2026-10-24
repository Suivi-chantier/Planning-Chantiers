-- ============================================================================
-- Refonte des marges — étape 2 : les trois marges dans les relevés journaliers.
--
-- CHANGEMENT (purement additif) : nouvelles colonnes sur
-- chantier_releves_journaliers, écrites par le serveur à chaque relevé :
--   - production_cumulee  : Σ prix des ouvrages × avancement exact à la date ;
--   - marge_avancement    : production cumulée − coûts réels imputés
--                           (le constat, « où j'en suis ») ;
--   - materiaux_imputes   : matériaux imputés à l'avancement des lots
--                           (+ sous-traitance, location, bennes, autres) ;
--   - materiaux_en_avance : achats anticipés dans l'enveloppe d'un lot ;
--   - marge_probable      : marge à terminaison corrigée de la dérive des lots ;
--   - budget_restant      : vendu − coûts engagés (ancienne « marge nette »,
--                           qui n'est PAS une marge) ;
--   - heures_sans_lot / pct_sans_lot : heures pointées hors d'un lot ;
--   - chantier_repris     : chantier démarré avant l'application (exclu des
--                           alertes et des statistiques).
-- Les colonnes marge / marge_pct (ancienne « marge nette ») ne sont plus
-- écrites : commentaire posé, aucune donnée supprimée.
-- Aucune nouvelle table, aucune policy, aucune fonction.
--
-- RETOUR ARRIÈRE : alter table public.chantier_releves_journaliers
--   drop column production_cumulee, drop column marge_avancement, … (colonnes
--   ci-dessous) ; comment on column … is null.
-- Idempotente.
-- ============================================================================

alter table public.chantier_releves_journaliers
  add column if not exists production_cumulee  numeric,
  add column if not exists marge_avancement    numeric,
  add column if not exists materiaux_imputes   numeric,
  add column if not exists materiaux_en_avance numeric,
  add column if not exists marge_probable      numeric,
  add column if not exists budget_restant      numeric,
  add column if not exists heures_sans_lot     numeric,
  add column if not exists pct_sans_lot        numeric,
  add column if not exists chantier_repris     boolean not null default false;

comment on column public.chantier_releves_journaliers.marge is
  'Obsolète depuis le 24/10/2026 (ancienne « marge nette » = budget restant, pas une marge) : plus écrite, voir budget_restant et marge_avancement.';
comment on column public.chantier_releves_journaliers.marge_pct is
  'Obsolète depuis le 24/10/2026 : plus écrite.';
comment on column public.chantier_releves_journaliers.marge_avancement is
  'Marge à l''avancement : production cumulée exacte − coûts réels imputés (MO, FG, autres natures, matériaux imputés à l''avancement des lots).';
comment on column public.chantier_releves_journaliers.marge_probable is
  'Marge probable : marge à terminaison − Σ lots heures restantes × (coefficient − 1) × (taux MO prév. + FG).';
comment on column public.chantier_releves_journaliers.budget_restant is
  'Vendu − coûts engagés à date (ancienne « marge nette »). Ce n''est pas une marge.';
