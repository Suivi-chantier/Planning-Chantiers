# Projet : Fiche de préparation sécurité chantier

Règles complètes : `CLAUDE.md`, section « Projets longs : travail en autonomie ».
Spécification complète de François (fait foi pour le détail des écrans, des
tables et des règles) : `docs/projets/fiche-securite-chantier-specification.md`.

> Sections de François recopiées depuis sa spécification du 25/11/2026. Création
> du fichier projet et lancement validés par François le 25/11/2026, avec les
> corrections listées au journal du même jour.

---

<!-- Sections de François : Claude ne les modifie jamais. -->

## Objectif métier

Chaque chantier doit avoir une fiche de préparation sécurité remplie, signée et
justifiée avant son démarrage, consultable depuis la page de l'opération et
présentable en cas de contrôle (inspection du travail, CARSAT, OPPBTP).

La procédure papier « Procédure de préparation de chantier — v2 » (12 points)
est transposée dans l'appli :

- un bouton « Fiche sécurité » sur la page de chaque opération, une fiche par
  chantier ;
- une fiche éditable, pré-remplie à partir des données existantes (phasage,
  planning, sous-traitants) ;
- des signatures électroniques simples (établie par, chef d'équipe, accueil de
  chaque intervenant) ;
- des justificatifs joints par point, et un espace de justificatifs permanents
  de l'entreprise avec dates d'expiration ;
- une intégration au cycle de vie : le démarrage est bloqué tant que la fiche
  n'est pas validée ;
- un export PDF à la charte Profero, identique au modèle papier.

## Règles et invariants

- Une fiche par chantier (table `chantiers`) ; les données du bâtiment sont
  saisies une fois au niveau de l'opération et reprises en lecture dans chaque
  fiche.
- Le contenu suit exactement les 12 points du PDF v2. Chaque point a un statut
  `a_completer`, `concerne` ou `non_concerne` ; une proposition automatique ne
  valide jamais un point toute seule.
- Les définitions des points sont dans le code (`securite/points.ts` ou
  équivalent), la base ne stocke que les réponses.
- Rien n'est supprimé de l'existant ; aucune table existante n'est modifiée ;
  patterns RLS actuels respectés (`est_ouvrier()`, `mon_role()`,
  `est_collaborateur_actif()`, `profero_collaborateurs_seulement`).
- Versions et signatures : jamais modifiées ni supprimées, même par un admin.
- Aptitudes médicales : visibles par les seuls admins, dans l'appli comme dans
  le stockage.
- Un seul contrôle bloquant : le passage d'un chantier « en cours » exige une
  fiche validée (forçage admin motivé, tracé dans l'historique du chantier).
- Pas de blocage rétroactif pour les chantiers déjà en cours.
- Critères d'acceptation : ceux de la spécification, section « Plan de
  livraison et critères d'acceptation ».

## Hors périmètre

Mise à jour automatique du DUERP, signature électronique qualifiée (eIDAS),
envoi de la fiche aux sous-traitants par mail. Pas de déclencheur bloquant en
base en v1 pour le démarrage.

## Description des étapes

1. **Fiche et PDF** : migration, bloc bâtiment sur la page opération, fiche
   éditable avec les 12 points, justificatifs de chantier, signatures « établie
   par » et « chef d'équipe », validation, export PDF. (Suffit pour le prochain
   contrôle.)
2. **Pré-remplissage** : règles de la spécification, propositions affichées avec
   leur raison, alertes de divergence.
3. **Cycle de vie et équipe** : étape « Fiche sécurité validée », blocage du
   passage en cours avec forçage, signature d'accueil côté ouvrier, nouvelles
   versions, verrouillage à la clôture.
4. **Espace entreprise** : justificatifs permanents, rattachement automatique,
   alertes d'expiration, bouton « Dossier de contrôle ».

## Validation automatique

