# Hook d'accès Profero (Custom Access Token Hook)

Chantier 1.0 — TRANSVERSE / sécurité. Migration
`supabase/migrations/20260930170000_acces_profero_hook_sessions.sql`.

**État (01/10/2026)** : migration appliquée (corps des 4 fonctions = fichier),
fonction appelée à blanc sur les 18 comptes Auth avant activation (15
collaborateurs actifs acceptés, 3 comptes désactivés refusés en 403), hook
activé dans le tableau de bord vers 10:30 UTC, reconnexion administrateur OK
(journal Auth : « Hook ran successfully »). Sessions des comptes déjà
désactivés : non supprimées (le hook refuse leur renouvellement).
Recette restante : collaborateur non admin après plus d'une heure ; compte
désactivé refusé à l'écran.

## Ce que ça garantit

`public.utilisateurs.actif` est la **seule** source de vérité de l'accès d'un
collaborateur. Supabase Auth appelle `public.acces_profero_hook` avant de
délivrer **chaque** jeton — connexion, renouvellement (`token_refresh`), lien
d'invitation, de réinitialisation, lien magique — et refuse (HTTP 403,
« Accès Profero refusé : compte désactivé ou non autorisé. ») toute identité
qui ne relève pas d'une population autorisée.

| Population | Autorisée si | Où |
|---|---|---|
| `collaborateur` | au moins un profil `utilisateurs` à cette adresse, `actif = true`, et aucun profil non actif à la même adresse | `public.acces_collaborateur_autorise(email)` |
| `client_invest` | **Chantier 1.1** — aujourd'hui toujours `false` | `public.acces_client_invest_autorise(user_id)` |
| aucune, les deux, erreur | — refus | |

Le jeton accordé porte la claim `profero_population`, posée par le serveur.

Désactiver un profil (ou le supprimer) supprime aussi ses sessions Auth
(déclencheur `utilisateurs_revoquer_sessions`). Réactiver = remettre
`actif = true` : la personne se reconnecte avec son mot de passe.

**Fenêtre résiduelle** : un jeton d'accès déjà délivré reste valable jusqu'à
son expiration (1 h par défaut, Authentication → Sessions / JWT). Supabase ne
permet pas de l'annuler ; la fermer entièrement relève du durcissement des
tables (1.0 bis).

## Brancher les clients Invest (Chantier 1.1) — contrat

Remplacer **uniquement** le corps de `public.acces_client_invest_autorise(p_user_id uuid)` :

- lire la table clients du 1.1 **par identifiant Auth** (`p_user_id`), jamais
  par email, jamais dans `public.utilisateurs` ;
- fermée par défaut : `false` si la ligne est absente, révoquée, ou en cas de
  doute ;
- rester `language sql stable set search_path = ''`, sans `security definer`
  (le hook s'exécute déjà en propriétaire) et sans droit pour `anon` /
  `authenticated`.

Le hook refuse d'office une identité reconnue à la fois collaborateur et
client : les deux populations ne se mélangent jamais. Les politiques RLS du
portail pourront exiger `auth.jwt() ->> 'profero_population' = 'client_invest'`
(et les tables bureau `= 'collaborateur'`).

## Pourquoi supprimer directement les sessions dans `auth.sessions`

Comparaison faite avant de choisir (documentation Supabase, 30/09/2026) :

| | API Admin | Suppression dans `auth.sessions` |
|---|---|---|
| Révoquer les sessions d'un utilisateur **par son identifiant** | **N'existe pas** : `auth.admin.signOut(jwt)` exige le jeton de l'utilisateur lui-même | oui |
| Effet | — | celui d'une déconnexion : « When a user signs out, the sessions affected by the logout are removed from the database entirely » (guide *User sessions*) ; refresh tokens et `mfa_amr_claims` supprimés par `ON DELETE CASCADE` ; couvre aussi les jetons stockés dans la session (`refresh_token_hmac_key`) |
| Bannir (`ban_duration`) | possible, mais c'est un second état à synchroniser — écarté | — |
| Journal d'audit Auth | — | pas d'événement « logout » |
| Stabilité | API publique | schéma interne à Supabase : peut évoluer |

Décision : suppression directe, **au mieux**. Si elle échoue (schéma Auth
modifié par Supabase), la désactivation n'est pas bloquée — avertissement dans
les journaux PostgreSQL — et le hook reste la garantie : il refuse le
renouvellement. La suppression des sessions n'est qu'une accélération.

## Activation (manuelle, une fois — après application de la migration)

La migration seule ne change rien aux connexions. **Ne pas** déclarer le hook
dans `supabase/config.toml` : une section `[auth]` partielle ferait réécrire,
par un `supabase config push`, tous les autres réglages Auth de production
avec les valeurs par défaut du CLI.

1. Vérifier, en lecture seule, que la fonction répond correctement :
   admin actif → claims + `profero_population = collaborateur` ; compte
   désactivé → erreur 403.
2. Tableau de bord → **Authentication → Hooks** → **Custom Access Token** →
   *Enable* → type **Postgres** → schéma `public` → fonction
   `acces_profero_hook` → *Create/Save*.
   (URI équivalente : `pg-functions://postgres/public/acces_profero_hook`.)
3. Immédiatement : se connecter avec un compte administrateur. Si la connexion
   échoue → désactiver le hook (étape de retour arrière 1), rien d'autre.
4. Recette (voir plus bas).

## Retour arrière

1. **D'abord** : Authentication → Hooks → Custom Access Token → *Disable*.
   Effet immédiat, toutes les connexions redeviennent comme avant.
2. Ensuite seulement, si nécessaire :
   `npx supabase db query --linked -f sql/202609_acces_profero_hook_sessions_rollback.sql`
   puis `npx supabase migration repair --status reverted 20260930170000 --linked`.

Supprimer la fonction pendant que le hook est actif bloquerait **toutes** les
connexions. Les sessions déjà supprimées ne reviennent pas : les personnes se
reconnectent.

## Recette après activation

- administrateur : connexion OK ;
- collaborateur actif non admin : connexion OK, et session toujours valide
  après plus d'une heure (renouvellement accepté) ;
- compte de test désactivé : connexion refusée avec le message « Votre compte a
  été désactivé ou n'est pas autorisé » ;
- journaux Auth : refus visibles, aucun refus pour un compte actif.
