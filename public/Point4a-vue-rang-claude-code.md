# Point 4 (a) — Vue « Rang » : l'ordre logique déduit des prédécesseurs — Prompts pour Claude Code

## Brief de reprise (à lire en premier sur un nouveau chat)

**L'appli.** Application interne d'une entreprise de rénovation (React + Supabase). Code modifié via **Claude Code**.

**Le but.** Ajouter au Phasage V2 une **cinquième vue, « Rang »**, à côté de Liste / Chronologique / Gantt / Prévisionnel. Elle applique la **méthode des rangs** : chaque tâche a un ou plusieurs **prédécesseurs**, et l'appli en déduit son **rang** — c'est-à-dire l'ordre logique d'exécution, et surtout **ce qui peut se faire en parallèle** (même rang).

**Ce document est autonome** : il ne dépend ni de l'Opération ni du Chemin de fer (voir *Point 4 b*).

## Les décisions prises (à respecter)

### Les prédécesseurs sont au niveau de la TÂCHE
Maille fine assumée. **Mais on ne saisit jamais 40 liens à la main** : le chaînage par défaut est **déduit de ce qui existe déjà**.

| Le chaînage par défaut (gratuit, calculé) | Ce qu'on édite (par exception seulement) |
|---|---|
| Dans un groupe : une tâche suit **celle qui la précède** dans `chrono_ordre`. | Les tâches réellement **parallèles** (même prédécesseur). |
| Première tâche d'un groupe : suit la **dernière tâche du groupe précédent** (ordre des groupes). | Les liens qui **sautent d'un groupe à l'autre**. |

➡️ Vos groupes ordonnés + `chrono_ordre` fournissent donc un **graphe de dépendances complet sans aucune saisie**. Le champ `predecesseurs` ne sert qu'à enregistrer les **écarts** au chaînage par défaut.

### Qui gagne, le manuel ou le déduit ?
**L'ordre manuel reste ce qui est stocké.** `chrono_ordre` (le glisser-déposer de la vue Chronologique) est la **source de vérité de l'ordre**. La vue Rang :
- **calcule** les rangs à partir des prédécesseurs,
- **propose** un réordonnancement (bouton, jamais automatique),
- **signale les incohérences** : une tâche placée avant son prédécesseur, un cycle de dépendances.

C'est exactement l'arbitrage « déclaré > déduit » déjà utilisé dans la frise du CRM Invest et pour les équipes par défaut : **proposé, jamais imposé**.

### Piste pour plus tard (ne pas faire maintenant)
Les enchaînements **internes à un ouvrage** sont toujours les mêmes (installation électrique : repérage → câbles → boîtes → tableau → appareillage → essai). Les stocker **une fois dans la bibliothèque d'ouvrages types**, à côté des sous-tâches et des cadences, les rendrait **pré-remplis à chaque import de devis**. À garder en tête, mais **hors périmètre** de ce document.

