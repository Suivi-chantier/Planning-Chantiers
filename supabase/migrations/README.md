# Migrations Supabase

Ce dossier reflète **exactement** l'historique des migrations de la base de
production (`supabase_migrations.schema_migrations`). Aligné le 22/09/2026.

- **25 fichiers** correspondent chacun à une migration réellement appliquée :
  même numéro de version, même nom.
- **1 fichier est volontairement en attente** :
  `20260829210000_planning_replanning_apply_rpc_v1.sql` (chantier 05). La
  fonction `apply_planning_replanning_v1` **n'existe pas en base**, et c'est
  voulu — l'écriture du planning replanifié est une décision séparée, à prendre
  explicitement. C'est le **seul** fichier dont la version n'est pas enregistrée
  en base.

**Ajout du 24/09/2026, en attente de relecture puis d'application :**
`20260924130000_data_history_planning_cells_bibliotheque.sql` (historique du
planning et de la bibliothèque). Une fois appliqué, renommer le fichier au
numéro que la base lui aura attribué (règle 3) et retirer ce paragraphe.

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
