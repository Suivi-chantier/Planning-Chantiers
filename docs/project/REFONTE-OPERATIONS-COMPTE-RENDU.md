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

### Lot 3 — Nouveau cycle de vie du chantier, relances, synthèse par opération

**Fiche chantier (pages Chantiers et Opérations → clic sur un chantier).**
La frise « Cycle de vie du chantier » passe de 6 à **5 phases** : Étude,
Contrat, Préparation, Travaux, Réception. Les phases Garanties/SAV et Clôture
disparaissent, comme les étapes Métrés, Réponse client, Rétractation,
Commandes & approvisionnements, Équipes affectées, Installation, Nettoyage et
DOE.

| Phase | Étape | Comment elle se valide |
|---|---|---|
| Étude | Visite avant chiffrage + Imapper | Case « Fait » + bouton « Créer l'événement Google Agenda » |
| Étude | Chiffrage réalisé | Automatique (phasage chiffré ou chiffrage rattaché) |
| Étude | Devis envoyé | Import du devis (la date d'import = date d'envoi) + « Ouvrir dans ProGBat » |
| Étude | Relance devis | Automatique : nombre de relances envoyées et date de la dernière, ou pourquoi aucune ne part |
| Contrat | Devis signé | Import du devis signé **avec sa date de signature** (obligatoire) + « Ouvrir dans ProGBat » |
| Contrat | Acompte encaissé | Automatique (facture d'acompte réglée dans ProGBat ou encaissement saisi) + bouton vers la facture |
| Contrat | Relance acompte | Automatique (comme la relance devis) |
| Contrat | Autorisation reçue (DP ou autre) | Case à cocher, **partagée** entre les chantiers de l'opération |
| Préparation | Visite conducteur + chargé d'affaires | Case « Fait » + bouton Google Agenda |
| Préparation | Plans techniques | Import du document (visible aussi des ouvriers) |
| Préparation | Phasage créé | Automatique, **seulement si le phasage contient des matériaux prévus** ; sinon l'étape dit ce qui manque |
| Préparation | Planning prévisionnel | Import du PDF |
| Préparation | Visite conducteur + chef de chantier | Case « Fait » + bouton Google Agenda |
| Préparation | Finalisation de la préparation | Case à cocher |
| Travaux | Un groupe d'exécution = une étape | Inchangé : validée par le contrôle de fin de groupe |
| Réception | Pré-réception interne | Automatique quand tous les groupes sont contrôlés |
| Réception | Réception + PV | Import du PV **avec la date de réception** (obligatoire) |
| Réception | Levée des réserves | Case à cocher (voir décision ci-dessous) |
| Réception | Facture de solde | Automatique (échéance « solde » émise) + bouton vers la facture |

- **Le cycle de vie n'a plus besoin d'un phasage.** Un chantier « À l'étude »
  (pas encore de phasage) peut enregistrer son devis envoyé et son devis
  signé ; la bascule « À l'étude → Planifié » fonctionne donc dès la
  signature. Les étapes sont enregistrées une par une : deux personnes qui
  valident deux étapes différentes ne s'écrasent plus.
- **Devis signé** validé : le chantier « À l'étude » passe en « Planifié »
  (historique conservé) et les relances du devis s'arrêtent. L'étape affiche
  « Facture d'acompte dans ProGBat : création automatique à venir (lot 4) — à
  créer à la main dans ProGBat pour l'instant ».
- **Autorisation reçue** cochée sur un chantier : les autres chantiers de la
  même opération affichent « Validée via le chantier X le … », sans copie de
  la donnée. « Dé-partager pour ce chantier » le dispense (il attend alors sa
  propre autorisation) ; « Re-partager » annule.
- **Ouvrir dans ProGBat** : ouvre le devis ou la facture dans un nouvel onglet
  (l'application n'écrit rien dans ProGBat). L'infobulle rappelle que
  l'entreprise « PROFERO RENOVATION » doit être active dans ProGBat. Devis
  inconnu (aucun devis créé depuis l'application pour ce chantier) : pas de
  bouton, la raison est écrite. Facture pas encore connue : le bouton ouvre la
  liste des factures, et le dit.
- **Créer l'événement Google Agenda** : même mécanisme que le bouton du
  Planning hebdo (un seul module pour les deux), événement pré-rempli avec le
  nom du chantier, l'opération et l'adresse (fiche chantier, sinon chiffrage,
  sinon opération). Adresse inconnue : c'est écrit sous le bouton.
- **Étapes déjà validées avant le lot 3** : reprises sur leur équivalent
  (tableau « Données migrées »). Les anciennes étapes sans équivalent ne sont
  plus affichées ; leurs documents restent consultables en bas de la frise
  (« Documents des anciennes étapes »).
- **Page Opération** : nouveau bloc « Cycle de vie des chantiers » en lecture
  seule : « 2/5 devis envoyés », « 1/5 devis signés », « autorisations
  reçues », « préparations finalisées », « réceptionnés », puis une ligne par
  chantier. Les chantiers perdus ne comptent pas (ils sont signalés à part).
  L'opération n'a pas de cycle de vie à elle.
- **Espace ouvrier** : inchangé, sauf que les nouveaux « plans techniques »
  apparaissent dans « Documents » (comme les anciens plans d'exécution).
- **Export de l'opération** (Markdown) : 5 phases ; une étape automatique y est
  marquée « Automatique (voir la fiche chantier) », jamais « À faire ».

**Qui voit quoi** : aucun droit d'accès aux pages modifié (`src/access.js`
inchangé). La fiche chantier et la page Opération gardent leurs rôles (lot 2).
Nouvel onglet **Réglages → Logistique → Relances**, réservé au rôle
administrateur (comme « Utilisateurs » ou « Accès »). Les deux nouvelles
tables portent `profero_collaborateurs_seulement` ; le bureau lit et écrit les
étapes, les ouvriers ne lisent que l'étape « Plans techniques » ; le journal
des relances n'est écrit que par le serveur.

**E-mails — qui reçoit quoi.** Les relances partent **uniquement si
l'administrateur les active** (Réglages → Relances ; livrées ÉTEINTES) :
- **Relance devis** : au **chargé d'affaires** du chantier (celui du chantier,
  sinon celui de l'opération), quand le devis a été importé comme envoyé depuis
  au moins 7 jours (réglable) sans être signé, puis chaque semaine jusqu'à la
  signature. Lien « Ouvrir dans ProGBat » vers le devis.
- **Relance acompte** : au chargé d'affaires, quand la facture d'acompte est
  émise depuis au moins 7 jours (réglable) sans être réglée, puis chaque
  semaine jusqu'à l'encaissement. Lien vers la facture.
- Jamais pour un chantier « Perdu », jamais sans chargé d'affaires (l'étape
  affiche « relance impossible : aucun chargé d'affaires »), jamais vers un
  compte inactif ou un identifiant sans vraie adresse e-mail. Une relance n'est
  jamais envoyée deux fois (une par semaine au plus, garantie par la base).
  Tâche planifiée : chaque matin du lundi au vendredi (6h15 UTC, 7h15 ou 8h15 à
  Paris), au plus 30 relances par passage.
- Aucun e-mail réel n'a été envoyé pendant le développement.

### Lot 4 — Automatisation ProGBat : client, chantier, facture d'acompte, statut du devis

**Vérifications faites EN LECTURE avant de coder (06/11/2026).** Aucune écriture
dans ProGBat, ni client, ni chantier, ni devis, ni facture de test. Les lectures
sont passées par une fonction serveur dédiée (`progbat-devis-statut-cron`,
action « diagnostic », uniquement des GET), déclenchée depuis la base avec le
même secret que la synchronisation des factures ; le diagnostic ne rapporte que
la forme des réponses et des valeurs techniques (identifiants, types, statuts),
jamais les coordonnées d'un client. La documentation officielle ProGBat
(progbat.readme.io) a été lue par la même fonction.

| Point à vérifier | Ce qui a été lu | Conclusion |
|---|---|---|
| Droits de la clé | La documentation donne les droits de chaque route : client = `thirds` ou `thirds.write`, chantier = `business` ou `business.write`, facture d'acompte = `bills` ou `bills.write`. Clé « devis » (`PROGBAT_PRIVATE_ACCESS_TOKEN`) : lit les devis (413), les clients (`/company/thirds`) et les types de tiers ; **refusée (403)** sur `/company/business`, `/company/bills`, `/company/users`, `/company/employees`. Clé « facturation » : lit chantiers (123), yards (126) et factures (516) ; refusée sur `/me`, les devis et les clients. Aucune route ne donne la liste des droits d'une clé. | **Non vérifiable sans écriture.** Très probable : la clé « devis » **n'a pas** `business.write` ni `bills.write` (elle n'a même pas leur lecture) ; `thirds.write` possible mais non prouvé. Le premier clic affichera « Droit ProGBat manquant : … » si ProGBat répond 403 (voir « À faire par Loris »). |
| `type` d'un client | `/company/third-types` : 1 Fournisseur, 2 **Client**, 3 Sous-traitant, 4 Prospect. 113 tiers de type 2 (= les 113 clients du 06/11), 61 fournisseurs, 12 sous-traitants. | **Confirmé : client = type 2.** Particulier / société = `legalType` 1 / 0 (89 clients à 1, civilités « Mr et Mme »… ; 24 à 0, civilités « SAS », « SARL »…). |
| `status` d'un chantier ProGBat | 123 chantiers : statut 0 (30), 1 (21), 2 (67), 3 (5). `business/2` (créé en 1970, ancien) = 2. La documentation ne décrit pas ces valeurs. | Correspondance probable 0 = À l'étude, 1 = En cours, 2 = Achevé, 3 = inconnu. **Non utilisé** : le chantier est créé sans statut (ProGBat met sa valeur par défaut). |
| `managerId` ↔ chargés d'affaires | `managerId` des chantiers : 0 (aucun, 62), 2 (50), 15 (10), 21 (1). Liste des utilisateurs / salariés ProGBat **refusée (403, droit `staff.read`)**. La clé « devis » est celle de l'utilisateur ProGBat n° 26. | **Correspondance illisible.** Réglage ajouté (Réglages → Outils → ProGBat : chargés d'affaires) ; sans correspondance, le chantier ProGBat est créé sans responsable et l'écran le dit. |
| `business/2` et `quotes/524` | `business/2` : id 2, client (thirdId) 4, responsable 2, statut 2, 2 yards (2 et 40). `quotes/524` = **D-260264** : client 174, **businessId 0, yardId 0** (« Chantier : Aucun » confirmé), **statut 1 = accepté**. | Formes conformes à la documentation. |
| `yardLabel` crée-t-il le yard ? | La création d'un chantier (`POST /company/business`) accepte `yardLabel` mais sa réponse documentée **ne contient pas le yard**. | Les deux cas sont gérés : yard lu dans la réponse s'il y est, sinon relu (`GET /company/business/{id}/yards`) ; s'il reste introuvable, l'écran le dit et propose « Relire le chantier ProGBat ». |
| Longueur maximale des codes | Aucune limite documentée (client : 1 caractère minimum). Codes existants : clients jusqu'à 38 caractères, chantiers jusqu'à 49. | Pas de troncature. |
| Statut des devis | Documenté : 0 étude (et brouillon), 1 accepté, 2 refusé, 6 en attente. Sur les 413 devis : 119 / 156 / 22 / 116. | Utilisé tel quel. |

**Nouveau process, pas à pas.**
1. **Client** — Opérations → fiche de l'opération → « Client ProGBat existant »
   (aussi dans le nouveau chiffrage, étape client) : liste des clients et
   prospects ProGBat, recherche par nom, e-mail, ville ou adresse ; « Choisir »
   crée la fiche client de l'application pré-remplie depuis ProGBat (ou reprend
   celle qui existe déjà : un client ProGBat n'a jamais deux fiches). Ce qui
   manque selon les règles Profero (souvent le prénom, l'e-mail, le téléphone)
   est affiché ; compléter la fiche ne modifie pas ProGBat. « + Nouveau client »
   montre d'abord les clients ProGBat qui ressemblent (« ce client existe
   peut-être déjà dans ProGBat ») : on en choisit un, ou on coche « aucun ne
   correspond ».
2. **Chiffrage → Aperçu ProGBat** : en haut, « 1. Client ProGBat ». Un client
   déjà relié est « fait » : aucune création. Sinon « Chercher dans ProGBat »
   (correspondances avec leurs raisons : même e-mail, même téléphone, même
   adresse, même nom, même identifiant), puis « Choisir ce client » ou « Créer
   le client dans ProGBat » (aperçu exact de ce qui sera envoyé, puis
   « Confirmer la création »). La création est refusée tant que les clients
   ressemblants n'ont pas été écartés explicitement.
3. « 2. Chantier ProGBat » → « Créer le chantier dans ProGBat » : nom et code
   générés, adresse du chantier, client ProGBat, responsable si la
   correspondance est renseignée ; aperçu puis confirmation. Le chantier
   ProGBat et son yard sont notés sur le chantier (et dans les yards ProGBat
   du chantier, utilisés par la synchronisation des factures).
4. Le bouton « Créer le brouillon dans ProGBat » ne s'active qu'avec client et
   chantier ProGBat : le devis part avec thirdId, businessId et yardId (plus de
   « Chantier : Aucun »). Si ProGBat a refusé une création faute de droit, une
   case permet de créer le devis comme avant (sans client ni chantier reliés),
   pour ne pas bloquer le chiffrage.
5. **Signature** — fiche chantier → Contrat → « Devis signé » validé : bouton
   « Créer la facture d'acompte en brouillon (50 %) ». Le serveur vérifie la
   signature, qu'aucune facture d'acompte n'existe déjà pour ce devis (factures
   synchronisées + lecture de ProGBat ; si la lecture échoue, rien n'est créé),
   puis crée le brouillon. « Ouvrir dans ProGBat » ouvre la facture : l'assistante
   la valide et l'émet dans ProGBat (l'API ne le permet pas).
6. **Statut du devis** — relu dans ProGBat toutes les heures de 6 h à 19 h
   (UTC) : devis accepté et « Devis signé » non validé → « Devis accepté dans
   ProGBat : importer le devis signé » ; refusé → « … utiliser « Marquer
   perdu » » ; devis introuvable (supprimé dans ProGBat) → dit tel quel.

**Protection de chaque écriture ProGBat.** Utilisateur du bureau, aperçu
puis confirmation (l'empreinte de l'aperçu doit être identique au moment de
l'envoi), réservation en base avant l'appel (table `progbat_ecritures` :
une seule tentative en cours, réussie ou incertaine par élément), jamais de
nouvel essai automatique. Coupure réseau, délai dépassé ou erreur ProGBat
5xx = « état incertain » : tout nouvel essai est bloqué jusqu'à « J'ai vérifié
dans ProGBat : rien n'a été créé ». Un refus de ProGBat est affiché tel quel
(« Droit ProGBat manquant : business.write (ProGBat a répondu 403 …) »).

**Qui voit quoi.** Aucun droit d'accès modifié (`src/access.js` inchangé). Les
boutons sont sur des pages existantes (Opérations, Chiffrage, fiche chantier)
et servent aux utilisateurs du bureau (le serveur refuse les ouvriers). Le
réglage des responsables ProGBat est dans Réglages → Outils (administrateur).
Aucun e-mail.

**Statuts lus dans ProGBat le 06/11/2026** (requête sur la base, premier passage
de la tâche planifiée) : sur 27 chiffrages ayant un devis, 5 « à l'étude /
brouillon », 19 « en attente », 0 accepté, 0 refusé, **3 introuvables**
(devis supprimés dans ProGBat). Aucun chiffrage n'est encore rattaché à un
chantier (`chantier_projets` vide) : ces statuts n'apparaîtront sur les fiches
chantier qu'après rattachement (lot 2).
### Lot 5 — Opérations devient la porte d'entrée

**Bureau (conducteurs, comptable, commerciaux, direction).**
- **Menu** : « Opérations » remonte juste sous le tableau de bord ;
  « Chantiers » (la liste) **disparaît du menu**, sur ordinateur comme sur
  téléphone. Quelqu'un qui avait réordonné son menu garde son ordre ;
  Opérations y apparaît (en fin de liste s'il ne l'avait pas encore).
- **Page Opérations** : onglets **À l'étude · En cours · Terminées · Perdues ·
  Sans chantier**, chacun avec son nombre. Le statut de l'opération est celui
  du lot 2, calculé à partir de ses chantiers, jamais saisi. Une opération est
  dans un seul onglet. « Sans chantier » (opération vide, ou dont tous les
  chantiers sont archivés) a son propre onglet, **toujours affiché**, même à 0 :
  une opération vide n'est ni « à l'étude » ni « terminée ». Un onglet vide
  l'écrit (« Aucune opération perdue. »). L'onglet choisi est retenu sur
  l'appareil ; par défaut « En cours » (ou le premier onglet non vide).
- **Fiche d'une opération** : en-tête, client et chargé d'affaires (lot 2),
  puis **« Chantiers et cycle de vie »** : la synthèse (« 2/5 devis
  signés »…) et **la liste de ses chantiers**, chacun avec sa couleur, son
  statut et sa **mini-frise** (envoyé, signé, autorisation, préparé,
  réceptionné). **Un clic sur un chantier ouvre sa fiche.** Si les étapes ne
  se chargent pas, la liste reste et chaque ligne dit « frise indisponible ».
  Puis les onglets habituels : Synthèse (indicateurs), Chemin de fer,
  Planifier.
- **Fiche chantier** : **inchangée**, avec en plus en haut le fil d'Ariane
  **« Opérations › nom de l'opération › chantier »**. Cliquer sur le nom de
  l'opération y revient ; « Opérations » ramène à la liste. Le bouton
  « Retour » devient **« Retour à l'opération »**. Opération introuvable :
  « Opération introuvable » en rouge (jamais un vide).
- **Liens « ouvrir le chantier » existants** : il y en a trois, tous vérifiés
  et passés par le même chemin (`ouvrirFicheChantier` dans `App.jsx`) :
  Opérations (clic sur un chantier), Alertes (clic sur une alerte), Notes des
  ouvriers (nom du chantier). Ils ouvrent la fiche directement, comme avant.
  Les liens « Chantiers » du Journal des MAJ mènent maintenant à Opérations.

**Ouvriers : rien ne change.** L'espace ouvrier est un écran à part (routé
dès la connexion pour le rôle ouvrier) ; son onglet « Opérations » / ses
chantiers restent en accès direct, sans passer par la page bureau. Aucun
fichier de l'espace ouvrier n'est modifié.

**Qui voit quoi** — lu en base le 06/11/2026
(`planning_config.access_pages_renovation`), avant / après. Rappel de la
règle : la liste enregistrée en base remplace la liste par défaut pour chaque
rôle, **sauf l'administrateur**, qui reçoit en plus automatiquement toute
page de sa liste par défaut (fin de `loadAccessConfig`).

| Rôle (comptes actifs) | Opérations avant | Opérations après | Fiche chantier (`chantiers`) | Liste Chantiers dans le menu |
|---|---|---|---|---|
| Administrateur (4) | oui, par attribution automatique seulement | **oui** (en base + automatique) | oui | non (était oui) |
| Super administrateur (0) | non | **oui** | oui | non (était oui) |
| Conducteur de travaux (0) | non | **oui** | oui | non (était oui) |
| Comptable (1) | non | **oui** | oui | non (était oui) |
| Commercial (2) | non | **oui** | oui | non (était oui) |
| Ouvrier (7) | non | non | non (espace ouvrier) | — |

Comptes actifs lus dans `utilisateurs` le 06/11/2026 (un compte
« agent_edl » existe aussi : rôle sans liste Rénovation, inchangé).

- Modification en base, **appliquée avant la fusion** (compatible avec
  l'ancien code : Opérations existait déjà ; avec l'ancien code, ces rôles
  voient simplement une entrée de menu de plus). **Rien n'est retiré** :
  « chantiers » reste dans chaque liste, il porte désormais le droit d'ouvrir
  la fiche. Seule la ligne `access_pages_renovation` est modifiée (une page
  ajoutée à 5 rôles : 24→25, 22→23, 16→17, 18→19, 9→10 pages). Aucune
  policy, fonction ou rôle touché.
- **Sauvegarde** : `planning_config_sauvegarde_refonte`, ligne **id 4**,
  motif « lot5 : avant ajout de operations aux rôles qui ont chantiers
  (06/11/2026) ».
- Script appliqué : `sql/202611_refonte_operations_lot5_acces.sql` ;
  **retour arrière** : `sql/202611_refonte_operations_lot5_acces_rollback.sql`
  (retire « operations » seulement des rôles qui ne l'avaient pas dans la
  sauvegarde ; option de restauration exacte).
- `src/access.js` (listes par défaut) : « operations » ajouté au commercial
  (les autres l'avaient déjà) ; la page « chantiers » s'appelle « Fiche
  chantier (via Opérations) » dans Réglages → Accès.
- **À savoir** : la page Opérations montre les chiffres de l'opération
  (vendu, marges) ; les commerciaux et le comptable les voyaient déjà sur la
  fiche chantier (bloc financier), ils les voient maintenant aussi agrégés
  par opération. Ils peuvent aussi « Marquer perdu » et renseigner client /
  chargé d'affaires depuis la fiche de l'opération (bloc du lot 2). Pour le
  restreindre : Réglages → Accès (ou lot 6, rôle chargé d'affaires).

**E-mails** : aucun changement.

### Lot 6 — Rôle « Chargé d'affaires »

**Nouveau rôle** (identifiant technique `charge_affaires`, libellé « Chargé
d'affaires ») que l'administrateur peut attribuer dans Réglages →
Utilisateurs. **Aucun compte ne l'a aujourd'hui** (lu en base le 06/11/2026 :
4 administrateurs, 2 commerciaux actifs, 1 comptable, 1 agent EDL, 7
ouvriers actifs) : rien ne change pour personne tant que Loris ne l'attribue
pas.

**Ce que fait le chargé d'affaires.**
- Pages : **Opérations** (porte d'entrée), **fiche chantier**, **Chiffrage**,
  **Journal des MAJ**. Il crée opérations, chantiers et clients (parcours
  « Nouveau projet » du Chiffrage, fiche de l'opération), fait le chiffrage
  et crée les devis dans ProGBat (bouton existant, mêmes règles de saisie).
- Cycle de vie : il **valide les étapes des phases Étude et Contrat** (visite
  avant chiffrage, devis envoyé, devis signé, acompte, autorisation…). Les
  phases **Préparation, Travaux et Réception lui sont en lecture seule** :
  les étapes s'affichent sans boutons, avec la phrase « Lecture seule : en
  tant que chargé d'affaires, vous validez les étapes des phases Étude et
  Contrat… ». Il ne peut pas non plus « Déclarer comme phase en cours » ni
  « Revenir à l'automatique » (ce choix pilote toute la frise).
- **La base le garantit aussi** : deux policies restrictives sur
  `chantier_cycle_vie` refusent à un compte `charge_affaires` l'écriture de
  toute étape hors Étude/Contrat (et de la phase déclarée). Pour les autres
  rôles, rien ne change.
- Il **n'a pas** : États financiers, Bilan de semaine, Encours fournisseurs,
  Rapprochement factures, Heures des salariés, Réglages, ni le tableau de
  bord, le planning, les commandes, les bibliothèques (ouvrages, matériaux :
  modifiables par tous ceux qui les ouvrent), le phasage ou la validation.
- Il apparaît dans la liste des chargés d'affaires proposés (opération et
  chantier, lot 2) : la règle « comptes actifs hors ouvriers » est maintenant
  une fonction unique testée (`estCollaborateurProposable`).

**Droits en base (SQL)** : aligné sur le **commercial**, le rôle existant le
plus proche. Cartographie faite le 06/11/2026 :
- `est_collaborateur_actif()` ne regarde pas le rôle (fiche active suffit) :
  **reconnu collaborateur sans modification**. `est_ouvrier()` = rôle
  exactement « ouvrier » : **jamais traité comme un ouvrier**. Aucune
  contrainte CHECK sur `utilisateurs.role`. Le déclencheur
  `utilisateurs_proteger_champs_sensibles` empêche toujours un
  non-administrateur de changer son propre rôle. **Aucune fonction ni
  contrainte modifiée**, aucune fonction qui écrit dans
  `invest_dossier_etapes` touchée.
- Toutes les policies « bureau » (`NOT est_ouvrier()`) lui ouvrent, comme au
  commercial : opérations, chantiers, clients, chiffrages, liens chiffrage →
  chantier, journal des statuts, cycle de vie (limité ci-dessus),
  `planning_config`.
- Listes de rôles nommées, où il **n'est pas** ajouté (le commercial n'y est
  pas non plus) : `facture_frais` et bucket `factures-privees` (admin,
  conducteur, bureau, comptable), `planning_semaine_export` (admin,
  conducteur), fonctions `conducteur_*_suggestion_materiau` (admin,
  conducteur), `ia_jobs` (admin), `is_admin()`. Fonction
  `portail_gestionnaire()` (admin, commercial — gestion du portail client
  Invest) : **non ouverte** au chargé d'affaires (rôle Rénovation).
- Fonctions serveur `admin-users` / `admin-users-local` : réservées à
  l'administrateur, aucune liste de rôles à compléter.

**Qui voit quoi** — lu en base après modification le 06/11/2026
(`planning_config.access_pages_renovation`). Rappel : la liste en base
remplace la liste par défaut pour chaque rôle, **sauf l'administrateur**,
qui reçoit en plus automatiquement toute page de sa liste par défaut (fin de
`loadAccessConfig`).

| Rôle (comptes actifs) | Pages en base | Opérations | Fiche chantier | Chiffrage | Pages financières globales | Réglages |
|---|---|---|---|---|---|---|
| **Chargé d'affaires (0)** — nouveau | **4** : operations, chantiers, info-client, journal-maj | **oui** | **oui** | **oui** | **non** | **non** |
| Administrateur (4) | 25 (inchangé) + attribution automatique de toute page de sa liste par défaut | oui | oui | oui | oui | oui |
| Super administrateur (0) | 23 (inchangé) | oui | oui | oui | oui (États financiers) | oui |
| Conducteur de travaux (0) | 17 (inchangé) | oui | oui | oui | non | non |
| Comptable (1) | 19 (inchangé) | oui | oui | oui | oui (États financiers) | non |
| Commercial (2) | 10 (inchangé) | oui | oui | non | non | non |
| Ouvrier (7) | 0 (espace ouvrier) | — | — | — | — | — |

- **L'administrateur voit-il le rôle ?** Oui : dans Réglages → Utilisateurs
  (choix du rôle) et Réglages → Accès (ligne « Chargé d'affaires » réglable
  comme les autres). Le rôle lui-même n'ajoute aucune page à l'admin.
- **Qui d'autre ?** Personne ne voit plus ni moins qu'avant : les 6 autres
  lignes de la configuration sont identiques à la sauvegarde (contrôlé en
  base).
- Modification en base, **appliquée avant la fusion** (compatible avec
  l'ancien code : un compte qui aurait le rôle avant la fusion verrait ses 4
  pages, la base limitant déjà le cycle de vie) :
  - `access_roles_renovation` : rôle ajouté en fin de liste (6 → 7 rôles ;
    sans cela il n'était pas proposé dans Réglages, la liste en base remplaçant
    la liste par défaut) ;
  - `access_pages_renovation` : clé `charge_affaires` ajoutée (4 pages) ;
    rien retiré ni modifié ailleurs.
  - **Sauvegardes** : `planning_config_sauvegarde_refonte`, lignes **id 7**
    (`access_pages_renovation`) et **id 8** (`access_roles_renovation`), motif
    « lot6 : avant ajout du rôle charge_affaires (06/11/2026) ». Essai d'abord
    dans une transaction annulée (mêmes résultats).
  - Script appliqué : `sql/202611_refonte_operations_lot6_acces.sql` ;
    **retour arrière** : `sql/202611_refonte_operations_lot6_acces_rollback.sql`
    (retire la seule clé et la seule entrée du rôle ; option de restauration
    exacte).
- Migration `supabase/migrations/20261106071527_refonte_operations_lot6.sql`
  (version **20261106071527**, enregistrée comme appliquée) : deux policies
  **restrictives** sur `chantier_cycle_vie` (création, modification), rien
  d'autre. Essai complet dans une transaction annulée avec un compte
  `charge_affaires` fictif (exemple issu des tests, données fictives : le
  compte n'existait que dans la transaction) : collaborateur actif = vrai,
  ouvrier = faux ; lit 46 chantiers, 19 opérations, 88 chiffrages, et
  seulement sa propre fiche `utilisateurs` ; « Devis signé » créé puis
  modifié ; « Plans techniques », déclaration de phase et renommage d'une
  étape en « Plans techniques » refusés ; un administrateur réel crée et
  modifie toujours « Plans techniques ». Après application : 7 policies sur
  la table (5 avant). **Retour arrière** :
  `sql/202611_refonte_operations_lot6_rollback.sql` (retire les deux
  policies).
- Code : `src/Renovation/roleChargeAffaires.mjs` (module pur : pages, pages
  interdites, `peutValiderEtape`, `peutDeclarerPhase`, message de lecture
  seule) ; rôle et pages par défaut dans `src/access.js` et dans le repli du
  menu `Navigation.jsx` (sans cette entrée, un rôle inconnu du repli retombait
  sur le menu administrateur) ; libellé dans `App.jsx`, `Navigation.jsx`,
  `Admin.jsx` ; bouton « Ouvrir les Réglages » de la page Opérations réservé
  à qui a Réglages.

**À savoir** : comme le commercial, le chargé d'affaires voit les chiffres de
vente et de marge **dans Opérations** (totaux de la liste, synthèse de chaque
opération) et sur la fiche chantier (bloc financier, facturation). Ce ne sont
pas des pages financières globales, mais si Loris veut les lui masquer, c'est
une évolution à part.

**E-mails** : aucun changement (relances : inchangées ; le chargé d'affaires
désigné sur un chantier reçoit les relances comme avant, quel que soit son
rôle).

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
| 06/11/2026 | **Lot 3 — Étapes du cycle de vie dans une table à part** (`chantier_cycle_vie`, une ligne par chantier et par étape), au lieu du phasage. | Un chantier à l'étude n'a pas de phasage : il ne pouvait valider ni « Devis envoyé » ni « Devis signé », donc jamais basculer en Planifié. Une ligne par étape évite aussi qu'une validation en écrase une autre. | Annuler la demande de fusion + `sql/202611_refonte_operations_lot3_rollback.sql` (renomme les tables en `_sauvegarde_refonte`, rien n'est supprimé). |
| 06/11/2026 | **Lot 3 — Reprise À LA LECTURE de l'ancien cycle**, aucune réécriture en base. Correspondances : Métrés → Visite avant chiffrage + Imapper ; Chiffrage réalisé, Devis envoyé, Devis signé, Acompte encaissé, Levée des réserves → même étape ; Plans d'exécution → Plans techniques ; Visite de réception → Réception + PV ; phases Devis → Étude, Garanties → Réception. Sans équivalent (conservées en base, non affichées, documents consultables) : Réponse client, Rétractation, Commandes, Équipes affectées, Installation, DOE, Parfait achèvement, SAV, Fin de garantie. Une ligne de la nouvelle table prime toujours sur l'ancien état ; à la première modification d'une étape reprise, son état (documents compris) est recopié dans la table, l'ancien reste intact. | Les anciennes données restent la vérité de secours ; l'ancien code relit exactement ce qu'il avait. | Retour arrière : l'ancien code relit `meta.cycle_vie_etapes`, jamais modifié. |
| 06/11/2026 | **Lot 3 — « Réponse client : accepté » n'est pas repris en « Devis signé ».** | « Devis signé » se prouve par le devis signé importé ; une réponse orale ne déclenche pas la bascule en Planifié. Les 8 chantiers concernés avaient de toute façon déjà « Devis signé » ou un statut d'exploitation. | — |
| 06/11/2026 | **Lot 3 — « Acompte encaissé » devient automatique**, mais une coche manuelle de l'ancien cycle reste valable (« coche manuelle conservée »). La facture d'acompte retenue est celle de l'échéance « acompte », sinon la première facture d'acompte ProGBat du chantier (l'écran le précise). Réglée = règlements ProGBat couvrant le montant, ou encaissement saisi dans le bloc Facturation. L'ancienne écriture automatique de l'étape depuis la facturation est supprimée (le calcul se fait à la lecture). | Ne jamais retirer une information saisie ; un seul calcul, pas de recopie. | — |
| 06/11/2026 | **Lot 3 — Levée des réserves reste une case à cocher.** | Vérifié : les seules réserves saisies dans l'application sont celles des contrôles de fin de groupe (table `reserves`, 0 ligne en base au 06/11/2026), pas les réserves du PV de réception. L'étape affiche le nombre de réserves de contrôle encore ouvertes, à titre d'information. | Brancher l'étape sur `reserves` si un jour les réserves de réception y sont saisies. |
| 06/11/2026 | **Lot 3 — Phasage créé** = le phasage existe et au moins un ouvrage a des matériaux prévus (liens matériaux ou coût matériaux) ; les ouvrages sans matériau sont comptés dans la raison. | « Pas seulement des heures » sans rendre bloquants les ouvrages de pure main-d'œuvre (démolition…). | Durcir la règle dans `etatPhasageMateriaux()`. |
| 06/11/2026 | **Lot 3 — Dates obligatoires à l'import** : le devis signé ne s'importe qu'avec sa date de signature, le PV qu'avec sa date de réception. | Cahier des charges (« + date de signature », « + date de réception ») ; la date de signature sert au diagramme financier. | — |
| 06/11/2026 | **Lot 3 — Relances** : première relance au bout du délai réglé (7 jours par défaut, entre 1 et 60), puis tous les 7 jours ; une semaine manquée n'est pas rattrapée (on envoie celle en cours) ; la relance est réservée en base avant l'envoi (contrainte d'unicité), un échec d'envoi est retenté le lendemain ; 30 relances au plus par passage. Créneau dédié (`?job=relances_cycle_vie`) dans le workflow existant `cron-dispatcher.yml` ; envoi par `api/send-email.js` (profil serveur). Interrupteur éteint = la tâche ne lit rien d'autre que l'interrupteur. | Prudence : rien ne part sans l'accord de Loris ; jamais de double envoi ; pas de déluge le jour de l'activation. | Éteindre l'interrupteur (Réglages → Relances). |
| 06/11/2026 | **Lot 3 — Phase déclarée à la main** : enregistrée dans la même table (pseudo-étape `_phase_declaree`), l'ancienne déclaration du phasage est reprise et traduite. | Fonctionne sans phasage, comme les étapes. | — |
| 06/11/2026 | **Lot 3 — Ouvriers** : nouvelle policy de lecture limitée à l'étape « Plans techniques » sur la nouvelle table. La fonction `ouvrier_chantier_detail` (droits élevés) n'est pas modifiée ; l'écran ouvrier ajoute les plans de la table et retire les anciens plans d'exécution quand la table les a repris (pas de doublon). | Les ouvriers voyaient déjà les plans d'exécution ; ne pas leur retirer les nouveaux plans. Aucune fonction à droits élevés touchée. | Supprimer la policy « cycle vie ouvrier plans techniques ». |
| 06/11/2026 | **Lot 3 — Facture d'acompte ProGBat (lot 4)** : aucun appel ProGBat. Point d'accroche : la bascule `decisionBasculeSignature()` / l'effet « bascule à la signature » de `PageChantiers.jsx` ; message honnête sur l'étape « Devis signé ». | Garde-fou « ProGBat en lecture seule » ; le lot 4 ajoute le bouton avec confirmation et anti-doublon. | — |
| 06/11/2026 | **Lot 4 — Lectures de vérification par une fonction serveur dédiée** (`progbat-devis-statut-cron`, GET uniquement), déclenchée depuis la base avec le secret de la synchronisation des factures. | La session de développement n'a pas d'accès réseau à ProGBat ni à Supabase hors base ; les clés ProGBat ne sont lisibles que par les fonctions serveur. Le diagnostic ne rend que des formes et des valeurs techniques. | L'action « diagnostic » peut être retirée de la fonction sans effet sur le reste. |
| 06/11/2026 | **Lot 4 — Écritures avec la clé « devis »** (`PROGBAT_PRIVATE_ACCESS_TOKEN`), la clé « facturation » restant en lecture (repli pour lire chantiers, yards et factures). | La clé de facturation a été créée volontairement en lecture seule ; la clé « devis » écrit déjà les devis. | Changer le jeton dans `progbat-operations`. |
| 06/11/2026 | **Lot 4 — Client ProGBat** : créé en type 2 (client), `legalType` 1 particulier / 0 société, code = identifiant « NOM VILLE » du lot 2, adresse et contact avec e-mail et téléphone ; pays « France » envoyé « FR ». Création refusée tant que les clients ProGBat ressemblants (même identifiant, e-mail, téléphone, adresse ou nom) n'ont pas été écartés un par un. | « Jamais de rapprochement automatique par ressemblance » ; « création directement en client ». | — |
| 06/11/2026 | **Lot 4 — Demande de Loris du 06/11 : les clients existent déjà dans ProGBat.** « Client ProGBat existant » dans Opérations et le chiffrage : la fiche locale est créée pré-remplie depuis le client ProGBat choisi (ou réutilisée), index unique sur `clients.progbat_client_id`. Le nom d'un particulier (« Mr et Mme DUPONT ») est repris tel quel dans « nom » ; le prénom, l'e-mail, le téléphone manquants sont affichés à compléter. « + Nouveau client » montre d'abord les ressemblances et exige « aucun ne correspond ». Modifier une fiche reliée garde l'identifiant ProGBat d'origine. | Éviter les doublons dans ProGBat ; ne rien deviner du nom. | Les fiches créées restent ; ne plus proposer le bouton. |
| 06/11/2026 | **Lot 4 — Chantier ProGBat** : créé sans `status` (valeur par défaut de ProGBat), avec `yardLabel` = référence du logement ; responsable (`managerId`) seulement si la correspondance est renseignée dans Réglages → Outils. | Statuts des chantiers non documentés ; liste des utilisateurs ProGBat illisible (403, `staff.read`). | Renseigner / vider la correspondance. |
| 06/11/2026 | **Lot 4 — Identifiants reportés sur le chiffrage** (`profero_projets.progbat_client_id / progbat_business_id / progbat_yard_id`) seulement pour les chiffrages **sans devis**, à chaque ouverture de l'aperçu. | La fonction des devis lit le chiffrage : elle envoie thirdId / businessId / yardId sans être modifiée. Un devis déjà créé garde ses identifiants. | Vider les colonnes d'un chiffrage sans devis. |
| 06/11/2026 | **Lot 4 — Devis sans chantier ProGBat** : bloqué, sauf si ProGBat a refusé la création du client ou du chantier faute de droit (403) — une case « créer comme avant » apparaît alors. | Ne pas bloquer le chiffrage tant que les droits ProGBat ne sont pas ajoutés (chaque lot laisse l'application utilisable). | — |
| 06/11/2026 | **Lot 4 — Facture d'acompte** : seulement si « Devis signé » est validé (table du lot 3 ou ancienne coche reprise), 50 % (`advanceRate`), refusée si une facture d'acompte existe déjà pour ce devis (synchronisation des factures ou lecture de ProGBat) ou si la lecture des factures échoue. | Anti-doublon maximal sur une écriture comptable. | — |
| 06/11/2026 | **Lot 4 — Statut des devis** : tâche planifiée de la base (`progbat-devis-statut`, toutes les heures à 37 de 6 h à 19 h UTC) → fonction `progbat-devis-statut-cron` (GET des devis). Un devis supprimé dans ProGBat (404) est enregistré « introuvable » (valeur -1) et affiché, jamais présenté comme « pas encore lu ». | Pas de webhook ProGBat ; le dispatcher Vercel n'a pas de clé ProGBat. | `select cron.unschedule('progbat-devis-statut')`. |
| 06/11/2026 | **Lot 4 — `progbat-quote` non redéployée.** Comparaison faite avec la version en ligne (v9) : elle sait déjà envoyer thirdId / businessId / yardId ; ses seules différences avec le dépôt sont les règles de saisie du lot 2 (contrôlées aussi par le bouton) et des fonctions d'heures du chiffrage sans effet sur le devis. | Recopier à la main 150 Ko de code de prix pour un redéploiement sans effet fonctionnel sur le lot 4 présentait plus de risque que d'intérêt. | Redéployer depuis le dépôt (`supabase functions deploy progbat-quote`). |
| 06/11/2026 | **Lot 5 — L'identifiant de page « chantiers » est gardé** comme droit d'ouvrir la fiche chantier ; seule l'entrée de menu disparaît (liste `PAGES_HORS_MENU` de `navigationOperations.mjs`, lue par le menu latéral et la barre mobile). | Le plus prudent : aucun droit retiré, les liens existants (Alertes, Notes des ouvriers, Opérations) et les réglages d'accès en base continuent de fonctionner sans réécriture. | Retirer « chantiers » de `PAGES_HORS_MENU`. |
| 06/11/2026 | **Lot 5 — « operations » ajouté en base** à tous les rôles qui avaient « chantiers » (admin, super_admin, conducteur, comptable, commercial), **avant la fusion**, sans rien retirer. | Compatible avec l'ancien et le nouveau code ; sans cela, ces rôles n'auraient plus eu de porte d'entrée vers leurs chantiers (la liste en base remplace la liste par défaut, sauf pour l'admin). Admin ajouté aussi pour que la ligne en base se lise seule. | `sql/202611_refonte_operations_lot5_acces_rollback.sql` (sauvegarde id 4). |
| 06/11/2026 | **Lot 5 — La liste Chantiers reste joignable en repli**, seulement si un rôle a « chantiers » sans « operations » (cas qui n'existe plus en base) : « Retour » de la fiche y ramène alors comme avant. Sinon « Retour » ramène à l'opération, et un lien générique vers « chantiers » (Journal des MAJ) mène à Opérations. La page d'arrivée n'est jamais la liste Chantiers. | Ne jamais perdre l'accès à ses chantiers si quelqu'un modifie les accès dans Réglages → Accès. | — |
| 06/11/2026 | **Lot 5 — Onglet « Sans chantier »** toujours affiché (même à 0), à côté des quatre onglets demandés. Onglet par défaut : En cours, sinon le premier non vide ; choix retenu sur l'appareil. | « Une impossibilité doit rester visible » : une opération vide ne doit ni disparaître ni passer pour « terminée ». | — |
| 06/11/2026 | **Lot 5 — La liste des chantiers de la fiche Opération est le bloc « Chantiers et cycle de vie »** du lot 3 (mini-frise `resumeCycleVieChantier`), rendu cliquable, plutôt qu'un nouveau tableau. Le tableau financier des logements (onglet Synthèse) reste cliquable lui aussi. | Un seul calcul de la frise ; la liste est visible quel que soit l'onglet choisi (Synthèse, Chemin de fer, Planifier). | — |
| 06/11/2026 | **Lot 6 — Identifiant du rôle : `charge_affaires`**, libellé « Chargé d'affaires ». | Distinct de l'identifiant de page « chantiers » ; même forme que les colonnes `charge_affaires_id` du lot 2. | `sql/202611_refonte_operations_lot6_acces_rollback.sql` (après avoir changé le rôle des comptes concernés). |
| 06/11/2026 | **Lot 6 — Pages du rôle : Opérations, fiche chantier, Chiffrage, Journal des MAJ**, rien d'autre. Pas de tableau de bord, planning, commandes, bibliothèques, phasage. Interdites et contrôlées : États financiers, Bilan de semaine, Encours fournisseurs, Rapprochement factures, Heures des salariés, Réglages (et l'ancien identifiant « dashboard-analyse »). | Cahier des charges (« Opérations, fiche chantier et chiffrage ; pas de pages financières globales ni d'administration »). Journal des MAJ ajouté : il n'affiche aucune donnée et c'est là que les nouveautés sont expliquées. Bibliothèques exclues : ce qui y est modifié change les prix de tous les chiffrages. | Réglages → Accès (ligne « Chargé d'affaires »). |
| 06/11/2026 | **Lot 6 — Phases autres qu'Étude et Contrat en lecture seule**, et pas de « Déclarer comme phase en cours » ; une étape dont la phase est inconnue (groupe d'exécution, échéance de facturation) est en lecture seule. Garanti **à l'écran** (`peutValiderEtape`) **et en base** (2 policies restrictives sur `chantier_cycle_vie`). | Le plus prudent ; la base empêche un contournement par un ancien onglet ou un appel direct. La liste d'étapes de la base est comparée à celle du module par `verif-refonte-lot6` : une étape en trop en base fait échouer le contrôle ; une étape ajoutée plus tard à Étude/Contrat sans migration est signalée (le chargé d'affaires verrait alors un refus d'enregistrer, jamais un droit de trop). | `sql/202611_refonte_operations_lot6_rollback.sql`. |
| 06/11/2026 | **Lot 6 — Droits SQL alignés sur le commercial** : aucune fonction (`est_collaborateur_actif`, `est_ouvrier`, `mon_role`…) ni contrainte modifiée ; pas d'ajout aux listes de rôles nommées (factures de frais, export du planning, suggestions de matériaux, portail client Invest). | Le rôle est déjà collaborateur actif et non ouvrier ; ne lui donner aucun droit de plus qu'au commercial. | — |
| 06/11/2026 | **Lot 6 — Configuration d'accès en base modifiée avant la fusion** (liste des rôles + pages du rôle), sans rien retirer aux autres rôles ; sauvegardes id 7 et 8. Le rôle n'est attribué à personne. | Compatible avec l'ancien code ; sans la ligne en base, le rôle n'était pas proposé dans Réglages (la liste en base remplace la liste par défaut). | `sql/202611_refonte_operations_lot6_acces_rollback.sql`. |

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

### Lot 3 — étapes de l'ancien cycle de vie

Comptes lus en base le 06/11/2026 (requête sur `phasages.plan_travaux.meta.cycle_vie_etapes`,
24 phasages sur 49 portent des étapes, tous rattachés à un chantier existant).
**Rien n'est réécrit** : la reprise se fait à l'affichage.

| Ancienne étape | États en base | Dont validées | Avec documents | Devient |
|---|---|---|---|---|
| Métrés | 1 | 0 | 0 | Visite avant chiffrage + Imapper |
| Chiffrage réalisé | 1 | 0 | 0 | Chiffrage réalisé (automatique, recalculé) |
| Devis signé | 8 | 8 | 7 | Devis signé |
| Acompte encaissé | 8 | 8 (toutes cochées à la main) | 0 | Acompte encaissé (coche conservée) |
| Plans d'exécution | 1 | 1 | 1 | Plans techniques |
| Visite de réception | 2 | 1 | 2 | Réception + PV |
| Levée des réserves | 9 | 9 | 7 | Levée des réserves |
| Réponse client | 9 | 8 | 7 | — (non affichée ; 7 documents consultables en bas de la frise) |
| Commandes & approvisionnements | 2 | 2 | 0 | — (non affichée) |
| Facture de situation 100 % (déjà masquée depuis l'échéancier) | 2 | 2 | 0 | — (non affichée) |

Phases déclarées à la main : 2 (une « Travaux », une « Réception ») — reprises
telles quelles. Aucune phase « Devis » ni « Garanties » déclarée.

Migration `supabase/migrations/20261106061807_refonte_operations_lot3.sql`,
**purement additive** : tables `chantier_cycle_vie` et `relances_cycle_vie`
créées (vides), policy `profero_collaborateurs_seulement` posée sur les deux,
aucune ligne existante lue ni modifiée, aucune fonction à droits élevés.
Vérifiée avant (objets inexistants, SQL relu), essayée dans une transaction
annulée (2 policies restrictives, une ligne d'essai par table, 46 chantiers /
49 phasages inchangés), puis appliquée et enregistrée (version
20261106061807). Pas de sauvegarde nécessaire : rien n'est réécrit. Retour
arrière : `sql/202611_refonte_operations_lot3_rollback.sql`.

**Simulation des relances** (lecture seule de la base le 06/11/2026, module
`relancesCycleVie.mjs`, aucun e-mail) — si l'interrupteur était activé
aujourd'hui avec le délai de 7 jours : **0 relance partirait**.
- Devis : aucun chantier n'a encore d'étape « Devis envoyé » importée (38
  chantiers sans devis envoyé, 8 avec un devis signé repris de l'ancien
  cycle).
- Acompte : 30 chantiers ont une facture d'acompte émise ; 29 sont réglées
  (ou cochées à la main), **1 n'est pas réglée** (facture du 25/08/2025, chantier
  en cours) mais **aucun chantier n'a de chargé d'affaires** (0 sur 46) :
  l'étape affiche « relance impossible : aucun chargé d'affaires ».
- Dès qu'un chargé d'affaires sera renseigné sur ce chantier (ou son
  opération), cette facture serait relancée au premier passage : à vérifier
  avant d'activer (elle a peut-être été réglée hors ProGBat).

### Lot 4

Migration `refonte_operations_lot4` (version 20261106073709) **purement
additive**, essayée d'abord dans une transaction annulée : table
`progbat_ecritures` (vide, `profero_collaborateurs_seulement`, accessible au
seul serveur), colonnes vides sur `chantiers` (chantier ProGBat) et
`profero_projets` (chantier ProGBat, statut du devis, facture d'acompte), index
unique sur `clients.progbat_client_id` (0 fiche reliée : aucun conflit), tâche
planifiée `progbat-devis-statut`. Aucune donnée existante réécrite. Comptes
avant / après : 46 chantiers, 88 chiffrages, 0 client. Seule écriture de
données depuis : le statut des 27 devis existants, lu dans ProGBat (voir
plus haut). Retour arrière : `sql/202611_refonte_operations_lot4_rollback.sql`.

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
- Lot 3 : **renseigner les chargés d'affaires** (Opérations → fiche de
  l'opération, ou chantier par chantier) : aucun n'est rempli aujourd'hui, et
  sans chargé d'affaires aucune relance ne peut partir.
- Lot 3 : **régler le délai** des relances si 7 jours ne convient pas, puis
  **activer l'interrupteur** (Réglages → Logistique → Relances, compte
  administrateur). Avant d'activer : vérifier la facture d'acompte du
  25/08/2025 signalée non réglée (voir « Données migrées »).
- Lot 3 : la facture d'acompte se crée encore à la main dans ProGBat après la
  signature (automatisation au lot 4).
- Lot 5 : rien d'obligatoire. Si les commerciaux ou le comptable ne doivent
  pas voir les marges agrégées par opération, ou ne doivent pas pouvoir
  « Marquer perdu », le dire : Réglages → Accès, ou rôle chargé d'affaires
  (lot 6).
- Lot 6 : **attribuer le rôle « Chargé d'affaires »** aux personnes qui
  portent les affaires (Réglages → Utilisateurs → modifier → Rôle). Aucun
  compte ne l'a aujourd'hui. Attention : un commercial qui passe chargé
  d'affaires perd les pages qu'il avait en plus (tableau de bord, planning,
  notes, équipe, plans, notes des ouvriers) et gagne le Chiffrage ; ajuster
  si besoin dans Réglages → Accès. Puis, sur chaque opération en cours,
  choisir ce chargé d'affaires (Opérations → fiche de l'opération).
- Lot 6 : dire si le chargé d'affaires doit voir le tableau de bord, le
  planning ou les plans (non par défaut), et s'il doit ne pas voir les
  totaux de vente et de marge de la page Opérations (visibles aujourd'hui,
  comme pour le commercial).

- Lot 4 : **ajouter des droits à l'application ProGBat** dont le jeton est
  `PROGBAT_PRIVATE_ACCESS_TOKEN` (celui des devis), sur le « Portail
  développeur ProGBat » : `thirds` (ou `thirds.write`) pour créer un client,
  `business` (lecture + écriture des chantiers) pour créer un chantier et lire
  son yard, `bills` (ou `bills.write`) pour créer la facture d'acompte. Sans ces
  droits, le bouton concerné affiche « Droit ProGBat manquant : … » et rien
  n'est créé. Facultatif : `staff.read` pour lire la liste des utilisateurs
  ProGBat (correspondance des chargés d'affaires). Si le jeton change, mettre
  le nouveau dans le secret Supabase du même nom.
- Lot 4 : **Réglages → Outils → « Chargés d'affaires : responsable dans
  ProGBat »** : indiquer le numéro ProGBat de chaque chargé d'affaires (les
  numéros utilisés aujourd'hui sont 2, 15 et 21 ; leur nom n'est pas lisible
  par l'application).
- Lot 4 : **3 devis sont introuvables dans ProGBat** (supprimés ?) alors que
  leur chiffrage les mentionne encore : l'écran le signale ; dans l'aperçu du
  devis, « Ce brouillon a été supprimé dans ProGBat ? » libère le chiffrage.
- Lot 4 : choisir vos clients avec « Client ProGBat existant » plutôt que
  « + Nouveau client » (les 113 clients sont déjà dans ProGBat), puis
  compléter les fiches (prénom, e-mail, téléphone) quand l'écran le demande.

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

### Lot 3

1. **Fiche d'un chantier existant avec phasage** (ex. un chantier en cours) :
   la frise montre 5 phases. Les étapes validées avant (devis signé, levée des
   réserves…) sont toujours validées, avec la mention « reprise de l'ancienne
   étape » quand le nom a changé. En bas, « Documents des anciennes étapes »
   liste les documents de « Réponse client ».
2. **Chantier à l'étude sans phasage** (créé au lot 2) : la frise s'affiche.
   Étude → « Visite avant chiffrage » → « Créer l'événement Google Agenda » :
   Google Agenda s'ouvre avec le nom du chantier et l'adresse ; « Valider ».
3. **Devis envoyé** : « Importer le document » → l'étape est validée à la date
   du jour ; « Relance devis » affiche « Première relance prévue le … ».
   « Ouvrir dans ProGBat » ouvre le devis si le chiffrage a créé un devis,
   sinon la raison est écrite.
4. **Devis signé** : le bouton d'import est grisé tant que la date de
   signature n'est pas saisie ; après import, le chantier passe « Planifié »,
   « Relance devis » dit « Relances arrêtées », et le message sur la facture
   d'acompte (lot 4) s'affiche.
5. **Autorisation reçue** : la cocher sur un chantier d'une opération à
   plusieurs logements → sur un autre chantier, « Validée via le chantier X le
   … ». « Dé-partager pour ce chantier » → redevient à faire ; « Re-partager »
   → revient.
6. **Phasage créé** : sur un chantier dont le phasage n'a que des heures,
   l'étape dit « aucun matériau prévu » ; sur un phasage avec matériaux, elle
   est validée.
7. **Réception + PV** : import grisé sans date de réception ; « Pré-réception
   interne » se valide quand tous les groupes ont leur contrôle.
8. **Opérations → une opération** : bloc « Cycle de vie des chantiers »
   (« x/y devis signés »…), une ligne par chantier ; un chantier perdu n'est
   pas compté.
9. **Réglages → Logistique → Relances** (administrateur) : « Relances
   désactivées » ; régler 10 jours et enregistrer, recharger : 10 jours. Ne pas
   activer avant d'avoir renseigné les chargés d'affaires.
10. **Espace ouvrier** : un plan importé dans « Plans techniques » apparaît
    dans « Documents » du chantier.
11. Relances (après activation par Loris) : le lendemain matin, le chargé
    d'affaires d'un devis envoyé il y a plus de 7 jours reçoit un e-mail avec
    le lien ProGBat ; l'étape affiche « 1 relance envoyée, dernière le … ».

### Lot 4

À faire dans l'ordre, sur une opération de test. **Les étapes 4 à 7 écrivent
dans ProGBat** (la vraie comptabilité) : les faire avec un client et un
chantier de test que vous supprimerez ensuite dans ProGBat, ou sur un vrai
dossier.

1. **Client ProGBat existant** (Opérations → une opération → « Client ProGBat
   existant ») : la liste des clients ProGBat s'affiche (113 clients et les
   prospects) ; taper un nom ou une ville filtre la liste. « Choisir » →
   confirmation → la fiche apparaît comme client de l'opération ; ce qui manque
   (prénom, e-mail, téléphone…) est listé. Rechoisir le même client ProGBat
   sur un autre chantier → message « fiche réutilisée » (pas de doublon).
2. **+ Nouveau client** : taper le nom d'un client existant dans ProGBat → le
   bloc orange « Ce client existe peut-être déjà dans ProGBat » le propose ;
   « Enregistrer » est refusé tant que « aucun ne correspond » n'est pas coché.
3. **Chiffrage → Aperçu ProGBat** d'un chantier dont le client vient de
   ProGBat : « 1. Client ProGBat » est déjà « fait » (aucune création) ; le
   bouton du devis est grisé avec « À faire avant de créer le devis : le
   chantier ProGBat ».
4. **Créer le chantier dans ProGBat** : l'aperçu montre code, nom, adresse,
   client, (responsable) ; « Confirmer » → « Chantier créé dans ProGBat (n° …) »
   avec « Ouvrir dans ProGBat » ; si ProGBat répond 403 → « Droit ProGBat
   manquant : business.write », et la case « créer le devis comme avant »
   apparaît.
5. **Devis** : le bouton s'active ; le devis créé apparaît dans ProGBat
   rattaché au client et au chantier (plus de « Chantier : Aucun »).
6. **Nouveau client inconnu de ProGBat** (autre chantier) : « Chercher dans
   ProGBat » → aucune correspondance → « Créer le client dans ProGBat » →
   aperçu → confirmer. Recliquer : « Déjà relié à ProGBat ».
7. **Facture d'acompte** : fiche chantier → Contrat → avant « Devis signé »
   validé, le texte dit que le bouton viendra ; valider « Devis signé » →
   « Créer la facture d'acompte en brouillon (50 %) » → aperçu → confirmer →
   facture « $… » en brouillon, « Ouvrir dans ProGBat ». Recliquer : bloqué
   (« existe déjà »).
8. **Statut du devis** : accepter un devis dans ProGBat ; au plus une heure
   après (de 7 h à 20 h, heure d'hiver), « Devis signé » affiche « Devis
   accepté dans ProGBat : importer le devis signé ». Un devis refusé fait
   proposer « Marquer perdu ».
9. **Réglages → Outils → Chargés d'affaires : responsable dans ProGBat** :
   saisir « 2 » pour un collaborateur, enregistrer, recharger : conservé ; un
   texte non numérique est refusé.
10. **Coupure** : si un message « état incertain » apparaît, vérifier dans
    ProGBat ; « J'ai vérifié dans ProGBat : rien n'a été créé » rouvre la
    création.
### Lot 5

1. **Menu** (compte administrateur, sur ordinateur puis sur téléphone) :
   « Chantiers » n'apparaît plus ; « Opérations » est sous le tableau de bord.
2. **Opérations** : cinq onglets avec leur nombre (À l'étude, En cours,
   Terminées, Perdues, Sans chantier) ; la somme des nombres = le nombre
   d'opérations en haut de page. Ouvrir « Sans chantier » : une opération
   sans logement y figure (ou « Aucune opération sans chantier. »).
3. **Fiche d'une opération en cours** : bloc « Chantiers et cycle de vie »
   avec un chantier par ligne (statut + mini-frise) ; les onglets Synthèse,
   Chemin de fer, Planifier fonctionnent comme avant.
4. **Clic sur un chantier** : la fiche chantier habituelle s'ouvre, avec
   « Opérations › nom de l'opération › chantier » en haut. Cliquer sur le nom
   de l'opération → retour à la fiche de l'opération ; « Retour à
   l'opération » → idem ; « Opérations » → la liste, sur le dernier onglet
   choisi.
5. **Alertes** → cliquer une alerte : la fiche du chantier s'ouvre. **Notes
   des ouvriers** → cliquer le nom d'un chantier : idem.
6. **Journal des MAJ** → une entrée qui cite « Chantiers » : le lien mène à
   Opérations.
7. **Compte commercial ou comptable** : Opérations est dans le menu, la fiche
   d'un chantier s'ouvre depuis l'opération ; Chantiers n'est plus dans le
   menu.
8. **Compte ouvrier** (téléphone) : l'espace ouvrier est identique ; l'onglet
   des chantiers s'ouvre directement.

### Lot 6

1. **Administrateur → Réglages → Utilisateurs** : modifier un compte de test,
   la liste des rôles propose « Chargé d'affaires » ; l'enregistrer.
   **Réglages → Accès** : une ligne « Chargé d'affaires » avec Opérations,
   Fiche chantier, Chiffrage et Journal des MAJ cochés, rien d'autre.
2. **Se connecter avec ce compte** : le menu montre Opérations, Chiffrage et
   Journal des MAJ (la fiche chantier s'ouvre depuis une opération). Pas de
   tableau de bord, États financiers, Bilan, Encours, Factures, Heures,
   Réglages. À la connexion, la page d'arrivée est Opérations.
3. **Chiffrage → Nouveau projet** : créer une opération, un chantier, un
   client ; le chiffrage s'ouvre. Le bouton « Créer le devis dans ProGBat »
   suit les mêmes règles qu'avant (ne pas cliquer sur un vrai dossier pour
   tester).
4. **Fiche d'un chantier → Cycle de vie** : phase Étude, cocher « Visite
   avant chiffrage » puis la décocher : enregistré. Phase Contrat : importer
   un devis signé de test avec une date, puis le dé-valider : enregistré.
5. Cliquer **Préparation**, **Travaux**, **Réception** : les étapes
   s'affichent sans boutons, avec « Lecture seule : … ». Aucun bouton
   « Déclarer comme phase en cours ».
6. **Opérations → fiche d'une opération** : la liste des chargés d'affaires
   propose ce compte (en compte administrateur : tous les collaborateurs
   actifs hors ouvriers, chargé d'affaires compris).
7. **Compte conducteur / administrateur** : la frise se valide sur toutes les
   phases comme avant.
8. Remettre le compte de test à son rôle d'origine.
