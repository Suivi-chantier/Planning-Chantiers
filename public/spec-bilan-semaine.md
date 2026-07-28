# Bilan semaine multi-chantiers — Prompts pour Claude Code

Série de prompts à donner **dans l'ordre** à Claude Code. Chaque étape est autonome et
testable : vérifie le résultat avant de passer à la suivante. Ne saute pas d'étape.

**Fichiers principaux concernés :**
- `src/chantierFinance.js` *(à créer — source de vérité des calculs)*
- `src/Renovation/PhasageV2.jsx` *(source des formules, à refactorer pour consommer le module)*
- `src/Renovation/BilanSemaine.jsx` *(à créer — page autonome)*
- `src/Renovation/Equipe.jsx` *(à alléger)*
- `api/cron-snapshot-hebdo.js` *(à créer)*

---

## Contexte à rappeler dans chaque prompt

```
Contexte projet : app React (Vite), hébergée sur Vercel, base Supabase (accès direct
depuis le front via src/supabase.js ; le dossier /api/ ne sert qu'aux crons, à l'envoi
de mail et à l'admin users — on ne crée PAS de couche REST maison).

Décision d'architecture actée : la page Phasage V2 (src/Renovation/PhasageV2.jsx) est
la SEULE source de vérité pour les calculs financiers et d'avancement d'un chantier.
DashboardAnalyse.jsx est considéré comme OBSOLÈTE et non utilisé : ne t'appuie jamais
sur ses formules, ne les prends pas comme référence, ne cherche pas à t'aligner sur
lui. Si un écart apparaît entre PhasageV2 et une autre page, c'est l'autre page qui a
tort.

Aucun chiffre affiché ne doit changer de valeur à cause d'un refactor. Si un refactor
modifie un montant affiché sur Phasage V2, c'est un bug : signale-le au lieu de
"corriger" le chiffre.
```

---

# ÉTAPE 0 — Module de calcul unique (`chantierFinance.js`)

> L'étape la plus délicate du projet : une erreur ici contamine tout le reste.
> Elle se fait en trois prompts séparés (0a, 0b, 0c). Ne les fusionne pas.

## Étape 0a — Orientation, sans aucune modification

```
Avant toute modification, lis src/Renovation/PhasageV2.jsx et fais-moi l'inventaire
exhaustif de tous les calculs financiers et d'avancement qu'il contient. Pour chacun,
donne-moi :
- le nom de la variable / fonction dans le code
- la formule exacte appliquée
- les données d'entrée et leur provenance précise (colonne de table, clé de
  plan_travaux.meta, champ d'ouvrage, table pointages, table commande_lignes...)
- les cas de repli (fallback) et pourquoi ils existent

Couvre au minimum : prixHTOuvrage / prixHTChantier, heuresVenduesOuvrage /
heuresVenduesChantier, heuresReellesOuvrage / heuresReellesTotalChantier,
coutMOChantier / coutMOTotalChantier, extras (sumLibreEtIndirect), tauxMOPrevEff /
moPrevChantier, coutMatOuvrage / commandesPrevChantier, coutMatChantier (lignes de
commande), fgTauxHoraire / fgChantier, margeChantier / margePctChantier,
avancementOuvrage / avancementChantier, la reprise d'heures (meta.reprise_heures ×
meta.reprise_taux), et les scalaires de suivi direction (marge_vendue_cible,
seuil_prime, prime).

Liste-moi séparément TOUTES les configurations de la modale `kpiDetail` (title,
subtitle, rows, total, totalLabel, empty) : c'est le matériau des futures infobulles,
je veux savoir précisément ce qui existe déjà.

Dis-moi aussi où PhasageV2 utilise encore l'attribut HTML title="" pour expliquer une
valeur.

Ne modifie AUCUN fichier. Je veux seulement ton inventaire, pour qu'on parte sur une
base commune.
```

**Sortie attendue :** un inventaire que tu relis avant de continuer. Si une formule
te surprend, c'est le moment de le dire, pas après.

