# Chantier 10 — Diagnostic pour l'étape 2 de l'assistant IA Rénovation

Date : 24/09/2026. Livré avec l'étape 1 (PR `feat/renovation-copilot-v1`), **sans aucune modification du moteur de planning**.

Objet : préparer l'étape 2 de l'assistant — « qui travaille où / quand ça finit », « et si… », et les consignes au moteur en langage naturel demandées par Loris :
- « Steven est absent lundi prochain, recalcule » → `planning_resource_events` ;
- « Kev va faire l'ossature placo sur ce chantier même si ce n'est pas son équipe, recalcule » → `planning_constraints`, type `resource_required`, scope groupe (chantier + `groupe_type_id`) ;
- « J'ai programmé une intervention le 25/09, prends-la en compte » → allocation manuelle verrouillée (`allocation_lock` / `fixed_date`).

Questions 1 à 3 : prompt initial de l'étape 1. Questions 4 à 7 : ajoutées en cours d'étape.

Méthode : lecture du code (fichier:ligne), requêtes en **lecture seule** sur la base, et mesures sous Node sur des **données fictives**. Les bancs de mesure et démonstrations ont été exécutés hors du dépôt et ne sont pas versionnés. Numéros de ligne relevés sur `main` au 24/09/2026 (af75749) ; pour `api/ai.js`, sur cette branche (+11 lignes : le correctif « crédit épuisé »).

Contre-vérification faite à la relecture : filtre du pool avant `resource_required` (`planningEngineV1.js:217-250`, `planningConstraintModelV1.js:169-175`), verrou rangé sans contrôle du jour (`planningEngineAdapterV1.js:276-284`), options lues par `simulerPlanningGlobalV1` (`planningEngineDataV1.js:192-198`), et en base : `apply_planning_replanning_v1` absente de `pg_proc`, `planning_resource_events` = 0 ligne, `planning_constraints` = 0 ligne.

Légende utilisée partout :
- **[CODE]** vérifié en lisant le code (fichier:ligne) ;
- **[BASE]** vérifié par une requête SQL en LECTURE (SELECT uniquement, connecteur Supabase, projet `yooksnzhlffqgpzkcjhl`, le projet de production) ;
- **[MESURÉ-FICTIF]** exécuté sous Node sur **données fictives** (exemple issu des tests, données fictives) ;
- **[NON VÉRIFIÉ]** hypothèse ou information extérieure au dépôt.

## Résumé en 7 lignes

