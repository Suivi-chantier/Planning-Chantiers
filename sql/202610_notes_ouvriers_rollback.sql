-- Retour arrière de supabase/migrations/20261014073919_notes_ouvriers.sql.
-- ⚠ DESTRUCTIF : supprime toutes les notes des ouvriers, leurs réponses et
-- leurs lectures. Les photos du bucket « notes-ouvriers » doivent être vidées
-- depuis le tableau de bord Supabase (Storage) AVANT de supprimer le bucket.

drop policy if exists notes_ouvriers_photos_insert on storage.objects;
drop policy if exists notes_ouvriers_photos_select on storage.objects;
drop policy if exists notes_ouvriers_photos_delete on storage.objects;
delete from storage.buckets where id = 'notes-ouvriers'
  and not exists (select 1 from storage.objects o where o.bucket_id = 'notes-ouvriers');

drop function if exists public.notes_destinataires();
drop table if exists public.notes_ouvriers_lectures;
drop table if exists public.notes_ouvriers_reponses;
drop table if exists public.notes_ouvriers;
drop function if exists public.notes_ouvriers_reponse_activite();
drop function if exists public.notes_ouvriers_reponse_garde();
drop function if exists public.notes_ouvriers_garde();
drop function if exists public.notes_textes_checklist(jsonb);
drop function if exists public.note_partagee_avec_moi(text[]);
