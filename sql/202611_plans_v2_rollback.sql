-- ============================================================================
-- Retour arrière de la migration « plans_v2 » (nouvel éditeur de plans,
-- tâche 3). À n'exécuter qu'après avoir annulé les demandes de fusion qui
-- lisent ou écrivent cette table.
--
-- RIEN N'EST SUPPRIMÉ : la table est mise de côté sous un autre nom, avec ses
-- lignes, ses règles d'accès (dont profero_collaborateurs_seulement) et son
-- rattachement aux chantiers. Ses index sont renommés avec elle, pour que la
-- migration puisse être rejouée ensuite sans collision de noms. L'ancienne
-- table des plans n'est pas concernée : la migration ne l'a jamais touchée.
--
-- Supprimer définitivement la table mise de côté est un geste séparé, à
-- décider explicitement (les plans dessinés dans le nouvel éditeur y sont).
-- ============================================================================
begin;
alter table public.plans_v2 rename to plans_v2_retiree;
alter index public.plans_v2_pkey rename to plans_v2_retiree_pkey;
alter index public.plans_v2_chantier_idx rename to plans_v2_retiree_chantier_idx;
alter index public.plans_v2_origine_idx rename to plans_v2_retiree_origine_idx;
alter trigger plans_v2_set_updated_at on public.plans_v2_retiree rename to plans_v2_retiree_set_updated_at;
commit;
