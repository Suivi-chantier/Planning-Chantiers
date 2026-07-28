# Point 2 (a) — Pilotage du chantier : triangle QCD + cycle de vie — Prompts pour Claude Code

## Brief de reprise (à lire en premier sur un nouveau chat)

**L'appli.** Application interne d'une entreprise de rénovation (React + Supabase), outil unique de la boîte. Le code est modifié via **Claude Code**.

**Le but.** Sur la **fiche détaillée d'un chantier** (page Chantiers → un chantier), afficher deux choses en tête, comme un bandeau de santé :
1. un **triangle QCD** (Qualité · Coût · Délai) en temps réel ;
2. une **frise du cycle de vie** du chantier, du devis au SAV, où chaque étape se valide par une action concrète (souvent l'import d'un document).

Ce document couvre **le pilotage**. Le sommet **Qualité** est alimenté par les **contrôles de fin de groupe**, qui font l'objet d'un second document (*Point 2 (b)*). Le triangle doit fonctionner **sans attendre** ce second chantier : Délai et Coût pleinement opérationnels, Qualité en **gris** tant qu'aucun contrôle n'existe.

## ⚠️ Avertissement important — ne pas réutiliser les formules existantes

`src/Renovation/DashboardAnalyse.jsx` contient déjà des indicateurs (`avSt`, `mrSt`, `ratioMO`, `ratioMOStatus`, `calcAvancementTheorique`…). **Ces formules sont considérées comme fausses par le métier : il ne faut PAS s'en servir, ni les copier, ni les importer.** Les formules du QCD sont définies ci-dessous et doivent être implémentées **à neuf**, dans un module dédié.

Les **données brutes**, elles, sont bonnes et déjà disponibles (heures vendues, pointages validés, avancement, budgets, commandes). C'est uniquement le calcul dérivé qu'on refait.

## Les formules du QCD (définitives)

### Délai — « est-ce qu'on brûle les heures plus vite qu'on avance ? »
```
indice_delai = heures_reelles / (heures_vendues_total × avancement)
```
- `heures_reelles` = somme des heures pointées (validées) du chantier.
- `heures_vendues_total` = somme des `heures_vendues` des tâches du chantier.
- `avancement` = avancement réel du chantier, en fraction (0 → 1).
- Exemple métier : 100 h vendues, 20 % d'avancement, 80 h consommées → 80 / (100 × 0,20) = **4** → très en dépassement.

| Statut | Condition |
|---|---|
| 🟢 vert | indice < 1,10 |
| 🟠 orange | 1,10 ≤ indice ≤ 1,30 |
| 🔴 rouge | indice > 1,30 |
| ⚪ démarrage | avancement < 10–15 % (indice instable) ou données manquantes |

### Coût — « a-t-on mangé le budget ? » (comparaison au **budget total prévu**, pas proraté)
```
ratio_MO         = cout_MO_reel        / cout_MO_prevu
ratio_materiaux  = cout_materiaux_reel / cout_materiaux_prevu
statut_cout      = le PIRE des deux
```
- `cout_MO_reel` = pointages × taux horaire (déjà calculé côté fiche chantier).
- `cout_MO_prevu` = heures vendues × taux horaire.
- `cout_materiaux_reel` = somme des lignes de commande du chantier.
- `cout_materiaux_prevu` = estimation matériaux du phasage (prévisionnel).

| Statut | Condition |
|---|---|
| 🟢 vert | ratio < 90 % |
| 🟠 orange | 90 % ≤ ratio ≤ 100 % |
| 🔴 rouge | ratio > 100 % (budget dépassé) |
| ⚪ non évaluable | budget prévu à 0 / absent |