Règle par défaut de `CLAUDE.md`. Arrêts obligatoires rappelés : la migration de
la tâche 1 (droits d'accès) et la nouvelle page de la tâche 9 (`src/access.js`)
attendent l'accord de François.

---

<!-- Sections de Claude : mises à jour après chaque tâche et avant tout arrêt. -->

## Tâches

| N° | Tâche | Statut | Validation | Preuve de réussite | Demande de fusion |
|----|-------|--------|------------|--------------------|-------------------|
| 1 | Migration : 5 tables `securite_`, vues d'état, déclencheurs d'immuabilité, droits, dossier de stockage `securite-confidentiel` (avec le verrou `profero_collaborateurs_seulement`) ; script `verif-*` des règles de droits | en ligne (migration appliquée et fusion le 25/11/2026) | **Arrêt avant application** (droits d'accès) | Essai dans une transaction annulée sur la vraie base ; tables, policies et verrou présents après application ; l'appli s'ouvre | [#281](https://github.com/Suivi-chantier/Planning-Chantiers/pull/281) |
| 2 | Page opération : bouton « Fiche sécurité », panneau des chantiers avec pastilles, bloc « Bâtiment » éditable | en ligne (fusion le 25/11/2026, 13 contrôles verts ; enregistrement du bloc Bâtiment à confirmer par François dans l'appli) | Auto | Pastilles justes sur une opération réelle ; bloc bâtiment relu après rechargement | [#282](https://github.com/Suivi-chantier/Planning-Chantiers/pull/282) |
| 3 | Fiche éditable : configuration des 12 points dans le code, bandeau, points 1 et 2 (responsable saisi à la main), cartes 4 à 12, synthèse, enregistrement automatique | en ligne (fusion le 25/11/2026 ; libellés des cases à faire relire par François — PDF v2 demandé ; rechargement d'une vraie fiche à confirmer dans l'appli) | Auto | Fiche remplie, rechargée, réponses intactes ; utilisable sur tablette | [#283](https://github.com/Suivi-chantier/Planning-Chantiers/pull/283) |
| 4 | Justificatifs de chantier, signatures « établie par » / « chef d'équipe », bouton « Valider » avec liste de ce qui manque, version figée + empreinte, lecture seule, « Mettre à jour » avec motif | en ligne (fusion le 25/11/2026, 15 contrôles verts ; écritures essayées sur la vraie base en transaction annulée ; validation réelle à confirmer dans l'appli) | Auto | Validation refusée tant qu'il manque un élément ; version et signature non modifiables | [#284](https://github.com/Suivi-chantier/Planning-Chantiers/pull/284) |
| 5 | Export PDF charte Profero, généré et stocké à chaque validation + entrée `journalMaj.js` (fin de la première livraison) | en ligne (fusion le 25/11/2026, 20 contrôles verts ; génération réelle à confirmer dans l'appli) — **première livraison complète** | Auto | PDF conforme au modèle v2 avec signatures | [#285](https://github.com/Suivi-chantier/Planning-Chantiers/pull/285) |
| 6 | Pré-remplissage : module de calcul pur (`.mjs` + façade), propositions avec raison, alertes de divergence + `verif-*` | en ligne (fusion le 25/11/2026, contrôles verts ; question posée à François : un collègue dans un autre logement du même immeuble suffit-il à écarter le travail isolé ?) | Auto | Propositions justes sur des chantiers réels (phasage, planning) | [#286](https://github.com/Suivi-chantier/Planning-Chantiers/pull/286) |
| 7 | Cycle de vie : étape `fiche_securite`, blocage du passage en cours + forçage admin tracé dans `chantiers_statut_journal`, verrouillage à « terminé », alertes `notifications` | en ligne (fusion le 25/11/2026, 24 contrôles verts) ; **en attente de François** : reprise des 20 chantiers en cours, alertes dans `notifications`, droit du chargé d'affaires sur l'étape | Auto, sauf reprise de données et droits (arrêt) | Passage en cours refusé sans fiche validée ; forçage visible dans l'historique | [#287](https://github.com/Suivi-chantier/Planning-Chantiers/pull/287) |
| 8 | Équipe : signature d'accueil côté ouvrier (mobile), « signée sur la v1 », nouvelle version proposée quand un prestataire arrive au planning | en cours (demande de fusion ouverte, contrôles GitHub à attendre ; essai sur la vraie base en transaction annulée conforme) | Auto | Un ouvrier signe à son nom et ne peut rien modifier d'autre | à venir |
| 9 | Espace « Justificatifs entreprise », rattachement automatique, alertes 30 jours, « Dossier de contrôle » (ZIP) + entrée `journalMaj.js` | à faire | **Arrêt** : nouvelle page, qui la voit | Aptitudes médicales invisibles pour un non-admin, ZIP sans documents confidentiels | — |

## Journal des décisions

**25/11/2026 — Lancement et corrections de la spécification (validées par
François).**

- Le nouveau dossier de stockage `securite-confidentiel` reçoit le verrou
  `profero_collaborateurs_seulement` (oublié dans le SQL de la spécification).
  Constat au passage, hors projet : `notes-ouvriers` et `factures-privees` ne
  l'ont pas non plus aujourd'hui.
- La table `chantiers` n'a pas de responsable : au point 1, **le responsable est
  saisi à la main dans la fiche** (réponse de François).
- Colonne des signatures : on garde `auth_user_id` (le texte disait
  `utilisateur_id`) ; elle correspond à `planning_resources.auth_user_id`.
- « Prêt à démarrer » et « justificatifs requis manquants » sont calculés dans
  l'appli (la liste des justificatifs attendus vit dans le code), pas par la vue
  de la base.
- Pas de fiche créée pour les chantiers déjà terminés (15 au 25/11/2026).
- À savoir pour la tâche 6 : `planning_cells.jour` est un nom de jour
  (« Lundi »…) associé à `week_id` (« 2026-W48 »), pas une date.

**25/11/2026 — État constaté sur la base (requête réelle).** 62 chantiers :
16 à l'étude, 1 planifié, 6 en cours, 15 terminés, **24 sans statut**. Aucune
table `securite_` n'existe encore. François demande la liste des 24 pour leur
donner un statut (voir comptes rendus).

**25/11/2026 — Tâche 1 : migration préparée, essayée, NON appliquée.**
Fichier : `supabase/migrations/20261125114305_securite_fiches_chantier.sql` (renommé ensuite `20261125121322_…`, voir plus bas)
(nom horodaté au lieu de `20261125_…` de la spécification, convention du
dossier). Écarts avec le SQL de la spécification, et pourquoi :

- a. Verrou `profero_collaborateurs_seulement` de `storage.objects` recréé à
  l'identique avec `securite-confidentiel` en plus (correction déjà validée).
  `notes-ouvriers` et `factures-privees` volontairement laissés de côté (hors
  projet). Aucune autre liste de buckets à tenir à jour dans le dépôt : celles
  de `scripts/verif-collaborateurs-seulement.mjs` et du document 3A décrivent
  la migration du 01/10, pas l'état courant.
- b. Droits SQL explicites, modèle `chantiers_statut_journal` : tout retiré à
  `anon`, et pour les connectés lecture / ajout / modification seulement, jamais
  suppression ni vidage ; sur les versions, seule la colonne `pdf_path` peut
  être modifiée. Sans cela, les droits par défaut de Supabase donnaient tout.
- c. Vidage complet (`truncate`) des versions et signatures refusé aussi par
  déclencheur (les déclencheurs ligne par ligne ne le voient pas).
- d. Signature d'accueil d'un ouvrier : seulement sur la version en cours,
  validée, d'une fiche d'un chantier non archivé, avec l'empreinte exacte de
  cette version. En contrepartie, l'ouvrier peut lire les versions des fiches
  qu'il voit déjà (il en a besoin pour signer).
- e. Signature saisie au bureau : elle ne peut pas porter le compte d'un autre
  utilisateur (compte vide pour un sous-traitant, ou celui de la personne
  connectée). Le SQL d'origine permettait de signer au nom d'un collègue.
- f. Colonnes qualifiées dans les sous-requêtes des règles ouvrier ; chemin de
  recherche figé sur les 3 fonctions de déclencheur (recommandation Supabase).
- g. Garde-fou en fin de migration : elle échoue sans rien laisser si une table
  `securite_` n'a pas la RLS et le verrou, ou si le bucket n'est pas couvert.
- Inchangé : `auth_user_id`, vues `security_invoker`, `on delete restrict`.
  La vue d'état ne calcule pas « prêt à démarrer » (fait dans l'appli).
- Vérifié en base au passage : aucun objet `securite_` ni bucket
  `securite-confidentiel` n'existe ; `chantiers.id`, `operations.id` en texte,
  `chantiers.archive_le` présent ; fonctions de droits présentes.
- **Constat à trancher (question 2 ci-dessous)** : dans `chantier-documents`,
  tout collaborateur connecté, ouvriers compris, peut supprimer un fichier
  (règle existante « chantier-documents suppression »). Les images de
  signature et les PDF de version prévus dans ce bucket pourraient donc être
  effacés, même si la ligne en base reste intacte.

**25/11/2026 — Statuts des 24 chantiers complétés (réponse de François).**
Briollay, Fourmond, Kathleen, Metois, Montilliers, Tourbouton : en cours ;
Fougeray, Louison : planifié ; Lamartine : terminé. Appliqué sur la base :
24 chantiers mis à jour (14 en cours, 9 planifiés, 1 terminé), chacun tracé
dans `chantiers_statut_journal` (événement `statut_complete`, ancien statut
vide : retour arrière possible). Après : 0 chantier sans statut, dans la table
comme dans la configuration (16 à l'étude, 10 planifiés, 20 en cours,
16 terminés). Conséquence pour le projet : ces 14 chantiers en cours sont
« déjà en cours à la mise en service » (fiche brouillon + alerte, pas de
blocage).

**25/11/2026 — Réponse de François aux deux questions de la tâche 1 : « Oui et
oui ».** 1) appliquer la migration ; 2) ajouter un espace de stockage où rien
ne peut être effacé pour les images de signature et les PDF de version.

- Ajouté à la même migration (pas encore appliquée) : bucket privé
  `securite-preuves`. Chemins : `signatures/{fiche_id}/…` (images de
  signature) et `versions/{fiche_id}/…` (PDF de version). **Ils ne vont plus
  dans `chantier-documents`** (la spécification le prévoyait ; corrige aussi la
  section « Stockage » pour les tâches 4, 5 et 8). Les autres justificatifs
  restent dans `chantier-documents` sous `securite/…`.
- Règles : bureau = lecture et dépôt partout ; ouvrier = lecture des preuves
  des fiches qu'il voit, dépôt seulement sous `signatures/{fiche_id}/` d'une
  fiche qu'il voit ; **aucune règle de modification ni de suppression**, pour
  personne (un dépôt « remplacer si existe » est donc refusé). Bucket ajouté au
  verrou `profero_collaborateurs_seulement` et au garde-fou final, qui refuse
  aussi toute règle de modification / suppression sur un bucket `securite-`.
- Conséquence pour l'appli : un fichier déposé ne se remplace pas ; une
  nouvelle image ou un nouveau PDF prend un nouveau nom.
- Deuxième essai complet dans une transaction annulée (vraie base) : 54
  contrôles conformes, dont les nouveaux sur `securite-preuves`. Les essais
  « supprimer un fichier » y étaient bloqués par la protection générale de
  Supabase contre les suppressions directes, et « écraser » par une erreur de
  syntaxe de l'essai, pas encore par les règles elles-mêmes. Un essai ciblé
  (même protection levée comme le fait le service de stockage, écrasement
  correctement écrit) a été lancé, mais l'outil de base de données a demandé
  une confirmation restée sans réponse : **il n'a pas tourné**. Au vu des
  règles, il doit montrer 0 fichier supprimé et l'écrasement refusé, car aucune
  règle ne permet de modifier ou de supprimer un fichier de ce bucket.
- **Pas encore appliquée** : à reprendre par cet essai ciblé, puis
  l'application (même nom), puis les vérifications prévues.

**25/11/2026 — Tâche 1 : migration appliquée.**

- Essai ciblé sur `securite-preuves`, annulé ensuite (vraie base, protection
  générale de suppression levée comme le fait le service de stockage) :
  ouvrier et admin suppriment 0 fichier, modifient 0 fichier, l'écrasement est
  refusé par les règles (« row-level security »), le redépôt du même nom est
  refusé, les 2 fichiers d'essai restent intacts. 10 contrôles conformes.
- Appliquée par `apply_migration` (nom `securite_fiches_chantier`). Version
  enregistrée par la base : **20261125121322** ; le fichier a été renommé
  `20261125121322_securite_fiches_chantier.sql` pour rester aligné.
- Vérifié après application (requêtes réelles) : migration présente dans la
  liste ; 5 tables avec RLS et verrou `profero_collaborateurs_seulement`,
  2 vues ; 21 règles sur les tables `securite_` ; buckets
  `securite-confidentiel` et `securite-preuves` privés ; verrou du stockage
  couvrant chantier-documents, invest-documents, photos,
  securite-confidentiel, securite-preuves ; 6 règles de stockage, uniquement
  lecture ou dépôt. Alertes sécurité Supabase : aucune ne concerne un objet
  `securite_` ou `securite-` (les alertes listées existaient déjà).
- Reste pour clore la tâche : contrôles GitHub verts sur la demande de fusion,
  fusion par la session principale, application qui s'ouvre.

**25/11/2026 — Tâche 1 en ligne.** 9 contrôles GitHub verts du premier coup,
demande de fusion #281 fusionnée. Vérifié sur la base après fusion : migration
`20261125121322` enregistrée, 5 tables avec RLS et verrou, buckets
`securite-confidentiel` et `securite-preuves` privés. Ouverture de
l'application dans un navigateur non faite depuis l'environnement de Claude ;
la tâche 1 ne change aucun écran. Tâche 2 lancée.

**25/11/2026 — Tâche 2 : page Opération, bouton « Fiche sécurité ».**

- Vérifié avant de coder : la page Opérations est une page bureau. En base
  (`planning_config.access_pages_renovation`), admin, super_admin, conducteur,
  comptable, commercial et chargé d'affaires l'ont ; ouvrier ne l'a pas.
  **Aucune page ajoutée à `src/access.js`** : le bouton vit dans la page
  existante, il est donc visible pour les mêmes rôles qu'elle (admin compris).
  Côté base, la règle « bureau » de `securite_operations` laisse tous ces rôles
  modifier le bloc Bâtiment (pas les ouvriers).
- Pastille calculée par un module pur `securitePastilles.mjs` (+ façade `.js`)
  à partir de la ligne de `securite_fiches_etat`. Choix faits :
  - lecture en échec → « état illisible » (pointillés), en cours →
    « chargement… » : jamais « à créer » ;
  - chantier terminé sans fiche → « pas de fiche — chantier terminé » (gris),
    pas « à créer », puisqu'on ne crée pas de fiche pour eux (décision du
    25/11) ; affaire perdue sans fiche → « pas de fiche — affaire perdue » ;
  - fiche `verrouillee` → « verrouillée vN » (gris-bleu), prioritaire sur tout ;
  - `a_mettre_a_jour` (statut prévu en base, pas cité dans la spécification
    des pastilles) → orange « à mettre à jour — n/12 » ;
  - rouge : le module accepte déjà `justificatifs { manquants, expires }`,
    mais la page ne le fournit pas encore (règle des tâches 3-4) : **aucune
    pastille rouge n'est affichée pour l'instant**. Une fiche validée ne
    passe pas en « justificatifs manquants », seulement en « expiré ».
  - statut de fiche inattendu → « état inconnu (…) ».
- Bloc Bâtiment : enregistrement par bouton « Enregistrer » (pas
  d'enregistrement automatique : un bloc de six champs, une seule écriture
  par upsert sur `operation_id`). Une case vide est enregistrée vide, jamais
  « non ». Le statut du repérage amiante propose les 6 valeurs du check en
  base, dont `a_completer` (défaut en base) affiché « Non renseigné (à
  compléter) ». « Avant 1997 / avant 1949 » sont relus dans la base après
  enregistrement. Si la lecture du bloc échoue, il n'est pas modifiable (sinon
  on écraserait des données jamais vues).
- Liste du panneau : chantiers de l'opération non archivés (règle
  `estChantierArchive`), tous statuts confondus.


**25/11/2026 — Tâche 3 : écran de la fiche d'un chantier.**

- Emplacement de la configuration des points : la spécification dit
  `securite/points.ts` ; le dépôt est en JavaScript, donc
  `src/Renovation/securite/points.mjs` (module pur, lisible par les scripts de
  vérification) + façade `points.js`. La logique de l'écran est dans
  `src/Renovation/securiteFiche.mjs` (+ façade), à côté de
  `securitePastilles.mjs`.
- Le PDF v2 n'est pas dans le dépôt : **les libellés des cases des points 4 à
  12, les champs du point 2 et la liste des justificatifs attendus par point
  sont une proposition** construite à partir de la spécification (seules les
  cases du point 5 « zones listées, trémies protégées, échafaudage vérifié »
  y figuraient). À faire relire par François. Les codes des cases ne doivent
  plus changer une fois des fiches remplies (les réponses y sont rattachées).
- `concerneSi` est présent et vide (null) sur les 12 points : réservé à la
  tâche 6.
- Justificatifs : `requis: true` proposé pour repérage amiante (point 4),
  habilitation électrique (6), consigne de travail isolé (9), fiche de remise
  des EPI (10) ; les autres « selon le cas ». Utilisé seulement à la tâche 4.
