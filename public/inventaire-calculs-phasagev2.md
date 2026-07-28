# Inventaire des calculs de PhasageV2.jsx (étape 0a — base commune)

Relevé exhaustif au 2026-07-28, sur `src/Renovation/PhasageV2.jsx` (5 986 lignes).
Aucun fichier modifié. Ce document sert de référence pour l'écriture de
`src/chantierFinance.js` (étape 0b) : les formules doivent être reprises À L'IDENTIQUE.

## 1. Données d'entrée et provenance

| Donnée | Provenance |
|---|---|
| `phasage` | table `phasages`, ligne du chantier (`.eq("chantier_id", id).maybeSingle()`). Contient `ouvrages` (jsonb) et `plan_travaux.meta` (jsonb). Les ids d'ouvrages/tâches manquants sont normalisés au chargement (L519-564) |
| `ouvrages` | `phasage.ouvrages \|\| []` (L599) |
| `meta` | `phasage.plan_travaux.meta \|\| {}` (L1069) |
| `pointages` | `fetchPointages({ chantier_id })` — table `pointages`, TOUT le chantier (L573) |
| `pointagesParTache` | `indexPointagesParTache(pointages)` (src/pointages.js) : pointages productifs (`type_pointage !== "indirect"`) AVEC `tache_id`, indexés par `String(tache_id)` (L577) |
| `commandeLignes` | table `commande_lignes` filtrée `chantier_id`, avec jointure `commande:commandes(statut_completude, statut_facturation, fournisseur_nom, doc_numero)` (L590-597) |
| `tauxHoraires` | prop depuis App.jsx — map `{ nom_ouvrier: taux }` (config) |
| `tauxMOPrev` | prop depuis App.jsx — réglage Admin (0 si non réglé) |
| `lots` | `loadLots()` : `planning_config.key="lots_travaux"` → `value.items`, repli `LOTS_DEFAUT` (src/constants.js L476-501) |

## 2. Heures

