# Inventaire des surfaces accessibles publiquement — 29/09/2026

Inventaire léger (Chantier 1.0), établi depuis le dépôt et une lecture publique
de `GET /auth/v1/settings`. Objectif : ne pas sécuriser deux portes en en
laissant une troisième équivalente ouverte.

**Rappel important** : la clé Supabase anon est dans le bundle JavaScript de
production, donc **publique**. Tout ce qui n'exige « que » la clé anon est
public. Une Edge Function avec `verify_jwt` (défaut) accepte la clé anon, qui
est elle-même un JWT valide : ce n'est pas une authentification.

Échelle : 🔴 critique · 🟠 élevé · 🟡 moyen · 🟢 faible / conforme.

## 1. Routes Vercel (`api/`) — 10 fonctions exposées

| Route | Méthode | Authentification | Appelant attendu | Données / action | Risque | Correction |
|---|---|---|---|---|---|---|
| `/api/ai` | POST | JWT vérifié (`getUser`) + portée par rôle | collaborateur | IA, lecture Invest via outils filtrés | 🟢 | — |
| `/api/send-email` | POST | **1.0** : serveur / collaborateur / compte rendu | front, crons | envoi d'emails Resend | 🔴 → 🟢 en strict | **Faite (1.0)**. ⚠ En mode `observer`, la route reste un relais ouvert : l'observation doit être courte |
| `/api/cron-dispatcher` | GET | `CRON_SECRET`, **fermée par défaut (1.0)** | GitHub Actions | lance les crons (emails, écritures `planning_config`) | 🟢 | Faite (1.0) |
| `/api/cron-encours-fournisseurs` | GET | idem | GitHub Actions | email encours | 🟢 | Faite (1.0) |
| `/api/cron-snapshot-avancement` | GET | idem | GitHub Actions | écrit des snapshots | 🟢 | Faite (1.0) |
| `/api/cron-snapshot-hebdo` | GET | idem | GitHub Actions | écrit des snapshots | 🟢 | Faite (1.0) |
| `/api/generate-docx` | POST | **aucune** | BilanSemaine | génère un .docx ; **appelle Anthropic** si `notesLibres` | 🟡 coût | Exiger un JWT collaborateur |
| `/api/generate-cr-client-docx` | POST | **aucune** | aucun appelant dans `src/` | .docx ; **récupère côté serveur toute URL d'image fournie** (SSRF) | 🟡 | JWT + n'accepter que les URLs Supabase Storage / data: — ou supprimer si inutilisée |
| `/api/generate-info-client-docx` | POST | **aucune** | PageInfoClient | idem (SSRF) | 🟡 | idem |
| `/api/generate-visite-docx` | POST | **aucune** | VisiteChantier | idem (SSRF) | 🟡 | idem |
| ~~`/api/gmail-draft`~~ | — | — | — | **supprimée (1.0)** : aucun appelant, consommait des crédits Anthropic sans authentification | — | Faite |

## 2. Edge Functions Supabase

| Fonction | Dans le dépôt | Authentification | Données / action | Risque | Correction |
|---|---|---|---|---|---|
| `admin-users-local` | oui | JWT + `utilisateurs.role = admin` actif | crée / modifie des comptes | 🟢 | — |
| `analyse-commande` | oui | clé anon suffit | appelle Anthropic | 🟡 coût | exiger JWT collaborateur |
| `analyse-facture` | oui | clé anon suffit | appelle Anthropic | 🟡 coût | idem |
| `list-team-calendar-events` | oui | **clé anon suffit** ; les emails d'agenda viennent du corps de la requête | **lit les agendas Google de l'équipe** (compte og@) | 🟠 données | exiger JWT collaborateur + liste d'agendas côté serveur |
| `admin-users` | **non** | inconnue | invitations, reset mot de passe | ❓ | récupérer le code |
| `send-mission-email` | **non** | inconnue | **envoie des emails Gmail depuis og@groupe-profero.com** | ❓ potentiellement 🔴 (second relais) | **récupérer le code en priorité** |
| `notify-new-prospect` | **non** | inconnue | notification prospect | ❓ | récupérer |
| `sourcing-analyse-url` | **non** | inconnue | analyse d'une URL (fetch serveur ? IA ?) | ❓ | récupérer |
| `create-mission-calendar-event` | **non** | inconnue | écrit dans Google Agenda | ❓ | récupérer |

Récupération (sans modification) :
`npx supabase functions download <nom> --project-ref yooksnzhlffqgpzkcjhl`.

## 3. Supabase Auth

| Surface | État | Risque | Correction |
|---|---|---|---|
| Inscription publique (`disable_signup`) | **`false` au 29/09/2026** — inscriptions ouvertes, confirmation email exigée (contournable avec sa propre boîte) | 🔴 : tout compte créé obtient les droits bureau (`not est_ouvrier()`) | Désactiver « Allow new users to sign up » — action manuelle |
| Utilisateurs anonymes | désactivés | 🟢 | — |
| Fournisseurs OAuth | aucun | 🟢 | — |

## 4. Base via PostgREST (clé anon publique)

| Surface | Accès anon | Risque | Correction |
|---|---|---|---|
| Tables Invest | fermées — `scripts/verif-rls-invest.mjs` « Conforme » au 29/09/2026 | 🟢 | — |
| `invest_prospects` | **lecture et écriture anon** (dette déclarée, API Fluidify) | 🟠 | voir `sql/README-securite-invest.md` |
| `planning_config` | SELECT anon `using (true)` : **toute** la configuration (matrice d'accès, destinataires de mails, états des crons) | 🟡 | restreindre aux clés du formulaire `/rapport` |
| `planning_cells` | SELECT anon | 🟡 | restreindre |
| `rapports`, `besoins` | INSERT anon `with check (true)` | 🟡 (formulaire public voulu) | contrôles de forme |
| `bilans_hebdo` | policy `public_all` sans `TO` — **possiblement anon** | ❓ | vérifier `pg_policies` |
| Toutes les tables bureau | tout **authenticated** non-ouvrier, y compris un compte inconnu de `utilisateurs` | 🔴 tant que les inscriptions sont ouvertes | `sql/README-durcissement-bureau.md` |

## 5. Storage

| Bucket | Accès | Risque | Correction |
|---|---|---|---|
| `photos` | **public** ; liste des dossiers racine en anon | 🟡 (Rénovation) | évaluer si des photos sensibles y figurent |
| `invest-documents` | privé ; lecture/écriture pour tout `authenticated` | 🟠 avec inscriptions ouvertes | `invest_est_membre()` |
| `chantier-documents` | privé ; tout `authenticated` | 🟠 idem | `est_collaborateur()` |

## 6. Pages publiques

| Page | Accès | Risque | Remarque |
|---|---|---|---|
| `/rapport` | public, voulu (lien quotidien aux ouvriers) | 🟡 | envoie désormais uniquement vers la liste blanche interne |
| `/` (connexion) | public | 🟢 | — |

## Priorités qui en découlent

1. Fermer les inscriptions Supabase (manuel, immédiat).
2. Passer `/api/send-email` en strict après les 5 jours d'observation.
3. Récupérer et versionner les 5 Edge Functions absentes — `send-mission-email`
   en premier (second canal d'envoi, contrat inconnu).
4. `list-team-calendar-events` : exiger un collaborateur authentifié.
5. Routes `generate-*` et Edge Functions `analyse-*` : exiger un JWT
   collaborateur ; limiter les URLs d'images aux sources Profero.
6. Durcissement bureau (deny by default) — chantier séparé.
