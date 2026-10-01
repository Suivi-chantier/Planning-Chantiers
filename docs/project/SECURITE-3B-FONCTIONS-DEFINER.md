# Sécurité — étape 3b : audit des fonctions SECURITY DEFINER

Chantier 22, 01/10/2026. **État : EN PRODUCTION le 01/10/2026, contrôlé en base.**

Audit en lecture seule de la base de production : 47 fonctions SECURITY DEFINER
dans `public`, toutes propriété de postgres (donc elles contournent la
restrictive 3a).

## Résultat

- **38 fonctions sans risque pour un compte client** : soit non exécutables par
  l'API (invest_*, hook d'accès, purges), soit protégées par une garde interne
  (fiche `utilisateurs` active, rôle) : `ouvrier_*`, `conducteur_*`,
  `progbat_devis_exportables`, `mon_profil_espace`, `est_*`, `invest_*`. Un
  compte sans fiche collaborateur reçoit « rien ».
- **Périmètre décidé le 01/10/2026 : Profero Invest uniquement.** La migration
  ne retire que l'accès API à `fn_invest_notify_mission_action_status_change`
  (fonction de déclencheur Invest, inoffensive mais inutile).
- **Constats Rénovation, NON corrigés (hors périmètre, à décider séparément)** :
  `catalogue_materiaux_demande()` sans garde, lisible par anon (bibliothèque de
  matériaux) ; `recompute_commande_completude(uuid)` exécutable par anon, écrit
  `commandes.statut_completude`.

## Application (par Matthieu)

```
npx supabase db query --linked -f supabase/migrations/20261001170000_securite_3b_fonctions_definer.sql
npx supabase migration repair --status applied 20261001170000 --linked
```
Jamais `db push`. Aucun front à déployer. Retour arrière :
`sql/202610_securite_3b_fonctions_definer_rollback.sql` puis `migration repair --status reverted`.

## Contrôle après application

Changer le statut d'une action de mission Invest : la notification arrive toujours.
