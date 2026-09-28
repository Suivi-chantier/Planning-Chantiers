-- Bibliothèque matériaux : la règle d'accès vérifie le rôle UNE fois par
-- requête, plus une fois par article.
--
-- Pourquoi : depuis l'import du catalogue SIDER (28/09/2026), la table compte
-- 23 101 articles. mon_role() et est_ouvrier() sont SECURITY DEFINER avec un
-- search_path figé : Postgres ne peut pas les « déplier » et les rappelait pour
-- chaque ligne, soit environ 70 000 lectures de la table utilisateurs par
-- chargement. Mesuré en tant qu'utilisateur bureau :
--   avant  : 2 496 ms  (select * order by categorie, nom limit 1000)
--   après  :    17 ms  (mesuré à nouveau après application)
--
-- Même règle, même effet : les appels sont enveloppés dans (select …), que
-- Postgres évalue une seule fois (InitPlan). Vérifié après application :
-- ouvrier 0 ligne, e-mail inconnu 0, anon 0, bureau 23 101.
--
-- Appliquée le 28/09/2026 depuis une autre session, sous ce numéro et ce nom.
-- Le SQL ci-dessous est celui enregistré en base, mot pour mot.

-- Même règle d'accès, mais les fonctions sont évaluées une seule fois par requête (et non pour chaque ligne)
drop policy if exists materiaux_bibliotheque_bureau on public.materiaux_bibliotheque;
create policy materiaux_bibliotheque_bureau on public.materiaux_bibliotheque
  for all to authenticated
  using (((select public.mon_role()) is not null) and (not (select public.est_ouvrier())))
  with check (((select public.mon_role()) is not null) and (not (select public.est_ouvrier())));
