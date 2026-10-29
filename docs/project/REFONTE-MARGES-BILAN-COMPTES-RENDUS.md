# Projet — Refonte des marges, du Bilan semaine et des comptes rendus

> Document de référence du projet. Il contient le contexte, les décisions métier
> prises avec Loris, les règles communes, le suivi d'avancement et le cahier des
> charges complet de chaque étape. Claude Code le relit au début de CHAQUE étape
> (le contexte d'une longue session peut être résumé et perdre des détails) et
> met à jour la section « Suivi du projet » à la fin de chaque étape.

---

## 0. Mode d'emploi pour Claude Code

1. Lis entièrement ce document et `CLAUDE.md` avant de commencer.
2. Repère dans « Suivi du projet » la première étape qui n'est pas terminée.
3. Réalise-la en suivant son cahier des charges (section 5) et les règles
   communes (section 3). Les « Décisions métier » (section 2) priment en cas de
   doute : ne réintroduis jamais une idée listée dans « Décisions écartées ».
4. Mets en ligne selon les règles (section 3), puis mets à jour « Suivi du
   projet » : statut, date, résumé en langage métier, points d'attention.
5. Enchaîne sur l'étape suivante sans attendre, jusqu'à la fin du projet.
6. Tu ne t'arrêtes pour attendre Loris QUE dans les cas listés en section 3
   (migrations, reconstitution du passé, suppression des anciens crons, ou
   blocage réel). Dans ce cas, pose une question claire, attends la réponse,
   puis reprends là où tu t'étais arrêté.
7. À la fin du projet : un compte rendu global (voir section 3).

---

## 1. Contexte et objectifs

Application interne de Profero Rénovation (React, Vercel, Supabase). Objectif :
« industrialiser » la rénovation avec des processus simples, répétables et le
plus automatisés possible.

Le Bilan semaine envoyé à la direction donnait des chiffres contradictoires :
- la « marge nette » (vendu total − coûts engagés) n'est pas une marge mais un
  budget restant ; elle baisse mécaniquement chaque semaine ;
- l'alerte « perte de marge » s'appuyait dessus et se déclenchait sur presque
  tous les chantiers actifs, même ceux qui gagnaient de l'argent ;
- les heures ne correspondaient pas entre la synthèse et les alertes (relevé du
  vendredi pris avant la fin des validations, saisies tardives) ;
- la production reposait sur un avancement chantier arrondi au point ;
- les matériaux comptaient au moment de la commande ;
- la marge à terminaison ignorait la dérive constatée ;
- les heures « sans lot » masquaient les causes des dérives.

Côté terrain, les ouvriers trouvent le compte rendu du soir long et compliqué, la
qualité des déclarations est variable, et la page de validation n'est pas
travaillée visuellement.

---

## 2. Décisions métier (référence)

### 2.1 Marges et Bilan

1. **Alertes** : l'alerte « perte de marge » se base sur la baisse de la marge
   probable, plus sur la « marge nette ». La « marge nette » devient « budget
   restant » ou disparaît.
2. **Trois marges par chantier** : marge à l'avancement (production − coûts réels,
   le constat), marge à terminaison (si le reste se passe comme le devis), marge
   probable (reste à faire de chaque lot × sa dérive).
3. **Garde-fous de la marge probable** : dérive appliquée à partir de 25 %
   d'avancement du lot (réglable) ; dérive historique du même type de lot pour
   les lots non commencés ; neutralisation possible par le conducteur avec
   commentaire obligatoire.
4. **Matériaux en enveloppe par lot** : reste à commander = budget prévu du lot −
   commandes saisies sur le lot (minimum zéro) ; bouton « achats terminés » ;
   chaque commande est attribuée à un lot. La sous-traitance, la location et les
   bennes/déchetterie sont saisies comme des commandes (avec une nature).
5. **Matériaux imputés à l'avancement** pour la marge à l'avancement ; le surplus
   apparaît comme « matériaux en avance sur chantier ».
6. **Avancement plus fiable** : repères concrets ou quantités, validés par le
   conducteur ; alerte sur une production par heure aberrante.
7. **Heures sans lot** : tâches standard (nettoyage, réception, SAV,
   approvisionnement, déchetterie, reprises) ; alerte au-delà de 10 %.
8. **Chantier repris** (démarré avant l'application, ex. TOM & CAMILLE) : exclu
   des statistiques de cadences, des dérives historiques et des alertes.
9. **Coûts** : taux horaire de frais généraux unique pour l'entreprise, réglé dans
   les paramètres, 17,44 €/h par défaut, daté (date d'effet). Le taux horaire
   des ouvriers est le COÛT CHARGÉ.
10. **Journal d'avancement daté** : chaque modification d'avancement est
    enregistrée avec sa date de réalisation ; relevés journaliers recalculés à
    chaque validation ; statut « journée complète / incomplète » ; cron de nuit
    de rattrapage.
11. **Bilan** : comparaison d'un dernier jour travaillé à l'autre ; trois marges
    et € produits par heure ; journées incomplètes signalées ; n'importe quelle
    période (semaine, mois).
12. **Bilan de clôture** devis / réel par ouvrage pour alimenter les cadences de
    la bibliothèque.
13. **Export du bilan** : présélection des chantiers ayant eu de l'activité ;
    chantiers en cours sans activité listés ; avertissement s'il reste des
    comptes rendus non validés.
14. **Refonte du bilan** : version direction (1-2 pages) et version détaillée ;
    dérive en heures et en euros ; tâches résumées par lot avec synthèse IA
    relue ; pas de commentaires bruts dans la version direction ; tendances par
    lot ; semaine à venir ; prévu / réalisé ; photos ; rappel des blocages limité
    à 4 semaines ; rectifications des semaines déjà exportées.
15. **Tâches hors devis**, trois cas :
    - A. la tâche existait, l'ouvrier ne l'a pas trouvée → on réaffecte les
      heures, sans créer de tâche ;
    - B. travail imprévu dans un ouvrage vendu → on ajoute la tâche, marquée
      « ajoutée en cours de chantier », avec ses heures NORMALES (pas les heures
      réelles) comme poids ;
    - C. travail non vendu → « à arbitrer », puis avenant (nouvel ouvrage
      chiffré) ou geste commercial.
    La production est calculée ouvrage par ouvrage, en euros, sans arrondi. La
    date de réalisation d'un avancement modifié depuis le phasage est le dernier
    jour où la tâche a été déclarée.

### 2.2 Comptes rendus et validation

- **C1. Parcours unique** (révisé le 26/10/2026, CR-6 ; remplace les deux
  branches « Journée comme prévu » / « Pas comme prévu ») : pour chaque chantier
  du jour, l'ouvrier voit directement la liste de ses tâches prévues, heures
  PRÉREMPLIES avec la durée prévue, état NON prérempli et OBLIGATOIRE choisi en
  un geste (Pas commencé, Commencé, À moitié, Presque fini, Terminé, ou la
  quantité posée ; « Bloqué » avec son motif), le prévu affiché en petit comme
  simple repère, jamais sélectionné. « J'ai fait autre chose » ouvre le phasage
  et AJOUTE des tâches à la liste sans rien effacer. « Pas commencé » ne demande
  aucun motif.
- **C2. Vue phasage mobile** (ouverte par « J'ai fait autre chose » depuis
  CR-6 ; avant : branche « pas comme prévu ») : lot › ouvrage › tâche,
  métier de l'ouvrier en premier, recherche, tâches terminées masquées, sélection
  multiple, « Créer une tâche » avec le motif A / B / C. Les tâches prévues ne
  sont PAS proposées comme choix dans cette branche.
- **C3. Temps PRÉCIS, saisie allégée** : durée prévue préremplie, « le reste
  ici », raccourcis 1 h / 2 h / 4 h / journée, ±15 min, frise horaire en OPTION
  (désactivée par défaut) ; envoi bloqué tant que le total n'est pas exact.
- ~~**C4. Tâches prévues non faites** : une question « pourquoi ? » à la fin.~~
  **Supprimée le 26/10/2026 (CR-6)** : plus d'écran ni de motif pour les tâches
  prévues non faites. À la validation, « prévue, pas faite » reste un écart
  orange, sans motif affiché.
- **C5.** Repères concrets ou quantités au lieu des pourcentages libres ; dictée
  vocale avec préremplissage par l'IA ; une photo de la zone en fin de journée
  (recommandée, jamais exigée) ; retour à l'ouvrier après l'envoi ; diagnostic
  chiffré avant et après.
- **C6. Phasage lisible** : libellés d'ouvrages et de tâches personnalisables dans
  chaque phasage, enregistrés À CÔTÉ du libellé devis ; liste de pièces par
  chantier ; découpage par pièce seulement pour les lots qui s'y prêtent.
- **C8. Tâches faites à plusieurs** : le premier qui déclare fixe l'état, les
  suivants confirment et ajoutent leur temps.
- **C9. Sans réseau** : phasage chargé à l'avance ; repli de la dictée.
- **C10. Refonte visuelle de la page de validation** (Loris valide sur
  ordinateur, et veut continuer à valider chaque compte rendu lui-même).
- **C11. Répartir une tâche regroupée** (« fourre-tout ») sur plusieurs tâches du
  phasage, avec proposition automatique et compteur dans le suivi qualité.

### 2.3 Décisions écartées (ne pas réintroduire)

- Déclaration du temps approximative (proportions de journée) : REFUSÉE, le
  temps reste précis.
- Libellés terrain stockés dans la bibliothèque : NON, ils se personnalisent
  dans chaque phasage.
- Trajets préremplis depuis l'adresse du dépôt : NON (certains ouvriers vont
  directement sur le chantier).
- Relances / notifications de compte rendu non envoyé : NON.
- Bouton ou champ spécifique « signaler un incident » : NON (le commentaire libre
  suffit, le formulaire doit rester léger).
- Déploiement progressif à quelques ouvriers : NON, tout le monde passe en même
  temps (un interrupteur de retour en arrière reste prévu).
- Validation groupée « tout valider d'un clic » : NON (seul un bouton « Valider »
  direct par compte rendu « comme prévu » sans anomalie).
- Trésorerie / situation à facturer : reportée à plus tard (le % facturé n'est
  pas fiable).
- Liens de prévisualisation et attente de validation avant mise en ligne : NON,
  Loris teste à la fin du projet.
- Boutons « Journée comme prévu » / « Ça ne s'est pas passé comme prévu » : NON
  (écartés le 26/10/2026, CR-6) — l'état attendu tiré du planning n'est juste
  qu'environ une fois sur deux ; un compte rendu faux arrivait en gris « comme
  prévu », validable en un clic.
- État des tâches prérempli d'après le planning : NON (CR-6) — c'est l'ouvrier
  qui choisit l'état, le prévu n'est qu'un repère affiché.
- Motif demandé pour les tâches prévues non faites : NON (CR-6).

---

## 3. Règles communes à toutes les étapes

- Respecter `CLAUDE.md` (modules de calcul purs `.mjs`, scripts `verif-*.mjs`
  branchés dans un workflow, entrée dans `journalMaj.js` en langage métier,
  invariants « même chiffre = même service » et « une impossibilité reste
  visible », policy `profero_collaborateurs_seulement` sur toute nouvelle table).
- **Mise en ligne** : normale, sans attendre Loris. Dès que les contrôles GitHub
  sont verts, on fusionne, on attend le déploiement, et on passe à la suite. On
  ne fusionne jamais au rouge.
