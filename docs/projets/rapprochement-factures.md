# Projet : Rapprochement factures fournisseurs

Règles complètes : `CLAUDE.md`, section « Projets longs : travail en autonomie ».
Source : cahier de François du 28/11/2026, recopié tel quel en annexe A. Les
sections de François ci-dessous en sont des extraits mot pour mot ; Claude ne
les modifie pas.

---

<!-- Sections de François : Claude ne les modifie jamais. -->

## Objectif métier

> Quand on scanne une facture fournisseur dans **Rapprochement factures**, l'appli
> retrouve seule les BL déjà saisis, les passe en `facture`, et ne demande une
> action humaine que pour les vrais problèmes (BL manquant, écart de prix, frais à
> ventiler).

## Règles et invariants

Repris du cahier (annexe A) :
- « Le socle est bon » : moteur déterministe `rapprocherFacture()`, jamais de liaison automatique ambiguë, validation atomique SQL.
- Frais causés par une livraison → chantier du BL ; frais liés au compte ou à la facture → frais généraux (§6 cas 7).
- Un bon de commande / accusé de réception est un engagement, pas un coût réel ; ses BL le consomment, jamais de double comptage (§6 cas 5).
- Rexel : ne rien changer au montant de référence (« Sous total HT BL » imprimé) (§4 P2).
- Rapprochement flou des références chantier : proposer, ne jamais imposer (§4 P3).

_(À compléter par François si besoin.)_

## Hors périmètre

_(À compléter par François.)_ Le cahier classe « Import automatique des factures PDF depuis la boîte mail compta » en « Plus tard ».

## Description des étapes

Ordre du cahier : §4 par priorité (P1, puis P2, puis P3), et les cas du §6 (P1).

## Validation automatique

_(Vide : règle par défaut de `CLAUDE.md`.)_

---

<!-- Sections de Claude : mises à jour après chaque tâche et avant tout arrêt. -->

## Tâches

Fait cette nuit (27–28/11/2026), hors mode projet, à la demande de François :

| N° | Tâche | Statut | Validation | Preuve de réussite | Demande de fusion |
|----|-------|--------|------------|--------------------|-------------------|
| 0.1 | Normalisation Rexel « CL-<agence>- » / « … / <agence> » (§4 P1, §6 cas 4.3) | en ligne | contrôles verts + tests | 960676175 : 6 faux écarts repris en « rapproche », facture validable | #294 |
| 0.2 | Statut d'un BL = montants seulement ; proposition choisie au même montant = confirmée (§6 cas 4.1–4.2) | en ligne | contrôles verts + migration testée en transaction annulée | plus de « Écart de montant » à 0,00 € | #294 |
| 0.3 | Connexions base saturées : vignettes PDF (§6 hors rapprochement) | en ligne | contrôles verts | cause trouvée (229 miniatures PDF par ouverture de la Saisie commande) | #294 |
| 0.4 | « Saisir ce BL depuis la facture » : lignes réelles, date, n° commande, référence client, chantier proposé (§4 P3) | en ligne | contrôles verts + tests | commande créée avec ses articles | #295, #296 |
| 0.5 | « Compléter avec le PDF du BL » / « depuis la facture », sans doublon | en ligne | idem | lignes remplacées dans la même commande | #295, #296 |
| 0.6 | PDF refusé par l'IA → relu en images ; refus affiché en clair | en ligne | contrôles verts | Partedis 9302114 lisible | #297 |
| 0.7 | Rattacher un BL saisi après la facture | en ligne | contrôles verts + tests | Wurth 4335906658 rattachée | #298 |
| 0.8 | Partedis : montant du BL = Total HT − frais de facturation (§4 P2) | en ligne | contrôles verts + reprise testée | 9302111 : 52,61 = 52,61, frais de port supprimés | #299 |
| 0.9 | BL sans prix (Wurth) : prix repris de la facture | en ligne | contrôles verts + tests | 8172372177 : 33,84 € | #300 |
| 0.10 | Frais de facture en frais généraux, pré-choix, États financiers (§6 cas 7.1, 7.3) | en ligne | accord de François (option B) | essai 9302111 + 4,20 € : validée, 0 coût chantier | #301, #302 |
| 0.11 | Autres noms de fournisseur (alias) ; Cromology = ZOLPAN (§4 P1 partiel) | en ligne | contrôles verts + tests | 28746368 rattachée à ZOLPAN | #303 |

Découpage du reste (proposition, à valider par François) :

