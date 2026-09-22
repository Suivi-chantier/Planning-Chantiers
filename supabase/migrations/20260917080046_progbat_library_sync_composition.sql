alter table public.progbat_library_sync_items
  drop constraint if exists progbat_library_sync_items_action_check;
alter table public.progbat_library_sync_items
  add constraint progbat_library_sync_items_action_check
  check (action in ('link', 'create', 'composition'));

alter table public.progbat_library_sync_items
  drop constraint if exists progbat_library_sync_items_statut_check;
alter table public.progbat_library_sync_items
  add constraint progbat_library_sync_items_statut_check
  check (statut in (
    'linking', 'creating', 'composing',
    'linked', 'created', 'composed', 'created_sans_cadence',
    'failed', 'uncertain'
  ));

drop index if exists progbat_library_sync_items_actif_uidx;
create unique index if not exists progbat_library_sync_items_actif_uidx
  on public.progbat_library_sync_items (ouvrage_id)
  where statut in ('linking', 'creating', 'composing', 'uncertain');
