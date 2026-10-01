# Sécurité — étape 3d : Edge Functions Invest

01/10/2026, périmètre Profero Invest. **État : DÉPLOYÉ le 01/10/2026. Fermeture vérifiée (401 avec la clé publique seule). `send-mission-email` testée avec un compte collaborateur : mail reçu. Les deux autres : test applicatif restant.**

Les trois fonctions n'étaient pas dans le dépôt ; code récupéré de la production
(sans modification) et archivé dans `archives/edge-functions-avant-3d/`.

Constat : `verify_jwt` est actif, mais la clé « anon » (publique, dans le bundle)
est un jeton valide → les trois étaient appelables par n'importe qui.

| Fonction | Avant | Après |
|---|---|---|
| `send-mission-email` | relais Gmail og@ ouvert : destinataire, sujet, texte et expéditeur choisis par l'appelant | collaborateur actif exigé ; expéditeur imposé og@groupe-profero.com |
| `notify-new-prospect` | relais d'e-mails ouvert (destinataire libre) ; le GET public affichait l'adresse de notification | collaborateur actif exigé ; adresse retirée du GET (qui reste public, sans donnée) |
| `sourcing-analyse-url` | filtre `includes("leboncoin.fr")` contournable, redirections suivies | collaborateur actif exigé ; nom de domaine réel vérifié (https), redirections suivies à la main (3 max) et refusées hors leboncoin.fr |

Garde : jeton validé (`auth.getUser`) puis RPC `est_collaborateur_actif()`, la même
règle que la RLS. Client borné au jeton de l'appelant, aucun service_role.
Le front (`supabase.functions.invoke`) envoie déjà le jeton de l'utilisateur connecté.

Non vérifié : pas de Deno sur le poste, donc syntaxe contrôlée (esbuild) mais
pas d'exécution. À contrôler après déploiement : bouton « Mail » du CRM, création
d'un prospect (notification), capture d'une annonce dans Sourcing.

Déploiement (garder `--use-api`, jamais de changement de verify_jwt) :
`npx supabase functions deploy <nom> --project-ref yooksnzhlffqgpzkcjhl --use-api`
Retour arrière : redéployer le fichier de `archives/edge-functions-avant-3d/<nom>/`.
