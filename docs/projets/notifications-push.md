# Projet : Notifications sur téléphone (push PWA)

Cahier rédigé le 06/11/2026 à partir des décisions de Loris.
Règles complètes : `CLAUDE.md`, section « Projets longs : travail en autonomie ».

---

<!-- Sections de Loris : Claude ne les modifie jamais. -->

## Objectif métier

Prévenir les bonnes personnes sur leur téléphone, au bon moment, de ce qui
demande une action, sans qu'elles aient à ouvrir l'application pour le découvrir.

- **Conducteurs** : un point quotidien à 18h30 sur les comptes rendus (reçus et
  manquants), les demandes de matériel et les matériaux à commander, et les
  chantiers qui passent en alerte.
- **Comptable** : les factures à émettre et l'encours fournisseurs.
- **Direction (les admins)** : les événements qui touchent la rentabilité et
  les nouveaux chantiers.

**Les ouvriers ne reçoivent aucune notification.** Ce choix est volontaire :
l'application ne doit pas être intrusive pour eux.

Chaque notification ouvre directement le bon écran. Tout ce qui est envoyé
reste consultable dans une boîte de réception dans l'application, pour que rien
ne se perde si le téléphone était éteint ou les notifications refusées.

## Règles et invariants

1. **Aucune notification push vers le rôle `ouvrier`**, ni aucune demande
   d'autorisation de notification dans l'espace ouvrier. Le mail de rappel du
   rapport (`cron-rappel-rapport`) reste **inchangé**.
2. **On notifie un changement d'état, pas un état qui dure.** « Le chantier X
   vient de passer en critique » part une seule fois. Un chantier qui reste
   critique ne renvoie rien le lendemain. L'état déjà notifié est stocké pour
   pouvoir comparer.
3. **Aucune détection réécrite.** Les alertes viennent de `alertesV1.mjs`, qui
   s'appuie lui-même sur `pointsAttentionV1`. Les factures à émettre viennent de
   la logique d'échéancier existante, et les matériaux à commander de la
   logique du récap commandes. On importe et on appelle ces modules, on ne les
   recopie pas. Si une logique vit dans un composant React, on l'extrait d'abord
   dans un module pur `.mjs` partagé par l'écran et par le serveur.
4. **Plage de silence** : aucun push entre 20h et 7h, ni le samedi ou le
   dimanche. Ce qui tombe pendant cette plage est reporté au prochain créneau
   autorisé. Les horaires sont réglables dans les Réglages.
5. **Regroupement** : une seule notification par sujet et par créneau (« 3
   comptes rendus manquants », pas trois notifications).
6. **Préférences** : chaque utilisateur peut couper chaque type de notification
   dans son profil. Par défaut, tout est activé pour les rôles destinataires.
7. **Onglet « Notifications » dans les Réglages** (admin), qui centralise le
   pilotage :
   - un **interrupteur général**, **livré désactivé**. Loris l'activera après
     ses tests. Le bouton « Envoyer une notification de test » du profil
     fonctionne même quand l'interrupteur est coupé ;
   - **une ligne par type de notification** du catalogue (C1 à D4), avec son
     libellé métier, un interrupteur pour l'activer ou non, et des **cases à
     cocher par rôle** pour choisir qui la reçoit. On reprend le modèle visuel
     du bloc « Destinataires de la notification » qui existe déjà pour la
     facture à émettre ;
   - les rôles proposés sont ceux de `ROLES_DEFAULT_RENOVATION`, **sauf
     `ouvrier`**, qui n'apparaît pas (règle 1) ;
   - les valeurs par défaut sont celles de la colonne « Destinataires » du
     catalogue ci-dessous ;
   - une ligne sans aucun rôle coché affiche « Aucun rôle coché : cette
     notification ne sera envoyée à personne » (même avertissement que
     l'existant) ;
   - la plage de silence (heures et jours) ;
   - pour chaque type, la date du dernier envoi et le nombre de destinataires
     touchés, pour voir d'un coup d'œil que ça tourne ;
   - le nombre d'utilisateurs ayant activé les notifications sur au moins un
     appareil, par rôle.

   Le réglage est stocké en base (`planning_config` ou table dédiée) et relu
   par l'Edge Function `send-push` à chaque envoi : un changement s'applique
   au prochain envoi, sans redéploiement. Les rôles cochés pour le **mail**
   « facture à émettre » restent un réglage séparé, inchangé (règle 8).
8. **Le mail ne disparaît pas.** Les mails existants (récap commandes du
   vendredi, encours fournisseurs, facture à émettre, compte rendu ouvrier)
   continuent de partir comme aujourd'hui. Le push s'ajoute, il ne remplace
   rien dans ce projet.
9. **Une impossibilité doit rester visible.** Dans le profil, afficher
   clairement l'état réel : notifications activées, refusées (avec la
   marche à suivre dans les réglages du téléphone), non prises en charge, ou
   « sur iPhone, installez d'abord l'application sur l'écran d'accueil ».
10. Invariants de `CLAUDE.md` : policy `profero_collaborateurs_seulement` sur
    toute nouvelle table, modules de calcul purs en `.mjs`, scripts `verif-*`,
    entrée dans `journalMaj.js`.

### Catalogue des notifications (décidé par Loris)

La colonne « Destinataires » donne les **valeurs par défaut**. Elles sont
modifiables dans l'onglet Réglages › Notifications (règle 7).

