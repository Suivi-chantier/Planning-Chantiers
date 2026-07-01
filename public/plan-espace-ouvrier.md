# Plan d'action — Espace ouvrier authentifié

Objectif global : donner aux ouvriers de vrais comptes (auth Supabase) et un espace dédié
mobile-first à 4 onglets — **Tableau de bord**, **Planning**, **Compte rendu**, **Demande
commande** — sans casser le formulaire public actuel, qui reste accessible jusqu'à la bascule.

---

## Décisions arrêtées

- **Sécurité RLS : verrouillage complet dès la Phase 0.** On ne se contente pas de masquer des
  pages ; on réécrit les policies de toutes les tables pour distinguer les rôles. Voir Phase 0.
- **Prénoms tous distincts** dans le planning → le pont compte ↔ prénom est une jointure directe
  sur `prenom_planning`, sans mécanisme de désambiguïsation. On fige la règle « un prénom-planning
  = une personne » (déjà implicitement imposée par le code : `ouvrier_emails` et les crons keyent
  par prénom).
- **Session : longue par défaut.** Le client Supabase persiste la session et rafraîchit le token
  tout seul → l'ouvrier se connecte une fois puis reste connecté des semaines. Rien à construire,
  juste ne pas raccourcir ce comportement.
- **Notifications planning : indicateur visuel en V1**, vraie notif push PWA reportée à plus tard.
- **Hors-ligne : brouillon local solide en V1** (déjà en place), vraie file d'attente offline +
  synchro à la reconnexion reportée à plus tard.

---

## Décisions d'architecture

1. **Espace ouvrier séparé, pas un rôle bridé dans `MainApp`.**
   `MainApp` (Rénovation) charge tout le lourd (planning conducteur, phasage, commandes,
   états financiers…). On crée un composant dédié `EspaceOuvrier` routé au niveau de
   `authState`, sur le même modèle que la branche Invest (`PageInvest`). L'ouvrier ne charge
   que ce dont il a besoin.

2. **Le pont compte ↔ prénom est le cœur du chantier.**
   Tout le métier identifie les ouvriers par **prénom en texte libre** (`planning_cells.ouvriers[]`,
   `rapports.ouvrier`, `besoins.ouvrier_demandeur`, `pointages.ouvrier`). L'auth identifie par
   **email / rôle** (`utilisateurs`). Chaque compte ouvrier doit porter son **prénom-planning**
   pour relier les deux. Sans ça, un ouvrier connecté ne voit « rien » car l'app ignore que son
   compte = « Kevin » dans le planning. On généralise l'idée déjà présente dans
   `planning_config.ouvrier_emails` (prénom → email), mais posée proprement sur `utilisateurs`.

3. **La sécurité vit dans les RLS Supabase, pas dans `access.js`.**
   `access.js` masque des pages côté front ; il ne protège pas la base. État actuel constaté :
   RLS activées partout mais **toutes les policies sont permissives** (`using (true)`), et
   `pointages` (qui contient les taux horaires) est même en `public_all` → lisible sans être
   connecté. Dès qu'un ouvrier a un compte, il peut interroger l'API et lire les salaires et les
   marges. On verrouille donc complètement en Phase 0.

   **Subtilité critique — le rôle `anon` :** le formulaire public écrit en tant que `anon`
   (ouvrier non connecté). Une policy `besoins_ins ... to anon` l'autorise déjà, et le formulaire
   lit aussi `planning_cells` en `anon` pour charger les tâches du jour. Le verrouillage doit être
   **chirurgical** : conserver exactement les chemins `anon` du formulaire public (insert
   `rapports`, insert `besoins`, select `planning_cells`) et fermer tout le reste. Verrouiller
   sans distinguer `anon` = casser le formulaire public = violer l'invariant ci-dessous.

