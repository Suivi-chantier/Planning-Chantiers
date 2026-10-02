-- Retour arrière de 20261002130000 (supprime les financements et banques enregistrés).
drop table if exists public.invest_dossier_banques;
drop table if exists public.invest_dossier_financements;
drop function if exists public.invest_dossier_banques_limite();
drop function if exists public.invest_dossier_financements_controle();
