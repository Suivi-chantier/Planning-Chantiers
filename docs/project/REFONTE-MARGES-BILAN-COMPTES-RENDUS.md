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

- **C1. Deux branches** : écran d'accueil avec la journée prévue et l'état attendu
  ce soir de chaque tâche ; « Journée comme prévu » ou « Pas comme prévu ».
- **C2. Vue phasage mobile** pour « pas comme prévu » : lot › ouvrage › tâche,
  métier de l'ouvrier en premier, recherche, tâches terminées masquées, sélection
  multiple, « Créer une tâche » avec le motif A / B / C. Les tâches prévues ne
  sont PAS proposées comme choix dans cette branche.
- **C3. Temps PRÉCIS, saisie allégée** : durée prévue préremplie, « le reste
  ici », raccourcis 1 h / 2 h / 4 h / journée, ±15 min, frise horaire en OPTION
  (désactivée par défaut) ; envoi bloqué tant que le total n'est pas exact.
- **C4. Tâches prévues non faites** : une question « pourquoi ? » à la fin.
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
| 2 | Étape 2 — Les trois marges et les alertes | ✅ En ligne | 2026-10-24 | Trois marges (avancement, terminaison, probable), « marge nette » devenue « budget restant », relevés passés recalculés (3 686), nouvelles alertes sur les relevés journaliers. Question ouverte : coefficients historiques sous ×1. Voir « Étape 2 ». |
| 3 | Étape 3 — Refonte du Bilan semaine | 🟡 En cours — en attente de Loris pour 3.5 | 2026-10-24 | En ligne : 3.0 plancher ×1 (#155), 3.1-3.3 Bilan d'une période + présélection + version direction (#156), 3.4 version détaillée (#157), 3.6 décisions / tendances / semaine qui vient (#158), 3.7 bilan de clôture (#159). Reste : 3.5 bilans figés et rectifications + prévu / réalisé (question sur la table d'archive), assistant IA sur les relevés journaliers, sort des relevés du vendredi (question posée). Voir « Étape 3 ». |
| 4 | Étape 4 — Tâches hors devis | ⏳ À faire | | |
| 5 | CR-1 — Diagnostic chiffré des comptes rendus | ⏳ À faire | | |
| 6 | CR-2 — Phasage lisible (libellés, pièces) | ⏳ À faire | | |
| 7 | CR-3 — Nouveau parcours du compte rendu | ⏳ À faire | | |
| 8 | CR-4 — Dictée vocale et IA | ⏳ À faire | | |
| 9 | CR-5 — Refonte de la page de validation | ⏳ À faire | | |

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

#### Étape 3 — Refonte du Bilan (24/10/2026, en cours : 3.5 en attente)

**Mises en ligne.** 3.0 coefficient de la marge probable jamais sous ×1
(#155) ; 3.1-3.3 Bilan d'une période, présélection, version direction
(#156) ; 3.4 version détaillée (#157, migration additive
`20261024170000_releves_couts_par_nature` appliquée et vérifiée avant
fusion) ; 3.6 décisions attendues, tendances, semaine qui vient (#158) ; 3.7
bilan de clôture (#159). Scripts : `verif-bilan-periode.mjs` (68 contrôles,
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
  lot, semaine qui vient (calculée à l'ouverture).
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

**Points d'attention.**
- 3.5 (bilans figés, ligne « Rectifications », prévu / réalisé, glissement
  de la fin) attend l'accord de Loris sur la table d'archive.
- L'assistant IA lit encore le relevé du vendredi : à basculer sur les
  relevés journaliers (en même temps que la décision sur les relevés du
  vendredi).
- « Semaine qui vient » : équipe, jours, heures et nombre de tâches par
  chantier ; les commandes à passer et livraisons attendues n'y sont pas
  encore.
- Prévu / réalisé : sera exprimé à partir du bilan précédent archivé (3.5).
- Les tendances et les dérives historiques restent faussées par les heures
  mal rattachées des anciens chantiers ; TOM & CAMILLE ne sont pas encore
  cochés « repris » (Loris le fera).

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
