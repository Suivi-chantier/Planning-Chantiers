# Projet : L'application suit mon organisation de la semaine

Cahier rédigé le 24/11/2026 à partir des décisions de Loris.
À copier en `docs/projets/organisation-par-jour.md`. Règles complètes :
`CLAUDE.md`, section « Projets longs : travail en autonomie ».

---

<!-- Sections de Loris : Claude ne les modifie jamais. -->

## Objectif métier

Mon travail suit une organisation hebdomadaire validée en réunion le
24/11/2026 : chaque jour a une thématique (bilan le lundi, préparation des
chantiers le mardi, application et plans le mercredi, tournée le jeudi,
planning de la semaine suivante le vendredi).

L'application doit connaître cette organisation et s'y adapter selon le jour :

- **la barre de navigation** remonte en tête les pages utiles ce jour-là, sur
  ordinateur comme sur téléphone ;
- **l'application s'ouvre** directement sur la page principale du jour ;
- **le tableau de bord** rappelle la thématique et les rendez-vous du jour, et
  affiche en premier les données dont j'ai besoin ce jour-là.

L'organisation se règle par utilisateur. Un autre conducteur de travaux doit
pouvoir avoir la sienne, et quelqu'un qui n'en règle pas garde l'application
exactement comme aujourd'hui.

## Règles et invariants

1. **Rien ne change pour un utilisateur sans organisation.** Ni l'ordre de ses
   onglets, ni sa page d'arrivée, ni son tableau de bord.
2. **Aucun droit d'accès ne change.** On ne fait que réordonner des pages déjà
   autorisées pour le rôle. Une page non autorisée indiquée dans une
   organisation est ignorée sans erreur. On ne touche ni à `src/access.js`, ni
   aux policies, ni au déclencheur de sécurité de la table `utilisateurs`.
3. **Stockage dans `utilisateurs.nav_order`**, qui existe déjà, suit
   l'utilisateur d'un appareil à l'autre, et est déjà la seule colonne que
   chacun peut modifier sur son propre profil. Le format évolue d'une liste
   vers un objet, et l'ancien format (une simple liste d'identifiants) doit
   continuer de fonctionner :

   ```json
   {
     "ordre": ["dashboard", "planning", "..."],
     "jours": {
       "lundi": {
         "theme": "Bilan, réunion et commandes",
         "accueil": "bilan-semaine",
         "devant": ["bilan-semaine", "commandes", "capture-cmd"],
         "rendez_vous": [{ "heure": null, "libelle": "Réunion sur la semaine passée" }],
         "blocs": ["bilan_semaine_passee", "commandes_a_saisir"]
       }
     }
   }
   ```

   `ordre` est l'ordre habituel, celui que règle déjà le glisser-déposer.
4. **Réordonner sans désorienter.** Seules les pages de `devant` remontent en
   tête, dans l'ordre indiqué. Toutes les autres gardent l'ordre habituel.
   Aucune page ne disparaît du menu.
5. **Page d'arrivée** : appliquée uniquement à l'ouverture de l'application,
   jamais pendant la navigation, et seulement si la page est autorisée pour le
   rôle. Sinon, on garde le comportement actuel.
6. **Samedi et dimanche** : pas d'organisation, ordre habituel.
7. **Garder la main** : un bouton « Ordre habituel aujourd'hui » repasse la
   navigation et le tableau de bord en mode standard jusqu'au lendemain (cas
   d'une journée bouleversée par un imprévu). Le bandeau du jour reste visible
   pour pouvoir revenir.
8. **Tableau de bord : on ajoute et on réordonne, on ne retire rien.** Les blocs
   du jour s'affichent en premier, les widgets actuels (chantiers aujourd'hui,
   activité équipe, mes tâches, météo, agendas) restent tous en dessous.
9. **Aucun calcul réécrit.** Chaque bloc du jour appelle les modules existants
   (`bilanPeriodeV3`, `alertesV1`, `retoursTerrainV1`, `commandesAPasserV1`,
   `materiauxACommanderV1`, `bilanSemaineProchaineV1`, `cycleVie`). Si une
   logique vit dans un composant, on l'extrait d'abord dans un module pur
   `.mjs` partagé.
10. **Une impossibilité reste visible.** Un bloc qui ne peut pas s'afficher le
    dit (« aucune donnée de bilan pour la semaine 47 », « montant prévisionnel :
    fonctionnalité à venir »). Jamais de bloc vide sans explication.
11. **L'espace ouvrier n'est pas concerné.**
12. Invariants de `CLAUDE.md` : modules de calcul purs en `.mjs`, scripts
    `verif-*` branchés dans les workflows, entrée dans `journalMaj.js`.

### Organisation de Loris (modèle « Conducteur de travaux »)

Proposée comme modèle à appliquer en un clic dans l'écran « Mon organisation »
(étape 3). Claude ne l'écrit jamais lui-même dans la base.