| N° | Tâche | Statut | Validation | Preuve de réussite | Demande de fusion |
|----|-------|--------|------------|--------------------|-------------------|
| 1 | Fournisseur reconnu par n° de TVA : extraction `tva_fournisseur`, TVA des 4 fournisseurs, ordre TVA → alias → nom ; plus de création automatique de fournisseur (liste déroulante) (§4 P1) | à faire | migration additive + redéploiement analyse-facture | les 9 factures du test reconnues sans saisie | |
| 2 | Rexel « Notre Réf » = n° de commande ; « Votre commande » = référence client ; n° de commande comparé à `numero_commande_fournisseur` et aux `doc_numero` de forme commande Rexel → appariement automatique si montant égal (§6 cas 1.1) | à faire | contrôles verts + tests sur les 29 n° de 961106792 | 960676175 : 383912 apparié sans confirmation | |
| 3 | Würth : n° de facture essayé contre les tickets ; `numero_livraison` extrait (§4 P1) | à faire | contrôles verts + tests | 4336131218 trouvée si le ticket est en base | |
| 4 | Frais affectés automatiquement par fournisseur (`regles_frais` : P.F.A., Frais facturation, FFVDF → frais généraux ; port → chantier du BL) (§6 cas 7.2) | à faire | migration additive | 960676175, 9302109, 28746368 : frais en frais généraux sans action | |
| 5 | `numero_normalise` rempli à l'enregistrement et utilisé au rapprochement (§4 P1) | à faire | **arrêt** : recalcul de l'existant = reprise de données | 29/29 n° Rexel normalisés | |
| 6 | Accusé de réception reconnu au scan (`doc_type = accuse_reception`, n° → `numero_commande_fournisseur`) ; alerte « ressemble à une facture » (§6 cas 1.3, §4 P3) | à faire | contrôles verts | accusé 000925398 rangé en commande « BL à venir » | |
| 7 | Reprise : commandes dont `doc_numero` est un n° de commande Rexel (4900-000917429, 4900-000915728…) ; n° Partedis 92xxxxx saisis comme BL (§6 cas 1.4, §3) | à faire | **arrêt** : reprise de données | liste avant / après | |
| 8 | Bons de commande consommés par leurs BL : proposition au scan, reliquat au rapprochement (§6 cas 5.1–5.3) | à faire | contrôles verts | 4900-000915728 : reliquat 54,78 € proposé | |
| 9 | Coûts chantier : un bon de commande n'est plus compté en plus de ses BL (§6 cas 5.4) | en attente de François | **arrêt** : chiffres financiers, tableau avant / après | aucun double comptage | |
| 10 | Reprise des 13 bons de commande ouverts (§6 cas 5.5) | à faire | **arrêt** : reprise de données | 13 traités, tableau avant / après | |
| 11 | Commandes multi-BL : regroupement proposé via n° de commande (§6 cas 1.2) | à faire | contrôles verts + tests | MONTILLERS T3 : 5 BL regroupés | |
| 12 | Consignes de lecture par fournisseur injectées dans le prompt (§4 P2) | à faire | redéploiement analyse-facture | — | |
| 13 | Lecture de la couche texte des PDF avant l'IA (Cromology ligne machine, Rexel, Partedis, Würth) avec contrôle Σ BL + frais = Total HT (§4 P2) | à faire | contrôles verts + tests | 9 factures lues sans IA | |
| 14 | Rexel factures comptant 4900681xx traitées en `par_livraison` (§6 cas 2) | à faire | contrôles verts | 490068119 rapprochée | |
| 15 | Écran « BL en attente de facture » par fournisseur, avec ancienneté (§4 P3) | à faire | contrôles verts ; nouvelle page = droits d'accès → **arrêt** | liste à jour, > 45 j signalés | |

## Journal des décisions

- 28/11/2026 — Fichier créé à partir du cahier de François. Les tâches 0.1 à 0.11 ont été faites avant, hors mode projet, à sa demande.
- 28/11/2026 — Alias fournisseur rangés dans `fournisseurs.regles_numero.alias` (tâche 0.11) plutôt qu'une colonne `alias text[]` ; la tâche 1 pourra créer la colonne si François le préfère.
- 28/11/2026 — Frais généraux (option B choisie par François) : bloc d'information dans les États financiers, non ajouté au total mensuel saisi à la main (risque de double comptage).
- 28/11/2026 — Question posée à François (tâche 9) : un bon de commande ouvert compte-t-il dans le coût chantier pour sa partie non livrée, ou pas du tout ?

## Comptes rendus

_(Aucune tâche du découpage commencée.)_

---

## Annexe A — Cahier de François du 28/11/2026 (recopié tel quel)

