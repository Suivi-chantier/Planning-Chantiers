-- ============================================================
-- PROMPT 7 — Autoriser source='manuel' sur commandes
-- (commandes créées manuellement depuis la page Commandes :
--  conversion d'un besoin, saisie manuelle bureau). NON destructif.
-- ============================================================
alter table public.commandes drop constraint if exists commandes_source_check;
alter table public.commandes
  add constraint commandes_source_check
  check (source in ('mobile','import_ia','migration','facture','planning','manuel'));
