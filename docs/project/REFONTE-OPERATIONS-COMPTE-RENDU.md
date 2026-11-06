# Refonte Opérations — compte rendu

Projet : `docs/projets/refonte-operations.md`. Document en langage métier, mis à
jour à la fin de chaque lot.

---

## Ce qui a changé

### Lot 1 — Opérations et chantiers dans de vraies tables, règle « chantier actif »

**Pour tout le monde (bureau et ouvriers) : rien ne change à l'écran**, sauf
dans Réglages → Chantiers / Opérations (voir plus bas). Ce qui change est
dessous :

- **Plus d'écrasement entre collègues.** Avant, la liste des chantiers et celle
  des opérations étaient enregistrées d'un seul bloc : changer le statut d'un
  chantier réécrivait les 46 chantiers. Si le conducteur modifiait un chantier
  pendant qu'un collègue créait une opération, le dernier qui enregistrait
  effaçait le travail de l'autre. Désormais chaque opération et chaque chantier
  est une ligne à part : une modification n'écrit que ce qui a changé, sur ce
  seul chantier.
- **Chaque chantier a une opération.** C'est obligatoire et contrôlé par la
  base. Les 7 chantiers qui n'en avaient pas ont reçu une opération à leur nom,
  avec un seul logement (liste plus bas). Elles apparaissent dans Opérations
  et dans Réglages → Opérations.
- **Une seule règle pour savoir quels chantiers afficher.** Toutes les pages qui
  listent des chantiers passent par la même règle (`estChantierActif`). Au
  lot 1 elle donne exactement le même résultat qu'avant ; au lot 2, il suffira
  d'y ajouter « À l'étude » et « Perdu » pour qu'ils disparaissent de toutes
  ces pages d'un coup (ils resteront visibles dans Opérations).
- **Réglages → Chantiers** (administrateur) : un nouveau chantier se crée en
  choisissant son opération, ou « Nouvelle opération à son nom ». On ne peut
  plus laisser un chantier « sans opération » : on le déplace d'une opération
  à l'autre avec la liste déroulante. « Supprimer » un chantier le retire des
  listes mais le garde en réserve dans la base (récupérable).
- **Réglages → Opérations** : le bouton « détacher » (×) a disparu ; la liste
  « + Rattacher un chantier… » devient « + Déplacer un chantier ici… » et
  propose les chantiers des autres opérations. Une opération ne se supprime
  que si elle n'a plus aucun chantier (elle est elle aussi gardée en réserve).
- **E-mails** : aucun changement.

**Qui voit quoi** : aucun droit d'accès aux pages n'est modifié
(`src/access.js` inchangé). Les nouvelles tables reprennent exactement les
droits de l'ancien bloc : le bureau lit et modifie, les ouvriers lisent (les
chantiers non supprimés, comme avant), un visiteur non connecté n'y a aucun
accès. Personne ne peut effacer une ligne : la suppression n'existe pas, seul
l'archivage existe.

#### Pages qui passent par `estChantierActif()`

Règle : un chantier archivé (supprimé) n'apparaît jamais ; « Terminé » est
retiré là où il l'était déjà, gardé là où il était déjà montré.

