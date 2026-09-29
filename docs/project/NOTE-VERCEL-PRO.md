# Note — passage de Vercel Hobby à Vercel Pro

Sources : documentation Vercel consultée le 29/09/2026
(`/docs/plans/hobby`, `/docs/limits`, `/docs/functions/runtimes`). Tarifs en
USD, hors taxes, susceptibles d'évoluer : à revérifier au moment de décider.

## Situation actuelle

- Projet sans framework serveur : **chaque fichier de `api/` = une fonction**.
- Hobby : **12 fonctions maximum par déploiement**. Au-delà, le déploiement
  échoue.
- Après le Chantier 1.0 : **10 fonctions** (suppression de `gmail-draft.js`).
  Avec `api/portail.js` : 11/12. Une seule place de marge.
- Crons : pilotés par GitHub Actions (`.github/workflows/`), indépendants du
  plan.

## Ce que Pro change

| Sujet | Hobby | Pro | Intérêt pour Profero |
|---|---|---|---|
| **Usage commercial** | **interdit** : « non-commercial, personal use only » | autorisé | L'usage actuel (outil d'entreprise) sort déjà du cadre Hobby ; un portail client l'accentue. **C'est le point principal.** |
| Fonctions par déploiement | 12 | illimité | Le portail et les chantiers suivants n'ont plus à regrouper artificiellement leurs routes |
| Journaux d'exécution | **1 heure** | 1 jour | Diagnostic d'incident, suivi de la phase d'observation email, audit du portail |
| Règles WAF personnalisées | 3 | 40 | Limitation de débit sur le code OTP du portail, blocage d'abus |
| Blocage d'IP | 3 | 100 | idem |
| Durée max d'une fonction | 300 s | 300 s par défaut, jusqu'à 800 s | sans objet aujourd'hui |
| Domaines par projet | 50 | illimité | futur `espace.profero-invest.fr` |
| Maîtrise des dépenses | — | plafonds configurables | éviter une surprise de facture |
| Support email | — | oui | — |
| Collaboration | compte personnel | équipe, rôles (Owner, Member, Billing, Viewer) | accès contrôlé au projet |
| Dépôt Git d'une organisation | non | oui | si le dépôt passe dans une organisation GitHub |

## Coût

- **20 $ par siège développeur et par mois** ; sièges « Viewer » gratuits.
- Un crédit d'usage mensuel est inclus ; l'usage au-delà est facturé à la
  demande (bande passante, invocations, CPU…). Au volume actuel de
  l'application (usage interne + premiers clients), le crédit devrait couvrir
  l'essentiel : **à confirmer sur la page d'usage après un mois**.
- Estimation : **20 à 40 $/mois** pour 1 à 2 sièges développeur.
- Option protection par mot de passe des déploiements : 20 $/mois par projet —
  non nécessaire.

## Conséquences techniques de la migration

- **Aucune modification de code.**
- Le projet passe dans une équipe Vercel ; les variables d'environnement, les
  domaines et l'historique des déploiements suivent le projet.
- Les workflows GitHub Actions appellent `planning-chantiers.vercel.app` : URL
  inchangée tant que le projet garde son nom.
- Un essai Pro gratuit existe (avec limites) : il permet de valider la
  migration avant paiement.

## Recommandation

Passer en Pro **avant la mise en production du portail client** — pour la
conformité d'usage d'abord, pour les journaux et le WAF ensuite. La décision
peut attendre la création de `api/portail.js`, qui tient encore dans le plan
Hobby (11/12).
