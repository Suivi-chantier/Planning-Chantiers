# Schéma Invest — état des lieux

Dix-sept des dix-neuf tables Invest n'ont pas de migration dans ce dépôt : elles
ont été créées directement dans la console Supabase. C'est la cause racine de
deux défauts de code (constat n°14 de l'audit) :

- la conversion prospect → client tente quatre charges utiles de moins en moins
  riches, faute de savoir quelles colonnes existent, et perdait des données en
  silence (`Prospection.jsx`) ;
- le tableau de bord interrogeait huit noms de tables candidats à chaque
  affichage (`Dashboard.jsx`).

## Ce qui a été relevé

`node scripts/introspect-invest.mjs` lit une ligne par table et en déduit les
colonnes. Résultat au 20 août 2026 :

**Tables dont les colonnes sont connues** — invest_prospects (62),
invest_mission_actions (52), invest_action_notifications (14),
invest_structuration_patrimoniale (11), invest_drive_links (12),
invest_planning, invest_suivi_financier (4).

**Tables illisibles avec la clé anon** — leur RLS n'expose rien à un visiteur
non authentifié, ce qui est le comportement voulu : invest_clients,
invest_biens, invest_propositions, invest_notes, invest_morning_routine_items,
invest_etats_des_lieux, invest_urbanisme_dossiers, sourcing_*, utilisateurs.

**Tables qui n'existent pas** — invest_projets (archivée), et les sept
candidates devinées par le tableau de bord : invest_prospection,
invest_crm_prospects, invest_crm_prospection, invest_prospection_contacts,
crm_prospection, crm_prospects, prospects.

## Ce qu'il reste à faire, et qui demande vos accès

Le relevé ci-dessus donne des NOMS de colonnes, pas les types, les contraintes,
les index ni les policies. Et il ne couvre pas les tables protégées par RLS —
dont `invest_clients`, précisément celle qui pose problème à la conversion.

Pour une migration de référence complète :

```bash
supabase login
supabase link --project-ref <ref-du-projet>
supabase db dump --schema public -f sql/schema_invest.sql
```

Une fois ce fichier dans le dépôt, la cascade de charges utiles de
`Prospection.jsx:4268` peut être remplacée par une charge unique et explicite.

## Règle à tenir

Aucune table nouvelle sans migration versionnée dans `sql/`. Une table créée
dans la console est une table que le code devra deviner — et la devinette finit
toujours par perdre des données sans le dire.
