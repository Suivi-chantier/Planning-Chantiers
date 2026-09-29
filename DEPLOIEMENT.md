# Déploiement — points à ne pas défaire

## `vercel.json` : pourquoi `/assets/` est exclu de la règle attrape-tout

```json
{ "source": "/((?!assets/).*)", "destination": "/index.html" }
```

La règle était `"/(.*)"`, c'est-à-dire : renvoyer `index.html` pour **toute**
URL non trouvée. Utile pour les routes d'une application monopage — mais elle
avalait aussi les requêtes vers des fichiers `/assets/*.js` supprimés par un
déploiement ultérieur.

Le navigateur recevait alors du HTML avec un code **200** là où il attendait un
module JavaScript :

```
TypeError: 'text/html' is not a valid JavaScript MIME type
sur /assets/react-CFvls62f.js
```

Quand le fichier concerné est le chunk React, **plus aucun script applicatif ne
s'exécute** : ni l'`ErrorBoundary`, ni la reprise de chunk. Écran blanc muet,
et sur un téléphone aucun moyen de diagnostiquer.

Avec le négatif, un asset manquant renvoie un vrai **404**. Le navigateur émet
alors un événement d'erreur normal, que le filet de `index.html` intercepte
pour purger le cache et recharger.

Vercel sert les fichiers réellement présents **avant** d'appliquer les
rewrites : les assets existants ne sont pas affectés.

**Attention** : `vercel.json` est validé contre un schéma strict. Toute clé
inconnue à la racine — y compris une pseudo-clé de commentaire comme
`_comment` — fait **échouer le déploiement**. C'est pour cela que cette
explication vit ici et non dans le fichier.

## `index.html` : le filet doit rester le premier bloc du `<head>`

Vite injecte le script du bundle à la **fin** du `<head>`. Un filet placé dans
le `<body>` s'enregistre donc APRÈS le début du chargement du module : l'erreur
peut survenir sans écouteur en place. C'est ce qui a laissé passer la panne du
20 août 2026, alors que le filet existait depuis le 29 juillet.

Il écoute trois canaux, parce qu'un échec de module ne se manifeste pas de la
même façon selon le navigateur :

1. erreur de chargement sur un élément `<script>` ou `<link>` — Chrome
2. erreur globale mentionnant le type MIME — Safari
3. promesse rejetée non gérée — import dynamique

La première version n'écoutait que le canal 1, et l'échec portait sur un module
importé par le module d'entrée : aucun élément ne portait l'erreur.

## Service worker

`registerType: 'prompt'` et `skipWaiting: false` (voir `vite.config.js`) : c'est
l'application qui décide du moment du rechargement, via `src/pwa.js`. Un
appareil peut donc rester longtemps sur une version précédente — d'où
l'importance des deux points ci-dessus.

## `api/cron-dispatcher.js` : router par `?job=`, pas par l'heure

Les crons Vercel natifs sont désactivés sur le plan Hobby. Les créneaux vivent
donc dans `.github/workflows/` et appellent tous la même fonction, qui déduisait
la tâche à lancer de **l'heure et du jour à Paris**.

Ce routage par fenêtre horaire tient tant que les fenêtres ne se recouvrent
pas. Elles se recouvrent maintenant :

| Tâche | Fenêtre Paris |
|---|---|
| veille échéances Invest | 3 h – 5 h, lun-ven |
| récap commandes | 5 h – 11 h, **vendredi** |
| rappel rapport | 13 h – 19 h, lun-ven |

Le tableau de bord Invest doit partir vers 7 h. Ajouté par fenêtre, il serait
parti **avec** le récap commandes chaque vendredi. D'où le paramètre explicite :

```
/api/cron-dispatcher?job=invest_tableau_bord
```

Quand `job` est fourni, le dispatcher lance cette tâche **sans regarder
l'heure**. C'est aussi le seul moyen de rejouer une tâche à la main hors de son
créneau, ce qui n'était pas possible avant.

Un nom de tâche inconnu renvoie un **400** avec la liste des noms valides,
plutôt qu'un 200 « rien à faire » : un créneau mal orthographié resterait
sinon muet pendant des mois.

