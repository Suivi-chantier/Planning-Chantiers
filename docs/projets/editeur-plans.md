# Projet : nouvel éditeur de plans

Nov 24, 2026 · @General

Cahier rédigé le 24/11/2026 à partir des décisions de Loris. À copier en `docs/projets/editeur-plans.md`. Règles complètes : `CLAUDE.md`, section « Projets longs : travail en autonomie ».

*Sections de Loris : Claude ne les modifie jamais.*

## Objectif métier

Un nouvel éditeur de plans, construit à côté de l'actuel (`Plans.jsx`, jugé trop lourd et peu pratique), qui part d'un relevé iMapper et produit des plans propres avec le moins de retouches possible.

Le plan sert à trois choses, par ordre d'importance :

- **guider les équipes** sur le chantier ;
- **montrer le projet au client** ;
- **sortir les métrés et quantitatifs**.

Quatre principes guident tout le projet :

- **On dessine un logement, pas des traits.** Le plan est fait de pièces, de murs, d'ouvertures et d'équipements. L'appli sait ce qu'ils sont, ce qui lui permet de calculer les cotes, les surfaces et les métrés toute seule.
- **Un seul plan, plusieurs versions.** Dès la première livraison : démolition, cloisons et plâtrerie, électricité, plomberie. Une modification faite une fois se retrouve dans toutes les versions.
- **Utilisable au bureau comme sur tablette.**
- **Des PDF impeccables**, un pour le client et un pour les équipes.

## Règles et invariants

1. **Rien n'est supprimé ni modifié dans l'existant.** L'ancien éditeur, la table `plans` et tous ses lecteurs restent tels quels : `PlanViewerOuvrier`, `planRendu`, `planPdf`, `releveDossierPdf`, `CheminDeFer`, `PageInfoClient`, `RetoursTerrain`, `tourneeChantiersV1`. Le nouvel éditeur a sa propre table (par exemple `plans_v2`), rattachée à un chantier, avec la policy `profero_collaborateurs_seulement`. Quand on part d'un ancien plan, son relevé est **copié**, jamais modifié sur place.
2. **On réutilise, on ne recopie pas.** L'import iMapper (`releveImapperImport.js`, `assemblerReleve`), la détection et la manipulation des ouvertures, `calculerMetres`, les points à valider, l'analyse IA des photos (`/api/ai`, tâche `releve_photos`, plafond `PLAFOND_IA_RELEVE_EUR`) et les principes du PDF vectoriel à l'échelle (`planPdf.js`) sont repris tels quels. Si l'une de ces briques doit évoluer, on l'étend dans son module pur, avec ses vérifications, sans changer le comportement de l'ancien éditeur.
3. **Les dimensions viennent toujours de la géométrie du DXF**, comme le veut déjà `releveImapper.mjs`. Le redressement (angles presque droits ramenés à 90°, murs presque alignés alignés, épaisseurs régularisées) est fait par du code, pas par l'IA. Tout déplacement au-delà d'une tolérance (départ : 1 cm et 0,5°, réglable) devient un point à valider au lieu d'être appliqué en silence.
4. **L'existant est figé, le projet se pose par-dessus.** L'existant, c'est le relevé redressé. Le projet, c'est la liste des modifications : murs ou portions de murs à démolir, cloisons et doublages à créer, ouvertures ajoutées, déplacées ou bouchées, équipements, notes. On peut toujours revoir l'existant seul.
5. **Le plan est fait d'objets métier** : pièce, mur (calculé à partir des pièces, partagé entre deux pièces voisines, avec un type), ouverture (accrochée à un mur), équipement (posé dans une pièce, tiré d'une bibliothèque), note, trait libre. Chaque élément porte un **corps d'état** et un **état** : existant, à démolir ou à créer.
6. **Une version est une vue, jamais une copie.** Modifier un élément met à jour toutes les versions. Une note peut n'appartenir qu'à une version.
7. **Groupes.** Les objets métier se déplacent d'un bloc. Les traits libres se groupent et se dégroupent librement, et un groupe peut être enregistré comme symbole dans la bibliothèque. Dégrouper un objet métier est possible : il devient des traits libres, et l'appli prévient avant qu'il ne comptera plus dans les métrés ni dans les quantitatifs.
8. **L'IA et les règles métier proposent, l'utilisateur décide.** Toute proposition s'affiche en orange « à valider » et n'entre dans le plan qu'après une action de l'utilisateur. Le coût IA reste plafonné par relevé, comme aujourd'hui.
9. **Cotes et surfaces calculées.** On ne les pose jamais à la main. On peut masquer ou déplacer une cote automatique, et ajouter une cote libre.
10. **Pensé pour le doigt d'abord.** Zones à toucher d'au moins 44 px. Aucune action ne dépend du clic droit ou d'un raccourci clavier (les raccourcis restent un bonus sur ordinateur). Zoom au pincement, pavé numérique à l'écran pour taper une longueur, annuler et rétablir, sauvegarde automatique.
11. **Technique.** Rendu en SVG, pas en canvas. Toute la géométrie (redressement, murs partagés, découpage des pièces, métrés, comptages) vit dans des modules purs `.mjs`, avec des scripts `verif-*` branchés dans les workflows. L'interface est découpée en composants courts : aucun fichier de plus de 600 lignes environ.
12. **Couleurs par défaut** : existant en noir ou gris, à démolir en jaune, à créer en rouge.
13. **Invariants de `CLAUDE.md`** : une impossibilité reste visible à l'écran, entrée dans `journalMaj.js`, nouvelle page déclarée dans `src/access.js`.

## Hors périmètre

Ces sujets sont prévus, mais dans un projet suivant :

- la bascule vers le nouvel éditeur, le retrait de l'ancien et la conversion automatique des anciens plans dessinés sans relevé ;
- le branchement aux autres pages : pièces du phasage, visionneuse de l'espace ouvrier, envoi du métré travaux vers le chiffrage et les commandes ;
- la création d'un plan sans relevé iMapper (pièces tracées aux cotes) ;
- les versions « client aménagé » (mobilier) et « revêtements » (sols, faïence).

Et hors sujet tout court :

- l'envoi automatique de PDF au client ou aux équipes ;
- la 3D, l'import DWG, et tout format d'entrée autre que les exports DXF et PDF d'iMapper.

## Description des étapes

### Étape 1 : importer et afficher proprement

- Nouvelle page « Plans (nouveau) », déclarée dans `src/access.js` et visible des seuls admins au début. Liste des plans par chantier.
- Deux façons de créer un plan : déposer les exports iMapper (le DXF « plan éditable » et les PDF), avec le parcours d'import existant ; ou repartir d'un ancien plan qui contient déjà un relevé, en le copiant.
- Redressement automatique de la géométrie, avec points à valider au-delà de la tolérance (règle 3).
- Affichage SVG propre : pièces colorées par type avec leur nom et leur surface, murs pleins à leur épaisseur, ouvertures, cotes intérieures automatiques.
- Déplacement et zoom, à la souris comme au doigt.
- Toucher une pièce ouvre un panneau : nom, type, hauteur sous plafond, métrés, photos de ses murs.

**Fin d'étape** : les relevés réels déjà en base s'ouvrent proprement dans le nouvel éditeur, et leurs métrés sont **identiques** à ceux de l'ancien éditeur. Le tableau de comparaison va dans le compte rendu.

### Étape 2 : modifier, c'est-à-dire dessiner le projet

- Cinq outils au maximum : Sélectionner, Mur, Ouverture, Équipement, Note et trait libre. Le reste se règle dans le panneau de l'élément sélectionné.
- **Démolir** un mur entier ou une portion de mur (entre deux points posés sur le mur).
- **Créer** une cloison ou un doublage d'un type donné. On reprend les types de l'ancien éditeur : cloisons 45 et 70, doublages 120 et 160. Longueur tapée au pavé numérique, aimantation sur les murs existants, mode orthogonal.
- Les pièces se recalculent : une cloison qui coupe une pièce en crée deux. Si le découpage automatique échoue, l'appli le dit et laisse corriger à la main.
- Ouvertures : ajouter, déplacer, élargir, boucher, changer le sens d'ouverture.
- Traits libres : grouper, dégrouper, enregistrer un groupe comme symbole (règle 7).
- Annuler et rétablir, sauvegarde automatique.
- **Métré travaux** mis à jour en direct : m² à démolir, ml et m² de cloison par type, m² de doublage, puis sol, plafond et murs nets par pièce **après** travaux.

**Fin d'étape** : sur un vrai relevé, démolir une cloison et en créer une autre met à jour le plan, les pièces et le métré travaux. Les cas géométriques difficiles (cloison en biais, pièce en L, cloison qui touche un seul mur) sont couverts par le script de vérification.

### Étape 3 : équipements et versions

- **Bibliothèque métier**, avec des symboles conformes aux usages des plans d'électricité et de plomberie. Les sanitaires de l'ancienne bibliothèque (`DXF_LIBRARY`) sont repris.
  - Électricité : prises, prises commandées, prises spécialisées (lave-linge, lave-vaisselle, four, plaque), interrupteurs simple et va-et-vient, points lumineux en plafond et en applique, tableau, prise RJ45.
  - Plomberie : WC, lavabo ou vasque, évier, receveur, baignoire, chauffe-eau, attentes lave-linge et lave-vaisselle.
  - Chauffage et ventilation : radiateur, bouche VMC.
- **Comptages automatiques** par pièce et par type d'équipement, qui viennent compléter le métré travaux.
- **Les quatre versions** :
  - Démolition : l'existant, avec ce qui est à démolir en jaune.
  - Cloisons et plâtrerie : le projet, cloisons et doublages créés en rouge, avec leur type et leurs cotes.
  - Électricité : murs du projet en gris clair, symboles électriques, légende.
  - Plomberie : murs du projet en gris clair, appareils et attentes, légende.
