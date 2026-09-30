# Dossier Invest — Tranche 2a : pilotage dans le CRM (Chantier 1.1)

État : **préparée, non appliquée, non poussée** (30/09/2026).

## Ce que la Tranche 2a ajoute

**Écran (fiche client du CRM)**

- Carte « Dossier Invest », en tête de fiche : référence, statut, conseiller,
  lettre de mission ; ruban des 11 étapes (toutes les étapes actives visibles,
  mention « à confirmer » sur les étapes issues de la reprise) ; ligne
  « Maintenant » (étape, balle, prochaine action, échéance, blocage) ; points à
  vérifier (vue `invest_controle_dossiers`, incohérence de statut client) ;
  sélecteur des dossiers anciens ; suggestions **jamais appliquées** ; journal.
- Panneau latéral par étape : gestes explicites (démarrer, mettre en attente,
  reprendre, bloquer, débloquer, terminer, non applicable, rouvrir, changer la
  balle, prochaine action, échéance, confirmer la reprise), tâches de l'étape,
  journal de l'étape. « Terminer » affiche les tâches encore ouvertes et fait
  choisir : les laisser ouvertes, ou les passer « non concerné » (aucune
  suppression). Un dossier clos s'affiche en lecture seule.
- « Démarrer une mission » : `invest_ouvrir_dossier` (Tranche 1), inchangée.
- Parcours Mission : onglets = les 11 étapes canoniques (+ « À classer » s'il
  reste des tâches sans étape). Les anciens modèles de tâches sont rangés dans
  l'étape qui les accueille (Urbanisme → Acquisition). Toute tâche générée ou
  assignée porte **explicitement** `dossier_id` et `etape` ; sans dossier en
  cours, la création est refusée à l'écran avec un message.
- `invest_clients.etape` / `etape_num` : **lecture seule** dans la fiche
  (« Ancienne étape (historique) »), la liste du CRM (frise : sélecteur et
  « Valider étape » retirés) et le formulaire client. Les colonnes ne sont pas
  supprimées.

**Base (`20260930210000_invest_dossiers_tranche2a.sql`)**

1. `survenu_le = clock_timestamp()` : chaque événement a l'heure réelle de son
   écriture, l'ordre du journal est fiable même dans une seule transaction.
2. « balle personne → Client » quand personne n'avait la balle.
3. Événement `etape_reprise_confirmee` quand `reprise_a_confirmer` passe de
   vrai à faux ; le passage inverse est refusé. Aucune autre modification ne
   touche ce drapeau.
4. Matrice des enchaînements de statut d'étape (identique à
   `src/Invest/dossiers/transitions.mjs`).
5. « Non applicable » exige un commentaire nouveau **au moment du passage**
   (les 2 étapes reprises déjà « non applicable » sans commentaire restent valides).
6. Rouvrir une étape terminée ou non applicable exige un motif.

Les règles 3 à 6 sont dans un déclencheur séparé,
`invest_etapes_regles_pilotage`, **aux droits de l'appelant** : dans une
fonction « security definer », `current_user` vaut toujours le propriétaire et
la dérogation de maintenance s'appliquerait à tout le monde. Elles s'appliquent
aux collaborateurs et à la clé serveur ; seule la maintenance (`postgres`,
`supabase_admin`) y échappe.

