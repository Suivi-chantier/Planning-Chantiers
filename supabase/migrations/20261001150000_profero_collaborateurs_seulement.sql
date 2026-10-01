-- ============================================================================
-- Chantier 22 (sécurité) — étape 3a : « réservé aux collaborateurs » (deny by default).
--
-- CLASSEMENT : TRANSVERSE (Invest + Rénovation + Storage). Validé par Matthieu
-- le 01/10/2026. Aucune policy métier existante n'est modifiée ni supprimée.
--
-- PROBLÈME
--   Les policies existantes répondent à « que peut faire CE collaborateur ? »
--   mais pas à « est-ce un collaborateur ? ». Exemples : 54 tables Rénovation
--   en « NOT est_ouvrier() » (VRAI pour un compte qui n'est pas ouvrier, donc
--   pour un futur client), 66 tables sans contrôle d'identité, buckets
--   ouverts à tout compte connecté. Un compte client (portail) aurait lu et
--   écrit l'essentiel de la base.
--
-- CHANGEMENT
--   1. public.est_collaborateur_actif() : condition POSITIVE — l'adresse du
--      jeton correspond à une fiche utilisateurs ACTIVE et sans doublon inactif
--      (public.acces_collaborateur_autorise, la même règle que le hook d'accès),
--      ET le jeton n'est pas étiqueté client_invest. « Non client » ne suffit
--      jamais. SECURITY DEFINER sans paramètre : lit utilisateurs sans RLS (donc
--      sans récursion), ne renvoie qu'un booléen sur l'appelant lui-même (aucun
--      nouveau chemin d'accès). Écrit nulle part.
--   2. Une policy RESTRICTIVE « profero_collaborateurs_seulement », FOR ALL TO
--      authenticated, sur chacune des 101 tables de public (liste explicite
--      ci-dessous). Restrictive = ET logique avec les policies existantes :
--      un collaborateur actif garde EXACTEMENT ses droits actuels ; tout autre
--      compte connecté n'a plus rien.
--   3. La même policy restrictive sur storage.objects, pour les 3 buckets
--      existants : chantier-documents, invest-documents, photos.
--   4. Garde-fous : la migration échoue (et ne laisse rien) si une table de
--      public ou un bucket n'est pas couvert au moment de l'application.
--
-- NON CONCERNÉ (volontairement)
--   anon : la policy vise authenticated seulement ; les ouvertures anonymes
--   (bilans_hebdo, cr_photos, planning_cells, utilisateurs, bucket photos) sont
--   analysées à l'étape 3c. service_role (Edge Functions, n8n/Fluidify, crons)
--   ignore la RLS. Fonctions SECURITY DEFINER : étape 3b.
--
-- RETOUR ARRIÈRE : sql/202610_profero_collaborateurs_seulement_rollback.sql
-- VÉRIFICATION  : node scripts/verif-collaborateurs-seulement.mjs
-- ============================================================================

create or replace function public.est_collaborateur_actif()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'profero_population', '') is distinct from 'client_invest'
     and coalesce(public.acces_collaborateur_autorise(lower(btrim(coalesce(auth.email(), '')))), false);
$$;
revoke all on function public.est_collaborateur_actif() from public, anon;
grant execute on function public.est_collaborateur_actif() to authenticated;

do $do$
declare
  t text;
  tables constant text[] := array[
    'besoins',
    'bibliotheque_ratios',
    'bilans_hebdo',
    'chantier_avancement_history',
    'chantier_factures_client',
    'chantier_factures_reglements',
    'chantier_notes',
    'chantier_progbat_yards',
    'chantier_projets',
    'chantier_reference_financiere',
    'chantier_snapshots_hebdo',
    'chiffrage_conditions_historique',
    'chiffrage_ligne_conditions_historique',
    'clotures_journee',
    'coefficients_vente',
    'commande_lignes',
    'commandes',
    'commandes_detail',
    'commandes_passees',
    'controles_groupe',
    'cr_comptes_rendus',
    'cr_observations',
    'cr_photos',
    'data_history',
    'facture_bl',
    'factures',
    'fournisseurs',
    'ia_jobs',
    'invest_actifs_patrimoniaux',
    'invest_action_notifications',
    'invest_biens',
    'invest_clients',
    'invest_dashboard_action_links',
    'invest_dossier_etapes',
    'invest_dossier_evenements',
    'invest_dossiers',
    'invest_drive_links',
    'invest_engagements',
    'invest_etats_des_lieux',
    'invest_events',
    'invest_mission_actions',
    'invest_morning_routine_items',
    'invest_morning_routine_logs',
    'invest_morning_routine_recurrences',
    'invest_morning_routine_reminders',
    'invest_morning_routines',
    'invest_notes',
    'invest_personnes',
    'invest_planning',
    'invest_postes_financiers',
    'invest_projets_archive',
    'invest_propositions',
    'invest_prospect_actions',
    'invest_prospects',
    'invest_structuration_patrimoniale',
    'invest_structures',
    'invest_suivi_financier',
    'invest_urbanisme_dossiers',
    'journal_envois_email',
    'materiaux_bibliotheque',
    'materiel',
    'materiel_audit_lignes',
    'materiel_audits',
    'phasages',
    'phasages_backup_premig_v2',
    'phasages_history',
    'planning_baselines',
    'planning_cells',
    'planning_chantiers',
    'planning_commandes',
    'planning_config',
    'planning_constraints',
    'planning_mensuel',
    'planning_notes',
    'planning_resource_events',
    'planning_resources',
    'plans',
    'pointages',
    'profero_categories_ouvrages',
    'profero_cotes',
    'profero_dessins',
    'profero_ouvrages_selectionnes',
    'profero_plans',
    'profero_projets',
    'progbat_cadence_import_items',
    'progbat_cadence_import_plans',
    'progbat_cadence_import_runs',
    'progbat_library_category_sync_items',
    'progbat_library_family_sync_items',
    'progbat_library_sync_items',
    'progbat_quote_exports',
    'rapports',
    'reserves',
    'sourcing_annonces',
    'sourcing_criteres',
    'sourcing_logs',
    'suggestions_materiaux_ouvriers',
    'taux_horaires_vente',
    'utilisateurs',
    'vehicules',
    'visites_chantier'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists profero_collaborateurs_seulement on public.%I', t);
    execute format('create policy profero_collaborateurs_seulement on public.%I as restrictive for all to authenticated
      using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()))', t);
  end loop;
end
$do$;

drop policy if exists profero_collaborateurs_seulement on storage.objects;
create policy profero_collaborateurs_seulement on storage.objects as restrictive for all to authenticated
  using (bucket_id not in ('chantier-documents', 'invest-documents', 'photos') or (select public.est_collaborateur_actif()))
  with check (bucket_id not in ('chantier-documents', 'invest-documents', 'photos') or (select public.est_collaborateur_actif()));

-- Garde-fous : rien n'est appliqué si la couverture n'est pas complète.
do $do$
declare manquantes text; buckets text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into manquantes
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                    and p.policyname = 'profero_collaborateurs_seulement' and p.permissive = 'RESTRICTIVE');
  if manquantes is not null then
    raise exception 'Tables de public non couvertes par profero_collaborateurs_seulement : %', manquantes;
  end if;
  select string_agg(id, ', ' order by id) into buckets from storage.buckets
  where id not in ('chantier-documents', 'invest-documents', 'photos');
  if buckets is not null then
    raise exception 'Buckets non couverts par profero_collaborateurs_seulement : %', buckets;
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity) then
    raise exception 'Une table de public n''a pas la RLS activée : la policy restrictive serait sans effet.';
  end if;
end
$do$;