### Qualité — alimentée par les contrôles de fin de groupe (*Point 2 b*)
- ⚪ **gris** : aucun contrôle exploitable → message incitatif (« ce chantier n'a pas été contrôlé »).
- 🟢 vert : aucune réserve ouverte sur les groupes contrôlés.
- 🟠 orange : réserves ouvertes mineures.
- 🔴 rouge : non-conformité (NOK), **ou** réserves anciennes non levées d'un contrôle à l'autre.
- Pondération prévue : **taux de conformité** (tâches non signalées ÷ tâches contrôlées) et **ancienneté des réserves non levées**.

➡️ Dans ce document, la Qualité est branchée sur **une fonction unique isolée** qui renvoie `gris` par défaut. Le *Point 2 (b)* remplira cette fonction sans toucher au reste.

### Correction manuelle
Les **trois sommets** sont **corrigeables à la main** (override stocké, avec la valeur auto conservée à côté). Le jugement du conducteur prime, comme dans la frise CRM.

## Le cycle de vie (6 phases, du devis au SAV)

**Modèle à copier : la frise du CRM Invest** (`src/Invest/CRM.jsx` : `CRM_CLIENT_TIMELINE_STEPS` + `computeCRMClientTimeline`). Principe repris tel quel : **étape déclarée à la main prioritaire**, sinon **étape déduite** de signaux, avec les raisons affichées.

| Phase | Étapes et action qui valide |
|---|---|
| **1 · Devis** | Chiffrage réalisé *(auto)* · Devis envoyé *(importer le devis PDF)* · Réponse client *(coche : accepté / en attente / refusé)* |
| **2 · Contrat** | Devis signé *(importer)* · Acompte encaissé *(montant + date)* · Délai de rétractation purgé *(auto : signature + 14 j)* |
| **3 · Préparation** | Plans d'exécution *(joindre / lien module Plans)* · Commandes & approvisionnements *(lien commandes)* · Équipes affectées *(auto : chaque groupe a son équipe — Point 1)* · Installation de chantier *(coche)* |
| **4 · Travaux** | Les **groupes d'exécution** dans l'ordre, chacun clôturé par son **jalon de contrôle** *(Point 2 b)*. La phase se termine quand **tous les groupes sont contrôlés**. |
| **5 · Réception** | Visite de réception *(importer le PV)* · Levée des réserves *(coche)* · Remise des clés & DOE *(joindre)* |
| **6 · Garanties / SAV** | Parfait achèvement 1 an *(auto : réception + 1 an)* · Interventions SAV *(journal)* · Fin de garantie *(repère de date)* |

**Règles transverses :**
- Une **pièce jointe est possible sur TOUTES les étapes**, y compris celles validées par une coche ou en automatique (photo ou document en preuve).
- Trois natures de validation : **auto** (donnée déjà présente / date calculée), **import de document**, **coche manuelle**.
- ❌ Pas d'étape « Autorisations DP / PC » : retirée volontairement (hors périmètre de l'entreprise).
- Le cycle **démarre au devis** : pas de phase prospection / visite (la fiche chantier n'existe qu'après signature).

## Vocabulaire (à ne JAMAIS confondre)
- **Phases (V1)** = Phasage V1 legacy (`plan_travaux[phase_id]`). Intouchable, et **le mot « phase » du cycle de vie ne doit pas réutiliser ce mécanisme**.
- **Phases du cycle de vie** = les 6 ci-dessus (Devis → SAV). Niveau **projet**.
- **Groupes** = étapes d'exécution d'un chantier (vue chrono, `meta.chrono_groupes`). Niveau **travaux**, contenues dans la phase « Travaux ».
- **Groupes types** = référentiel global des groupes (Admin).
- **Équipes** = référentiel des équipes (Point 1).
- **Jalons** = repères de la vue chrono (`meta.chrono_jalons`) — deviendront de deux natures au *Point 2 (b)*.

## Décisions déjà prises (à respecter)
- **Strictement additif** : ne rien casser (V1, lots, import de devis, phasage, planning, Dashboard existant).
- Le QCD vit **en tête de la fiche détaillée du chantier**, toujours visible.
- Les **calculs QCD** sont dans un **module dédié**, testable, indépendant de l'affichage — et **jamais** repris de `DashboardAnalyse`.
- **Délai proraté** par l'avancement (alerte précoce) / **Coût comparé au budget total** (signal plafond) : les deux sont complémentaires, ne pas « harmoniser ».
- **Qualité** = un point d'entrée unique, `gris` par défaut, rempli par le *Point 2 (b)*.
- Frise = **hybride** : auto + correction manuelle prioritaire, sur le modèle du CRM Invest.
- **Pièce jointe possible sur toutes les étapes.**

