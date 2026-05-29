-- Notes libres par chantier — éditeur riche (HTML).
--
-- Une seule ligne par chantier (contrainte d'unicité sur chantier_id).
-- Le contenu est stocké en HTML produit par le contentEditable côté front
-- (gras / italique / souligné via document.execCommand).
--
-- last_client_id : identifiant unique par onglet (cf. getClientId() dans
-- src/supabase.js) qui sert à filtrer nos propres broadcasts Realtime.

CREATE TABLE IF NOT EXISTS public.chantier_notes (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id     text         NOT NULL UNIQUE,
  contenu         text         DEFAULT '',
  last_client_id  text,
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

-- Policy permissive (alignée avec le reste de la base)
ALTER TABLE public.chantier_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all" ON public.chantier_notes
  FOR ALL USING (true) WITH CHECK (true);

-- Activer Realtime sur cette table
ALTER PUBLICATION supabase_realtime ADD TABLE public.chantier_notes;