**Invariant permanent :** le formulaire public `PageRapportMobile` (servi par URL contenant
« rapport », avant tout contrôle d'auth) doit continuer à fonctionner à l'identique tant que
la bascule n'est pas décidée. Si ce n'est plus le cas, on s'arrête.

---

## Récap de l'existant à RÉUTILISER (ne pas reconstruire)

- **Auth** : login `PageLogin` → `signInWithPassword` → profil depuis `utilisateurs` → `onLogin`.
  Invitation via Edge Function `admin-users` (action `invite`) + création de mot de passe (`creer-mdp`).
- **Rôles & accès** : `src/access.js` + `planning_config` (rôles et matrice éditables depuis Admin → Accès).
- **Compte rendu** : `src/Renovation/RapportMobile.jsx` (prénom, tâches, photos, brouillon,
  écriture dans `rapports` **et** `besoins`).
- **Demandes de commande** : table `besoins` (statut `en_attente`/`traite`/`annule`), déjà lue par
  la page `Commandes`, comptée sur le Dashboard conducteur, et envoyée dans `cron-recap-commandes`.
- **Planning** : table `planning_cells` (`chantier_id`, `jour`, `week_id`, `ouvriers[]`, `taches[]`, `planifie`).
- **Table comptes** : `utilisateurs` (`id`, `email`, `nom`, `role`, `branches[]`, `actif`).

---

## Phase 0 — Fondations données & sécurité (verrouillage complet)

**Objectif :** poser le rôle, le pont compte↔prénom et surtout la sécurité RLS AVANT toute UI.
C'est la phase la plus délicate : une policy fausse casse silencieusement une page qui marche
(côté bureau) OU le formulaire public. À traiter comme une migration isolée et réversible, testée
page par page avant de continuer.

- Ajouter le rôle `ouvrier` dans `src/access.js` (rôles Rénovation) et définir ses pages
  autorisées : `dashboard`, `planning`, `compte-rendu`, `demande-commande` (identifiants dédiés
  à l'espace ouvrier, distincts des pages conducteur).
- Ajouter sur `utilisateurs` une colonne `prenom_planning` (text) : le prénom exact utilisé dans
  le planning et les rapports. Clé de jointure métier. Unique (règle « un prénom = une personne »).
- **Helper de rôle en base** : une fonction SQL `SECURITY DEFINER` (ex. `public.mon_profil()`)
  qui lit, pour le `auth.uid()`/email courant, le `role` et le `prenom_planning` dans
  `utilisateurs`. Toutes les policies s'appuient dessus. (Éviter de requêter `utilisateurs`
  directement dans une policy sans passer par une fonction, sous peine de récursion RLS.)
- **Réécrire les policies de toutes les tables** selon trois profils :
  - **Rôles bureau** (`admin`, `conducteur`, `commercial`, `comptable`) : accès large conservé
    (`using(true)`) → aucune page existante ne casse.
  - **Rôle `ouvrier`** : accès restreint à ses propres lignes — `rapports`/`besoins` filtrés par
    `prenom_planning`, `planning_cells` où son prénom est dans `ouvriers[]` (lecture seule), et
    **aucun accès** aux tables sensibles (`pointages`, `commandes`, `commande_lignes`, `factures`,
    `facture_bl`, `data_history`, `phasages`…).
  - **Rôle `anon`** : uniquement les chemins du formulaire public — insert `rapports`, insert
    `besoins`, select `planning_cells`. Retirer les `public_all` trop larges (notamment sur
    `pointages`, `phasages_history`, `data_history`, `chantier_notes`) pour qu'`anon` ne lise plus
    rien de sensible.

**Contraintes :** migration non destructive et réversible ; `prenom_planning` nullable pour les
comptes existants ; ne rien retirer aux rôles bureau ; ne pas rompre les chemins `anon` listés.
Idéalement tester sur une base de staging / branche Supabase avant la prod.

**Critère d'acceptation :** (1) chaque page existante fonctionne encore pour admin/conducteur/
commercial/comptable ; (2) le formulaire public charge les tâches, envoie un rapport et une
demande de matériel comme avant ; (3) un compte `ouvrier` (`prenom_planning="Kevin"`) ne lit via
l'API que les rapports/besoins de Kevin et ses cellules planning, et reçoit une erreur/vide sur
`pointages` et les tables financières.

---

## Phase 1 — Création des comptes ouvriers depuis l'Admin

**Objectif :** permettre au conducteur/admin de créer un compte ouvrier et de le relier à son prénom.

- Dans `src/Renovation/Admin.jsx` (onglet Utilisateurs / invitation), autoriser le rôle `ouvrier`
  dans le sélecteur et afficher, quand le rôle est `ouvrier`, un champ **Prénom-planning**
  (idéalement une liste déroulante alimentée par `DEFAULT_OUVRIERS` / la config `ouvriers` pour
  éviter les fautes de frappe et garantir la correspondance exacte).
- À l'invitation, écrire `prenom_planning` dans la ligne `utilisateurs`. Réutiliser le flux
  `admin-users` (`invite`) existant, sans le dupliquer.
- Prénoms tous distincts confirmé → imposer simplement l'unicité de `prenom_planning` (refuser
  deux comptes actifs sur le même prénom). Pas de mécanisme de désambiguïsation à prévoir.

