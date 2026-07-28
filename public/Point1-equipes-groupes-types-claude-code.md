# Point 1 — Équipes & groupes types — Prompts pour Claude Code

## Brief de reprise (à lire en premier sur un nouveau chat)

**L'appli.** Application interne d'une entreprise de rénovation (React + Supabase), outil unique de la boîte. Le code est modifié via **Claude Code** — pas à la main dans le chat.

**Le but du Point 1.** Structurer les ouvriers en **équipes** stables (avec un responsable), et pouvoir affecter automatiquement la bonne équipe à chaque étape d'exécution d'un chantier, pour que les ouvriers se pré-remplissent dans le planning sans ressaisie. Aujourd'hui, l'affectation se fait à la main, et les « étapes » d'exécution sont retapées sur chaque chantier.

**Les 3 équipes (référentiel cible).**
- **Plomberie** — responsable *Wanceslas*, membre *Selman*. Prioritaire sur : passage réseau plomberie, appareillage plomberie.
- **Élec** — responsable *Steven*, membre *Keita* (arrive en septembre). Prioritaire sur : passage réseau élec, appareillage élec.
- **Second œuvre** — responsable *Davy*, membres *Margaux, Kev*. Prioritaire sur : menuiserie ext., ossature placo, laine/placo/enduit, peinture, sols, finition générale.
- **Externe** (prestataire) — démolition, couverture extérieure. Pas de membres internes.

**Les 12 groupes types (référentiel cible), avec lot rattaché et équipe par défaut.**

| # | Groupe type | Lot (devis) | Équipe par défaut |
|---|---|---|---|
| 1 | Démolition | Démolition | Externe |
| 2 | Menuiserie extérieure | Menuiserie / Ouvertures | Second œuvre |
| 3 | Couverture extérieure | — | Externe |
| 4 | Passage réseau plomberie | Plomberie | Plomberie |
| 5 | Ossature placo | Murs cloison | Second œuvre |
| 6 | Passage réseau élec | Électricité | Élec |
| 7 | Laine / Placo / Enduit | Murs cloison | Second œuvre |
| 8 | Peinture | Finitions | Second œuvre |
| 9 | Sols | Finitions | Second œuvre |
| 10 | Appareillage élec | Électricité | Élec |
| 11 | Appareillage plomberie | Plomberie | Plomberie |
| 12 | Finition générale | Finitions | Second œuvre |

## Vocabulaire (à ne JAMAIS confondre)
- **Phases** = Phasage **V1** (`plan_travaux[phase_id]`). Legacy. On **n'y touche pas** et on **ne réutilise pas le mot « phase »** pour la nouvelle notion.
- **Lots** = axe **devis** (les 8 lots, dans `planning_config`, chargés via `loadLots`/`LOTS_DEFAUT`, forme `{ id, label, couleur, code_prefixe }`). On **n'y touche pas**.
- **Groupes** = vue **chronologique** du V2, **propres à chaque chantier** (`phasage.plan_travaux.meta.chrono_groupes` = `[{ id, nom, couleur, ordre }]` ; chaque tâche porte `chrono_groupe_id` + `chrono_ordre`).
- **Groupes types** = **NOUVEAU** référentiel standard, **global**, qui alimente les groupes des chantiers.
- **Équipes** = **NOUVEAU** référentiel.