## Comment utiliser ce document
- **Un prompt à la fois.** Colle, laisse travailler, **teste**, **commit**, puis le suivant.
- **Commence par le Prompt 0** (audit, sans modification) et **lis sa réponse** : elle donne les noms et formes réels, qui peuvent ajuster un détail des prompts suivants (notamment le stockage des fichiers).
- À chaque étape, l'appli doit rester fonctionnelle.

---

## Prompt 0 — Audit (aucune modification de code)

```
Avant toute modification, lis le code et fais-moi un état des lieux écrit, sans rien changer.

Contexte : je veux ajouter, en tête de la fiche détaillée d'un chantier, (1) un triangle QCD Qualité/Coût/Délai calculé en temps réel et (2) une frise du cycle de vie du chantier (6 phases, du devis au SAV) avec des étapes validées par une action et des pièces jointes.

IMPORTANT : je considère que les formules d'indicateurs de src/Renovation/DashboardAnalyse.jsx sont fausses. Ne t'en sers pas comme référence de calcul. Je veux savoir quelles DONNÉES BRUTES sont disponibles, pas quels indicateurs existent déjà.

Réponds-moi en texte, ne modifie aucun fichier :
1. PageChantiers.jsx : où est exactement la fiche détaillée d'un chantier, comment elle est structurée en haut (quels blocs), et où je pourrais insérer un bandeau sans casser la mise en page.
2. Les données brutes disponibles par chantier, et le chemin exact pour chacune :
   - heures vendues (taches[].heures_vendues) : où et comment on les totalise ;
   - heures réellement pointées (validées) : table/colonne, comment on les somme, et comment on distingue validé / non validé ;
   - avancement réel du chantier (calcAvancement / calcAvancementPondere) : formule actuelle et forme du résultat (0-1 ou 0-100) ;
   - coût MO réel et taux horaires (pointages × taux_horaire) ;
   - coût matériaux réel (lignes de commande) et coût matériaux PRÉVISIONNEL (estimation) : où vit chacun ;
   - prix vendu du chantier.
   Donne-moi la fonction calcFinances de PageChantiers.jsx et ce qu'elle renvoie.
3. Le statut commercial (Prospect → Signé) et le statut chantier (Planifié → En cours → Terminé) : où ils sont stockés, quelles valeurs exactes, et s'il existe des dates (signature, démarrage, réception).
4. src/Invest/CRM.jsx : explique-moi précisément le mécanisme de la frise — la forme de CRM_CLIENT_TIMELINE_STEPS, comment computeCRMClientTimeline arbitre entre étape déclarée et étape déduite, comment les "reasons" sont produites, et comment l'étape est enregistrée. Je veux réutiliser ce pattern pour le chantier.
5. Le stockage de FICHIERS : est-ce que l'appli sait déjà uploader un fichier (photos de visite, plans, pièces jointes) ? Quel bucket Supabase, quelle fonction d'upload, quelle table de métadonnées ? C'est essentiel pour "importer le devis PDF".
6. Où sont les groupes d'un chantier (meta.chrono_groupes) et les jalons (meta.chrono_jalons), et comment savoir si un groupe est terminé (avancement des tâches du groupe).
7. Comment sont stockées les équipes et l'affectation équipe → groupe (Point 1), pour l'étape "Équipes affectées".

Termine par : (a) ce qui manque en base pour tenir les formules QCD que je t'ai données, (b) les points d'attention pour rester strictement additif.
```

---

## Prompt 1 — Module de calcul QCD (calculs purs, aucun affichage)

