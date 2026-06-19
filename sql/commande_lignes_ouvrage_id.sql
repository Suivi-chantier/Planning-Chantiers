-- ============================================================================
-- COMMANDES : lien optionnel d'une ligne à un OUVRAGE (en plus du lot)
-- ----------------------------------------------------------------------------
-- Le lot reste le lien principal (commande_lignes.lot_id). On ajoute un
-- ouvrage_id OPTIONNEL pour pouvoir préciser à quel ouvrage une référence
-- commandée se rattache (utilisé par le panneau "Matériaux & commandes" de
-- Phasage V2). Non destructif, idempotent.
-- ============================================================================

alter table public.commande_lignes add column if not exists ouvrage_id text;

create index if not exists commande_lignes_ouvrage_idx
  on public.commande_lignes(ouvrage_id) where ouvrage_id is not null;