Les trois créneaux historiques n'envoient pas de `job` et continuent d'être
routés par fenêtre — ne pas les convertir sans convertir aussi leur workflow.

**`maxDuration`** : le dispatcher est passé à 60 s. Le tableau de bord lit neuf
tables, construit un mail par destinataire et les expédie ; les 10 s par défaut
du plan Hobby ne suffisent pas.

## Deux mails Invest le matin, un seul destinataire à la fois

`cron-invest-echeances` (4 h) et `cron-invest-tableau-bord` (7 h) portent en
partie les mêmes lignes : le mail de 7 h intègre les collecteurs du premier
dans sa section « Échéances & vigilances ».

Qui reçoit celui de 7 h est donc **exclu** de celui de 4 h, via
`api/_cron/_destinataires-invest.js`. Deux mails disant à peu près la même
chose le même matin, et on cesse de lire les deux.

Ce module existe séparément parce qu'un `require` croisé entre les deux crons
serait circulaire. Ne pas y recopier la règle dans l'un des deux fichiers.

Réglage des destinataires — `planning_config` :

```json
{ "key": "invest_tableau_bord_destinataires",
  "value": { "emails": ["prenom.nom@groupe-profero.com"] } }
```

Sans cette clé : les utilisateurs actifs de la branche `invest` dont le rôle est
`admin` ou `direction`.

## Le tableau de bord Invest n'a qu'une définition

`src/Invest/tableauBord.mjs` porte la consolidation (alertes, colonnes,
priorités) **et** la liste des tables à lire (`REQUETES_TABLEAU_BORD`).
`Dashboard.jsx` l'affiche, `cron-invest-tableau-bord.js` l'envoie par mail.

Une requête ajoutée dans l'un sans l'autre produirait un mail incomplet **sans
erreur** — le pire cas, parce qu'un tableau de bord vide rassure. C'est pour
cela que la liste est partagée et non recopiée.

`scripts/verif-tableau-bord.mjs` vérifie ce point explicitement, en relisant
`Dashboard.jsx` : aucune requête `invest_*` directe, aucune redéfinition de
`consolidateData`.

## Règle : toute route est interdite par défaut

Une route n'est accessible qu'après identification explicite : collaborateur
authentifié, serveur authentifié, session portail client, ou cas public
documenté et fortement limité. **L'absence d'une variable d'environnement ne
doit jamais ouvrir une route** : elle la ferme.

Les routes cron testaient `if (process.env.CRON_SECRET) { … }` — variable
absente, vérification sautée, route publique. Elles passent maintenant par
`api/_lib/autorisationServeur.js` : sans `CRON_SECRET`, elles répondent
**500** « route fermée par défaut ». Un cron qui échoue bruyamment vaut mieux
qu'une route sensible ouverte.

`api/_lib/` est préfixé `_` : il n'est **pas** déployé en fonction.

## `/api/send-email` : trois appelants possibles, pas un de plus

C'était un relais ouvert (ni authentification, `from` libre, CORS `*`). Règles
dans `api/_lib/autorisationEmail.js` :

| Appelant | Identifié par | Droit |
|---|---|---|
| serveur (crons) | `Authorization: Bearer <CRON_SECRET>` | envoi libre |
| collaborateur | JWT Supabase + ligne `utilisateurs` **active**, rôle ≠ ouvrier | envoi libre |
| compte rendu | anonyme (`/rapport`) ou ouvrier connecté | uniquement vers `DESTINATAIRES_RAPPORT`, sans copie ni pièce jointe, sujet « CR … » |

Tout le reste est refusé — y compris un compte Auth absent de `utilisateurs`.
Le `from` de l'appelant est ignoré : l'expéditeur est toujours `RESEND_FROM`.

Côté navigateur, **un seul point d'appel** : `src/emailApi.js`
(`envoyerEmailApi`), qui joint le JWT de la session. Côté serveur, les
`envoyerMail` des crons utilisent `enTetesAppelServeur()`.
`scripts/verif-send-email.mjs` échoue si un `fetch("/api/send-email")` direct
réapparaît, ou si un cron appelle sans en-tête.

