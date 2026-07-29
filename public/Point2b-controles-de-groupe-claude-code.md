# Point 2 (b) — Contrôles de fin de groupe (refonte des visites) — Prompts pour Claude Code

## Brief de reprise (à lire en premier sur un nouveau chat)

**L'appli.** Application interne d'une entreprise de rénovation (React + Supabase). Code modifié via **Claude Code**.

**Le problème.** Le module actuel **Visite chantier** n'est **plus utilisé** par le conducteur de travaux. Trois raisons, dans l'ordre d'importance :
1. **trop long / fastidieux** : il faut passer sur chaque tâche pour dire « validé » ;
2. **redondant avec le phasage** : on redéroule une liste parallèle ;
3. **pas pratique sur le terrain** (mobile).

Ce qui est audité n'est **pas** en cause — c'est **la façon de le remplir** qui ne va pas. On ne refait donc pas *quoi* contrôler, on refait *comment*.

**La solution retenue.** Remplacer la grosse visite « tout le chantier » par un **contrôle de fin de groupe** :

> À la fin de chaque **groupe** d'exécution du chantier, un **jalon de contrôle** est créé **automatiquement**. Ce jalon est une **visite de contrôle limitée au périmètre de ce seul groupe**.

Pourquoi ça règle les trois griefs : le périmètre est **court** (un groupe), il n'y a **plus de redondance** (le contrôle lit directement les tâches du groupe dans le phasage), et le moment est **naturel** (on contrôle ce qu'on vient de finir, sur place).

**Et ça alimente la Qualité.** Le sommet **Qualité** du triangle QCD (*Point 2 a*) est nourri par ces contrôles. Le *Point 2 a* a laissé **une fonction unique isolée** qui renvoie « gris » : ce document doit la remplir.

## Les règles du contrôle de fin de groupe (décisions prises)

- **Automatique** : un jalon de contrôle est créé pour chaque groupe, sans action manuelle.
- **Obligatoire mais NON bloquant** : on peut continuer à avancer sur le chantier, **mais le groupe reste signalé en rouge tant qu'il n'a pas été contrôlé**. Aucun verrouillage.
- **Réalisé par le conducteur de travaux** (pas par les équipes).
- **Audit par exception** — le cœur de la refonte : **tout est réputé conforme par défaut**. On ne touche **que** ce qui pose problème. Sur 40 tâches dont 38 sont bonnes → **2 gestes**, pas 40.
- **Périmètre = le groupe seul** : uniquement les tâches rattachées à ce groupe (`chrono_groupe_id`), lues **directement** dans le phasage, sans copie d'une liste parallèle.
- **Mobile d'abord** : gros boutons, un geste pour signaler une réserve, photo immédiate, note courte.
- **Les jalons-repères manuels existants restent** (livraison, réception…). Ce sont **deux natures différentes** de jalons, qui cohabitent.

## Ce qui alimente la Qualité (formule cible)

