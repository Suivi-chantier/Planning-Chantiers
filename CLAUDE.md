# CLAUDE.md — règles de travail sur ce dépôt

Application Profero (Planning-Chantiers). Loris n'est pas développeur : les
comptes rendus doivent être compréhensibles sans lire le code, et ne jamais
l'orienter vers GitHub.

## Comptes rendus et exemples

> Ne jamais présenter une sortie de jeu de test comme une sortie réelle. Quand un
> exemple vient des tests, l'écrire explicitement : "exemple issu des tests,
> données fictives". Loris ne lit pas le code : un exemple inventé présenté comme
> vérifié lui fait croire qu'une fonctionnalité tourne sur ses vraies données.
> Si un exemple réel est demandé, il doit venir d'une requête sur la base, pas
> d'une fixture.

**Pourquoi cette règle existe — le cas qui l'a provoquée (24/09/2026).**
Un exemple de résumé e-mail du Bilan Semaine citant les chantiers « LE CLOS » et
« VILLA NORD » en semaine 2026-W39 a été présenté comme « produit réellement
(vérifié) ». C'était faux :

- ces deux noms de chantiers n'existent pas — la base en compte 29, aucune
  occurrence de l'un ni de l'autre ;
- la semaine 2026-W39 n'a aucun relevé hebdomadaire à cette date ;
- les chiffres venaient d'un script de démonstration écrit pour l'occasion,
  avec des données inventées de bout en bout.

L'exécution était réelle, mais les données ne l'étaient pas — et c'est la seule
chose qui compte pour quelqu'un qui ne peut pas ouvrir le fichier pour vérifier.
Un rendu de ce type donne l'illusion d'une fonctionnalité déjà en service sur de
vraies données.

En pratique : un bloc d'exemple non issu de la base porte la mention
« exemple issu des tests, données fictives », sur la même ligne ou juste au-dessus.
Pas en note de bas de page.

## Invariants du projet

- **Une impossibilité doit rester visible.** Ne jamais présenter une absence de
  donnée comme un résultat. Une fin de chantier qu'on ne peut pas calculer
  s'affiche « au-delà de l'horizon », pas comme une date ; une semaine sans
  relevé s'affiche « relevé pas encore disponible », pas « aucune dérive ».
  Quand un état vide et un état inconnu se ressemblent à l'écran, c'est un bug.
- **Même chiffre = même service + même explication.** Un montant affiché deux
  fois dans l'application vient du même module et porte la même explication.
  Aucun recalcul parallèle : on lit les colonnes déjà écrites.
- **Dossier Invest — fonctions SECURITY DEFINER.** Toute future fonction
  SECURITY DEFINER susceptible d'écrire dans `invest_dossier_etapes` doit faire
  l'objet d'un audit explicite, car une fonction appartenant à postgres
  contourne les règles de pilotage (`invest_etapes_regles_pilotage`).
  Détail : `docs/project/DOSSIER-INVEST-TRANCHE2A.md`.
- **Réservé aux collaborateurs (deny by default).** Toute table de `public` et
  tout bucket Storage portent la policy RESTRICTIVE
  `profero_collaborateurs_seulement` (`est_collaborateur_actif()`). Une
  nouvelle table ou un nouveau bucket doit la recevoir dans sa migration ;
  l'ouverture au portail client se fait table par table, explicitement.
  Détail : `docs/project/SECURITE-3A-COLLABORATEURS-SEULEMENT.md`.
- **Modules de calcul purs** : extension `.mjs`, aucun accès Supabase, aucune
  horloge, aucun effet de bord, façade `.js` (`export * from "./x.mjs"`) pour le
  front. Les données arrivent en paramètre.

## Conventions

- Les scripts de vérification vivent dans `scripts/`, nommés `verif-*.mjs`, et
  sont branchés dans un workflow de `.github/workflows/`.
- Toute fonctionnalité livrée reçoit une entrée dans `src/Renovation/journalMaj.js`,
  rédigée en langage métier.
- Une nouvelle page bureau s'enregistre dans `src/access.js`.
- Toute nouvelle page : dans `src/access.js`, la liste enregistrée en base
  (`planning_config.access_pages_renovation`) remplace la liste par défaut pour
  chaque rôle, SAUF pour admin, qui reçoit automatiquement toute page de sa
  liste par défaut (auto-grant en fin de `loadAccessConfig`). Avant d'annoncer qui
  verra une page, vérifier la configuration en base ET lire `loadAccessConfig`
  jusqu'au bout. Dire explicitement dans le compte rendu : visible pour admin
  (auto-grant) ou non, et pour quels autres rôles.

