# Portail client Invest — plan d'ouverture (proposition)

01/10/2026. **Décisions de Matthieu (01/10/2026)** : (1) le client ne voit que les tâches que
Profero choisit de montrer ; (2) seulement les documents partagés explicitement ;
(3) lecture seule d'abord.

**Avancement** : étape 1 écrite (migration `20261001190000_portail_client_invest_liaison.sql`,
retour arrière dans `sql/`, banc `scripts/verif-portail-client-invest.mjs`, 17/17
conformes sur PGlite, données fictives). **APPLIQUÉE en production le 01/10/2026** (table vide, hook contrôlé : 15 collaborateurs acceptés, 3 désactivés refusés).

Étape 2 écrite (migration `20261001200000_portail_client_invest_lecture.sql`) : indicateur
`invest_mission_actions.visible_client` (faux par défaut) + 4 vues en lecture seule
(`portail_dossier`, `portail_etapes`, `portail_taches`, `portail_evenements`) qui ne montrent
que des colonnes choisies, pour le seul client de l'appelant. Banc : 25/25 conformes, et
3 casses volontaires de la migration détectées. **NON appliquée en production.**
Reste : documents partagés (table + stockage), écran portail, invitation, et une case
« visible client » dans le CRM pour cocher tâches / événements / dossier.
Sans effet immédiat : la table est vide, aucun client n'est accepté, aucune policy
client n'est ouverte.

## Déjà en place (sécurité)
- Hook d'accès : chaque jeton porte `profero_population` (`collaborateur` ou
  `client_invest`). `acces_client_invest_autorise(user_id)` existe et renvoie
  `false` (chantier 1.1 : à brancher).
- 3a : tout compte connecté non collaborateur est refusé partout (101 tables,
  3 buckets). Un client connecté ne voit donc **rien** tant qu'on ne lui ouvre
  rien, table par table.
- Inscription publique fermée ; relais e-mail et Edge Functions Invest fermés.

## Ce qui manque
1. **Lien compte ↔ client** : `invest_clients` n'a qu'un e-mail, aucune colonne
   vers l'identifiant Auth. Il faut une table dédiée (client ↔ compte Auth,
   statut, date d'invitation, révocation). Jamais par e-mail seul.
2. **Brancher `acces_client_invest_autorise`** sur cette table (fermé par
   défaut).
3. **Policies client, lecture seule d'abord**, sur un périmètre minimal :
   - son dossier (`invest_dossiers`) et la progression des étapes ;
   - ses tâches visibles (`invest_mission_actions`) — **à marquer
     explicitement visibles** (une action interne ne doit jamais fuiter) ;
   - ses événements marqués `visible_client` (colonne déjà existante sur
     `invest_dossier_evenements`) ;
   - ses documents (bucket `invest-documents`, par dossier).
   Chaque policy : `profero_population = 'client_invest'` ET client lié au
   compte. La restrictive 3a est adaptée sur ces seules tables.
4. **Écran portail** séparé du bureau, enregistré à part dans `access.js`.
5. **Invitation** d'un client (par un admin) + révocation immédiate.
6. **Test d'étanchéité** : deux clients fictifs, aucun ne voit l'autre ni le
   bureau (même principe que `verif-collaborateurs-seulement.mjs`).

## Ordre proposé
1. Table de liaison + hook branché (aucun client réel encore).
2. Test d'étanchéité sur le banc.
3. Lecture : dossier + progression.
4. Tâches visibles, puis documents.
5. Invitation du premier client pilote (compte test, puis un vrai client).

## Décisions (prises)
- Un client voit-il les tâches internes, ou seulement celles que Profero
  décide de montrer (recommandé : seulement celles marquées) ?
- Les documents : tous ceux du dossier, ou ceux explicitement partagés
  (recommandé : partagés) ?
