-- Snapshot hebdomadaire FINANCIER par chantier (étape 2 du plan Bilan semaine).
--
-- Chaque vendredi 18h Paris, le cron /api/cron-snapshot-hebdo calcule la ligne
-- financière complète de chaque chantier ACTIF via src/chantierFinance.js
-- (mêmes formules que Phasage V2) et l'insère ici. Bénéfices : bilan instantané
-- à charger, séries temporelles pour voir les dérives, bilans passés qui
-- restent justes quand on les rouvre.
--
-- Idempotence : UNIQUE (chantier_id, date_snapshot) — un second appel le même
-- jour met à jour la ligne au lieu de la dupliquer (upsert).
--
-- Le cron d'avancement existant (chantier_avancement_history) continue de
-- tourner en parallèle ; on le supprimera plus tard si celui-ci le remplace.

CREATE TABLE IF NOT EXISTS public.chantier_snapshots_hebdo (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id     text        NOT NULL,
  chantier_nom    text,
  phasage_id      uuid,
  week_id         text        NOT NULL,               -- même format que weekId dans l'app ("2026-W31")
  date_snapshot   date        NOT NULL DEFAULT current_date,

  -- Ligne financière (source : computeChantierFinance, formules Phasage V2)
  vendu_ht        numeric,                            -- somme des prix HT des ouvrages
  mo_prev         numeric,                            -- heures vendues × taux MO prévisionnel
  mat_prev        numeric,                            -- somme des coûts matériaux estimés (biblio)
  mo_reel         numeric,                            -- coût MO total (tâches + libres + indirect + reprise)
  mat_reel        numeric,                            -- somme des lignes de commande
  fg              numeric,                            -- frais généraux (taux × heures réelles)
  marge           numeric,                            -- marge nette = vendu − MO − mat − FG
  marge_pct       numeric,
  avancement      numeric,                            -- avancement pondéré (0-100)
  heures_vendues  numeric,
  heures_reelles  numeric,

  lots            jsonb,      -- [{id,label,heuresVendues,heuresReelles,avancement,ratioDerive}]
  warnings        jsonb,      -- warnings du module + {code:"reconstitue"} pour le backfill

  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Lecture courante : dernier snapshot d'un chantier / série temporelle.
CREATE INDEX IF NOT EXISTS idx_snapshots_hebdo_chantier_date
  ON public.chantier_snapshots_hebdo (chantier_id, date_snapshot DESC);

-- Idempotence du cron : un snapshot par chantier et par jour.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_snapshots_hebdo_chantier_date
  ON public.chantier_snapshots_hebdo (chantier_id, date_snapshot);

-- RLS : cette table contient des MARGES → verrouillage bureau-only, comme les
-- tables sensibles de 202607_espace_ouvrier_phase0.sql. PAS de "public_all".
ALTER TABLE public.chantier_snapshots_hebdo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bureau_all" ON public.chantier_snapshots_hebdo;
CREATE POLICY "bureau_all" ON public.chantier_snapshots_hebdo
  FOR ALL TO authenticated
  USING (NOT public.est_ouvrier())
  WITH CHECK (NOT public.est_ouvrier());
