# Point 4 (b) — L'Opération + la vue « Chemin de fer » — Prompts pour Claude Code

## Brief de reprise (à lire en premier sur un nouveau chat)

**L'appli.** Application interne d'une entreprise de rénovation (React + Supabase). Code modifié via **Claude Code**.

**Le métier.** L'entreprise **divise une maison en plusieurs appartements**. Convention en place : **1 devis = 1 chantier = 1 logement**. Plusieurs chantiers correspondent donc souvent à **une même maison**, mais rien dans l'appli ne les relie aujourd'hui.

**Le but.** Deux choses, indissociables :
1. créer le niveau **Opération** — le parent qui regroupe les chantiers/logements d'une même maison ;
2. ajouter la vue **Chemin de fer** (planning géo-temporel) : les **logements en lignes**, le **temps en colonnes**, les groupes d'exécution en barres. Chaque équipe descend d'un logement au suivant : **l'escalier apparaît**.

**Pourquoi ça compte ici.** Diviser une maison en trois appartements, c'est trois logements quasi identiques qui s'enchaînent — le **flux répétitif** pour lequel le planning géo-temporel a été inventé. Chez eux, ce n'est pas un cas particulier, **c'est la norme**.

## Les décisions prises (à respecter)

### Une zone = un logement = un chantier → AUCUN champ « zone » à créer
C'est le point le plus important. On avait envisagé un champ `zone` sur les tâches : **il est inutile**. La zone d'une tâche, c'est **le chantier auquel elle appartient**. Le regroupement existe déjà, il manque juste le **parent**.

➡️ **N'ajoute aucun champ `zone` / `niveau` / `logement` sur les tâches.**

### La convention « 1 devis = 1 chantier » reste intacte
On **n'y touche pas**. On ajoute seulement un parent au-dessus. Un chantier sans opération doit continuer de fonctionner **exactement** comme aujourd'hui.

### Périmètre volontairement MINIMAL
Pour l'inst: **le lien entre chantiers + la vue Chemin de fer**. 