| Jour | Thématique | Page d'arrivée | Pages en tête | Rendez-vous | Blocs du tableau de bord |
|---|---|---|---|---|---|
| Lundi | Bilan, réunion et commandes | Bilan de semaine | Bilan de semaine, Commandes, Saisie commande | Réunion sur la semaine passée (après le bilan) | Bilan de la semaine passée · Commandes à saisir |
| Mardi | Chantiers à venir | Opérations | Opérations, Phasage, Commandes à passer | — | Chantiers à venir |
| Mercredi | Application, plans et administratif | Plans | Plans, Rapprochement factures, Encours fournisseurs | 9h30 : réunion appli et IA avec Matthieu | Administratif fournisseurs |
| Jeudi | Tournée des chantiers et anticipation | Alertes | Alertes, Retours du terrain, Phasage, Planning semaine | — | Tournée des chantiers |
| Vendredi | Planning et commandes S+1 | Planning semaine | Planning semaine, Commandes à passer, Commandes | — | Planning de la semaine suivante · Matériaux à commander |

### Catalogue des blocs du tableau de bord

| Bloc | Contenu | Source (à réutiliser) | Lien |
|---|---|---|---|
| `bilan_semaine_passee` | Chiffres clés de la semaine précédente, tels que les affiche la page Bilan de semaine (heures, comptes rendus, écarts) | logique du Bilan de semaine / `bilanPeriodeV3` | Bilan de semaine |
| `commandes_a_saisir` | Demandes de matériel des ouvriers en attente et articles à commander | table `besoins` (déjà lue par le tableau de bord), `statsCommandesAPasser` | Commandes à passer |
| `chantiers_a_venir` | Chantiers qui n'ont pas encore démarré, avec l'avancement de leur phase Préparation et ce qui manque | `cycleVie` | Fiche chantier |
| `administratif_fournisseurs` | Factures fournisseurs à rapprocher et encours à payer | logique de Rapprochement factures et d'Encours fournisseurs | les deux pages |
| `tournee_chantiers` | Chantiers en cours avec leur niveau d'alerte, tâches signalées « bloqué » ou « pas commencé » et dépassements de la semaine, tâches de phasage dont la date prévue est passée | `alertesV1`, `retoursTerrainV1`, phasages | Alertes, Retours du terrain |
| `planning_semaine_suivante` | Heures prévues la semaine suivante, par chantier et par personne. Ligne « montant prévisionnel : fonctionnalité à venir » tant que le calcul des euros générés par les tâches placées n'existe pas | `bilanSemaineProchaineV1` | Planning semaine |
| `materiaux_a_commander` | Matériaux prévisionnels dont la date butoir tombe la semaine suivante | `materiauxACommanderV1` | Commandes à passer |

Sur téléphone, chaque bloc suit le modèle des sections accordéon existantes
(`MobileSection`), avec sa métrique clé visible dans l'en-tête.

## Hors périmètre

- Le calcul des euros générés par les tâches placées dans le planning : c'est
  un projet à part. Ici, on prévoit seulement sa place dans le bloc du vendredi.
- Toute modification des droits d'accès, des rôles ou de la sécurité de la
  table `utilisateurs`.
- L'espace ouvrier et la branche Invest.
- Les notifications push.
- La modification des calculs des modules réutilisés.

## Description des étapes

**Étape 1 : le module `organisationJour.mjs`**
- Module pur (le jour et la date sont passés en paramètre, aucune horloge) :
  lecture de `nav_order` sous ses deux formats, organisation du jour, ordre des
  pages à partir des pages autorisées, page d'arrivée, liste des blocs.
- Script `scripts/verif-organisation-jour.mjs` : ancien format liste, objet
  sans `jours`, samedi, page non autorisée dans `devant` ou `accueil`, page
  inconnue, doublons, mode « ordre habituel aujourd'hui ».
- **Fin d'étape** : aucun changement visible, vérifications vertes.

**Étape 2 : la navigation**
- Barre latérale (`Navigation.jsx`) : applique l'ordre du jour. Le
  glisser-déposer continue de régler `ordre` sans effacer `jours`.
- Barre du bas sur téléphone (`BottomNav`) : aujourd'hui elle ignore l'ordre
  personnalisé. Elle doit utiliser le même ordre, pour que les 4 raccourcis
  soient ceux du jour.
- Page d'arrivée à l'ouverture (`App.jsx`), dans le respect de la règle 5.
- Bouton « Ordre habituel aujourd'hui » (règle 7).
- **Fin d'étape** : avec une organisation saisie à la main pour un compte de
  test, l'ordre et la page d'arrivée changent selon le jour simulé. Un compte
  sans organisation ne voit aucune différence.

**Étape 3 : l'écran « Mon organisation »**
- Dans le profil : pour chaque jour, thématique, page d'arrivée, pages en tête
  (choisies parmi les pages autorisées du rôle), rendez-vous fixes (heure
  facultative + libellé) et blocs du tableau de bord.
- Bouton « Appliquer le modèle Conducteur de travaux » (tableau ci-dessus),
  qui pré-remplit l'écran sans enregistrer : l'utilisateur relit puis
  enregistre.
- Bouton « Supprimer mon organisation », qui revient au comportement actuel.
- **Fin d'étape** : Loris applique le modèle, l'enregistre, et retrouve son
  organisation sur ordinateur et sur téléphone.

**Étape 4 : le tableau de bord du jour**
- Bandeau en haut : jour, thématique, rendez-vous du jour, bouton « Ordre
  habituel aujourd'hui ».
