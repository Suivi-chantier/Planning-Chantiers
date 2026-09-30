# Dossier Invest — Tranche 2c : Foyer & situation patrimoniale (Chantier 1.1)

État : **développée en local, non poussée, migration non appliquée** (30/09/2026).

## Modèle

Le foyer = `invest_clients` (pas de table foyer). Cinq tables rattachées au
client, réutilisables d'un dossier à l'autre :

| Table | Contenu |
|---|---|
| `invest_personnes` | personnes du foyer ; au plus un principal et un conjoint actifs |
| `invest_postes_financiers` | revenus et charges (flux : périodicité obligatoire), actifs financiers (stock : sans périodicité) ; base du revenu obligatoire |
| `invest_engagements` | crédits et engagements ; crédit lié à un bien par `asset_id` |
| `invest_actifs_patrimoniaux` | patrimoine DÉJÀ détenu (≠ `invest_biens`, les biens recherchés) |
| `invest_structures` | SCI, holdings… ; associés incomplets acceptés (avertissement à l'écran) |

Colonnes communes : source (client / profero / reprise), auteur collaborateur
et futur auteur client (identifiant Auth), dates, vérification
(non vérifiée / vérifiée / à corriger), archivage, dossier de contexte.

Règles en base :
- écriture seulement si le client a un Dossier Invest en cours ; dossier clos = lecture seule ;
- modifier une donnée vérifiée la repasse « non vérifiée » ; seul un collaborateur vérifie ;
  « à corriger » exige un commentaire ; pas de suppression (archivage) ;
- références (personne, bien, structure, co-emprunteurs, associés) toujours du même foyer ;
- journal du dossier en cours : `collecte_ajout`, `collecte_modification` (champs), `collecte_verification`.

L'ancien écran Structuration (`invest_structuration_patrimoniale`) est intact ;
aucune reprise.

## Application

`npx supabase db query --linked -f supabase/migrations/20260930230000_invest_situation_patrimoniale_2c.sql`
puis `npx supabase migration repair --status applied 20260930230000 --linked`.
Jamais `db push`. Migration avant le front : sans elle, la carte affiche
« pas encore installée ».

## Vérification

`node scripts/verif-invest-dossiers-t1.mjs` (cas 45 à 52).
