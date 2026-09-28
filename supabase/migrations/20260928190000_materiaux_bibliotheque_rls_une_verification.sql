-- Bibliothèque matériaux : la règle d'accès vérifie le rôle UNE fois par
-- requête, plus une fois par article.
--
-- Pourquoi : depuis l'import du catalogue SIDER (28/09/2026), la table compte
-- 23 101 articles. mon_role() et est_ouvrier() sont SECURITY DEFINER avec un
-- search_path figé : Postgres ne peut pas les « déplier » et les rappelait pour
-- chaque ligne, soit environ 70 000 lectures de la table utilisateurs par
-- chargement. Mesuré en tant qu'utilisateur bureau :
--   avant  : 2 496 ms  (select * order by categorie, nom limit 1000)
--   après  :    17 ms
--
-- Même règle, même effet : les appels sont simplement enveloppés dans
-- (select …), que Postgres évalue une seule fois (InitPlan). Vérifié dans une
-- transaction annulée : ouvrier 0 ligne, e-mail inconnu 0, anon 0,
-- bureau 23 101.

alter policy materiaux_bibliotheque_bureau on public.materiaux_bibliotheque
  using (((select public.mon_role()) is not null) and (not (select public.est_ouvrier())))
  with check (((select public.mon_role()) is not null) and (not (select public.est_ouvrier())));
