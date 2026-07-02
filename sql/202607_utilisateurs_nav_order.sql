-- Ordre personnalisé des onglets de la barre de navigation, mémorisé par utilisateur.
-- Tableau JSON d'identifiants de pages (ex : ["dashboard","chantiers",...]).
-- NULL = ordre par défaut.

ALTER TABLE utilisateurs
  ADD COLUMN IF NOT EXISTS nav_order jsonb;

COMMENT ON COLUMN utilisateurs.nav_order IS
  'Ordre personnalisé des onglets de la sidebar Rénovation (tableau d''ids de pages). NULL = ordre par défaut.';
