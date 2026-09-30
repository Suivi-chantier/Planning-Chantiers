# Dossier Invest — Tranche 1 (Chantier 1.1)

Migration `supabase/migrations/20260930190000_invest_dossiers_tranche1.sql` —
**non appliquée**. Catalogue : `src/Invest/dossiers/parcours.mjs`. Reprise :
`src/Invest/dossiers/repriseDossiers.mjs` + `scripts/reprise-invest-dossiers-t1.mjs`.
Vérification : `node scripts/verif-invest-dossiers-t1.mjs` (PGlite).

## Ce que la Tranche 1 ajoute

| Objet | Rôle |
|---|---|
| `invest_dossiers` | la mission Profero d'un client ; au plus un dossier non clos par client |
| `invest_dossier_etapes` | les 11 étapes du dossier ; statut piloté par Profero, « balle » obligatoire dès qu'une étape est active |
| `invest_dossier_evenements` | journal écrit par la base, jamais modifiable depuis le navigateur |
| `invest_mission_actions` (+6 colonnes) | `dossier_id`, `etape`, `nature`, `acteur_type`, `responsable_id`, `operation_id` — facultatives ou avec défaut |
| `invest_ouvrir_dossier(client, options)` | dossier + 11 étapes + journal, tout ou rien |
| `invest_convertir_prospect(prospect, client, options)` | client + dossier + 11 étapes + prospect « converti », tout ou rien |
| `invest_rattacher_actions_dossier(dossier)` | rattrapage explicite des tâches sans dossier |
| `invest_controle_dossiers` (vue) | ce que les anciens écrans n'ont pas pu faire |

Un client possédant un dossier **ne peut plus être supprimé** (refus en base,
code 23001) ; le CRM supprime désormais en un seul appel et affiche le refus.

## Chemins historiques non atomiques (jusqu'à leur bascule)

| Écran | Ce qu'il fait | Ce qui manque | Où le voir |
|---|---|---|---|
| Prospection — conversion (`Prospection.jsx` ~L4268) | crée le client, marque le prospect | le dossier et ses étapes | `client_actif_sans_dossier`, `prospect_converti_sans_dossier` |
| CRM — nouveau client (`CRM.jsx` ~L1732) | crée le client | idem | `client_actif_sans_dossier` |
| Structuration — nouveau client (`Structuration.jsx` ~L594) | crée le client | idem | `client_actif_sans_dossier` |
| CRM / Dashboard — nouvelle tâche | crée la tâche | dossier si le client n'en a pas ; étape si `urbanisme` ou clé inconnue | `action_sans_dossier`, `action_etape_a_classer` |

Rattrapage : `select public.invest_ouvrir_dossier('<client>', '{"conseiller_id":"<utilisateur>"}')`
pour un client dont la mission a réellement démarré, puis
`select public.invest_rattacher_actions_dossier('<dossier>')`. Jamais
automatique (D4 : une ligne client ne suffit pas à créer une mission).

## Application (ordre impératif)

1. Relecture et fusion de la PR (CI verte).
2. Migration seule :
   `npx supabase db query --linked -f supabase/migrations/20260930190000_invest_dossiers_tranche1.sql`
   puis `npx supabase migration repair --status applied 20260930190000 --linked`.
   Jamais `supabase db push` (la migration du chantier 05 est en attente).
3. Vérification en lecture seule (tables, fonctions, policies, colonnes).
4. Reprise :
   - export en lecture seule : `node scripts/reprise-invest-dossiers-t1.mjs --requete` ;
   - `node scripts/reprise-invest-dossiers-t1.mjs --export export.json --sortie ./reprise` ;
   - relecture de `rapport-reprise-t1.md` (cas ambigus) ;
   - `npx supabase db query --linked -f ./reprise/reprise-t1.sql` (rejouable).
5. Recette (ci-dessous).

Le front (correction de la suppression) peut être déployé avant ou après la
migration : sans la migration, la suppression se comporte comme aujourd'hui.

## Recette

- CRM : supprimer un client **sans** dossier → supprimé ; **avec** dossier →
  message « Ce client possède un Dossier Invest… », notes et propositions intactes.
- Créer une tâche depuis la fiche client → `dossier_id` et `etape` remplis
  (sauf urbanisme), notification « Retour collaborateur » toujours émise.
- Vue `invest_controle_dossiers` : anomalies attendues seulement.
- Journal : un événement `dossier_cree` et un `reprise_importee` par dossier repris.

## Retour arrière

`sql/202609_invest_dossiers_tranche1_rollback.sql` — supprime dossiers, étapes
et journal (exporter avant si des dossiers ont été saisis), retire les 6
colonnes ajoutées ; tâches, clients, notes et propositions intacts. Puis
`npx supabase migration repair --status reverted 20260930190000 --linked`.