- Blocs du jour en premier, dans l'ordre de la configuration, puis les widgets
  actuels (règle 8).
- Un bloc à la fois, du catalogue ci-dessus, chacun avec ses vérifications.
- **Fin d'étape** : chaque jour de la semaine, le tableau de bord de Loris
  montre ses blocs avec les vraies données. Les captures des 5 jours (date
  simulée) sont jointes au compte rendu.

## Validation automatique

Règle par défaut de `CLAUDE.md`. En plus :
- aucune migration n'est attendue (`nav_order` est déjà en `jsonb`). Si une
  migration paraît nécessaire, on s'arrête et on demande à Loris ;
- avant de mettre en ligne l'étape 2, vérifier sur la base que les utilisateurs
  qui ont déjà un `nav_order` (format liste) gardent exactement le même ordre.

### Points déjà tranchés, à noter dans le journal

- **Stockage** : `utilisateurs.nav_order` plutôt qu'une nouvelle colonne, pour
  ne pas toucher au déclencheur de sécurité (une modification de droits est un
  arrêt obligatoire).
- **Rendez-vous** : saisis dans l'organisation, pas lus depuis Google Agenda
  en v1. Le widget « Agendas équipe » reste affiché en dessous.
- **Vendredi** : les ouvriers ne travaillent pas le vendredi (rythme 4 jours),
  donc « Chantiers aujourd'hui » est vide ce jour-là. C'est normal. Les blocs
  du vendredi passent devant.

---

<!-- Sections de Claude : mises à jour après chaque tâche et avant tout arrêt. -->

## Tâches

