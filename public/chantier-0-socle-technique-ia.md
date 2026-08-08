# Chantier 0 — Socle technique IA

> Document de référence projet. À fournir à Claude Code comme contexte avant toute tâche.
> **Statut :** à démarrer · **Durée cible :** 3 à 5 semaines · **Prérequis :** aucun

---

## 1. Objectif

Poser les quatre briques transverses sur lesquelles reposeront **toutes** les fonctionnalités IA de l'application, avant d'écrire la moindre fonctionnalité métier.

Ce chantier ne produit aucune valeur visible pour l'utilisateur final. C'est volontaire. Il est réalisé en premier parce que chacune de ses briques est un point de passage obligé : les reconstruire plus tard imposerait de reprendre toutes les fonctionnalités déjà livrées.

**Règle directrice :** à la fin du Chantier 0, ajouter une nouvelle fonction IA doit demander la création d'**un seul fichier** et **aucune modification** de l'infrastructure.

---

## 2. Contexte technique existant

| Élément | État actuel |
|---|---|
| Frontend | React + Vite, déployé sur Vercel |
| Base de données | Supabase (Postgres + Auth + Storage + Realtime) |
| Routes serveur | Vercel Functions (`/api/*`) — déjà utilisées, ex. `cron-encours-fournisseurs` |
| Fonctions serveur | Supabase Edge Functions (`admin-users`, `admin-users-local`) |
| Authentification | Supabase Auth, profil applicatif dans la table `utilisateurs` |
| Rôles | `admin`, `conducteur`, `commercial`, `comptable`, `ouvrier` |
| Branches | `renovation`, `invest` |
| Matrice d'accès | `planning_config.access_pages_<branche>`, chargée par `loadAccessConfig()` |
| Variables d'env front | `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` |

**Décision d'architecture :** les appels IA passent par une **Vercel Function** (`/api/ai`) et non par une Edge Function Supabase.

Justification : les routes `/api/*` sont déjà en place et déployées avec le front (un seul pipeline), la clé API Anthropic n'a pas à être dupliquée dans deux environnements, et les temps d'exécution longs (extraction de document, transcription) sont mieux supportés. Les Edge Functions restent réservées à l'administration des comptes, où elles sont déjà en production.

---

## 3. Brique 1 — Route unique `/api/ai`

### 3.1 Principe

Tout appel à un modèle d'IA, quelle que soit la fonctionnalité appelante, transite par cette route. Aucun composant React n'appelle jamais directement l'API Anthropic, et la clé API n'existe **que** dans les variables d'environnement Vercel côté serveur.

### 3.2 Responsabilités de la route

Dans l'ordre d'exécution :

1. **Authentifier** — vérifier le JWT Supabase transmis par le client, résoudre le profil dans `utilisateurs`, rejeter si `actif = false`
2. **Autoriser** — vérifier que le rôle de l'utilisateur a le droit d'invoquer cette tâche IA (voir 3.4)
3. **Contrôler le quota** — nombre d'appels et coût cumulé sur la période glissante
4. **Charger la tâche** — récupérer la définition de la tâche demandée dans le registre
5. **Construire le prompt** — assembler le prompt système, le contexte métier et l'entrée utilisateur
6. **Appeler le modèle** — avec le modèle et les paramètres définis par la tâche
7. **Valider la sortie** — vérifier le schéma attendu ; en cas d'échec, une relance, puis erreur explicite
8. **Journaliser** — écrire dans `ia_jobs` (voir Brique 2)
9. **Répondre** — payload normalisé au client

### 3.3 Contrat d'interface

Une seule forme de requête et de réponse pour toutes les tâches.

```
POST /api/ai
Authorization: Bearer <supabase_access_token>

{
  "tache":    "extraction_bl",      // identifiant de la tâche dans le registre
  "entree":   { ... },              // payload propre à la tâche
  "contexte": {                     // optionnel, pour la traçabilité
    "chantier_id": "...",
    "branche": "renovation"
  }
}
```

```
// Réponse 200
{
  "ok": true,
  "job_id": "uuid",                 // référence vers ia_jobs
  "resultat": { ... },              // conforme au schéma de sortie de la tâche
  "confiance": 0.87,                // optionnel, si la tâche en produit une
  "meta": { "modele": "...", "duree_ms": 2340, "cout_eur": 0.0032 }
}

// Réponse 4xx / 5xx
{
  "ok": false,
  "job_id": "uuid",                 // le job est loggé même en échec
  "erreur": { "code": "quota_depasse", "message": "..." }
}
```

