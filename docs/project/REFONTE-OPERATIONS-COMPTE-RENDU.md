# Refonte Opérations — compte rendu

Projet : `docs/projets/refonte-operations.md`. Document en langage métier, mis à
jour à la fin de chaque lot.

---

## Ce qui a changé

### Lot 1 — Opérations et chantiers dans de vraies tables, règle « chantier actif »

**Pour tout le monde (bureau et ouvriers) : rien ne change à l'écran**, sauf
dans Réglages → Chantiers / Opérations (voir plus bas). Ce qui change est
dessous :

- **Plus d'écrasement entre collègues.** Avant, la liste des chantiers et celle
  des opérations étaient enregistrées d'un seul bloc : changer le statut d'un
  chantier réécrivait les 46 chantiers. Si le conducteur modifiait un chantier
  pendant qu'un collègue créait une opération, le dernier qui enregistrait
  effaçait le travail de l'autre. Désormais chaque opération et chaque chantier
  est une ligne à part : une modification n'écrit que ce qui a changé, sur ce
  seul chantier.
- **Chaque chantier a une opération.** C'est obligatoire et contrôlé par la
  base. Les 7 chantiers qui n'en avaient pas ont reçu une opération à leur nom,
  avec un seul logement (liste plus bas). Elles apparaissent dans Opérations
  et dans Réglages → Opérations.
- **Une seule règle pour savoir quels chantiers afficher.** Toutes les pages qui
  listent des chantiers passent par la même règle (`estChantierActif`). Au
  lot 1 elle donne exactement le même résultat qu'avant ; au lot 2, il suffira
  d'y ajouter « À l'étude » et « Perdu » pour qu'ils disparaissent de toutes
  ces pages d'un coup (ils resteront visibles dans Opérations).
- **Réglages → Chantiers** (administrateur) : un nouveau chantier se crée en
  choisissant son opération, ou « Nouvelle opération à son nom ». On ne peut
  plus laisser un chantier « sans opération » : on le déplace d'une opération
  à l'autre avec la liste déroulante. « Supprimer » un chantier le retire des
  listes mais le garde en réserve dans la base (récupérable).
- **Réglages → Opérations** : le bouton « détacher » (×) a disparu ; la liste
  « + Rattacher un chantier… » devient « + Déplacer un chantier ici… » et
  propose les chantiers des autres opérations. Une opération ne se supprime
  que si elle n'a plus aucun chantier (elle est elle aussi gardée en réserve).
- **E-mails** : aucun changement.

**Qui voit quoi** : aucun droit d'accès aux pages n'est modifié
(`src/access.js` inchangé). Les nouvelles tables reprennent exactement les
droits de l'ancien bloc : le bureau lit et modifie, les ouvriers lisent (les
chantiers non supprimés, comme avant), un visiteur non connecté n'y a aucun
accès. Personne ne peut effacer une ligne : la suppression n'existe pas, seul
l'archivage existe.

#### Pages qui passent par `estChantierActif()`

Règle : un chantier archivé (supprimé) n'apparaît jamais ; « Terminé » est
retiré là où il l'était déjà, gardé là où il était déjà montré.

| Page | Terminés | Comment |
|---|---|---|
| Planning hebdo | retirés (comme avant) | `Planning.jsx` |
| Planning mensuel | montrés (comme avant) | liste filtrée par `App.jsx` |
| Bilan semaine / période | retirés (comme avant) | `BilanPeriode.jsx` |
| Tableau de bord | montrés | liste filtrée par `App.jsx` |
| Commandes, capture de commande, planning des commandes | montrés | liste filtrée par `App.jsx` |
| Équipe (capacité des équipes) | montrés | liste filtrée par `App.jsx` |
| Validation des journées, heures des salariés | montrés | liste filtrée par `App.jsx` |
| Phasage, plans | montrés | liste filtrée par `App.jsx` |
| Notes des ouvriers, notes & todo (bureau) | montrés | liste filtrée par `App.jsx` |
| Alertes | — | un relevé d'un chantier hors des listes ne donne pas d'alerte (`PageAlertes.jsx`) |
| États financiers | montrés | `EtatsFinanciers.jsx` |
| Simulation d'une opération (« Planifier ») | retirés (comme avant) | `planningOperationV1.mjs` |
| Moteur et replanification du planning | retirés (comme avant) | `planningEngineAdapterV1.js`, `planningReplanningAdapterV1.js` |
| Espace ouvrier — Chantiers | montrés | `OuvrierChantiers.jsx` |
| Espace ouvrier — Mes phases | « Autres chantiers » sans les terminés, groupe « Terminés » à part (comme avant) | `OuvrierMesPhases.jsx` |
| Espace ouvrier — Commande, Notes, mémos chantier | montrés | `OuvrierCommande.jsx`, `OuvrierNotes.jsx` |
| Rapport de journée — « J'ai fait autre chose », heures indirectes | retirés / montrés (comme avant) | `PanneauAutreChose.jsx`, `RapportMobile.jsx` |
| Serveur : dérives historiques des relevés (chantiers terminés) | — | `api/_partage/relevesJournaliers.js` (`estChantierTermine`) |
| Serveur : assistant IA, recherche d'un chantier | montrés | `api/_ia/renovation/outils.js` |

