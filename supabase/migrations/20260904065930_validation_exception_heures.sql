alter table public.rapports
  add column if not exists exception_heures jsonb;

comment on column public.rapports.exception_heures is
  'Trace du déverrouillage du garde-fou heures lors de la validation d une journée exceptionnelle.';
