# Sécurité — étape 3a : « réservé aux collaborateurs » (deny by default)

Chantier 22 (sécurité avant ouverture clients), TRANSVERSE. Principe validé par
Matthieu le 01/10/2026. Migration
`supabase/migrations/20261001150000_profero_collaborateurs_seulement.sql`.

**État (01/10/2026)** : EN PRODUCTION depuis 10:57:19 UTC.
- 10:46:55 : première application ; 10:48:47 : retour arrière par précaution
  (aucun écart : un ouvrier, réponses identiques). État d'avant vérifié.
- 10:57:19 : réapplication par Matthieu. Contrôle structurel conforme
  (37 migrations, 102 policies restrictives, 0 table non couverte, 162
  policies métier md5 e0bbbb27… identiques, fonction = fichier).
- Journaux 10:57 → 11:07 : 38 requêtes d'un administrateur, toutes 200, et 6
  requêtes serveur, toutes 200 ; aucune erreur PostgreSQL. Les 17 requêtes
  refaites à l'identique renvoient le même nombre de lignes qu'à 10:30
  (prospects 132, clients 24, biens 91, propositions 14, notifications 78,
  tâches 300, missions en cours 19, étapes 264, utilisateurs 20…). Fiche
  client ouverte après application : 0 ligne de situation patrimoniale, 0
  note, 0 tâche, 3 événements, 11 étapes = valeurs de la base.
- Profils observés : administrateur (cette fenêtre), ouvrier (fenêtre du
  premier essai). Non encore observés en production : commercial, comptable,
  agent EDL (couverts par le banc, 18/18).

## Pourquoi

Les policies existantes disent ce que peut faire *tel* collaborateur, pas si
l'appelant *est* un collaborateur. Avant le portail client, tout compte
connecté doit être refusé par défaut, sauf collaborateur actif.

Mesure sur une réplique de la structure de production (données fictives) : un
compte connecté sans fiche collaborateur (futur client, compte désactivé)
atteignait **au moins 12 tables** en lecture et 11 en écriture, dont
`cr_comptes_rendus`, `cr_observations`, `cr_photos`, `bilans_hebdo`,
`ia_jobs`, `invest_events`, `invest_morning_routine*`,
`invest_projets_archive`, `invest_dashboard_action_links` et les fichiers des
3 buckets. Correction d'une première estimation : les 54 policies Rénovation
« `NOT est_ouvrier()` » ne s'ouvrent **pas** à un compte sans fiche
(`mon_role()` nul → condition nulle → refus).

## Ce que fait la migration

- `public.est_collaborateur_actif()` — condition **positive** : l'adresse du
  jeton correspond à une fiche `utilisateurs` active sans doublon inactif
  (`acces_collaborateur_autorise`, même règle que le hook d'accès) **et** le
  jeton n'est pas étiqueté `client_invest`. « Non client » ne suffit jamais.
  SECURITY DEFINER sans paramètre : lit `utilisateurs` sans RLS (pas de
  récursion), ne renseigne que l'appelant (aucun nouveau chemin d'accès),
  n'écrit rien. Exécutable par `authenticated` seulement.
- Policy **RESTRICTIVE** `profero_collaborateurs_seulement` (FOR ALL TO
  authenticated) sur les **101 tables** de `public`, et sur `storage.objects`
  pour les buckets `chantier-documents`, `invest-documents`, `photos`.
  Restrictive = ET avec les policies existantes, qui ne sont pas touchées.
- Garde-fous : la migration échoue sans rien laisser si une table de `public`
  ou un bucket n'est pas couvert, ou si une table n'a pas la RLS.

## Ce qui ne change pas

- Collaborateurs actifs : droits **strictement identiques** (vérifié table par
  table, lecture / création / modification / suppression, pour admin,
  commercial, comptable, agent EDL, ouvrier responsable, ouvrier).
- anon : identique. Ouvertures anonymes à traiter en **3c** : lecture
  `bilans_hebdo`, `cr_photos`, `invest_dashboard_action_links`,
  `planning_cells`, bucket `photos` ; écriture `besoins`, `bilans_hebdo`,
  `cr_photos`, `invest_dashboard_action_links`, `rapports`, bucket `photos`.
- service_role (Edge Functions, n8n/Fluidify, crons) : ignore la RLS.
- Fonctions SECURITY DEFINER (propriétaire postgres, BYPASSRLS) : inchangées,
  à auditer en **3b**.

## Règle pour la suite

Toute nouvelle table de `public` et tout nouveau bucket doivent recevoir la
policy `profero_collaborateurs_seulement` (CLAUDE.md). Le portail client
rouvrira, table par table, ce dont il a besoin, avec une policy dédiée aux
clients et une adaptation explicite de la restrictive sur ces seules tables.

## Application

```
npx supabase db query --linked -f supabase/migrations/20261001150000_profero_collaborateurs_seulement.sql
npx supabase migration repair --status applied 20261001150000 --linked
```
Jamais `db push`. Aucun front à déployer.

Retour arrière (rétablit exactement l'état d'avant) :
`npx supabase db query --linked -f sql/202610_profero_collaborateurs_seulement_rollback.sql`
puis `npx supabase migration repair --status reverted 20261001150000 --linked`.

## Contrôle après application

1. 102 policies restrictives, 162 policies métier inchangées (empreinte).
2. Journaux API : aucun 401/403 nouveau pour un collaborateur ; aucune
   requête `authenticated` passée de 200 à vide de façon suspecte.
3. Connexion admin + un collaborateur Rénovation + un ouvrier.

## Vérification

`node scripts/verif-collaborateurs-seulement.mjs` : réplique de la structure
de production (`scripts/fixtures/catalogue-prod-20261001.json`, catalogue
PostgreSQL extrait en lecture seule, aucune ligne de données), comparaison
avant / après pour chaque persona et chaque table.