| N° | Tâche | Statut | Validation | Preuve de réussite | Demande de fusion |
|----|-------|--------|------------|--------------------|-------------------|
| 1 | Étape 1 — module pur `organisationJour.mjs` (+ façade `.js`), script `verif-organisation-jour.mjs` et son workflow | en ligne | Contrôles verts | Tous les cas du cahier vérifiés sur GitHub ; aucun écran modifié | [#256](https://github.com/Suivi-chantier/Planning-Chantiers/pull/256) |
| 2 | Barre latérale et barre du bas lisent `nav_order` sous ses deux formats via le module ; ordre du jour appliqué ; le glisser-déposer règle `ordre` sans effacer `jours` ; la barre du bas suit le même ordre | en ligne | Contrôles verts + requête sur la base : chaque `nav_order` existant (format liste) donne exactement le même ordre qu'avant | Tableau « avant / après » de l'ordre de chaque utilisateur concerné, identique | [#257](https://github.com/Suivi-chantier/Planning-Chantiers/pull/257) |
| 3 | Page d'arrivée à l'ouverture (`App.jsx`, règle 5) + bouton « Ordre habituel aujourd'hui » (règle 7) | en ligne | Contrôles verts | Compte de test avec organisation saisie à la main : ordre et page d'arrivée changent selon le jour simulé ; compte sans organisation inchangé | [#258](https://github.com/Suivi-chantier/Planning-Chantiers/pull/258) |
| 4 | Écran « Mon organisation » dans le profil + « Appliquer le modèle Conducteur de travaux » (pré-remplit sans enregistrer) + « Supprimer mon organisation » | en ligne | Contrôles verts | Loris applique le modèle, enregistre, retrouve son organisation sur ordinateur et téléphone | [#259](https://github.com/Suivi-chantier/Planning-Chantiers/pull/259) |
| 5 | Tableau de bord : bandeau du jour (jour, thématique, rendez-vous, bouton) + emplacement des blocs du jour au-dessus des widgets actuels ; un bloc pas encore livré affiche « bloc à venir » (règle 10) | en ligne | Contrôles verts | Widgets actuels tous présents en dessous ; compte sans organisation inchangé | [#260](https://github.com/Suivi-chantier/Planning-Chantiers/pull/260) |
| 6 | Bloc `bilan_semaine_passee` (extraction préalable en `.mjs` si la logique vit dans la page Bilan de semaine) | en ligne | Contrôles verts | Mêmes chiffres que la page Bilan de semaine pour la semaine passée, sur la base | [#261](https://github.com/Suivi-chantier/Planning-Chantiers/pull/261) |
| 7 | Bloc `commandes_a_saisir` | en ligne | Contrôles verts | Mêmes comptes que la page Commandes à passer | [#262](https://github.com/Suivi-chantier/Planning-Chantiers/pull/262) |
| 8 | Bloc `chantiers_a_venir` (`cycleVie`) | en ligne | Contrôles verts | Liste identique aux chantiers non démarrés en base | [#263](https://github.com/Suivi-chantier/Planning-Chantiers/pull/263) |
| 9 | Bloc `administratif_fournisseurs` (extraction en `.mjs` de la logique de Rapprochement factures et d'Encours fournisseurs, sans changer leurs chiffres) | en ligne | Contrôles verts + chiffres des deux pages identiques avant / après l'extraction | Tableau avant / après des montants des deux pages | [#264](https://github.com/Suivi-chantier/Planning-Chantiers/pull/264) |
| 10 | Bloc `tournee_chantiers` (`alertesV1`, `retoursTerrainV1`, phasages) | en cours | Contrôles verts | Mêmes niveaux d'alerte que la page Alertes | — |
| 11 | Bloc `planning_semaine_suivante` (+ ligne « montant prévisionnel : fonctionnalité à venir ») | à faire | Contrôles verts | Mêmes heures que `bilanSemaineProchaineV1` sur la base | — |
| 12 | Bloc `materiaux_a_commander` | à faire | Contrôles verts | Mêmes matériaux que la page Commandes à passer pour S+1 | — |
| 13 | Captures des 5 jours (date simulée) sur le compte de Loris + synthèse de fin de projet | à faire | — | Captures jointes au compte rendu | — |
| 14 | Aligner le mail du vendredi et la notification « X € HT à payer » (`encoursFournisseursV1`, `api/cron-encours-fournisseurs.js`) sur le calcul de la page Encours fournisseurs (`encoursFournisseursPageV1.mjs`) | à faire | Contrôles verts + tableau avant / après par fournisseur et par mois sur la base réelle (écart attendu : celui de la page) | Le montant du mail = la somme des mois correspondants de la page | — |

## Journal des décisions

- **24/11/2026 — Découpage.** Étape 2 coupée en deux tâches (navigation, puis
  page d'arrivée + bouton) et étape 4 en un socle + une tâche par bloc, pour
  que chaque demande de fusion reste petite et fonctionne seule.
- **24/11/2026 — Ordre des tâches imposé par le code actuel.** Aujourd'hui,
  `Navigation.jsx` n'accepte `nav_order` que sous forme de liste
  (`Array.isArray`). Aucun objet ne doit être écrit dans `nav_order` avant que
  la tâche 2 soit en ligne ; sinon l'ordre habituel de l'utilisateur serait
  ignoré. L'écran « Mon organisation » (tâche 4) vient donc après.
- **24/11/2026 — Point à surveiller (tâche 2).** Une ancienne version de
  l'application restée en cache sur un téléphone, si l'on y fait un
  glisser-déposer, réécrirait `nav_order` en liste et effacerait `jours`.
  Risque faible (le cache se met à jour à l'ouverture). À rappeler dans le
  compte rendu de la tâche 4.
- **24/11/2026 — Proposition (tâche 3).** Le mode « Ordre habituel
  aujourd'hui » serait stocké dans `nav_order` (date du jour) pour s'appliquer
  aussi sur le téléphone. Pas de migration, colonne déjà modifiable par chacun.
- **24/11/2026 — Le déclencheur de sécurité** de `utilisateurs` n'autorise que
  la modification de `nav_order`, quel qu'en soit le contenu `jsonb` : le
  nouveau format passe sans y toucher (vérifié dans
  `supabase/migrations/20260930150000_utilisateurs_champs_sensibles.sql`).
- **24/11/2026 — ARRÊT (autorisation).** La session n'a pas reçu l'accès en
  écriture au dépôt : l'ajout du dépôt avec droit de pousser a été refusé par
  la configuration des autorisations. Conformément à `CLAUDE.md`
  (« Autorisations »), on s'arrête sans contourner.
- **24/11/2026 — Réponse : « oui ».** Accès en écriture accordé ; reprise.
  Le fichier projet arrive sur `main` avec la demande de fusion de la tâche 1.

- **24/11/2026 — Tâche 2, barre du bas.** Aujourd'hui la barre du bas ignore
  l'ordre personnalisé (glisser-déposer). Pour respecter la règle 1, elle ne
  suit l'ordre de la barre latérale que lorsqu'une organisation du jour est
  réellement active ; sinon elle reste exactement comme avant.
- **24/11/2026 — Tâche 2, glisser-déposer.** En mode édition, la barre latérale
  affiche et règle l'ordre habituel ; hors édition, l'ordre du jour. L'ordre
  d'un jour ne peut pas être enregistré par erreur comme ordre habituel.
- **24/11/2026 — Tâche 2, date simulée.** Paramètre d'adresse
  `?date_simulee=AAAA-MM-JJ`, lu au chargement (aucun mécanisme n'existait).
- **24/11/2026 — Tâche 2, contrôle rouge corrigé (1re correction).** La garde
  de sécurité qui fige les écritures vers `utilisateurs` a échoué : le code
  avait regroupé les deux écritures existantes de `nav_order` en une. Corrigé en
  rétablissant les deux écritures à l'identique, sans toucher à la garde.

- **24/11/2026 — Tâche 3, page d'arrivée.** Aujourd'hui l'application
  s'ouvre toujours sur le tableau de bord (rien n'est restauré de la session
  précédente). La page d'arrivée du jour ne s'applique qu'une fois par
  ouverture, jamais si l'adresse demande déjà une page (lien de notification,
  ancre), jamais après une première navigation, jamais pour l'espace ouvrier
  ni Invest.
- **24/11/2026 — Tâche 3, bouton.** Bas de la barre latérale sur ordinateur,
  haut du menu « Plus » sur téléphone. Limite connue : un rôle à 5 pages ou
  moins n'a pas de menu « Plus » (chargé d'affaires aujourd'hui) ; le bandeau
  du tableau de bord (tâche 5) offrira aussi le bouton.

- **24/11/2026 — Tâche 4, écran.** « Mon profil » → onglet « Mon
  organisation ». Un jour laissé vide n'est pas enregistré ; enregistrer sans
  aucun jour rempli revient à supprimer l'organisation. « Supprimer mon
  organisation » efface aussi le mode « ordre habituel aujourd'hui ». Une page
  devenue non autorisée est signalée dans l'écran puis retirée au prochain
  enregistrement.
- **24/11/2026 — Tâche 4, correction annexe.** La barre relisait l'ancienne
  valeur du profil après un enregistrement si elle était réaffichée (passage
  ordinateur ↔ téléphone) : corrigé par une mémoire de session.
- **24/11/2026 — À faire en tâche 5.** Mettre à jour les phrases de l'écran
  « Mon organisation » qui annoncent le bandeau « lors d'une prochaine mise à
  jour ».

- **24/11/2026 — Tâche 5, rendez-vous.** Ceux avec heure d'abord (du plus
  tôt au plus tard), puis ceux sans heure dans l'ordre saisi.
- **24/11/2026 — Repérage pour les tâches 6 à 12.** Plusieurs logiques sources
  vivent dans des composants et doivent être extraites en `.mjs` avant
  réutilisation (règle 9) : chargement et assemblage du Bilan de semaine
  (`BilanPeriode.jsx`, tâches 6 et 11), chargeur de Commandes à passer
  (`PagePlanningCommandes.jsx`, tâches 7 et 12), liste « à rapprocher »
  (`RapprochementFactures.jsx`) et calcul d'Encours fournisseurs
  (`PageEncoursFournisseurs.jsx` n'utilise pas `encoursFournisseursV1.mjs` :
  tâche 9, tableau avant / après obligatoire), requêtes de
  `RetoursTerrain.jsx` (tâche 10). Chaque extraction est vérifiée « mêmes
  chiffres avant / après » sur la base réelle.

- **24/11/2026 — Tâche 6, extraction.** Chargement et assemblage des
  chiffres du Bilan de semaine extraits de `BilanPeriode.jsx` vers
  `bilanSemaineDonnees.js` (lecture) et `bilanSemaineChiffresV1.mjs` (pur) ;
  la page et le bloc utilisent les mêmes fonctions. Deux scripts existants
  (`verif-bilan-periode`, `verif-chantier-actif`) ont été ajustés pour suivre
  le déplacement du code, sans retirer de vérification.
- **24/11/2026 — Point signalé, hors périmètre (pour Loris).** La notification
  « synthèse de la semaine » (`notificationsDirectionV1.mjs`) recalcule les
  chiffres du bandeau en parallèle, sans barème de frais généraux : elle
  pourrait s'écarter de la page si un barème était enregistré un jour. Non
  modifié.
- **24/11/2026 — Coût connu.** Le lundi, le bloc relit les relevés comme la
  page (environ 4 000 lignes) à chaque affichage du tableau de bord.

- **24/11/2026 — Tâche 7, extraction.** Lectures de la page Commandes à
  passer et du compteur du tableau de bord regroupées dans
  `commandesAPasserDonnees.js` (mêmes 17 requêtes), logique pure dans
  `commandesASaisirV1.mjs`. Scripts `verif-enveloppes-lots` et
  `verif-materiaux-grand-catalogue` ajustés pour suivre le déplacement, sans
  retrait de vérification. Le tableau de bord garde son comportement en cas
  d'erreur de lecture (0) ; seul le bloc signale l'erreur.
- **24/11/2026 — Deux compteurs de demandes distincts.** La tuile du tableau de
  bord compte des articles demandés, l'onglet de la page des envois
  d'ouvriers ; le bloc montre les deux avec leur intitulé.

- **24/11/2026 — Tâche 8, règle « pas encore démarré ».** Aucune règle
  n'existait : reprise de la plus proche, le statut affiché par la fiche
  chantier (`statutChantier` = « Planifié » : devis signé, travaux pas
  commencés ; `factureAEmettre.mjs`). Avancement de la Préparation : les 6
  étapes de `cv_preparation` (`cycleVie.mjs`), format « x/6 étapes faites »
  comme la synthèse Opérations. Aucune date de démarrage prévue n'existe en
  base : non affichée.
- **24/11/2026 — Question à Loris : le bloc du mardi est vide** (aucun chantier
  « Planifié » en base ; 25 chantiers sans statut s'affichent « En cours »
  parce qu'ils ont un phasage, dont 9 sans aucune heure pointée : FOUGERAY ×6,
  LOUISON APPT 2/3/4). Faut-il les passer en « Planifié » ?
- **24/11/2026 — Réponse de Loris** : « je passe les 9 chantiers en Planifié,
  continue ». Saisie faite par Loris dans l'application ; Claude n'écrit rien
  en base. Règle du bloc inchangée.
- **24/11/2026 — Incohérence existante signalée, non corrigée (hors
  périmètre).** Un chantier sans statut s'affiche « En cours » dans la liste
  Opérations, « Planifié » dans la synthèse cycle de vie d'Opérations, et l'un
  ou l'autre sur la fiche selon qu'il a un phasage. Le bloc suit la fiche.

- **24/11/2026 — Tâche 9, extraction.** Calcul de la page Encours
  fournisseurs extrait tel quel (`encoursFournisseursDonnees.js`,
  `encoursFournisseursPageV1.mjs`) ; historique du rapprochement extrait
  (`rapprochementDonnees.js`, `historiqueRapprochementV1.mjs`). Les pages et le
  bloc utilisent les mêmes fonctions. `encoursFournisseursV1.mjs` non modifié.
- **24/11/2026 — Divergence constatée (question à Loris).** Le mail du
  vendredi et la notification « X € HT à payer » (`encoursFournisseursV1`)
  annoncent 32 469,16 € sur 6 mois quand la page donne 32 578,47 € pour les
  mêmes mois (−109,31 €). Causes : règle « 30 j fin de mois » différente pour
  un document daté d'une fin de mois (page : 31/08 → 31/10 ; V1 : 31/08 →
  30/09 ; 5 commandes REXEL, ZOLPAN, Partedis), conversion UTC des dates,
  échéance saisie sur facture et BL de facture ignorés (sans effet
  aujourd'hui), fenêtre de 6 mois.
- **24/11/2026 — Réponse de Loris** : « oui il faut » (aligner le mail et la
  notification sur la page). Ajout de la **tâche 14**, placée en fin de projet
  pour ne pas mêler un changement de montants aux blocs du tableau de bord.
  Ce n'est pas un calcul réutilisé par les blocs (hors périmètre « modules
  réutilisés » non concerné) ; la décision vient de Loris.
- **24/11/2026 — Défaut existant signalé, non corrigé.** La page Encours
  fournisseurs affiche « Aucune dépense enregistrée. » quand la lecture
  échoue (état inconnu présenté comme vide). Le bloc, lui, signale l'erreur.
- **24/11/2026 — Mois en cours du bloc Encours** : horloge de l'appareil, comme
  la page, pour afficher toujours le même chiffre que la page.

## Comptes rendus

### Arrêt avant la tâche 1 — 24/11/2026

- **Fait** : cahier recopié en `docs/projets/organisation-par-jour.md`,
  découpage en 13 tâches, lecture du code de navigation et du déclencheur de
  sécurité. Aucun code modifié, rien mis en ligne.
- **Bloque** : la session ne peut ni pousser une branche, ni ouvrir de
  demande de fusion (accès en écriture au dépôt refusé par la configuration).
- **Question** : « Autorises-tu cette session à écrire dans le dépôt
  Planning-Chantiers (pousser des branches, ouvrir et fusionner des demandes
  de fusion) ? » — Oui / Non.
- **Réponse (24/11/2026)** : « oui ». Accès en écriture accordé, reprise à la
  tâche 1.

### Tâche 1 — en ligne (24/11/2026)

- **Ce qui a changé** : rien de visible. Le module qui calcule l'organisation
  du jour existe (ordre des pages, page d'arrivée, blocs, mode « ordre
  habituel aujourd'hui », modèle Conducteur de travaux) avec 13 vérifications
  automatiques, dont la comparaison avec l'ordre actuel pour tous les rôles.
- **Modèle Conducteur de travaux** : toutes les pages du tableau existent et
  sont autorisées par défaut au rôle conducteur (« Commandes à passer » =
  page `planning-commandes`, « Phasage » = `phasage-v2`).
- **Sans organisation, rien n'est écrit en base** : le glisser-déposer
  continue d'enregistrer une simple liste.
- **Journal des MAJ** : pas d'entrée (rien de visible), comme pour le projet
  « Préparer le chantier ». L'entrée viendra avec la tâche 2.
- **Vérification de mise en ligne** : 14 contrôles verts, fusion, déploiement
  de production Vercel terminé avec succès. L'adresse de l'application n'est
  pas joignable depuis l'environnement de Claude (réseau) : l'ouverture n'a pas
  pu être testée dans un navigateur.
- Hors données réelles : la vérification tourne sur des listes de test
  (exemple issu des tests, données fictives).

### Tâche 2 — en ligne (24/11/2026)

- **Ce qui a changé** : la barre latérale et la barre du bas sur téléphone
  suivent l'organisation du jour quand l'utilisateur en a une. Personne n'en a
  encore (l'écran pour la régler arrive en tâche 4) : aucun changement visible
  pour l'instant.
- **Vérification sur la base (exigée avant mise en ligne)** : 2 utilisateurs
  ont un ordre enregistré, tous deux au format liste, rôle admin. Aucun n'a
  d'organisation. Comparaison de l'ordre affiché, ancien code contre nouveau,
  pour chaque jour du lundi 23 au dimanche 29/11/2026, avec les pages
  autorisées réelles du rôle admin (configuration en base + ajout automatique
  admin) :

  | Utilisateur (début d'identifiant) | Rôle | Pages du menu | Ordre identique les 7 jours | Barre du bas inchangée |
  |---|---|---|---|---|
  | 39c41372 | admin | 29 | oui | oui |
  | 586c3534 | admin | 29 | oui | oui |

- **Contrôles** : 19 verts après une correction (voir journal). Fusion,
  déploiement de production Vercel terminé avec succès. Ouverture dans un
  navigateur impossible depuis l'environnement de Claude (réseau).
- **Test des écrans** : barres testées sur une page de test avec des profils
  fictifs (exemple issu des tests, données fictives) : lundi « Bilan de
  semaine, Commandes, Saisie commande » en tête ; samedi ordre habituel ; sans
  organisation, rien ne change.
- **Journal des MAJ** : entrée ajoutée le 24/11/2026.

### Tâche 3 — en ligne (24/11/2026)

- **Ce qui a changé** : à l'ouverture, l'application ira sur la page
  d'arrivée du jour ; bouton « Ordre habituel aujourd'hui » / « Revenir à
  l'organisation du jour ». Toujours invisible tant que personne n'a
  d'organisation (écran de réglage : tâche 4).
- **Sécurité** : aucune nouvelle écriture vers la table `utilisateurs` ; le
  bouton réutilise l'écriture existante de l'ordre de navigation.
- **Contrôles** : 19 verts du premier coup, fusion, déploiement de production
  terminé avec succès. Ouverture dans un navigateur impossible depuis
  l'environnement de Claude (réseau).
- **Test des écrans** : application lancée avec une base simulée et un profil
  fictif (exemple issu des tests, données fictives) : 18 cas réussis — lundi
  ouvre Bilan de semaine, jeudi Alertes, samedi et sans organisation le
  tableau de bord, un lien de notification reste prioritaire.
- **Journal des MAJ** : entrée ajoutée le 24/11/2026.

### Tâche 4 — en ligne (24/11/2026)

- **Ce qui a changé** : « Mon profil » → onglet « Mon organisation » : pour
  chaque jour, thématique, page d'arrivée, pages en tête (ordonnées),
  rendez-vous, blocs du tableau de bord. « Appliquer le modèle Conducteur de
  travaux » pré-remplit sans enregistrer ; « Supprimer mon organisation »
  revient exactement à l'état d'avant.
- **Sécurité** : aucune nouvelle écriture vers `utilisateurs` (toujours les
  deux écritures de l'ordre de navigation) ; ni droits, ni base modifiés.
- **Contrôles** : 19 verts du premier coup, fusion, déploiement de production
  terminé avec succès.
- **Test des écrans** : 26 cas réussis, application lancée avec une base
  simulée (exemple issu des tests, données fictives) : modèle appliqué sans
  écriture, enregistrement en une écriture, barre du lundi « Bilan de semaine,
  Commandes, Saisie commande », téléphone « Bilan, Cmd., Saisie, Planning »,
  suppression = retour exact à l'avant.
- **Fin d'étape 3 côté Loris** : il peut désormais appliquer le modèle et
  l'enregistrer ; la vérification sur son compte réel reste à faire par lui
  (Claude n'écrit jamais l'organisation dans la base).
- **Journal des MAJ** : entrée ajoutée le 24/11/2026.

### Tâche 5 — en ligne (24/11/2026)

- **Ce qui a changé** : pour un utilisateur avec organisation, le tableau de
  bord affiche en haut un bandeau (jour, thématique, rendez-vous, bouton
  « Ordre habituel aujourd'hui »), puis les blocs du jour — encore « à venir »
  avec un lien vers leur page —, puis tous les widgets actuels.
- **Sans organisation** : tableau de bord identique au pixel près à la version
  précédente (comparaison sur base simulée, bureau et téléphone).
- **Contrôles** : 19 verts du premier coup, fusion, déploiement de production
  terminé avec succès.
- **Test des écrans** : 92 cas réussis, captures du lundi au samedi
  (exemple issu des tests, données fictives).
- **Journal des MAJ** : entrée ajoutée le 24/11/2026.

### Tâche 6 — en ligne (24/11/2026)

- **Ce qui a changé** : le bloc « Bilan de la semaine passée » affiche les
  chiffres du haut de la page Bilan de semaine (production, marge de la
  période, marge probable, heures validées, comptes rendus non validés), avec
  les mêmes libellés et explications, et un lien vers la page. Sans données :
  « Aucune donnée de bilan pour la semaine 47 » ; relevé absent : « relevé pas
  encore disponible », jamais un zéro.
- **Avant / après sur la base réelle** (lecture seule ; ancien calcul de la
  page contre fonctions extraites, mêmes données) :

  | Semaine | Chiffre | Avant | Après | Écart |
  |---|---|---|---|---|
  | 2026-W47 | Production de la période | 7 123 € | 7 123 € | 0 |
  | 2026-W47 | Marge de la période | −2 912 € | −2 912 € | 0 |
  | 2026-W47 | Marge probable (8 chantiers) | +43 399 € | +43 399 € | 0 |
  | 2026-W47 | Heures validées | 232,2 h | 232,2 h | 0 |
  | 2026-W47 | Chantiers retenus / relevé indisponible | 9 / 0 | 9 / 0 | 0 |
  | 2026-W46 | Production de la période | 14 143 € | 14 143 € | 0 |
  | 2026-W46 | Marge de la période | +2 454 € | +2 454 € | 0 |
  | 2026-W46 | Marge probable | +23 400 € | +23 400 € | 0 |
  | 2026-W46 | Heures validées | 258,8 h | 258,8 h | 0 |
  | 2026-W46 | Comptes rendus non validés | 1 | 1 | 0 |

  Présélection, synthèse par chantier, alertes et avertissements : strictement
  identiques.
- **Contrôles** : 17 verts du premier coup, fusion, déploiement de production
  terminé avec succès.
- **Test des écrans** : 34 cas réussis (exemple issu des tests, données
  fictives) ; chaque tuile du bloc se retrouve à l'identique sur la page.
- **Journal des MAJ** : entrée ajoutée le 24/11/2026.

### Tâche 7 — en ligne (24/11/2026)

- **Ce qui a changé** : le bloc « Commandes à saisir » affiche les demandes de
  matériel des ouvriers en attente (5 plus récentes) et les articles à
  commander du phasage, avec les chiffres et intitulés de la page Commandes à
  passer, et un lien vers elle.
- **Avant / après sur la base réelle** (lecture seule, 24/11/2026 ; ancien code
  contre code extrait, mêmes données, mêmes requêtes) :

  | Chiffre | Avant | Après | Écart |
  |---|---|---|---|
  | Demandes en attente (tuile du tableau de bord) | 0 | 0 | 0 |
  | Demandes ouvriers (onglet de la page) | 0 | 0 | 0 |
  | Chantiers en cours | 42 | 42 | 0 |
  | Articles à commander | 1 544 | 1 544 | 0 |
  | Reste à commander HT (enveloppes des lots) | 161 556 € | 161 556 € | 0 |

  Aucune demande en attente en base ce jour (71 annulées, 38 traitées) : le
  bloc affiche « Aucune demande en attente ».
- **Contrôles** : 18 verts du premier coup, fusion, déploiement de production
  terminé avec succès.
- **Test des écrans** : 52 cas réussis (exemple issu des tests, données
  fictives) ; la tuile, la page et le bloc affichent les mêmes chiffres.
- **Journal des MAJ** : entrée ajoutée le 24/11/2026.

### Tâche 8 — en ligne (24/11/2026)

- **Ce qui a changé** : le bloc « Chantiers à venir » liste les chantiers
  « Planifié » avec l'avancement de leur Préparation (« x/6 étapes faites »,
  « Préparation non renseignée », « Préparation complète ») et les étapes qui
  manquent ; un clic ouvre la fiche chantier.
- **Base réelle** (lecture seule, 24/11/2026 ; calcul de la fiche chantier
  contre calcul du bloc, mêmes données) :

  | Mesure | Fiche chantier | Bloc | Écart |
  |---|---|---|---|
  | Statuts, 62 chantiers non archivés | 31 En cours, 15 Terminé, 16 À l'étude, 0 Planifié | identique | 0 |
  | Chantiers à venir | 0 | 0 (« Aucun chantier à venir ») | 0 |
  | Préparation, 62 chantiers | 32 non renseignées, 29 à 1/6, 1 à 2/6 | identique | 0 |

  Rien n'a été extrait : les règles étaient déjà dans des modules purs.
- **Contrôles** : 19 verts du premier coup, fusion, déploiement de production
  terminé avec succès.
- **Test des écrans** : 57 cas réussis (exemple issu des tests, données
  fictives) ; les cases de Préparation de la fiche sont celles du bloc.
- **Journal des MAJ** : entrée ajoutée le 24/11/2026.

### Tâche 9 — en ligne (24/11/2026)

- **Ce qui a changé** : le bloc « Administratif fournisseurs » affiche les
  factures à rapprocher (nombre, 5 plus anciennes) et l'encours à payer avec
  les cartes de la page Encours (« À payer » et « Payé comptant » du mois),
  les fournisseurs du mois et les mois suivants ; liens vers les deux pages.
- **Avant / après sur la base réelle** (lecture seule, 24/11/2026 ; code de la
  page en ligne contre fonctions extraites, mêmes données) :

  | Chiffre | Avant | Après | Écart |
  |---|---|---|---|
  | À payer · novembre 2026 | 6 879,94 € | 6 879,94 € | 0 |
  | Payé comptant · novembre 2026 | 1 050,05 € | 1 050,05 € | 0 |
  | REXEL, à payer / payé comptant (tous mois) | 22 506,28 € / 1 535,20 € | identique | 0 |
  | Partedis | 5 849,28 € / 725,07 € | identique | 0 |
  | ZOLPAN | 4 758,81 € / 0 € | identique | 0 |
  | YESSS ELECTRIQUE | 971,97 € / 0 € | identique | 0 |
  | WURTH | 408,68 € / 0 € | identique | 0 |
  | LEROY MERLIN | 0 € / 31 774,49 € | identique | 0 |
  | 15 autres fournisseurs | 0 € / 8 989,52 € | identique | 0 |
  | **Total** | **34 495,02 € / 43 037,46 €** | identique | **0** |
  | Factures à rapprocher | 0 | 0 | 0 |

  Les 9 mois d'échéance et les 273 éléments sont identiques un par un.
- **Contrôles** : 18 verts du premier coup, fusion, déploiement de production
  terminé avec succès.
- **Test des écrans** : 60 cas réussis (exemple issu des tests, données
  fictives) ; mêmes chiffres que les pages Encours et Rapprochement.
- **Journal des MAJ** : entrée ajoutée le 24/11/2026.

