-- ============================================================================
-- FILET DE SÉCURITÉ DONNÉES — historique universel + restauration
-- ============================================================================
--
-- Objectif : qu'AUCUNE donnée importante ne puisse être perdue définitivement,
-- même en cas de bug, d'écrasement collaboratif, de dé-validation ou de
-- suppression accidentelle.
--
-- Contexte : seule la table `phasages` avait jusqu'ici un filet (cf.
-- phasages_history.sql). Les heures réelles (`pointages`), les coûts matériaux
-- (`commande_lignes`, `commandes`, `factures`, `facture_bl`), les demandes
-- (`besoins`) et les comptes-rendus (`rapports`) n'avaient AUCUNE protection.
--
-- Principe : une table d'historique GÉNÉRIQUE + UN SEUL trigger réutilisable,
-- branché sur chaque table critique. À chaque UPDATE ou DELETE, l'état COMPLET
-- de la ligne AVANT l'opération est snapshoté en JSON. On peut ensuite
-- restaurer n'importe quelle ligne (cf. Renovation/Admin.jsx → Historique).
--
-- À exécuter dans Supabase SQL Editor. Idempotent (réexécutable sans risque).
-- ============================================================================

-- ─── Table d'historique générique ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.data_history (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name      text          NOT NULL,            -- table d'origine (ex 'pointages')
  row_id          text          NOT NULL,            -- id de la ligne touchée (uuid ou text)
  op              text          NOT NULL CHECK (op IN ('UPDATE', 'DELETE')),
  chantier_id     text,                              -- extrait si la ligne en a un (pour le filtre par chantier)
  row_data        jsonb         NOT NULL,            -- état COMPLET de la ligne AVANT l'opération
  changed_by      text,                              -- acteur best-effort (valide_par / saisi_par / ouvrier...)
  prev_updated_at timestamptz,                       -- updated_at de la version sauvegardée (si la table en a un)
  saved_at        timestamptz   NOT NULL DEFAULT now()
);

-- Index : lecture par chantier (vue Admin) et par ligne (timeline d'une ligne)
CREATE INDEX IF NOT EXISTS idx_data_history_chantier   ON public.data_history (chantier_id, saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_history_table_row  ON public.data_history (table_name, row_id, saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_history_saved      ON public.data_history (saved_at DESC);

-- ─── Trigger générique : snapshot de l'état PRÉCÉDENT ────────────────────────
-- Réutilisable sur n'importe quelle table : il lit la ligne via to_jsonb(OLD)
-- et en extrait, si elles existent, les clés chantier_id / updated_at / un acteur.
CREATE OR REPLACE FUNCTION public.log_data_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  j jsonb := to_jsonb(OLD);
BEGIN
  INSERT INTO public.data_history (
    table_name, row_id, op, chantier_id, row_data, changed_by, prev_updated_at
  )
  VALUES (
    TG_TABLE_NAME,
    COALESCE(j->>'id', ''),
    TG_OP,
    j->>'chantier_id',
    j,
    COALESCE(j->>'valide_par', j->>'saisi_par', j->>'ouvrier', j->>'cloture_par'),
    NULLIF(j->>'updated_at', '')::timestamptz
  );
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── Branchement sur les tables critiques ────────────────────────────────────
-- Helper local : (re)crée le trigger BEFORE UPDATE OR DELETE sur une table.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'pointages',        -- heures réelles + coût MO figé
    'commande_lignes',  -- coûts matériaux rattachés au chantier
    'commandes',        -- en-têtes commandes / BL / tickets
    'factures',         -- factures fournisseurs
    'facture_bl',       -- rapprochement facture ↔ BL
    'besoins',          -- demandes de matériel
    'rapports'          -- comptes-rendus de fin de journée
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- On ne crée le trigger que si la table existe réellement.
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_data_history ON public.%I;', t);
      EXECUTE format(
        'CREATE TRIGGER trg_data_history BEFORE UPDATE OR DELETE ON public.%I '
        'FOR EACH ROW EXECUTE FUNCTION public.log_data_history();', t
      );
    END IF;
  END LOOP;
END $$;

-- ─── Policy permissive (aligné avec le reste de la base) ─────────────────────
ALTER TABLE public.data_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all" ON public.data_history;
CREATE POLICY "public_all" ON public.data_history
  FOR ALL USING (true) WITH CHECK (true);

-- ─── Purge : conservation 365 jours (données financières/RH → on garde large) ─
CREATE OR REPLACE FUNCTION public.purge_data_history(retention_days int DEFAULT 365)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  deleted int;
BEGIN
  WITH d AS (
    DELETE FROM public.data_history
    WHERE saved_at < now() - (retention_days || ' days')::interval
    RETURNING 1
  )
  SELECT count(*) INTO deleted FROM d;
  RETURN deleted;
END;
$$;

-- ============================================================================
-- UTILISATION
-- ============================================================================
--
-- 1) Voir l'historique d'un chantier (toutes tables confondues) :
--    SELECT saved_at, table_name, op, changed_by, row_id
--    FROM data_history
--    WHERE chantier_id = '<chantier_id>'
--    ORDER BY saved_at DESC;
--
-- 2) Voir la timeline d'une ligne précise :
--    SELECT saved_at, op, changed_by, row_data
--    FROM data_history
--    WHERE table_name = 'pointages' AND row_id = '<uuid>'
--    ORDER BY saved_at DESC;
--
-- 3) Restaurer une ligne supprimée/modifiée (réinsère l'état sauvegardé) :
--    Côté app : bouton « Restaurer » dans Admin → Historique (recommandé).
--    En SQL, pour une ligne `pointages` par ex :
--      INSERT INTO public.pointages
--      SELECT * FROM jsonb_populate_record(NULL::public.pointages,
--               (SELECT row_data FROM data_history WHERE id = '<history_uuid>'))
--      ON CONFLICT (id) DO UPDATE SET
--        heures = EXCLUDED.heures, taux_horaire = EXCLUDED.taux_horaire;
--    (La restauration crée elle-même une entrée d'historique → annulable.)
-- ============================================================================
