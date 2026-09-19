-- La synchronisation de la bibliothèque pose désormais la CADENCE Profero dans
-- ProGBat, via PUT /company/library/structures/{id}/composition.
--
-- Deux cas suivis ici :
--   • 'create'      : l'ouvrage est créé PUIS sa composition est posée ;
--   • 'composition' : l'ouvrage était déjà lié et sa composition ProGBat était
--                     VIDE — seule la cadence y est ajoutée. Une composition
--                     existante n'est jamais remplacée.
--
-- Statuts ajoutés :
--   'composing' : PUT en cours (bloquant, comme 'creating') ;
--   'composed'  : cadence posée sur un ouvrage déjà lié ;
--   'created_sans_cadence' : l'ouvrage EXISTE bien dans ProGBat, mais le PUT de
--                     composition a échoué — la liaison est acquise, le temps
--                     reste à poser. Volontairement distinct de 'uncertain' :
--                     ici rien n'est douteux, il manque juste la cadence.

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

-- Un ouvrage n'a qu'une opération en cours à la fois : 'composing' rejoint les
-- statuts bloquants de l'index unique partiel.
drop index if exists progbat_library_sync_items_actif_uidx;
create unique index if not exists progbat_library_sync_items_actif_uidx
  on public.progbat_library_sync_items (ouvrage_id)
  where statut in ('linking', 'creating', 'composing', 'uncertain');
