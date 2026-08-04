# Point 5 — Diagramme financier (prévisionnel figé & réel) — Prompts pour Claude Code

## Brief de reprise (à lire en premier sur un nouveau chat)

**L'appli.** Application interne d'une entreprise de rénovation (React + Supabase). Code modifié via **Claude Code**.

**Le but.** Un **diagramme financier en courbes cumulées**, **mensuel**, qui suit **trois flux d'argent** — dépenses, recettes (facturation), et **valeur générée** — chacun en **référence figée** et en **réel**. Disponible **par chantier** (sur la fiche chantier, à côté du triangle QCD) et **consolidé tous chantiers** (dans Suivi direction).

**La notion clé : la valeur générée.** Ce n'est ni ce qu'on dépense, ni ce qu'on facture : c'est **ce qu'on a réellement produit**, soit `avancement × montant du devis`. C'est elle qui permet de lire les deux vrais écarts :

| L'écart | Ce qu'il dit |
|---|---|
| Valeur générée − Dépenses | la **marge en train de se constituer** |
| Valeur générée − Facturation | le **décalage de trésorerie** : produit mais pas encore facturé |
| Réel − Référence (chaque courbe) | la **dérive** par rapport au départ |

## ⚠️ Avertissement — consommer `chantierFinance`, ne réécrire AUCUNE formule

`src/chantierFinance.mjs` **centralise déjà toutes les formules financières** (vendu, MO prévue/réelle, matériaux, frais généraux, marge, avancement, et les projections dont **`situationAFacturer`**). Le critère d'acceptation posé lors de sa création était : *« plus aucune formule financière en dehors du module »*.

- ✅ **Consomme** `chantierFinance` pour toute valeur financière.
- ❌ **N'utilise pas** les indicateurs de `DashboardAnalyse.jsx` comme référence de calcul (formules considérées fausses par le métier).
- ❌ **Ne duplique pas** une formule dans un composant, un cron ou ce nouveau module.

**Cadeau du code existant** : la recette prévue d'un mois est **exactement** `situationAFacturer` — `(avancement − % facturé) × vendu HT` — simplement appliquée à l'avancement **prévu** au lieu du réel. Aucune logique nouvelle à inventer.

## Les six séries et leurs sources

| Flux | Prévisionnel (référence figée) | Réel |
|---|---|---|
| **Dépenses** | MO prévue répartie dans le temps par les **`date_prevue`** des tâches (heures estimées × taux MO prévisionnel) + matériaux prévus au démarrage des ouvrages qui les consomment | pointages datés × taux + lignes de commande datées — **via `chantierFinance`** |
| **Recettes** *(facturation)* | **acompte** au mois de signature, puis chaque mois `(avancement prévu fin de mois − cumul déjà facturé) × vendu HT` | **`pctFacture` × `montantHT`** des États financiers, mois par mois (+ acomptes) |
| **Valeur générée** | courbe d'**avancement planifié** (cumul des heures vendues placées dans le temps) × vendu HT | **`avancementReel` × `montantHT`** des États financiers |

## Décisions prises (à respecter)

- **Granularité mensuelle**, alignée sur les **fins de mois des États financiers**. Pas d'hebdomadaire, pas de mélange des deux.
- **Le prévisionnel est FIGÉ** — c'est la décision la plus importante. S'il se recalculait à chaque changement de planning, il suivrait le réel : décaler le chantier décalerait la courbe prévue et **la dérive s'effacerait**. On ne verrait jamais rien.
- **Recettes = facturation, pas encaissement.** On ne modélise **pas** le délai de paiement client. *(Hors périmètre, à noter comme suite possible pour un vrai suivi de trésorerie.)*
- **% d'acompte** : valeur par défaut en Admin, surchargeable par chantier, récupérée des États financiers quand elle y est renseignée.
- **Données manquantes** : afficher « non renseigné » plutôt qu'un zéro trompeur — c'est déjà la convention de `chantierFinance` (`renseigne: false`).
- **Consolidé** : somme mensuelle des chantiers ; un chantier **sans référence figée** n'entre pas dans la courbe prévue consolidée.

