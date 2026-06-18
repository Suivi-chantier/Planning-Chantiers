-- ============================================================================
-- LOTS V2 : (A) ajout des 3 nouveaux lots, (B) auto-classification des ouvrages
-- ----------------------------------------------------------------------------
-- À lancer APRÈS la migration des tâches (migration_phasage_v2_apply.sql).
-- Lit plan_travaux (intact) pour déduire la phase dominante de chaque ouvrage,
-- puis pose lot_id. Filet de sécurité : trigger phasages_history + backup.
--
-- Mapping phase -> lot (validé avec le gérant) :
--   plomberie_ro, finition_plomb, cuisine        -> plomberie     (Plomberie sanitaire)
--   elec_vmc, finition_elec                       -> electricite   (Électricité)
--   feraillage, placo, peinture_sols              -> murs_cloison  (Murs cloison doublages)
--   menuiserie                                    -> menuiserie    (NOUVEAU)
--   demolition                                    -> demolition    (NOUVEAU)
--   finitions_gen                                 -> finitions_gen (NOUVEAU)
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ (A) Ajout des 3 nouveaux lots dans planning_config (idempotent, non destr.)║
-- ╚══════════════════════════════════════════════════════════════════════════╝
with
new_lots(item) as (
  values
    ('{"id":"menuiserie","label":"Menuiserie","couleur":"#b45309","code_prefixe":"ME"}'::jsonb),
    ('{"id":"demolition","label":"Démolition","couleur":"#e05c5c","code_prefixe":"D"}'::jsonb),
    ('{"id":"finitions_gen","label":"Finitions générales","couleur":"#a78bfa","code_prefixe":"FG"}'::jsonb)
),
cur(items) as (
  select value->'items' from planning_config where key = 'lots_travaux'
),
base as (  -- items existants, sinon les 5 lots historiques par défaut
  select coalesce((select items from cur),
    '[{"id":"electricite","label":"Électricité","couleur":"#eab308","code_prefixe":"E"},
      {"id":"maconnerie","label":"Maçonnerie","couleur":"#a8a29e","code_prefixe":"M"},
      {"id":"murs_cloison","label":"Murs cloison doublages","couleur":"#6366f1","code_prefixe":"MC"},
      {"id":"ouvertures","label":"Ouvertures","couleur":"#8b5cf6","code_prefixe":"O"},
      {"id":"plomberie","label":"Plomberie sanitaire","couleur":"#06b6d4","code_prefixe":"P"}]'::jsonb
  ) as items
),
to_add as (
  select nl.item from new_lots nl
  where not exists (
    select 1 from jsonb_array_elements((select items from base)) b
    where b->>'id' = nl.item->>'id'
  )
),
merged as (
  select (select items from base) || coalesce((select jsonb_agg(item) from to_add), '[]'::jsonb) as items
)
insert into planning_config (key, value)
select 'lots_travaux', jsonb_build_object('items', (select items from merged))
on conflict (key) do update set value = excluded.value;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ (B-dry) APERÇU de l'auto-classification — n'écrit rien                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Décommente ce bloc pour voir, par ouvrage, le lot proposé (phase dominante).
/*
with
pl as (
  select p.id as phasage_id, ph.phase_key,
    nullif(t.value->>'ouvrage_id','') as ouvrage_id,
    lower(trim(coalesce(t.value->>'ouvrage_libelle',''))) as ouvrage_libelle
  from phasages p
  cross join lateral jsonb_each(coalesce(p.plan_travaux,'{}'::jsonb)) ph(phase_key, phase_val)
  cross join lateral jsonb_array_elements(
      case when jsonb_typeof(ph.phase_val)='array' then ph.phase_val else '[]'::jsonb end) t(value)
  where ph.phase_key <> 'meta'
),
map(phase_key, lot_id) as (values
  ('plomberie_ro','plomberie'),('finition_plomb','plomberie'),('cuisine','plomberie'),
  ('elec_vmc','electricite'),('finition_elec','electricite'),
  ('feraillage','murs_cloison'),('placo','murs_cloison'),('peinture_sols','murs_cloison'),
  ('menuiserie','menuiserie'),('demolition','demolition'),('finitions_gen','finitions_gen')
),
ex as (
  select p.id as phasage_id, p.chantier_nom, o.ord, o.value as ouvrage,
    coalesce(o.value->>'id','') as o_id,
    lower(trim(coalesce(o.value->>'libelle',''))) as o_libelle
  from phasages p
  cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.ouvrages)='array' then p.ouvrages else '[]'::jsonb end) with ordinality o(value, ord)
),
votes as (
  -- un ouvrage reçoit les votes de TOUTES les tâches qui le désignent,
  -- par ouvrage_id OU par libellé. Les ouvrages en doublon (même libellé)
  -- sont ainsi tous classés de la même manière.
  select ex.phasage_id, ex.ord, m.lot_id, count(*) as n
  from ex
  join pl on pl.phasage_id=ex.phasage_id
    and ((pl.ouvrage_id is not null and pl.ouvrage_id=ex.o_id)
      or (pl.ouvrage_libelle<>'' and pl.ouvrage_libelle=ex.o_libelle))
  join map m on m.phase_key=pl.phase_key
  group by ex.phasage_id, ex.ord, m.lot_id
),
best as (
  select distinct on (phasage_id, ord) phasage_id, ord, lot_id
  from votes order by phasage_id, ord, n desc
)
select ex.chantier_nom,
       left(ex.ouvrage->>'libelle', 60) as ouvrage,
       coalesce(b.lot_id, '(reste sans lot)') as lot_propose
from ex left join best b on b.phasage_id=ex.phasage_id and b.ord=ex.ord
order by ex.chantier_nom, lot_propose;
*/


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ (B-apply) AUTO-CLASSIFICATION — pose lot_id sur les ouvrages               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
with
pl as (
  select p.id as phasage_id, ph.phase_key,
    nullif(t.value->>'ouvrage_id','') as ouvrage_id,
    lower(trim(coalesce(t.value->>'ouvrage_libelle',''))) as ouvrage_libelle
  from phasages p
  cross join lateral jsonb_each(coalesce(p.plan_travaux,'{}'::jsonb)) ph(phase_key, phase_val)
  cross join lateral jsonb_array_elements(
      case when jsonb_typeof(ph.phase_val)='array' then ph.phase_val else '[]'::jsonb end) t(value)
  where ph.phase_key <> 'meta'
),
map(phase_key, lot_id) as (values
  ('plomberie_ro','plomberie'),('finition_plomb','plomberie'),('cuisine','plomberie'),
  ('elec_vmc','electricite'),('finition_elec','electricite'),
  ('feraillage','murs_cloison'),('placo','murs_cloison'),('peinture_sols','murs_cloison'),
  ('menuiserie','menuiserie'),('demolition','demolition'),('finitions_gen','finitions_gen')
),
ex as (
  select p.id as phasage_id, o.ord, o.value as ouvrage,
    coalesce(o.value->>'id','') as o_id,
    lower(trim(coalesce(o.value->>'libelle',''))) as o_libelle
  from phasages p
  cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.ouvrages)='array' then p.ouvrages else '[]'::jsonb end) with ordinality o(value, ord)
),
votes as (
  -- un ouvrage reçoit les votes de TOUTES les tâches qui le désignent,
  -- par ouvrage_id OU par libellé. Les ouvrages en doublon (même libellé)
  -- sont ainsi tous classés de la même manière.
  select ex.phasage_id, ex.ord, m.lot_id, count(*) as n
  from ex
  join pl on pl.phasage_id=ex.phasage_id
    and ((pl.ouvrage_id is not null and pl.ouvrage_id=ex.o_id)
      or (pl.ouvrage_libelle<>'' and pl.ouvrage_libelle=ex.o_libelle))
  join map m on m.phase_key=pl.phase_key
  group by ex.phasage_id, ex.ord, m.lot_id
),
best as (
  select distinct on (phasage_id, ord) phasage_id, ord, lot_id
  from votes order by phasage_id, ord, n desc
),
rebuilt as (
  select ex.phasage_id, ex.ord,
    case when b.lot_id is not null
         then jsonb_set(ex.ouvrage, '{lot_id}', to_jsonb(b.lot_id))
         else ex.ouvrage end as ouvrage
  from ex left join best b on b.phasage_id=ex.phasage_id and b.ord=ex.ord
),
final as (
  select phasage_id, jsonb_agg(ouvrage order by ord) as ouvrages_new
  from rebuilt group by phasage_id
)
update public.phasages p
set ouvrages = f.ouvrages_new, updated_at = now()
from final f
where f.phasage_id = p.id
  and p.ouvrages is distinct from f.ouvrages_new;