- Le client peut-il écrire (déposer un document, répondre) dès le départ
  (recommandé : non, lecture seule d'abord) ?
- Les fonctions d'envoi d'e-mails du bureau restent réservées aux
  collaborateurs (décidé en 3d).

## Étape 3 — documents partagés (écrite, NON appliquée ni déployée)
- Migration `20261001210000_portail_client_invest_documents.sql` : table
  `invest_documents_partages` (le chemin DOIT être dans `clients/<client_id>/`),
  vue `portail_documents` (nom, date ; jamais le chemin), restrictive 3a.
- Edge Function `portail-document-url` : jeton, droit vérifié par la vue avec le
  jeton du client, puis seulement lien signé de 60 s par le service_role.
  Le stockage reste fermé : le client n'a aucun droit direct sur les fichiers.
- CRM : bouton « Partager » / « Partagé client » sur chaque fichier d'un dossier
  `clients/<id>` (confirmation avant de partager) ; supprimer un fichier retire son partage.
- Banc : `verif-portail-client-invest` 35/35 (3 casses volontaires détectées) ;
  `verif-portail-visibilite-crm` 10/10. La fonction Edge n'a pas pu être exécutée
  (pas de Deno sur le poste) : ordre des vérifications contrôlé sur le texte, test réel
  à faire après déploiement avec un compte client de test.
- Hors périmètre de cette étape : documents des biens, EDL, urbanisme ; dépôt par le client.

## Étape 4 — écran client `/espace-client` (écrite, NON appliquée ni déployée)
- Page `src/Portail/PortailClient.jsx`, servie à `/espace-client` (chemin déjà réservé dans
  `vite.config.js` : le service worker du bureau ne l'intercepte pas). `main.jsx` charge le
  portail ou le bureau à la demande : un client ne télécharge pas le code du bureau.
- Contenu : accueil par prénom, dossier(s) montrés avec progression des étapes, « Ce qui vous
  concerne » (tâches cochées), documents partagés (téléchargement par `portail-document-url`),
  dernières nouvelles (événements cochés). Vocabulaire client (« En attente », jamais « bloquée »).
- Lecture seule : ne lit que les vues `portail_*`. Une erreur de chargement s'affiche comme une
  erreur, jamais comme « rien à afficher ».
- Migration `20261001220000` : `portail_etapes` limitée aux étapes du dossier (pas d'opération)
  et vue `portail_client` (prénom, nom du seul client de la connexion).
- Un compte collaborateur qui ouvre `/espace-client` voit « Accès non autorisé » (sans être déconnecté).
  Un compte client qui ouvre le bureau est refusé (« Compte non trouvé ») : comportement inchangé.
- Banc : `verif-portail-client-invest` 39/39, `verif-portail-ecran` 10/10 (casses volontaires détectées).
- Non vérifié : rendu à l'écran et téléphone ; connexion réelle d'un client (aucun compte n'existe
  encore) ; mot de passe oublié / création du mot de passe par lien d'invitation = étape suivante.

## Étape 5 — invitation d'un client (écrite, NON appliquée ni déployée)
Décision de Matthieu (01/10/2026) : bouton réservé aux **administrateurs et aux commerciaux**.
- Base (`20261001230000`) : `portail_gestionnaire()` (admin / commercial actif). Sur
  `invest_portail_comptes`, les gestionnaires LISENT et RÉVOQUENT (colonnes statut, qui, quand) ;
  plus personne ne crée, supprime ni relie un compte à un autre client en direct.
- Fonction `portail-inviter-client` : jeton, droit par `portail_gestionnaire()`, puis service_role.
  Adresse prise sur la fiche CLIENT, refus si c'est celle d'un collaborateur, aucun compte
  existant « repris » (sauf essai interrompu), accès enregistré AVANT le courriel (le hook
  d'accès l'exige), courriel en français par la messagerie Profero (Apps Script, og@).
  Lien à usage unique `/espace-client?token_hash=…` validé par le portail lui-même : aucune
  dépendance à la liste de redirections ni au modèle de courriel de Supabase.
- CRM : bloc « Accès au portail client » dans la vue d'ensemble de la fiche client : Inviter,
  Renvoyer le lien, Révoquer (confirmations). Invisible pour les autres rôles.
- Portail : écran « Choisissez votre mot de passe » (8 caractères minimum), écran « Lien non valide ».
  Pas de « mot de passe oublié » libre (évite un envoi d'e-mails à n'importe qui) : le conseiller
  renvoie le lien.
- Banc : `verif-portail-client-invest` 44/44, `verif-portail-invitation` 13/13 (casses volontaires détectées).
- Non vérifié : envoi réel du courriel par la messagerie Profero avec ce contenu ; ouverture du
  lien par un vrai client ; durée de validité du lien (réglage Supabase, 1 h par défaut).

## Étape 6 — le client renseigne et corrige ses données (écrite, NON appliquée ni déployée)
Décision de Matthieu (02/10/2026), après avoir vécu l'espace client avec un compte de démonstration : fin du
« lecture seule d'abord » pour la collecte. Principe retenu : **le client n'écrit jamais dans le dossier**.
- Base (`20261002180000`) : table d'attente `invest_portail_reponses` (brouillon, soumis, valide, refuse, remplace) sans AUCUN accès
  direct pour le client (règle 3a). Il passe par `portail_enregistrer_reponse(section, donnees, soumettre)` : le client est celui de
  la connexion (aucun identifiant en paramètre), et la saisie est NETTOYÉE côté base d'après `portail_schema_reponses()` (clés
  connues seulement, types et listes de choix contrôlés, textes et listes plafonnés). Lecture : vue `portail_reponses`, et
  `portail_donnees_dossier()` (valeurs déjà connues de Profero, limitées aux champs du schéma : jamais analyses, notes, conformité).
  `portail_maj_telephone()` ; l'e-mail (identifiant de connexion) ne se modifie pas.
- Client : bloc « Mes informations » (`src/Portail/MonDossier.jsx`), cinq parties (foyer, revenus et charges, patrimoine, dettes,
  objectifs), brouillon puis « Envoyer à mon conseiller ».
- Profero : panneau « Le client a envoyé N parties à vérifier » en tête de la Collecte du dossier de structuration, avec les écarts
  avec le dossier ; « Intégrer au dossier » (le dossier est modifié par la sauvegarde habituelle de la page) ou « Renvoyer au client »
  avec une note. Bandeau d'alerte sur la fiche client.
- Hors périmètre de cette étape : dépôt de pièces par le client.
- Banc : `verif-portail-reponses` 22/22, `verif-portail-ecran` 10/10 (adapté : la lecture seule est remplacée par « seule écriture =
  fonctions de la base »).
- À appliquer par Matthieu : `supabase db query --linked -f supabase/migrations/20261002180000_portail_client_invest_reponses.sql`,
  puis `supabase migration repair` (jamais `db push`).

## Étape 7 — le client dépose ses pièces (écrite, NON appliquée ni déployée)
Suite de l'étape 6, même principe : le client ne touche à rien en direct, tout arrive « à vérifier ».
- Pièces demandées : celles du dossier de structuration au statut « Demandé » (`portail_pieces_demandees()` : identifiant et libellé
  seulement). Le client peut aussi déposer un « autre document » avec un libellé.
- Fonction `portail-depot-document` (à déployer, `verify_jwt = true`) en deux temps : **préparer** (contrôle PDF/JPG/PNG, 10 Mo, 25 pièces
  en attente au plus, pièce réellement demandée ; le chemin `clients/<client>/depots-client/<dépôt>-<nom>` est fabriqué par le serveur ;
  adresse de dépôt à usage unique) puis **confirmer** (relit le fichier : taille et premiers octets doivent correspondre au type annoncé,
  sinon il est SUPPRIMÉ). Le client est celui de la connexion (`portail_client_id()` appelée avec son jeton), jamais un identifiant du corps.
- Base (`20261002200000`) : `invest_portail_depots` (aucun accès direct pour le client), vue `portail_depots` (sans le chemin du fichier),
  `portail_pieces_demandees()`. Droits des collaborateurs : comme les autres tables Invest (`invest_peut_voir('crm')` ou `('structuration')`),
  donc jamais un ouvrier — corrigé aussi pour `invest_portail_reponses`.
- Profero : panneau « Le client a déposé N pièces à vérifier » en tête de l'onglet Pièces (Ouvrir, Accepter = la pièce passe à « Reçu » dans
  le dossier, Refuser avec un motif que le client voit) ; le bandeau de la fiche client compte aussi les pièces.
- Banc : `verif-portail-depots` (règles pures, ordre des contrôles de la fonction, base PGlite, retour arrière) ; `verif-portail-ecran` adapté.
- À faire par Matthieu : appliquer la migration `20261002200000` ET déployer la fonction (`supabase functions deploy portail-depot-document`).
  Non testé : le téléversement réel vers le stockage (aucun accès au stockage depuis les tests), à essayer avec le compte de démonstration.
