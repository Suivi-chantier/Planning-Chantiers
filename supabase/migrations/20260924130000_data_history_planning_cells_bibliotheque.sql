-- ============================================================================
-- HISTORIQUE — planning_cells et bibliotheque_ratios rejoignent le filet
-- ============================================================================
--
-- ÉTAT AVANT (vérifié en base le 24/09/2026) : le déclencheur trg_data_history
-- (avant UPDATE/DELETE) historise 15 tables — besoins, chantier_factures_client,
-- chantier_factures_reglements, chantier_progbat_yards, chantier_projets,
-- commande_lignes, commandes, controles_groupe, facture_bl, factures, materiel,
-- materiel_audits, pointages, rapports, reserves.
--
-- PAS planning_cells, ni bibliotheque_ratios. Les lignes de ces deux tables
-- présentes dans data_history sont des sauvegardes ponctuelles faites par des
-- scripts (801 cellules le 28/08 avant le backfill allocation_uid ; 68 ouvrages
-- le 14/09 avant leur suppression). Conséquence : aujourd'hui, toute
-- modification du planning est irréversible, et c'est une suppression non
-- historisée de la bibliothèque qui a laissé 153 ouvrages de chantier orphelins.
--
-- CE QUE FAIT CETTE MIGRATION : elle branche la fonction EXISTANTE
-- public.log_data_history() (sql/202606_data_history_filet_securite.sql) sur
-- ces deux tables, exactement comme sur les 15 autres. La fonction n'est ni
-- réécrite ni modifiée. Aucune donnée n'est touchée.
--
-- DROITS : la fonction écrit dans data_history avec les droits de celui qui
-- modifie la ligne. Les politiques RLS sont identiques des deux côtés
-- (authenticated ET NOT est_ouvrier() sur planning_cells, bibliotheque_ratios
-- et data_history) : toute écriture autorisée sur le planning ou la
-- bibliothèque l'est aussi dans l'historique. Un enregistrement qui passait
-- avant ne peut donc pas être refusé à cause de ce déclencheur.
--
-- ORDRE DES DÉCLENCHEURS : les BEFORE s'exécutent par ordre alphabétique.
-- trg_data_history passe après planning_cells_ensure_allocation_uids_v1 et
-- après les trois gardes de bibliotheque_ratios. Il lit OLD (l'état d'avant),
-- que ces déclencheurs ne modifient pas : l'ordre est sans effet sur ce qui
-- est sauvegardé. Si une garde refuse l'écriture, l'entrée d'historique est
-- annulée avec elle.
--
-- VOLUME ESTIMÉ (compteurs de la base depuis son démarrage du 09/09/2026,
-- soit 15,4 jours ; fiables : 183 insertions comptées = 183 cellules créées
-- sur la période) :
--
--   planning_cells     611 modifications, 0 suppression en 15,4 j
--                      ≈ 40 / jour ≈ 1 200 entrées / mois
--                      ligne actuelle : 803 o en moyenne (médiane 538 o,
--                      90 % sous 1 687 o, max 5 235 o)
--                      entrée data_history ≈ 1 Ko avec en-tête, + index
--                      ⇒ ≈ 1,2 à 1,5 Mo / mois, ≈ 15 à 18 Mo / an
--
--   bibliotheque_ratios 842 modifications, 76 suppressions en 15,4 j — période
--                      gonflée par les migrations de vente et ProGBat du
--                      15 au 17/09, qui réécrivaient toute la table.
--                      ligne actuelle : 2 797 o en moyenne (90 % sous 4 930 o)
--                      ⇒ plafond ≈ 5 Mo / mois au rythme de cette période
--                      exceptionnelle ; en rythme normal, bien moins.
--
--   Pour situer : base entière 172 Mo, data_history 3,6 Mo aujourd'hui.
--   Chaque migration future qui réécrit toute la bibliothèque ajoutera
--   ≈ 119 × 2,8 Ko ≈ 330 Ko. Une application massive du planning (étape 3)
--   qui réécrirait 300 cellules ajoutera ≈ 300 Ko.
--
--   La purge public.purge_data_history(365) existe mais n'est planifiée
--   nulle part (un seul cron en base : progbat-billing-sync-hourly).
--
-- RETOUR ARRIÈRE : supprimer les deux déclencheurs. L'historique déjà
-- accumulé reste dans data_history (rien n'est perdu) :
--   drop trigger if exists trg_data_history on public.planning_cells;
--   drop trigger if exists trg_data_history on public.bibliotheque_ratios;
--
-- Idempotente : réexécutable sans effet.
-- ============================================================================

do $$
declare
  t text;
begin
  -- On ne réécrit pas la fonction : si elle manque, c'est le socle qui manque,
  -- et brancher un déclencheur dessus n'aurait aucun sens.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'log_data_history'
  ) then
    raise exception 'public.log_data_history() introuvable : appliquer d''abord sql/202606_data_history_filet_securite.sql.';
  end if;

  foreach t in array array['planning_cells', 'bibliotheque_ratios'] loop
    execute format('drop trigger if exists trg_data_history on public.%I;', t);
    execute format(
      'create trigger trg_data_history before update or delete on public.%I '
      'for each row execute function public.log_data_history();', t
    );
  end loop;
end $$;

-- ─── Contrôle ────────────────────────────────────────────────────────────────
-- Doit renvoyer 17 tables, dont bibliotheque_ratios et planning_cells :
--   select string_agg(c.relname, ', ' order by c.relname), count(*)
--   from pg_trigger t join pg_class c on c.oid = t.tgrelid
--   where t.tgname = 'trg_data_history' and not t.tgisinternal;
