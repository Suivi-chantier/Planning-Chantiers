# Rebrancher l'audit de visite sur Phasage V2 — Prompts pour Claude Code

## Brief de reprise (à lire en premier sur un nouveau compte / nouveau chat)

**L'appli.** Application interne d'une entreprise de rénovation (React + Supabase), outil unique de la boîte. Le code est modifié via **Claude Code** — pas à la main dans le chat. Modules concernés ici : **Phasage V2** (refonte du plan de travail) et **Visites chantier** (audits de chantier en cours).

**Le problème de départ.** Quand j'audite un chantier en cours, j'ai deux besoins : (1) valider ce qui a été réalisé, (2) en déduire ce qu'il reste à faire et le planifier. La page **Visite chantier** fait le point (1), mais elle est **indexée sur les phases du Phasage V1** : la portée est dans `visite.phases_auditees`, le détail dans `visite.audit[phase_id]`, alimenté par `phasage.plan_travaux[phase_id]`. Or **on a basculé la planification sur Phasage V2**, qui ne remplit plus ce tiroir : en V2 les tâches vivent dans `phasage.ouvrages[].taches[]`, chaque ouvrage portant un `lot_id`. Résultat : **l'audit lit une liste de tâches V1 vide ou périmée.**

**La cible.** Rebrancher l'audit sur le modèle V2 **Lot → Ouvrage → Tâche**. La portée d'une visite se choisit par **lot** (au lieu de phase) ; le détail s'affiche en deux niveaux (ouvrages d'un lot, puis leurs tâches) ; chaque tâche garde ses statuts **OK / Réserve / NOK** + commentaire + photos. L'identité d'une tâche pour l'héritage des réserves est son `tache.id` (stable, V2 le normalise et le persiste au chargement).

**Décisions déjà prises (à respecter) :**
- **Phasage V1 est considéré comme remplacé par V2.** On ne base plus aucun nouvel écran sur `plan_travaux[phase_id]` pour la liste des tâches ; la source de vérité des tâches est `ouvrages[].taches[]`.
- **Portée par lot.** Un nouveau champ `visite.lots_audites` (liste de `lot_id`) remplace `phases_auditees` pour les visites V2.
- **Audit en deux niveaux.** L'écran affiche, pour chaque lot en portée, ses ouvrages, puis les tâches de chaque ouvrage.
- **Snapshot conservé.** L'audit reste un instantané : on continue d'écrire le détail dans `visite.audit`, on ne le recalcule pas à la volée depuis le phasage (sauf synchro des nouvelles tâches, cf. Prompt 4).
- **Identité de tâche = `tache.id`** (unique dans un phasage). L'héritage des réserves matche sur `tache.id`, pas sur du texte ni sur le couple phase+tâche.
- **Compatibilité ascendante obligatoire.** Les visites déjà enregistrées sont indexées par `phase_id`. On ajoute un drapeau `visite.data_version` (`"v1"` / `"v2"`) ; les visites existantes restent `"v1"` et continuent de s'ouvrir, de s'exporter et de s'imprimer **exactement comme aujourd'hui**. Aucune perte de données, aucune réécriture des anciennes visites.

**Pas encore traité (prompt futur, déjà esquissé en Prompt 6) :** la planification directement depuis l'audit (envoyer les réserves et le reste-à-faire dans `planning_cells`). C'est mon besoin n°2 ; on le branche une fois que l'audit lit correctement V2.

**Si tu veux re-discuter la conception en chat (pas juste exécuter) :** recrée un Projet et **uploade les fichiers du code** dans la base de connaissances du projet, pour que le chat puisse « voir » le dépôt comme dans la session d'origine.

---

