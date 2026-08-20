-- ============================================================================
-- ARCHIVAGE DE invest_projets (Profero Invest).
--
-- ⚠ CE FICHIER A UN DÉFAUT DE CONCEPTION, CORRIGÉ PAR :
--     sql/2026xx_invest_projets_vue_compat.sql
--
-- Il renomme la table d'un bloc, ce qui impose un ordre strict entre la base
-- et le déploiement : exécuté avant que le code cesse de lire invest_projets,
-- il casse l'onglet Dashboard Financier en production (42P01). C'est arrivé.
--
-- La bonne méthode est en deux temps (expand / contract) : on ajoute le
-- nouveau nom, on laisse l'ancien vivre le temps que le code bascule, puis on
-- retire l'ancien. Aucun ordre à respecter, donc aucun ordre à inverser.
-- La vue de compatibilité du fichier ci-dessus rétablit cette propriété.
--
-- Pourquoi : la table n'a plus de rédacteur. Le Simulateur a basculé en
-- « calculatrice » — mode libre enregistré localement, et seule la simulation
-- lancée depuis une fiche bien est persistée, dans
-- invest_biens.visite_data.simulateur. Aucun code n'écrit plus dans
-- invest_projets depuis ce changement.
--
-- Elle gardait pourtant deux lecteurs :
--   • la carte « Simulations » de la fiche client (CRM.jsx) — en réalité une
--     requête morte : la carte avait déjà été retirée de l'affichage ;
--   • les indicateurs projets du Dashboard Financier (Finance.jsx), qui
--     portaient donc sur un jeu gelé à la date du refactor, sans le moindre
--     message à l'écran.
--
-- Le code lit désormais les simulations depuis invest_biens. On ne SUPPRIME
-- pas la table : elle contient l'historique des projets créés avant la
-- bascule. On la renomme pour qu'il soit clair qu'elle n'est plus alimentée,
-- et pour qu'une requête oubliée échoue franchement au lieu de renvoyer
-- silencieusement des données périmées.
--
-- Réversible : il suffit de renommer dans l'autre sens.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.invest_projets') IS NOT NULL
     AND to_regclass('public.invest_projets_archive') IS NULL THEN
    ALTER TABLE public.invest_projets RENAME TO invest_projets_archive;

    COMMENT ON TABLE public.invest_projets_archive IS
      'Archive en lecture seule. Ancienne table des projets du Simulateur, '
      'plus alimentée depuis que les simulations vivent dans '
      'invest_biens.visite_data.simulateur. Conservée pour l''historique.';
  END IF;
END $$;