Codes d'erreur normalisés : `non_authentifie`, `non_autorise`, `quota_depasse`, `tache_inconnue`, `entree_invalide`, `sortie_invalide`, `modele_indisponible`, `erreur_interne`.

### 3.4 Registre des tâches

Chaque fonctionnalité IA est un fichier déclaratif dans `api/_ia/taches/`. Ajouter une fonctionnalité = ajouter un fichier, rien d'autre.

Une définition de tâche expose :

| Champ | Rôle |
|---|---|
| `id` | Identifiant stable, ex. `extraction_bl` |
| `libelle` | Nom lisible, affiché dans les logs et l'admin |
| `roles` | Rôles autorisés à invoquer la tâche |
| `modele` | Modèle à utiliser |
| `schema_entree` | Validation du payload reçu |
| `schema_sortie` | Validation de la réponse du modèle |
| `construire_prompt` | Fonction assemblant le prompt à partir de l'entrée et du contexte |
| `cout_max_eur` | Garde-fou par appel |
| `sensible` | Booléen — si `true`, la sortie ne peut pas être appliquée sans validation humaine |

Un fichier `api/_ia/registre.js` agrège les tâches. La route n'a aucune connaissance des tâches individuelles.

### 3.5 Quotas et garde-fous

- Plafond par utilisateur et par jour, paramétrable dans `planning_config`
- Plafond global mensuel pour l'entreprise, avec alerte à 80 %
- Plafond de coût par appel unitaire, défini par tâche
- Coupe-circuit global : un drapeau dans `planning_config` désactive instantanément toutes les fonctions IA sans redéploiement

Ce dernier point n'est pas optionnel. Il te permet de couper en trente secondes si un comportement inattendu apparaît en production.

### 3.6 Variables d'environnement à créer sur Vercel

| Variable | Portée |
|---|---|
| `ANTHROPIC_API_KEY` | Serveur uniquement — jamais préfixée `VITE_` |
| `SUPABASE_SERVICE_ROLE_KEY` | Serveur uniquement |
| `SUPABASE_URL` | Serveur (doublon non préfixé de `VITE_SUPABASE_URL`) |

⚠️ Toute variable préfixée `VITE_` est embarquée dans le bundle JavaScript et donc **publique**. Ne jamais y placer la clé Anthropic ni la service role key.

---

## 4. Brique 2 — Table `ia_jobs`

### 4.1 Pourquoi

Cette table est l'actif le plus durable du chantier. Elle répond à quatre questions que tu te poseras en permanence :

- Est-ce que ça marche ? (taux de validation sans correction)
- Où est-ce que ça dérape ? (corrections humaines fréquentes sur une tâche donnée)
- Combien ça coûte ? (par tâche, par utilisateur, par mois)
- Que s'est-il passé ? (audit, quand quelqu'un conteste une donnée)

Le **différentiel entre la sortie brute du modèle et la version corrigée par l'humain** est la donnée la plus précieuse. C'est elle qui te dira quel prompt améliorer et quelle tâche est mûre pour être automatisée davantage.

### 4.2 Schéma proposé

```sql
create table ia_jobs (
  id              uuid primary key default gen_random_uuid(),
  cree_le         timestamptz not null default now(),

  -- Qui / quoi
  utilisateur_id  uuid,
  utilisateur_email text,
  role            text,
  branche         text,
  tache           text not null,

  -- Rattachement métier (nullable, pour filtrer les analyses)
  chantier_id     text,
  entite_type     text,          -- 'commande', 'phasage', 'pointage', ...
  entite_id       text,

  -- Contenu
  entree          jsonb,
  sortie_brute    jsonb,         -- ce que le modèle a répondu
  sortie_validee  jsonb,         -- ce que l'humain a validé, après corrections
  corrige         boolean default false,
  valide_par      text,
  valide_le       timestamptz,

  -- Exécution
  statut          text not null, -- 'succes' | 'echec' | 'en_attente_validation' | 'rejete'
  erreur_code     text,
  erreur_message  text,
  modele          text,
  tokens_entree   integer,
  tokens_sortie   integer,
  cout_eur        numeric(10,5),
  duree_ms        integer
);

create index on ia_jobs (tache, cree_le desc);
create index on ia_jobs (chantier_id);
create index on ia_jobs (utilisateur_email, cree_le desc);
create index on ia_jobs (statut) where statut = 'en_attente_validation';
```

### 4.3 Règles

- **Écriture serveur uniquement**, via la service role key. RLS activée avec aucune politique d'écriture côté client.
- **Lecture** : `admin` voit tout, un utilisateur voit ses propres jobs. Politique RLS en lecture à écrire explicitement.
- **Rétention** : purge des `entree` et `sortie_brute` au-delà de 12 mois, conservation des métadonnées (coût, statut, tâche) indéfiniment pour les statistiques.
- **Données personnelles** : ne jamais stocker en clair dans `entree` des coordonnées client complètes si la tâche ne l'exige pas. Prévoir dès maintenant un mécanisme de purge à la demande.

