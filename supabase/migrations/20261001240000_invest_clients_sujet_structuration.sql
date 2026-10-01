-- ============================================================================
-- CRM Invest : repérer les clients qui ont un SUJET DE STRUCTURATION, par
-- opposition à une simple recherche d'investissement.
-- Périmètre : Profero Invest. Décision de Matthieu (01/10/2026) : une case sur
-- la fiche client ; l'onglet Structuration n'apparaît que pour ces clients.
--
-- Ajout d'UNE colonne booléenne, faux par défaut : aucune donnée existante n'est
-- modifiée, aucune policy touchée (la restrictive « collaborateurs seulement » et
-- les policies de invest_clients s'appliquent comme avant).
--
-- RETOUR ARRIÈRE : sql/202610_invest_clients_sujet_structuration_rollback.sql
-- ============================================================================
alter table public.invest_clients
  add column if not exists sujet_structuration boolean not null default false;
