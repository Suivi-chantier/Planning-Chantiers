-- ============================================================================
-- Portail client Invest — étape 2 : lecture seule, uniquement ce que Profero montre.
-- Périmètre : Profero Invest. Décisions de Matthieu du 01/10/2026 : le client ne
-- voit que les tâches choisies, lecture seule d'abord.
-- Plan : docs/project/PORTAIL-CLIENT-INVEST-PLAN.md
--
-- PRINCIPE : le client ne lit JAMAIS une table de base (elles contiennent des
-- corps d'e-mails, motifs de blocage, honoraires, questionnaires...). Il lit
-- quatre vues qui ne montrent que des colonnes choisies, et seulement pour son
-- propre client (public.portail_client_id(), étape 1) :
--   portail_dossier    dossiers marqués portail_visible
--   portail_etapes     progression des étapes de ces dossiers
--   portail_taches     actions marquées visible_client (NOUVEAU), dossier visible
--   portail_evenements événements marqués visible_client
-- Tout est « faux » par défaut : tant que Profero ne coche rien, le client ne voit rien.
-- La règle 3a (collaborateurs seulement) reste intacte sur toutes les tables.
-- Les vues appartiennent à postgres (elles lisent sans RLS) : le filtre sur
-- portail_client_id() EST la protection ; security_barrier évite les fuites par
-- prédicats. Le conseiller Supabase signalera « security definer view » : voulu.
--
-- RETOUR ARRIÈRE : sql/202610_portail_client_invest_lecture_rollback.sql
-- VÉRIFICATION  : node scripts/verif-portail-client-invest.mjs
-- ============================================================================

alter table public.invest_mission_actions
  add column visible_client boolean not null default false;

create view public.portail_dossier with (security_barrier = true) as
  select d.id, d.reference, d.libelle, d.type_mission, d.statut, d.date_ouverture,
         d.lettre_mission_statut, d.lettre_mission_signee_le
  from public.invest_dossiers d
  where d.portail_visible is true
    and d.client_id = (select public.portail_client_id());

create view public.portail_etapes with (security_barrier = true) as
  select e.id, e.dossier_id, e.etape, e.statut, e.date_debut, e.date_fin
  from public.invest_dossier_etapes e
  join public.invest_dossiers d on d.id = e.dossier_id
  where d.portail_visible is true
    and d.client_id = (select public.portail_client_id());

create view public.portail_taches with (security_barrier = true) as
  select a.id, a.dossier_id, a.step_label, a.action_title, a.status, a.due_date, a.completed_at
  from public.invest_mission_actions a
  where a.visible_client is true
    and a.client_id = (select public.portail_client_id())
    and (a.dossier_id is null or exists (
          select 1 from public.invest_dossiers d
          where d.id = a.dossier_id and d.portail_visible is true));

create view public.portail_evenements with (security_barrier = true) as
  select ev.id, ev.dossier_id, ev.type, ev.resume, ev.survenu_le
  from public.invest_dossier_evenements ev
  join public.invest_dossiers d on d.id = ev.dossier_id
  where ev.visible_client is true
    and d.portail_visible is true
    and d.client_id = (select public.portail_client_id());

-- Supabase accorde par défaut tous les droits à authenticated sur les nouveaux
-- objets, et une vue simple est modifiable : on retire donc TOUT, y compris à
-- authenticated, avant de n'accorder que la lecture.
revoke all on public.portail_dossier, public.portail_etapes,
              public.portail_taches, public.portail_evenements from public, anon, authenticated;
grant select on public.portail_dossier, public.portail_etapes,
                public.portail_taches, public.portail_evenements to authenticated;
