-- ============================================================
-- Autorise le statut 'archivee' sur factures
-- (facture enregistrée sans rapprochement des BL : période de
--  transition avant la saisie des BL, ou fournisseur sans BL).
-- NON destructif.
-- ============================================================
alter table public.factures drop constraint if exists factures_statut_check;
alter table public.factures
  add constraint factures_statut_check
  check (statut in ('a_rapprocher','rapprochee','archivee'));
