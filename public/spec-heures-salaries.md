# Spec — Page « Heures des salariés » (vue ouvrier, clôture paie)

Nouvelle page orientée **salarié** (une ligne = un ouvrier, une colonne = un jour),
alimentée par le registre `pointages` (donc par les CR validés). Elle complète — sans
remplacer — la page Équipe (orientée chantier) et la Validation (saisie/validation).
Objectif métier : **préparer la paie du mois** (contrôle → clôture → export).

Trois parties, à jouer dans l'ordre :

- **Partie 1** — La page + la grille lecture seule (ouvrier × jour, vues jour / semaine / mois).
  Buildable tout de suite avec les données existantes. PRIORITAIRE.
- **Partie 2** — L'en-tête mensuel : indicateur de validation, KPI, garde-fous d'export.
- **Partie 3** — Absences + clôture + export paie. **Nécessite des décisions** (voir la
  section « Décisions à prendre avant la Partie 3 »). Ne pas commencer sans elles.

---

## Contexte commun

### Source de vérité
La table `pointages` (cf. `sql/pointages.sql`) contient une écriture par
`(ouvrier, tâche, date)` issue d'un CR **validé**. Colonnes utiles ici :
`ouvrier` (texte), `date`, `heures`, `chantier_id`, `type_pointage`
(`'tache'` | `'indirect'`), `motif_indirect`. **Un pointage n'existe qu'après
validation d'un CR** — c'est le point central de tout l'écran.

Helpers déjà disponibles dans `src/pointages.js` : `fetchPointages(...)`,
`sumHeures(pts)`, `sumCoutMO(pts)`. La page charge le périmètre voulu puis
agrège **en mémoire** (même pattern que `DashboardAnalyse`).

### Pour la paie, on additionne TOUT
Contrairement aux vues de coût, on ne sépare PAS le productif de l'indirect :
toutes les heures `pointages` (tâche + indirect + trajet) sont des heures payées.
Le total d'une cellule = somme de `heures` de tous les pointages du couple
`(ouvrier, date)`, tous chantiers et tous types confondus.

### Cette page agrège À TRAVERS les chantiers
Le total d'une cellule ne dépend pas du chantier. La ventilation par chantier
n'apparaît qu'en « vue détaillée » (sous la cellule) et via les pastilles de
couleur. Ne pas ré-appliquer la logique de lissage `Trajet (1/N)` ici : on veut
le total réel de la personne.

### Liste des salariés = référentiel, pas les pointages
La colonne de gauche doit lister **tous** les ouvriers connus (y compris ceux à
0h ce mois-ci), pris depuis la config Admin (`ouvriers` + `tauxHoraires`), et
NON depuis les noms présents dans les pointages. Sinon un salarié sans heure
disparaît — inacceptable pour la paie. Jointure pointage↔salarié par le nom.

> ⚠️ Fragilité connue : `pointages.ouvrier` est un texte libre. Un écart de casse
> ou d'orthographe (« Davy » vs « Davy M. ») casse silencieusement l'agrégation.
> Pour cette passe, faire la jointure par nom normalisé (trim + casse).
> Une vraie table `ouvriers` avec id est recommandée à terme (hors périmètre ici).

### Ne pas modifier
`RapportMobile.jsx`, `Validation.jsx`, le schéma `pointages`, ni la logique de
lissage `Trajet (1/N)`. Le pipeline de saisie est correct. Cette page est
**en lecture** (sauf Partie 3, qui écrit uniquement dans de nouvelles tables
dédiées, jamais dans `pointages`).

### Discipline
Aucune correction d'heures depuis cette page. Corriger une heure = revalider le
CR dans `Validation.jsx`. Un seul endroit modifie les heures, sinon les données
divergent.

---

# PARTIE 1 — Page + grille lecture seule (PRIORITAIRE)

## Nouveau fichier : `src/Renovation/HeuresSalaries.jsx`

