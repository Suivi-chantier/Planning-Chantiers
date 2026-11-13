-- ============================================================================
-- PLUSIEURS DOSSIERS EN COURS PAR CLIENT — NON APPLIQUÉ, en attente de validation.
--
-- Décision de Matthieu (13/11/2026) : un client peut avoir plusieurs dossiers
-- (projets) en cours en même temps. Aujourd'hui la base l'interdit :
--   1. un index unique n'autorise qu'un dossier « ouvert / actif / suspendu »
--      par client (invest_dossiers_un_non_clos_par_client) ;
--   2. invest_ouvrir_dossier refuse d'ouvrir un dossier si le client en a déjà un.
--
-- Ce fichier lève ces deux règles. Il ne supprime AUCUNE donnée : un index est
-- retiré, une fonction est réécrite. Annulation : voir le bas du fichier.
--
-- À FAIRE EN MÊME TEMPS que l'application de ce fichier (sinon l'application
-- se comporte mal) — ce sont des suppositions « un seul dossier en cours par
-- client » encore présentes dans le code :
--   • src/Invest/dossiers/pilotage.mjs  indexerPilotage : Map client_id → UN pilotage
--     (le dernier dossier écrase les autres). Lu par l'ancienne vue CRM, le tableau
--     de bord et la Morning Routine. À remplacer par une liste de pilotages par client.
--   • src/Invest/crm/crmV2Vue.mjs  nouvelleMissionPossible : refuse une 2e mission ;
--     à rendre toujours possible (et le bouton « Nouvelle mission » de la fiche client).
--   • scripts/verif-invest-dossiers-t1.mjs (test 5), verif-invest-pilotage-2b.mjs (test 5),
--     verif-invest-crm-v2.mjs (test 6) : ils vérifient l'ancienne règle.
-- La nouvelle Synthèse et le nouvel Avancement du CRM gèrent déjà plusieurs dossiers
-- par client (une ligne par dossier ; le client agrège ses projets).
--
-- Avant d'appliquer : vérifier sur la base que l'index existe, puis essayer ce
-- fichier dans une transaction annulée.
--   select indexname from pg_indexes where indexname = 'invest_dossiers_un_non_clos_par_client';
-- Aucune table nouvelle : pas de policy profero_collaborateurs_seulement à poser.
-- ============================================================================

begin;

drop index if exists public.invest_dossiers_un_non_clos_par_client;

create or replace function public.invest_ouvrir_dossier(p_client_id uuid, p_options jsonb default '{}'::jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  o jsonb := coalesce(p_options, '{}'::jsonb);
  v_client record;
  v_dossier uuid;
  v_conseiller uuid := nullif(o ->> 'conseiller_id', '')::uuid;
  v_origine text := coalesce(nullif(o ->> 'origine', ''), 'creation_crm');
  v_nb int;
begin
  if v_origine not in ('creation_crm','conversion_prospect') then
    raise exception 'Origine « % » non autorisée ici (la reprise a son propre script).', v_origine using errcode = '22023';
  end if;
  select id, statut, nom, prenom into v_client from public.invest_clients where id = p_client_id for update;
  if not found then
    raise exception 'Client introuvable ou non accessible.' using errcode = 'P0002';
  end if;
  -- Plusieurs dossiers en cours par client sont désormais permis (décision du 13/11/2026).

  insert into public.invest_dossiers (client_id, libelle, type_mission, statut, conseiller_id,
    lettre_mission_statut, honoraires_prevus_ht, date_ouverture, origine, prospect_id)
  values (p_client_id,
    coalesce(nullif(btrim(o ->> 'libelle'), ''), 'Dossier Invest ' || to_char(current_date, 'YYYY')),
    coalesce(nullif(o ->> 'type_mission', ''), 'accompagnement_acquisition'),
    coalesce(nullif(o ->> 'statut', ''), 'ouvert'),
    v_conseiller,
    coalesce(nullif(o ->> 'lettre_mission_statut', ''), 'a_emettre'),
    nullif(o ->> 'honoraires_prevus_ht', '')::numeric,
    current_date, v_origine, nullif(o ->> 'prospect_id', '')::uuid)
  returning id into v_dossier;

  insert into public.invest_dossier_etapes (dossier_id, etape, statut, balle, balle_utilisateur_id, date_debut)
  select v_dossier, e.cle,
         case when e.cle = 'signature' then 'en_cours' else 'a_venir' end,
         case when e.cle = 'signature' then 'profero' end,
         case when e.cle = 'signature' then v_conseiller end,
         case when e.cle = 'signature' then current_date end
  from unnest(array['signature','collecte','documents','analyse','strategie','recherche',
                    'opportunites','financement','structuration','acquisition','suivi']) as e(cle);

  select count(*) into v_nb from public.invest_dossier_etapes where dossier_id = v_dossier and operation_id is null;
  if v_nb <> 11 then
    raise exception 'Parcours incomplet (% étapes sur 11) : dossier non créé.', v_nb;
  end if;

  if coalesce((o ->> 'activer_client')::boolean, true)
     and (v_client.statut is null or lower(v_client.statut) = 'prospect') then
    update public.invest_clients set statut = 'Actif', updated_at = now() where id = p_client_id;
  end if;
  if coalesce((o ->> 'rattacher_actions')::boolean, true) then
    update public.invest_mission_actions set dossier_id = v_dossier
    where client_id = p_client_id and dossier_id is null;
  end if;
  return v_dossier;
end;
$$;

commit;

-- ── ANNULATION (rétablit la règle « un seul dossier en cours par client ») ────
-- À ne lancer que s'il n'existe AUCUN client avec deux dossiers en cours, sinon la
-- création de l'index échoue :
--   select client_id, count(*) from public.invest_dossiers
--   where statut in ('ouvert','actif','suspendu') group by client_id having count(*) > 1;
-- Puis :
--   create unique index if not exists invest_dossiers_un_non_clos_par_client
--     on public.invest_dossiers (client_id) where statut in ('ouvert','actif','suspendu');
--   et recréer invest_ouvrir_dossier depuis
--   supabase/migrations/20260930190000_invest_dossiers_tranche1.sql.