- **Arrêts obligatoires (attendre l'accord de Loris)** :
  - toute migration de base : expliquer en langage simple ce qu'elle change ;
  - la reconstitution du passé du journal d'avancement (étape 1C) : simulation
    chiffrée d'abord ;
  - la suppression des anciens crons ou de `chantier_snapshots_hebdo` (étape 3) ;
  - un blocage réel (information manquante, contradiction entre ce document et
    le code) : poser UNE question claire.
- **Exemples** : jamais de données de test présentées comme réelles. Tout chiffre
  « réel » vient d'une requête sur la base.
- **Compte rendu de chaque étape** (dans « Suivi du projet », et dans la
  conversation) : en français, sans jargon, compréhensible sans lire le code ;
  ce qui a changé pour Loris et pour les ouvriers ; les résultats chiffrés
  demandés par l'étape ; les points d'attention.
- **Compte rendu final du projet** : ce qui a été livré étape par étape, les
  migrations appliquées, ce que Loris doit tester en priorité (liste concrète),
  les réglages à vérifier dans Admin, et les points restés ouverts.

---

## 4. Suivi du projet

Claude Code met à jour ce tableau et la liste de comptes rendus à la fin de
chaque étape.

| Ordre | Étape | Statut | Date | Résumé |
|---|---|---|---|---|
| 1 | Étape 1 — Fondations des données financières | ✅ En ligne | 2026-10-24 | Trouvée non en ligne au démarrage, mise en ligne le 24/10 avec l'accord de Loris : 3 migrations, reconstitution du passé (4 796 lignes), premiers relevés journaliers. Voir « Vérification de l'étape 1 ». |
| 2 | Étape 2 — Les trois marges et les alertes | ✅ En ligne | 2026-10-24 | Trois marges (avancement, terminaison, probable), « marge nette » devenue « budget restant », relevés passés recalculés (3 686), nouvelles alertes sur les relevés journaliers. Coefficients sous ×1 : tranché par Loris (plancher ×1, livré en 3.0). Voir « Étape 2 ». |
| 3 | Étape 3 — Refonte du Bilan semaine | ✅ En ligne | 2026-10-24 | Bilan sur les relevés journaliers, période libre, présélection, versions direction et détaillée, bilans figés + Rectifications, prévu / réalisé, fin prévisionnelle et glissement, tendances, semaine qui vient (équipe + commandes + livraisons), bilan de clôture. Relevés du vendredi arrêtés (option A), plus aucun lecteur. PR #155 à #166. Voir « Étape 3 ». |
| 4 | Étape 4 — Tâches hors devis | ✅ En ligne | 2026-10-24 | Cas A / B / C choisis à la validation et dans le phasage (« Ce travail est-il facturé au client ? »), avenant, geste commercial, ouvrage non facturé ; décisions « à arbitrer » dans le Bilan avec rappel réglable ; heures hors devis par cas dans la fiche chantier ; tâches souvent ajoutées dans la Bibliothèque. Aucune migration. Voir « Étape 4 ». |
| 5 | CR-1 — Diagnostic chiffré des comptes rendus | ✅ En ligne | 2026-10-24 | Diagnostic réel sur 8 semaines, page « Qualité des comptes rendus » (bureau), module d'indicateurs réutilisable (compteur « lignes découpées » par ouvrier et par mois pour CR-5). Écart d'avancement déclaré / validé allumé à partir du journal d'avancement, sans fonction SQL. Voir « CR-1 ». |
| 6 | CR-2 — Phasage lisible (libellés, pièces) | ✅ En ligne | 2026-10-24 | Libellés personnalisés d'ouvrages et de tâches (à côté du libellé devis, inventaire complet des usages) ; pièces du chantier : liste, rattachement de plusieurs tâches, filtre et regroupement, duplication par pièce à heures conservées. Aucune migration. Écrans ouvriers : libellé devis jusqu'au CR-3. Voir « CR-2 ». |
| 7 | CR-3 — Nouveau parcours du compte rendu | ✅ En ligne | 2026-10-25 | Accueil « journée prévue » avec l'état attendu ce soir, « Journée comme prévu » / « Pas comme prévu », phasage sur téléphone (lot / pièce, noms personnalisés, recherche, sélection multiple, création avec motif), repères, raccourcis de temps et « le reste ici », frise en option, tâches prévues non faites, tâches faites à plusieurs, message de retour. Activé pour tous, interrupteur dans Réglages → Utilisateurs. PR #174 + activation. Voir « CR-3 ». |
| 8 | CR-4 — Dictée vocale et IA | ✅ En ligne | 2026-10-25 | « Raconter ma journée au micro » : reconnaissance vocale du navigateur (repli : micro du clavier), l'IA propose tâches, états, temps, remarque reformulée et matériel ; l'ouvrier relit et envoie ; rien de prérempli sans certitude ; texte dicté d'origine toujours joint (visible à la validation) ; micro aussi dans la recherche du phasage, la tâche créée et la remarque ; photo de fin de journée recommandée. Migration additive (2 colonnes). Coût estimé : 1,5 à 3 € / mois. Voir « CR-4 ». |
| 9 | CR-5 — Refonte de la page de validation | ✅ En ligne | 2026-10-25 | Page de la journée (résumé, écarts en clair, couleurs, « Valider » direct pour un compte rendu comme prévu, arbitrage d'une tâche faite à plusieurs, comptes rendus non envoyés), détail en grand (budget de chaque tâche, colonne latérale, « Valider et passer au suivant »), répartition d'une tâche regroupée avec compteur. Aucune migration. PR #177 à #179. Voir « CR-5 » et « Compte rendu final du projet ». |
| 10 | CR-6 — Parcours unique du compte rendu et correctifs | ✅ En ligne | 2026-10-26 | Ajoutée par Loris le 26/10 après relecture. Cinq mises en ligne (PR #184, #186, #188, #190, #192), aucune migration, aucun droit modifié. **6A en ligne** (#184) : liste des tâches prévues tout de suite, état obligatoire jamais prérempli, « J'ai fait autre chose », proposition pour une ligne du planning non liée. **6B en ligne** (#186) : écart orange « avancement incohérent » à la validation (seuils dans Admin), avancement retenu gardé au rechargement ; pas repris au Bilan (expliqué). **6C en ligne** (#188) : compteur de lignes liées, proposition en un clic, proposition dès la saisie ; liaison des anciennes lignes = question ouverte. **6D en ligne** (#190) : classement en masse des tâches hors devis (Phasage → Hors devis → « Classement en masse ») et des commandes sans lot (Commandes → « Lignes sans lot »). **6E en ligne** (#192) : trois indicateurs sur la page « Qualité des comptes rendus ». Voir « CR-6 » et « Compte rendu final de CR-6 ». |

### Journal des décisions

- **24/10/2026 — Étape 1 trouvée non en ligne.** Au démarrage de l'étape 2, les
  quatre parties de l'étape 1 (1A à 1D) étaient prêtes mais pas fusionnées, leurs
  3 migrations pas appliquées, et la reconstitution du passé du journal
  d'avancement pas faite. Réponse de Loris : tout mettre en ligne — fusion des
  quatre parties, les 3 migrations, et la reconstitution du passé (simulation :
  4 796 lignes).
- **24/10/2026 — Migrations des étapes suivantes.** Réponse de Loris : une
  migration purement additive (création de table, de colonne, d'index) est
  appliquée sans lui demander, après vérification (règles de `CLAUDE.md`). Une
  migration qui supprime, renomme ou réécrit des données reste soumise à son
  accord.
- **24/10/2026 — Droits posés par les migrations de l'étape 1.** Les
  migrations de l'étape 1 avaient été présentées à tort à Loris comme
  « purement additives » : elles posaient aussi des règles d'accès réservées
  au bureau sur les nouvelles tables et remplaçaient les 2 fonctions
  d'enregistrement du phasage (fonctions à droits élevés). Réponse de Loris :
  il confirme a posteriori, on garde tout tel quel.
- **24/10/2026 — Relevés journaliers des jours passés.** Réponse de Loris :
  accord pour recalculer les relevés journaliers depuis mai 2026 à partir du
  journal d'avancement reconstitué (ajout de relevés seulement).
- **24/10/2026 — Dérives historiques : chantiers avec reprise d'antériorité
  exclus (choix technique, étape 2).** Sur les vrais chantiers terminés,
  ARTHUR (RDC, R+1, R+2), GILDAS BAUGE 2 et MAUDUIT ont l'essentiel de leurs
  heures en « reprise d'antériorité », saisies en bloc, sans lot : leur dérive
  par lot serait fausse (×0,0 à ×0,4). Ils sont exclus du calcul des dérives
  historiques, comme un chantier repris.

- **24/10/2026 — Coefficient de la marge probable : jamais sous ×1.** Les
  dérives historiques réelles sortaient sous ×1 (Électricité ×0,40, Murs
  cloisons ×0,58), ce qui rendait la marge probable plus optimiste que la marge
  à terminaison (LOUISON APPT 3 : 15 808 € contre 11 028 €). Réponse de Loris :
  le coefficient ne descend jamais sous ×1, ni constaté ni historique (plancher
  ×1 en plus du plafond ×5). Appliqué en tête de l'étape 3 (3.0).
- **24/10/2026 — Chantier repris.** Réponse de Loris : il cochera lui-même
  « chantier repris » sur les trois TOM & CAMILLE ; rien n'est coché
  automatiquement.

- **24/10/2026 — Étape 3 : découpage ajusté (choix technique).** 3.1, 3.2 et
  3.3 sont livrées ensemble (#156) : la page d'une période n'a de sens
  qu'avec sa sélection et son export. Le prévu / réalisé et le glissement de
  la fin prévisionnelle passent en 3.5 : ils ont besoin du bilan précédent
  archivé comme référence.
- **24/10/2026 — Relevés journaliers recalculés après le plancher ×1 (choix
  technique, même accord que le recalcul de l'étape 2).** 3 686 relevés
  recalculés (12/05 → 24/10) avec le code en ligne, après sauvegarde complète
  dans `chantier_releves_journaliers_sauvegarde_20261024b` (3 686 lignes,
  réservée au serveur). Production et marge à l'avancement inchangées sur les
  3 686 ; marge probable modifiée sur 2 368 relevés, toujours à la baisse
  (au plus −5 379 €) ; ventilation des coûts par nature remplie partout.
- **24/10/2026 — Tendances par lot : un lot sans aucune heure pointée est
  exclu (choix technique).** Sur les chantiers terminés, des lots ont 0 h
  rattachée (heures saisies en bloc ou ailleurs) : ils tiraient la moyenne
  vers ×0 (Électricité ×0,5, Finitions ×0).
- **24/10/2026 — Questions posées à Loris (en attente).** (1) Créer la table
  d'archive des bilans exportés, lisible et modifiable par le bureau
  seulement (droits d'accès → son accord) ; (2) arrêter les deux relevés du
  vendredi et garder leurs tables en lecture seule.

- **24/10/2026 — Table d'archive des bilans.** Réponse de Loris : OUI pour
  créer `bilans_exports`, lisible et modifiable par le bureau seulement
  (mêmes règles que `achats_lots_termines` + « réservé aux collaborateurs »).
  Réserve du pilote : le stockage « chantier-documents » est lisible par tous
  les collaborateurs, ouvriers compris → les bilans n'y sont PAS rangés ; le
  document exporté (HTML, qui redonne le PDF) est gardé dans la table
  elle-même. Un bilan figé ne se modifie pas : le bureau peut lire et
  ajouter, pas modifier ni supprimer.
- **24/10/2026 — Migration `20261024180000_bilans_exports` non appliquée.**
  L'application de la migration (qui pose des règles d'accès) a été refusée
  par le garde-fou des autorisations de Claude Code ; elle n'a pas été
  contournée. 3.5 attend qu'elle soit appliquée (par Loris ou après
  autorisation) avant d'être fusionnée.
- **24/10/2026 — Relevés du vendredi : option A.** Réponse de Loris : arrêter
  les deux tâches du vendredi (relevé hebdomadaire `chantier_snapshots_hebdo`
  et historique d'avancement `chantier_avancement_history`) APRÈS avoir
  basculé leurs derniers lecteurs sur les relevés journaliers ; garder les
  deux tables en lecture seule pour l'historique, rien supprimé (si la
  lecture seule exige une migration de droits, on ne la fait pas : arrêter les
  écritures suffit). Ordre : (1) bascule des lecteurs, (2) arrêt des tâches,
  (3) compléments du cahier des charges (commandes à passer et livraisons
  dans « La semaine qui vient », glissement de la fin prévisionnelle).
- **État au 24/10/2026 (fin de session du sous-agent étape 3).** (1a) États
  financiers (colonne Terrain) et export Opérations (historique d'avancement,
  un point par semaine) lisent les relevés journaliers : PR « bascule des
  lecteurs ». (1b) RESTE : l'assistant IA (`api/_ia/renovation/outils.js`,
  `calculerAlertes` et l'historique d'`expliquer_alerte`, + table autorisée
  dans `donnees.js`) et les données de test de
  `verif-renovation-copilot-v1` (table `chantier_snapshots_hebdo` → relevés
  journaliers, test du doublon W31 à adapter). (2) et (3) : pas commencés.
  3.5 (#161, brouillon) attend l'application de la migration
  `bilans_exports`, gérée par le pilote avec Loris.
- **24/10/2026 — Migration `bilans_exports` appliquée par Loris** dans
  l'éditeur SQL de Supabase (la voie automatique était refusée), puis
  enregistrée comme appliquée ; Loris a aussi exécuté le retrait des droits
  de modification / suppression (`revoke update, delete, truncate`), vérifié
  par le pilote (les utilisateurs connectés n'ont plus que lecture et ajout).
  3.5 en ligne (#161).
- **24/10/2026 — Étape 3 terminée.** (1b) assistant IA et onglet « Détail des
  comptes rendus » sur les relevés journaliers (#164) ; (2) les deux tâches du
  vendredi n'ont plus de déclenchement automatique, lancement manuel gardé,
  tables conservées sans migration (#165) ; (3) commandes à passer et
  livraisons attendues dans « La semaine qui vient », fin prévisionnelle et
  glissement (#166). Choix faits : « livraison attendue » = matériau marqué
  « commandé le » par la page Commandes à passer sans réception saisie (la
  base n'a pas de date de livraison prévue) ; « à commander » = matériaux non
  commandés des ouvrages dont la date de besoin tombe au plus tard le dernier
  jour de la semaine qui vient (retards compris). La règle d'un ouvrage est
  extraite dans `commandesOuvrageV1.mjs` et utilisée par les deux pages.
- **24/10/2026 — Étape 4 : découpage et choix techniques.** Quatre parties
  mises en ligne une par une : 4A validation de fin de journée (choix du cas
  A / B / C) ; 4B phasage (mêmes choix pour les tâches existantes, question
  « Ce travail est-il facturé au client ? », avenant, geste commercial,
  ouvrage « non facturé ») ; 4C Bilan et fiche chantier (décisions attendues,
  rappel réglable, gestes commerciaux, heures par motif) ; 4D bibliothèque
  (« tâches souvent ajoutées ») — 4C et 4D livrées ensemble (#170), petites
  et sans risque l'une pour l'autre. Aucune migration : le motif, le statut
  d'arbitrage et la marque « ajoutée en cours de chantier » sont rangés dans
  la tâche du phasage, comme les autres informations de la tâche. Les tâches
  existantes restent « motif non renseigné » tant que personne ne les classe.
  Un cas B pose les heures NORMALES comme heures estimées de la tâche (son
  poids dans l'avancement) ; les heures prévues de l'ouvrage (heures du devis)
  ne bougent pas. Un cas C reste « hors devis » (coût réel, pas d'avancement,
  pas comparé aux heures prévues) jusqu'à son rattachement à un avenant.

- **24/10/2026 — CR-1 : écart d'avancement lu dans le journal, sans fonction
  SQL (choix technique).** La fonction serveur proposée le 24/10
  (`qualite_cr_avancements_valides`, lecture de l'historique des phasages)
  n'est plus nécessaire : depuis l'étape 1C, chaque validation écrit dans le
  journal d'avancement une ligne portant l'id du compte rendu. La page lit ce
  journal. Le passé reconstitué ne dit pas quelle validation a fixé quelle
  valeur (un essai sur le passé donnait 30 % de lignes « modifiées », contre
  8 % mesurés directement le 24/10 : artefact de datation) : l'indicateur
  n'est donc mesuré que pour les comptes rendus validés depuis le 24/10/2026,
  et le chiffre du passé reste celui du diagnostic. Aucune migration.

- **24/10/2026 — CR-3 : fonctions serveur des écrans ouvriers.** Réponse de
  Loris : accord pour modifier les fonctions à droits élevés qui servent le
  phasage aux téléphones (noms personnalisés, pièces, journée prévue,
  déclarations du jour des collègues), sans nouvel appelant et sans élargir
  ce qu'un ouvrier voit. Appliqué le 25/10 (migration
  `20261025090000_cr3_parcours_ouvrier`).
- **25/10/2026 — CR-3 : choix techniques.** (1) État attendu ce soir : le
  moteur de planning ne dit pas qu'une tâche « doit finir » un jour donné ;
  règle simple tirée du planning (toutes personnes) : encore planifiée après
  aujourd'hui → « en cours » (avancement attendu au prorata des heures) ;
  dernier jour planifié → « terminée ce soir », sauf si les heures du jour
  couvrent moins de la moitié du reste ; ligne sans tâche du phasage → état
  inconnu, l'ouvrier le dit. (2) Repères = 25 / 50 / 75 / 100 %, les valeurs
  des boutons du formulaire v2 ; un repère sous l'avancement actuel n'est pas
  proposé. (3) Interrupteur : `planning_config.cr_parcours_v3`, lu par les
  ouvriers via la nouvelle fonction `ouvrier_journee_cr` (aucune règle
  d'accès de `planning_config` modifiée) ; activé pour tous par défaut une
  fois le parcours complet. (4) « Métier de l'ouvrier en premier » : les lots
  où il a une tâche prévue aujourd'hui, puis ceux où il a déjà travaillé ou
  est affecté, puis les autres — déduit des données, sans nouveau réglage.
  (5) Message de retour sans « le chantier est à X % » : aucun chiffre
  d'avancement chantier n'est partagé avec l'écran ouvrier, et l'avancement
  ne bouge qu'à la validation ; en afficher un créerait un second chiffre.
  (6) Une tâche créée par l'ouvrier porte son motif (`motif_hd`) et la
  validation présélectionne le cas A / B / C (modifiable).
- **25/10/2026 — CR-4 : choix techniques.** (1) Transcription : la
  reconnaissance vocale du navigateur (gratuite, aucun nouveau service ni
  nouvelle clé) ; repli : le micro du clavier dans le même champ texte (voir
  le compte rendu CR-4). (2) Une seule tâche IA `cr_dictee` sur la route
  existante `/api/ai` (aucune nouvelle fonction serveur : 11 / 12), modèle
  claude-haiku-4-5, rôles ouvrier / admin / conducteur, quotas et
  coupe-circuit existants ; les tâches proposées viennent du phasage déjà sur
  le téléphone (aucune donnée nouvelle exposée). (3) Sortie validée par le
  même module des deux côtés (`dicteeCrV1.mjs`) ; seules les propositions
  « sûres » d'une réponse non ambiguë sont préremplies, les autres restent
  des suggestions à toucher. (4) Texte d'origine + remarque reformulée dans
  une nouvelle colonne `rapports.dictee` ; la remarque relue par l'ouvrier
  reste dans `remarque` (lue par la chaîne existante sans changement). (5)
  Sans réseau au moment de la dictée : l'ouvrier remplit à la main ; à
  l'envoi, la remarque est remise au propre (12 s au plus, sinon envoi sans),
  marquée « non relue par l'ouvrier ». (6) Photo de fin de journée : colonne
  `photos_fin_journee` ET ajoutée aux photos du chantier (tous les lecteurs
  existants la voient, Bilan compris). (7) Demande de matériel détectée :
  ouvre la demande de matériel existante avec la recherche préremplie
  (l'ouvrier choisit l'article et la quantité).

- **25/10/2026 — CR-5 : choix techniques.** (1) Écarts et couleurs calculés par un module pur (`validationJourneeV1.mjs`) ; rouge = bloquée, tâche créée, heures sans tâche du phasage ; orange = dépassement, prévue non faite, désaccord avec un collègue, tâche déjà terminée, journée hors norme, ouvrier non planifié, total différent de l'attendu. (2) « Valider » direct = la validation de la fenêtre sans retouche, réservé aux comptes rendus comme prévu dont chaque ligne est rattachée à une tâche du phasage suivie en pourcentage. (3) Comptes rendus non envoyés : la fonction des relevés journaliers (`comptesRendusAttendus`), pour que « non envoyé » ici = « journée incomplète » au Bilan. (4) Avancement retenu d'une tâche faite à plusieurs : gardé par la page tant qu'elle est ouverte, appliqué aux comptes rendus validés ensuite (aucune nouvelle table). (5) Coût d'un dépassement : heures en trop × (coût moyen d'une heure de main-d'œuvre sur la tâche, à défaut le taux de l'ouvrier, + frais généraux du jour). (6) Compteur des tâches regroupées : module du suivi qualité (CR-1) sur les comptes rendus validés du mois. (7) Trois mises en ligne : journée (#177), détail (#178), répartition (#179).

- **26/10/2026 — Retouche du PDF du Bilan (réponses de Loris après lecture du PDF W43).**
  (1) Tableau des chantiers de la version direction : « Devis → probable » —
  avancement, vendu HT, marge devis (€ et % du vendu), marge probable (€ et %),
  écart marge probable − marge devis, évolution de la marge probable sur la
  période, € produits par heure avec le repère du devis (vendu HT ÷ heures
  prévues). Les marges à l'avancement, à terminaison et de la période par
  chantier passent dans la version détaillée (« Détail des marges »).
  (2) Alertes en tableau (chantier, problème, heures, effet sur la marge), au
  plus 3 points par chantier triés par montant ; lot déjà terminé en dérive,
  heures sans lot et dépassements d'enveloppe sous 500 € (nouveau réglage
  Admin) : version détaillée seulement. Les règles d'alerte ne changent pas
  (page Alertes, assistant IA inchangés). (3) Bandeau : production, marge de
  la période en € et en % de la production, marge probable totale face à la
  marge devis totale (€ et % du vendu, évolution sur la période), heures
  validées avec € produits par heure face au repère du devis ; comptes rendus
  non validés seulement s'il y en a. (4) Journées incomplètes et chantiers sans
  activité résumés en une ligne (détail en version détaillée). Tendances par
  lot et semaine qui vient : inchangées. Choix techniques : la « marge devis »
  est la « Marge prév. » qui existait déjà dans le Phasage (même fonction,
  `margePrevueDevis` de chantierFinance), relue dans le Bilan depuis les
  colonnes des relevés journaliers (vendu, MO prévue, matériaux prévus,
  heures prévues) + frais généraux au taux de la date du relevé ; pas de
  migration. La référence financière figée du Point 5 n'a pas été reprise :
  c'est une série mensuelle pour le diagramme, pas une marge de devis par
  chantier. Un chantier dont les ouvrages n'ont aucun matériau prévu (21
  relevés sur 45 au 22/10, dont les trois TOM & CAMILLE) voit sa marge devis
  affichée avec « sans matériaux prévus », sans écart, et hors du total du
  bandeau (elle serait trop belle).

- **26/10/2026 — Version détaillée du Bilan, fiches chantier (réponses de Loris
  après lecture du PDF détaillé W43).** Plan du PDF inchangé (page 1 = direction,
  « Détail des marges », alertes complètes, décisions, tendances, semaine qui
  vient, fiches, méthode) ; pas d'alertes ni de prévu / réalisé dans les fiches.
  En tête de chaque fiche : « Du devis au probable », étape par étape, en € et
  en % du vendu. Lots utiles seulement (les autres en « À venir »), « Sans lot »
  en heures seulement, lot terminé sans coefficient ; matériaux lot par lot.
  Choix techniques : la décomposition est calculée dans chantierFinance
  (`cascadeMargeDevisReleve`) À PARTIR DU SEUL relevé de fin (mêmes colonnes
  que les marges, aucun recalcul des coûts) ; elle tombe exactement sur la
  marge à terminaison et la marge probable (vérifié sur les 45 relevés réels du
  22/10 : aucun « autres écarts »). Le détail des matériaux par lot réutilise
  les deux fonctions de la marge (`resteACommanderEnveloppes`,
  `materiauxImputesALAvancement`, réunies dans `materiauxParLot`) sur les
  données arrêtées à la date du relevé, et n'est affiché que s'il retombe sur
  les totaux du relevé à 1 € près — sinon la fiche dit pourquoi (pas de
  colonne ajoutée aux relevés, pas de migration, pas de recalcul des relevés).
  Correction : la ligne « Sans lot » du tableau des lots lisait les seules
  heures des ouvrages sans lot (38,9 h pour FOURMOND 001) quand l'encadré
  lisait les heures sans lot complètes (40,4 h : + heures libres et indirectes
  hors trajets) ; la ligne lit désormais la même colonne que l'encadré.

- **26/10/2026 — CR-6 ajoutée par Loris : le projet est rouvert.** Après
  relecture, Loris remplace les deux branches du compte rendu par un parcours
  unique (C1 révisé, C4 supprimé, trois idées ajoutées aux décisions écartées)
  et demande des correctifs (écart « avancement incohérent », planning lié au
  phasage, classement en masse, suivi qualité, avancement retenu gardé).
  Mêmes règles que le reste du projet : migration purement additive sans
  attendre, le reste avec son accord ; mise en ligne normale.
- **26/10/2026 — CR-6 : découpage (choix du pilote).** Cinq mises en ligne,
  chacune en ligne avant la suivante : **6A** parcours unique (cahier §1) ;
  **6B** écart « avancement incohérent » à la validation, seuils dans Admin,
  Bilan si simple, et avancement retenu gardé au rechargement (§2 et §6, tous
  deux dans la validation) ; **6C** lignes du planning non liées au phasage
  (§3) ; **6D** outils de classement en masse (§4) ; **6E** indicateurs de la
  page « Qualité des comptes rendus » (§5) et compte rendu final de CR-6. Les
  outils de classement en masse sont placés dans des pages existantes (pas de
  nouvelle page, donc pas de changement de `src/access.js`).
- **26/10/2026 — CR-6 : tâche prévue sans heures et sans état (question de
  Loris « dis-moi si tu vois mieux »).** Retenu tel que proposé : elle part
  comme « pas commencé », c'est-à-dire 0 h et avancement du phasage INCHANGÉ
  (c'est déjà ce que la chaîne fait de « Pas commencé » : statut `non_faite`,
  jamais de recul d'avancement), sans motif. À la validation, elle apparaît en
  « prévue, pas faite » (écart orange). Précision d'affichage : pour une tâche
  déjà avancée, le bouton s'écrit « Pas avancé aujourd'hui » plutôt que « Pas
  commencé » (même effet), pour ne pas laisser croire qu'on remet la tâche à
  zéro.
- **29/10/2026 — Une seule base d'heures : l'ouvrage (décisions de Loris).**
  Constat sur FOURMOND 102 (Électricité : 36,49 h « attendues ») : les heures
  attendues partaient des heures de l'ouvrage, les heures restantes des
  heures des tâches, qui ne concordaient pas (tâches à 55,9 h pour un ouvrage
  de 49 h, % à 106 %) ; 104 ouvrages sur 516 n'ont pas des % à 100. Décisions :
  (1) les heures prévues de l'ouvrage font foi ; chaque tâche d'origine devis
  en reçoit sa part selon son %, ramené à 100 % dans le calcul (aucune donnée
  réécrite) ; l'avancement d'un LOT est pondéré par les heures prévues de ses
  ouvrages (le chantier reste pondéré par le prix : part du vendu réalisée) ;
  la production reste prix × avancement, ouvrage par ouvrage ; (2) la
  bibliothèque reste la source des heures prévues, mais des heures saisies à
  la main dans le phasage font foi partout et ne sont JAMAIS écrasées par un
  report (heures_prevues_source « manuel ») ; la provenance s'affiche ;
  (3) une tâche de reprise ne fait pas avancer l'ouvrage — critère retenu :
  la nature « Reprise » déjà proposée au phasage et à la validation (aucune
  tâche ne la porte aujourd'hui ; rien n'est deviné d'après le nom) ;
  (4) les % des tâches d'origine devis font toujours 100 % : total affiché,
  enregistrement refusé sinon, « ajuster la dernière tâche » / « répartir
  l'écart », suppression qui rééquilibre ; hors du total : hors devis, cas B
  (heures normales) et reprises. Les 104 ouvrages existants ne sont pas
  réécrits : signalés dans le phasage avec le bouton de correction. Une
  correction en masse serait une réécriture de données (accord + sauvegarde).
- **29/10/2026 — Mise en ligne de la base d'heures unique (réponses de Loris
  à l'avant/après réel).** (1) OUI à la mise en ligne et au recalcul des
  relevés journaliers passés (depuis mai), après sauvegarde datée — Loris a
  validé les 6 chantiers qui varient de plus de 500 € (effet voulu : les % à
  106-129 % gonflaient le reste à faire, ceux à 77-80 % le réduisaient) ;
  (2) les 89 ouvrages (31 chantiers) hors 100 % ne sont PAS corrigés en masse :
  Loris corrige lui-même les modèles de la bibliothèque en cause (MU-001,
  MU-002, E-002, MU-021, PL-002…) puis « Appliquer à tous les chantiers » ;
  (3) OUI pour aligner l'écran ouvrier : `ouvrier_mes_phases` calcule
  l'avancement d'ouvrage comme le bureau (base = heures de l'ouvrage, % ramenés
  à 100) sans jamais envoyer au téléphone les % ni des montants ; mêmes
  conditions que l'accord CR-3 (aucun nouvel appelant, corps comparé à la
  production, un ouvrier ne voit que ce qu'il voyait).

### Comptes rendus des étapes

_(Ajouter ici, pour chaque étape terminée, le compte rendu en langage métier.)_

#### Vérification de l'étape 1 (24/10/2026, début de l'étape 2)

**Ce qui a été trouvé.** Le document indiquait l'étape 1 comme terminée. En
réalité, ses quatre parties étaient prêtes et vérifiées, mais aucune n'était
en ligne : rien de fusionné, aucune des 3 migrations appliquée, pas de
reconstitution du passé. Loris a donné son accord pour tout mettre en ligne.

**Ce qui est maintenant en ligne (24/10/2026).**
- 1A — Frais généraux : un seul taux pour l'entreprise, daté, réglé dans
  Réglages. Le réglage n'a encore jamais été enregistré : l'application
  applique le taux par défaut (17,44 €/h depuis le 01/01/2026). Le champ par
  phasage n'est plus lu.
- 1B — Commandes : nature de chaque coût (les 1 692 lignes existantes sont
  « matériaux »), lot obligatoire à la saisie, lots « achats terminés »,
  reste à commander calculé lot par lot (même calcul dans Commandes à passer et
  dans la marge à terminaison).
- 1C — Journal d'avancement daté : chaque changement d'avancement d'une tâche
  est enregistré avec sa date de réalisation, par un seul mécanisme en base
  qu'aucun écran ne peut contourner. Point de départ : 3 151 tâches. Le passé a
  été reconstitué depuis l'historique des phasages : **4 796 lignes**, 45
  chantiers, du 12/05/2026 au 24/10/2026, cohérentes à 100 % avec l'état
  actuel des tâches (3 151 sur 3 151). La reconstitution n'a fait qu'ajouter
  des lignes au journal (aucune donnée existante réécrite, donc pas de
  sauvegarde nécessaire). Premier contrôle de nuit lancé à la main :
  **0 écart** sur 3 151 tâches (compteur visible dans Réglages).
- 1D — Relevés journaliers : premier calcul lancé à la main, 46 relevés
  (45 chantiers au 24/10, plus FOURMOND 102 au 22/10, journée « incomplète » :
  comptes rendus de Davy et Margaux manquants). Rattrapage chaque nuit
  (21h45 UTC), contrôle du journal à 21h30 UTC ; relevés du vendredi
  conservés, déplacés à 18h30 et 18h40 UTC.

**Écarts avec le cahier des charges et points d'attention.**
- Les relevés journaliers n'existent qu'à partir du 24/10/2026 (et du 22/10
  pour FOURMOND 102) : rien n'a été recalculé pour les jours passés. Pour
  comparer « du dernier jour travaillé de la semaine précédente au dernier jour
  travaillé de la semaine courante » sur des semaines passées (dont 2026-W43),
  il faudra un rattrapage des relevés des jours passés, maintenant possible
  grâce au journal reconstitué (à prévoir aux étapes 2-3).
- 673 lignes de commande rattachées à un chantier n'ont pas de lot
  (19 682 € au total) : elles sont déduites du reste à commander global avec
  un avertissement, mais ne peuvent pas être imputées à un lot.
- La liste d'aide de « Commandes à passer » calcule encore les quantités par
  unité d'ouvrage (sans multiplier par la quantité de l'ouvrage) : défaut connu,
  non corrigé à l'étape 1.
- La colonne `marge` des relevés (journaliers et du vendredi) reste l'ancienne
  « marge nette » (vendu − coûts engagés) : c'est l'objet de l'étape 2.

#### Étape 2 — Les trois marges et les nouvelles alertes (24/10/2026, en ligne)

**Mises en ligne.** 2A (calcul des trois marges + relevés journaliers), 2B
(affichage : la « marge nette » devient « budget restant »), 2C (nouvelles
alertes). Migration `20261024160000` (nouvelles colonnes des relevés
journaliers, purement additive) appliquée et vérifiée avant 2A.

**Relevés des jours passés (accord de Loris).** 3 686 relevés journaliers
calculés pour 45 chantiers, du 12/05/2026 au 24/10/2026 (à partir du premier
jour du journal d'avancement de chaque chantier). Les 46 relevés qui
existaient ont été recalculés avec les nouvelles colonnes, après sauvegarde
dans `chantier_releves_journaliers_sauvegarde_20261024` (46 lignes, réservée au
serveur). 22 relevés ont un avancement « inconnu » (jours antérieurs à la
première valeur connue d'une tâche) : leurs marges restent vides, jamais 0.
82 journées sont « incomplètes » (comptes rendus attendus manquants ou non
validés).

**Ce qui change pour Loris et les conducteurs.**
- Chaque chantier affiche trois marges : **à l'avancement** (le constat :
  production exacte − coûts imputés), **à terminaison** (si le reste suit le
  devis, calcul inchangé) et **probable** (si on continue au rythme actuel).
  L'ancienne « marge nette » s'appelle **budget restant** et n'est plus
  présentée comme une marge nulle part (Phasage, Bilan, Opérations et son PDF,
  Chantiers, assistant IA, relevés).
- Matériaux **imputés à l'avancement** de chaque lot : un achat anticipé dans
  l'enveloppe est « en avance sur chantier » ; un dépassement compte tout de
  suite ; un lot terminé impute tout.
- **Marge de la semaine** = marge à l'avancement fin − début : les semaines
  s'additionnent exactement à la marge cumulée.
- **Phasage** : détail de la marge probable lot par lot (dérive en heures et en
  euros, coefficient et provenance), bouton « Neutraliser… » (commentaire
  obligatoire, réversible), case « Chantier repris » dans Suivi direction.
- **Alertes** (Bilan, page Alertes) : sur les relevés journaliers, une ligne par
  chantier avec toutes ses alertes chiffrées ; plus de phrase grise répétée ;
  « perte de marge » supprimée.
- **Réglages → Taux horaires → « Marge probable et alertes »** : tous les
  seuils (défauts : dérive appliquée à partir de 25 % d'avancement, plafond ×5,
  historique sur 2 chantiers minimum, baisse de marge probable 500 €, lot à
  ×1,3 dès 25 %, 10 % d'heures sans lot, production par heure ×2, dépassement
  d'enveloppe à partir de 100 €, consommation sans avancement : 1 point, 2 h,
  50 €) et les dérives historiques par type de lot.

**Avant / après sur les vrais chantiers** (requête sur la base du 24/10/2026 ;
semaine 2026-W43 = du dimanche 18/10 exclu au dimanche 25/10 inclus ; montants
en €). Les chantiers à 100 % ne changent pas : leur production est égale au
vendu, donc marge à l'avancement = ancien chiffre.

| Chantier | Av. | Ancienne « marge nette » | Semaine W43 avant | Semaine W43 après | Marge à l'avancement | À terminaison | Probable | Mat. en avance |
|---|---|---|---|---|---|---|---|---|
| FOURMOND 102 | 41 % | 18 424 | −736 | −1 053 | 1 243 | 5 797 | −15 | 310 |
| FOURMOND 101 | 46 % | 20 194 | −872 | −872 | 3 509 | 7 142 | 3 380 | 1 455 |
| FOURMOND 001 | 34 % | 24 063 | −270 | −146 | −35 | 9 162 | 8 971 | 2 411 |
| FOURMOND COMMUNS | 29 % | 4 416 | 0 | 0 | 239 | 1 484 | 1 996 | 0 |
| KATHLEEN T2 | 41 % | 16 894 | +1 453 | +1 453 | 4 600 | 9 363 | 9 750 | 0 |
| MONTILLERS APPT 1 (T3) | 6 % | 30 931 | +776 | +843 | 754 | 14 489 | 17 825 | 68 |
| MONTILLERS APPT 2 (T2) | 1 % | 33 751 | −1 108 | −1 069 | −1 069 | 14 580 | 17 028 | 39 |
| MONTILLERS APPT 3 (STUDIO) | 1 % | 25 968 | −102 | −35 | −35 | 9 691 | 11 682 | 68 |
| MONTILLERS APPT 4 (T2) | 0 % | 39 218 | −393 | −306 | −306 | 15 489 | 17 196 | 87 |
| BRIOLLAY APPT 1 | 56 % | 23 817 | 0 | 0 | 12 686 | 20 587 | 23 282 | 0 |
| BRIOLLAY APPT 2 | 45 % | 26 843 | 0 | 0 | 9 580 | 22 479 | 24 524 | 0 |
| BRIOLLAY APPT 3 | 48 % | 14 472 | 0 | 0 | 5 982 | 12 788 | 13 654 | 0 |
| BRIOLLAY APPT 4 | 45 % | 15 768 | 0 | 0 | 6 310 | 13 591 | 14 586 | 0 |
| BRIOLLAY APPT 5 | 51 % | 16 518 | 0 | 0 | 7 590 | 14 462 | 15 588 | 0 |
| TOURBOUTON 101 | 36 % | 17 947 | 0 | 0 | 4 378 | 9 625 | 10 810 | 0 |
| TOURBOUTON 102 | 46 % | 14 236 | 0 | 0 | 4 819 | 8 844 | 10 658 | 0 |
| GILDAS BAUGE 2 | 91 % | 46 650 | 0 | 0 | 40 521 | 45 804 | 46 613 | 0 |
| METOIS | 97 % | 79 050 | 0 | 0 | 76 205 | 78 684 | 79 026 | 0 |
| LOUISON APPT 1 (T2) | 0 % | 31 501 | 0 | 0 | −89 | 9 153 | 12 050 | 0 |
| LOUISON APPT 3 (T4) | 0 % | 68 039 | 0 | 0 | 0 | 11 028 | 15 808 | 0 |

Explications des écarts importants :
- L'ancienne « marge nette » d'un chantier à 0-1 % (LOUISON, MONTILLERS,
  FOUGERAY) valait presque tout le vendu ; la marge à l'avancement y est de
  0 € ou légèrement négative (les premières heures n'ont rien produit).
- FOURMOND 102 : la marge probable tombe à −15 € parce que le lot « Murs
  cloison doublages » dérive à ×2,68 à 38 % d'avancement ; ses 50 h de trop
  se reportent sur les heures restantes.
- FOURMOND 001 : 2 411 € de matériaux commandés en avance (dans l'enveloppe)
  ne pèsent plus sur la marge à l'avancement, d'où une semaine W43 moins
  négative (−146 € au lieu de −270 €).
- FOURMOND 102 semaine W43 : −1 053 € au lieu de −736 € car les matériaux
  sont imputés à l'avancement réel du lot, plus à la date de commande.
- Production exacte et coûts réels : identiques à l'étape 1 sur tous les
  chantiers (écart maximal 29 € de main-d'œuvre sur TOM & CAMILLE R+2, dû à
  une tâche dont les heures anciennes ont été remplacées par des pointages).

**Alertes avant / après, semaine 2026-W43** (page Alertes, DÉPOT exclu).
- Avant (relevés du vendredi) : 8 critiques, dont 6 « perte de marge »
  (FOURMOND 101, FOURMOND 102, KATHLEEN T2, MONTILLERS APPT 1, TOM & CAMILLE
  RDC, FOURMOND 001) — KATHLEEN T2 a pourtant gagné 1 453 € cette semaine-là.
- Après (relevés journaliers) : 5 critiques — BRIOLLAY et TOURBOUTON
  CO-LIVING (marge à terminaison négative, inchangé), et marge probable en
  baisse sur FOURMOND 102 (−3 681 €), FOURMOND 101 (−3 522 €) et MONTILLERS
  APPT 2 (−1 180 €), chacune avec le lot responsable en heures et en euros.
  8 « à surveiller » (lots en dérive, heures sans lot, consommation sans
  avancement : TOM & CAMILLE R+1/R+2/RDC, FOURMOND 001, KATHLEEN T2,
  MONTILLERS APPT 1, 3 et 4). KATHLEEN T2 et MONTILLERS APPT 1 ne sont plus
  critiques : ils ont gagné de l'argent.

**Points d'attention.**
- **Dérives historiques sous ×1** (question pour Loris) : sur les chantiers
  terminés exploitables (14 BOULEVARD DU ROI RENÉ, CHALONNES ENEDIS, 8 RUE
  SAINT BLAISE, ROLAND - PLANCHER), Électricité sort à ×0,40 et Murs cloison
  doublages à ×0,58, car une bonne partie des heures n'était pas pointée sur
  les tâches. Résultat : la marge probable des chantiers peu avancés est plus
  optimiste que la marge à terminaison (ex. LOUISON APPT 3 : 15 808 € contre
  11 028 €). Les chantiers avec une reprise d'antériorité (ARTHUR RDC/R+1/R+2,
  GILDAS BAUGE 2, MAUDUIT) sont exclus de ce calcul (choix technique noté au
  journal des décisions). Faut-il ne jamais appliquer un coefficient inférieur
  à ×1 ?
- Aucun chantier n'est encore coché « repris » : TOM & CAMILLE (RDC, R+1, R+2)
  et les chantiers avec reprise d'antériorité devraient probablement l'être.
- L'assistant IA applique les nouvelles règles, mais sur le relevé du
  vendredi (pas encore de marge probable dedans) : il passera aux relevés
  journaliers avec la refonte du Bilan (étape 3).
- Le module de l'ancienne règle (`pointsAttentionV1`) n'est plus utilisé par
  l'application ; il pourra être retiré à l'étape 3 avec les relevés du
  vendredi.
- Écarts de l'étape 1 toujours ouverts : réglage des frais généraux jamais
  enregistré (17,44 €/h par défaut), 673 lignes de commande sans lot
  (19 682 €), liste d'aide de Commandes à passer non multipliée par la
  quantité d'ouvrage, une commande saisie n'est reprise dans le relevé qu'au
  rattrapage de nuit.

#### Étape 3 — Refonte du Bilan (24/10/2026, en ligne)

**Mises en ligne.** 3.0 coefficient de la marge probable jamais sous ×1
(#155) ; 3.1-3.3 Bilan d'une période, présélection, version direction
(#156) ; 3.4 version détaillée (#157, migration additive
`20261024170000_releves_couts_par_nature` appliquée et vérifiée avant
fusion) ; 3.6 décisions attendues, tendances, semaine qui vient (#158) ; 3.7
bilan de clôture (#159) ; 3.5 bilans figés, Rectifications, prévu / réalisé
(#161, migration `20261024180000_bilans_exports` appliquée par Loris) ;
bascule des derniers lecteurs des relevés du vendredi (#162 États financiers
et export Opérations, #164 assistant IA et onglet « Détail des comptes
rendus ») ; arrêt des deux tâches du vendredi (#165) ; commandes et
livraisons de la semaine qui vient, fin prévisionnelle et glissement (#166).
Scripts : `verif-bilan-periode.mjs` (96 contrôles,
données fictives) dans Verify Fondations Finance ; `verif-trois-marges`
complété (plancher ×1).

**Ce qui change pour Loris et les conducteurs (Équipe → Bilan).**
- On choisit une **semaine** (par défaut), un **mois** ou des **dates
  libres**. Le Bilan compare le relevé du dernier jour travaillé avant la
  période à celui du dernier jour travaillé de la période (W43 : du ven. 16/10
  au jeu. 22/10).
- Bandeau : production, marge de la période, évolution de la marge probable,
  heures validées, comptes rendus non validés. Synthèse par chantier avec
  pastille (légende sous le tableau), trois marges, € produits par heure,
  mentions « démarrage », « réception / levée de réserves » (avec les heures
  après réception) et « chantier repris ».
- Les chantiers ayant eu de l'activité (heures pointées ou déclarées,
  avancement, commande) sont cochés pour l'export ; les autres restent listés
  avec « aucune activité sur la période ». Les choix manuels tiennent tant
  qu'on reste sur la même période. Un avertissement liste les comptes rendus
  non validés et les journées incomplètes.
- **Version direction** (par défaut, 2 pages sur W43) : jamais aucun
  commentaire d'ouvrier. **Version détaillée** (case à cocher) : une fiche par
  chantier (lots avec écart en heures et en euros et provenance du
  coefficient, ligne « sans lot » au-delà de 10 %, matériaux commandés /
  imputés / en avance / reste à commander + coûts par nature, tâches résumées
  par lot puis détail, présences, 1-2 photos choisies, synthèse proposée par
  l'IA et relue, commentaires cochés) + annexe « Méthode de calcul ».
- Page 2 : alertes de l'étape 2, décisions attendues (rappel des blocages
  limité à 4 semaines ; propositions « Retenir / Écarter » : tâches en cours
  depuis 3 semaines, comptes rendus qui parlent d'une attente), tendances par
  lot, semaine qui vient (calculée à l'ouverture : équipe, jours, heures,
  tâches, matériaux à commander et livraisons attendues par chantier).
- **Bilans figés** : chaque PDF téléchargé est archivé (chiffres + document)
  et ne change plus ; une donnée arrivée après coup sur une période déjà
  exportée apparaît dans « Rectifications » du bilan suivant (chantier,
  période, montant, cause). **Prévu / réalisé** : heures prévues par le
  planning au bilan précédent face aux heures validées. **Fin
  prévisionnelle** : date de fin prévue de chaque chantier et glissement en
  jours depuis le bilan précédent (« au-delà de l'horizon du planning » ou
  « pas de bilan précédent » quand on ne sait pas — jamais « 0 jour »).
- **Relevés du vendredi arrêtés** : toute l'application (Bilan, Alertes,
  États financiers, export Opérations, assistant IA) lit les relevés
  journaliers ; les anciens relevés du vendredi restent enregistrés pour
  l'historique et peuvent être relancés à la main.
- Bilan de clôture des chantiers à 100 % (pas pour un chantier repris) :
  devis / réel par lot et ouvrage, marge finale, cadences de la bibliothèque à
  revoir (écart de plus de 15 %), sans rien modifier automatiquement.
- Retirés : « Tâches » du bandeau, « Situation à facturer », la marge nette
  (déjà à l'étape 2), les phrases grises qui répètent la ligne (étape 2).
  L'ancien détail des comptes rendus (et son brouillon d'e-mail) reste dans
  l'onglet « Détail des comptes rendus ».

**PDF de la semaine 2026-W43 sur les vraies données** (dumps de la base du
24/10/2026, modules de l'application, état par défaut de la page : aucun choix
manuel, aucune décision retenue, aucune synthèse ni photo ni commentaire
choisis ; rendu par Chrome au lieu de html2pdf, même HTML) : direction
2 pages, détaillée 8 pages. Chiffres W43 : 11 chantiers avec activité,
production 9 152 €, marge de la période −327 €, marge probable −9 367 € sur
la période, 232,8 h validées, 0 compte rendu non validé, 16 journées
incomplètes (FOURMOND, MONTILLERS, TOM & CAMILLE), 11 chantiers avec au moins
une alerte. Lot qui dérive le plus : Menuiserie (×1,61, 52 h, 1 947 €).
La section « semaine qui vient » n'est pas calculée dans ce PDF généré hors de
l'application (elle l'est dans la page).

**Fichiers PDF W43** (vraies données, générés le 24/10 avant 3.5) :
`C:\Users\franz\AppData\Local\Temp\claude\c--Users-franz-Documents-AppProfero-Planning-Chantiers\4159b5ef-ac44-4c33-93a9-2dca97e1961a\scratchpad\Bilan-2026-W43-direction.pdf`
et `…\scratchpad\Bilan-2026-W43-detaille.pdf` (dossier temporaire de la
session : les régénérer depuis la page Bilan si besoin).

**Migrations de l'étape.** `20261024170000_releves_couts_par_nature`
(colonne ajoutée, appliquée après vérification) ;
`20261024180000_bilans_exports` (nouvelle table réservée au bureau, accord
de Loris, appliquée par Loris + retrait des droits de modification et de
suppression). Aucune autre migration ; les tables des relevés du vendredi
sont gardées telles quelles.

**Points d'attention.**
- Premier bilan exporté : « Prévu / réalisé » et le glissement de la fin
  diront « pas de bilan précédent » jusqu'à ce qu'un premier bilan ait été
  téléchargé (c'est lui qui sert de référence au suivant).
- « Livraisons attendues » repose sur la marque « commandé le » posée par la
  page Commandes à passer : une commande passée autrement n'y figure qu'à sa
  saisie.
- Les tendances et les dérives historiques restent faussées par les heures
  mal rattachées des anciens chantiers ; TOM & CAMILLE ne sont pas encore
  cochés « repris » (Loris le fera).
- L'emplacement « tâches hors devis à arbitrer » des décisions attendues est
  prêt mais vide : l'étape 4 le remplit (`suggestionsDecisionsV3` et la page).
- Code mort laissé en place (aucun appel) : `pointsAttentionV1`, les
  fonctions de dédoublonnage des relevés du vendredi et les deux routes
  `api/cron-snapshot-*.js` (gardées pour un relancement manuel).

#### Étape 4 — Tâches hors devis (24/10/2026, en ligne)

**Ce qui change pour les conducteurs (et pour Loris).**
- **Validation de fin de journée** : quand un ouvrier propose une tâche qui
  n'est pas dans le phasage (ou quand le conducteur clique « + Créer »), un
  bloc « Quel cas ? » demande ce que c'est :
  - **A — elle existait** : l'application propose les tâches les plus
    probables (nom proche, prévue ce jour-là, même lot) ; un clic rattache
    les heures à la tâche existante, rien n'est créé ;
  - **B — imprévu dans un ouvrage vendu** : la tâche est créée dans l'ouvrage
    choisi, marquée « ajoutée en cours de chantier », avec ses heures
    NORMALES (proposées par la bibliothèque quand une étape du modèle porte
    un nom proche, sinon saisies) ; la validation est refusée tant qu'elles
    manquent. Les heures prévues de l'ouvrage ne bougent pas : la dérive
    reste visible ;
  - **C — non vendu** : la tâche va dans « Divers / hors devis », « à
    arbitrer ». Sans cas choisi, tout se passe comme avant.
- **Phasage** : bouton « Hors devis · N » en haut (rouge s'il reste des
  tâches à arbitrer). Toutes les tâches hors devis du chantier, anciennes
  comprises, avec heures, coût (main-d'œuvre + frais généraux) et un cas
  proposé. « Classer » pose d'abord la question « Ce travail est-il facturé
  au client ? » : oui dans le devis → A (les heures passent sur la tâche
  existante, la tâche hors devis disparaît) ou B ; oui par un avenant →
  rattachement à l'ouvrage d'avenant chiffré (il produit ; les relevés sont
  recalculés depuis le premier jour déclaré, et si ces jours sont dans un
  bilan déjà exporté, l'écart sort dans « Rectifications ») ; non → geste
  commercial (un coût sans production) ; pas encore décidé → à arbitrer. Un
  ouvrage sans prix peut être marqué « non facturé ».
- **Bilan** : « Décisions attendues » propose, par chantier, les tâches à
  arbitrer avec heures et coût (Retenir / Écarter), en rouge au-delà de 3
  semaines sans décision. Version détaillée : total des gestes commerciaux de
  la période, et par chantier les heures hors devis par cas.
- **Fiche chantier** (page Chantiers, sous « Total chantier ») : heures hors
  devis par cas, à arbitrer, gestes commerciaux, avenants.
- **Bibliothèque** : encart « Tâches souvent ajoutées en cours de chantier »
  dans un ouvrage (au moins 2 chantiers, chantiers repris exclus), bouton
  « Ajouter au modèle » (étape à 0 %, à répartir).
- **Admin** → Taux horaires → « Marge probable et alertes » → « Tâches hors
  devis » : rappel au-delà de **3 semaines** (défaut).

**Mises en ligne** : #168 (4A validation + module), #169 (4B phasage),
#170 (4C Bilan / fiche / Admin + 4D bibliothèque). **Aucune migration** : le
cas, le statut d'arbitrage et la marque « ajoutée en cours de chantier » sont
rangés dans la tâche du phasage. Contrôle `verif-hors-devis-v2.mjs` (63
contrôles, données fictives) branché dans « Verify Fondations Finance » :
les 6 cas demandés (A sans nouvelle tâche ni double production ; B à 1 h
normale pour 3 h réelles ; C en avenant dans une semaine exportée →
Rectifications de 600 € ; C en geste commercial, coût sans production ;
rappel au-delà de 3 semaines ; tâche souvent ajoutée proposée) et plus.

**Les vraies tâches hors devis, chantier par chantier** (requête sur la base
du 24/10/2026 : tâches cochées hors devis ou rangées dans « Divers / hors
devis » ; coût = heures × taux horaire chargé de l'ouvrier + frais généraux
au taux par défaut 17,44 €/h, le barème n'ayant jamais été enregistré ; cas
proposé automatiquement par l'application, aucune n'est encore classée) :

| Chantier | Tâches | Heures | Coût (MO+FG) | A proposé | B proposé | C proposé | Standard |
|---|---|---|---|---|---|---|---|
| TOM & CAMILLE R+2 | 47 | 173,5 h | 5 941 € | 0 · 0 h | 0 · 0 h | 39 · 142 h | 8 · 31,5 h |
| BRIOLLAY | 43 | 165,3 h | 6 165 € | 0 · 0 h | 0 · 0 h | 36 · 143,3 h | 7 · 22 h |
| TOM & CAMILLE R+1 | 45 | 128,2 h | 4 709 € | 4 · 9,5 h | 0 · 0 h | 35 · 99,7 h | 6 · 19 h |
| TOM & CAMILLE RDC | 47 | 126,8 h | 4 769 € | 2 · 1 h | 1 · 1 h | 38 · 99,3 h | 6 · 25,6 h |
| METOIS | 41 | 92,7 h | 3 448 € | 1 · 3,5 h | 0 · 0 h | 38 · 86,3 h | 2 · 2,9 h |
| MAUDUIT | 31 | 65,3 h | 2 479 € | 5 · 0 h | 0 · 0 h | 23 · 60,3 h | 3 · 5 h |
| ARTHUR - R+1 | 16 | 56 h | 1 542 € | 1 · 0,5 h | 0 · 0 h | 13 · 52,3 h | 2 · 3,3 h |
| ARTHUR - RDC | 23 | 53 h | 1 815 € | 1 · 0 h | 0 · 0 h | 19 · 49,8 h | 3 · 3,3 h |
| TOURBOUTON CO-LIVING | 30 | 42,3 h | 1 551 € | 0 · 0 h | 0 · 0 h | 27 · 36,3 h | 3 · 6 h |
| FOURMOND 001 | 17 | 38,9 h | 1 367 € | 0 · 0 h | 0 · 0 h | 13 · 26,4 h | 4 · 12,5 h |
| TOURBOUTON 101 | 11 | 36,8 h | 1 380 € | 1 · 0,5 h | 0 · 0 h | 7 · 24,5 h | 3 · 11,8 h |
| FOURMOND 101 | 9 | 22,3 h | 792 € | 0 · 0 h | 0 · 0 h | 7 · 19,3 h | 2 · 3 h |
| BRIOLLAY APPT 2 | 9 | 21,8 h | 717 € | 0 · 0 h | 0 · 0 h | 7 · 13,3 h | 2 · 8,5 h |
| KATHLEEN T2 | 5 | 20 h | 758 € | 0 · 0 h | 0 · 0 h | 5 · 20 h | 0 · 0 h |
| BRIOLLAY APPT 1 | 4 | 15,5 h | 519 € | 0 · 0 h | 0 · 0 h | 1 · 2,5 h | 3 · 13 h |
| BRIOLLAY APPT 5 | 4 | 15 h | 561 € | 0 · 0 h | 0 · 0 h | 3 · 12 h | 1 · 3 h |
| FOURMOND 102 | 4 | 15 h | 576 € | 0 · 0 h | 0 · 0 h | 3 · 14,5 h | 1 · 0,5 h |
| FOURMOND COMMUNS | 6 | 14,8 h | 591 € | 0 · 0 h | 0 · 0 h | 4 · 7 h | 2 · 7,8 h |
| BRIOLLAY APPT 3 | 4 | 13,2 h | 508 € | 0 · 0 h | 0 · 0 h | 4 · 13,2 h | 0 · 0 h |
| ARTHUR - R+2 | 15 | 11,8 h | 425 € | 2 · 0,5 h | 0 · 0 h | 10 · 10,8 h | 3 · 0,5 h |
| BRIOLLAY APPT 4 | 5 | 11,3 h | 430 € | 0 · 0 h | 0 · 0 h | 3 · 5 h | 2 · 6,3 h |
| TOURBOUTON 102 | 5 | 9 h | 288 € | 0 · 0 h | 0 · 0 h | 5 · 9 h | 0 · 0 h |
| ROLAND - PLANCHER | 1 | 5,3 h | 153 € | 0 · 0 h | 0 · 0 h | 0 · 0 h | 1 · 5,3 h |
| MONTILLERS APPT 1 (T3) | 1 | 4 h | 146 € | 0 · 0 h | 1 · 4 h | 0 · 0 h | 0 · 0 h |
| CHALONNES ENEDIS | 1 | 3 h | 126 € | 0 · 0 h | 0 · 0 h | 1 · 3 h | 0 · 0 h |
| MONTILLERS APPT 3 (STUDIO) | 2 | 2,5 h | 91 € | 0 · 0 h | 1 · 1 h | 0 · 0 h | 1 · 1,5 h |
| MONTILLERS APPT 4 (T2) | 1 | 0,5 h | 18 € | 0 · 0 h | 0 · 0 h | 1 · 0,5 h | 0 · 0 h |
| GILDAS BAUGE 2 | 4 | 0 h | 0 € | 0 · 0 h | 0 · 0 h | 4 · 0 h | 0 · 0 h |
| TEST | 1 | 0 h | 0 € | 0 · 0 h | 0 · 0 h | 1 · 0 h | 0 · 0 h |
| LOU | 1 | 0 h | 0 € | 0 · 0 h | 0 · 0 h | 0 · 0 h | 1 · 0 h |

Total : **433 tâches, 1 163 h, 41 866 €**. Cas proposés : A 17, B 3, C 347,
tâches standard (nettoyage, approvisionnement, SAV… à garder telles quelles)
66.

**Points d'attention.**
- La proposition « C » est surtout un « à examiner » : sur les chantiers
  anciens (TOM & CAMILLE, BRIOLLAY, METOIS, MAUDUIT, ARTHUR), presque tout
  le travail a été saisi dans « Divers » sans tâches de devis à côté — il n'y
  a rien à quoi le rapprocher, alors que beaucoup de ces travaux étaient
  vendus (« Doublage cuisine », « Enduits »…). Rien n'est classé
  automatiquement : seul un clic du conducteur change une tâche. Les
  décisions du Bilan ne montrent que les tâches effectivement marquées « à
  arbitrer ».
- Cas A depuis le phasage : les heures sont déplacées dans les pointages
  (la tâche hors devis disparaît du phasage) ; les comptes rendus d'origine
  gardent le nom écrit par l'ouvrier.
- Rattachement à un avenant : la production compte aux jours où la tâche a
  progressé dans le journal d'avancement ; la ligne « Rectifications »
  n'apparaît que si un bilan de ces jours a été exporté.
- Réservé à CR-3 : l'écran ouvrier posera lui-même la question « Pourquoi
  elle n'est pas dans la liste ? » (introuvable / imprévu / demande du
  client) ; les données sont prêtes (`motif_hd`, `ajoutee_en_cours`,
  `arbitrage` dans la tâche).

---
#### CR-1 — Diagnostic chiffré des comptes rendus (24/10/2026, en ligne)

**Mises en ligne.** Page « Qualité des comptes rendus » et module
d'indicateurs (PR #148, 24/10) ; finitions CR-1 (écart d'avancement déclaré /
validé allumé depuis le journal d'avancement). Aucune migration.

**Qui voit la page.** Équipe → bouton « Qualité des comptes rendus » (et le
menu). Vérifié en base et dans `loadAccessConfig` : **admin oui** (ajout
automatique des nouvelles pages pour admin) ; conducteur : prévue dans sa
liste par défaut, mais la liste enregistrée en base ne la contient pas, donc
**non** tant qu'on ne la coche pas dans Admin → Accès ; commercial, comptable,
ouvrier : non.

**Le diagnostic — vraies données, 8 semaines (31/08 → 25/10/2026, base du
24/10).** 597 comptes rendus, 236 envois, 1 049 lignes avec des heures, 8
ouvriers. Ancien formulaire (v1) : 174 envois ; nouveau (cr_v2) : 62.

| Indicateur | Total | Ancien formulaire | Nouveau formulaire |
|---|---|---|---|
| Temps de remplissage (médiane / 80 %) | 13 min / 29 min | non mesurable | 13 min / 29 min |
| Envoyés en rattrapage (le lendemain) | 4 % | 5 % | 2 % |
| Avancement modifié à la validation | 8 % des lignes (écart moyen 3,5 pts) | | |
| Lignes réaffectées / découpées / heures modifiées | 2 % / 0,5 % / 2 % | | |
| Lignes sans tâche du phasage | 56 % | 63 % | 38 % |
| … dont rattachées à la main à la validation | 89 % | 88 % | 95 % |
| Tâches proposées par l'ouvrier (v2) | 9 % | — | 9 % |
| Lignes « fourre-tout » probables | 4 % | 5 % | 2 % |
| Lignes sans remarque | 62 % | 60 % | 67 % |
| Remarques très courtes (< 15 caractères) | 44 % | 30 % | 68 % |
| Tâches terminées sans photo | 65 % | 69 % | 54 % |
| Comptes rendus rouverts après validation | 2 % | 2 % | 1 % |
| Tâche faite à plusieurs : avancements différents | 30 % (écart moyen 43 pts) | 27 % | 35 % |

Heure d'envoi : 16 avant 16 h, 80 entre 16 h et 17 h, 76 entre 17 h et 18 h,
27 entre 18 h et 19 h, 28 après 19 h.

**Ce que mesure le temps de remplissage.** Le temps entre la première saisie
de la journée et l'envoi, sur le nouveau formulaire seulement (l'ancien ne
note pas l'heure de début). C'est le temps pendant lequel le compte rendu est
resté ouvert, pas le temps passé à écrire : un brouillon ouvert à midi et
envoyé le soir compte plusieurs heures. 5 envois sur 61 dépassent une heure.

**Les 5 constats les plus marquants.**
1. **Plus d'une ligne sur deux n'est rattachée à aucune tâche du phasage**
   (56 %) ; le conducteur en rattache 89 % à la main à la validation. Sur le
   nouveau formulaire, la plupart viennent de cases du planning qui n'ont pas
   de lien vers une tâche.
2. **Tâches faites à plusieurs : dans 30 % des cas, les ouvriers ne déclarent
   pas le même avancement**, avec 43 points d'écart en moyenne quand ils
   diffèrent.
3. **65 % des tâches déclarées terminées n'ont pas de photo.**
4. **Les remarques sont pauvres** : 62 % des lignes sans remarque, et sur le
   nouveau formulaire 68 % des remarques font moins de 15 caractères
   (« En cours », « À finir »).
5. **Le conducteur corrige peu** : 8 % des avancements modifiés, 2 % des
   lignes réaffectées, 0,5 % découpées, 2 % des comptes rendus rouverts. Le
   remplissage médian (13 min) n'est pas excessif ; c'est la qualité de ce qui
   est déclaré qui pose problème, plus que la durée.

**Par ouvrier (lignes sans tâche du phasage, lignes fourre-tout).** JP 100 % /
12 % ; Margaux 86 % / 4 % ; Kev 66 % / 5 % ; Davy 57 % / 2 % ; Steven 50 % /
2 % ; Selman 46 % / 3 % ; Mohamed 42 % / 9 % ; Venceslas 34 % / 3 %.
Lignes découpées à la validation (compteur prévu pour CR-5) : 5 sur la
période (Davy 2, Kev 1, Steven 1, Venceslas 1).

**Écart d'avancement déclaré / validé sur la page.** Il est maintenant lu dans
le journal d'avancement : chaque validation y écrit l'avancement retenu avec
l'id du compte rendu. Il n'est mesuré que pour les comptes rendus validés
depuis le 24/10/2026 ; avant, la page affiche « — » (aucune ligne comparable),
jamais 0. Le chiffre du passé (8 % de lignes modifiées) vient du diagnostic.

**Points d'attention.** Mesure faite avant le nouveau parcours (CR-3) : c'est
la référence « avant ». La même page donnera le « après ».
#### CR-2 — Phasage lisible (24/10/2026, en ligne)

**Partie 1 — libellés personnalisés (24/10/2026).** Dans le Phasage, un
ouvrage ou une tâche se renomme directement dans la ligne (crayon ✎ ou
double-clic, Entrée pour enregistrer, Échap pour annuler ; un nom vide reprend
le libellé du devis). Le nom personnalisé est enregistré À CÔTÉ du libellé
devis (`libelle_perso` sur l'ouvrage, `nom_perso` sur la tâche, dans le
phasage — aucune migration) ; le libellé devis reste visible en petit sous le
nom, dans le Phasage et dans la Validation, et se modifie toujours dans la
fenêtre de l'ouvrage / de la tâche (« Libellé du devis »).

**Inventaire des usages du libellé** (règle : ce qui sort vers le client ou
ProGBat = libellé devis ; ce qui s'affiche dans l'application = nom
personnalisé s'il existe, sinon libellé devis ; correspondance de noms = les
deux).

| Usage | Où | Libellé utilisé |
|---|---|---|
| Phasage : bulles ouvrage / tâche, listes, recherche, PDF phasage / prévisionnel / Gantt / rang, contrôles de groupe | PhasageV2 | personnalisé (+ devis en petit) ; recherche : les deux |
| Fenêtre « Modifier l'ouvrage / la tâche » | PhasageV2 | les deux champs : « Libellé du devis » et « Nom sur le chantier » |
| Ligne de planning créée depuis le phasage | PhasageV2 → planning | personnalisé |
| Planning (moteur, assistant planning, planifier une opération, explications) | planningEngineAdapterV1, phasagePlanning, planningOperationV1 | personnalisé |
| Objectifs de la semaine (lien planning ↔ tâche par le nom) | objectifsSemaine | correspondance : les deux |
| Validation : liste des tâches, regroupement par ouvrage, choix du cas hors devis | Validation, ChoixCasHorsDevis | personnalisé (+ devis en petit sous la ligne) |
| Validation : correspondance automatique du nom écrit par l'ouvrier, arbitrage par nom | Validation | les deux (meilleur score) |
| Tâches hors devis : propositions du cas A, synthèse, décisions du Bilan | horsDevisV2, HorsDevisPhasage | proposition : les deux ; affichage : personnalisé |
| Phasage : rapports d'une tâche (lien par nom des anciennes tâches) | PhasageV2 | les deux |
| Bilan : fiche détaillée (tâches résumées par lot), bilan de clôture, décisions | bilanFicheV3, bilanClotureV3, bilanDecisionsV3 | personnalisé |
| Retours du terrain | retoursTerrainV1 | personnalisé |
| Fiche chantier (graphiques par ouvrage) | PageChantiers | personnalisé |
| Commandes à passer (ouvrage du besoin) | PagePlanningCommandes | personnalisé (le rapprochement se fait par identifiant d'ouvrage, pas par nom) |
| « Tâches souvent ajoutées » de la Bibliothèque | horsDevisV2 | libellé devis de la tâche ajoutée (le même nom d'un chantier à l'autre, comparé au modèle de la bibliothèque) |
| Export de la fiche Opération (PDF / Markdown) | operationExportModele, operationMarkdown | **devis** (document qui sort de l'application) |
| Page d'information client, documents de visite | PageInfoClient, generate-visite-docx | **devis** |
| ProGBat (devis, inventaire, cadences) | progbat*, Edge Functions | **devis** (ne lit pas le phasage) |
| Chiffrage, bibliothèque | Chiffrage, Bibliotheque | sans objet (avant le phasage) |
| Écrans ouvriers (Mes phases, préparation, tâches actives, compte rendu) | fonctions serveur `ouvrier_*` | **devis pour l'instant** : ces fonctions renvoient le libellé devis. Les passer au nom personnalisé demande de modifier des fonctions à droits élevés (accord de Loris) — prévu avec le nouveau parcours (CR-3). |
| Assistant IA Rénovation | api/_ia/renovation | sans objet (ne lit pas les noms de tâches du phasage) |

**Partie 2 — les pièces du chantier (24/10/2026).** Phasage → colonne Tâches :
- bouton **« Pièces »** : la liste des pièces du chantier, saisie une fois
  (ajouter, renommer, monter / descendre, supprimer — une pièce supprimée
  détache ses tâches) ; enregistrée dans le phasage
  (`plan_travaux.meta.pieces`), chaque tâche porte sa pièce (`piece_id`,
  facultatif) — aucune migration ;
- **filtre** « Toutes les pièces / une pièce / Sans pièce » et case
  **« par pièce »** pour regrouper les tâches ; un badge rappelle la pièce
  de chaque tâche ;
- **« Choisir plusieurs »** : on coche des tâches, puis une barre en bas
  « N tâches choisies → pièce → Rattacher » (ou « Sans pièce » pour détacher) ;
- fenêtre d'une tâche : choix de la pièce et **« Dupliquer par pièce… »** :
  une tâche par pièce cochée ; la première garde la tâche d'origine (son
  avancement, ses heures pointées), les autres partent à 0 %. Les heures
  estimées sont réparties (parts égales par défaut, ajustables au quart
  d'heure) et le bouton ne s'active que quand le total tombe juste. Les heures
  vendues et le ratio de la tâche sont répartis dans les mêmes proportions :
  les heures prévues de l'ouvrage — donc la dérive — ne bougent pas.

**Contrôles** (données fictives, branchés dans Verify Fondations Finance) :
`verif-libelles-phasage` (21 contrôles : un ouvrage renommé garde son
libellé devis dans l'export, correspondance par les deux noms) et
`verif-pieces-phasage` (31 contrôles : la duplication par pièce conserve le
total des heures estimées et vendues, refus si la répartition ne tombe pas
juste, filtre, regroupement, rattachement).

**Points pour CR-3.**
- Les écrans ouvriers lisent le phasage par des fonctions serveur à droits
  élevés (`ouvrier_mes_phases`, `ouvrier_preparation_chantier`,
  `ouvrier_chantier_detail`, `ouvrier_taches_actives`) qui renvoient le
  libellé devis et ne connaissent pas les pièces. Le nouveau parcours devra
  les faire renvoyer `nom_perso` / `libelle_perso` (ou le nom affiché) et
  `piece_id` + `meta.pieces` : modification de fonctions à droits élevés,
  donc accord de Loris.
- Une tâche dupliquée par pièce est une tâche ordinaire : la validation, le
  journal d'avancement et le Bilan la traitent sans changement. Les tâches
  qui dépendaient de la tâche d'origine ne dépendent pas automatiquement des
  copies (dépendances à revoir si besoin dans la vue Rang).
#### CR-3 — Nouveau parcours du compte rendu ouvrier (25/10/2026, en ligne)

**Ce qui change pour les ouvriers** (espace ouvrier → compte rendu).
- **Écran d'accueil** : la journée prévue (chantiers, heures attendues) et,
  pour chaque tâche prévue, l'état attendu ce soir (« terminée ce soir »,
  « en cours ce soir (à moitié) », ou « à toi de dire où elle en est » quand
  la ligne du planning n'est liée à aucune tâche du phasage). Deux gros
  boutons :
  - **« Journée comme prévu »** : chaque tâche prévue reçoit son état
    attendu et sa durée prévue ; l'ouvrier vérifie, ajuste si besoin, ajoute
    une photo ou une remarque s'il veut, et envoie ;
  - **« Ça ne s'est pas passé comme prévu »** : il part du phasage du
    chantier, pas de la liste des tâches prévues.
- **Phasage sur téléphone** : grosses tuiles par lot (son métier en premier),
  puis ouvrages, puis tâches, avec un fil de navigation ; ou par pièce. Noms
  personnalisés partout (nom du devis en petit), recherche sur tout le
  chantier, tâches terminées masquées (case « Voir les terminées »), point de
  couleur gris / orange / vert (pas commencée / en cours / terminée),
  sélection multiple avec « 3 tâches choisies → Suivant ». « Créer une
  tâche » à chaque niveau, avec une seule question : « Pourquoi elle n'est
  pas dans la liste ? » (je ne l'ai pas trouvée / travail imprévu / demande
  du client ; une photo reste demandée pour une demande du client, comme
  avant). Le phasage des chantiers du jour est gardé sur le téléphone dès
  l'ouverture du compte rendu : il s'affiche sans réseau.
- **Détail de chaque tâche** : repères concrets — Commencé (25 %), À moitié
  (50 %), Presque fini (75 %), Terminé — ou la quantité posée pour les tâches
  suivies en quantité ; « Pas commencé » et « Bloqué » restent disponibles.
  Temps précis : durée prévue préremplie, ± 15 min, raccourcis 1 h / 2 h /
  4 h / journée, « Le reste ici » qui pose tout le temps restant ; en option
  (case à cocher, désactivée par défaut), une frise horaire (arrivée, départ,
  pause, heure de début de chaque tâche → durées calculées). L'envoi reste
  bloqué tant que le total n'est pas exact.
- **Tâches prévues pas faites** (parcours « pas comme prévu ») : un dernier
  écran court les liste avec une seule question pour toutes, « Pourquoi pas
  faites aujourd'hui ? », ou une réponse tâche par tâche (motifs existants,
  qui alimentent déjà « À replanifier » et le Bilan).
- **Tâches faites à plusieurs** : quand un collègue a déjà déclaré la tâche
  aujourd'hui, l'ouvrier voit « Davy a déclaré : bandes SDB terminée —
  d'accord ? ». Oui → même état, il n'ajoute que son temps ; non → il dit son
  état, et la validation affiche « Pas d'accord avec Davy, qui a déclaré
  terminée ». Sans réseau, rien n'est affiché.
- **Après l'envoi** : « Merci Davy ! Chambre 101 terminée, 1 en cours. Ton
  conducteur va valider ta journée. » (exemple issu des tests, données
  fictives). Pas de « le chantier est à X % » : il n'existe pas de chiffre
  d'avancement chantier partagé avec l'écran ouvrier (voir le journal des
  décisions).

**Ce qui change pour Loris et les conducteurs.**
- **Réglages → Utilisateurs → « Nouveau parcours du compte rendu »** :
  interrupteur pour tous les ouvriers en même temps. **État : activé pour
  tous** (réglage jamais enregistré = activé par défaut depuis le 25/10).
  L'éteindre ramène immédiatement au formulaire actuel à la prochaine
  ouverture du compte rendu ; les brouillons passent d'un écran à l'autre
  sans perte (un brouillon commencé avant la mise en ligne s'ouvre
  directement sur le détail).
- **Validation** : les lignes reçues sont les mêmes qu'avant (mêmes statuts,
  même avancement, mêmes heures). Deux ajouts visibles : le badge « D'accord
  / Pas d'accord avec un collègue », et pour une tâche créée par l'ouvrier le
  cas A / B / C présélectionné d'après son motif (modifiable). Aucune règle
  de validation ne change ; l'avancement s'écrit toujours par le journal
  d'avancement à la validation.

**Comment se calcule l'état attendu ce soir** (règle simple, le moteur de
planning ne marque pas de « fin prévue ce jour-là ») : la tâche est encore
planifiée après aujourd'hui → en cours, avec l'avancement attendu = avancement
+ reste × heures du jour ÷ (heures du jour + heures planifiées après) ;
aujourd'hui est son dernier jour planifié → terminée ce soir, sauf si les
heures du jour couvrent moins de la moitié du reste (heures estimées × reste
à faire) ; ligne du planning sans tâche du phasage → l'ouvrier le dit.
Mesure sur les vraies données (planning et comptes rendus du 05/10 au
23/10/2026, requête sur la base) : sur 98 tâches-jours où c'était le dernier
jour planifié, 50 ont été déclarées terminées, 33 en cours, 15 pas faites ou
bloquées ; sur 22 tâches-jours encore planifiées ensuite, 8 en cours, 2
terminées, 12 pas faites ou bloquées. La règle est donc un point de départ
que l'ouvrier corrige d'un tap, pas une certitude : le planning n'est
souvent prolongé qu'après coup. Sur les semaines 41 à 43, 120 lignes du
planning sur 218 (55 %) sont liées à une tâche du phasage ; les autres
s'affichent « à toi de dire ».

**Fonctions serveur modifiées (accord de Loris du 24/10)** — migration
`20261025090000_cr3_parcours_ouvrier`, appliquée le 25/10 et enregistrée :
- `ouvrier_mes_phases` : corps de production repris ligne à ligne (349 / 349
  lignes retrouvées), 26 lignes ajoutées : `nom_perso`, `piece_id` (tâche),
  `libelle_perso`, `lot_id` (ouvrage), `pieces`, `lots` (réponse). Même garde
  (ouvrier testeur « mes_phases » ou « cr_v2 »), mêmes chantiers servis
  qu'avant : avant comme après, la fonction sert le phasage de n'importe quel
  chantier à un ouvrier autorisé (c'était déjà le cas — le panneau « J'ai
  fait autre chose » s'en sert) ; rien n'a été élargi.
- `ouvrier_taches_actives` : corps de production (110 / 110 lignes) + 1 ligne
  (`nom_perso`).
- **Nouvelle** `ouvrier_journee_cr` (lecture seule) : réglage du parcours,
  journée prévue du chantier (heures du jour, heures planifiées après,
  dernière date), et ce que les AUTRES ouvriers ont déclaré ce jour-là sur ce
  chantier (tâche, état, avancement, quantité — ni heures ni remarques). Un
  ouvrier ne l'obtient que pour un chantier où il est planifié dans la
  semaine ; sinon seulement le réglage.
- Droits vérifiés en base après application : les trois fonctions sont
  exécutables par les utilisateurs connectés seulement (aucun accès anonyme),
  comme les autres fonctions ouvrier.

**Mises en ligne** : PR #174 (parcours complet, interrupteur éteint par
défaut le temps de vérifier) puis PR d'activation (interrupteur allumé par
défaut). Contrôle `verif-compte-rendu-v3` (données fictives) branché dans
« Verify Fondations Finance » : les 7 cas demandés (« comme prévu » = mêmes
lignes qu'une saisie manuelle avec les repères, « le reste ici », frise →
durées, tâche créée avec chacun des 3 motifs et cas présélectionné, tâche
prévue non faite avec motif, collègue confirmé puis contesté, envoi bloqué
tant que le total n'est pas exact) et la navigation du phasage. Rendu des
écrans vérifié hors application (rendu serveur, données fictives) ; le formulaire
v2 sans le parcours est inchangé.

**Points d'attention / pour CR-4.**
- Les écrans « Mes phases » et le tableau de bord ouvrier affichent aussi
  les noms personnalisés. Les écrans « Préparation » et « Chantier » de
  l'espace ouvrier (fonctions `ouvrier_preparation_chantier`,
  `ouvrier_chantier_detail`) gardent le libellé du devis : non modifiés.
- La remarque générale et les remarques par tâche restent du texte tapé :
  la dictée et la reformulation par l'IA arrivent à CR-4 (le texte d'origine
  devra être gardé à côté).
- La photo de fin de journée « de la zone » n'est pas encore distincte des
  photos du chantier existantes : CR-4.
- Écart aux règles : le script `verif-compte-rendu-v3` a été lancé en local
  pendant son écriture, et un contrôle de syntaxe esbuild sur les fichiers
  modifiés (aucun contrôle rouge à ce moment-là).

#### CR-4 — Dictée vocale, préremplissage par l'IA, photo de fin de journée (25/10/2026, en ligne)

**Ce qui change pour les ouvriers** (compte rendu du soir, nouveau parcours).
- **« Raconter ma journée au micro »** : un gros bouton sur l'écran
  d'accueil (et « Raconter ma journée » en haut du détail). L'ouvrier appuie,
  parle (« J'ai fini le placo de la chambre, commencé les bandes dans la salle
  de bain, il manque des vis de 25 »), relit le texte qui s'écrit, puis
  « Préparer mon compte rendu ».
- **Ce que l'IA propose** : les tâches concernées (prises dans le phasage du
  chantier, noms personnalisés), leur état (commencé / à moitié / presque fini
  / terminé), le temps quand il l'a dit, sa remarque remise au propre, et le
  matériel qui manque (bouton « Demander » qui ouvre la demande de matériel
  habituelle, recherche déjà remplie). Il voit un résumé « Ce que j'ai
  compris », corrige la remarque, touche les suggestions incertaines s'il
  veut, puis « Utiliser et vérifier » : les tâches sont remplies dans son
  compte rendu, il ajuste le temps et **c'est lui qui envoie**. Rien n'est
  envoyé par l'IA.
- **Rien n'est prérempli sans certitude** : une tâche dont l'IA n'est pas
  sûre reste une suggestion à toucher ; un texte trop vague ne remplit rien.
  IA en panne, coupée par l'administrateur ou trop lente : un message, et le
  formulaire reste utilisable normalement (« Remplir moi-même » toujours
  présent).
- **Le micro est aussi** dans la recherche du phasage, dans le nom d'une
  tâche créée et à côté de la remarque générale.
- **Photo de fin de journée** : un encadré par chantier, « Photo de fin de
  journée (recommandée) » — une vue d'ensemble de la zone travaillée. Jamais
  obligatoire ; la photo « après » d'une tâche terminée reste possible sur la
  tâche.

**Ce qui change à la validation.** La remarque affichée est celle que
l'ouvrier a relue ; quand elle vient d'une dictée, un lien « Voir le texte
dicté d'origine » montre ce qu'il a dit, mot pour mot (le texte d'origine est
toujours gardé, colonne `rapports.dictee`). Une remarque remise au propre à
l'envoi sans relecture (cas sans réseau) est signalée « reformulée par l'IA
(non relue par l'ouvrier) ». Le titre des photos indique « dont N de fin de
journée ». Les lignes reçues, les pointages et le Bilan ne changent pas.

**Choix de la transcription.**
| | Reconnaissance du navigateur (retenue) | Service côté serveur |
|---|---|---|
| Android (Chrome) | fonctionne, en français ; demande le réseau (sauf pack de langue hors ligne) | fonctionne |
| iPhone (Safari) | fonctionne dans Safari ; dans l'application installée sur l'écran d'accueil, peut être refusée selon la version d'iOS → message clair et repli sur le micro du clavier | fonctionne |
| Coût | 0 € | environ 0,005 € la minute, plus un nouveau fournisseur, une nouvelle clé et l'envoi de l'audio |
| Sans réseau | non (comme le serveur) | non |
| Repli | micro du clavier (Android et iPhone le font, souvent même hors ligne) dans le même champ | idem |

La dictée du clavier est déjà sur tous les téléphones et marche partout ; le
micro du navigateur n'ajoute qu'un gros bouton plus simple. Un service
serveur coûterait plus, demanderait un nouveau fournisseur et n'apporterait
rien hors réseau. **À vérifier par Loris sur un iPhone d'ouvrier** : si le
gros bouton micro ne s'affiche pas ou affiche « utilise le micro de ton
clavier », c'est le repli prévu, pas une panne.

**Le texte de l'ouvrier reste une donnée.** Il voyage dans un champ JSON,
jamais dans la consigne ; la consigne dit explicitement de ne suivre aucune
instruction qu'il contiendrait ; la réponse est revalidée (serveur et
téléphone) : seules des tâches de la liste fournie, des états connus, des
durées au quart d'heure dans la limite de la journée passent — sinon rien
n'est proposé.

**Coût estimé de l'IA** (pour Loris : environ **1,5 à 3 € par mois**).
Hypothèses : 10 ouvriers × 1 compte rendu par jour × 17,3 jours travaillés
par mois (4 jours par semaine depuis le 19/10) = 173 comptes rendus ; pour
comparaison, la base compte 108 journées de compte rendu de 7 ouvriers sur
les 4 semaines du 28/09 au 24/10 (requête sur la base). Par analyse : un
texte de 60 à 150 mots, 50 à 150 tâches du phasage proposées, soit environ
4 000 à 6 500 jetons lus et 300 à 500 écrits, au tarif de claude-haiku-4-5
retenu par l'application (0,92 € le million lus, 4,60 € le million écrits) :
0,006 à 0,008 € l'analyse. Avec 1,3 à 2 analyses par compte rendu (une
correction puis une nouvelle analyse) : 225 à 350 analyses, **1,4 à 2,8 €
par mois**. Transcription : 0 €. Plafonds existants inchangés (5 € par
utilisateur et par jour, 200 € par mois pour l'entreprise, coupe-circuit dans
`planning_config.ia_config`).

**Migration** `20261025120000_cr4_dictee_photo_fin` : deux colonnes
facultatives sur `rapports` (`dictee`, `photos_fin_journee`). Purement
additive : relue en entier, colonnes absentes avant, droits de la table
inchangés (ils couvrent les nouvelles colonnes), appliquée le 25/10 par la
CLI liée, enregistrée et vérifiée en base. L'envoi les retire de lui-même si
elles manquaient. Aucune fonction serveur ouvrier modifiée.

**Contrôle** `verif-dictee-cr` (données fictives, IA simulée), branché dans
« Verify Fondations Finance » : texte dicté avec 3 tâches et une demande de
matériel (lignes identiques à une saisie manuelle) ; texte ambigu (rien de
prérempli, suggestions seulement) ; IA indisponible (formulaire inchangé,
envoi jamais bloqué) ; texte d'origine conservé et visible à la validation ;
réponses piégées refusées (tâche inventée, en double, état inconnu, durée
hors limite, texte libre) ; photo de fin de journée (listée à part et dans
les photos du chantier, jamais exigée) ; ancien formulaire inchangé.

**Points d'attention / pour CR-5.**
- Le compteur « tâches regroupées » et la répartition (CR-5) pourront
  s'appuyer sur `rapports.dictee.texte_origine` pour proposer la
  répartition (« à partir du texte dicté »).
- Les écrans « Préparation » et « Chantier » de l'espace ouvrier gardent le
  libellé du devis (inchangé depuis CR-3).
- Rien n'a été essayé sur un vrai téléphone d'ouvrier : le comportement du
  micro sur iPhone en application installée est à confirmer au premier
  usage (le repli clavier est là dans tous les cas).

#### CR-5 — Refonte de la page de validation (25/10/2026, en ligne)

**Mises en ligne.** Trois demandes de fusion, chacune en ligne avant la
suivante, contrôles verts à chaque fois : 1/3 page de la journée (#177),
2/3 détail d'un compte rendu (#178), 3/3 répartition d'une tâche regroupée
(#179). Aucune migration, aucun droit d'accès modifié.

**Ce qui change pour Loris (Validation fin de journée, sur ordinateur).**
- *La page de la journée.* En haut, la date avec des flèches jour précédent /
  suivant, et un rappel des jours précédents qui ont encore des comptes rendus
  à valider (« lun. 19 · 2 comptes rendus », cliquable). Un résumé : à valider
  (dont avec écarts), validés (heures enregistrées), non envoyés (qui et sur
  quel chantier), heures déclarées sur heures attendues, et une barre de
  progression de la journée. Regroupement par chantier (par défaut) ou par
  ouvrier, case « Écarts seulement », légende : gris = comme prévu,
  orange = écarts à regarder, rouge = à arbitrer.
- *Une ligne par compte rendu, lisible sans l'ouvrir* : l'ouvrier, le badge
  « Comme prévu » / « N écarts » / « À arbitrer », les tâches en étiquettes
  avec leur état, les écarts écrits en clair (dépassement d'heures avec les
  chiffres et le motif, tâche créée et son motif, tâche bloquée avec motif et
  remarque, tâche prévue non faite et pourquoi, désaccord avec un collègue,
  journée différente de l'attendu, ouvrier non planifié), les vignettes des
  photos et les heures. Bouton « Valider » direct seulement pour un compte
  rendu « comme prévu » sans anomalie ; sinon « Ouvrir et valider ». Pas de
  « tout valider d'un clic ».
- *Tâche faite à plusieurs avec des états différents* : un encart en haut du
  chantier la montre une seule fois (« Davy : en cours 50 % · Kev :
  terminée »), avec « Avancement retenu » et « Appliquer aux deux » : la
  valeur est reportée dans les comptes rendus des deux ouvriers.
- *Compte rendu attendu mais non envoyé* : encart en pointillés rouges dans le
  chantier, qui rappelle que la journée de ce chantier reste « incomplète » au
  Bilan. C'est la même règle que les relevés journaliers (ouvriers planifiés
  sur le chantier ce jour-là, hors absences) : le chiffre affiché ici est celui
  du Bilan.
- *Le détail d'un compte rendu* s'ouvre en grand : « Retour à la journée »,
  « Ouvrier · Chantier », date et heure d'envoi, badge, « Compte rendu 2 sur
  5 », « Valider », et le bouton principal « Valider et passer au suivant ·
  [ouvrier] » (on ne passe au suivant que si la validation a réussi). Pour
  chaque tâche : le chemin lot › ouvrage, le libellé devis en petit, une barre
  de budget (heures pointées avant aujourd'hui, heures du jour de chaque
  ouvrier, trait des heures prévues, dépassement en rouge avec son coût estimé
  = heures en trop × (coût moyen d'une heure de main-d'œuvre sur la tâche +
  frais généraux du jour), la méthode de l'étape 2), et l'avancement avant →
  déclaré par chaque ouvrier → retenu (modifiable). La remarque reformulée
  garde son lien « Voir le texte dicté d'origine ». Colonne de droite : la
  journée de l'ouvrier (tous ses chantiers, trajets, heures indirectes, total
  comparé à la journée attendue), les autres comptes rendus du chantier avec
  leur statut (cliquables), les photos de fin de journée, et les corrections
  (changer le chantier du compte rendu, ajouter une tâche).
- *Répartir une tâche regroupée* : le bouton « Découper » d'une ligne ouvre
  « Répartir sur les tâches du phasage ». En haut, ce que l'ouvrier a déclaré
  (intitulé, heures, texte dicté, motif, photos) et le compteur « 3e tâche
  regroupée de Steven ce mois-ci ». Une proposition tirée du texte dicté et du
  planning du jour, qui dit pourquoi chaque tâche est proposée (« prévue au
  planning ce jour-là », « le texte parle de « bandes » », « tâche standard
  citée dans le texte »). Une ligne par tâche, sans limite : tâche du phasage
  (avec recherche), heures ±15 min, en cours avec un pourcentage ou terminée.
  « Parts égales » et « Selon les durées prévues », barre colorée, et
  « Valider la répartition » qui ne s'active que quand le total est exactement
  égal aux heures déclarées. Case « Garder les photos et le texte dicté sur
  chaque tâche », cochée par défaut.
- *Messages techniques* (« exécute le SQL du P6 », colonnes manquantes,
  « Détail technique : … ») : retirés de l'écran, ils vont dans les journaux
  techniques ; les messages d'erreur restants disent seulement quoi faire.

**Ce qui ne change pas.** Le garde-fou des heures, le verrou d'écriture du
phasage, la création des pointages, le journal d'avancement et la clôture de
journée sont exactement les mêmes : « Valider » direct passe par la même
validation que la fenêtre ouverte puis validée sans retouche.

**Contrôles.** `verif-validation-journee.mjs` (données fictives, branché dans
« Verify Fondations Finance ») couvre les cas exigés : arbitrage appliqué aux
deux comptes rendus ; répartition qui doit tomber juste (bouton inactif
sinon) ; parts égales et selon les durées prévues (somme toujours juste,
au quart d'heure) ; compteur de tâches regroupées (calculé par le module du
suivi qualité CR-1) ; compte rendu manquant affiché (règle des relevés
journaliers). Plus : couleurs et écarts en clair, « Valider » direct réservé
aux comptes rendus comme prévu, proposition expliquée, barre de budget, aucun
message technique à l'écran.

**Points d'attention.**
- L'« avancement retenu » d'un encart est gardé tant que la page reste
  ouverte : il est appliqué aux comptes rendus validés ensuite (direct ou
  ouverts). Si la page est rechargée avant, il faut le ressaisir.
- « Valider » direct n'est pas proposé pour une tâche suivie en quantité, ni
  pour une ligne reçue d'un autre chantier : ces comptes rendus s'ouvrent.
- « Garder les photos et le texte dicté sur chaque tâche » agit sur les lignes
  de la fenêtre de validation : les photos et le texte restent de toute façon
  attachés au compte rendu de l'ouvrier, qui n'est jamais réécrit.
- Heures attendues : même calcul que le garde-fou (rythme de la semaine moins
  les absences). Si les absences ne peuvent pas être lues, la page écrit
  « attendu : inconnu » au lieu d'un chiffre.
- Le compteur de tâches regroupées compte les découpes des comptes rendus
  déjà validés du mois (comme la page Qualité) ; une découpe faite puis
  annulée avant validation n'est pas comptée.

#### CR-6 — Parcours unique du compte rendu et correctifs (26/10/2026, en ligne)

**6A — Parcours unique (en ligne, PR #184, sans migration ni changement de
droits).**

Ce qui change pour les ouvriers (interrupteur « Nouveau parcours du compte
rendu » allumé) :
- Plus de « Journée comme prévu » / « Ça ne s'est pas passé comme prévu », plus
  d'écran « Pourquoi pas faites aujourd'hui ? ». En haut, « Ta journée »
  (heures attendues, « Raconter ma journée au micro », « J'ai fait autre
  chose »), puis directement les tâches prévues, chantier par chantier.
- Chaque tâche : heures préremplies avec la durée prévue ; état jamais
  prérempli, choisi par l'ouvrier (Pas commencé, Commencé, À moitié, Presque
  fini, Terminé, quantité posée, ou Bloqué avec son motif) ; le prévu écrit en
  petit (« prévu : terminée ce soir »), rien quand il est inconnu.
- « Pas commencé » ne demande plus de motif ; sur une tâche déjà avancée il
  s'écrit « Pas avancé aujourd'hui » (0 h, avancement inchangé).
- « J'ai fait autre chose » ouvre le phasage ; les tâches choisies ou créées
  s'ajoutent à la liste sans rien effacer.
- Ligne du planning non liée au phasage : un encadré propose « La plus
  probable » (nom, lot › ouvrage › pièce), acceptée d'un geste ; sinon
  « Choisir dans le phasage » ou « Créer une tâche » (nom prérempli, motif
  demandé). La ligne garde ses heures, photos et remarque.
- Collègue : « Oui, d'accord » vaut choix de l'état. Dictée : inchangée.
- Envoi bloqué tant qu'une tâche avec des heures n'a pas d'état (le message
  nomme la tâche) ou que le total n'est pas exact. Tâche prévue laissée sans
  heures ni état → « pas commencé ».
- Brouillons de l'ancien parcours et du formulaire v2 : s'ouvrent sur la liste,
  lignes gardées. Interrupteur éteint : formulaire v2 d'avant, inchangé (le
  motif de « Pas commencé » y reste demandé).

Ce qui change pour Loris : à la validation, « « X » prévue, pas faite » reste
orange, sans motif affiché (y compris pour les anciens comptes rendus ; le
motif reste enregistré sur la ligne).

Choix techniques : règles du parcours dans le module pur `compteRenduV3.mjs` ;
proposition de tâche par la même ressemblance de noms que le cas A hors devis
(`ressemblanceNomsV2`), mots d'action du planning (« terminer », « finir »)
ignorés, aucune proposition si aucun nom ne ressemble ; chaque ligne prévue
garde le prévu affiché (`prevu : {etat, avancement, repere}`) et une ligne
rattachée garde le texte du planning (`liaison`) — aucun lecteur existant ne
les lit, ils servent au suivi qualité (6E). Code des deux branches retiré.

Contrôle `verif-cr6-parcours-unique.mjs` (65 contrôles, données fictives) dans
« Verify Fondations Finance » ; `verif-compte-rendu-v3` (63) et
`verif-validation-journee` (92) adaptés.

Points d'attention :
- Rattacher une ligne du planning non liée n'est pas obligatoire : ignorée,
  elle arrive comme avant en rouge « sans tâche du phasage » à la validation
  (le phasage peut manquer sans réseau).
- En rattachant une ligne, l'état est à redire (l'avancement de référence
  devient celui de la tâche choisie).
- Un brouillon commencé en « pas comme prévu » fait réapparaître les tâches
  prévues masquées : l'ouvrier doit dire leur état si elles ont des heures.
- Rien n'a été essayé sur un vrai téléphone.

**6B — Écart « avancement incohérent » et avancement retenu gardé (en ligne,
PR #186, sans migration ni changement de droits).**

Ce qui change pour Loris (Validation fin de journée) : un écart orange
« avancement incohérent » retire le « Valider » direct ; le compte rendu doit
être ouvert. Trois textes (exemples issus des tests, données fictives) :
« « Bandes chambre » déclarée terminée avec 2 h pour 10 h prévues » ;
« « Enduit séjour » passe de 50 % à 75 % (+25 points) sans aucune heure pointée
dessus ce jour-là » ; « « Faïence douche » était terminée et revient « en cours
60 % » ». Plusieurs cas sur une même tâche = un seul écart. L'« avancement
retenu » d'une tâche faite à plusieurs ne se perd plus au rechargement.

Réglages : Admin → Taux horaires → « Validation des comptes rendus :
avancement incohérent » (clé `planning_config.seuils_avancement_incoherent`,
jamais enregistrée = défauts : rapport heures / avancement 0,5 ; tâche d'au
moins 2 h prévues ; 25 points sans heure ; cas « terminée qui revient » actif).

Mesure sur les vrais comptes rendus du 12/10 au 25/10/2026 (113 comptes rendus,
lecture seule, seuils par défaut) : **11 tâches sur 9 comptes rendus** auraient
eu l'écart — 10 « déclarée en avance sur les heures », 0 « sans heure », 1
« terminée qui revient » ; **aucun « Valider » direct perdu à cause de lui**
(seuls 3 comptes rendus sur 113 l'auraient eu, les autres avaient déjà un autre
écart, surtout des heures sans tâche du phasage).

| Ouvrier | Comptes rendus | avec l'écart | Tâches |
|---|---|---|---|
| Davy | 18 | 2 | 4 |
| Mohamed | 14 | 3 | 3 (dont 1 terminée qui revient) |
| Selman | 16 | 2 | 2 |
| Steven | 19 | 1 | 1 |
| Venceslas | 22 | 1 | 1 |
| Kev | 20 | 0 | 0 |
| Margaux | 4 | 0 | 0 |

Exemples réels (base) : 15/10, Davy, FOURMOND 101, « Isolation laine de verre
120mm doublage » déclarée terminée avec 0,5 h pour 5,04 h prévues ; 13/10,
Selman, FOURMOND 102, porte-fenêtre 225x140 déclarée terminée avec 2 h pour
5,16 h ; 16/10, Mohamed, KATHLEEN T2, « Passages des gaines VMC » était
terminée et revient « en cours 25 % » ; 22/10, Venceslas, MONTILLERS APPT 1,
« Décollage et enlèvement de la tapisserie » à 75 % avec 4,75 h pour 26,69 h.
Chiffres approchés : avancement de la veille lu dans le journal (passé
reconstitué), heures prévues d'aujourd'hui, 134 lignes sans tâche du phasage
non contrôlables, 129 tâches sur 249 sous 2 h prévues. Le cas « sans heure »
vaut 0 parce que l'ancien formulaire ne permettait pas de déclarer un état sans
heures ; il servira avec le parcours unique.

Choix techniques (voir aussi le journal) : module pur
`avancementIncoherentV1.mjs` (`ecartsAvancementIncoherentRapport`, réutilisé
en 6E) ; heures avant / du jour / prévues = mêmes sources que la barre de
budget de CR-5 ; heures du jour = toutes les personnes ; « terminée » = 100 %
la veille d'après le journal (situation validée) ; « Pas avancé aujourd'hui »
et « en cours 100 % » ne déclenchent pas ; le premier cas ne vise qu'une
déclaration qui fait avancer la tâche ; tâche bloquée non contrôlée (déjà en
rouge) ; donnée manquante = pas d'écart. Avancement retenu : gardé dans le
navigateur (par jour, chantier, tâche), oublié une fois les comptes rendus
validés — limite : seulement sur cet ordinateur. Contrôle
`verif-cr6-avancement-incoherent.mjs` (91 contrôles, données fictives).

**Bilan : pas repris (choix).** Le Bilan lit les relevés journaliers, sans
détail par tâche : il faudrait une nouvelle colonne (migration + recalcul) ou
un second circuit de calcul ; et au moment du Bilan l'écart a déjà été tranché
à la validation. Le comptage par ouvrier va sur la page Qualité (6E).

**6C — Planning lié au phasage (en ligne, PR #188, sans migration ni
changement de droits ; moteur de planning inchangé, ses 4 contrôles verts).**

Taux de lignes du planning liées à une tâche du phasage (vraies données, base
du 26/10, même fonction que le compteur) :

| Semaine | Liées | Part |
|---|---|---|
| W36 | 38 / 96 | 40 % |
| W37 | 37 / 74 | 50 % |
| W38 | 36 / 77 | 47 % |
| W39 | 87 / 118 | 74 % |
| W40 | 56 / 78 | 72 % |
| W41 | 12 / 39 | 31 % |
| W42 | 72 / 129 | 56 % |
| W43 | 36 / 50 | 72 % |
| W44 (en cours) | 67 / 72 | 93 % |
| W45 à W47 (déjà planifiées) | 140 / 140 | 100 % |

W41-W43 : 120 / 218 = 55 %, la mesure de CR-3.

D'où viennent les lignes non liées : **toutes ont été tapées à la main dans une
case** (« + Ajouter une tâche ») ; les autres chemins (« Envoyer au planning »
depuis le phasage, « Planifier », « Planifier une opération », moteur) posaient
déjà le lien, et aucune ligne n'a perdu son lien après coup (historique
vérifié). Sur les 103 lignes non liées de W41 à W44 : 28 (27 %) visaient une
tâche créée ensuite à la validation (elle n'existait pas encore), 10 (10 %)
une tâche qui existait déjà sous le même nom, 63 (61 %) une tâche ressemblante
au nom différent, 2 sans rien de ressemblant (« RDV ENEDIS »).

**Corrigé à la source** : la saisie à la main propose la tâche dès la création
de la ligne (sans bloquer). Non corrigeable à la source : une ligne tapée pour
un travail qui n'a pas encore de tâche.

Ce qui change pour Loris (Planning) : compteur « X % des lignes de la semaine
liées au phasage » en haut de la semaine (« aucune ligne » pour une semaine
vide) ; un clic ouvre la liste des lignes à lier avec, pour chacune, la tâche
la plus probable (lot › ouvrage › pièce) et « Lier » (un clic), « Choisir dans
le phasage » ou « Pas une tâche du chantier » ; point orange devant chaque
ligne non liée de la grille ; la même proposition dans la case, y compris
pendant la saisie. « Lier » ne change ni le texte, ni la durée, ni l'équipe.
Lignes « libres » ni signalées ni comptées : absence (congé, maladie, visite
médicale, férié, RTT…), formation, trajet, passage au dépôt, ou marquées « Pas
une tâche du chantier » (liste volontairement étroite : des phasages réels ont
des tâches « Nettoyage », « Appro », « RDV Enedis »).

Choix techniques : module pur `liaisonPlanningV1.mjs` (`tauxLiaisonPlanning`,
réutilisé en 6E) ; la proposition de tâche (`propositionsLiaison`) y est
déplacée et sert À LA FOIS à l'écran ouvrier (6A) et au planning (même
fonction). Contrôle `verif-cr6-planning-lie.mjs` (76 contrôles, données
fictives).

Points d'attention : la proposition favorise les tâches pas encore terminées
(sur une ancienne ligne, elle peut mettre une moins bonne tâche en tête :
« Pose du Dumawall… » → « Pose appareillage », « Pose du dumawall » en
deuxième) ; « Pas une tâche du chantier » ne vaut que dans le planning (l'écran
ouvrier propose toujours une tâche) ; une ligne du compte rendu ne mémorise pas
de quelle ligne du planning elle vient, donc la validation ne lie pas le
planning en retour.

**Question ouverte pour Loris — lier automatiquement les anciennes lignes ?**
(non fait : c'est une reprise de données). 1 491 lignes non liées en base (W16
à W44) ; avec la proposition livrée : confiance élevée 580 (dont 37 en
W41-W44, 463 avant W36), moyenne 154, faible 530, aucune proposition 227.
Exemples réels de confiance élevée : KATHLEEN T2 « Terminer la pose du
tableau+ GTL » → « Pose tableau + GTL » ; FOURMOND 101 « Dépose de l'ancienne
baie vitrée » → même nom. Exemple douteux : TOM & CAMILLE R+1 « Peindre porte
palière et mise en place » → « Mise en place de l'ouvrant porte palière »
(Menuiserie). Effets d'une liaison en masse : heures déjà planifiées par
tâche (donc durées proposées ensuite), équipe retenue pour une tâche côté
ouvrier, bandeau « À replanifier ».

**6D — Outils de classement en masse (en ligne, PR #190, sans migration ni
changement de droits ; rien n'a été appliqué en base).**

Où et qui (vérifié en base et dans `loadAccessConfig`) :
- **Tâches hors devis** : Phasage → « Hors devis · N » → onglet « Classement
  en masse », chantier par chantier. Page Phasage visible pour admin (en base
  et automatique), super_admin, comptable ; **pas pour conducteur** : la liste
  enregistrée en base ne contient pas le Phasage (la liste par défaut le
  prévoit).
- **Commandes sans lot** : Commandes → bouton « Lignes sans lot · N ». Page
  visible pour admin (automatique), super_admin, conducteur, comptable.

Ce qui change pour Loris : chaque tâche à classer montre le cas proposé (A /
B / C / standard), pourquoi, un niveau de confiance et, pour A, la tâche du
phasage proposée (lot › ouvrage) ; rien n'est coché au départ ; choix
modifiable ligne par ligne ; « Appliquer la sélection » montre un récapitulatif
à confirmer puis fait exactement ce que fait « Classer » une tâche à la fois
(même code). Sur un chantier coché « Chantier repris », « Tout laisser en
l'état » marque les tâches restantes (marque datée et signée dans la tâche,
réversible par « Reprendre le classement ») : heures, coût et production
inchangés, elles ne sont plus proposées. Aucun chantier n'est encore coché
« repris » : le bouton apparaîtra quand la case sera cochée. Commandes : lot
proposé avec son explication et sa confiance, filtres par chantier et
confiance, lot modifiable, seules les lignes cochées sont écrites après
confirmation ; les relevés journaliers des chantiers touchés sont recalculés
depuis la plus ancienne date d'achat changée (mécanisme existant ; écart dans
« Rectifications » si un bilan exporté est concerné).

Effet d'un lot posé : avant, une ligne sans lot était imputée en entier tout de
suite dans la marge à l'avancement ; après, elle entre dans l'enveloppe du lot
(reste à commander du lot en baisse, dépassement si l'enveloppe est dépassée,
« matériaux en avance » si le lot est peu avancé — la marge à l'avancement
peut alors monter).

Mesure réelle (base du 26/10, lecture seule) — **tâches hors devis à classer :
429 tâches, 1 145 h** :

| Cas proposé | Élevée | Moyenne | Faible | Total |
|---|---|---|---|---|
| A (la tâche existait) | 2 | 1 | 14 | 17 |
| B (imprévu, ouvrage vendu) | 0 | 0 | 3 | 3 |
| C (à arbitrer) | 2 | 0 | 341 | 343 |
| Standard (à laisser) | 0 | 66 | 0 | 66 |

Les 341 C « faibles » sont un « à examiner » par défaut (aucune tâche
ressemblante). Principaux chantiers : TOM & CAMILLE R+2 47 tâches (173,5 h),
RDC 47 (126,8 h), R+1 45 (128,2 h), BRIOLLAY 43 (165,3 h), METOIS 41
(92,7 h), MAUDUIT 31 (65,3 h). Exemples réels : TOM & CAMILLE R+1 « Ratissage
des murs » → A élevée vers « Ratissage des murs » ; METOIS « Enduit
étanchéité douche » → A moyenne vers « Pose de l'enduit d'étanchéité
douche » ; douteux : ARTHUR - R+1 « Mise en place d'un miroir » → A faible
vers « Mise en place du WC » (signalé « « miroir » ne s'y retrouve pas »).

**Commandes sans lot : 673 lignes, 19 681,59 €** :

| Confiance | Lignes | Montant |
|---|---|---|
| Élevée | 0 | 0 € |
| Moyenne | 278 | 5 752,71 € |
| Faible | 352 | 11 736,80 € |
| Aucune proposition | 43 | 2 192,08 € |

Aucune « élevée » : aucune ligne n'a d'ouvrage rattaché et les mêmes
matériaux sont presque toujours commandés sur d'autres chantiers. Exemples
réels : KATHLEEN T2 « éco-contribution PMCB » → Plomberie sanitaire, moyenne
(« les 18 autres lignes de ce bon sont du lot Plomberie sanitaire ») ; TOM &
CAMILLE R+2 « ODACE INTERRUPTEUR VMC » → Électricité, moyenne (même libellé
que 5 commandes) ; douteux : DÉPOT « PANTALON VICENTE » → Plomberie sanitaire,
faible (chantier sans phasage).

Niveaux de confiance — hors devis : élevée = nom quasi identique sans
concurrente, ou cas déjà déclaré (motif enregistré) ; moyenne = tous les mots
retrouvés sans concurrente, tâche standard, tâche déjà dans un ouvrage vendu ;
faible = le reste (dont C par défaut). Commandes : élevée = ouvrage rattaché ou
matériau prévu / toujours commandé sur ce lot du chantier ; moyenne = même bon,
même libellé (≥ 2 commandes, ≥ 75 % sur un lot), même matériau ailleurs avec
avis net ; faible = fournisseur, historique, libellé proche ; un indice
contraire, un lot absent du phasage ou un chantier sans phasage baissent d'un
cran (raison écrite). Contrôle `verif-cr6-classement-masse.mjs` (83 contrôles,
données fictives) ; `verif-hors-devis-v2` reste vert.

Points d'attention (pour Loris) :
- **Conducteurs sans accès au Phasage** en base : à cocher dans Admin → Accès
  s'ils doivent classer les tâches hors devis.
- **DÉPOT** (97 lignes, 5 236 € : vêtements, balais…) : la règle « lot
  obligatoire » de l'étape 1B s'y applique alors qu'un lot n'y a guère de
  sens ; toutes ses propositions sont faibles.
- **BRIOLLAY** : plusieurs lots proposés n'ont aucun ouvrage dans le phasage ;
  les poser créerait un dépassement sur une enveloppe vide.
- **Défaut existant constaté, non corrigé** : changer le lot d'une ligne à la
  main sur la page Commandes ne recalcule pas les relevés journaliers (le
  rattrapage de nuit ne voit que les lignes créées dans la journée). L'outil de
  masse, lui, demande le recalcul.

**6E — Suivi qualité (en ligne, PR #192, sans migration ni changement de
droits ; page existante, mêmes personnes qu'avant).**

Trois lignes ajoutées au tableau de la page « Qualité des comptes rendus »,
au total et par ouvrier, avec la tendance, et trois encarts de détail :
1. **États déclarés identiques au prévu** — mesure la fiabilité du PLANNING,
   pas le travail de l'ouvrier. « Identique » = même état (terminée /
   terminée, en cours / en cours quel que soit le repère ; le « même repère »
   est compté à part dans le détail) ; « Pas commencé » ou « Bloqué » face à un
   prévu = différent ; exclues : lignes sans prévu (avant le 26/10, tâches
   ajoutées), prévu inconnu, sans état.
2. **Écarts « avancement incohérent »** — même fonction que la validation (6B),
   détail par cas et liste avec date, ouvrier, chantier et texte exact.
3. **Lignes du planning liées au phasage** — même fonction et même explication
   que le compteur du Planning (6C) ; par ouvrier = les lignes où il est prévu
   (la qualité du planning qu'il a reçu).

Valeurs réelles (base du 26/10, lecture seule) :

| | 12/10 → 25/10 | W44 (en cours) |
|---|---|---|
| Identiques au prévu | — (aucun compte rendu du parcours unique encore) | — |
| Avancement incohérent | 11 écarts sur 9 comptes rendus (113 contrôlés) : 10 cas 1, 0 cas 2, 1 cas 3 — 7 sur la période précédente | — (aucun compte rendu envoyé à l'heure de la mesure) |
| Planning lié | 60 % (108 / 179) | 93 % (67 / 72) |

Les chiffres retombent exactement sur les mesures de 6B et 6C. Planning lié
par ouvrier (12/10 → 25/10) : Selman 94 %, Davy 92 %, Mohamed 81 %, Venceslas
76 %, Steven 68 %, Margaux 12 %, Kev 8 % (3 / 40) — les lignes prévues pour Kev
et Margaux sont presque toutes tapées à la main.

Contrôle `verif-cr6-qualite-indicateurs.mjs` (80 contrôles, données fictives),
dans « Verify Planning Replanning V1 » à côté du contrôle de la page Qualité.
Un contrôle de 6A (qui vérifiait que le suivi qualité ne lisait pas le prévu)
a été rouge une fois puis adapté. Points d'attention : écarts des jours passés
recalculés avec les heures prévues d'aujourd'hui (écrit sur la page) ; la
tendance des écarts compare des nombres bruts (le nombre de comptes rendus
contrôlés est au survol) ; temps de chargement de la page non mesuré dans un
navigateur (calcul ≈ 50 ms sur 231 comptes rendus).

#### Compte rendu final de CR-6 (26/10/2026)

**CR-6 terminée : les cinq parties sont en ligne** (PR #184, #186, #188, #190,
#192, plus les mises à jour du document #183, #185, #187, #189, #191). Aucune
migration, aucun droit d'accès modifié, aucune donnée réelle réécrite.

Ce qui a changé :
- **Pour les ouvriers** : un seul parcours. Les tâches prévues s'affichent tout
  de suite, heures préremplies ; c'est l'ouvrier qui dit où en est chaque tâche
  (rien n'est prérempli d'après le planning) ; « Pas commencé » sans motif ;
  « J'ai fait autre chose » ajoute sans effacer ; une ligne du planning sans
  tâche propose la plus probable.
- **Pour Loris et les conducteurs** : à la validation, un écart orange
  « avancement incohérent » (plus de « Valider » direct) et l'avancement
  retenu qui ne se perd plus ; dans le planning, un compteur de lignes liées
  au phasage et la liaison en un clic ; deux outils de classement en masse
  (tâches hors devis, commandes sans lot) ; trois indicateurs de plus sur la
  page Qualité.
- **Pour la direction** : rien de visible tout de suite ; à terme, des
  avancements plus justes (donc production et marges plus fiables) et moins de
  lignes « sans lot » ou « sans tâche ».

Chiffres réels clés : lignes du planning liées 55 % sur W41-W43 → 93 % sur
W44 ; avancement incohérent sur les 2 dernières semaines : 11 tâches sur 9
comptes rendus (aucun « Valider » direct perdu à cause de lui) ; tâches hors
devis à classer : 429 (A 17, B 3, C 343, standard 66) ; commandes sans lot :
673 lignes, 19 682 € (moyenne 278, faible 352, aucune proposition 43).

À tester en priorité :
1. Compte rendu ouvrier sur un vrai téléphone : choisir un état pour chaque
   tâche, « J'ai fait autre chose », accepter la proposition d'une ligne sans
   tâche, envoi bloqué tant qu'une tâche avec des heures n'a pas d'état.
2. Validation du soir : un compte rendu avec « avancement incohérent » (orange,
   pas de « Valider » direct) ; recharger la page après avoir saisi un
   avancement retenu.
3. Planning : le compteur et « Lier » sur une ligne de la semaine.
4. Phasage → Hors devis → « Classement en masse » sur un chantier ; Commandes
   → « Lignes sans lot » (commencer par les propositions « moyennes »).
5. Qualité des comptes rendus : les trois nouvelles lignes après quelques
   jours de parcours unique.

Réglages Admin ajoutés : Taux horaires → « Validation des comptes rendus :
avancement incohérent » (`planning_config.seuils_avancement_incoherent`,
jamais enregistré = défauts 0,5 / 2 h / 25 points / cas « terminée qui
revient » actif).

Points en suspens (décisions de Loris) :
- **Lier automatiquement les anciennes lignes du planning ?** (reprise de
  données, non faite) — 580 propositions de confiance élevée, dont 37 sur
  W41-W44 ; recommandation du pilote : les 37 récentes ou rien.
- **Conducteurs sans accès au Phasage** dans la liste enregistrée en base
  (donc sans le classement des tâches hors devis).
- **DÉPOT** : lot obligatoire peu pertinent (97 lignes, 5 236 €).
- **Chantier repris** : aucun chantier coché (TOM & CAMILLE), donc « Tout
  laisser en l'état » n'apparaît nulle part.
- **Défaut existant** : un changement de lot à la main dans Commandes ne
  recalcule pas les relevés journaliers (l'outil de masse, lui, le fait).
- Rattacher une ligne du planning non liée n'est pas obligatoire côté ouvrier ;
  « Pas une tâche du chantier » ne vaut que dans le planning.

Entrées ajoutées au Journal des MAJ (26/10) : Compte rendu du soir : un seul
parcours · Validation : avancement retenu gardé au rechargement · Validation :
avancement qui ne colle pas avec les heures · Planning : lignes pas rattachées
au phasage signalées · Classement en masse (hors devis, commandes sans lot) ·
Qualité des comptes rendus : trois nouveaux indicateurs.

### Compte rendu final du projet (25/10/2026)

**Projet terminé.** Les neuf étapes du tableau de suivi sont en ligne.
(Complété le 26/10/2026 par CR-6, ajoutée par Loris : voir « Compte rendu
final de CR-6 » ci-dessus. Le point ouvert « avancement retenu gardé tant que
la page reste ouverte » est corrigé ; « environ 350 tâches hors devis » et
« 673 lignes de commande sans lot » ont maintenant leurs outils de classement
en masse.)

#### Ce qui a été livré, étape par étape
1. **Étape 1 — Fondations des données financières** : taux de frais généraux
   unique et daté, nature des coûts et reste à commander par lot, journal
   d'avancement daté (passé reconstitué : 4 796 lignes) et relevé de chaque
   chantier chaque jour, avec les comptes rendus manquants.
2. **Étape 2 — Trois marges et nouvelles alertes** : marge à l'avancement, à
   terminaison et probable sur chaque chantier, « marge nette » devenue
   « Budget restant », case « chantier repris », neutralisation d'une dérive
   par lot, et alertes fondées sur la marge probable au lieu de l'ancienne
   « perte de marge ».
3. **Étape 3 — Refonte du Bilan** : Bilan sur n'importe quelle période calculé
   sur les relevés journaliers, versions direction et détaillée, bilans figés
   et ligne « Rectifications », tendances par lot, semaine qui vient, prévu /
   réalisé, bilan de clôture ; les deux relevés du vendredi sont arrêtés
   (tables gardées).
4. **Étape 4 — Tâches hors devis** : cas A / B / C choisis à la validation et
   dans le phasage, avenant, geste commercial, décisions « à arbitrer » dans le
   Bilan, tâches souvent ajoutées dans la Bibliothèque.
5. **CR-1 — Diagnostic des comptes rendus** : page « Qualité des comptes
   rendus » avec indicateurs par ouvrier et tendance.
6. **CR-2 — Phasage lisible** : noms personnalisés d'ouvrages et de tâches (le
   libellé devis reste pour le client et ProGBat), pièces du chantier,
   duplication par pièce.
7. **CR-3 — Nouveau compte rendu ouvrier** : journée prévue, « comme prévu » /
   « pas comme prévu », phasage sur téléphone, temps au quart d'heure avec
   raccourcis, tâches faites à plusieurs ; interrupteur de retour en arrière.
8. **CR-4 — Dictée et IA** : « raconter sa journée au micro », l'IA prépare le
   compte rendu que l'ouvrier relit et envoie, texte d'origine toujours gardé,
   photo de fin de journée (coût estimé 1,5 à 3 € par mois).
9. **CR-5 — Page de validation** : journée lisible d'un coup d'œil, écarts en
   clair, « Valider » direct pour un compte rendu comme prévu, arbitrage d'une
   tâche faite à plusieurs, détail en grand avec budget de chaque tâche,
   « Valider et passer au suivant », répartition d'une tâche regroupée.

**Ce qui a changé** — pour la direction : un Bilan court (1 à 2 pages) dont
les marges ne baissent plus mécaniquement chaque semaine, et des alertes qui
ne se déclenchent plus sur un chantier qui gagne de l'argent ; pour les
conducteurs : phasage plus lisible, tâches hors devis classées, validation
plus rapide ; pour les ouvriers : compte rendu plus court, au micro si besoin.

**Principaux chiffres avant / après (vrais chantiers, semaine 2026-W43).**
Alertes critiques : 8 avant (dont 6 « perte de marge », y compris KATHLEEN T2
qui avait gagné 1 453 € cette semaine-là), 5 après (BRIOLLAY et TOURBOUTON
CO-LIVING : marge à terminaison négative ; marge probable en baisse sur
FOURMOND 102, FOURMOND 101, MONTILLERS APPT 2, avec le lot responsable). La
production et les coûts réels n'ont pas bougé d'une étape à l'autre (écart
maximal 29 €). Détail dans les comptes rendus des étapes 2 et 3.

#### Migrations appliquées
| Migration | Ce qu'elle fait | Appliquée par |
|---|---|---|
| `20261024120000_nature_couts_achats_lots` | nature des coûts sur les lignes de commande, table des lots « achats terminés » | Claude (outil Supabase en ligne de commande), accord de Loris |
| `20261024130000_journal_avancement` | journal d'avancement daté ; les 2 fonctions d'enregistrement du phasage y écrivent | Claude (ligne de commande), accord de Loris (droits confirmés a posteriori) |
| `20261024140000_releves_journaliers` | relevé de chaque chantier chaque jour | Claude (ligne de commande), accord de Loris |
| `20261024160000_releves_trois_marges` | colonnes des trois marges dans les relevés | Claude (ligne de commande) |
| `20261024170000_releves_couts_par_nature` | coûts par nature dans les relevés | Claude (ligne de commande) |
| `20261024180000_bilans_exports` | archive des bilans exportés (bureau seulement) | **Loris, à la main** dans l'éditeur SQL de Supabase, puis le correctif « revoke update, delete, truncate » (un bilan figé ne se modifie ni ne se supprime) ; enregistrée ensuite comme appliquée |
| `20261025090000_cr3_parcours_ouvrier` | noms personnalisés, pièces, journée prévue et déclarations des collègues pour l'écran ouvrier | Claude (ligne de commande), accord de Loris (mêmes appelants, un ouvrier ne voit que ses chantiers) |
| `20261025120000_cr4_dictee_photo_fin` | texte dicté et photos de fin de journée sur les comptes rendus | Claude (ligne de commande) |

Données reconstituées ou recalculées (avec accord) : journal d'avancement du
passé, 4 796 lignes ajoutées ; relevés journaliers du 12/05 au 24/10, 3 686
relevés, recalculés deux fois avec sauvegarde
(`chantier_releves_journaliers_sauvegarde_20261024`, 46 lignes ;
`chantier_releves_journaliers_sauvegarde_20261024b`, 3 686 lignes).
Étapes 4, CR-1, CR-2 et CR-5 : aucune migration.

#### À tester en priorité (dans cet ordre)
1. **Réglages → Taux horaires** : vérifier le taux de frais généraux (voir
   ci-dessous) — il entre dans toutes les marges.
2. **Validation fin de journée**, lundi soir, sur les vrais comptes rendus :
   la page de la journée (couleurs, écarts en clair, non envoyés), « Valider »
   sur un compte rendu gris, « Ouvrir et valider » sur un orange ou un rouge,
   « Valider et passer au suivant », la barre de budget d'une tâche, l'encart
   d'une tâche faite à plusieurs (« Appliquer aux deux »), et « Découper » sur
   une tâche regroupée (répartition).
3. **Compte rendu ouvrier** sur un téléphone Android ET un iPhone (application
   installée) : « Journée comme prévu », « Ça ne s'est pas passé comme prévu »,
   créer une tâche, le micro « Raconter ma journée », la photo de fin de
   journée. En cas de problème : Réglages → Utilisateurs → « Nouveau parcours
   du compte rendu » (éteint = ancien écran, brouillons gardés).
4. **Phasage** d'un chantier en cours : les quatre cartes (budget restant et
   trois marges), le détail de la marge probable par lot et « Neutraliser… »,
   la case « Chantier repris » (à cocher sur les trois TOM & CAMILLE), renommer
   un ouvrage ou une tâche, les pièces et « Dupliquer par pièce », le bouton
   « Hors devis » (KATHLEEN, par exemple).
5. **Équipe → Bilan** sur la semaine 43 : présélection des chantiers,
   avertissements, export direction puis détaillé (relire la phrase de
   synthèse IA avant), puis modifier un avancement daté de cette semaine et
   vérifier la ligne « Rectifications » du bilan suivant.
6. **Page Alertes** : les nouvelles alertes et leurs explications.
7. **Commandes** : lot obligatoire, nature du coût, « achats terminés » sur un
   lot.
8. **Bibliothèque** (tâches souvent ajoutées) et **Qualité des comptes
   rendus**.

#### Réglages à vérifier dans Admin
| Où | Réglage | Valeur actuelle |
|---|---|---|
| Réglages → Taux horaires | Taux de frais généraux, daté | **jamais enregistré** : l'application applique le défaut, 17,44 €/h depuis le 01/01/2026. Enregistrer la vraie valeur. |
| Réglages → Taux horaires | Taux horaire de chaque ouvrier | doit être le COÛT CHARGÉ (décision métier 9) |
| Réglages → Taux horaires → « Marge probable et alertes » | dérive constatée appliquée à partir de | 25 % d'avancement du lot |
| idem | plafond / plancher du coefficient | ×5 / ×1 (le plancher n'est pas réglable : décision de Loris) |
| idem | dérive historique : chantiers terminés minimum | 2 |
| idem | alerte baisse de marge probable | 500 € |
| idem | lot en dérive | ×1,3 dès 25 % d'avancement |
| idem | heures sans lot | 10 % |
| idem | production par heure aberrante | ×2 |
| idem | dépassement d'enveloppe matériaux | à partir de 100 € |
| idem | consommation sans avancement | 1 point / 2 h / 50 € |
| idem → « Tâches hors devis » | rappel d'arbitrage | au-delà de 3 semaines |
| Réglages → Utilisateurs | « Nouveau parcours du compte rendu » | activé pour tous |
| Réglages → Vue d'ensemble | compteur du contrôle de nuit du journal d'avancement | doit rester à 0 écart |
| Réglages → Accès | page « Qualité des comptes rendus » | visible pour admin (automatique) ; **pas** pour conducteur (absente de la liste enregistrée) : à cocher si les conducteurs doivent la voir |

#### Points restés ouverts
- **TOM & CAMILLE** (RDC, R+1, R+2) : à cocher « chantier repris » par Loris ;
  d'ici là, ils entrent dans les alertes et les tendances.
- **673 lignes de commande sans lot** (19 682 €) : déduites du reste à
  commander global, jamais d'un lot.
- **Liste d'aide de « Commandes à passer »** : quantités encore calculées par
  unité d'ouvrage (non multipliées par la quantité de l'ouvrage).
- **Environ 350 tâches hors devis anciennes** à classer à la main (A / B / C),
  surtout TOM & CAMILLE, BRIOLLAY et METOIS.
- **Écrans ouvriers « Préparation » et « Chantier »** : affichent encore le
  libellé du devis (leurs fonctions serveur n'ont pas été modifiées).
- **`ouvrier_mes_phases`** ne vérifie pas que l'ouvrier est affecté au chantier
  demandé (déjà le cas avant le projet, rien élargi ni restreint).
- **Dépendances des tâches dupliquées par pièce** : les tâches qui dépendaient
  de la tâche d'origine ne dépendent pas automatiquement de ses copies.
- **Micro sur iPhone** quand l'application est installée sur l'écran
  d'accueil : à confirmer à l'usage (le micro du clavier marche dans tous les
  cas).
- **Relevés du vendredi** : arrêtés, tables gardées en lecture pour
  l'historique ; ils peuvent être relancés à la main.
- **Prévu / réalisé, glissement de la fin et « Rectifications »** ne
  fonctionnent qu'à partir du premier bilan exporté (avant : « pas de bilan
  précédent »).
- **Validation** : l'avancement retenu d'une tâche faite à plusieurs est gardé
  tant que la page reste ouverte (voir CR-5).

#### Entrées ajoutées au Journal des MAJ (`src/Renovation/journalMaj.js`)
Frais généraux : un seul taux daté · Commandes : nature, lot obligatoire,
reste à commander par lot · Avancement daté · Relevé de chaque chantier chaque
jour · Trois marges par chantier · Nouvelles alertes · Coefficient jamais
sous ×1 · Nouveau Bilan sur n'importe quelle période · Bilan détaillé ·
Décisions attendues, tendances, semaine qui vient · Bilan de clôture · Bilans
figés et rectifications · États financiers et export Opérations sur les
relevés journaliers · Assistant IA sur les relevés journaliers · Relevés du
vendredi arrêtés · Commandes de la semaine qui vient et glissement · Tâches
hors devis à la validation, dans le phasage, au Bilan · Tâches souvent
ajoutées · Qualité des comptes rendus (page, puis écart d'avancement) ·
Renommer un ouvrage ou une tâche · Pièces du chantier · Nouveau parcours du
compte rendu · Dictée et IA · Validation : la journée d'un coup d'œil · le
détail en grand et « Valider et passer au suivant » · répartir une tâche
« fourre-tout ».

#### Retouche du PDF du Bilan (26/10/2026)
À la lecture du PDF de la semaine 43, Loris a demandé de retravailler ce qui
est mis en avant, surtout les marges. La version direction montre maintenant,
pour chaque chantier, la marge prévue au devis face à la marge probable (en
euros et en pourcentage du vendu), l'écart entre les deux, l'évolution de la
semaine et l'euro produit par heure à côté de celui du devis. Les autres
marges sont dans la version détaillée. Les alertes sont un tableau court (au
plus 3 points par chantier, du plus coûteux au moins coûteux) ; les constats
qui reviennent chaque semaine sont renvoyés à la version détaillée. Les
journées incomplètes et les chantiers sans activité tiennent chacun en une
ligne. La page Bilan affiche le même tableau (case « Détail des marges » pour
voir les autres colonnes). Aucune migration.

Bandeau de la semaine 43 sur les vraies données (base du 26/10/2026,
comparaison du ven. 16/10 au jeu. 22/10) : production 9 152 € ; marge de la
semaine −327 € (−4 % de la production) ; marge probable des 8 chantiers
comparables 72 706 €, soit 28 % du vendu, contre 107 534 € (42 %) au devis,
en baisse de 9 367 € sur la semaine (tous chantiers) ; 232,8 h validées,
39 €/h produits contre 120 €/h au devis. Trois chantiers sont hors du total :
les trois TOM & CAMILLE, dont les ouvrages n'ont aucun matériau prévu.

Quelques lignes du nouveau tableau (vraies données) :

| Chantier | Avancement | Vendu HT | Marge devis | Marge probable | Écart / devis | Semaine |
|---|---|---|---|---|---|---|
| FOURMOND 102 | 41 % | 29 793 € | 11 075 € (37 %) | −15 € (0 %) | −11 090 € | −3 681 € |
| FOURMOND 101 | 46 % | 33 900 € | 12 923 € (38 %) | 3 207 € (9 %) | −9 716 € | −3 482 € |
| KATHLEEN T2 | 41 % | 20 815 € | 10 381 € (50 %) | 9 232 € (44 %) | −1 149 € | −43 € |
| MONTILLERS APPT 1 (T3) | 6 % | 32 156 € | 14 789 € (46 %) | 14 489 € (45 %) | −300 € | +506 € |

Points d'attention : l'écart au devis des FOURMOND (−9 000 à −11 000 €) vient
des lots en dérive (murs, cloisons, doublages surtout) et des heures déjà
passées ; le coût moyen réel d'une heure pointée sur la période (19,94 €/h)
est au niveau du taux de main-d'œuvre prévisionnel réglé dans Admin (20 €/h).
Si ce taux n'est pas le coût chargé, toutes les marges devis et à terminaison
sont trop belles : à vérifier dans Admin (Réglages → Taux horaires).
**Version détaillée, fiches chantier (26/10/2026).** Après lecture du PDF
détaillé, chaque fiche commence par « Du devis au probable » : la marge devis,
les postes qui mènent à la marge à terminaison (heures sur les lots au-delà de
ce que l'avancement justifie, heures hors des lots — sans lot, trajets, hors
devis —, reste à faire réestimé, coût réel de la main-d'œuvre face au taux
prévisionnel, frais généraux, matériaux, sous-traitance et autres coûts), puis
la dérive des 3 lots qui pèsent le plus jusqu'à la marge probable. Le tableau
des lots ne garde que les lots commencés ou qui pèsent sur la marge ; les
autres tiennent en une ligne « À venir ». Les matériaux sont détaillés par lot
(enveloppe, commandé, imputé, en avance, reste à commander, dépassement), avec
les commandes sans lot à part. Aucune migration.

Exemple réel (base du 26/10/2026, relevé du 22/10) — FOURMOND 102 : marge
devis 11 075 € (37 %) ; heures sur les lots au-delà de l'avancement +81,6 h
−3 055 € ; heures hors des lots +28,5 h −1 068 € ; reste à faire réestimé
+24,3 h −909 € ; coût réel de la main-d'œuvre −245 € ; = marge à terminaison
5 797 € (19 %) ; dérive Murs cloison doublages (×2,68) −4 335 €, Plomberie
(×1,73) −1 087 €, Électricité (×1,29) −315 €, autres lots −76 € ; = marge
probable −15 € (0 %). FOURMOND 101 : marge devis 12 923 € (38 %) ; −2 541 €
(+67,9 h sur les lots), −1 693 € (+45,2 h hors des lots), −945 € (+25,2 h
réestimées), −164 € (main-d'œuvre), −439 € (matériaux) ; = 7 142 € (21 %) ;
dérive Murs cloison doublages (×2,34) −3 784 €, Menuiserie −106 €,
Électricité −45 € ; = marge probable 3 207 € (9 %). Les trois TOM & CAMILLE
n'ont aucun matériau prévu : leur fiche dit « marge devis non comparable » et
ne donne que le passage de la marge à terminaison à la marge probable.

Point d'attention : le poste « reste à faire réestimé » (+24 à +32 h sur les
FOURMOND) signifie que les heures estimées des tâches restantes dépassent la
part non faite des heures prévues des ouvrages : des tâches ont été ajoutées
ou réévaluées dans le phasage. À regarder dans le phasage de ces chantiers.

#### Base d'heures unique (29/10/2026)

Constat de Loris sur FOURMOND 102 (Électricité : 36,49 h « attendues ») : les
heures attendues partaient des heures de l'ouvrage, les heures restantes des
heures des tâches, qui ne concordaient pas (tâches à 55,9 h pour un ouvrage
de 49 h, % à 106 %). Décisions de Loris : voir le Journal des décisions
(29/10/2026, deux entrées).

**Ce qui a changé (en ligne, #195 et #196).**
- Une seule base : les heures prévues de l'ouvrage (bibliothèque, ou saisies à
  la main dans le phasage — jamais écrasées par un report de la
  bibliothèque). Chaque tâche d'origine devis en reçoit sa part selon son %,
  ramené à 100 % dans le calcul. L'avancement d'un lot est pondéré par les
  heures prévues. La production reste prix × avancement, ouvrage par ouvrage.
- Une tâche de nature « Reprise » ne fait plus avancer l'ouvrage ; son temps
  reste dans les coûts et la dérive.
- Phasage : les % des tâches d'un ouvrage doivent faire 100 % pour
  enregistrer (« Ajuster la dernière tâche », « Répartir l'écart ») ; la
  provenance des heures prévues est affichée.
- Écran ouvrier : `ouvrier_mes_phases` (migration `20261029120000`, accord de
  Loris) renvoie pour chaque tâche d'origine devis sa part des heures de
  l'ouvrage, calculée comme au bureau : l'avancement d'ouvrage affiché aux
  ouvriers est celui du bureau. Vérifié sur la base : corps en base identique
  au fichier, mêmes droits (authenticated, service_role), et sur le contenu
  reçu par un vrai compte ouvrier (FOURMOND 102) seule la valeur de
  `heures_estimees` change (37 tâches), aucun champ nouveau, aucun % ni
  montant.

**Avant → après sur les vrais chantiers** (mesuré le 29/10 avant la mise en
ligne ; production et marge à l'avancement : moins de 50 € d'écart).

| Chantier | Marge à terminaison | Marge probable |
|---|---|---|
| FOURMOND 102 | 4 440 → 5 188 € (+748) | −298 → 1 216 € (+1 514) |
| FOURMOND 101 | 5 243 → 5 994 € (+751) | 1 517 → 3 194 € (+1 676) |
| FOURMOND 001 | 8 608 → 9 390 € (+782) | 5 092 → 5 936 € (+844) |
| BRIOLLAY APPT 1 | 20 587 → 21 459 € (+872) | 20 512 → 21 459 € (+947) |
| TOURBOUTON 101 | +541 € | +541 € |
| KATHLEEN T2 | −173 € | −440 € |
| LOUISON APPT 3 | −434 € | −434 € |
| FOUGERAY COMMUN | 6 434 → 4 974 € (−1 460) | −1 460 € |

Six chantiers varient de plus de 500 € : validé par Loris (effet voulu).

**Relevés journaliers.** Sauvegarde
`chantier_releves_journaliers_sauvegarde_20261029` (3 697 lignes, lecture
serveur seulement + « réservé aux collaborateurs »), puis recalcul de tous
les relevés avec le nouveau calcul : 3 911 relevés pour 45 chantiers (les
3 697 existants, tous recalculés, plus les jours manquants jusqu'au 29/10 ;
aucun relevé perdu). Dérives historiques recalculées. Vérifié : FOURMOND 102
au 29/10 = marge à terminaison 5 188 €, marge probable 1 216 €, comme
l'avant/après.

**Restent à Loris.** Corriger dans la Bibliothèque les modèles dont les % ne
font pas 100 (MU-001, MU-002, E-002, MU-021, PL-002…) puis « Appliquer à tous
les chantiers » : 89 ouvrages sur 31 chantiers sont concernés (aucune
correction en masse). Vérifier les cadences nettement sous le devis
(installation électrique T2 : 49 h contre 62 h, sur 5 chantiers ; T3 : 60 h
contre 79,5 h ; doublage MU-001 sur 13 chantiers). Passer en nature
« Reprise » les tâches qui corrigent une erreur (par exemple « Réparation
mauvais emplacement de trou », FOURMOND 102).


---

## 5. Cahier des charges des étapes

### Étape 1 — Fondations des données financières (TERMINÉE)

> Déjà réalisée avant la création de ce document. Au début de l'étape 2, vérifie
> ce qui est réellement en ligne (code ET base : migrations appliquées, journal
> initialisé, reconstitution du passé faite ou non, crons) et signale tout écart
> avec ce cahier des charges dans le compte rendu de l'étape 2. Ne refais pas
> l'étape ; complète seulement ce qui manque si c'est indispensable à la suite.

#### 1A — Taux horaire de frais généraux unique et daté
- Réglage global dans Admin, stocké dans planning_config sous forme de liste
  datée, par exemple [{ depuis: "2026-01-01", taux: 17.44 }]. Défaut 17,44 €/h
  depuis le 01/01/2026.
- Frais généraux d'une heure = taux en vigueur à la date du pointage. Reprise
  d'antériorité : le taux le plus ancien. Projections : le taux en vigueur
  aujourd'hui.
- Le module reçoit la liste des taux en paramètre ; tous les appelants à jour.
- Le champ par phasage `plan_travaux.meta.fg_taux_horaire` n'est plus lu ni
  affiché ; l'avertissement « Définis un taux horaire de frais généraux »
  disparaît. METHODE_CALCUL à jour.

#### 1B — Nature des coûts et enveloppe matériaux par lot
- Colonne nature sur commande_lignes : materiaux (défaut), sous_traitance,
  location, dechets, autre.
- Lot obligatoire à la saisie pour une ligne rattachée à un chantier.
- Ventilation des coûts réels par nature.
- Reste à commander par enveloppe : par lot, max(0, enveloppe − commandes
  matériaux du lot) ; lot « achats terminés » → 0 ; commandes matériaux sans lot
  déduites du reste total (plancher 0) avec avertissement chiffré.
- Marquage « achats terminés » par lot, daté, avec auteur, réversible.
- Dépassement d'enveloppe renvoyé par le module (€ et %).
- Page Commandes à passer et marge à terminaison utilisent la même fonction.

#### 1C — Journal d'avancement daté et production exacte
- Table de journal : chantier_id, phasage_id, ouvrage_id, tache_id,
  avancement_avant, avancement_apres, date_realisation, source (validation_cr |
  phasage | correction | reconciliation | initial), auteur, rapport_id,
  created_at.
- Tous les chemins d'écriture d'avancement passent par une seule fonction.
- date_realisation : date du rapport pour une validation ; dernier jour où la
  tâche a été déclarée pour une modification depuis le phasage (à défaut la date
  du jour), préremplie et modifiable.
- Contrôle nocturne de réconciliation avec compteur visible.
- Ligne « initial » par tâche au déploiement ; reconstitution du passé proposée
  en simulation puis appliquée après accord.
- Module pur : état des tâches à une date D ; avancement d'ouvrage non arrondi
  (nouvelle fonction, l'arrondi d'affichage reste).
- Production d'une période = somme par ouvrage de prix_ht × (avancement exact fin
  − début). margeReelleSemaine et la marge depuis le début l'utilisent.

#### 1D — Relevés journaliers
- Table de relevé par chantier et par jour (unique chantier_id + date) avec les
  colonnes de chantier_snapshots_hebdo, un statut complete / incomplete et la
  liste des comptes rendus attendus manquants ou non validés (ouvriers planifiés
  hors absences).
- Recalcul à chaque validation, correction ou modification d'avancement datée ;
  recalcul des jours suivants dépendants.
- Cron de nuit de rattrapage, horaire tardif été comme hiver.
- Crons du vendredi conservés, horaire corrigé (plus tard que 16h UTC).

---

### Étape 2 — Les trois marges, la marge probable et les nouvelles alertes

#### Contexte
L'étape 1 est en ligne : taux de frais généraux global et daté, nature des coûts
et enveloppe matériaux par lot, journal d'avancement daté, production exacte
calculée ouvrage par ouvrage, relevés journaliers. Cette étape porte sur les
INDICATEURS, dans src/chantierFinance.mjs et le module des points d'attention.
La refonte de l'affichage du Bilan viendra à l'étape 3 : ici, on met seulement à
jour les endroits qui affichent déjà ces indicateurs (page Phasage, Bilan
actuel), sans refondre leur présentation.

#### 1. Supprimer la « marge nette »
Aujourd'hui, marge nette = vendu HT total − coûts engagés à date. Ce n'est pas une
marge, c'est un budget restant (exemple : un chantier à 0 % affiche 99 % de marge).
- Renomme-la « Budget restant » partout où elle reste utile, ou retire-la si elle
  n'apporte rien à côté des trois marges. « Marge % » sur cette base disparaît.
- Fais l'inventaire de tous ses usages : affichages, colonne `marge` des relevés,
  assistant IA, points d'attention. Aucun ne doit plus la présenter comme une
  marge.

#### 2. Les trois marges (module pur, mêmes données partout)
##### a) Marge à l'avancement (« où j'en suis », un constat)
= production cumulée à la date (production exacte de l'étape 1) − coûts réels
imputés à la date (MO + frais généraux + coûts des autres natures + matériaux
imputés).
Matériaux imputés à l'avancement, par lot :
- consommé théorique = enveloppe du lot × avancement exact du lot ;
- matériaux en avance = min( max(0, commandés matériaux du lot − consommé
  théorique), enveloppe × (1 − avancement) ) ;
- imputé = commandés du lot − matériaux en avance.
Effets attendus : un lot terminé impute tout ; un dépassement d'enveloppe est
imputé tout de suite ; seul un achat anticipé dans la limite de l'enveloppe est
différé. Les commandes matériaux sans lot et les autres natures (sous-traitance,
location, déchets) sont imputées directement. Le module renvoie le montant des
« matériaux en avance sur chantier », pour l'affichage.
##### b) Marge de la période
= marge à l'avancement en fin de période − marge à l'avancement en début de
période. Elle remplace le calcul actuel de margeReelleSemaine, pour que la marge
de la semaine et la marge cumulée soient toujours cohérentes entre elles.
##### c) Marge à terminaison (« si le reste se passe comme le devis »)
= vendu − coûts réels à date − heures restantes × (taux MO prévisionnel + taux de
frais généraux en vigueur) − reste à commander (enveloppe, étape 1B).
##### d) Marge probable (« si on continue au rythme actuel »)
Comme la marge à terminaison, mais les heures restantes de chaque lot sont
multipliées par un coefficient :
- si l'avancement exact du lot est ≥ 25 % (seuil réglable dans Admin, 25 % par
  défaut) : la dérive constatée du lot, plafonnée à ×5 ;
- si le lot est sous le seuil : la dérive historique de ce type de lot, soit la
  moyenne pondérée par les heures sur les chantiers terminés, en excluant les
  chantiers repris (voir point 4), avec au moins 2 chantiers. À défaut : ×1 ;
- si le conducteur a neutralisé la dérive du lot : ×1. La neutralisation se fait
  par lot et par chantier, avec un commentaire obligatoire, un auteur et une date ;
  elle est réversible et visible partout où la marge probable est affichée.
Le module renvoie aussi, par lot : le coefficient appliqué et sa provenance
(constatée / historique / neutralisée / aucune), les heures restantes prévues et
probables, et l'écart en euros.
Les heures « sans lot » n'entrent dans aucun coefficient (elles restent dans les
coûts réels).

#### 3. Dérive d'un lot exprimée en heures et en euros
Pour chaque lot : heures attendues à cet avancement = heures prévues × avancement ;
écart en heures = heures réelles comparables − heures attendues ; écart en euros
= écart en heures × (coût horaire MO réel moyen du lot + taux de frais généraux).
Le ratio ×N reste disponible, mais ces deux valeurs deviennent l'information
principale.

#### 4. Case « chantier repris »
Une case par chantier, avec date et auteur : le chantier a démarré avant
l'application, ses données d'origine ne sont pas fiables (exemple : les chantiers
TOM & CAMILLE). Un chantier repris est exclu des dérives historiques, des
statistiques de cadences de la bibliothèque (reportRatiosBibliotheque) et des
alertes automatiques. Ses chiffres restent affichés, avec la mention « chantier
repris ».

#### 5. Nouvelles alertes (remplacent la règle actuelle « perte de marge »)
La règle actuelle compare la « marge nette » de deux relevés : elle se déclenche
dès qu'un chantier consomme plus de 500 € dans la semaine, même quand il gagne
de l'argent. Elle disparaît. Les alertes, calculées sur les relevés journaliers,
deviennent (tous les seuils réglables dans Admin) :
- marge probable en baisse de plus de 500 € par rapport au relevé de comparaison ;
  l'explication cite le ou les lots responsables, en heures et en euros ;
- un lot qui dérive au-delà de ×1,3 avec au moins 25 % d'avancement ;
- plus de 10 % d'heures « sans lot » sur le chantier ;
- une production par heure aberrante sur la période : € produits ÷ heures de la
  période > 2 × (vendu HT ÷ heures vendues du chantier) ;
- un dépassement d'enveloppe matériaux d'un lot (calculé à l'étape 1B) ;
- la règle « consommation sans avancement » est conservée, calculée avec la
  production exacte.
Supprime la phrase d'explication qui répète la ligne principale. Un chantier
repris ne déclenche aucune alerte.

#### Règles propres à l'étape
- Dans le compte rendu, un tableau avant/après sur les VRAIS chantiers (requête
  sur la base) : marge à l'avancement, marge de la semaine 2026-W43, marge à
  terminaison, marge probable, matériaux en avance, et la liste des alertes
  avant/après pour la semaine 2026-W43. Explique chaque écart important en une
  phrase.
- Scripts verif-*.mjs, avec au minimum :
  - achat anticipé dans l'enveloppe (différé) ;
  - dépassement d'enveloppe (imputé tout de suite) ;
  - lot terminé ;
  - lot à 10 % avec une dérive de ×3 (pas appliquée, historique utilisé) ;
  - lot à 40 % avec une dérive de ×2 (appliquée) ;
  - dérive neutralisée ;
  - historique avec moins de 2 chantiers (×1) ;
  - chantier repris exclu de l'historique et des alertes ;
  - semaine où le chantier progresse et gagne de l'argent (aucune alerte de perte) ;
  - production par heure aberrante.
- METHODE_CALCUL (annexe du Bilan) mis à jour avec toutes les nouvelles formules.

---

### Étape 3 — Refonte de la page Bilan semaine et de son export PDF

#### Contexte
Les étapes 1 et 2 sont en ligne. Cette étape refond la page Équipe → Bilan
semaine (src/Renovation/BilanSemaine.jsx) et son export PDF / e-mail.
Aujourd'hui le PDF fait environ 11 pages et mélange deux publics : la direction,
qui doit décider, et le conducteur de travaux, qui pilote.

#### 1. Base de calcul
- Le Bilan s'appuie sur les relevés journaliers (étape 1D), et non plus sur les
  photos du vendredi. Une semaine se compare du dernier jour travaillé de la
  semaine précédente au dernier jour travaillé de la semaine courante.
- Le Bilan permet de choisir n'importe quelle période (semaine par défaut,
  mais aussi mois ou dates libres), notamment pour préparer les situations de
  travaux mensuelles.
- Une fois ce Bilan en place, propose à Loris ce qu'on fait des deux crons du
  vendredi et de chantier_snapshots_hebdo (suppression, ou maintien en lecture
  seule pour l'historique). Ne supprime rien sans son accord ; si tu attends sa
  réponse, tu peux poursuivre les étapes suivantes en parallèle.

#### 2. Sélection des chantiers à exporter
- Sont cochés par défaut les chantiers ayant eu de l'activité sur la période :
  au moins une heure pointée (validée ou non), un avancement modifié ou une
  commande datée de la période.
- Les décochages manuels sont conservés tant qu'on reste sur la même période ; la
  présélection se refait quand on change de période.
- Les chantiers en cours sans activité restent dans la liste, décochés, avec la
  mention « aucune activité sur la période ». Dans le PDF, une ligne les cite :
  « Chantiers en cours sans activité : … ».
- Avant l'export, un avertissement liste les comptes rendus soumis mais non
  validés et les journées incomplètes de la période, par chantier : « 3 comptes
  rendus non validés (FOURMOND 102, KATHLEEN) : chiffres incomplets ». Les journées
  incomplètes sont aussi signalées dans le PDF.

#### 3. Deux versions d'export
Au moment de l'export : une case « version détaillée ».
##### Version direction (1 à 2 pages, par défaut)
Page 1 :
- bandeau : production de la période, marge de la période, évolution de la marge
  probable totale, heures validées, nombre de comptes rendus non validés ;
- synthèse par chantier : avancement, production, marge de la période, marge à
  l'avancement, marge à terminaison, marge probable, € produits par heure. Pastille
  de couleur avec une légende qui explique les critères ;
- mentions « démarrage » (première ou deuxième semaine d'activité),
  « réception / levée de réserves » (chantier à 100 % qui consomme encore, avec
  un compteur d'heures après réception) et « chantier repris » ;
- ligne des chantiers en cours sans activité.
Page 2 :
- alertes (étape 2), chacune avec le lot responsable et l'écart en heures et en
  euros ;
- décisions attendues ;
- tendances par lot (voir point 5) ;
- la semaine qui vient (voir point 6) ;
- ligne « Rectifications » (voir point 4).
##### Version détaillée
Version direction + une fiche par chantier :
- tableau des lots : heures réelles / prévues, avancement, écart en heures et en
  euros, heures restantes prévues et probables, provenance du coefficient de la
  marge probable, ligne « sans lot » mise en évidence au-delà de 10 % ;
- matériaux : commandés, imputés, en avance, reste à commander, et la ventilation
  par nature des coûts ;
- tâches résumées par lot (« Murs cloisons : 6 terminées, 2 en cours »), puis le
  détail des tâches ;
- une phrase de synthèse de la semaine générée par l'IA de l'application
  (api/_ia) à partir des comptes rendus. Elle s'affiche dans la page, modifiable,
  et c'est la version relue qui part dans le PDF ;
- présences sur une ligne : « Davy 4 j · Selman 4 j · Kev 2 j » ;
- une ou deux photos de la semaine, issues des comptes rendus, choisies par le
  conducteur dans la page (aucune par défaut si rien n'est choisi) ;
- annexe « Méthode de calcul ».
Les commentaires bruts des ouvriers (et toute appréciation d'un ouvrier sur un
autre) n'apparaissent JAMAIS dans la version direction. Dans la version
détaillée, seulement si le conducteur les a cochés.

#### 4. Bilans figés et rectifications
- Chaque export (PDF ou e-mail) est archivé : période, chantiers, chiffres
  affichés, fichier. Un bilan exporté ne change plus.
- Quand une donnée datée d'une période déjà exportée est ajoutée ou modifiée
  après l'export (compte rendu validé en retard, avancement modifié depuis le
  phasage, commande saisie en retard), le bilan suivant affiche une ligne
  « Rectifications » : chantier, période concernée, montant, cause.

#### 5. Tendances par lot (tous chantiers)
Un tableau par type de lot : nombre de chantiers, dérive moyenne pondérée par les
heures, écart total en heures et en euros, sur les chantiers en cours ayant au
moins 25 % d'avancement dans le lot et sur les chantiers terminés. Les chantiers
repris sont exclus. Signaler en clair le lot qui dérive le plus. Réutilise ce qui
existe dans reportRatiosBibliotheque.

#### 6. Semaine qui vient et prévu / réalisé
- La section « La semaine qui vient » est calculée et affichée par défaut, sans
  avoir à lancer le calcul : équipe prévue par chantier, commandes à passer,
  livraisons attendues, jalons.
- Prévu / réalisé par chantier : l'avancement prévu par le moteur de planning
  pour la période face à l'avancement réalisé, et la date de fin prévisionnelle
  avec son glissement depuis le bilan précédent.

#### 7. Décisions attendues
- Rappel des blocages des bilans précédents limité aux 4 dernières semaines
  (aujourd'hui, il peut remonter à 11 semaines).
- Avant l'export, l'application propose des décisions que le conducteur valide ou
  écarte : tâches en cours depuis 3 semaines ou plus (existe déjà), comptes rendus
  qui mentionnent « en attente » (carottage, client, livraison…), et un
  emplacement prévu pour les tâches hors devis à arbitrer (alimenté à l'étape 4).

#### 8. Bilan de clôture d'un chantier
Quand un chantier passe à 100 % et est réceptionné : un bilan de clôture devis /
réel, ouvrage par ouvrage et lot par lot (heures, matériaux, marge finale), avec
la proposition de mise à jour des cadences de la bibliothèque
(reportRatiosBibliotheque). Pas pour un chantier repris.

#### 9. À supprimer
- « 35 tâches » dans le bandeau ;
- les phrases grises qui répètent la ligne principale dans les points d'attention ;
- « Situation à facturer » tant que le % facturé n'est pas fiable (la trésorerie
  sera traitée plus tard : ne l'ajoute pas) ;
- la « marge nette » et « marge % » s'il en reste.

#### Règles propres à l'étape
- Dans le compte rendu, joins le PDF direction et le PDF détaillé de la semaine
  2026-W43 générés sur les VRAIES données (pas de données de test).
- Scripts verif-*.mjs, avec au minimum :
  - présélection (chantier sans activité décoché, chantier avec seulement une
    commande coché) ;
  - bilan figé puis donnée rétrodatée → ligne « Rectifications » ;
  - version direction sans aucun commentaire brut ;
  - rappel des blocages limité à 4 semaines ;
  - chantier repris exclu des tendances.

---

### Étape 4 — Tâches hors devis : réaffecter, intégrer ou arbitrer

#### Contexte
Les étapes 1 à 3 sont en ligne. Cette étape traite les tâches hors devis dans la
validation de fin de journée (src/Renovation/Validation.jsx), le phasage
(PhasageV2) et le Bilan. L'écran de compte rendu des ouvriers sera repensé à
l'étape CR-3 : ici, on prépare seulement les données dont il aura besoin.

Une tâche hors devis correspond à l'un de ces trois cas :
- A. La tâche existait dans le phasage, l'ouvrier ne l'a pas trouvée ;
- B. Un travail imprévu au phasage, mais compris dans un ouvrage vendu ;
- C. Un travail non vendu, qui sera offert au client ou facturé par un avenant
  futur.

#### 1. Données
- Un motif sur les tâches / lignes hors devis : introuvable (A) | imprevu (B) |
  demande_client (C) | non_renseigne (lignes existantes). L'écran ouvrier le
  remplira à l'étape CR-3 ; le conducteur peut le fixer ou le corriger à la
  validation et dans le phasage.
- Un statut d'arbitrage pour le cas C : a_arbitrer | avenant | geste_commercial,
  avec date et auteur.
- Un indicateur « ajoutée en cours de chantier » sur les tâches du cas B.

#### 2. Validation de fin de journée
Pour une ligne hors devis, le conducteur choisit le cas :
- A : réaffecter les heures à la tâche existante (la fonction de réaffectation
  existe déjà), sans créer de tâche. L'application propose les tâches les plus
  probables (même chantier, même lot, tâches prévues ce jour-là, mots proches).
- B : créer la tâche dans l'ouvrage choisi, marquée « ajoutée en cours de
  chantier ». Ses heures estimées sont les heures NORMALES de ce travail, pas les
  heures réellement passées : l'application propose la cadence de la bibliothèque
  si elle existe, sinon le conducteur saisit une estimation. Les heures vendues de
  l'ouvrage ne changent pas, pour que la dérive reste visible.
- C : la ligne reste hors devis avec le statut « à arbitrer ».

#### 3. Phasage
- Les mêmes choix sont possibles depuis le phasage pour les tâches hors devis
  existantes (reprise du passé, par exemple sur KATHLEEN).
- Rattachement d'une tâche C à un ouvrage d'avenant : quand l'avenant est signé et
  l'ouvrage créé avec son prix, la tâche y est rattachée. L'avancement passe par
  le journal (étape 1C) avec comme date de réalisation le dernier jour où la tâche
  a été déclarée. Si cette date tombe dans une période déjà exportée, la
  production apparaît dans la ligne « Rectifications » du bilan suivant.
- Passage en « geste commercial » : la tâche reste un coût sans production.
- Un ouvrage non facturé (prix 0) peut être marqué « non facturé » ; il ne crée
  pas de production.
- À chaque déplacement d'une tâche hors devis, l'application demande d'abord :
  « Ce travail est-il facturé au client ? » et guide vers le bon cas.

#### 4. Bilan et alertes
- Décisions attendues : les tâches « à arbitrer », par chantier, avec les heures
  et le coût (MO + frais généraux), par exemple « KATHLEEN : 3 tâches hors devis à
  arbitrer, 12 h, environ 450 € — avenant ou offert ? ». Rappel si non arbitrées
  au-delà de 3 semaines (réglable dans Admin).
- Gestes commerciaux : le total par chantier (heures et euros) dans la fiche
  chantier, et le total de la période dans le bandeau de la version détaillée.
- Les heures hors devis par motif (A non encore réaffectées, B, C) sont visibles
  dans la fiche chantier.

#### 5. Tâches oubliées et bibliothèque
- Compter les tâches « ajoutées en cours de chantier » par modèle d'ouvrage de la
  bibliothèque.
- Dans la Bibliothèque, pour chaque modèle d'ouvrage : « tâches souvent ajoutées »
  (au moins 2 chantiers, chantiers repris exclus), avec un bouton pour les ajouter
  au modèle.

#### Règles propres à l'étape
- Dans le compte rendu, la liste réelle (requête sur la base) des tâches hors
  devis existantes par chantier, avec heures, coût et motif proposé
  automatiquement.
- Scripts verif-*.mjs, avec au minimum :
  - cas A réaffecté (pas de nouvelle tâche, pas de double production) ;
  - cas B avec 1 h normale et 3 h réelles (le poids reste 1 h) ;
  - cas C passé en avenant avec une date dans une semaine déjà exportée
    (rectification) ;
  - cas C passé en geste commercial (coût sans production, total affiché) ;
  - rappel d'arbitrage au-delà de 3 semaines ;
  - tâche souvent ajoutée proposée dans la bibliothèque.

---

### CR-1 — Diagnostic chiffré des comptes rendus (aucune modification du formulaire)

#### Contexte
Les ouvriers trouvent le compte rendu du soir long et compliqué, et la qualité de
ce qu'ils déclarent est très variable. Tous sont sur le formulaire bêta « cr_v2 ».
Avant de le refondre, il faut des chiffres réels, et un outil pour les suivre
dans le temps et mesurer l'effet des changements.

#### 1. Le rapport (requêtes sur la VRAIE base, aucune donnée de test)
Sur les 8 dernières semaines, par ouvrier, puis au total, en distinguant v1 et v2
quand c'est possible :
- Temps de remplissage : entre la première saisie et l'envoi (médiane et 80e
  centile). Explique ce que mesure exactement ce chiffre et ses limites (brouillon
  ouvert à midi puis complété le soir, par exemple).
- Heure d'envoi (répartition) et part des comptes rendus envoyés en rattrapage.
- Qualité :
  - écart moyen entre l'avancement déclaré par l'ouvrier et l'avancement validé ;
  - part des lignes réaffectées, découpées ou basculées vers un autre chantier à
    la validation ;
  - part des lignes hors devis ou en texte libre ;
  - part des tâches créées par l'ouvrier ;
  - lignes « fourre-tout » probables (une ligne qui couvre l'essentiel de la
    journée, ou un texte qui décrit plusieurs travaux) ;
  - remarques vides ou très courtes ;
  - photos manquantes sur les tâches terminées ;
  - comptes rendus corrigés après validation.
- Sur les tâches faites à plusieurs le même jour : part des cas où les
  avancements déclarés diffèrent.
Rends-le dans le compte rendu, lisible sans lire le code, avec les 5 constats les
plus marquants.

#### 2. Un module de suivi réutilisable
- Un module pur `.mjs` qui calcule ces indicateurs sur une période, par ouvrier et
  au total (données en paramètre).
- Une page « Qualité des comptes rendus » dans Équipe, réservée au bureau :
  indicateurs par ouvrier sur la période choisie, avec la tendance par rapport à
  la période précédente. Enregistre-la dans src/access.js et précise pour quels
  rôles elle est visible.
- Ce module servira aussi au compteur « tâches regroupées » de la validation
  (CR-5) : prévois un indicateur « lignes découpées à la validation » par ouvrier
  et par mois.

#### Règles propres à l'étape
- Aucune migration n'est nécessaire a priori ; s'il en faut une, règles communes.
- Script verif-*.mjs pour le module, avec des cas sur chaque indicateur (données
  de test clairement marquées comme telles).

---

### CR-2 — Libellés personnalisés et pièces dans le phasage

#### Contexte
Le futur compte rendu des ouvriers (CR-3) leur fera choisir leurs tâches
directement dans le phasage. Aujourd'hui, les ouvrages et les tâches portent les
libellés du devis (« Isolation laine minérale de 45 cloison hydro »), peu lisibles
sur un téléphone, et le phasage n'a pas de notion de pièce. Loris préparera mieux
les phasages en amont ; l'application doit lui permettre de le faire vite.

#### 1. Libellés personnalisés
- Dans la page Phasage, Loris peut renommer un ouvrage ou une tâche pour ce
  chantier.
- Le nom personnalisé est enregistré À CÔTÉ du libellé du devis, jamais à sa
  place. Fais l'inventaire complet des usages du libellé (documents client,
  synchronisation ProGBat, rapprochement des commandes, exports, assistant IA,
  correspondance automatique des noms à la validation…) et indique lequel des deux
  libellés chacun utilise. Règle par défaut : tout ce qui sort vers le client ou
  vers ProGBat garde le libellé devis ; tout ce qui est affiché dans
  l'application (ouvriers, validation, planning, bilan) utilise le libellé
  personnalisé s'il existe, sinon le libellé devis.
- Le libellé devis reste visible en petit dans le phasage et dans la validation.
- La modification est rapide : édition directe dans la ligne, sans fenêtre.

#### 2. Les pièces du chantier
- Une liste de pièces par chantier (« Salle de bain », « Chambre 1 », « Séjour »…),
  saisie une fois, modifiable, réordonnable.
- Chaque tâche peut être rattachée à une pièce (facultatif). Rattachement rapide
  de plusieurs tâches à la fois.
- Dans le phasage, un filtre et un regroupement par pièce.
- Duplication rapide d'une tâche pour plusieurs pièces (pour les lots qui se font
  pièce par pièce : cloisons, sols, peinture, faïence), avec répartition des
  heures estimées entre les copies, ajustable.

#### Règles propres à l'étape
- Scripts verif-*.mjs, avec au minimum : un ouvrage renommé garde son libellé
  devis dans les documents client et pour ProGBat ; une duplication par pièce
  conserve le total des heures estimées.

---

### CR-3 — Nouveau parcours du compte rendu ouvrier

#### Contexte
Tous les ouvriers sont sur le formulaire bêta « cr_v2 » (RapportMobile.jsx,
compteRenduV2.mjs, TacheCarteV2.jsx). Ils le trouvent long, et la qualité des
déclarations est variable. Les étapes 1 à 4 sont en ligne (journal d'avancement
daté, motifs des tâches hors devis : introuvable / imprévu / demande client),
ainsi que CR-2 (libellés personnalisés, pièces). Cette étape refond le PARCOURS ;
la dictée vocale et l'IA viendront à CR-4. La chaîne existante (validation,
pointages, bilan) doit continuer à lire les lignes sans changement de sens.

#### 1. Écran d'accueil : la journée prévue
- Afficher la journée prévue par le planning : chantier(s), heures attendues, et
  chaque tâche prévue avec l'état ATTENDU ce soir (« Plaquage chambre → terminé ce
  soir », « Bandes SDB → en cours »). Vérifie si le moteur de planning sait, pour
  chaque tâche, si elle devait se terminer ce jour-là ; si ce n'est pas fiable,
  choisis une règle simple et explique-la dans le compte rendu.
- Deux gros boutons :
  - « Journée comme prévu » : chaque tâche prévue reçoit son état attendu et sa
    durée prévue ; photo et remarque facultatives ; envoi. Si les durées prévues
    ne tombent pas exactement sur le total du jour, l'ouvrier ajuste avec les
    outils du point 3 avant d'envoyer.
  - « Ça ne s'est pas passé comme prévu » : point 2. Dans ce parcours, les tâches
    prévues ne sont PAS proposées comme choix : l'ouvrier part du phasage.

#### 2. Vue du phasage sur téléphone
- Trois niveaux au maximum : grosses tuiles par lot (le métier de l'ouvrier en
  premier), puis les ouvrages, puis les tâches. Un fil de navigation en haut.
  Navigation alternative par pièce (CR-2).
- Libellés personnalisés (CR-2) partout.
- Une recherche tout en haut, sur tout le phasage du chantier.
- Les tâches terminées sont masquées par défaut, avec un bouton pour les afficher.
  Un code couleur distingue « pas commencée » et « en cours ».
- Sélection multiple, avec un compteur en bas : « 3 tâches choisies → Suivant ».
- Un bouton « Créer une tâche » à chaque niveau, avec le lot et l'ouvrage courants
  présélectionnés. Une seule question : « Pourquoi elle n'est pas dans la
  liste ? » → je ne l'ai pas trouvée / travail imprévu / demande du client (les
  motifs de l'étape 4).
- Le phasage du chantier est chargé à l'avance sur le téléphone (à l'ouverture de
  l'application ou le matin) pour fonctionner sans réseau.

#### 3. Détail des tâches choisies : état et temps
- État : des repères concrets au lieu d'un pourcentage libre (commencé, à moitié,
  presque fini, terminé, mappés sur les valeurs que la chaîne attend déjà), ou la
  quantité posée pour les tâches suivies en quantité.
- Temps PRÉCIS, saisie allégée :
  - chaque tâche est préremplie avec sa durée prévue quand elle en a une ;
  - boutons ±15 min et raccourcis 1 h, 2 h, 4 h, journée ;
  - un bouton « le reste ici » qui place tout le temps restant de la journée sur
    cette tâche ;
  - en option (réglage de l'ouvrier, désactivé par défaut) : une saisie par frise
    horaire, de l'arrivée au départ avec la pause déjà placée ; l'ouvrier indique
    à quelle heure il change de tâche et les durées sont calculées ;
  - l'envoi reste bloqué tant que le total n'est pas exact.
- Les motifs restent demandés seulement quand ils sont utiles (blocage,
  dépassement), comme aujourd'hui.

#### 4. Tâches prévues mais non faites
Dans le parcours « pas comme prévu », un dernier écran court liste les tâches qui
étaient prévues et n'ont pas été choisies, avec une seule question pour toutes :
« Pourquoi pas faites aujourd'hui ? » (motifs existants). Possibilité de répondre
tâche par tâche. La réponse alimente le replanning et les décisions attendues du
Bilan.

#### 5. Tâches faites à plusieurs
Quand un collègue a déjà déclaré une tâche aujourd'hui, l'ouvrier le voit
(« Davy a déclaré : bandes SDB terminées — d'accord ? »). Il confirme et ajoute
seulement son temps, ou propose un autre état (signalé au conducteur à la
validation). Sans réseau, on n'affiche rien et on laisse la validation trancher.

#### 6. Retour après l'envoi
Un message court et factuel tiré de ce qui vient d'être envoyé : « Merci ! Chambre
101 terminée, le chantier est à 46 % ».

#### Règles propres à l'étape
- Prévois un interrupteur dans Admin pour revenir instantanément à l'écran actuel
  si un problème apparaît à l'usage.
- Les brouillons en cours au moment de la mise en ligne ne doivent pas être
  perdus.
- Toute écriture d'avancement passe par la fonction du journal (étape 1C).
- Scripts verif-*.mjs, avec au minimum :
  - « comme prévu » produit les mêmes lignes qu'une saisie manuelle équivalente ;
  - « le reste ici » ;
  - frise horaire → durées ;
  - tâche créée avec chacun des 3 motifs ;
  - tâche prévue non faite avec motif ;
  - tâche déjà déclarée par un collègue (confirmée, puis contestée) ;
  - envoi impossible tant que le total n'est pas exact.

---

### CR-4 — Dictée vocale, préremplissage par l'IA, photo de fin de journée

#### Contexte
Le nouveau parcours du compte rendu (CR-3) est en ligne. Sur chantier, taper du
texte est pénible : les remarques sont courtes ou illisibles (« Je finir »). Cette
étape ajoute la dictée vocale et le préremplissage par l'IA de l'application
(api/_ia).

#### 1. Dictée
- Un gros bouton micro dans le compte rendu : l'ouvrier raconte sa journée en
  quelques phrases (« J'ai fini le placo de la chambre, commencé les bandes dans
  la salle de bain, il manque des vis de 25 »).
- Choisis la solution de transcription la plus fiable (reconnaissance du
  navigateur ou service côté serveur) en comparant Android et iPhone, le coût et
  le comportement sans réseau, et explique ton choix dans le compte rendu.
  Solution de repli sans réseau : la dictée du clavier du téléphone dans un champ
  texte, et l'analyse IA faite à l'envoi.
- La dictée est aussi disponible dans la recherche du phasage et dans la
  description d'une tâche créée.

#### 2. Préremplissage par l'IA
- À partir du texte dicté, du phasage du chantier et du planning du jour, l'IA
  propose : les tâches concernées, leur état, une répartition du temps, la remarque
  reformulée proprement en français, et les demandes de matériel détectées (qui
  ouvrent la demande de matériel existante, préremplie).
- L'ouvrier voit un résumé clair, corrige si besoin, et c'est lui qui envoie. Rien
  n'est envoyé sans son action.
- Le texte dicté d'origine est TOUJOURS conservé à côté de la remarque
  reformulée ; la validation montre la reformulation, avec accès au texte
  d'origine.
- Le texte venu de l'ouvrier est traité comme une donnée, jamais comme une
  instruction pour l'IA.
- Si l'IA ne répond pas ou n'est pas sûre, le formulaire reste utilisable
  normalement.

#### 3. Photo de fin de journée
Une photo d'ensemble de la zone travaillée en fin de journée, recommandée et
jamais exigée, plutôt qu'une photo par tâche. La photo « après » d'une tâche
terminée reste possible.

#### Règles propres à l'étape
- Dans le compte rendu, une estimation du coût mensuel de l'IA et de la
  transcription pour environ 10 ouvriers et un compte rendu par jour chacun.
- Scripts verif-*.mjs, avec au minimum : texte dicté avec 3 tâches et une demande
  de matériel ; texte ambigu (rien n'est prérempli sans certitude) ; IA
  indisponible ; texte d'origine conservé.

---

### CR-5 — Refonte visuelle de la page de validation de fin de journée

#### Contexte
La page de validation (src/Renovation/Validation.jsx) fonctionne bien, et Loris
veut continuer à valider chaque compte rendu lui-même pour suivre ce qui se
passe. Mais l'interface n'est pas travaillée : liste par ouvrier, alertes cachées
au survol, contenu invisible sans ouvrir la fenêtre, messages techniques
affichés. Loris valide sur ordinateur. Respecte le thème actuel de l'application
(sombre, accent jaune #FFC200). Une maquette a été validée par Loris ; elle est
décrite ci-dessous.

#### 1. La page de la journée
- En-tête : la date, des flèches jour précédent / suivant, et un rappel des jours
  précédents qui ont encore des comptes rendus à valider (« Lun. 19 · 2 comptes
  rendus »).
- Résumé : à valider (dont avec écarts), validés (heures enregistrées), non envoyés
  (qui et sur quel chantier, d'après les comptes rendus attendus de l'étape 1D),
  heures déclarées sur heures attendues, et une barre de progression de la
  journée.
- Regroupement par chantier (par défaut) ou par ouvrier, et un filtre « écarts
  seulement ».
- Légende des couleurs : gris = comme prévu ; orange = écarts à regarder ;
  rouge = à arbitrer (bloqué, hors devis, tâche créée, compte rendu manquant).
- Par chantier : un en-tête (nom, nombre de comptes rendus, heures, avancement),
  puis une ligne par compte rendu, lisible SANS l'ouvrir :
  - l'ouvrier et un badge « comme prévu » / « N écarts » / « à arbitrer » ;
  - les tâches sous forme d'étiquettes avec leur état ;
  - les alertes écrites en clair (dépassement d'heures avec motif, tâche créée
    avec motif, tâche bloquée avec motif et remarque, tâches prévues non faites) ;
  - des vignettes des photos ;
  - les heures ;
  - un bouton « Valider » direct pour un compte rendu « comme prévu » sans
    anomalie, sinon « Ouvrir et valider ».
- Tâche faite à plusieurs avec des états différents : un encart en haut du
  chantier qui la montre une seule fois (« Davy : en cours 50 % · Kev :
  terminée »), avec un champ « avancement retenu » et un bouton « Appliquer aux
  deux ».
- Compte rendu attendu mais non envoyé : un encart en pointillés rouges dans le
  chantier concerné, qui précise que la journée de ce chantier reste
  « incomplète » dans le bilan.
- Les comptes rendus déjà validés sont repliés en bas, avec un bouton
  « Afficher ».

#### 2. Le détail d'un compte rendu
- Une page ou un grand panneau, avec un lien « Retour à la journée », le titre
  « Ouvrier · Chantier », la date, l'heure d'envoi et le badge d'écarts.
- En haut à droite : « Compte rendu 2 sur 5 », « Valider », et le bouton principal
  « Valider et passer au suivant · [ouvrier suivant] ».
- Une carte par tâche :
  - le chemin (lot › ouvrage), le libellé personnalisé, le libellé devis en
    petit, l'état, les heures (modifiables) ;
  - une barre de budget : heures avant aujourd'hui, heures du jour (tous les
    ouvriers, avec le détail par personne), un trait pour les heures vendues, et
    le dépassement en rouge avec son coût estimé (méthode de l'étape 2) ;
  - l'avancement : hier → déclaré par chaque ouvrier → valeur retenue
    (modifiable) ;
  - le motif, la remarque reformulée, et un lien « Voir le texte dicté
    d'origine » ;
  - les photos ;
  - les actions existantes : réaffecter, découper, envoyer vers un autre
    chantier.
- Une colonne latérale : la journée de l'ouvrier (tâches, trajets, heures
  indirectes, total comparé à la journée attendue, autres comptes rendus du
  jour) ; les autres comptes rendus du même chantier ce jour-là avec leur statut ;
  les photos de fin de journée ; les corrections (changer le chantier du compte
  rendu, ajouter une tâche).

#### 3. Répartir une tâche regroupée
Certains ouvriers créent une seule tâche hors devis pour toute leur journée. Le
bouton « Découper » ouvre une fenêtre « Répartir sur les tâches du phasage » :
- En haut, ce que l'ouvrier a déclaré : intitulé, heures, texte dicté, motif,
  photos.
- L'application propose une répartition à partir du texte dicté et du planning du
  jour (tâches prévues ce jour-là, mots du texte, tâches standard comme
  « Nettoyage et rangement »), en indiquant pourquoi chaque tâche est proposée.
- Une ligne par tâche, sans limite fixe : la tâche choisie dans le phasage
  (libellé personnalisé, chemin, recherche), les heures avec ±15 min, et l'état ce
  soir (en cours avec un pourcentage, ou terminée). Ajouter et retirer des lignes.
- Deux boutons de répartition rapide : parts égales, et selon les durées prévues.
- Une barre colorée montre la répartition ; « Valider la répartition » ne
  s'active que quand le total est exactement égal aux heures déclarées.
- Une case, cochée par défaut : garder les photos et le texte dicté sur chaque
  tâche.
- Chaque découpage est compté dans le suivi qualité (module de CR-1), et le
  compteur s'affiche dans la fenêtre (« 3e tâche regroupée de Steven ce mois-ci »).

#### 4. À retirer
Tous les messages techniques destinés au développement (« exécute le SQL du
P6 », colonnes manquantes…) : ils vont dans les journaux techniques, pas à
l'écran.

#### Règles propres à l'étape
- Aucune règle métier de la validation ne change (garde-fou des heures, verrou
  d'écriture, création des pointages, journal d'avancement) : seule la
  présentation est refaite, plus l'arbitrage groupé et la répartition.
- Scripts verif-*.mjs, avec au minimum : arbitrage appliqué aux deux comptes
  rendus ; répartition qui doit tomber juste ; répartition en parts égales et
  selon les durées prévues ; compteur de tâches regroupées ; compte rendu
  manquant affiché.

---

### CR-6 — Parcours unique du compte rendu et correctifs (ajoutée le 26/10/2026)

#### Contexte
Les 9 étapes précédentes sont en ligne. Après relecture, Loris change le
parcours du compte rendu et demande des correctifs. Décisions métier mises à
jour : C1 révisé (parcours unique), C4 supprimé, trois idées ajoutées aux
décisions écartées (section 2.3). Mêmes règles communes que le reste du projet
(section 3 et journal des décisions : migration purement additive sans
attendre, le reste avec l'accord de Loris ; mise en ligne normale).

#### Pourquoi
Le diagnostic CR-1 et les mesures de CR-3 montrent que l'état « attendu ce
soir » tiré du planning n'est juste qu'environ une fois sur deux (50 tâches
terminées sur 98 dont c'était le dernier jour planifié). Avec « Journée comme
prévu », l'application décide de l'état à la place de l'ouvrier, et un compte
rendu faux arrive en gris « comme prévu », validable en un clic : risque
d'avancement surestimé, donc de production et de marges fausses. À l'inverse,
la branche « pas comme prévu » oblige l'ouvrier à tout refaire depuis le
phasage pour un seul écart.

#### 1. Parcours unique (remplace les deux boutons)
- Pour chaque chantier du jour, l'ouvrier voit directement la liste de ses
  tâches prévues :
  - heures PRÉREMPLIES avec la durée prévue (outils existants : ±15 min,
    raccourcis, « le reste ici », frise en option) ;
  - état NON prérempli et OBLIGATOIRE, choisi en un geste : Pas commencé,
    Commencé, À moitié, Presque fini, Terminé (ou la quantité posée pour une
    tâche suivie en quantité) ; « Bloqué » reste disponible avec son motif ;
  - le prévu affiché en petit comme simple repère (« prévu : terminée ce
    soir », règle de CR-3), jamais sélectionné.
- « Pas commencé » ne demande AUCUN motif. Le motif de dépassement d'heures et
  celui de « Bloqué » restent comme aujourd'hui.
- Un bouton « J'ai fait autre chose » ouvre la vue du phasage existante
  (CR-3) ; les tâches choisies ou créées (motif A / B / C) s'ajoutent à la
  liste sans rien effacer.
- Ligne du planning non liée à une tâche du phasage : l'ouvrier choisit la
  tâche dans le phasage, avec en tête la proposition la plus probable (nom,
  lot, ouvrage) ; ou il crée une tâche avec son motif.
- Tâche déjà déclarée par un collègue : « Davy a déclaré : terminée —
  d'accord ? » ; « Oui » vaut choix de l'état.
- La dictée et l'IA (CR-4) continuent de fonctionner : les états qu'elle
  propose avec certitude sont remplis, l'ouvrier relit avant l'envoi comme
  aujourd'hui.
- L'envoi reste bloqué tant que chaque tâche avec des heures n'a pas d'état et
  que le total n'est pas exact. Une tâche prévue sans heures et sans état est
  envoyée comme « pas commencé » (voir le journal des décisions du 26/10).
- À supprimer : les boutons « Journée comme prévu » / « Ça ne s'est pas passé
  comme prévu » et l'écran final « Pourquoi pas faites aujourd'hui ? ».
- Les brouillons existants s'ouvrent sans perte. L'interrupteur de Réglages →
  Utilisateurs ramène toujours à l'ancien écran.
- Validation : « prévue, pas faite » reste un écart orange, sans motif
  affiché.

#### 2. Nouvel écart à la validation : avancement incohérent avec les heures
Un écart orange (donc plus de « Valider » direct) quand, sur une tâche :
- l'avancement déclaré est nettement en avance sur les heures consommées :
  (heures avant + heures du jour) ÷ (heures prévues × avancement déclaré)
  < 0,5, pour une tâche d'au moins 2 h prévues ;
- ou l'avancement gagne au moins 25 points sans heure pointée sur la tâche ce
  jour-là ;
- ou une tâche déclarée terminée revient « en cours » ou moins.
Texte en clair, par exemple : « Bandes chambre déclarée terminée avec 2 h pour
10 h prévues ». Seuils réglables dans Admin, avec ces valeurs par défaut. Même
logique côté Bilan si c'est simple (sinon le dire).

#### 3. Planning : lignes non liées à une tâche du phasage
Aujourd'hui, seulement 55 % des lignes du planning sont liées à une tâche du
phasage (mesure CR-3), ce qui crée la plupart des lignes « sans tâche » des
comptes rendus (56 %, rattachées à la main à la validation).
- Trouver d'où viennent les lignes non liées (création manuelle, import,
  moteur…) et corriger à la source quand c'est possible.
- Dans le planning, signaler chaque ligne non liée et proposer la tâche la
  plus probable, à accepter en un clic (ou à choisir dans le phasage).
- À la création d'une ligne de planning, proposer de la lier.
- Un compteur « X % des lignes de la semaine liées au phasage ».

#### 4. Outils de classement en masse
- Tâches hors devis anciennes (environ 350, surtout TOM & CAMILLE, BRIOLLAY,
  METOIS) : une liste par chantier avec, pour chaque tâche, le cas proposé
  (A / B / C) et, pour le cas A, la tâche du phasage proposée ; cases à cocher
  et « Appliquer la sélection ». Pour un chantier repris, possibilité de tout
  laisser en l'état d'un clic.
- Commandes sans lot (673 lignes, 19 682 €) : une liste avec le lot proposé
  (d'après l'ouvrage, le matériau, le libellé, le fournisseur et l'historique
  du chantier), cases à cocher et « Appliquer la sélection ».
- Les propositions sont expliquées (« même matériau que 12 commandes du lot
  Plomberie »). Rien n'est appliqué sans action de Loris.

#### 5. Suivi qualité (page « Qualité des comptes rendus »)
- Part des états déclarés identiques au prévu (mesure la fiabilité du
  planning).
- Nombre d'écarts « avancement incohérent » par ouvrier.
- Part des lignes du planning liées au phasage.

#### 6. Petit correctif
L'« avancement retenu » d'une tâche faite à plusieurs (encart de la
validation) ne doit plus se perdre si la page est rechargée avant validation.

#### Règles propres à l'étape
- Dans le compte rendu : le taux actuel de lignes de planning liées et ce qui a
  été corrigé à la source ; le nombre de tâches hors devis et de lignes de
  commande avec une proposition, par niveau de confiance ; et, sur les comptes
  rendus réels des 2 dernières semaines, combien auraient déclenché l'écart
  « avancement incohérent ».
- Scripts verif-*.mjs, avec au minimum :
  - envoi impossible tant qu'une tâche avec des heures n'a pas d'état ;
  - aucun état prérempli d'après le planning ;
  - « Pas commencé » sans motif ;
  - « J'ai fait autre chose » ajoute sans effacer ;
  - ligne de planning non liée → proposition ;
  - écart « avancement incohérent » (les 3 cas) et plus de « Valider » direct ;
  - classement en masse (rien d'appliqué sans sélection) ;
  - avancement retenu conservé après rechargement ;
  - un brouillon de l'ancien parcours s'ouvre sans perte.
- Mettre à jour le tableau de suivi, le journal des décisions et le compte
  rendu final du document, et une entrée dans journalMaj.js en langage métier.
