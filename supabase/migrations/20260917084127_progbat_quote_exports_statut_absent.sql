alter table public.progbat_quote_exports
  drop constraint if exists progbat_quote_exports_statut_check;
alter table public.progbat_quote_exports
  add constraint progbat_quote_exports_statut_check
  check (statut in ('preparing', 'creating', 'created', 'failed', 'uncertain', 'absent'));
