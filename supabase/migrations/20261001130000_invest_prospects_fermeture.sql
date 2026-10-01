-- ============================================================================
-- Chantier 22 (sécurité) — fermeture de invest_prospects aux non-connectés.
--
-- AVANT : 4 policies « *_all » (anon + authenticated, true) : sans connexion,
-- la clé publique de l'application permettait de LIRE, CRÉER, MODIFIER et
-- SUPPRIMER les prospects (132 lignes au 01/10/2026).
-- Dette déclarée (sql/README-securite-invest.md) tant que l'arrivée des leads
-- Fluidify n'était pas identifiée. Identifiée le 01/10/2026 dans les journaux :
-- n8n → Edge Function `fluidify-import-prospect` (clé secrète x-profero-api-key)
-- → écriture avec la clé service_role, qui ignore la RLS. Fermer la table ne
-- coupe donc pas l'ingestion.
--
-- APRÈS : mêmes règles que le reste du périmètre Invest (invest_peut_voir) :
--   lecture      : prospection, crm, dashboard (tableau de bord et Morning Routine) ;
--   création     : prospection, crm ;
--   modification : prospection, crm (conversion prospect → client depuis le CRM) ;
--   suppression  : prospection.
-- anon : plus aucun droit. authenticated : plus de TRUNCATE (vide la table
-- sans passer par la RLS), REFERENCES ni TRIGGER, comme pour utilisateurs (1.0).
-- Aucune donnée modifiée.
--
-- RETOUR ARRIÈRE : sql/202610_invest_prospects_fermeture_rollback.sql
-- VÉRIFICATION  : node scripts/verif-invest-dossiers-t1.mjs (cas 69)
--                 node scripts/verif-rls-invest.mjs (production, clé publique)
-- ============================================================================

drop policy if exists invest_prospects_select_all on public.invest_prospects;
drop policy if exists invest_prospects_insert_all on public.invest_prospects;
drop policy if exists invest_prospects_update_all on public.invest_prospects;
drop policy if exists invest_prospects_delete_all on public.invest_prospects;

drop policy if exists invest_prospects_lecture on public.invest_prospects;
create policy invest_prospects_lecture on public.invest_prospects for select to authenticated using (
  (select public.invest_peut_voir('prospection')) or (select public.invest_peut_voir('crm'))
  or (select public.invest_peut_voir('dashboard')));
drop policy if exists invest_prospects_creation on public.invest_prospects;
create policy invest_prospects_creation on public.invest_prospects for insert to authenticated with check (
  (select public.invest_peut_voir('prospection')) or (select public.invest_peut_voir('crm')));
drop policy if exists invest_prospects_modification on public.invest_prospects;
create policy invest_prospects_modification on public.invest_prospects for update to authenticated
  using ((select public.invest_peut_voir('prospection')) or (select public.invest_peut_voir('crm')))
  with check ((select public.invest_peut_voir('prospection')) or (select public.invest_peut_voir('crm')));
drop policy if exists invest_prospects_suppression on public.invest_prospects;
create policy invest_prospects_suppression on public.invest_prospects for delete to authenticated using (
  (select public.invest_peut_voir('prospection')));

alter table public.invest_prospects enable row level security;
revoke all on table public.invest_prospects from anon;
revoke truncate, references, trigger on table public.invest_prospects from authenticated;