---

## Étape 0b — Création du module (sans brancher personne dessus)

```
Objectif : créer src/chantierFinance.js, module unique et source de vérité des
calculs de chantier, en reprenant À L'IDENTIQUE les formules de PhasageV2.jsx
inventoriées à l'étape précédente. À cette étape, PERSONNE ne consomme encore le
module : on le crée et on le teste à côté.

CONTRAINTES DE DESIGN, non négociables :
1. Fonctions PURES. Aucun appel Supabase, aucun accès réseau, aucun import de React,
   aucun JSX, aucun accès à window/localStorage. Le module reçoit toutes ses données
   en argument. Les appelants font les I/O.
2. Importable depuis le front (ESM) ET depuis /api/*.js (CommonJS, `require`). C'est
   indispensable : le cron de snapshot devra utiliser exactement les mêmes formules
   que l'écran. Choisis la solution la plus simple et robuste pour ce double usage et
   explique-moi ton choix avant d'écrire (ex : fichier .js sans dépendances avec
   export nommés + un point d'entrée compatible, ou build dual). Ne pars pas sur une
   solution qui obligerait à ajouter une étape de build.
3. Aucune dépendance npm nouvelle.

API publique attendue :

  computeChantierFinance({
    phasage,           // ligne de la table phasages (ouvrages, plan_travaux, ...)
    pointages,         // pointages du chantier (déjà chargés)
    commandeLignes,    // lignes de commande du chantier
    tauxHoraires,      // map { nom_ouvrier: taux }
    tauxMOPrev,        // taux MO prévisionnel global (réglages Admin)
    lots,              // config des lots
  }) => ChantierFinance

Le retour NE DOIT PAS être un objet de nombres nus. Chaque indicateur est un objet
"Donnee" :

  {
    cle:        'marge',
    label:      'Marge nette',
    valeur:     16098,
    format:     'euro' | 'heure' | 'pourcent' | 'ratio' | 'texte',
    formule:    "Vendu HT − coût main d'œuvre − matériaux − frais généraux",
    calculDetaille: "97 400 € − 61 200 € − 16 700 € − 3 402 € = 16 098 €",
    ventilation: [ { main, sub, right, rightColor } ],   // même forme que kpiDetail
    source:     "Ouvrages du phasage, registre de pointage, lignes de commande",
    fraicheur:  { dernierPointage: '2026-07-25', ... },
    warnings:   [ { code, message, gravite: 'info'|'alerte' } ],
    renseigne:  true,   // false = donnée absente, à NE PAS confondre avec valeur 0
  }

Points précis :
- `formule` est rédigée en FRANÇAIS COMPRÉHENSIBLE PAR UN CONDUCTEUR DE TRAVAUX, pas
  en pseudo-code. Écris "heures pointées × taux horaire de l'ouvrier", pas "Σ(h×t)".
- `calculDetaille` substitue les nombres réels dans la formule.
- `ventilation` reprend telle quelle la structure des `rows` des modales kpiDetail
  existantes de PhasageV2, pour que l'UI puisse les afficher sans transformation.
- `renseigne: false` quand la donnée d'entrée manque (ex : fg_taux_horaire non réglé).
  Un 0 calculé et un 0 faute de paramétrage sont deux choses différentes, et cette
  distinction doit vivre dans le module, pas dans l'UI.
- `warnings` reprend l'esprit des messages `empty` existants (ex : "Définis un taux
  horaire de frais généraux dans Suivi direction").

Le retour global contient au minimum :
  venduHT, ecartVendu, moPrev, matPrev, moReel, matReel, fg, marge, margePct,
  heuresVendues, heuresReelles, avancement, trajets, indirect,
  lots: [ { id, label, couleur, nbOuvrages, heuresVendues, heuresReelles,
             avancement, ratioDerive, vide } ],
  meta: { margeCible, seuilPrime, prime },
  warnings: [...]   // agrégés, niveau chantier

`ecartVendu` : PhasageV2 calcule le vendu comme la somme des prix_ht des ouvrages.
Il existe aussi plan_travaux.meta.prix_vendu et une colonne phasages.prix_vendu
(utilisées par d'autres pages). La base de calcul reste la SOMME DES OUVRAGES (seul
montant ventilable par lot). Mais expose un `ecartVendu` = somme des ouvrages −
montant du devis renseigné, avec un warning si l'écart dépasse 1 % ou 500 €. Un écart
signale une donnée à corriger (avenant oublié, ouvrage non chiffré), pas une marge.

`ratioDerive` par lot = (heures réelles / heures vendues) ÷ (avancement / 100).
À 1,00 le lot est dans le devis. > 1,15 = dérive à signaler. Renvoie null si les
heures vendues ou l'avancement sont à zéro (indéterminé, pas 0).

INTERDITS à cette étape :
- ne modifie PAS PhasageV2.jsx (ça vient à l'étape 0c)
- ne modifie AUCUNE autre page
- ne touche pas à src/pointages.js : réutilise ses helpers existants
  (indexPointagesParTache, sumLibreEtIndirect, sumHeures, sumCoutMO) en les important,
  ou en les recevant en argument si l'import casse la compatibilité CommonJS
- ne "corrige" aucune formule au passage, même si tu en trouves une discutable :
  signale-la moi, je tranche

CRITÈRE D'ACCEPTATION : écris un petit script de vérification (jetable, ou un fichier
de test) qui charge un chantier réel et affiche côte à côte les valeurs du module et
les valeurs actuellement affichées par Phasage V2. Les deux doivent être identiques
au centime. Montre-moi le tableau comparatif.
```