### 1a. Enregistrer la page
- `src/Renovation/Navigation.jsx` : ajouter `"heures-salaries"` aux tableaux
  `ROLE_PAGES.admin` et `ROLE_PAGES.conducteur` (et `comptable` si pertinent).
  Ajouter une entrée dans `ALL_NAV_ITEMS` : `{ id:"heures-salaries", icon:Clock,
  label:"Heures", longLabel:"Heures des salariés" }` (icône `Clock` déjà importée).
- `src/Renovation/PageAide.jsx` : ajouter une clé `"heures-salaries"` (titre,
  sousTitre, intro, etapes, savoir) sur le modèle des entrées existantes.
- Câbler le rendu de la page comme les autres (là où `activeTab`/routing des
  pages est géré au niveau du conteneur principal).

### 1b. Sélecteur de granularité : jour / semaine / mois
Un switch en tête (`vue = 'jour' | 'semaine' | 'mois'`, défaut `'mois'`), plus la
navigation de période (précédent / suivant / « Aujourd'hui ») déjà présente
ailleurs. La période sélectionnée définit la plage `[dateMin, dateMax]`.

### 1c. Données
Charger les pointages de la plage (fetch large puis filtre mémoire sur `date`) :
grouper par `ouvrier` puis par `date`. Structure cible :
`{ [ouvrier]: { [dateISO]: { heures, chantiers:Set<chantier_id>, pointages:[] } } }`.
Couleurs de chantier : réutiliser le mapping couleur déjà utilisé dans les vues
planning / dashboard (ne pas réinventer une palette).

### 1d. La grille
- Lignes = salariés (référentiel Admin, cf. Contexte). Total du mois affiché sous
  le nom (`sumHeures` sur toute la plage).
- Colonnes = jours de la plage. Week-end en fond discret (`--surface-0`).
- Cellule = total du jour + pastille(s) de chantier + icône photo si le CR
  d'origine a des photos. Clic sur la cellule → ouvre le(s) CR source (traçabilité).
- « Vue détaillée » (toggle déjà prévu) : sous chaque cellule, éclatement par
  chantier (`chantier_id` + heures).

### 1e. Les 4 états de cellule (lisibilité = priorité)
1. **Validé** : fond plein `--bg-accent`, chiffre `--text-accent`, pastilles + photo.
2. **Prévu non validé** : fond transparent, bordure pointillée, chiffre grisé,
   mention « à valider ». Provient du planning (cf. 1f).
3. **Absence** : tag coloré `--bg-warning`, PAS de chiffre (Partie 3 pour la donnée).
4. **Vide / week-end** : fond neutre, sans bordure.
Ne pas dépasser 4 fonds de couleur. Tout état supplémentaire = marqueur discret
(liseré, point), pas un nouveau fond.

### 1f. Superposition planning (prévu) — si donnée disponible
Si un planning prévisionnel existe pour la période (à confirmer : où vivent les
heures/affectations prévues — probablement `planning_config`), afficher le prévu
en « fantôme » (état 2) dans les cellules sans pointage validé. Dès qu'un CR est
validé pour ce jour, la cellule bascule en état 1.
> Si la source du planning n'est pas claire, livrer la 1e sans le fantôme et
> signaler le point — ne rien inventer.

---

# PARTIE 2 — En-tête mensuel (contrôle + garde-fous)

Ne s'affiche qu'en vue `'mois'`. Répond à : « ce mois est-il prêt pour la paie,
et sinon qu'est-ce qui bloque ? »

### 2a. Indicateur de validation
Récupérer les CR **non validés** du mois (`rapports` avec `statut != 'valide'`,
comme déjà fait dans `Phasage.jsx` / `PhasageV2.jsx`).
- S'il en reste : bandeau `--bg-warning`, « N jours restent à valider avant de
  clôturer », + liste nominative (ouvrier + date). Bouton « Voir les CR en
  attente » → renvoie vers `Validation.jsx` filtré sur ces jours (raccourci, pas
  de nouvelle mécanique).
- Si zéro : bandeau `--bg-success`, « Tous les CR du mois sont validés ».

### 2b. KPI du mois (contrôle de vraisemblance)
Cartes `--surface-2` : Heures du mois (`sumHeures`), dont heures sup
(`--text-warning`, cf. 2d), Absences (Partie 3), Effectif.

### 2c. Garde-fous sur les actions
- « Exporter le mois » : autorisé même si des jours ne sont pas validés, MAIS
  confirmation obligatoire au clic (« N jours non validés compteront pour 0h,
  exporter quand même ? »).
- « Clôturer » : **désactivé tant que le bandeau n'est pas vert.**

### 2d. Seuil heures sup — AFFICHAGE seulement
Le sous-total **par semaine** (à côté du nom) se colore au-delà d'un seuil
configurable (défaut 35h ; alerte forte à 48h). Les heures sup se comptent à la
**semaine civile**, pas au mois : le total mensuel empile les semaines.
> NE PAS calculer les taux de majoration (25 % / 50 %) automatiquement dans cette
> passe. On se contente de **signaler** le dépassement. Le calcul des majorations
> dépend de la convention collective et se décide avec le comptable (Partie 3).

---

# PARTIE 3 — Absences, clôture, export (APRÈS DÉCISIONS)

> ⚠️ Ne pas démarrer sans avoir tranché la section « Décisions à prendre » ci-dessous.
> Ces briques écrivent en base : créer de **nouvelles tables** dédiées, ne jamais
> écrire dans `pointages`.

### 3a. Absences (nouvelle table `absences`)
Saisie d'un motif (congé / maladie / férié / RTT…) sur une cellule vide.
Distingue « 0h car absent » de « 0h car non validé ».
> Rappel BTP : les congés payés passent par la caisse (CIBTP). Ne PAS les
> convertir en heures payées sans validation comptable — voir décisions.

### 3b. Clôture de mois (nouvelle table `clotures_paie`)
Action « Clôturer » : enregistre `(mois, clôturé_par, date, snapshot)` et
verrouille l'affichage. En-tête clôturé : badge « Clôturé le … par … », actions
grisées, bouton « Rouvrir » discret. Empêche une double paie accidentelle.

### 3c. Export
Génère le livrable paie (format = décision). Réutiliser la mécanique d'export
existante (Word / PDF / e-mail des bilans, ou xlsx via la skill xlsx si CSV/Excel).
N'écrit rien en base.

---

## Décisions à prendre avant la Partie 3 (avec le comptable)
1. **Format d'export attendu** par le comptable ou le logiciel de paie
   (Silae / Sage / autre) : colonnes exactes, xlsx vs CSV vs PDF.
2. **Règle des heures sup** : base hebdo (35h ? 39h collectif ?), seuils des
   paliers 25 % / 50 %, modulation éventuelle.
3. **Modèle des absences** : quels motifs, lesquels sont des heures payées,
   lesquels partent en caisse (CP), comment ils apparaissent à l'export.

---

## Critères de recette
1. **Vue mois** : grille salariés × jours, totaux par jour corrects (= somme des
   `heures` du couple ouvrier/date, tous chantiers/types), total mensuel par
   salarié cohérent avec `sumHeures`.
2. **Salarié à 0h** : présent dans la grille (référentiel Admin), pas masqué.
3. **États** : validé (plein) / prévu (pointillé) / vide nettement distincts ;
   week-end en fond discret ; clic cellule → CR source.
4. **Vues jour / semaine** : mêmes chiffres, agrégés sur la bonne plage.
5. **En-tête** : compteur de CR non validés exact et nominatif ; « Clôturer »
   désactivé tant qu'il reste des jours à valider ; export confirmé si non propre.
6. **Sous-total semaine** coloré au-delà du seuil ; total mois = somme des semaines.
7. **Lecture seule** : aucune écriture dans `pointages` (Parties 1–2).

## Hors périmètre (à signaler, ne pas traiter)
- Table `ouvriers` normalisée avec id (fiabiliserait la jointure par nom).
- Calcul automatique des majorations d'heures sup.
- Interface de saisie du planning prévisionnel (on lit l'existant, on ne le crée pas).