**La liste blanche du compte rendu n'existe qu'à un endroit** :
`DESTINATAIRES_RAPPORT` dans `api/_lib/autorisationEmail.js`. Un destinataire
ajouté dans `RapportMobile.jsx` sans l'y ajouter serait refusé en mode strict.

### `EMAIL_AUTH_MODE` : observer, puis strict

| Valeur | Effet |
|---|---|
| `observer` | rien n'est bloqué ; chaque refus est journalisé `aurait_refuse` |
| absente, ou toute autre valeur | **strict** : les refus sont appliqués |

L'absence vaut strict, par la règle ci-dessus. **Il faut donc poser
`EMAIL_AUTH_MODE=observer` dans Vercel (Production) AVANT le premier
déploiement**, sinon les appareils restés sur l'ancien bundle (qui appelle sans
en-tête) verraient leurs envois refusés d'emblée. La bascule en strict se fait
en changeant la variable puis en redéployant — **jamais automatiquement**.

Le journal ne contient que des métadonnées : décision, raison, profil, type et
rôle de l'appelant, source (`X-Profero-Source`), chemin d'origine, nombre et
domaines des destinataires, nombre de pièces jointes, identifiant de requête
Vercel. Jamais le sujet, le corps, les pièces jointes, un jeton, ni aucune
adresse complète. Un appel **sans** `source` vient d'un appareil resté sur un
ancien bundle.

Il est écrit en console **et** dans `public.journal_envois_email`
(`sql/202609_journal_envois_email.sql`) : sur Hobby, les journaux Vercel ne
durent qu'une heure, la table est la seule trace qui permet le bilan
d'observation. RLS sans policy, privilèges retirés à anon/authenticated :
seul le serveur y accède. **Appliquer la migration avant le déploiement** ;
table absente, les envois continuent mais rien n'est conservé. Purge :
`select public.purger_journal_envois_email('90 days');` (non planifiée).

Bilan d'observation :

```sql
select decision, raison, appelant, coalesce(source, '(ancien bundle)') as source,
       origine, count(*) as envois, sum(pieces_jointes) as pj
from public.journal_envois_email
where cree_le >= '<date de déploiement>'
group by 1, 2, 3, 4, 5 order by envois desc;
```

## Service worker : `/espace-client` et `/api/` exclus du repli

`navigateFallbackDenylist: [/^\/espace-client/, /^\/api\//]` dans
`vite.config.js`. Sans elle, un appareil ayant l'app collaborateurs installée
recevrait `index.html` (l'app collaborateurs) en naviguant vers le futur
portail client. Diffusée **avant** le portail, parce qu'un appareil peut rester
longtemps sur un ancien service worker (`registerType: 'prompt'`).

## Liens d'invitation et de réinitialisation : relevés avant `createClient`

`supabase-js` (flow implicite) lit le fragment `#access_token=…&type=invite`
dès sa création, enregistre la session, puis **efface le fragment avant de
prévenir l'application**. L'ancienne détection de `App.jsx` lisait l'URL
après coup : l'invité entrait sans définir de mot de passe, et le lien de
réinitialisation (`PASSWORD_RECOVERY`) n'était pas traité.

`src/supabase.js` appelle donc `capturerLienAuth()` (`src/authLien.mjs`)
**avant** `createClient` — ne pas inverser ces deux lignes, ne pas créer d'autre
client Supabase côté navigateur. `App.jsx` propose `PageCreerMotDePasse`
uniquement si la session active est celle du lien (même `access_token`) : la
présence de `type=invite` / `type=recovery` dans l'URL ne suffit jamais. Un
lien expiré ou forgé ouvert dans un navigateur déjà connecté ne propose donc
pas à ce compte de changer son mot de passe.

Lien valide ouvert dans un navigateur déjà connecté : la session du lien
**remplace** la session existante (comportement de supabase-js). L'écran
affiche le compte réellement actif et propose « Se déconnecter ».

`scripts/verif-auth-lien.mjs` rejoue ces cas avec le vrai `supabase-js`.
