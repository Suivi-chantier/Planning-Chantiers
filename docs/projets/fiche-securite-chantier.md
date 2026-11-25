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
| 4 | Justificatifs de chantier, signatures « établie par » / « chef d'équipe », bouton « Valider » avec liste de ce qui manque, version figée + empreinte, lecture seule, « Mettre à jour » avec motif | en cours (demande de fusion ouverte le 25/11/2026, contrôles GitHub à attendre ; pas de migration) | Auto | Validation refusée tant qu'il manque un élément ; version et signature non modifiables | [#284](https://github.com/Suivi-chantier/Planning-Chantiers/pull/284) |
| 5 | Export PDF charte Profero, généré et stocké à chaque validation + entrée `journalMaj.js` (fin de la première livraison) | à faire | Auto | PDF conforme au modèle v2 avec signatures | — |
| 6 | Pré-remplissage : module de calcul pur (`.mjs` + façade), propositions avec raison, alertes de divergence + `verif-*` | à faire | Auto | Propositions justes sur des chantiers réels (phasage, planning) | — |
| 7 | Cycle de vie : étape `fiche_securite`, blocage du passage en cours + forçage admin tracé dans `chantiers_statut_journal`, verrouillage à « terminé », alertes `notifications` | à faire | Auto | Passage en cours refusé sans fiche validée ; forçage visible dans l'historique | — |
| 8 | Équipe : signature d'accueil côté ouvrier (mobile), « signée sur la v1 », nouvelle version proposée quand un prestataire arrive au planning | à faire | Auto | Un ouvrier signe à son nom et ne peut rien modifier d'autre | — |
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
