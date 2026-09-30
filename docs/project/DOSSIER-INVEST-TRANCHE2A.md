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

**RECETTE-T1 (gestes réversibles et destructifs).** Son dossier INV-2026-0001
est clos : la carte l'affiche en lecture seule. « Démarrer une mission » crée
un nouveau dossier de recette. Le client restant « Inactif », la carte doit
afficher l'incohérence de statut (jamais corrigée automatiquement). Puis, sur ce
dossier : chaque geste une fois ; « Non applicable » et « Rouvrir » sans motif
→ refus ; « Bloquer » sans motif → refus ; « Terminer » avec tâches ouvertes →
choix proposé ; « Générer étape » et « Tâche collaborateur » → tâche avec
dossier et étape ; journal dans l'ordre réel, « balle personne → … ».
Clôture du dossier de recette ensuite (2a n'a pas de bouton pour cela) :
mise à jour de `invest_dossiers.statut = 'clos'` avec `motif_cloture`, en
collaborateur, comme en Tranche 1 — à décider au moment de la recette.

**Louison Pelletreau (lecture seule).** INV-2026-0010, actif : ruban avec 9
étapes terminées et Suivi en cours (balle Profero), 11 étapes « à confirmer »,
59 tâches rangées par étape, aucune « à classer ». Ne cliquer aucun geste.

**Raphaël Sanyas (lecture seule).** INV-2026-0009, actif : deux étapes actives
(Financement et Acquisition, en cours) visibles dans le ruban et dans
« Maintenant ». Ne cliquer aucun geste.

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
