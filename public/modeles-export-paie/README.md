# Modèles d'export paie — Profero Rénovation

Ce dossier contient **3 modèles d'export** des heures des salariés vers la paie,
avec des données d'exemple (juillet 2026, l'équipe réelle). Objectif : les montrer
au comptable pour choisir **le** format à implémenter dans la page « Heures des
salariés » (Partie 3).

- `export-generique.csv` — tableau lisible, 1 ligne par salarié. À ouvrir dans Excel.
- `export-silae.csv` — éléments variables au format Silae (1 ligne par variable).
- `export-sage.csv` — événements/rubriques au format Sage Paie.

> ⚠️ Les **codes** de rubriques/variables (colonnes « Code ») sont propres à
> **votre dossier** chez l'éditeur de paie. Ceux utilisés ici sont représentatifs
> mais **doivent être confirmés par le comptable** (il les lit dans le paramétrage
> Silae/Sage). La **structure** des colonnes, elle, est la bonne.

---

## 1. Règle des heures supplémentaires — base 39 h

Le contrat est à **39 h/semaine**. Les heures se comptent **à la semaine civile**
(lundi → dimanche), pas au mois. Les seuils légaux de majoration sont les mêmes
quelle que soit la base contractuelle :

| Tranche hebdo         | Traitement                    | Dans l'export |
|-----------------------|-------------------------------|---------------|
| 0 → 35 h              | Heures normales               | `HN`          |
| 35 → 43 h (8 h max)   | Heures sup **+25 %**          | `HS 25%`      |
| au-delà de 43 h       | Heures sup **+50 %**          | `HS 50%`      |

Comme le contrat est à 39 h, **les 4 heures structurelles (35 → 39) sont toujours
des HS à 25 %**, payées chaque semaine même sans dépassement. Une semaine « normale »
de 39 h donne donc : **35 HN + 4 HS 25 %**.

Exemples (une semaine) :
- 39 h → 35 HN + 4 HS25
- 43 h → 35 HN + 8 HS25
- 45 h → 35 HN + 8 HS25 + 2 HS50
- 32 h (jour d'absence) → 32 HN (pas de HS)

Le **total mensuel** empile les semaines. Formules retenues, par semaine :
- `HN     = min(heures ; 35)`
- `HS 25% = max(0 ; min(heures ; 43) − 35)`
- `HS 50% = max(0 ; heures − 43)`

> 🔧 **Choix à confirmer** : certains dossiers préfèrent afficher « heures normales
> = 39 » et ne sortir en HS que le dépassement au-delà de 39 h (les 35→39 étant
> déjà mensualisées dans le salaire de base à 169 h). Les deux conventions donnent
> la même paie ; ça change seulement **quelles colonnes** on remplit. Les exemples
> ci-joints suivent la convention légale (HN = 35, HS25 dès 35 h). Dites-moi laquelle
> veut le comptable.

---

## 2. Modèle des absences — **proposition à valider**

Vous ne savez pas encore : voici un modèle **standard BTP** comme base de discussion.
Chaque absence pose un motif sur une case vide et distingue « 0 h car absent » de
« 0 h car CR non validé ».

| Motif                          | Code proposé | Unité   | Payé par la paie ? | Remarque |
|--------------------------------|--------------|---------|--------------------|----------|
| Congés payés                   | `CP`         | jours   | **Non → caisse CIBTP** | Les CP du BTP passent par la caisse (CIBTP). Ne PAS convertir en heures payées sans accord comptable. |
| RTT                            | `RTT`        | jours   | Oui                | Si accord RTT en place. |
| Maladie (arrêt)                | `MAL`        | heures/jours | Partiel (IJSS + maintien) | Nécessite l'arrêt ; le calcul du maintien est fait par la paie. |
| Accident du travail            | `AT`         | heures/jours | Partiel            | Déclaration AT séparée. |
| Jour férié chômé               | `FER`        | jours   | Oui (maintien)     | |
| Intempéries (chômage BTP)      | `INT`        | heures  | **Régime intempéries BTP** | Spécifique BTP, indemnisé via la caisse. |
| Événement familial             | `EVF`        | jours   | Oui                | Mariage, naissance, décès… (barème conventionnel). |
| Congé sans solde               | `CSS`        | jours   | Non                | |
| Absence injustifiée            | `ABI`        | heures  | Non (retenue)      | |

Points clés à trancher avec le comptable :
1. **CP et intempéries** partent-ils en caisse (CIBTP) et doivent-ils apparaître à
   l'export en information seule, ou pas du tout ?
2. Absences saisies en **heures** ou en **jours** (le BTP mélange souvent : CP en
   jours, intempéries en heures) ?
3. Quels motifs sont **payés** (à sortir comme rubrique) vs **non payés** (retenue) ?

Une fois ces réponses connues, je crée la table `absences` et l'export final.

---

## 3. Points à confirmer avant implémentation

1. **Quel format** parmi les 3 (ou une variante précise demandée par l'éditeur) ?
2. **Codes** exacts des rubriques/variables (Silae ou Sage) depuis votre dossier.
3. **Convention HN** : heures normales = 35 h (légale) ou 39 h (contractuelle) ?
4. **Matricules** des salariés (les exports paie s'appuient dessus, pas sur le nom).
   Aujourd'hui la page joint par nom : il faudra une correspondance nom → matricule.
5. **Modèle d'absences** validé (cf. §2).
