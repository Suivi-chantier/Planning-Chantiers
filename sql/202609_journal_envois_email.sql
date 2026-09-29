-- ============================================================================
-- CHANTIER 1.0 — Journal technique des envois de /api/send-email.
--
-- PÉRIMÈTRE : UNE table nouvelle + UNE fonction de purge nouvelle.
--   Migration strictement ADDITIVE : aucune table existante, aucune policy
--   existante, aucune donnée existante n'est lue, modifiée ou supprimée.
--
-- ÉTAT PRÉCÉDENT
--   /api/send-email journalise ses décisions en console uniquement. Sur le plan
--   Vercel Hobby, les journaux d'exécution sont conservés UNE heure : le bilan
--   des 5 jours ouvrés d'observation (EMAIL_AUTH_MODE=observer) serait
--   impossible à produire.
--
-- CHANGEMENT
--   public.journal_envois_email : une ligne par appel de /api/send-email,
--   MÉTADONNÉES SEULEMENT.
--
--   N'Y FIGURENT JAMAIS : corps, HTML, sujet, pièces jointes (ni contenu ni
--   nom de fichier), jeton, secret, JWT, adresse email complète (ni de
--   l'appelant, ni des destinataires — seulement le DOMAINE des destinataires).
--   Les contraintes CHECK ci-dessous l'imposent en base pour les colonnes
--   texte : aucune ne peut contenir « @ », et chacune est bornée en longueur.
--
--   Accès : RLS activée, AUCUNE policy, privilèges retirés à anon et
--   authenticated. Seule la clé service_role (serveur, api/send-email.js) lit
--   et écrit. Aucun écran de l'application n'y accède.
--
-- OBJECTIF
--   Produire le bilan d'observation avant la bascule observer → strict :
--   volume total, envois qui auraient été refusés, leur origine, leur motif.
--
-- IMPACT
--   Aucun sur l'existant. Si la table est absente, send-email continue
--   d'envoyer (l'écriture du journal ne bloque jamais un envoi).
--
-- PURGE
--   Fonction public.purger_journal_envois_email(conservation), NON planifiée.
--   Conservation par défaut : 90 jours (validée le 29/09/2026).
--   SECURITY INVOKER, exécutable par service_role seul.
--
-- ROLLBACK : sql/202609_journal_envois_email_rollback.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.journal_envois_email (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cree_le          timestamptz NOT NULL DEFAULT now(),

  -- Identifiant technique de la requête (en-tête x-vercel-id) : relie la ligne
  -- aux journaux Vercel de la même invocation, tant qu'ils existent.
  requete_id       text CHECK (char_length(requete_id) <= 120 AND position('@' in requete_id) = 0),

  -- Mode d'autorisation en vigueur au moment de l'appel.
  mode             text NOT NULL CHECK (mode IN ('observer', 'strict')),

  -- Résultat : autorisé / aurait été refusé (observer) / refusé (strict).
  decision         text NOT NULL CHECK (decision IN ('autorise', 'aurait_refuse', 'refuse')),

  -- Motif d'un refus (codes de api/_lib/autorisationEmail.js), NULL si autorisé.
  raison           text CHECK (char_length(raison) <= 60 AND position('@' in raison) = 0),

  -- Règle appliquée, et type d'appelant détecté.
  profil           text CHECK (profil IN ('serveur', 'collaborateur', 'rapport', 'invalide')),
  appelant         text NOT NULL CHECK (appelant IN ('serveur', 'collaborateur', 'ouvrier', 'anonyme', 'invalide')),
  -- Rôle interne de l'appelant (admin, conducteur…) — jamais son adresse.
  appelant_role    text CHECK (char_length(appelant_role) <= 40 AND position('@' in appelant_role) = 0),

  -- Origine de l'appel : étiquette X-Profero-Source (todo, rapport, cron…) —
  -- NULL = appareil resté sur un ancien bundle —, et chemin de la page
  -- d'origine (Referer, chemin seul, sans requête ni fragment).
  source           text CHECK (char_length(source) <= 60 AND position('@' in source) = 0),
  origine          text CHECK (char_length(origine) <= 200 AND position('@' in origine) = 0),

  -- Destinataires : leur NOMBRE et leurs DOMAINES, jamais les adresses.
  nb_destinataires smallint NOT NULL DEFAULT 0 CHECK (nb_destinataires >= 0),
  domaines         text[] NOT NULL DEFAULT '{}'
                   CHECK (cardinality(domaines) <= 50 AND position('@' in array_to_string(domaines, ',')) = 0),

  -- Pièces jointes : leur NOMBRE seulement.
  pieces_jointes   smallint NOT NULL DEFAULT 0 CHECK (pieces_jointes >= 0),

  -- L'envoi a-t-il réellement été transmis à Resend, et avec quel statut.
  envoye           boolean NOT NULL DEFAULT false,
  statut_resend    text CHECK (char_length(statut_resend) <= 20)
);