## Vérifications : GitHub s'en charge, pas de scripts en local

Décision de Loris du 14/10/2026 : lancer les scripts en local à chaque
modification est beaucoup trop long. Chaque demande de fusion relance tous les
workflows sur GitHub, et `main` refuse la fusion tant qu'ils ne sont pas verts :
c'est la vérification qui fait foi.

- Par défaut, **aucun script `verif-*` ni compilation en local**. On pousse la
  branche, on ouvre la demande de fusion, on attend les contrôles GitHub.
- On continue d'écrire et de brancher les scripts `verif-*` d'une nouvelle
  fonctionnalité (ils tournent sur GitHub, sans coût pour Loris).
- Exception : un contrôle GitHub échoue. On lance alors en local le seul script
  en échec, pour comprendre et corriger.
- Les trois scripts qui échouent déjà sous Windows (`verif-composants-internes`,
  `verif-progbat-yards-ecran`, `verif-urbanisme`) ne sont plus mesurés avant /
  après, et ne doivent toujours pas être « réparés ».

## Mise en ligne : sans attendre de feu vert

Décision de Loris du 14/10/2026 : une tâche terminée est mise en ligne sans
qu'il ait à le demander ou à l'écrire. Dès que tous les contrôles GitHub de la
demande de fusion sont verts, on la fusionne (`gh pr merge`), on attend la fin
du déploiement, et le compte rendu dit simplement que c'est en ligne. Si un
contrôle est rouge, on corrige d'abord ; on ne fusionne jamais au rouge.
Une migration de base n'est pas couverte par cette règle : on dit ce qu'elle
change et on demande avant de l'appliquer.

Seule exception, décisions de Loris du 24/10/2026 : en mode projet (voir
« Projets longs »), toute migration est appliquée sans demander, une fois
vérifiée.

- **Migration purement additive** — création de table, de colonne, d'index, ou
  ajout de la policy `profero_collaborateurs_seulement` sur une nouvelle
  table :
  - avant : relire le SQL en entier et confirmer qu'il ne fait que créer ;
    vérifier sur la base que les objets créés n'existent pas déjà et que
    chaque nouvelle table reçoit bien `profero_collaborateurs_seulement` ;
  - après : vérifier que la migration est bien enregistrée comme appliquée et
    que l'application s'ouvre.
- **Migration qui supprime, renomme ou réécrit des données** — mêmes
  vérifications, et en plus :
  - avant : compter sur la base les lignes touchées, et essayer la migration
    dans une transaction annulée ;
  - sauvegarder les données supprimées ou réécrites dans une table de
    sauvegarde datée (qui reçoit `profero_collaborateurs_seulement`), pour
    pouvoir revenir en arrière ;
  - après : vérifier les comptes, et refaire le tableau avant / après sur les
    vrais chantiers si des chiffres financiers sont touchés ;
  - si le nombre de lignes touchées est très éloigné de ce qui était prévu,
    on s'arrête.

Le compte rendu dit ce qui a été vérifié, et pour une migration qui supprime
ou réécrit : le nombre de lignes touchées et le nom de la sauvegarde. Raison :
sur un projet long, attendre une réponse pour chaque migration bloquerait
tout ; la vérification et la sauvegarde rendent chaque migration rattrapable.
Hors mode projet, rien ne change.

## Projets longs : travail en autonomie

Décision de Loris du 24/10/2026 : un gros projet (plusieurs fonctionnalités,
plusieurs demandes de fusion) est décrit dans un seul fichier, et mené seul
jusqu'à la mise en ligne complète. On ne s'arrête qu'aux points de validation.
On est « en mode projet » quand Loris désigne un fichier de `docs/projets/`.

### Le fichier projet

- Il vit dans `docs/projets/<nom>.md` (modèle : `docs/projets/_modele.md`) et
  fait foi : en cas de doute, on relit le fichier, pas la conversation. Une
  conversation se coupe ou se résume ; le fichier reste.
