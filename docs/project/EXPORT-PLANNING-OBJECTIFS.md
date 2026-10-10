# Spec — Export PDF du planning hebdo avec objectifs de la semaine

> À fournir à Claude Code avec le fichier `ref-export-planning-hebdo.html` (référence visuelle validée, à placer dans `public/`).
> Page concernée : **Planning hebdomadaire** (`src/Renovation/Planning.jsx`, bouton « Imprimer / Exporter » → `handlePrint`).

## 1. Ce que veut Loris

Chaque export PDF du planning hebdomadaire doit produire le document de la référence. Ce document comprend :

- les **objectifs de la semaine**, proposés automatiquement par une analyse puis validés à la main ;
- le **planning** en tableau, chantiers × 5 jours ;
- un encadré **Remarques** en texte libre (par exemple « Kev ne travaille pas vendredi »).

Le tout tient sur **une page A4 paysage**, au design commun des documents Profero (gabarit `docClientHTML` de `previsionnelDoc.js` : polices Barlow, bandeau sombre, jaune `#FFC200`, titres soulignés).

Le PDF ne contient **ni** la ligne « Heures planifiées », **ni** de « points à surveiller ». Loris les a retirés volontairement.

## 2. Parcours utilisateur

1. Clic sur « Imprimer / Exporter » : une modale **« Export du planning — Semaine N »** s'ouvre au lieu de lancer l'impression directement.
2. L'analyse se lance toute seule, avec un indicateur de chargement. Les objectifs proposés s'affichent en cartes éditables :
   - **Groupe affiché**, par exemple « FOURMOND 001 · 101 · 102 » ;
   - **Jour**, à choisir de lundi à vendredi ;
   - **Titre court** ;
   - **Détail**, en une ligne ;
   - la couleur est reprise du chantier.

   Chaque carte peut être supprimée, et un bouton « + Ajouter un objectif » permet d'en saisir un à la main.
3. Un champ **Remarques** (zone de texte libre, une ligne = une remarque).
4. Des **points d'attention** sont affichés **dans la modale uniquement, jamais dans le PDF**. Par exemple :
   - « 3 tâches du phasage Tom & Camille RDC ne sont pas planifiées avant la livraison » ;
   - « Mohamed n'a aucune tâche jeudi ».

   Ils aident à corriger le planning avant d'imprimer.
5. Deux boutons :
   - **Générer le PDF**, l'action principale ;
   - **Planning seul**, l'export actuel sans objectifs, en secours.
6. À la réouverture pour la même semaine, la modale recharge les objectifs et remarques **déjà enregistrés**, sans relancer d'analyse. Un bouton **« Relancer l'analyse »** remplace les propositions, après confirmation si des modifications manuelles existent.

## 3. Données — nouvelle table

`planning_semaine_export` contient une ligne par semaine.

| colonne | type | rôle |
|---|---|---|
| `week_id` | text, unique | ex. `2026-W42` |
| `objectifs` | jsonb | `[{ id, operation_id, chantier_ids[], libelle_groupe, jour, titre, detail, couleur, origine: "analyse" \| "manuel", fait_ids[] }]` |
| `remarques` | text | texte libre |
| `analyse_job_id` | uuid null | lien vers `ia_jobs` |
| `updated_by`, `updated_at` | | traçabilité |

La table doit avoir une **migration versionnée**, avec la policy RESTRICTIVE `profero_collaborateurs_seulement` (cf. CLAUDE.md).

Garder les objectifs en base prépare l'étape suivante : marquer chaque objectif **tenu / non tenu** le vendredi, pour calculer un taux de tenue des engagements (PPC).

## 4. L'analyse — deux couches

### 4a. Règles déterministes — `src/Renovation/objectifsSemaine.mjs` (module pur + façade `.js`)

**Entrées** (passées en paramètre, aucun accès Supabase) :
- les `planning_cells` de la semaine, de S-4 à S-1 et de S+1 à S+2 ;
- la config des chantiers (`nom`, `couleur`, `operation_id`) et les opérations ;
- les phasages des chantiers actifs (`taches[]` : `lot_id`, `date_prevue`, `avancement`).

