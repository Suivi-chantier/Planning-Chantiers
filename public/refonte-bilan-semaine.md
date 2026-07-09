# Refonte du bilan de semaine — Prompts pour Claude Code

Ce fichier contient une série de prompts à donner **dans l'ordre** à Claude Code.
Chaque étape est autonome et testable : génère un bilan après chacune pour vérifier
avant de passer à la suivante. Ne saute pas d'étape, chacune prépare la suivante.

**Fichier principal concerné :** `src/Renovation/Equipe.jsx`
(fonctions `buildBilanHTML`, `generatePDFBlob`, `genPDFBilan`, et le composant de la modale de bilan)

**Contexte pour tous les prompts :** l'app est en React, hébergée sur Vercel, base
Supabase. Le bilan est généré en HTML puis exporté en PDF (via `window.print()` pour
le téléchargement et `html2pdf.js` pour l'envoi mail). Les données par chantier
existantes sont : `heures`, `presences`, `faites`, `enCours`, `nonFaites`,
`remarques`, `progression` (avancement avant/après + delta % et delta €).

---

## Étape 0 — Orientation (à passer en premier, ne modifie rien)

```
Avant toute modification, lis et résume-moi le fonctionnement actuel du bilan de
semaine dans src/Renovation/Equipe.jsx. Je veux comprendre précisément :
- la fonction buildBilanHTML : comment elle construit le bandeau (bilan-banner),
  les KPI (kpiCell), et les blocs par chantier (chantierBlocs)
- l'objet de données construit pour chaque chantier (nom, heures, presences,
  faites, enCours, nonFaites, remarques, progression)
- comment sont calculés totalHeures, totalFaites, totalGenereEuros
- les deux chemins d'export PDF (window.print via genPDFBilan, et html2pdf via
  generatePDFBlob) et ce qui les différencie
- où et comment la progression hebdo est récupérée (table chantier_avancement_history)

Ne modifie aucun fichier. Donne-moi juste ta compréhension pour qu'on parte sur
une base commune.
```

---

## Étape 1 — Retirer les tâches « non faites » du bilan

```
Objectif : le bilan de semaine doit présenter uniquement ce qui a avancé cette
semaine. Retire complètement l'affichage des tâches "non faites" du PDF.

Dans src/Renovation/Equipe.jsx :
- Dans le rendu HTML du bloc chantier (buildBilanHTML), supprime la section qui
  affiche nonFaites.
- Garde le calcul de nonFaites dans les données si c'est utilisé ailleurs, mais
  ne l'affiche plus dans le bilan. Si rawNonFaites n'est utilisé nulle part
  ailleurs, supprime-le proprement.
- Vérifie que ça ne casse pas le KPI totalFaites ni la mise en page.

Ne touche pas encore à l'ordre des sections ni au style. On veut juste retirer
les "non faites" pour l'instant.
```

---

## Étape 2 — Stockage des blocages et de la semaine suivante (Supabase)

```
Objectif : créer un stockage persistant, par semaine et par chantier, pour deux
nouvelles informations saisies par le conducteur de travaux : les blocages/
arbitrages, et le point "semaine suivante".

1. Crée un nouveau fichier SQL dans le dossier sql/ : bilans_hebdo.sql
   Table public.bilans_hebdo :
   - week_id      text        PRIMARY KEY   (même format que weekId dans l'app)
   - data         jsonb       NOT NULL DEFAULT '{}'::jsonb
   - updated_at   timestamptz NOT NULL DEFAULT now()
   Active RLS avec une policy permissive "public_all" (FOR ALL USING(true)
   WITH CHECK(true)), comme les autres tables du projet.

   La structure du champ data sera :
   {
     "blocages": [
       { "chantier_id": "...", "chantier_nom": "...", "texte": "...",
         "statut": "info" | "decision" }
     ],
     "semaine_suivante": [
       { "chantier_id": "...", "chantier_nom": "...", "texte": "..." }
     ]
   }

2. Dans src/Renovation/Equipe.jsx, ajoute :
   - un state `bilanExtras` = { blocages: [], semaineSuivante: [] }
   - au chargement de la modale de bilan, un chargement depuis bilans_hebdo pour
     le weekId courant (supabase.from("bilans_hebdo").select().eq("week_id", weekId))
   - une fonction de sauvegarde (upsert) vers bilans_hebdo, appelée quand on
     modifie ces champs (debounce ~800ms suffit).

Ne modifie pas encore le rendu PDF. Cette étape ne fait que le stockage + le state.
Confirme-moi le SQL à exécuter dans Supabase avant que je le lance.
```

---

## Étape 3 — Interface de saisie des blocages / arbitrages

```
Objectif : dans la modale de bilan (avant génération du PDF), ajouter une zone de
saisie des blocages et arbitrages, alimentant le state bilanExtras.blocages créé
à l'étape 2.

Design de la saisie (rapide à remplir) :
- Une liste éditable. Chaque ligne = un blocage :
  - un menu déroulant pour choisir le chantier concerné (parmi les chantiers
    présents dans le bilan de la semaine)
  - un champ texte libre pour décrire le point
  - un sélecteur à deux valeurs : "Pour info" (statut "info") et
    "Décision attendue" (statut "decision"), avec un rendu visuel clair
    (ex : "Décision attendue" en orange/rouge)
  - un bouton pour supprimer la ligne
- Un bouton "+ Ajouter un blocage" en bas.
- Les lignes se sauvegardent automatiquement via la fonction d'upsert de l'étape 2.

Respecte le style visuel existant de la modale (couleurs, radius, typo des variables
de thème T.*). Ne touche pas encore au PDF.
```

---

## Étape 4 — Interface de saisie « semaine suivante »

```
Objectif : même logique que l'étape 3, mais pour bilanExtras.semaineSuivante.

Ajoute dans la modale de bilan une section "Semaine suivante" :
- Une liste éditable, une ligne par point : menu déroulant chantier + champ texte
  libre (ex : besoins matériel/appro, effectifs, relance client à faire).
- Bouton "+ Ajouter un point".
- Sauvegarde auto via l'upsert bilans_hebdo.

Garde ça court et léger visuellement : c'est de l'anticipation, pas un plan détaillé.
Même style que l'étape 3. Ne touche pas encore au PDF.
```

---

## Étape 5 — Réorganiser le contenu de chaque bloc chantier

```
Objectif : réorganiser l'ordre des informations dans chaque bloc chantier du PDF
pour hiérarchiser par importance. Ne change pas encore le style visuel en profondeur
(étape 6) — ici on ne touche qu'à l'ORDRE et au regroupement des sections.

Nouvel ordre dans chaque bloc chantier (buildBilanHTML) :
1. En-tête chantier : nom + PROGRESSION EN TÊTE. Affiche le delta d'avancement de
   la semaine (progression.delta %) et le "généré €" du chantier, avec une PASTILLE
   COULEUR :
     - vert  : progression > seuil (ex : delta >= 3%)
     - orange: progression faible/quasi nulle (0 < delta < 3%)
     - gris  : pas de donnée de progression (progression null)
   La pastille + la progression doivent être l'élément le plus visible du bloc.
2. Tâches faites : afficher un compteur en synthèse ("X tâches terminées") plutôt
   qu'une longue liste. Garde la liste détaillée mais en version compacte/discrète
   (ou repliable si simple à faire côté HTML print — sinon liste courte, style
   allégé).
3. Tâches en cours : liste visible (c'est un signal important).
4. Blocages / arbitrages : afficher les blocages de bilanExtras.blocages qui
   concernent CE chantier. Les "Décision attendue" doivent ressortir visuellement
   (couleur d'alerte). Ne rien afficher si le chantier n'a aucun blocage.
5. Semaine suivante : afficher les points de bilanExtras.semaineSuivante concernant
   ce chantier. Ne rien afficher si vide.
6. Présences et remarques : en bas, en version discrète.

Supprime définitivement l'affichage des "non faites" si ce n'était pas déjà fait.
```

---

## Étape 6 — Encart de synthèse en haut du bilan

```
Objectif : ajouter en haut du PDF, juste après le bandeau, un encart de synthèse
qui permet de tout comprendre en 10 secondes.

Contenu de l'encart :
- Une ligne par chantier de la semaine : pastille couleur (même logique verte/
  orange/grise que l'étape 5) + nom du chantier + delta d'avancement + généré €.
- En dessous, un bloc "Décisions attendues" qui liste automatiquement TOUS les
  blocages de bilanExtras.blocages dont le statut est "decision", tous chantiers
  confondus, avec le nom du chantier en préfixe. Si aucune décision attendue,
  afficher une ligne discrète "Aucune décision en attente".

Cet encart doit être visuellement distinct (encadré) et placé avant les blocs
chantier détaillés. C'est le résumé exécutif.
```

---

## Étape 7 — Refonte visuelle complète du PDF

```
Objectif : refonte esthétique et de mise en page du PDF de bilan. Le rendu actuel
est peu soigné. Je veux un document qui ressemble à un vrai rapport professionnel
de chantier, propre et lisible sur téléphone comme imprimé.

Direction artistique :
- Format A4 portrait, marges généreuses et cohérentes.
- Hiérarchie typographique nette : un seul système de tailles (titre doc >
  titre chantier > sous-section > corps), interligne aéré. Police système sans-serif
  propre (Arial/Helvetica pour compatibilité print).
- Palette restreinte : garder le noir profond et le jaune Profero (#f5c400) comme
  couleurs de marque, le vert (#50c878) et un orange pour les pastilles d'état.
  Le reste en niveaux de gris. Pas de fond coloré agressif sur les grandes zones.
- Beaucoup de blanc / d'espace. Les blocs chantier bien séparés, respirables.
- Système de pastilles d'état cohérent et discret (petit rond coloré + label).
- Les "Décision attendue" et blocages doivent utiliser une couleur d'alerte
  sobre (orange/rouge doux), pas criard.
- Alignements rigoureux, pas de tableaux qui débordent, pas de sections orphelines
  en bas de page (garde/renforce les règles page-break-inside:avoid existantes).

Contraintes techniques :
- Applique le même rendu aux DEUX chemins d'export : window.print (genPDFBilan) et
  html2pdf (generatePDFBlob). Les deux doivent produire un visuel identique.
- Conserve le footer de page (logo/nom, semaine, numéro de page).
- Vérifie le rendu sur un bilan à 1 chantier ET à 4+ chantiers (pagination propre).
- Ne change pas la logique de données, seulement le HTML/CSS de buildBilanHTML.

Montre-moi le rendu avant/après si possible.
```

---

## Étape 8 (optionnelle, plus tard) — Suggestion automatique de blocages

```
Objectif (amélioration future, à faire seulement quand le reste est stable) :
aider le conducteur à ne rien oublier dans les blocages.

Détecte les tâches qui restent au statut "en cours" depuis 3 semaines ou plus
(en croisant avec l'historique des rapports / snapshots). Pour chacune, propose-la
en suggestion dans l'interface de saisie des blocages (étape 3), sous forme d'un
bandeau "Points d'attention détectés" avec un bouton "Ajouter aux blocages" qui
pré-remplit une ligne. Le conducteur reste libre de l'ajouter ou de l'ignorer.

Ne rend rien automatique dans le PDF : ce sont uniquement des suggestions de saisie.
```

---

## Rappels pour piloter Claude Code

- Teste et génère un vrai bilan après **chaque** étape avant de continuer.
- Fais valider le SQL avant de l'exécuter dans Supabase (étape 2).
- Si une étape casse quelque chose, corrige avant d'avancer — ne cumule pas les
  changements non testés.
- Demande à Claude Code de te montrer les diffs et de ne pas toucher aux fichiers
  hors périmètre de l'étape en cours.