1. Côté serveur, **un seul fichier** bloque : `src/supabase.js` (client navigateur, `import.meta.env`), importé sans extension par `planningEngineDataV1.js`. Les 26 autres modules de la chaîne se chargent sous Node 22 (testé). L'injection d'un client serveur est possible sans dupliquer le chargement, avec un petit découpage.
2. Une simulation complète prend **~10 s (horizon 42 j) et ~23 s (horizon 84 j)** sur un jeu fictif calibré sur les volumes réels, dont **~85 % du temps passé à re-normaliser les contraintes** en boucle. C'est au-dessus des 10 s historiques du plan Hobby.
3. Absences « et si » en mémoire : **pas via `simulerPlanningGlobalV1`** (aucun paramètre prévu), **oui via les fonctions pures** qu'il appelle. Le déclencheur `resource_unavailable` NE crée PAS d'absence.
4. `planning_resource_events` et `planning_constraints` sont bien lus et utilisés, mais **les deux tables sont vides en base** aujourd'hui. Plusieurs cas sont chargés mais sans effet : contraintes « soft » (sauf priorité), bornes de dates sur les contraintes de ressource, scope `allocation` hors verrou.
5. `resource_required` **ne peut jamais placer une ressource hors du pool** : il ne fait que restreindre le pool. Si Kev n'est pas dans le pool, la tâche devient **non planifiée, sans avertissement, avec une raison générique trompeuse**.
6. Une allocation verrouillée posée un vendredi de semaine impaire (0 h) est **conservée telle quelle, en silence** (pas de rejet, pas de déplacement, pas d'avertissement).
7. L'application au planning réel n'existe pas : la fonction SQL `apply_planning_replanning_v1` est **écrite mais volontairement non déployée** (absente en base), **aucun code ne l'appelle**, et elle exige un utilisateur connecté (pas de clé service).

---

## Question 1 — Faire tourner `simulerPlanningGlobalV1` côté serveur (Node / fonction Vercel CommonJS)

**Réponse : partiellement possible aujourd'hui ; un seul verrou réel, facile à lever.**

### 1.1 Graphe d'imports [CODE + MESURÉ]
Graphe transitif calculé par script (`graph.cjs`) depuis `src/Renovation/planningEngineDataV1.js` : **28 fichiers**. Le seul fichier qui dépend du navigateur :

| Fichier | Problème | Preuve |
|---|---|---|
| `src/supabase.js` | `import.meta.env.VITE_SUPABASE_URL` (variable Vite, `undefined` sous Node) | `src/supabase.js:3-5` : `const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;` |
| `src/Renovation/planningEngineDataV1.js` | importe ce client **sans extension** | `planningEngineDataV1.js:7` : `import { supabase } from "../supabase";` |

Aucun autre fichier de la chaîne n'utilise `window`, `localStorage`, `document`, `import.meta.env` ni JSX (recherche automatique sur les 28 fichiers). Tous les autres imports relatifs ont une extension explicite (`.js` ou `.mjs`, ex. `planningEngineDataV1.js:8-15`, `planningResourceCapacityV1.js:1` → `"../rythmeSemaine.js"`).

Tests réels sous Node v22.23.2 depuis un script **CommonJS** faisant `await import()` (`test-import.cjs`) :
- `planningEngineDataV1.js` → **ÉCHEC** `ERR_MODULE_NOT_FOUND ... Cannot find module '...\src\supabase'` (import sans extension).
- `src/supabase.js` importé directement → **ÉCHEC** `TypeError: Cannot read properties of undefined (reading 'VITE_SUPABASE_URL')`.
- `planningReplanningAdapterV1.js`, `planningReplanningIncrementalV1.js`, `planningEngineV1.js`, `rythmeSemaine.js` → **OK**, avec l'avertissement `MODULE_TYPELESS_PACKAGE_JSON` (« Reparsing as ES module because module syntax was detected »).

### 1.2 Le piège `.js` ESM sans `"type":"module"` [CODE + NON VÉRIFIÉ sur Vercel]
- `package.json` n'a pas de `"type"` ni de `"engines"` (lu en entier). Les modules du moteur sont des `.js` en syntaxe ESM, contrairement à la règle du projet « modules de calcul purs : extension `.mjs` + façade `.js` » (CLAUDE.md).
- `scripts/_chargeur.mjs:3-6` documente déjà ce problème et le contourne par des data-URL.
- Sous Node ≥ 22.12, la **détection de syntaxe** les recharge en ESM (constaté localement). Sur Vercel, la version de Node du projet n'est fixée nulle part dans le dépôt (pas d'`engines`, pas de `.nvmrc`) → **[NON VÉRIFIÉ]** que la fonction tourne avec un Node qui fait cette détection. Tous les `await import()` serveur existants visent des **`.mjs`** : `api/cron-snapshot-hebdo.js:142`, `api/generate-info-client-docx.js:60`, `api/_ia/invest/moteur.js:40`.

### 1.3 Droits de lecture côté serveur [BASE + MESURÉ]
Lecture avec la clé **anon** du fichier d'environnement local (comptages uniquement) :
- `phasages` : **0 ligne, sans erreur** (RLS : lecture vide silencieuse ; la base en compte 42) ;
- `planning_resources`, `planning_resource_events`, `planning_constraints` : **refus 401** ;
- `planning_config` : seules `chantiers, espace_ouvrier_actif, heures_par_jour, ouvriers` visibles (pas `groupes_types` ni `equipes`).

→ Un chargeur serveur doit utiliser la **clé service** (comme `api/ai.js:126`, `createClient(SUPABASE_URL, SERVICE_KEY…)`) ou le **jeton de l'utilisateur**. Avec la clé anon, `verifier()` lèverait une erreur sur les ressources (`planningEngineDataV1.js:19-25`), donc l'échec serait visible — mais les phasages seuls reviendraient vides sans bruit.

### 1.4 Peut-on injecter un client serveur sans dupliquer le chargement ? **Oui.** [CODE + MESURÉ-FICTIF]
Le chargement est concentré dans **une seule fonction**, `chargerDonneesSimulationPlanningGlobalV1` (`planningEngineDataV1.js:32-96`), qui n'utilise que `supabase.from(...)` (7 requêtes en parallèle, l. 35-61). Démonstration : `bench.mjs` recharge le **vrai** `planningEngineDataV1.js` en remplaçant **uniquement** la ligne 7 par un faux client en mémoire (`fake-supabase.mjs`) — la simulation complète tourne sous Node sans autre changement.

