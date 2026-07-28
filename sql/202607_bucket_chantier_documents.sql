-- ============================================================================
-- Bucket PRIVÉ "chantier-documents" — documents du cycle de vie chantier
-- (devis, devis signé, plans, PV de réception, DOE, pièces jointes d'étapes).
-- Point 2a, Prompt 6. À exécuter dans l'éditeur SQL Supabase. Idempotent.
--
-- Pourquoi un nouveau bucket : le bucket "photos" est PUBLIC (getPublicUrl
-- partout) et réservé aux images de terrain ; les documents client (devis,
-- PV…) doivent rester privés. L'appli y accède exclusivement par URLs
-- signées via src/Renovation/storageChantier.js.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('chantier-documents', 'chantier-documents', false)
on conflict (id) do nothing;

-- Accès réservé aux utilisateurs connectés (même philosophie que le reste de
-- l'appli : tout utilisateur authentifié de l'entreprise).
drop policy if exists "chantier-documents lecture" on storage.objects;
create policy "chantier-documents lecture" on storage.objects
  for select to authenticated
  using (bucket_id = 'chantier-documents');

drop policy if exists "chantier-documents ecriture" on storage.objects;
create policy "chantier-documents ecriture" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chantier-documents');

drop policy if exists "chantier-documents suppression" on storage.objects;
create policy "chantier-documents suppression" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chantier-documents');
