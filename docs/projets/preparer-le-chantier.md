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
| 1 | Tranche 1a — Moteur de calcul du découpage (module pur `preparationChantierV1.mjs` + façade, script `verif-preparation-chantier.mjs` branché dans un workflow) ; bouton « Préparer le chantier » dans Phasage V2, parcours plein écran, étape « Les pièces », « Enregistrer et quitter » / reprise | en cours | Auto (contrôles verts) | Vérifications vertes sur GitHub ; le parcours s'ouvre, les pièces s'enregistrent, la reprise revient à la bonne étape | — |
| 2 | Tranche 1b — Étape « Où se fait chaque ouvrage » (3 modes, reste à placer, granularité par tâche, aperçu ouvriers) + entrée `journalMaj.js` | à faire | **Arrêt avant fusion** : démonstration sur LOUISON APPT 2 (T2), rien d'enregistré sans accord | Tableau avant / après du doublage MU-001 (50 m²), totaux identiques au centième | — |
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

## Comptes rendus

(Aucune tâche commencée.)
