-- Historique des snapshots d'avancement par chantier.
--
-- Un snapshot est pris automatiquement chaque vendredi soir 18h Paris via le
-- workflow GitHub Actions cron-snapshot-avancement.yml qui appelle l'endpoint
-- Vercel /api/cron-snapshot-avancement.
--
-- Sert au calcul de la progression hebdomadaire affichée dans le bilan
-- semaine de la page Équipe (avant cette semaine → maintenant).

CREATE TABLE IF NOT EXISTS public.chantier_avancement_history (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id       text          NOT NULL,
  chantier_nom      text,
  phasage_id        uuid,
  avancement        integer       NOT NULL CHECK (avancement >= 0 AND avancement <= 100),
  taches_terminees  integer       DEFAULT 0,
  taches_total      integer       DEFAULT 0,
  date_snapshot     date          NOT NULL DEFAULT CURRENT_DATE,
  created_at        timestamptz   NOT NULL DEFAULT now()
);

-- Index pour les requêtes par chantier et par date (lecture courante)
CREATE INDEX IF NOT EXISTS idx_avancement_history_chantier_date
  ON public.chantier_avancement_history (chantier_id, date_snapshot DESC);

-- Empêcher 2 snapshots pour le même chantier le même jour (idempotence du cron)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_avancement_history_chantier_date
  ON public.chantier_avancement_history (chantier_id, date_snapshot);

-- Policy permissive (pour rester aligné avec le reste de la base)
ALTER TABLE public.chantier_avancement_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all" ON public.chantier_avancement_history
  FOR ALL USING (true) WITH CHECK (true);