---

## Étape 0c — PhasageV2 consomme le module

```
Objectif : faire de PhasageV2.jsx un CONSOMMATEUR de src/chantierFinance.js. Toutes
les formules doivent disparaître du composant et vivre uniquement dans le module.

C'est le point critique de tout le projet : si les formules restent dans PhasageV2 ET
sont dupliquées dans le module, elles divergeront. Il ne doit rester AUCUN calcul
financier ou d'avancement dans PhasageV2.jsx.

À faire :
- charger les données (phasage, pointages, commande_lignes, taux, lots) comme
  aujourd'hui, puis appeler computeChantierFinance une seule fois dans un useMemo
- remplacer chaque variable calculée locale par la lecture de l'objet retourné
- alimenter les KpiCard depuis les objets Donnee (valeur + label + format)
- alimenter les modales kpiDetail depuis `ventilation` / `formule` / `calculDetaille`
  / `warnings` au lieu des configurations construites en dur dans le composant. Garde
  côté UI uniquement la présentation : icône, couleur, mise en page.

INTERDITS :
- aucun changement visuel : même disposition, mêmes couleurs, mêmes libellés, mêmes
  seuils de couleur (marge < 0 rouge, < 15 % orange, sinon vert)
- aucun changement de comportement : le repli du bandeau KPI, les lots vides masqués,
  le glisser-déposer, l'autosave, tout reste identique
- ne touche à aucune autre page

CRITÈRE D'ACCEPTATION : sur 3 chantiers réels différents (dont un chantier legacy sans
pointage et un chantier avec reprise d'heures), tous les KPI et toutes les modales de
détail affichent exactement les mêmes valeurs qu'avant le refactor. Fais-moi une
capture ou un relevé avant/après.
```

---

# ÉTAPE 1 — Bascule des autres pages sur le module

