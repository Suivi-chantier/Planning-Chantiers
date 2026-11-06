# Projet : Refonte Opérations › Chantiers, cycle de vie et automatisation ProGBat

Règles complètes : `CLAUDE.md`, section « Projets longs : travail en autonomie ».
Livrable final : `docs/project/REFONTE-OPERATIONS-COMPTE-RENDU.md`.

> Sections de Loris recopiées depuis son cahier des charges du 06/11/2026
> (« Rédigé le 06/11/2026 à partir des décisions de Loris »). Projet lancé en
> autonomie complète le 06/11/2026 : Loris ne valide rien en cours de route et
> teste l'ensemble une fois en ligne.

---

<!-- Sections de Loris : Claude ne les modifie jamais. -->

## Objectif métier

Opérations et chantiers vivent aujourd'hui dans `planning_config`, un seul bloc
réécrit en entier à chaque modification (par exemple la mise à jour du statut
dans `PageChantiers.jsx`). Avec un chargé d'affaires qui crée des opérations
pendant que le conducteur modifie un chantier, l'un écrase le travail de
l'autre. Le projet installe opérations et chantiers dans de vraies tables,
ajoute les statuts « À l'étude » et « Perdu », impose le parcours
opération → chantier → client → chiffrage, remplace le cycle de vie du chantier
(5 phases), automatise la création du client, du chantier ProGBat et de la
facture d'acompte, fait d'Opérations la porte d'entrée et crée le rôle
« chargé d'affaires ».

### Vocabulaire

| Terme | Sens |
|---|---|
| **Opération** | Un projet, souvent un immeuble, qui regroupe un ou plusieurs chantiers. Elle n'existe que dans l'application et n'a **pas** d'équivalent dans ProGBat. |
| **Chantier** | Un logement, avec **un devis par chantier**. 1 chantier de l'application = 1 chantier ProGBat. |
| **Chantier ProGBat** | L'écran « Chantier » de ProGBat (adresse `/business/{id}`). Dans l'API, c'est une « affaire » (`business`) qui porte un `yard` technique. |
| **Chargé d'affaires** | Il crée l'opération, les chantiers et le client, fait le chiffrage et suit le devis jusqu'à la signature. |

## Règles et invariants

**Mode de travail.** Loris ne validera rien en cours de route. Il testera tout
une fois l'ensemble terminé et en ligne. Aller **jusqu'au bout des 6 lots sans
s'arrêter pour poser de question ni attendre de validation.**

- **Ordre des lots** : du lot 1 au lot 6. Une demande de fusion par lot. Fusion
  dès que les vérifications GitHub sont vertes, puis lot suivant.
- **Point ambigu ou non documenté** : décision la plus prudente et réversible,
  notée dans le journal de décisions, et on continue. On ne bloque jamais
  l'ensemble pour un point de détail.
- **Action qui ne peut pas aboutir** (droit ProGBat manquant, valeur d'API
  inconnue) : on livre tout le reste. La fonction concernée affiche clairement
  à l'écran pourquoi elle ne fonctionne pas encore, et c'est inscrit dans « À
  faire par Loris ».
- **Respecter `CLAUDE.md`** : policy `profero_collaborateurs_seulement` sur
  toute nouvelle table ; modules de calcul purs en `.mjs` ; scripts
  `verif-*.mjs` branchés dans les workflows ; entrée dans `journalMaj.js` ;
  nouvelles pages déclarées dans `src/access.js` ; aucun exemple fictif
  présenté comme réel.
- **Une impossibilité doit rester visible.** Une information manquante
  s'affiche (par exemple « relance impossible : aucun chargé d'affaires »).
  Jamais une absence silencieuse d'action.

### Garde-fous, puisque personne ne relit avant la mise en ligne

1. **Données existantes** : avant toute migration, copie de sauvegarde des
   données touchées (tables ou colonnes `_sauvegarde_refonte`) et script de
   retour arrière. **Aucune suppression de donnée existante** : ce qui devient
   inutile est conservé et simplement plus affiché.
2. **ProGBat est la vraie comptabilité de l'entreprise** : pendant le
   développement, ProGBat n'est appelé **qu'en lecture**. Jamais de client,
   chantier, devis ou facture de test. Les écritures vers ProGBat ne partent
   que d'une action d'un utilisateur dans l'application (bouton), avec la même
   confirmation et la même protection anti-doublon que la création de devis
   actuelle (`progbat_quote_exports`).
