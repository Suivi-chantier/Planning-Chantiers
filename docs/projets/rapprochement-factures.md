# Projet : Rapprochement factures fournisseurs — reconnaissance automatique

Fichier préparé le 06/11/2026 par Claude à partir du cahier de Loris
(recopié tel quel dans `docs/projets/rapprochement-factures-annexe.md`).
**Statut : proposition — en attente du feu vert de Loris pour démarrer.**
Règles complètes : `CLAUDE.md`, section « Projets longs : travail en autonomie ».

---

<!-- Sections de Loris : Claude ne les modifie jamais.
     Pré-remplies à partir du cahier du 06/11/2026 ; Loris les valide ou les corrige. -->

## Objectif métier

Quand on scanne une facture fournisseur dans **Rapprochement factures**,
l'application retrouve seule les BL déjà saisis, les passe en « facturé », et
ne demande une action humaine que pour les vrais problèmes : BL manquant,
écart de prix, frais à ventiler.

Aujourd'hui, sur les 4 fournisseurs principaux, 3 ne sont pas ou mal reconnus
(test réel sur 9 factures d'octobre 2026 : Rexel, Partedis ×6, Würth,
Cromology/Zolpan — détail dans l'annexe, §2).

## Règles et invariants

1. On garde le socle existant : scan multi-pages, moteur déterministe
   `rapprocherFacture()`, règles fournisseurs (`regles_numero`,
   `tolerance_ht`, `type_facturation`), validation atomique SQL, gestion des
   écarts, frais et avoirs.
2. **Jamais de liaison automatique ambiguë** : en cas de doute, on propose, on
   ne lie pas.
3. **Plus aucune création automatique de fournisseur** depuis une facture :
   l'utilisateur choisit dans une liste.
4. Lecture d'un fournisseur : n° de TVA du fournisseur d'abord (jamais le nôtre,
   `FR52921024584`), puis alias, puis la reconnaissance actuelle par nom.
5. Contrôle de cohérence obligatoire : somme des BL + frais = Total HT de la
   facture ; sinon, la facture part en revue (ou en lecture IA).
6. Un BL absent de la base reste visible comme « manquant » : pas d'écart
   fantôme, pas de commande créée sans chantier quand un chantier peut être
   proposé.

## Hors périmètre

- Import automatique des factures PDF depuis la boîte mail compta (« plus
  tard »).

## Description des étapes

Dans l'ordre de priorité du cahier (détail et fiches fournisseurs : annexe §3–§4) :

1. **P1** — Reconnaître le fournisseur par n° de TVA puis alias ; corriger la
   lecture des n° Rexel « CL- » et utiliser le n° normalisé déjà prévu en
   base ; Würth : essayer le n° de facture contre les tickets comptoir.
2. **P2** — Partedis : comparer le BL au bon montant et affecter
   automatiquement les frais de facturation ; consignes de lecture par
   fournisseur pour l'IA ; lecture directe du texte des PDF avant l'IA.
3. **P3** — BL manquant : proposer le chantier à partir de la référence
   client ; capter n° de commande et référence client dès le scan du BL ;
   écran « BL en attente de facture ».

## Validation automatique

Règle par défaut de `CLAUDE.md`. Critères d'acceptation : annexe §5
(les 9 factures du test).

---

<!-- Sections de Claude : mises à jour après chaque tâche et avant tout arrêt. -->

## Tâches

Une ligne par tâche, une tâche = une demande de fusion qui fonctionne seule.
Statuts : à faire, en cours, en attente de Loris, en ligne, bloquée, abandonnée.

| N° | Tâche | Statut | Validation | Preuve de réussite | Demande de fusion |
|----|-------|--------|------------|--------------------|-------------------|
| 1 | **Lecture des n° de BL** : corriger la normalisation (Rexel `619454142-01 / 4900` → `619454142-01`, agence en préfixe `4900-000917429`), sans toucher aux autres fournisseurs | à faire | auto (module pur + tests) | tests avec les n° réels de la facture Rexel 961106792 relevés en base : les 8 « CL- » trouvés ; tests existants toujours verts | — |
| 2 | **Fiche fournisseur enrichie** : colonnes `tva_intracom`, `alias`, `consignes_lecture`, `montant_bl` sur `fournisseurs` + valeurs des 4 fournisseurs | à faire | auto (migration additive, vérifiée) | colonnes créées, 4 fournisseurs renseignés, application qui s'ouvre | — |
| 3 | **Reconnaissance du fournisseur** : l'IA lit le n° TVA du fournisseur ; ordre TVA → alias → nom ; suppression de la création automatique (liste déroulante) | à faire | auto | Cromology 28746368 rattachée à ZOLPAN ; Rexel reconnu par TVA ; aucun fournisseur créé | — |
| 4 | **N° normalisé en base** : calculé à l'enregistrement d'un BL, rapprochement fait dessus ; recalcul des BL existants | à faire | **arrêt** pour le recalcul de l'existant (reconstitution de données) — simulation seule d'abord | nombre de BL recalculés annoncé avant ; Rexel 961106792 : 27 BL rapprochés | — |
| 5 | **Würth et factures « une par livraison »** : n° de facture essayé en premier contre les tickets ; n° de livraison et n° de commande extraits et comparés | à faire | auto | Würth 4336131218 trouvé via ticket, ou « manquant » sans écart fantôme | — |
| 6 | **Partedis : bon montant + frais de facturation** : règle « total HT facture », frais de facturation affectés au chantier du BL | à faire | auto ; tableau avant / après si un coût chantier bouge | Partedis 9302110–9302114 sans écart ; 9302109 : 4,20 € sur Trottier | — |
| 7 | **Consignes IA par fournisseur** + champs `reference_client`, `numero_livraison`, `commande_numero` par BL | à faire | auto | les références (FOURMOND/TLV, KATELINE, MONTILLERS) ressortent de la lecture | — |
| 8 | **Lecture directe des PDF texte** (Rexel, Cromology) avec contrôle Σ BL + frais = Total HT, repli IA sinon | à faire | auto | Rexel : 29 BL, 9,90 € de frais, 6 619,44 € ; Cromology : 198,95 € + 1,34 € | — |
| 9 | **Lecture directe des PDF texte** (Partedis, Würth) | à faire | auto | les 7 factures lues sans IA, contrôle de cohérence OK | — |
| 10 | **BL manquant → chantier proposé** à partir de la référence client ; lignes créées depuis la facture | à faire | auto ; tableau avant / après (coûts chantier) | les 2 BL Rexel manquants proposés sur FOURMOND et TROTTIER | — |
| 11 | **Scan BL en amont** : capter n° de commande et référence client ; alerte si le document ressemble à une facture | à faire | auto | un scan Partedis `93xxxxx / 571678` déclenche l'alerte | — |
| 12 | **Écran « BL en attente de facture »** par fournisseur, ancienneté, seuil 45 jours | à faire | **arrêt** (nouvelle page = droits d'accès dans `src/access.js`) | écran visible pour les rôles choisis par Loris | — |
| 13 | **Nettoyage** des n° de facture Partedis saisis comme BL (`9246803/571678`, `9246807/571678`…) | à faire | **arrêt** (réécriture de données, sauvegarde datée) | lignes comptées avant, sauvegarde nommée, comptes vérifiés après | — |

## Journal des décisions

- 06/11/2026 — Cahier reçu hors mode projet. Trop gros pour une session
  (13 demandes de fusion estimées, plusieurs migrations) : transformé en
  fichier projet comme le prévoit `CLAUDE.md`. Vérifié dans le code avant
  découpage : la règle « retirer l'agence » n'accepte que des chiffres avant
  `/agence` (d'où l'échec des « CL- ») ; la colonne `commandes.numero_normalise`
  existe mais n'est ni remplie ni lue ; le moteur sait déjà utiliser un n° de
  facture en 3e recours mais ne le reçoit jamais.
- 06/11/2026 — Le cahier a été recopié tel quel en annexe pour garder les
  fiches fournisseurs et les critères d'acceptation sans les résumer.
- Questions posées à Loris : (1) feu vert pour mener ce projet en autonomie ;
  (2) où trouver les 9 PDF du test (nécessaires aux tâches 8–9 et aux critères
  d'acceptation).

## Comptes rendus

_(aucun pour l'instant)_