> Objectif : quand on scanne une facture fournisseur dans **Rapprochement factures**, l'appli retrouve seule les BL déjà saisis, les passe en `facture`, et ne demande une action humaine que pour les vrais problèmes (BL manquant, écart de prix, frais à ventiler).
>
> Ce cahier part de l'existant (`RapprochementFactures.jsx`, `rapprochementFactures.mjs`, Edge Function `analyse-facture`) et d'un **test réel** : 9 factures d'octobre 2026 (Rexel, Partedis ×6, Würth, Cromology/Zolpan) confrontées à la table `commandes`.
>
> **Mise à jour 28/11/2026** : retours du test utilisateur dans l'appli (factures Rexel de septembre/octobre) et comparaison extranet Rexel ↔ boîte compta ↔ appli → voir **§6** (cas à traiter, à compléter au fil des tests).

### 1. Ce qui existe déjà (à garder)

- Scan multi-pages → Edge Function `analyse-facture` (Claude) → JSON `{fournisseur, numero, montant_ht, bls[], frais[]}`.
- Moteur déterministe `rapprocherFacture()` : par n° de BL, puis n° de commande, puis n° de facture ; propositions par montant (±3 j) et regroupements de 2–3 BL ; jamais de liaison automatique ambiguë.
- `fournisseurs.regles_numero`, `tolerance_ht`, `type_facturation` (`recapitulative` / `par_livraison`).
- Validation atomique SQL qui passe les `commandes` en `statut_facturation = 'facture'` + `facture_id`.
- Gestion écarts, frais à affecter à un chantier, avoirs.

**Le socle est bon. Le problème est la reconnaissance : sur les 4 fournisseurs principaux, 3 ne seraient pas (ou mal) reconnus aujourd'hui.**

### 2. Résultat du test sur les vraies factures

| Fournisseur | Facture | BL sur facture | Reconnus auto aujourd'hui | Problème |
|---|---|---|---|---|
| Rexel | 961106792 (31/10, 9 p., 6 619,44 € HT) | 29 | 19 | 8 BL « CL-… » présents en base mais **non reconnus par numéro** (bug de normalisation) ; 2 BL absents de la base |
| Partedis | 9302109 → 9302114 (6 factures) | 1 par facture | numéro OK | **Écart systématique** : le BL saisi = Total HT facture, l'IA compare au SOUS-TOTAL |
| Würth | 4336131218 (29/10, 61,08 € HT) | 1 | 0 | La clé Würth est le **n° de facture = n° de ticket comptoir**, le moteur ne l'essaie jamais |
| Cromology (Zolpan) | 28746368 (31/10, 200,29 € HT) | 1 | 0 | Le nom imprimé est « CROMOLOGY DISTRIBUTION » → **pas reconnu comme ZOLPAN**, l'appli crée un nouveau fournisseur |

BL Rexel absents de la base (à saisir, référence client imprimée sur la facture) :
- `CL-4900-619451058-01` — 23/10 — 1 200,75 € HT — « FOURMOND Chantier n° TLV »
- `CL-4903-619509012-01` — 16/10 — 21,40 € HT — « TROTTIER »

Contrôle Rexel : Σ sous-totaux BL = 6 609,54 € ; total HT = 6 619,44 € → 9,90 € de frais en pied de facture.

### 3. Fiche « comment lire » par fournisseur

#### REXEL — facture récapitulative mensuelle (+ factures comptant à l'unité)
- En-tête : `FACTURE 961106792`, date, n° client `6477761`, échéance, LCR. TVA fournisseur **FR26309304616**.
- Corps : blocs répétés
  - `Votre commande FOURMOND [Chantier n° TLV]` ← **référence chantier saisie au comptoir**
  - `Notre Réf: 4900000917429 du 22/09/2026` ← **n° de commande Rexel** (agence 4900 + n° de commande sur 9 chiffres = `4900-000917429` sur l'extranet et sur l'accusé de réception)
  - `Notre BL n° 000384456 expédié le 02/10/2026`
  - `Agence: REXEL ANGERS` / `REXEL ANGERS BEAUCOUZE`
  - lignes (`0010 REF prix_brut remise prix_net qté U total code_tva`), lignes DEEE sans n° de ligne (à garder dans le BL)
  - `Sous Total HT BL n° 000384456 116,71` ← **montant de référence du BL**