## Décisions déjà prises (à respecter)
- **Strictement additif.** Ne rien casser : ni le V1 (phases), ni les lots / l'import de devis, ni la vue chronologique existante des chantiers déjà créés.
- **Groupes types = globaux**, rangés au même endroit que les lots (dans `planning_config`), séparés des phases V1 et des groupes par chantier.
- Chaque **groupe type** porte : `nom`, `couleur`, `ordre` (rang d'exécution), `lot_id` (un des lots existants), `equipe_id` (équipe par défaut, peut être vide au départ).
- Chaque **équipe** porte : `nom`, `responsable_id` (un ouvrier), `membres` (ouvriers existants), un marqueur `externe` (true pour les prestataires : pas de membres internes), et la possibilité qu'un membre ait une **date de disponibilité** (ex : Keita en septembre).
- Le lien **groupe type → équipe** est stocké **une seule fois**, sur le groupe type (`equipe_id`). Côté équipe, on **affiche** seulement les groupes qui pointent vers elle (lecture). Pas de double saisie.
- Sur un chantier, les groupes de la vue chrono sont **semés** depuis les groupes types et gardent un lien `groupe_type_id` vers leur origine. C'est ce lien qui permet de retrouver l'équipe par défaut et d'alimenter le chemin de fer (Point 4).
- L'équipe par défaut est **proposée, jamais imposée** : c'est une action que l'utilisateur déclenche (bouton), pas un automatisme. On peut toujours prêter quelqu'un ailleurs sur un chantier donné.

## Comment utiliser ce document
- **Un prompt à la fois.** Colle le prompt, laisse Claude Code travailler, **teste**, puis **commit** avant de passer au suivant.
- **Commence par le Prompt 0** (audit, sans modification) et **lis sa réponse** : elle donne les noms exacts et les formes réelles, qui peuvent ajuster un détail des prompts suivants.
- À chaque étape, l'appli doit rester fonctionnelle. Si une étape casse quelque chose, on s'arrête et on corrige avant d'avancer.

---

## Prompt 0 — Audit (aucune modification de code)

```
Avant toute modification, lis le code et fais-moi un état des lieux écrit, sans rien changer.

Contexte : je veux ajouter deux référentiels globaux — les « groupes types » (liste standard ordonnée d'étapes d'exécution) et les « équipes » — sans toucher au V1 (phases), aux lots (devis), ni casser la vue chronologique existante.

Réponds-moi en texte, ne modifie aucun fichier :
1. Où et comment est chargée/sauvée la config globale (planning_config) : le mécanisme exact de loadLots / LOTS_DEFAUT dans constants.js, la forme d'un lot ({ id, label, couleur, code_prefixe }), et comment on lit/écrit dans planning_config de façon générale (autres clés déjà présentes : ouvriers, chantiers, bibliothèque d'ouvrages types…).
2. La liste des ouvriers : où elle vit, sa forme exacte (id, nom, email… ?), et où on la gère dans l'Admin.
3. La vue chronologique de PhasageV2.jsx : la forme réelle d'un groupe (meta.chrono_groupes), comment une tâche référence son groupe (chrono_groupe_id, chrono_ordre), et les fonctions existantes (addGroupe, deleteGroupe, applyChrono, reorderGroupe…). Confirme que les groupes sont bien propres à chaque phasage.
4. La forme réelle d'une tâche V2 (ouvrages[].taches[]) : confirme la présence de taches[].ouvriers[] et sa forme (liste de noms ? d'ids ?), ainsi que date_prevue.
5. Comment une tâche/un groupe alimente le planning hebdomadaire (planning_cells) : la fonction envoyerDansPlanning, et la forme de planning_cells.ouvriers.
6. Comment sont créés un chantier et son phasage (addChantier) : est-ce qu'un phasage vide est créé automatiquement, et à quel endroit on pourrait « semer » ses groupes.
7. Confirme la coexistence V1/V2 (data_version) et que le V1 (plan_travaux[phase_id]) n'est pas impacté par ce qui précède.

Termine par une courte liste des points d'attention pour rester strictement additif.
```

---

## Prompt 1 — Référentiel « groupes types » (données + Admin)

```
Objectif : créer un référentiel GLOBAL de « groupes types » (liste standard ordonnée d'étapes d'exécution), rangé au même endroit que les lots (planning_config), et éditable dans l'Admin.

- Ajoute une clé groupes_types dans planning_config. Forme d'un groupe type :
  { id, nom, couleur, ordre, lot_id, equipe_id }
  (equipe_id peut rester vide à ce stade ; lot_id référence un lot existant.)
- Ajoute un onglet « Groupes types » dans l'Admin, à côté des lots et de la bibliothèque d'ouvrages types. CRUD complet :
  créer / renommer / choisir une couleur / réordonner (rang d'exécution) / choisir le lot rattaché (menu parmi les lots existants). Le champ « équipe par défaut » sera branché au Prompt 3.
- Amorce le référentiel avec les 12 groupes types du brief (dans l'ordre), chacun avec son lot rattaché. (Couverture extérieure : lot vide.)

Contraintes : strictement additif. Ne touche NI aux lots, NI aux phases V1, NI aux groupes chrono des chantiers existants. Réutilise la palette de couleurs existante (CHRONO_PALETTE) si pratique.

Critère d'acceptation : dans l'Admin, je vois et je peux éditer la liste ordonnée des 12 groupes types, chacun rattaché à un lot ; rien d'autre dans l'appli n'est modifié.
```

---

## Prompt 2 — Référentiel « équipes » (données + Admin)

```
Objectif : créer un référentiel GLOBAL d'« équipes », éditable dans l'Admin.

- Ajoute une clé equipes dans planning_config. Forme d'une équipe :
  { id, nom, responsable_id, membres: [ { ouvrier_id, date_dispo? } ], externe: false, couleur? }
  - responsable_id et membres.ouvrier_id référencent des ouvriers existants (pas de nouvelle liste de personnes).
  - date_dispo (optionnelle) : date à partir de laquelle le membre est disponible (ex : Keita en septembre).
  - externe: true pour un prestataire → pas de membres internes.
- Ajoute un onglet « Équipes » dans l'Admin. CRUD : nom, responsable (menu parmi les ouvriers), membres (multi-sélection parmi les ouvriers), case « externe », date de disponibilité par membre.
- Amorce avec : Plomberie (resp. Wanceslas, membre Selman), Élec (resp. Steven, membre Keita avec date_dispo en septembre), Second œuvre (resp. Davy, membres Margaux + Kev), et une équipe Externe (externe: true, sans membres).

Contraintes : strictement additif. Réutilise la liste d'ouvriers existante ; ne la duplique pas. Ne touche à rien d'autre.

Critère d'acceptation : dans l'Admin, je crée/édite mes 3 équipes + l'externe, avec responsable et membres pris dans mes ouvriers ; Keita apparaît avec sa date de disponibilité.
```

---

## Prompt 3 — Lien groupe type → équipe par défaut

```
Objectif : rattacher chaque groupe type à une équipe par défaut, avec une seule source de vérité.

- Dans l'onglet « Groupes types », active le champ equipe_id : un menu qui liste les équipes existantes.
- Renseigne les équipes par défaut des 12 groupes types selon le brief (plomberie → équipe Plomberie, élec → équipe Élec, second œuvre → équipe Second œuvre, démolition + couverture → équipe Externe).
- Dans l'onglet « Équipes », affiche EN LECTURE, pour chaque équipe, la liste des groupes types qui pointent vers elle (ses « groupes prioritaires »). Cette liste est calculée depuis equipe_id des groupes types — ne la stocke pas en double sur l'équipe.

Contraintes : le lien n'est stocké qu'à un seul endroit (equipe_id sur le groupe type). Additif, rien d'autre impacté.

Critère d'acceptation : je choisis l'équipe par défaut d'un groupe type ; elle apparaît aussitôt dans les « groupes prioritaires » de cette équipe ; aucune double saisie.
```

---

## Prompt 4 — Semer les groupes d'un chantier depuis les groupes types

```
Objectif : pré-remplir les groupes de la vue chronologique d'un chantier à partir des groupes types, sans casser les chantiers existants.

- Ajoute un champ groupe_type_id sur les groupes chrono (meta.chrono_groupes) : quand un groupe vient d'un groupe type, il garde le lien vers son origine.
- Ajoute, dans la vue chronologique, une action explicite « Initialiser depuis les groupes types » : elle crée les groupes du chantier à partir des groupes types (nom, couleur, ordre, groupe_type_id), dans le bon ordre.
- Comportement sûr : ne semе PAS automatiquement un chantier qui a déjà des groupes. L'action est manuelle ; si des groupes existent déjà, demande confirmation (ajouter les manquants vs remplacer). Par défaut, proposer d'ajouter seulement les groupes types absents.

Contraintes : les chantiers existants et leurs groupes actuels restent intacts tant qu'on ne déclenche pas l'action. Strictement additif ; ne touche pas au reste de la vue chrono.

Critère d'acceptation : sur un nouveau chantier, un clic crée les 12 groupes dans l'ordre, avec le lien groupe_type_id ; sur un chantier existant, rien ne bouge sans mon action explicite.
```

---

## Prompt 5 — Proposer l'équipe par défaut et pré-remplir les ouvriers

```
Objectif : sur un groupe de chantier, proposer l'équipe par défaut et pré-remplir les ouvriers des tâches — proposé, jamais imposé.

- Pour un groupe chrono ayant un groupe_type_id, résous l'équipe par défaut : groupe → groupe type → equipe_id → équipe.
- Affiche sur le groupe une action « Affecter l'équipe [Nom] » (badge/bouton). Au clic, pré-remplis taches[].ouvriers des tâches de ce groupe avec les membres de l'équipe (responsable + membres), en réutilisant le mécanisme d'affectation d'ouvriers existant. Ne remplace pas des ouvriers déjà saisis sans confirmation.
- Réutilise le flux existant vers le planning (envoyerDansPlanning / planning_cells.ouvriers) : ne crée pas un second chemin.
- « Proposé, jamais imposé » : c'est une action volontaire, pas un automatisme ; l'utilisateur peut affecter d'autres ouvriers manuellement comme aujourd'hui.

Contraintes : additif ; réutilise le code d'affectation et de planning existant. Ne modifie pas la logique de calcul des heures.

Critère d'acceptation : sur un groupe « Passage réseau plomberie », un clic affecte Wanceslas + Selman aux tâches du groupe ; ça remonte dans le planning ; je peux toujours affecter quelqu'un d'autre à la main.
```

---

## Prompt 6 — Cas particuliers : externes et membre à venir

```
Objectif : gérer proprement les prestataires externes et les membres pas encore disponibles.

- Équipe externe (externe: true) : quand elle est affectée à un groupe (démolition, couverture), elle apparaît bien sur le groupe et dans le planning comme repère, MAIS ne compte pas dans les heures internes ni dans les calculs d'effectif interne. Marque ces cellules/tâches comme « externe » plutôt que d'y mettre des ouvriers internes.
- Membre à venir (date_dispo dans le futur, ex : Keita) : il figure dans l'équipe (visible), mais n'est PAS compté dans l'effectif disponible ni proposé au pré-remplissage tant que la date n'est pas atteinte. Affiche-le avec une mention « à partir de [date] ».

Contraintes : additif ; ne fausse aucun calcul d'heures ou de coût existant. Un membre à venir ne doit jamais gonfler l'effectif dispo avant sa date.

Critère d'acceptation : la démolition affectée à l'externe n'ajoute pas d'heures internes ; Keita est visible dans l'équipe Élec mais pas proposé ni compté avant septembre.
```

---

## Récapitulatif de l'ordre
0. Audit (lecture seule) → 1. Groupes types (données + Admin) → 2. Équipes (données + Admin) → 3. Lien groupe type → équipe → 4. Semer les groupes d'un chantier → 5. Proposer l'équipe + pré-remplir les ouvriers → 6. Externes + membre à venir.

## Invariants à toutes les étapes
- Le **V1 (phases)** n'est jamais impacté ; le mot « phase » n'est pas réutilisé.
- Les **lots** et l'**import de devis** ne sont pas modifiés.
- Les **groupes chrono des chantiers existants** ne bougent pas sans action explicite.
- Chaque étape est **strictement additive** : on **teste** puis on **commit** avant la suivante. Si une étape casse quelque chose, on s'arrête et on corrige.
