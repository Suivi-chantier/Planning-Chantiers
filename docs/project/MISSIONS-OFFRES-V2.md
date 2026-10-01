# Invest V2 — Chantier 9 : Missions Offre 2 / Offre 3

État : **développé, migration non appliquée** (01/10/2026). Spécification
validée par Matthieu le 01/10/2026.

## Définition métier (validée)

- **Offre 2 — Accompagnement à l'investissement** (`type_mission =
  accompagnement_acquisition`) : Projet → Documents → Recherche → Opportunités →
  Financement → Acquisition.
- **Offre 3 — Accompagnement patrimonial global** (`audit_patrimonial`) :
  phase **Patrimoine** (Collecte → Analyse → Stratégie → **Rapport &
  restitution**), puis phase **Investissement** (**Cadrage** facultatif →
  Documents → Recherche → Opportunités → Financement → Acquisition).
  L'Offre 3 contient l'Offre 2.
- Rapport et restitution : **une seule date** (rapport remis et restitué le
  même jour).
- Cadrage après la restitution : possible, pas systématique (fait / non
  nécessaire / à faire).
- Une Offre 2 peut devenir une Offre 3 en cours de mission.
- Honoraires : **forfait de mission**, dû à la signature de la lettre de
  mission ; **honoraires d'accompagnement** = 50 % de la remise obtenue (prix
  affiché − prix d'achat), par acquisition.
- Au 01/10/2026 : aucune Offre 3 signée ; les 24 missions en base sont des
  Offre 2 (valeur juste, aucune correction de données).

## Modèle

Les 11 étapes internes ne changent pas ; un jalon est un regroupement
d'étapes (`src/Invest/dossiers/offres.mjs`, module pur, source unique pour la
fiche Dossier et le CRM V2).

`invest_dossiers` : `restitution_le` (date), `cadrage_statut` (NULL = à faire,
`fait`, `non_necessaire`), `cadrage_le` (date, seulement si fait).

Règles en base :
- restitution et cadrage réservés à l'Offre 3 (un retour en Offre 2 exige de
  les retirer) ;
- le cadrage suit la restitution, sa date n'est pas antérieure ;
- aucune date dans le futur ; mission close = offre, restitution et cadrage en
  lecture seule (déclencheur `invest_offre_regles`, droits de l'appelant).

Journal (types `offre_change`, `restitution_change`, `cadrage_change`) :
« Offre : Offre 2 → Offre 3. », « Rapport patrimonial remis et restitué le
15/09/2026. », « Cadrage du projet fait le 20/09/2026. ». Le forfait et la
lettre de mission sont désormais rédigés en clair (« Forfait de mission : non
renseigné → 3 000 € HT. », « Lettre de mission : à émettre → signée (signée le
01/09/2026). ») au lieu de « Dossier modifié : honoraires_prevus_ht ».

Audit SECURITY DEFINER (invariant CLAUDE.md) : `invest_offre_journal` et
`invest_dossiers_journal` (redéfinie) écrivent **uniquement** dans le journal
via `invest_journaliser`, jamais dans `invest_dossier_etapes` (vérifié par le
cas 67 du banc). `invest_offre_regles` est en security invoker.

## Écran

- Fiche Dossier : parcours par phases et jalons ; les étapes restent
  cliquables dans chaque jalon (panneau 2a inchangé). En Offre 3 sans
  restitution, la phase Investissement s'affiche « pas encore commencée »,
  jamais en retard ; si elle a commencé quand même, une alerte le dit.
- Carte « Mission & honoraires » : offre (passer en Offre 3 / revenir en
  Offre 2), forfait (vide = « non renseigné », jamais 0 €), lettre de mission,
  règle d'accompagnement (sans calcul : il viendra avec les Opérations,
  chantiers 15-16).
- CRM V2 : le jalon affiché suit l'offre (Offre 3 : « Rapport & restitution »,
  « Cadrage »).
- Hors périmètre : suivi des paiements, contenu du rapport (chantiers 12-13),
  documents (chantier 10).

## Application

`npx supabase db query --linked -f supabase/migrations/20261001100000_invest_missions_offres.sql`
puis `npx supabase migration repair --status applied 20261001100000 --linked`,
**avant** la fusion du front. Jamais `db push`.

Retour arrière : `sql/202610_invest_missions_offres_rollback.sql` (supprime
les dates de restitution et de cadrage ; conserve l'offre et le journal).

## Recette prévue (RECETTE-T2A, INV-2026-0023)

1. Passer la mission en Offre 3 → événement « Offre : Offre 2 → Offre 3. ».
2. Enregistrer une restitution datée de demain → refus.
3. Enregistrer la restitution du jour → événement en clair.
4. Cadrage « fait » à une date antérieure à la restitution → refus ; puis
   « non nécessaire ».
5. Revenir en Offre 2 avec restitution → refus.
6. Forfait 3 000 → « Forfait de mission : non renseigné → 3 000 € HT. ».
7. Non-régression : empreintes des autres missions identiques avant / après.

## Vérification

`node scripts/verif-invest-dossiers-t1.mjs` (cas 64 à 68, PostgreSQL embarqué)
et `node scripts/verif-invest-missions-offres.mjs` (module pur, données
fictives).