```
Objectif : supprimer toutes les formules financières dupliquées ailleurs dans l'app et
les faire passer par src/chantierFinance.js.

Cibles :
- src/Renovation/PageChantiers.jsx : la fonction calcFinances et tous les calculs de
  la fiche chantier (coûts prévus/réels, marges, heures par ouvrage). Attention, elle
  somme actuellement TOUS les pointages du chantier, ce qui diffère de la méthode
  PhasageV2 (par tâche + extras) : c'est PhasageV2 qui fait foi, donc certains
  montants de PageChantiers VONT changer. C'est attendu et souhaité — liste-moi
  précisément les chantiers et les montants impactés avant d'appliquer.
- toute autre page qui recalcule marge, coût MO, coût matériaux, frais généraux ou
  avancement (fais la recherche, ne te limite pas à ma liste).

Cas particulier DashboardAnalyse.jsx : page obsolète et non utilisée. Ne la refactore
pas, ne cherche pas à la faire fonctionner. Dis-moi simplement si elle est encore
atteignable depuis la navigation, et propose-moi soit sa suppression, soit son
retrait de la matrice de droits (src/access.js et ALL_NAV_ITEMS dans Navigation.jsx).
Je tranche, tu n'agis pas de ton propre chef sur ce point.

Ajoute aussi le contrôle d'écart sur le vendu (ecartVendu du module) là où le prix de
vente est affiché, sous forme d'avertissement discret.

CRITÈRE D'ACCEPTATION : pour un même chantier, la marge nette est identique au centime
sur Phasage V2 et sur PageChantiers. Plus aucune formule financière en dehors du
module — vérifie par recherche dans le code et montre-moi le résultat.
```

---

# ÉTAPE 2 — Snapshot hebdomadaire financier

```
Objectif : historiser chaque semaine la ligne financière complète de chaque chantier,
pas seulement l'avancement. Bénéfices : bilan instantané à charger, séries temporelles
pour voir les dérives, et bilans passés qui restent justes quand on les rouvre.

1. SQL — crée sql/chantier_snapshots_hebdo.sql, sur le modèle de
   sql/chantier_avancement_history.sql :
   table public.chantier_snapshots_hebdo
     id uuid pk default gen_random_uuid()
     chantier_id text not null
     chantier_nom text
     phasage_id uuid
     week_id text not null              -- même format que weekId dans l'app
     date_snapshot date not null default current_date
     vendu_ht, mo_prev, mat_prev, mo_reel, mat_reel, fg, marge  numeric
     marge_pct, avancement, heures_vendues, heures_reelles      numeric
     lots jsonb                          -- [{id,label,heuresVendues,heuresReelles,avancement,ratioDerive}]
     warnings jsonb
     created_at timestamptz not null default now()
   + index (chantier_id, date_snapshot desc)
   + UNIQUE (chantier_id, date_snapshot) pour l'idempotence du cron

   RLS : ATTENTION, ne mets pas la policy permissive "public_all". Cette table
   contient des marges. Applique le même verrouillage bureau-only que les tables
   sensibles de sql/202607_espace_ouvrier_phase0.sql :
   policy "bureau_all" for all to authenticated
     using (not public.est_ouvrier()) with check (not public.est_ouvrier())

   Confirme-moi le SQL avant que je le lance dans Supabase.

2. Cron — crée api/cron-snapshot-hebdo.js sur le modèle de
   api/cron-snapshot-avancement.js (même vérification CRON_SECRET, même gestion de
   la timezone Paris, même upsert idempotent).
   IMPÉRATIF : il doit importer src/chantierFinance.js et n'implémenter AUCUNE formule
   en propre. Si l'import échoue pour une raison de module, dis-le moi et on corrige
   le module — n'écris pas une copie des formules dans le cron.
   Il charge phasages + pointages + commande_lignes + réglages, appelle
   computeChantierFinance par chantier, insère une ligne par chantier actif.
   Ajoute le workflow GitHub Actions correspondant (vendredi 18h Paris), sur le
   modèle de cron-snapshot-avancement.yml.

3. Backfill rétroactif — écris un script (ou un endpoint avec ?backfill=true) qui
   reconstitue les snapshots des semaines passées. C'est possible parce que :
   - l'état des ouvrages à une date passée est dans public.phasages_history
     (cf. la technique déjà utilisée dans sql/corriger_snapshots_avancement_v2.sql)
   - les pointages et les lignes de commande sont datés, donc filtrables à une date
   Reconstitue les 12 dernières semaines. Marque ces lignes comme reconstituées
   (colonne ou clé dans warnings) pour qu'on sache qu'elles ne sont pas natives.

Ne touche pas au cron d'avancement existant : il continue de tourner, on le
supprimera plus tard si celui-ci le remplace complètement.

CRITÈRE D'ACCEPTATION : un appel manuel du cron insère une ligne par chantier actif,
un second appel le même jour ne crée pas de doublon, et les valeurs snapshotées sont
identiques à celles affichées par Phasage V2 au même instant.
```