| # | Destinataires | Événement | Push | Boîte in-app |
|---|---|---|---|---|
| C1 | Conducteurs | **Point comptes rendus à 18h30** (jours ouvrés) : comptes rendus reçus aujourd'hui et ouvriers attendus qui n'en ont pas rendu (ceux qui avaient une tâche ce jour-là, même règle que `cron-rappel-rapport`) | Oui, 1 par jour | Oui, avec la liste détaillée |
| C2 | Conducteurs | **Demandes de matériel des ouvriers** en attente (table `besoins`, statut `en_attente`) | Oui, regroupé dans le point de 18h30 ou dans un envoi quotidien | Oui |
| C3 | Conducteurs | **Matériaux à commander** : date butoir atteinte (même calcul que `cron-recap-commandes`) | Oui | Oui |
| C4 | Conducteurs | Un chantier **passe** en alerte **critique** | Oui | Oui |
| C5 | Conducteurs | Un chantier **passe** en alerte **à surveiller** | Oui | Oui |
| F1 | Comptable | **Facture de situation à émettre** : une échéance atteint son déclencheur | Oui | Oui |
| F2 | Comptable | **Encours fournisseurs** du vendredi | Oui, court, renvoie vers la page | Oui |
| D1 | Admins | Marge à terminaison d'un chantier qui **devient** négative | Oui | Oui |
| D2 | Admins (+ conducteurs) | **Nouveau chantier signé** | Oui | Oui |
| D3 | Admins | Synthèse de la semaine | Oui, court, renvoie vers le Bilan semaine | Oui |
| D4 | Admins | Écart du contrôle du journal d'avancement (`cron-journal-avancement` ≠ 0) | Non | Oui |

Non retenus : blocage signalé par un ouvrier (push), ouvrier sans affectation
le lendemain, toute notification aux ouvriers, toute la partie Invest.

## Hors périmètre

- **Toute la partie Invest** (prospects, échéances d'urbanisme, tableau de bord
  du matin) : on n'y touche pas, ni ses crons ni ses mails.
- L'espace ouvrier et le mail de rappel du rapport.
- La suppression ou la modification des mails existants.
- Le changement de la logique de détection des alertes, des factures à émettre
  ou des matériaux à commander (on les réutilise telles quelles).
- Les notifications natives via une application iOS ou Android (on reste en
  PWA).

## Description des étapes

**Étape 1 : la plomberie et le test**
- Clés VAPID : clé publique dans `VITE_VAPID_PUBLIC_KEY`, clé privée dans les
  secrets Supabase. Ajouter à « À faire par Loris » ce qu'il doit saisir lui-même.
- Table `push_subscriptions` : utilisateur, endpoint, clés, appareil, dates de
  création et de dernière utilisation. Plusieurs appareils par personne. Une
  ligne est supprimée quand l'envoi répond 404 ou 410.
- Service worker : rester en mode `generateSW` et ajouter un fichier
  `public/push-sw.js` via `workbox.importScripts`. Il gère `push` (afficher) et
  `notificationclick` (ouvrir ou mettre au premier plan l'app sur l'adresse
  fournie). Attention aux règles de `src/pwa.js` : rien ne doit changer pour les
  previews Vercel ni pour la mise à jour différée.
- Edge Function Supabase `send-push` (et non une fonction Vercel : le plafond
  des 12 fonctions est presque atteint). Elle reçoit les destinataires, le titre,
  le texte et le lien, applique les préférences et la plage de silence, envoie,
  et écrit dans la boîte de réception.
- Profil : bouton « Activer les notifications », déclenché par un clic, jamais
  au chargement. Il est précédé d'une phrase qui explique ce qu'on va recevoir,
  avec une aide d'installation sur l'écran d'accueil pour les iPhone. Ajouter
  aussi le bouton « Envoyer une notification de test ». Ces éléments ne sont
  affichés que pour les rôles bureau.
- **Fin d'étape** : Loris active les notifications sur son téléphone et reçoit
  la notification de test, qui ouvre l'application.

**Étape 2 : boîte de réception et préférences**
- Table `notifications` : destinataire, type, titre, texte, lien, date, lu ou
  non lu.
- Icône cloche avec compteur dans la navigation bureau, liste des
  notifications, « tout marquer comme lu ».
- Préférences par type dans le profil.
- Onglet **Réglages › Notifications** complet (règle 7) : interrupteur
  général, activation et rôles destinataires par type, plage de silence,
  suivi des envois. `send-push` lit ces réglages à chaque envoi.
- **Fin d'étape** : la notification de test apparaît aussi dans la cloche. On
  peut couper un type dans son profil. Dans les Réglages, décocher un rôle sur
  un type fait que ce rôle ne le reçoit plus au prochain envoi, et le rôle
  ouvrier n'est jamais proposé.

**Étape 3 : le point conducteurs de 18h30 (C1 + C2)**
- Nouveau job `?job=point_conducteurs` dans `cron-dispatcher.js`, avec son
  créneau GitHub Actions (attention au changement d'heure : reprendre la
  technique de `cron-rappel-rapport`).
- **Fin d'étape** : un soir de semaine, les conducteurs reçoivent une seule
  notification qui résume les comptes rendus reçus, ceux qui manquent et les
  demandes de matériel en attente.

**Étape 4 : matériaux à commander (C3) et alertes (C4, C5, D1)**
- Pour les alertes, un job serveur recalcule les niveaux avec `alertesV1`,
  compare avec l'état déjà notifié (nouvelle table d'état) et ne notifie que
  les passages à un niveau plus grave. **Premier passage** : enregistrer l'état
  actuel **sans rien envoyer**. Sinon les 25 chantiers déjà en alerte
  partiraient tous d'un coup.
- Même principe pour D1 (marge à terminaison qui passe sous zéro).
- **Fin d'étape** : la simulation sur les vrais chantiers (sans envoi) liste
  qui aurait reçu quoi. Ce tableau est recopié dans le compte rendu.

**Étape 5 : comptable et direction (F1, F2, D2, D3, D4)**
- F1 : la détection « facture à émettre » se fait aujourd'hui **seulement à
  l'ouverture de la fiche chantier** (`PageChantiers.jsx`). Elle passe côté
  serveur (job quotidien) en réutilisant la même logique extraite en `.mjs` et
  le même drapeau anti-doublon, pour qu'un mail et un push ne partent jamais
  deux fois pour la même échéance.
- D2 : déclenché quand l'étape « Devis signé » est validée (voir la refonte
  Opérations › Chantiers). Si cette refonte n'est pas encore en ligne, on
  s'appuie sur le passage du statut à « Planifié » et on le note dans le journal.
- **Fin d'étape** : simulation sur les vraies données, puis Loris active
  l'interrupteur général.

## Validation automatique

