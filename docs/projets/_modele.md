# Projet : <nom du projet>

Copier ce fichier en `docs/projets/<nom>.md`, remplir les sections de Loris,
puis demander à Claude de mener le projet. Règles complètes : `CLAUDE.md`,
section « Projets longs : travail en autonomie ».

---

<!-- Sections de Loris : Claude ne les modifie jamais. -->

## Objectif métier

Ce que le projet doit changer pour les conducteurs, les ouvriers ou la
direction, en quelques phrases, sans parler de technique.

## Règles et invariants

Ce qui doit rester vrai quoi qu'il arrive : calculs à ne pas changer, chiffres
qui doivent rester identiques, comportements à garder.

## Hors périmètre

Ce que le projet ne doit pas toucher, même si ça paraît lié ou utile.

## Description des étapes

Les grandes étapes dans l'ordre souhaité, avec ce qu'on doit pouvoir faire ou
voir à la fin de chacune. Claude les découpe ensuite en tâches.

## Validation automatique

Ce que Claude peut mettre en ligne seul et ce qui doit attendre l'accord de
Loris. Laisser vide pour appliquer la règle par défaut de `CLAUDE.md` (contrôles
verts, migrations purement additives vérifiées, écart financier ≤ 500 € et ≤ 2 points de
marge par chantier). Les arrêts obligatoires de `CLAUDE.md` s'appliquent
toujours.

---

<!-- Sections de Claude : mises à jour après chaque tâche et avant tout arrêt. -->

## Tâches

Une ligne par tâche, une tâche = une demande de fusion qui fonctionne seule.
Statuts : à faire, en cours, en attente de Loris, en ligne, bloquée, abandonnée.

| N° | Tâche | Statut | Validation | Preuve de réussite | Demande de fusion |
|----|-------|--------|------------|--------------------|-------------------|

## Journal des décisions

Chaque modification du plan avec sa raison, chaque question posée à Loris et
sa réponse, datées.

## Comptes rendus

Un compte rendu par tâche terminée ou arrêtée : ce qui a changé, tableau avant /
après des chiffres financiers sur les vrais chantiers, et à l'arrêt la question
posée à Loris avec les éléments pour décider. Synthèse finale du projet en
dernier.
