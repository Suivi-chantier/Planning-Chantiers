# Projet : Préparer le chantier (parcours guidé par logement)

Règles complètes : `CLAUDE.md`, section « Projets longs : travail en autonomie ».
Maquette validée : https://claude.ai/artifact/YVNjAGP7ruWaBJCCyFS87V

> Sections de Loris recopiées depuis sa demande du 06/11/2026 et validées par
> lui le même jour. Projet lancé en autonomie le 06/11/2026.

---

<!-- Sections de Loris : Claude ne les modifie jamais. -->

## Objectif métier

Un ouvrage importé du devis (ex. « MU-001 Doublage de mur, 42 m² ») couvre
souvent plusieurs murs dans plusieurs pièces. Dans le phasage, ses tâches
(« Pose ossature métallique doublage »…) ne disent pas où travailler : les
ouvriers ne savent pas par quel mur commencer.

On veut un parcours guidé, pas à pas, lancé une fois par logement, qui aide le
conducteur de travaux à :

1. partir d'un logement déjà préparé de la même opération (copie) ;
2. définir les pièces ;
3. répartir chaque ouvrage par pièce, et si besoin par mur, en m² ;
4. ajouter des consignes et une photo par pièce (et par mur).

Résultat côté ouvrier : sur le téléphone, une navigation par pièce, avec la
consigne en haut et les tâches de cette pièce.

Les fonctions de pièces existent déjà mais sont enfouies dans Phasage V2 : le
but est de les rendre faciles à utiliser, pas d'ajouter une deuxième logique.

## Règles et invariants

- Respecter `CLAUDE.md`. Calculs dans un module pur
  `src/Renovation/preparationChantierV1.mjs` (avec sa façade `.js`), interface
  dans `src/Renovation/PreparationChantier.jsx`. Ne pas grossir `PhasageV2.jsx`
  au-delà du bouton d'accès.
- Réutiliser l'existant : `piecesPhasageV1.mjs` (`ajouterPiece`,
  `renommerPiece`, `deplacerPiece`, `supprimerPiece`, `rattacherTaches`,
  `grouperParPiece`, `repartirHeures`, `dupliquerTacheParPieces`),
  `PiecesPhasage.jsx`, `phasageMobileV1.mjs` (`nomAffiche`), écrans ouvrier.
- Aucune migration de base si possible : tout tient dans le JSON du phasage
  (`ouvrages[].taches[]` et `plan_travaux.meta`). Si une migration devient
  nécessaire, s'arrêter et demander.
- Ne jamais modifier une tâche déjà commencée (`avancement > 0`,
  `quantite_terminee` présent ou heures pointées) : elle s'affiche « déjà
  commencée, non découpée » et reste telle quelle.
- Total conservé : pour chaque ouvrage découpé, la somme des heures estimées,
  des heures vendues et des ratios de ses tâches est identique avant et après,
  au centième près. Le découpage passe par `dupliquerTacheParPieces`.
- On ne touche jamais à `nom` (lien avec la bibliothèque) : le libellé lisible
  passe par `nom_perso`.