Règle par défaut de `CLAUDE.md`. En plus :
- l'interrupteur général reste **désactivé** à la livraison de chaque étape ;
- avant toute activation, une simulation sur les vraies données (aucun envoi)
  liste par personne ce qu'elle aurait reçu sur les 7 derniers jours. Si
  quelqu'un aurait reçu plus de 3 push par jour en moyenne, on s'arrête et on
  demande à Loris.

### Points déjà tranchés, à noter dans le journal

- **Destinataires** : il n'y a pas de conducteur rattaché à chaque chantier
  dans les données actuelles. En v1, une notification va à **tous les
  utilisateurs actifs des rôles cochés** dans Réglages › Notifications. Par
  défaut, « direction » veut dire **les admins**.
  Le ciblage par chantier viendra plus tard, avec le chargé d'affaires ou le
  conducteur rattaché au chantier.
- **iPhone** : le push ne fonctionne que si l'app est installée sur l'écran
  d'accueil (iOS 16.4 minimum). L'écran du profil doit le dire clairement.

---

<!-- Sections de Claude : mises à jour après chaque tâche et avant tout arrêt. -->

## Tâches

| N° | Tâche | Statut | Validation | Preuve de réussite | Demande de fusion |
|----|-------|--------|------------|--------------------|-------------------|
| 1 | Étape 1 — Plomberie : clés VAPID, table `push_subscriptions`, `public/push-sw.js` importé par le service worker, Edge Function `send-push` (envoi de test), Edge Function d'abonnement, profil : « Activer les notifications » + « Envoyer une notification de test » + état réel (activées / refusées / non prises en charge / iPhone à installer), rôles bureau seulement ; script `verif-notifications-push.mjs` | en ligne | Auto (migration additive vérifiée) ; test sur téléphone par Loris (non bloquant pour la suite) | Contrôles verts ; abonnement enregistré en base depuis un navigateur ; test reçu par Loris | [n°217](https://github.com/Suivi-chantier/Planning-Chantiers/pull/217) (fusionnée le 06/11) |
| 2 | Étape 2a — Moteur et boîte côté serveur : table `notifications`, réglages en base (interrupteur général livré **coupé**, types C1–D4 avec rôles par défaut, plage de silence), module pur `notificationsPushV1.mjs` (destinataires par rôle sans ouvrier, préférences, plage de silence, report, regroupement), `send-push` complet + job de rattrapage des envois reportés | en ligne | Auto | Contrôles verts ; la notification de test est écrite dans la boîte ; un envoi en plage de silence est reporté (vérifs) | [n°220](https://github.com/Suivi-chantier/Planning-Chantiers/pull/220) (fusionnée le 06/11) |
| 3 | Étape 2b — Écrans : cloche avec compteur dans la navigation bureau, liste, « tout marquer comme lu », préférences par type dans le profil, onglet Réglages › Notifications complet (suivi des envois, appareils par rôle) + entrée `journalMaj.js` | en ligne | Auto | Décocher un rôle dans les Réglages fait qu'il ne reçoit plus le test suivant ; le rôle ouvrier n'est jamais proposé | [n°226](https://github.com/Suivi-chantier/Planning-Chantiers/pull/226) (fusionnée le 06/11) |
| 4 | Étape 3 — Point conducteurs 18h30 (C1 + C2) : job `?job=point_conducteurs`, créneau GitHub Actions (technique heure été/hiver de `cron-rappel-rapport`), logique « ouvriers attendus » partagée avec le rappel, entrée `journalMaj.js` | en ligne | Auto | Simulation sur les vraies données d'un jour ouvré (sans envoi) : une seule notification par conducteur | [n°232](https://github.com/Suivi-chantier/Planning-Chantiers/pull/232) (fusionnée le 06/11) |
| 5 | Étape 4a — Matériaux à commander (C3) : extraction du calcul de `cron-recap-commandes` en module `.mjs` partagé, envoi quotidien | en ligne (ne partira pas avec les données actuelles, question à Loris) | Auto | Le récap du vendredi reste identique (même liste avant / après sur les vraies données) | [n°223](https://github.com/Suivi-chantier/Planning-Chantiers/pull/223) (fusionnée le 06/11) |
| 6 | Étape 4b — Alertes C4, C5 et marge négative D1 : table d'état notifié, job qui recalcule avec `alertesV1` et ne notifie que les aggravations, premier passage silencieux | en ligne | Auto ; tableau de simulation recopié dans le compte rendu | Simulation sur les vrais chantiers : qui aurait reçu quoi ; premier passage = 0 envoi | [n°231](https://github.com/Suivi-chantier/Planning-Chantiers/pull/231) (fusionnée le 06/11) |
| 7 | Étape 5a — Facture à émettre (F1) côté serveur : extraction de la détection de `PageChantiers.jsx` en `.mjs`, job quotidien, même drapeau anti-doublon que le mail | en ligne | Auto | Aucune échéance n'a deux envois (mail + push) ; la fiche chantier se comporte comme avant | [n°224](https://github.com/Suivi-chantier/Planning-Chantiers/pull/224) (fusionnée le 06/11) |
| 8 | Étape 5b — F2 encours vendredi, D2 nouveau chantier, D3 synthèse semaine, D4 écart du journal (boîte seule) + entrée `journalMaj.js` | en ligne | Auto | Simulation sur les vraies données | [n°234](https://github.com/Suivi-chantier/Planning-Chantiers/pull/234) (fusionnée le 06/11) |
| 10 | C3 rebranchée sur la logique de l'écran « Commandes à passer » (saisie par ouvrage), extraite en module `.mjs` partagé avec l'écran ; mail du vendredi inchangé | en attente de Loris | Auto | Simulation sur les vraies données : la liste correspond à ce qu'affiche « Commandes à passer » | [n°233](https://github.com/Suivi-chantier/Planning-Chantiers/pull/233) (contrôles verts, non fusionnée) |
| 9 | Simulation des 7 derniers jours par personne (aucun envoi), puis activation de l'interrupteur général par Loris | à faire | **Arrêt** : Loris active ; arrêt si quelqu'un dépasse 3 push par jour en moyenne | Tableau par personne recopié dans le compte rendu | — |

## Journal des décisions

**06/11/2026 — Démarrage du projet.** Fichier créé à partir du cahier de
Loris. Découpage en 9 demandes de fusion (tableau ci-dessus). L'étape 2 est
coupée en deux (moteur serveur puis écrans), les étapes 4 et 5 aussi, pour
que chaque demande de fusion tienne dans une session. La simulation finale
est une tâche à part, car c'est elle qui précède l'activation par Loris.

**06/11/2026 — Points déjà tranchés par Loris (recopiés du cahier).**
Destinataires v1 = tous les utilisateurs actifs des rôles cochés dans
Réglages › Notifications ; « direction » = les admins par défaut ; ciblage
par chantier plus tard. iPhone : push seulement si l'app est installée sur
l'écran d'accueil (iOS 16.4 minimum), à dire clairement dans le profil.

**06/11/2026 — Droits d'accès des nouvelles tables : passage obligé par le
serveur.** Les tables `push_subscriptions`, `notifications` et la table
d'état des alertes ne reçoivent **que** la policy
`profero_collaborateurs_seulement`, sans aucune règle d'ouverture
supplémentaire. Le navigateur n'y lit ni n'y écrit directement : tout passe
par des Edge Functions qui vérifient l'utilisateur connecté et ne
touchent qu'à ses propres lignes. Raison : poser une règle « chacun voit ses
propres lignes » serait une modification des droits d'accès, donc un arrêt
obligatoire ; passer par le serveur garde la base fermée par défaut et
permet d'avancer sans attendre.

**06/11/2026 — Envois reportés (plage de silence).** Une notification qui
tombe entre 20h et 7h ou le week-end est écrite tout de suite dans la boîte
de réception, et son push part au premier créneau autorisé grâce à un job de
rattrapage du dispatcher (tâche 2).

**06/11/2026 — Organisation des branches.** Toutes les tâches passent par la
branche `claude/vigilant-bell-fp6fv0`, repartie de `main` après chaque
fusion. Le fichier projet est mis à jour dans la demande de fusion de chaque
tâche.

**06/11/2026 — Tâche 1 : choix techniques.**
- Clés VAPID générées (P-256, base64url). L'enregistrement des secrets par
  l'outil Supabase est suspendu (« Storing keys is paused ») : les trois
  secrets ne sont **pas** enregistrés. Les valeurs sont confiées à Loris hors
  du dépôt (voir « À faire par Loris »). Tant qu'ils manquent, les fonctions
  répondent 503 « Clés de notification non configurées sur le serveur » et le
  profil affiche « Pas encore configurées sur le serveur » (jamais un faux
  « activé »).
- Bibliothèque Web Push : `npm:web-push@3.6.7` dans l'Edge Function. Vérifiée
  après déploiement par un auto-contrôle (GET de `send-push`) qui chiffre un
  message fictif avec des clés jetables, sans rien envoyer.
- Deux Edge Functions, JWT exigé : `push-abonnement` (GET clé publique et état
  de l'appareil, POST enregistrement, DELETE retrait) et `send-push` (POST
  `mode: "test"` seulement ; `mode: "serveur"` répond 501 en attendant la
  tâche 2). Code partagé dans `supabase/functions/_partage/` (décisions pures
  dans `pushRegles.mjs`, testées par `verif-notifications-push.mjs`).
  L'appelant doit être un collaborateur actif (même fonction
  `est_collaborateur_actif()` que la policy restrictive, appelée avec son
  jeton) avec un rôle bureau ; « ouvrier » refusé.
- Table `push_subscriptions` (migration `20261106052100_push_subscriptions`) :
  seule la policy `profero_collaborateurs_seulement`, aucun droit direct pour
  le navigateur (`revoke all … from authenticated`), aucune fonction
  SECURITY DEFINER.
- Il n'existait pas d'écran profil dans l'espace bureau. « Mon profil » est un
  **panneau** (pas une page, donc rien dans `src/access.js`) qui s'ouvre en
  touchant son nom en bas de la barre latérale, ou l'icône téléphone de la
  barre du haut sur mobile. Il contient le bloc « Notifications sur ce
  téléphone ». Il n'est jamais rendu pour le rôle `ouvrier`, ni dans l'espace
  ouvrier.
- Service worker : `public/push-sw.js` importé par `workbox.importScripts`
  (on reste en generateSW, `skipWaiting: false` inchangé). Au toucher d'une
  notification, un onglet déjà ouvert est mis au premier plan **sans être
  rechargé** (un rechargement interromprait une saisie, ce que `src/pwa.js`
  interdit) ; l'adresse lui est transmise par message pour les liens vers un
  écran précis des tâches suivantes. Sans onglet ouvert, une fenêtre s'ouvre
  sur l'adresse.

**06/11/2026 — Loris a saisi les 3 secrets VAPID ; la notification de test
est reçue sur son téléphone** (vérifié en base : 1 appareil enregistré, dernier
envoi réussi). Fin d'étape 1 validée.

**06/11/2026 — Tâche 2 : choix techniques.**
- **Emplacement des réglages** : `planning_config`, clé `notifications_push`
  (même rangement que le réglage « facture à émettre », clé
  `echeancier_facturation`, qui reste séparé et inchangé). Forme :
  `{ actif, types: { C1: { actif, roles } … D4 }, silence: { debut, fin, jours } }`.
  La clé est **absente** à la livraison : `send-push` prend alors les valeurs
  par défaut, interrupteur général **coupé**. Le rôle `ouvrier` est retiré à
  la lecture, même s'il est écrit à la main en base. Rôles par défaut : C1–C5
  conducteur ; F1, F2 comptable ; D1, D3, D4 admin ; D2 admin + conducteur.
  D4 est en boîte seule (pas de push), comme le catalogue.
- **Préférences** : table `notifications_preferences` (une ligne par
  personne, types coupés en jsonb). Une préférence coupée supprime le push
  mais **garde** la notification dans la boîte (statut « desactive »), pour que
  rien ne se perde.
- **Destinataires** : utilisateurs actifs des rôles cochés, avec un compte de
  connexion (rapprochement par e-mail, `utilisateurs.id` ≠ identifiant de
  connexion), jamais ouvrier, **et rattachés à la Rénovation** (un compte
  Invest seul — commerciaux, agent EDL — n'est pas destinataire même si son
  rôle est coché). C'est une précision par rapport au point tranché « tous
  les utilisateurs actifs des rôles cochés » (les rôles proposés sont ceux de
  la Rénovation) : à confirmer par Loris, facile à retirer si besoin.
- **Secret serveur** : la clé service role, déjà présente des deux côtés
  (Vercel `SUPABASE_SERVICE_ROLE_KEY`, Supabase l'injecte dans les Edge
  Functions). `send-push` compare le jeton « Bearer » à cette clé avant toute
  lecture. Aucun nouveau secret.
- **Regroupement** : index unique (personne, type, clé de regroupement) ;
  clé par défaut = type + jour de Paris. Rejouer un envoi ne crée aucun
  doublon, même si deux passages se croisent.
- **Créneau du rattrapage** : `.github/workflows/cron-push-reportes.yml`,
  `?job=push_reportes` du dispatcher, **deux** créneaux les jours ouvrés,
  05h05 et 06h05 UTC : l'un tombe à 7h05 Paris selon la saison, l'autre ne
  trouve rien (en hiver, à 6h05, rien n'est encore dû ; en été, à 8h05, tout
  est parti). Pas de correction à faire au changement d'heure. Le même
  workflow, lancé à la main avec un type (ex. D2), fait une simulation sans
  envoi (`?job=push_simulation&type=D2`).
- **Module pur** `supabase/functions/_partage/notificationsPushV1.mjs`
  (même emplacement que `pushRegles.mjs`), façade front
  `src/notificationsPushV1.js`.
- **État au 06/11/2026** : la migration `notifications_boite` a d'abord été
  relue et vérifiée (rien n'existait), mais l'outil Supabase a demandé une
  confirmation restée sans réponse.

**06/11/2026 — Migration appliquée par la session principale**, version
`20261106063848` (fichier renommé `20261106063848_notifications_boite.sql`
pour correspondre). Vérifié : les deux tables existent et ne portent que la
policy restrictive `profero_collaborateurs_seulement`. `send-push` et
`notifications-boite` ont ensuite été redéployées avec les fichiers complets
du dépôt.

**06/11/2026 — Pas de compte « conducteur » : réponse de Loris.** Constat
en base : aucun utilisateur actif n'a le rôle `conducteur` (4 admins,
2 commerciaux, 1 comptable, 7 ouvriers, 1 agent EDL). Question posée à Loris :
qui reçoit C1–C5 ? Réponse : « c'est moi le conducteur, mais je suis
également admin, il faudrait pouvoir avoir plusieurs rôles ». Décision :
les plusieurs rôles par compte touchent aux droits d'accès (arrêt obligatoire)
et sortent du périmètre — projet séparé à proposer plus tard. Dans ce projet,
les valeurs par défaut de C1–C5 deviennent **conducteur + admin** (modifiables
dans Réglages › Notifications ; chaque admin peut couper un type dans son
profil ; une personne ne reçoit jamais deux fois la même notification).
Accepté par Loris (« ok ça me va »). Mis en œuvre dans la tâche 3.

**06/11/2026 — Tâches en parallèle, à la demande de Loris.** Loris demande de
lancer les lots suivants en parallèle quand c'est sans risque. Les tâches 3
(écrans), 5 (matériaux à commander) et 7 (facture à émettre côté serveur)
ne dépendent que de la tâche 2 et sont menées en même temps, chacune sur sa
branche (`claude/vigilant-bell-fp6fv0-t3`, `-t5`, `-t7`) et sa demande de
fusion, mises en ligne l'une après l'autre quand leurs contrôles sont verts.
Les tâches 4 et 6 attendent la tâche 3 (destinataires admin) ; la tâche 9
attend tout le reste. Le fichier projet n'est modifié que par la session
principale pour éviter les conflits.

**06/11/2026 — Question à Loris (non bloquante) : C3 « matériaux à
commander ».** Le calcul repris tel quel du récap du vendredi lit les
matériaux prévisionnels saisis **par phase**. En base, aucun des 49 phasages
n'en a (4 phases ont une date butoir, mais une liste vide). L'écran
« Commandes à passer » utilise une autre saisie, **par ouvrage**. Avec les
données actuelles, C3 ne partira donc jamais, et la partie « commandes
prévisionnelles » du mail du vendredi est vide elle aussi. Changer la règle
étant hors périmètre, rien n'a été modifié. Question : *garder C3 telle
quelle, ou la rebrancher (plus tard) sur la logique de « Commandes à
passer » ?*
Réponse de Loris (06/11/2026) : « On modifiera cette notif ». Décision : on
ajoute la tâche 10 (C3 branchée sur la logique de « Commandes à passer »),
menée après les tâches 6 et 8, avant la simulation finale. Le mail du
vendredi n'est pas touché (règle 8).

**06/11/2026 — Limite de déploiements Vercel atteinte.** Vers 07h30 UTC,
Vercel refuse tout nouveau déploiement (« Deployment rate limited — retry in
24 hours », offre Hobby). Chaque envoi de branche crée un déploiement : les
lots de la refonte Opérations, les tâches en parallèle et les mises à jour
du fichier projet ont épuisé le quota du jour. Conséquences : la demande de
fusion n°226 (tâche 3) a ses 15 contrôles GitHub verts mais le contrôle
Vercel rouge → **pas de fusion au rouge** (règle CLAUDE.md), reprise
programmée le 07/11 à 08h00 UTC. Il n'est pas certain que la mise en ligne
de la tâche 5 (n°223) soit passée avant la limite : à vérifier à la reprise.
Les Edge Functions de la tâche 3 (`send-push` v4, `notifications-boite` v3,
`notifications-pilotage` v1) sont déjà déployées côté Supabase ; elles
restent compatibles avec l'application en ligne (l'envoi de test continue de
fonctionner). Pour la suite : regrouper les commits et pousser le moins
souvent possible.

**06/11/2026 — Format des liens des notifications** : `/?page=<id>&chantier=<id>`
(retenu en tâche 3) ; l'ancien `/#planning-commandes` de la tâche 5 est
compris par l'écran.

**06/11/2026 — Tâche 7 : regroupement F1 et table d'état.** La première
version envoyait un push par échéance (14 d'un coup à l'activation), contraire
à la règle 5. Révisée : au plus une notification F1 par jour (« N factures à
émettre » + liste), chaque échéance notifiée une seule fois grâce à une table
d'état **générique** `notifications_etat` (type, objet, état), réutilisable
par la tâche 6 pour les niveaux d'alerte. Le mail reste envoyé par la fiche,
inchangé (règle 8) ; le job ne pose pas le drapeau `facture_mail_*`.
Simulation issue de la base : 1 notification « 14 factures à émettre » au
premier passage après activation, 0 au suivant. Migration
`notifications_etat` purement additive, appliquée par la session principale
après accord explicite de Loris (« vas-y pour la table » — la première
tentative avait expiré faute de réponse à la confirmation Supabase) :
version **20261106084227**, seule policy `profero_collaborateurs_seulement`,
aucun droit pour anon / authenticated. Fichier renommé `20261106084227_notifications_etat.sql` dans la PR n°224.
Signalé à Loris, non modifié (hors périmètre) : DÉPOT et BRIOLLAY « à
émettre » avec un prix de vente à 0 € ; course possible sur le mail si deux
personnes ouvrent la même fiche en même temps (antérieure au projet).

**06/11/2026 (soir) — Fin d'étape 2 validée par Loris** : « La cloche
fonctionne ». Vérifié en base : la notification de test de 21h19 UTC est
dans la boîte, statut « envoyé », marquée lue.

**06/11/2026 (soir) — Appareil enregistré au nom de François Huet.** La
seule ligne de `push_subscriptions` (et la notification de test) appartient
au compte `francois.huet@…`, pas à celui de Loris : le téléphone de test est
connecté avec ce compte. Question posée à Loris (non bloquante).

**06/11/2026 (soir) — Tâche 4 : C1 et C2 regroupés en un seul push.**
`send-push` ne savait envoyer qu'un type par appel. Ajout d'un champ
facultatif `groupe` (nouveau fichier `_partage/pushGroupeV1.mjs`, aucun
fichier existant de `_partage/` modifié) : C1 et C2 gardent chacun leurs
rôles, leur interrupteur et la préférence de chacun, et sont écrits en boîte
sous leur propre type ; seul le push est réuni par personne. `send-push` v5
déployée. Une demande de matériel non traitée revient chaque soir (c'est un
rappel quotidien voulu par le catalogue : « regroupé dans le point de
18h30 »). Pas de jours fériés, comme le mail de rappel.

**06/11/2026 (soir) — Tâches 8 et 10 lancées en parallèle** (direction et
comptable F2/D2/D3/D4 ; C3 sur « Commandes à passer »), un seul envoi chacune
pour ménager la limite Vercel.

**06/11/2026 (soir) — Tâche 10 arrêtée : 1 895 commandes au premier
passage.** L'écran « Commandes à passer » n'a pas de date butoir : il liste
tout article lié à un ouvrage et pas encore commandé. Sur la base : 1 895
articles (175 340 € HT, 42 chantiers), dont 641 avec une date de besoin
passée, 468 sans date, 18 sur 3 chantiers terminés. Écran avant / module /
job : identiques. Mais la première notification après activation serait
« 1895 commandes à passer » : chiffre très éloigné de ce que le projet
laissait attendre, donc arrêt obligatoire. Demande de fusion n°233 laissée
ouverte. **Question à Loris** : a) seulement les articles dont la date de
besoin arrive dans les 7 prochains jours, chacun une fois, l'arriéré
enregistré sans envoi (recommandé) ; b) seulement les articles ajoutés à
partir de maintenant ; c) laisser tomber C3 pour l'instant (coupée par
défaut).

