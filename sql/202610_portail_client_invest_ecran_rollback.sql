-- Retour arrière de 20261001220000.
drop view if exists public.portail_client;
create or replace view public.portail_etapes with (security_barrier = true) as
  select e.id, e.dossier_id, e.etape, e.statut, e.date_debut, e.date_fin
  from public.invest_dossier_etapes e
  join public.invest_dossiers d on d.id = e.dossier_id
  where d.portail_visible is true
    and d.client_id = (select public.portail_client_id());
