# Refonte « heures réelles → registre de pointage » — Prompts pour Claude Code

## Brief de reprise (à lire en premier sur un nouveau compte / nouveau chat)

**L'appli.** Application interne d'une entreprise de rénovation (React + Supabase), destinée à devenir l'outil unique de la boîte. Le code est modifié via **Claude Code** — pas à la main dans le chat. Modules existants : planning hebdo, phasage / plan de travail, comptes rendus de fin de journée saisis par les ouvriers sur mobile, fiches chantiers, commandes, bilan d'équipe.

**Le problème de départ.** Dans le plan de travail, chaque tâche n'a qu'un seul champ `heures_reelles`, et le coût main d'œuvre est calculé avec le taux du **premier ouvrier** seulement (`ouvriers[0]`). Impossible donc de représenter « 2 ouvriers lundi, 1 mardi », et le coût est faux dès que deux ouvriers ont des taux différents.

**La cible.** Remplacer le champ unique par un **registre de pointage** : une liste d'écritures (ouvrier + tâche + date + heures). Le coût d'une tâche n'est plus saisi, il est **dérivé** = somme des écritures × le taux de chaque ouvrier. Les comptes rendus de fin de journée, une fois **validés** par le conducteur, sont ce qui crée ces écritures.

**Décisions déjà prises (à respecter) :**
- File de validation de fin de journée organisée **par ouvrier** (un compte rendu = la journée d'un ouvrier).
- La validation devient **obligatoire** : un compte rendu reste « en attente » tant que le conducteur ne l'a pas validé.
- Le conducteur peut **corriger avant de valider** (réaffecter des heures à la bonne tâche, ajuster, splitter, gérer les tâches libres).
- **On garde les heures, on dérive le coût** (l'heure reste la donnée saisie ; le coût est calculé par-dessus). Le taux est **figé** au moment de la validation (un changement de taux ultérieur ne réécrit pas l'historique).
- **Avancement** : l'ouvrier continue de le déclarer (c'est une *proposition*) ; le conducteur l'**arbitre** et valide la valeur de la tâche. On conserve **les deux** (déclaré + validé). Le champ « validé » est **pré-rempli** avec le déclaré. **Garde-fou anti-régression** : on ne baisse jamais un avancement automatiquement. Si plusieurs ouvriers pointent la même tâche le même jour, on affiche leurs propositions côte à côte et le conducteur tranche une seule fois.

**Pas encore traité (prompt futur) :** la contradiction possible entre le statut « faite » coché par l'ouvrier et le % d'avancement (ex. « terminée » mais 80 %).

**Si tu veux re-discuter la conception en chat (pas juste exécuter) :** recrée un Projet et **uploade les fichiers du code** dans la base de connaissances du projet, pour que le chat puisse « voir » le dépôt comme dans la session d'origine.

---

## Comment utiliser ce document
- **Un prompt à la fois.** Colle le prompt, laisse Claude Code travailler, **teste**, puis **commit** avant de passer au suivant. Ne lui donne pas tout d'un bloc.
- **Commence impérativement par le Prompt 0** (audit, sans modification) et **lis sa réponse** avant de lancer le Prompt 1 : il peut révéler des détails de ton code qui changent l'ordre des étapes.
- **Prompts 0 à 5 + 8 à 9 = le cœur de ta demande.** Les **Prompts 6 et 7 sont des ajouts que je t'ai suggérés** (clôture/garde-fous, heures indirectes) — garde-les ou jette-les selon ce que tu veux dans le périmètre.
- Le lien **statut « faite » vs % d'avancement** (quand ils se contredisent) n'est volontairement **pas** traité ici — on l'avait mis de côté. Ce sera un prompt à part quand tu auras calé le reste.

---