## Ce qui est stocké pour la référence figée
- les **trois séries mensuelles prévues** (dépenses, recettes, valeur générée) ;
- la **date de prise** de référence et son **libellé** ;
- **quand** : au démarrage — à la signature ou au premier planning validé ;
- **re-baser** : possible mais **explicitement** (gros avenant qui change le montant du marché), en gardant la trace de l'ancienne référence.

## Pièges connus à vérifier au Prompt 0
1. **Les États financiers joignent par NOM de chantier**, pas par `chantier_id` (`"chantier": "FOURMOND - R+1"`). La jointure est donc **fragile** : à traiter explicitement, avec un signalement des chantiers non appariés.
2. Les **clés de mois** peuvent porter un suffixe (`"2026-04-30-corrige"` à côté de `"2026-04-30"`). Le parsing doit gérer ça et savoir **laquelle fait foi**.
3. `pctFacture`, `avancementReel`, `acompteMois` sont des **fractions** (0,82 = 82 %), pas des pourcentages. Et il faut confirmer ce que représente exactement `acompteMois`.
4. `saveMeta` **relit la base avant d'écrire** et n'est **pas** debouncé : deux appels dans le même tick se perdent un patch.

## Comment utiliser ce document
- **Un prompt à la fois.** Colle, laisse travailler, **teste**, **commit**, puis le suivant.
- **Commence par le Prompt 0** (audit, sans modification) et **lis sa réponse** : la structure des États financiers et la jointure par nom peuvent ajuster les prompts suivants.
- À chaque étape, l'appli doit rester fonctionnelle.

---

## Prompt 0 — Audit (aucune modification de code)

```
Avant toute modification, lis le code et fais-moi un état des lieux écrit, sans rien changer.

Contexte : je veux un diagramme financier MENSUEL en courbes cumulées, avec 3 flux (dépenses, recettes de
facturation, valeur générée = avancement × montant du devis), chacun en RÉFÉRENCE FIGÉE et en RÉEL. Par
chantier sur la fiche chantier, et consolidé dans Suivi direction.

RÈGLE ABSOLUE que je veux que tu confirmes : toutes les valeurs financières doivent venir de
src/chantierFinance.mjs. Je ne veux AUCUNE formule financière réécrite ailleurs, et je ne veux PAS que tu
t'appuies sur les indicateurs de DashboardAnalyse.jsx (formules considérées fausses par le métier).

Réponds-moi en texte, ne modifie aucun fichier :
1. chantierFinance.mjs : l'API exacte de computeChantierFinance (paramètres attendus, forme du retour, le type
   Donnee avec formule/calculDetaille/warnings/renseigne). Liste-moi précisément les valeurs disponibles, dont
   situationAFacturer, et dis-moi qui l'appelle aujourd'hui et comment les I/O sont faites par les appelants.
2. LES ÉTATS FINANCIERS — c'est le point le plus important. Où sont stockées les données (table, colonnes),
   la forme exacte d'une ligne et de son objet `values` indexé par fin de mois, et la signification de CHAQUE
   champ : montantHT, montantTTC, avancementPrecedent, avancementReel, pctFacture, acompteMois,
   acomptePrecedent, pctProvisionner, caProvisionner.
   Confirme que ce sont des FRACTIONS (0,82) et pas des pourcentages.
   Dis-moi précisément ce que représente acompteMois.
   ATTENTION : je crois que la jointure avec les chantiers se fait par NOM de chantier et pas par chantier_id
   ("chantier": "FOURMOND - R+1"). Confirme-le, et dis-moi comment on apparie aujourd'hui.
   Explique aussi les clés de mois avec suffixe (ex : "2026-04-30-corrige" à côté de "2026-04-30") : laquelle
   fait foi et comment le code les traite.
3. Les DÉPENSES datées : comment récupérer les pointages avec leur date et leur coût, et les lignes de commande
   avec leur date et leur montant, pour un chantier — de façon à cumuler mois par mois. Quels champs de date
   exactement.
4. Existe-t-il la table chantier_snapshots_hebdo (snapshots financiers hebdo) et son cron ? Si oui, dis-moi ce
   qu'elle contient et sur combien de semaines elle est remplie. Je veux savoir si j'ai déjà un historique
   financier exploitable.
5. Le PRÉVISIONNEL : où vivent le taux MO prévisionnel, le prix vendu du chantier, les heures vendues et les
   heures estimées par tâche, et la date_prevue. Comment j'obtiendrais le cumul des heures vendues placées dans
   le temps. Où sont les matériaux prévus (materiaux_liens des ouvrages) et ont-ils une date.
6. Les DATES de repère du chantier : y a-t-il une date de signature, de démarrage, de réception quelque part
   (chantier, phasage, cycle de vie du Point 2, États financiers) ? J'en ai besoin pour placer l'acompte.
7. L'AFFICHAGE : quelle librairie de graphiques est déjà utilisée dans l'appli (recharts ? SVG maison ?) et où —
   montre-moi un exemple existant que je puisse suivre. Décris la structure de la fiche chantier détaillée (où
   insérer un bloc) et de la page Suivi direction (où insérer le consolidé).
8. Confirme le piège saveMeta (relecture DB avant écriture, non debouncé).

Termine par : (a) ta reco pour stocker la référence figée (table dédiée ? clé dans le phasage ? planning_config ?),
(b) les risques de la jointure par nom des États financiers et comment les rendre visibles plutôt que silencieux,
(c) les points d'attention pour rester strictement additif.
```

