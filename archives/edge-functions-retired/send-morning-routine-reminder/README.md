# send-morning-routine-reminder — FONCTION RETIRÉE

> ⚠️ **NE PAS REDÉPLOYER SANS CORRIGER L'AUTHENTIFICATION.** Voir « Faille connue »
> plus bas. En l'état, cette fonction est déclenchable par n'importe quel porteur
> d'un JWT valide — y compris la clé `anon`, qui est publique par conception.

Ce dossier est une **archive hors déploiement**. Il est volontairement placé sous
`archives/edge-functions-retired/` et **non** sous `supabase/functions/` : un
`supabase functions deploy` sans nom de fonction ne doit jamais pouvoir le
redéployer par inadvertance.

## Identité de l'objet retiré

| | |
|---|---|
| Nom logique | `send-morning-routine-reminder` |
| **Slug distant constaté** | **`send-morning-routine-reminder-index-ts`** |
| Identifiant | `94b3107a-3675-4c37-8140-0a444ce450f6` |
| Version au retrait | 6 |
| **Configuration distante constatée** | **`verify_jwt = true`** |
| Fichiers | `index.ts` seul — aucun `deno.json`, aucun import map |
| Date du retrait | **17 septembre 2026** |

Le nom logique et le slug **diffèrent** : le slug porte un suffixe `-index-ts`,
probablement hérité d'un déploiement où le nom du fichier a servi de nom de
fonction. Le routage se fait sur le **slug** ; c'est lui qu'il faut employer
dans toute URL.

## Pourquoi ce retrait

Le rappel e-mail n'a **jamais été opérationnel**, depuis sa création :

- **160 exécutions du cron, 160 échecs, 0 réussite**, du 30/06/2026 au 17/09/2026 ;
- l'erreur survenait dans `net.http_post`, **avant** tout appel HTTP : l'URL du job
  contenait des marqueurs de gabarit non substitués (`<PROJECT_REF>`), et les
  caractères `<` `>` sont refusés par `net._encode_url_with_params_array` ;
- l'URL visait en outre `/send-morning-routine-reminder`, c'est-à-dire le **nom**
  et non le **slug** : même corrigée, elle aurait répondu 404 ;
- trois secrets indispensables étaient absents du projet
  (`MORNING_ROUTINE_MAIL_WEBHOOK_URL`, `MAIL_WEBHOOK_URL`, `MAIL_AGENDA_WEBAPP_URL`) :
  la fonction aurait répondu 500 même si elle avait été atteinte ;
- **aucun consommateur** : aucune référence dans le dépôt, 0 appel dans les
  journaux Edge, table `invest_morning_routine_reminders` **vide (0 ligne)**.

À ne pas confondre : la **checklist** Morning Routine du tableau de bord Invest
(`invest_morning_routine_items`, 3 lignes) est une fonctionnalité **vivante** et
n'est pas concernée par ce retrait. Seul le **rappel par e-mail** est supprimé.

## Faille connue — à corriger avant tout redéploiement

```js
const source   = body.source || "manual";
const isManual = source === "manual" || source === "manual_test" || body.force === true;
const cronSecret = Deno.env.get("MORNING_ROUTINE_CRON_SECRET") || "";
if (!isManual && cronSecret && incomingCronSecret !== cronSecret) { /* 401 */ }
```

Trois défauts cumulés :

1. **Un corps vide contourne tout.** `body.source` absent ⇒ `source = "manual"`
   ⇒ `isManual = true` ⇒ le contrôle du secret **et** le garde-fou
   « seulement à 8 h Paris » sont l'un comme l'autre sautés.
2. **Secret absent ⇒ contrôle désactivé.** `MORNING_ROUTINE_CRON_SECRET`
   n'existait pas ; `cronSecret` valait `""` et le `&& cronSecret` court-circuitait
   la comparaison. La seule barrière réelle était `verify_jwt`.
3. **Comparaison non constante.** `incomingCronSecret !== cronSecret` sort au
   premier caractère différent.

Modèle de référence à reprendre : `supabase/functions/progbat-billing-sync-cron/`
— méthode imposée, secret serveur obligatoire, comparaison par condensats
SHA-256, et refus **avant** toute lecture de secret ou tout accès externe.

## Procédure théorique de restauration

Aucune clé ni aucun secret ne figure ci-dessous ; les valeurs sont à poser
depuis le Dashboard, jamais dans un fichier ni dans un commit.

1. **Corriger d'abord la faille** ci-dessus : ne plus laisser `body.source`
   décider de l'authentification, et exiger le secret même en l'absence de
   configuration (échouer fermé, pas ouvert).
2. Copier `index.ts` vers `supabase/functions/send-morning-routine-reminder/`.
3. Poser les secrets manquants (Dashboard → Project Settings → Edge Functions) :
   `MORNING_ROUTINE_CRON_SECRET` (aléatoire, ≥ 32 octets),
   `MORNING_ROUTINE_MAIL_WEBHOOK_URL`, `MORNING_ROUTINE_TO`.
   Poser **la même valeur** de secret cron dans le Vault, sous un nom logique
   dédié, pour que le job puisse la lire sans jamais la stocker en clair.
4. Déployer **en nommant explicitement la fonction** :
   `supabase functions deploy send-morning-routine-reminder --project-ref <PROJECT_REF>`
   avec `verify_jwt = false` si l'authentification repose sur le secret dédié.
   Attention : un nouveau déploiement créera le slug `send-morning-routine-reminder`,
   différent de l'ancien `send-morning-routine-reminder-index-ts`.
5. Recréer le job (voir ci-dessous), puis valider : refus sans en-tête, refus
   avec en-tête faux, appel autorisé, et contrôle de `cron.job_run_details`
   **et** de `net._http_response` **et** des journaux Edge — un `succeeded`
   côté pg_cron ne prouve que la mise en file, pas le résultat HTTP.

## Définition du cron retiré — assainie, marqueurs uniquement

Le job `profero-morning-routine-8h-paris` (jobid 1, cadence `0 6,7 * * *`) portait
exactement ceci. Les `<…>` sont les marqueurs **réellement présents en base** :
ils n'ont jamais été substitués, aucune clé n'a donc jamais été stockée dans
`cron.job`.

```sql
select cron.schedule(
  'profero-morning-routine-8h-paris',
  '0 6,7 * * *',
  $job$
  select net.http_post(
    url := 'https://<PROJECT_REF>.functions.supabase.co/send-morning-routine-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SUPABASE_SERVICE_ROLE_KEY>'
    ),
    body := jsonb_build_object('source', 'cron')
  ) as request_id;
  $job$
);
```

**Ne pas recréer le job sous cette forme.** Outre les marqueurs, elle est
doublement fautive : `Authorization: Bearer <service_role>` n'était là que pour
franchir `verify_jwt`, alors qu'une clé publique aurait suffi — la fonction lit
son propre `SUPABASE_SERVICE_ROLE_KEY` depuis son environnement pour accéder à
la base. Un secret cron dédié, lu depuis le Vault, est le bon modèle.

## Retour arrière du retrait

- **Job** : rejouer le `cron.schedule(...)` ci-dessus le restaure à l'identique
  (il redeviendra tout aussi inopérant — c'est la restauration fidèle d'un objet
  cassé, pas une réparation).
- **Fonction** : redéployer `index.ts` de ce dossier selon la procédure ci-dessus.
  Le slug d'origine `…-index-ts` n'est pas reproductible par un déploiement
  nommé ; toute URL devra viser le nouveau slug.
