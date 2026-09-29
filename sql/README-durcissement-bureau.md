# Durcissement « bureau » — deny by default (chantier séparé, NON appliqué)

Document de cadrage. **Aucun SQL de ce document n'a été exécuté.** Il sera
finalisé après lecture du schéma réel de production (dump ou connexion en
lecture seule), puis appliqué comme chantier séparé, hors du code du portail.

## Le défaut structurel

Presque toutes les policies du projet disent :

```sql
for all to authenticated
using (not public.est_ouvrier()) with check (not public.est_ouvrier())
```

et `est_ouvrier()` (`sql/202607_espace_ouvrier_phase0.sql`) vaut :

```sql
coalesce((select role = 'ouvrier' from utilisateurs where email = auth.email()), false)
```

Un compte Auth **absent** de `utilisateurs` donne `NULL`, puis `false` par le
`coalesce` : `not est_ouvrier()` est **vrai**. Tout compte authentifié inconnu
de l'entreprise obtient donc les droits bureau complets. Même chose pour un
compte **désactivé** (`actif = false`) : `est_ouvrier()` ne regarde pas `actif`.

Relevé le 29/09/2026 : `GET /auth/v1/settings` → `"disable_signup": false`.
N'importe qui pouvait créer un compte, le confirmer avec sa propre boîte, et
lire l'ensemble des tables bureau. La fermeture des inscriptions est la mesure
d'urgence ; ce chantier corrige la cause.

## Principe cible

> Un utilisateur authentifié qui n'existe pas dans `utilisateurs`, ou dont le
> compte n'est pas actif, a **zéro droit métier**.

```sql
-- Proposition — à valider sur le schéma réel (type de `role`, casse des emails).
create or replace function public.est_collaborateur()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.utilisateurs u
    where u.email = auth.email()
      and coalesce(u.actif, false) = true
      and u.role is not null
      and u.role <> 'ouvrier'
      -- et, si la liste est figée : and u.role in (<rôles bureau autorisés>)
  );
$$;
revoke execute on function public.est_collaborateur() from public, anon;
grant  execute on function public.est_collaborateur() to authenticated;
```

Puis, table par table : `using (not public.est_ouvrier())` →
`using (public.est_collaborateur())`, idem `with check`.

À trancher lors du chantier :

