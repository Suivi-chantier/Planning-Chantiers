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
| 1 | Étape 1 — Plomberie : clés VAPID, table `push_subscriptions`, `public/push-sw.js` importé par le service worker, Edge Function `send-push` (envoi de test), Edge Function d'abonnement, profil : « Activer les notifications » + « Envoyer une notification de test » + état réel (activées / refusées / non prises en charge / iPhone à installer), rôles bureau seulement ; script `verif-notifications-push.mjs` | à faire | Auto (migration additive vérifiée) ; test sur téléphone par Loris (non bloquant pour la suite) | Contrôles verts ; abonnement enregistré en base depuis un navigateur ; test reçu par Loris | — |
| 2 | Étape 2a — Moteur et boîte côté serveur : table `notifications`, réglages en base (interrupteur général livré **coupé**, types C1–D4 avec rôles par défaut, plage de silence), module pur `notificationsPushV1.mjs` (destinataires par rôle sans ouvrier, préférences, plage de silence, report, regroupement), `send-push` complet + job de rattrapage des envois reportés | à faire | Auto | Contrôles verts ; la notification de test est écrite dans la boîte ; un envoi en plage de silence est reporté (vérifs) | — |
| 3 | Étape 2b — Écrans : cloche avec compteur dans la navigation bureau, liste, « tout marquer comme lu », préférences par type dans le profil, onglet Réglages › Notifications complet (suivi des envois, appareils par rôle) + entrée `journalMaj.js` | à faire | Auto | Décocher un rôle dans les Réglages fait qu'il ne reçoit plus le test suivant ; le rôle ouvrier n'est jamais proposé | — |
| 4 | Étape 3 — Point conducteurs 18h30 (C1 + C2) : job `?job=point_conducteurs`, créneau GitHub Actions (technique heure été/hiver de `cron-rappel-rapport`), logique « ouvriers attendus » partagée avec le rappel, entrée `journalMaj.js` | à faire | Auto | Simulation sur les vraies données d'un jour ouvré (sans envoi) : une seule notification par conducteur | — |
| 5 | Étape 4a — Matériaux à commander (C3) : extraction du calcul de `cron-recap-commandes` en module `.mjs` partagé, envoi quotidien | à faire | Auto | Le récap du vendredi reste identique (même liste avant / après sur les vraies données) | — |
| 6 | Étape 4b — Alertes C4, C5 et marge négative D1 : table d'état notifié, job qui recalcule avec `alertesV1` et ne notifie que les aggravations, premier passage silencieux | à faire | Auto ; tableau de simulation recopié dans le compte rendu | Simulation sur les vrais chantiers : qui aurait reçu quoi ; premier passage = 0 envoi | — |
| 7 | Étape 5a — Facture à émettre (F1) côté serveur : extraction de la détection de `PageChantiers.jsx` en `.mjs`, job quotidien, même drapeau anti-doublon que le mail | à faire | Auto | Aucune échéance n'a deux envois (mail + push) ; la fiche chantier se comporte comme avant | — |
| 8 | Étape 5b — F2 encours vendredi, D2 nouveau chantier, D3 synthèse semaine, D4 écart du journal (boîte seule) + entrée `journalMaj.js` | à faire | Auto | Simulation sur les vraies données | — |
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

## Comptes rendus