**06/11/2026 (soir) — Tâche 8 : choix et constats.** D2 se déclenche sur
l'étape « Devis signé » validée (lue par `cycleVie.etatsCycleVie`, comme la
fiche chantier), premier passage silencieux, état vu enregistré même
interrupteur coupé. Constat signalé à Loris : `chantier_cycle_vie` est vide ;
le 05/11, les devis signés de KATHLEEN T2, FOUGERAY 001/101/102/201 et
FOUGERAY COMMUN ont été joints sur l'ancienne étape « Réponse client », qui
ne compte pas comme signature (ni pour D2, ni pour la bascule « Planifié »).
D3 : `cron-snapshot-hebdo` est arrêté depuis le 24/10 ; les chiffres
viennent des fonctions du Bilan semaine (`bilanPeriodeV3`) sur les relevés
journaliers ; sans relevé, « relevé pas encore disponible », sans chiffre.
Le contrôle `verify-refonte-lot4.yml` échoue sur `main` (hors de ce projet,
il ne fait pas partie des contrôles des demandes de fusion) : signalé.

## À faire par Loris

1. **Saisir `VITE_VAPID_PUBLIC_KEY`** dans Vercel (Settings › Environment
   Variables, Production) avec la même valeur que `VAPID_PUBLIC_KEY` (clé
   publique, sans risque). Facultatif : sans elle, l'application demande la
   clé au serveur (c'est ce qui se passe aujourd'hui, et ça fonctionne).

