-- ============================================================================
-- ANNULATION — restauration des 59 ouvrages de bibliothèque du 14/09/2026
-- ============================================================================
--
-- Défait sql/202609_restauration_bibliotheque_14-09.sql : retire les 59
-- identifiants des archivés, puis supprime les 59 ouvrages réinsérés.
-- Effet : les 140 ouvrages de chantier redeviennent orphelins (153 au total).
--
-- À N'UTILISER QUE SUR DÉCISION. Le script refuse de s'exécuter si :
--   • la bibliothèque n'est pas historisée (trg_data_history absent) : la
--     suppression ne serait pas récupérable — c'est exactement l'erreur du
--     14/09 qu'on ne reproduit pas ;
--   • un chiffrage (profero_ouvrages_selectionnes) cite l'un des 59 : le
--     supprimer créerait de nouveaux liens morts, côté devis cette fois ;
--   • la liste des archivés a une forme inattendue (on ne l'écrase pas).
--
-- Chaque ouvrage supprimé part dans data_history (op = DELETE) : l'annulation
-- est elle-même annulable, en relançant le script de restauration… à ceci
-- près que celui-ci lit les sauvegardes du 14/09, pas celles de l'annulation.
-- Une modification faite sur un ouvrage restauré entre-temps ne serait donc
-- récupérable que depuis data_history, à la main.
--
-- Rejouable : sans effet si rien n'est à défaire. Tout ou rien.
--
-- La liste des 59 est la même que dans le script de restauration (commentée
-- ligne par ligne là-bas).
-- ============================================================================

begin;

do $$
declare
  ids constant text[] := array[
    '57a0500e-2911-432a-9c66-ab9bcd5b9807','d1d07796-3823-47a9-baa4-af51c8bfd143',
    '3659c0bb-0cf3-4b9f-bbcd-3ab5fbafe5e2','f8b98ba9-8668-4ccc-b5de-57514364ce71',
    'dba8b7e7-de60-497b-ab31-fc08bca7a1ea','fb705fd4-7f84-4e2c-b04d-a45ae3f0908d',
    '9311d5dd-c4a9-4ac4-a836-185029bfa93b','afa3805b-5523-4804-a30f-9359b2c944f4',
    'ede57186-bf4d-4f7d-b7f8-6408308029c3','3e05bcda-9445-466c-8222-fbaefae34d33',
    '52f36295-80a3-4e1a-ac48-8362d8183116','3f7a7f7f-e34e-4bee-a9d9-a7f6daf56ecc',
    '09051c8e-ce6d-40f3-9ef4-93beb8b2de10','b689dd51-8401-4be8-a40c-b9049ba84e85',
    'c210f005-d0f5-47aa-b96f-16b687e1f957','42dba44b-bb2a-4989-aef4-1a7e447f7967',
    '30d631ce-f584-498f-9a2a-76527643eb06','fa920471-bc08-4cc3-82db-fc9342f27478',
    '64dd0da9-6ea6-4c51-881c-ea453b06e748','534d2624-8167-4883-b5f3-057ab507fabc',
    '03b7e951-c512-4bab-aa78-3ec8c433a9eb','b232d988-e697-4cfa-973c-60643b8e16e2',
    'e08620bc-d9f8-48dc-b78e-4c7ddbd90a58','fa16f016-154d-4472-a2fc-c7980696fdf2',
    '4d448589-5748-4acd-b97b-88132d3bce5b','c4fdd915-cf02-414f-a9cb-60a7110f8f4f',
    '63d3ffe0-04ec-497e-9521-53172a8a4a1f','d4f83acb-e0cd-429c-82bd-08c295477d32',
    '05ea2e74-bc08-4ed5-abdb-ee379aa1fdb1','d5b6de39-03cd-46a6-9561-4db3519acfbd',
    '59d416cc-50dd-434f-9042-68301eecb8f5','ed735405-e022-46fd-b426-03301f7ca2ec',
    '1e8373a4-f629-483f-83c9-ee652bed2a89','5da2efee-80d6-476b-a4fc-aaa13b7ce579',
    '2670e12a-6439-466f-93cd-8326cb0cb63a','b60a769f-1328-44ea-aa5d-2b084271757e',
    '850b2942-5a87-4f33-9878-35f80e3dd51f','ca6f9b56-1a7c-4dbf-96cd-1b27bee73ca4',
    '67a74647-6bd6-4af8-9805-fa2bd5c66d9a','3b840a45-37c4-40ce-9be7-d29509d8f3e4',
    '16699eed-2daf-470d-bf45-162f4a4744d0','551f4fbd-2160-4a51-9fa3-ee57cb3b3c5a',
    '5866389f-bdd4-42f3-ab43-2a24892f5291','aa0fe462-8bb7-426a-86ee-9682206ff221',
    '1e874758-c82d-4998-b2bb-3730121b081c','74659fbf-a336-45b2-b0ca-95f2ce42c6fd',
    '2e747179-da0f-4e56-b30c-fca298a6f7e3','4c065ea8-451f-4061-ba32-f01948363686',
    'fd17c0ba-65e4-432a-adcd-130e029552c0','e6f9a484-d3fa-4746-8809-413a8a2666d2',
    '8d179fa8-0b2f-445d-aa6d-c0147ea314c8','d9fb2cc1-f2c5-4e39-a30d-d9804225d7ff',
    '76af0d8f-7d06-4502-b242-2d74fb5bdabb','f516846f-7f79-4cf1-96b0-9a9840132e66',
    '7cbcb234-101a-4e39-b286-e20789d22602','e5226f55-da20-4288-9920-93c5f31805e7',
    '018f5390-0599-4589-81fd-bf22264b1986','2d6a6dbb-2104-413f-8f9b-1aa062fbc1c5',
    '202f4391-ad4c-4475-8e06-ba5e6caff87e'
  ];
  n_chiffrage int;
  n_supprimes int;
  n_restants  int;
  cfg         jsonb;
  items_avant text[];
  items_apres text[];
begin
  if cardinality(ids) <> 59 or (select count(distinct x) from unnest(ids) x) <> 59 then
    raise exception 'Liste interne incohérente : 59 identifiants distincts attendus.';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.bibliotheque_ratios'::regclass
       and tgname = 'trg_data_history' and not tgisinternal
  ) then
    raise exception 'bibliotheque_ratios n''est pas historisée : la suppression ne serait pas récupérable. Appliquer d''abord la migration 20260924130000. Rien n''est annulé.';
  end if;

  select count(*) into n_chiffrage
    from public.profero_ouvrages_selectionnes s
   where s.bibliotheque_id::text = any(ids);
  if n_chiffrage > 0 then
    raise exception '% ligne(s) de chiffrage citent l''un des 59 ouvrages : les supprimer créerait des liens morts dans les devis. Rien n''est annulé.', n_chiffrage;
  end if;

  -- 1. Retrait des archivés (les autres archivés sont conservés, dans leur ordre)
  select pc.value into cfg
    from public.planning_config pc where pc.key = 'bibliotheque_archives'
     for update;

  if found and cfg is not null then
    if jsonb_typeof(cfg) <> 'object' or jsonb_typeof(cfg->'items') <> 'array' then
      raise exception 'planning_config.bibliotheque_archives a une forme inattendue : on ne l''écrase pas. Rien n''est annulé.';
    end if;
    select coalesce(array_agg(btrim(e) order by ord), array[]::text[]) into items_avant
      from jsonb_array_elements_text(cfg->'items') with ordinality as t(e, ord);
    select coalesce(array_agg(v order by ord), array[]::text[]) into items_apres
      from unnest(items_avant) with ordinality as t(v, ord)
     where v <> all(ids);
    if cardinality(items_apres) < cardinality(items_avant) then
      update public.planning_config
         set value = cfg || jsonb_build_object('items', to_jsonb(items_apres)),
             updated_at = now()
       where key = 'bibliotheque_archives';
    end if;
  end if;

  -- 2. Suppression (historisée par trg_data_history)
  delete from public.bibliotheque_ratios b where b.id::text = any(ids);
  get diagnostics n_supprimes = row_count;

  -- 3. Contrôles
  select count(*) into n_restants from public.bibliotheque_ratios b where b.id::text = any(ids);
  if n_restants > 0 then
    raise exception 'Contrôle : % ouvrage(s) encore présent(s). Tout est annulé.', n_restants;
  end if;
  if exists (
    select 1 from public.planning_config pc, jsonb_array_elements_text(pc.value->'items') e
     where pc.key = 'bibliotheque_archives' and btrim(e) = any(ids)
  ) then
    raise exception 'Contrôle : des identifiants restent dans les archivés. Tout est annulé.';
  end if;

  raise notice 'Annulation : % ouvrage(s) supprimé(s) (sauvegardés dans data_history), retirés des archivés.', n_supprimes;
end $$;

commit;
