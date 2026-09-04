# Sécurisation RLS Profero Invest — mode opératoire

Les huit fichiers `202609_invest_securite_*.sql` referment l'accès anonyme aux
tables Profero Invest et font appliquer par la base la matrice de droits qui
n'existait jusqu'ici que dans React.

**Aucun n'a été appliqué.** Ils demandent un accès SQL au projet Supabase, que
l'environnement de développement où ils ont été écrits ne possède pas.

## Pourquoi ce chantier

Mesuré le 4 septembre 2026 avec la seule clé anon — celle qui est embarquée
dans le bundle JavaScript de production, donc publique :

- **huit tables Invest lisibles sans aucune authentification**, dont 123 fiches
  prospects nominatives (nom, prénom, e-mail, téléphone renseignés à 100 %),
  415 comptes rendus d'appels, et la ligne unique qui porte l'intégralité du
  suivi financier ;
- **écriture anonyme ouverte sur ces mêmes tables** — `INSERT` et `UPDATE`
  prouvés par sondes non destructives (clé primaire dupliquée, donc échec
  garanti par violation d'unicité et annulation par atomicité) ;
- la RLS ne distinguait aucun rôle Invest : les deux seules policies
  versionnées disaient `USING (NOT est_ouvrier())`, soit « tout utilisateur
  connecté qui n'est pas ouvrier, sur tout ». Un commercial lisait le suivi
  financier, un `agent_edl` lisait tout le CRM, et un utilisateur Rénovation
  seul lisait tout Invest.

## Ordre d'application

`00` et `01` d'abord, dans cet ordre. Les fichiers `02a` à `06` sont
indépendants entre eux et peuvent être passés séparément.

| # | Fichier | Contenu | Peut s'appliquer seul |
|---|---|---|---|
| 00 | `202609_invest_securite_00_matrice.sql` | `super_admin` → accès complet Invest | oui |
| 01 | `202609_invest_securite_01_helpers.sql` | 3 fonctions `invest_*` | oui, sans aucun effet |
| 02a | `202609_invest_securite_02a_prospect_actions.sql` | `invest_prospect_actions` | après 01 |
| 03 | `202609_invest_securite_03_crm.sql` | clients, notes, propositions, actions, notifications | après 01 |
| 04 | `202609_invest_securite_04_biens.sql` | biens, planning, routine | après 01 |
| 05 | `202609_invest_securite_05_finance.sql` | `invest_suivi_financier` | après 01 |
| 06 | `202609_invest_securite_06_annexes.sql` | structuration, urbanisme, EDL, Drive, sourcing | après 01 |
| 99 | `202609_invest_securite_99_rollback.sql` | retour arrière | — |

Ordre recommandé : **00, 01, puis 05** — le suivi financier d'abord, gain
maximal pour un risque minimal et une régression immédiatement visible —
**puis 02a, 03, 04, 06**.

## `invest_prospects` n'est pas dans la liste

C'est volontaire, et documenté comme dette. 83 de ses 123 lignes arrivent
d'une API Fluidify externe qui n'est **pas hébergée par ce projet** : ni dans
ce dépôt, ni dans son historique, ni sur ses branches, ni parmi les Edge
Functions Supabase, ni parmi les routes `/api/*` de production (55 noms
candidats sondés). Sa clé d'accès est donc inconnue, et fermer la table à
l'aveugle couperait l'acquisition de leads.

Pour lever le blocage : tableau de bord Supabase → Logs → API, filtrer sur
`/rest/v1/invest_prospects` et la méthode `POST`. Le journal donne le rôle de
la clé utilisée, l'IP et le user-agent — donc l'endroit où l'API est
hébergée. Dernières ingestions connues (UTC) : `2026-09-01 10:44:20`,
`2026-08-27 11:51:45`, `2026-08-25 10:30:46`.

- si la clé est **service_role** → fermer la table comme les autres ;
- si la clé est **anon** → basculer d'abord l'API sur une clé serveur, en
  conservant son endpoint et son contrat pour ne rien changer côté Fluidify,
  puis fermer.

## Avant d'appliquer

1. Lire l'état réel des policies — trois requêtes en lecture seule :

```sql
select c.relname, c.relrowsecurity as rls_active
from   pg_class c join pg_namespace n on n.oid = c.relnamespace
where  n.nspname = 'public' and c.relkind = 'r'
  and  (c.relname like 'invest_%' or c.relname like 'sourcing_%')
order  by c.relrowsecurity, c.relname;

select tablename, policyname, roles, cmd, qual, with_check
from   pg_policies
where  schemaname = 'public'
  and  (tablename like 'invest_%' or tablename like 'sourcing_%')
order  by tablename, cmd;

select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type)
from   information_schema.role_table_grants
where  table_schema = 'public' and grantee in ('anon', 'authenticated')
  and  (table_name like 'invest_%' or table_name like 'sourcing_%')
group  by table_name, grantee order by table_name, grantee;
```

2. Relever le type réel de `utilisateurs.branches` : les helpers du fichier 01
   comparent sur la représentation textuelle, faute de pouvoir lire la table.
   C'est documenté dans le fichier, avec la forme resserrée à adopter ensuite.

```sql
select column_name, data_type, udt_name from information_schema.columns
where  table_schema = 'public' and table_name = 'utilisateurs'
  and  column_name in ('branches', 'role', 'actif');

select role, branches, count(*) from public.utilisateurs
where  actif group by 1, 2 order by 1;
```

3. Choisir un créneau creux. L'application est en usage actif : des lignes
   sont écrites tous les jours ouvrés.

## Après chaque fichier

```bash
node scripts/verif-rls-invest.mjs
```

Code de sortie `0` = conforme, `1` = au moins une table Invest encore
accessible sans authentification. Le script tolère `invest_prospects` comme
dette déclarée et le signale à chaque exécution — retirer cette table de
`EXCEPTIONS` le jour où elle sera fermée.

## Valider les droits : observer, jamais déduire

**Porte obligatoire : le fichier `02a` ne s'applique pas avant que les helpers
aient été validés sur un vrai compte Invest.** Un rôle non observé se note
`NON TESTÉ` et ne peut pas être déclaré GO.

Attendus à comparer — ce ne sont pas des résultats :

| Rôle | membre | role | crm | finance | edl |
|---|---|---|---|---|---|
| `admin` | t | admin | t | t | t |
| `super_admin` | t | super_admin | t | t | t |
| `commercial` | t | commercial | t | **f** | **f** |
| `agent_edl` | t | agent_edl | **f** | **f** | **t** |
| Rénovation seul | **f** | NULL | f | f | f |

### La clé `service_role` ne peut pas servir à ce test

Deux raisons, dont la seconde est la plus traître. Elle contourne la RLS, donc
toutes les lectures de tables réussissent. Et sous `service_role`,
`auth.email()` vaut `NULL` : `invest_role_courant()` renvoie `NULL`,
`invest_est_membre()` renvoie `false`, et `invest_peut_voir()` renvoie `false`
pour toute page. On lirait donc « aucun droit » dans les helpers et « tous les
droits » sur les tables. Les deux signaux se contredisent et aucun n'est
valide : ce n'est pas un test trop permissif, c'est un test sans signification.

### Méthode 1 — session réelle

Se connecter à l'application avec le compte à tester, relever son jeton dans
la console du navigateur :

```js
JSON.parse(localStorage.getItem('sb-yooksnzhlffqgpzkcjhl-auth-token')).access_token
```

puis interroger les helpers avec ce jeton — c'est le chemin exact de
l'application : rôle `authenticated`, `auth.email()` renseigné, RLS active.

```bash
TOKEN="eyJ…"     # jeton relevé ci-dessus, valable ~1 h
URL="https://yooksnzhlffqgpzkcjhl.supabase.co"
ANON="eyJ…"      # clé anon de ID.env

for fn in invest_est_membre invest_role_courant; do
  printf "%-22s " "$fn"
  curl -s -X POST "$URL/rest/v1/rpc/$fn" \
    -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -d '{}'; echo
done

for page in dashboard prospection crm sourcing biens simulateur \
            etat_des_lieux urbanisme structuration finance \
            suivi_financier admin; do
  printf "%-18s " "$page"
  curl -s -X POST "$URL/rest/v1/rpc/invest_peut_voir" \
    -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -d "{\"page\":\"$page\"}"; echo
done
```

### Méthode 2 — simulation de session dans l'éditeur SQL

Rigoureuse et sans compte à créer : on prend le rôle `authenticated` et on
injecte les mêmes revendications JWT que PostgREST, donc la RLS s'applique
réellement. Le `rollback` garantit qu'aucune écriture ne subsiste.

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","email":"compte@groupe-profero.com"}';

select public.invest_est_membre()                  as membre,
       public.invest_role_courant()                as role,
       public.invest_peut_voir('crm')              as crm,
       public.invest_peut_voir('suivi_financier')  as finance,
       public.invest_peut_voir('etat_des_lieux')   as edl;

-- et le contrôle qui compte vraiment : la RLS elle-même
select count(*) as biens_visibles  from public.invest_biens;
select count(*) as finance_visible from public.invest_suivi_financier;

rollback;
```

À répéter en changeant la seule adresse e-mail, avec un compte réel de chaque
rôle. Cette méthode observe le comportement effectif des fonctions et des
policies ; elle ne dispense pas des tests fonctionnels dans l'interface.

### Méthode 3 — comptes de test dédiés

Un compte par rôle (`test-commercial@`, `test-agent-edl@`…) créé depuis
Admin → Accès avec la branche Invest, plus un compte Rénovation seul. Plus
long à mettre en place, mais c'est le seul dispositif rejouable à chaque
migration future, et il évite d'emprunter le compte d'un collègue.

### Si `invest_est_membre()` renvoie faux pour un compte Invest

Arrêter. C'est le type réel de `utilisateurs.branches` qui ne se prête pas à
la comparaison textuelle du fichier 01. Inspecter le type, corriger
`invest_est_membre()` et `invest_role_courant()` — et rien d'autre. Ne pas
contourner, ne toucher à aucun élément Rénovation.

## Le test qui compte le plus

Avec un compte `agent_edl` : **créer un état des lieux et rattacher un bien.**

`edlStore.listerBiensPourEDL()` lit `invest_biens`, alors que la matrice
n'accorde à ce rôle que la page `etat_des_lieux`. C'est pourquoi la policy de
`invest_biens` inclut `etat_des_lieux` en lecture — mais pas en écriture. Si
ce test échoue, le sélecteur de bien est cassé.

## Périmètre — ce qui n'est pas touché

Aucun fichier de ce lot ne modifie Profero Rénovation :

- aucune table Rénovation, aucune policy Rénovation ;
- `public.mon_role()` et `public.est_ouvrier()` sont **appelées**, jamais
  redéfinies ni supprimées — elles appartiennent à
  `sql/202607_espace_ouvrier_phase0.sql` et servent à la RLS de l'espace
  ouvrier ;
- `utilisateurs` est lue, jamais modifiée ;
- de `planning_config`, seule la clé `access_pages_invest` est écrite (par
  fusion jsonb, les 31 autres clés restent intactes) ;
- le bucket `photos` n'est pas touché.

## Restes connus, non traités

- **`invest_prospects`** — dette ci-dessus.
- **Bucket `invest-documents`** — ses policies ouvrent la lecture à tout compte
  `authenticated`, sans distinction de rôle ni de branche. À resserrer sur
  `invest_est_membre()` dans un second temps, après avoir vérifié que les URL
  signées de l'EDL et de l'Urbanisme continuent de fonctionner.
- **Bucket `photos`** — laisse lister ses dossiers racine en anon. Périmètre
  Rénovation : signalé, non traité.
- **Variantes historiques de rôles** dans `access_pages_invest` (`Admin`,
  `Super Admin`, `Commercial`, `Direction`, `Conseiller`) — conservées tant
  que les comptes réels n'ont pas été contrôlés. `invest_peut_voir()` les
  résout comme le front, dette de nettoyage à part.
