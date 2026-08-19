-- ============================================================================
-- FICHE DE DEMANDE URBANISME (FDU) — Profero Invest.
-- À exécuter dans l'éditeur SQL Supabase. Idempotent.
--
-- Une ligne = une demande d'autorisation d'urbanisme (DP ou PC) sur un bien.
--
-- Règle d'or portée par la table : une FDU incomplète ne part pas.
-- La complétude est recalculée côté application à chaque enregistrement et
-- dénormalisée dans `completude` / `nb_pieces_manquantes` pour que la liste de
-- suivi puisse trier et alerter sans parser le JSONB.
--
-- Cycle de vie (colonne `statut`) :
--   'brouillon'      → le commercial remplit sa FDU
--   'transmis'       → FDU envoyée au pôle urbanisme (Camille)
--   'attente_pieces' → repartie au commercial : pièces ou blocs manquants
--   'complet'        → prise en charge, prête à déposer
--   'depose'         → dépôt effectué, instruction en cours
--   'pieces_mairie'  → pièces complémentaires demandées (délai relancé à zéro)
--   'accorde' / 'refuse'
--   'purge'          → recours des tiers purgé, chantier démarrable
--   'abandonne'
--
-- Pourquoi tout le détail dans `donnees` (jsonb) et pas en colonnes : la FDU
-- compte une dizaine de blocs dont trois tableaux à lignes variables
-- (menuiseries, logements créés, bâtiments). Seules les données qui servent au
-- pilotage de la liste et aux échéances sont sorties en colonnes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.invest_urbanisme_dossiers (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Bloc 1 — identification (sorti en colonnes : filtres et tri de la liste)
  reference             text        NOT NULL,                     -- n° de dossier / réf. chantier
  entite                text        NOT NULL DEFAULT 'Profero Invest',
  commercial            text,
  adresse               text,
  code_postal           text,
  commune               text,

  statut                text        NOT NULL DEFAULT 'brouillon',

  -- Nature et régime de la demande
  natures               jsonb       NOT NULL DEFAULT '[]'::jsonb, -- ids du bloc 4
  autorisation          text,                                     -- 'DP' | 'PC' | 'À trancher'
  abf                   text        NOT NULL DEFAULT 'À vérifier', -- 'Oui' | 'Non' | 'À vérifier'

  -- Dates qui pilotent le rétroplanning
  date_demande          date,
  date_max_depot        date,
  date_depot            date,
  date_fin_instruction  date,

  -- Saisie complète : { identification, demandeur, bien, nature, division,
  -- facade, surfaces, stationnement, complement, pieces, todo, validation, suivi }
  donnees               jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Compteurs dénormalisés pour la liste de suivi
  completude            integer     NOT NULL DEFAULT 0,           -- 0-100 (champs obligatoires)
  nb_menuiseries        integer     NOT NULL DEFAULT 0,           -- lignes du bloc 6
  nb_pieces_manquantes  integer     NOT NULL DEFAULT 0,           -- checklist § 2

  -- Rattachement optionnel au reste de Profero Invest
  bien_id               uuid,
  client_id             uuid,

  auteur                text,
  transmis_le           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Les colonnes de pilotage ont pu manquer sur une base créée avant cette
-- version du fichier : on les ajoute sans toucher aux données existantes.
ALTER TABLE public.invest_urbanisme_dossiers
  ADD COLUMN IF NOT EXISTS date_depot           date,
  ADD COLUMN IF NOT EXISTS date_fin_instruction date,
  ADD COLUMN IF NOT EXISTS bien_id              uuid,
  ADD COLUMN IF NOT EXISTS client_id            uuid,
  ADD COLUMN IF NOT EXISTS transmis_le          timestamptz;

-- Rattachement au stock de biens et au CRM : en FK seulement si les tables
-- sont là, et en SET NULL — supprimer un bien ne doit pas emporter la trace
-- d'une autorisation déposée en mairie.
DO $$
BEGIN
  IF to_regclass('public.invest_biens') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invest_urba_bien_fk') THEN
    ALTER TABLE public.invest_urbanisme_dossiers
      ADD CONSTRAINT invest_urba_bien_fk FOREIGN KEY (bien_id)
      REFERENCES public.invest_biens(id) ON DELETE SET NULL;
  END IF;

  IF to_regclass('public.invest_clients') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invest_urba_client_fk') THEN
    ALTER TABLE public.invest_urbanisme_dossiers
      ADD CONSTRAINT invest_urba_client_fk FOREIGN KEY (client_id)
      REFERENCES public.invest_clients(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Tri par défaut de la liste de suivi : les dossiers touchés en dernier d'abord.
CREATE INDEX IF NOT EXISTS idx_invest_urba_maj
  ON public.invest_urbanisme_dossiers (updated_at DESC);

-- Vue « qu'est-ce qui sort bientôt » : statut + échéance de dépôt.
CREATE INDEX IF NOT EXISTS idx_invest_urba_echeance
  ON public.invest_urbanisme_dossiers (statut, date_max_depot);

CREATE INDEX IF NOT EXISTS idx_invest_urba_bien
  ON public.invest_urbanisme_dossiers (bien_id);

-- updated_at tenu à jour côté base : la sauvegarde automatique passe par des
-- UPDATE partiels, on ne dépend pas du client pour l'horodatage.
CREATE OR REPLACE FUNCTION public.invest_urba_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invest_urba_touch ON public.invest_urbanisme_dossiers;
CREATE TRIGGER trg_invest_urba_touch
  BEFORE UPDATE ON public.invest_urbanisme_dossiers
  FOR EACH ROW EXECUTE FUNCTION public.invest_urba_touch();

-- RLS : une FDU nomme le demandeur (état civil, SIRET) et décrit son bien →
-- bureau uniquement, jamais les comptes ouvrier (même modèle que
-- invest_etats_des_lieux).
ALTER TABLE public.invest_urbanisme_dossiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bureau_all" ON public.invest_urbanisme_dossiers;
CREATE POLICY "bureau_all" ON public.invest_urbanisme_dossiers
  FOR ALL TO authenticated
  USING (NOT public.est_ouvrier())
  WITH CHECK (NOT public.est_ouvrier());
