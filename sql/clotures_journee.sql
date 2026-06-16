-- Clôture de fin de journée : verrouille les rapports d'une date donnée pour
-- empêcher toute (re)validation tardive. Réouverture possible mais tracée.
--
-- chantier_id NULL = clôture globale de la journée (tous chantiers).
-- Pour l'instant on n'utilise que la clôture globale ; la colonne est prévue
-- pour pouvoir clôturer par chantier plus tard si besoin.

CREATE TABLE IF NOT EXISTS public.clotures_journee (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  date          date          NOT NULL,
  chantier_id   text,         -- NULL = clôture globale
  statut        text          NOT NULL DEFAULT 'cloture' CHECK (statut IN ('cloture', 'reouverte')),
  -- Historique chronologique : [{ action: 'cloture'|'reouverture', par, le, motif }]
  historique    jsonb         NOT NULL DEFAULT '[]'::jsonb,
  cloture_par   text,
  cloture_le    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now()
);

-- Une seule entrée par (date, chantier_id) — la même journée n'est pas
-- clôturée deux fois en parallèle.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_clotures_date_chantier
  ON public.clotures_journee (date, COALESCE(chantier_id, ''));

CREATE INDEX IF NOT EXISTS idx_clotures_date ON public.clotures_journee (date DESC);

ALTER TABLE public.clotures_journee ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all" ON public.clotures_journee FOR ALL USING (true) WITH CHECK (true);
