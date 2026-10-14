# Spécification — Import d'un relevé iMapper dans la page Plans

Oct 15, 2026 · @General

## Objectif

En un seul import (le DXF du plan automatique iMapper + les PDF « pour les devis » d'un même projet), la page Plans affiche un plan de l'existant abouti et éditable, du niveau du prototype du 15/10/2026, sans aucune saisie sur la plateforme iMapper.

Le résultat attendu dans l'éditeur, sans clic supplémentaire :

- les pièces fermées, nommées, colorées, avec leur surface ;
- les murs avec leur épaisseur et les cotes intérieures ;
- les portes (avec sens d'ouverture), fenêtres, baies et placards, chacun avec un statut « confirmé » ou « à vérifier » ;
- les 10 photos de chaque pièce, rattachées à leur mur ;
- les observations proposées par l'IA à partir des photos ;
- un panneau de métrés par pièce (sol, périmètre, plinthes, murs bruts et nets) ;
- la liste des points à valider.

Tout doit rester modifiable par le conducteur de travaux, et les métrés se recalculent à chaque modification.

Règle de fond : les dimensions viennent toujours de la géométrie, jamais de l'IA. L'IA interprète (type d'ouverture, équipements, alertes), elle ne mesure pas.

## Fichiers d'entrée

Deux exports iMapper suffisent, obtenus après avoir lancé le plan automatique sur la plateforme. Les autres formats testés (JSON, EGI, IFC4, IFC Revit, LDossier, vecXml, PNG) n'apportent rien de plus et ne sont pas pris en charge.

**1. DXF « pour AutoCAD (plan éditable) »** — un seul fichier, version AC1009 (R12), unités en mètres ($INSUNITS = 6).

| Calque | Entité | Contenu | Usage |
| --- | --- | --- | --- |
| A-AREA-ONE-POLYLINE | POLYLINE fermée | 1 polygone par pièce (face intérieure des murs) | pièces |
| A-WALL | POLYLINE fermée | 1 polygone par tronçon de mur, avec épaisseur | rendu des murs, épaisseurs |
| A-WALL-MERGED | POLYLINE fermée | murs fusionnés | non utilisé |
| A-WALL-CNTR | LINE | axes des murs | non utilisé |
| A-ANNO-DIMS | LINE + TEXT | cotes iMapper | non utilisé (recalculées) |
| A-AREA, A-AREA-IDEN | LINE + TEXT | surfaces écrites | contrôle croisé seulement |
| V-SURV-PTS-Scan\_‹projet›*‹scan›*‹nom› | POINT | points bruts du scan | détection des ouvertures |
| V-SURV-ORIG-Scan\_‹projet›*‹scan›*‹nom› | POINT (+ LINE, CIRCLE) | position du scanner | nommage des pièces |

Le nom de pièce dans le calque est tronqué à 5 caractères (Salon, Chamb, Buand, Salle, Cuisi, Entre). Deux scans peuvent porter le même nom. Le numéro ‹projet› diffère du numéro de partage iMapper.

**2. PDF « pour les devis »** — un fichier par pièce, nommé `imapper-‹horodatage›_‹n›.pdf`, 2 pages, produit par jsPDF.

- Page 1 : en-tête « ‹Projet› — Pièce #‹k› », le plan de la pièce, et la ligne « Aire : 11.70 m² · Périmètre : 13774 mm ».
- Page 1 : 10 photos JPEG 1200 × 1600 px intégrées, dans l'ordre de la numérotation iMapper, plus 1 logo (283 × 100 px, à ignorer).
- Page 2 : tableau « ‹n° photo› Mur ‹longueur› mm ‹angle›° » qui rattache une photo à chaque mur.

Le nom « Pièce #‹k› » est générique : la pièce se retrouve en comparant aire et périmètre avec le DXF (égalité au millimètre sur le jeu de test).

## Constat sur l'éditeur actuel

L'éditeur de `src/Renovation/Plans.jsx` (commit 010d849) est un outil de dessin libre : il ne sait pas ce qu'est une pièce, un mur ou une porte. C'est la principale chose à faire évoluer.

- **Modèle de données à plat** : `plans.data` contient `segments` (traits), `symbols` (texte, symboles de bibliothèque), `cotes`, `surfaces` (polygone + couleur), `viewport`, `planRotation`. Une porte posée avec l'outil est un groupe de segments (`groupId`), pas un objet porte.
- **`parseDXF` ne lit pas ce DXF** : il gère POINT, LINE et LWPOLYLINE, mais pas POLYLINE + VERTEX (format R12 d'iMapper). Les pièces et murs du plan automatique sont donc perdus, et seuls les points sont relus puis reliés par `autoConnect`.
- **Repère inversé** : `parseDXF` retourne l'axe Y (`maxY − y`). Tout ce qui est importé doit subir la même transformation, sinon pièces, points et scanners ne se superposent pas.
- **Historique** : `pushHistory(segments, symbols, cotes)` n'enregistre pas les surfaces ; il faudra y ajouter la couche relevé.
- **Moteur de rendu partagé** : `planRendu.js` (`dessinerScene`) sert à la visionneuse ouvrier et à l'export PDF vectoriel (`planPdf.js`). Le rendu du relevé doit y être ajouté pour rester identique partout.
- **Déjà disponibles** : `pdfjs-dist` (lecture des PDF), la bibliothèque de symboles (radiateurs, électricité, plomberie), le registre des tâches IA (`api/_ia/registre.js`, modèle de `facture_client.js` pour lire un fichier en stockage privé), et `storageChantier.js` (upload privé + URL signées).

## Choix d'architecture

Décision recommandée : ajouter dans `plans.data` une couche `releve` sémantique (pièces, murs, ouvertures, photos), rendue et éditée par l'éditeur, à côté des segments et symboles existants.

L'alternative serait de convertir l'import en traits, surfaces et symboles existants. Elle est plus rapide à coder, mais on perd l'information : déplacer une porte ne recalculerait pas les plinthes, et les métrés ne pourraient pas alimenter le chiffrage.

Principes :

- **Le plan est une donnée, le dessin en est une vue.** Le rendu (murs, symboles de porte, cotes) est calculé à partir de `releve` à chaque affichage, jamais stocké en segments.
- **Cohabitation** : les outils actuels (ligne, texte, symboles de bibliothèque, cotes manuelles) restent disponibles et se dessinent par-dessus. Un plan sans `releve` fonctionne exactement comme aujourd'hui.
- **Calculs purs et testables** : toute la logique (lecture DXF, rapprochement des PDF, détection des ouvertures, métrés) va dans un module sans React, dans `src/Renovation/releveImapper.mjs` (façade `releveImapper.js` pour le front, règle des modules purs de `CLAUDE.md`), testable en Node sur le jeu de test.
- **Un seul moteur de rendu** : le dessin du relevé est ajouté à `planRendu.js`, utilisé par l'éditeur, la visionneuse ouvrier et l'export PDF.

## Modèle de données

La couche est stockée dans `plans.data.releve`, en mètres, dans le repère de l'éditeur (Y déjà inversé). Proposition de forme, à ajuster par Claude Code :

```json
{
  "version": 1,
  "source": { "outil": "imapper", "projet": "00000", "importe_le": "2026-10-15T10:00:00Z",
              "fichiers": ["chemin/stockage/plan.dxf", "chemin/stockage/piece_1.pdf"] },
  "pieces": [{
    "id": "p1", "nom": "Chambre", "type": "chambre", "scan": "272",
    "polygone": [[2.36, 9.66], [2.26, 6.20], "…"],
    "hsp": 2.50, "hsp_statut": "defaut",
    "photos": [{ "num": 1, "chemin": "…/272_01.jpg", "mur": 0 }],
    "observations": [{ "texte": "Fenêtre 2 vantaux…", "categorie": "menuiserie", "statut": "propose" }],
    "statut": "a_valider"
  }],
  "murs": [{ "polygone": [["…"]] }],
  "ouvertures": [{
    "id": "o1", "code": "F1", "type": "fenetre",
    "piece": "p1", "mur": 1, "t0": 0.60, "t1": 1.85,
    "pieces_liees": ["p1"], "sens": { "charniere": "t0", "cote": "interieur" },
    "hauteur": null, "allege": null,
    "origine": "detection", "statut": "confirme_photo", "libelle": "Fenêtre 2 vantaux"
  }],
  "points": { "272": [[2.31, 7.12], "…"] },
  "scanners": { "272": [4.41, 7.06] },
  "alertes": [{ "code": "scan_isole", "scan": "277", "texte": "…" }]
}
```

Précisions :

- **Ouverture** : positionnée par la pièce, l'indice du côté du polygone (`mur`) et deux abscisses `t0`, `t1` en mètres le long de ce côté. Déplacer ou élargir une ouverture revient à changer `t0` et `t1`.
- **Types d'ouverture** : `porte`, `porte_fenetre`, `fenetre`, `baie` (passage sans porte), `placard`.
- **Statuts d'ouverture** : `detecte` (trou dans le relevé seul), `confirme_photo` (trou + photo concordante), `a_verifier` (doute), `valide` (confirmé par le conducteur de travaux).
- **Statut de hauteur** : `defaut` ou `mesuree`.
- **Points bruts** : conservés (environ 5 500 points, quelques centaines de Ko) pour pouvoir relancer la détection après une correction. Tous les points sont exprimés dans le même repère que le reste de la couche.

## Déroulé de l'import

L'utilisateur dépose en une fois le DXF et les PDF sur une zone « Importer un relevé iMapper » de la page Plans. Le traitement se fait dans le navigateur, sauf l'analyse IA des photos (côté serveur).

1. **Tri des fichiers** : `.dxf` → plan ; `.pdf` → pièces. Refuser proprement un DXF sans calque A-AREA-ONE-POLYLINE, avec ce message : « Lancez le plan automatique sur iMapper avant d'exporter. »
2. **Lecture du DXF** : nouveau lecteur gérant POLYLINE + VERTEX (R12) en plus de LWPOLYLINE, qui conserve le nom de calque. Extraire pièces, murs, points par scan et position de chaque scanner. Appliquer l'inversion de Y à tout.
3. **Nommage des pièces** : pour chaque pièce, trouver le scanner situé à l'intérieur du polygone. Traduire le nom tronqué par une table (Salon → Salon, Chamb → Chambre, Buand → Buanderie, Salle → Salle d'eau (iMapper ne distingue pas salle de bain et salle d'eau ; corrigeable), Cuisi → Cuisine, Entre → Entrée, WC → WC…). Un nom inconnu reste tel quel, à corriger.
4. **Scanners hors pièce** : créer une alerte « scan isolé » (cas du scan 277 sur le jeu de test) et l'ignorer pour la suite.
5. **Lecture des PDF** avec `pdfjs-dist` : lire « Aire » et « Périmètre » sur la page 1, le tableau photo → mur sur la page 2, et extraire les images JPEG de la page 1 au format portrait 3:4 d'au moins 800 px (écarte le logo), dans leur ordre d'apparition.
6. **Rapprochement PDF ↔ pièce** : même aire à ± 0,02 m² et même périmètre à ± 5 mm. Un PDF sans correspondance ou deux pièces candidates → alerte, rapprochement manuel.
7. **Rattachement photo ↔ mur** : chaque ligne « n° photo, Mur, longueur » du tableau désigne le côté du polygone de même longueur (± 5 mm). Les photos absentes du tableau restent rattachées à la pièce sans mur précis.
8. **Upload des photos et des fichiers d'origine** dans le stockage privé via `storageChantier.js` ; seuls les chemins sont enregistrés dans `releve`.
9. **Détection des ouvertures** sur la géométrie (section suivante) → statuts `detecte` ou `a_verifier`.
10. **Analyse IA des photos**, une requête par pièce, lancée en parallèle (section « Analyse des photos par l'IA »). Elle confirme, requalifie ou signale les ouvertures, et propose les observations.
11. **Calcul des métrés et ouverture de l'éditeur** sur le résultat, avec le panneau des points à valider ouvert.

Les étapes 1 à 9 doivent prendre moins de 3 secondes sur le jeu de test. L'analyse IA peut arriver ensuite : le plan s'affiche d'abord, les statuts et observations se complètent quand les réponses arrivent.

## Détection des ouvertures

Une ouverture se repère comme un trou dans les points relevés le long d'un mur. Algorithme validé sur le jeu de test :

1. Orienter chaque polygone de pièce dans le sens trigonométrique, pour que la normale (−uy, ux) pointe vers l'intérieur.
2. Pour chaque côté de longueur ≥ 0,30 m, garder les points (tous scans confondus) dont la projection tombe dans le côté et dont la distance au côté est inférieure à 4 cm. Une bande plus large capte la face opposée du mur voisin et masque les portes.
3. Découper le côté en cases de 5 cm et marquer les cases contenant au moins un point.
4. Une suite de cases vides d'au moins 55 cm est une ouverture candidate (`t0`, `t1`).
5. **Mur partagé** : chercher un côté d'une autre pièce parallèle (écart d'angle < 5°), à moins de 40 cm, dont la projection recouvre le trou. Si ce côté présente aussi un trou au même endroit (recouvrement ≥ 50 %), c'est une porte ou une baie entre les deux pièces : statut `detecte`. Sinon, statut `a_verifier`.
6. **Mur extérieur** (pas de côté voisin) : fenêtre candidate, statut `detecte`. Si des points existent au-delà du mur dans l'axe du trou, c'est le signe d'une vitre, ce qui renforce l'hypothèse.
7. **Faux positifs connus** à marquer `a_verifier` : trou de plus de 1,60 m sur un seul côté (mobilier qui masque), trou sur un mur où l'IA voit un miroir.
8. **Largeur** : `t1 − t0`, arrondie au centimètre et affichée avec « ≈ ». **Sens d'ouverture** par défaut : charnière en `t0`, ouverture vers la pièce qui porte le côté, modifiable.
9. **Épaisseur du mur** à l'endroit de l'ouverture : avancer depuis la face intérieure, par pas d'1 cm vers l'extérieur, tant qu'on reste dans un polygone A-WALL (minimum 8 cm).

Sur le jeu de test, la géométrie seule retrouve 11 des 12 ouvertures réelles, mais en qualifie mal plusieurs (porte palière et placard pris pour des fenêtres, baie prise pour une porte), laisse 3 portes en `a_verifier` et produit environ 7 faux candidats dus au mobilier, aux meubles hauts et à un miroir. La fenêtre de la cuisine n'est pas détectée, car sa vitre a renvoyé des points comme un mur. La détection n'est donc jamais définitive sans l'analyse des photos (détail dans les critères d'acceptation).

## Analyse des photos par l'IA

Nouvelle tâche déclarative `api/_ia/taches/releve_photos.js`, ajoutée au registre, sur le modèle de `facture_client.js` qui lit déjà un fichier en stockage privé.

- **Entrée** : identifiant du plan et de la pièce. Les photos sont lues dans le stockage par `construire_prompt`, pas transmises dans l'entrée (qui est journalisée dans `ia_jobs`).
- **Ce qu'on envoie au modèle** : les 10 photos réduites à 800 px de grand côté, le nom de la pièce, la liste de ses murs (indice, longueur, photos rattachées) et les ouvertures candidates (mur, `t0`, `t1`, statut).
- **Modèle et coût** : un modèle avec vision du niveau Sonnet, une requête par pièce, avec un plafond `cout_max_eur` fixé par l'équipe. `sensible: true`, car tout résultat est une proposition à valider.
- **Rôles** : admin et conducteur.

Sortie JSON attendue, contrôlée par `schema_sortie` :

```json
{
  "type_piece": "salle_d_eau_wc",
  "ouvertures": [
    { "ref": "o4", "verdict": "confirme", "type": "porte", "photos": [10], "confiance": 0.9 },
    { "ref": null, "mur": 2, "verdict": "nouvelle", "type": "fenetre", "photos": [7], "confiance": 0.6 }
  ],
  "equipements": [{ "type": "radiateur", "mur": 4, "photos": [5] }],
  "revetements": [{ "zone": "murs", "description": "faïence blanche à mi-hauteur" }],
  "alertes": [{ "texte": "Vitre cassée sur la fenêtre", "gravite": "haute", "photos": [7] }],
  "observations": ["Douche avec robinetterie encastrée", "WC visible"]
}
```

Règles du prompt :

- ne jamais donner de dimension, de largeur ni de hauteur ;
- pour chaque ouverture candidate : `confirme`, `requalifie` (avec le nouveau type), `faux_positif` (mobilier, miroir) ou `incertain` ;
- une ouverture non détectée mais visible (`nouvelle`) est rattachée à un mur, sans position. Si ce mur fait moins de 1,20 m (cas d'un ébrasement), elle occupe tout le côté moins 5 cm à chaque bout ; sinon le conducteur de travaux la place. Dans les deux cas, statut « à vérifier » ;
- signaler en alerte tout ce qui touche la sécurité ou l'étanchéité (vitre cassée, câblage apparent, tableau électrique, trace d'humidité, pièce sans ventilation visible).

Mise à jour du relevé : `confirme` → statut `confirme_photo` ; `faux_positif` → ouverture masquée mais conservée (pour pouvoir la rétablir) ; `incertain` ou `nouvelle` → `a_verifier`.

## Rendu

Le rendu de référence est la page 1 du PDF prototype « plan de l'existant » (15/10/2026). Il est calculé à chaque affichage à partir de `releve`, dans `planRendu.js`, pour l'éditeur, la visionneuse ouvrier et l'export PDF.

Ordre de dessin, du fond vers le dessus :

1. **Sols des pièces** : polygone rempli d'une couleur pastel propre à chaque type de pièce (une palette fixe, lisible en impression).
2. **Murs** : polygones A-WALL remplis en gris anthracite.
3. **Ouvertures** : la zone de mur correspondante est effacée (rectangle limité aux polygones de mur), puis le symbole est tracé.
   - Porte : vantail et arc de débattement, à la largeur réelle.
   - Fenêtre : trois traits parallèles dans l'épaisseur du mur.
   - Baie : trait pointillé.
   - Placard : symbole de porte, libellé « placard ».
4. **Couleur du statut** : noir pour `detecte`, `confirme_photo` et `valide` ; orange et pointillé pour `a_verifier`.
5. **Cotes intérieures** : longueur de chaque côté ≥ 0,30 m, en centimètres, le long du côté et à l'intérieur de la pièce.
6. **Étiquettes** : nom et surface au centre de la pièce, code de l'ouverture (P1, F1, B1…) dans une pastille.

Le calque « points bruts » existe déjà dans l'éditeur (`layers.points`). Il est masqué par défaut, mais l'afficher sous le relevé est le meilleur moyen de contrôler une ouverture douteuse.

Ce qui ne doit pas changer : les plans existants sans `releve` s'affichent à l'identique.

## Édition et validation

Tout se modifie au clic dans le plan, avec un panneau latéral qui affiche l'objet sélectionné. Chaque modification passe par l'historique (annuler / rétablir) et recalcule immédiatement les métrés.

**Pièce sélectionnée** — le panneau montre :

- nom et type (liste fermée : séjour, chambre, cuisine, salle de bain, salle d'eau, WC, entrée, dégagement, buanderie, cellier, autre) ;
- hauteur sous plafond, avec la mention « valeur par défaut » tant qu'elle n'a pas été saisie ;
- les métrés de la pièce ;
- les 10 photos, en grand au clic, avec le mur visé surligné dans le plan ;
- les observations et alertes de l'IA, chacune avec « Valider » ou « Supprimer ».

**Ouverture sélectionnée** — on peut :

- la glisser le long de son mur (modifie `t0` et `t1` sans changer la largeur) ;
- saisir sa largeur, et en option sa hauteur et son allège ;
- changer son type, inverser le côté des charnières ou le côté d'ouverture ;
- la supprimer, ou la marquer « validée ».

**Ajouter une ouverture** : nouvel outil « Ouverture sur mur ». Un clic sur un côté de pièce la crée à cet endroit, à 0,83 m de large par défaut, et le panneau s'ouvre.

**Écran « Points à valider »** : la liste de tout ce qui est `a_verifier`, des alertes IA, des hauteurs par défaut et des scans isolés. Pour chaque point : la photo concernée, la zone du plan centrée, et trois boutons « Confirmer », « Corriger » (ouvre le panneau), « Supprimer ». Un compteur « 7 points à valider » reste visible dans la barre d'outils.

**Hors périmètre du lot 1** : déplacer les sommets des pièces. La géométrie d'iMapper est considérée comme fiable.

## Métrés

Les métrés sont calculés par pièce, dans une fonction pure du module `releveImapper.mjs`, et affichés dans un tableau « Métrés par pièce » avec une ligne de total.

| Quantité | Unité | Calcul |
| --- | --- | --- |
| Surface au sol | m² | aire du polygone de la pièce |
| Périmètre | m | somme des côtés du polygone |
| Plinthes | m | périmètre − largeurs des portes, portes-fenêtres et baies de la pièce |
| Surface de murs brute | m² | périmètre × hauteur sous plafond |
| Surface de murs nette | m² | brute − Σ (largeur × hauteur) des ouvertures de la pièce |
| Surface de plafond | m² | égale à la surface au sol |

Hauteurs par défaut tant qu'aucune valeur n'est saisie : porte 2,04 m, porte-fenêtre 2,15 m, fenêtre 1,45 m, baie 2,20 m, placard 2,04 m. Elles sont affichées sous le tableau comme hypothèses.

Une ouverture entre deux pièces est déduite des deux côtés. Toute valeur qui dépend d'une hypothèse (hauteur par défaut, ouverture `a_verifier`) est précédée de « ≈ ».

Valeurs attendues sur le jeu de test, avec les hypothèses ci-dessus et les ouvertures du prototype :

| Pièce | Sol (m²) | Périmètre (m) | Plinthes (m) | Murs bruts (m²) | Murs nets ≈ (m²) |
| --- | --- | --- | --- | --- | --- |
| Entrée | 4,05 | 8,23 | 5,53 | 20,58 | 14,86 |
| Salon | 23,50 | 19,87 | 17,22 | 49,68 | 39,29 |
| Chambre | 11,70 | 13,77 | 12,42 | 34,43 | 29,87 |
| Buanderie | 6,39 | 11,36 | 9,36 | 28,41 | 24,33 |
| Cuisine | 7,80 | 11,82 | 9,52 | 29,56 | 23,81 |
| Salle d'eau + WC | 3,28 | 7,35 | 6,65 | 18,38 | 16,95 |
| **Total** | **56,72** | **72,42** | **60,72** | **181,04** | **149,10** |

Dans le prototype, les ouvertures `a_verifier` sont déduites comme les autres, et le placard technique de l'entrée n'est déduit ni des plinthes ni des murs. Ces deux choix sont à confirmer par l'équipe ; ils changent les totaux de quelques dixièmes.

## Stockage et confidentialité

Les photos montrent l'intérieur de logements de clients : elles ne doivent jamais être publiques.

- **Upload** : uniquement via `storageChantier.js` (stockage privé, URL signées). Ne pas utiliser le bucket `photos` avec `getPublicUrl`, comme le font aujourd'hui `VisiteChantier.jsx` et `RapprochementFactures.jsx`.
- **Chemins** : rangés par chantier et par plan, par exemple `‹chantier›/plans/‹plan›/releve/‹scan›_‹n°›.jpg`. Le DXF et les PDF d'origine sont conservés au même endroit pour traçabilité.
- **Affichage** : URL signées générées à l'ouverture du plan, jamais enregistrées dans `plans.data`.
- **Visionneuse ouvrier** : elle affiche le plan et les ouvertures, mais pas les observations IA non validées.

**Jeu de test** : le relevé de référence du 14/10/2026 (1 DXF + 6 PDF) sert de référence. Le dépôt GitHub étant public, ces fichiers ne doivent pas y être ajoutés : ils contiennent des photos du logement, le nom du client et l'adresse e-mail de l'entreprise. Les placer dans un dossier local exclu par `.gitignore`, par exemple `scripts/fixtures-privees/`, et faire lire ce dossier par les tests. Une copie anonymisée (numéro de projet remplacé, textes des PDF sans titre ni auteur, aucune photo) est versionnée dans `scripts/fixtures/` pour que la vérification tourne sur GitHub.

## Découpage en lots

Quatre lots livrables séparément, chacun testable sur le jeu de test. Ne pas commencer un lot avant que le précédent passe ses critères.

1. **Lot 1 — Import et rendu** : lecteur DXF (POLYLINE R12, calques), nommage par scanner, alertes de scan isolé, rapprochement et lecture des PDF, upload privé, couche `releve` dans `plans.data`, rendu dans `planRendu.js` (pièces, murs, cotes, étiquettes), panneau des métrés. Pas encore d'ouvertures.
2. **Lot 2 — Ouvertures et édition** : détection des ouvertures, symboles, statuts, panneau pièce et panneau ouverture, glisser le long du mur, outil « Ouverture sur mur », historique annuler / rétablir, écran « Points à valider ».
3. **Lot 3 — Analyse IA des photos** : tâche `releve_photos` dans le registre, intégration des verdicts et observations, affichage progressif quand les réponses arrivent.
4. **Lot 4 — Sorties** : export PDF avec plan d'ensemble, tableau des métrés et fiches pièces (modèle : le PDF prototype), affichage dans la visionneuse ouvrier.

À chaque lot, Claude Code ajoute une entrée au journal des mises à jour (`src/Renovation/journalMaj.js`), selon les règles de `CLAUDE.md`.

## Critères d'acceptation

Tous les critères se vérifient sur le relevé de référence (DXF du 14/10/2026 à 16:19 + PDF du 14/10/2026 à 16:34).

**Lot 1**

- [ ] 6 pièces importées, aires 11,70 / 6,39 / 23,50 / 4,05 / 7,80 / 3,28 m² et périmètres identiques aux PDF au millimètre.
- [ ] Noms : Chambre, Buanderie, Salon, Entrée, Cuisine, Salle d'eau, chacun dans la bonne pièce.
- [ ] Le scan 277 produit une alerte « scan isolé » et aucune pièce.
- [ ] Les 6 PDF sont rapprochés sans ambiguïté ; 60 photos importées, aucun logo.
- [ ] Aucune photo accessible sans URL signée.
- [ ] Pièces, murs et points bruts se superposent exactement.
- [ ] Un plan existant sans `releve` s'affiche et s'exporte à l'identique.

**Lot 2** — ouvertures attendues, à ± 10 cm près sur la position et la largeur :

| Code | Type final | Largeur ≈ | Entre | Après géométrie seule | Après IA |
| --- | --- | --- | --- | --- | --- |
| P1 | porte | 75 cm | Chambre / Salon | porte, detecte | confirme\_photo |
| P2 | porte | 60 cm | Chambre / Buanderie | porte, a\_verifier (trou d'un seul côté) | confirme\_photo |
| P3 | porte | 80 cm | Buanderie / Cuisine | porte, a\_verifier (trous décalés de 5 cm) | confirme\_photo |
| P4 | porte | 70 cm | Cuisine / Salle d'eau | porte, detecte | confirme\_photo |
| P5 | porte | 80 cm | Cuisine / Entrée | porte, a\_verifier (trou d'un seul côté) | confirme\_photo |
| P6 | porte palière | 60 cm | Entrée | fenêtre, detecte (mur sans voisin) | requalifiée en porte |
| PL | placard | 60 cm | Entrée | fenêtre, detecte (mur sans voisin) | requalifiée en placard |
| P7 | porte ? | 60 cm | Buanderie / Salon | porte, a\_verifier | a\_verifier |
| B1 | baie | 130 cm | Salon / Entrée | porte, detecte | requalifiée en baie |
| F1 | fenêtre | 125 cm | Chambre | fenêtre, detecte | confirme\_photo |
| F2 | fenêtre | 73 cm | Cuisine | non détectée (vitre relevée comme un mur) | nouvelle, a\_verifier |
| F3 | fenêtre | 145 cm | Salon | fenêtre, detecte | confirme\_photo |
| F4 | fenêtre ? | 185 cm | Salon | fenêtre, detecte | incertain, a\_verifier |

La géométrie seule produit aussi des faux candidats, que l'IA doit écarter en `faux_positif` : mur est de la chambre sur 1,65 m (mur nu masqué des deux côtés), mur ouest de la chambre sur 2,0 m (mobilier bâché), angle nord-est de la cuisine (meubles hauts, deux trous), mur ouest de la salle d'eau (panneau de douche), mur sud de la salle d'eau (miroir), et les deux petits côtés du renfoncement de placard de la buanderie.

- [ ] Glisser une porte le long de son mur met à jour plinthes et murs nets sans rechargement.
- [ ] Annuler / rétablir couvre toutes les modifications du relevé.
- [ ] Les métrés correspondent au tableau de la section « Métrés », à 0,05 près.

**Lot 3**

- [ ] P2, P3 et P5 passent en `confirme_photo`.
- [ ] La vitre cassée de la cuisine et le placard technique de l'entrée apparaissent en alertes.
- [ ] Aucune réponse de l'IA ne contient de dimension ; un coût par relevé est affiché dans les journaux `ia_jobs`.

**Lot 4**

- [ ] L'export PDF reproduit le prototype : plan à l'échelle 1:50, tableau des métrés, liste des ouvertures, une fiche par pièce avec photos et observations validées, page des points à valider.

## Hors périmètre et décisions

Hors périmètre de cette spécification :

- déplacement des sommets des pièces et ajout ou suppression de murs ;
- import des autres formats iMapper (JSON, IFC, EGI, vecXml, LDossier, PNG) ;
- accès direct aux données iMapper sans fichiers exportés (pas d'API publique à ce jour) ;
- placement automatique des équipements (radiateurs, sanitaires, prises) comme symboles : ils restent des observations dans le lot 3 ;
- orientation nord, même si l'export LDossier la contient pour une partie des murs ;
- envoi des métrés vers le chiffrage, qui fera l'objet d'une spécification séparée.

Décisions à prendre par l'équipe avant le lot 2 :

- [ ] Hauteur sous plafond par défaut : 2,50 m partout, ou une valeur saisie une fois par chantier.
- [ ] Déduction des ouvertures `a_verifier` dans les métrés : oui (comme le prototype) ou non tant qu'elles ne sont pas validées.
- [ ] Déduction des placards dans les plinthes et les murs.
- [ ] Qui valide le relevé : conducteur de travaux seul, ou aussi l'ouvrier sur place depuis la visionneuse.
- [ ] Plafond de coût IA par relevé.
