# Portail client Invest — plan d'ouverture (proposition)

01/10/2026. **Décisions de Matthieu (01/10/2026)** : (1) le client ne voit que les tâches que
Profero choisit de montrer ; (2) seulement les documents partagés explicitement ;
(3) lecture seule d'abord.

**Avancement** : étape 1 écrite (migration `20261001190000_portail_client_invest_liaison.sql`,
retour arrière dans `sql/`, banc `scripts/verif-portail-client-invest.mjs`, 17/17
conformes sur PGlite, données fictives). **APPLIQUÉE en production le 01/10/2026** (table vide, hook contrôlé : 15 collaborateurs acceptés, 3 désactivés refusés).

Étape 2 écrite (migration `20261001200000_portail_client_invest_lecture.sql`) : indicateur
`invest_mission_actions.visible_client` (faux par défaut) + 4 vues en lecture seule
(`portail_dossier`, `portail_etapes`, `portail_taches`, `portail_evenements`) qui ne montrent
que des colonnes choisies, pour le seul client de l'appelant. Banc : 25/25 conformes, et
3 casses volontaires de la migration détectées. **NON appliquée en production.**
Reste : documents partagés (table + stockage), écran portail, invitation, et une case
« visible client » dans le CRM pour cocher tâches / événements / dossier.
Sans effet immédiat : la table est vide, aucun client n'est accepté, aucune policy
client n'est ouverte.

## Déjà en place (sécurité)
- Hook d'accès : chaque jeton porte `profero_population` (`collaborateur` ou
  `client_invest`). `acces_client_invest_autorise(user_id)` existe et renvoie
  `false` (chantier 1.1 : à brancher).
- 3a : tout compte connecté non collaborateur est refusé partout (101 tables,
  3 buckets). Un client connecté ne voit donc **rien** tant qu'on ne lui ouvre
  rien, table par table.
- Inscription publique fermée ; relais e-mail et Edge Functions Invest fermés.

## Ce qui manque
1. **Lien compte ↔ client** : `invest_clients` n'a qu'un e-mail, aucune colonne
   vers l'identifiant Auth. Il faut une table dédiée (client ↔ compte Auth,
   statut, date d'invitation, révocation). Jamais par e-mail seul.
2. **Brancher `acces_client_invest_autorise`** sur cette table (fermé par
   défaut).
3. **Policies client, lecture seule d'abord**, sur un périmètre minimal :
   - son dossier (`invest_dossiers`) et la progression des étapes ;
   - ses tâches visibles (`invest_mission_actions`) — **à marquer
     explicitement visibles** (une action interne ne doit jamais fuiter) ;
   - ses événements marqués `visible_client` (colonne déjà existante sur
     `invest_dossier_evenements`) ;
   - ses documents (bucket `invest-documents`, par dossier).
   Chaque policy : `profero_population = 'client_invest'` ET client lié au
   compte. La restrictive 3a est adaptée sur ces seules tables.
4. **Écran portail** séparé du bureau, enregistré à part dans `access.js`.
5. **Invitation** d'un client (par un admin) + révocation immédiate.
6. **Test d'étanchéité** : deux clients fictifs, aucun ne voit l'autre ni le
   bureau (même principe que `verif-collaborateurs-seulement.mjs`).

## Ordre proposé
1. Table de liaison + hook branché (aucun client réel encore).
2. Test d'étanchéité sur le banc.
3. Lecture : dossier + progression.
4. Tâches visibles, puis documents.
5. Invitation du premier client pilote (compte test, puis un vrai client).

## Décisions (prises)
- Un client voit-il les tâches internes, ou seulement celles que Profero
  décide de montrer (recommandé : seulement celles marquées) ?
- Les documents : tous ceux du dossier, ou ceux explicitement partagés
  (recommandé : partagés) ?
- Le client peut-il écrire (déposer un document, répondre) dès le départ
  (recommandé : non, lecture seule d'abord) ?
- Les fonctions d'envoi d'e-mails du bureau restent réservées aux
  collaborateurs (décidé en 3d).