---

## Prompt 1 — Module : les trois séries RÉELLES mensuelles (calcul pur)

```
Objectif : construire les 3 séries mensuelles RÉELLES d'un chantier, en lecture, sans affichage ni stockage.

Crée un module dédié (ex. src/Renovation/diagrammeFinancier.js) en fonctions aussi pures que possible (les
I/O restent à l'appelant, comme pour chantierFinance).

Les 3 séries réelles, en CUMULÉ, par fin de mois :
1) DÉPENSES : pointages datés × taux horaire + lignes de commande datées, cumulées mois par mois.
   Les montants doivent être cohérents au centime avec ce que chantierFinance renvoie pour le total à date —
   vérifie-le explicitement et dis-moi le résultat de la comparaison.
2) RECETTES (facturation) : pctFacture × montantHT des États financiers, mois par mois, en tenant compte des
   acomptes.
3) VALEUR GÉNÉRÉE : avancementReel × montantHT des États financiers, mois par mois.

Contraintes impératives :
- Consomme chantierFinance pour tout ce qui est financier. N'y réimplémente RIEN.
- Gère la jointure États financiers ↔ chantier (par nom, cf. Prompt 0) : renvoie explicitement la liste des
  chantiers NON APPARIÉS plutôt que de les traiter comme des zéros.
- Gère les clés de mois à suffixe ("...-corrige") selon ce que tu as constaté au Prompt 0.
- Les fractions (0,82) doivent être traitées comme telles, jamais confondues avec des pourcentages.
- Une série sans donnée doit renvoyer "non renseigné" (comme le renseigne:false de chantierFinance), jamais 0.
- Aucune modification d'interface.

Critère d'acceptation : pour un chantier réel qui a des États financiers, j'obtiens 3 séries mensuelles
cohérentes ; le total des dépenses au dernier mois est identique au centime au coût total de chantierFinance ;
un chantier non apparié est signalé, pas silencieusement à zéro.
```

---

## Prompt 2 — Module : les trois séries PRÉVUES (calcul pur)

```
Objectif : construire les 3 séries mensuelles PRÉVUES d'un chantier, à partir du planning. Toujours sans
affichage ni stockage.

Dans le module du Prompt 1 :

1) DÉPENSES PRÉVUES, cumulées par fin de mois :
   - MO prévue : pour chaque tâche, heures estimées × taux MO prévisionnel, placée au mois de sa date_prevue ;
   - matériaux prévus : les materiaux_liens des ouvrages, placés au mois de démarrage de l'ouvrage qui les
     consomme (la plus petite date_prevue de ses tâches).
   - Les tâches SANS date_prevue ne peuvent pas être placées : renvoie-les à part (elles rendent la référence
     incomplète, il faut le savoir avant de figer).

2) VALEUR GÉNÉRÉE PRÉVUE :
   courbe d'avancement planifié = cumul des HEURES VENDUES placées dans le temps par date_prevue, divisé par le
   total des heures vendues → × vendu HT. Utilise la même pondération que l'avancement du chantier dans
   chantierFinance (ne crée pas une seconde définition de l'avancement).

3) RECETTES PRÉVUES — réutilise la formule existante :
   - au mois de signature : acompte = % acompte × vendu HT ;
   - chaque mois suivant : (avancement PRÉVU fin de mois − cumul déjà facturé prévu) × vendu HT.
     C'est EXACTEMENT situationAFacturer de chantierFinance, appliqué à l'avancement prévu. Réutilise-la,
     ne la réécris pas.
   - % acompte : valeur par défaut en Admin, surchargeable par chantier, reprise des États financiers si elle y
     est renseignée (cf. Prompt 0). Ajoute le réglage par défaut en Admin s'il n'existe pas.
   - Si aucune date de signature n'est disponible, place l'acompte au premier mois de la série et signale-le.

Contraintes : aucune écriture, aucun affichage. Aucune nouvelle définition de l'avancement ni du vendu.

Critère d'acceptation : sur un chantier planifié, j'obtiens 3 séries prévues cohérentes qui finissent au montant
du devis ; les tâches non datées sont listées à part ; la recette prévue du mois de signature est bien
l'acompte.
```