## L'idée en une phrase (à garder en tête)
On remplace le **champ unique** `heures_reelles` (qui ne sait gérer qu'un ouvrier et écrase la valeur) par un **registre de pointage** : une liste d'écritures (ouvrier + tâche + date + heures), où le **coût d'une tâche = somme des écritures × le taux de chaque ouvrier concerné**. La validation des comptes rendus de fin de journée est ce qui crée ces écritures.

---

## Prompt 0 — Audit (aucune modification de code)

```
Avant toute modification, lis le code et fais-moi un état des lieux écrit, sans rien changer.

Contexte métier : je veux refondre la gestion des heures réelles. Aujourd'hui chaque tâche du plan de travail (phasages.plan_travaux, un JSON organisé par phase) a un seul champ heures_reelles, et le coût main d'œuvre est calculé avec le taux du PREMIER ouvrier (ouvriers[0]) seulement. Je veux passer à un registre de pointage : une liste d'écritures (un ouvrier + une tâche + une date + un nombre d'heures), où le coût d'une tâche = somme des écritures × le taux de CHAQUE ouvrier concerné.

Fais-moi, sans modifier de fichier :
1. La liste de TOUS les endroits qui lisent ou écrivent heures_reelles, et de tous ceux qui calculent un coût MO avec ouvriers[0] et les taux horaires (regarde au moins Phasage.jsx, PageChantiers.jsx, Equipe.jsx, api/generate-docx.js — et vérifie s'il y en a d'autres).
2. La structure réelle des tables Supabase concernées : phasages (plan_travaux), rapports, planning_cells, et la config des taux horaires. Donne les champs exacts.
3. Comment une ligne de compte rendu (rapports.taches[]) est aujourd'hui reliée — ou non — à une tâche du plan_travaux.
4. Un plan de migration en étapes, qui garde l'appli fonctionnelle à chaque étape (compatibilité ascendante, aucune perte de données).

Réponds-moi en texte, ne modifie aucun fichier.
```

---

## Prompt 1 — Lien stable entre une tâche et ses pointages

```
Objectif : établir un identifiant stable entre une tâche du plan de travail et les lignes de compte rendu. Aujourd'hui le lien se fait par correspondance de texte, ce qui est fragile.

- Quand une tâche du plan (plan_travaux, son champ id) est planifiée (executerPlanification dans Phasage.jsx), propage son id et son phase_id dans planning_cells.taches[] : ajoute des champs tache_id et phase_id, en plus du champ text actuel.
- Dans RapportMobile.jsx (loadTaches), reporte ce tache_id et ce phase_id sur chaque ligne de compte rendu créée, et sauvegarde-les dans rapports.taches[].
- Garde un repli : si tache_id est absent (anciennes données ou tâche libre), continue de fonctionner comme aujourd'hui (matching par texte + chantier_id).

Contraintes : strictement additif. Ne casse ni les comptes rendus déjà soumis, ni le planning existant.

Critère d'acceptation : un nouveau compte rendu soumis depuis le mobile contient, pour chaque tâche issue du planning, le tache_id de la tâche correspondante du plan de travail.
```

---

## Prompt 2 — Le registre de pointage (modèle de données)

```
Crée le registre de pointage, SANS encore retirer le champ heures_reelles existant (on garde un double modèle temporaire).

- Crée une table Supabase "pointages" avec au minimum : id, chantier_id, phasage_id, phase_id, tache_id, ouvrier, date (date du travail réel), heures (numérique), taux_horaire (le taux de l'ouvrier FIGÉ au moment de la validation), rapport_id (le compte rendu source), avancement_declare (le % déclaré par l'ouvrier, pour info), valide_par, created_at.
- Le coût d'une écriture = heures × taux_horaire figé. Important : le coût ne doit PAS être recalculé si le taux de l'ouvrier change plus tard.
- Ajoute des fonctions utilitaires pour calculer, à partir des pointages : le total d'heures réelles et le coût MO réel (somme heures × taux figé) au niveau d'une tâche, d'une phase, et d'un chantier.

Contraintes : ne modifie aucun écran existant à cette étape. On ne fait qu'ajouter la table et les helpers. Donne-moi le SQL de création de la table.

Critère d'acceptation : je peux insérer une écriture de test et récupérer le total heures + coût d'une tâche via les helpers.
```

---

## Prompt 3 — Page « Validation de fin de journée » (squelette, par ouvrier)

```
Crée une nouvelle page "Validation de fin de journée".

- Elle liste les comptes rendus (table rapports) pour une date choisie (par défaut aujourd'hui), groupés PAR OUVRIER : un compte rendu = la journée d'un ouvrier.
- Ajoute un statut de validation sur les rapports : par défaut "en_attente". Un rapport reste en attente tant que je ne l'ai pas validé — la validation devient obligatoire. Ajoute la colonne si nécessaire (avec un repli si elle est absente).
- Je peux ouvrir un compte rendu et voir ses tâches : intitulé, heures déclarées, statut (faite / en cours / pas faite), avancement déclaré, remarque, photos.
- Bouton "Valider" : pour chaque tâche du compte rendu, crée une écriture dans pointages (avec le taux figé de l'ouvrier, lu depuis les taux horaires), puis passe le rapport en statut "valide". À ce stade, on valide tel quel, sans correction.

Contraintes : ne touche pas encore au plan de travail ni aux écrans de coût existants. Évite tout double comptage : si je revalide un rapport déjà validé, ne recrée pas d'écritures.

Critère d'acceptation : après validation d'un compte rendu, les écritures correspondantes existent dans pointages et le rapport est marqué validé ; les totaux heures/coût des helpers du Prompt 2 reflètent ces écritures.
```

---

## Prompt 4 — Correction avant validation

```
Sur la page de validation, ajoute la possibilité de corriger un compte rendu AVANT de le valider :

- Réaffecter une ligne à la bonne tâche du plan de travail (changer son tache_id) quand l'ouvrier s'est trompé de tâche.
- Modifier le nombre d'heures d'une ligne, et "splitter" une ligne en plusieurs (ex : 8h → 5h sur tâche A + 3h sur tâche B).
- Gérer les "tâches libres" (lignes sans tache_id, ajoutées par l'ouvrier) : soit les rattacher à une tâche existante du plan, soit créer une nouvelle tâche dans le plan_travaux du chantier et y rattacher les heures.

Les écritures pointages créées à la validation doivent refléter ces corrections.

Contraintes : ne modifie pas de façon destructive le compte rendu d'origine de l'ouvrier. Garde une trace de ce qu'il avait déclaré — les corrections sont les miennes, pas les siennes.

Critère d'acceptation : je peux réaffecter / splitter des heures et créer une tâche manquante depuis l'écran de validation, et les écritures pointages tombent sur les bonnes tâches.
```

---

## Prompt 5 — Avancement arbitré

```
Sur l'écran de validation, gère l'avancement comme un arbitrage (l'ouvrier propose, je tranche) :

- Pour chaque tâche concernée, affiche l'avancement DÉCLARÉ par l'ouvrier ET l'avancement ACTUEL de la tâche dans le plan. Pré-remplis mon champ "avancement validé" avec la valeur déclarée par l'ouvrier.
- Quand je valide, écris l'avancement validé sur la tâche du plan_travaux (champ avancement). Conserve l'avancement déclaré (déjà stocké dans pointages.avancement_declare) pour la traçabilité — ne l'écrase pas.
- Garde-fou régression : si la valeur que je m'apprête à enregistrer est INFÉRIEURE à l'avancement actuel de la tâche, signale-le visuellement et demande confirmation avant de baisser. Ne baisse jamais automatiquement.
- Si plusieurs ouvriers ont pointé la même tâche le même jour, affiche leurs propositions côte à côte (ex : "Marc 50% · Paul 60%") et laisse-moi poser une seule valeur validée pour la tâche.

Critère d'acceptation : valider un compte rendu met à jour l'avancement de la tâche avec MA valeur ; une régression est signalée et demande confirmation ; les avancements déclarés restent consultables.
```

---

## Prompt 6 — Cohérence + clôture de journée *(ajout suggéré, optionnel)*

```
Ajoute des garde-fous et la clôture de journée sur la page de validation :

- Alertes non bloquantes : total d'heures d'un ouvrier > 10h sur la journée ; ouvrier ayant pointé mais non planifié ce jour-là (croise avec planning_cells.ouvriers) ; tâche pointée alors qu'elle est déjà à 100%.
- Statut de journée (par chantier ou global) : une fois tous les comptes rendus du jour validés, je peux "clôturer" la journée (verrouillage). Une journée clôturée peut être rouverte, mais la réouverture doit être tracée (qui, quand).

Critère d'acceptation : les alertes s'affichent dans les bons cas ; je peux clôturer puis rouvrir une journée, et la réouverture est tracée.
```

---

## Prompt 7 — Heures indirectes *(ajout suggéré, optionnel)*

```
Ajoute la notion d'heures indirectes (non productives) : trajet, intempéries, nettoyage, SAV, etc.

- Permets, à la validation, d'enregistrer des heures d'un ouvrier qui ne tombent sur aucune tâche vendue, rattachées au chantier (ou à une catégorie "indirect" générale), avec un motif.
- Ces heures comptent dans le coût main d'œuvre du chantier, mais ne s'imputent ni sur l'avancement ni sur une tâche vendue précise.
- Idéalement, propose aussi côté RapportMobile une façon simple pour l'ouvrier de déclarer ce type d'heures ; l'essentiel reste que je puisse les saisir / valider côté conducteur.

Critère d'acceptation : je peux enregistrer des heures indirectes ; elles apparaissent dans le coût MO du chantier sans fausser la rentabilité par tâche.
```

---

## Prompt 8 — Bascule de l'affichage du plan de travail

```
Bascule l'affichage du plan de travail (Phasage.jsx, écran PlanTravaux) pour qu'il lise le registre de pointage au lieu du champ heures_reelles :

- Par tâche : affiche "heures vendues" face à "heures réelles cumulées" (somme des pointages) et le coût MO réel (somme heures × taux figé). Le champ heures réelles n'est plus saisissable à la main — il est dérivé du registre.
- Idem pour les totaux par phase et le bandeau coût/marge global du chantier : remplace le calcul actuel (heures_reelles × taux de ouvriers[0]) par la somme des coûts du registre.

Contraintes : garde un repli pour les tâches qui n'ont pas encore de pointages mais possèdent une ancienne valeur heures_reelles, le temps de la migration (Prompt 9).

Critère d'acceptation : le coût MO d'une tâche / d'un chantier reflète la somme des pointages, ouvrier par ouvrier avec leurs taux respectifs ; éditer manuellement les heures réelles n'est plus possible.
```

---

## Prompt 9 — Cohérence aval + migration des données existantes

```
Dernière étape : aligne tout le reste sur le registre et migre l'existant.

- Mets à jour PageChantiers.jsx (finances), Equipe.jsx (bilan hebdo) et api/generate-docx.js pour qu'ils calculent le coût et les heures réelles à partir des pointages, et non plus de heures_reelles × ouvriers[0].
- Migration : pour les tâches qui ont aujourd'hui un heures_reelles > 0 mais aucun pointage, crée des écritures "legacy" équivalentes (au mieux : les heures sur la tâche, ouvrier = ouvriers[0] de la tâche, taux = taux actuel, date = date_prevue ou date du jour, marquées comme "legacy"). Si tu vois une meilleure stratégie, propose-la-moi avant d'agir — mais ne perds pas l'historique de coût.
- Une fois la migration validée et l'appli stable, indique-moi ce qu'on peut retirer proprement (le champ heures_reelles éditable et les calculs basés sur ouvriers[0]) sans rien casser.

Critère d'acceptation : plus aucun écran ne calcule le coût MO via ouvriers[0] × heures_reelles ; les chantiers existants gardent un coût cohérent après migration.
```

---

## Récapitulatif de l'ordre
0. Audit (lecture seule) → 1. Lien stable tâche↔pointage → 2. Table + helpers du registre → 3. Page de validation (par ouvrier) → 4. Correction avant validation → 5. Avancement arbitré → *(6. Clôture/garde-fous · 7. Heures indirectes — optionnels)* → 8. Affichage du plan dérivé du registre → 9. Cohérence aval + migration.
