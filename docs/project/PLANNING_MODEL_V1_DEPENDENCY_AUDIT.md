# Planning Model V1 — Audit des dépendances composites

Statut : WORKING — ne constitue pas encore une règle d'exécution automatique.
Date : 2026-08-27

## Principe verrouillé

**Ordre d'affichage ≠ dépendance dure.**

Une sous-tâche sans dépendance technique connue reste `parallel` et reçoit `predecesseur_ids: []`.
Une dépendance dure n'est créée que lorsqu'une règle métier explicite la justifie.

Les groupes d'exécution et `chrono_ordre` portent la préférence d'organisation générale. Le graphe de dépendances porte uniquement les impossibilités / prérequis techniques.

## État du référentiel après migration

- 68 Ouvrages_V2.
- 43 ouvrages contiennent des sous-tâches.
- 218 sous-tâches avec identifiants stables uniques.
- 210 sous-tâches ont un groupe d'exécution certain.
- 6 affectations de groupe restent probables : E-008 et ME-001.
- 2 anomalies restent en revue : D-003.1 et MU-006.
- 38 dépendances dures certaines ont été appliquées sur 15 ouvrages simples.
- 180 sous-tâches restent sans dépendance dure.
- 0 dépendance cassée.

## Modèle recommandé pour les ouvrages composites

Un ouvrage composite ne doit pas être représenté par une chaîne unique. Il doit être décomposé en branches parallèles qui convergent vers des **portes techniques** (gates).

Schéma générique :

```text
branche A ─┐
branche B ─┼──> PORTE TECHNIQUE ──> étape suivante
branche C ─┘
```

Une porte technique peut être une vraie tâche existante (ex. « Contrôle / essais réseaux avant fermeture ») ou, plus tard, un jalon logique non productif si le modèle en a besoin.

## Famille plomberie / salle de bain

### Réseau initial

Sur P-021 et P-021.2, les tâches suivantes ne doivent pas être chaînées entre elles par leur simple ordre de liste :

- alimentation PER douche ;
- alimentation PER vasque ;
- alimentation PER WC ;
- évacuation WC ;
- évacuation vasque ;
- évacuation douche ;
- nourrices EF/EC.

Elles peuvent être réalisées dans un ordre variable ou partiellement en parallèle selon l'accès chantier et l'équipe.

### Porte technique proposée

`Contrôle / essais réseaux avant fermeture` est un excellent candidat de convergence :

```text
alimentations + évacuations + nourrices
                  ↓
     contrôle réseaux avant fermeture
                  ↓
        fermeture des ouvrages
```

Cette règle est forte métier mais son lien avec l'ossature doit encore être précisé, car certains réseaux passent avant l'ossature et d'autres dans les cloisons après mise en place de l'ossature.

### Appareillage salle de bain

Les équipements finaux ne forment pas nécessairement une seule chaîne. Trois sous-branches sont plus réalistes :

1. Douche : receveur / bonde → raccordements → étanchéité / revêtement mural → colonne / paroi → silicone / finitions.
2. WC : mise en place → raccordement évacuation + alimentation.
3. Vasque : meuble / vasque → mitigeur + alimentation + évacuation.

`Mise en eau + essais finaux` peut converger depuis les trois branches terminées.

L'ordre exact entre receveur, SPEC/enduit d'étanchéité et Dumawall doit être validé avant automatisation.

## P-900 — Douche

Structure probable :

```text
alimentation PER ─┐
évacuation douche ├──> pose receveur / raccordements
                  │             ↓
                  └────> étanchéité → Dumawall
                                      ↓
                         colonne + paroi
                                      ↓
                               silicone final
```

Cette famille est une bonne candidate pour la prochaine règle explicite, après validation de l'ordre receveur / étanchéité / Dumawall.

## Cuisine — PC-001 / P-1100

Le macro-groupe reste volontairement `Appareillage plomberie`.

Branches proposées :

```text
alimentation cuisine ─┐
évacuation cuisine ───┴──> implantation / meubles / plan de travail
                                 ├──> évier + raccordement
                                 ├──> plaque
                                 ├──> four
                                 └──> hotte
                                           ↓
                                    finitions cuisine
```

Les équipements électroménagers n'ont pas besoin d'être chaînés les uns aux autres. Les raccordements électriques externes éventuels devront être traités comme contraintes inter-tâches / inter-lots, pas par ordre de liste.

P-1100 est actuellement non planifiable car ses ratios de sous-tâches totalisent 0 %.

## Chauffe-eau — P-800 / P-001

Les alimentations/évacuations/nourrices sont des travaux réseau. La pose du chauffe-eau puis ses raccordements sont de l'appareillage plomberie.

Structure candidate :

```text
alimentation PER ─┐
évacuation ───────┼──> pose chauffe-eau ──> raccordements finaux
nourrices EF/EC ──┘
```

À confirmer : la nourrice peut être un prédécesseur de l'alimentation plutôt qu'un simple prédécesseur de la pose finale selon le mode de réalisation Profero.

## Électricité complète — E-002 / E-003

Ne pas chaîner automatiquement les lignes dans l'ordre actuel.

Familles fonctionnelles :

- préparation / dépose ;
- repérage ;
- saignées, gaines, câbles ;
- terre ;
- GTL + tableau ;
- boîtes d'encastrement (position métier encore à verrouiller) ;
- appareillage ;
- radiateurs / sèche-serviette ;
- essais et mise en service.

Modèle cible : plusieurs tâches de réseau convergent vers un **réseau électrique prêt**. L'appareillage et les équipements finaux peuvent ensuite être réalisés en parallèle, avant une convergence sur `Essai / mise en service`.

Il manque toutefois une dépendance externe importante : l'appareillage final dépend souvent de l'état des cloisons / peinture. Cette dépendance ne doit pas être inventée à l'intérieur de l'ouvrage électrique ; elle doit être exprimée par les règles métier transversales du chantier.

## P-021.2 — cas de référence composite

35 sous-tâches, 4 groupes d'exécution. Ce cas doit servir de fixture métier pour vérifier que le moteur sait gérer :

- branches parallèles ;
- convergence réseau ;
- alternance entre plomberie et ossature/placo ;
- fermeture après réseaux ;
- plusieurs branches d'appareillage final ;
- convergence vers essais finaux.

Aucune chaîne globale ne doit jamais être générée pour cet ouvrage.

## Points à verrouiller avant règles composites automatiques

1. Plomberie dans cloisons : quelles tâches peuvent être réalisées avant ossature et lesquelles nécessitent l'ossature en place ?
2. Boîtes d'encastrement : réseau électrique ou appareillage final selon la pratique Profero ?
3. Salle de bain : ordre réel entre receveur, étanchéité, Dumawall, colonne et paroi.
4. Cuisine : équipements finaux après peinture/sol ou seulement préférence souple ?
5. Peinture vs sols : contrainte dure ou ordre préféré ?
6. Menuiseries extérieures / mise hors d'eau-hors d'air : prérequis dur pour quels travaux intérieurs ?

## Règle de sécurité

Tant que ces points ne sont pas validés, les tâches concernées restent `parallel` et le futur planificateur les ordonne avec les groupes, les préférences métier et les contraintes chantier — sans inventer un verrou technique.
