-- ============================================================================
-- RETOUR ARRIÈRE de supabase/migrations/20261001130000_invest_prospects_fermeture.sql
--
-- ⚠️ ROUVRE la table aux non-connectés (lecture, création, modification,
-- suppression avec la clé publique). À n'utiliser qu'en cas de blocage avéré
-- de l'application, le temps de corriger.
-- ============================================================================

drop policy if exists invest_prospects_lecture on public.invest_prospects;
drop policy if exists invest_prospects_creation on public.invest_prospects;
drop policy if exists invest_prospects_modification on public.invest_prospects;
drop policy if exists invest_prospects_suppression on public.invest_prospects;

grant all on table public.invest_prospects to anon;
grant truncate, references, trigger on table public.invest_prospects to authenticated;
create policy invest_prospects_select_all on public.invest_prospects for select to anon, authenticated using (true);
create policy invest_prospects_insert_all on public.invest_prospects for insert to anon, authenticated with check (true);
create policy invest_prospects_update_all on public.invest_prospects for update to anon, authenticated using (true) with check (true);
create policy invest_prospects_delete_all on public.invest_prospects for delete to anon, authenticated using (true);
