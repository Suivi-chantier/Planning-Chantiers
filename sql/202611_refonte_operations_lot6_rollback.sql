-- ============================================================================
-- RETOUR ARRIÈRE — Refonte Opérations, lot 6 (policies du rôle chargé
-- d'affaires sur chantier_cycle_vie).
-- Annule supabase/migrations/20261106071527_refonte_operations_lot6.sql.
--
-- Retire les deux policies RESTRICTIVES ajoutées au lot 6. État d'avant :
-- 5 policies sur chantier_cycle_vie (cycle vie bureau creation / lecture /
-- modification, cycle vie ouvrier plans techniques,
-- profero_collaborateurs_seulement), inchangées par le lot 6.
-- Effet : un compte charge_affaires pourrait de nouveau écrire toutes les
-- étapes (comme un commercial). Aucune donnée n'est touchée.
--
-- Puis : npx supabase migration repair --status reverted 20261106071527 --linked
-- Pour retirer aussi le rôle de la configuration d'accès :
-- sql/202611_refonte_operations_lot6_acces_rollback.sql.
-- ============================================================================

begin;

drop policy if exists "cycle vie charge affaires etude contrat ajout" on public.chantier_cycle_vie;
drop policy if exists "cycle vie charge affaires etude contrat modification" on public.chantier_cycle_vie;

-- Contrôle : 5 policies attendues.
select policyname, permissive, cmd from pg_policies
 where schemaname = 'public' and tablename = 'chantier_cycle_vie'
 order by policyname;

commit;
