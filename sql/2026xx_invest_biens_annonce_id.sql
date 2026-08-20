-- ============================================================================
-- RATTACHEMENT ANNONCE → BIEN (Profero Invest).
-- À exécuter dans l'éditeur SQL Supabase. Idempotent.
--
-- Pourquoi : Sourcing collecte, qualifie et note des annonces dans
-- sourcing_annonces. Aucun chemin ne transformait une annonce retenue en bien
-- du stock — le mot « invest_biens » n'apparaissait pas une seule fois dans
-- les 2 887 lignes de Sourcing.jsx. Une annonce validée était intégralement
-- retapée dans l'onglet Biens, avec les fautes de frappe et les écarts de prix
-- que cela suppose.
--
-- La colonne compte autant que le bouton qu'elle rend possible :
--   • elle empêche de créer deux fois le même bien depuis la même annonce ;
--   • elle permet de savoir quel canal d'acquisition produit les biens qui se
--     vendent — l'annonce garde sa source, le bien garde son annonce.
--
-- ON DELETE SET NULL : purger d'anciennes annonces ne doit pas emporter les
-- biens qui en sont issus, ni les faire disparaître du stock.
--
-- ── Ordre d'application ─────────────────────────────────────────────────────
-- Ce fichier peut être exécuté AVANT ou APRÈS le déploiement du code : le
-- bouton « Créer le bien » fonctionne dans les deux cas. Sans la colonne, il
-- crée le bien mais ne peut pas détecter les doublons, et le signale à
-- l'écran. C'est la leçon de la migration invest_projets, qui imposait un
-- ordre — et un ordre imposé finit par être inversé.
-- ============================================================================

ALTER TABLE public.invest_biens
  ADD COLUMN IF NOT EXISTS annonce_id uuid;

-- Clé étrangère seulement si la table source est là : sourcing peut ne pas
-- être déployé sur tous les environnements.
DO $$
BEGIN
  IF to_regclass('public.sourcing_annonces') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invest_biens_annonce_fk') THEN
    ALTER TABLE public.invest_biens
      ADD CONSTRAINT invest_biens_annonce_fk FOREIGN KEY (annonce_id)
      REFERENCES public.sourcing_annonces(id) ON DELETE SET NULL;
  END IF;
END $$;

-- « Cette annonce a-t-elle déjà produit un bien ? » — question posée à chaque
-- affichage de la liste des annonces, donc indexée.
CREATE INDEX IF NOT EXISTS idx_invest_biens_annonce
  ON public.invest_biens (annonce_id)
  WHERE annonce_id IS NOT NULL;

COMMENT ON COLUMN public.invest_biens.annonce_id IS
  'Annonce Sourcing dont ce bien est issu. Empêche le doublon à la création '
  'et conserve la trace du canal d''acquisition.';