- Deux formats de n° de BL : `000384456` (agence 4900) / `000147645` (agence 4903) **et** `CL-4900-619454142-01` (commandes web / plateforme, suffixe `-01`, `-02` = livraisons partielles d'une même commande).
- **Une commande peut avoir plusieurs BL** (ex. commande `4900-000922180` MONTILLERS T3 → BL `619566072-01/-02/-03`, `960608109-01`, `385852`).
- Le « PORT/BON DE LIV. » est **dans** le sous-total du BL (déjà dans le montant saisi).
- Pied : base / DEEE / total HT / frais / TVA / TTC sur la dernière page.
- En base, les BL sont saisis `384456 / 4900` et `619454142-01 / 4900`.
- **Factures comptant à l'unité** (série `4900681xx`, vues en novembre) : 1 facture = 1 BL, mention « Paiement au comptant. Tient lieu de bon de livraison », même structure de bloc. À traiter comme `par_livraison`.
- **Accusé de réception de commande** (`ACCUSE DE RECEPTION N° 000925398`, PDF `EMP_000925398_4900.PDF`) : ce n'est **pas** un BL. Son numéro est le n° de commande.

#### PARTEDIS — 1 facture = 1 livraison
- En-tête : `Facture 9302110 / 571678 du 31.10.2026` (571678 = notre n° client, pas un n° de BL). TVA **FR57467200515**.
- Ligne BL : `Cde No 18046692 Livraison No 12196097 du 16.10.26 V/ref client : KATELINE`
  - n° BL = `Livraison No`, n° commande = `Cde No`, **référence chantier** = `V/ref client`.
- Lignes + « éco-contribution PMCB » (à garder dans le BL).
- Pied : `SOUS-TOTAL` articles, puis cases Part. frais port / Frais facturation / Energ. / Eco Taxe, puis `TOTAL HORS TAXE`.
- **Constat clé** : dans 5 cas sur 6, le montant du BL saisi en base = `TOTAL HORS TAXE` de la facture (le BL Partedis est valorisé avec énergie/port). Seuls les « Frais facturation » (ex. 4,20 €) n'y sont pas.
- En base, BL saisis `12196097/ 571678` → règle `retirerClient` OK.
- ⚠️ Des lignes `9246803/571678`, `9246807/571678` en base sont des **n° de facture** saisis comme BL (format 92xxxxx) → à nettoyer.
- Partedis envoie aussi **chaque bon d'emporte par mail** à comptabilite@ (« Votre bon », PDF `EMPORTE_<n°BL>_….PDF`, `BON D'EMPORTE12353857/ 571678`, `Réf client : Kateline`).

#### WÜRTH — achat comptoir Proxi Shop, 1 facture par passage
- En-tête : `N° de facture 4336131218`, `N° client 1071124672`. TVA **FR57668502966**.
- `Commande 2283584033`, `Votre n° de cde STOCK`, `Livraison/Date 8173115263/ 29.10.2026`.
- **Le ticket comptoir porte le même n° que la facture (4336…)** : c'est ce n° qui est saisi en base (`doc_type = ticket`). Parfois c'est le bon de livraison `81…` qui est scanné.
- Montant : `Montant net 61,08` (HT).

#### CROMOLOGY DISTRIBUTION (= ZOLPAN / TOLLENS)
- Nom imprimé : « CROMOLOGY DISTRIBUTION CENTRE OUEST ». TVA **FR28306289307**.
- **Ligne machine en tête de PDF** (couche texte) : `#Facture#28746368#31-10-2026#17037178#00100-RCO#30-11-2026#1#200.29#40.06#240.35#EUR#` → n°, date, code client, échéance, HT, TVA, TTC lisibles sans IA.
- Ligne BL : `N° BL : 15805160 - Expédié le 19/10/2026 (ZANS - ANGERS) - N° Cde : 19879680 du 19/10/2026` puis `Réf. de cde client : MONTILLERS`.
- Lignes articles, puis `FFVDF FRAIS DE FACTURATION AFFAIRE VDF 1,34` → **frais**, pas article.
- Pas de sous-total par BL : somme des montants de ligne du BL (168,95 + 30,00 = 198,95 = montant en base ✔).

### 4. Corrections à faire (par priorité)

#### P1 — Identifier le fournisseur par n° de TVA, puis par alias
1. Ajouter à `fournisseurs` : `tva_intracom text`, `alias text[]`.
2. Renseigner :
   - REXEL : `FR26309304616`, alias `{REXEL France}`
   - Partedis : `FR57467200515`
   - WURTH : `FR57668502966`, alias `{Würth France, WURTH PROXI SHOP}`
   - ZOLPAN : `FR28306289307`, alias `{CROMOLOGY, CROMOLOGY DISTRIBUTION, TOLLENS}`
3. Prompt `analyse-facture` : extraire `tva_fournisseur` (le n° TVA **du fournisseur**, pas le nôtre `FR52921024584`).
4. Ordre de reconnaissance : TVA exacte → alias → `matchFournisseur` actuel. **Ne plus créer de fournisseur automatiquement** depuis une facture : proposer une liste déroulante.

#### P1 — Bug normalisation Rexel « CL- »
`normaliserNumero("619454142-01 / 4900", {retirerAgence:true})` renvoie `619454142-01/4900` alors que la facture donne `619454142-01` → pas d'appariement.
- Corriger la regex `retirerAgence` : accepter tirets/lettres avant `/agence` (ex. `/^[\w-]+\/\d{4}$/`).
- Gérer aussi la forme `4900-000917429` (agence en préfixe) vue en base — **attention : cette forme est un n° de commande, pas un n° de BL (voir §6, cas 1)**.
- Mieux : la colonne `commandes.numero_normalise` (+ index) existe déjà (migration `20261015_rapprochement_factures_v2.sql`) mais n'est remplie ni utilisée nulle part : la calculer à l'enregistrement du BL avec les règles du fournisseur, la recalculer pour l'existant, et rapprocher dessus. Tests unitaires avec les 29 n° de la facture Rexel 961106792.

#### P1 — Würth : essayer le n° de facture contre les tickets
- Dans `matchBls`, passer `facture_numero: p.numero` sur chaque livraison (le moteur sait déjà l'utiliser en 3e recours) — ou, pour `type_facturation = par_livraison`, essayer le n° de facture **en premier**.
- Extraire aussi `numero_livraison` (8173115263) et `commande_numero` (2283584033) : les trois clés sont comparées à `doc_numero` et `numero_commande_fournisseur`.

#### P2 — Partedis : comparer au bon montant
- Nouvelle règle fournisseur `montant_bl: "total_ht_facture"` (Partedis) vs `"sous_total_bl"` (défaut).
- Si une facture `par_livraison` ne contient qu'un BL : comparer le BL au **Total HT facture moins les frais de facturation** ; énergie/port/éco-taxe restent dans le BL.
- Les « Frais facturation » restent en `frais` et vont en **frais généraux** (règle §6 cas 7), pas sur le chantier du BL.

#### P2 — Consignes IA par fournisseur
- Ajouter `fournisseurs.consignes_lecture text` (le contenu des fiches §3) et l'injecter dans le prompt quand le fournisseur est pré-identifié (TVA lue dans la couche texte, ou choix manuel).
- Champs supplémentaires par BL : `reference_client` (« FOURMOND Chantier n° TLV », « KATELINE », « MONTILLERS »), `numero_livraison`, `commande_numero`.

#### P2 — Lire la couche texte des PDF avant l'IA
Les factures reçues par mail sont des PDF texte (Rexel est « envoi dématérialisé »). Pour Rexel, Partedis, Würth, Cromology, un parseur déterministe (regex sur le texte du PDF) donne n° BL, sous-totaux et totaux **sans erreur et sans coût IA**. L'IA reste le repli pour les photos ou un fournisseur inconnu.
- Contrôle de cohérence obligatoire : Σ BL + frais = Total HT (sinon → IA ou revue).

#### P3 — BL manquant : pré-remplir le chantier
Quand un BL de la facture n'existe pas en base, utiliser `reference_client` pour proposer le chantier (rapprochement flou sur nom de chantier / client : « KATHLEEN », « FOURMOND », « TROTTIER »…) au lieu de créer une commande avec `chantier_id = null`. Créer les lignes à partir des lignes de la facture (désignation, qté, montant) → le coût arrive directement sur le bon chantier.
- Les références saisies au comptoir sont très variables pour un même chantier : `MONTILLER` / `MONTILLERS` / `MONTILLIERS` / `MONTILLERS T3`, `KATELEEN` / `KATHLEEN` / `Kateline` / `KATHELEEN`, `FOURMOND` / `FOURMONT` / `FOURMOND GAINE`, `TOURBOUTON` / `TOUR BOUTON`. Le rapprochement flou doit tolérer fautes, espaces et suffixes ; proposer, ne jamais imposer.

#### P3 — Côté scan BL (amont)
- Capturer `numero_commande_fournisseur` et `reference_client` dès le scan du BL.
- Alerte si le document scanné ressemble à une facture (ex. Partedis `93xxxxx / 571678`).
- Alerte si le document scanné est un **accusé de réception de commande** (voir §6, cas 1).

#### P3 — Suivi des BL non facturés
Écran « BL en attente de facture » par fournisseur, avec ancienneté. Exemples actuels : 7 lignes Zolpan issues de la migration sans n° ni date ; BL Würth de juillet ; Rexel du 22–24/09 non vus sur la facture d'octobre. Au-delà de 45 jours → à réclamer au fournisseur ou à annuler.

#### Plus tard
Import automatique des factures PDF depuis la boîte mail compta (pièce jointe → rapprochement pré-calculé → il ne reste qu'à valider).

### 5. Critères d'acceptation (avec les 9 factures du test)
- Rexel 961106792 : fournisseur reconnu par TVA ; 27 BL rapprochés automatiquement (19 numérotés + 8 « CL- ») ; 2 BL signalés manquants avec chantier proposé (FOURMOND/TLV, TROTTIER) ; 9,90 € de P.F.A. affectés automatiquement aux frais généraux ; Σ = 6 619,44 €.
- Partedis 9302110–9302114 : rapprochés sans écart ; 9302109 : BL rapproché + 4,20 € de frais de facturation affectés automatiquement aux frais généraux.
- Würth 4336131218 : trouvé via n° de facture si le ticket 4336131218 est en base, sinon signalé manquant (pas d'écart fantôme).
- Cromology 28746368 : rattachée à ZOLPAN (pas de nouveau fournisseur) ; BL 15805160 rapproché (198,95 €) ; FFVDF 1,34 € en frais → frais généraux.
- Rexel 961106792 — **testé le 28/11/2026 dans l'appli : conforme** (27 BL appariés, 2 manquants `CL-4900-619451058-01` et `CL-4903-619509012-01`, P.F.A. 9,90 €, écart 0,00 €).
- Rexel 960676175 (septembre) : BL `000383912` (33,66 €) rapproché **automatiquement** avec la commande saisie `4900-000917429` via « Notre Réf » (voir §6, cas 1).

### 6. Retours du test utilisateur — cas à traiter (journal, à compléter)

> Test lancé le 27–28/11/2026 dans l'appli sur les factures Rexel de septembre (960676175) et octobre (961106792). Chaque nouveau cas rencontré est ajouté ici avant d'être corrigé.

#### Cas 1 — Un accusé de réception de commande saisi à la place du BL (P1)
**Constat.** Facture Rexel 960676175 : `BL n° 000383912 — 33,66 € HT` ressort en **« BL manquant »** ; l'appli propose `4900-000917429 — 33,66 € HT (montant)`.
Ce n'est pas Rexel qui imprime un mauvais n° : `4900-000917429` est le **n° de commande** (accusé de réception transféré par mail le 22/09), saisi en base comme `doc_numero`. Le bloc facture contient les deux :
```
Votre commande : TOUR BOUTON
Notre Réf: 4900000917429 du 22/09/2026
Notre BL n° 000383912 expédié le 22/09/2026
Sous total HT BL 000383912 ........ 33,66
```
La proposition par montant est juste, mais elle demande une confirmation manuelle qui ne devrait pas être nécessaire.

**Corrections.**
1. **Rapprochement :** extraire `Notre Réf` de chaque bloc BL Rexel → `commande_numero` normalisé (`4900000917429` → agence `4900` + commande `917429`). Comparer ce n° :
   - à `commandes.numero_commande_fournisseur`,
   - **et** à `commandes.doc_numero` quand celui-ci a la forme d'un n° de commande Rexel (`^\d{4}-0009\d{5}$` ou `^0009\d{5}$`).
   Égalité n° de commande + montant égal (± tolérance) → **appariement automatique** (badge « Apparié via n° de commande »). Égalité n° de commande mais montant différent → proposition, comme aujourd'hui.
   - ⚠️ Constaté sur 961106792 : l'IA range aujourd'hui « Votre commande » (FOURMOND, KATHLEEN…) dans `commande_numero`. C'est la **référence client** (→ `reference_client`), pas le n° de commande fournisseur ; le vrai n° de commande est « Notre Réf ». À corriger dans le prompt `analyse-facture` / le parseur, sinon l'appariement « via n° de commande » compare des noms de chantier.
2. **Commandes multi-BL :** si une commande saisie par son n° de commande correspond à **plusieurs** BL de la facture, proposer le regroupement (somme des BL = montant saisi) au lieu de « BL manquant » sur chacun.
3. **Au scan (amont) :** reconnaître un accusé de réception (`ACCUSE DE RECEPTION N°`, `Nous accusons réception de votre commande`, PDF `EMP_…`) :
   - ranger le n° dans `numero_commande_fournisseur`, laisser `doc_numero` vide ;
   - `doc_type = 'accuse_reception'`, statut « BL à venir » ;
   - quand le BL ou la facture arrive avec le même n° de commande, compléter la même commande (pas de doublon).
4. **Reprise de l'existant :** lister les `commandes` dont `doc_numero` a la forme d'un n° de commande Rexel et les basculer (n° → `numero_commande_fournisseur`). Au moins : `4900-000917429` (TOUR BOUTON, 33,66 €, = BL 383912) et `4900-000915728` (CHALONNE — commande qui a **2 BL** chez Rexel : `383448` 423,67 € et `619391060-01` 54,78 € → vérifier lequel la ligne représente).

#### Cas 2 — Factures Rexel comptant à l'unité (série 4900681xx)
**Constat.** En novembre, Rexel émet des factures à l'unité, le lendemain de l'achat (`490068119`, `490068122`, `490068127`), « Paiement au comptant. Tient lieu de bon de livraison ». Même structure de bloc que la facture mensuelle (`Votre commande`, `Notre Réf`, `Notre BL n°`, `Sous total HT BL`).
**À faire.** Les traiter comme `par_livraison` (1 facture = 1 BL), avec la même lecture que la mensuelle. Elles serviront aussi de source pour créer le BL s'il manque (cas fréquent : aucun BL papier n'est remis).

#### Cas 3 — BL connus de Rexel mais absents de l'appli (pour mémoire)
Comparaison extranet Rexel (page « Bons de livraison ») ↔ boîte compta ↔ appli au 28/11/2026, sur 53 BL lus : **19 BL absents de l'appli (~5 700 € HT)**, + `CL-4900-619621425-01` (MONTILLER, 1 394,20 €, facture 490068127). Les BL « Retiré » de novembre n'apparaissent dans aucun mail avant la facture mensuelle. Deux BL « Facturé » (`619566072-01` 1 542,11 € et `619566066-01` 32,45 €) n'ont pas de facture dans la boîte compta → à vérifier dans « Mes factures » sur rexel.fr.
Ces cas sont le jeu de test du flux **« BL manquant → création avec chantier proposé »** (§4 P3) à la réception de la facture mensuelle de novembre.

#### Cas 4 — « Écart de montant » affiché alors que les montants sont identiques (P1)
**Constat.** Facture Rexel 960676175 : `000383912` (33,66 = 33,66), `CL-4900-619330811-02` (182,83 = 182,83), `CL-4900-619348240-01`, `CL-4900-619366870-01`, `CL-4900-619380824-01`, `CL-4900-619429149-01` → badge orange **« Écart de montant »** alors que facture = commande au centime.

**Cause (code).** Dans `RapprochementFactures.jsx` :
- `blStatut()` renvoie `"ecart"` **dès que** `mode_rapprochement` vaut `montant`, `numero_ambigu` ou `regroupement`, sans regarder les montants ;
- le choix d'une proposition dans la liste déroulante force aussi `statut: "ecart"`.
Le statut « ecart » sert donc à deux choses différentes : « montants différents » et « appariement à confirmer ». Le libellé affiché est toujours « Écart de montant » → trompeur, et la validation « Valider les correspondances conformes » reste bloquée.

Pourquoi ces BL passent par une proposition : les « CL- » à cause du bug de normalisation (§4 P1 : `619330811-02 / 4900` ≠ `CL-4900-619330811-02`), et `383912` parce que la commande est saisie avec son n° de commande (cas 1).

**Corrections.**
1. Séparer deux statuts : `ecart` (montants différents au-delà de la tolérance) et `a_confirmer` (appariement trouvé autrement que par n° exact, montants égaux). Libellés : « Écart de montant » / « À confirmer — même montant ».
2. Quand l'utilisateur **choisit** une proposition dont le montant est égal (± tolérance), le statut devient `rapproche` (le choix humain vaut confirmation). Garder `mode_rapprochement` (`montant`, `commande`…) pour la traçabilité.
3. Corriger la normalisation « CL- » (§4 P1) et la lecture de « Notre Réf » (cas 1) : ces BL doivent être appariés par numéro, sans proposition.
4. Critère d'acceptation : sur 960676175, plus aucun badge « Écart de montant » quand facture = commande ; les 5 BL « CL- » en « Apparié » directement.

#### Cas 5 — Bon de commande + BL saisis tous les deux → coût compté deux fois ; reliquat de livraison (P1)
**Constat.** Commande Rexel `4900-000915728` (CHALONNE, 14/09/2026) :
- en base, **deux** documents : le **bon de commande** `4900-000915728` (`doc_type = bon_commande`, 478,45 €, 7 lignes, saisi par Loris le 16/09) **et** le **BL** `383448 / 4900` (423,67 €, saisi par François le 16/10) ;
- chez Rexel, la commande a été livrée en **deux BL** le même jour : `383448` (423,67 €, comptoir — le BL indique « quantité commandée 3 / livrée 2 / reste à livrer 1 » sur BIZ301612 et BIZ301613) puis le **reliquat** `CL-4900-619391060-01` (54,78 € = 1 × 33,45 + 1 × 21,33).
- 478,45 = 423,67 + 54,78 : le bon de commande couvre les deux BL. Résultat : **423,67 € comptés deux fois** sur le chantier, et le reliquat ressort « BL manquant » (le bon de commande n'est pas proposé car son montant ≠ 54,78).

**Ampleur.** 13 documents `bon_commande` depuis juillet sont toujours `en_attente_facture` et **aucun** n'a `remplace_par_id` (Partedis, fenetre24, Loxam, Zolpan ×3, Chausson, Amazon ×2, Avosdim, Rexel, Sider, Gefradis — ~6 900 € HT). À contrôler un par un : risque de double comptage dès qu'un BL du même achat a aussi été saisi.

**Règle métier à implémenter.** Un bon de commande / accusé de réception est un **engagement**, pas un coût réel. Quand les BL (ou la facture) de cette commande arrivent, ils **consomment** le bon de commande :
1. Au scan d'un BL : chercher un `bon_commande` ouvert du même fournisseur avec le même n° de commande (ex. BL Rexel : `Commande N° 000915728 / 4900`) ou les mêmes articles ; proposer « Ce BL livre la commande X ».
2. Livraison partielle : le bon de commande garde le **reste à livrer** (lignes commandées − lignes livrées) ; dès qu'il est soldé, `remplace_par_id` / statut `solde` → il sort des coûts chantier et du rapprochement.
3. Au rapprochement : un BL de facture qui correspond au **reste** d'un bon de commande ouvert (même n° de commande dans « Notre Réf », montant = reste) → proposition « reliquat de la commande X ».
4. Coûts chantier : ne compter un `bon_commande` que pour sa partie non encore livrée (ou pas du tout, selon le choix métier) — jamais en plus de ses BL.
5. Reprise : traiter les 13 bons de commande ouverts ; pour `4900-000915728` → le transformer en BL `CL-4900-619391060-01` (54,78 €, 2 lignes) ou le marquer remplacé par `383448` + créer le reliquat.

#### Cas 7 — Frais de facture : chantier ou frais généraux ? (P1)
**Constat.** Facture Rexel 960676175 : ligne « P.F.A. — 9,90 € HT » (participation forfaitaire aux frais, mensuelle). L'écran impose « Affectation manuelle à un chantier présent dans les achats » + motif de 12 caractères : on finit par l'affecter arbitrairement au plus gros chantier, ce qui fausse son coût.

**Règle métier retenue.**
- Frais **causés par une livraison** (port, livraison chantier, emballage, éco-participation sur une livraison) → **chantier du BL** concerné. Chez Rexel ils sont déjà inclus dans le sous-total du BL.
- Frais **liés au compte ou à la facture** (P.F.A. Rexel, « Frais facturation » Partedis, `FFVDF` Zolpan, frais de relance, pénalités, escompte) → **frais généraux**. Ils sont couverts par le coefficient de frais généraux des chiffrages, pas par le coût d'un chantier.

**À faire.**
1. Écran « Frais de facture » : ajouter le choix **« Frais généraux »** dans la liste (pas de motif obligatoire pour ce choix ; motif toujours obligatoire pour une affectation chantier manuelle).
2. Affectation **automatique** par type de frais et par fournisseur : table ou champ `fournisseurs.regles_frais` (ex. `{"P.F.A.": "frais_generaux", "PORT": "chantier_bl", "FRAIS FACTURATION": "frais_generaux", "FFVDF": "frais_generaux"}`), avec repli « frais généraux » pour un libellé inconnu de type facturation/administratif et « à affecter » sinon.
3. Les frais généraux doivent être stockés de façon exploitable (catégorie, fournisseur, mois) pour alimenter la future gestion des frais généraux dans l'appli (voir projet « Frais généraux / import des factures »).
4. Critère d'acceptation : 960676175 → P.F.A. 9,90 € en frais généraux sans action ; Partedis 9302109 → 4,20 € en frais généraux ; Zolpan 28746368 → 1,34 € en frais généraux.

#### Hors rapprochement — à signaler
- 28/11/2026 ~00h : la base Supabase a refusé une connexion (`remaining connection slots are reserved for roles with the SUPERUSER attribute`) → pool de connexions saturé. Vérifier les fonctions qui ouvrent des connexions sans les fermer (Edge Functions, crons) et l'usage du pooler.