- **`est_ouvrier()` lui-même** doit-il exiger `actif` ? (un ouvrier désactivé
  garde aujourd'hui ses droits ouvrier). Il appartient à la RLS de l'espace
  ouvrier : à modifier avec ses propres tests.
- **Casse des emails** : `utilisateurs.email` vs `auth.email()` sont comparés
  à l'égalité stricte partout. À vérifier sur les données réelles.
- **Rôles autorisés** : liste fermée (`admin`, `conducteur`, `commercial`,
  `comptable`, `direction`, `super_admin`, `conseiller`, `agent_edl`…) ou
  simple « ≠ ouvrier » ? La liste fermée est plus sûre mais casse un rôle
  ajouté depuis Admin → Accès sans migration.
- **Invest** : ses helpers `invest_est_membre()` / `invest_peut_voir()`
  vérifient déjà `actif` et la branche — ils sont déjà « deny by default ».

## Inventaire — relevé dans les fichiers du dépôt

À **confirmer** contre `pg_policies` : les fichiers ne disent pas ce qui a été
appliqué, ni dans quel ordre, ni ce qui a été créé dans la console.

### A. `bureau_all` — `not est_ouvrier()` (à convertir)

| Source | Tables |
|---|---|
| `202607_espace_ouvrier_phase0.sql` 0C-1 | pointages, data_history, phasages, phasages_history, phasages_backup_premig_v2, commandes, commande_lignes, factures, facture_bl, commandes_detail, commandes_passees, fournisseurs |
| `202607_espace_ouvrier_phase0.sql` 0C-2 | bibliotheque_ratios, chantier_avancement_history, chantier_notes, clotures_journee, planning_chantiers, planning_commandes, planning_mensuel, planning_notes, plans, visites_chantier, profero_categories_ouvrages, profero_cotes, profero_ouvrages_selectionnes, profero_plans, profero_projets, vehicules, sourcing_annonces, sourcing_criteres, sourcing_logs |
| `202607_espace_ouvrier_phase0.sql` 0C-3 | planning_config, planning_cells, rapports, besoins (policies `*_bureau_all`) |
| `202607_controles_groupe.sql` | controles_groupe, reserves |
| `202608_reference_financiere.sql` | chantier_reference_financiere |
| `chantier_snapshots_hebdo.sql` | chantier_snapshots_hebdo |
| `202609_inventaire_equipes.sql`, `202609_materiel_audits.sql` | tables créées par boucle — noms à relever dans `pg_policies` |
| `supabase/migrations/20260828221500_planning_baseline_v1.sql` | tables baseline — idem |
| `202608_invest_etats_des_lieux.sql`, `202608_invest_urbanisme.sql` | invest_etats_des_lieux, invest_urbanisme_dossiers (remplacées par `invest_peut_voir` si le lot 06 Invest est appliqué) |

### B. `using (true)` pour `authenticated` — plus large encore

| Source | Tables | Remarque |
|---|---|---|
| `202606_commandes_nouveau_modele.sql` | commandes, commande_lignes, factures, facture_bl, besoins | `*_sel/_ins/_upd/_del` — probablement écrasées par phase0, à confirmer |
| `vehicules.sql`, `fournisseurs.sql`, `commandes_passees.sql` | idem | idem |
| `202606_commandes_prompt6_besoins.sql` | besoins | `to anon, authenticated using (true)` en SELECT — **anon** |

### C. Policies sans `TO` (donc `PUBLIC`, anon compris) — `public_all`

`data_history`, `bilans_hebdo`, `phasages_history`, `chantier_notes`,
`pointages`, `chantier_avancement_history`, `clotures_journee`. Toutes sauf
**`bilans_hebdo`** figurent dans phase0 0C-1/0C-2, qui les purge. **`bilans_hebdo`
est à vérifier en priorité** : potentiellement lisible et modifiable en anon.

### D. Chemins anon voulus (formulaire public `/rapport`)

| Table | Policy | À conserver ? |
|---|---|---|
| planning_config | `config_anon_sel` SELECT `using (true)` | à restreindre aux clés utiles au formulaire (la table contient toute la configuration, dont la matrice d'accès et des destinataires de mails) |
| planning_cells | `cells_anon_sel` SELECT `using (true)` | à restreindre à la semaine courante / colonnes utiles |
| rapports | `rapports_anon_ins` INSERT `with check (true)` | oui, mais contrôles de forme à ajouter |
| besoins | `besoins_anon_ins` INSERT `with check (true)` | idem |

### E. Storage

| Bucket | Public | Policies | Cible |
|---|---|---|---|
| `photos` | **oui** | lecture publique, liste racine en anon | périmètre Rénovation — URLs devinables ? à évaluer |
| `invest-documents` | non | lecture/écriture/suppression pour **tout** `authenticated` | `invest_est_membre()` (+ `est_collaborateur()`) |
| `chantier-documents` | non | idem, tout `authenticated` | `est_collaborateur()` |

## Requêtes de relevé (lecture seule, à passer avant d'écrire le SQL)

```sql
-- Toutes les policies, avec leur rôle cible et leur condition
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname in ('public', 'storage')
order by schemaname, tablename, cmd;

-- Tables sans RLS
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- Droits accordés à anon / authenticated
select table_name, grantee, string_agg(privilege_type, ', ')
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by 1, 2 order by 1, 2;

-- Comptes Auth sans ligne utilisateurs (voir aussi la section suivante)
select u.id, u.email, u.created_at, u.email_confirmed_at, u.last_sign_in_at
from auth.users u left join public.utilisateurs p on p.email = u.email
where p.email is null order by u.created_at desc;

-- Comptes utilisateurs désactivés mais encore présents dans Auth
select p.email, p.role, u.last_sign_in_at
from public.utilisateurs p join auth.users u on u.email = p.email
where not coalesce(p.actif, false);
```

## Comptes Auth hors `utilisateurs` — traitement individuel

**Aucune suppression automatique.** Pour chaque ligne de la requête ci-dessus :
date de création, confirmation, dernière connexion, domaine de l'email. Puis,
cas par cas : collaborateur à rattacher, compte technique à documenter, ou
compte étranger à bannir (`ban_duration` via l'API admin — réversible — plutôt
que suppression).

## Ordre d'application proposé (le jour venu)

1. Relevé (requêtes ci-dessus) versionné dans `sql/`.
2. `est_collaborateur()` seule — sans effet tant qu'aucune policy ne l'appelle.
3. Contrôle avec une session simulée par rôle (même méthode que
   `README-securite-invest.md` : `set local role authenticated` + claims),
   **y compris un compte absent de `utilisateurs` et un compte inactif** :
   attendu zéro ligne partout.
4. Conversion table par table, en commençant par les tables financières.
5. Storage en dernier (URLs signées de l'EDL, de l'urbanisme et des documents
   chantier à re-tester).
6. Fichier de retour arrière livré avec chaque lot.
