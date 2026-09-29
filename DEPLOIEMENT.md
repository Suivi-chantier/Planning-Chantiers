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