- Sections de Loris — Objectif métier, Règles et invariants, Hors périmètre,
  Description des étapes, Validation automatique — jamais modifiées. Si une
  découverte les rend fausses ou impossibles, on s'arrête et on lui demande :
  c'est lui qui décide de ce que le projet doit faire.
- Sections de Claude — Tâches, Journal des décisions, Comptes rendus — mises à
  jour après chaque tâche et avant tout arrêt, pour qu'une nouvelle session
  puisse reprendre sans rien demander à Loris.
- Statuts d'une tâche : à faire, en cours, en attente de Loris, en ligne,
  bloquée, abandonnée.
- Reprise : avant de continuer une tâche « en cours », vérifier son état réel
  (branche, demande de fusion, migration appliquée ou non). Une coupure a pu
  survenir juste après l'écriture du fichier : le statut écrit peut être en
  retard sur la réalité.

### Découpage et pilotage

- Tableau des tâches vide : on commence par découper. Une tâche = une demande
  de fusion qui fonctionne seule, assez petite pour une session ; en cas de
  doute, plus fin. Chaque tâche indique son niveau de validation et ce qui
  prouvera qu'elle est réussie.
- La session principale pilote et ne code pas. Chaque tâche est confiée à un
  sous-agent, une à la fois, avec le fichier projet, CLAUDE.md et les comptes
  rendus précédents. Raison : la session principale garde la vue d'ensemble sur
  toute la durée du projet au lieu de se remplir du détail du code.
- Après chaque tâche : vérifier que c'est vraiment en ligne (fusionné,
  déploiement terminé, l'application s'ouvre), mettre le fichier à jour, revoir
  les tâches restantes. Toute modification du plan est notée dans le journal
  avec sa raison.
- Une tâche ne démarre que si la précédente est en ligne : chaque tâche
  s'appuie sur une base qui tourne réellement.

### Validation automatique

- On applique la section « Validation automatique » du fichier projet. Quand
  elle est vide :
  - mise en ligne seule si tous les contrôles sont verts ;
  - migration seule si elle est purement additive et vérifiée (voir « Mise en
    ligne ») ;
  - chiffres financiers : tableau avant / après sur les VRAIS chantiers
    (requête sur la base, jamais une fixture) ; aucun chantier ne doit varier
    de plus de 500 € ou de 2 points de marge. Ce tableau est recopié dans le
    compte rendu même quand tout passe.
- Arrêts obligatoires, même si le fichier projet dit autre chose :
  - reprise ou reconstitution de données appliquée pour de vrai (la simulation
    peut tourner seule) ;
  - toute modification des droits d'accès : policies, fonctions SECURITY
    DEFINER, `src/access.js`, rôles. Seule exception : la pose de
    `profero_collaborateurs_seulement` sur une nouvelle table, qui applique
    l'invariant « Réservé aux collaborateurs » ;
  - contrôle encore rouge après 2 corrections ;
  - découverte qui change l'objectif ;
  - chiffre très éloigné de ce que le projet laissait attendre.

  Raison : ce sont les erreurs qu'on ne rattrape pas en annulant une demande de
  fusion.
- Avant de s'arrêter, écrire dans le fichier : le statut, ce qui est fait, ce
  qui bloque, la question et les éléments pour décider. La question doit
  pouvoir recevoir une réponse en une phrase, depuis un téléphone. La réponse
  de Loris est notée dans le journal avant de reprendre.

### Autorisations

- Si une commande nécessaire est interdite par la configuration, on s'arrête et
  on le signale. On ne contourne jamais une interdiction par un autre moyen :
  une interdiction est une décision de Loris, pas un obstacle technique.

### Fin de projet

- Synthèse en français, sans jargon, dans le fichier et dans la conversation :
  ce qui a changé pour les conducteurs, les ouvriers et la direction ;
  principaux chiffres avant / après ; points en suspens ; entrées ajoutées dans
  `src/Renovation/journalMaj.js`.
- Le message de fin commence par « Projet terminé » : c'est ce qui déclenche la
  notification Windows « Projet terminé » (`.claude/hooks/notifier.mjs`).

### Hors mode projet

- Une demande isolée trop grosse pour une session n'est pas commencée telle
  quelle : on propose de la transformer en fichier projet, avec un premier
  découpage. Raison : commencée en vrac, elle s'arrête au milieu sans trace de
  ce qui reste à faire.