---

# ÉTAPE 3 — Page « Bilan semaine » autonome (migration à l'identique)

```
Objectif : sortir le bilan de semaine de la modale d'Équipe et en faire une page à
part entière. À CETTE ÉTAPE, AUCUNE FONCTIONNALITÉ NOUVELLE : c'est une migration
pure. Le bilan produit doit être identique à celui d'avant.

1. Crée src/Renovation/BilanSemaine.jsx et déplaces-y depuis src/Renovation/Equipe.jsx :
   le composant BilanSemaine, buildBilanHTML, generatePDFBlob, genPDFBilan, l'envoi
   par mail (sendBilanEmail + blobToBase64), le state bilanExtras avec son
   chargement/upsert vers bilans_hebdo, les suggestions de blocages, et les helpers
   fusionnerTachesBilan / filtrerStatutDominant / normTexteBilan.
   Si un helper est utilisé AUSSI par le reste d'Equipe.jsx, ne le duplique pas :
   sors-le dans un module partagé et importe-le des deux côtés.

2. Transforme la modale en page : plus de backdrop ni de modal-box, mise en page
   pleine page cohérente avec les autres pages (page-padding, thème T.*), sélecteur
   de semaine dans l'en-tête (semaine précédente / suivante + valeur par défaut =
   semaine en cours). Conserve les styles responsive mobile existants.

3. La page charge ses données elle-même. C'EST LE POINT DE RISQUE : la modale
   recevait rapports / chantiers / cells en props, déjà filtrés par Equipe. Elle doit
   maintenant charger pour la semaine sélectionnée : rapports, planning_cells,
   pointages (fetchPointages avec dateFrom/dateTo), bilans_hebdo,
   chantier_avancement_history, et la liste des chantiers. Vérifie bien que le filtre
   de semaine s'applique partout (le bug classique : les cells restent sur la semaine
   courante alors que le bilan est sur une autre semaine).

4. Navigation et droits :
   - ajoute l'id de page "bilan-semaine" dans ALL_NAV_ITEMS et dans allNav
     (src/Renovation/Navigation.jsx), placé juste après "planning", icône cohérente
   - ajoute-le dans src/access.js (PAGES_RENOVATION + ROLE_PAGES_DEFAULT_RENOVATION)
     pour les rôles admin, conducteur et comptable. Pas pour commercial ni ouvrier.
   - branche la page dans le routeur de MainApp

5. Dans Equipe.jsx : retire le bouton « Bilan de la semaine » et remplace-le, à la
   même place, par un lien discret « Le bilan de semaine a déménagé → » qui navigue
   vers la nouvelle page. On le supprimera dans quelques semaines.

INTERDITS : ne change ni le contenu du bilan, ni son HTML, ni son PDF, ni ses calculs.
N'ajoute pas le bloc financier (étape 4).

CRITÈRE D'ACCEPTATION : génère le bilan de la même semaine avec l'ancien code et le
nouveau, et compare les deux PDF. Ils doivent être identiques. Teste aussi une semaine
antérieure, pour valider que le filtre de semaine s'applique bien à toutes les sources.
```

---

# ÉTAPE 4 — Finances dans l'accordéon + infobulles explicatives