Pour un chantier, à partir des contrôles réalisés :
- ⚪ **gris** : aucun groupe contrôlé → message incitatif (« ce chantier n'a pas été contrôlé »). Le gris est **volontairement incitatif** : il pousse à faire le contrôle.
- 🟢 **vert** : aucune réserve ouverte sur les groupes contrôlés.
- 🟠 **orange** : réserves ouvertes mineures (statut « réserve »).
- 🔴 **rouge** : au moins une **non-conformité (NOK)**, **ou** des **réserves anciennes non levées** d'un contrôle à l'autre.

Deux pondérations importantes :
- le **taux de conformité** = tâches non signalées ÷ tâches contrôlées (évite qu'une réserve sur 50 tâches fasse tout basculer au rouge) ;
- l'**ancienneté des réserves non levées** : une réserve fraîche est normale, une réserve qui traîne d'un contrôle à l'autre est un vrai problème. **C'est le signal le plus important.**

## Vocabulaire (à ne JAMAIS confondre)
- **Phases (V1)** = Phasage V1 legacy (`plan_travaux[phase_id]`). Intouchable.
- **Groupes** = étapes d'exécution d'un chantier (`meta.chrono_groupes`), niveau travaux. C'est le périmètre d'un contrôle.
- **Groupes types** = référentiel global des groupes (Admin).
- **Jalons** = entrées de la vue chrono (`meta.chrono_jalons`), désormais de **deux natures** : `repere` (manuel, existant : livraison, réception) et `controle` (nouveau, automatique, fin de groupe).
- **Visite (ancien module)** = `VisiteChantier.jsx`, audit tâche par tâche à l'échelle du chantier. **Ne pas casser** : les anciennes visites doivent rester consultables.
- **Contrôle de groupe** = la nouvelle notion, portée par un jalon de type `controle`.

## Décisions déjà prises (à respecter)
- **Strictement additif** : ne rien casser (V1, lots, phasage, planning, anciennes visites et leurs exports).
- Les jalons existants (sans type) doivent continuer de fonctionner **exactement** comme avant → au moment de typer les jalons, l'absence de type vaut `repere`.
- **Le contrôle lit le phasage**, il ne le duplique pas. Une réserve pointe sur une **tâche existante** (`tache_id`).
- **Non bloquant** : jamais d'empêchement d'avancer, uniquement un **signalement rouge**.
- La **Qualité** doit être exposée par **une seule fonction**, celle laissée en place par le *Point 2 (a)*.

## Comment utiliser ce document
- **Un prompt à la fois.** Colle, laisse travailler, **teste sur mobile aussi**, **commit**, puis le suivant.
- **Commence par le Prompt 0** (audit, lecture seule) et **lis sa réponse** avant d'enchaîner.
- Le *Point 2 (a)* n'est pas un prérequis strict, sauf pour le Prompt 6 (branchement de la Qualité).

---

## Prompt 0 — Audit (aucune modification de code)

```
Avant toute modification, lis le code et fais-moi un état des lieux écrit, sans rien changer.

Contexte : je veux remplacer les visites de chantier actuelles (tâche par tâche, à l'échelle du chantier, que
je n'utilise plus car trop longues) par des CONTRÔLES DE FIN DE GROUPE : à la fin de chaque groupe de la vue
chronologique, un jalon de contrôle créé automatiquement ouvre une visite limitée aux tâches de CE groupe, en
audit par exception (tout conforme par défaut, on ne pointe que les réserves).

Réponds-moi en texte, ne modifie aucun fichier :
1. Les JALONS de la vue chrono : forme exacte de meta.chrono_jalons, fonctions addJalon / setJalonDate /
   deleteJalon, comment entriesOfGroup fusionne tâches et jalons par "ordre", comment un jalon est rendu
   (renderJalon) et comment il apparaît dans le Gantt. Est-ce qu'un jalon porte déjà un type ou une nature ?
2. Les GROUPES : forme de meta.chrono_groupes (dont groupe_type_id), comment on liste les tâches d'un groupe,
   et comment on peut savoir qu'un groupe est TERMINÉ (avancement de ses tâches à 100 %). Y a-t-il déjà un
   endroit qui affiche un état de groupe (badge, couleur, synthèse) où je pourrais poser un signalement rouge ?
3. Le module VisiteChantier.jsx : structure d'une visite (table, colonnes, lots_audites, visite.audit indexé
   par lot_id en v2 / par phase en v1), les statuts possibles d'une tâche (validé / réserve / NOK / non
   commencé), le mécanisme d'héritage des réserves de la visite précédente, la checklist sécurité, et l'export
   (api/generate-visite-docx.js). Dis-moi ce qui est réutilisable tel quel et ce qui ne l'est pas.
4. Les PHOTOS et fichiers : comment une photo est prise/uploadée dans une visite aujourd'hui (bucket Supabase,
   fonction d'upload, forme stockée). Je veux réutiliser exactement le même mécanisme.
5. Le rendu MOBILE : comment l'appli gère le mobile (composant, breakpoint, RapportMobile / espace ouvrier),
   et quels composants tactiles existants je peux réutiliser pour un écran de contrôle utilisable sur
   chantier.
6. Est-ce qu'il existe déjà une notion de "réserve" persistée ailleurs que dans le snapshot d'une visite
   (table dédiée, champ sur la tâche) ? Et comment une réserve est "levée" aujourd'hui ?
7. Confirme où le Point 2 (a) a laissé la fonction unique de calcul de la Qualité (le point de branchement à
   remplir), si ce chantier a déjà été fait.

Termine par : (a) ta reco sur "nouvelle notion à côté de VisiteChantier" vs "extension de VisiteChantier",
avec les risques de chaque option ; (b) les points d'attention pour ne pas casser les visites existantes.
```

---

## Prompt 1 — Typer les jalons : `repere` vs `controle`

```
Objectif : distinguer deux natures de jalons, sans rien casser pour les jalons existants.

- Ajoute un champ "type" sur les jalons (meta.chrono_jalons) : "repere" (les jalons manuels actuels :
  livraison, réception…) et "controle" (nouveau : contrôle de fin de groupe).
- RÉTROCOMPATIBILITÉ STRICTE : un jalon existant sans type doit se comporter exactement comme aujourd'hui →
  traite l'absence de type comme "repere". Ne migre rien de force.
- Le bouton "Jalon" existant continue de créer un jalon de type "repere", avec le même comportement (nom
  éditable, date, glisser-déposer, suppression).
- Distingue visuellement les deux natures dans la vue chrono (icône ou couleur différente), sans alourdir.
- Un jalon de type "controle" n'est PAS librement supprimable ni déplaçable comme un repère : prévois-le dès
  maintenant (il sera géré par le Prompt 2), mais ne casse pas le glisser-déposer des repères.

Contraintes : strictement additif. Aucune modification du comportement des jalons existants. Le Gantt doit
continuer d'afficher les jalons datés comme avant.

Critère d'acceptation : mes jalons actuels fonctionnent exactement comme avant ; je peux distinguer un jalon
repère d'un jalon de contrôle ; rien d'autre n'a changé.
```

---

## Prompt 2 — Créer automatiquement le jalon de contrôle en fin de groupe

```
Objectif : chaque groupe d'un chantier a, automatiquement, un jalon de contrôle en dernière position.

- Pour chaque groupe de la vue chronologique, garantis l'existence d'UN jalon de type "controle", placé en
  DERNIÈRE position du groupe (après toutes ses tâches), nommé de façon parlante
  (ex. "Contrôle — <nom du groupe>").
- Création automatique : à la création d'un groupe, au semis depuis les groupes types, et pour les groupes
  déjà existants (rattrapage). Le rattrapage sur un chantier existant ne doit RIEN casser d'autre : il ajoute
  seulement les jalons de contrôle manquants.
- Un jalon de contrôle suit son groupe : si le groupe est supprimé, son jalon de contrôle disparaît avec lui
  (même règle que les repères aujourd'hui). Il ne doit pas pouvoir être déplacé dans un autre groupe.
- Il reste toujours en fin de groupe, même quand on réordonne les tâches par glisser-déposer.
- Ne le rends pas supprimable à la main : il est obligatoire. En revanche il n'empêche RIEN (non bloquant).

Contraintes : additif ; ne touche pas aux jalons "repere" ; ne modifie pas la logique d'ordre des tâches
au-delà du maintien du jalon de contrôle en dernier.

Critère d'acceptation : sur un chantier semé depuis les groupes types, chaque groupe se termine par son jalon
de contrôle ; j'ajoute un groupe, son jalon apparaît ; je réordonne les tâches, il reste en dernier ; sur un
chantier existant, les jalons de contrôle manquants sont ajoutés sans rien perdre.
```

---

## Prompt 3 — L'écran de contrôle par exception (mobile d'abord)

```
Objectif : ouvrir un contrôle depuis le jalon, sur le périmètre du seul groupe, en audit PAR EXCEPTION.

Principe non négociable : TOUT EST CONFORME PAR DÉFAUT. L'utilisateur ne touche QUE ce qui pose problème.
Sur un groupe de 40 tâches dont 38 sont bonnes, il doit faire 2 gestes, pas 40.

- Depuis un jalon de contrôle, un bouton ouvre l'écran de contrôle du groupe.
- L'écran liste les tâches DU GROUPE uniquement, lues directement dans le phasage
  (ouvrages[].taches filtrées par chrono_groupe_id). Aucune copie d'une liste parallèle, aucune ressaisie.
- Chaque tâche est conforme par défaut. Deux actions possibles, en UN geste :
  "Réserve" (à reprendre) et "Non conforme (NOK)". Un geste supplémentaire permet d'ajouter une photo et une
  note courte. Rien d'obligatoire à remplir pour les tâches conformes.
- Ergonomie terrain : gros boutons tactiles, zone de tap large, photo en un tap (réutilise le mécanisme
  d'upload existant des visites), note courte au clavier. Utilisable debout sur un chantier, à une main.
- En haut : le nom du groupe, le nombre de tâches, et un compteur clair du type "38 conformes · 2 réserves".
- Un bouton "Terminer le contrôle" enregistre : date, auteur (le conducteur), la liste des tâches signalées
  avec leur statut/photo/note, et le fait que les autres sont conformes.
- Un contrôle terminé reste consultable et modifiable (on peut y revenir pour lever une réserve).

Contraintes : additif ; ne modifie pas le module VisiteChantier existant ; réutilise l'upload photo existant ;
une réserve référence la tâche par son identifiant (tache_id), jamais par son libellé.

Critère d'acceptation : j'ouvre le contrôle d'un groupe sur mon téléphone, je signale 2 réserves avec photo en
quelques secondes, je termine — le contrôle est enregistré avec 38 conformes et 2 réserves, et je n'ai jamais
eu à valider quoi que ce soit tâche par tâche.
```

---

## Prompt 4 — Réserves : persistance, levée et ancienneté

```
Objectif : suivre la vie d'une réserve dans le temps — c'est le signal le plus important pour la Qualité.

- Persiste les réserves de façon interrogeable, rattachées au chantier, au groupe et à la tâche (tache_id),
  avec : statut (reserve / nok), commentaire, photos, date de création, auteur, et date de levée si elle a été
  levée.
- Permets de LEVER une réserve explicitement (avec date et auteur, et la possibilité de joindre une photo de
  la reprise). Une réserve levée reste dans l'historique — on ne la supprime pas.
- Si on rouvre le contrôle d'un groupe, les réserves encore ouvertes de ce groupe apparaissent en tête, avec
  leur ANCIENNETÉ ("ouverte depuis 12 jours", "non levée depuis 2 contrôles").
- Calcule et expose, par groupe et par chantier : nombre de réserves ouvertes, nombre de NOK, taux de
  conformité (tâches non signalées ÷ tâches contrôlées), et l'ancienneté de la plus vieille réserve non levée.
- Ne réinvente pas l'héritage des réserves du module VisiteChantier : ici, la réserve est persistée et vit sa
  vie, on la relit directement.

Contraintes : additif ; ne modifie pas les visites existantes ni leur héritage de réserves ; le matching se
fait toujours par tache_id ; une réserve dont la tâche a été supprimée doit s'afficher sans planter.

Critère d'acceptation : je signale une réserve, je reviens 10 jours plus tard, elle est là avec son ancienneté ;
je la lève avec une photo de la reprise, elle sort des réserves ouvertes mais reste dans l'historique ; les
compteurs par groupe et par chantier sont justes.
```

---

## Prompt 5 — Signalement rouge du groupe non contrôlé (obligatoire, non bloquant)

```
Objectif : rendre le contrôle "obligatoire" au sens SIGNALÉ, jamais bloquant.

- Un groupe dont toutes les tâches sont terminées (100 %) mais dont le contrôle n'a PAS été réalisé s'affiche
  en ROUGE / signalé dans la vue chronologique (et partout où l'état du groupe apparaît).
- Le message doit être explicite : "groupe terminé, contrôle à faire", avec un accès direct à l'écran de
  contrôle.
- Un groupe contrôlé sans réserve passe au vert ; contrôlé avec réserves ouvertes, en orange ; avec un NOK ou
  des réserves anciennes, en rouge.
- NON BLOQUANT, strictement : on peut continuer à travailler, avancer les autres groupes, dater, planifier,
  pointer. Aucun verrouillage, aucune modale bloquante, aucune interdiction.
- Expose un état de groupe réutilisable ("non contrôlé" / "conforme" / "réserves" / "non conforme") pour que
  la frise du cycle de vie (Point 2 a, phase Travaux) puisse l'afficher sans dupliquer la logique.

Contraintes : additif ; aucun blocage d'aucune action existante ; ne modifie pas les calculs d'avancement.

Critère d'acceptation : je termine toutes les tâches d'un groupe sans le contrôler → il devient rouge avec
"contrôle à faire" ; je peux quand même tout faire dans l'appli ; après contrôle sans réserve il passe vert.
```

---

## Prompt 6 — Brancher le sommet Qualité du triangle QCD

```
Objectif : allumer le sommet Qualité du triangle QCD à partir des contrôles de groupe.

- Le Point 2 (a) a laissé une fonction unique isolée pour la Qualité, qui renvoie toujours "gris".
  Remplis CETTE fonction — ne crée pas une seconde logique ailleurs.
- Règle de calcul, par chantier :
  - gris (non évalué) : aucun groupe contrôlé → message incitatif "ce chantier n'a pas encore été contrôlé".
  - vert : aucune réserve ouverte sur les groupes contrôlés.
  - orange : réserves ouvertes mineures (statut "reserve").
  - rouge : au moins un NOK, OU des réserves anciennes non levées d'un contrôle à l'autre.
- Pondérations : tiens compte du TAUX DE CONFORMITÉ (une réserve sur 50 tâches ne doit pas faire basculer tout
  le chantier au rouge) et surtout de l'ANCIENNETÉ des réserves non levées (c'est le signal le plus fort :
  une réserve fraîche est normale, une réserve qui traîne est un problème).
- Renvoie aussi une explication courte en français, affichable au clic sur le sommet
  (ex. "3 groupes contrôlés · 2 réserves ouvertes · la plus ancienne depuis 18 jours").
- Vérifie que la correction manuelle du sommet (Point 2 a, Prompt 3) continue de fonctionner par-dessus.

Contraintes : un seul point de calcul de la Qualité ; ne touche pas aux formules Délai et Coût ; additif.

Critère d'acceptation : sur un chantier avec des contrôles faits, le sommet Qualité s'allume avec la bonne
couleur et une explication juste ; un chantier sans contrôle reste gris avec son message ; une réserve qui
traîne fait basculer au rouge même si elle est seule.
```

---

## Prompt 7 — Sort de l'ancien module Visites

```
Objectif : clarifier la cohabitation avec l'ancien module Visite chantier, sans rien perdre.

- Les visites existantes doivent rester CONSULTABLES à l'identique, avec leur export (docx/PDF). On ne
  supprime aucune donnée, on ne migre rien de force.
- En revanche, la création d'une nouvelle visite "à l'ancienne" (tâche par tâche, tout le chantier) n'a plus
  de raison d'être : propose-moi la meilleure option (masquer la création, la garder en secours, ou rediriger
  vers les contrôles de groupe) en m'expliquant les conséquences — et attends ma réponse avant d'agir.
- Vérifie qu'il ne reste pas deux sources de vérité pour les réserves : ce sont les contrôles de groupe qui
  font foi désormais pour le sommet Qualité. Les réserves des anciennes visites restent de l'historique.
- Si un élément de l'ancien module est utile et non repris (par exemple la checklist sécurité/qualité),
  signale-le-moi explicitement plutôt que de le laisser mourir en silence.

Contraintes : ne supprime rien sans mon accord explicite ; ne casse aucun export existant.

Critère d'acceptation : mes anciennes visites s'ouvrent et s'exportent comme avant ; j'ai une reco claire sur
la création de nouvelles visites ; on m'a listé ce qui existait et n'est pas repris.
```

---

## Récapitulatif de l'ordre
0. Audit (lecture seule) → 1. Typer les jalons (`repere` / `controle`) → 2. Jalon de contrôle automatique en fin de groupe → 3. Écran de contrôle par exception (mobile) → 4. Réserves : persistance, levée, ancienneté → 5. Signalement rouge non bloquant → 6. Branchement du sommet Qualité → 7. Sort de l'ancien module Visites.

## Invariants à toutes les étapes
- **Audit par exception** : tout conforme par défaut, on ne pointe que les problèmes. C'est LA raison de la refonte — ne jamais y revenir.
- **Périmètre = un groupe**, lu directement dans le phasage, jamais dupliqué.
- **Non bloquant** : uniquement du signalement rouge, jamais d'empêchement.
- Les **jalons repères** et les **anciennes visites** continuent de fonctionner à l'identique.
- Matching des réserves **par `tache_id`**, jamais par libellé.
- **Mobile d'abord** : à tester sur téléphone à chaque étape.
- Chaque étape est **strictement additive** : on **teste** puis on **commit** avant la suivante.
