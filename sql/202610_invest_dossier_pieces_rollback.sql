-- Retour arrière de 20261002100000 (supprime la table des pièces ; les fichiers du stockage restent).
drop trigger if exists invest_dossiers_semer_pieces on public.invest_dossiers;
drop function if exists public.invest_dossiers_semer_pieces();
drop function if exists public.invest_dossier_pieces_preparer(uuid);
drop function if exists public.invest_dossier_pieces_semer(uuid);
drop table if exists public.invest_dossier_pieces;
drop function if exists public.invest_dossier_pieces_client();