**Changement minimal proposé (texte, non appliqué) :**
1. Créer `src/Renovation/planningEngineDataCoreV1.mjs` contenant le code actuel de `planningEngineDataV1.js` (l. 17-267), **sans** l'import de `../supabase`, où chaque fonction publique reçoit `client` en paramètre (`chargerDonneesSimulationPlanningGlobalV1({ client, startDate, horizonDays })`, puis `preparerDonneesReellesMoteurV1`, `simulerPlanningGlobalV1`, `simulerSensibiliteHorizonsReplanningV1` qui le transmettent).
2. Réduire `planningEngineDataV1.js` à une façade navigateur : importer `supabase` depuis `"../supabase.js"` et réexporter les fonctions avec `client: options.client || supabase`. Les appels existants (`BilanSemaine.jsx:1051`, `PlanningEngineSimulationPanel.jsx:77`) ne changent pas.
3. Côté serveur : `await import("../src/Renovation/planningEngineDataCoreV1.mjs")` avec un client service.
4. Pour ne pas dépendre de la détection de syntaxe de Node sur Vercel : soit passer la chaîne pure en `.mjs` avec façades `.js` (conforme à CLAUDE.md, ~27 fichiers dont `rythmeSemaine.js`), soit fixer `"engines": {"node": ">=22.12"}` et le vérifier sur un déploiement de préproduction.
5. Profiter du même paramètre d'options pour les absences « et si » (voir Q3).
6. Le script existant `scripts/verif-planning-engine-data-v1.mjs:18-19` interdit toute écriture/RPC dans `planningEngineDataV1.js` : il faudra l'étendre au nouveau fichier.

Autres points serveur : il reste **1 place** de fonction sur les 12 du plan Hobby (11 fichiers `api/*.js` comptés) ; le résultat pèse **1,6 à 3 Mo** en JSON [MESURÉ-FICTIF], alors que `api/ai.js:330` plafonne les résultats d'outils à `MAX_OCTETS_RESULTATS = 120000` octets → il faudra un résumé, pas le résultat brut.

---

## Question 2 — Durée d'une simulation complète

**Réponse : mesurée sur données fictives uniquement ; environ 10 s pour 42 jours, 23 s pour 84 jours sur ce PC. Les données réelles n'ont pas pu être chargées sous Node** (clé anon insuffisante, voir 1.3 ; aucune clé service locale ; les ~1,4 Mo de JSON réels n'ont pas été rapatriés via le connecteur).

### 2.1 Volumes réels [BASE] (comptages uniquement)
| Donnée | Valeur réelle |
|---|---|
| Phasages | 42 (546 ouvrages, 2 572 tâches) |
| Tâches ouvertes (< 100 %) avec heures > 0 | 1 339, sur 29 chantiers |
| Tâches avec dépendances explicites | 212 |
| Chantiers dans `planning_config.chantiers` | 39 |
| Groupes types / équipes | 13 / 5 |
| Ressources actives | 14 |
| `planning_cells` | 1 044 (semaines 2026-W09 → 2027-W03) |
| Lignes liées dans l'horizon 42 j depuis le 28/09 (W40-W45) | 181 lignes, 173 tâches distinctes, 8 chantiers |
| `planning_resource_events` / `planning_constraints` | **0 / 0** |

### 2.2 Mesures [MESURÉ-FICTIF] — exemple issu des tests, données fictives
Banc `bench-calibre.mjs` : le **vrai** `simulerPlanningGlobalV1` avec un faux client en mémoire (réseau non compté). Jeu fictif calibré : 42 phasages, 52 chantiers en config, 2 730 tâches dont 1 347 ouvertes, 14 ressources, 5 équipes, 13 groupes types, 184 lignes de prévision, départ le 28/09/2026. Node 22.23.2, Windows, 4 cœurs.

| Cas | 5 exécutions (ms) | Résultat |
|---|---|---|
| Horizon 42 j | 10 232 · 9 820 · 10 074 · 9 821 · 9 824 | 1 248 travaux moteur, 271 allocations proposées, 1 161 non planifiés, 1,6 Mo |
| Horizon 84 j | 23 039 · 23 187 · 22 715 · 22 716 · 24 512 | 670 allocations, 1 031 non planifiés, 2,5 Mo |
| Sensibilité 3 horizons [42, 56, 84] | 48 633 (1 exécution) | |
| Import des modules à froid | 57 ms | |

