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