## Comptes rendus

### Tâche 1 — Plomberie et notification de test (06/11/2026) — en ligne

**Ce qui a changé.** Les collaborateurs du bureau ont un panneau « Mon
profil ». On l'ouvre en touchant son nom en bas de la barre latérale, ou
l'icône téléphone en haut sur mobile. Il contient « Activer les
notifications », « Envoyer une notification de test » et l'état réel de
l'appareil. Les ouvriers ne voient rien de tout cela.

**Vérifié.**
- La demande de fusion n°217 a ses 13 contrôles GitHub verts. Elle a été
  fusionnée.
- Le déploiement est terminé : sur le site en production, la page d'accueil
  et `push-sw.js` répondent 200.
- La migration `20261106052100_push_subscriptions` est purement additive et
  enregistrée en base. La table ne porte que la policy
  `profero_collaborateurs_seulement` et n'est pas accessible directement
  depuis le navigateur.
- Les fonctions `push-abonnement` et `send-push` sont déployées :
  - un appel sans connexion est refusé (401) ;
  - le serveur dit clairement « clés non configurées » (503) ;
  - l'auto-contrôle de chiffrement est bon.

**Non vérifié.** Aucun envoi réel. Les 3 secrets VAPID ne sont pas saisis,
car Supabase a suspendu leur enregistrement automatique. N'ont donc pas été
testés : la réception sur téléphone, l'ouverture de l'application au
toucher, la suppression d'un appareil périmé. Voir « À faire par Loris ».

