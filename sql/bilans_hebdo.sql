-- Bilan hebdomadaire — informations saisies par le conducteur de travaux
-- en complément des rapports d'équipe, pour le bilan de semaine transmis à
-- la hiérarchie.
--
-- Une seule ligne par semaine (week_id = même format que weekId dans l'app,
-- ex. "2026-S28"). Les données sont stockées en JSONB :
--
--   {
--     "blocages": [
--       { "chantier_id": "...", "chantier_nom": "...", "texte": "...",
--         "statut": "info" | "decision" }
--     ],
--     "semaine_suivante": [
--       { "chantier_id": "...", "chantier_nom": "...", "texte": "..." }
--     ]
--   }

CREATE TABLE IF NOT EXISTS public.bilans_hebdo (
  week_id     text         PRIMARY KEY,
  data        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

-- Policy permissive (alignée avec le reste de la base)
ALTER TABLE public.bilans_hebdo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all" ON public.bilans_hebdo;
CREATE POLICY "public_all" ON public.bilans_hebdo
  FOR ALL USING (true) WITH CHECK (true);
