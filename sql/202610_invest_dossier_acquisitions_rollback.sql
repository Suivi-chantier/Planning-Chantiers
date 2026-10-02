-- Retour arrière de 20261002140000 (supprime les acquisitions enregistrées).
drop table if exists public.invest_dossier_acquisitions;
drop function if exists public.invest_dossier_acquisitions_limite();
