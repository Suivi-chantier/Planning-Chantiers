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
| 1 | Calculs sans changement d'affichage : `fiabiliteMargeProbableV3`, tendance 6 semaines, fourchette (fonctions pures dans `bilanPeriodeV3.mjs`), seuils de fiabilité dans `normaliserSeuilsMarges` + `SeuilsMargesAdmin`, tests dans `scripts/verif-bilan-periode.mjs` (ou nouveau `verif-*` branché) | en ligne | Auto (contrôles verts) | Les 4 cas de fiabilité demandés + cas de tendance et de fourchette verts sur GitHub ; aucune formule de `chantierFinance.mjs` modifiée | [#206](https://github.com/Suivi-chantier/Planning-Chantiers/pull/206) (fusionnée) |
| 2 | Haut du PDF détaillé : nouveau tableau de synthèse (ligne TOTAL, fourchette, fiabilité, tendance) + détail des marges complété (budget restant, €/h avec repère devis, une phrase par marge) ; chargement des relevés sur 6 semaines dans `BilanPeriode.jsx` + entrée `journalMaj.js` | en ligne | Auto | Contrôles verts ; version direction inchangée | [#208](https://github.com/Suivi-chantier/Planning-Chantiers/pull/208) (fusionnée) |
| 3 | Fiches et annexe : cascade seulement si baisse > seuil ou pastille rouge, sinon « Marge probable stable (±X €) » ; méthode retirée, case « Joindre la méthode de calcul » décochée par défaut + entrée `journalMaj.js` | en ligne | Auto | Contrôles verts ; méthode absente par défaut, présente si cochée | [#209](https://github.com/Suivi-chantier/Planning-Chantiers/pull/209) (fusionnée) |
| 4 | PDF d'exemple : ancien et nouveau PDF détaillé de la dernière semaine réelle, construits depuis la base | en ligne (PDF remis à Loris) | Livrable à Loris | Deux PDF sur les vrais chantiers, chiffres de marge identiques entre ancien et nouveau | — (aucun changement de code) |
| 5 | Finitions vues sur le PDF réel : cellule TOTAL de la marge probable qui écrase les colonnes, explication de fiabilité trop longue (6–7 lignes par chantier), pluriel « 0 chantier(s) » ; selon les réponses de Loris : lecture de la marge devis (`mo_prev`) et sens de l'écart dans « Marge probable stable » | en ligne | Auto | Nouveau PDF W44 : une ligne par chantier sans texte tassé ; total de marge probable affiché si Loris accepte la correction | [#211](https://github.com/Suivi-chantier/Planning-Chantiers/pull/211) |

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
- 06/11/2026 — #206 fusionnée, contrôles tous verts. Le site de production
  n'est pas joignable depuis la session (proxy) ; la prévisualisation Vercel du
  même code a été construite avec succès (« Ready »). Tâche 2 lancée.
- 06/11/2026 — Tâche 2 livrée en #208. Choix retenus : la ligne TOTAL reprend
  les totaux du bandeau tels quels (« même chiffre = même service ») ; la marge
  probable totale du bandeau ne compte que les chantiers comparables (marge
  devis connue), et la cellule TOTAL le dit (« N chantiers, comme le
  bandeau ») plutôt que d'afficher un second total différent. Pour une période
  autre qu'une semaine, les en-têtes deviennent « Généré sur la période » /
  « Marge de la période ». Chargement des relevés inchangé : il couvrait déjà
  les 6 semaines.
- 06/11/2026 — #208 fusionnée, contrôles tous verts, prévisualisation Vercel
  « Ready ». Tâche 3 lancée.
- 06/11/2026 — Tâche 3 livrée en #209, fusionnée (contrôles verts). Règle
  retenue pour la cascade : pastille rouge, évolution inconnue (pas de relevé
  de départ) ou baisse > seuil → cascade ; hausse > seuil → « Marge probable
  en hausse (+X €) » ; sinon « Marge probable stable (±X €) ». Une baisse
  exactement égale au seuil compte comme stable (même règle que la pastille).
  Tâche 4 lancée : PDF construits hors navigateur depuis la base ; ils ne
  sont pas versionnés dans le dépôt (données financières réelles).
- 06/11/2026 — Tâche 4 : semaine 2026-W44 (dernière semaine complète ; W45
  en cours). Chiffres identiques ancien / nouveau sur les 7 chantiers.
  Découverte : la marge prévue au devis n'est jamais affichée dans le Bilan
  (« Marge devis inconnue » partout, « Marge probable (0 chantiers) — » dans le
  bandeau) parce que l'écran ne lit pas la colonne `mo_prev` des relevés
  (absente de `COLONNES_COMPLETES` dans `BilanPeriode.jsx`), alors qu'elle est
  remplie en base. Défaut antérieur au projet (les exports réels W43 et
  novembre l'ont aussi) ; il prive la ligne TOTAL de sa marge probable, donc la
  question 3 de l'objectif n'a pas de total. Corriger touche aussi la version
  direction (hors périmètre) : arrêt, question à Loris. Tâche 5 ajoutée pour
  les finitions d'affichage vues sur le PDF réel.

### Question en attente (06/11/2026)

1. Je corrige la lecture de la marge devis (colonne déjà remplie en base, non
   lue par l'écran) ? Effet : la marge devis, l'écart au devis et le total de
   la marge probable apparaissent, y compris dans la version direction. Aucun
   calcul ne change.
2. « Marge probable stable (±217 €) » cache le sens : j'écris plutôt « stable
   (−217 €) » / « stable (+98 €) » ?

Réponse de Loris (06/11/2026) : « 1 oui, 2 oui ». La marge devis est lue
(colonne `mo_prev`), y compris pour la version direction ; la ligne « stable »
affiche l'écart signé, ce qui remplace le « ±X € » de l'étape 6 sur décision de
Loris. Tâche 5 lancée.
- 06/11/2026 — Tâche 5 livrée en #211. Colonnes ajoutées à la lecture des
  relevés : `mo_prev` (marge devis) et `reste_a_faire_h` (sans elle, la
  cascade « du devis au probable » restait incomplète même avec la marge
  devis). Un contrôle automatique vérifie désormais que l'écran charge toutes
  les colonnes dont la marge devis a besoin. Version direction : sur le jeu
  d'essai, HTML identique ; sur les vraies données, la marge devis, l'écart au
  devis et le total de marge probable apparaissent (accord de Loris).

## Comptes rendus

### Tâche 1 — calculs (06/11/2026)

Ajouts sans effet visible dans le PDF : calcul de la fiabilité de la marge
probable (bonne / moyenne / faible, ou inconnue si l'avancement l'est), de la
tendance sur 6 semaines et de la fourchette. Quatre nouveaux seuils réglables
dans l'écran Admin des seuils de marges (25 / 60 % d'avancement, 30 / 70 % de
couverture). Aucun calcul de marge modifié : dans `chantierFinance.mjs`, seules
les 4 valeurs par défaut ont été ajoutées. Script de vérification local :
154 contrôles OK (exemples issus des tests, données fictives).


### Tâche 2 — haut du PDF détaillé (06/11/2026)

Le PDF détaillé s'ouvre sur un tableau qui répond aux 3 questions : une ligne
TOTAL en tête (généré, marge de la semaine, marge probable), puis une ligne par
chantier avec avancement, généré cette semaine, marge de la semaine (€ et % de
la production), marge probable (€ et % du vendu), fourchette, fiabilité et
tendance sur 6 semaines. Le détail des marges qui suit gagne le budget restant
et les € produits par heure (avec le repère du devis en gris), avec une phrase
d'explication par marge. La version direction est inchangée (HTML identique
avant / après sur le même jeu d'essai). Aucun calcul de marge modifié.
Scripts : 171, 44 et 63 contrôles OK (exemples issus des tests, données
fictives). Entrée ajoutée dans `journalMaj.js`.

### Tâche 3 — fiches et méthode (06/11/2026)

Dans les fiches chantier du PDF détaillé, l'explication « du devis au
probable » n'apparaît plus que pour les chantiers dont la pastille est rouge,
dont la marge probable a baissé de plus du seuil (500 € par défaut) sur la
période, ou dont l'évolution est inconnue faute de relevé de départ. Les autres
fiches portent une ligne « Marge probable stable (±X €) » ou « Marge probable
en hausse (+X €) ». La méthode de calcul n'est plus dans le PDF par défaut :
case « Joindre la méthode de calcul » (décochée) à côté de « Version
détaillée ». Le bilan archivé est exactement le PDF téléchargé. Scripts : 63,
173 et 63 contrôles OK (exemples issus des tests, données fictives). Entrée
ajoutée dans `journalMaj.js`.

### Tâche 4 — PDF d'exemple sur la semaine 2026-W44 (06/11/2026)

Deux PDF détaillés reconstitués hors application depuis la base (lecture
seule), mêmes données pour les deux : l'ancien rendu (avant le projet) et le
nouveau. Non versionnés (données financières réelles). Sans synthèse relue,
photos, commentaires ni « semaine qui vient » (saisis à l'écran ou calculés par
le moteur de planning).

Chiffres lus en base, ancien = nouveau, écart nul partout :

| Chantier | Production | Marge de la période | Marge probable |
|---|---|---|---|
| FOURMOND 001 | 3 377,72 € | +68,99 € | +4 134,52 € |
| FOURMOND 101 | 5 033,59 € | +1 200,77 € | +3 205,73 € |
| FOURMOND 102 | 4 594,18 € | +1 074,08 € | +953,75 € |
| FOURMOND COMMUNS | 0 € | −107,72 € | +1 501,73 € |
| KATHLEEN T2 | 659,01 € | +210,31 € | +8 314,10 € |
| MONTILLERS APPT 2 (T2) | 0 € | 0 € | +14 709,79 € |
| MONTILLERS APPT 4 (T2) | 0 € | 0 € | +14 757,33 € |
| Total | 13 664,50 € | +2 446,43 € (18 %) | « — » (0 chantier comparable) |

Nouveau PDF : 9 pages au lieu de 11 ; cascade dans 2 fiches (FOURMOND 001 et
101, pastille rouge), « stable » dans 5 ; fiabilité bonne 1, moyenne 3,
faible 3 ; tendance incomplète (« · ») pour 3 chantiers récents.

### Tâche 5 — marge devis relue, écart signé, tableau lisible (06/11/2026)

Le Bilan relit la marge prévue au devis, enregistrée dans chaque relevé mais
jamais chargée par l'écran. Sur la semaine 2026-W44 (chiffres lus en base,
PDF reconstitué hors application) :

| Chantier | Marge devis | Marge probable | Écart au devis |
|---|---|---|---|
| FOURMOND 001 | +15 702,55 € (38,9 %) | +4 134,52 € | −11 568,03 € |
| FOURMOND 101 | +12 923,41 € (38,1 %) | +3 205,73 € | −9 717,68 € |
| FOURMOND 102 | +11 075,12 € (37,2 %) | +953,75 € | −10 121,37 € |
| FOURMOND COMMUNS | +2 332,81 € (39,4 %) | +1 501,73 € | −831,08 € |
| KATHLEEN T2 | +10 404,42 € (47,7 %) | +8 314,10 € | −2 090,32 € |
| MONTILLERS APPT 2 (T2) | +16 056,56 € (45,5 %) | +14 709,79 € | −1 346,77 € |
| MONTILLERS APPT 4 (T2) | +16 083,93 € (40,6 %) | +14 757,33 € | −1 326,60 € |

Total de la marge probable dans le bandeau : +47 577 € (23 % du vendu), contre
+84 579 € (40,9 %) prévus au devis. Production, marge de la période et marge
probable de chaque chantier identiques à la tâche 4 (aucun calcul modifié).
Barème des frais généraux absent en base : taux par défaut, comme dans le
Phasage. Ligne « stable » avec écart signé (FOURMOND 102 : « stable
(−217 €) »). Tableau de synthèse et détail des marges tiennent sur la page 1 ;
PDF de 8 pages (11 avant le projet). Scripts : 194, 66 et 63 contrôles OK
(exemples issus des tests, données fictives).

Reste visible : dans « Détail des marges », les noms de chantier passent
encore sur deux lignes ; la fiabilité occupe 2 à 3 lignes par chantier.

## Synthèse de fin de projet (06/11/2026)

**Ce qui change pour la direction.** Le PDF détaillé du Bilan s'ouvre sur un
tableau qui répond aux trois questions, chantier par chantier et au total :
combien on a généré, combien on a gagné en marge dans la semaine, et où va
chaque chantier (marge probable, fourchette entre « au rythme actuel » et « si
le reste suit le devis », fiabilité bonne / moyenne / faible avec sa raison,
tendance sur 6 semaines). Le détail des marges suit, avec le budget restant et
les € produits par heure. Les fiches ne détaillent le passage « du devis au
probable » que pour les chantiers qui décrochent ; les autres disent en une
ligne « stable (−217 €) » ou « en hausse (+X €) ». La méthode de calcul ne sort
plus que si on coche « Joindre la méthode de calcul ». La marge prévue au devis
et le total de la marge probable réapparaissent, dans les deux versions du PDF.

**Pour les conducteurs et les ouvriers** : rien ne change.

**Chiffres avant / après** (semaine 2026-W44, base réelle) : production,
marge de la semaine et marge probable identiques sur les 7 chantiers (voir
tâches 4 et 5). Ce qui apparaît : marge devis totale +84 579 €, marge probable
totale +47 577 €, soit 37 002 € d'écart au devis, dont −31 407 € sur les trois
logements FOURMOND 001, 101 et 102.

**Points en suspens** : noms de chantier sur deux lignes dans « Détail des
marges » ; barème des frais généraux absent en base (taux par défaut) ; le
site de production n'a pas pu être ouvert depuis la session (accès réseau
bloqué), seules les prévisualisations Vercel ont été vérifiées.

**Entrées ajoutées dans `src/Renovation/journalMaj.js`** :
- « Bilan détaillé : le PDF s'ouvre sur un tableau qui dit combien on a
  généré, combien on a gagné et où va chaque chantier » ;
- « Bilan détaillé : fiches chantier plus courtes, et méthode de calcul
  seulement si on la demande » ;
- « Bilan : la marge prévue au devis réapparaît, avec le total de la marge
  probable ».


## Suite du 06/11/2026 — marge à terminaison et PDF direction allégé

Demande de Loris (après le projet) : « Il faut ajouter la marge à terminaison,
je ne la vois pas sur le PDF mensuel », puis, sur le PDF direction d'octobre :
« les 3 dernières pages ne servent à rien, retire-les ».

- **Marge à terminaison** (où le chantier finit si le reste se passe comme le
  devis) : nouvelle colonne juste avant la marge probable, en € et en % du
  vendu, dans le tableau des chantiers des deux versions du PDF ; « — » si
  elle n'est pas connue, jamais 0. Le bandeau donne son total « à
  terminaison », calculé sur exactement les mêmes chantiers que le total de
  la marge probable (inconnu dès qu'un de ces chantiers n'a pas de marge à
  terminaison). La ligne TOTAL du PDF détaillé le reprend. Chiffre déjà
  enregistré dans chaque relevé : aucun calcul ne change.
- **Version direction** : elle s'arrête après les alertes, les décisions
  attendues et les tendances par lot. La semaine qui vient, le prévu /
  réalisé, la fin prévisionnelle et les rectifications ne sont plus que dans
  la version détaillée. Seul l'affichage est retiré : ce qui est archivé à
  chaque export ne change pas, les rectifications et le prévu / réalisé des
  bilans suivants continuent de fonctionner.

Semaine 2026-W44, chiffres lus en base (relevés du 29/10/2026), PDF
reconstitués hors application :

| Chantier | Marge à terminaison | Marge probable |
|---|---|---|
| FOURMOND 001 | +8 518,02 € (21,1 %) | +4 134,52 € (10,2 %) |
| FOURMOND 101 | +5 830,41 € (17,2 %) | +3 205,73 € (9,5 %) |
| FOURMOND 102 | +4 586,03 € (15,4 %) | +953,75 € (3,2 %) |
| FOURMOND COMMUNS | +1 501,73 € (25,4 %) | +1 501,73 € (25,4 %) |
| KATHLEEN T2 | +9 068,48 € (41,6 %) | +8 314,10 € (38,2 %) |
| MONTILLERS APPT 2 (T2) | +14 782,54 € (41,9 %) | +14 709,79 € (41,7 %) |
| MONTILLERS APPT 4 (T2) | +15 777,86 € (39,8 %) | +14 757,33 € (37,3 %) |
| Total du bandeau (7 chantiers) | +60 065 € (29 %) | +47 577 € (23 %) |

PDF direction : 2 pages ; PDF détaillé : 8 pages, tableau du haut lisible
avec les noms de chantier sur une ligne. Entrée ajoutée dans `journalMaj.js`
(« Bilan : la marge à terminaison apparaît dans les deux PDF, et la version
direction est plus courte »).
