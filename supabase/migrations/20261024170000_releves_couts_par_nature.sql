-- ============================================================================
-- Refonte du Bilan — étape 3.4 : ventilation des coûts par nature dans les
-- relevés journaliers (fiche chantier de la version détaillée du Bilan).
--
-- CHANGEMENT (purement additif) : une colonne jsonb couts_par_nature sur
-- chantier_releves_journaliers, écrite par le serveur à chaque relevé :
--   { materiaux, sous_traitance, location, dechets, autre } en € HT
-- (même calcul que la ventilation affichée dans le Phasage : coutsParNature
-- de chantierFinance). Les relevés existants gardent null (« pas encore
-- disponible ») jusqu'à leur prochain recalcul.
-- Aucune nouvelle table, aucune policy, aucune fonction, aucune donnée
-- existante modifiée.
-- ============================================================================
alter table public.chantier_releves_journaliers
  add column if not exists couts_par_nature jsonb;

comment on column public.chantier_releves_journaliers.couts_par_nature is
  'Coûts engagés par nature à la date (€ HT) : materiaux, sous_traitance, location, dechets, autre. Étape 3.4 du Bilan.';
