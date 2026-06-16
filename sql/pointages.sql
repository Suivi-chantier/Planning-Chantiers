-- Registre de pointage : une écriture par (ouvrier, tâche, date) issue
-- d'un compte rendu de fin de journée validé par le conducteur.
--
-- Le coût d'une écriture = heures × taux_horaire FIGÉ au moment de la
-- validation. Un changement ultérieur du taux d'un ouvrier ne doit PAS
-- réécrire l'historique : c'est pour ça que taux_horaire est stocké sur
-- la ligne (et non lu en jointure).
--
-- Ce registre remplace progressivement le champ unique
-- phasages.plan_travaux[*].heures_reelles, qui ne savait pas gérer
-- plusieurs ouvriers et calculait le coût avec le taux du PREMIER ouvrier
-- de la tâche (faux dès que deux ouvriers à taux différent travaillent
-- sur la même tâche).
--
-- Les colonnes type_pointage / motif_indirect sont créées dès cette étape
-- pour préparer le Prompt 3 (validation) et le Prompt 7 (heures indirectes :
-- trajet, intempéries, nettoyage, SAV...). Elles ne sont pas encore
-- exploitées par le P2 mais évitent une ALTER TABLE plus tard.

CREATE TABLE IF NOT EXISTS public.pointages (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Lien vers la tâche / le chantier / le phasage / la phase
  chantier_id          text          NOT NULL,
  phasage_id           uuid,
  phase_id             text,
  tache_id             text,         -- nullable : tâche libre ou heure indirecte
  -- Qui, quand, combien
  ouvrier              text          NOT NULL,
  date                 date          NOT NULL,
  heures               numeric(6,2)  NOT NULL CHECK (heures >= 0),
  -- Taux figé à la validation : si le taux change ensuite, on NE recalcule pas
  taux_horaire         numeric(8,2)  NOT NULL DEFAULT 0,
  -- Source : compte rendu validé
  rapport_id           uuid,
  -- Avancement déclaré par l'ouvrier (pour info ; l'arbitrage vit dans plan_travaux)
  avancement_declare   integer       CHECK (avancement_declare IS NULL OR (avancement_declare >= 0 AND avancement_declare <= 100)),
  valide_par           text,
  -- Type d'écriture : tâche productive vs heure indirecte (trajet/intempéries/...)
  type_pointage        text          NOT NULL DEFAULT 'tache' CHECK (type_pointage IN ('tache', 'indirect')),
  motif_indirect       text,         -- rempli si type_pointage = 'indirect'
  created_at           timestamptz   NOT NULL DEFAULT now()
);

-- Index utiles pour les agrégations
CREATE INDEX IF NOT EXISTS idx_pointages_tache    ON public.pointages (tache_id) WHERE tache_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pointages_phase    ON public.pointages (chantier_id, phase_id);
CREATE INDEX IF NOT EXISTS idx_pointages_chantier ON public.pointages (chantier_id, date);
CREATE INDEX IF NOT EXISTS idx_pointages_ouvrier  ON public.pointages (ouvrier, date);
CREATE INDEX IF NOT EXISTS idx_pointages_rapport  ON public.pointages (rapport_id) WHERE rapport_id IS NOT NULL;

-- Empêche le double comptage si un rapport est revalidé : on ne recrée pas
-- d'écriture pour la même (rapport, tâche, ouvrier, date). Pour les tâches
-- libres (tache_id NULL) ou les heures indirectes, l'idempotence est gérée
-- côté code à la validation (cf. P3).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pointages_rapport_tache
  ON public.pointages (rapport_id, tache_id, ouvrier, date)
  WHERE rapport_id IS NOT NULL AND tache_id IS NOT NULL;

-- Policy permissive (aligné avec le reste de la base)
ALTER TABLE public.pointages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all" ON public.pointages
  FOR ALL USING (true) WITH CHECK (true);
