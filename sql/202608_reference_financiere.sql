-- Référence financière FIGÉE d'un chantier (Point 5, Prompt 3).
--
-- Une ligne = une PRISE de référence : les 3 séries mensuelles PRÉVUES
-- (dépenses, recettes, valeur générée) calculées par
-- src/Renovation/diagrammeFinancier.mjs à un instant donné, avec libellé,
-- auteur et récapitulatif. C'est la courbe « pointillés » du diagramme
-- financier — celle qui NE BOUGE PAS quand le planning change, pour que la
-- dérive reste visible.
--
-- TABLE INSERT-ONLY (convention applicative) :
--   • la référence COURANTE d'un chantier = sa ligne la plus récente
--     (date_prise DESC) ;
--   • « Reprendre une nouvelle référence » (re-basage, ex. gros avenant)
--     = un nouvel INSERT — les anciennes lignes ne sont JAMAIS modifiées ni
--     supprimées : l'historique est garanti par construction ;
--   • aucun UPDATE nulle part → le piège saveMeta (read-before-write non
--     atomique de plan_travaux) est évité par conception.
--
-- Un chantier sans ligne ici fonctionne normalement partout : le diagramme
-- n'affichera que le réel, avec une invitation à prendre la référence.

CREATE TABLE IF NOT EXISTS public.chantier_reference_financiere (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id   text        NOT NULL,
  chantier_nom  text,
  phasage_id    uuid,
  libelle       text        NOT NULL,                  -- ex. "Référence initiale", "Avenant n°2"
  auteur        text,
  date_prise    timestamptz NOT NULL DEFAULT now(),

  -- Les 3 séries mensuelles prévues, telles que rendues par
  -- seriesPrevuesChantier : { depenses:{points,nonPlace,controle},
  -- valeurGeneree:{points,avancementPrevuFinal}, recettes:{points,acompte} }.
  series        jsonb       NOT NULL,

  -- Récapitulatif montré à l'utilisateur AVANT de figer (recapReference) :
  -- vendu HT, MO/mat prévus, période couverte, tâches non datées, acompte…
  recap         jsonb,
  warnings      jsonb,

  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Lecture courante : dernière référence d'un chantier / historique trié.
CREATE INDEX IF NOT EXISTS idx_reference_financiere_chantier_date
  ON public.chantier_reference_financiere (chantier_id, date_prise DESC);

-- RLS : les séries contiennent des MONTANTS PRÉVUS et des MARGES implicites →
-- verrouillage bureau-only, comme chantier_snapshots_hebdo. PAS de "public_all".
ALTER TABLE public.chantier_reference_financiere ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bureau_all" ON public.chantier_reference_financiere;
CREATE POLICY "bureau_all" ON public.chantier_reference_financiere
  FOR ALL TO authenticated
  USING (NOT public.est_ouvrier())
  WITH CHECK (NOT public.est_ouvrier());