```
Objectif : ajouter la lecture financière multi-chantiers à la page Bilan semaine, et
rendre chaque chiffre auto-explicatif.

1. Structure en accordéon, un chantier par ligne, case à cocher pour la sélection PDF.
   Filtre "chantiers en cours" défini par l'ACTIVITÉ, pas par un statut (il n'y a pas
   de colonne statut fiable) : au moins un pointage dans les 21 derniers jours OU
   avancement strictement entre 1 % et 99 %. Un chantier sans activité cette semaine
   est affiché quand même, avec un badge "aucune activité cette semaine" — un chantier
   silencieux est une information, pas un vide.

   En-tête replié : pastille d'état · nom · avancement % + delta de la semaine ·
   vendu HT · marge € · badge d'alerte s'il y en a. Chevron qui pivote, transition
   CSS ~200 ms, pas de saut visuel.

   Déplié, dans cet ordre :
     1. Progression de la semaine (existant : avant → maintenant, delta % et delta €)
     2. Finances : les indicateurs issus de computeChantierFinance
     3. Lots, avec le ratio de dérive par lot (lots vides masqués, bouton pour les
        afficher, comme sur Phasage V2)
     4. Tâches faites / en cours (existant)
     5. Blocages / semaine suivante (existant)
     6. Présences et remarques (existant, discret)

2. Réutilise les composants de Phasage V2 (KpiCard, barre d'avancement, tableau des
   lots) en les rendant paramétrables par props plutôt qu'en les dupliquant. Sors-les
   dans un module partagé si nécessaire.

3. Composant <Donnee> — infobulles. Crée un composant unique qui enveloppe chaque
   valeur affichée et rend son explication depuis l'objet Donnee du module (formule,
   calculDetaille, source, fraicheur, warnings).
   Exigences :
   - N'UTILISE PAS l'attribut HTML title="". Il a un délai d'une seconde, n'est pas
     stylable et surtout ne se déclenche pas au tactile. Écris un petit composant
     maison qui gère le survol souris ET l'appui long sur mobile. Aucune dépendance
     npm nouvelle. Remplace au passage les title="" explicatifs de Phasage V2.
   - Trois niveaux de lecture : valeur visible → infobulle au survol (formule +
     calculDetaille + fraîcheur, 3 lignes maximum, pas plus) → clic pour la
     ventilation complète (réutilise les modales kpiDetail existantes).
   - Rendu visuel DIFFÉRENT quand renseigne === false : un 0 calculé et un 0 faute
     de paramétrage ne doivent pas se ressembler. L'infobulle dit quoi faire
     ("taux de frais généraux à régler dans Suivi direction").
   - Affiche la fraîcheur : "à date du JJ/MM · dernier pointage le JJ/MM".
   - Applique <Donnee> sur la page Bilan semaine ET sur Phasage V2.

4. Sélection multi-chantiers + PDF : bouton désactivé tant que rien n'est coché.
   Étends buildBilanHTML pour n'inclure que les chantiers sélectionnés et ajouter la
   section financière. Ajoute un drapeau includeFinances (défaut true) pour pouvoir
   produire un bilan sans les marges le jour où le document doit sortir de la boîte.
   Conserve les règles page-break-inside:avoid existantes ; un tableau de lots ou de
   finances ne doit jamais être coupé entre deux pages.

5. Annexe "Méthode de calcul" en dernière page du PDF, GÉNÉRÉE depuis le module
   (jamais rédigée en dur) : chaque indicateur, sa formule en français, sa source.
   Le PDF n'a pas d'infobulles, c'est son équivalent.

6. Ajoute une section "Méthode de calcul" dans l'aide de la page
   (src/Renovation/PageAide.jsx), également générée depuis le module.

CRITÈRE D'ACCEPTATION : pour un chantier donné, chaque montant du bilan est identique
au centime à celui de Phasage V2. Toute valeur financière affichée a une infobulle
qui fonctionne à la souris et au doigt. Aucun texte d'infobulle n'est écrit en dur
dans un composant — vérifie par recherche dans le code.
```

