-- Historique automatique des phasages.
--
-- Chaque UPDATE sur public.phasages déclenche un INSERT dans phasages_history
-- avec l'état précédent (OLD) de la ligne. Permet de restaurer un phasage à
-- n'importe quelle version antérieure sans dépendre des backups Supabase.
--
-- Sert de filet de sécurité contre :
--   - les écrasements en édition collaborative (autosave concurrent)
--   - les bugs côté client qui pousseraient un plan_travaux vide
--   - les manipulations accidentelles (suppression d'ouvrage, etc.)
--
-- Retention : conservation 90 jours par défaut. Une cron task externe peut
-- appeler purge_phasages_history() pour nettoyer (voir bas de fichier).

CREATE TABLE IF NOT EXISTS public.phasages_history (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  phasage_id      uuid          NOT NULL,
  chantier_id     text,
  chantier_nom    text,
  ouvrages        jsonb,
  plan_travaux    jsonb,
  client_id       text,                       -- last_client_id qui a écrit la version précédente
  prev_updated_at timestamptz,                -- updated_at de la version sauvegardée
  saved_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phasages_history_phasage_saved
  ON public.phasages_history (phasage_id, saved_at DESC);

-- Trigger : à chaque UPDATE qui modifie ouvrages OU plan_travaux, on snapshote
-- la version PRÉCÉDENTE. On ne loggue pas les updates qui ne touchent à rien
-- de structurel (ex : un updated_at tout seul).
CREATE OR REPLACE FUNCTION public.phasages_log_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.phasages_history (
    phasage_id, chantier_id, chantier_nom,
    ouvrages, plan_travaux,
    client_id, prev_updated_at
  )
  VALUES (
    OLD.id, OLD.chantier_id, OLD.chantier_nom,
    OLD.ouvrages, OLD.plan_travaux,
    OLD.plan_travaux->'meta'->>'last_client_id',
    OLD.updated_at
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_phasages_log_history ON public.phasages;
CREATE TRIGGER trg_phasages_log_history
  BEFORE UPDATE ON public.phasages
  FOR EACH ROW
  WHEN (
    OLD.ouvrages     IS DISTINCT FROM NEW.ouvrages
    OR OLD.plan_travaux IS DISTINCT FROM NEW.plan_travaux
  )
  EXECUTE FUNCTION public.phasages_log_history();

-- Idem sur DELETE : si quelqu'un supprime un phasage, on garde la dernière
-- version pour permettre une restauration.
CREATE OR REPLACE FUNCTION public.phasages_log_history_on_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.phasages_history (
    phasage_id, chantier_id, chantier_nom,
    ouvrages, plan_travaux,
    client_id, prev_updated_at
  )
  VALUES (
    OLD.id, OLD.chantier_id, OLD.chantier_nom,
    OLD.ouvrages, OLD.plan_travaux,
    OLD.plan_travaux->'meta'->>'last_client_id',
    OLD.updated_at
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_phasages_log_history_delete ON public.phasages;
CREATE TRIGGER trg_phasages_log_history_delete
  BEFORE DELETE ON public.phasages
  FOR EACH ROW
  EXECUTE FUNCTION public.phasages_log_history_on_delete();

-- Policy permissive (aligné avec le reste de la base)
ALTER TABLE public.phasages_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all" ON public.phasages_history;
CREATE POLICY "public_all" ON public.phasages_history
  FOR ALL USING (true) WITH CHECK (true);

-- Purge : garde 90 jours d'historique. À appeler manuellement ou via cron.
CREATE OR REPLACE FUNCTION public.purge_phasages_history(retention_days int DEFAULT 90)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  deleted int;
BEGIN
  WITH d AS (
    DELETE FROM public.phasages_history
    WHERE saved_at < now() - (retention_days || ' days')::interval
    RETURNING 1
  )
  SELECT count(*) INTO deleted FROM d;
  RETURN deleted;
END;
$$;

-- ─── Utilisation ────────────────────────────────────────────────────────────
--
-- 1) Lister l'historique d'un phasage :
--    SELECT id, saved_at, client_id,
--           jsonb_array_length(COALESCE(ouvrages, '[]'::jsonb)) AS nb_ouvrages
--    FROM phasages_history
--    WHERE phasage_id = '<uuid>'
--    ORDER BY saved_at DESC;
--
-- 2) Restaurer une version :
--    UPDATE phasages p
--    SET ouvrages     = h.ouvrages,
--        plan_travaux = h.plan_travaux,
--        updated_at   = now()
--    FROM phasages_history h
--    WHERE h.id = '<history_uuid>'
--      AND p.id = h.phasage_id;
--    (Cette restauration crée elle-même une entrée d'historique de l'état
--     actuel avant écrasement, donc elle est annulable.)