| Nom | Ligne | Formule exacte | Repli |
|---|---|---|---|
| `tacheHeuresReelles(t)` | 866 | Σ `p.heures` des pointages de la tâche (via `pointagesParTache`) | si aucun pointage : `t.heures_reelles` — si tableau (format v1) : somme du tableau ; sinon `parseFloat` ; 0 par défaut |
| `tacheHeuresVendues(t)` | 885 | `parseFloat(t.heures_vendues) \|\| 0` (réparties depuis `heures_devis` de l'ouvrage au chargement, backfill L536-546) | — |
| `heuresReellesOuvrage(o)` | 886 | Σ `tacheHeuresReelles(t)` sur `o.taches` | — |
| `heuresVenduesOuvrage(o)` | 887 | `parseFloat(o.heures_devis) \|\| 0` | — |
| `heuresReellesLot` / `heuresVenduesLot` | 888-889 | Σ sur `ouvragesDuLot(lotId)` | — |
| `heuresVenduesChantier` | 949 | Σ `o.heures_devis` sur tous les ouvrages | — |
| `heuresReellesChantier` | 950 | Σ `tacheHeuresReelles` sur toutes les tâches de tous les ouvrages | — |
| `extras` | 954 | `sumLibreEtIndirect(pointages)` → `{ heuresLibre, coutLibre, heuresIndirect, coutIndirect }`. Libres = `type_pointage !== "indirect"` ET `tache_id` null. Indirects = `type_pointage === "indirect"` (TRAJET INCLUS) | — |
| `repriseHeures` / `repriseTaux` / `repriseCout` | 960-962 | `meta.reprise_heures`, `meta.reprise_taux`, produit des deux | 0 si absents |
| `heuresReellesTotalChantier` | 977 | `heuresReellesChantier + extras.heuresLibre + extras.heuresIndirect + repriseHeures` (ensembles disjoints, pas de double comptage) | — |

## 3. Coûts et marge

| Nom | Ligne | Formule exacte | Repli / cas particuliers |
|---|---|---|---|
| `coutMOTache(t)` | 901 | Σ `p.heures × p.taux_horaire` (taux FIGÉ sur la ligne de pointage) | si aucun pointage : `hr × taux` pour **CHAQUE ouvrier assigné** (`t.ouvriers`), c.-à-d. `Σ_ouvriers (heures_reelles × tauxHoraires[nom])`. 0 si hr=0 ou aucun ouvrier. ⚠️ diffère de `coutMOEff` de pointages.js (qui ne prend que `ouvriers[0]`) — voir « Surprises » |
| `coutMOOuvrage` / `coutMOLot` / `coutMOChantier` | 928-930 | sommes de `coutMOTache` | — |
| `coutMOTotalChantier` | 975 | `coutMOChantier + extras.coutLibre + extras.coutIndirect + repriseCout` | — |
| `prixHTOuvrage(o)` | 933 | `parseFloat(o.prix_ht) \|\| 0` | — |
| `prixHTLot` / `prixHTChantier` | 934-935 | sommes | — |
| `coutMatOuvrage(o)` (prévu) | 939 | `parseFloat(o.cout_materiaux) \|\| 0` (estimé depuis la bibliothèque de matériaux) | — |
| `totalLignes(lignes)` | 941 | Σ (`prix_total` sinon `prix_unitaire × quantite` sinon 0) | ⚠️ un `prix_total` à 0 retombe sur PU×qté (comportement du `\|\|`) |
| `coutMatChantier` (réel) | 946 | `totalLignes(commandeLignes)` — somme réelle des lignes de commande | — |
| `tauxMOPrevEff` | 1045 | `tauxMOPrev > 0 ? tauxMOPrev : TAUX_MO_PREV_DEFAUT` (constante = **25**) | — |
| `moPrevChantier` | 1046 | `heuresVenduesChantier × tauxMOPrevEff` | — |
| `commandesPrevChantier` | 1051 | Σ `coutMatOuvrage(o)` | — |
| `fgTauxHoraire` | 1056 | `parseFloat(meta.fg_taux_horaire)`, `Number.isFinite` sinon **0** | `meta.fg_pct` mentionné « en compat » mais **jamais utilisé** dans un calcul |
| `fgChantier` | 1060 | `fgTauxHoraire × heuresReellesTotalChantier` (heures RÉELLES totales : tâches + trajets + indirect + libres + reprise) | 0 si taux non réglé — **cas typique de `renseigne: false`** |
| `margeChantier` | 1062 | `prixHTChantier − coutMOTotalChantier − coutMatChantier − fgChantier` | — |
| `margePctChantier` | 1063 | `prixHT > 0 ? marge / prixHT × 100 : 0` | ⚠️ 0 (pas null) quand prixHT = 0 |

### Stats d'affichage (incluses dans le coût MO total, jamais additionnées en plus)
| Nom | Ligne | Formule |
|---|---|---|
| `trajetStats` | 982 | pointages `type_pointage === "indirect"` ET `motif_indirect` matche `/trajet/i` → `{ heures, cout }` (coût = h × taux figé) |
| `indirectStats` | 993 | pointages indirects HORS trajet (même regex inversée) → `{ heures, cout }` |
| `heuresParMois` | 1009 | TOUTES les heures pointées (tâches + trajets + indirect), groupées par `date.slice(0,7)` puis par ouvrier, triées mois décroissant |
| `moisCourant` | 1034 | heures du mois calendaire courant (`new Date()`) — ⚠️ dépendance à l'horloge, à garder côté UI |

## 4. Avancement

| Nom | Ligne | Formule exacte |
|---|---|---|
| `avancementOuvrage(o)` | 1413 | moyenne des `t.avancement` pondérée par `t.heures_estimees`, **`Math.round`** ; si Σ heures_estimees = 0 → moyenne simple arrondie ; si aucune tâche → 0 |
| `avancementLot(lotId)` | 1479 | moyenne des `avancementOuvrage(o)` (déjà arrondis) pondérée par `o.prix_ht`, **`Math.round`** ; si Σ prix = 0 → moyenne simple arrondie ; si lot vide → 0. Pseudo-lot `"_orphans"` = ouvrages sans `lot_id` reconnu (L1476) |
| `avancementChantier` | 1493 | même logique sur TOUS les ouvrages (lots confondus), pondérée `prix_ht`, `Math.round` |

⚠️ Les arrondis sont IMBRIQUÉS : l'avancement d'ouvrage est arrondi AVANT la pondération
du lot/chantier. À reproduire tel quel, sinon écarts de ±1 %.

## 5. Suivi direction (scalaires `plan_travaux.meta`)

| Nom | Ligne | Source |
|---|---|---|
| `margeCible` | 1070 | `meta.marge_vendue_cible` (%) |
| `seuilPrime` | 1071 | `meta.seuil_prime` (%) |
| `primeChant` | 1072 | `meta.prime` (€) |
| `cibleAtteinte` | 5580 | `margeCible > 0 && prixHT > 0 && margePct >= margeCible` |
| `primeAcquise` | 5581 | `prime > 0 && seuilPrime > 0 && prixHT > 0 && margePct >= seuilPrime` |

## 6. Seuils de couleur (présentation, à garder côté UI mais documentés)

- Marge : `< 0` → rouge `#e15a5a` ; `< 15 %` → orange `#f5a623` ; sinon vert `#22c55e` (L2439, L3308)
- Dérive heures réelles/estimées `couleurDerive` (L875) : ratio ≤ 1 vert ; ≤ 1,2 orange ; > 1,2 rouge ; null si estimées ≤ 0
- Dépassement heures `couleurDepassement` (L891) : rouge si vendues > 0 et réelles > vendues
- Avancement 100 % → vert

## 7. Configurations `kpiDetail` (matériau des futures ventilations)

Toutes construites L3202-3389, structure commune `{ icon, color, title, subtitle, rows: [{main, sub, right, rightColor?}], empty, total, totalLabel, totalColor, totalIsText? }` :

| Clé | title / subtitle | rows | total |
|---|---|---|---|
| `vendu` | « Prix de vente HT » / « N ouvrages valorisés » | par ouvrage (prix > 0, tri décroissant) : libellé, lot, € | `prixHTChantier`, « Total vendu HT », `#f5c400` |
| `heures` | « Heures réelles / vendues » / « X h pointées sur Y h vendues » | par ouvrage (r>0 ou v>0, tri v puis r) : `Xh / Yh` + rouge si dépassement ; ligne « Trajets + indirect + libres » si hExtra > 0,05 | texte `Xh / Yh`, couleur dépassement ou `#5b9cf6` |
| `mo` | « Coût main d'œuvre réel » / « N ouvriers au registre » | par ouvrier (registre, taux figé) `Xh × Y€/h` ; + « Heures sans pointage nominatif » si reste legacy > 0,50 € ; + « Trajets » ; + « Heures indirectes » ; + « Heures libres » (si > 0,50 €) | `coutMOTotalChantier`, `#60a5fa` |
| `fg` | « Frais généraux » / « X€/h × Yh réelles » ou « Taux horaire non réglé (Suivi direction) » | par ouvrage (hr > 0) `Xh × T€/h` ; + ligne extras. `empty` : « Définis un taux horaire de frais généraux dans « Suivi direction »… » | `fgChantier`, `#a78bfa` |
| `marge` | « Marge nette » / « X % du vendu » ou « Vendu − MO − Matériaux − FG » | 4 lignes fixes : Vendu HT (+, vert), Coût MO (−), Matériaux (−), FG (−) | texte `±X €`, couleur seuils marge |
| `mo_prev` | « Coût MO prévisionnel » / « T€/h × Yh vendues » | par ouvrage (hv > 0) `Xh × T€/h` | `moPrevChantier`, `#818cf8` |
| `commandes_prev` | « Commandes prévisionnelles » / « N ouvrages avec matériaux liés » | par ouvrage (cout_materiaux > 0) | `commandesPrevChantier`, `#fb923c` |
| `trajet` | « Trajets » / « Xh · N ouvriers · inclus dans le coût MO » | par ouvrier `Xh × Y€/h` | `trajetStats.cout`, `#f59e0b` |
| `indirect` | « Heures indirectes » / « Xh · hors trajet · incluses dans le coût MO » | par MOTIF `Xh` | `indirectStats.cout`, `#f59e0b` |

Modales apparentées hors `kpiDetail` : `moisModal` (heures par mois / ouvrier, L3435+) et `matKpiModal` (commandes du chantier).

## 8. Attributs `title=""` explicatifs de valeurs (à remplacer par <Donnee> à l'étape 4)

- L2526 : barre d'avancement chantier → `avancementChantierDetail` (calcul pondéré ligne à ligne)
- L2654, L2799, L2905 : pastilles heures « Réalisé Xh sur Yh vendues » (lot / ouvrage / tâche)
- L2674, L2714 : `avancementLotDetail` (lots et orphelins)
- L2817 : `avancementOuvrageDetail`
- L2950 : `avancementTacheDetail`
- L2998, L3985 : « Heures issues du registre de pointage — non modifiable ici »
- L4522, L5379 : « X % réalisé » (chrono / gantt)
- L5466 : tooltip de barre Gantt
(Les autres `title=""` sont des libellés de boutons, pas des explications de valeur.)

## 9. Surprises / points signalés (aucune correction appliquée)

1. **Deux replis legacy différents coexistent** pour le coût MO d'une tâche sans pointage :
   `coutMOTache` de PhasageV2 (L901) compte `heures_reelles × taux` pour **chaque** ouvrier
   assigné (somme sur tous), alors que `coutMOEff` de src/pointages.js (utilisé ailleurs)
   ne compte que `ouvriers[0]`. PhasageV2 fait foi → c'est SA version qui ira dans le module.
2. **Arrondis imbriqués d'avancement** : ouvrage arrondi avant pondération lot/chantier.
   Reproduit à l'identique dans le module (sinon écarts de ±1 %).
3. **`meta.fg_pct`** : mentionné en compat (L1055) mais n'entre dans aucun calcul. Le module l'ignore.
4. **`margePctChantier` vaut 0** (et non null/indéterminé) quand le vendu est 0. Conservé tel quel ;
   le module pourra le signaler via `renseigne`.
5. **`totalLignes`** : une ligne avec `prix_total = 0` explicite retombe sur PU × quantité
   (effet du `||`). Conservé tel quel.
6. **`moisCourant`** dépend de l'horloge (`new Date()`) : reste côté UI, n'entre pas dans le module
   (le module reçoit ses données, il ne lit pas l'heure).
7. **`ecartVendu`** (à créer en 0b) : `plan_travaux.meta.prix_vendu` et la colonne `phasages.prix_vendu`
   existent mais ne sont PAS utilisés par PhasageV2 — la base reste Σ des ouvrages.
