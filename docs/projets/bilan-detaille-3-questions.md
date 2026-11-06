# Projet : Bilan détaillé — répondre d'abord à 3 questions

Règles complètes : `CLAUDE.md`, section « Projets longs : travail en autonomie ».

> Sections de Loris recopiées depuis sa demande du 06/11/2026 ; réponses de
> Loris aux trois questions préalables notées dans le journal. Projet lancé en
> autonomie le 06/11/2026.

---

<!-- Sections de Loris : Claude ne les modifie jamais. -->

## Objectif métier

Refonte du Bilan de la semaine, VERSION DÉTAILLÉE uniquement (c'est la seule
que Loris exporte et partage). Le PDF doit répondre d'abord à 3 questions,
chantier par chantier et au total :

1. Combien d'argent on a généré cette semaine (production de la période).
2. Combien on a gagné en marge cette semaine (marge de la période).
3. Où va chaque chantier (marge probable, sa fourchette, sa fiabilité, sa
   tendance).

## Règles et invariants

- Aucun calcul de marge ne change : `src/chantierFinance.mjs` est la source de
  vérité. Seule exception acceptée par Loris le 06/11/2026 : y ajouter les
  seuils de fiabilité et leurs valeurs par défaut dans
  `normaliserSeuilsMarges` (aucune formule touchée).
- On ne fait que lire les relevés existants et réorganiser l'affichage.
- « — » si inconnu, jamais 0.
- Modules purs testables (`.mjs`, façade `.js`, aucune horloge, aucun accès
  Supabase).

## Hors périmètre

- La version direction du PDF.
- L'onglet « Détail des comptes rendus » (`BilanSemaine.jsx`) et son ancien
  export (impression navigateur, e-mail, `METHODE_CALCUL`) : ce n'est pas le
  chemin du bouton d'export du Bilan.

## Description des étapes

Chemin d'export réel (vérifié le 06/11/2026) : page `BilanPeriode.jsx`, case
« Version détaillée », bouton « Télécharger le PDF » → `documentBilanV3` →
`htmlBilanDetailleV3` / `corpsBilanV3` dans `src/Renovation/bilanPdfV3.mjs`.

1. **Tableau de synthèse** (remplace `syntheseHtml` en version détaillée). Une
   ligne par chantier, colonnes dans cet ordre : Chantier (pastille +
   mentions) | Avancement | Généré cette semaine (production) | Marge de la
   semaine (€ + % de la production) | Marge probable (€ + % du vendu) |
   Fourchette | Fiabilité | Tendance 6 semaines. Ligne TOTAL en haut du tableau
   avec les mêmes trois montants (reprendre `bandeauV3`).
2. **Fourchette de la marge probable** : de la marge probable (« au rythme
   actuel », `marge_probable`) à la marge à terminaison (« si le reste se passe
   comme le devis », `marge_terminaison`). Affichage « entre +8 400 € et
   +11 200 € ». Si les deux sont égales à 1 € près : « pas de dérive en
   cours ».
3. **Niveau de fiabilité** — nouvelle fonction pure dans `bilanPeriodeV3.mjs` :
   `fiabiliteMargeProbableV3({ avancement, lots })` → `{ niveau: "bonne" |
   "moyenne" | "faible", raison }`, `lots` = `fin.lots` du relevé.
   a) Note d'avancement : < 25 % faible, 25–60 % moyenne, > 60 % bonne.
   b) Note de couverture : part des heures restantes prévues
   (`heuresRestantesPrevues`) des lots non terminés dont
   `provenanceCoefficient` = « constatee » ou « neutralisee ». ≥ 70 % bonne,
   30–70 % moyenne, < 30 % faible. Aucune heure restante → bonne.
   Niveau retenu = la plus basse des deux notes. `raison` = phrase courte, ex.
   « 35 % avancé · coefficients constatés sur 40 % des heures restantes ».
   Seuils dans `normaliserSeuilsMarges` (réglables dans `SeuilsMargesAdmin`)
   avec ces valeurs par défaut. Tests unitaires : chantier neuf, chantier à
   80 % tout constaté, chantier à 50 % tout « aucune », chantier sans heures
   restantes.
4. **Tendance 6 semaines** : pour chaque chantier, la marge probable en fin de
   chacune des 6 dernières semaines (relevé au plus tard à chaque fin de
   semaine : `releveAuPlusTardV3`). Affichage compact : petites flèches ▲ ▼ =
   semaine par semaine (seuil 1 €), plus l'évolution totale en € sur 6
   semaines. Semaine sans relevé : « · ». Fonction pure, avec tests.
5. **Détail des marges** (`margesDetailHtml`) : on garde tout. Tableau par
   chantier, juste après la synthèse : Production · Marge de la période ·
   Marge à l'avancement · Marge à terminaison · Marge probable · Matériaux en
   avance · Budget restant · € produits / h (avec repère devis en gris).
   Ajouter budget restant et €/h (déjà présents dans `syntheseChantiersV3`).
   Note de bas de tableau d'une phrase par marge, pas plus.
