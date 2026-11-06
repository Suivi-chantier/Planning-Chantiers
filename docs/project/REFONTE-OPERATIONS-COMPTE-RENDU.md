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
| 06/11/2026 | **Lot 5 — L'identifiant de page « chantiers » est gardé** comme droit d'ouvrir la fiche chantier ; seule l'entrée de menu disparaît (liste `PAGES_HORS_MENU` de `navigationOperations.mjs`, lue par le menu latéral et la barre mobile). | Le plus prudent : aucun droit retiré, les liens existants (Alertes, Notes des ouvriers, Opérations) et les réglages d'accès en base continuent de fonctionner sans réécriture. | Retirer « chantiers » de `PAGES_HORS_MENU`. |
| 06/11/2026 | **Lot 5 — « operations » ajouté en base** à tous les rôles qui avaient « chantiers » (admin, super_admin, conducteur, comptable, commercial), **avant la fusion**, sans rien retirer. | Compatible avec l'ancien et le nouveau code ; sans cela, ces rôles n'auraient plus eu de porte d'entrée vers leurs chantiers (la liste en base remplace la liste par défaut, sauf pour l'admin). Admin ajouté aussi pour que la ligne en base se lise seule. | `sql/202611_refonte_operations_lot5_acces_rollback.sql` (sauvegarde id 4). |
| 06/11/2026 | **Lot 5 — La liste Chantiers reste joignable en repli**, seulement si un rôle a « chantiers » sans « operations » (cas qui n'existe plus en base) : « Retour » de la fiche y ramène alors comme avant. Sinon « Retour » ramène à l'opération, et un lien générique vers « chantiers » (Journal des MAJ) mène à Opérations. La page d'arrivée n'est jamais la liste Chantiers. | Ne jamais perdre l'accès à ses chantiers si quelqu'un modifie les accès dans Réglages → Accès. | — |
| 06/11/2026 | **Lot 5 — Onglet « Sans chantier »** toujours affiché (même à 0), à côté des quatre onglets demandés. Onglet par défaut : En cours, sinon le premier non vide ; choix retenu sur l'appareil. | « Une impossibilité doit rester visible » : une opération vide ne doit ni disparaître ni passer pour « terminée ». | — |
| 06/11/2026 | **Lot 5 — La liste des chantiers de la fiche Opération est le bloc « Chantiers et cycle de vie »** du lot 3 (mini-frise `resumeCycleVieChantier`), rendu cliquable, plutôt qu'un nouveau tableau. Le tableau financier des logements (onglet Synthèse) reste cliquable lui aussi. | Un seul calcul de la frise ; la liste est visible quel que soit l'onglet choisi (Synthèse, Chemin de fer, Planifier). | — |

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