```
Objectif : créer un module de calcul du QCD isolé et testable, SANS aucune modification d'interface.

Crée un module dédié (ex. src/Renovation/qcd.js) qui expose des fonctions pures. N'importe RIEN de DashboardAnalyse.jsx : ces formules sont considérées comme fausses.

1) Délai :
   indice = heures_reelles / (heures_vendues_total × avancement)   // avancement en fraction 0→1
   - heures_reelles = somme des heures pointées validées du chantier
   - heures_vendues_total = somme des heures_vendues des tâches
   Statuts : vert < 1,10 · orange 1,10 à 1,30 · rouge > 1,30
   Cas "démarrage" (statut neutre, pas d'alerte) si avancement < 0,15, ou si heures_vendues_total = 0, ou données absentes.

2) Coût (comparaison au BUDGET TOTAL prévu, non proraté) :
   ratio_MO = cout_MO_reel / cout_MO_prevu           // prévu = heures vendues × taux horaire
   ratio_mat = cout_materiaux_reel / cout_materiaux_prevu  // réel = lignes de commande, prévu = estimation
   statut = le PIRE des deux ratios
   Statuts : vert < 0,90 · orange 0,90 à 1,00 · rouge > 1,00 · non évaluable si budget prévu = 0.

3) Qualité : expose une seule fonction dédiée qui renvoie pour l'instant TOUJOURS l'état "gris / non évalué"
   (avec un message type "chantier non contrôlé"). Elle sera remplie plus tard par les contrôles de fin de
   groupe : isole-la bien pour qu'on n'ait qu'un seul endroit à modifier.

4) Une fonction d'ensemble qui renvoie les trois sommets avec, pour chacun : statut, valeur brute, valeur
   formatée lisible, et une explication courte en français (ex. "80 h consommées pour 20 h attendues à 20 %
   d'avancement"). Les seuils doivent être des constantes exportées, faciles à recalibrer.

Contraintes : aucune modification d'interface, aucun effet de bord, tout en fonctions pures. Robuste aux
données manquantes (jamais NaN affiché, jamais de division par zéro).

Critère d'acceptation : je peux appeler ces fonctions avec les données d'un chantier et obtenir les trois
sommets ; l'exemple 100 h vendues / 20 % / 80 h consommées donne bien un indice de 4 et un statut rouge ;
rien n'a changé dans l'appli.
```

---

## Prompt 2 — Bandeau QCD sur la fiche chantier

```
Objectif : afficher le triangle QCD en tête de la fiche détaillée d'un chantier, en consommant le module du Prompt 1.

- Insère un bandeau en haut de la fiche chantier (page Chantiers → un chantier), avant les blocs existants,
  sans casser la mise en page actuelle.
- Représente les trois sommets Qualité / Coût / Délai avec leur couleur (vert / orange / rouge / gris).
  Un vrai triangle est bienvenu s'il reste lisible ; sinon trois indicateurs clairement identifiés comme les
  trois axes du QCD.
- Au clic (ou au survol) d'un sommet : afficher le détail — la valeur, le calcul en clair, et l'explication
  courte renvoyée par le module. L'utilisateur doit comprendre POURQUOI c'est orange ou rouge.
- Le sommet Délai en état "démarrage" s'affiche en neutre avec la mention "trop tôt pour juger".
- Le sommet Qualité en gris affiche le message incitatif ("ce chantier n'a pas encore été contrôlé").
- Le bandeau se met à jour avec les données du chantier déjà chargées : ne refais pas de requêtes si les
  données sont déjà là.

Contraintes : additif ; ne modifie ni les calculs financiers existants, ni le Dashboard, ni la page Analyse.
Réutilise le style/les composants de la fiche chantier (cartes, couleurs, thème T) pour rester homogène.

Critère d'acceptation : j'ouvre un chantier, je vois immédiatement l'état Q/C/D ; en cliquant sur "Délai" je
vois le calcul détaillé ; un chantier sans contrôle affiche la Qualité en gris ; le reste de la fiche est
intact.
```

---

## Prompt 3 — Correction manuelle des sommets

```
Objectif : pouvoir corriger à la main chacun des trois sommets, sans perdre la valeur automatique.

- Sur chaque sommet, permets de forcer le statut (vert / orange / rouge) avec un commentaire court obligatoire.
- Stocke l'override dans le phasage (meta), par sommet : statut forcé, commentaire, auteur, date.
- L'affichage indique clairement quand un sommet est forcé, et montre à côté la valeur automatique
  ("auto : rouge") — comme la frise CRM affiche l'étape déduite quand on a déclaré une étape manuelle.
- Un bouton permet de revenir à l'automatique.

Contraintes : l'override n'altère JAMAIS le calcul automatique, il se superpose. Additif.

Critère d'acceptation : je force la Qualité en vert avec un commentaire, c'est visible et attribué ; la valeur
auto reste affichée à côté ; je peux revenir à l'automatique en un clic.
```

