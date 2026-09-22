alter table public.progbat_quote_exports
  add column if not exists logement_reference       text,
  add column if not exists verified_at              timestamptz,
  add column if not exists verification_http_status integer;

comment on column public.progbat_quote_exports.logement_reference is
  'Référence du logement (profero_projets.logement_reference) figée à la réservation ; la clé d''unicité reste project_id (un projet = un logement).';
comment on column public.progbat_quote_exports.verified_at is
  'Date de la relecture GET /company/quotes/{quoteId} confirmant le brouillon après un POST réussi (jamais suivie d''un second POST).';
