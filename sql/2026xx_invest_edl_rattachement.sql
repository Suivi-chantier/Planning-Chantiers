-- ============================================================================
-- RATTACHEMENT DES ÉTATS DES LIEUX AU STOCK DE BIENS (Profero Invest).
-- À exécuter dans l'éditeur SQL Supabase. Idempotent.
--
-- Pourquoi : un état des lieux ne portait ni bien_id ni client_id, ni en base
-- ni dans l'interface. Il flottait, identifié par un titre et une adresse en
-- texte libre — retrouver tous les états des lieux d'un bien supposait de se
-- souvenir de la façon dont on avait écrit son adresse.
--
-- C'est le dernier des trois modules isolés à être rattaché, après Urbanisme
-- (colonnes déjà présentes, il ne manquait que l'interface) et Sourcing
-- (annonce_id).
--
-- ON DELETE SET NULL : un constat contradictoire est signé par deux parties.
-- Supprimer un bien du stock ne doit pas l'emporter — il garde sa valeur
-- probante indépendamment de la fiche commerciale.
--
-- Ce fichier peut être exécuté AVANT ou APRÈS le déploiement du code : le
-- sélecteur de bien se masque tant que la colonne n'existe pas, et la saisie
-- libre de l'adresse continue de fonctionner comme aujourd'hui.
-- ============================================================================

ALTER TABLE public.invest_etats_des_lieux
  ADD COLUMN IF NOT EXISTS bien_id   uuid,
  ADD COLUMN IF NOT EXISTS client_id uuid;

-- Clés étrangères seulement si les tables cibles existent : même précaution
-- que dans 202608_invest_urbanisme.sql.
DO $$
BEGIN
  IF to_regclass('public.invest_biens') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invest_edl_bien_fk') THEN
    ALTER TABLE public.invest_etats_des_lieux
      ADD CONSTRAINT invest_edl_bien_fk FOREIGN KEY (bien_id)
      REFERENCES public.invest_biens(id) ON DELETE SET NULL;
  END IF;

  IF to_regclass('public.invest_clients') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invest_edl_client_fk') THEN
    ALTER TABLE public.invest_etats_des_lieux
      ADD CONSTRAINT invest_edl_client_fk FOREIGN KEY (client_id)
      REFERENCES public.invest_clients(id) ON DELETE SET NULL;
  END IF;
END $$;

-- « Quels états des lieux pour ce bien ? » — question posée à chaque ouverture
-- d'une fiche bien, et triée par date pour la chronologie entrée / sortie.
CREATE INDEX IF NOT EXISTS idx_invest_edl_bien
  ON public.invest_etats_des_lieux (bien_id, date_edl DESC)
  WHERE bien_id IS NOT NULL;

COMMENT ON COLUMN public.invest_etats_des_lieux.bien_id IS
  'Bien du stock concerné. Les dossiers antérieurs à cette colonne restent à '
  'NULL : le rattachement se fait à la main, on ne devine pas sur l''adresse.';

-- ── Reprise des dossiers existants ──────────────────────────────────────────
-- Volontairement AUCUNE : rapprocher sur l'adresse en texte libre produirait
-- des rattachements faux sur des dossiers qui font foi entre deux parties.
-- Les états des lieux déjà saisis restent non rattachés, et l'interface permet
-- de les relier un par un.