---

## Prompt 4 — Référentiel du cycle de vie (6 phases + étapes)

```
Objectif : définir le référentiel du cycle de vie chantier, en données, sans affichage.

- Crée une définition centralisée (ex. src/Renovation/cycleVie.js) des 6 phases dans l'ordre, chacune avec
  ses étapes. Pour chaque étape : un id stable, un libellé, la nature de validation
  ("auto" | "document" | "coche"), et un indice/hint pour la déduction automatique (comme les "hints" de
  CRM_CLIENT_TIMELINE_STEPS).

  1 Devis      : chiffrage_realise (auto) · devis_envoye (document) · reponse_client (coche)
  2 Contrat    : devis_signe (document) · acompte_encaisse (coche + montant/date) · retractation_purgee (auto, signature + 14 j)
  3 Préparation: plans_execution (document) · commandes_appros (coche/lien) · equipes_affectees (auto) · installation_chantier (coche)
  4 Travaux    : dérivée des GROUPES du chantier (une entrée par groupe), chaque groupe validé par son jalon de contrôle
  5 Réception  : visite_reception (document, PV) · levee_reserves (coche) · remise_cles_doe (document)
  6 Garanties  : parfait_achevement (auto, réception + 1 an) · interventions_sav (journal) · fin_garantie (repère de date)

- IMPORTANT : n'utilise pas le mécanisme des "phases" du Phasage V1 (plan_travaux[phase_id]). C'est une
  notion différente, au niveau projet. Nomme les choses sans ambiguïté.
- Prévois que TOUTE étape peut porter une ou plusieurs pièces jointes, quelle que soit sa nature de validation.
- Aucun affichage à ce stade : juste le référentiel + les helpers (phase d'une étape, étape suivante, etc.).

Contraintes : strictement additif, aucun impact sur le phasage, le V1, ou les lots.

Critère d'acceptation : le référentiel des 6 phases et de leurs étapes est disponible et documenté dans le
code ; rien n'a changé dans l'appli.
```

---

## Prompt 5 — La frise sur la fiche chantier (hybride, modèle CRM Invest)

```
Objectif : afficher la frise du cycle de vie sur la fiche chantier, avec la phase en cours déduite
automatiquement et corrigeable — en reprenant le pattern de la frise du CRM Invest.

- Étudie d'abord src/Invest/CRM.jsx (CRM_CLIENT_TIMELINE_STEPS + computeCRMClientTimeline) et reprends la même
  logique : étape déclarée à la main PRIORITAIRE sur l'étape déduite, avec les "raisons" affichées, et un
  message quand l'indice détecté est plus avancé que l'étape déclarée.
- Déduction automatique de la phase du chantier, à partir des signaux existants :
  statut commercial (Prospect → Signé), statut chantier (Planifié → En cours → Terminé), dates disponibles
  (signature, démarrage, réception), avancement, et étapes déjà validées.
  Règle de bon sens : la phase déduite ne recule jamais toute seule.
- Affiche la frise sous le bandeau QCD : les 6 phases dans l'ordre, la phase en cours mise en avant, et les
  étapes de cette phase avec leur état (fait / à faire).
- Permets de déclarer manuellement la phase en cours (prioritaire), avec la phase déduite affichée à côté.
- Visuellement : inspire-toi de la frise CRM pour rester familier, mais adapte-toi au thème de la partie
  Rénovation.

Contraintes : additif ; ne modifie pas le CRM Invest, contente-toi de t'en inspirer. La frise doit rester
lisible sur mobile.

Critère d'acceptation : j'ouvre un chantier signé et en cours, la frise le positionne toute seule dans la
bonne phase avec la raison ; je peux forcer une autre phase et ça tient ; la phase déduite reste visible.
```

---

## Prompt 6 — Validation des étapes par une action + pièces jointes

