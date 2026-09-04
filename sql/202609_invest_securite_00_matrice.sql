-- ============================================================================
-- CHANTIER 1C · 00 — Matrice d'accès Invest : super_admin en accès complet.
--
-- PÉRIMÈTRE : INVEST ONLY.
--   Ce fichier ne touche QUE la clé `access_pages_invest` de planning_config.
--   Les 31 autres clés de cette table (dont access_pages_renovation, chantiers,
--   ouvriers, taux_horaires, etats_financiers…) ne sont PAS modifiées : la
--   mise à jour se fait par fusion jsonb sur une seule clé de l'objet, et le
--   WHERE porte sur une seule ligne.
--
-- ÉTAT PRÉCÉDENT (relevé le 04/09/2026, avant modification)
--   La clé `super_admin` n'accordait que 8 des 12 pages Invest. Il lui
--   manquait : prospection, sourcing, etat_des_lieux, urbanisme.
--   Valeur exacte relevée :
--     "super_admin": ["dashboard","crm","biens","simulateur","admin",
--                     "finance","suivi_financier","structuration"]
--
--   À noter : la variante historique "Super Admin" (avec espace et majuscules)
--   possédait DÉJÀ les 12 pages. Seule la clé canonique était incomplète.
--
--   Autres clés de la matrice au même relevé, laissées INCHANGÉES par ce
--   fichier — reproduites ici pour servir de point de retour :
--     "admin"        : les 12 pages
--     "Admin"        : les 12 pages
--     "Super Admin"  : les 12 pages
--     "commercial"   : ["crm","biens","simulateur","structuration","prospection"]
--     "Commercial"   : ["dashboard","prospection","crm","biens","simulateur",
--                       "structuration","finance","suivi_financier"]
--     "direction"    : ["dashboard","prospection","crm","biens","simulateur",
--                       "structuration","finance","suivi_financier"]
--     "Direction"    : idem "direction"
--     "conseiller"   : idem "direction"
--     "Conseiller"   : idem "direction"
--     "agent_edl"    : ["etat_des_lieux"]
--
-- CHANGEMENT
--   `super_admin` reçoit les 12 pages Invest. Décision métier confirmée :
--   super_admin = accès complet à Profero Invest.
--
-- OBJECTIF
--   Cette matrice devient la source d'autorité de la RLS Invest (fichier 01).
--   Elle doit donc être juste AVANT que les policies s'y adossent, sinon un
--   super_admin perdrait en base des modules que l'interface lui refuse déjà
--   par erreur.
--
-- IMPACT
--   Immédiat et visible : un compte super_admin voit réapparaître les onglets
--   Prospection, Sourcing, États des lieux et Urbanisme. Aucun autre rôle
--   n'est affecté. Aucune donnée métier touchée.
--
-- ORDRE D'APPLICATION : ce fichier D'ABORD, avant 01.
-- ============================================================================

BEGIN;

-- Garde-fou : on refuse d'agir si la clé n'existe pas, plutôt que de créer
-- une matrice partielle qui verrouillerait tout le monde.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.planning_config WHERE key = 'access_pages_invest') THEN
    RAISE EXCEPTION
      'access_pages_invest absente de planning_config : ne pas continuer, '
      'la RLS du fichier 01 retomberait sur son repli admin/super_admin.';
  END IF;
END $$;

-- Trace de la valeur précédente dans les journaux Postgres, avant écrasement.
DO $$
DECLARE avant jsonb;
BEGIN
  SELECT value -> 'super_admin' INTO avant
  FROM public.planning_config WHERE key = 'access_pages_invest';
  RAISE NOTICE 'access_pages_invest.super_admin AVANT = %', COALESCE(avant::text, '(absent)');
END $$;

-- Fusion jsonb : `||` ne remplace QUE la clé fournie et conserve toutes les
-- autres. Un `set value = '{...}'` complet aurait écrasé les 10 autres rôles.
UPDATE public.planning_config
SET    value = value || jsonb_build_object(
         'super_admin',
         jsonb_build_array(
           'dashboard', 'prospection', 'crm', 'sourcing', 'biens', 'simulateur',
           'etat_des_lieux', 'urbanisme', 'structuration', 'finance',
           'suivi_financier', 'admin'
         )
       ),
       updated_at = now()
WHERE  key = 'access_pages_invest';

-- Contrôle : doit renvoyer 12.
SELECT jsonb_array_length(value -> 'super_admin') AS pages_super_admin
FROM   public.planning_config
WHERE  key = 'access_pages_invest';

COMMIT;

-- ── RETOUR ARRIÈRE ──────────────────────────────────────────────────────────
-- UPDATE public.planning_config
-- SET    value = value || jsonb_build_object(
--          'super_admin',
--          jsonb_build_array('dashboard','crm','biens','simulateur','admin',
--                            'finance','suivi_financier','structuration')
--        ),
--        updated_at = now()
-- WHERE  key = 'access_pages_invest';