## Comment utiliser ce document
- **Un prompt à la fois.** Colle le prompt, laisse Claude Code travailler, **teste**, puis **commit** avant de passer au suivant. Ne lui donne pas tout d'un bloc.
- **Commence impérativement par le Prompt 0** (audit, sans modification) et **lis sa réponse** avant de lancer le Prompt 1 : il peut révéler des détails de ton code (noms exacts des composants, forme réelle du snapshot `audit`) qui changent un détail d'une étape.
- **Prompts 0 à 5 = le cœur de la bascule.** Le **Prompt 6 est un ajout** (planifier depuis l'audit) — c'est ton besoin n°2 ; garde-le ou traite-le dans une session à part.
- À chaque étape, l'appli doit rester **fonctionnelle pour les anciennes visites** (routées par `data_version`). Si une étape casse une visite V1, on s'arrête et on corrige avant d'avancer.

---

## L'idée en une phrase (à garder en tête)
L'audit ne lit plus les **phases du V1** (`plan_travaux[phase_id]`) mais les **lots/ouvrages/tâches du V2** (`ouvrages[].taches[]`). On change l'**axe de la portée** (phase → lot) et la **source des tâches**, on garde tout le reste (statuts, snapshot, héritage des réserves, export), et on protège l'existant avec un drapeau `data_version`.

---

## Prompt 0 — Audit (aucune modification de code)

```
Avant toute modification, lis le code et fais-moi un état des lieux écrit, sans rien changer.

Contexte métier : la page Visite chantier (audit de chantier en cours) est aujourd'hui branchée sur le modèle Phasage V1 (les phases). On a basculé la planification sur Phasage V2 (modèle Lot → Ouvrage → Tâche, tâches dans phasage.ouvrages[].taches[]). Je veux rebrancher l'audit sur V2, sans casser les visites déjà enregistrées.

Fais-moi, sans modifier de fichier :
1. Dans VisiteChantier.jsx : la liste exacte des endroits qui lisent phasage.plan_travaux[phase_id], visite.phases_auditees et visite.audit[phase_id] (création de visite, composant AuditVisite, calcul des KPIs, héritage des réserves, synchro des nouvelles tâches, "phases hors portée"). Donne-moi les noms réels des composants/fonctions.
2. La forme réelle d'un objet visite tel qu'il est sauvegardé (champs de premier niveau : id, chantier_id, date, statut, phases_auditees, audit, checklist, note_generale… et la forme d'une entrée de audit[phase_id]).
3. La forme réelle d'un ouvrage V2 (phasage.ouvrages[]) et d'une de ses tâches (ouvrages[].taches[]) : tous les champs présents (id, libelle, lot_id, taches[].id, taches[].nom, taches[].avancement, taches[].heures_estimees, taches[].date_prevue…). Confirme que tache.id est stable et persisté (normalisation au chargement dans PhasageV2.jsx).
4. Le contrat de l'export : ce que VisiteChantier.jsx envoie à api/generate-visite-docx.js (payload) et comment ce fichier itère sur phases et audit[phase.id].
5. Où sont chargés les lots (constants.js : loadLots / LOTS_DEFAUT) et leur forme ({ id, label, couleur, code_prefixe }).

Termine par un plan de migration en étapes qui garde l'appli fonctionnelle pour les anciennes visites à chaque étape. Réponds-moi en texte, ne modifie aucun fichier.
```

---

## Prompt 1 — Marquage de version des visites

```
Objectif : pouvoir distinguer une visite "ancien modèle" (indexée par phase) d'une visite "nouveau modèle" (indexée par lot), pour ne jamais casser l'existant.

- Ajoute un champ data_version sur la visite. À la création d'une visite, écris data_version = "v2". Toute visite qui n'a pas ce champ est traitée comme "v1".
- Crée un helper unique (ex : getVisiteModele(visite)) qui renvoie "v1" ou "v2", et fais passer par lui tous les futurs branchements d'affichage/export. Ne disperse pas la condition dans le code.
- À ce stade, AUCUN changement d'affichage : v1 comme v2 continuent de s'afficher via le chemin actuel (par phase). On ne fait que poser le drapeau et le helper.

Contraintes : strictement additif. Si la colonne/le champ n'existe pas en base (les visites sont en JSON dans une table — vérifie la structure), prévois un repli pour que la lecture d'une visite sans data_version fonctionne. Ne réécris aucune visite existante.

Critère d'acceptation : une visite créée après ce changement porte data_version = "v2" ; les anciennes visites s'ouvrent, s'éditent et s'exportent exactement comme avant ; getVisiteModele renvoie la bonne valeur dans les deux cas.
```

---

## Prompt 2 — Création de visite : portée par lot (V2)

```
Objectif : choisir la portée d'une nouvelle visite par LOT (modèle V2), au lieu de par phase.

- Sur l'écran de création de visite, quand on crée une visite V2 : charge les lots (loadLots) et propose de cocher les lots à auditer. Calcule la portée à partir des ouvrages du phasage dont le lot_id est coché.
- Stocke la sélection dans un nouveau champ visite.lots_audites (liste de lot_id), en plus de data_version = "v2". Ne touche pas à phases_auditees pour les visites V2 (laisse-le vide/absent).
- Affiche, comme l'actuel écran le fait pour les phases, un petit récap par lot : nb d'ouvrages, nb de tâches, avancement moyen (avancement d'un ouvrage = moyenne des avancements de ses tâches, pondérée par heures_estimees — réutilise la logique déjà présente dans PhasageV2.jsx, ne la réécris pas).
- L'écran de création des visites v1 (s'il reste accessible) n'est pas obligatoire à conserver : on ne crée plus que des visites v2. Mais ne supprime pas la logique v1 d'AFFICHAGE des anciennes visites.

Contraintes : additif. Une visite v2 ne doit jamais écrire dans phases_auditees ; une visite v1 existante n'est pas migrée.

Critère d'acceptation : je crée une visite en cochant des lots ; la visite enregistrée a data_version = "v2" et lots_audites correctement rempli ; les anciennes visites restent intactes.
```

---

## Prompt 3 — Audit en lecture V2 (Lot → Ouvrage → Tâche)

```
Objectif : que l'audit d'une visite v2 affiche et évalue les tâches V2 (ouvrages[].taches[]), groupées par lot puis par ouvrage.

- Dans le composant d'audit (AuditVisite), branche un chemin V2 (routé par getVisiteModele) :
  - Pour chaque lot de visite.lots_audites, liste les ouvrages du phasage rattachés (ouvrage.lot_id), puis les tâches de chaque ouvrage.
  - Garde l'interaction identique à aujourd'hui : statut par tâche OK / Réserve / NOK, commentaire, photos (même préfixe de stockage visites/{chantier_id}/{visite.id}).
  - Les KPIs globaux (nb OK / Réserve / NOK / non défini + total) gardent exactement la même logique, calculés sur l'ensemble des tâches en portée + les items de checklist.
- Snapshot : écris le détail dans visite.audit, mais pour une visite v2 indexe-le par lot_id (visite.audit[lot_id] = [ ... ]). Chaque entrée de tâche porte au minimum : ouvrage_id, ouvrage_libelle, tache_id, nom, heures_estimees, avancement, statut, commentaire, photos. (On reste sur un instantané, comme en v1.)
- Le chemin v1 (lecture par phase) reste strictement inchangé pour les anciennes visites.

Contraintes : ne modifie pas le chemin v1. N'introduis pas de recalcul live qui écraserait le snapshot v2 — l'audit reste un instantané, sauf la synchro du Prompt 4.

Critère d'acceptation : j'ouvre une visite v2, je vois mes lots → ouvrages → tâches issus de Phasage V2, je peux poser OK/Réserve/NOK + commentaire + photo, et après sauvegarde le détail est bien stocké dans visite.audit indexé par lot_id ; une visite v1 s'affiche toujours comme avant.
```

---

## Prompt 4 — Héritage des réserves + synchro des nouvelles tâches (V2)

```
Objectif : reprendre les réserves de la dernière visite et intégrer les tâches ajoutées au phasage depuis la création de la visite — version V2, matché par tache_id.

- Héritage des réserves (chemin v2) : prends la dernière visite v2 du même chantier (date antérieure), et liste les tâches encore en "reserve" ou "nok". Matche-les aux tâches de la visite courante par tache_id (pas par texte, pas par lot). Affiche, comme aujourd'hui, le statut d'origine et le statut courant de la même tâche.
- Synchro : si des tâches ont été ajoutées dans ouvrages[].taches[] depuis la création de la visite (pour les lots en portée), ajoute-les au snapshot d'audit avec statut null, sans toucher aux tâches déjà notées.
- "Hors portée" : signale, comme l'actuel "phases hors portée", les LOTS qui ont des ouvrages/tâches mais ne sont pas dans lots_audites, avec un bouton "élargir la portée" qui les ajoute.

Contraintes : matching strictement par tache_id. Ne modifie ni la logique v1 d'héritage, ni les visites v1. Si une tâche héritée n'existe plus dans le phasage (supprimée), affiche-la en lecture seule sans planter.

Critère d'acceptation : sur une 2e visite v2 d'un chantier, les tâches laissées en réserve/NOK à la visite précédente remontent automatiquement (matchées par tache_id) ; une tâche ajoutée au phasage entre-temps apparaît bien dans l'audit ; un lot oublié est signalé et "élargir la portée" fonctionne.
```

---

## Prompt 5 — Export .docx de la visite (V2)

```
Objectif : que le compte rendu .docx d'une visite v2 s'imprime correctement, groupé par lot → ouvrage → tâche.

- Côté VisiteChantier.jsx (handleExport) : pour une visite v2, envoie un payload adapté à api/generate-visite-docx.js — la liste des lots (id, label, couleur) à la place de phases, et le détail audit indexé par lot_id. Garde le payload v1 (phases) pour les visites v1, routé par getVisiteModele.
- Côté api/generate-visite-docx.js : ajoute un chemin de rendu v2 qui itère sur les lots puis, à l'intérieur, sur les ouvrages et leurs tâches. Conserve intégralement le chemin v1 existant (itération par phase) pour les anciennes visites. Réutilise les mêmes styles, le même bilan global (OK/Réserve/NOK + checklist) et la même section "réserves héritées".

Contraintes : ne casse pas l'export des visites v1. Pas de duplication anarchique : si tu peux factoriser le rendu d'une tâche commun aux deux chemins, fais-le, mais sans toucher au résultat visuel du .docx v1.

Critère d'acceptation : j'exporte une visite v2 → le .docx liste mes lots, leurs ouvrages et leurs tâches avec statuts, le bilan global et les réserves héritées ; j'exporte une vieille visite v1 → le document est identique à avant.
```

---

## Prompt 6 — Planifier depuis l'audit *(ajout — mon besoin n°2)*

```
Objectif : fermer la boucle audit → planification. Depuis l'audit, envoyer une tâche (réserve, NOK, ou simplement non terminée) directement dans le planning, sans repasser par Phasage.

- Sur chaque tâche de l'audit v2 (et en priorité sur les réserves / NOK / tâches < 100%), ajoute une action "Planifier" qui ouvre le même mini-formulaire que Phasage V2 (semaine + jour + durée + ouvriers) et écrit dans planning_cells, en réutilisant la logique existante envoyerDansPlanning de PhasageV2.jsx (ne la réécris pas : factorise-la ou importe-la).
- Comme en V2, mets aussi à jour date_prevue sur la tâche source (ouvrages[].taches[]) après planification.
- Ajoute un filtre/raccourci "reste à planifier" : les tâches en réserve/NOK ou < 100% qui n'ont pas encore de date_prevue future, pour les traiter en série en fin d'audit.

Contraintes : réutilise le code de planification existant, n'en crée pas un second. Ne planifie rien automatiquement — c'est toujours moi qui valide semaine/jour/durée.

Critère d'acceptation : depuis l'audit, je planifie une réserve sur un jour donné ; elle apparaît dans le planning semaine et la tâche du phasage reçoit sa date_prevue ; je peux voir d'un coup d'œil ce qu'il me reste à planifier.
```

---

## Récapitulatif de l'ordre
0. Audit (lecture seule) → 1. Marquage `data_version` → 2. Création de visite par lot → 3. Audit en lecture V2 (Lot→Ouvrage→Tâche) → 4. Héritage des réserves + synchro (par `tache_id`) → 5. Export .docx V2 → *(6. Planifier depuis l'audit — ajout, besoin n°2)*

**Invariant à toutes les étapes :** une visite `data_version = "v1"` s'ouvre, s'édite, s'exporte et s'imprime exactement comme avant. Si ce n'est plus le cas, on s'arrête.
