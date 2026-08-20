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
