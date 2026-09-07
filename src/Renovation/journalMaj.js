// src/Renovation/journalMaj.js — Contenu du « Journal des MAJ ».
//
// Une entrée = une mise à jour visible pour les utilisateurs, expliquée en
// langage courant. Le composant PageJournalMaj.jsx lit ce fichier tel quel :
// pour publier une nouvelle mise à jour, il suffit d'ajouter une entrée EN
// TÊTE du tableau ci-dessous (les entrées sont triées par date décroissante
// à l'affichage, mais autant garder le fichier lisible).
//
// Champs :
//   date   : "AAAA-MM-JJ" (date de mise en ligne)
//   type   : "nouveaute" | "amelioration" | "correctif"
//   titre  : une ligne, ce que l'utilisateur retient
//   pages  : [{ id, label }] pages de l'appli concernées (id = ids de access.js)
//            — laisser [] si c'est transversal (toute l'appli)
//   quoi   : à quoi ça sert (le bénéfice, pour qui)
//   comment: comment ça fonctionne (où cliquer, ce qui se passe)

export const TYPES_MAJ = {
  nouveaute:    { label: "Nouveauté",    color: "#22c55e" },
  amelioration: { label: "Amélioration", color: "#4db8ff" },
  correctif:    { label: "Correctif",    color: "#f59e0b" },
};