**Sortie** : une liste de **faits**. Chaque fait porte un id, un type, les chantier_ids, le jour et ses *preuves*, c'est-à-dire les tâches qui le justifient. La sortie comprend aussi les **points d'attention** de la modale.

| type de fait | règle |
|---|---|
| `DEMARRAGE` | Le chantier a des tâches cette semaine et aucune cellule avec tâches de S-4 à S-1. Jour = premier jour avec tâches. |
| `LIVRAISON` | Le chantier a des tâches cette semaine, aucune en S+1/S+2, et sa dernière journée contient « réception », « nettoyage avant réception » ou « livraison ». Jour = ce dernier jour. |
| `FIN_RESEAUX` | Une tâche « essais réseaux » / « avant fermeture » est planifiée → jour de cette tâche. À défaut : dernier jour de la semaine portant des tâches de *passage* des lots plomberie / électricité / VMC, quand aucune tâche de passage de ces lots ne reste ensuite au phasage. |
| `FIN_LOT` | Toutes les tâches restantes d'un lot au phasage sont planifiées cette semaine → « lot terminé » au dernier jour (ex. menuiseries extérieures). |
| `RDV` | Tâche contenant « RDV » → jalon externe (ENEDIS, client…). |
| `FIN_CHANTIER` | Petit chantier dont toutes les tâches restantes sont planifiées cette semaine (ex. Roland). |

**Regroupement** : les faits de même type, même jour et même `operation_id` sont fusionnés en un seul (ex. « Fourmond 001 · 101 · 102 », « Tom & Camille RDC, R+1, R+2 »). Tous les chantiers sont déjà rattachés à une opération en base.

**Priorité et plafond** : on retient au maximum 8 faits, dans cet ordre : livraison > démarrage > fin réseaux > fin de lot > fin chantier > RDV.

**Points d'attention** (modale uniquement) :
- tâches du phasage non terminées et non planifiées avant un fait `LIVRAISON` ou `FIN_RESEAUX` ;
- compagnon sans aucune tâche un jour ouvré ;
- cellule avec compagnons mais sans tâche ;
- `date_prevue` du phasage décalée de plus de 7 jours par rapport au planning.

### 4b. Rédaction — tâche IA `api/_ia/taches/objectifs_semaine.js`

- Elle passe par la route unique `/api/ai` existante. Rôles : `admin`, `conducteur`. Modèle léger (`claude-haiku-4-5`).
- **Entrée** : les faits uniquement, pas le planning brut.
- **Sortie** : JSON `[{ fait_ids[], libelle_groupe, jour, titre, detail }]`.
- **Règles de rédaction**, issues des retours de Loris :
  - le titre énonce le **résultat attendu** en 2 à 5 mots (« Livraison RDC, R+1, R+2 », « Réseaux terminés », « Démarrage du chantier ») ;
  - le détail tient en une phrase courte et **n'énumère pas les ouvrages de la semaine**, sinon le lecteur croit la liste exhaustive. Bon exemple : « Les trois logements terminés et prêts pour la réception jeudi soir. »
- **Interdiction d'inventer** : chaque objectif référence au moins un `fait_id` existant. Sinon la sortie est invalide (contrôle dans `schema_sortie`).
- **Si l'IA est indisponible** (crédit épuisé, erreur) : titres générés par gabarits à partir des faits, et message visible dans la modale : « Rédaction automatique indisponible — objectifs proposés par règles, à relire ». On ne masque jamais l'échec.

## 5. Le PDF

- Nouveau module `src/Renovation/planningHebdoDoc.js`, qui reproduit **exactement** `ref-export-planning-hebdo.html` :
  - bandeau sombre compact avec logo, semaine, dates et pastilles ;
  - « Objectifs de la semaine » en cartes 4 colonnes ;
  - « Planning de la semaine » en tableau avec en-tête sombre arrondi, bande couleur par chantier, pastilles compagnons et durées à droite ;
  - encadré « Remarques », **absent si le champ est vide** ;
  - pied de page Profero.
