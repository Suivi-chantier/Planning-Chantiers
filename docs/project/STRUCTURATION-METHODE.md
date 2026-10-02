# Structuration patrimoniale : la méthode des professionnels, et ce que la page en fait

Rédigé le 02/10/2026. Écrit pour Matthieu et l'équipe Profero Invest, sans jargon de code.

## Ce qui a été consulté

Recherche en ligne le 02/10/2026 sur la pratique des conseillers en gestion de patrimoine (CGP / CIF) :

- la démarche de conseil en sept étapes : recueil d'informations, analyse et diagnostic, conception de la stratégie (ingénierie patrimoniale), présentation et explications, mise en œuvre, suivi et contrôle, adaptation aux évolutions ;
- les documents qu'un conseiller doit pouvoir produire, datés et signés : document d'entrée en relation (DER), lettre de mission, questionnaire de connaissance du client, déclaration / rapport d'adéquation, information sur les frais ;
- les leviers de structuration immobilière les plus courants : SCI à l'IR ou à l'IS, holding, démembrement, donation de parts avec décote d'illiquidité, pacte Dutreil, toujours en coordination avec le notaire, l'expert-comptable et l'avocat fiscaliste.

Sources : gestion-de-patrimoine-du-chef-d-entreprise.com (démarche en sept étapes), garonne-patrimoine.com (documents obligatoires), cgpp.fr (lettre de mission), noun-partners.com et odincapital.fr (holding / SCI), hr-associes.fr (démembrement). Ce sont des sites de cabinets, pas des textes de loi : ils décrivent la pratique, ils ne remplacent ni un juriste ni la réglementation de l'AMF et de l'ORIAS. À faire valider par votre conformité avant de présenter le parcours comme « conforme ».

## Ce que la page faisait déjà bien

Collecte très complète (profil, patrimoine, financement, pièces), analyse, scénarios, préconisations, rapport PDF.

## Ce qui manquait par rapport à la pratique

1. **Le début** : rien ne suivait la remise du document d'entrée en relation, la signature de la lettre de mission, la vérification d'identité et de l'origine des fonds, ni la déclaration d'adéquation.
2. **La fin** : rien après la restitution. Or une structuration se met en œuvre avec d'autres professionnels (notaire, expert-comptable, banque) et se revoit chaque année.
3. **Aucune vue d'ensemble** : on ne voyait pas à quelle étape en était le dossier, ni quoi faire ensuite.

## Ce qui a été construit

- Une **barre de parcours** en sept étapes (cadrage et conformité · recueil · diagnostic · stratégies comparées · préconisation et restitution · mise en œuvre · suivi). Chaque étape affiche ses points faits / à faire, la barre dit le prochain point et y mène en un clic.
- Un onglet **Cadrage & conformité** (nouveau).
- Un onglet **Mise en œuvre & suivi** (nouveau) : rapport remis, intervenants à coordonner, actions de mise en œuvre avec échéances, prochaine revue.
- Les onglets existants sont conservés et renommés dans l'ordre de la démarche.

Les règles de calcul sont dans `src/Invest/structurationParcours.mjs`, vérifiées par `scripts/verif-structuration-parcours.mjs` (jeu de données fictif). Un point sans donnée est toujours « à faire », jamais « fait par défaut » : les trois préconisations modèles d'un nouveau dossier ne comptent donc pas tant qu'aucune stratégie n'est rédigée.

## Ce qui reste à décider avec vous

- Le dossier de structuration est-il une activité réglementée chez Profero (statut CIF / courtage) ? Si oui, des points obligatoires manquent peut-être (questionnaire de risque détaillé, information sur les frais). La liste de l'onglet Cadrage est un point de départ, pas un avis juridique.
- Les points sont-ils les bons pour vos missions ? Chaque point est une ligne de `structurationParcours.mjs`, facile à retirer ou ajouter.
- Une simulation chiffrée IR / IS / holding / démembrement (comparaison de fiscalité et de transmission) n'existe pas : c'est la vraie suite, à cadrer ensemble.
