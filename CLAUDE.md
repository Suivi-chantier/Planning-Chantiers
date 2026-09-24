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
- **Modules de calcul purs** : extension `.mjs`, aucun accès Supabase, aucune
  horloge, aucun effet de bord, façade `.js` (`export * from "./x.mjs"`) pour le
  front. Les données arrivent en paramètre.

## Conventions

- Les scripts de vérification vivent dans `scripts/`, nommés `verif-*.mjs`, et
  sont branchés dans un workflow de `.github/workflows/`.
- Toute fonctionnalité livrée reçoit une entrée dans `src/Renovation/journalMaj.js`,
  rédigée en langage métier.
- Une nouvelle page bureau s'enregistre dans `src/access.js`.
- Trois scripts échouent déjà sous Windows et ne doivent pas être « réparés » :
  `verif-composants-internes`, `verif-progbat-yards-ecran`, `verif-urbanisme`.
  Les mesurer avant et après toute modification, en comparant les sorties.