**Contraintes :** ne pas modifier le flux d'invitation des autres rôles ; réutiliser `callAdminUsers`.

**Critère d'acceptation :** j'invite « kevin@… » en rôle ouvrier lié au prénom « Kevin » ;
il reçoit l'email, crée son mot de passe, et son profil porte bien `role=ouvrier` + `prenom_planning="Kevin"`.

---

## Phase 2 — Routage & coquille de l'espace ouvrier

**Objectif :** router les ouvriers vers un espace dédié après connexion, avec la navigation à 4 onglets.

- Dans `src/App.jsx`, après login/checkSession : si `profil.role === "ouvrier"`, forcer
  `authState = "ouvrier"` (court-circuiter la sélection de branche / le portail).
- Ajouter le rendu `authState === "ouvrier"` → nouveau composant `<EspaceOuvrier user={} profil={} onLogout={} />`.
- Créer `src/Renovation/EspaceOuvrier.jsx` : coquille mobile-first avec une bottom-nav à 4 onglets
  (Tableau de bord, Planning, Compte rendu, Demande commande), état de page interne, bouton
  déconnexion. Réutiliser le thème/typo existants (`THEMES`, `FONT`, `RADIUS`) et l'esthétique
  déjà employée dans `RapportMobile.jsx`. Onglets en placeholders à ce stade.

