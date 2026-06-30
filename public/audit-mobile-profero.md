# Audit mobile — Planning Chantiers Profero

Audit d'utilisabilité sur écran < 400px. La feuille de style mobile globale
(`src/App.jsx`, `@media (max-width: 767px)`) adapte automatiquement les éléments
qui portent les bonnes **classes** (`responsive-grid-*`, `responsive-row`,
`table-scroll`, `modal-box`, `tabs-scroll`, `hide-on-mobile`, `page-padding`).
Comme ces règles sont en `!important`, **ajouter la classe** sur un élément à
style inline suffit le plus souvent (l'`!important` du stylesheet prime sur
l'inline sans `!important`).

## Classement par état

### 🟢 OK (rien à faire)
Planning, CaptureCommandeMobile, BesoinCommandeDrawer, PageChantiers,
Bibliotheque, NotesEtTodo, Validation, Admin.

### 🟠 Peu pratique
| Page | Problèmes | Effort |
|------|-----------|--------|
| Dashboard | grilles `repeat(4,1fr)` (l.223), `3fr 2fr` (l.230), agenda 7 col (l.702) sans classe | Trivial |
| CellModal | grille interne `1fr 320px` (l.123) non repliée ; éditeur tâches serré | Trivial |
| PageInfoClient | labels 11px ; sidebar 280px fixe (l.749) ; `ouvrage-edit-row` non replié (l.720) | Trivial |
| VisiteChantier | grille form inline `1fr 1fr` (l.739) sans classe responsive | Trivial |
| Equipe | header modale Bilan semaine sans `flexWrap` (l.803) | Trivial |
| PageBibliothequeMateriaux | table `min-width:760` (l.935), header non replié | Trivial→Moyen |
| PagePlanningCommandes | stats overflow texte, boutons modale vendredi | Trivial |
| RapprochementFactures | grilles `1fr 1fr` (l.401) et `1fr 1fr 1fr` (l.405) serrées | Moyen |
| PlanningMensuel | calendrier 7 colonnes illisible (l.639) ; chips débordent | Moyen |
| PhasageV2 | layout 3 colonnes (Lots/Ouvrages/Tâches) non replié | Refonte |

### 🔴 Cassé (inutilisable < 400px)
| Page | Problèmes | Effort | Usage mobile probable |
|------|-----------|--------|----------------------|
| Commandes | grilles 2–5 col + tableau import largeur fixe sans `table-scroll` | Moyen | Moyen |
| DashboardAnalyse | table `min-width:1100` (l.688) sans `table-scroll` | Moyen | Faible (bureau) |
| GanttView | gantt 2 colonnes large, >1000px en ligne | Refonte | Faible (bureau) |
| EtatsFinanciers | tableaux financiers massifs | Refonte | Faible (bureau) |
| Phasage (V1) | multi-panneaux desktop sans responsive | Refonte | Faible (bureau) |

## Ordre d'exécution proposé

- **Vague 1 — Quick wins** (triviaux, fort trafic mobile) : Dashboard, CellModal,
  PageInfoClient, VisiteChantier, Equipe, PageBibliothequeMateriaux.
- **Vague 2 — Flux cœur (effort moyen)** : Commandes, RapprochementFactures,
  PlanningMensuel, DashboardAnalyse (table-scroll).
- **Vague 3 — Pages bureau (refonte/dégradation)** : GanttView, EtatsFinanciers,
  Phasage/PhasageV2. Décision à prendre : refonte mobile complète vs dégradation
  gracieuse (scroll horizontal + repli en colonne) selon l'usage réel sur mobile.