3. **E-mails** : relances automatiques livrées **désactivées par défaut**, avec
   un interrupteur dans les Réglages. Loris les activera après ses tests.
4. **Chaque lot laisse l'application utilisable.** Aucun lot ne casse une page
   existante en attendant le suivant.

### Livrable final : `docs/project/REFONTE-OPERATIONS-COMPTE-RENDU.md`

Document en langage métier, mis à jour à la fin de chaque lot :
- **Ce qui a changé**, lot par lot : ce que voit chaque rôle, qui reçoit quels
  e-mails.
- **Journal de décisions** : chaque choix fait sans validation, avec la raison
  et comment revenir en arrière.
- **Données migrées** : combien d'opérations et de chantiers, ce que sont
  devenues les étapes déjà cochées de l'ancien cycle, les opérations créées
  automatiquement (liste).
- **À faire par Loris** : droits ProGBat à activer, réglages à remplir
  (chargés d'affaires, délai de relance, interrupteur des relances), tout ce
  qui attend une action de sa part.
- **Plan de test** : la liste des parcours à tester, dans l'ordre, avec le
  résultat attendu.

## Hors périmètre

(Rien d'indiqué dans la demande.)

## Description des étapes

### Lot 1 : Opérations et chantiers dans de vraies tables, règle « chantier actif »

1. Créer de vraies tables Supabase pour les opérations et les chantiers, avec
   un lien chantier → opération **obligatoire**.
2. Migrer l'existant sans perte. Un chantier sans opération reçoit une
   opération créée automatiquement avec un seul logement. Lister ces cas dans
   le compte rendu.
3. Créer **un module unique** `estChantierActif()` (module pur `.mjs` + script
   de vérification). **Toutes** les pages qui listent des chantiers doivent
   passer par lui : planning, Bilan semaine, tableau de bord, commandes, espace
   ouvrier, capacité des équipes, états financiers, etc. Aucun filtre recopié
   page par page.
4. Dresser la liste complète des pages concernées dans le compte rendu.

### Lot 2 : Statuts « À l'étude » et « Perdu », opération et client obligatoires avant le chiffrage

**Statuts du chantier.** On ajoute **À l'étude** et **Perdu** aux statuts
existants (Planifié, En cours, En pause, Terminé).
- Un chantier À l'étude ou Perdu **n'apparaît nulle part ailleurs que dans
  Opérations** (via `estChantierActif()`).
- **Bascule automatique** : quand l'étape « Devis signé » est validée, le
  chantier passe de À l'étude à **Planifié**. Chantier par chantier.
- **Bouton « Marquer perdu »**, en dehors du cycle de vie, sur un chantier À
  l'étude. Motif obligatoire (liste + texte libre). Ce bouton arrête toutes
  les relances.

**Statut de l'opération**, calculé à partir de ses chantiers, jamais saisi :

| Chantiers de l'opération | Statut de l'opération |
|---|---|
| Tous À l'étude | À l'étude |
| Au moins un actif | En cours |
| Tous Perdus | Perdue |
| Tous Terminés | Terminée |

**Parcours de chiffrage imposé.** Choisir ou créer l'opération → créer le
chantier (il naît À l'étude) → choisir ou créer le client → chiffrer.
**Impossible de chiffrer sans opération.**

**Client**
- Il se saisit sur l'**opération** et sert par défaut à tous ses chantiers. On
  peut le changer sur un chantier.
- **Champ « Chargé d'affaires »** sur le chantier, avec l'opération en valeur
  par défaut. Choisi parmi les collaborateurs.

**Champs obligatoires dès la saisie.** Tout ce que ProGBat exige est
obligatoire **au moment de la saisie** : astérisque, enregistrement refusé
sinon. **Une seule liste de règles**, utilisée par le formulaire et par le
contrôle d'avant-envoi existant (`construireEnTeteDevis` dans
`progbatQuotePayload.mjs`).

| Fiche | Champ | Règle |
|---|---|---|
| Client | Type : particulier ou société | Obligatoire |
| Client | Nom + prénom (particulier) ou raison sociale + nom du contact (société) | Obligatoire |
| Client | Adresse, code postal, ville, pays (France par défaut) | Obligatoire |
| Client | E-mail, téléphone | Obligatoire. ProGBat ne les exige pas, c'est une règle Profero |
| Client | Identifiant ProGBat (`code`) | **Généré automatiquement** sur le modèle « NOM VILLE » déjà utilisé (ex. « CORRAL ST BARTHELEMY D ANJOU ») |
| Chantier | Adresse, code postal, ville | Obligatoire. Code postal et ville, aujourd'hui simples avertissements, **deviennent bloquants** |
| Chantier | Référence du logement (ex. T2 - R+2) | Obligatoire (déjà le cas) |
| Chantier | Chargé d'affaires | Obligatoire |
| Chantier | Nom et code du chantier ProGBat | **Générés automatiquement** |
| Devis | Objet, date de validité, TVA, lignes complètes | Déjà bloquants, inchangés |

À l'écran : tant qu'une information manque, le bouton « Créer le devis dans
ProGBat » est grisé et affiche la liste de ce qui manque.

### Lot 3 : Nouveau cycle de vie du chantier

Le cycle de vie **reste au niveau du chantier**. Les 6 phases actuelles de
`src/Renovation/cycleVie.mjs` sont remplacées par les 5 phases ci-dessous. Les
phases Garanties/SAV et toute notion de Clôture disparaissent, de même que les
étapes Métrés, Réponse client, Rétractation, Commandes & approvisionnements,
Équipes affectées, Installation de chantier, Nettoyage et DOE.

**Reprise de l'existant** : les étapes déjà validées (`meta.cycle_vie_etapes`)
sont reportées sur leur équivalent dans le nouveau cycle quand il existe. Les
autres sont conservées en base sans être affichées. Détail dans le compte rendu.

**1. Étude**
| Étape | Validation |
|---|---|
| Visite avant chiffrage + Imapper | Case « Fait » + bouton **« Créer l'événement Google Agenda »**, même mécanisme que le bouton du Planning hebdo (`Planning.jsx`, lien pré-rempli avec le nom du chantier et l'adresse) |
| Chiffrage réalisé | Automatique (signal existant `chiffrage_existant`) |
| Devis envoyé | Import du devis. La date d'import sert de date d'envoi. + bouton « Ouvrir dans ProGBat » vers le devis |
| Relance devis | Automatique, voir « Relances ». L'étape affiche le nombre de relances envoyées et la date de la dernière |

**2. Contrat**
| Étape | Validation |
|---|---|
| Devis signé | Import du devis signé + date de signature. Déclenche la bascule en Planifié, l'arrêt des relances devis et la création de la facture d'acompte (lot 4). + bouton ProGBat vers le devis |
| Acompte encaissé | Automatique (facturation, comme aujourd'hui) + bouton ProGBat vers la facture d'acompte |
| Relance acompte | Automatique, voir « Relances » |
| Autorisation reçue (DP ou autre) | Case à cocher. **Étape partagée** : validée sur un chantier, elle s'affiche « validée via le chantier X le … » sur les autres chantiers de la même opération, **sans recopier la donnée**. On peut la dé-partager sur un chantier |

**3. Préparation**
| Étape | Validation |
|---|---|
| Visite conducteur + chargé d'affaires | Case « Fait » + bouton Google Agenda |
| Plans techniques | Import du document |
| Phasage créé | Automatique, **uniquement si le phasage contient les matériaux prévus** (pas seulement des heures). La raison affichée dit ce qui manque |
| Planning prévisionnel | Import du PDF |
| Visite conducteur + chef de chantier | Case « Fait » + bouton Google Agenda |
| Finalisation de la préparation | Case à cocher |

**4. Travaux** — Inchangé : une étape par groupe d'exécution, validée par son
contrôle de fin de groupe.

**5. Réception**
| Étape | Validation |
|---|---|
| Pré-réception interne | Automatique quand tous les groupes sont contrôlés |
| Réception + PV | Import du PV + date de réception |
| Levée des réserves | Case à cocher. Automatique si les réserves sont saisies dans l'application : à vérifier |
| Facture de solde | Automatique (facturation) + bouton ProGBat vers la facture |

**Relances par e-mail**
- **Devis non signé** : e-mail au chargé d'affaires du chantier 7 jours après
  l'envoi du devis, puis **chaque semaine** jusqu'à la signature.
- **Facture d'acompte (50 %) émise mais non réglée** : e-mail au chargé
  d'affaires 7 jours après l'émission, puis **chaque semaine** jusqu'à
  l'encaissement.
- Délai réglable dans les Réglages (7 jours par défaut).
- Chaque e-mail contient le lien « Ouvrir dans ProGBat » vers le devis ou la
  facture.
- Envoi d'e-mail et dispatcher existants (`api/send-email.js`,
  `api/cron-dispatcher.js`). Pas de nouveau service.
- **Aucune relance** pour un chantier Perdu.
- Sans chargé d'affaires, l'étape affiche « relance impossible : aucun chargé
  d'affaires ».

**Page Opération** : **synthèse en lecture seule** du cycle de vie de ses
chantiers (ex. « 3/5 devis signés », « 2/5 réceptionnés »). L'opération n'a pas
de cycle de vie à elle.

### Lot 4 : Automatisation ProGBat

**Process actuel** : 1. le chargé d'affaires chiffre dans l'application, qui
crée un devis brouillon dans ProGBat ; 2. il exporte le PDF et l'envoie depuis
ProGBat ; 3. l'assistante crée le chantier ProGBat, y rattache le devis, puis
crée et émet la facture d'acompte ; 4. l'application voit le règlement grâce à
la synchronisation des factures.

**Process cible** : au moment de créer le devis, l'application enchaîne
1. **Le client ProGBat** :
   - **Recherche d'abord** parmi les clients ProGBat existants (113 au 06/11),
     par nom, e-mail et adresse. Correspondances proposées ; création
     uniquement **après un choix explicite**. **Jamais de rapprochement
     automatique par ressemblance**.
   - Sinon, création **directement en client**, pas en prospect :
     `POST /company/thirds`. Le type « client » vaut probablement 2 (écran
     Clients `/thirds/type-2`) : **à confirmer**.
   - `thirdId` enregistré dans la colonne déjà prévue `progbat_client_id`.
2. **Le chantier ProGBat** : `POST /company/business`, avec `thirdId`, le code
   et le libellé générés, l'adresse du chantier et `managerId` (le chargé
   d'affaires). Enregistrer `progbat_business_id` et `progbat_yard_id` (colonnes
   déjà réservées). **À vérifier** : `yardLabel` crée-t-il le yard en même
   temps ? Le yard créé alimente aussi `chantier_progbat_yards`.
