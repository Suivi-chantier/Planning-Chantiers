# Plan — Refonte premium complète (mobile + desktop)

Objectif : faire passer toute l'app au niveau « appli pro », mobile-first, **thème
clair**, en s'appuyant sur le design system figé (`src/mobileUI.jsx`). On avance
**petit à petit** : chaque étape = 1 commit autonome, buildé et testable, pour
réduire le risque. Après chaque étape : test sur téléphone + PC, puis on enchaîne.

Légende risque : 🟢 faible · 🟡 moyen · 🔴 élevé (structure sensible).

---

## Phase 0 — Renforcer le design system (socle commun) 🟢
Tout le reste s'appuie dessus → à faire en premier.
- **0.1** Enrichir `mobileUI.jsx` avec les briques manquantes :
  - `MobileTabs` (sélecteur segmenté premium, réutilisable)
  - `MobileListItem` (ligne/élément de liste surélevé avec accent + chevron)
  - `Pill` / `StatusDot` (badges et pastilles de statut standardisés)
  - `MobileEmptyState` (état vide soigné : icône + message)
  - `SummaryBar` (bandeau de chiffres clés compact, pour les pages-outils)
- **0.2** Nettoyer les ombres/couleurs « sombres » résiduelles (rgba noir 0.4+)
  vers des ombres claires douces, partout où ça dépasse.

## Phase 1 — Planning (refonte complète) 🟡
- **1.1** Hero/résumé semaine (mobile) : nb chantiers actifs, total heures équipe,
  alerte surcharge (>40h) — via `SummaryBar`. 🟢
- **1.2** Cartes chantier enrichies : avancement, badges (commande/note), état. 🟢
- **1.3** Récap heures/ouvrier en barres premium (au lieu de pills brutes). 🟢
- **1.4** Refonte de la **grille semaine desktop** : en-têtes de jours soignés,
  colonne « aujourd'hui » mise en avant, cellules plus lisibles, conteneur
  surélevé arrondi. 🔴 (étape délicate, isolée et testée à part)

## Phase 2 — Chantiers / Fiche chantier (refonte complète) 🟡
- **2.1** Liste : `SummaryBar` (nb chantiers, CA total, en cours/terminés). 🟢
- **2.2** Cartes chantier enrichies : barre d'avancement, mini-indicateurs
  finances, statut visuel. 🟢
- **2.3** **Fiche chantier (détail) mobile** : refonte en sections/onglets premium
  (`MobileTabs` + `MobileSection`), au lieu d'un long scroll. 🟡
- **2.4** Fiche chantier desktop : mise en page soignée, cartes surélevées. 🟡

## Phase 3 — Commandes (refonte complète) 🟡
- **3.1** Hero/résumé : à passer, en attente facture, montants engagés. 🟢
- **3.2** **Mobile : table → cartes de commande** (la grosse demande) : une carte
  par commande (fournisseur, montant, statut coloré, chantier), tap pour détail. 🟡
- **3.3** Vue groupée premium (cartes déjà élevées → enrichir en-têtes/compteurs). 🟢
- **3.4** Table desktop : en-têtes, lignes alternées, badges de statut soignés,
  ligne survol. 🟡

## Phase 4 — Pages « bureau » (premium, après les 3 ci-dessus) 🟡→🔴
- **4.1** DashboardAnalyse : cartes/sections premium, table lisible. 🟡
- **4.2** États financiers : KPI premium, matrices clarifiées. 🔴
- **4.3** PhasageV2 : panneaux/cartes premium (mobile drill-down déjà en place). 🟡
- **4.4** GanttView : liste mobile premium (cartes déjà en place → enrichir). 🟢

---

## Méthode
1. On traite une étape à la fois (ou un petit groupe d'étapes 🟢 ensemble).
2. Build + commit + push à chaque étape.
3. Tu testes (mobile + PC), retour, ajustement si besoin, puis étape suivante.
4. Les étapes 🔴 (grille planning, états financiers) sont faites isolément avec
   un soin particulier et un test dédié.

Ordre recommandé : **Phase 0 → 1 → 2 → 3 → 4**.