**Hors périmètre, à ne pas faire maintenant** (même si c'est tentant) : marge et avancement consolidés à l'échelle de l'opération, répartition des coûts communs (base vie, benne, échafaudage), facturation groupée. Ce sont des suites logiques, pas ce chantier-ci.

### Aucune nouvelle source de dates
La vue lit **`date_prevue`**, la date **déjà partagée** par le Gantt et la vue Chronologique. Déplacer une barre du chemin de fer **écrit `date_prevue`** → le Gantt et la Chrono se mettent à jour aussitôt. C'est le principe de **source unique**, déjà en place dans l'appli : **ne crée pas un second stockage de dates**.

## Vocabulaire (à ne JAMAIS confondre)
- **Phases (V1)** = Phasage V1 legacy (`plan_travaux[phase_id]`). **Intouchable**, mot non réutilisé.
- **Opération** = **NOUVEAU** : la maison / l'adresse. Parent de plusieurs chantiers.
- **Chantier** = un logement (= un devis). **Inchangé.**
- **Groupes** = étapes d'exécution d'un chantier (`meta.chrono_groupes`, avec `groupe_type_id`).
- **Groupes types** / **Équipes** = référentiels globaux (Admin), déjà en place.
- **Chemin de fer** = la nouvelle vue géo-temporelle, à l'échelle de l'**opération**.

## Piège technique à connaître (dit par le code lui-même)
`saveMeta` **relit la base avant d'écrire** et n'est **pas** debouncé : **deux appels dans le même tick se perdent mutuellement un patch** (c'est pourquoi `setChronoGroupesEtJalons` existe). Écris plusieurs clés de `meta` en **un seul appel**.

Attention particulière ici : le chemin de fer manipule **plusieurs chantiers**, donc **plusieurs phasages**. Une modification doit écrire dans **le bon phasage**, un par un, sans mélanger les états.

## Comment utiliser ce document
- **Un prompt à la fois.** Colle, laisse travailler, **teste**, **commit**, puis le suivant.
- **Commence par le Prompt 0** (audit, sans modification) et **lis sa réponse** : la question « où vit la vue » et « comment charger plusieurs phasages » s'y décide.
- À chaque étape, l'appli doit rester fonctionnelle.

---

## Prompt 0 — Audit (aucune modification de code)

```
Avant toute modification, lis le code et fais-moi un état des lieux écrit, sans rien changer.

Contexte : l'entreprise divise une maison en plusieurs appartements, avec la convention "1 devis = 1 chantier =
1 logement". Je veux (1) créer un niveau "Opération" qui regroupe les chantiers d'une même maison, et (2)
ajouter une vue "Chemin de fer" : les logements en lignes, le temps en colonnes, les groupes en barres.
Point crucial : la zone = le chantier, donc AUCUN champ zone n'est à ajouter sur les tâches.

Réponds-moi en texte, ne modifie aucun fichier :
1. Les CHANTIERS : où est stockée la liste (planning_config ? table dédiée ?), la forme exacte d'un chantier
   (id, nom, couleur, statut, montant, dates… ?), et la fonction de création côté Admin (addChantier) — y
   compris la création automatique du phasage lié.
2. Le lien chantier ↔ phasage : table phasages, comment on charge le phasage d'un chantier, et si l'appli sait
   déjà charger PLUSIEURS phasages à la fois quelque part (Dashboard, Analyse, États financiers…). Montre-moi
   comment c'est fait, je veux réutiliser ce mécanisme plutôt qu'en inventer un.
3. Les DATES : confirme que date_prevue sur la tâche est bien la date partagée entre la vue Chronologique et le
   Gantt, et montre-moi comment le Gantt construit son échelle de temps (jours ? semaines ? bornes min/max ?)
   et comment on déplace/décale une tâche ou un groupe entier (patchTaches, décalage de groupe).
4. Le système de VUES du Phasage : viewMode, le toggle de l'en-tête, le rendu par vue, et le bouton PDF qui
   choisit l'export selon la vue. IMPORTANT : le Phasage est aujourd'hui scopé à UN chantier sélectionné en
   haut de page. Dis-moi si une vue multi-chantiers y est envisageable, ou s'il vaut mieux une page à part —
   avec les conséquences de chaque option (chargement, sélecteur, exports).
5. Les GROUPES : forme de meta.chrono_groupes (dont groupe_type_id, couleur, ordre) et comment retrouver
   l'équipe par défaut d'un groupe (propositionPourGroupe). Pour le chemin de fer je veux colorer les barres
   par groupe — dis-moi si la couleur vient du groupe du chantier ou du groupe type.
6. Confirme qu'il n'existe AUCUNE notion de zone / niveau / logement / opération / regroupement de chantiers
   aujourd'hui (y compris côté Invest, où il pourrait y avoir un concept d'immeuble ou de bien).
7. Le piège saveMeta (relecture DB avant écriture, non debouncé) : confirme-le et dis-moi comment écrire
   proprement dans DEUX phasages différents à la suite sans perte.

Termine par : (a) ta reco pour stocker l'Opération (clé dans planning_config comme les autres référentiels, ou
table dédiée) et pour le lien chantier → opération, (b) ta reco sur l'emplacement de la vue, (c) les points
d'attention pour rester strictement additif.
```

---

## Prompt 1 — Le référentiel « Opérations » + le lien chantier → opération

```
Objectif : créer le niveau Opération et permettre de rattacher des chantiers, sans rien changer pour les
chantiers non rattachés.

- Crée le référentiel des opérations (emplacement selon ta reco du Prompt 0, a priori une clé operations dans
  planning_config, cohérente avec lots / ouvriers / groupes_types / equipes).
  Forme minimale d'une opération : { id, nom, adresse, couleur? }.
  Reste MINIMAL : pas de montant, pas de statut, pas de consolidation — c'est hors périmètre.
- Ajoute un champ operation_id sur le chantier (optionnel, vide par défaut).
- Dans l'Admin, à côté de la gestion des chantiers : un écran « Opérations » avec CRUD (créer, renommer,
  adresse, supprimer si aucun chantier rattaché) et, pour chaque opération, la liste de ses chantiers/logements.
- Depuis un chantier, permets de le rattacher à une opération (menu) ou de l'en détacher.
- RÈGLE ABSOLUE : un chantier sans operation_id doit se comporter EXACTEMENT comme aujourd'hui, partout dans
  l'appli. Aucune opération n'est créée d'office, aucun chantier n'est rattaché automatiquement.

Contraintes : strictement additif. Ne modifie ni la création de chantier existante (au-delà de l'ajout du champ
optionnel), ni les phasages, ni les calculs financiers, ni le planning.

Critère d'acceptation : je crée l'opération « Tourbouton 102 », j'y rattache mes deux chantiers/logements ; les
chantiers non rattachés fonctionnent comme avant ; rien d'autre n'a bougé dans l'appli.
```

---

## Prompt 2 — Charger les chantiers frères d'une opération

```
Objectif : pouvoir lire, ensemble, les phasages de tous les chantiers d'une même opération. Aucun affichage
nouveau à ce stade.

- Crée le chargement multi-chantiers : à partir d'une opération, récupérer ses chantiers et le phasage de
  chacun, dans une structure exploitable (par chantier : ses groupes, ses tâches avec date_prevue, avancement,
  heures, couleur de groupe).
- Réutilise le mécanisme de chargement de phasages déjà présent dans l'appli (celui identifié au Prompt 0) —
  n'invente pas un second chemin d'accès aux données.
- Prévois le cas V1 : un chantier de l'opération peut être en data_version v1 (plan_travaux[phase_id]). Il ne
  doit PAS planter le chargement : traite-le comme "non représentable dans le chemin de fer" et signale-le
  proprement.
- Gère les cas limites : opération sans chantier, chantier sans phasage, phasage sans groupe, tâches sans date.
- Expose aussi les bornes de temps de l'opération (première et dernière date_prevue), utiles pour l'échelle de
  la vue.

Contraintes : lecture seule ; aucune écriture ; aucune modification de l'interface. Performance raisonnable :
ne charge pas tous les phasages de la base, seulement ceux de l'opération.

Critère d'acceptation : pour une opération de 2 ou 3 logements, j'obtiens en une fois les groupes et les tâches
datées de chaque logement, plus les bornes de dates ; un chantier V1 dans l'opération ne casse rien.
```

---

## Prompt 3 — La vue « Chemin de fer » (affichage)

```
Objectif : afficher le planning géo-temporel de l'opération : logements en lignes, temps en colonnes.

- Emplacement : selon ta reco du Prompt 0. Si c'est une vue du Phasage, ajoute-la au toggle de l'en-tête et
  scope-la sur l'OPÉRATION du chantier courant ; si le chantier n'a pas d'opération, affiche un message clair
  invitant à en créer une (avec le lien vers l'Admin) plutôt qu'une vue vide.
- Structure de la vue :
  - une LIGNE par chantier/logement de l'opération (nom du logement à gauche) ;
  - une échelle de TEMPS en colonnes (semaines par défaut, avec la possibilité de passer en jours) ;
  - des BARRES = les groupes d'exécution, positionnées d'après les date_prevue de leurs tâches (début = date la
    plus tôt du groupe, fin = date la plus tard), colorées avec la couleur du groupe ;
  - au survol/clic d'une barre : le nom du groupe, ses dates, ses heures, son équipe, son avancement.
- L'ESCALIER doit sauter aux yeux : le même groupe décalé d'un logement au suivant. C'est tout l'intérêt de la
  vue — soigne la lisibilité horizontale (alignement des colonnes, contraste des couleurs).
- Une légende des groupes, et un repère visuel sur AUJOURD'HUI.
- Ajoute l'export PDF en paysage, sur le même patron que l'export Gantt existant.
- Réutilise les couleurs, composants et le thème T de l'appli.

Contraintes : vue en LECTURE seule à ce stade (l'édition arrive au Prompt 4). Additif : aucune autre vue, aucun
export existant, aucun calcul modifié. AUCUN champ zone ajouté sur les tâches.

Critère d'acceptation : sur une opération de 3 logements, je vois 3 lignes et l'escalier des groupes dans le
temps ; je reconnais mes groupes par leur couleur ; l'export PDF paysage fonctionne ; les autres vues sont
intactes.
```

---

## Prompt 4 — Éditer depuis le chemin de fer (source unique)

```
Objectif : pouvoir décaler le travail depuis le chemin de fer, en écrivant dans la SEULE source de dates
existante.

- Permets de déplacer une barre (un groupe d'un logement) dans le temps : le déplacement décale les
  date_prevue de TOUTES les tâches du groupe du même nombre de jours.
- Réutilise le mécanisme de décalage déjà présent dans la vue Chronologique / le Gantt (patchTaches, décalage
  de groupe) — n'écris pas les dates par un autre chemin.
- Écris dans le BON phasage : la vue manipule plusieurs chantiers, donc plusieurs phasages. Écris-les un par un,
  en tenant compte du piège saveMeta (relecture DB avant écriture, non debouncé). Vérifie qu'un déplacement sur
  le logement 2 ne touche jamais les données du logement 1.
- Après déplacement, la vue Chronologique et le Gantt du chantier concerné doivent refléter le changement
  immédiatement (même champ, source unique). Vérifie-le explicitement.
- Ne décale JAMAIS automatiquement les logements suivants ("effet domino") : ce serait une décision de
  planification, pas un effet de bord. Si tu veux le proposer, ce doit être une action explicite avec aperçu et
  confirmation.
- Affiche un retour clair pendant l'enregistrement (le Phasage a déjà un badge de statut de sauvegarde :
  réutilise-le).

Contraintes : aucune nouvelle source de dates ; aucun décalage automatique en cascade ; aucune modification des
heures, de l'avancement ou des équipes.

Critère d'acceptation : je décale de 2 semaines le groupe « Placo » du logement 2 depuis le chemin de fer ; les
dates de ses tâches bougent ; la Chrono et le Gantt de ce chantier l'affichent aussitôt ; le logement 1 et le
logement 3 sont inchangés.
```

---

## Prompt 5 — Finitions : lisibilité et cas réels

```
Objectif : rendre la vue utilisable sur de vrais chantiers, sans ajouter de fonctionnalité.

- Cas « tâches non datées » : un groupe dont aucune tâche n'a de date ne peut pas être placé. Affiche-le dans
  une zone « non planifié » en marge de la frise, plutôt que de l'ignorer silencieusement.
- Cas « logement en retard » : compare la date du jour à l'avancement du groupe et signale visuellement les
  groupes en retard (sans inventer de nouveau calcul : réutilise l'avancement existant).
- Densité : prévois un affichage lisible jusqu'à 4-5 logements et une durée de plusieurs mois (zoom
  semaines/jours, défilement horizontal, en-têtes de colonnes qui restent visibles).
- Ordre des lignes : les logements dans un ordre stable et modifiable (l'ordre de l'opération), pas un ordre
  aléatoire de chargement.
- Vérifie le comportement sur mobile : la vue peut rester secondaire sur petit écran, mais elle ne doit pas
  casser la page.

Contraintes : aucune nouvelle donnée, aucun nouveau calcul métier. Uniquement de la lisibilité.

Critère d'acceptation : une opération avec un groupe non daté et un groupe en retard s'affiche clairement dans
les deux cas ; je peux zoomer et faire défiler sans perdre les en-têtes ; rien ne casse sur mobile.
```

---

## Récapitulatif de l'ordre
0. Audit (lecture seule) → 1. Référentiel Opérations + lien chantier → 2. Chargement des chantiers frères → 3. Vue Chemin de fer en lecture + export PDF → 4. Édition (décalage) via `date_prevue` → 5. Finitions et cas réels.

## Invariants à toutes les étapes
- **AUCUN champ `zone` sur les tâches** : la zone, c'est le chantier.
- Un **chantier sans opération** fonctionne exactement comme avant, partout.
- **`date_prevue` est la seule source de dates** — jamais de second stockage, jamais de décalage automatique en cascade.
- La convention **« 1 devis = 1 chantier »** n'est pas touchée.
- **Hors périmètre** : marge/avancement consolidés, coûts communs, facturation groupée.
- Écriture dans **plusieurs phasages** : un par un, en tenant compte du `saveMeta` non debouncé.
- Le **V1** dans une opération ne doit rien casser.
- Chaque étape est **strictement additive** : on **teste** puis on **commit** avant la suivante.
