-- Retour arrière : portail client Invest — dépôt de pièces (migration 20261002200000).
-- Les fichiers déjà déposés restent dans le stockage (dossier clients/<client>/depots-client/).
drop function if exists public.portail_pieces_demandees();
drop view if exists public.portail_depots;
drop table if exists public.invest_portail_depots;
