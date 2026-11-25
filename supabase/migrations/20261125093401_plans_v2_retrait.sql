-- ============================================================================
-- Projet « nouvel éditeur de plans » annulé par Loris le 25/11/2026 :
-- retrait de la table public.plans_v2, créée le même jour par la migration
-- 20261125093119_plans_v2 et restée vide (0 ligne, vérifié avant le retrait
-- et revérifié ici : la migration s'arrête si la table contient une ligne).
--
-- Rien d'autre n'est touché : ni l'ancienne table des plans, ni les
-- chantiers. Les index, le déclencheur, les contraintes et les deux règles
-- d'accès de plans_v2 disparaissent avec elle. Aucune sauvegarde : il n'y a
-- aucune donnée à sauvegarder.
-- ============================================================================
do $$
begin
  if (select count(*) from public.plans_v2) <> 0 then
    raise exception 'plans_v2 n''est pas vide : retrait annulé';
  end if;
end $$;
drop table public.plans_v2;