3. **Le devis**, avec `thirdId`, `businessId` et `yardId`. Plus de devis
   « Chantier : Aucun » comme D-260264 aujourd'hui.

**À la signature** (étape « Devis signé » validée) : créer la **facture
d'acompte en brouillon** avec `POST /company/quotes/{quoteId}/advance-bill` et
`advanceRate = 50`. L'assistante n'a plus qu'à la valider dans ProGBat, via le
bouton.

**Lecture du statut du devis ProGBat** (0 étude/brouillon, 1 accepté,
2 refusé, 6 en attente) :
- devis **accepté** et étape « Devis signé » non validée → « devis accepté dans
  ProGBat : importer le devis signé » ;
- devis **refusé** → proposer « Marquer perdu ».
Pas de webhooks : lecture par tâche planifiée (crons existants).

**Ce que l'API NE permet PAS : bouton « Ouvrir dans ProGBat »** — exporter le
PDF du devis et l'envoyer ; passer le devis en « accepté » ; valider ou émettre
une facture ; envoyer une facture par e-mail.

Adresses relevées le 06/11/2026 (l'identifiant est **celui de l'API**, pas le
numéro affiché ; ex. D-260264 = `quotes/524`) :

| Cible | Adresse |
|---|---|
| Devis | `https://app.progbat.com/v5#/v5/quotes/{quoteId}` |
| Facture | `https://app.progbat.com/v5#/v5/bills/{billId}` |
| Liste des factures avec une ligne surlignée | `https://app.progbat.com/v5#/v5/bills?highlight={billId}` |
| Liste des factures (repli si la facture n'est pas encore connue) | `https://app.progbat.com/v5#/v5/bills` |
| Chantier ProGBat (depuis la **fiche chantier**) | `https://app.progbat.com/v5#/v5/business/{businessId}` |
| Liste des clients | `https://app.progbat.com/v5#/v5/thirds/type-2` |

Ces adresses dans un **module unique**. Point d'attention : ProGBat gère
plusieurs entreprises (sélecteur « PROFERO RENOVATION ») ; le lien ne
fonctionne que si la bonne entreprise est active.

**À vérifier avant de coder ce lot** (en lecture seule, conclusions dans le
compte rendu) : 1. droits de la clé ProGBat (`thirds.write`, `business.write`,
`bills.write` ; sinon « droit ProGBat manquant : … » + « À faire par Loris ») ;
2. valeurs non documentées (`type` d'un client, `status` d'un chantier ProGBat
— « À l'étude », « En cours », « Achevé » —, correspondance `managerId` ↔ nos
chargés d'affaires) ; 3. test en lecture sur `business/2` et `quotes/524` ;
4. pas de doublon en cas de nouvel essai (principe `progbat_quote_exports`,
réservation anti-doublon, confirmation avant écriture).

### Lot 5 : Navigation

- **Opérations** devient la porte d'entrée, avec des onglets **À l'étude · En
  cours · Terminées · Perdues**.
- La fiche Opération affiche : l'en-tête et le client ; la liste des
  chantiers, chacun avec sa mini-frise d'avancement ; la synthèse du cycle de
  vie ; les onglets actuels (indicateurs, chemin de fer, planifier).
- Un clic sur un chantier ouvre la **fiche chantier actuelle** (inchangée),
  avec un fil d'Ariane *Opération › Chantier*.
- **La page Chantiers (liste) est retirée** du menu. Mettre à jour
  `src/access.js` et la configuration en base, et noter qui voit quoi dans le
  compte rendu.
- **L'espace ouvrier garde un accès direct** à « mes chantiers », sans passer
  par l'opération.

### Lot 6 : Rôle « chargé d'affaires »

- Nouveau rôle qui donne accès à Opérations : il crée des opérations, des
  chantiers et des clients, fait le chiffrage, crée les devis et valide les
  étapes des phases Étude et Contrat.
- Accès aux autres pages : Opérations, fiche chantier et chiffrage. Pas d'accès
  aux pages financières globales ni à l'administration. Noter le choix dans le
  journal de décisions.
- Dans le compte rendu, préciser si l'admin le voit (auto-grant) et quels
  autres rôles le voient.

## Validation automatique

Autonomie complète demandée par Loris le 06/11/2026 : les 6 lots sont fusionnés
et mis en ligne dès que les contrôles GitHub sont verts, sans attendre son
accord, avec les garde-fous ci-dessus (sauvegarde `_sauvegarde_refonte` +
script de retour arrière avant toute migration, aucune suppression, ProGBat en
lecture seule pendant le développement, relances désactivées par défaut).

---

<!-- Sections de Claude : mises à jour après chaque tâche et avant tout arrêt. -->

## Tâches

| N° | Tâche | Statut | Validation | Preuve de réussite | Demande de fusion |
|----|-------|--------|------------|--------------------|-------------------|
| 1 | Lot 1 — tables `operations` / `chantiers`, migration sauvegardée, `estChantierActif()` branché partout | en ligne | Auto (contrôles verts + migration vérifiée) | Comptes avant/après identiques, aucune page cassée, verif vert | [#215](https://github.com/Suivi-chantier/Planning-Chantiers/pull/215) (fusionnée) |
| 2 | Lot 2 — statuts À l'étude / Perdu, statut d'opération calculé, parcours de chiffrage, règles de saisie uniques | en ligne | Auto | verif vert ; bouton devis grisé avec la liste du manquant | [#218](https://github.com/Suivi-chantier/Planning-Chantiers/pull/218) (fusionnée) |
| 3 | Lot 3 — cycle de vie 5 phases, reprise des étapes, relances (désactivées), synthèse opération | en ligne | Auto | verif vert ; relances off par défaut | [#221](https://github.com/Suivi-chantier/Planning-Chantiers/pull/221) (fusionnée) |
| 4 | Lot 4 — automatisation ProGBat (client, chantier, acompte, statut devis, liens) | en cours | Auto (aucune écriture ProGBat de test) | Vérifications en lecture notées ; verif vert | — |
| 5 | Lot 5 — navigation Opérations porte d'entrée, liste Chantiers retirée | en ligne | Auto | verif vert ; accès documentés | [#222](https://github.com/Suivi-chantier/Planning-Chantiers/pull/222) (fusionnée) |
| 6 | Lot 6 — rôle chargé d'affaires | en ligne | Auto | verif vert ; accès documentés | [#225](https://github.com/Suivi-chantier/Planning-Chantiers/pull/225) (fusionnée) |

## Journal des décisions

- 06/11/2026 — Fichier projet créé depuis le cahier des charges de Loris.
  Arrêts obligatoires de `CLAUDE.md` (droits d'accès, reprise de données) :
  Loris demande explicitement, dans ce cahier des charges, d'aller jusqu'au
  bout sans s'arrêter, et précise lui-même les changements d'accès (lots 5 et
  6) et la reprise de données (lots 1 et 3) avec leurs garde-fous. Ces
  changements sont donc appliqués sans arrêt, chacun précédé d'une sauvegarde
  `_sauvegarde_refonte` et d'un script de retour arrière, et décrit dans le
  compte rendu.
- 06/11/2026 — Lot 1 livré en #215. Choix retenus : les anciens blocs
  `planning_config.chantiers` / `operations` restent tenus à jour par un
  déclencheur (copie miroir), parce que trois fonctions SECURITY DEFINER de
  l'espace ouvrier, le rapport mobile sans connexion et deux tâches serveur les
  lisent encore : aucune fonction à droits élevés n'est modifiée et aucune
  table n'est ouverte aux visiteurs non connectés. Aucun droit DELETE sur les
  nouvelles tables (archivage par `archive_le`). Conflit avec `main` (page
  Visites retirée, PDF du Bilan) résolu par le pilote. Re-synchronisation
  lancée juste avant la fusion : 46 chantiers / 19 opérations, 0 absent.
  Contrôles GitHub tous verts, prévisualisation Vercel « Ready ». Le site de
  production n'est pas joignable depuis la session.
- 06/11/2026 — Lot 2 livré en #218. Migration purement additive
  `refonte_operations_lot2` (tables `clients`, `chantiers_statut_journal`,
  colonnes client / chargé d'affaires / perte) ; aucune donnée réécrite.
  Choix retenus : statut d'opération calculé dans l'ordre « au moins un actif →
  En cours ; sinon un à l'étude → À l'étude ; sinon un terminé → Terminée ;
  sinon tous perdus → Perdue ; aucun chantier → Sans chantier » ;
  collaborateurs lus dans `utilisateurs` (liste complète visible du seul
  administrateur, l'écran le dit) ; aucune reprise automatique des clients :
  les 88 chiffrages existants se rattachent à la main ; « Perdu » réversible
  avec motif et historique ; dé-valider la signature ne remet pas à l'étude.
  Deux contrôles rouges corrigés par le pilote : copie serveur des règles de
  saisie non resynchronisée, et vérification de l'export d'opération restée
  sur l'ancienne pondération d'avancement (rouge aussi sur `main`, elle compare
  maintenant au module de calcul). La fonction serveur `progbat-quote` n'est
  pas redéployée : elle applique encore les anciennes règles (moins strictes),
  le bouton de l'application applique les nouvelles ; redéploiement prévu
  avec le lot 4, qui la modifie.
- 06/11/2026 — Lot 3 livré en #221. Migration additive
  `refonte_operations_lot3` (tables `chantier_cycle_vie`, `relances_cycle_vie`,
  vides à la création). Reprise des anciennes étapes **à la lecture** : rien
  n'est réécrit, l'ancien état reste dans le phasage. Nouvelle policy de
  lecture « ouvriers : étape plans techniques » sur la nouvelle table : elle
  recrée l'accès que les ouvriers avaient déjà aux plans d'exécution, aucune
  policy existante n'est touchée. Relances : interrupteur éteint par défaut,
  simulation sur la base = 0 relance aujourd'hui (aucun devis envoyé importé ;
  1 acompte non réglé mais aucun chargé d'affaires renseigné). Contrôle rouge
  corrigé par le pilote : la non-régression « hors devis » comparait la liste
  des étapes de l'ancien cycle ; cette liste seule sort de la comparaison,
  81 291 valeurs restent comparées. Sur demande de Loris (« avancer sans
  attendre les vérifs »), le lot 4 commence par les vérifications ProGBat en
  lecture pendant que les contrôles tournent.
- 06/11/2026 — Accord de Loris (« oui ») pour mener le lot 5 en parallèle du
  lot 4, sur une deuxième branche `claude/zealous-lovelace-oraraf-lot5`. Raison :
  le lot 5 (navigation, accès) touche peu les fichiers du lot 4 (ProGBat). Le
  lot 6 reste après le lot 5, dont il dépend.
- 06/11/2026 — Lot 5 livré en #222, contrôles verts. Accès modifiés en base :
  « operations » ajouté aux 5 rôles qui avaient « chantiers » (admin,
  super_admin, conducteur, comptable, commercial), rien retiré ; sauvegarde
  `planning_config_sauvegarde_refonte` (ligne 4), retour arrière
  `sql/202611_refonte_operations_lot5_acces_rollback.sql`. L'identifiant
  « chantiers » reste le droit d'ouvrir la fiche ; seule l'entrée de menu
  disparaît. Point à confirmer par Loris au test : commercial et comptable
  voient désormais les marges agrégées par opération et peuvent marquer un
  chantier perdu. Lot 6 lancé sur la même deuxième branche, repartie de `main`.
- 06/11/2026 — Demande de Loris ajoutée au lot 4 : pouvoir choisir dans
  l'application un client déjà créé dans ProGBat (les clients existent déjà
  dans ProGBat ; en créer dans l'application ferait des doublons). Lecture
  seule de la liste des clients ProGBat, fiche locale liée par
  `progbat_client_id` unique, « + Nouveau client » précédé d'un avertissement
  sur les clients ProGBat ressemblants. Jamais de rapprochement automatique.
- 06/11/2026 — Lot 6 livré en #225, contrôles verts. Rôle `charge_affaires` :
  Opérations, fiche chantier, Chiffrage, Journal des MAJ ; ni finances
  globales ni Réglages ; validation limitée aux étapes Étude et Contrat, à
  l'écran et en base (2 policies RESTRICTIVES additives sur
  `chantier_cycle_vie`, migration `refonte_operations_lot6`). Aucune fonction
  SECURITY DEFINER ni contrainte modifiée (`est_collaborateur_actif()` ne
  regarde pas le rôle). Accès en base : rôle ajouté, autres rôles identiques ;
  sauvegardes `planning_config_sauvegarde_refonte` id 7 et 8. Rôle attribué à
  personne : Loris choisira. Le chargé d'affaires voit, comme le commercial,
  les totaux vendu/marge des opérations : à confirmer par Loris.

## Comptes rendus

### Lot 1 — opérations et chantiers en tables (06/11/2026)

Opérations et chantiers sont enregistrés un par un dans deux tables : modifier
un chantier n'écrase plus les autres. Comptes lus en base : 12 opérations et
46 chantiers avant (7 sans opération) ; 19 opérations et 46 chantiers après,
chantiers identiques un par un. Opérations créées automatiquement : LAMARTINE,
METOIS, GILDAS BAUGE 2, LOU, 14 BOULEVARD DU ROI RENÉ, MAUDUIT, DÉPOT.
Sauvegarde `planning_config_sauvegarde_refonte` (3 lignes), retour arrière
`sql/202611_refonte_operations_lot1_rollback.sql`. Règle unique
`estChantierActif()` branchée sur toutes les pages qui listent des chantiers
(liste dans `docs/project/REFONTE-OPERATIONS-COMPTE-RENDU.md`) ; rien ne change
à l'écran.

### Lot 2 — statuts, parcours de chiffrage, règles de saisie (06/11/2026)

Statuts « À l'étude » et « Perdu » ajoutés, masqués partout sauf Opérations,
Chantiers, Chiffrage et Réglages. « Marquer perdu » avec motif obligatoire,
annulable. Statut d'opération calculé. Client saisi sur l'opération, chargé
d'affaires sur le chantier (défaut : opération). Une seule liste de champs
obligatoires, partagée par les formulaires et le contrôle d'avant-envoi ; le
bouton « Créer le devis dans ProGBat » est grisé avec la liste de ce qui
manque. Base : 46 chantiers (statuts inchangés), 19 opérations, 0 client
après migration (comptes lus en base). 61 chiffrages sans devis devront être
rattachés à une opération et complétés avant de créer leur devis.

### Lot 3 — nouveau cycle de vie, relances (06/11/2026)

Cycle de vie en 5 phases (Étude, Contrat, Préparation, Travaux, Réception),
étapes à boutons Google Agenda et « Ouvrir dans ProGBat », imports de
documents, étape « Autorisation reçue » partagée entre chantiers d'une même
opération, synthèse en lecture seule sur la page Opération. Relances par
e-mail au chargé d'affaires livrées éteintes (Réglages → Logistique →
Relances). Reprise des étapes déjà cochées (comptes lus en base) : Devis signé
8, Acompte encaissé 8, Levée des réserves 9, Plans d'exécution → Plans
techniques 1, Visite de réception → Réception + PV 1 ; Réponse client (8),
Commandes & appros (2), Situation 100 % (2) conservées sans être affichées.
