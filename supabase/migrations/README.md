# Migrations Supabase

Ce dossier reflète **exactement** l'historique des migrations de la base de
production (`supabase_migrations.schema_migrations`). Aligné le 22/09/2026.

- **28 fichiers `.sql`**, dont **27** correspondent chacun à une migration
  réellement appliquée : même numéro de version, même nom (vérifié en base par
  Cowork le 26/09/2026, puis le 28/09/2026 pour la 27e).
- **Le 28e n'est pas appliqué** :
  `20260829210000_planning_replanning_apply_rpc_v1.sql` (chantier 05), la RPC
  `apply_planning_replanning_v1`. Cette fonction **n'existe pas en base**, et
  c'est voulu — l'écriture du planning replanifié est une décision séparée, à
  prendre explicitement. Ce fichier **sera renommé avant tout déploiement**, à
  l'étape 3. C'est le **seul** fichier dont la version n'est pas enregistrée en
  base.

20260924130000 appliquée par Cowork le 24/09/2026, contenu identique au fichier.

**Mise à jour du 30/09/2026 : 31 fichiers.** 30 sont appliqués (dont les trois
ci-dessous) ; 1 ne l'est pas : celui du chantier 05 (plus haut). La migration
de la PR #46 (20260930170000) n'est pas encore dans ce dossier.

`20260930190000_invest_dossiers_tranche1.sql` **appliquée le 30/09/2026**
(Chantier 1.1 Tranche 1 : Dossier Invest), seule (`supabase db query --linked -f …`
puis `migration repair`), jamais par `db push` ; la reprise des données est un
script séparé : `docs/project/DOSSIER-INVEST-TRANCHE1.md`.

`20260930150000_utilisateurs_champs_sensibles.sql` **appliquée le 30/09/2026**
: protection des champs sensibles de `utilisateurs` (chantier 1.0, sécurité).
Retour arrière : `sql/202609_utilisateurs_champs_sensibles_rollback.sql`.

`20260930210000_invest_dossiers_tranche2a.sql` — **appliquée en production le
30/09/2026** (Chantier 1.1 Tranche 2a : pilotage du Dossier Invest dans le CRM). Additive et courte : heure réelle du journal et numéro d'ordre
technique (colonne `ordre`, IDENTITY), libellé « balle
personne », événement « reprise confirmée », enchaînements de statut d'étape
contrôlés, motifs obligatoires (« non applicable », réouverture). S'applique
seule, jamais par `db push` : `docs/project/DOSSIER-INVEST-TRANCHE2A.md`.
Retour arrière non destructif : `sql/202609_invest_dossiers_tranche2a_rollback.sql`.

`20260930230000_invest_situation_patrimoniale_2c.sql` — **appliquée en
production le 30/09/2026** (Chantier 1.1 Tranche 2c : foyer et situation
patrimoniale). Additive : 5 tables rattachées au client (personnes, postes
financiers, engagements, actifs patrimoniaux, structures), types d'événements
`collecte_*`. Aucune reprise. S'applique seule, jamais par `db push` :
`docs/project/DOSSIER-INVEST-TRANCHE2C.md`. Retour arrière (destructif pour les
données 2c) : `sql/202609_invest_situation_patrimoniale_2c_rollback.sql`.

`20260930235000_invest_questionnaire_2d.sql` — **appliquée en production le
30/09/2026** (Chantier 1.1 Tranche 2d : questionnaire « Projet & situation »). Additive : colonnes questionnaire_* de invest_dossiers, types
d'événements questionnaire_*, deux compléments aux fonctions 2c. Aucune
reprise. S'applique seule, avant le front, jamais par `db push` :
`docs/project/DOSSIER-INVEST-TRANCHE2D.md`.

`20260930235500_invest_questionnaire_2d1_catalogue.sql` — **appliquée en
production le 30/09/2026** (mini-correctif 2d.1) : refuse une réponse dont la clé n'existe pas dans le
catalogue de la version du questionnaire. La liste des clés
(`invest_questionnaire_cles`) est générée par
`scripts/generer-questionnaire-cles-sql.mjs` depuis `questionnaireDossier.mjs`.
Aucune donnée modifiée. S'applique seule, jamais par `db push`.

`20261001100000_invest_missions_offres.sql` — **NON appliquée** (Invest V2,
chantier 9 : Missions Offre 2 / Offre 3). Additive : colonnes `restitution_le`,
`cadrage_statut`, `cadrage_le` de invest_dossiers (réservées à l'Offre 3),
types d'événements `offre_change`, `restitution_change`, `cadrage_change`,
journal du forfait et de la lettre de mission rédigé en français. Aucune donnée
modifiée. S'applique seule, AVANT le front, jamais par `db push` :
`docs/project/MISSIONS-OFFRES-V2.md`. Retour arrière :
`sql/202610_invest_missions_offres_rollback.sql`.

20260928191112 appliquée le 28/09/2026 depuis une autre session : règle
d'accès de `materiaux_bibliotheque` à effet identique, évaluée une fois par
requête (2,5 s → 17 ms). Le fichier, d'abord préparé sous
`20260928190000_materiaux_bibliotheque_rls_une_verification.sql`, a été renommé
au numéro et au nom enregistrés en base (règle 3), et reprend le SQL enregistré
mot pour mot (drop + create au lieu d'alter : même règle).

## Pourquoi cet alignement

Avant le 22/09/2026, les fichiers portaient des numéros que la base ne
connaissait pas : ils étaient écrits à la main, puis appliqués par un outil qui
leur attribuait un autre horodatage. La base comptait 24 migrations, le dépôt
17 fichiers, et **aucun numéro ne coïncidait**.

Rien n'était cassé — toutes les tables existaient bien. Mais un
`supabase db push` aurait cru que 15 migrations restaient à appliquer et aurait
tenté de les rejouer sur la production.

Deux anomalies ont été corrigées au passage :

- 6 migrations appliquées n'avaient aucun fichier ; elles ont été réécrites
  depuis le SQL conservé en base.
- `progbat_library_category_dispatch` avait été passée **à la main dans
  l'éditeur SQL** : ses 2 tables, 4 index et 2 déclencheurs existaient en
  production sans qu'aucune migration ne les déclare. Elle a été inscrite comme
  appliquée (écriture de comptabilité uniquement, aucun changement de schéma).

## Règles

1. **Ne jamais exécuter de SQL directement dans l'éditeur Supabase.** Toute
   modification de schéma passe par un fichier de ce dossier. C'est ce qui a
   produit la seule anomalie invisible du lot.
2. **Ne jamais lancer `supabase db push` sans vérifier la liste ci-dessus** :
   il déploierait la migration en attente du chantier 05.
3. Après avoir appliqué une migration, **vérifier que le fichier porte bien le
   numéro enregistré en base**. Si l'outil en attribue un autre, renommer le
   fichier pour qu'il corresponde.
4. Aucun workflow CI ni Vercel n'exécute de migration : le déploiement est
   toujours un geste manuel et délibéré.

## Contenu des fichiers

Les fichiers repris du dépôt contiennent le SQL appliqué **plus les commentaires
d'explication** qui les accompagnaient — ils sont donc un peu plus longs que ce
que la base a enregistré, sans différence d'effet. Ceux qui ont été reconstitués
depuis la base reprennent son SQL mot pour mot.
