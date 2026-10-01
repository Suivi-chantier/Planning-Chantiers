# Sécurité — étape 3c (périmètre Profero Invest uniquement)

01/10/2026. **État : EN PRODUCTION le 01/10/2026, contrôlé en base.**

Périmètre décidé par Matthieu : seul Profero Invest est touché.

- `invest_dashboard_action_links` : lisible ET modifiable sans compte (clé anon
  publique). Table vide en production, aucune référence dans le front.
  La migration `20261001180000` ferme l'accès anonyme ; les comptes connectés
  gardent le leur.
- **Hors périmètre, non traité** (Rénovation) : lecture anonyme de
  `bilans_hebdo`, `cr_photos`, `planning_cells`, bucket `photos` ; écriture
  anonyme de `besoins`, `bilans_hebdo`, `cr_photos`, `rapports`, bucket `photos`.

Application : `npx supabase db query --linked -f supabase/migrations/20261001180000_securite_3c_invest_action_links.sql`
puis `npx supabase migration repair --status applied 20261001180000 --linked`.
Jamais `db push`. Retour arrière : `sql/202610_securite_3c_invest_action_links_rollback.sql`.
