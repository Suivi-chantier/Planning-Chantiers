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

| N° | Tâche | Statut | Validation | Preuve de réussite | Demande de fusion |
| --- | --- | --- | --- | --- | --- |

## Journal des décisions

## Comptes rendus