| Page | Terminés | Comment |
|---|---|---|
| Planning hebdo | retirés (comme avant) | `Planning.jsx` |
| Planning mensuel | montrés (comme avant) | liste filtrée par `App.jsx` |
| Bilan semaine / période | retirés (comme avant) | `BilanPeriode.jsx` |
| Tableau de bord | montrés | liste filtrée par `App.jsx` |
| Commandes, capture de commande, planning des commandes | montrés | liste filtrée par `App.jsx` |
| Équipe (capacité des équipes) | montrés | liste filtrée par `App.jsx` |
| Validation des journées, heures des salariés | montrés | liste filtrée par `App.jsx` |
| Phasage, plans | montrés | liste filtrée par `App.jsx` |
| Notes des ouvriers, notes & todo (bureau) | montrés | liste filtrée par `App.jsx` |
| Alertes | — | un relevé d'un chantier hors des listes ne donne pas d'alerte (`PageAlertes.jsx`) |
| États financiers | montrés | `EtatsFinanciers.jsx` |
| Simulation d'une opération (« Planifier ») | retirés (comme avant) | `planningOperationV1.mjs` |
| Moteur et replanification du planning | retirés (comme avant) | `planningEngineAdapterV1.js`, `planningReplanningAdapterV1.js` |
| Espace ouvrier — Chantiers | montrés | `OuvrierChantiers.jsx` |
| Espace ouvrier — Mes phases | « Autres chantiers » sans les terminés, groupe « Terminés » à part (comme avant) | `OuvrierMesPhases.jsx` |
| Espace ouvrier — Commande, Notes, mémos chantier | montrés | `OuvrierCommande.jsx`, `OuvrierNotes.jsx` |
| Rapport de journée — « J'ai fait autre chose », heures indirectes | retirés / montrés (comme avant) | `PanneauAutreChose.jsx`, `RapportMobile.jsx` |
| Serveur : dérives historiques des relevés (chantiers terminés) | — | `api/_partage/relevesJournaliers.js` (`estChantierTermine`) |
| Serveur : assistant IA, recherche d'un chantier | montrés | `api/_ia/renovation/outils.js` |