- **« n/12 » : même définition que la vue `securite_fiches_etat`** (relue sur
  la base, identique à la migration ; même résultat que PostgreSQL sur 4
  échantillons, requête de lecture sur des valeurs littérales). Conséquence à
  connaître : la vue compte le point 1 dès qu'il y a **un** intervenant (le
  responsable seul suffit), le point 2 dès qu'**un** champ est rempli, le
  point 3 dès qu'**une** ligne est saisie. L'appli suit la vue, sans
  recalcul différent. Pour que ce compte reste honnête, l'enregistrement
  n'écrit jamais de champ vide (une fiche ouverte et non remplie reste à
  0/12) et n'écrit dans `reponses` que p4 à p12 (la vue compte toute clé).
- Point 1 : le responsable est saisi à la main (décision du 25/11) ; le client
  (celui du chantier, sinon celui de l'opération) et l'adresse (de
  l'opération) sont **lus**, pas recopiés dans la fiche : ils seront figés
  dans la version à la validation (tâche 4). Stockage dans `intervenants` :
  `{type: "responsable", nom, telephone}` et
  `{type: "entreprise", id, nom, activite, contact, telephone}`.
- Point 2 (`donnees_base`) : lots (cases issues de la liste des lots de
  l'appli), début et fin prévus, date de dépose des sanitaires, effectif
  maximum, logement occupé (oui / non / non renseigné), accès, observations.
  Bâtiment affiché en lecture ; le lien « Modifier dans le bloc Bâtiment »
  ramène au panneau de l'opération.
- Point 3 (`synthese_risques`) : tableau de 3 lignes de texte au plus.
- « Créer la fiche » n'apparaît que quand la pastille dit « à créer » : pas
  pour un chantier terminé (décision du 25/11), ni pour une affaire perdue,
  ni quand l'état des fiches est illisible. Si quelqu'un a créé la fiche
  entre-temps, on ouvre la sienne.
- Enregistrement automatique 0,9 s après la dernière frappe. L'écriture ne
  passe que si la fiche est toujours en brouillon **et** n'a pas été
  modifiée ailleurs depuis la lecture (même `updated_at`) ; sinon rien n'est
  écrit, l'écran affiche « erreur, non enregistré » avec la raison et
  propose de recharger. Une saisie invalide (date impossible, effectif non
  entier) n'est pas enregistrée et le dit.
- Lecture seule : toute fiche qui n'est pas en brouillon (validée, à mettre à
  jour, verrouillée), et toute fiche dont le contenu en base a une forme
  inattendue (pour ne rien écraser). Les éléments inconnus (case retirée de
  la configuration, clé ou type inattendus) sont conservés tels quels.
- Aucune page ajoutée dans `src/access.js`, aucune migration, aucune écriture
  en base pendant le développement (0 fiche en base au 25/11).

**25/11/2026 — Tâche 4 : justificatifs, signatures, validation, versions.**

- Livrée en une seule demande de fusion (pas de découpage 4a / 4b : les
  justificatifs requis font partie de la règle de validation, les séparer
  aurait livré un bouton « Valider » incomplet).
- **Flux signature / empreinte choisi.** La base exige (règle ouvrier, tâche
  8) que l'empreinte d'une signature d'accueil soit celle de la ligne de
  version figée ; la spécification veut que « établie par » et « chef
  d'équipe » soient faites AVANT la validation. Donc :
  1. la fiche doit être complète (règle stricte ci-dessous) et enregistrée ;
  2. l'appli calcule l'empreinte du contenu qui sera figé : sérialisation
     canonique (clés triées, module pur `securiteVersion.mjs`) puis sha256
     (Web Crypto, `securiteDonnees.js`) ;
  3. chaque signature relit d'abord tout en base, recalcule l'empreinte,
     refuse si elle diffère de celle affichée, dépose l'image PNG dans
     `securite-preuves` sous `signatures/{fiche_id}/v{N}-{type}-{horodatage}-{aléa}.png`
     (nom toujours nouveau : le bucket refuse tout remplacement), puis
     insère `securite_signatures` (version N, `empreinte_version`) ;
  4. « Valider » relit tout, recalcule, exige les deux signatures avec CETTE
     empreinte sur la version N, insère `securite_fiches_versions` (contenu
     complet, même empreinte, motif), puis passe la fiche en « validée »
     (seulement si toujours brouillon, même version, même `updated_at`), puis
     écrit le journal du chantier (`fiche_securite`).
  Une modification après signature change l'empreinte : la signature reste
  en base (rien ne s'efface), s'affiche « signée sur un contenu antérieur —
  à refaire », et il faut re-signer. Si la validation s'interrompt entre la
  version et la fiche : relancer réussit si le contenu n'a pas bougé (même
  empreinte) ; sinon l'écran propose de passer en version N+1 (motif).
- **Contenu figé** (`contenuVersion`) : fiche (4 colonnes), version, motif,
  chantier, opération et adresse, libellé du client, bâtiment (8 champs),
  justificatifs actifs (9 champs). Rien de volatil (pas de `updated_at`, pas
  de date de validation : elle est dans `cree_le` de la version).
- **Règle stricte de validation** (`securiteValidation.mjs`), distincte du
  « n/12 » de la vue qui reste l'indicateur d'avancement. L'écran affiche les
  deux (« 12/12 renseignés, 3 éléments manquants pour valider ») et la liste.
  Point 1 : responsable avec nom ET téléphone, au moins une entreprise
  nommée, aucune entreprise sans nom, adresse de l'opération. Point 2 : au
  moins un lot, début et fin (fin ≥ début), effectif, logement occupé
  oui / non. Point 3 : au moins 2 risques. Points 4 à 12 : statut choisi et,
  si « Concerné », au moins une case ou une mesure. Justificatifs `requis`
  des points concernés (points 1 à 3 toujours concernés) joints au point,
  non retirés, non expirés.
- **Amiante** : bloquant si permis avant le 1/7/1997 sans repérage reçu
  (critère d'acceptation) ; bloquant aussi si la date du permis est inconnue
  sans repérage reçu (on ne peut pas savoir : impossibilité visible).
- **« Mettre à jour »** : motif obligatoire (5 caractères au moins), version
  + 1, retour en brouillon. Le motif est écrit d'abord au journal du chantier
  (« Ouverture de la vN+1… »), relu à la validation suivante et figé dans
  `motif_changement` de la nouvelle version (pas de colonne de motif sur la
  fiche, aucune migration). Motif introuvable = validation bloquée.
- **Justificatifs** : `chantier-documents` sous
  `securite/chantiers/{chantier_id}/p{point}/` via le service d'envoi
  existant (`storageChantier.js`) ; ouverture par URL signée (10 min) ;
  retrait = `archive_le`, jamais de suppression. Types proposés : ceux du
  point + photo + autre, sans aptitude médicale (tâche 9). Ajout et retrait
  seulement sur une fiche en brouillon. Si la ligne en base est refusée, le
  fichier tout juste envoyé est retiré (rattaché à rien).
- **Signature au bureau** : « Je signe moi-même » (coché par défaut pour
  « établie par ») rattache le compte connecté ; décoché, le compte reste
  vide (la base refuse de signer au nom d'un autre compte). Canvas maison
  (Pointer Events), pas de nouvelle dépendance : `signature_pad` n'est pas
  dans le projet.
- **Pastille rouge** : le panneau lit les réponses des fiches et les
  justificatifs actifs, et applique la même fonction que la fiche
  (`justificatifsPourPastille`). « Expiré » = date d'expiration avant
  aujourd'hui, même règle que la vue `securite_justificatifs_expiration`
  (date du jour de l'appareil). Justificatifs illisibles : pas de rouge, un
  message le dit.
- Scripts existants ajustés (2 assertions qui figeaient l'état de la tâche
  3) : `verif-securite-fiche.mjs` (l'écran n'appelle toujours pas le stockage
  directement) et `verif-securite-pastilles.mjs` (la pastille reçoit les
  justificatifs). Nouveau : `verif-securite-validation.mjs` + workflow.
- Pas de PDF (`pdf_path` jamais écrit, tâche 5), pas de migration, aucune
  page ajoutée à `src/access.js`, aucune écriture en base pendant le
  développement (0 fiche, 0 justificatif, 0 signature, 0 version au 25/11).
  Entrée `journalMaj.js` prévue à la tâche 5 (fin de la première livraison).

**25/11/2026 — Tâche 4 : essai des écritures sur la vraie base (transaction
annulée, demandé avant fusion).** Requêtes reproduites à l'identique de
`securiteDonnees.js`, avec un vrai compte admin connecté (rôle simulé
« authenticated », chantier planifié réel), puis refaites avec le compte
comptable (rôle bureau non admin). Résultats, tous conformes :
création de fiche ; enregistrement avec la condition `updated_at` (1 ligne) ;
dépôt d'un fichier dans `chantier-documents` sous `securite/chantiers/…/p6/` ;
ligne de justificatif chantier ; 2 dépôts dans `securite-preuves` sous
`signatures/{fiche_id}/` ; 2 signatures avec l'empreinte (« établie par »
rattachée au compte connecté par défaut, « chef d'équipe » sans compte) ;
ligne de version ; fiche → « validée » avec `validee_le` / `validee_par`
(1 ligne) ; journal `fiche_securite` ; archivage du justificatif (1 ligne) ;
« Mettre à jour » : journal puis fiche en v2 brouillon (1 ligne). Après
annulation : 0 fiche, 0 justificatif, 0 signature, 0 version, 0 entrée
`fiche_securite` au journal, 0 fichier `securite-preuves` ou `securite/…`.
Aucun correctif de code nécessaire. À savoir : aucun conducteur actif n'a de
compte de connexion correspondant (essai fait avec admin et comptable) ; dans
une seule transaction l'horloge ne bouge pas, donc la condition `updated_at`
n'a pas été mise à l'épreuve d'un aller-retour réel (elle l'est depuis la
tâche 3 par l'enregistrement automatique).

**25/11/2026 — Tâche 5 : PDF de la fiche (fin de la première livraison).**

- **Technique** : la même que le PDF du Bilan (`html2pdf`, déjà dans le
  projet, chargé à la demande ; aucune nouvelle dépendance). Mise en page
  dans un module pur `securitePdf.mjs` (+ façade) en deux étapes :
  `modelePdfFiche()` (données → modèle ordonné : sections, lignes, cases,
  signatures) puis `htmlFicheSecuritePdf()` (modèle → HTML à la charte, mêmes
  couleurs et décor que `charteDocProfero.mjs`). Rendu navigateur et
  orchestration : `securitePdfRendu.js` ; lectures / écritures :
  `securiteDonnees.js`.
- **Source du PDF** : le contenu figé de la version
  (`securite_fiches_versions.contenu`), jamais la fiche courante. Avant de
  fabriquer le PDF, l'appli recalcule l'empreinte de ce contenu : s'il ne
  correspond plus à l'empreinte signée, pas de PDF (« PDF non généré » avec
  la raison). Historique : seulement les versions jusqu'à celle du PDF (une
  v3 ne change pas le PDF de la v2). Signatures : seulement celles de la
  version portant son empreinte (une signature « à refaire » n'y figure pas) ;
  signature requise absente = « non signée » ; pour un PDF stocké, une image
  de signature illisible fait échouer la génération (on ne stocke pas un PDF
  incomplet), pour un aperçu elle est marquée « image de signature
  illisible ». Images intégrées au document (lues dans `securite-preuves`,
  pas d'URL externe au moment du rendu).
- **Stockage** : `securite-preuves` sous
  `versions/{fiche_id}/v{N}-fiche-securite-{horodatage}-{aléa}.pdf` (nom
  toujours nouveau, dépôt sans remplacement), puis `pdf_path` renseigné avec
  la condition « encore vide ». Si un autre poste l'a renseigné entre-temps,
  c'est le sien qui fait foi (le fichier en trop reste stocké, rien ne
  s'efface) et l'écran le dit.
- **Écran** : PDF généré automatiquement juste après « Valider la fiche » ; en
  cas d'échec la validation reste acquise et la version affiche « PDF non
  généré (raison) · Générer le PDF » (bandeau de la fiche validée et
  historique des versions, pour toute version sans PDF) ; sinon
  « Télécharger le PDF » (lien signé 10 min, nom de fichier proposé). Fiche
  en brouillon : « Aperçu PDF (brouillon) », marqué « BROUILLON — non
  validé » en haut, dans le héros, l'historique et le pied, téléchargé sans
  être stocké.
- Ajout dans `storageChantier.js` : lecture d'une preuve (`download`) et
  option « télécharger sous ce nom » du lien signé. Script existant ajusté :
  `verif-securite-validation.mjs` exigeait « pdf_path jamais écrit » (état de
  la tâche 4) ; il exige maintenant « écrit à un seul endroit, seulement s'il
  est vide ». Nouveau : `verif-securite-pdf.mjs` + workflow.
- **Essai sur la vraie base (transaction annulée)** avec le compte comptable
  (rôle bureau non admin ; rôle « authenticated », identifiant et e-mail dans
  les claims), sur un chantier planifié réel : fiche et version créées ;
  dépôt d'un PDF dans `securite-preuves` sous `versions/{fiche_id}/` accepté ;
  redépôt du même nom refusé ; modification du fichier : 0 ligne ;
  `pdf_path` renseigné (1 ligne) ; second changement refusé par le
  déclencheur (« Une version de fiche sécurité ne peut pas être
  modifiée ») ; second changement avec la condition de l'appli : 0 ligne ;
  modification d'une autre colonne refusée (droits). Après annulation :
  0 fiche, 0 version, 0 fichier `securite-preuves`.
- Pas de migration, aucune page ajoutée à `src/access.js`, aucune écriture
  réelle en base.
- Entrée `journalMaj.js` : première livraison de la fiche sécurité (bouton
  sur la page Opérations, bloc Bâtiment, 12 points, justificatifs,
  signatures, validation, PDF).

**25/11/2026 — Tâche 6 : pré-remplissage.**

- **Sources relevées sur la vraie base (lecture seule).** Lots : planning_config
  « lots_travaux » — `demolition`, `maconnerie`, `murs_cloison`,
  `electricite`, `plomberie`, `menuiserie`, `ouvertures`, `finitions_gen`, et
  deux lots créés dans l'appli dont l'identifiant est généré : « Sol »
  (`lot_1783405744817`) et « Plafond » (`lot_1783409027948`). Le code d'un
  ouvrage est en tête de son libellé (« PL-002 : … »), lu par
  `codeOuvrage.mjs` ; **beaucoup d'ouvrages n'ont pas de code** (« Faux-plafond
  SDB », « Pose d'un carrelage »…) et 45 ouvrages n'ont pas de lot (dont
  « Divers / hors devis » sur 31 chantiers). `planning_resources` : 13
  personnes et **un seul prestataire, nommé « Externe »** (3 cases au planning,
  semaines 20 à 22) ; le planning contient aussi d'anciens noms absents des
  ressources (Stev, Yann, Julien) et des véhicules (semaine 13).
  `securite_operations` : **0 ligne** (aucun bâtiment saisi).
- **Liste unique des déclencheurs** : `DECLENCHEURS_PRE_REMPLISSAGE` dans
  `securite/points.mjs`, avec l'origine de chaque code. Chute de hauteur :
  lot Plafond, préfixes PL et COUV, LOC-001 (échafaudage), V-002 (sortie de
  toiture), D-014 (dépose faux-plafond, écrit aussi « D-14 »), D-020
  (trémie), D-031 (dépose menuiserie extérieure), fenêtres / portes-fenêtres /
  baies / fenêtres de toit ME-021 à 024, 031 à 040, 044 à 049. Poussières :
  lots démolition, maçonnerie, murs-cloisons + S-004, S-007, P-1005, D-023,
  ME-0014. Dépose des sanitaires : D-004, D-015, D-016, D-017, D-026. Les
  mots du libellé (faux-plafond, fenêtre, carrelage, « dépose » + WC…) ne
  servent **que pour un ouvrage sans code** : un code non listé fait foi
  (« E-006 … plafonnier » n'est pas une chute de hauteur). `concerneSi` de
  chaque point = énoncé de la règle.
- **Module pur** `securitePreRemplissage.mjs` (+ façade). Règle d'inconnu :
  source absente ou illisible = « à compléter » avec la raison, jamais « non
  concerné » ; « non concerné » seulement si la donnée existe et dit non.
  Conversion semaine + jour → date dans le module (semaine 53 gérée, semaine
  impossible = case signalée « illisible », pas de date inventée). Les points
  qui dépendent d'autres (10, 3, 12) prennent la réponse de la fiche si elle
  est choisie, sinon la proposition, et le disent.
- Choix faits (spécification muette) : responsable jamais proposé (décision
  du 25/11, saisi à la main) ; EPI de base proposés = chaussures et gants ;
  harnais proposé si le point 5 est concerné et qu'aucune protection
  collective n'est cochée au point 5 (trémies protégées, échafaudage, PIRL,
  protection collective) ; travail isolé compté par chantier, en signalant
  les jours où quelqu'un travaille sur un autre chantier de la même opération
  (autre logement du même immeuble) ; quantités du point 8 : bons remplacés
  par leur BL et lignes de migration écartés (même règle que
  `achatsParMois.mjs`), « plaque » seul écarté (une plaque d'interrupteur
  n'est pas une plaque de plâtre — vu sur FOURMOND 001), sacs = « sac » ou
  20 kg et plus.
- **Écran** : sur chaque carte (1 à 12), encadré « Proposé : statut — raison »
  et bouton « Appliquer la proposition ». Le bouton ajoute (entreprises,
  lots, cases, jours isolés dans les mesures, lignes de risques vides), ne
  retire rien, et applique le statut proposé ; la date de dépose proposée
  remplace celle du point 2 seulement par ce clic. Une proposition « à
  compléter » n'a pas de bouton. Un choix manuel de statut enregistre aussi
  `statut_propose` / `raison_proposition` (trace de la proposition vue).
  **Rien n'est écrit à l'ouverture** : une fiche ouverte et non touchée reste
  à 0/12, et rien n'est écrit dans `reponses` pour les points 1 à 3 (la vue
  compte toute clé).
- **Divergences** : calculées contre la fiche ENREGISTRÉE ; statut choisi ≠
  proposition recalculée (sauf si la fiche porte déjà cette même proposition :
  la personne l'a tranchée), prestataire du planning absent du point 1, lot du
  phasage absent du point 2, date de dépose différente. Brouillon : encadré
  orange « à revoir » ; fiche validée : « pour information » seulement.
- Données : `chargerDonneesPreRemplissage` dans `securiteDonnees.js`, lecture
  seule, phasage par le service existant `loadPhasagesPourLiaison`
  (`null` = échec, absent = pas de phasage), planning paginé (1 000 lignes).
- Script ajusté : `verif-securite-fiche.mjs` exigeait `concerneSi: null`
  (état de la tâche 3) ; il exige maintenant un énoncé. Nouveau :
  `verif-securite-preremplissage.mjs` + workflow. Aucune migration, aucune
  écriture en base, aucune page ajoutée à `src/access.js`.

**25/11/2026 — Tâche 7 : fiche sécurité dans le cycle de vie.**

- **Où `chantiers.statut` est modifié (recensement complet, code et base).**
  Toutes les écritures du front passent par `sauverChantiers`
  (`chantiersDonnees.js`, appelé par `saveConfig("chantiers")` d'`App.jsx`).
  Écrans qui changent le statut :
  1. `PageChantiers.jsx`, menu « changer le statut » de la fiche chantier
     (tous les statuts sauf « Perdu ») — **seul écran qui peut mettre « En
     cours » ou « Terminé »** ;
  2. `PageChantiers.jsx`, bascule automatique à la signature du devis
     (« À l'étude » → « Planifié », `decisionBasculeSignature`) ;
  3. `PageChantiers.jsx` et `OperationCommercial.jsx` (page Opérations) :
     « Marquer perdu » / « Annuler perdu » (→ « Perdu » / « À l'étude ») ;
  4. `ParcoursChiffrage.jsx` : création d'un chantier « À l'étude ».
  Base : `refonte_appliquer_chantiers` (appelée par le déclencheur
  `planning_config_vers_tables` quand l'ancien bloc `planning_config`
  « chantiers » est écrit directement — plus aucun code ne l'écrit, seules
  des lectures subsistent) et `refonte_resynchroniser_depuis_config`
  (manuelle, réservée au service). Aucune autre fonction SQL, aucun des 9
  crons (`cron.job`), aucune edge function (dont `progbat-operations`, qui
  n'écrit que les identifiants ProGBat), aucune tâche `api/` ni script ne
  modifie le statut. La synchronisation ProGBat du statut des devis
  (`progbat-devis-statut`) ne fait que proposer « Marquer perdu ».
  **Aucun traitement automatique ne passe un chantier « en cours ».**
- **Étape `fiche_securite`** (« Fiche sécurité validée ») ajoutée dans la
  phase Préparation de `cycleVie.mjs`, avant « Finalisation de la
  préparation », nature `auto` (jamais cochée à la main). Évaluation : la
  fiche relue par l'écran d'abord, sinon le dernier état enregistré dans
  `chantier_cycle_vie` (lu par le bloc « Chantiers à venir »), sinon « non
  chargé ». L'état enregistré (`{ fait, date, auteur, fiche: { statut,
  version, forcee } }`, rangé sous `fiche` et non `donnees` pour ne pas
  apparaître dans l'export d'opération) est écrit par le service existant
  `ecrireEtapeCycleVie` (écriture directe sous les règles de la table, aucune
  fonction SECURITY DEFINER) à la création, la validation, la mise à jour,
  le forçage et le verrouillage, et remis d'accord à l'ouverture de la fiche
  chantier s'il a pris du retard. Conséquences : « Préparation » compte 7
  étapes au lieu de 6 (scripts `verif-refonte-lot3` et
  `verif-bloc-chantiers-a-venir` ajustés) ; un chantier dont les 6 autres
  étapes sont faites n'est plus « Préparation complète » sans fiche validée.
  **Limite** : la règle de la base réserve au chargé d'affaires les étapes
  Étude et Contrat ; l'étape n'est donc pas écrite depuis son compte (la
  fiche chantier ne l'essaie pas ; l'écran montre quand même l'état réel de
  la fiche). Changer cette règle = modification de droits (non faite).
- **Blocage** (module pur `securiteCycleVie.mjs` + façade) : sur le menu de
  statut de la fiche chantier, la fiche est relue au moment du clic. « En
  cours » passe seulement avec une fiche `validee` (le statut `validee` porte
  toujours sur la version en cours) ; depuis n'importe quel statut (À l'étude,
  Planifié, En pause, Terminé). Fiche illisible ou en cours de lecture :
  bloqué, sans forçage. Sinon, fenêtre « Passage « En cours » bloqué » avec
  la raison, « Ouvrir / Créer la fiche sécurité » (la fiche s'ouvre
  directement depuis la fiche chantier) et, pour `profil.role === "admin"`
  (même règle que le reste de l'appli et que `is_admin()`), « Forcer le
  démarrage » avec motif obligatoire (5 caractères au moins, comme « Mettre
  à jour »).
- **Forçage, ordre des écritures** : fiche relue → fiche (créée en brouillon
  avec `forcage_motif/par/le`, ou forçage ajouté si son état n'a pas changé)
  → journal (`fiche_securite`, ancien statut du chantier → `en_cours`, motif,
  « Démarrage forcé sans fiche sécurité validée — … ») → statut « en cours ».
  Une erreur arrête tout avant le statut. Fiche verrouillée (chantier terminé
  qu'on rouvre) : le motif ne peut aller qu'au journal (la base refuse toute
  modification). Un nouveau forçage remplace le motif porté par la fiche ;
  l'ancien reste dans le journal. Une entrée de forçage n'est jamais prise
  pour le motif d'une nouvelle version (vérifié).
- **Verrouillage** : statut « terminé » enregistré D'ABORD (un verrouillage
  ne s'annule pas, même par un admin), puis fiche → `verrouillee` (si son
  état n'a pas changé), puis journal. Échec : message rouge « Chantier
  terminé, MAIS fiche sécurité NON verrouillée (raison) » et bouton
  « Verrouiller la fiche » sur le bandeau tant que la fiche d'un chantier
  terminé n'est pas verrouillée. Chantier terminé sans fiche : rien (aucune
  fiche créée, décision du 25/11). Pour cela, `saveConfig("chantiers")`
  renvoie maintenant le résultat de l'enregistrement (avant : rien).
- **Pas de blocage rétroactif** : rien ne change pour un chantier déjà en
  cours ; le bandeau de la fiche chantier et le panneau de l'opération
  affichent en rouge « Chantier déjà en cours sans fiche sécurité validée ».
- **Historique visible** : le journal des statuts n'était affiché nulle
  part ; bouton « Historique » sur le bandeau (changements de statut,
  validations, mises à jour, forçages, verrouillages).
- **Reprise des 20 chantiers en cours (arrêt obligatoire, NON appliquée)** :
  script `sql/20261125_securite_fiches_reprise_en_cours.sql`, uniquement des
  ajouts : une fiche brouillon v1 par chantier en cours non archivé sans
  fiche, une ligne de journal (motif `reprise_mise_en_service`), l'étape du
  cycle de vie. Essayé dans une transaction annulée : 20 fiches, 20 lignes de
  journal, 20 étapes, les 20 fiches à 0/12 dans la vue ; après annulation,
  0 fiche, 0 étape, 0 ligne de journal. Sans ce script, les fiches se créent
  une par une avec « Créer la fiche » (bandeau ou panneau).
- **Alertes (`notifications`) : rien d'écrit, préparé seulement.** La table
  n'est accessible qu'au serveur (aucun droit pour un compte connecté :
  vérifié, « permission denied » avec l'admin et la comptable) ; les
  notifications passent par l'edge function `send-push` en mode serveur
  (secret) appelée par les tâches planifiées ; son type est limité par un
  contrôle de la base à C1…D4 et `test`. L'alerte « fiche à créer » au
  passage en planifié est donc affichée à l'écran seulement (message orange
  sur la fiche chantier). Préparé : `alertesSecurite()` (module pur, testé)
  calcule les 4 alertes (fiche à créer pour un chantier planifié ; non
  validée à 7 jours de la première date prévue du phasage, date inconnue
  signalée à part ; justificatif expiré sur un chantier en cours ; fiche à
  mettre à jour), lien `/?page=chantiers&chantier=…`, clé de regroupement
  par type, chantier et jour. Pour les envoyer il faudrait : (1) migration
  modifiant le contrôle de type de `notifications` (table existante) et un
  code « S1 » dans le catalogue `notificationsPushV1.mjs` (destinataires par
  défaut : admin + conducteur, comme C1-C5, réglables dans Réglages ›
  Notifications) ; (2) une tâche planifiée quotidienne (nouveau job du
  `cron-dispatcher`, ou ajout à `cron-alertes-chantiers`) qui lit chantiers,
  fiches, phasages et justificatifs et appelle `send-push`. À décider par
  François.
- **Essai sur la vraie base (transaction annulée)** avec un vrai compte admin
  et le compte comptable (rôle `authenticated`, identifiant et e-mail dans
  les claims), sur des chantiers planifiés réels de FOUGERAY. Admin :
  `is_admin()` vrai ; fiche créée en brouillon avec le forçage ; journal
  écrit ; statut « en cours » (1 ligne) ; étape du cycle de vie écrite ;
  forçage sur fiche existante avec la condition (1 ligne) ; statut
  « terminé » puis verrouillage (1 ligne) ; modification après verrou
  refusée par la base (« Fiche sécurité verrouillée (chantier terminé) ») ;
  notification refusée (« permission denied »). Comptable : `is_admin()`
  faux ; fiche validée → « en cours » (1 ligne) ; étape écrite ;
  verrouillage (1 ligne) + journal ; déverrouillage refusé ; notification
  refusée. **À savoir** : la base laisse la comptable écrire un forçage
  (`forcage_*`) — le contrôle « admin seulement » est dans l'appli, comme
  le prévoit la v1 (pas de déclencheur bloquant). Après annulation :
  0 fiche, 0 étape, 0 ligne de journal, statuts des 3 chantiers inchangés,
  0 notification d'essai.
- Aucune migration appliquée, aucune écriture réelle en base, aucune page
  ajoutée à `src/access.js`, aucune règle de droits modifiée.

**25/11/2026 — Tâche 8 : accueil de l'équipe, nouvelles versions.**

- **Où côté ouvrier.** Intégré à l'onglet « Accueil » existant de l'espace
  ouvrier (`OuvrierDashboard.jsx`), dans la carte de chaque chantier du jour,
  par un nouveau composant `FicheSecuriteOuvrier.jsx`. Les chantiers du jour
  sont ceux que l'écran lisait déjà (`planning_cells` de la semaine et du jour
  courants ; la base ne renvoie à l'ouvrier que ses cases, reliées par
  `planning_resources.auth_user_id`). **Aucune page ajoutée, `src/access.js`
  non touché** (l'espace ouvrier ne lit aucun droit d'onglet pour cela).
- **Ce que lit l'ouvrier** : le contenu FIGÉ de la version validée en cours
  (ce qu'il signe), pas la fiche courante ; risques principaux (point 3) puis,
  pour chaque point concerné, les cases cochées (libellés de
  `securite/points.mjs`) et les mesures ; liste des points non concernés.
  Le contenu est contrôlé contre son empreinte avant d'afficher le bouton.
- **Signature** : nom = `profil.nom` (ex. prénom + nom du compte), non
  modifiable ; entreprise « Profero », non modifiable ; texte d'engagement
  existant (`TEXTE_ENGAGEMENT`). Juste avant l'écriture, la fiche et la
  version sont relues (même version, toujours validée, même empreinte), puis
  image PNG dans `securite-preuves` sous `signatures/{fiche_id}/v{N}-accueil-…`
  et ligne `securite_signatures` (compte = défaut de la base, `auth.uid()`).
  Composant de tracé réutilisé (`SignatureFicheSecurite.jsx`), avec deux
  options ajoutées : nom figé, consignes affichées sous les risques.
- **Aperçu Admin de l'espace ouvrier** : lecture seule, signature désactivée
  (elle serait prise au nom du compte bureau).
- **Règle « qui doit re-signer »** (module pur `securiteAccueil.mjs` + façade) :
  établie par + chef d'équipe à chaque version (inchangé, règle de la tâche
  4) ; accueil seulement si les points 3 à 12 diffèrent entre les contenus
  figés de la version signée et de la version en cours. Comparés : lignes de
  la synthèse (point 3), et pour 4 à 12 statut, cases cochées (ordre
  indifférent), mesures. **Choix faits (spécification muette)** : ne comptent
  pas les traces de proposition et de saisie (`statut_propose`,
  `raison_proposition`, `maj_par`, `maj_le`), les points 1 et 2, le bâtiment
  ni les justificatifs (preuves au dossier, pas des consignes données à
  l'équipe). Contenu illisible = « à refaire » (jamais « valable » par défaut).
- **Bureau** : carte « Accueil de l'équipe » dans la fiche (signatures
  d'accueil par version, la plus récente d'abord : « signée sur la v2 (version
  en cours) », « signée sur la v1 — reste valable pour la v2 », « signée sur
  la v1 — à refaire : point 7 modifié depuis », compte connecté ou non,
  image) ; ligne « v2 par rapport à la v1 : … » ; bouton « Faire signer
  l'accueil (sous-traitant sans compte) » sur une fiche validée ou à mettre à
  jour : nom et entreprise libres, `auth_user_id` vide. Vérifié que la règle
  bureau le permet (`auth_user_id is null or = auth.uid()`, pas de condition
  sur l'empreinte : l'appli met celle de la version figée en cours).
- **Mise à jour proposée** (fiche validée ou à mettre à jour ; pour un
  brouillon, les divergences de la tâche 6 s'en chargent) : nouveau
  prestataire au planning absent du point 1 ; lot ajouté au phasage qui
  change un statut proposé des points 4 à 12 (on recalcule les propositions
  de `securitePreRemplissage` avec et sans les nouveaux lots, et on ne
  signale que si la fiche ne dit pas déjà ce statut) ; justificatif requis
  expiré (même règle que la validation). Source illisible = « Non vérifié :
  … », jamais « rien à signaler ». Affichée en haut de la fiche et sous le
  chantier dans le panneau de l'opération ; « Mettre à jour » ouvre le
  formulaire existant avec le motif pré-rempli (modifiable). Le panneau ne
  calcule que pour les fiches validées / à mettre à jour.
- **Statut `a_mettre_a_jour`** : **seulement par un clic au bureau**
  (« Marquer « à mettre à jour » », chantier en cours, fiche validée, une
  mise à jour proposée), avec confirmation ; écriture conditionnée à « encore
  validée, même version », puis journal du chantier (`fiche_securite`,
  validée → à mettre à jour, motif) et étape du cycle de vie. **Aucune
  écriture automatique en arrière-plan.**
- **Conséquence à connaître** : la règle ouvrier de la base n'accepte une
  signature d'accueil que sur une fiche `validee`. Une fiche « à mettre à
  jour » bloque donc la signature des ouvriers depuis leur téléphone jusqu'à
  la validation de la version suivante (le bureau peut encore faire signer un
  sous-traitant). L'écran de confirmation et l'espace ouvrier le disent.
  L'élargir à `a_mettre_a_jour` serait une modification de droits (non faite).
- Script existant ajusté : `verif-securite-cycle-vie.mjs` comptait 2 appels
  à la synchronisation de l'étape dans la fiche ; il en compte 3 (ajout
  après « Marquer « à mettre à jour » »). Nouveau :
  `verif-securite-accueil.mjs` (18 vérifications, exemples fictifs) +
  workflow `verify-securite-accueil.yml`.
- **Essai sur la vraie base (transaction annulée)** avec le vrai compte
  ouvrier de Steven (rôle `authenticated`, identifiant ET e-mail dans les
  claims) sur MONTILLERS APPT 1 (T3), où il est planifié aujourd'hui, et une
  fiche d'essai validée v1 : `est_ouvrier()` vrai ; sa case du jour lue
  (1) ; fiche lue (1) ; versions lues (1) ; image déposée sous
  `signatures/{fiche_id}/` ; dépôt sous `versions/` refusé ; signature
  d'accueil à son nom acceptée ; il ne lit que la sienne ; refusées : au nom
  d'un autre ouvrier, mauvaise empreinte, type `chef_equipe` ; modification
  de la fiche : 0 ligne. Compte comptable (bureau) : image + accueil d'un
  sous-traitant sans compte acceptés ; lit les 2 accueils ; passage
  « à mettre à jour » (1 ligne) + journal ; ensuite la signature de l'ouvrier
  est refusée. Après annulation : 0 fiche, 0 version, 0 signature, 0 fichier
  `securite-preuves`, 0 entrée `fiche_securite` au journal, chantier toujours
  « en cours ».
- Aucune migration, aucune règle de droits modifiée, aucune page ajoutée.

## Comptes rendus

### 25/11/2026 — Liste des 24 chantiers sans statut

Requête sur la vraie base. La colonne « Indice » n'est qu'une aide tirée des
semaines du planning (semaine actuelle : 2026-W48) ; c'est François qui choisit
le statut.

| Opération | Chantier | Planning (1re → dernière semaine) | Indice |
|---|---|---|---|
| Briollay | BRIOLLAY APPT 1 | W35 → W37 | planning fini : terminé ? |
| Briollay | BRIOLLAY APPT 2 | W36 → W45 | planning fini : terminé ? |
| Briollay | BRIOLLAY APPT 3 | W36 → W37 | planning fini : terminé ? |
| Briollay | BRIOLLAY APPT 4 | W35 → W37 | planning fini : terminé ? |
| Briollay | BRIOLLAY APPT 5 | W36 → W37 | planning fini : terminé ? |
| FOUGERAY | FOUGERAY APPT 001 (T2 RDC) | W50 → 2027-W06 | commence dans 2 semaines : planifié ? |
| FOUGERAY | FOUGERAY APPT 101 (STUDIO 3 R+1) | W50 → 2027-W06 | planifié ? |
| FOUGERAY | FOUGERAY APPT 102 (STUDIO 4 R+1) | W50 → 2027-W06 | planifié ? |
| FOUGERAY | FOUGERAY APPT 201 (STUDIO 5 R+2) | W50 → 2027-W06 | planifié ? |
| FOUGERAY | FOUGERAY APPT 202 (STUDIO 6 R+2) | W50 → 2027-W05 | planifié ? |
| FOUGERAY | FOUGERAY COMMUN | W50 → 2027-W03 | planifié ? |
| Fourmond | FOURMOND COMMUNS | W39 → W47 | fini la semaine dernière : terminé ou en cours ? |
| Kathleen BILLAUD | KATHLEEN T2 | W41 → W48 | en cours ? |
| LAMARTINE | LAMARTINE | W09 → W45 | planning fini : terminé ? |
| Louison | LOUISON APPT 2 (T2) | W38, sans ouvrier | à l'étude ? |
| Louison | LOUISON APPT 3 (T4) | W38, sans ouvrier | à l'étude ? |
| Louison | LOUISON APPT 4 (STUDIO) | W38, sans ouvrier | à l'étude ? |
| METOIS | METOIS | W10 → W47 | terminé ou en cours ? |
| Montilliers | MONTILLERS APPT 1 (T3) | W42 → 2027-W02 | en cours ? |
| Montilliers | MONTILLERS APPT 2 (T2) | W43 → 2027-W02 | en cours ? |
| Montilliers | MONTILLERS APPT 3 (STUDIO) | W43 → 2027-W02 | en cours ? |
| Montilliers | MONTILLERS APPT 4 (T2) | W43 → 2027-W03 | en cours ? |
| Tourbouton | TOURBOUTON 101 | W24 → W46 | terminé ? |
| Tourbouton | TOURBOUTON 102 | W29 → W45 | terminé ? |

### 25/11/2026 — Tâche 1 : migration prête, en attente de votre accord

**Ce que fait la migration.** Elle crée les cinq tableaux de la fiche sécurité
(données du bâtiment, fiche, versions figées, signatures, justificatifs), deux
vues pour les pastilles et les expirations, et un dossier de stockage
`securite-confidentiel` pour les aptitudes médicales. Elle ne modifie aucun
tableau existant. Seule règle existante touchée : le verrou « réservé aux
collaborateurs » du stockage, recréé à l'identique avec le nouveau dossier en
plus.

**Essai sur la vraie base, annulé à la fin (rien n'est resté, vérifié
ensuite).** 54 contrôles, tous conformes, avec de vrais comptes (un ouvrier,
la comptable, un admin) et une fiche d'essai sur un chantier en cours :

- chaque nouveau tableau a bien le verrou « réservé aux collaborateurs » ;
- une version ou une signature ne peut être ni modifiée, ni supprimée, ni
  vidée, même par un admin ; le PDF d'une version s'enregistre une seule fois ;
- une aptitude médicale non confidentielle est refusée ; la comptable ne voit
  pas l'aptitude médicale (ni dans la liste des expirations), l'admin la voit ;
  la comptable ne peut rien déposer dans le dossier confidentiel ;
- l'ouvrier voit la fiche, signe l'accueil à son nom, et ne peut ni signer
  pour un autre, ni signer « chef d'équipe », ni modifier la fiche ;
- une fiche verrouillée (chantier terminé) ne peut plus être modifiée ;
- personne sans compte ne lit quoi que ce soit.

**Questions pour François** (réponse en une phrase) :

1. J'applique la migration sur la vraie base ? (oui / non)
2. Les images de signature et les PDF de version doivent-ils aller dans un
   dossier de stockage à part où rien ne peut être supprimé (au lieu de
   `chantier-documents`, où tout collaborateur peut effacer un fichier) ?
   Si oui, je l'ajoute à cette même migration avant de l'appliquer.

### 25/11/2026 — Tâche 1 : votre accord est noté, application à reprendre

Vous avez répondu oui aux deux questions. Le dossier de stockage protégé
`securite-preuves` est ajouté : les signatures et les PDF de chaque version y
seront rangés, et personne, admin compris, ne pourra les effacer ni les
remplacer. Un deuxième essai complet sur la vraie base, annulé ensuite, est
conforme. La migration n'est pas encore appliquée : un dernier contrôle sur la
suppression des fichiers attend une confirmation technique côté base.

### 25/11/2026 — Tâche 1 : la base est prête

Les tableaux de la fiche sécurité et les deux espaces de stockage protégés
existent maintenant sur la vraie base. Rien de visible ne change encore dans
l'application : les écrans arrivent avec les tâches suivantes. Vérifié après
la mise en place : chaque tableau est réservé aux collaborateurs, et personne,
admin compris, ne peut effacer ni remplacer une signature ou le PDF d'une
version.

### 25/11/2026 — Tâche 2 : bouton « Fiche sécurité » sur la page Opération

**Ce qui change à l'écran.** Sur la page d'une opération, un nouveau bouton
« Fiche sécurité » apparaît dans l'en-tête, à côté du choix de l'opération.
Il ouvre un panneau avec :

- en haut, le bloc **Bâtiment** : date du permis de construire,
  copropriété, étage, ascenseur utilisable, repérage amiante et notes. On le
  remplit une fois pour l'immeuble ; chaque fiche de chantier le reprendra.
  Sous les champs, l'appli indique si le permis date d'avant le
  1er juillet 1997 et d'avant 1949. Ce qui n'est pas rempli s'affiche
  « non renseigné », jamais « non » ;
- en dessous, la liste des chantiers de l'opération, chacun avec une
  pastille : « à créer » (gris), « brouillon — 7/12 » (orange),
  « validée v2 » (vert), « verrouillée » pour un chantier terminé. Si l'état
  des fiches ne peut pas être lu, la pastille dit « état illisible » au lieu
  de faire croire qu'il n'y a pas de fiche.

Aujourd'hui, aucune fiche n'existe encore (requête sur la vraie base : 0 fiche,
0 bâtiment saisi) : sur les 62 chantiers rattachés à une opération, les 46 non
terminés affichent « à créer » et les 16 terminés « pas de fiche — chantier
terminé ». La création et le remplissage des fiches arrivent à la tâche 3 ;
la pastille rouge « justificatifs manquants / expiré » aux tâches 3-4.

**Qui le voit.** Les mêmes personnes que la page Opérations : admin, direction
(super admin), conducteurs, comptable, commercial, chargés d'affaires. Pas les
ouvriers. Aucune nouvelle page.

**Vérifié.** Nouveau contrôle automatique des pastilles et du bloc Bâtiment
(14 vérifications, exemples issus des tests, données fictives), lancé en local :
tout passe. Les colonnes lues par l'écran existent bien en base (requête de
lecture). Pas vérifié depuis l'environnement de Claude : l'ouverture du
panneau dans un navigateur ; la compilation de l'application est faite par les
contrôles GitHub.

### 25/11/2026 — Tâche 3 : la fiche sécurité de chaque chantier se remplit dans l'appli

**Ce qui change à l'écran.** Dans le panneau « Fiche sécurité » de la page
Opération, chaque chantier a maintenant un bouton :

- **« Créer la fiche »** pour un chantier qui n'en a pas (pas pour un
  chantier terminé ni une affaire perdue) ; la fiche est créée en brouillon
  et s'ouvre aussitôt ;
- **« Ouvrir la fiche »** quand elle existe.

La fiche s'ouvre en plein écran (ordinateur et tablette), dans l'ordre du
modèle papier :

1. un bandeau bleu nuit : chantier, opération, adresse, état de la fiche,
   nombre de points complétés sur 12 et les 12 numéros (jaunes quand le point
   est complété) ;
2. **point 1 — Intervenants** : responsable du chantier et son téléphone
   (saisis à la main), client et adresse repris de l'opération, liste des
   entreprises (ajouter / retirer) ;
3. **point 2 — Données de base** : lots prévus, dates de début et de fin,
   date de dépose des sanitaires, effectif, logement occupé ou non, accès,
   observations ; en dessous, les données du bâtiment en lecture, avec un
   lien pour les modifier sur l'opération ;
4. **points 4 à 12**, une carte chacun : « À compléter / Concerné / Non
   concerné », les cases à cocher, « Mesures retenues », et la liste des
   justificatifs attendus (l'ajout des documents arrive à la tâche suivante) ;
5. **point 3 — Synthèse des risques** : trois lignes.

Tout s'enregistre seul, un instant après la saisie. En haut à droite :
« enregistrement… », puis « enregistré » ; si l'écriture échoue,
« erreur, non enregistré » avec la raison, et rien n'est écrasé (par exemple
si un collègue a modifié la même fiche entre-temps). Une fiche validée ou
verrouillée s'affiche en lecture seule.

**Le chiffre « n/12 »** de la fiche est calculé exactement comme celui de la
pastille du panneau. À savoir : un point compte comme complété dès qu'il a
quelque chose — un seul intervenant pour le point 1, un seul champ pour le
point 2, une seule ligne pour le point 3 ; pour les points 4 à 12, dès que
« Concerné » ou « Non concerné » est choisi.

**À relire par vous.** Le modèle papier v2 n'est pas dans l'appli : les cases
à cocher des points 4 à 12, les champs du point 2 et les justificatifs
attendus par point sont une proposition à partir de la spécification. Dites
ce qu'il faut ajouter, retirer ou reformuler ; c'est une modification simple
tant qu'aucune fiche n'est remplie.

**Qui le voit.** Les mêmes personnes que la page Opérations (admin, direction,
conducteurs, comptable, commercial, chargés d'affaires). Pas les ouvriers.
Aucune nouvelle page.

**Vérifié.** Nouveau contrôle automatique de la fiche (12 vérifications,
exemples issus des tests, données fictives) lancé en local : tout passe. Le
calcul du « n/12 » donne les mêmes résultats que la base sur 4 exemples
(requête de lecture, sans fiche réelle : la base n'en contient aucune). Pas
vérifié depuis l'environnement de Claude : l'ouverture de la fiche dans un
navigateur, la création d'une vraie fiche et son rechargement (« réponses
intactes ») — à faire une fois en ligne ; la compilation est faite par les
contrôles GitHub.

### 25/11/2026 — Tâche 4 : justificatifs, signatures et validation de la fiche

**Ce qui change à l'écran** (fiche d'un chantier, ouverte depuis le panneau
« Fiche sécurité » de la page Opération) :

- **Justificatifs sur chaque point (1 à 12)** : bouton « Ajouter un
  justificatif » → type de document, date, date d'expiration facultative,
  personne et entreprise, puis « Prendre une photo » (tablette) ou « Choisir
  un fichier ». Les documents joints sont listés sous le point ; un clic les
  ouvre. « Retirer » ne supprime rien : le document est archivé. Un
  justificatif requis absent ou expiré est marqué en rouge sur le point.
  L'aptitude médicale n'est pas proposée ici (espace entreprise, plus tard).
- **Signatures et validation**, en bas de la fiche : une ligne du type
  « 12/12 renseignés, 3 éléments manquants pour valider », puis la liste de
  ce qui manque (champ par champ, justificatif par justificatif, amiante,
  signatures). Le « 12/12 » est l'avancement (un point compte dès qu'il a
  quelque chose) ; pour valider, la règle est plus stricte.
- Quand la fiche est complète, les boutons « Signer » s'ouvrent pour
  « Établie par » et « Chef d'équipe » : la personne voit les risques
  principaux, la phrase « Je reconnais avoir été informé des risques et des
  consignes de ce chantier. », son nom (pré-rempli pour soi-même) et son
  entreprise, et signe au doigt. **La signature se fait en dernier** : si la
  fiche change ensuite, la signature est marquée « à refaire ».
- **« Valider la fiche »** ne s'active que quand tout est en ordre. La fiche
  est alors figée (copie complète + empreinte numérique), passe « validée »
  et en lecture seule ; l'historique du chantier le note.
- **« Mettre à jour »** (fiche validée) : motif obligatoire, la fiche passe en
  version suivante, en brouillon, à re-signer et re-valider. Les anciennes
  signatures restent visibles, « signée sur la v1 ».
- Panneau de l'opération : la pastille devient **rouge** « justificatifs
  manquants » (fiche en brouillon) ou « expiré ».
- Amiante : un bâtiment dont le permis date d'avant le 1er juillet 1997 sans
  repérage reçu empêche la validation ; une date de permis non renseignée
  aussi, tant que le repérage n'est pas reçu (on ne peut pas savoir).

**Qui le voit.** Les mêmes personnes que la page Opérations (admin, direction,
conducteurs, comptable, commercial, chargés d'affaires). Pas les ouvriers.
Aucune nouvelle page, aucune migration.

**Vérifié.** Nouveau contrôle automatique (14 vérifications, exemples issus
des tests, données fictives) lancé en local : tout passe — règles de
validation, cas amiante, empreinte identique quel que soit l'ordre des
données, même empreinte côté navigateur et côté serveur, « Mettre à jour »,
pastille rouge. Relu sur la vraie base (lecture) : colonnes du journal du
chantier et règles de stockage (dépôt et lecture autorisés aux
collaborateurs dans `chantier-documents`, aucune suppression ni remplacement
possible dans `securite-preuves`).
**Pas vérifié** depuis l'environnement de Claude : l'écran dans un
navigateur (photo depuis la tablette, tracé au doigt, ouverture d'un
document, validation d'une vraie fiche) — à faire une fois en ligne ; la
compilation et les autres contrôles sont faits par GitHub.

### 25/11/2026 — Tâche 5 : le PDF de la fiche sécurité

**Ce qui change à l'écran** (fiche d'un chantier, ouverte depuis le bouton
« Fiche sécurité » de la page Opérations) :

- **À la validation**, le PDF de la version est fabriqué et rangé
  automatiquement dans l'espace de stockage protégé (personne, admin compris,
  ne peut l'effacer ni le remplacer). Il reproduit exactement la version
  validée : identification et intervenants, données de base et bâtiment,
  synthèse des risques, points 4 à 12 (statut, cases cochées, mesures,
  justificatifs joints avec leur date), historique des versions, puis les
  signatures en image. Charte Profero : bandeau bleu nuit arrondi avec le
  logo, accents jaunes, cartes blanches, pied « Profero — Rénovation &
  réhabilitation ».
- **« Télécharger le PDF »** sur la fiche validée et sur chaque ligne de
  l'historique des versions.
- **Si le PDF n'a pas pu être fabriqué** (connexion coupée, image de
  signature illisible…), la fiche reste validée et la version affiche « PDF
  non généré » avec la raison et un bouton **« Générer le PDF »**.
- **Fiche en brouillon** : bouton « Aperçu PDF (brouillon) ». Le document
  porte « BROUILLON — non validé » en haut, dans le bandeau et en pied de
  page ; il n'est pas conservé et ne doit pas être présenté à un contrôle.

**Qui le voit.** Les mêmes personnes que la page Opérations (admin, direction,
conducteurs, comptable, commercial, chargés d'affaires). Pas les ouvriers.
Aucune nouvelle page, aucune migration.

**Vérifié.** Nouveau contrôle automatique de la mise en page (11
vérifications, exemples issus des tests, données fictives) lancé en local :
tout passe. Essai des écritures sur la vraie base avec le compte comptable,
annulé ensuite (rien n'est resté) : le PDF se dépose au bon endroit, se
rattache à sa version une seule fois, et ne peut ensuite ni être remplacé ni
rattaché une seconde fois. Un PDF d'exemple a été fabriqué à partir de
données inventées (exemple issu des tests, données fictives).
**Pas vérifié** depuis l'environnement de Claude : la fabrication du PDF dans
un vrai navigateur à partir d'une vraie fiche (l'exemple a été imprimé par
Chrome, l'appli passe par `html2pdf` : rendu très proche mais pas identique,
notamment les coupures de page) — à faire une fois en ligne, sur la première
fiche validée ; la compilation et les autres contrôles sont faits par GitHub.

### 25/11/2026 — Tâche 6 : l'appli propose une réponse pour chaque point

**Ce qui change à l'écran** (fiche d'un chantier, ouverte depuis le bouton
« Fiche sécurité » de la page Opérations) :

- Sur chaque point, un encadré **« Proposé : Concerné — Lot Démolition au
  phasage »** : la proposition et sa raison, recalculées à chaque ouverture à
  partir du phasage, du planning, des commandes et du bâtiment.
- Un bouton **« Appliquer la proposition »** recopie la proposition dans la
  fiche : il ajoute ce qui manque (entreprises du planning, lots, date de
  dépose des sanitaires, cases EPI, jours de travail isolé, lignes de
  risques) et **ne retire jamais** ce que vous avez saisi. Sans clic, rien
  n'est rempli et rien n'est validé.
- Quand une donnée manque, la proposition dit **« À compléter »** et pourquoi
  (« Date du permis inconnue : données du bâtiment jamais saisies sur
  l'opération »), jamais « Non concerné ».
- Si le phasage ou le planning change après vos réponses, un encadré orange
  en haut de la fiche le signale (« Le phasage contient maintenant le lot
  Démolition : absent du point 2 »). Sur une fiche validée, il s'affiche pour
  information seulement.

**Propositions calculées sur 3 vrais chantiers** — requête de lecture sur la
vraie base le 25/11/2026, passée au module de l'appli. Le bloc Bâtiment n'est
rempli pour aucune opération (0 ligne) : les points 4 et 8 sont donc « à
compléter » partout, et le point 3 le signale.

| Point | FOUGERAY APPT 101 (planifié) | KATHLEEN T2 (en cours) | FOURMOND 001 (en cours) |
|---|---|---|---|
| 1 Intervenants | Profero seule, aucun prestataire au planning | idem | idem |
| 2 Données de base | Lots Électricité, Murs-cloisons, Plomberie, Menuiserie, Démolition, Sol, Plafond ; aucune dépose de WC / lavabo / douche au phasage | mêmes lots ; 1 ouvrage sans lot (« Divers / hors devis ») ; aucune dépose de sanitaires | mêmes lots sans Démolition ; aucune dépose de sanitaires |
| 3 Synthèse | Chute de hauteur / Électricité / Poussières (amiante non évalué : point 4 à compléter) | idem | idem |
| 4 Amiante | À compléter : date du permis inconnue (bâtiment jamais saisi) | idem | idem |
| 5 Chute de hauteur | Concerné : PL-002 faux-plafond (lot Plafond) | Concerné : « Faux-plafond SDB » (lot Plafond) | Concerné : fenêtres ME-032, ME-033, porte-fenêtre ME-023, faux-plafond PL-001 |
| 6 Électricité | Concerné, lot Électricité : habilitation exigée | idem | idem |
| 7 Poussières | Concerné : lots Murs-cloisons, Démolition | Concerné : lots Murs-cloisons, Démolition ; carrelage S-004 | Concerné : lot Murs-cloisons |
| 8 Manutention | À compléter (étage, ascenseur) ; aucune commande | À compléter ; commandé : 17 plaques, 2 sacs | À compléter ; commandé : 73 plaques, 22 sacs, 6 menuiseries |
| 9 Travail isolé | Concerné : 16 jours sur 37 avec une seule personne (1er : 11/12/2026 Venceslas) ; les 16 ont quelqu'un sur un autre logement de l'opération | Concerné : 2 jours sur 17 (13/10 et 26/10/2026, Steven) | Non concerné : toujours au moins 2 personnes sur 36 jours |
| 10 EPI | Chaussures, gants, FFP3, protections auditives, harnais | idem | Chaussures, gants, FFP3, harnais |
| 11 Sanitaires | Concerné, pas de dépose au phasage | idem | idem |
| 12 Coordination | Non concerné : une seule entreprise | idem | idem |

**Résultats surprenants, à regarder :**

- **Aucun bâtiment n'est saisi** : tant que le bloc Bâtiment de l'opération
  est vide, amiante et manutention restent « à compléter » sur toutes les
  fiches.
- **Aucune dépose de sanitaires datée** sur ces 3 chantiers, alors que
  FOUGERAY 101 et FOURMOND 001 ont une salle de bain neuve (P-021.2) : les
  devis ne contiennent pas d'ouvrage « dépose de WC / lavabo / douche »
  (D-015, D-016…). La date de dépose reste donc à saisir à la main.
- **FOUGERAY 101 : 16 jours « seul »** sur le logement, mais chaque fois
  quelqu'un travaille sur un autre appartement du même immeuble. La règle de
  la spécification (« une seule personne sur le chantier ») les compte ; à
  vous de dire si un collègue dans l'appartement voisin suffit.
- **FOURMOND 001** est proposé « chute de hauteur » à cause du remplacement
  de fenêtres (menuiserie extérieure, comme le demande la spécification),
  même s'il s'agit probablement d'un rez-de-chaussée.
- **Un seul prestataire existe dans l'appli, nommé « Externe »** : les
  sous-traitants ne sont pas identifiés au planning, donc le point 1 propose
  presque toujours « Profero seule » et le point 12 « non concerné ».
- Le harnais est proposé dès qu'un point 5 est concerné, tant qu'aucune
  protection collective n'est cochée au point 5 (règle de la
  spécification) : il disparaît quand on coche « PIRL prévues » ou
  « trémies protégées ».

**Qui le voit.** Les mêmes personnes que la page Opérations (admin, direction,
conducteurs, comptable, commercial, chargés d'affaires). Pas les ouvriers.
Aucune nouvelle page, aucune migration, aucune écriture en base.

**Vérifié.** Nouveau contrôle automatique (15 vérifications, exemples issus
des tests, données fictives) lancé en local : tout passe — chaque règle, cas
inconnus, conversion semaine / jour (semaine 53 de 2026), ordre des risques,
divergences, « Appliquer » qui n'enlève rien. Tableau ci-dessus : vraies
données (requête de lecture), calculé par le module de l'appli ; pour ce
calcul, le planning des autres logements de l'opération a été limité aux
jours utiles et les libellés raccourcis, sans effet sur les statuts.
**Pas vérifié** depuis l'environnement de Claude : l'écran dans un
navigateur (encadrés, bouton « Appliquer », encadré des divergences) — à
faire une fois en ligne ; la compilation et les autres contrôles sont faits
par GitHub.

### 25/11/2026 — Tâche 7 : démarrage bloqué sans fiche validée, verrouillage à la fin

**Ce qui change à l'écran.**

- **Fiche d'un chantier (page Chantiers)** : un bandeau « Fiche sécurité »
  sous l'en-tête montre l'état de la fiche (à créer, brouillon, validée,
  à mettre à jour, verrouillée), avec « Ouvrir la fiche » (elle s'ouvre
  directement, sans passer par l'opération) ou « Créer la fiche », et
  « Historique » (changements de statut, validations, forçages).
- **Passer un chantier « En cours »** sans fiche validée ouvre une fenêtre
  qui explique ce qui manque, avec « Ouvrir / Créer la fiche sécurité ».
  Un administrateur y trouve aussi « Forcer le démarrage », avec un motif
  obligatoire ; le forçage est inscrit dans l'historique du chantier et sur
  la fiche, qui reste à valider.
- **Passer un chantier « Terminé »** verrouille sa fiche (plus personne ne
  peut la modifier). Si le verrouillage échoue, le bandeau le dit en rouge
  et propose « Verrouiller la fiche ».
- **Chantiers déjà en cours** : rien n'est bloqué, mais le bandeau et le
  panneau « Fiche sécurité » de la page Opérations affichent en rouge
  « Chantier déjà en cours sans fiche sécurité validée ».
- **Cycle de vie** : nouvelle étape « Fiche sécurité validée » dans la phase
  Préparation (7 étapes au lieu de 6), qui suit toute seule l'état de la
  fiche.
- **Passer un chantier « Planifié »** sans fiche affiche « sa fiche sécurité
  est à créer » (message à l'écran ; pas de notification, voir question 2).

**Où le statut d'un chantier change dans l'appli** : seul le menu de statut
de la fiche chantier peut mettre « En cours » ou « Terminé » ; les autres
changements sont « Planifié » à la signature du devis, « Perdu » et son
annulation, et « À l'étude » à la création depuis le chiffrage. Aucun
traitement automatique (ProGBat, tâches planifiées) ne passe un chantier
« En cours ».

**Qui le voit.** Bandeau et fenêtre : tous ceux qui ont la page Chantiers
(le menu de statut demande le droit de modifier les chantiers) ; « Forcer le
démarrage » : administrateurs seulement. Aucune nouvelle page.

**Questions pour François** (réponse en une phrase chacune) :

1. Je crée en brouillon la fiche des 20 chantiers déjà en cours (script
   prêt et essayé, uniquement des ajouts) ? (oui / non)
2. Voulez-vous les 4 alertes sécurité en notification (nouveau type
   d'alerte dans la base et nouvelle tâche planifiée quotidienne, vers les
   admins et conducteurs) ? (oui / non)
3. Le chargé d'affaires doit-il pouvoir faire avancer l'étape « Fiche
   sécurité validée » du cycle de vie (aujourd'hui la base le lui refuse,
   comme toutes les étapes de Préparation) ? (oui / non)

**Vérifié.** Nouveau contrôle automatique (12 vérifications, exemples issus
des tests, données fictives) lancé en local : tout passe. Essai des écritures
sur la vraie base avec un compte admin et le compte comptable, annulé ensuite
(rien n'est resté) : forçage, historique, verrouillage, refus de toute
modification après verrouillage, refus d'écrire une notification depuis
l'appli. Script de reprise essayé : 20 fiches créées puis annulées.
**Pas vérifié** depuis l'environnement de Claude : les écrans dans un
navigateur (bandeau, fenêtre de blocage, forçage, verrouillage sur un vrai
chantier) — à faire une fois en ligne ; la compilation et les autres
contrôles (dont les deux scripts du cycle de vie ajustés) sont faits par
GitHub.

### 25/11/2026 — Tâche 8 : les ouvriers signent l'accueil, la fiche propose ses mises à jour

**Ce qui change pour les ouvriers** (téléphone, onglet « Accueil ») : sous
chaque chantier du jour, un encadré « Fiche sécurité » :

- fiche validée et pas encore signée : « Lire » montre les risques
  principaux et les consignes de chaque point concerné, puis **« Signer
  l'accueil »** : la phrase « Je reconnais avoir été informé des risques et
  des consignes de ce chantier. », son nom déjà écrit (il ne peut pas le
  changer), Profero, signature au doigt ;
- déjà signé : « Accueil signé sur la v1 », ou « Votre signature de la v1
  reste valable : les risques et consignes n'ont pas changé dans la v2 » ;
  si les risques ont changé, le bouton revient ;
- fiche pas encore validée : « Fiche sécurité pas encore validée », pas de
  bouton.

**Ce qui change au bureau** (fiche d'un chantier) :

- carte **« Accueil de l'équipe »** : toutes les signatures d'accueil, par
  version, avec « reste valable » ou « à refaire » ; bouton **« Faire signer
  l'accueil (sous-traitant sans compte) »** sur la tablette (nom et
  entreprise libres) ;
- en haut d'une fiche validée, **« Mise à jour proposée : … »** quand un
  nouveau prestataire apparaît au planning, quand un lot ajouté au phasage
  change un point, ou quand un justificatif requis a expiré ; « Mettre à
  jour » ouvre le formulaire avec ce motif déjà écrit. La même ligne
  s'affiche sous le chantier dans le panneau « Fiche sécurité » de
  l'opération ;
- pour un chantier en cours : **« Marquer « à mettre à jour » »**, seulement
  si vous cliquez (rien ne se fait tout seul).

**Qui le voit.** Espace ouvrier : tous les ouvriers connectés, pour leurs
chantiers du jour (aucune nouvelle page, `src/access.js` inchangé). Fiche et
panneau : les mêmes personnes qu'avant (page Opérations ; bandeau de la page
Chantiers).

**À savoir.** Tant qu'une fiche est « à mettre à jour », les ouvriers ne
peuvent plus signer l'accueil depuis leur téléphone (la base ne l'accepte
que sur une fiche validée) ; le bureau peut encore faire signer un
sous-traitant. Aujourd'hui, aucune fiche n'existe encore en base : l'encadré
des ouvriers affichera « pas encore validée » partout tant qu'aucune fiche
n'est validée.

**Vérifié.** Nouveau contrôle automatique (18 vérifications, exemples issus
des tests, données fictives) lancé en local : tout passe. Essai sur la vraie
base avec le vrai compte d'un ouvrier et le compte comptable, annulé
ensuite (rien n'est resté, vérifié) : l'ouvrier lit sa fiche et signe
l'accueil à son nom ; il ne peut ni signer pour un autre, ni signer avec une
mauvaise empreinte, ni signer « chef d'équipe », ni modifier la fiche ; le
bureau fait signer un sous-traitant sans compte. **Pas vérifié** depuis
l'environnement de Claude : les écrans dans un navigateur ou un téléphone
(tracé au doigt, ouverture repliée, panneau) — à faire sur la première
fiche validée ; la compilation et les autres contrôles sont faits par
GitHub.