---

# ÉTAPE 5 — Points d'attention automatiques

```
Objectif : le bilan doit remonter ce qui cloche, pas tout lister. Avec 10-15 chantiers
actifs, personne ne déplie 15 accordéons chaque vendredi.

Ajoute un encart "Points d'attention" en tête de page ET en tête de PDF, juste après
la synthèse. Il liste automatiquement, tous chantiers confondus :

 1. marge réelle inférieure au seuil de prime (meta.seuil_prime)
 2. dérive d'heures : ratioDerive > 1,15 sur un lot — indique le lot concerné
 3. avancement stagnant : delta de la semaine < 3 % (via les snapshots)
 4. compte rendu hebdo manquant
 5. lot dont les travaux démarrent sous 15 jours sans aucune commande passée
 6. données manquantes qui faussent la marge : fg_taux_horaire non réglé, ouvrages
    sans prix de vente, écart de vendu (ecartVendu) au-delà du seuil
 7. écart d'avancement vs facturation : si l'avancement dépasse le % facturé, une
    situation est à émettre — chiffre le montant

Les règles 1, 2, 6 viennent directement des warnings du module. Ne les réimplémente
pas ici : consomme-les.

Ces points alimentent en PRÉ-REMPLISSAGE les blocages de bilans_hebdo : le conducteur
valide ou écarte au lieu de rédiger. Ne les ajoute JAMAIS automatiquement dans les
blocages enregistrés — proposition uniquement, comme le fait déjà le mécanisme de
suggestions existant.

Les seuils (1,15 · 3 % · 15 jours · 1 % d'écart de vendu) doivent être des constantes
nommées en haut du fichier, pas des nombres au milieu du code.

CRITÈRE D'ACCEPTATION : sur la semaine en cours, l'encart remonte des points réels et
vérifiables, et aucun faux positif évident. Chaque point est cliquable et déplie le
chantier concerné.
```

---

# ÉTAPE 6 — Projections

```
Objectif : passer du constat au pilotage. La marge à date dit où on en est ; ces
indicateurs disent où on va.

Ajoute au module chantierFinance.js, avec le même format Donnee (formule, calcul
détaillé, warnings) :

- margeATerminaison = vendu − (coût MO réel + heures restantes estimées × taux)
                             − (matériaux réel + reste à commander)
                             − frais généraux projetés
  Les heures restantes viennent des tâches non terminées (heures_estimees ×
  (100 − avancement) / 100).

- resteAFaire en euros et en heures

- situationAFacturer = (avancement % − % facturé) × vendu HT. Le % facturé existe
  côté États financiers (logique "CA à provisionner") : réutilise-la, ne la
  réinvente pas. Si la donnée de facturation n'est pas disponible pour un chantier,
  renvoie renseigne: false plutôt qu'un zéro trompeur.

- resteACommander : réutilise la logique de la page Commandes à passer.

Affiche ces indicateurs dans le bloc Finances de l'accordéon, visuellement distincts
des indicateurs à date (ce sont des projections, elles ne doivent pas être confondues
avec des chiffres constatés). Ajoute-les au snapshot hebdo et au PDF.

CRITÈRE D'ACCEPTATION : sur un chantier à 50 % d'avancement dont les heures dérivent,
la marge à terminaison est inférieure à la marge à date, et l'infobulle explique
pourquoi de façon compréhensible.
```

---

# ÉTAPE 7 — Génération et envoi automatiques