**Points connus.**
- Si l'application est déjà ouverte, toucher une notification la met au
  premier plan sans changer d'écran. La navigation vers l'écran précis
  viendra avec les vraies notifications.
- Sur ordinateur, quand la barre latérale est repliée, il faut la déplier
  pour atteindre « Mon profil ».
- La migration `ouvrier_mes_phases_pieces_consignes` du dépôt est
  enregistrée en base sous un autre numéro (20261106021209). Elle est bien
  appliquée, rien à faire.

### Tâche 2 — Moteur et boîte côté serveur (06/11/2026) — en ligne

**Ce qui a changé.** Rien de visible pour l'instant : le moteur d'envoi est en
place côté serveur (boîte de réception, préférences, réglages, plage de
silence avec report au matin, regroupement sans doublon, rattrapage à 7h05
les jours ouvrés). L'interrupteur général est **coupé** (aucun réglage en
base = valeurs par défaut).

**Vérifié.** Demande de fusion n°220 : 12 contrôles GitHub verts, fusionnée.
Migration `20261106063848_notifications_boite` purement additive, appliquée
par la session principale (les 2 tables n'existaient pas ; après : seule la
policy `profero_collaborateurs_seulement`, enregistrée dans les
migrations). `send-push` (v3) et `notifications-boite` (v2) déployées depuis
le dépôt : auto-contrôle 200 avec clés configurées ; tous les appels sans
connexion ou avec la clé anonyme refusés (401). Aucune ligne écrite en boîte
pendant les tests.

