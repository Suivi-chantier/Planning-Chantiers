# Annexe — cahier « Rapprochement factures fournisseurs » (texte de Loris, 06/11/2026)

> Recopie fidèle du cahier transmis par Loris. Référence pour le projet
> `docs/projets/rapprochement-factures.md`. Claude ne modifie pas ce fichier.

## 2. Résultat du test sur les vraies factures

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

## 3. Fiche « comment lire » par fournisseur

### REXEL — facture récapitulative mensuelle
- En-tête : `FACTURE 961106792`, date, n° client `6477761`, échéance, LCR. TVA fournisseur **FR26309304616**.
- Corps : blocs répétés
  - `Notre BL n° 000384456 expédié le 02/10/2026`
  - `Votre commande FOURMOND [Chantier n° TLV]` ← référence chantier saisie au comptoir
  - `Agence: REXEL ANGERS` / `REXEL ANGERS BEAUCOUZE`
  - lignes (`0010 REF prix_brut remise prix_net qté U total code_tva`), lignes DEEE sans n° de ligne (à garder dans le BL)
  - `Sous Total HT BL n° 000384456 116,71` ← montant de référence du BL
- Deux formats de n° de BL : `000384456` (agence 4900) / `000147645` (agence 4903) **et** `CL-4900-619454142-01` (commandes web / plateforme, suffixe `-01`, `-02` = livraisons partielles d'une même commande).
- Le « PORT/BON DE LIV. » est **dans** le sous-total du BL (déjà dans le montant saisi).
- Pied : base / DEEE / total HT / frais / TVA / TTC sur la dernière page.
- En base, les BL sont saisis `384456 / 4900` et `619454142-01 / 4900`.

### PARTEDIS — 1 facture = 1 livraison
- En-tête : `Facture 9302110 / 571678 du 31.10.2026` (571678 = notre n° client, pas un n° de BL). TVA **FR57467200515**.
- Ligne BL : `Cde No 18046692 Livraison No 12196097 du 16.10.26 V/ref client : KATELINE`
  - n° BL = `Livraison No`, n° commande = `Cde No`, référence chantier = `V/ref client`.
- Lignes + « éco-contribution PMCB » (à garder dans le BL).
- Pied : `SOUS-TOTAL` articles, puis cases Part. frais port / Frais facturation / Energ. / Eco Taxe, puis `TOTAL HORS TAXE`.
- Constat clé : dans 5 cas sur 6, le montant du BL saisi en base = `TOTAL HORS TAXE` de la facture (le BL Partedis est valorisé avec énergie/port). Seuls les « Frais facturation » (ex. 4,20 €) n'y sont pas.
- En base, BL saisis `12196097/ 571678` → règle `retirerClient` OK.
- ⚠️ Des lignes `9246803/571678`, `9246807/571678` en base sont des n° de facture saisis comme BL (format 92xxxxx) → à nettoyer.

### WÜRTH — achat comptoir Proxi Shop, 1 facture par passage
- En-tête : `N° de facture 4336131218`, `N° client 1071124672`. TVA **FR57668502966**.
- `Commande 2283584033`, `Votre n° de cde STOCK`, `Livraison/Date 8173115263/ 29.10.2026`.
- Le ticket comptoir porte le même n° que la facture (4336…) : c'est ce n° qui est saisi en base (`doc_type = ticket`). Parfois c'est le bon de livraison `81…` qui est scanné.
- Montant : `Montant net 61,08` (HT).

### CROMOLOGY DISTRIBUTION (= ZOLPAN / TOLLENS)
- Nom imprimé : « CROMOLOGY DISTRIBUTION CENTRE OUEST ». TVA **FR28306289307**.
- Ligne machine en tête de PDF (couche texte) : `#Facture#28746368#31-10-2026#17037178#00100-RCO#30-11-2026#1#200.29#40.06#240.35#EUR#` → n°, date, code client, échéance, HT, TVA, TTC lisibles sans IA.
- Ligne BL : `N° BL : 15805160 - Expédié le 19/10/2026 (ZANS - ANGERS) - N° Cde : 19879680 du 19/10/2026` puis `Réf. de cde client : MONTILLERS`.
- Lignes articles, puis `FFVDF FRAIS DE FACTURATION AFFAIRE VDF 1,34` → frais, pas article.
- Pas de sous-total par BL : somme des montants de ligne du BL (168,95 + 30,00 = 198,95 = montant en base ✔).

## 4. Corrections demandées (par priorité)

- **P1** — Identifier le fournisseur par n° de TVA (`fournisseurs.tva_intracom`), puis par alias (`fournisseurs.alias`), puis `matchFournisseur` actuel. Prompt : extraire `tva_fournisseur` (pas le nôtre `FR52921024584`). Ne plus créer de fournisseur automatiquement : liste déroulante. Valeurs : REXEL `FR26309304616` alias `{REXEL France}` ; Partedis `FR57467200515` ; WURTH `FR57668502966` alias `{Würth France, WURTH PROXI SHOP}` ; ZOLPAN `FR28306289307` alias `{CROMOLOGY, CROMOLOGY DISTRIBUTION, TOLLENS}`.
- **P1** — Bug normalisation Rexel « CL- » (`619454142-01 / 4900` → doit donner `619454142-01`), forme `4900-000917429` (agence en préfixe), remplir et utiliser `commandes.numero_normalise`, tests avec les 29 n° de la facture Rexel 961106792.
- **P1** — Würth : essayer le n° de facture contre les tickets (en premier pour `par_livraison`), extraire aussi `numero_livraison` et `commande_numero`.
- **P2** — Partedis : règle `montant_bl: "total_ht_facture"` ; facture `par_livraison` à 1 BL comparée au Total HT moins frais de facturation ; frais de facturation affectés automatiquement au chantier du BL.
- **P2** — `fournisseurs.consignes_lecture` injecté dans le prompt ; champs BL `reference_client`, `numero_livraison`, `commande_numero`.
- **P2** — Lire la couche texte des PDF avant l'IA (parseur déterministe Rexel, Partedis, Würth, Cromology) ; contrôle Σ BL + frais = Total HT, sinon IA ou revue.
- **P3** — BL manquant : proposer le chantier via `reference_client`, créer les lignes depuis la facture.
- **P3** — Scan BL : capturer `numero_commande_fournisseur` et `reference_client` ; alerte si le document ressemble à une facture.
- **P3** — Écran « BL en attente de facture » par fournisseur, ancienneté, seuil 45 jours.
- **Plus tard** — Import automatique des factures PDF depuis la boîte mail compta.

## 5. Critères d'acceptation (9 factures du test)
- Rexel 961106792 : fournisseur reconnu par TVA ; 27 BL rapprochés automatiquement (19 numérotés + 8 « CL- ») ; 2 BL signalés manquants avec chantier proposé (FOURMOND/TLV, TROTTIER) ; 9,90 € de frais à ventiler ; Σ = 6 619,44 €.
- Partedis 9302110–9302114 : rapprochés sans écart ; 9302109 : BL rapproché + 4,20 € de frais de facturation affectés au chantier Trottier.
- Würth 4336131218 : trouvé via n° de facture si le ticket 4336131218 est en base, sinon signalé manquant (pas d'écart fantôme).
- Cromology 28746368 : rattachée à ZOLPAN (pas de nouveau fournisseur) ; BL 15805160 rapproché (198,95 €) ; FFVDF 1,34 € en frais.