export const JOURNAL_MAJ = [
  // ── SEPTEMBRE 2026 ─────────────────────────────────────────────────────────
  {
    date: "2026-09-07",
    type: "nouveaute",
    titre: "Inventaire des équipes : qui détient quel matériel",
    pages: [{ id: "inventaire-equipes", label: "Inventaire des équipes" }],
    quoi: "Savoir à tout moment quel matériel est entre les mains de chaque ouvrier. Chaque outil est identifié par le code unique inscrit dessus (ex. P-012 sur une perceuse), et la recherche répond directement à « qui a cet outil ? ».",
    comment: "La page liste tous les ouvriers du planning ; un clic sur un ouvrier affiche le matériel mis à sa disposition, avec le code de chaque outil bien en évidence, son état (bon, usé, hors service) et sa date de remise. Le matériel non affecté apparaît dans « Au dépôt ». On ajoute un outil avec « Nouvel outil », et la barre de recherche retrouve un outil par son code, son nom ou son détenteur.",
  },
  {
    date: "2026-09-07",
    type: "nouveaute",
    titre: "Journal des MAJ : cette page",
    pages: [{ id: "journal-maj", label: "Journal des MAJ" }],
    quoi: "Savoir ce qui a changé dans l'application sans avoir à le découvrir par hasard : chaque mise à jour est expliquée ici, avec son utilité et son fonctionnement.",
    comment: "La page liste les mises à jour de la plus récente à la plus ancienne, regroupées par mois. On peut filtrer par type (nouveauté, amélioration, correctif), chercher un mot-clé, et cliquer sur la page concernée pour l'ouvrir directement. Les entrées publiées depuis votre dernière visite portent une pastille « Nouveau ».",
  },
  {
    date: "2026-09-07",
    type: "amelioration",
    titre: "Notes & To-do : notes détaillées, mises à jour horodatées et emails",
    pages: [{ id: "notes-todo", label: "Notes & To-do" }],
    quoi: "Une tâche peut maintenant porter tout son contexte : une note descriptive, plusieurs assignés, et un fil de mises à jour daté. Les personnes concernées sont prévenues par email, y compris du détail de la tâche.",
    comment: "Sur chaque tâche : un champ note pour décrire le travail, des boutons d'échéance rapide (aujourd'hui, demain, cette semaine…), et la possibilité d'assigner plusieurs personnes. Chaque ajout de mise à jour est horodaté et déclenche un email aux assignés. L'email d'assignation reprend la note et les détails de la tâche.",
  },
  {
    date: "2026-09-07",
    type: "amelioration",
    titre: "Bilan de semaine : marge nette générée par chantier",
    pages: [{ id: "bilan-semaine", label: "Bilan de semaine" }],
    quoi: "Voir en un coup d'œil non seulement le chiffre d'affaires généré dans la semaine par chaque chantier, mais aussi la marge nette que cette production a réellement dégagée.",
    comment: "Dans l'accordéon financier du bilan, la marge nette générée s'affiche à côté du CA généré pour chaque chantier. Les chantiers qui n'ont pas encore de snapshot hebdomadaire sont désormais comptés dans le généré (au lieu d'être ignorés).",
  },
  {
    date: "2026-09-04",
    type: "nouveaute",
    titre: "Planning semaine : déplacer des tâches vers une autre semaine",
    pages: [{ id: "planning", label: "Planning semaine" }],
    quoi: "Quand un chantier glisse, plus besoin de tout re-saisir : les tâches planifiées se déplacent vers une autre semaine en quelques clics. Un mode « tout le jour » permet aussi de déplacer une journée entière.",
    comment: "Depuis la cellule du planning, choisir le déplacement vers une autre semaine : les tâches sont recopiées sur la semaine cible et retirées de la semaine d'origine, en gardant leur lien avec le phasage. Le mode « tout le jour » sélectionne d'un coup toutes les tâches du jour.",
  },
  {
    date: "2026-09-04",
    type: "correctif",
    titre: "Validation : garde-fou sur les heures saisies",
    pages: [{ id: "validation", label: "Validation fin de journée" }],
    quoi: "Éviter qu'une faute de frappe (ex. 80 h au lieu de 8 h) ne fausse les pointages, la paie et les coûts de main-d'œuvre.",
    comment: "À la validation d'un compte rendu, les heures manifestement anormales sont détectées et signalées avant l'enregistrement : il faut confirmer ou corriger la valeur.",
  },

  // ── AOÛT 2026 ──────────────────────────────────────────────────────────────
  {
    date: "2026-08-28",
    type: "nouveaute",
    titre: "Planning de référence (baseline)",
    pages: [{ id: "planning", label: "Planning semaine" }],
    quoi: "Figer une « photo » du planning à un instant donné pour pouvoir comparer ensuite le prévu initial et le réalisé, et mesurer les dérives.",
    comment: "Un panneau « Planning de référence » permet de prendre une version de référence du planning et de consulter les versions figées. Les affectations sont verrouillables individuellement pour protéger ce qui est acté.",
  },
  {
    date: "2026-08-28",
    type: "nouveaute",
    titre: "Ressources & indisponibilités : la capacité réelle dans le planning",
    pages: [{ id: "admin", label: "Réglages" }, { id: "planning", label: "Planning semaine" }],
    quoi: "Le planning connaît maintenant la disponibilité réelle de chacun : absences, congés et capacité par jour. On ne peut plus surcharger quelqu'un sans le voir.",
    comment: "Dans Réglages, un écran « Ressources et indisponibilités » liste les ouvriers avec leurs absences. À l'affectation dans le planning, la capacité restante de la journée est calculée en tenant compte du rythme 4 j/5 j et des absences (une absence journée met le plafond à 0 h).",
  },
  {
    date: "2026-08-28",
    type: "nouveaute",
    titre: "Prévisionnel client : document PDF généré depuis le planning",
    pages: [{ id: "phasage-v2", label: "Phasage" }, { id: "chemin-de-fer", label: "Chemin de fer" }],
    quoi: "Remettre au client un calendrier prévisionnel propre et professionnel, sans le refaire à la main : il est généré depuis le planning réel, chantier par chantier ou pour toute l'opération.",
    comment: "Export PDF « Prévisionnel » avec une mise en page premium : frise horizontale « Vue d'ensemble », chips de synthèse, détail par groupe de tâches. Le Chemin de fer propose aussi un PDF « Dossier de plans » de l'opération, pensé comme document client.",
  },
  {
    date: "2026-08-27",
    type: "amelioration",
    titre: "Compte rendu ouvrier : rattrapage d'un jour manqué et envoi fiabilisé",
    pages: [],
    quoi: "Un ouvrier qui a oublié son compte rendu la veille peut le rattraper lui-même, et l'envoi fonctionne du premier coup (fini le « il faut envoyer deux fois »).",
    comment: "Dans l'espace ouvrier, le compte rendu accepte la saisie d'un jour passé non déclaré. Le bouton d'envoi a été fiabilisé : l'enregistrement est confirmé ou l'erreur est affichée, sans état intermédiaire trompeur.",
  },
  {
    date: "2026-08-25",
    type: "nouveaute",
    titre: "Espace ouvrier : section « À reprendre »",
    pages: [],
    quoi: "Les tâches commencées mais non terminées ne disparaissent plus : elles restent visibles pour l'équipe jusqu'à ce qu'elles soient vraiment finies.",
    comment: "Sur le tableau de bord de l'espace ouvrier, une section « À reprendre » liste les tâches entamées non soldées. L'équipe affichée vient du planning (pas seulement du phasage), et ces tâches sont proposées directement dans le formulaire de compte rendu.",
  },
  {
    date: "2026-08-22",
    type: "nouveaute",
    titre: "Barre « Mes tâches » sur toutes les pages",
    pages: [{ id: "notes-todo", label: "Notes & To-do" }],
    quoi: "Ne plus perdre de vue ses tâches assignées : elles suivent l'utilisateur partout dans l'application, sans devoir retourner sur la page Notes & To-do.",
    comment: "Une bulle persistante en bas d'écran affiche les tâches qui vous sont assignées, sur toutes les pages Rénovation. Un clic ouvre le détail ; un lien renvoie vers la page Notes & To-do complète.",
  },
  {
    date: "2026-08-21",
    type: "nouveaute",
    titre: "Espace ouvrier : onglet Chantiers avec plans et heures",
    pages: [{ id: "plans", label: "Plans" }],
    quoi: "L'ouvrier accède depuis son téléphone aux vrais plans du chantier et voit où en sont les heures : vendues vs réelles, ouvrage par ouvrage.",
    comment: "Nouvel onglet « Chantiers » dans l'espace ouvrier : chaque chantier affiche ses plans (les mêmes que la page Plans du bureau) et un comparatif heures vendues / heures réelles par ouvrage. Le planning ouvrier permet aussi de naviguer librement entre les semaines.",
  },
  {
    date: "2026-08-21",
    type: "amelioration",
    titre: "Connexion : arrivée sur la première page autorisée",
    pages: [],
    quoi: "Un utilisateur au périmètre restreint n'atterrit plus sur « Accès refusé » à la connexion.",
    comment: "À l'ouverture de l'application, si le rôle n'a pas accès au tableau de bord, on bascule automatiquement sur la première page autorisée de son profil.",
  },
  {
    date: "2026-08-20",
    type: "nouveaute",
    titre: "Rythme de travail 4 jours / 5 jours",
    pages: [{ id: "planning", label: "Planning semaine" }, { id: "heures-salaries", label: "Heures des salariés" }],
    quoi: "L'application intègre l'alternance de l'entreprise : semaines impaires à 4 jours, semaines paires à 5 jours (depuis le 24/08/2026). Capacités, plannings et heures attendues suivent automatiquement.",
    comment: "Le rythme est calculé depuis le numéro de semaine ISO, à un seul endroit du code. Le planning, la capacité par jour et les heures attendues par salarié s'adaptent sans réglage manuel.",
  },
  {
    date: "2026-08-19",
    type: "amelioration",
    titre: "Phasage : KPI « Marge prévisionnelle »",
    pages: [{ id: "phasage-v2", label: "Phasage" }],
    quoi: "Connaître dès le phasage la marge attendue du chantier, avant même le premier jour de travaux.",
    comment: "Un indicateur calcule la marge prévisionnelle : vendu moins déboursé prévu (main-d'œuvre + matériaux) moins frais généraux prévus. Il s'affiche dans le bandeau KPI du phasage.",
  },
  {
    date: "2026-08-16",
    type: "amelioration",
    titre: "Biblio. ouvrages : dupliquer et réordonner",
    pages: [{ id: "bibliotheque", label: "Biblio. ouvrages" }],
    quoi: "Créer une déclinaison d'un ouvrage existant sans tout re-saisir, et ranger les sous-tâches dans le bon ordre d'exécution.",
    comment: "Bouton « Dupliquer » sur chaque ouvrage de la bibliothèque, et flèches haut/bas pour réordonner les sous-tâches.",
  },
  {
    date: "2026-08-08",
    type: "nouveaute",
    titre: "Socle technique IA : fondations posées",
    pages: [{ id: "admin", label: "Réglages" }],
    quoi: "Préparer l'arrivée de fonctions IA dans l'application (analyses, propositions) avec des garde-fous : chaque appel est journalisé, plafonné, et un coupe-circuit permet de tout arrêter.",
    comment: "Une route serveur unique /api/ai centralise les appels IA : authentification, autorisation par rôle, journalisation en base (table ia_jobs), quotas par utilisateur et par jour, plafonds de coût et coupe-circuit global. Une tâche de test « ping » permet de vérifier la chaîne de bout en bout.",
  },

  // ── JUILLET 2026 ───────────────────────────────────────────────────────────
  {
    date: "2026-07-30",
    type: "nouveaute",
    titre: "Factures de situation sur l'avancement",
    pages: [{ id: "chantiers", label: "Chantiers" }, { id: "admin", label: "Réglages" }],
    quoi: "Ne plus rater une facturation intermédiaire : quand l'avancement d'un chantier franchit un seuil, l'application le signale et prévient les bonnes personnes par email.",
    comment: "Les seuils d'avancement sont réglables dans Réglages (onglet « Fact. de situation »), ainsi que les rôles notifiés. Sur la frise du chantier, les jalons de facturation apparaissent sur l'avancement ; le franchissement déclenche un email automatique.",
  },
  {
    date: "2026-07-29",
    type: "nouveaute",
    titre: "Contrôles de fin de groupe : la qualité tracée sur chantier",
    pages: [{ id: "phasage-v2", label: "Phasage" }, { id: "visite", label: "Visites chantier" }],
    quoi: "Chaque groupe de tâches terminé doit être contrôlé : l'application le rappelle, garde la trace du contrôle et suit les réserves jusqu'à leur levée. C'est ce qui alimente le sommet « Qualité » du QCD.",
    comment: "Un jalon de contrôle est créé automatiquement à la fin de chaque groupe. L'écran de contrôle (pensé mobile d'abord) fonctionne par exception : tout est réputé conforme, on ne saisit que les réserves. Les réserves ont une levée explicite, une ancienneté et des compteurs ; un groupe non contrôlé est signalé en rouge (obligatoire mais jamais bloquant).",
  },
  {
    date: "2026-07-28",
    type: "nouveaute",
    titre: "Fiche chantier : bandeau QCD et frise de cycle de vie",
    pages: [{ id: "chantiers", label: "Chantiers" }],
    quoi: "Lire l'état de santé d'un chantier en une seconde : Qualité / Coût / Délai en tête de fiche, et une frise des 6 phases de vie (devis → SAV) pour savoir où on en est.",
    comment: "Le bandeau QCD calcule automatiquement chaque sommet (avec correction manuelle possible). La frise affiche les 6 phases avec validation d'étape par action et pièces jointes sur chaque étape ; la phase Travaux est branchée sur l'avancement réel des groupes.",
  },
  {
    date: "2026-07-28",
    type: "amelioration",
    titre: "Brouillons automatiques : plus de saisie perdue",
    pages: [],
    quoi: "Une mise à jour de l'application ou une fausse manipulation ne fait plus perdre un formulaire en cours de saisie.",
    comment: "Les saisies sont protégées par un garde global : l'application ne se recharge jamais pendant qu'un champ est en cours d'édition, et les formulaires longs conservent un brouillon local restauré à la réouverture.",
  },
  {
    date: "2026-07-28",
    type: "nouveaute",
    titre: "Bilan de semaine : la page complète",
    pages: [{ id: "bilan-semaine", label: "Bilan de semaine" }],
    quoi: "Un point hebdomadaire multi-chantiers en une page : finances par chantier, points d'attention automatiques, projections, et un PDF de restitution propre à diffuser.",
    comment: "La page se choisit une semaine et charge tout : accordéon financier par chantier (marge, dérive par lot, KPI cliquables avec leur méthode de calcul), points d'attention détectés automatiquement (dérive de marge, stagnation, compte rendu manquant, lot démarrant sous 15 jours sans commande), bloc projections (marge à terminaison, reste à faire, situation à facturer), saisie des blocages et de la semaine suivante, export PDF sélectif. Un instantané financier est archivé chaque vendredi soir pour suivre l'évolution.",
  },
  {
    date: "2026-07-27",
    type: "nouveaute",
    titre: "Équipes et groupes types : les référentiels de l'exécution",
    pages: [{ id: "admin", label: "Réglages" }, { id: "phasage-v2", label: "Phasage" }],
    quoi: "Standardiser la façon dont les chantiers s'exécutent : 12 étapes types (démolition → finitions) et des équipes nommées avec responsable, membres et intervenants externes. L'affectation d'une équipe sur un groupe se fait en un clic.",
    comment: "Deux référentiels dans Réglages : « Groupes types » (les 12 étapes, avec équipe par défaut et ouvriers prioritaires) et « Équipes » (responsable, membres, marquage externe, date de disponibilité). Dans le phasage, les groupes chrono sont semés depuis les groupes types et le bouton « Affecter l'équipe » pré-remplit les ouvriers sur toutes les tâches du groupe.",
  },
  {
    date: "2026-07-27",
    type: "nouveaute",
    titre: "Comptes sans adresse email",
    pages: [{ id: "admin", label: "Réglages" }],
    quoi: "Créer un compte à un ouvrier qui n'a pas d'adresse email : un identifiant et un mot de passe suffisent.",
    comment: "Dans Réglages, la création de compte accepte un simple identifiant (ex. « jp ») ; l'application gère l'email technique en interne. Une vraie adresse email peut être rattachée plus tard sans rien casser.",
  },
  {
    date: "2026-07-26",
    type: "amelioration",
    titre: "Plans : dessin plus complet et plus fiable",
    pages: [{ id: "plans", label: "Plans" }],
    quoi: "Dessiner des plans plus proches de la réalité du chantier : doublages, cloisons, portes battantes avec leur débattement, largeur des fenêtres… et ne plus jamais perdre un dessin.",
    comment: "Nouveaux outils : doublages/cloisons, gomme par tronçon, saisie des longueurs au clavier, portes battantes 70/80/90 poussant gauche/droite avec arc de débattement. L'éditeur sauvegarde automatiquement (2 s après la dernière modification et à la fermeture).",
  },
  {
    date: "2026-07-23",
    type: "nouveaute",
    titre: "Planning ↔ Phasage : les tâches se planifient depuis le planning",
    pages: [{ id: "planning", label: "Planning semaine" }, { id: "phasage-v2", label: "Phasage" }],
    quoi: "Le planning et le phasage parlent enfin ensemble : on planifie les tâches du phasage directement dans la grille semaine, et les dates prévues se synchronisent toutes seules.",
    comment: "Dans la cellule du planning, un sélecteur propose les tâches du phasage du chantier ; la date prévue de la tâche devient son premier jour planifié. La durée s'appuie sur les heures vendues et se répartit selon le nombre d'ouvriers. Une ligne « Charge » par ouvrier et par jour montre la capacité réelle (rythme 4 j/5 j) et signale les surcharges. L'export PDF tient sur une page, sans les chantiers vides.",
  },
  {
    date: "2026-07-15",
    type: "nouveaute",
    titre: "Vue « Chronologique » du phasage",
    pages: [{ id: "phasage-v2", label: "Phasage" }],
    quoi: "Organiser le chantier comme il va se dérouler : les tâches se rangent dans des groupes ordonnés (corps d'état), avec jalons, dates et export PDF du planning chantier par groupe.",
    comment: "La vue chrono permet le glisser-déposer des tâches entre groupes, le réordonnancement, la multi-sélection, les jalons datés entre tâches, et un encart « Où en est-on ? » (avancement + prochaines tâches). Une template globale des corps d'état pré-génère les groupes ; le Gantt affiche les lots repliables et les jalons.",
  },
  {
    date: "2026-07-15",
    type: "nouveaute",
    titre: "Page « Heures des salariés » : la préparation de la paie",
    pages: [{ id: "heures-salaries", label: "Heures des salariés" }],
    quoi: "Une vue par salarié pour préparer la paie : heures pointées, base 39 h, heures supplémentaires, trajets. Fini le recomptage à la main depuis les comptes rendus.",
    comment: "La page agrège le registre de pointages (alimenté par les validations de fin de journée) par ouvrier et par semaine. Les trajets sont répartis au centime près et pondérés par le temps passé sur chaque chantier. Un outil de diagnostic dans Réglages (onglet Pointages) compare jour par jour le registre et le déclaré, et répare les écarts.",
  },
  {
    date: "2026-07-17",
    type: "amelioration",
    titre: "Saisie commande : anti-doublons et lecture IA plus fiable",
    pages: [{ id: "capture-cmd", label: "Saisie commande" }],
    quoi: "Éviter de compter deux fois le même bon de livraison, et mieux lire les documents difficiles (PDF, gros BL, remises).",
    comment: "À l'enregistrement, l'application détecte si un document identique existe déjà et le signale. L'analyse IA convertit les PDF en images pour les lire, force les prix en HT, ignore les lignes non livrées et répartit les remises globales sur les lignes.",
  },
  {
    date: "2026-07-08",
    type: "nouveaute",
    titre: "Phasage : vue « Prévisionnel » calendrier client",
    pages: [{ id: "phasage-v2", label: "Phasage" }],
    quoi: "Montrer au client un calendrier prévisionnel lisible de son chantier, exportable en PDF.",
    comment: "Une vue dédiée du phasage présente le déroulé sous forme de calendrier orienté client, avec export PDF.",
  },
  {
    date: "2026-07-03",
    type: "nouveaute",
    titre: "Encours fournisseurs : les dépenses par fournisseur et par mois",
    pages: [{ id: "encours-fournisseurs", label: "Encours fournisseurs" }],
    quoi: "Savoir combien on doit à chaque fournisseur et quand : les dépenses sont regroupées par mois d'échéance de paiement (comptant, 30 jours, 30 jours fin de mois).",
    comment: "La page distingue « à payer » et « payé comptant », détaille les documents (BL, tickets, factures) par mois, compare saisi et facturé avec l'écart, et s'exporte en PDF. Un email récapitulatif part chaque vendredi soir aux destinataires choisis dans Réglages.",
  },
  {
    date: "2026-07-03",
    type: "nouveaute",
    titre: "Menu latéral : onglets réorganisables",
    pages: [],
    quoi: "Chacun range le menu à sa façon : les pages les plus utilisées en haut.",
    comment: "Un bouton crayon en bas du menu active le glisser-déposer des onglets. L'ordre est mémorisé par utilisateur et synchronisé : on le retrouve d'un appareil à l'autre.",
  },
];
