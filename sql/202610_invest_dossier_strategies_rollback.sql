-- Retour arrière de 20261002120000 (supprime les stratégies et scénarios enregistrés).
drop table if exists public.invest_dossier_scenarios;
drop table if exists public.invest_dossier_strategies;
drop function if exists public.invest_dossier_modules_client();