---

## Prompt 3 — La référence figée : stockage, prise, re-basage

```
Objectif : figer le prévisionnel comme une RÉFÉRENCE, pour que la dérive reste visible.

Pourquoi : si le prévisionnel se recalculait à chaque changement de planning, il suivrait le réel et l'écart
s'effacerait. C'est le même arbitrage que la grille de contrainte du Point 3 : on FIGE.

- Stocke, par chantier (emplacement selon ta reco du Prompt 0) : les 3 séries mensuelles prévues, la date de
  prise de référence, un libellé, et l'auteur.
- Action explicite « Prendre la référence » : calcule les séries prévues (Prompt 2) et les enregistre.
  AVANT d'enregistrer, montre un récapitulatif : montant total, période couverte, et surtout les TÂCHES NON
  DATÉES qui rendraient la référence incomplète. L'utilisateur confirme en connaissance de cause.
- La référence ne se recalcule JAMAIS toute seule. Aucun recalcul silencieux, jamais.
- Action explicite « Reprendre une nouvelle référence » (cas d'un gros avenant qui change le montant du
  marché) : demande confirmation, exige un libellé, et CONSERVE la trace de l'ancienne référence (historique,
  ne l'écrase pas).
- Un chantier sans référence figée doit fonctionner normalement partout : le diagramme affichera simplement le
  réel, avec une invitation à prendre la référence.

Contraintes : strictement additif ; aucun recalcul automatique ; l'ancienne référence n'est jamais perdue.
Attention au piège saveMeta si tu stockes dans meta.

Critère d'acceptation : je prends la référence sur un chantier, je décale ensuite tout le planning de 3
semaines — la courbe de référence NE BOUGE PAS, et l'écart avec le réel devient visible. Je peux re-baser
explicitement, et l'ancienne référence reste consultable.
```

---

## Prompt 4 — Le diagramme par chantier (affichage)

```
Objectif : afficher le diagramme financier sur la fiche détaillée d'un chantier.

- Emplacement : sur la fiche chantier, à côté / en dessous du triangle QCD (Point 2).
- Un graphique en COURBES CUMULÉES, axe des mois en abscisse, euros cumulés en ordonnée.
- Six séries : les 3 flux, chacun en RÉEL (trait plein) et en RÉFÉRENCE FIGÉE (pointillés), avec une couleur
  par flux (dépenses / recettes / valeur générée) et une légende explicite sur les deux styles de trait.
- Utilise la librairie de graphiques déjà en place dans l'appli (identifiée au Prompt 0) — n'en ajoute pas une
  seconde.
- Affiche les DEUX ÉCARTS en clair, sous le graphique, à la date du jour :
  - valeur générée − dépenses = "marge en train de se constituer" ;
  - valeur générée − facturation = "produit mais pas encore facturé" (décalage de trésorerie).
  Ce sont les deux messages utiles du diagramme : ils doivent être lisibles sans interpréter la courbe.
- Au survol d'un mois : les 6 valeurs de ce mois, en euros.
- Si pas de référence figée : n'affiche que le réel, avec un bouton « Prendre la référence ».
- Si les États financiers ne sont pas appariés pour ce chantier : dis-le explicitement à l'écran plutôt que
  d'afficher des courbes fausses.

Contraintes : additif ; réutilise le thème T, les couleurs et les composants existants ; ne modifie ni le
triangle QCD ni les blocs financiers existants de la fiche.

Critère d'acceptation : j'ouvre un chantier en cours, je vois les 6 courbes, je lis immédiatement la marge en
formation et le décalage de facturation ; un chantier sans référence n'affiche que le réel sans planter.
```