COMMENT ON TABLE public.journal_envois_email IS
  'Journal technique de /api/send-email (métadonnées seulement : ni contenu, ni '
  'pièce jointe, ni jeton, ni adresse complète). Écriture et lecture serveur '
  '(service_role) uniquement. Purge : purger_journal_envois_email().';

CREATE INDEX IF NOT EXISTS journal_envois_email_cree_le_idx
  ON public.journal_envois_email (cree_le DESC);
CREATE INDEX IF NOT EXISTS journal_envois_email_decision_idx
  ON public.journal_envois_email (decision, cree_le DESC);

-- ── Accès : serveur uniquement ──────────────────────────────────────────────
-- RLS activée et AUCUNE policy : anon et authenticated ne voient rien et
-- n'écrivent rien. service_role contourne la RLS (c'est la clé du serveur).
ALTER TABLE public.journal_envois_email ENABLE ROW LEVEL SECURITY;

-- Supabase accorde par défaut des privilèges à anon et authenticated sur les
-- nouvelles tables de public : on les retire explicitement, en plus de la RLS.
REVOKE ALL ON TABLE public.journal_envois_email FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.journal_envois_email TO service_role;

-- ── Purge (non planifiée) — conservation par défaut : 90 jours ──────────────
-- Supprime les lignes plus anciennes que `conservation`. Refuse une durée
-- absente ou inférieure à 7 jours, pour qu'une erreur de saisie ne vide pas le
-- journal en pleine observation.
--
-- SECURITY INVOKER, volontairement : la fonction s'exécute avec les droits de
-- l'APPELANT, pas de son propriétaire. Seul service_role détient DELETE sur la
-- table ; un autre rôle qui obtiendrait EXECUTE par erreur (privilèges par
-- défaut de Supabase, GRANT oublié…) échouerait sur le DELETE. Le verrou ne
-- repose donc pas sur le seul REVOKE. SECURITY DEFINER n'apporterait rien :
-- service_role a déjà les droits nécessaires.
-- search_path vide : tous les objets sont qualifiés, aucun détournement par un
-- objet homonyme n'est possible.
CREATE OR REPLACE FUNCTION public.purger_journal_envois_email(conservation interval DEFAULT interval '90 days')
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE supprimees integer;
BEGIN
  IF conservation IS NULL OR conservation < interval '7 days' THEN
    RAISE EXCEPTION 'Conservation absente ou trop courte (%) : minimum 7 jours.', conservation;
  END IF;
  DELETE FROM public.journal_envois_email WHERE cree_le < pg_catalog.now() - conservation;
  GET DIAGNOSTICS supprimees = ROW_COUNT;
  RETURN supprimees;
END;
$$;

-- EXECUTE : service_role uniquement (le propriétaire, postgres, le conserve
-- de fait). Retiré à PUBLIC, anon et authenticated, y compris le droit que
-- Supabase accorde par défaut sur les nouvelles fonctions de public.
REVOKE EXECUTE ON FUNCTION public.purger_journal_envois_email(interval) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purger_journal_envois_email(interval) TO service_role;

COMMIT;

-- ── CONTRÔLES (lecture seule) ───────────────────────────────────────────────
-- 1) RLS active, aucune policy :
--    SELECT relrowsecurity FROM pg_class WHERE oid = 'public.journal_envois_email'::regclass;  -- t
--    SELECT count(*) FROM pg_policies WHERE tablename = 'journal_envois_email';               -- 0
-- 2) Aucun privilège pour anon / authenticated :
--    SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'journal_envois_email' AND grantee IN ('anon','authenticated');     -- 0 ligne
-- 3) Fonction de purge : SECURITY INVOKER, et exécutable par service_role seul :
--    SELECT prosecdef FROM pg_proc
--    WHERE oid = 'public.purger_journal_envois_email(interval)'::regprocedure;               -- f
--    SELECT r AS role, has_function_privilege(r, 'public.purger_journal_envois_email(interval)', 'EXECUTE') AS execute
--    FROM unnest(array['anon','authenticated','service_role']) AS r;
--      → anon f, authenticated f, service_role t
--    SELECT r AS role, has_table_privilege(r, 'public.journal_envois_email', 'DELETE') AS delete
--    FROM unnest(array['anon','authenticated','service_role']) AS r;
--      → anon f, authenticated f, service_role t
-- 4) Depuis le poste de dev, clé anon : un GET REST sur
--    /rest/v1/journal_envois_email doit renvoyer une erreur de permission.