### 4.4 Écran d'administration minimal

À ajouter comme onglet de `PageAdmin` :

- Compteur de jobs et coût cumulé du mois en cours, avec la barre de progression du plafond
- Tableau des tâches : volume, taux d'échec, taux de correction humaine, coût moyen
- Liste des 50 derniers jobs avec accès au détail entrée/sortie
- Interrupteur du coupe-circuit global

Trente minutes de travail, et tu n'es plus aveugle.

---

## 5. Brique 3 — Composant UI « Proposition IA »

### 5.1 Principe d'ergonomie

Une règle unique, appliquée partout sans exception :

> **L'IA pré-remplit. L'humain valide.**

L'utilisateur doit toujours voir, d'un coup d'œil, ce qui vient du modèle et ce qui vient de lui. Une donnée générée qui se fond dans l'interface sans se signaler est le meilleur moyen de détruire la confiance dans l'application le jour où elle se trompe.

### 5.2 États du composant

| État | Affichage |
|---|---|
| `inactif` | Bouton d'appel discret, avec libellé explicite de l'action |
| `chargement` | Indicateur de progression, action annulable |
| `proposition` | Champs pré-remplis en surbrillance, badge « Proposé par l'IA », niveau de confiance si disponible |
| `modifie` | L'utilisateur a corrigé — la surbrillance disparaît champ par champ |
| `valide` | Données intégrées normalement, mention discrète de l'origine |
| `erreur` | Message en langage clair, action de repli manuelle toujours accessible |

### 5.3 Exigences

- **Repli manuel systématique.** Chaque écran utilisant l'IA doit rester utilisable si l'IA est indisponible. Le coupe-circuit ne doit jamais bloquer le travail.
- **Confiance affichée quand elle est calculable**, et seuil visuel : sous un seuil défini par tâche, l'interface signale explicitement qu'une vérification est nécessaire.
- **Traçabilité du refus.** Si l'utilisateur rejette la proposition, on enregistre le rejet dans `ia_jobs` (`statut = 'rejete'`). Un taux de rejet élevé est le signal le plus utile qui soit.
- **Cohérence graphique** avec les composants existants (`ui.jsx`, `mobileUI.jsx`), respect du thème clair/sombre et de l'accent de branche (`getBranchAccent`).
- **Mobile d'abord.** L'essentiel des usages IA à venir (CR vocal, photo de BL) se fera sur téléphone, sur chantier, avec du réseau incertain. Prévoir la reprise après perte de connexion.

### 5.4 Où le placer

`src/ui/PropositionIA.jsx`, à côté des composants transverses existants, avec un hook associé `useTacheIA(tache)` encapsulant l'appel à `/api/ai`, la gestion des états et la remontée de la validation.

---

## 6. Brique 4 — Connecteur MCP en lecture seule

### 6.1 Objectif

Exposer les données de l'application à Claude, pour interrogation en langage naturel. Sert de **banc d'essai** : les questions que tu poseras révéleront quelles automatisations méritent d'être codées en dur dans l'application.

### 6.2 Implémentation

- Route `/api/mcp` sur Vercel, transport Streamable HTTP, SDK `@modelcontextprotocol/sdk`
- Ajout côté Claude via **Customize → Connectors → + → Add custom connector**
- Authentification par jeton dans les *request headers* dans un premier temps ; OAuth plus tard si besoin
- La connexion part de l'infrastructure Anthropic, pas de ton poste : le serveur doit être joignable sur l'internet public. Vercel convient sans configuration supplémentaire.

### 6.3 Outils de la version 1 — lecture seule, sans exception

| Outil | Rôle |
|---|---|
| `get_chantier` | Fiche consolidée : avancement, QCD, budget, heures vendues/consommées, phase du cycle de vie |
| `list_chantiers` | Liste filtrable par statut, phase, indicateur QCD |
| `get_planning` | Affectations d'une semaine : qui, où, quels véhicules |
| `get_heures_salaries` | Pointages agrégés sur une période |
| `get_encours_fournisseurs` | Commandes en attente, montants, ancienneté |
| `get_ecarts` | Prévu vs réel sur main-d'œuvre et matériaux, par lot |
| `search_materiaux` | Recherche dans la bibliothèque matériaux |

**Aucun outil d'écriture dans cette version.** Ils viendront une fois la confiance établie sur les lectures.