```
Objectif : rendre chaque étape de la frise validable par une action concrète, et permettre de joindre un
document sur n'importe quelle étape.

- Pour chaque étape, implémente sa nature de validation :
  - "auto" : calculée (chiffrage existant, rétractation = signature + 14 j, équipes affectées sur tous les
    groupes, parfait achèvement = réception + 1 an). Non modifiable à la main, mais explicite : montre POURQUOI
    c'est validé ou non.
  - "document" : l'étape se valide en important un fichier (devis PDF, devis signé, plans, PV de réception,
    DOE). Le fichier devient consultable directement depuis la frise (ouvrir / télécharger).
  - "coche" : validation manuelle simple, avec la possibilité de saisir les infos utiles (ex. montant + date
    pour l'acompte).
- Pièces jointes : TOUTE étape, quelle que soit sa nature, peut recevoir une ou plusieurs pièces jointes
  (photo ou document en preuve). Réutilise le mécanisme d'upload existant de l'appli (celui identifié au
  Prompt 0) — ne crée pas un second système de fichiers.
- Stocke pour chaque étape : validée ou non, date, auteur, données saisies, et la liste des pièces jointes.
- Résultat attendu : la frise devient aussi le classeur du chantier — depuis la fiche, je retrouve le devis,
  le devis signé, le PV de réception, à leur place.

Contraintes : additif ; réutilise le stockage de fichiers existant ; les étapes "auto" ne doivent jamais être
faussées par une saisie manuelle.

Critère d'acceptation : j'importe le devis PDF → l'étape "Devis envoyé" passe validée et je peux ouvrir le
devis depuis la frise ; je coche l'acompte avec montant et date ; je peux joindre une photo sur une étape
"coche" ; la rétractation se valide toute seule 14 jours après la signature.
```

---

## Prompt 7 — Brancher la phase « Travaux » sur les groupes (et préparer la Qualité)

```
Objectif : faire de la phase "Travaux" le reflet des groupes d'exécution du chantier, et préparer le
branchement du sommet Qualité.

- Dans la frise, la phase "Travaux" se déroule en une entrée par GROUPE du chantier (meta.chrono_groupes),
  dans leur ordre, avec l'avancement de chaque groupe.
- Un groupe est considéré terminé quand ses tâches sont à 100 % ; il est "validé" quand son jalon de contrôle
  a été réalisé (mécanisme livré par le Point 2 b). En attendant ce chantier-là : affiche l'état d'avancement
  du groupe et prévois explicitement l'emplacement du témoin "contrôlé / non contrôlé", sans l'inventer.
- La phase "Travaux" ne peut se terminer que lorsque tous les groupes sont contrôlés — implémente la règle,
  même si la source "contrôlé" renvoie encore toujours faux.
- Vérifie que le sommet Qualité du QCD consomme bien la fonction isolée du Prompt 1 (et pas une logique
  dupliquée ici) : il doit suffire de remplir cette fonction pour que la Qualité s'allume.

Contraintes : additif ; ne crée aucune notion de contrôle/visite ici (c'est le Point 2 b) ; ne duplique aucune
logique de Qualité.

Critère d'acceptation : sur un chantier en travaux, la frise montre mes groupes dans l'ordre avec leur
avancement ; la phase Travaux ne se clôture pas alors que des groupes ne sont pas contrôlés ; la Qualité
reste grise mais son point de branchement est unique et identifié.
```

---

## Récapitulatif de l'ordre
0. Audit (lecture seule) → 1. Module de calcul QCD → 2. Bandeau QCD sur la fiche chantier → 3. Correction manuelle des sommets → 4. Référentiel du cycle de vie → 5. Frise hybride sur la fiche → 6. Validation des étapes + pièces jointes → 7. Phase Travaux branchée sur les groupes.

## Invariants à toutes les étapes
- **Ne jamais réutiliser les formules de `DashboardAnalyse.jsx`** (considérées fausses).
- Le **V1 (phases)**, les **lots**, l'**import de devis** et le **phasage** ne sont pas impactés.
- Le **calcul** QCD reste séparé de l'**affichage**.
- La **Qualité** a un seul point de branchement, `gris` par défaut.
- **Une pièce jointe possible sur toutes les étapes.**
- Chaque étape est **strictement additive** : on **teste** puis on **commit** avant la suivante.
