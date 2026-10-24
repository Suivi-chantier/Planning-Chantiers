-- ============================================================================
-- Refonte des comptes rendus — CR-4 : dictée vocale et photo de fin de journée.
--
-- Deux colonnes facultatives sur `rapports` (purement additive : aucune donnée
-- existante touchée, aucun droit modifié — les droits de la table couvrent
-- les nouvelles colonnes, l'envoi les retire si la base ne les connaît pas).
--
--   dictee              le texte raconté par l'ouvrier, TOUJOURS conservé tel
--                       quel à côté de la remarque reformulée par l'IA :
--                       { texte_origine, source ("micro" | "clavier"),
--                         remarque_reformulee, relue (bool), prerempli (nb de
--                         tâches préremplies) }
--   photos_fin_journee  adresses des photos « de la zone en fin de journée »
--                       (sous-ensemble de photos_chantier, qui les contient
--                       aussi : tous les lecteurs existants les voient).
-- ============================================================================
alter table public.rapports add column if not exists dictee jsonb;
alter table public.rapports add column if not exists photos_fin_journee jsonb;

comment on column public.rapports.dictee is
  'CR-4 : texte dicté d''origine (toujours conservé) + remarque reformulée par l''IA.';
comment on column public.rapports.photos_fin_journee is
  'CR-4 : photos de la zone en fin de journée (aussi présentes dans photos_chantier).';