Première version du jeu, moins bien calibrée (667 tâches en prévision au lieu de 173) : **38 à 61 s** à 42 j, **86 à 132 s** à 84 j. Le temps dépend donc fortement du nombre de contraintes (réelles + éphémères).

Décomposition sur le jeu calibré, horizon 42 j (`bench-phases.mjs`) : préparation 82 ms · stabilité 3 ms · **cœur `planifierPropositionV1` 10 332 ms** · diagnostic 8 ms · diff 12 ms · plan d'application 35 ms · sécurité 16 ms.

### 2.3 Cause [MESURÉ-FICTIF + CODE]
Profil CPU (`--cpu-prof`, `top.cjs`) : **76,8 % dans `normaliserContraintePlanning`** + 7,8 % dans son utilitaire `str` → **~85 % du temps à re-normaliser des contraintes déjà normalisées**.
- Déjà normalisées une fois : `planningEngineV1.js:358`.
- Re-normalisées à chaque appel de `evaluerContraintesPlanning` : `planningConstraintModelV1.js:134-135` (`.map(normaliserContraintePlanning)`), appelé pour **chaque tâche × chaque tour de boucle × chaque jour** (`planningEngineV1.js:395-399`) et **chaque ressource candidate** (`planningEngineV1.js:244-249`).
- Et dans `contraintesPourTravail` (`planningEngineV1.js:139-143`), appelé par `scorerTravail` via `prioriteContrainte` et `deadlineTravail` (l. 146-158, 194, 202).
- La boucle `while (progress)` (l. 384-513) recalcule toute la liste éligible après **chaque** allocation (`break` l. 511).
- Chaque tâche avec prévision reçoit une contrainte éphémère `not_before` (`planningReplanningDateStabilityV1.js:117-121`) : 176 dans le jeu calibré.
Une mise en cache de la normalisation ferait probablement tomber le temps de façon importante [NON VÉRIFIÉ : non testé, aucun code modifié].

