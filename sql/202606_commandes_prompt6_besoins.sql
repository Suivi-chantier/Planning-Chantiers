-- ============================================================
-- PROMPT 6 — Bascule du flux "besoins" + écriture Planning
-- Ajustements contrainte / RLS. NON destructif.
-- ============================================================

-- 1) Autoriser la valeur 'planning' pour commandes.source
--    (commandes créées depuis la page "Planning des commandes").
alter table public.commandes drop constraint if exists commandes_source_check;
alter table public.commandes
  add constraint commandes_source_check
  check (source in ('mobile','import_ia','migration','facture','planning'));

-- 2) RLS besoins : le rapport ouvrier est une page PUBLIQUE (ouvrier non
--    authentifié = rôle "anon"). Les besoins doivent donc être insérables par
--    anon, comme l'était commandes_detail. On élargit select + insert à anon.
drop policy if exists "besoins_ins" on public.besoins;
create policy "besoins_ins" on public.besoins
  for insert to anon, authenticated with check (true);

drop policy if exists "besoins_sel" on public.besoins;
create policy "besoins_sel" on public.besoins
  for select to anon, authenticated using (true);