```
Objectif : le conducteur ne fabrique plus le bilan, il le relit.

Le vendredi 18h Paris, après le snapshot (étape 2) : génération du bilan de la semaine
et envoi par mail aux destinataires configurés, en réutilisant api/send-email.js et
les destinataires déjà en place dans le code de l'envoi manuel.

Difficulté à traiter explicitement : le PDF est aujourd'hui généré côté client
(window.print pour le téléchargement, html2pdf pour la pièce jointe). Un cron n'a pas
de navigateur. Propose-moi deux ou trois options (ex : mail HTML riche sans PJ avec
lien vers la page, génération serveur, ou tâche déclenchée côté client), avec leurs
inconvénients, et attends mon arbitrage AVANT d'implémenter.

Prévois un réglage pour activer/désactiver l'envoi automatique et gérer la liste des
destinataires (dans Réglages plutôt qu'en dur dans le code).

CRITÈRE D'ACCEPTATION : un vendredi soir, le bilan arrive sans que personne ne l'ait
lancé, et il est identique à celui qu'on aurait généré à la main.
```

---

# Annexe A — Tableau des indicateurs et de leurs sources

| Indicateur | Source réelle |
|---|---|
| Vendu HT | Σ `ouvrages[].prix_ht` *(base de calcul)* ; contrôle d'écart vs `meta.prix_vendu` / colonne `prix_vendu` |
| Heures vendues | Σ `ouvrages[].heures_devis` |
| Heures réelles | tâches via registre `pointages` (repli `heures_reelles`) + libres + indirects |
| Coût MO réel | `pointages.heures × pointages.taux_horaire` (taux figé sur la ligne, jamais recalculé par jointure) + libres + indirects + `meta.reprise_heures × meta.reprise_taux` |
| MO prévu | heures vendues × taux MO prévisionnel (Admin, repli `TAUX_MO_PREV_DEFAUT`) |
| Matériaux prévu | Σ `ouvrages[].cout_materiaux` |
| Matériaux réel | Σ `commande_lignes.prix_total` du chantier |
| Frais généraux | `meta.fg_taux_horaire` × heures réelles |
| Marge nette | vendu − coût MO − matériaux − FG *(= le « delta total » du plan initial : un seul indicateur, pas deux)* |
| Avancement | tâches pondérées `heures_estimees` → ouvrages pondérés `prix_ht` |
| Historique avancement | `chantier_avancement_history` (cron vendredi 18h) |
| Historique financier | `chantier_snapshots_hebdo` *(à créer, étape 2)* |
| Blocages / semaine suivante | `bilans_hebdo` (`week_id`, jsonb) |
| État passé des ouvrages | `phasages_history` *(permet le backfill)* |

# Annexe B — Décisions actées

1. **Phasage V2 est la seule source de vérité.** DashboardAnalyse est obsolète : ses formules ne servent pas de référence, y compris quand elles diffèrent.
2. **Un seul module de calcul**, pur et importable front + cron. Aucune formule financière ailleurs, PhasageV2 compris.
3. **Le vendu se calcule par somme des ouvrages**, avec contrôle d'écart affiché.
4. **« Marge nette » = « delta total ».** Un seul indicateur, un seul nom, jamais deux côte à côte.
5. **Le bilan semaine devient une page**, retirée d'Équipe, avec lien de transition.
6. **Un seul bilan** (opérationnel + financier), avec un drapeau `includeFinances` pour l'avenir.
7. **Droits** : admin, conducteur, comptable. Pas commercial, pas ouvrier.
8. **Chaque donnée affichée porte son explication**, produite par le module et jamais rédigée dans l'UI.
9. **« Chantier en cours » se déduit de l'activité**, pas d'un statut. Un statut explicite sur `phasages` reste à faire le jour où d'autres écrans en auront besoin.
10. **La dimension hebdomadaire n'est pas un enjeu** : lecture principale à date, le delta de la semaine ne concerne que l'avancement, les heures et le coût MO.

# Annexe C — Points restés ouverts

- Sort de DashboardAnalyse : suppression pure ou retrait de la navigation ? *(à trancher à l'étape 1)*
- Génération PDF côté serveur pour l'envoi automatique *(à trancher à l'étape 7)*
- Statut explicite des chantiers sur `phasages` *(hors périmètre, à planifier séparément)*
- Suppression du cron d'avancement une fois le snapshot financier stabilisé