- Réutiliser les constantes du gabarit commun (`OR`, `HALO_OR`, `HALO_BLEU`, `sectionTitre`) et respecter la règle « aucun dégradé vers le transparent » de `previsionnelDoc.js`.
- **Une seule page** : on garde le calcul d'échelle automatique, mais **pas avec `zoom` CSS**. Constaté en préparant la référence : à faible zoom, Chrome écrase les espaces entre les mots avec la police Barlow (« Protectionsdeszones »).
  - Utiliser plutôt un conteneur de largeur `297mm / échelle` réduit par `transform: scale(échelle)` (origine en haut à gauche).
  - Vérifier sur un PDF réel que les espaces sont intacts.

## 6. Conventions du dépôt à respecter

- Entrée dans `src/Renovation/journalMaj.js`, en langage métier.
- Script `scripts/verif-objectifs-semaine.mjs`, branché dans un workflow. Ses jeux de test portent la mention « exemple issu des tests, données fictives ».
- Pas de nouvelle page : aucun changement dans `src/access.js`.

## 7. Cas de recette — semaine 2026-W42 (données réelles)

Sur la base actuelle, l'analyse de la S42 doit retrouver au minimum les objectifs suivants, validés par Loris :

| Groupe | Jour | Titre |
|---|---|---|
| Tom & Camille (RDC, R+1, R+2) | Jeudi 15 | Livraison RDC, R+1, R+2 |
| Kathleen T2 | Lundi 12 | Démarrage du chantier |
| Fourmond 001 · 101 · 102 | Mardi 13 | Réseaux terminés |
| Kathleen T2 | Jeudi 15 | Réseaux passés |
| Fourmond | Mercredi 14 | Menuiseries extérieures posées |
| Roland | Mercredi 14 | Chantier terminé |
| Montillers Appt 1 | Vendredi 16 | Démarrage du chantier |

## 8. Découpage conseillé (3 demandes de fusion)

1. **Gabarit PDF, modale, table** : nouveau design, champ Remarques, ajout et édition manuelle des objectifs, sauvegarde. Utilisable dès cette étape, sans analyse.
2. **Règles** : module `objectifsSemaine.mjs`, son script de vérification et les points d'attention dans la modale.
3. **Rédaction IA** : tâche `objectifs_semaine`, branchement dans la modale, repli par gabarits.


## Précisions de livraison — 10 octobre 2026

- « Menuiseries extérieures posées » repose sur les tâches de pose/calage/fixation des ouvrages fenêtre et baie, consolidées au dernier jour de pose de l'opération. Les finitions ultérieures ne sont pas présentées comme terminées. Cela permet de retrouver Fourmond mercredi sur les données S42 ; l'ensemble du lot menuiserie inclut aussi des portes intérieures et ne serait pas terminé mercredi.
- Un petit chantier terminé absorbe ses jalons internes (démarrage, réseaux, lot). Une livraison absorbe ses fins de lots. Cela évite de remplir les huit places avec des engagements redondants.
- Les RDV ne constituent pas un démarrage de travaux : Montillers conserve ainsi son démarrage vendredi malgré le RDV Enedis jeudi.
- Une ligne manuelle sans lien au phasage n'est rapprochée par son nom que si ce nom est unique dans le phasage du chantier.
- La sauvegarde compare la version précédemment chargée ; une modification simultanée impose une réouverture, sans écrasement silencieux.
- L'enregistrement sans impression est également disponible. Les alertes et l'indisponibilité IA sont conservées avec la semaine.
- Contrôle réel du 10 octobre : les sept objectifs de recette sont présents dans les huit propositions. L'autre proposition concerne la fin du lot démolition de Kathleen lundi. Deux RDV sont écartés par le plafond.
- Vérification du PDF Chromium sur les données réelles S42 : une page A4 paysage, espaces de mots conservés, aucune ligne d'heures planifiées ni alerte dans le document. Tests d'interface avec ces données, sauvegarde et panne IA simulées. Les scripts automatisés utilisent des données fictives explicitement identifiées.
