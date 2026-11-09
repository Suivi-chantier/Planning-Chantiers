-- Performance des règles « réservé au bureau » — appliquée le 09/11/2026,
-- avec l'accord de Loris.
--
-- Pourquoi : la règle `NOT est_ouvrier()` (bureau oui, ouvriers non) était
-- recalculée pour CHAQUE ligne lue — une recherche dans `utilisateurs` par
-- ligne. Toutes les pages qui lisent beaucoup de lignes (Opérations, Bilan de
-- semaine, fiche chantier, finances) en étaient ralenties : lire 1 000
-- pointages prenait 93 ms au lieu de 2 ms ; lire les 60 tables concernées,
-- 3,6 s au lieu de 0,43 s pour un compte bureau.
--
-- Changement : `(select not public.est_ouvrier())` — calculé UNE fois par
-- requête. Même résultat ligne pour ligne. Rien d'autre ne change : mêmes
-- règles (ALTER POLICY garde nom, type, rôles, commande), la règle
-- `profero_collaborateurs_seulement` n'est pas touchée.
--
-- Vérifié avant (transaction annulée, base réelle) : 60 tables × 5 rôles
-- (admin, commercial, comptable, agent EDL, ouvrier), 0 différence de lignes
-- visibles. Après : 0 règle à l'ancienne écriture, 333 règles au total
-- (inchangé), compte ouvrier toujours à 0 ligne sur pointages / phasages /
-- commandes.
--
-- Retour arrière : sql/202611_rls_bureau_role_verifie_une_fois_rollback.sql
alter policy bureau_all on public.achats_lots_termines using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_lecture on public.avancement_journal using ((select not public.est_ouvrier()));
alter policy bureau_lecture on public.avancement_journal_controles using ((select not public.est_ouvrier()));
alter policy besoins_bureau_all on public.besoins using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.bibliotheque_ratios using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.bilans_exports using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.chantier_avancement_history using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy "factures client bureau" on public.chantier_factures_client using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy "reglements lecture bureau" on public.chantier_factures_reglements using ((select not public.est_ouvrier()));
alter policy bureau_all on public.chantier_notes using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy "chantier_progbat_yards bureau" on public.chantier_progbat_yards using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy "chantier_projets bureau" on public.chantier_projets using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.chantier_reference_financiere using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_lecture on public.chantier_releves_journaliers using ((select not public.est_ouvrier()));
alter policy bureau_all on public.chantier_snapshots_hebdo using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy chiffrage_conditions_historique_bureau_insert on public.chiffrage_conditions_historique with check ((select not public.est_ouvrier()));
alter policy chiffrage_conditions_historique_bureau_select on public.chiffrage_conditions_historique using ((select not public.est_ouvrier()));
alter policy chiffrage_ligne_conditions_historique_bureau_insert on public.chiffrage_ligne_conditions_historique with check ((select not public.est_ouvrier()));
alter policy chiffrage_ligne_conditions_historique_bureau_select on public.chiffrage_ligne_conditions_historique using ((select not public.est_ouvrier()));
alter policy bureau_all on public.clotures_journee using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy coefficients_vente_bureau_select on public.coefficients_vente using ((select not public.est_ouvrier()));
alter policy bureau_all on public.commande_lignes using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.commandes using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.commandes_detail using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.commandes_passees using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy "controles_groupe bureau" on public.controles_groupe using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.data_history using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.facture_bl using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.factures using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.fournisseurs using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy materiel_bureau_all on public.materiel using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy materiel_audit_lignes_bureau_all on public.materiel_audit_lignes using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy materiel_audits_bureau_all on public.materiel_audits using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.phasages using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.phasages_backup_premig_v2 using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.phasages_history using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy planning_baselines_bureau_select on public.planning_baselines using ((select not public.est_ouvrier()));
alter policy cells_bureau_all on public.planning_cells using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.planning_chantiers using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.planning_commandes using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy config_bureau_all on public.planning_config using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy planning_constraints_bureau_delete on public.planning_constraints using ((select not public.est_ouvrier()));
alter policy planning_constraints_bureau_insert on public.planning_constraints with check ((select not public.est_ouvrier()));
alter policy planning_constraints_bureau_select on public.planning_constraints using ((select not public.est_ouvrier()));
alter policy planning_constraints_bureau_update on public.planning_constraints using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.planning_mensuel using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.planning_notes using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy planning_resource_events_bureau_delete on public.planning_resource_events using ((select not public.est_ouvrier()));
alter policy planning_resource_events_bureau_insert on public.planning_resource_events with check ((select not public.est_ouvrier()));
alter policy planning_resource_events_bureau_select on public.planning_resource_events using ((select not public.est_ouvrier()));
alter policy planning_resource_events_bureau_update on public.planning_resource_events using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy planning_resources_bureau_delete on public.planning_resources using ((select not public.est_ouvrier()));
alter policy planning_resources_bureau_insert on public.planning_resources with check ((select not public.est_ouvrier()));
alter policy planning_resources_bureau_select on public.planning_resources using ((select not public.est_ouvrier()));
alter policy planning_resources_bureau_update on public.planning_resources using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.plans using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.pointages using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.profero_categories_ouvrages using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.profero_cotes using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.profero_dessins using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.profero_multi_ouvrages using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.profero_ouvrages_selectionnes using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.profero_plans using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.profero_projets using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy progbat_cadence_import_items_lecture_bureau on public.progbat_cadence_import_items using ((select not public.est_ouvrier()));
alter policy progbat_cadence_import_runs_lecture_bureau on public.progbat_cadence_import_runs using ((select not public.est_ouvrier()));
alter policy rapports_bureau_all on public.rapports using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy "reserves bureau" on public.reserves using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy taux_horaires_vente_bureau_select on public.taux_horaires_vente using ((select not public.est_ouvrier()));
alter policy bureau_all on public.vehicules using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
alter policy bureau_all on public.visites_chantier using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
