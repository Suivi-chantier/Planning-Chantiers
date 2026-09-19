-- ProGBat — suivi des devis brouillon : clé du logement et vérification GET.
--
-- Clé du logement : dans Profero, UN projet (profero_projets) = UN logement
-- (colonnes logement_reference / type_logement ; l'ancien tableau `logements`
-- n'est plus qu'une lecture de repli et un projet multi-logements est refusé
-- par le générateur). La clé du logement est donc project_id, déjà couverte par
-- l'index unique partiel progbat_quote_exports_actif_uidx (project_id, statut ∈
-- creating / created / uncertain). On fige en plus la référence du logement au
-- moment de la réservation, pour l'audit, et le résultat de la lecture GET
-- /company/quotes/{quoteId} effectuée après un POST explicitement réussi.
--
-- Idempotente et SANS PERTE.
alter table public.progbat_quote_exports
  add column if not exists logement_reference       text,          -- profero_projets.logement_reference au moment de la réservation
  add column if not exists verified_at              timestamptz,   -- GET /company/quotes/{id} réussi après création
  add column if not exists verification_http_status integer;       -- code HTTP de cette lecture (null = non tentée)

comment on column public.progbat_quote_exports.logement_reference is
  'Référence du logement (profero_projets.logement_reference) figée à la réservation ; la clé d''unicité reste project_id (un projet = un logement).';
comment on column public.progbat_quote_exports.verified_at is
  'Date de la relecture GET /company/quotes/{quoteId} confirmant le brouillon après un POST réussi (jamais suivie d''un second POST).';