### 6.4 Sécurité — point critique

La matrice `ROLE_PAGES` du front **ne s'applique pas** au serveur MCP. Sans réplication explicite, un commercial pourra interroger les états financiers via Claude.

À prévoir :

- Un jeton MCP par utilisateur, stocké haché, révocable depuis `PageAdmin`
- Résolution du rôle à partir du jeton, à chaque appel
- Filtrage des outils exposés **et** des données retournées selon le rôle, réutilisant la logique de `access.js`
- Service role key utilisée côté serveur uniquement, jamais transmise
- Journalisation de chaque appel MCP dans `ia_jobs` avec `tache = 'mcp:<nom_outil>'`

---

## 7. Ordre de réalisation

| # | Étape | Dépend de | Estimation |
|---|---|---|---|
| 1 | Table `ia_jobs` + RLS + index | — | 0,5 j |
| 2 | Route `/api/ai` : auth, autorisation, journalisation | 1 | 1,5 j |
| 3 | Registre de tâches + une tâche de test (`ping`) | 2 | 1 j |
| 4 | Quotas, coupe-circuit, plafonds | 2 | 1 j |
| 5 | Composant `PropositionIA` + hook `useTacheIA` | 3 | 2 j |
| 6 | Onglet admin : suivi des jobs et des coûts | 1 | 0,5 j |
| 7 | Route `/api/mcp` + authentification par jeton | 1 | 1,5 j |
| 8 | Les 7 outils de lecture MCP | 7 | 2 j |
| 9 | Filtrage MCP par rôle + gestion des jetons dans l'admin | 8 | 1 j |

Total indicatif : environ 11 jours-homme, soit 3 à 5 semaines à raison de quelques soirées par semaine.

**Ne pas paralléliser.** Chaque étape valide la précédente.

---

## 8. Critères de recette

Le Chantier 0 est terminé quand **tous** ces points sont vérifiés :

- [ ] Ajouter une nouvelle fonction IA ne demande que la création d'un fichier dans `api/_ia/taches/`
- [ ] Aucune clé secrète n'est présente dans le bundle client (vérifié par recherche dans le build de production)
- [ ] Un appel IA en échec est journalisé dans `ia_jobs` au même titre qu'un succès
- [ ] Le coupe-circuit désactive toutes les fonctions IA sans redéploiement, en moins d'une minute
- [ ] L'écran d'administration affiche le coût du mois en cours et le détail par tâche
- [ ] Le composant `PropositionIA` fonctionne en thème clair et sombre, sur mobile et desktop
- [ ] Un écran utilisant `PropositionIA` reste pleinement utilisable IA désactivée
- [ ] Le connecteur MCP répond aux 7 outils depuis Claude
- [ ] Un compte de test avec le rôle `commercial` ne peut accéder ni aux états financiers ni aux heures des salariés via MCP
- [ ] Chaque appel MCP apparaît dans `ia_jobs`

---

## 9. Hors périmètre

Explicitement **non traité** dans ce chantier, pour éviter la dérive :

- Toute fonctionnalité IA métier (extraction de BL, CR vocal, chiffrage…) — la tâche `ping` suffit à valider le socle
- Les outils MCP en écriture
- L'OAuth pour le connecteur
- Le streaming des réponses
- Le traitement de fichiers volumineux et le stockage des documents sources
- Toute automatisation planifiée (cron IA) — Chantier 3

---

## 10. Points de vigilance

**Ne pas céder à la tentation de la première fonctionnalité.** L'envie de livrer quelque chose de visible va être forte pendant ces trois semaines. C'est précisément le piège : une première fonctionnalité codée sur un socle inachevé devient la dette qu'on ne rembourse jamais.

**Journaliser avant d'optimiser.** La tentation inverse serait de sur-concevoir le registre de tâches. Reste minimal : la table `ia_jobs` te dira ce qu'il faut améliorer, l'anticipation te ferait construire des abstractions inutiles.

**Le coût est à surveiller dès le premier jour.** Sans plafond ni visibilité, une boucle mal écrite peut consommer un budget mensuel en une nuit. C'est pour cela que les quotas sont dans le Chantier 0 et non ajoutés après coup.

**La sécurité du connecteur MCP mérite une relecture attentive.** C'est le seul composant de ce chantier qui expose des données d'entreprise à un service externe. Prends le temps de tester explicitement les accès avec un compte de chaque rôle avant d'ouvrir l'usage au-delà de toi.

---

## Références

- Connecteurs personnalisés Claude : https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- Documentation MCP : https://modelcontextprotocol.io/docs/develop/connect-remote-servers
- API Claude : https://docs.claude.com/en/api/overview
