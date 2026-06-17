-- ============================================================
-- NETTOYAGE — Archivage des anciennes tables de commandes
-- ⚠️ À EXÉCUTER SEULEMENT APRÈS VALIDATION EN CONDITIONS RÉELLES
--    (quelques semaines de recul). NON destructif : on RENOMME en _archive,
--    on ne supprime pas. Le drop définitif se fera bien plus tard.
--
-- Pré-requis : plus aucune lecture/écriture active vers ces tables dans le
-- code (vérifié — seules subsistent la sauvegarde JSON Admin, qui tolère
-- l'absence des tables, et des commentaires).
-- ============================================================

alter table if exists public.commandes_detail  rename to commandes_detail_archive;
alter table if exists public.commandes_passees rename to commandes_passees_archive;

-- Pour revenir en arrière si besoin :
--   alter table public.commandes_detail_archive  rename to commandes_detail;
--   alter table public.commandes_passees_archive rename to commandes_passees;