Non traité en 2a (volontairement) : statut du dossier (ouvrir/suspendre/clore)
depuis l'écran ; écrans Prospection et Structuration (écrivent encore
`etape` à la création d'un client) ; Dashboard ; `invest_clients.prochaine_action`
(encore lue par le Dashboard jusqu'en 2b).

## Application (ordre impératif)

1. Relecture et fusion de la PR (CI verte).
2. Migration seule :
   `npx supabase db query --linked -f supabase/migrations/20260930210000_invest_dossiers_tranche2a.sql`
   puis `npx supabase migration repair --status applied 20260930210000 --linked`.
   Jamais `supabase db push` (la migration du chantier 05 est en attente).
3. Vérification en lecture seule : défaut `clock_timestamp()`, contrainte de
   type avec `etape_reprise_confirmee`, déclencheur `invest_etapes_regles_pilotage`.
4. Déploiement du front.

Ordre : **migration avant le front**. Le front sans la migration fonctionne,
mais les règles ne seraient contrôlées que par l'écran.

## Recette

Aucun client de recette n'est créé à l'avance.

| Client | Usage | Ce qu'on vérifie |
|---|---|---|
| RECETTE-T1 | Lecture seule | Son dossier INV-2026-0001 est clos : la carte l'affiche en lecture seule, et le panneau d'étape ne propose aucun geste. Le bouton « Démarrer une mission » reste visible, puisqu'aucun dossier n'est en cours : ne pas cliquer. |
| Louison Pelletreau | Lecture seule | INV-2026-0010, actif : 9 étapes terminées, Suivi en cours (balle Profero), 11 étapes « à confirmer », 59 tâches rangées par étape, aucune « à classer ». |
| Raphaël Sanyas | Lecture seule | INV-2026-0009, actif : deux étapes actives (Financement et Acquisition) visibles dans le ruban et dans « Maintenant ». |
| RECETTE-T2A / NE PAS UTILISER | Gestes modifiants | Client technique créé au moment de la recette, en « Prospect ». « Démarrer une mission » : dossier et 11 étapes créés, client passé « Actif ». Puis chaque geste une fois ; « Non applicable », « Rouvrir » et « Bloquer » sans motif → refus ; « Terminer » avec tâches ouvertes → choix proposé ; « Générer étape » et « Tâche collaborateur » → tâche avec dossier et étape ; journal dans l'ordre réel, « balle personne → … » ; statut client inchangé après les gestes. |

Aucun geste sur les dossiers de Louison Pelletreau, Raphaël Sanyas et RECETTE-T1.

**Statut du client.** Seule l'ouverture explicite d'une mission
(`invest_ouvrir_dossier`, ou la conversion d'un prospect) fait passer un client
« Prospect » en « Actif ». Aucun geste d'étape, aucune tâche, aucune balle et
aucune clôture de dossier ne modifie `invest_clients.statut` (vérifié le
30/09/2026 : seules ces deux fonctions écrivent ce statut ; scénario complet
rejoué sur base de test).

## Audit : droits PostgreSQL et contrôle des transitions

**Défaut trouvé puis corrigé avant toute application en production.** Dans la
première version locale de la 2a, les règles 3 à 6 étaient placées dans
`invest_etapes_avant_ecriture`, qui est une fonction `security definer`
appartenant à `postgres`. Dans une telle fonction, `current_user` ne désigne pas
la personne qui agit : c'est le propriétaire de la fonction, donc toujours
`postgres`. Le test « maintenance ? » (`current_user in ('postgres',
'supabase_admin')`) était donc toujours vrai. Tout le monde, collaborateurs
comme clé serveur, était traité comme la maintenance, et aucune règle n'était
appliquée. Les tests 32 à 34 l'ont détecté (refus attendus non obtenus).

**Mécanisme actuel.** Les règles sont dans un déclencheur séparé,
`invest_etapes_regles_pilotage` (`before update`, `security invoker`). Il
s'exécute avec le rôle réel de la requête, après `invest_etapes_avant_ecriture`
(ordre alphabétique des déclencheurs). Seuls `postgres` et `supabase_admin` y
échappent.

| Qui | Comportement |
|---|---|
| `anon` | Aucun droit sur `invest_dossier_etapes` (ni lecture ni écriture ; vérifié en production). La requête est refusée avant d'atteindre les règles. |
| `authenticated` (collaborateur) | Policy `invest_etapes_modification` (accès Invest requis), puis règles appliquées. Test 32 : 30 enchaînements. |
| `service_role` (clé serveur) | Contourne la RLS (`bypassrls`), **pas** les règles : `current_user = service_role`. Test 33. |
| Fonction `security definer` | `current_user` = propriétaire. Une fonction appartenant à `postgres` qui modifierait des étapes **contournerait les règles sans le dire**. Aucune n'existe aujourd'hui (vérifié en production : aucune fonction ne met à jour `invest_dossier_etapes`). |
| API serveur actuelles | Les routes `api/` (IA Invest, cron des échéances) passent par PostgREST avec la clé `service_role` : règles appliquées. Aucune n'écrit dans `invest_dossier_etapes`. Aucune Edge Function ne touche aux dossiers. Aucune connexion directe à la base dans le code. |
| Connexion directe `postgres` | CLI (`supabase db query --linked`), éditeur SQL, scripts de maintenance et de reprise : règles contournées. C'est le seul contournement voulu. |

**Point de vigilance (non corrigé, à arbitrer).** Le contournement est
**implicite** pour toute future fonction `security definer` appartenant à
`postgres`. Un futur traitement serveur légitime peut contourner les règles de
deux façons :

1. **explicitement**, par un script de maintenance exécuté en connexion directe
   `postgres` (comme la reprise de la Tranche 1), relu et journalisé ;
2. **implicitement**, par une fonction `security definer` : à éviter. Si un tel
   besoin apparaît, la fonction devra être `security invoker`, pour rester
   soumise aux règles, ou le contournement devra passer par un rôle dédié
   nommé dans le déclencheur. Un paramètre de session ne convient pas : tout
   rôle peut le positionner.

## Retour arrière

`sql/202609_invest_dossiers_tranche2a_rollback.sql` — **non destructif** :
fonctions du journal rendues à leur texte exact de Tranche 1, déclencheur et
fonctions 2a retirés, défaut `now()` rétabli, événements
`etape_reprise_confirmee` conservés (contrainte Tranche 1 remise en
« not valid »), commentaires et motifs conservés. Puis
`npx supabase migration repair --status reverted 20260930210000 --linked`.

## Vérification

`node scripts/verif-invest-dossiers-t1.mjs` (cas 0 à 31 : Tranche 1, rejoués
avec la 2a appliquée ; cas 32 à 42 : Tranche 2a).