- Écriture du phasage par le même chemin que Phasage V2 (même gestion de
  `revision`, même journal d'avancement). Pas d'écriture directe parallèle.
- Interface : thème existant (`THEMES` dans `src/constants.js`), boutons d'au
  moins 44 px, utilisable sur tablette au chantier.
- Un « Enregistrer et quitter » à chaque étape, reprise là où on s'est arrêté
  (`meta.preparation = { etape, maj_le, par }`).
- Modèle de données (ajouts au JSON existant) : `tache.mur` (texte libre
  facultatif) ; `tache.nom_perso` généré au découpage sous la forme
  `"<nom> — <pièce>[, <mur>]"`, modifiable ; `tache.quantite_part` (m² de la
  part) ; `meta.pieces[i].consigne` ; `meta.pieces[i].consignes_murs =
  [{ mur, texte }]` ; `meta.pieces[i].photos` (chemins dans le bucket `photos`).
- Copie depuis un autre logement : on ne copie jamais l'avancement, les heures
  pointées ni les ouvriers.

## Hors périmètre

(Rien d'indiqué dans la demande.)

## Description des étapes

**Tranche 1 — Pièces et répartition (à livrer en premier).**
Bouton « Préparer le chantier » dans l'en-tête de Phasage V2, parcours en
plein écran. Étape « Les pièces » : ajout rapide (Entrée, Séjour / cuisine,
Chambre, Chambre 2, Salle d'eau, WC, Dégagement, Placard, Cellier, + Autre),
liste réordonnable. Étape « Où se fait chaque ouvrage » : liste des ouvrages
avec état (À placer / En cours / Placé / Déjà commencé) et barre « X / N
placés » ; trois modes (une seule pièce / tout le logement / plusieurs pièces
et murs avec lignes pièce + mur + quantité, « + Autre mur dans la même
pièce », « Reste X m² à placer », validation seulement à 0, raccourci « Mettre
le reste dans… »). Granularité par tâche : par mur ou par pièce ; par défaut
par pièce si le nom contient bande, passe, enduit, ponçage, peinture ou
impression, sinon par mur ; modifiable tâche par tâche. Heures au prorata des
quantités (dernière part absorbe l'arrondi), puis `dupliquerTacheParPieces`.
Aperçu « Ce que verront les ouvriers » avant validation ; l'ouvrage suivant
s'ouvre après validation. Script `scripts/verif-preparation-chantier.mjs`
branché dans un workflow : conservation des totaux, refus de découper une
tâche commencée, fusion par pièce, arrondi.

**Tranche 2 — Consignes, photos et vue ouvrier par pièce.**
Étape « Consignes & plans » : une carte par pièce (consigne, consignes par
mur, photos dans le bucket `photos`, dictée si un composant existe —
`DicteeCompteRendu.jsx`), contrôle final « Toutes les tâches ont une pièce »
ou liste de celles qui n'en ont pas. Côté ouvrier (vue mobile) : onglets par
pièce dans l'ordre de `meta.pieces`, consignes en haut, photos, puis tâches de
la pièce avec `mur` et `quantite_part` en sous-titre.

**Tranche 3 — Copier depuis un autre logement.**
Étape « Point de départ » : logements de la même `operation_id`
(`planning_config.chantiers`) dont la préparation est faite, plus « Partir de
zéro ». Cases à cocher : pièces, répartition, consignes, photos (décochée par
défaut). Correspondance des ouvrages par `bibliotheque_id`, à défaut par
libellé identique ; répartition reprise en proportion si les quantités
diffèrent, affichée à l'étape 3 pour vérification ; ouvrages sans
correspondance « À placer ».

## Validation automatique

- Une demande de fusion par tranche, dans l'ordre 1 → 2 → 3, chacune avec une
  entrée dans `src/Renovation/journalMaj.js` en langage métier.
- Avant de fusionner la tranche 1 : montrer sur un vrai chantier pas encore
  commencé (Louison, Fougeray ou Montillers) le résultat d'un découpage de
  doublage. On ne l'enregistre qu'avec l'accord de Loris.
- Le reste : règle par défaut de `CLAUDE.md`.

---

<!-- Sections de Claude : mises à jour après chaque tâche et avant tout arrêt. -->

## Tâches

| N° | Tâche | Statut | Validation | Preuve de réussite | Demande de fusion |
|----|-------|--------|------------|--------------------|-------------------|
| 1 | Tranche 1a — Moteur de calcul du découpage (module pur `preparationChantierV1.mjs` + façade, script `verif-preparation-chantier.mjs` branché dans un workflow) ; bouton « Préparer le chantier » dans Phasage V2, parcours plein écran, étape « Les pièces », « Enregistrer et quitter » / reprise | en ligne | Auto (contrôles verts) | Vérifications vertes sur GitHub ; le parcours s'ouvre, les pièces s'enregistrent, la reprise revient à la bonne étape | [#199](https://github.com/Suivi-chantier/Planning-Chantiers/pull/199) |
| 2 | Tranche 1b — Étape « Où se fait chaque ouvrage » (3 modes, reste à placer, granularité par tâche, aperçu ouvriers) + entrée `journalMaj.js` | en cours | **Arrêt avant fusion** : démonstration sur LOUISON APPT 2 (T2), rien d'enregistré sans accord | Tableau avant / après du doublage MU-001 (50 m²), totaux identiques au centième | — |
| 3 | Tranche 2a — Étape « Consignes & plans » (consignes, consignes par mur, photos, dictée, contrôle final) | à faire | Auto | Consignes et photos relues après rechargement ; contrôle final juste | — |
| 4 | Tranche 2b — Vue ouvrier par pièce (onglets, consignes, photos, tâches avec mur et m²) + entrée `journalMaj.js` | à faire | Auto | Téléphone : navigation par pièce dans l'ordre de `meta.pieces` | — |
| 5 | Tranche 3 — Copie depuis un autre logement (moteur de correspondance + étape « Point de départ ») + vérifications + entrée `journalMaj.js` | à faire | Auto | Vérifications de copie vertes ; copie d'un logement préparé vers un logement vierge de la même opération | — |

## Journal des décisions

**06/11/2026 — État constaté sur la base (requête réelle, pas une fixture).**
Aucun logement de Louison, Fougeray ou Montillers n'a encore de pièces
(`meta.pieces` vide partout). Candidats pour la démonstration de la tranche 1
(ouvrage doublage présent, aucune tâche commencée dans le phasage) :

| Logement | Doublage | Tâches commencées |
|---|---|---|
| LOUISON APPT 2 (T2) | MU-001, 50 m² | 0 |
| LOUISON APPT 4 (STUDIO) | MU-001, 35 m² | 0 |
| LOUISON APPT 1 (T2) | MU-0051, 72 m² | 0 |
| LOUISON APPT 3 (T4) | MU-0011, 137 m² | 0 |
| FOUGERAY APPT 001 (T2 RDC) | MU-001, 22 m² | 0 |
| FOUGERAY APPT 101 / 102 / 201 / 202 | 18,9 / 14,5 / 8,6 / 7,5 m² | 0 |
| MONTILLERS APPT 3 et 4 | 11 / 15,7 m² | 4 et 1 → écartés |

Les heures pointées n'ont pas encore été vérifiées (elles vivent hors du
phasage) : à contrôler avant la démonstration.

**06/11/2026 — Questions posées à Loris avant de démarrer :**

1. Je lance le projet en autonomie avec ce fichier ? (oui / non)
2. Découpage en 7 demandes de fusion (tableau ci-dessus) au lieu de 3, une
   par tranche ? (7 / 3)
3. Chantier de démonstration pour la tranche 1 : LOUISON APPT 2 (T2,
   doublage 50 m²) ? (oui / autre)

Réponses de Loris (06/11/2026) : 1. oui ; 2. « fais comme tu penses être
le mieux » ; 3. oui, LOUISON APPT 2 (T2).

**06/11/2026 — Découpage retenu : 5 demandes de fusion.** Raison : Loris
souhaite que ça aille vite ; chaque mise en ligne coûte une attente des
contrôles GitHub et du déploiement. Le moteur de calcul est regroupé avec
l'étape « Les pièces » (tâche 1), et la copie (moteur + écran) tient en une
seule tâche (tâche 5). La démonstration avant mise en ligne de la
répartition est conservée (tâche 2).

**06/11/2026 — Organisation des branches.** Toutes les tâches passent par la
branche `claude/hopeful-thompson-3jxtxn`, repartie de `main` après chaque
fusion. Le fichier projet est mis à jour dans la demande de fusion de chaque
tâche.

**06/11/2026 — Tâche 1 : choix techniques.**

- *Nom du script de vérification.* Le fichier projet prévoit
  `scripts/verif-preparation-chantier.mjs`, mais ce nom est déjà pris par
  la vérification de l'écran « préparation » des ouvriers (module
  `preparationChantier.mjs`, sans rapport, lancé par deux workflows).
  Pour ne pas l'écraser, la vérification du découpage s'appelle
  `scripts/verif-preparer-le-chantier.mjs` (workflow
  `verify-fondations-finance.yml`, juste après celle des pièces). Le contenu
  vérifié est celui demandé (totaux conservés, tâche commencée refusée,
  fusion par pièce, arrondi).
- *Format de `meta.preparation`* : `{ etape, maj_le, par, ouvrages_places }`.
  `etape` ∈ `depart` / `pieces` / `repartition` / `consignes` ; `maj_le`
  (horodatage ISO) et `par` (nom ou e-mail du conducteur) sont fournis par
  l'écran, jamais par le module de calcul ; `ouvrages_places` = liste des
  identifiants d'ouvrages marqués « placés ». Les champs inconnus sont
  conservés à chaque enregistrement.
- *Reprise* : on rouvre l'étape enregistrée si elle est déjà disponible,
  sinon « Les pièces » (seule étape disponible dans la tâche 1).
- *État d'un ouvrage* : « Placé » s'il est dans `ouvrages_places` ;
  « Déjà commencé » si TOUTES ses tâches sont commencées (rien à découper) ;
  « En cours » s'il est ouvert à l'écran ou si une partie de ses tâches non
  commencées a déjà une pièce ; sinon « À placer ». Le compteur « X / N
  placés » ne compte pas les ouvrages entièrement commencés.
- *Tâche commencée* : avancement > 0, `quantite_terminee` renseigné, ou
  heures pointées (registre de pointage passé en paramètre, sinon ancien
  champ `heures_reelles`, même lecture que `chantierFinance`).
- *Ouvrage sans quantité au devis* : le découpage par m² est refusé (le
  reste à placer est « inconnu », jamais « 0 ») ; restent « Une seule
  pièce » et « Tout le logement ».
- *Tâche sans heures estimées* (heures portées par le ratio de l'ouvrage) :
  `dupliquerTacheParPieces` partage alors ratio et heures vendues à parts
  égales ; le module les reporte ensuite au prorata des m², avec le même
  arrondi. Les totaux restent identiques (vérifié).
- *Mode « Une seule pièce »* : les tâches non commencées reçoivent la pièce,
  sans libellé `nom_perso` ajouté (inutile quand tout est dans une pièce).
- *Écriture* : le parcours ne parle jamais à la base. Il reçoit `saveMeta`
  et `updateOuvrages` de Phasage V2 (file d'attente avec révision, journal
  d'avancement). Pièces et préparation partent en UN seul `saveMeta` ; les
  tâches d'une pièce retirée sont détachées (`detacherPiece`) via
  `updateOuvrages`, comme dans le panneau « Pièces » existant.
- *Pas d'entrée `journalMaj.js`* dans la tâche 1 : le bouton indique
  clairement que l'étape suivante arrive bientôt ; l'entrée viendra avec la
  tâche 2.

**06/11/2026 — Tâche 1 en ligne.** Demande de fusion #199 fusionnée, tous
les contrôles verts. Déploiement : la version de test Vercel du même code
s'est construite sans erreur ; le site de production n'est pas joignable
depuis la session de travail, son ouverture n'a pas pu être contrôlée
directement. Limite reportée en tâche 2 : « Enregistrer et quitter » ferme
le parcours même si Phasage V2 est en pause pour conflit de révision.

**06/11/2026 — Tâche 2 : choix techniques.**

- *Ouvrage déjà découpé* (une tâche porte déjà `quantite_part` ou `mur`) :
  affiché « Placé » avec sa répartition actuelle, en lecture seule. Le
  parcours ne propose ni de le redécouper ni de le remettre « Tout le
  logement » : redécouper des parts qui ont déjà leurs heures multiplierait
  les tâches et brouillerait les heures. Un changement se fait dans Phasage
  V2, tâche par tâche. Un simple `nom_perso` ne compte pas comme découpage
  (il peut avoir été saisi à la main). Solution la plus sûre retenue.
- *Ouvrage placé mais pas découpé* (« Une seule pièce » ou « Tout le
  logement ») : peut être revalidé ; la nouvelle répartition remplace
  l'ancienne (les tâches n'ont pas été copiées, rien ne se multiplie).
- *Pièces enregistrées avant la répartition* : « Continuer : où se fait
  chaque ouvrage » enregistre d'abord les pièces (une tâche ne doit viser
  qu'une pièce connue en base). Chaque validation d'ouvrage réécrit pièces
  et préparation en un seul `saveMeta` (liste complète, jamais un patch
  partiel), puis l'ouvrage suivant à traiter s'ouvre.
- *Heures pointées* : Phasage V2 transmet son index des pointages par
  tâche ; une tâche pointée est « déjà commencée, non découpée ».
- *Nouvelles fonctions du module pur* : `ouvrageDejaDecoupe`,
  `repartitionActuelle`, `mettreLeResteDans`, `apercuPlacement` (aperçu des
  modes « Une seule pièce » et « Tout le logement »), `ouvrageSuivant` ;
  `etatOuvrage` rend « Placé » pour un ouvrage déjà découpé. Vérification
  complétée (84 contrôles, données fictives).
- *Limite de la tâche 1 corrigée* (« Enregistrer et quitter » pendant un
  conflit de révision) : Phasage V2 passe au parcours `conflit` et l'état de
  sa sauvegarde ; `saveMeta` renvoie maintenant `false` quand rien n'a pu
  être mis en file (dont la pause pour conflit). Le parcours refuse alors
  d'écrire, affiche un message et reste ouvert ; sinon il attend que Phasage
  V2 confirme « Sauvegardé » (au moins 1,2 s, pour couvrir l'attente de 800
  ms de la sauvegarde des ouvrages) avant de se fermer. Sans confirmation au
  bout de 20 s, message et parcours ouvert. Le chemin d'écriture n'est pas
  modifié.
- *Sous-composant* : l'étape est dans `PreparationRepartition.jsx` pour ne
  pas alourdir `PreparationChantier.jsx`.
- *Heures pointées sur LOUISON APPT 2 (T2)* : vérifiées (registre
  `pointages`, requête du 06/11/2026) : aucun pointage sur le chantier,
  aucune tâche commencée dans le phasage.
- *Constat sur les vraies données* : les 6 tâches de MU-001 totalisent
  107 % de ratios et 31,93 h estimées pour 30 h prévues sur l'ouvrage. Le
  découpage conserve ces totaux sans les corriger (hors périmètre).

## Comptes rendus

**Tâche 1 — Tranche 1a (06/11/2026, demande de fusion ouverte, pas encore en ligne).**

Ce qui change pour le conducteur de travaux :

- Dans Phasage V2, un nouveau bouton **« Préparer le chantier »** apparaît
  en haut de l'écran, à côté du bouton PDF.
- Il ouvre un parcours en plein écran, avec les quatre étapes de la
  maquette. Seule l'étape **« Les pièces »** fonctionne pour l'instant ; les
  trois autres sont marquées « bientôt ».
- Étape « Les pièces » : on touche une pièce pour l'ajouter (Entrée, Séjour /
  cuisine, Chambre, Chambre 2, Salle d'eau, WC, Dégagement, Placard,
  Cellier, ou « + Autre pièce… »). On peut renommer, monter / descendre
  (l'ordre sera l'ordre de visite sur le téléphone des ouvriers) et retirer
  une pièce. Les boutons sont assez gros pour une tablette.
- **« Enregistrer et quitter »** garde la liste des pièces (la même que
  celle du bouton « Pièces » de la colonne Tâches) et note où on s'est
  arrêté, quand et par qui. À la réouverture, on revient à cette étape.
  « Quitter sans enregistrer » demande confirmation si on a modifié quelque
  chose. Retirer une pièce qui avait des tâches les remet « sans pièce »,
  après confirmation.
- Le moteur qui découpera un ouvrage par pièce et par mur (étape suivante)
  est livré et vérifié, mais pas encore utilisable à l'écran : rien ne
  change dans le phasage tant que la tâche 2 n'est pas en ligne.

Vérifications : nouvelle vérification automatique du découpage (67
contrôles, données fictives) — totaux d'heures estimées, vendues et ratios
identiques au centième, tâche commencée jamais découpée, fusion par pièce
des bandes / enduits / peintures, arrondi (10 h sur 3 parts = 3,33 + 3,33
+ 3,34). Aucune migration, aucun changement de droits d'accès.

**Tâche 2 — Tranche 1b (06/11/2026, demande de fusion ouverte, pas encore en ligne — en attente de l'accord de Loris sur la démonstration).**

Ce qui change pour le conducteur de travaux :

- Dans « Préparer le chantier », après « Les pièces », le bouton
  **« Continuer : où se fait chaque ouvrage »** enregistre les pièces et
  ouvre l'étape 2.
- À gauche, la liste des ouvrages du devis avec leur état (À placer, En
  cours, Placé, Déjà commencé) et la barre « X / N placés ».
- À droite, trois choix pour l'ouvrage ouvert : **Une seule pièce**,
  **Plusieurs pièces / murs**, **Tout le logement**. En « Plusieurs pièces
  / murs », une ligne par pièce (et par mur si on veut) avec ses m², « +
  Autre mur dans la même pièce », le compteur « Reste X m² à placer » et
  le raccourci « Mettre le reste dans… ». On ne peut valider qu'à 0.
- Pour chaque tâche : « Par mur » ou « Par pièce » (bandes, passes,
  enduits, ponçage, impression et peinture sont proposés par pièce).
- L'aperçu **« Ce que verront les ouvriers »** montre les tâches obtenues
  avant de valider ; après validation, l'ouvrage suivant s'ouvre.
- Une tâche déjà commencée n'est jamais découpée ; un ouvrage déjà découpé
  s'affiche « Placé » avec sa répartition, sans proposer de le redécouper.
- « Enregistrer et quitter » marche aussi à cette étape et on y revient à
  la réouverture. Si le phasage a été modifié ailleurs entre-temps, le
  parcours l'explique et reste ouvert, au lieu de se fermer sans rien dire.
- Nouvelle entrée dans le journal des mises à jour (Phasage).

Vérifications : vérification automatique du découpage complétée (84
contrôles, données fictives). Aucune migration, aucun changement de droits
d'accès. L'écran n'a pas pu être essayé dans un navigateur depuis la
session de travail (pas de dépendances installées) : la construction est
contrôlée par GitHub.

**Démonstration sur LOUISON APPT 2 (T2)** — source : requête en lecture
seule sur la base du 06/11/2026 ; rien n'a été enregistré. Les pièces,
murs et m² par mur sont une hypothèse de démonstration ; les tâches, heures
et ratios sont réels.

#### Démonstration — découpage du doublage MU-001, LOUISON APPT 2 (T2)

**Source** : requête en lecture seule sur la base (table `phasages`, phasage `b75ab2bf…`, révision 10), le 06/11/2026. Rien n'a été écrit en base.
Contrôle de l'extraction : 91 tâches, somme des heures estimées 224,02 h, des heures vendues 230,5 h et des ratios 1 887,5 — identiques entre le fichier extrait et la base (requête de contrôle du même jour).
Les tâches, heures estimées, heures vendues et ratios sont **réels**. Les pièces, murs et m² par mur sont une **hypothèse de démonstration**, à la place de la répartition réelle que fera le conducteur.

Ouvrage : MU-001 :Fourniture et pose d'un doublage de mur (2,5ml haute… — 50 m², heures prévues de l'ouvrage 30 h, prix 3 841 € HT.

Heures pointées : 0 pointage sur tout le chantier dans le registre `pointages`, aucune tâche avec avancement, quantité terminée ou ancien champ d'heures réelles → aucune tâche de MU-001 n'est commencée, toutes sont découpables.

##### Répartition utilisée (hypothèse de démonstration)

| Pièce | Mur | m² |
|---|---|---:|
| Séjour / cuisine | Mur côté rue | 14 |
| Séjour / cuisine | Mur côté palier | 12 |
| Chambre | Mur extérieur | 16 |
| Salle d'eau | Mur extérieur | 8 |
| **Total** | | **50** |

##### (a) Tâches d'origine de MU-001 (réelles)

| Tâche | Heures estimées | Heures vendues | Ratio (%) | Découpage par défaut | Commencée |
|---|---:|---:|---:|---|---|
| Pose ossature métallique doublage | 7,5 | 7,5 | 25 | par mur | non |
| Isolation laine de verre 120mm doublage | 6 | 6 | 20 | par mur | non |
| Plaquage BA13 doublage | 9 | 9 | 30 | par mur | non |
| Bandes et 1ère passe doublage | 4,2 | 4,2 | 14 | par pièce | non |
| 2ème passe doublage | 3,3 | 3,3 | 11 | par pièce | non |
| Passe de finition doublage | 1,93 | 2,8 | 7 | par pièce | non |

##### (b) Tâches après découpage

| Libellé vu par les ouvriers (nom_perso) | Pièce | Mur | m² (quantite_part) | Heures estimées | Heures vendues | Ratio (%) |
|---|---|---|---:|---:|---:|---:|
| Pose ossature métallique doublage — Séjour / cuisine, Mur côté rue | Séjour / cuisine | Mur côté rue | 14 | 2,1 | 2,1 | 7 |
| Pose ossature métallique doublage — Séjour / cuisine, Mur côté palier | Séjour / cuisine | Mur côté palier | 12 | 1,8 | 1,8 | 6 |
| Pose ossature métallique doublage — Chambre, Mur extérieur | Chambre | Mur extérieur | 16 | 2,4 | 2,4 | 8 |
| Pose ossature métallique doublage — Salle d'eau, Mur extérieur | Salle d'eau | Mur extérieur | 8 | 1,2 | 1,2 | 4 |
| Isolation laine de verre 120mm doublage — Séjour / cuisine, Mur côté rue | Séjour / cuisine | Mur côté rue | 14 | 1,68 | 1,68 | 5,6 |
| Isolation laine de verre 120mm doublage — Séjour / cuisine, Mur côté palier | Séjour / cuisine | Mur côté palier | 12 | 1,44 | 1,44 | 4,8 |
| Isolation laine de verre 120mm doublage — Chambre, Mur extérieur | Chambre | Mur extérieur | 16 | 1,92 | 1,92 | 6,4 |
| Isolation laine de verre 120mm doublage — Salle d'eau, Mur extérieur | Salle d'eau | Mur extérieur | 8 | 0,96 | 0,96 | 3,2 |
| Plaquage BA13 doublage — Séjour / cuisine, Mur côté rue | Séjour / cuisine | Mur côté rue | 14 | 2,52 | 2,52 | 8,4 |
| Plaquage BA13 doublage — Séjour / cuisine, Mur côté palier | Séjour / cuisine | Mur côté palier | 12 | 2,16 | 2,16 | 7,2 |
| Plaquage BA13 doublage — Chambre, Mur extérieur | Chambre | Mur extérieur | 16 | 2,88 | 2,88 | 9,6 |
| Plaquage BA13 doublage — Salle d'eau, Mur extérieur | Salle d'eau | Mur extérieur | 8 | 1,44 | 1,44 | 4,8 |
| Bandes et 1ère passe doublage — Séjour / cuisine | Séjour / cuisine | — | 26 | 2,18 | 2,18 | 7,27 |
| Bandes et 1ère passe doublage — Chambre | Chambre | — | 16 | 1,34 | 1,34 | 4,47 |
| Bandes et 1ère passe doublage — Salle d'eau | Salle d'eau | — | 8 | 0,68 | 0,68 | 2,26 |
| 2ème passe doublage — Séjour / cuisine | Séjour / cuisine | — | 26 | 1,72 | 1,72 | 5,73 |
| 2ème passe doublage — Chambre | Chambre | — | 16 | 1,06 | 1,06 | 3,53 |
| 2ème passe doublage — Salle d'eau | Salle d'eau | — | 8 | 0,52 | 0,52 | 1,74 |
| Passe de finition doublage — Séjour / cuisine | Séjour / cuisine | — | 26 | 1 | 1,45 | 3,63 |
| Passe de finition doublage — Chambre | Chambre | — | 16 | 0,62 | 0,9 | 2,25 |
| Passe de finition doublage — Salle d'eau | Salle d'eau | — | 8 | 0,31 | 0,45 | 1,12 |

6 tâches avant → 21 tâches après (15 nouvelles). Le nom de bibliothèque (`nom`) de chaque tâche est inchangé.

##### (c) Totaux de l'ouvrage avant / après

| Total MU-001 | Avant | Après | Écart |
|---|---:|---:|---:|
| Heures estimées des tâches | 31,93 | 31,93 | 0 |
| Heures vendues des tâches | 32,8 | 32,8 | 0 |
| Somme des ratios (%) | 107 | 107 | 0 |

##### (d) Contrôle financier (simulation en mémoire, fonctions de `src/chantierFinance.mjs`)

| Indicateur | Avant | Après | Écart |
|---|---:|---:|---:|
| MU-001 — heures prévues (somme des heures prévues des tâches) | 30 | 30 | 0 |
| MU-001 — heures restantes | 30 | 30 | 0 |
| MU-001 — heures vendues de l'ouvrage | 30 | 30 | 0 |
| MU-001 — prix HT (€) | 3 841 | 3 841 | 0 |
| MU-001 — avancement (%) | 0 | 0 | 0 |
| Chantier — heures prévues (toutes tâches) | 222,44 | 222,44 | 0 |
| Chantier — avancement (%) | 0 | 0 | 0 |
| Chantier — brut.prixHTChantier (computeChantierFinance) | 29 430,58 | 29 430,58 | 0 |
| Chantier — brut.heuresVenduesChantier (computeChantierFinance) | 226,44 | 226,44 | 0 |
| Chantier — brut.heuresReellesChantier (computeChantierFinance) | 0 | 0 | 0 |
| Chantier — brut.coutMOChantier (computeChantierFinance) | 0 | 0 | 0 |

Comparaison complète du résultat de `computeChantierFinance` (sans pointages, sans commandes : il n'y a aucun pointage sur ce chantier) : 140 valeurs numériques comparées, 0 écart(s).

Phasage d'origine non modifié en mémoire : oui.

###### À savoir sur cet ouvrage (constaté sur les vraies données, sans lien avec le découpage)

Les tâches de MU-001 totalisent 107 % de ratios, 31,93 h estimées et 32,8 h vendues, pour 30 h prévues sur l'ouvrage (la « Passe de finition doublage » a 1,93 h estimées pour 2,8 h vendues). Le découpage conserve ces totaux tels quels ; il ne corrige pas cet écart, qui se règle par le bouton « % » de Phasage V2.