6. **Fiches chantier** : la cascade « Du devis au probable » (`cascadeHtml`)
   n'apparaît que dans les fiches des chantiers dont la marge probable a baissé
   de plus du seuil `alerteBaisseMargeProbableEuros` sur la période, ou dont la
   pastille est rouge. Pour les autres : une ligne « Marge probable stable
   (±X €) ». Le reste des fiches ne change pas.
7. **Méthode de calcul** : retirée du PDF hebdomadaire. Dans l'écran du Bilan
   (`BilanPeriode.jsx`) : case à cocher « Joindre la méthode de calcul »
   (décochée par défaut) qui la remet en annexe à l'export.

Livrables : diff fichier par fichier, tests verts, et un PDF d'exemple sur la
dernière semaine réelle pour comparer avec l'ancien.

## Validation automatique

Règle par défaut de `CLAUDE.md`.

---

<!-- Sections de Claude : mises à jour après chaque tâche et avant tout arrêt. -->

## Tâches

| N° | Tâche | Statut | Validation | Preuve de réussite | Demande de fusion |
|----|-------|--------|------------|--------------------|-------------------|
| 1 | Calculs sans changement d'affichage : `fiabiliteMargeProbableV3`, tendance 6 semaines, fourchette (fonctions pures dans `bilanPeriodeV3.mjs`), seuils de fiabilité dans `normaliserSeuilsMarges` + `SeuilsMargesAdmin`, tests dans `scripts/verif-bilan-periode.mjs` (ou nouveau `verif-*` branché) | en cours | Auto (contrôles verts) | Les 4 cas de fiabilité demandés + cas de tendance et de fourchette verts sur GitHub ; aucune formule de `chantierFinance.mjs` modifiée | [#206](https://github.com/Suivi-chantier/Planning-Chantiers/pull/206) (ouverte, contrôles en cours) |
| 2 | Haut du PDF détaillé : nouveau tableau de synthèse (ligne TOTAL, fourchette, fiabilité, tendance) + détail des marges complété (budget restant, €/h avec repère devis, une phrase par marge) ; chargement des relevés sur 6 semaines dans `BilanPeriode.jsx` + entrée `journalMaj.js` | à faire | Auto | Contrôles verts ; version direction inchangée | — |
| 3 | Fiches et annexe : cascade seulement si baisse > seuil ou pastille rouge, sinon « Marge probable stable (±X €) » ; méthode retirée, case « Joindre la méthode de calcul » décochée par défaut + entrée `journalMaj.js` | à faire | Auto | Contrôles verts ; méthode absente par défaut, présente si cochée | — |
| 4 | PDF d'exemple : ancien et nouveau PDF détaillé de la dernière semaine réelle, construits depuis la base | à faire | Livrable à Loris | Deux PDF sur les vrais chantiers, chiffres de marge identiques entre ancien et nouveau | — |

## Journal des décisions

- 06/11/2026 — Chemin d'export vérifié avant tout changement : le bouton du
  Bilan passe par `BilanPeriode.jsx` → `bilanPdfV3.mjs`. `BilanSemaine.jsx`
  (onglet « Détail des comptes rendus », rendu `METHODE_CALCUL`) n'est pas
  concerné. La méthode du PDF détaillé est `methodeBilanV3`.
- 06/11/2026 — Questions posées à Loris, réponses : « 1 oui, 2 oui, 3 go
  projet ».
  1. Seuils de fiabilité ajoutés dans `normaliserSeuilsMarges`
     (`chantierFinance.mjs`), sans toucher aux formules : oui.
  2. Un coefficient de provenance « historique » ne compte pas comme couvert
     (seuls « constatee » et « neutralisee » comptent) : oui.
  3. Passage en mode projet, découpage en 4 tâches : oui.
- 06/11/2026 — Pas de migration prévue : les seuils sont stockés avec les
  autres réglages de marges.
- 06/11/2026 — Tâche 1 livrée en #206. Choix retenus par le pilote :
  avancement inconnu → fiabilité « inconnue » (niveau vide), jamais « faible » ;
  `releveAuPlusTardV3` reprend le dernier relevé connu, donc pour respecter
  « Semaine sans relevé : « · » » la tâche 2 affichera « · » quand
  `releveDansLaSemaine` est faux ; le dernier point de la tendance sera
  `bornes.dateFin` pour coïncider avec la marge probable de la synthèse.

## Comptes rendus

### Tâche 1 — calculs (06/11/2026)

Ajouts sans effet visible dans le PDF : calcul de la fiabilité de la marge
probable (bonne / moyenne / faible, ou inconnue si l'avancement l'est), de la
tendance sur 6 semaines et de la fourchette. Quatre nouveaux seuils réglables
dans l'écran Admin des seuils de marges (25 / 60 % d'avancement, 30 / 70 % de
couverture). Aucun calcul de marge modifié : dans `chantierFinance.mjs`, seules
les 4 valeurs par défaut ont été ajoutées. Script de vérification local :
154 contrôles OK (exemples issus des tests, données fictives).

