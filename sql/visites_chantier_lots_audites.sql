-- ============================================================================
-- VISITE CHANTIER V2 : audit par LOT (au lieu de PHASE)
-- ----------------------------------------------------------------------------
-- La page Visite chantier est rebranchée sur le modèle Phasage V2
-- (Lot → Ouvrage → Tâche). La portée d'une visite se choisit par lot et le
-- détail d'audit est désormais indexé par lot_id dans la colonne `audit`.
--
-- Non destructif : on AJOUTE la colonne lots_audites. L'ancienne colonne
-- phases_auditees est conservée (elle n'est simplement plus alimentée).
-- ============================================================================

-- Nouvelle colonne portée par lot (liste de lot_id)
alter table public.visites_chantier
  add column if not exists lots_audites jsonb default '[]'::jsonb;

-- Sécurité : s'assurer que la checklist existe aussi (déjà créée normalement)
alter table public.visites_chantier
  add column if not exists checklist jsonb default '[]'::jsonb;

-- Contrôle
select
  count(*)                                                 as total_visites,
  count(*) filter (where lots_audites is not null
                     and jsonb_array_length(lots_audites) > 0) as visites_par_lot
from public.visites_chantier;
