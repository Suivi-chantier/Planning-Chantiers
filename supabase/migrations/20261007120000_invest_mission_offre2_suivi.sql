-- ============================================================================
-- Fiche Mission Offre 2 — suivi de la fin de mission (travaux, transmission) et détails d'acquisition.
-- Périmètre : Profero Invest. ÉVOLUTION ADDITIVE ET RÉTROCOMPATIBLE : deux colonnes facultatives, nulles par défaut.
--   public.invest_dossiers.suivi_offre2          jsonb   { travaux: { mode, responsable, livraison_prevue, chantier, notes },
--                                                          transmission: { date, destinataire, notes, documents[] } }
--   public.invest_dossier_acquisitions.suivi     jsonb   { compromis_prevu_le, sequestre, notaire_vendeur, frais }
-- Rien n'est modifié ni supprimé : aucune donnée existante, aucune politique (RLS), aucun droit, aucune vue du portail client.
-- Les droits de ces colonnes sont ceux de leur table (restrictive « collaborateurs seulement » + droit CRM). Le portail client
-- ne lit ces tables que par des vues à colonnes explicites : ces deux colonnes n'y figurent pas.
-- Tant que la migration n'est pas appliquée, la fiche fonctionne : elle masque ces saisies et l'indique.
-- RETOUR ARRIÈRE : sql/202610_invest_mission_offre2_suivi_rollback.sql
-- VÉRIFICATION  : node scripts/verif-invest-mission-offre2-suivi.mjs
-- ============================================================================

alter table public.invest_dossiers
  add column if not exists suivi_offre2 jsonb;
alter table public.invest_dossiers
  add constraint invest_dossiers_suivi_offre2_objet check (suivi_offre2 is null or jsonb_typeof(suivi_offre2) = 'object');

alter table public.invest_dossier_acquisitions
  add column if not exists suivi jsonb;
alter table public.invest_dossier_acquisitions
  add constraint invest_dossier_acquisitions_suivi_objet check (suivi is null or jsonb_typeof(suivi) = 'object');

comment on column public.invest_dossiers.suivi_offre2 is 'Mission Offre 2 : suivi des travaux et de la transmission (jsonb objet, facultatif).';
comment on column public.invest_dossier_acquisitions.suivi is 'Acquisition : compromis prévu, séquestre, notaire vendeur, frais (jsonb objet, facultatif).';