**Listes complètes, volontairement sans ce filtre** (toutes les statuts) :
Chantiers (page de gestion, onglets par statut), Opérations, Réglages et
Chiffrage (on chiffre un chantier avant qu'il soit actif, lot 2). Lot 5 :
Opérations devient la porte d'entrée.

Les pages qui ne font que retrouver le nom d'un chantier par son identifiant
(accueil et planning de l'espace ouvrier, rapprochement des factures)
lisent la table sans filtrer : ce ne sont pas des listes.

### Lot 2 — Statuts « À l'étude » et « Perdu », parcours de chiffrage, règles de saisie

**Ce que voient les conducteurs, les ouvriers et le planning : rien de
nouveau.** Un chantier « À l'étude » (en cours de chiffrage, pas signé) ou
« Perdu » (affaire non signée) n'apparaît ni dans le planning, ni dans le
Bilan, ni dans le tableau de bord, les commandes, l'espace ouvrier ou les
états financiers : toutes ces pages passent par la règle unique
`estChantierActif()`, qui les écarte. Ils restent visibles dans **Opérations**,
et dans les listes de gestion **Chantiers** (deux nouveaux onglets « À
l'étude » et « Perdu »), **Chiffrage** et **Réglages**. Les 46 chantiers
existants **gardent leur statut** : aucun ne devient « À l'étude ».

**Chiffrage (page « Chiffrage »)**

- « Nouveau projet » ouvre un **parcours imposé** : 1. choisir ou créer
  l'opération ; 2. créer le chantier (référence du logement, adresse, code
  postal, ville, chargé d'affaires) — **il naît « À l'étude »** ; 3. choisir ou
  créer le client (celui de l'opération est proposé par défaut) ; 4. le
  chiffrage s'ouvre, déjà rattaché à son chantier. Il n'existe plus d'autre
  façon de créer un chiffrage : **impossible de chiffrer sans opération**.
- Un **ancien chiffrage** sans chantier (les 88 existants) affiche « Chiffrage
  sans chantier — Rattacher à une opération » : même parcours, ses adresses
  sont reprises. Rien n'est rattaché automatiquement.
- Un chiffrage rattaché affiche « Opération › Chantier », le statut et le
  **chargé d'affaires** (modifiable ; vide = celui de l'opération).
- Le **client** affiché est la fiche client du chantier (ou de l'opération) ;
  ses coordonnées sont recopiées dans le chiffrage tant que le devis ProGBat
  n'est pas créé (après, plus rien n'est recopié : le devis est parti). Si ni
  le chantier ni l'opération n'ont de client, un bouton « Créer la fiche
  client depuis ce chiffrage » la pré-remplit.
- **Astérisque rouge** sur chaque champ exigé pour le devis ProGBat. Le bouton
  devient **« Créer le devis dans ProGBat »** ; il est **grisé tant qu'il
  manque quelque chose**, et la liste de ce qui manque s'affiche sous la
  barre des ouvrages. Nouveaux bloquants : code postal et ville du chantier,
  e-mail, téléphone et pays du client, prénom (particulier) ou nom du contact
  (société), chantier rattaché, chargé d'affaires.

**Opérations (fiche d'une opération)**

- Chaque carte d'opération porte son **statut calculé** (À l'étude, En cours,
  Terminée, Perdue, ou « Sans chantier »). Il n'est jamais saisi.
- Nouveau bloc **« Client, chargé d'affaires et statuts »** : client et chargé
  d'affaires de l'opération (valeurs par défaut de ses chantiers), puis pour
  chaque chantier son statut, son client et son chargé d'affaires (vide =
  comme l'opération), et le bouton **« Marquer perdu »** (chantier à l'étude)
  ou **« Annuler « perdu » »**. « Aucun client » / « Aucun chargé d'affaires »
  s'affichent en orange quand c'est le cas.
- Les chiffres de l'opération (vendu, marges) ne comptent que les chantiers en
  exploitation : un chantier à l'étude ou perdu n'est pas vendu.

**Chantiers (fiche chantier)**

- Menu de statut : « À l'étude » ajouté ; « Perdu » n'y est pas (il ne
  s'obtient que par « Marquer perdu », avec un motif).
- **Bascule automatique** : quand l'étape « Devis signé » du cycle de vie est
  validée sur un chantier « À l'étude », il passe en « Planifié » (une ligne
  est ajoutée à l'historique). Si le chantier n'a pas encore de phasage, le
  cycle de vie n'existe pas encore : la fiche l'écrit (« Passage automatique
  en Planifié impossible pour l'instant… »).
- « Marquer perdu » : motif obligatoire (liste : prix, concurrent, projet
  abandonné, délai, financement, sans réponse, autre + texte libre) ; date et
  auteur enregistrés. « Annuler « perdu » » remet le chantier « À l'étude »
  avec une raison ; la perte et son annulation restent dans l'historique
  (table `chantiers_statut_journal`).

**Qui voit quoi** : aucun droit d'accès aux pages n'est modifié
(`src/access.js` inchangé, configuration en base inchangée). Lu en base le
06/11/2026 (`planning_config.access_pages_renovation`) :

| Page | Rôles qui la voient |
|---|---|
| Opérations | administrateur seulement (attribution automatique de la liste par défaut) |
| Chiffrage | administrateur (auto), super administrateur, comptable, conducteur — **pas le rôle commercial** |
| Chantiers | administrateur (auto), super administrateur, comptable, conducteur, commercial |

Fiches client : lisibles et modifiables par le bureau, **jamais par les
ouvriers** (e-mail, téléphone). La liste complète des collaborateurs (choix
du chargé d'affaires) n'est lisible que par un administrateur : un autre
utilisateur ne voit que lui-même, et l'écran le dit.

**E-mails** : aucun changement. Les relances arrivent au lot 3.

---

## Journal de décisions

| Date | Décision | Raison | Comment revenir en arrière |
|---|---|---|---|
| 06/11/2026 | Les anciens blocs `planning_config` « chantiers » et « operations » **restent en place et sont tenus à jour automatiquement** par la base (copie miroir), au lieu d'être figés. | Trois fonctions de l'espace ouvrier côté base (`ouvrier_mes_phases`, `ouvrier_preparation_chantier`, `conducteur_lister_suggestions_materiaux`), le formulaire de rapport ouvert sans connexion et deux tâches serveur lisent encore ces blocs. Les modifier aurait touché à des fonctions à droits élevés et ouvert les nouvelles tables aux visiteurs non connectés. Avec la copie, ils voient exactement la même chose qu'avant. | Script `sql/202611_refonte_operations_lot1_rollback.sql` + annulation de la demande de fusion : le bloc redevient la seule source, et il est à jour. |
| 06/11/2026 | **Synchronisation dans les deux sens** pendant la transition : une modification faite depuis une ancienne version de l'application (onglet resté ouvert) est reportée dans les tables, seulement pour les chantiers qu'elle a changés. | Les tables ont été remplies avant la mise en ligne du nouveau code ; sans ce report, une modification faite entre-temps dans l'ancien écran serait perdue. | Même script de retour arrière (débranche les deux sens). |
| 06/11/2026 | Lecture : tables d'abord ; si elles ne répondent pas, **repli en lecture** sur la copie `planning_config` (journalisé). | La copie est toujours à jour : l'écran reste juste plutôt que vide. Les écritures, elles, ne vont que dans les tables. | — |
| 06/11/2026 | « Supprimer » un chantier ou une opération = **archiver** (date d'archivage), jamais effacer. Aucun droit de suppression sur les nouvelles tables. | « Aucune suppression de donnée » ; un chantier supprimé par erreur se récupère en remettant sa date d'archivage à vide. | — |
| 06/11/2026 | Un chantier créé **sans opération** (Réglages, ou ancienne version de l'application) reçoit automatiquement une opération à son nom. | Le lien obligatoire est garanti par la base, sans casser l'ancien écran pendant la transition. Le lot 2 imposera le choix de l'opération dans le parcours de chiffrage. | — |
| 06/11/2026 | Les identifiants existants sont repris **à l'identique** (texte). Opérations créées automatiquement : identifiant `op_auto_<identifiant du chantier>`, adresse reprise de l'adresse du chantier quand elle existe. | ~40 tables renvoient à ces identifiants. | — |
| 06/11/2026 | Les adresses des chantiers (`planning_config` « chantier_adresses ») **ne sont pas migrées** au lot 1. | Hors périmètre du lot 1 ; le lot 2 ajoute adresse / code postal / ville obligatoires sur le chantier et décidera de leur place. | — |
| 06/11/2026 | La règle `estChantierActif()` a deux usages : « en vie » (sans les terminés, là où on les retirait déjà) et `inclureTermines` (là où on les montrait déjà). Le statut « Terminé » n'est pas « hors exploitation ». | Aucune page ne change de comportement au lot 1 ; le lot 2 n'a qu'une constante à compléter. | — |
| 06/11/2026 | **Lot 2 — Fiche client dans une table à part** (`clients`), référencée par l'opération (`operations.client_id`) et, si différent, par le chantier (`chantiers.client_id`, vide = celui de l'opération). | « Choisir ou créer le client » suppose une liste réutilisable ; les tables opérations / chantiers sont lisibles par les ouvriers, pas les coordonnées des clients. Le lot 4 y enregistrera l'identifiant ProGBat (`clients.progbat_client_id`, vide). | Annuler la demande de fusion : les colonnes restent, vides et plus lues. |
| 06/11/2026 | **Lot 2 — Le chiffrage garde une copie du client** (colonnes `client_*` de `profero_projets`), recopiée depuis la fiche tant que le devis n'est pas créé, figée ensuite. | Le serveur qui crée le devis lit `profero_projets` ; ne pas modifier la fonction serveur pour lire une autre table. Une seule source (la fiche) tant que rien n'est parti. | — |
| 06/11/2026 | **Lot 2 — Aucune reprise automatique des clients.** Les 88 chiffrages existants ne sont rattachés à rien : l'utilisateur choisit explicitement l'opération et le chantier (« Rattacher à une opération »), puis crée la fiche client pré-remplie depuis le chiffrage. `chantier_adresses` n'est pas migré. | Deux T3 d'un même immeuble partagent client et adresse : un rapprochement automatique se tromperait en silence. Aucune donnée existante n'est réécrite par la migration. | — |
| 06/11/2026 | **Lot 2 — Lien chiffrage → chantier** : table existante `chantier_projets` (un chiffrage = au plus un chantier). | C'est exactement ce lien (« ce logement appartient à ce chantier ») ; la synchronisation des factures ProGBat l'utilise déjà en repli, elle rattachera donc correctement les factures des nouveaux devis. | Supprimer la ligne du lien (bloc « Rattachement de secours par devis » de la fiche chantier). |
| 06/11/2026 | **Lot 2 — Statut de l'opération, cas mixtes** (calculé, jamais stocké) : 1. au moins un chantier actif (planifié, en cours, en pause, sans statut) → En cours ; 2. sinon au moins un à l'étude → À l'étude (à l'étude + perdus, à l'étude + terminés : une affaire reste à signer) ; 3. sinon au moins un terminé → Terminée (terminés + perdus) ; 4. sinon tous perdus → Perdue ; 5. aucun chantier → « Sans chantier », jamais « Terminée ». | Le plus prudent : une opération n'est dite terminée ou perdue que s'il ne reste rien à signer ni à faire ; une opération vide ne se présente pas comme un résultat. | Changer l'ordre dans `statutOperation()` (`src/Renovation/statutsChantier.mjs`). |
| 06/11/2026 | **Lot 2 — Bascule à la signature** branchée sur l'étape actuelle « Devis signé » (`devis_signe`) via la constante `ETAPE_SIGNATURE` ; décision dans la fonction pure `decisionBasculeSignature()`, appliquée par la fiche chantier quand l'étape est validée (une fois par chantier, tracée). Dé-valider la signature ne remet **pas** le chantier à l'étude. | Le lot 3 n'aura qu'à changer la constante. Revenir en arrière automatiquement pourrait retirer du planning un chantier qui a déjà des équipes. | Corriger le statut à la main dans la fiche chantier. |
| 06/11/2026 | **Lot 2 — « Perdu »** : seulement depuis « À l'étude », motif obligatoire, date et auteur sur le chantier (`perdu_le`, `perdu_par`, `perdu_motif`, `perdu_motif_detail`) ; annulation possible (retour à « À l'étude », raison obligatoire) ; trace complète dans `chantiers_statut_journal` (ajout seulement). « Perdu » n'est pas proposé dans le menu de statut. | Réversible et traçable ; un perdu choisi dans un menu n'aurait pas de motif. Lot 3 : **aucune relance si `estChantierPerdu()`**. | « Annuler « perdu » ». |
| 06/11/2026 | **Lot 2 — Chargé d'affaires** = un compte collaborateur actif hors ouvriers (`utilisateurs`) ; on enregistre son identifiant et son nom affiché (`charge_affaires_id`, `charge_affaires_nom`), sur l'opération (défaut) et sur le chantier (si différent). Pas de clé étrangère. | La table des comptes n'est lisible en entier que par un administrateur : le nom enregistré permet à tous de l'afficher ; supprimer un compte ne doit ni être bloqué ni effacer en silence le chargé d'affaires. Aucun rôle ni droit créé (lot 6). | — |
| 06/11/2026 | **Lot 2 — Une seule liste de règles de saisie** (`src/Renovation/reglesSaisieProgbat.mjs`), lue par les formulaires (astérisques, refus d'enregistrer une fiche client incomplète, bouton grisé) et par `construireEnTeteDevis` (contrôle d'avant-envoi, navigateur et serveur). Code postal / ville du chantier, e-mail, téléphone et pays du client deviennent bloquants. Le formulaire de chiffrage reste en enregistrement automatique (brouillon) : le blocage porte sur la création du devis. | Refuser d'enregistrer un brouillon de chiffrage à chaque frappe le rendrait inutilisable ; les fiches client, elles, sont refusées si incomplètes. | Retirer une règle de la liste. |
| 06/11/2026 | **Lot 2 — Identifiants ProGBat générés** : client = « NOM VILLE » (nom ou raison sociale + ville, majuscules, sans accents ni ponctuation, SAINT → ST) ; nom du chantier ProGBat = « client — référence du logement » (déjà utilisé) ; code du chantier = code client + référence. Calculés, jamais saisis ; rien n'est envoyé à ProGBat dans ce lot. | Modèle de l'exemple du cahier des charges (« CORRAL ST BARTHELEMY D ANJOU ») ; aucune trace du modèle dans le code ni en base. Longueur maximale ProGBat inconnue : à vérifier au lot 4. | `genererCodeClient()` et voisines. |
| 06/11/2026 | **Lot 2 — Fonction serveur `progbat-quote`** : sa copie des règles est à jour dans le dépôt mais **n'est pas redéployée** par ce lot. | Pas de mise en production hors fusion. D'ici son déploiement, le serveur applique encore les anciennes règles ; le bouton de l'application, lui, applique déjà les nouvelles. | — |

---

## Données migrées

Comptes lus en base le 06/11/2026 (requêtes sur la base de production).

| | Avant (bloc `planning_config`) | Après (tables) |
|---|---|---|
| Opérations | 12 | 19 (12 reprises + 7 créées automatiquement) |
| Chantiers | 46 | 46, identifiants, noms, couleurs, statuts et ordre identiques (contrôlé chantier par chantier) |
| Chantiers sans opération | 7 | 0 |
| Statuts des chantiers | 6 en cours, 15 terminés, 25 sans statut (affichés « Planifié ») | identiques |

Sauvegarde avant reprise : table `planning_config_sauvegarde_refonte`
(3 lignes : blocs « chantiers », « operations », « chantier_adresses » tels
qu'ils étaient le 06/11/2026). Migration :
`supabase/migrations/20261106045027_refonte_operations_lot1.sql`, essayée
d'abord dans une transaction annulée (mêmes comptes, plus quatre essais :
modification depuis l'ancien écran, depuis le nouveau, création sans
opération des deux côtés), puis appliquée.

**Opérations créées automatiquement** (un seul logement chacune) :

| Opération | Chantier | Statut du chantier | Adresse reprise |
|---|---|---|---|
| LAMARTINE | LAMARTINE | sans statut | — |
| METOIS | METOIS | sans statut | 8 rue Yvonne Angers |
| GILDAS BAUGE 2 | GILDAS BAUGE 2 | terminé | 2 rue Basse Baugé en Anjou |
| LOU | LOU | terminé | — |
| 14 BOULEVARD DU ROI RENÉ | 14 BOULEVARD DU ROI RENÉ | terminé | 14 boulevard du roi rené Angers |
| MAUDUIT | MAUDUIT | terminé | — |
| DÉPOT | DÉPOT | en cours | — |

Les étapes du cycle de vie ne sont pas concernées par le lot 1 (lot 3).

### Lot 2

Migration `supabase/migrations/20261106052752_refonte_operations_lot2.sql`,
**purement additive** : tables `clients` et `chantiers_statut_journal`
créées (policy `profero_collaborateurs_seulement` posée sur les deux),
colonnes vides ajoutées à `operations` (client, chargé d'affaires) et à
`chantiers` (client, chargé d'affaires, perte). Aucune ligne existante lue,
réécrite ni supprimée ; aucune fonction à droits élevés ; copie
`planning_config` inchangée. Essayée d'abord dans une transaction annulée
(46 chantiers / 19 opérations, copie identique), puis appliquée. Comptes lus
après : 46 chantiers (25 sans statut, 6 en cours, 15 terminés — identiques),
19 opérations, 0 client. Pas de sauvegarde nécessaire (rien n'est réécrit).
Retour arrière : `sql/202611_refonte_operations_lot2_rollback.sql` (remet les
chantiers à l'étude sans statut et archive les perdus, après les avoir notés
dans l'historique ; ne supprime rien).

---

## À faire par Loris

- Rien pour le lot 1.
- À regarder quand vous testerez : les 7 opérations créées automatiquement
  ci-dessus. Vous pouvez déplacer ces chantiers dans une autre opération
  (Réglages → Chantiers) puis supprimer l'opération devenue vide. Le DÉPOT
  (stock) a lui aussi reçu une opération : à vous de dire s'il doit en avoir
  une à part.
- Lot 2 : remplir, pour chaque opération en cours de chiffrage, le client et
  le chargé d'affaires (Opérations → fiche de l'opération). Les anciens
  chiffrages se rattachent un par un (« Rattacher à une opération »).
- Lot 2 : le rôle **commercial** ne voit pas la page Chiffrage dans la
  configuration actuelle (Réglages → Accès) ; à ouvrir si les commerciaux
  doivent chiffrer (le lot 6 créera le rôle chargé d'affaires).
- Lot 2 : la liste complète des collaborateurs n'est visible que par un
  administrateur ; un autre utilisateur ne peut désigner que lui-même comme
  chargé d'affaires.

---

## Plan de test

### Lot 1

1. **Opérations** : la page s'ouvre ; les 12 opérations habituelles sont là
   avec leurs chantiers, plus 7 nouvelles (LAMARTINE, METOIS, GILDAS BAUGE 2,
   LOU, 14 BOULEVARD DU ROI RENÉ, MAUDUIT, DÉPOT) d'un logement chacune.
2. **Chantiers** : changer le statut d'un chantier (ex. En cours → En pause).
   Recharger la page : le statut est conservé. Sur un deuxième poste ouvert
   en même temps, le changement apparaît en quelques secondes.
3. **Écrasement** : sur deux postes, changer en même temps le statut de deux
   chantiers différents. Recharger : les deux changements sont conservés.
4. **Planning hebdo** : un chantier « Terminé » n'apparaît pas ; les autres
   oui, comme avant. Passer un chantier en Terminé : il disparaît du planning.
5. **Bilan** : même liste de chantiers qu'avant (sans les terminés ni le DÉPOT).
6. **Réglages → Chantiers** : créer un chantier « TEST LOT 1 » avec
   « Nouvelle opération à son nom » → une opération « TEST LOT 1 » apparaît
   dans Réglages → Opérations. Le déplacer vers une autre opération, puis
   supprimer le chantier et l'opération vide : ils disparaissent des listes.
7. **Espace ouvrier** (téléphone d'un ouvrier) : onglet Chantiers, mêmes
   chantiers qu'avant, regroupés par opération ; Mes phases, Commande et
   Notes proposent les mêmes chantiers qu'avant.
8. **Rapport de journée** (formulaire du téléphone) : la liste des chantiers
   proposée est la même qu'avant.
9. **États financiers** : la liste des chantiers à rattacher est la même
   qu'avant (terminés compris).

### Lot 2

1. **Rien ne bouge pour les chantiers existants** : Planning, Bilan, espace
   ouvrier montrent les mêmes chantiers qu'avant ; aucun chantier n'est « À
   l'étude ».
2. **Chiffrage → Nouveau projet** : essayer « Suivant » sans rien remplir →
   la liste de ce qui manque s'affiche. Créer une opération « TEST LOT 2 »,
   un chantier « T2 - R+2 » avec adresse, code postal, ville et chargé
   d'affaires, puis « + Nouveau client » : enregistrer sans e-mail → refusé
   avec la liste ; compléter → l'identifiant ProGBat « NOM VILLE » s'affiche.
   « Créer et chiffrer » → le chiffrage s'ouvre sur les ouvrages.
3. **Planning / Bilan / espace ouvrier** : le chantier « TEST LOT 2 — T2 -
   R+2 » n'y apparaît pas. **Opérations** : l'opération TEST LOT 2 est « À
   l'étude », avec son client et son chargé d'affaires.
4. **Bouton devis** : ajouter un ouvrage ; vider le code postal du chantier →
   « Créer le devis dans ProGBat » est grisé et la liste dit « Code postal du
   chantier ». Le remettre → le bouton redevient actif (ne pas créer de devis
   de test dans ProGBat).
5. **Marquer perdu** (Opérations → TEST LOT 2) : sans motif → refusé ; avec
   « Prix trop élevé » → statut « Perdu », date et nom affichés ; l'opération
   devient « Perdue ». « Annuler « perdu » » sans raison → refusé ; avec une
   raison → « À l'étude ».
6. **Client par chantier** : dans la fiche de l'opération, choisir un autre
   client pour le chantier → la page Chiffrage de ce chantier affiche ce
   client ; remettre « Comme l'opération ».
7. **Bascule** : sur un chantier à l'étude qui a un phasage, valider l'étape
   « Devis signé » (import du devis signé) → le chantier passe « Planifié » et
   apparaît dans le planning.
8. **Ancien chiffrage** : ouvrir un chiffrage existant → « Chiffrage sans
   chantier » ; le bouton devis est grisé (« Chantier et opération du
   chiffrage »). « Rattacher à une opération » → ses adresses sont reprises.
9. Nettoyage : marquer le chantier de test perdu (ou le supprimer dans
   Réglages → Chantiers) ; il reste en réserve.
