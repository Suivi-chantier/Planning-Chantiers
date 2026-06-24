-- ════════════════════════════════════════════════════════════════════════════
-- Rattrapage rétroactif des avancements perdus sur les chantiers V2
-- ════════════════════════════════════════════════════════════════════════════
--
-- Contexte : avant le fix du 19/06/2026, le bloc "double écriture V2" de la
-- validation matchait uniquement par NOM. Quand l'ouvrier avait écrit un nom
-- différent (faute de frappe, abréviation), l'auto-match rattachait bien
-- tache_id mais le nom ne matchait pas → l'avancement n'était pas reporté
-- dans phasages.ouvrages[].taches[].avancement.
--
-- Stratégie : pour chaque pointage validé qui a un tache_id et un
-- avancement_declare, on reporte cet avancement sur la tâche correspondante
-- de l'ouvrage. Garde-fou : on ne BAISSE jamais l'avancement existant.
--
-- Limites :
-- - Si le conducteur avait saisi un avancement arbitré différent du déclaré,
--   on perd l'info (la table pointages ne stocke que le déclaré). On utilise
--   le max(avancement_declare) — c'est une approximation raisonnable.
-- - V1 (plan_travaux) n'est PAS touché : le bug n'existait que sur V2.
--
-- Idempotent : peut être relancé sans risque (le garde-fou anti-baisse protège).

DO $$
DECLARE
  ph RECORD;
  ouvrage JSONB;
  tache JSONB;
  new_ouvrages JSONB;
  new_taches JSONB;
  tache_id_text TEXT;
  max_av INTEGER;
  current_av INTEGER;
  changed BOOLEAN;
  total_taches INTEGER := 0;
  total_phasages INTEGER := 0;
BEGIN
  FOR ph IN
    SELECT id, chantier_id, ouvrages
    FROM phasages
    WHERE ouvrages IS NOT NULL
      AND jsonb_typeof(ouvrages) = 'array'
      AND jsonb_array_length(ouvrages) > 0
  LOOP
    new_ouvrages := '[]'::jsonb;
    changed := false;

    FOR ouvrage IN SELECT value FROM jsonb_array_elements(ph.ouvrages) LOOP
      new_taches := '[]'::jsonb;

      IF ouvrage ? 'taches' AND jsonb_typeof(ouvrage->'taches') = 'array' THEN
        FOR tache IN SELECT value FROM jsonb_array_elements(ouvrage->'taches') LOOP
          tache_id_text := tache->>'id';

          IF tache_id_text IS NOT NULL THEN
            -- Cherche le max(avancement_declare) parmi les pointages liés à
            -- cette tâche pour ce chantier.
            SELECT MAX(avancement_declare) INTO max_av
            FROM pointages
            WHERE chantier_id = ph.chantier_id
              AND tache_id = tache_id_text
              AND avancement_declare IS NOT NULL;

            current_av := COALESCE((tache->>'avancement')::int, 0);

            -- Anti-régression : on ne descend jamais l'avancement.
            IF max_av IS NOT NULL AND max_av > current_av THEN
              tache := jsonb_set(tache, '{avancement}', to_jsonb(max_av));
              total_taches := total_taches + 1;
              changed := true;
            END IF;
          END IF;

          new_taches := new_taches || tache;
        END LOOP;

        ouvrage := jsonb_set(ouvrage, '{taches}', new_taches);
      END IF;

      new_ouvrages := new_ouvrages || ouvrage;
    END LOOP;

    IF changed THEN
      UPDATE phasages SET ouvrages = new_ouvrages, updated_at = now() WHERE id = ph.id;
      total_phasages := total_phasages + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Rattrapage terminé : % tâches mises à jour dans % phasages.',
    total_taches, total_phasages;
END $$;