**Simulation (calcul du module sur les vrais utilisateurs lus en base le
06/11, avant la décision « admins par défaut »).** D2 : 4 admins, 0
conducteur ; C1 : 0 destinataire (aucun conducteur) ; F1 : 1 comptable, sans
appareil enregistré ; D4 : 4 admins, boîte seule. Seul 1 admin a un
appareil enregistré (Loris).

**Non vérifié.** Le test depuis le profil qui s'écrit aussi dans la boîte, la
boîte avec une vraie session, et une simulation via `send-push` en mode
serveur (faite après mise en ligne par le workflow « Notifications
reportées », `simulation_type = D2`).

### Tâche 5 — Matériaux à commander, C3 (06/11/2026) — en ligne

**Ce qui a changé.** Le calcul « matériaux à commander, date butoir atteinte »
est sorti du récap du vendredi dans un module partagé
(`materiauxACommanderV1.mjs`), déplacé sans réécriture ; le mail du vendredi
l'utilise et ne change pas. Nouvel envoi quotidien `?job=push_materiaux` à
8h05 Paris (jours ouvrés) : une seule notification « N matériaux à commander
aujourd'hui », rien si la liste est vide. Interrupteur coupé : rien ne part.

**Vérifié.** Demande de fusion n°223 : 13 contrôles verts, fusionnée.
Tableau avant / après issu de la base (ancien code du récap et nouveau
module, mêmes données) :

| Jour | Ancien calcul | Nouveau module |
|---|---|---|
| 06/11/2026 | liste vide | liste vide |
| 13/11/2026 | liste vide | liste vide |

Identiques — mais vides, car aucun matériau n'est saisi par phase (voir la
question à Loris dans le journal).

