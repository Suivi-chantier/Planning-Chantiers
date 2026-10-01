-- ============================================================================
-- Portail client Invest — étape 4 : données de l'écran client (/espace-client).
-- Périmètre : Profero Invest. Lecture seule, même principe que les étapes 2-3.
--
-- 1. portail_etapes : ne renvoie que les étapes du DOSSIER (operation_id nul),
--    comme la fiche du CRM. Aucune étape d'opération n'existe aujourd'hui ; sans
--    ce filtre, elles apparaîtraient en doublon dès les premières opérations.
--    (create or replace : mêmes colonnes, droits conservés.)
-- 2. portail_client : prénom et nom du seul client de l'appelant (message d'accueil).
--
-- RETOUR ARRIÈRE : sql/202610_portail_client_invest_ecran_rollback.sql
-- VÉRIFICATION  : node scripts/verif-portail-client-invest.mjs
-- ============================================================================

create or replace view public.portail_etapes with (security_barrier = true) as
  select e.id, e.dossier_id, e.etape, e.statut, e.date_debut, e.date_fin
  from public.invest_dossier_etapes e
  join public.invest_dossiers d on d.id = e.dossier_id
  where e.operation_id is null
    and d.portail_visible is true
    and d.client_id = (select public.portail_client_id());

create view public.portail_client with (security_barrier = true) as
  select c.prenom, c.nom
  from public.invest_clients c
  where c.id = (select public.portail_client_id());

revoke all on public.portail_client from public, anon, authenticated;
grant select on public.portail_client to authenticated;
