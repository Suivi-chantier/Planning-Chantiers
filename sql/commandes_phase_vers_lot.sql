-- ============================================================================
-- COMMANDES : relier les lignes à un LOT (au lieu d'une PHASE)
-- ----------------------------------------------------------------------------
-- Non destructif : on AJOUTE une colonne lot_id et on la remplit à partir de
-- phase_id. La colonne phase_id est conservée (compat V1 / historique).
--
-- Mapping phase -> lot : identique à l'auto-classification des ouvrages.
-- ============================================================================

-- 1) Nouvelle colonne (idempotent)
alter table public.commande_lignes add column if not exists lot_id text;

-- 2) Migration phase_id -> lot_id (ne touche que les lignes pas encore mappées)
with map(phase_key, lot_id) as (values
  ('plomberie_ro','plomberie'),('finition_plomb','plomberie'),('cuisine','plomberie'),
  ('elec_vmc','electricite'),('finition_elec','electricite'),
  ('feraillage','murs_cloison'),('placo','murs_cloison'),('peinture_sols','murs_cloison'),
  ('menuiserie','menuiserie'),('demolition','demolition'),('finitions_gen','finitions_gen')
)
update public.commande_lignes cl
set lot_id = m.lot_id
from map m
where cl.phase_id = m.phase_key
  and (cl.lot_id is null or cl.lot_id = '');

-- 3) Index de ventilation par lot
create index if not exists commande_lignes_lot_idx
  on public.commande_lignes(phasage_id, lot_id);

-- 4) Contrôle : combien de lignes liées à un lot, combien restent sans lot
select
  count(*)                                          as total_lignes,
  count(*) filter (where lot_id is not null)        as lignes_avec_lot,
  count(*) filter (where lot_id is null
                     and phase_id is not null
                     and phase_id <> '')            as phase_non_mappee,
  count(*) filter (where (phase_id is null or phase_id = '')) as lignes_sans_phase
from public.commande_lignes;
