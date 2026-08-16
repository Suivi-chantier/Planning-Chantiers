-- ============================================================================
-- Dossier des ÉTATS DES LIEUX (Profero Invest).
-- À exécuter dans l'éditeur SQL Supabase. Idempotent.
--
-- Une ligne = un état des lieux (entrée ou sortie) d'un bien.
--
-- Cycle de vie :
--   'brouillon' → la saisie est synchronisée en continu entre les appareils
--                 (colonne `donnees`), MAIS les photos restent locales à
--                 l'appareil (IndexedDB) : rien n'est envoyé au Storage tant
--                 que le rapport n'est pas figé.
--   'archive'   → le rapport est figé. Les photos ont été recompressées et
--                 poussées une seule fois dans le bucket "invest-documents"
--                 (préfixe edl/<id>/), et `donnees.items[code].p` contient
--                 alors les CHEMINS Storage à la place des images en base64.
--                 La ligne devient lecture seule côté application.
--
-- Pourquoi les chemins et pas des URLs : le bucket est PRIVÉ. L'app resigne
-- les URLs à l'ouverture du rapport (createSignedUrls) — un lien qui fuite
-- expire, ce qui est le minimum pour des photos de logement habité.
--
-- Pourquoi les photos ne sont PAS dans la base : `donnees` resterait sous
-- forme de base64 en JSONB (~130 Ko la photo), soit plusieurs Mo par ligne.
-- Le Storage est fait pour ça, la base non.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.invest_etats_des_lieux (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identification du dossier
  titre          text        NOT NULL,                       -- ex. "Résidence Al Hana — Apt 16"
  adresse        text,
  type           text        NOT NULL DEFAULT 'ENTRÉE',      -- 'ENTRÉE' | 'SORTIE'
  date_edl       date,

  statut         text        NOT NULL DEFAULT 'brouillon',   -- 'brouillon' | 'archive'

  -- Saisie complète : { meta, items:{ "C1-08":{s,o,v,p[]} }, general, sigs }
  -- `p` = [] tant que le dossier est un brouillon, [chemins Storage] une fois archivé.
  donnees        jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Compteurs dénormalisés : la liste s'affiche sans avoir à parser le JSONB.
  nb_elements    integer     NOT NULL DEFAULT 0,
  nb_renseignes  integer     NOT NULL DEFAULT 0,
  nb_photos      integer     NOT NULL DEFAULT 0,
  nb_reserves    integer     NOT NULL DEFAULT 0,

  auteur         text,
  archive_le     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Tri par défaut de la liste : les dossiers récents d'abord.
CREATE INDEX IF NOT EXISTS idx_invest_edl_maj
  ON public.invest_etats_des_lieux (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_invest_edl_statut
  ON public.invest_etats_des_lieux (statut, date_edl DESC);

-- updated_at tenu à jour côté base : la sauvegarde automatique passe par des
-- UPDATE partiels, on ne veut pas dépendre du client pour l'horodatage.
CREATE OR REPLACE FUNCTION public.invest_edl_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invest_edl_touch ON public.invest_etats_des_lieux;
CREATE TRIGGER trg_invest_edl_touch
  BEFORE UPDATE ON public.invest_etats_des_lieux
  FOR EACH ROW EXECUTE FUNCTION public.invest_edl_touch();

-- RLS : un état des lieux nomme les locataires et décrit leur logement →
-- bureau uniquement, jamais les comptes ouvrier (même modèle que
-- chantier_reference_financiere).
ALTER TABLE public.invest_etats_des_lieux ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bureau_all" ON public.invest_etats_des_lieux;
CREATE POLICY "bureau_all" ON public.invest_etats_des_lieux
  FOR ALL TO authenticated
  USING (NOT public.est_ouvrier())
  WITH CHECK (NOT public.est_ouvrier());

-- ── Bucket ──────────────────────────────────────────────────────────────────
-- Les photos archivées vont dans le bucket PRIVÉ "invest-documents", déjà
-- utilisé par le CRM et la Structuration, sous le préfixe edl/<id>/.
-- Si ce bucket n'existe pas encore sur votre projet :
--   Supabase → Storage → New bucket → Nom : invest-documents → Public : OFF
-- Les policies ci-dessous sont idempotentes et n'écrasent rien d'autre.

INSERT INTO storage.buckets (id, name, public)
VALUES ('invest-documents', 'invest-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "invest-documents lecture" ON storage.objects;
CREATE POLICY "invest-documents lecture" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'invest-documents');

DROP POLICY IF EXISTS "invest-documents ecriture" ON storage.objects;
CREATE POLICY "invest-documents ecriture" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'invest-documents');

DROP POLICY IF EXISTS "invest-documents suppression" ON storage.objects;
CREATE POLICY "invest-documents suppression" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'invest-documents');