**Listes complètes, volontairement sans ce filtre** (toutes les statuts) :
Chantiers (page de gestion, onglets par statut), Opérations, Réglages et
Chiffrage (on chiffre un chantier avant qu'il soit actif, lot 2). Lot 5 :
Opérations devient la porte d'entrée.

Les pages qui ne font que retrouver le nom d'un chantier par son identifiant
(accueil et planning de l'espace ouvrier, rapprochement des factures)
lisent la table sans filtrer : ce ne sont pas des listes.

---

## Journal de décisions

| Date | Décision | Raison | Comment revenir en arrière |
|---|---|---|---|
| 06/11/2026 | Les anciens blocs `planning_config` « chantiers » et « operations » **restent en place et sont tenus à jour automatiquement** par la base (copie miroir), au lieu d'être figés. | Trois fonctions de l'espace ouvrier côté base (`ouvrier_mes_phases`, `ouvrier_preparation_chantier`, `conducteur_lister_suggestions_materiaux`), le formulaire de rapport ouvert sans connexion et deux tâches serveur lisent encore ces blocs. Les modifier aurait touché à des fonctions à droits élevés et ouvert les nouvelles tables aux visiteurs non connectés. Avec la copie, ils voient exactement la même chose qu'avant. | Script `sql/202611_refonte_operations_lot1_rollback.sql` + annulation de la demande de fusion : le bloc redevient la seule source, et il est à jour. |
| 06/11/2026 | **Synchronisation dans les deux sens** pendant la transition : une modification faite depuis une ancienne version de l'application (onglet resté ouvert) est reportée dans les tables, seulement pour les chantiers qu'elle a changés. | Les tables ont été remplies avant la mise en ligne du nouveau code ; sans ce report, une modification faite entre-temps dans l'ancien écran serait perdue. | Même script de retour arrière (débranche les deux sens). |
| 06/11/2026 | Lecture : tables d'abord ; si elles ne répondent pas, **repli en lecture** sur la copie `planning_config` (journalisé). | La copie est toujours à jour : l'écran reste juste plutôt que vide. Les écritures, elles, ne vont que dans les tables. | — |
| 06/11/2026 | « Supprimer » un chantier ou une opération = **archiver** (date d'archivage), jamais effacer. Aucun droit de suppression sur les nouvelles tables. | « Aucune suppression de donnée » ; un chantier supprimé par erreur se récupère en remettant sa date d'archivage à vide. | — |
| 06/11/2026 | Un chantier créé **sans opération** (Réglages, ou ancienne version de l'application) reçoit automatiquement une opération à son nom. | Le lien obligatoire est garanti par la base, sans casser l'ancien écran pendant la transition. Le lot 2 imposera le choix de l'opération dans le parcours de chiffrage. | — |
| 06/11/2026 | Les identifiants existants sont repris **à l'identique** (texte). Opérations créées automatiquement : identifiant `op_auto_<identifiant du chantier>`, adresse reprise de l'adresse du chantier quand elle existe. | ~40 tables renvoient à ces identifiants. | — |
| 06/11/2026 | Les adresses des chantiers (`planning_config` « chantier_adresses ») **ne sont pas migrées** au lot 1. | Hors périmètre du lot 1 ; le lot 2 ajoute adresse / code postal / ville obligatoires sur le chantier et décidera de leur place. | — |
| 06/11/2026 | La règle `estChantierActif()` a deux usages : « en vie » (sans les terminés, là où on les retirait déjà) et `inclureTermines` (là où on les montrait déjà). Le statut « Terminé » n'est pas « hors exploitation ». | Aucune page ne change de comportement au lot 1 ; le lot 2 n'a qu'une constante à compléter. | — |

---

## Données migrées

Comptes lus en base le 06/11/2026 (requêtes sur la base de production).

| | Avant (bloc `planning_config`) | Après (tables) |
|---|---|---|
| Opérations | 12 | 19 (12 reprises + 7 créées automatiquement) |
| Chantiers | 46 | 46, identifiants, noms, couleurs, statuts et ordre identiques (contrôlé chantier par chantier) |
| Chantiers sans opération | 7 | 0 |
| Statuts des chantiers | 6 en cours, 15 terminés, 25 sans statut (affichés « Planifié ») | identiques |

Sauvegarde avant reprise : table `planning_config_sauvegarde_refonte`
(3 lignes : blocs « chantiers », « operations », « chantier_adresses » tels
qu'ils étaient le 06/11/2026). Migration :
`supabase/migrations/20261106045027_refonte_operations_lot1.sql`, essayée
d'abord dans une transaction annulée (mêmes comptes, plus quatre essais :
modification depuis l'ancien écran, depuis le nouveau, création sans
opération des deux côtés), puis appliquée.

**Opérations créées automatiquement** (un seul logement chacune) :

| Opération | Chantier | Statut du chantier | Adresse reprise |
|---|---|---|---|
| LAMARTINE | LAMARTINE | sans statut | — |
| METOIS | METOIS | sans statut | 8 rue Yvonne Angers |
| GILDAS BAUGE 2 | GILDAS BAUGE 2 | terminé | 2 rue Basse Baugé en Anjou |
| LOU | LOU | terminé | — |
| 14 BOULEVARD DU ROI RENÉ | 14 BOULEVARD DU ROI RENÉ | terminé | 14 boulevard du roi rené Angers |
| MAUDUIT | MAUDUIT | terminé | — |
| DÉPOT | DÉPOT | en cours | — |

Les étapes du cycle de vie ne sont pas concernées par le lot 1 (lot 3).

---

## À faire par Loris

- Rien pour le lot 1.
- À regarder quand vous testerez : les 7 opérations créées automatiquement
  ci-dessus. Vous pouvez déplacer ces chantiers dans une autre opération
  (Réglages → Chantiers) puis supprimer l'opération devenue vide. Le DÉPOT
  (stock) a lui aussi reçu une opération : à vous de dire s'il doit en avoir
  une à part.

---

## Plan de test

### Lot 1

1. **Opérations** : la page s'ouvre ; les 12 opérations habituelles sont là
   avec leurs chantiers, plus 7 nouvelles (LAMARTINE, METOIS, GILDAS BAUGE 2,
   LOU, 14 BOULEVARD DU ROI RENÉ, MAUDUIT, DÉPOT) d'un logement chacune.
2. **Chantiers** : changer le statut d'un chantier (ex. En cours → En pause).
   Recharger la page : le statut est conservé. Sur un deuxième poste ouvert
   en même temps, le changement apparaît en quelques secondes.
3. **Écrasement** : sur deux postes, changer en même temps le statut de deux
   chantiers différents. Recharger : les deux changements sont conservés.
4. **Planning hebdo** : un chantier « Terminé » n'apparaît pas ; les autres
   oui, comme avant. Passer un chantier en Terminé : il disparaît du planning.
5. **Bilan** : même liste de chantiers qu'avant (sans les terminés ni le DÉPOT).
6. **Réglages → Chantiers** : créer un chantier « TEST LOT 1 » avec
   « Nouvelle opération à son nom » → une opération « TEST LOT 1 » apparaît
   dans Réglages → Opérations. Le déplacer vers une autre opération, puis
   supprimer le chantier et l'opération vide : ils disparaissent des listes.
7. **Espace ouvrier** (téléphone d'un ouvrier) : onglet Chantiers, mêmes
   chantiers qu'avant, regroupés par opération ; Mes phases, Commande et
   Notes proposent les mêmes chantiers qu'avant.
8. **Rapport de journée** (formulaire du téléphone) : la liste des chantiers
   proposée est la même qu'avant.
9. **États financiers** : la liste des chantiers à rattacher est la même
   qu'avant (terminés compris).