### 2.4 Comparaison aux limites Vercel
- `vercel.json:2-4` : seul `api/cron-snapshot-hebdo.js` a `"maxDuration": 60`. Aucun autre réglage ; aucune mention de durée max ailleurs dans le dépôt (recherche dans `api/`, `public/*.md`, mémoire projet `reference_vercel_hobby_limites.md` qui ne parle que du nombre de fonctions).
- **[NON VÉRIFIÉ]** Plan Hobby : défaut historique **10 s** (max 60 s configurable) ; avec **Fluid compute** (réglage du projet Vercel, invisible dans le dépôt) le défaut et le maximum sont plus élevés (de l'ordre de 300 s selon la documentation Vercel récente). À vérifier dans le tableau de bord Vercel.
- Le temps mesuré (10 s à 42 j) **ne compte pas** : le réseau Supabase (7 requêtes dont une lecture non filtrée de toutes les `planning_cells`, `planningEngineDataV1.js:44-45`), le démarrage à froid, ni la vitesse du processeur Vercel. → **À 10 s, ça ne passe pas ; à 60 s, ça passe pour 42 j et 84 j mais pas pour la sensibilité 3 horizons (~49 s + réseau, marge nulle).**
- `api/ai.js:328` : `MAX_TOURS = 5` tours de modèle, et les outils sont exécutés **en série** dans la même invocation (`api/ai.js:385-404`). Une simulation (10-25 s) appelée comme outil s'ajoute aux 1 à 6 appels au modèle dans **la même** durée de fonction.
- Côté navigateur, `BilanSemaine.jsx:1051` lance déjà `simulerPlanningGlobalV1({ horizonDays: 42 })` : on peut s'attendre à ~10 s de calcul bloquant l'onglet [NON MESURÉ dans un navigateur].

---

## Question 3 — Absences passées en mémoire pour une simulation « et si »

**Réponse : non via `simulerPlanningGlobalV1` ; oui via les fonctions pures qu'il enchaîne.**

- [CODE] `simulerPlanningGlobalV1(options)` ne lit que `startDate`, `horizonDays` (transmis à `chargerDonneesSimulationPlanningGlobalV1`, l. 32 et 193) et `replanningTrigger` (l. 197). Aucune option pour ajouter des événements : ils viennent **uniquement** de la base (l. 50-54 → l. 70 → l. 109).
- [CODE] Le point d'injection existe **un cran plus bas** : `preparerSimulationReplanningV1({ ..., evenementsRessources })` (`planningReplanningAdapterV1.js:178`, transmis l. 187 à `preparerSimulationPlanningGlobalV1`, `planningEngineAdapterV1.js:245` puis copié l. 603), jusqu'au moteur `planifierPropositionV1({ evenementsRessources })` (`planningEngineV1.js:343`, utilisé l. 429). Ces fonctions sont pures.
- [CODE] Précédent existant : `simulerSensibiliteHorizonsReplanningDepuisSnapshotV1({ snapshot })` (`planningReplanningHorizonSensitivityV1.js:139`) rejoue toute la chaîne depuis un **snapshot en mémoire** qui contient `evenementsRessources` (l. 51, 84). Une simulation « et si » = charger le snapshot une fois (`chargerDonneesSimulationPlanningGlobalV1`), ajouter des événements au tableau, rejouer la chaîne des l. 193-224.
- [MESURÉ-FICTIF] `demo-q3-q5-q6.mjs` (exemple issu des tests, données fictives) : tâche de 16 h, pool = Steven. Sans absence → `2026-09-21 9h, 2026-09-22 7h`. Avec une absence **en mémoire** du 21 au 23/09 → `2026-09-24 8h, 2026-09-28 7h, 2026-09-29 1h`. Aucune écriture.
- [CODE + MESURÉ-FICTIF] **Piège : le déclencheur `replanningTrigger: { type: "resource_unavailable" }` ne rend PAS la ressource indisponible.** Il sert seulement à choisir quelles allocations libérer (`planningReplanningImpactV1.js:108-121`) ; aucun code ne le transforme en événement (recherche de `resource_unavailable` : seuls `planningReplanningImpactV1.js:108` et un libellé `PlanningEngineSimulationPanel.jsx:53`). Démo : avec ce déclencheur et sans événement, Steven est **reposé le jour même** (`2026-09-21 9h`).
- Changement minimal suggéré (texte) : une option `evenementsRessourcesSimules` (et `contraintesSimulees`) ajoutée dans le cœur proposé en Q1, concaténée aux données lues avant l'appel de `preparerSimulationReplanningV1`, et marquée dans `invariants` / `audit_lecture` pour qu'un résultat « et si » ne puisse jamais être appliqué tel quel (voir Q7).

---

## Question 4 — `planning_resource_events` et `planning_constraints` sont-ils vraiment utilisés ?

**Réponse : oui, les deux sont chargés, transmis et utilisés dans l'allocation. Mais [BASE] les deux tables sont vides (0 ligne chacune) : aujourd'hui, en pratique, aucune simulation n'est influencée par elles.** Plusieurs cas sont chargés mais ignorés.

### 4.1 Événements ressources — parcours complet [CODE]
1. Lecture : `planningEngineDataV1.js:50-54` (`actif = true`, chevauchement de l'horizon).
2. Transmission : l. 70 → l. 109 → `planningReplanningAdapterV1.js:187` → `planningEngineAdapterV1.js:603` (copie) → `planningEngineV1.js:343`.
3. Utilisation dans l'allocation : `choisirEquipe` appelle `calculerCapaciteRessourcePourDate` pour chaque ressource candidate (`planningEngineV1.js:233-239`) ; ressource écartée si `capacite_disponible <= EPS` (l. 239).
4. Calcul : `planningResourceModelV1.js:227-284` — `capacite_override` remplace la capacité (l. 241-247), `absence`/`indisponibilite` journée entière → 0 (l. 249-255), partielle → réduction en heures (l. 257-260).
5. Aussi utilisé par le diagnostic d'après-calcul (`planningReplanningEngineV1.js:163, 219-224`).

Chargés mais sans effet : colonnes `motif_code`, `details`, `source` (lues l. 51, jamais utilisées dans le calcul). Un type inconnu devient `null` et est ignoré sans avertissement (`planningResourceModelV1.js:201`) — [BASE] mais la contrainte SQL `planning_resource_events_type_check` n'autorise que `absence`, `indisponibilite`, `capacite_override` : les 3 types autorisés sont tous traités. À noter : un `capacite_override` s'applique même un jour à 0 h (vendredi de semaine impaire) et le rend travaillable (l. 244-245 remplace la capacité de base sans la regarder).

### 4.2 Contraintes — parcours complet [CODE]
1. Lecture : `planningEngineDataV1.js:55-57` (`actif = true`, sans filtre de date).
2. Adaptateur : normalisation `planningEngineAdapterV1.js:258-260` ; `allocation_lock` sert à figer les allocations (l. 261-263, 276-284) **puis est retiré** de ce qui part au moteur (l. 560) ; le reste passe dans `engineInput.contraintes` (l. 604).
3. Moteur : filtrage par date par tâche (`planningEngineV1.js:395-403`), par ressource (l. 244-250), score (l. 193-210). Règles par type : `planningConstraintModelV1.js:144-193`.

| Type | Effet réel |
|---|---|
| `not_before` (hard) | bloque les dates avant (`planningConstraintModelV1.js:146-151`) |
| `fixed_date` (hard) | bloque hors fenêtre (l. 159-167) |
| `deadline` | jamais bloquante : violation + bonus de score (l. 153-157 ; `planningEngineV1.js:202-207`) |
| `resource_required` / `resource_forbidden` (hard) | écarte des ressources **à l'intérieur du pool** (l. 169-182 ; voir Q5) |
| `priority` | ajoute au score (l. 186-188 ; `planningEngineV1.js:154-158, 194`) |
| `allocation_lock` | fige l'allocation existante (adaptateur), ignoré par le moteur (l. 183-185 : `locked = true` jamais lu) |

**Chargé mais ignoré ou sans effet :**
- **Toute contrainte `hard: false`** (sauf `priority`) : elle produit seulement une « préférence » (l. 149, 164, 172, 179) que le moteur ne lit jamais ; le score d'une ressource n'utilise pas `cEval.score` ni `cEval.preferences` (`planningEngineV1.js:261-264`, `cEval` sert uniquement au test `eligible` l. 250).
- **Bornes de dates sur `resource_required`, `resource_forbidden`, `priority`** : ignorées (l. 169-188 ne regardent pas `date_debut/date_fin`, et `contrainteSapplique` l. 105-126 non plus). « Kev requis du 1er au 5/10 » s'appliquerait sur tout l'horizon.
- **Scope `allocation` pour un autre type qu'`allocation_lock`** : ne s'applique jamais, le contexte moteur n'a pas d'`allocation_id` (`planningEngineV1.js:131-137` vs `planningConstraintModelV1.js:121-122`).
- `label`, `source`, `created_at` : lus, sans effet.

---

## Question 5 — `resource_required` (scope groupe) peut-il placer une ressource HORS de son pool ?

**Réponse : non, jamais. Il ne fait que restreindre le pool. Ce n'est ni un rejet, ni un avertissement, ni un élargissement : la tâche devient non planifiable, en silence, avec une raison générique trompeuse.** [CODE + MESURÉ-FICTIF]

- Le pool HARD vient du groupe métier : `planningEngineAdapterV1.js:498-507` (`candidates = … groupe.groupe_type_id ? candidatesGroupe : mappingTache.ids`). Les noms de `tache.ouvriers` n'élargissent jamais un groupe interne (commentaire l. 498-502) ; seule exception : groupe à équipe externe (l. 503-504, et `planningReplanningAdapterV1.js:129-157`).
- Les contraintes ne modifient jamais `candidate_resource_ids` (aucune lecture de contrainte dans l'adaptateur hors `allocation_lock`, l. 258-263).
- Dans le moteur, les candidats sont d'abord filtrés par le pool (`planningEngineV1.js:217-222`), **puis** `resource_required` écarte ceux qui ne sont pas dans sa liste (l. 244-250 → `planningConstraintModelV1.js:169-175`). Kev hors pool n'est **jamais évalué**.
- Conséquence : 0 candidat chaque jour → « Équipe insuffisante » (l. 305-311) → la tâche finit dans `non_planifies` avec la raison générique « Capacité / ressources insuffisantes ou contraintes incompatibles dans l'horizon » (l. 328). Aucun avertissement, aucune mention de la contrainte.
- Aucune validation à l'enregistrement : `maturiteContraintePlanning` (`planningConstraintModelV1.js:79-103`) ne compare pas la liste au pool ; la table SQL non plus (`20260828191347_create_planning_constraints_v1.sql:28-35`).
- Démonstration (exemple issu des tests, données fictives, `demo-q3-q5-q6.mjs`) : groupe `gt_placo`, équipe Placo = Steven. Sans contrainte → Steven 9 h + 7 h. Avec `resource_required` scope groupe (C1 + gt_placo) = Kev → pool toujours `[R-STEVEN]`, **0 proposition**, `tentatives {"dates_bloquees":0,"dates_sans_equipe":14}`, **aucun avertissement**.

Cas « Kev va faire l'ossature placo sur ce chantier même si ce n'est pas son équipe » : **impossible aujourd'hui** par une contrainte. Seules voies existantes : changer l'équipe du groupe type (effet sur tous les chantiers) ou passer par une tâche sans groupe. Cela demanderait une règle explicite nouvelle (ex. `resource_required` scope tâche/groupe+chantier qui **remplace** le pool, comme l'exception externe), à décider, car elle contredit l'invariant « pool jamais élargi ». À minima, la situation actuelle viole l'invariant « une impossibilité doit rester visible » : il faudrait un avertissement « contrainte incompatible avec le pool ».

---

## Question 6 — Allocation verrouillée posée un vendredi à 0 h

**Réponse : conservée telle quelle, en silence (ni rejetée, ni déplacée, ni signalée).** [CODE + MESURÉ-FICTIF]

Règle 4j/5j vérifiée [CODE + MESURÉ] : `src/rythmeSemaine.js:19-20` (4 j : vendredi 0 ; 5 j : vendredi 7), `:69` (semaine paire → 5 j, impaire → 4 j), `:81-85` (capacité planning = heures − 1, 0 si non travaillé). Le moteur l'utilise via `planningResourceCapacityV1.js:12-17`. Mesuré : 24/09 (S39) 8 h, **25/09 (S39) 0 h**, 01/10 (S40) 7 h, 02/10 (S40) 6 h.

Parcours d'une allocation verrouillée [CODE] :
- Une ligne dont l'`allocation_uid` porte un `allocation_lock` actif est rangée dans les allocations **fixes** (`planningEngineAdapterV1.js:276-280`), sans aucun contrôle de capacité ni du jour.
- Ses heures sont retirées du reste à faire de la tâche (l. 281-284, 438-439).
- Elle part au moteur comme charge existante (l. 561-572) ; `construireChargeExistanteV1` l'additionne sans contrôle (`planningEngineV1.js:122-129`). Le moteur « ne modifie jamais les allocations existantes » (l. 333-335).
- Le seul avertissement « Surcharge » existant (`planningResourceModelV1.js:266`) n'est calculé que pour une ressource candidate, et ses `warnings` ne remontent pas dans le résultat (`planningEngineV1.js:233-239`, seul `capacite_disponible` est lu).
- La fonction SQL d'application préserverait aussi la ligne à l'identique (`20260829210000_…sql:269-303`).
- L'écran permet d'ailleurs de déplacer une tâche vers un vendredi non travaillé (simple info-bulle « jour non travaillé », `Planning.jsx:549-553`).

Démonstration (exemple issu des tests, données fictives, `demo-q3-q5-q6.mjs`) :
- Tâche 16 h ; ligne `U-FRI` de 8 h le **vendredi 25/09/2026** (S39) + `allocation_lock` → fixes : `U-FRI 2026-09-25 locked=true` ; reste envoyé au moteur : **8 h** (16 − 8) ; avertissements adaptateur : **[]** ; moteur : **[]** ; proposition : `2026-09-21 Steven 8h` ; le plan d'application ne touche pas la cellule du vendredi.
- Variante `fixed_date` (hard) sur le seul 25/09 : **aucune proposition**, raison générique « Capacité / ressources insuffisantes… », `{"dates_bloquees":13,"dates_sans_equipe":1}` — rien ne dit « jour non travaillé ». (Le motif de date hors horizon n'est donné que si la date est **après** l'horizon, `planningEngineV1.js:323-327`.)
- Même contrainte le 02/10 (S40, 6 h) : 6 h placées, **10 h non planifiées**, même raison générique.

→ Conflit avec l'invariant CLAUDE.md « une impossibilité doit rester visible » : 8 h verrouillées sur un jour à 0 h sont comptées comme faites, sans signal.

---

## Question 7 — Que manque-t-il pour appliquer une simulation au planning réel ?

**Réponse : la brique d'écriture existe en SQL mais n'est ni déployée, ni appelée. Il manque tout le chemin d'application.**

### 7.1 La fonction `apply_planning_replanning_v1` [CODE + BASE]
- Définie dans `supabase/migrations/20260829210000_planning_replanning_apply_rpc_v1.sql` (736 lignes). `supabase/migrations/README.md` : « La fonction `apply_planning_replanning_v1` **n'existe pas en base**, et c'est voulu » — c'est le seul fichier en attente, et le README interdit un `supabase db push` qui la déploierait.
- [BASE] `pg_proc` : **0 fonction** de ce nom dans `public` → confirmé absente.
- [CODE] Aucun appelant : aucune occurrence de `.rpc(` vers elle dans `src/` ; `construireRequeteApplicationReplanningV1` (`planningReplanningApplyRequestV1.js:17`) n'est utilisée que par `scripts/verif-planning-replanning-apply-request-v1.mjs`. `simulerPlanningGlobalV1` déclare `application_automatique: false` (`planningEngineDataV1.js:251`).

### 7.2 Ce qu'elle écrirait (si déployée) [CODE]
- **`planning_cells`** : `UPDATE` de `planifie`, `reel`, `ouvriers`, `taches`, `vehicules` (l. 486-495) ou `INSERT` de nouvelles cellules (l. 496-508). Jamais de suppression (l. 31).
- **`phasages`** : `UPDATE ouvrages` pour réécrire `date_prevue` des tâches touchées, recalculée côté base depuis tout le planning (l. 652-716).
- Lit `planning_constraints` pour refuser de recalculer une ligne verrouillée (l. 269-276).
- Ne touche ni `planning_resource_events`, ni `planning_constraints`, ni `pointages`.

### 7.3 Gardes présentes [CODE + BASE]
- Droits : utilisateur connecté obligatoire (`auth.uid()`, l. 85-89), pas ouvrier (l. 91-95), `SECURITY INVOKER` (l. 36) donc RLS active ; `EXECUTE` seulement pour `authenticated` (l. 731-733).
- Versions : `schema_version`, `apply_plan_version`, `safety_version`, `phasage_guard_version = 2`, `application_autorisable = true` (l. 100-114).
- Verrou global entre applications : `pg_advisory_xact_lock` (l. 137).
- Compare-before-write exact de chaque cellule, avec `FOR UPDATE` (l. 213-242) ; `reel` et `vehicules` immuables (l. 245-250) ; toute ligne non déclarée recalculable doit survivre à l'identique (l. 279-303) ; ligne verrouillée ou manuelle non recalculable (l. 266-276) ; chaque nouvelle ligne doit être liée à une tâche et déclarée (l. 333-364).
- Phasages : garde par `revision` avec `FOR UPDATE` (l. 440-453). [BASE] la révision est bien incrémentée par le déclencheur `trg_phasages_revision` (`new.revision := coalesce(old.revision, 0) + 1`), et les modifications de phasages sont historisées (`trg_phasages_log_history`).
- Insertion concurrente : [BASE] contrainte `UNIQUE (week_id, chantier_id, jour)` présente sur `planning_cells`.
- Unicité globale des `allocation_uid` (l. 537-552) ; une tâche ouverte ne peut pas perdre toute prévision future (l. 554-620) ; tout échoue d'un bloc (rollback).

### 7.4 Ce qui manque
1. **Déployer la migration** (décision explicite, geste manuel ; README règle 2).
2. **Un appelant** : bouton « Appliquer » avec aperçu du diff et confirmation humaine, qui construit la requête via `construireRequeteApplicationReplanningV1` et appelle la RPC.
3. **Identité** : la RPC exige `auth.uid()` → une fonction Vercel avec la **clé service** (comme `api/ai.js:126`) serait **refusée** (`planning_replanning_auth_required`). Il faut appeler avec le jeton de l'utilisateur.
4. **Aucune revérification métier côté base** : la RPC contrôle la structure et la concurrence, mais **pas** que les lignes proposées respectent la capacité (vendredi à 0 h), les absences, les contraintes ni le pool. Elle fait confiance au plan envoyé.
5. **Pas d'historique des cellules** : [BASE] seul déclencheur sur `planning_cells` = `planning_cells_ensure_allocation_uids_v1` ; `planning_cells` ne fait pas partie des tables du filet `data_history` (`sql/202606_data_history_filet_securite.sql:74-82`). Une application ratée côté métier ne serait pas récupérable depuis Admin → Historique.
6. **Simulation « et si »** : un résultat calculé avec des absences en mémoire (Q3) ne doit pas pouvoir être appliqué sans enregistrer d'abord ces absences — aucune garde n'existe aujourd'hui pour ça (la RPC ne lit pas `planning_resource_events`).
7. **Fenêtre de fraîcheur** : 10 à 25 s de calcul [MESURÉ-FICTIF] + le temps de relecture humaine ; toute modification d'une cellule touchée ou d'un phasage entre-temps fait échouer l'application entière (voulu, mais à expliquer à l'écran). [NON MESURÉ] fréquence réelle des conflits.
8. Les points de Q5 et Q6 (tâches non planifiées sans raison claire, verrous sur jours à 0 h) seraient appliqués tels quels.

---