- Un sélecteur de version en haut de l'écran. Dans une version, seuls les éléments de son corps d'état se modifient. Les autres sont affichés en grisé et verrouillés, pour éviter de déplacer un mur en posant une prise.

**Fin d'étape** : sur un vrai relevé, les quatre versions s'affichent, chacune avec ses seuls éléments, et une cloison déplacée dans la version plâtrerie apparaît déplacée dans les trois autres.

### Étape 4 : exports PDF

- Moteur vectoriel, sur les principes de `planPdf.js` : traits nets à tout zoom, échelle normalisée, réglet, cartouche, légende générée à partir des seuls symboles présents.
- **Gabarit équipes** : une planche par version, en A4 ou A3 paysage. Échelle 1/50 si le plan tient sur la feuille, sinon 1/100. Cotes complètes et consignes par pièce. Cartouche avec chantier, logement, version, indice de révision et date. QR code qui ouvre le plan à jour dans l'appli (l'accès des ouvriers à ce lien viendra avec le branchement de la visionneuse, dans le projet suivant).
- **Gabarit client** : charte Profero (page de garde, couleurs), plan du projet avec pièces colorées et surfaces, tableau des surfaces avant et après travaux. Pas de cotes de chantier ni de détails techniques.
- **Dossier en un clic** : on coche les versions voulues et on obtient un seul PDF.
- **Indice de révision** : A à la première émission, puis la lettre suivante à chaque export qui suit une modification, avec une ligne « ce qui a changé ».

**Fin d'étape** : sur un vrai relevé, le dossier équipes (quatre versions) et le PDF client sont générés et joints au compte rendu. Une cote mesurée à la règle sur la planche imprimée correspond à la cote réelle.

### Étape 5 : pré-remplissage par l'IA et par des règles métier

- À l'import, l'analyse IA des photos est étendue : elle repère les équipements existants visibles (radiateurs, prises, interrupteurs, tableau, chauffe-eau, sanitaires, évier) et les propose sur le bon mur, en orange.
- Un module de règles pur propose un équipement électrique minimal par type de pièce, d'après la NF C 15-100. Les valeurs sont rangées dans un fichier de règles lisible, à faire valider par l'électricien de l'entreprise. Il propose aussi les attentes de plomberie de base selon les appareils posés.
- On accepte ou on refuse chaque proposition, une par une ou pièce par pièce.

**Fin d'étape** : sur trois relevés réels, le compte rendu indique le nombre de propositions, le nombre d'acceptées et le coût IA par relevé, qui doit rester sous le plafond.

## Validation automatique

C'est la règle par défaut de `CLAUDE.md` qui s'applique, avec ces ajouts :

- aucune écriture dans la table `plans`, ce qu'un script de vérification contrôle ;
- la page « Plans (nouveau) » reste réservée aux admins jusqu'à décision de Loris ;
- à l'étape 1, si un seul métré diffère de celui de l'ancien éditeur sur un relevé réel, on s'arrête et on demande ;
- à chaque étape, le compte rendu contient des captures ou des PDF faits sur un vrai relevé, jamais sur un exemple inventé.

### Points déjà tranchés, à noter dans le journal

- Le point de départ est le relevé iMapper (DXF et PDF). Le plan sans relevé est reporté à plus tard.
- Les versions de la première livraison sont démolition, cloisons et plâtrerie, électricité, plomberie.
- Couleurs : existant en noir ou gris, à démolir en jaune, à créer en rouge.
- Le rendu se fait en SVG plutôt qu'en canvas, pour un éditeur plus léger et tactile.
- L'IA et les règles proposent, elles n'appliquent jamais rien seules.

---

*Sections de Claude : mises à jour après chaque tâche et avant tout arrêt.*

## Tâches

Statuts : à faire, en cours, en attente de Loris, en ligne, bloquée, abandonnée.
Tous les nouveaux fichiers vivent dans `src/Renovation/planV2/` (modules purs `.mjs` + façade `.js`, composants courts).