---

## Prompt 5 — Le consolidé tous chantiers

```
Objectif : le même diagramme, à l'échelle de l'entreprise.

- Emplacement : dans Suivi direction.
- Somme mensuelle des chantiers, pour les 6 mêmes séries. Réutilise EXACTEMENT le module et le composant de
  graphique du chantier : ne duplique ni les calculs ni le rendu.
- RÈGLE : un chantier SANS référence figée n'entre pas dans les courbes de référence consolidées (sinon la
  référence globale serait fausse). Indique combien de chantiers sont inclus / exclus, explicitement.
- Prévois un filtre de période (par exemple les 12 derniers mois) et, si c'est simple, un filtre sur les
  chantiers actifs.
- Performance : charge en une fois ce dont tu as besoin (patron .in comme loadPhasagesOperation), pas un appel
  par chantier.
- Cette page contient des marges : vérifie que l'accès respecte le verrouillage bureau-only déjà en place sur
  les données sensibles (les ouvriers ne doivent pas y accéder).

Contraintes : additif ; aucune duplication de calcul ni de composant ; respect des règles d'accès existantes.

Critère d'acceptation : dans Suivi direction, je vois le diagramme consolidé sur 12 mois, avec le nombre de
chantiers inclus et exclus ; les chiffres du mois dernier sont cohérents avec la somme des fiches chantier.
```

---

## Prompt 6 — Finitions et cas réels

```
Objectif : rendre le diagramme fiable et lisible sur les vraies données, sans ajouter de fonctionnalité.

- Données manquantes : partout où une série est indisponible (pas d'États financiers, pas de référence, pas de
  taux réglé), affiche « non renseigné » et la raison — jamais un zéro qui ressemble à une donnée. Réutilise la
  convention renseigne:false de chantierFinance.
- Chantiers non appariés aux États financiers : fais-en une liste visible (dans Suivi direction), pour qu'on
  puisse corriger les noms. C'est un vrai risque de faux chiffres.
- Mois sans activité : la courbe cumulée reste plate, elle ne redescend pas et ne fait pas de trou.
- Export : ajoute l'export PDF du diagramme sur le même patron que les exports existants.
- Lisibilité : 6 courbes c'est dense — permets de masquer/afficher un flux en cliquant la légende, et vérifie le
  rendu sur mobile (le diagramme peut rester secondaire sur petit écran, mais ne doit pas casser la page).
- Vérifie une dernière fois par recherche dans le code qu'AUCUNE formule financière n'a été écrite en dehors de
  chantierFinance, et montre-moi le résultat.

Contraintes : aucune nouvelle donnée métier, aucun nouveau calcul. Uniquement fiabilité et lisibilité.

Critère d'acceptation : un chantier sans États financiers affiche un message clair au lieu de courbes fausses ;
je peux masquer une courbe ; l'export PDF fonctionne ; la recherche confirme qu'aucune formule financière n'a
été dupliquée.
```

---

## Récapitulatif de l'ordre
0. Audit (lecture seule) → 1. Séries réelles (calcul) → 2. Séries prévues (calcul) → 3. Référence figée (stockage, prise, re-basage) → 4. Diagramme par chantier → 5. Consolidé dans Suivi direction → 6. Finitions et cas réels.

## Invariants à toutes les étapes
- **Toute valeur financière vient de `chantierFinance`.** Aucune formule réécrite ailleurs. Aucun appui sur `DashboardAnalyse`.
- **La référence est figée** : jamais de recalcul automatique, jamais de perte de l'ancienne référence.
- **Granularité mensuelle** alignée sur les États financiers. Pas de mélange avec l'hebdo.
- **Facturation, pas encaissement** (hors périmètre : le délai de paiement client).
- **Jamais de zéro trompeur** : « non renseigné » + la raison.
- La **jointure par nom** des États financiers est un risque : les non-appariés doivent être **visibles**.
- Chaque étape est **strictement additive** : on **teste** puis on **commit** avant la suivante.
