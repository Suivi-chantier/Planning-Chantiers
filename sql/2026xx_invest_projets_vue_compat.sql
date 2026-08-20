-- ============================================================================
-- VUE DE COMPATIBILITÉ invest_projets — À EXÉCUTER MAINTENANT.
--
-- Situation : 2026xx_invest_projets_archive.sql a été exécuté avant que le
-- code qui cesse de lire invest_projets soit déployé. La production tourne
-- donc encore sur l'ancien Finance.jsx, qui interroge une table renommée et
-- reçoit une 42P01 — l'onglet Dashboard Financier affiche « Impossible de
-- charger les données financières ».
--
-- Ce fichier rétablit le service SANS redéploiement et SANS défaire le
-- renommage : une vue reprend l'ancien nom et sert les mêmes lignes.
--
-- C'est le schéma classique en deux temps (expand / contract) qu'il aurait
-- fallu écrire d'emblée : on ajoute le nouveau nom, on laisse l'ancien vivre
-- le temps que le code bascule, puis on retire l'ancien. Renommer d'un bloc
-- impose un ordre entre base et déploiement, et cet ordre finit toujours par
-- être inversé un jour.
--
-- security_invoker : la vue applique les policies RLS au nom de l'appelant et
-- non du propriétaire. Sans cela, une vue ouvrirait une porte dérobée sur des
-- lignes que la table protège.
--
-- ── APRÈS la fusion de invest/remise-a-niveau-phase1 et son déploiement ────
-- Plus aucun code ne lit invest_projets. Supprimer la vue pour retrouver
-- l'effet recherché — qu'une requête oubliée échoue franchement plutôt que de
-- renvoyer des données gelées :
--
--     DROP VIEW IF EXISTS public.invest_projets;
--
-- Vérifier d'abord que le déploiement est bien en ligne : l'onglet Finance
-- doit afficher ses indicateurs alors que la vue est encore là.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.invest_projets_archive') IS NULL THEN
    RAISE EXCEPTION
      'invest_projets_archive introuvable : le renommage n''a pas eu lieu, cette vue n''a pas lieu d''être.';
  END IF;

  -- Si invest_projets existe encore en TABLE, il n'y a rien à réparer.
  IF to_regclass('public.invest_projets') IS NOT NULL THEN
    RAISE NOTICE 'invest_projets existe déjà (table ou vue) : rien à faire.';
    RETURN;
  END IF;

  EXECUTE 'CREATE VIEW public.invest_projets '
          'WITH (security_invoker = true) AS '
          'SELECT * FROM public.invest_projets_archive';

  EXECUTE 'COMMENT ON VIEW public.invest_projets IS '
          '''Vue de compatibilité temporaire. À SUPPRIMER une fois la branche '
          'invest/remise-a-niveau-phase1 déployée : plus aucun code ne lira '
          'alors ce nom.''';
END $$;

-- Contrôle : doit renvoyer une ligne 'v' (vue) et une ligne 'r' (table).
SELECT c.relname,
       c.relkind,
       CASE c.relkind WHEN 'v' THEN 'vue de compatibilité'
                      WHEN 'r' THEN 'table réelle' END AS nature
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public'
AND    c.relname IN ('invest_projets', 'invest_projets_archive')
ORDER  BY c.relkind DESC;