**Contraintes :** ne pas charger les pages lourdes de `MainApp` ; ne pas toucher au routage
`renovation`/`invest`/`portail` existant ; conserver la persistance de session PWA (session
longue → l'ouvrier ne se reconnecte quasi jamais).

**Critère d'acceptation :** Kevin se connecte → arrive directement sur l'espace ouvrier avec
4 onglets navigables (placeholders) ; un admin/conducteur, lui, arrive comme avant.

---

## Phase 3 — Onglet Tableau de bord

**Objectif :** en un coup d'œil, savoir où aller aujourd'hui et quoi faire.

- Reprendre la logique de `Dashboard.jsx` (chantiers du jour via `planning_cells` du `week_id`
  courant) **filtrée sur `prenom_planning`**.
- Afficher : chantier(s) du jour, adresse avec lien qui ouvre le GPS, horaires si dispo, tâches
  prévues (`taches`/`planifie`), et un gros bouton « Faire mon compte rendu » qui bascule sur
  l'onglet Compte rendu.
- Optionnel : petit indicateur « compte rendu du jour : rendu / à faire ».

**Contraintes :** lecture seule ; aucune donnée financière ; aucune donnée d'un autre ouvrier.

**Critère d'acceptation :** Kevin voit son chantier du jour, son adresse cliquable et ses tâches,
et le bouton l'emmène directement sur son compte rendu pré-rempli.

---

## Phase 4 — Onglet Planning

**Objectif :** consulter son planning à venir, en lecture seule.

- Lister les `planning_cells` où `prenom_planning` figure dans `ouvriers[]`, sur la semaine
  courante et les suivantes ; pour chaque : jour, chantier, adresse cliquable, tâches, durée si présente.
- Navigation simple entre semaines.
- Prévenir l'ouvrier d'un changement : en V1, un **indicateur visuel** dans l'onglet Planning
  (badge « modifié » / rafraîchissement). La vraie notif push PWA est reportée à une phase
  ultérieure (service worker + permissions + abonnements stockés).

**Contraintes :** lecture seule (seul le conducteur affecte) ; pas d'accès aux plannings des autres.

**Critère d'acceptation :** Kevin voit uniquement ses affectations, semaine par semaine, sans
pouvoir rien modifier.

---

## Phase 5 — Onglet Compte rendu

**Objectif :** le compte rendu de fin de journée, dérivé de l'existant, sans l'étape « c'est qui ? ».

- Dériver `RapportMobile.jsx` en version authentifiée : **supprimer l'étape login/sélection du
  prénom** (le `prenom_planning` vient de la session), pré-remplir le chantier depuis le planning
  du jour, et conserver tout le reste (tâches, statuts, photos, brouillon local, écriture dans
  `rapports` + génération de `besoins` pour les demandes de matériel).
- Factoriser plutôt que dupliquer la logique de soumission de `RapportMobile.jsx` (le formulaire
  public et la version authentifiée doivent écrire de la même façon dans `rapports`/`besoins`).
- Compression automatique des photos avant upload (les photos de chantier sont énormes et
  échouent sur mauvaise connexion). Hors-ligne V1 : conserver le **brouillon local** robuste déjà
  présent (rien n'est perdu si le réseau tombe) ; la vraie file d'attente offline + synchro à la
  reconnexion est reportée à une phase ultérieure.

**Contraintes :** ne pas dégrader le formulaire public ; même schéma d'écriture `rapports`/`besoins`.

**Critère d'acceptation :** Kevin ouvre l'onglet, son prénom et son chantier sont déjà connus,
il remplit et envoie ; le rapport apparaît côté conducteur comme un rapport normal.

---

## Phase 6 — Onglet Demande commande

**Objectif :** relier le terrain à l'appro, avec un retour de statut à l'ouvrier.

- Vue dédiée sur la table `besoins` filtrée sur `prenom_planning` :
  - un formulaire de saisie hors compte rendu (article/description libre, quantité, chantier,
    photo, urgence) qui écrit dans `besoins` avec `origine="ouvrier"`, `statut="en_attente"` ;
  - la liste de ses demandes avec leur statut (`en_attente` / `traite` / `annule`) → ferme la
    boucle : aujourd'hui l'ouvrier n'a aucun retour.
- Réutiliser le circuit existant : ces `besoins` remontent déjà dans la page `Commandes`, le
  Dashboard conducteur et le récap mail `cron-recap-commandes` — ne rien recâbler.

**Contraintes :** réutiliser le modèle `besoins` existant ; ne pas créer de table parallèle.

**Critère d'acceptation :** Kevin crée une demande → elle apparaît côté conducteur comme
aujourd'hui ; quand le conducteur la passe à `traite`, Kevin voit le statut changer.

---

## Phase 7 — Coexistence & bascule

**Objectif :** garder le formulaire public le temps de préparer les ouvriers, puis basculer proprement.

- Ne pas toucher à la route publique `PageRapportMobile` (servie par URL avant l'auth) : elle
  reste le point d'entrée sans compte pendant la transition.
- Prévoir un interrupteur simple (ex. clé dans `planning_config`) pour, le jour voulu, orienter
  les ouvriers vers l'espace authentifié (et éventuellement afficher un bandeau « connectez-vous »
  sur le formulaire public).
- Vérifier que `rapports`/`besoins` acceptent les deux origines (anonyme via lien public,
  authentifiée via espace ouvrier) sans conflit — colonnes liées au compte nullable.
- Déploiement progressif : tester avec 1–2 ouvriers volontaires avant d'ouvrir à toute l'équipe.

**Critère d'acceptation :** pendant la transition, le lien public et l'espace authentifié
fonctionnent en parallèle ; la bascule se fait sans migration ni interruption.

---

## Ordre recommandé
0 (fondations + RLS) → 1 (création comptes) → 2 (routage + coquille) → 3 (dashboard) →
4 (planning) → 5 (compte rendu) → 6 (demande commande) → 7 (coexistence + bascule).

## Points tranchés (rappel)
- Sécurité RLS → **verrouillage complet en Phase 0** (avec préservation chirurgicale des chemins `anon`).
- Homonymes → **aucun** ; prénoms tous distincts, jointure directe sur `prenom_planning`.
- Session → **longue par défaut** (comportement natif Supabase).
- Notifications planning → **indicateur visuel** en V1.
- Hors-ligne → **brouillon local** en V1.

## Reporté à une phase ultérieure (hors périmètre V1)
- Notification push PWA sur changement de planning.
- Vraie file d'attente hors-ligne + synchro à la reconnexion pour le compte rendu.