## Vocabulaire (à ne JAMAIS confondre)
- **Phases (V1)** = Phasage V1 legacy (`plan_travaux[phase_id]`). **Intouchable**, et le mot « phase » ne se réutilise pas.
- **Lots** = axe devis (les 8 lots).
- **Groupes** = étapes d'exécution d'un chantier (`meta.chrono_groupes`, avec `groupe_type_id`), ordonnées.
- **Groupes types** = référentiel global (Admin).
- **Rang** = **nouveau**, calculé : position dans l'ordre logique déduit des prédécesseurs. Ce n'est **pas** `chrono_ordre` (qui est l'ordre manuel dans un groupe).
- **Prédécesseur** = **nouveau champ** sur la tâche : les tâches qui doivent être finies avant elle.

## Piège technique à connaître (dit par le code lui-même)
`saveMeta` **relit la base avant d'écrire** et n'est **pas** debouncé : **deux appels dans le même tick se perdent mutuellement un patch**. C'est pour ça qu'il existe `setChronoGroupesEtJalons` (écriture combinée). Si tu dois écrire deux clés de `meta` en même temps, fais-le en **un seul appel**.

Pour les tâches, utilise les mécanismes existants : `updateTache` (une tâche), `patchTaches` (patch libre par tâche, en un passage), `applyChrono` (groupe + ordre en un passage). **Ne crée pas un second chemin d'écriture.**

## Comment utiliser ce document
- **Un prompt à la fois.** Colle, laisse travailler, **teste**, **commit**, puis le suivant.
- **Commence par le Prompt 0** (audit, sans modification) et **lis sa réponse** avant d'enchaîner.
- À chaque étape, l'appli doit rester fonctionnelle.

---

## Prompt 0 — Audit (aucune modification de code)

```
Avant toute modification, lis le code et fais-moi un état des lieux écrit, sans rien changer.

Contexte : je veux ajouter au Phasage V2 une 5e vue « Rang » qui applique la méthode des rangs. Chaque tâche
aura des prédécesseurs (maille tâche), mais le chaînage par défaut doit être DÉDUIT de l'existant (ordre des
groupes + chrono_ordre) pour qu'on n'ait à saisir que les exceptions.

Réponds-moi en texte, ne modifie aucun fichier :
1. PhasageV2.jsx — le système de vues : la variable viewMode, le toggle dans l'en-tête (list / chrono / gantt /
   previsionnel), et comment chaque vue est rendue. Où exactement j'ajouterais une 5e entrée.
2. L'export PDF par vue : exportRapportPDF, exportChronoPDF, exportGanttPDF, exportPrevisionnelPDF — comment le
   bouton PDF choisit l'export selon viewMode, et comment est construit un export (librairie, mise en page).
3. La forme EXACTE d'une tâche dans ouvrages[].taches[] : liste-moi tous les champs réellement présents
   (id, nom, heures_estimees, heures_vendues, avancement, ratio, ouvriers, date_prevue, chrono_groupe_id,
   chrono_ordre, externe…). Je veux savoir précisément ce qui existe avant d'ajouter un champ.
4. L'ordre : comment chrono_ordre est attribué et maintenu (glisser-déposer), comment les groupes sont ordonnés
   (meta.chrono_groupes.ordre), et comment entriesOfGroup fusionne tâches et jalons. Est-ce que chrono_ordre est
   unique par groupe ou global ?
5. Les fonctions d'écriture disponibles : updateTache, patchTaches, applyChrono, updateOuvrages, saveMeta —
   ce que fait chacune et laquelle utiliser pour écrire un champ sur plusieurs tâches en un passage.
   Confirme le piège du saveMeta non debouncé qui relit la DB avant d'écrire.
6. Est-ce qu'il existe DÉJÀ quelque part une notion de dépendance, de prédécesseur, de lien entre tâches, ou de
   durée de tâche (autre que les heures) ? Je veux être sûr de ne pas dupliquer.
7. Comment les tâches sont regroupées/lues pour l'affichage d'une vue (le sélecteur qui parcourt
   ouvrages[].taches et applique un filtre/tri), pour que ma vue Rang lise la même source.

Termine par : (a) ta reco sur la forme du champ prédécesseurs (tableau d'ids ? un seul id ?) au vu du code,
(b) les points d'attention pour rester strictement additif.
```

---

## Prompt 1 — Le chaînage par défaut (calcul pur, aucun affichage)

```
Objectif : calculer le graphe de dépendances PAR DÉFAUT à partir de l'existant, sans rien stocker et sans
toucher à l'interface.

Crée un module dédié (ex. src/Renovation/rang.js) avec des fonctions pures.

1) Chaînage par défaut, déduit de ce qui existe déjà :
   - à l'intérieur d'un groupe : le prédécesseur d'une tâche est la tâche qui la précède dans chrono_ordre ;
   - la PREMIÈRE tâche d'un groupe a pour prédécesseur la DERNIÈRE tâche du groupe précédent
     (ordre des groupes = meta.chrono_groupes.ordre) ;
   - la toute première tâche du chantier n'a pas de prédécesseur ;
   - ignore les jalons dans le chaînage (ce ne sont pas des tâches), mais ne les casse pas.
   - les tâches non classées (sans chrono_groupe_id) sont mises à part, pas chaînées de force.

2) Une fonction qui renvoie, pour chaque tâche, ses prédécesseurs EFFECTIFS :
   les prédécesseurs explicites de la tâche s'ils existent, SINON le chaînage par défaut.
   Un tableau explicite VIDE doit pouvoir signifier "aucun prédécesseur" (tâche parallèle libre) — distingue
   bien "pas renseigné" (→ défaut) de "renseigné vide" (→ vraiment aucun).

3) Aucune écriture, aucun champ ajouté à ce stade : uniquement du calcul en lecture.

Contraintes : fonctions pures, robustes aux données incomplètes (tâche sans groupe, groupe vide, ordres en
doublon). Aucune modification de l'interface ni du stockage.

Critère d'acceptation : sur un chantier réel, la fonction me renvoie un graphe de dépendances complet et
cohérent SANS qu'aucun prédécesseur n'ait été saisi ; rien n'a changé dans l'appli.
```

---

## Prompt 2 — Calcul des rangs et détection des incohérences (calcul pur)

```
Objectif : calculer les rangs par la méthode des rangs, et détecter les incohérences. Toujours sans affichage.

Dans le module du Prompt 1 :

1) Calcul des rangs (méthode des rangs / tri topologique par niveaux) :
   - rang 1 = les tâches sans prédécesseur ;
   - rang N = les tâches dont tous les prédécesseurs sont de rang < N ;
   - les tâches de MÊME rang sont celles qui peuvent se faire EN PARALLÈLE — c'est l'information la plus utile
     de cette vue, expose-la clairement.

2) Détection des incohérences, renvoyées explicitement (pas d'exception) :
   - CYCLE : une dépendance circulaire (A avant B avant A) → liste les tâches impliquées ;
   - ORDRE CONTRADICTOIRE : une tâche placée AVANT son prédécesseur dans l'ordre manuel
     (chrono_ordre / ordre des groupes) ;
   - PRÉDÉCESSEUR INTROUVABLE : un id qui ne correspond plus à une tâche existante (tâche supprimée) — doit
     être ignoré proprement, jamais planter.

3) Une fonction qui renvoie l'ordre PROPOSÉ (tâches triées par rang, puis par ordre manuel à rang égal).
   Elle ne modifie rien : elle propose.

Contraintes : fonctions pures. Un cycle ne doit JAMAIS provoquer de boucle infinie — borne le calcul et
renvoie l'incohérence.

Critère d'acceptation : j'obtiens les rangs de toutes les tâches d'un chantier ; les tâches parallèles
partagent le même rang ; si je crée volontairement un cycle, il est détecté et signalé sans plantage.
```

---

## Prompt 3 — La vue « Rang » (affichage)

```
Objectif : ajouter la 5e vue « Rang » dans le Phasage, en lecture, en consommant les modules des Prompts 1 et 2.

- Ajoute une entrée « Rang » au toggle de vues de l'en-tête (à côté de Liste / Chronologique / Gantt /
  Prévisionnel), avec une icône cohérente avec les autres.
- Affiche les tâches regroupées PAR RANG : une colonne (ou une bande) par rang, contenant les tâches de ce
  rang. Le message doit être immédiat : « ces tâches-là peuvent se faire en même temps ».
- Pour chaque tâche : son nom, son groupe (avec la couleur du groupe), ses heures, et ses prédécesseurs
  effectifs. Indique visuellement quand les prédécesseurs viennent du CHAÎNAGE PAR DÉFAUT et non d'une saisie.
- Affiche en tête un bandeau d'incohérences s'il y en a (cycle, ordre contradictoire), avec les tâches
  concernées et un accès direct à chacune.
- Réutilise les composants, couleurs et le thème T des autres vues pour rester homogène.
- Ajoute l'export PDF de cette vue en suivant exactement le même patron que les exports existants
  (exportChronoPDF / exportGanttPDF) et branche-le sur le bouton PDF selon viewMode.

Contraintes : vue en LECTURE seule à ce stade (l'édition arrive au Prompt 4). Additif : ne modifie aucune autre
vue, aucun calcul d'heures, aucun export existant.

Critère d'acceptation : je bascule sur « Rang », je vois mes tâches rangées par rang avec le parallélisme
visible, sans avoir saisi le moindre prédécesseur ; l'export PDF de la vue fonctionne ; les autres vues sont
intactes.
```

---

## Prompt 4 — Éditer les exceptions (le champ `predecesseurs`)

```
Objectif : permettre de renseigner les prédécesseurs là où ils s'écartent du chaînage par défaut — et
seulement là.

- Ajoute le champ predecesseurs sur la tâche (forme validée au Prompt 0, a priori un tableau d'ids de tâches).
  Règle IMPORTANTE : champ absent/null = "utiliser le chaînage par défaut" ; tableau vide = "aucun
  prédécesseur" (tâche libre). Ne renseigne JAMAIS le champ automatiquement avec le chaînage par défaut : le
  défaut doit rester calculé, pas figé en base.
- Depuis la vue Rang (et depuis l'édition d'une tâche), permets de :
  - choisir un ou plusieurs prédécesseurs parmi les tâches du chantier (recherche par nom, regroupées par
    groupe) ;
  - déclarer une tâche « parallèle » (aucun prédécesseur) en un geste ;
  - revenir au chaînage par défaut (efface le champ) en un geste.
- Actions groupées, pour éviter la saisie fastidieuse :
  - sélectionner plusieurs tâches et leur donner LE MÊME prédécesseur (= les rendre parallèles entre elles) ;
  - chaîner une sélection dans l'ordre.
- Écris via patchTaches (un seul passage), jamais tâche par tâche en boucle.
- Empêche de créer un cycle : si la saisie en produirait un, refuse-la avec un message clair indiquant la
  boucle.

Contraintes : additif ; ne touche pas à chrono_ordre ; ne modifie pas le comportement du glisser-déposer de la
Chrono ; une tâche sans predecesseurs doit se comporter exactement comme avant ce prompt.

Critère d'acceptation : je marque 3 tâches comme parallèles en une action, le rang se recalcule aussitôt ; je
reviens au défaut en un clic ; une tentative de cycle est bloquée avec un message compréhensible.
```

---

## Prompt 5 — Proposer le réordonnancement (l'arbitrage manuel / déduit)

```
Objectif : la vue Rang PROPOSE un ordre cohérent, elle ne l'impose jamais.

- Quand l'ordre manuel (chrono_ordre / ordre des groupes) contredit les rangs, affiche-le clairement et propose
  un bouton « Réordonner selon les rangs ».
- Ce bouton montre D'ABORD un aperçu de ce qui va changer (quelles tâches se déplacent, et où), puis demande
  confirmation. Rien ne bouge sans validation explicite.
- À la validation, écris le nouvel ordre via applyChrono (le mécanisme existant), en un seul passage. L'ordre
  manuel reste donc la source de vérité — on l'a juste mis à jour volontairement.
- Ne déplace jamais une tâche d'un groupe à un autre : le réordonnancement se fait À L'INTÉRIEUR des groupes,
  et l'ordre des groupes n'est pas modifié par cette action.
- Après réordonnancement, vérifie que la vue Chronologique et le Gantt reflètent bien le nouvel ordre (source
  unique) : ils lisent les mêmes champs, ne duplique rien.

Contraintes : jamais de réordonnancement automatique ni silencieux. Aucune modification des dates
(date_prevue) : ce prompt ne touche QUE l'ordre.

Critère d'acceptation : je vois qu'une tâche est mal placée par rapport à son prédécesseur, je clique
« Réordonner », je vois l'aperçu, je confirme — la Chrono et le Gantt affichent le nouvel ordre, et aucune date
n'a changé.
```

---

## Récapitulatif de l'ordre
0. Audit (lecture seule) → 1. Chaînage par défaut (calcul) → 2. Rangs + incohérences (calcul) → 3. Vue Rang en lecture + export PDF → 4. Édition des exceptions (`predecesseurs`) → 5. Proposition de réordonnancement.

## Invariants à toutes les étapes
- Le **chaînage par défaut reste CALCULÉ**, jamais figé en base : le champ `predecesseurs` n'enregistre que les **écarts**.
- **`chrono_ordre` reste la source de vérité de l'ordre.** La vue Rang propose, elle n'impose pas.
- Le **V1 (phases)**, les **lots**, l'**import de devis**, les **autres vues** et leurs **exports** ne sont pas impactés.
- Écriture par les mécanismes existants (`patchTaches`, `applyChrono`) — **pas de second chemin**.
- Un **cycle** ne doit jamais boucler à l'infini ni planter.
- Chaque étape est **strictement additive** : on **teste** puis on **commit** avant la suivante.
