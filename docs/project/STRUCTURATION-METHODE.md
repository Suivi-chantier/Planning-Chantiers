# Structuration patrimoniale : la méthode des professionnels, et ce que la page en fait

Rédigé le 02/10/2026. Écrit pour Matthieu et l'équipe Profero Invest, sans jargon de code.

## Ce qui a été consulté

Recherche en ligne le 02/10/2026 sur la pratique des conseillers en gestion de patrimoine (CGP / CIF) :

- la démarche de conseil en sept étapes : recueil d'informations, analyse et diagnostic, conception de la stratégie (ingénierie patrimoniale), présentation et explications, mise en œuvre, suivi et contrôle, adaptation aux évolutions ;
- les documents qu'un conseiller doit pouvoir produire, datés et signés : document d'entrée en relation (DER), lettre de mission, questionnaire de connaissance du client, déclaration / rapport d'adéquation, information sur les frais ;
- les leviers de structuration immobilière les plus courants : SCI à l'IR ou à l'IS, holding, démembrement, donation de parts avec décote d'illiquidité, pacte Dutreil, toujours en coordination avec le notaire, l'expert-comptable et l'avocat fiscaliste.

Sources : gestion-de-patrimoine-du-chef-d-entreprise.com (démarche en sept étapes), garonne-patrimoine.com (documents obligatoires), cgpp.fr (lettre de mission), noun-partners.com et odincapital.fr (holding / SCI), hr-associes.fr (démembrement). Ce sont des sites de cabinets, pas des textes de loi : ils décrivent la pratique, ils ne remplacent ni un juriste ni la réglementation de l'AMF et de l'ORIAS. Profero n'étant pas soumis à cette réglementation, le parcours est une référence de métier, pas une grille de conformité.

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

- Profero n'est pas soumis à la réglementation des conseillers en investissements financiers (confirmé par Matthieu le 02/10/2026). Les points de l'onglet Cadrage sont donc des bonnes pratiques de métier, pas des obligations : ils protègent le client et Profero, et peuvent être allégés. Le questionnaire de risque détaillé et l'information sur les frais ne sont pas ajoutés.
- Les points sont-ils les bons pour vos missions ? Chaque point est une ligne de `structurationParcours.mjs`, facile à retirer ou ajouter.
- Une simulation chiffrée IR / IS / holding / démembrement (comparaison de fiscalité et de transmission) n'existe pas : c'est la vraie suite, à cadrer ensemble.

## Comparaison des structures (lot 4) : règles fiscales et leur statut

Code : `src/Invest/structurationStructures.mjs`, tests : `scripts/verif-structuration-structures.mjs`. L'en-tête du module reprend cette liste.

**Retenues, vérifiées le 02/10/2026 sur des sites en ligne (cabinets, avocats, notaires), pas sur les textes officiels :** barème de l'impôt sur le revenu 2026 (lu à travers la tranche marginale saisie) ; prélèvements sociaux 17,2 % sur revenus fonciers, meublés et plus-values immobilières ; flat tax 31,4 % depuis janvier 2026 (12,8 + 18,6) sur les dividendes ; impôt sur les sociétés 15 % jusqu'à 42 500 € puis 25 % ; plus-value de SCI à l'IS sur la valeur nette comptable, sans abattement de durée ; plus-value des particuliers 19 % + 17,2 % avec abattements de durée (exonération d'impôt sur le revenu à 22 ans, de prélèvements sociaux à 30 ans) ; micro-BIC 50 % jusqu'à 77 700 € ; réintégration des amortissements du meublé au réel dans la plus-value (cessions depuis le 15/02/2025).

**Retenues, confirmées par la vérification que Matthieu a fournie (impots.gouv.fr, Bofip, service-public.fr, Cour de cassation) :** micro-foncier 30 % jusqu'à 15 000 € ; déficit foncier imputable sur le revenu global jusqu'à 10 700 € par an (hors intérêts d'emprunt, le reste reportable 10 ans) ; loueur meublé professionnel au-delà de 23 000 € de recettes ET plus que les autres revenus professionnels ; donation 100 000 € par parent et par enfant tous les 15 ans.

**Écartée :** la décote de 15 à 25 % sur les parts de SCI. Il n'existe pas de taux légal ; elle se justifie au cas par cas. Elle n'est pas dans le code, et un test le vérifie.

**Hypothèses de modélisation, modifiables à l'écran :** frais d'acquisition 7,5 %, terrain non amortissable 15 %, amortissement linéaire sur 30 ans (les composants réels amortissent plus vite), pas de forfait travaux de 15 % sur la plus-value, frais annuels de comptabilité (SCI à l'IR 600 €, meublé réel 600 €, SCI à l'IS 1 500 €), création de société 1 500 €.

**Non modélisé, signalé à l'écran :** quotient familial, surtaxe sur plus-values élevées, IFI, dispositifs particuliers (Pinel, Denormandie, Malraux, monuments historiques), CFE, TVA, transmission.