**Points connus.** L'application n'ouvre pas encore directement l'écran
« Commandes à passer » depuis le lien (même comportement que le bouton du
mail aujourd'hui).

### Tâche 7 — Facture à émettre côté serveur, F1 (06/11/2026) — en ligne

**Ce qui a changé.** La détection « facture de situation à émettre » est
sortie de la fiche chantier dans un module partagé (`factureAEmettre.mjs`),
déplacée sans réécriture : la fiche envoie le même mail, aux mêmes
destinataires, avec le même drapeau. Nouveau job quotidien
`?job=factures_a_emettre` (8h15 Paris, jours ouvrés) : il n'envoie **que le
push**, au plus une notification F1 par jour (« N factures à émettre » +
liste), et chaque échéance n'est notifiée qu'une fois (table
`notifications_etat`). Il ne touche ni au mail ni au drapeau. Interrupteur
coupé : rien ne part et rien n'est inscrit.

**Vérifié.** Demande de fusion n°224 : 14 contrôles GitHub verts + Vercel
vert, fusionnée le 06/11 au soir (retardée par la limite de déploiements
Vercel). Migration `20261106084227_notifications_etat` purement additive,
appliquée après accord de Loris, seule policy
`profero_collaborateurs_seulement`.

**Simulation issue de la base (06/11, aucun envoi).** 43 échéances prêtes
sur les chantiers non terminés, dont 29 déjà prévenues par mail ;
14 sans mail : BRIOLLAY S1 ; DÉPOT démarrage et S1 ; BRIOLLAY APPT 1 à 5
(démarrage et S1 chacun) ; KATHLEEN T2 S1. Premier passage après activation :
**1 notification « 14 factures à émettre »** pour le comptable ; passage
suivant : 0.

**Points connus.** DÉPOT et BRIOLLAY ont un prix de vente à 0 € et sont
pourtant « à émettre » (comme dans le mail actuel). Une échéance qui devient
prête après la notification du jour part le lendemain.

### Tâche 3 — Écrans : cloche, préférences, Réglages › Notifications (06/11/2026) — en ligne

**Ce qui a changé.** Cloche avec compteur de non lues (bas de la barre
latérale sur ordinateur, barre du haut sur téléphone, jamais pour les
ouvriers) ; « Mon profil » › « Ce que je reçois » (un interrupteur par type) ;
Réglages › Logistique › Notifications (admin) : interrupteur général
(coupé), une ligne par type avec rôles cochés (sans ouvrier), plage de
silence, dernier envoi et personnes touchées, appareils par rôle. C1–C5 vont
par défaut à conducteur + admin ; une personne ne reçoit jamais deux fois la
même notification. Nouvelle fonction `notifications-pilotage` (admin,
lecture seule de comptes).

**Vérifié.** Demande de fusion n°226 : 15 contrôles GitHub + Vercel verts,
fusionnée le 06/11 au soir (retardée par la limite Vercel). Aucune
migration, aucune policy. Loris : « La cloche fonctionne ».

**Point connu.** Comme tous les réglages de `planning_config`, la clé
`notifications_push` peut techniquement être écrite par tout collaborateur du
bureau ; seul l'écran est réservé aux admins.

### Tâche 6 — Alertes chantiers C4, C5, D1 (06/11/2026) — en ligne

**Ce qui a changé.** Le calcul de la page Alertes est sorti du composant dans
`alertesEcranV1.mjs` (même résultat, vérifié au caractère près) ; la marge à
terminaison est lue dans la colonne `marge_terminaison` du relevé journalier,
sans recalcul. Job `?job=alertes_chantiers`, jours ouvrés 9h05 Paris : seules
les aggravations partent (C5 aucun → à surveiller, C4 → critique, D1 marge
≥ 0 → < 0), une notification par type et par passage. État dans
`notifications_etat`. Premier passage : référence enregistrée, rien envoyé.
Interrupteur coupé : l'état vu est quand même enregistré, pour qu'à
l'activation seuls les changements postérieurs partent.

**Vérifié.** Demande de fusion n°231 : 16 contrôles + Vercel verts,
fusionnée. Aucune migration.

**Simulation issue de la base (06/11, aucun envoi).** 45 chantiers :
6 critiques, 3 à surveiller, 36 sans alerte ; marges à terminaison :
8 négatives (dont 6 chantiers terminés), 37 positives, 0 inconnue.

| Niveau | Chantier | Marge à terminaison | Avancement |
|---|---|---|---|
| Critique | BRIOLLAY | −70 140 € | 40 % |
| Critique | TOURBOUTON CO-LIVING | −2 124 € | 87 % |
| Critique | BRIOLLAY APPT 2 | 22 062 € | 48 % |
| Critique | FOURMOND 001 | 6 940 € | 44 % |
| Critique | KATHLEEN T2 | 8 136 € | 43 % |
| Critique | MONTILLERS APPT 1 (T3) | 12 006 € | 15 % |
| À surveiller | FOURMOND 101 | 4 948 € | 67 % |
| À surveiller | FOURMOND 102 | 4 227 € | 65 % |
| À surveiller | FOURMOND COMMUNS | 1 456 € | 30 % |

Premier passage : 0 envoi, 90 états enregistrés. Entre le 30/10 et le
06/11, une seule notification serait partie : C4 « 3 chantiers passent en
critique » (BRIOLLAY APPT 2, KATHLEEN T2, MONTILLERS APPT 1), vers 4 admins
(1 seul appareil enregistré) ; aucune C5 ni D1.

### Tâche 4 — Point du soir des conducteurs, C1 + C2 (06/11/2026) — en ligne

**Ce qui a changé.** Chaque jour ouvré à 18h30 Paris, une seule notification
par personne résume les comptes rendus reçus, les ouvriers attendus qui n'ont
pas rendu le leur, et les demandes de matériel en attente. S'il n'y a rien à
dire, rien ne part ; si des ouvriers étaient attendus et qu'aucun CR n'est
arrivé, la notification part. La règle « ouvriers attendus » est sortie du
mail de rappel (`ouvriersAttendusV1.mjs`) sans réécriture ; le mail est
inchangé.

**Vérifié.** Demande de fusion n°232 : 17 contrôles + Vercel verts,
fusionnée. `send-push` v5 déployée (401 sans jeton, auto-contrôle 200).

**Simulation issue de la base (rien envoyé).**

| Jour | CR reçus | Attendus | Manquants | Demandes | Notification |
|---|---|---|---|---|---|
| Lun 02/11 | 6 | 6 | 0 | 1 | « 6 CR reçus, 0 manquant, 1 demande de matériel » |
| Mar 03/11 | 6 | 6 | 0 | 1 | « 6 CR reçus, 0 manquant, 1 demande de matériel » |
| Mer 04/11 | 7 | 7 | 0 | 1 | « 7 CR reçus, 0 manquant, 1 demande de matériel » |
| Jeu 05/11 | 7 | 7 | 0 | 1 | « 7 CR reçus, 0 manquant, 1 demande de matériel » |
| Ven 06/11 | 0 | 0 | 0 | 1 | « 1 demande de matériel en attente » |

Destinataires par défaut : 4 admins (aucun conducteur), 1 appareil.

### Tâche 8 — Encours, nouveau chantier, synthèse, écart du journal (06/11/2026) — en ligne

**Ce qui a changé.** F2 : push court après le mail de l'encours du vendredi
(calcul sorti du mail dans `encoursFournisseursV1.mjs`, mail identique au
caractère près sur les vraies données). D2 : « Nouveau chantier signé », 8h45
Paris. D3 : synthèse de la semaine le lundi 8h30 (chiffres du Bilan
semaine). D4 : écart du journal d'avancement en boîte seule, sans push.

**Vérifié.** Demande de fusion n°234 : 17 contrôles + Vercel verts,
fusionnée. Aucune migration.

**Simulation issue de la base (rien envoyé).**

| Type | Résultat |
|---|---|
| F2, ven. 06/11 | « Encours fournisseurs : 31 813,81 € HT à payer » |
| D2 | aucun « Devis signé » validé sur 30 jours ; premier passage : 0 envoi, 8 chantiers enregistrés |
| D3, semaine 44 | production 13 665 € · marge +2 446 € (18 %) · 252,6 h |
| D4, 7 derniers jours | 7 contrôles, 0 écart : rien |

Push par personne : admin environ 1 le lundi (+ D2, rare) ; comptable 1 le
vendredi.