| N° | Tâche | Statut | Validation | Preuve de réussite | Demande de fusion |
| --- | --- | --- | --- | --- | --- |
| 1 | **Étape 1** — module pur « murs partagés » : à partir des pièces et des murs du relevé, calcule les murs (partagés entre deux pièces voisines, épaisseur, ouvertures accrochées) et le modèle d'objets métier de l'existant. Script `verif-plan-v2-modele` + workflow. Aucun écran. | en ligne | Contrôles verts | Cas du script verts ; tableau sur les 2 relevés réels : nombre de pièces, de murs partagés, d'ouvertures accrochées, rien de perdu | [#269](https://github.com/Suivi-chantier/Planning-Chantiers/pull/269) |
| 2 | Module pur de redressement (angles presque droits, murs presque alignés, épaisseurs régularisées ; tolérance réglable, départ 1 cm et 0,5°) ; au-delà : point à valider. Script `verif-plan-v2-redressement` + workflow. Aucun écran. | en ligne | Contrôles verts | Tableau sur les 2 relevés réels : corrections appliquées, points à valider, **écart de chaque métré avant / après redressement** |[#271](https://github.com/Suivi-chantier/Planning-Chantiers/pull/271) |
| 3 | Table `plans_v2` (migration additive + `profero_collaborateurs_seulement`) et couche de lecture / écriture ; script `verif-plan-v2-aucune-ecriture-plans` (aucune écriture dans `plans` depuis le nouvel éditeur) + workflow. | en attente de Loris | **Arrêt : droits d'accès** (question 1) ; puis migration additive vérifiée | Table créée, policy posée, migration enregistrée, l'application s'ouvre | — |
| 4 | Page « Plans (nouveau) » : déclaration dans `src/access.js` (admin seul), navigation, route ; liste des plans par chantier ; création en **copiant** le relevé d'un ancien plan. Entrée `journalMaj.js`. | en attente de Loris | **Arrêt : droits d'accès** (question 1) ; puis contrôles verts | Page visible pour admin seulement (configuration en base relue) ; l'ancien plan est inchangé après copie (comparaison en base) | — |
| 5 | Création par dépôt des exports iMapper (DXF + PDF), avec le parcours d'import existant, réutilisé tel quel. | à faire | Contrôles verts | Un import du DXF de référence donne le même relevé que dans l'ancien éditeur | — |
| 6a | Module pur « scène du plan » : à partir du relevé redressé et du modèle, la liste de ce qu'il faut dessiner (pièces colorées par type avec nom et surface, murs pleins à leur épaisseur avec leurs angles, ouvertures, cotes intérieures automatiques, points à valider en orange) et sa sortie en SVG. Script de vérification. Aucun écran. | en cours | Contrôles verts | Images des 2 relevés réels produites par le module (hors application), remises dans la conversation | [#272](https://github.com/Suivi-chantier/Planning-Chantiers/pull/272) |
| 6b | Affichage dans la page : composant SVG qui dessine la scène ; déplacement et zoom à la souris et au doigt (pincement). | à faire | Contrôles verts (après la tâche 4) | Captures des 2 relevés réels dans l'application | — |
| 7 | Redressement branché à la création du plan ; points à valider affichés en orange, à confirmer ou refuser un par un. | à faire | Contrôles verts | Sur les 2 relevés réels : liste des points à valider, capture avant / après | — |
| 8 | Panneau de pièce (nom, type, hauteur sous plafond, métrés, photos de ses murs) ; sauvegarde automatique. | à faire | Contrôles verts | Métrés du panneau = ceux de l'ancien éditeur, pièce par pièce | — |
| 9 | **Fin d'étape 1** : tableau de comparaison des métrés ancien / nouvel éditeur sur tous les relevés réels en base, captures. | à faire | **Arrêt si un seul métré diffère** | Tableau recopié dans le compte rendu, écart nul | — |
| 10 | **Étape 2** — modèle pur du projet : liste de modifications posée sur l'existant figé (démolir un mur ou une portion, créer cloison 45 / 70 ou doublage 120 / 160) ; état d'un élément (existant, à démolir, à créer) et corps d'état. Script de vérification. | à faire | Contrôles verts (dépend de la question 2 pour les types de cloisons) | Cas du script verts ; l'existant reste identique après toute modification | — |
| 11 | Module pur de découpage des pièces : une cloison qui coupe une pièce en crée deux ; échec signalé. Cas difficiles dans le script : cloison en biais, pièce en L, cloison qui ne touche qu'un mur. | à faire | Contrôles verts | Cas difficiles verts ; somme des surfaces conservée | — |
| 12 | Module pur « métré travaux » : m² à démolir, ml et m² de cloison par type, m² de doublage, sol / plafond / murs nets par pièce après travaux. | à faire | Contrôles verts | Sans aucune modification, le métré après travaux = le métré existant, sur les 2 relevés réels | — |
| 13 | Socle d'édition : barre des cinq outils, sélection, panneau de l'élément, annuler / rétablir, sauvegarde automatique des modifications. | à faire | Contrôles verts | Annuler / rétablir vérifié par script ; zones tactiles ≥ 44 px | — |
| 14 | Outil Mur — démolir un mur entier ou une portion entre deux points (jaune). | à faire | Contrôles verts | Capture sur relevé réel | — |
| 15 | Outil Mur — créer une cloison ou un doublage : type, pavé numérique à l'écran, aimantation, mode orthogonal (rouge) ; les pièces se recalculent, correction à la main si le découpage échoue. | à faire | Contrôles verts | Capture sur relevé réel : une pièce coupée en deux | — |
| 16 | Outil Ouverture : ajouter, déplacer, élargir, boucher, changer le sens (fonctions existantes réutilisées). | à faire | Contrôles verts | Capture sur relevé réel | — |
| 17 | Outil Note et trait libre : grouper, dégrouper, enregistrer un groupe comme symbole (table de bibliothèque, migration additive) ; dégrouper un objet métier avec avertissement « ne comptera plus dans les métrés ». | à faire | Contrôles verts ; migration additive vérifiée | Symbole enregistré puis reposé sur un autre plan | — |
| 18 | Panneau « Métré travaux » mis à jour en direct. | à faire | Contrôles verts | Chiffres du panneau = ceux du module, sur relevé réel | — |
| 19 | **Fin d'étape 2** : sur un vrai relevé, démolir une cloison et en créer une autre ; plan, pièces et métré travaux à jour. Captures. | à faire | — | Captures et métré travaux dans le compte rendu | — |
| 20 | **Étape 3** — bibliothèque métier (module pur) : symboles électricité, plomberie, chauffage et ventilation ; sanitaires repris de l'ancienne bibliothèque. | à faire | Contrôles verts (dépend de la question 2) | Planche de tous les symboles jointe au compte rendu | — |
| 21 | Outil Équipement : poser dans une pièce ou sur un mur, déplacer, régler dans le panneau. | à faire | Contrôles verts | Capture sur relevé réel | — |
| 22 | Comptages automatiques par pièce et par type d'équipement, ajoutés au métré travaux. | à faire | Contrôles verts | Comptage du panneau = comptage à la main sur un relevé réel | — |
| 23 | Les quatre versions (vues pures) + sélecteur en haut de l'écran ; hors corps d'état : grisé et verrouillé ; légende ; notes propres à une version. | à faire | Contrôles verts | Script : une version ne contient que ses éléments ; aucune copie de données | — |
| 24 | **Fin d'étape 3** : les quatre versions sur un vrai relevé ; une cloison déplacée en plâtrerie apparaît déplacée dans les trois autres. Captures. | à faire | — | Quatre captures + capture après déplacement | — |
| 25 | **Étape 4** — moteur de planche vectorielle (pur) : échelle 1/50 sinon 1/100, A4 ou A3 paysage, réglet, cartouche, légende des seuls symboles présents. | à faire | Contrôles verts | Script : une cote de 1 m mesure 20 mm au 1/50 et 10 mm au 1/100 | — |
| 26 | Gabarit équipes : une planche par version, cotes complètes, consignes par pièce, cartouche, QR code vers le plan. | à faire | Contrôles verts | PDF sur relevé réel | — |
| 27 | Gabarit client : page de garde et couleurs Profero, plan du projet, tableau des surfaces avant / après. | à faire | Contrôles verts | PDF sur relevé réel | — |
| 28 | Dossier en un clic (versions cochées → un seul PDF) et indice de révision (A, puis lettre suivante après modification, ligne « ce qui a changé »). | à faire | Contrôles verts ; migration additive vérifiée si une table d'émissions est nécessaire | Deux exports successifs : indice A puis B avec la ligne de changement | — |
| 29 | **Fin d'étape 4** : dossier équipes (quatre versions) et PDF client sur un vrai relevé ; contrôle d'une cote à l'échelle. | à faire | — | PDF joints au compte rendu | — |
| 30 | **Étape 5** — analyse IA des photos étendue aux équipements existants visibles (dans le module de la tâche IA, sans changer l'ancien éditeur) ; plafond par relevé conservé. | à faire | Contrôles verts | Coût mesuré sur un relevé réel, sous le plafond | — |
| 31 | Module pur de règles : équipement électrique minimal par type de pièce (NF C 15-100), dans un fichier de règles lisible à faire valider par l'électricien ; attentes de plomberie selon les appareils posés. | à faire | Contrôles verts | Fichier de règles joint au compte rendu | — |
| 32 | Propositions en orange : accepter ou refuser une par une ou pièce par pièce ; rien n'entre dans le plan sans action. | à faire | Contrôles verts | Script : une proposition non acceptée n'apparaît ni dans les métrés ni dans les PDF | — |
| 33 | **Fin d'étape 5** : sur trois relevés réels, nombre de propositions, d'acceptées, coût IA par relevé. | à faire | **Il faut un 3ᵉ relevé réel** (2 en base aujourd'hui) | Tableau dans le compte rendu | — |
| 34 | Synthèse de fin de projet. | à faire | — | Synthèse dans ce fichier et dans la conversation | — |

## Journal des décisions

- **24/11/2026 — Points déjà tranchés par Loris (repris du cahier).** Le point
  de départ est le relevé iMapper (DXF et PDF), le plan sans relevé est
  reporté. Versions de la première livraison : démolition, cloisons et
  plâtrerie, électricité, plomberie. Couleurs : existant en noir ou gris, à
  démolir en jaune, à créer en rouge. Rendu en SVG plutôt qu'en canvas. L'IA et
  les règles proposent, elles n'appliquent jamais rien seules.
- **24/11/2026 — Découpage.** 34 tâches. Dans chaque étape, les modules de
  calcul purs passent avant les écrans : ils se vérifient seuls sur GitHub, et
  les écrans s'appuient ensuite sur une base déjà en ligne. Chaque étape se
  termine par une tâche de preuve sur relevé réel.
- **24/11/2026 — État de la base (requête du jour).** 33 plans dans `plans`,
  sur 13 chantiers. **Deux seulement contiennent un relevé iMapper** :
  « Louison RDC » (8 pièces, 82 murs, 55 ouvertures, **rattaché à aucun
  chantier**) et le plan du chantier Montillers appt 1 T3 (12 pièces, 130 murs,
  4 ouvertures, déjà converti en traits dans l'ancien éditeur). Conséquences :
  la preuve de fin d'étape 1 porte sur ces deux relevés ; la fin d'étape 5 en
  demande trois (voir question 3).
- **24/11/2026 — Dépôt public : aucune donnée réelle n'y entre.** Les relevés
  réels servent aux vérifications depuis une copie de travail hors dépôt. Les
  captures et PDF faits sur un vrai relevé sont remis dans la conversation, pas
  enregistrés dans le dépôt ; le compte rendu les décrit. Les scripts `verif-*`
  tournent sur le DXF de référence anonymisé (`scripts/fixtures/`).
- **24/11/2026 — Constats sur l'existant (lecture du code).**
  - La règle 1 cite `RetoursTerrain` et `tourneeChantiersV1` parmi les lecteurs
    de `plans` : ils ne la lisent pas. Les lecteurs réels sont `Plans.jsx`,
    `PageInfoClient.jsx`, `CheminDeFer.jsx`, `operationExportData.js`,
    `Admin.jsx` (sauvegarde) et les deux fonctions de l'espace ouvrier. Aucun
    n'est touché.
  - Les métrés (`calculerMetres`) ne lisent que le relevé, jamais le dessin :
    dans l'ancien éditeur, dessiner une cloison ne change aucun métré. Le
    « métré travaux » de l'étape 2 est donc entièrement nouveau.
  - Les PDF actuels ne passent par aucune bibliothèque PDF : c'est une page
    vectorielle envoyée à l'impression du navigateur. Les « principes de
    `planPdf.js` » (échelle, réglet, cartouche) sont repris sur cette base.
  - Rien n'existe pour le QR code ni pour le pavé numérique à l'écran : à
    créer (tâches 15 et 26).
  - Le plafond IA de 2,50 € par relevé n'est appliqué que dans le navigateur
    (le serveur plafonne chaque appel et les totaux par jour et par mois). À
    traiter en tâche 30 sans changer l'ancien éditeur.
  - Les types de cloisons (45, 70, 120, 160) et la bibliothèque de sanitaires
    sont écrits à l'intérieur de `Plans.jsx`, pas dans un module réutilisable
    (voir question 2).
- **24/11/2026 — Risque identifié pour la fin d'étape 1.** Le redressement
  déplace la géométrie (jusqu'à 1 cm et 0,5°) : les surfaces et longueurs
  calculées sur le plan redressé peuvent s'écarter de celles de l'ancien
  éditeur, qui calcule sur le relevé brut. La tâche 2 mesure cet écart sur les
  deux relevés réels avant tout écran. S'il n'est pas nul, on s'arrête avec le
  tableau, comme le prévoit le cahier.
- **24/11/2026 — Quota de déploiement.** Chaque branche poussée déclenche un
  déploiement (environ 100 par jour, quota déjà épuisé une fois le 06/11) : une
  seule poussée par tâche autant que possible.
- **24/11/2026 — QUESTION 1 à Loris (droits d'accès, arrêt obligatoire de
  `CLAUDE.md`, bloque les tâches 3 et 4).** D'accord pour : (a) déclarer la
  page « Plans (nouveau) » dans `src/access.js` pour le **seul rôle admin** ;
  (b) donner à la nouvelle table `plans_v2` **les mêmes droits que l'ancienne
  table `plans`** (tout le bureau, pas les ouvriers), en plus de
  `profero_collaborateurs_seulement` ? Réponse attendue : « oui », ou « admins
  seulement aussi pour la table ».
- **24/11/2026 — QUESTION 2 à Loris (bloque les tâches 10 et 20, pas avant).**
  Pour reprendre les types de cloisons et les sanitaires de l'ancien éditeur
  sans les recopier (règle 2), il faut les sortir de `Plans.jsx` vers un
  fichier à part que l'ancien éditeur relit. Son comportement ne change pas,
  mais son fichier est modifié de quelques lignes, ce que la règle 1 interdit à
  la lettre. Réponse attendue : « oui, déplace-les » ou « non, ne touche pas au
  fichier : recopie-les ». Recommandation : les déplacer, avec un script qui
  prouve que l'ancien éditeur dessine exactement la même chose.
- **24/11/2026 — QUESTION 3 à Loris (pour la tâche 33, sans urgence).** La fin
  d'étape 5 demande trois relevés réels ; la base en contient deux. Il faudra
  importer un troisième relevé d'ici là. Par ailleurs « Louison RDC » n'est
  rattaché à aucun chantier, alors qu'un plan du nouvel éditeur l'est toujours
  (règle 1) : à quel chantier le rattacher lors de sa copie ?
- **24/11/2026 — Tâche 1 : forme du modèle de l'existant.** Deux modules
  purs dans `src/Renovation/planV2/` : `planV2Murs.mjs` (calcul des murs) et
  `planV2Modele.mjs` (document complet). Le modèle ne recopie pas le relevé :
  il désigne les pièces et les ouvertures par leur identifiant, et y ajoute ce
  qui est calculé (pour chaque côté de pièce, ses murs ; pour chaque
  ouverture, son mur). Nom, type, surface, hauteur et photos restent lus dans
  le relevé, et les métrés restent ceux de `calculerMetres` : aucun chiffre
  n'existe en double. Le document prévoit déjà, vides, les emplacements des
  équipements, des notes, des traits libres et de la liste des modifications
  du projet. Chaque mur et chaque ouverture porte un état (« existant ») et un
  corps d'état ; celui des murs est provisoirement « cloisons et plâtrerie »,
  à confirmer quand les versions seront construites (tâches 10 et 23). Le type
  constructif d'un mur existant (cloison 45, 70…) n'est pas dans le relevé :
  l'emplacement existe, vide.
- **24/11/2026 — Tâche 1 : comment un mur est reconnu, et avec quelles
  tolérances.** Chaque côté de pièce est découpé en tronçons, et chaque
  tronçon est la face d'un mur. Quatre cas : mur **partagé** (le côté d'une
  pièce et le côté parallèle d'une pièce voisine, le plus proche des deux
  côtés, avec de la matière entre les deux) ; mur **périphérique** (aucune
  pièce relevée derrière : façade, mitoyen, gaine) ; **raccord** (petit bout
  de côté adossé au bout d'une cloison perpendiculaire ou à un décrochement :
  il n'a pas d'épaisseur propre) ; **limite** (pas de mur : une autre pièce
  commence juste derrière). Tolérances de départ, toutes réglables : côtés
  parallèles à 5° près (la valeur déjà utilisée pour détecter les portes) ;
  écart entre les deux faces de 2 cm à 1 m ; longueur commune d'au moins
  3 cm ; au moins la moitié de l'entre-deux-faces couverte par les murs
  dessinés du relevé, sinon c'est un vide entre deux pièces et non un mur
  (ces cas sont listés à part). Essai sur les deux relevés réels : en faisant
  varier l'angle de 2° à 20° et la part de matière de 10 % à 90 %, le nombre
  de murs partagés bouge de 1 au plus sur 17 (Louison) et de 3 au plus sur 22
  (Montillers). Le résultat ne tient donc pas à un réglage fin.
- **24/11/2026 — Tâche 1 : épaisseurs, et ce qui reste visible quand on ne
  sait pas.** Mur partagé : l'épaisseur est la distance entre les deux faces,
  donc la géométrie du relevé ; quand les faces ne sont pas tout à fait
  parallèles, le plus mince et le plus épais sont gardés (utile au
  redressement). Mur périphérique : l'épaisseur est lue dans les murs dessinés
  par iMapper, avec la fonction existante `epaisseurMur`, en cinq points du
  tronçon (valeur médiane). Cette fonction applique d'office 8 cm quand elle
  ne trouve rien : ici ce minimum est neutralisé, et une épaisseur qu'on ne
  peut pas lire vaut « inconnue » avec sa raison (aucun mur dessiné derrière,
  relevé sans murs, mesures discordantes) — jamais une valeur par défaut.
  La lecture avance par pas de 1 cm : un mur de 30 cm peut être lu 29.
  Identifiant d'un mur : pièce, numéro du côté, rang du tronçon. Il ne dépend
  ni de l'ordre des pièces ni de l'heure : même relevé, mêmes identifiants.
- **24/11/2026 — Tâche 1 : ouvertures.** Chaque ouverture du relevé est
  accrochée au mur qui porte son côté de pièce (celui qu'elle recouvre le
  plus, si elle est à cheval sur plusieurs ; le débord est noté). Une
  ouverture « vue sur photo, pas encore placée » est accrochée si son côté ne
  porte qu'un mur ; sinon elle est listée « non rattachée » avec sa raison.
  Aucune n'est perdue : rattachées + non rattachées = ouvertures du relevé,
  ce que le script vérifie. Un relevé dont les ouvertures ne sont pas encore
  relevées garde cette information (ce n'est pas « zéro ouverture »).
- **24/11/2026 — Tâche 1 : constats sur les deux relevés réels, à reprendre
  dans les tâches suivantes.**
  - Louison RDC : ses 55 ouvertures sont toutes « à vérifier » (48 typées
    fenêtre, 7 porte) et chacune couvre son côté de pièce en entier ; le
    relevé extrait ne contient aucun point de mesure. 8 d'entre elles sont à
    cheval sur plusieurs murs. Elles sont toutes accrochées, mais elles ne
    décrivent pas de vraies portes ni fenêtres : à garder en tête pour
    l'affichage (tâche 6).
  - Montillers appt 1 T3 : deux pièces se chevauchent légèrement dans le
    relevé (environ 0,06 m²). Le modèle le signale (« limite, pièces
    superposées ») au lieu d'inventer un mur. Par ailleurs 9,5 % de la
    surface des murs dessinés par iMapper tombe à l'intérieur d'une pièce
    (0,9 % pour Louison). Ce relevé porte l'alerte « deux versions du plan
    superposées dans le DXF » ; le lien entre les deux constats n'est pas
    établi. À traiter comme point à valider au redressement (tâche 2).
  - Sur les deux relevés, la plupart des murs périphériques sont lus à
    29 ou 30 cm. C'est ce qu'iMapper dessine quand il n'y a pas de pièce
    derrière ; rien ne permet de dire s'il s'agit d'une mesure ou d'une
    épaisseur de convention. La source de chaque épaisseur est inscrite sur
    le mur (« faces » ou « murs du relevé ») pour ne pas confondre les deux.
  - Murs de moins de 5 cm de long : 2 (Louison) et 16 (Montillers). Murs
    périphériques ayant une pièce juste derrière, faces non parallèles : 6 et
    21, dont 6 de plus de 15 cm (tous à Montillers, angles de 6° à 24°). Ce
    sont les candidats naturels du redressement (tâche 2).
  - Affichage (tâche 6) : chaque mur a un contour à dessiner (ses deux faces,
    ou sa face décalée de l'épaisseur), mais les angles où les murs se
    rejoignent ne sont pas couverts par ces contours. Il faudra soit dessiner
    les murs d'iMapper en fond, soit calculer les raccords d'angle.

- **24/11/2026 — ARRÊT (autorisation) — QUESTION 4 à Loris.** La tâche 1 est
  prête : demande de fusion #269, 14 contrôles verts. La commande de fusion a
  été refusée par la configuration des autorisations de la session.
  Conformément à `CLAUDE.md` (« Autorisations »), on s'arrête sans contourner,
  et la tâche 2 ne démarre pas tant que la tâche 1 n'est pas en ligne.
  Question : « Puis-je fusionner moi-même les demandes de fusion de ce projet
  quand tous les contrôles sont verts ? » Réponse attendue : « oui ».
  À défaut, Loris peut fusionner lui-même la demande #269.

- **25/11/2026 — Réponse de Loris à la question 4 : « oui, fusionne quand les
  contrôles sont verts ».** La session pilote fusionne donc elle-même chaque
  demande de fusion du projet dès que tous ses contrôles sont verts, jamais au
  rouge. Les questions 1, 2 et 3 restent ouvertes : cette réponse ne les
  couvre pas.

- **25/11/2026 — Tâche 2 : comment le relevé est redressé.** Deux modules
  purs : `planV2Redressement.mjs` (ce qu'on corrige et si la tolérance le
  permet) et `planV2RedressementGeo.mjs` (la géométrie : poser des côtés sur
  des droites, faire suivre le reste). Aucune IA. Trois natures de correction :
  - **angle** — le code cherche la ou les directions dominantes du logement :
    celle que suivent le plus de mètres de murs, à un quart de tour près ; une
    autre direction n'est retenue que si elle porte au moins 15 % des côtés
    (aile de bâtiment en biais). Un côté à moins de 5° d'une direction
    dominante est « presque droit » : on propose de le remettre d'équerre.
    Au-delà, il est franchement en biais et on n'y touche pas. Les côtés d'une
    même pièce tournés du même angle (à 0,1° près) forment un seul groupe, qui
    tourne d'un bloc autour de son centre : les dimensions de la pièce ne
    changent pas ;
  - **alignement** — deux côtés parallèles, proches (moins de 1 m de vide
    entre eux le long de la ligne), décalés de moins de 5 cm : mis sur la même
    droite, le plus court s'alignant sur le plus long au prorata des
    longueurs. Un petit décrochement à l'intérieur d'une pièce n'est jamais
    supprimé : la pièce garde son nombre de côtés ;
  - **épaisseur** — les deux faces en biais d'un même mur partagé, pas tout à
    fait parallèles : rendues parallèles, donc épaisseur constante le long du
    mur. Aucune épaisseur n'est ramenée à une valeur « standard » : celle du
    relevé est gardée.
- **25/11/2026 — Tâche 2 : tolérance, cumul, deuxième passe.** Départ 1 cm et
  0,5°, en paramètres nommés. Une correction n'est appliquée que si aucun
  sommet ne finit à plus de 1 cm de sa position relevée, toutes corrections
  cumulées, et si aucun côté ne tourne de plus de 0,5°. Sinon elle devient un
  point à valider : rien n'est déplacé, la correction proposée et son ampleur
  sont jointes, et une fonction l'applique sur action de l'utilisateur. Quand
  deux corrections tiennent chacune dans la tolérance mais pas ensemble, les
  **deux** deviennent des points à valider : le résultat ne dépend pas d'un
  ordre de passage, et redresser un relevé déjà redressé ne change plus rien
  (vérifié sur tous les cas du script et sur les deux relevés réels ; les
  points à valider d'une deuxième passe sont les mêmes, leur ampleur proposée
  peut varier de quelques centièmes de millimètre). Le relevé redressé garde
  la pleine précision du calcul, sans arrondi au dixième de millimètre, sinon
  un angle droit ne serait plus exact. Les fenêtres « presque droit » (5°,
  l'écart déjà retenu en tâche 1 pour « parallèles ») et « presque aligné »
  (5 cm) sont des choix de Claude, réglables : elles décident du nombre de
  points à valider, pas de ce qui est appliqué.
- **25/11/2026 — Tâche 2 : ce que devient le reste du relevé.** Les murs
  dessinés par iMapper suivent les pièces : un coin de mur posé sur un coin de
  pièce bouge avec lui, la face extérieure d'un mur périphérique suit le coin
  le plus proche. L'épaisseur dessinée est donc conservée telle quelle, et la
  tâche 1 y relit les mêmes épaisseurs périphériques. Les ouvertures gardent
  leur identifiant, leur côté, leur largeur et leur position réelle ; une
  ouverture qui couvrait tout son côté le couvre toujours. Les points de
  mesure et les scanners ne bougent pas : ce sont des mesures brutes. Les deux
  pièces qui se chevauchent (Montillers) deviennent un point à valider sans
  correction automatique : rien ne dit laquelle des deux a raison.
- **25/11/2026 — Tâche 2 : constat sur les métrés, à trancher par Loris avant
  la fin d'étape 1 (question à poser par la session pilote).** Avec les
  tolérances de départ, les métrés calculés sur le relevé redressé sont
  identiques à ceux de l'ancien éditeur **à la précision affichée** sur les
  deux relevés réels (0 valeur différente sur 54 et sur 78). Ils ne sont pas
  identiques en valeur exacte (38 et 48 valeurs diffèrent, de 0,00035 et
  0,00135 au plus), et rien ne garantit l'égalité affichée sur un autre
  relevé : il suffit qu'une valeur soit à moins d'un millimètre d'un
  changement d'arrondi. Deux faits le montrent. Une première version du
  calcul faisait pivoter chaque côté autour du centre de la pièce : le bruit
  du relevé (0,1 mm) s'y trouvait amplifié (jusqu'à 0,9 mm sur Louison) et
  4 métrés affichés changeaient sur chaque relevé ; ce défaut est corrigé (un côté ne corrige
  plus son propre bruit qu'autour de son milieu), ce n'est pas un réglage de
  tolérance. Et sur le relevé de référence anonymisé, où les corrections
  appliquées vont jusqu'à 8,5 mm, 28 métrés affichés sur 42 changent (exemple
  issu des tests, données fictives). Enfin, dès qu'un point à valider est
  accepté, les métrés changent franchement (jusqu'à 0,80 et 1,44 si tous
  étaient acceptés). Options, avec leurs conséquences :
  1. métrés toujours calculés sur le relevé brut : identiques par
     construction, mais le plan dessiné et ses cotes (relevé redressé) ne
     racontent plus tout à fait la même chose que les métrés, et l'écart
     grandit avec chaque point accepté ;
  2. métrés calculés sur le relevé redressé : un seul jeu de chiffres pour le
     plan, les cotes et les métrés ; identiques à l'affichage sur les deux
     relevés réels tant qu'aucun point n'est accepté, sans garantie ailleurs,
     et différents ensuite par décision de l'utilisateur ;
  3. ne rien appliquer sans validation (tout devient point à valider) :
     métrés identiques tant que rien n'est accepté, mais 26 et 35 points à
     valider au lieu de 16 et 23, et aucun nettoyage automatique.
- **25/11/2026 — Tâche 2 : limites connues, à reprendre dans les tâches
  suivantes.**
  - Tâche 7 (écran des points à valider) : 16 et 23 points sur les deux
    relevés réels. La plupart ne sont pas des « presque » : ce sont des murs
    réellement tournés de 1 à 5°, dont la correction déplace de 1 à 50 cm.
    Élargir la tolérance ne règle rien (8 et 14 points à 5 cm et 2°, mais 40
    et 28 métrés affichés qui changent). Resserrer la fenêtre « presque
    droit » à 3° ou 2° donne 13 et 17, ou 11 et 13 points. L'écran devra
    trier par ampleur et permettre d'accepter ou de refuser par pièce.
  - Tâche 7 : après un point accepté, relancer le redressement fait apparaître
    les corrections devenues possibles (alignements de la pièce redressée).
    Chaque relance repart du relevé qu'on lui donne : pour que le cumul reste
    mesuré depuis le relevé d'origine, garder ce relevé brut et la liste des
    points acceptés ou refusés (chaque point a une clé stable).
  - Un point à valider d'angle sur un côté seul peut faire tourner fortement
    un petit côté voisin presque dans son prolongement (cas réel : redresser
    de 3,3° un côté de 1,30 m fait tourner de 9,7° son voisin de 22 cm) ;
    l'ampleur annoncée en tient compte.
  - Identifiants de murs (tâche 1) : identiques avant et après sur les deux
    relevés réels. Ce n'est pas garanti : sur le relevé de référence, un bout
    de raccord de 1,07 cm disparaît parce qu'il passe sous le centimètre en
    dessous duquel la tâche 1 rattache un reste de côté au mur voisin
    (exemple issu des tests, données fictives).
  - Épaisseurs périphériques : la lecture de la tâche 1 avance par pas de
    1 cm sur des murs dessinés à 30,0 cm ; un déplacement infime la fait
    basculer de 29 à 30 ou l'inverse (3 et 4 murs sur les relevés réels).
  - Tâche 6 (affichage) : les murs dessinés du relevé redressé suivent les
    pièces mais ne sont pas redessinés ; leurs faces extérieures peuvent
    garder un écart de l'ordre du millimètre entre deux murs voisins.

- **25/11/2026 — Modification du plan : la tâche 6 est coupée en 6a et 6b, et
  6a passe avant les tâches 3 à 5.** Raison : les tâches 3 et 4 attendent la
  réponse de Loris à la question 1 (droits d'accès), et les tâches 5, 6, 7 et
  8 ont besoin de la page. La partie « calcul de ce qu'il faut dessiner »
  (6a) est un module pur, sans page ni base : elle peut avancer tout de suite
  et produire les premières images des relevés réels. L'affichage dans la
  page (6b) viendra après la tâche 4. Si la question 1 reste sans réponse
  après 6a, on enchaîne sur la tâche 11 (découpage des pièces, module pur),
  qui ne dépend d'aucune question.
- **25/11/2026 — QUESTION 5 à Loris (à trancher avant les tâches 8 et 9, ne
  bloque pas 6a).** Constat de la tâche 2 : à la création du plan, les métrés
  affichés du plan redressé sont identiques à ceux de l'ancien éditeur sur
  les deux relevés réels (0 différence sur 54 et sur 78 valeurs), mais de
  justesse (les valeurs exactes diffèrent de 0,0014 m² au plus), et ils
  changent dès qu'on accepte un point à valider, puisqu'on déplace alors un
  mur. Question : « Les métrés du nouvel éditeur suivent le plan redressé :
  identiques à l'ancien à la création, ils changent quand on accepte de
  redresser un mur. D'accord ? » Réponse attendue : « oui », ou « non, les
  métrés restent toujours ceux du relevé brut ». Recommandation : oui (un
  seul jeu de chiffres pour le plan, les cotes et les métrés) ; la
  comparaison de fin d'étape 1 se fait alors à la création du plan, avant
  tout point accepté.
- **25/11/2026 — Point à régler avec Loris en tâche 7, sur captures (pas une
  question bloquante).** Le redressement propose 16 points à valider sur
  « Louison RDC » et 23 sur Montillers. Un tiers sont de petites retouches
  (moins de 3 cm) ; les autres sont des murs réellement tournés de 1 à 5°,
  dont la correction déplacerait un bout de mur de 3 à 50 cm. Le réglage
  « jusqu'à quel angle un mur est presque droit » (5° aujourd'hui) ramène la
  liste à 13 et 17 points à 3°, 11 et 13 à 2°. À décider en voyant les
  propositions dessinées.

- **25/11/2026 — Tâche 6a : une seule description, deux sorties.** Cinq
  modules purs dans `src/Renovation/planV2/`. `planV2Scene.mjs` dresse la
  liste de ce qu'il faut dessiner, en mètres, sans aucune taille d'écran :
  chaque élément porte l'identifiant de son objet (pièce, mur, ouverture…),
  son état (existant, à démolir, à créer), son corps d'état et son calque.
  `planV2SceneDessin.mjs` (avec `planV2SceneTextes.mjs`) met cette liste en
  page pour une échelle donnée et rend des formes simples (polygone, ligne,
  arc, cercle, rectangle, texte). `planV2SceneSvg.mjs` ne fait qu'écrire ces
  formes en SVG. Le composant de la tâche 6b dessinera les mêmes formes : la
  géométrie n'existe qu'à un endroit. Les calques équipements, notes, traits
  libres et projet existent, vides ; si le modèle en contient un jour, le plan
  l'écrit au lieu de les passer sous silence.
- **25/11/2026 — Tâche 6a : la surface affichée n'est pas recalculée.** La
  scène reçoit les métrés (`calculerMetres`) en paramètre et écrit la surface
  avec `texteMetre` : même chiffre, même service. Elle ne sait pas sur quel
  relevé ces métrés ont été calculés : la réponse à la question 5 ne changera
  rien ici. Sans métrés, l'étiquette dit « non calculable ». Les cotes sont
  celles de `cotesInterieures` (un côté d'au moins 30 cm, en centimètres).
- **25/11/2026 — Tâche 6a : comment les murs sont dessinés pleins.** Chaque
  mur du modèle reste un objet à part (il pourra passer en jaune seul) : c'est
  sa bande, entre ses deux faces ou entre sa face et son épaisseur. Les bandes
  ne couvrent pas les angles. À chaque coin saillant d'une pièce, le coin vide
  est rempli par une « jonction » : un petit quadrilatère qui va du coin de la
  pièce jusqu'à la rencontre des deux faces extérieures. Fait depuis les coins
  de toutes les pièces, cela ferme aussi les rencontres en T et en croix
  (plusieurs jonctions peuvent alors couvrir le même carré ; en aplat cela ne
  se voit pas). Chaque jonction liste les deux murs qu'elle relie. À un coin
  rentrant entre deux murs extérieurs, les deux bandes sont recoupées sur leur
  diagonale au lieu de se recouvrir. Derrière un décrochement (un « raccord »
  de la tâche 1, sans épaisseur propre), la jonction reprend l'épaisseur du
  mur voisin et longe tout le décrochement, comme iMapper le dessine ; elle
  n'est gardée que si les murs dessinés du relevé montrent bien de la matière
  à cet endroit (au moins la moitié).
- **25/11/2026 — Tâche 6a : pourquoi les murs dessinés par iMapper ne sont
  pas mis en fond.** Mesuré d'abord sur les deux relevés réels (relevé
  redressé, grille de 1 cm, murs superposés comptés une seule fois) : les murs
  d'iMapper recouvrent l'intérieur des pièces sur 0,52 % de leur emprise
  (Louison) et 6,47 % (Montillers, où deux versions du plan sont superposées) ;
  les murs calculés, 0,01 % et 0,13 %. Et 98,7 % et 97,5 % des murs d'iMapper
  se retrouvent dans les murs calculés ou dans les pièces. Les murs d'iMapper
  ne sont donc pas dessinés : ils servent de témoin (épaisseurs, matière
  derrière un décrochement). Autre raison : dès l'étape 2, un mur démoli doit
  disparaître du plan, ce qu'un fond figé empêcherait. (La tâche 1 annonçait
  9,5 % et 0,9 % : c'était la somme mur par mur, où deux murs dessinés l'un
  sur l'autre comptent deux fois ; recalculée ainsi, elle donne bien 9,57 % et
  0,88 %. Les deux mesures disent la même chose.)
- **25/11/2026 — Tâche 6a : ce qui reste visible quand on ne sait pas.** Un
  mur dont l'épaisseur est inconnue est un trait interrompu sur sa face, avec
  sa raison, jamais une bande d'épaisseur par défaut, et aucune jonction ne
  s'y accroche. Une « limite » (deux pièces sans mur entre elles, ou qui se
  chevauchent) est un trait fin pointillé. Une jonction qui tomberait à plus
  de 5 % dans une pièce est écartée et listée avec sa raison plutôt que
  dessinée de travers. Un relevé dont les ouvertures ne sont pas relevées
  porte la mention « Ouvertures non relevées » sous le plan. Une cote qui
  n'est pas affichée à une échelle donnée garde sa raison (côté trop court,
  chevauchement, hors de la pièce, masquée, doublon).
- **25/11/2026 — Tâche 6a : ouvertures, et l'orange.** Une ouverture
  détectée, confirmée sur photo ou validée est dessinée en menuiserie : trou
  dans le mur à l'épaisseur du mur qui la porte, tableaux, vantail et arc de
  débattement selon le sens connu, trois traits pour une fenêtre, pointillés
  pour une baie. Une ouverture « à vérifier » n'est PAS une menuiserie : un
  trait orange interrompu dans l'épaisseur du mur, sans trou. Une ouverture
  vue sur photo mais pas placée : une pastille orange avec son code et « ? »,
  au milieu de son côté. L'orange (#ea580c) n'est employé que pour ce qui est
  à valider ; le script le vérifie forme par forme. Couleurs des murs par
  état : gris-noir (#2f3540), jaune (#f2c200), rouge (#d92d20). Les couleurs
  de pièces sont celles de l'ancien éditeur (`couleurPiece`), dont le pêche
  clair des chambres, proche de l'orange sans être le même : à revoir si
  Loris le juge gênant.
- **25/11/2026 — Tâche 6a : textes, échelle, doigt.** L'échelle (unités de
  dessin par mètre) est un paramètre ; un second paramètre multiplie toutes
  les tailles de texte et de trait : à l'écran les textes gardent leur taille
  quand on zoome, à l'impression ils se règlent en millimètres. Les largeurs
  de texte sont estimées par une fonction reçue en paramètre (aucune police
  installée n'est nécessaire au calcul) ; le composant pourra passer la
  mesure exacte du navigateur. Étiquette : nom et surface sur deux lignes, au
  point de la pièce le plus loin des murs, réduite jusqu'à tenir ; sinon sur
  une ligne le long du plus grand côté ; sinon sur fond clair. Cotes : le long
  du côté, à l'intérieur, les plus longues d'abord ; chacune a un identifiant
  stable (pièce et numéro de côté) et peut déjà être masquée ou déplacée par
  un réglage. Une cloison qui avance dans une pièce ne donne sa longueur
  qu'une fois. Chaque pièce est un seul polygone à toucher (son étiquette
  laisse passer le doigt). Pour les petits objets (ouvertures, repères), la
  mise en page fournit une zone à toucher d'au moins 44 px à l'écran, quel que
  soit le zoom.
- **25/11/2026 — Tâche 6a : limites connues, à reprendre dans les tâches
  suivantes.**
  - Tâche 6b (composant et zoom) : la mise en page dépend de l'échelle (une
    cote masquée de loin s'affiche de près). Elle prend 12 à 19 ms sur les
    relevés réels, la scène 60 à 110 ms : recalculer la mise en page à la fin
    d'un geste de zoom, pas à chaque image, et garder la scène tant que le
    plan ne change pas. Les deux relevés réels sont faits de groupes de pièces
    éloignés d'une dizaine à une vingtaine de mètres : la vue d'ensemble est
    surtout du blanc, il faudra pouvoir cadrer sur un groupe.
  - Tâche 7 (points à valider) : chaque repère porte la clé du point et un
    numéro d'ordre dans la liste reçue. Sur « Louison RDC » tout est orange :
    les 55 ouvertures sont « à vérifier » et couvrent chacune un côté entier,
    en plus des 16 points du redressement. C'est fidèle aux données, mais
    lourd : prévoir de pouvoir masquer un des deux genres de repères.
  - Tâche 14 (démolition par portion) : un mur est une bande d'un seul
    tenant ; une portion demandera de recouper cette bande. Règle proposée
    pour les jonctions : une jonction ne passe en jaune que si ses deux murs
    sont démolis. Les jonctions se superposent aux rencontres en T : sans
    gravité en aplat, à reprendre si l'on veut des hachures ou de la
    transparence.
  - Tâche 25 (planches) : la sortie SVG n'a ni cartouche, ni réglet, ni
    découpage en pages ; elle sait seulement dessiner à une échelle donnée.
  - Zones en biais : là où une petite pièce est nettement tournée par
    rapport à ses voisines, les bandes et les jonctions se chevauchent et la
    silhouette du mur est en dents de scie sur quelques centimètres (une zone
    sur Louison, plusieurs sur Montillers, repérées à l'œil sur les images).
    Le dessin de chaque mur est juste, leur réunion n'est pas lissée.
  - Épaisseurs : un mur dessiné à 30 cm peut être lu 29 par le modèle (limite
    connue de la tâche 1) ; le plan le dessine donc à 29.
  - 13 jonctions écartées sur Montillers et 1 sur Louison : à ces endroits
    l'angle peut rester ouvert de quelques centimètres.

## Comptes rendus

### Tâche 1 — modèle de l'existant et murs partagés (24/11/2026)

- **Ce qui a changé** : rien de visible à l'écran. L'application sait
  maintenant transformer un relevé iMapper en « objets » : des pièces, des
  murs et des ouvertures accrochées à leur mur. Jusqu'ici un relevé ne
  contenait que des contours de pièces et des dessins de murs sans lien entre
  eux ; désormais un mur entre deux pièces est UN seul objet, qui connaît ses
  deux pièces, sa longueur et son épaisseur. C'est la base de tout le reste
  (affichage, démolition, métré travaux).
- **Rien n'est touché dans l'existant** : aucun fichier de l'ancien éditeur
  modifié, aucune écriture en base, aucune migration. Le relevé d'origine
  n'est jamais modifié : c'est vérifié par le script.
- **Essai sur les deux relevés réels de la base** (chiffres agrégés ; les
  relevés eux-mêmes ne sont pas dans le dépôt) :

  | | Louison RDC | Montillers appt 1 T3 |
  |---|---|---|
  | Pièces du relevé / pièces dans le modèle | 8 / 8 | 12 / 12 |
  | Côtés de pièces | 92 | 132 |
  | Murs calculés | 95 | 152 |
  | — partagés entre deux pièces | 17 | 22 |
  | — périphériques, épaisseur lue | 53 | 103 |
  | — périphériques, épaisseur inconnue | 0 | 0 |
  | — raccords (bout de cloison, décrochement : pas d'épaisseur propre) | 25 | 25 |
  | — limites sans mur (pièces qui se chevauchent dans le relevé) | 0 | 2 |
  | Paires de pièces voisines | 5 | 10 |
  | Vis-à-vis écartés (vide entre les deux pièces, pas un mur) | 2 | 2 |
  | Épaisseurs des murs partagés (cm × nombre) | 7×1, 10×2, 12×2, 16×1, 17×1, 38×3, 43×1, 44×1, 46×1, 54×1, 55×1, 70×1, 92×1 | 7×1, 10×10, 11×1, 14×1, 28×2, 31×1, 36×1, 37×1, 56×1, 57×1, 58×1, 79×1 |
  | Épaisseurs des murs périphériques (cm × nombre) | 9×1, 10×2, 29×17, 30×21, 40×4, 42×1, 44×1, 46×1, 58×1, 68×2, 76×1, 87×1 | 9×8, 10×10, 11×1, 13×3, 15×3, 16×1, 21×1, 24×2, 29×25, 30×31, 33×1, 41×3, 44×3, 47×2, 55×2, 56×2, 57×1, 79×3, 91×1 |
  | Ouvertures du relevé | 55 | 4 |
  | — accrochées à un mur | 55 | 3 |
  | — non rattachées, avec leur raison | 0 | 1 (vue sur photo, pas encore placée, sur un côté qui porte 2 murs) |
  | Métrés (`calculerMetres`) identiques avant et après | oui | oui |
  | Relevé non modifié, deux calculs successifs identiques | oui | oui |

- **Rien de perdu** : toutes les pièces sont là, chaque côté de pièce est
  couvert en entier par ses murs, chaque ouverture est accrochée ou listée.
- **Points surprenants, creusés** (détail dans le journal) :
  - Louison RDC : les 55 ouvertures sont toutes « à vérifier » et chacune
    couvre un côté de pièce en entier (48 « fenêtres », 7 « portes »). Elles
    sont bien accrochées, mais ce ne sont pas de vraies portes ni fenêtres.
  - Montillers : deux pièces se chevauchent un peu dans le relevé. Le modèle
    le dit au lieu d'inventer un mur entre elles.
  - Presque tous les murs périphériques font 29 ou 30 cm : c'est ce
    qu'iMapper dessine, sans qu'on sache si c'est mesuré.
  - Les 4 « vis-à-vis écartés » sont des pièces qui se font face à 74–88 cm
    sans aucun mur dessiné entre elles : un vide (gaine, espace non relevé),
    pas un mur de 80 cm.
- **Vérifications automatiques** : nouveau script `verif-plan-v2-modele`,
  15 cas, branché sur GitHub. Les logements dessinés pour les cas (deux
  pièces côte à côte, pièce en L, côté longeant deux voisins, mur en biais,
  pièce isolée, poteau, vide entre deux pièces, ouvertures) et le relevé de
  référence anonymisé : exemple issu des tests, données fictives. Sur ce
  relevé de référence (6 pièces) : 41 murs dont 10 partagés, 9 paires de
  pièces voisines, 20 ouvertures toutes accrochées — exemple issu des tests,
  données fictives.
- **Journal des MAJ** : pas d'entrée (rien de visible pour les utilisateurs).
  La première viendra avec la page « Plans (nouveau) ».
- **Mise en ligne** : en ligne depuis le 25/11/2026. Demande de fusion #269,
  14 contrôles verts, fusionnée après l'accord de Loris (question 4),
  déploiement de production terminé avec succès. L'ouverture de
  l'application n'a pas pu être testée depuis l'environnement de Claude (site
  de production non joignable d'ici) ; la tâche n'ajoute aucun écran et aucun
  fichier chargé par l'application.
- **Précision** : l'absence de points de mesure dans le relevé « Louison RDC »
  vient bien de la base (le champ y est vide), pas de l'extraction.

### Tâche 2 — redressement du relevé (25/11/2026)

- **Ce qui a changé** : rien de visible à l'écran. L'application sait
  maintenant « redresser » un relevé iMapper : remettre d'équerre les angles
  presque droits, mettre sur une même ligne les murs presque alignés, rendre
  parallèles les deux faces d'un même mur. C'est du calcul, sans IA. Tout ce
  qui déplacerait un point de plus de 1 cm, ou tournerait un mur de plus de
  0,5°, n'est **pas** appliqué : c'est rangé dans une liste de points à
  valider, avec la correction proposée et son ampleur, pour que l'utilisateur
  décide (tâche 7).
- **Rien n'est touché dans l'existant** : aucun fichier de l'ancien éditeur
  ni de la tâche 1 modifié, aucune écriture en base, aucune migration. Le
  relevé d'origine n'est jamais modifié : le redressement rend un nouveau
  relevé, de même forme, sur lequel les métrés et le modèle de la tâche 1
  s'appliquent tels quels.
- **Essai sur les deux relevés réels de la base**, tolérances de départ (1 cm
  et 0,5°). Chiffres agrégés ; les relevés eux-mêmes ne sont pas dans le
  dépôt.

  | | Louison RDC | Montillers appt 1 T3 |
  |---|---|---|
  | Direction dominante du logement (part des côtés qui la suivent) | 1,18° (40 %) | 0,88° (25 %) |
  | **Corrections appliquées** | 10 | 12 |
  | — angles remis d'équerre (groupes de côtés) | 4 | 7 |
  | — côtés alignés | 5 | 0 |
  | — faces de mur rendues parallèles | 1 | 5 |
  | Sommets déplacés | 54 sur 92 | 60 sur 132 |
  | Déplacement le plus grand / moyen sur tous les sommets | 0,09 mm / 0,02 mm | 3,14 mm / 0,08 mm |
  | Rotation la plus grande | 0,04° | 0,29° |
  | **Points à valider** | 16 | 23 |
  | — angles | 15 | 19 |
  | — alignements | 1 | 1 |
  | — faces de mur | 0 | 2 |
  | — pièces qui se chevauchent (sans correction proposée) | 0 | 1 |
  | Déplacement proposé par chaque point, du plus petit au plus grand (cm) | 1,4 · 1,5 · 2,0 · 2,2 · 2,9 · 2,9 · 3,0 · 3,8 · 4,2 · 7,5 · 12,3 · 12,6 · 16,7 · 19,2 · 19,3 · 26,9 | 0,0 · 0,2 · 0,3 · 1,2 · 1,5 · 2,1 · 2,6 · 3,1 · 3,6 · 3,7 · 4,2 · 4,6 · 4,9 · 7,6 · 12,6 · 14,5 · 15,5 · 15,9 · 19,1 · 40,1 · 43,3 · 49,6 |
  | **Métrés comparés**, relevé brut contre relevé redressé (sol, périmètre, plafond, murs bruts, plinthes, murs nets ; par pièce et au total) | 54 | 78 |
  | — différents à la précision affichée | **0** | **0** |
  | — différents en valeur exacte | 38 | 48 |
  | — écart le plus grand | 0,00035 m² (murs nets) ; périmètre : 0,00014 m ; sol : 0,00004 m² | 0,00135 m² (murs) ; périmètre : 0,00054 m ; sol : 0,00035 m² |
  | Murs du modèle (tâche 1), avant → après | 95 → 95, mêmes identifiants et mêmes types | 152 → 152, mêmes identifiants et mêmes types |
  | Ouvertures rattachées à un mur, avant → après | 55 sur 55 → 55 sur 55 | 3 sur 4 → 3 sur 4 |
  | Murs partagés dont les deux faces sont parallèles, avant → après | 8 → 13 sur 17 | 9 → 13 sur 22 |
  | Épaisseurs de mur changées de plus de 0,1 mm | 4 (dont 3 lectures au centimètre qui basculent de 1 cm) | 5 (dont 4 lectures qui basculent de 1 cm ; l'autre passe de 10,00 à 10,18 cm) |
  | Relevé d'entrée non modifié ; deuxième passe sans effet ; ordre des pièces indifférent | oui | oui |

- **Les métrés, en clair.** Aucun métré affiché ne change sur ces deux
  relevés : la liste des différences à la précision affichée est vide. Les
  valeurs exactes, elles, bougent de quelques dixièmes de millimètre ou de
  millimètre carré. Ce « zéro » n'est donc pas une garantie : sur un autre
  relevé, une valeur proche d'un changement d'arrondi peut basculer d'un
  centième. Et il ne vaut que tant qu'aucun point à valider n'est accepté :
  si tous l'étaient, 34 métrés affichés sur 54 et 58 sur 78 changeraient,
  jusqu'à 0,80 et 1,44. Le journal détaille le constat et trois options ; la
  décision revient à Loris.
- **Les points à valider sont-ils vivables ?** 16 et 23, c'est faisable mais
  lourd. Un tiers environ sont de petites retouches (moins de 3 cm) ; les
  autres sont des murs réellement tournés de 1 à 5°, que l'utilisateur
  refusera ou acceptera en connaissance de cause. Élargir la tolérance ne
  résout rien :

  | Tolérance | Louison : points à valider | Louison : métrés affichés qui changent | Montillers : points à valider | Montillers : métrés affichés qui changent |
  |---|---|---|---|---|
  | 1 cm et 0,5° (départ) | 16 | 0 sur 54 | 23 | 0 sur 78 |
  | 1 cm et 1° | 16 | 0 | 22 | 4 |
  | 1 cm et 2° | 16 | 0 | 21 | 4 |
  | 2 cm et 0,5° | 15 | 9 | 21 | 10 |
  | 2 cm et 1° | 15 | 9 | 20 | 10 |
  | 2 cm et 2° | 15 | 11 | 19 | 12 |
  | 3 cm et 0,5° | 14 | 15 | 21 | 10 |
  | 3 cm et 1° | 14 | 15 | 19 | 10 |
  | 3 cm et 2° | 13 | 15 | 18 | 14 |
  | 5 cm et 0,5° | 14 | 15 | 20 | 16 |
  | 5 cm et 1° | 13 | 23 | 18 | 16 |
  | 5 cm et 2° | 8 | 40 | 14 | 28 |

  Ce qui réduit vraiment la liste, c'est de ne plus appeler « presque droit »
  un mur tourné de plus de 3° ou de 2° (au lieu de 5°) : 13 et 17 points, ou
  11 et 13, sans changer un seul métré affiché. À l'inverse, ne rien
  appliquer sans validation donnerait 26 et 35 points.
- **Points surprenants, creusés** (détail dans le journal) :
  - Dans ces relevés, la plupart des côtés d'une même pièce sont déjà
    d'équerre entre eux (surtout sur Louison) ; ce sont des groupes de côtés,
    souvent la pièce entière, qui sont tournés par rapport au reste du
    logement, de 0,5 à 4°. D'où le choix de faire tourner ces côtés d'un
    bloc : les dimensions de la pièce ne changent pas.
  - Une première version changeait 4 métrés affichés sur chaque relevé pour
    des déplacements inférieurs au millimètre. Cause trouvée et corrigée (le
    bruit du relevé était amplifié) ; ce n'est pas un réglage de tolérance.
  - Les murs du modèle gardent leurs identifiants sur les deux relevés réels,
    mais ce n'est pas garanti dans tous les cas (voir le journal).
- **Vérifications automatiques** : nouveau script `verif-plan-v2-redressement`,
  19 cas, branché sur GitHub. Chaque cas vérifie en plus que le relevé reçu
  n'est pas modifié, que la tolérance n'est jamais dépassée et qu'une deuxième
  passe ne change rien. Les logements dessinés ou tirés au sort pour les cas
  et le relevé de référence anonymisé : exemple issu des tests, données
  fictives. Sur ce relevé de référence (6 pièces) : 14 corrections appliquées
  (8 angles, 6 alignements), 7 points à valider, 35 sommets déplacés sur 39,
  de 8,5 mm au plus, et 28 métrés affichés sur 42 qui changent — exemple issu
  des tests, données fictives.
- **Journal des MAJ** : pas d'entrée (rien de visible pour les utilisateurs).
- **Mise en ligne** : en ligne depuis le 25/11/2026. Demande de fusion #271,
  15 contrôles verts, fusionnée par la session pilote, déploiement de
  production terminé avec succès. L'ouverture de l'application n'a pas pu
  être testée depuis l'environnement de Claude (site de production non
  joignable d'ici) ; la tâche n'ajoute aucun écran et aucun fichier chargé
  par l'application.

### Tâche 6a — scène du plan et sortie SVG (25/11/2026)

- **Ce qui a changé** : rien de visible dans l'application. Elle sait
  maintenant produire le dessin d'un plan à partir d'un relevé : pièces
  colorées selon leur type avec leur nom et leur surface, murs pleins à leur
  épaisseur avec les angles fermés, ouvertures, cotes intérieures calculées,
  et en orange tout ce qui reste à valider. Ce dessin sort en SVG (une image
  nette à tout zoom). Ce n'est pas encore un écran : l'affichage dans la page
  viendra avec la tâche 6b, qui réutilisera exactement ce dessin.
- **Rien n'est touché dans l'existant** : aucun fichier de l'ancien éditeur
  ni des tâches 1 et 2 modifié, aucune écriture en base, aucune migration,
  aucune page.
- **Les images** : deux par relevé réel (le plan entier et un détail). Elles
  sont remises dans la conversation et **ne sont pas dans le dépôt** (dépôt
  public). Elles viennent du module de dessin, hors application.
- **Essai sur les deux relevés réels de la base** (relevé redressé, modèle,
  métrés calculés sur ce même relevé). Chiffres agrégés ; les relevés
  eux-mêmes ne sont pas dans le dépôt.

  | | Louison RDC | Montillers appt 1 T3 |
  |---|---|---|
  | Éléments à dessiner | 280 | 349 |
  | Pièces (sol coloré, nom, surface) | 8 | 12 |
  | Étiquettes qui tiennent dans leur pièce (à 50 pixels par mètre) | 8 sur 8 | 11 sur 12 (une pièce de 2 m² : étiquette sur fond clair) |
  | Murs pleins (un par mur du modèle à épaisseur connue) | 70 | 125 |
  | Jonctions d'angle, en T ou en croix | 60 (dont 18 derrière un décrochement) | 82 (dont 15 derrière un décrochement) |
  | Limites sans mur (trait fin) | 0 | 2 (les deux pièces qui se chevauchent) |
  | Murs d'épaisseur inconnue (trait interrompu) | 0 | 0 |
  | Murs du modèle sans dessin propre : « raccords », leur matière est celle du mur voisin | 25 | 25 |
  | Jonctions écartées, avec leur raison | 1 (tombait dans une pièce) | 13 (9 tombaient dans une pièce, 2 sans matière dessinée par iMapper, 2 à côté d'une limite sans mur) |
  | Ouvertures dessinées en menuiserie | 0 | 0 |
  | Ouvertures « à valider » (orange, dans le mur) | 55 | 0 |
  | Ouvertures « à placer » (pastille orange « ? ») | 0 | 4 |
  | Cotes intérieures | 71 | 101 |
  | — affichées sur l'image (50 pixels par mètre) | 67 | 81 |
  | — non affichées à cette échelle, et pourquoi | 2 doublons (deux faces d'une même cloison), 1 chevauchement, 1 côté trop court pour le texte | 14 chevauchements, 5 côtés trop courts, 1 hors de la pièce |
  | Repères de points à valider (redressement) | 16 | 23 |
  | Zones à toucher d'au moins 44 px | 71 | 27 |
  | Emprise des murs pleins | 42,70 m² | 50,38 m² |
  | — part qui recouvre l'intérieur des pièces | **0,01 %** | **0,13 %** |
  | — pour comparaison, les murs dessinés par iMapper | 0,52 % | 6,47 % |
  | Murs dessinés par iMapper retrouvés dans les murs pleins ou dans les pièces | 98,7 % | 97,5 % |
  | Temps de calcul : scène / mise en page / écriture du SVG | 59 à 75 ms / 14 à 19 ms / 2 à 4 ms | 88 à 110 ms / 12 à 17 ms / 2 à 3 ms |
  | Relevé, modèle, métrés non modifiés ; deux calculs identiques | oui | oui |

- **Ce qui est bon sur les images** : les murs sont nets, les angles et les
  rencontres de cloisons sont fermés, les pièces ne sont pas mordues par les
  murs, chaque étiquette est dans sa pièce, les cotes suivent leur mur sans se
  superposer, et l'orange n'apparaît que sur ce qui est à valider.
- **Ce qui reste laid ou incomplet, dit franchement** :
  - « Louison RDC » est très orange : ses 55 ouvertures sont toutes « à
    vérifier » et couvrent chacune un côté entier, donc un trait orange court
    dans presque tous les murs, en plus des 16 points du redressement. C'est
    ce que disent les données, pas un défaut de dessin, mais ce n'est pas un
    plan qu'on montrerait tel quel.
  - Aucune vraie porte ni fenêtre n'apparaît sur ces deux relevés : ils n'en
    contiennent aucune de validée. Le dessin des menuiseries (trou dans le
    mur, vantail, débattement, traits de fenêtre) n'a donc été contrôlé que
    sur le jeu de test — exemple issu des tests, données fictives.
  - Là où une petite pièce est en biais par rapport à ses voisines (une zone
    sur Louison, plusieurs sur Montillers), le mur a une silhouette en dents
    de scie sur quelques centimètres.
  - Les deux relevés sont faits de groupes de pièces très éloignés : le plan
    entier est surtout du blanc, les textes y sont petits. Le détail est
    lisible ; l'écran devra permettre de cadrer sur un groupe.
  - Les murs sont dessinés à l'épaisseur lue par le modèle, qui peut valoir
    29 cm pour un mur dessiné à 30.
- **Vérifications automatiques** : nouveau script `verif-plan-v2-scene`,
  15 cas, branché sur GitHub. Pour chaque cas : entrée non modifiée, deux
  calculs identiques, surface de l'étiquette égale au texte des métrés, un
  élément par mur du modèle ou une raison, cotes égales aux longueurs
  réelles, orange réservé à ce qui est à valider, zones à toucher d'au moins
  44 px, SVG bien formé. Tolérance fixée et justifiée dans le script : les
  murs pleins recouvrent au plus 1 % de leur emprise dans les pièces. Les
  logements dessinés pour les cas et le relevé de référence anonymisé :
  exemple issu des tests, données fictives. Sur ce relevé de référence
  (6 pièces) : 30 murs pleins, 27 jonctions, 10 raccords, 3 jonctions
  écartées, 6 menuiseries, 14 ouvertures à valider, 36 cotes dont 31
  affichées, 7 repères, 0,00 % de murs dans les pièces — exemple issu des
  tests, données fictives.
- **Journal des MAJ** : pas d'entrée (rien de visible pour les utilisateurs).
- **Mise en ligne** : demande de fusion #272, état réel confirmé par la
  session pilote.
