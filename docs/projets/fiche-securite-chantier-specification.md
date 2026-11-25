# Spécification — Fiche de préparation sécurité chantier

Nov 25, 2026 · @General

## Contexte et objectif

Chaque chantier doit avoir une fiche de préparation sécurité remplie, signée et justifiée avant son démarrage, consultable depuis la page de l'opération et présentable en cas de contrôle (inspection du travail, CARSAT, OPPBTP).

Aujourd'hui la procédure existe en PDF (« Procédure de préparation de chantier — v2 », 12 points). Cette fonctionnalité la transpose dans l'appli :

- un bouton « Fiche sécurité » sur la page de chaque opération, une fiche par chantier ;
- une fiche éditable, pré-remplie à partir des données existantes (phasage, planning, sous-traitants) ;
- des signatures électroniques simples (établie par, chef d'équipe, accueil de chaque intervenant) ;
- des justificatifs joints par point, et un espace de justificatifs permanents de l'entreprise avec dates d'expiration ;
- une intégration au cycle de vie : le démarrage est bloqué tant que la fiche n'est pas validée ;
- un export PDF à la charte Profero, identique au modèle papier.

**Hors périmètre de cette livraison :** mise à jour automatique du DUERP, signature électronique qualifiée (eIDAS), envoi de la fiche aux sous-traitants par mail.

## Principes

- **Une fiche par chantier** (table `chantiers`), car lots, dates et équipes diffèrent. Le bouton est sur la page de l'opération et liste les fiches de ses chantiers.
- **Les données du bâtiment sont saisies une fois, au niveau de l'opération** (table `operations`) : date du permis de construire, copropriété, étage, ascenseur, repérage amiante. Chaque fiche de chantier les reprend en lecture et renvoie vers l'opération pour les modifier.
- **Le contenu suit exactement les 12 points du PDF v2** : 1 intervenants, 2 données de base, 3 synthèse des risques, 4 amiante, 5 chute de hauteur, 6 électricité, 7 poussières et silice, 8 manutention, 9 travail isolé, 10 EPI, 11 sanitaires, 12 coordination.
- **Chaque point a un statut** : `a_completer`, `concerne`, `non_concerne`. L'appli propose le statut par règle (section pré-remplissage) ; l'utilisateur confirme ou corrige.
- **Les définitions des points sont dans le code, pas en base** : un fichier de configuration (`securite/points.ts`) décrit pour chaque point ses cases à cocher, sa règle « concerné si », et les justificatifs attendus. La base ne stocke que les réponses. Ajouter une case = modifier ce fichier.
- **Rien n'est supprimé de l'existant** : la fonctionnalité s'ajoute à côté, en respectant les patterns RLS actuels (`est_ouvrier()`, `mon_role()`, `est_collaborateur_actif()`).

## Modèle de données

Cinq nouvelles tables, toutes préfixées `securite_`, plus une vue. Aucune table existante n'est modifiée.

| Table | Une ligne = | Colonnes principales |
| --- | --- | --- |
| `securite_operations` | les données bâtiment d'une opération | `operation_id` (PK, FK `operations`), `date_permis_construire`, `avant_1997` et `avant_1949` (colonnes générées), `copropriete`, `etage`, `ascenseur_utilisable`, `reperage_amiante_statut` (`non_requis`, `a_demander`, `demande`, `recu_sans_amiante`, `recu_amiante_present`), `notes` |
| `securite_fiches` | la fiche en cours d'un chantier | `id`, `chantier_id` (unique, FK `chantiers`), `version`, `statut` (`brouillon`, `validee`, `a_mettre_a_jour`, `verrouillee`), `donnees_base` jsonb (point 2), `intervenants` jsonb (point 1), `reponses` jsonb (points 4 à 12), `synthese_risques` jsonb (point 3), `validee_le/par`, `forcage_motif/par/le` |
| `securite_fiches_versions` | une version figée, à chaque validation ou mise à jour | `fiche_id`, `version`, `contenu` jsonb (copie complète), `motif_changement`, `empreinte` (sha256 du contenu), `pdf_path`, `cree_par`, `cree_le` — jamais modifiée ni supprimée |
| `securite_signatures` | une signature | `fiche_id`, `version`, `type` (`etablie_par`, `chef_equipe`, `accueil`), `signataire_nom`, `signataire_entreprise`, `utilisateur_id` (null pour un sous-traitant), `image_path`, `empreinte_version`, `signe_le` — jamais modifiée ni supprimée |
| `securite_justificatifs` | un document | `portee` (`chantier`, `operation`, `entreprise`), `chantier_id` / `operation_id`, `point` (1 à 12), `type_code`, `personne`, `entreprise_nom`, `fichier_path`, `date_document`, `expire_le`, `confidentiel`, `archive_le` |
| vue `securite_fiches_etat` | l'état d'une fiche pour les pastilles | points complétés sur 12, justificatifs requis manquants, justificatifs expirés ou expirant sous 30 jours, signatures manquantes, `pret_a_demarrer` |

**Structure de `reponses`** (une clé par point) :

```json
{
  "p5": {
    "statut": "concerne",
    "statut_propose": "concerne",
    "raison_proposition": "Lot faux plafond prévu au phasage",
    "cases": { "zones_listees": true, "tremies_protegees": true, "echafaudage_verifie": false },
    "mesures": "PIRL pour plafonds séjour ; garde-corps trémie escalier",
    "maj_par": "…", "maj_le": "2026-11-25T10:12:00Z"
  }
}
```

**Types de justificatifs** (`type_code`) : `reperage_amiante`, `dta`, `mode_operatoire_amiante`, `formation_ss4`, `aptitude_medicale`, `pv_echafaudage`, `formation_echafaudage`, `habilitation_electrique`, `recepisse_dict`, `autorisation_voirie`, `fiche_remise_epi`, `consigne_travail_isole`, `accord_sanitaires`, `contrat_location`, `pgc`, `ppsps`, `registre_journal`, `contrat_sous_traitance`, `kbis`, `attestation_decennale`, `attestation_vigilance_urssaf`, `duerp`, `photo`, `autre`.

**Stockage** : bucket privé existant `chantier-documents`, sous `securite/chantiers/{chantier_id}/`, `securite/operations/{operation_id}/`, `securite/entreprise/` et `securite/signatures/{fiche_id}/`. Vérifier que les policies storage existantes de ce bucket couvrent ces chemins ; sinon les ajouter.

**Droits (RLS)**, sur le modèle des tables existantes :

- Bureau (`NOT est_ouvrier()`) : lecture et écriture sur toutes les tables `securite_`.
- Ouvrier : lecture de la fiche et des justificatifs de chantier des chantiers non archivés ; insertion d'une signature `accueil` uniquement à son propre nom (`utilisateur_id = auth.uid()`).
- Justificatifs `confidentiel = true` (aptitudes médicales) : lecture réservée à `is_admin()`. Les autres utilisateurs ne les voient pas, y compris dans la vue des expirations ; les alertes d'expiration de ces documents vont aux admins. Les fichiers sont stockés dans un bucket séparé, securite-confidentiel, réservé aux admins.
- Versions et signatures : aucune policy UPDATE ni DELETE, pour tout le monde.
- Toutes les tables gardent aussi la policy commune `profero_collaborateurs_seulement`.

## Écrans

**1. Page opération : bouton et pastilles**

- Bouton « Fiche sécurité » dans l'en-tête de la page opération.
- Il ouvre un panneau listant les chantiers de l'opération, chacun avec une pastille : gris « à créer », orange « brouillon — 7/12 », rouge « justificatifs manquants » ou « expiré », vert « validée v2 ».
- Au-dessus, un bloc « Bâtiment » (table `securite_operations`) éditable : date du permis, copropriété, étage, ascenseur, statut du repérage amiante.

**2. Fiche chantier (bureau, ordinateur et tablette)**

- Même ordre que le PDF : bandeau d'identification, puis points 1 et 2, puis une carte par point 4 à 12, puis la synthèse (point 3), les mises à jour et l'accueil de l'équipe.
- Chaque carte affiche : le statut proposé et sa raison (« Lot démolition prévu au phasage »), le choix Concerné / Non concerné, les cases à cocher, le champ « Mesures retenues », et les justificatifs attendus avec un bouton d'ajout (photo ou fichier).
- Un justificatif permanent valide (habilitation, formation, DUERP) est rattaché automatiquement et affiché « depuis l'espace entreprise, valable jusqu'au … ».
- Enregistrement automatique à chaque modification, avec indicateur « enregistré ».
- Bouton « Valider la fiche », actif seulement si tous les points ont un statut, que chaque point concerné a ses justificatifs requis et que les signatures « établie par » et « chef d'équipe » sont faites. Sinon, la liste de ce qui manque s'affiche.
- Une fiche validée passe en lecture seule. Le bouton « Mettre à jour » demande le motif du changement, crée une nouvelle version et repasse la fiche en brouillon.

**3. Signature (mobile)**

- Zone de tracé au doigt, nom pré-rempli pour un utilisateur connecté, saisie libre du nom et de l'entreprise pour un sous-traitant.
- Avant de signer, l'intervenant voit la synthèse des risques principaux et les consignes. Le texte affiché au-dessus du tracé : « Je reconnais avoir été informé des risques et des consignes de ce chantier. »
- Côté ouvrier, la fiche du chantier du jour apparaît dans son espace avec un bouton « Signer l'accueil » tant qu'il n'a pas signé la version en cours.

**4. Espace « Justificatifs entreprise » (bureau)**

- Liste par personne et par type : habilitations, formations SS4 et échafaudage, aptitudes médicales (admin seulement), DUERP, modes opératoires amiante.
- Colonnes : personne, type, date, expiration, statut (valide, expire sous 30 jours, expiré). Tri par expiration la plus proche.
- Notification au bureau 30 jours avant expiration, via la table `notifications` existante.

## Règles de pré-remplissage

L'appli propose un statut et des valeurs à partir des données déjà saisies ; l'utilisateur confirme ou corrige. Une proposition ne valide jamais un point toute seule. Les règles sont recalculées à l'ouverture de la fiche et signalées si elles divergent de la réponse enregistrée (« Le phasage contient maintenant un lot démolition : revoir le point 7 »).

| Point | Source dans l'appli | Règle proposée |
| --- | --- | --- |
| 1. Intervenants | `chantiers` (responsable, client), `operations.adresse`, `planning_cells.ouvriers`, `planning_resources` (`kind = 'prestataire'`) | Remplir responsable, client, adresse ; lister Profero et chaque prestataire présent au planning du chantier |
| 2. Données de base | `phasages.ouvrages[].lot_id`, `securite_operations` | Lots = liste distincte des `lot_id`. Date de dépose des sanitaires = plus petite `date_prevue` des tâches de dépose de WC, lavabo ou douche (lot `demolition`, codes ouvrage à lister dans la config) |
| 4. Amiante | `securite_operations.avant_1997` | Concerné si permis antérieur au 1er juillet 1997 ; date inconnue = « à compléter » et alerte |
| 5. Chute de hauteur | lots et codes ouvrage du phasage | Concerné si un ouvrage de faux plafond, plafond, menuiserie extérieure, trémie ou toiture est prévu (liste de codes dans la config) |
| 6. Électricité | toujours | Toujours concerné ; si lot `electricite` présent, exiger une habilitation pour au moins un intervenant affecté |
| 7. Poussières et silice | lots `demolition`, `maconnerie`, `murs_cloison` et codes de carrelage ou ponçage | Concerné si l'un de ces lots est présent |
| 8. Manutention | `securite_operations` (étage, ascenseur), `commande_lignes` du chantier | Concerné si étage ≥ 1 sans ascenseur utilisable ; afficher les quantités commandées de plaques, sacs et menuiseries comme aide |
| 9. Travail isolé | `planning_cells` (un jour = une ligne `chantier_id` + `jour` + `ouvriers`) | Concerné si au moins un jour planifié a une seule personne ; lister ces jours |
| 10. EPI | réponses des points 4 à 8 | Toujours concerné ; ajouter FFP3 si point 7, protections auditives si lot démolition, harnais si point 5 sans protection collective, combinaison si amiante présent |
| 11. Sanitaires | point 2 (date de dépose), `securite_operations` | Toujours concerné ; si une date de dépose existe, exiger une solution de remplacement à partir de cette date |
| 12. Coordination | point 1 | Concerné si plus d'une entreprise au point 1, même successivement |
| 3. Synthèse | points 4 à 12 | Proposer comme risques principaux, dans cet ordre : amiante présent, chute de hauteur, électricité, poussières ; l'utilisateur garde 2 ou 3 lignes |

Les codes ouvrage et lots qui déclenchent chaque règle sont à définir une fois dans `securite/points.ts`, à partir de la bibliothèque d'ouvrages.

## Intégration au cycle de vie

Un seul contrôle bloque : le passage du chantier en « en cours » exige une fiche validée. Les autres étapes créent, alertent ou verrouillent.

&#91;embedded content: cycle de vie du chantier · 4 statuts, 1 contrôle bloquant\]

La boucle en pointillé : un changement en cours de chantier renvoie la fiche en « à mettre à jour » sans arrêter le chantier.

- **Statuts** : on s'appuie sur `chantiers.statut` existant (`a_l_etude`, `planifie`, `en_cours`, `termine`). 24 chantiers n'ont pas de statut aujourd'hui : à compléter avant la mise en service, sinon le blocage ne s'applique pas.
- **Étape du cycle de vie** : ajouter une étape `fiche_securite` dans la définition des étapes (côté code, avec `visite_chiffrage`, `plans_techniques`…), stockée dans `chantier_cycle_vie` comme les autres. Son état reflète celui de la fiche.
- **Blocage** : implémenté côté appli, sur tout écran qui modifie `chantiers.statut`. Pas de déclencheur bloquant en base en v1 : vérifier d'abord qu'aucun traitement automatique (synchronisation ProgBat) ne passe des chantiers en cours, sinon il échouerait. Un déclencheur pourra être ajouté ensuite.
- **Forçage** : réservé à `is_admin()`, motif obligatoire, enregistré dans la fiche et dans `chantiers_statut_journal`.
- **Alertes** (table `notifications`) : fiche à créer quand un chantier passe en planifié, fiche non validée 7 jours avant la première date prévue du phasage, justificatif expiré sur un chantier en cours, fiche à mettre à jour.
- **Chantiers déjà en cours à la mise en service** : pas de blocage rétroactif ; une fiche est créée en brouillon avec une alerte.

## Signatures, versions et verrouillage

Une signature engage sur une version précise de la fiche : si la fiche change ensuite, la signature reste valable pour l'ancienne version et une nouvelle est demandée.

- **Signature électronique simple** : tracé au doigt (bibliothèque `signature_pad` ou équivalent), enregistré en PNG dans le storage, avec nom, entreprise, date et heure, utilisateur connecté s'il y en a un. C'est suffisant pour prouver l'information des salariés ; une signature qualifiée n'est pas nécessaire.
- **Empreinte** : à chaque validation, le contenu complet de la fiche est copié dans `securite_fiches_versions` et haché en sha256. Chaque signature stocke cette empreinte. Une signature dont l'empreinte ne correspond plus à la version en cours est affichée « signée sur la v1 ».
- **Quand une nouvelle version est créée** : au clic sur « Mettre à jour » (motif obligatoire), ou automatiquement proposée quand un nouveau prestataire apparaît au planning, quand le phasage gagne un lot qui change un statut, ou quand un justificatif requis expire.
- **Qui doit re-signer** : « établie par » et « chef d'équipe » à chaque version ; l'accueil de l'équipe seulement si les points 3 à 12 ont changé (pas pour une correction du point 1 ou 2 sans effet sur les risques).
- **Verrouillage** : au passage du chantier en « terminé », la fiche passe en `verrouillee`, plus aucune modification possible, même par un admin. Les justificatifs restent consultables.
- **Traçabilité** : chaque changement de statut de fiche et chaque forçage est aussi écrit dans `chantiers_statut_journal` (événement `fiche_securite`) pour rester visible dans l'historique du chantier.

## Export PDF

Le PDF reproduit les pages « Fiche chantier » du modèle v2, rempli avec les réponses, les justificatifs listés et les signatures en image.

- Même charte que les autres exports de l'appli : hero bleu nuit arrondi avec logo, accents jaunes, cartes blanches, pied de page « Profero — Rénovation & Réhabilitation ».
- Contenu dans l'ordre : identification et intervenants, données de base, synthèse des risques, points 4 à 12 (statut, cases cochées, mesures, liste des justificatifs joints avec leur date), historique des versions, signatures.
- Un PDF est généré et stocké automatiquement à chaque validation (`securite_fiches_versions.pdf_path`), pour qu'une version présentée à un contrôle ne puisse plus changer.
- Bouton « Dossier de contrôle » : un ZIP avec le PDF de la dernière version et tous les justificatifs du chantier et de l'entreprise rattachés, sauf les documents confidentiels pour un non-admin.

## Migration SQL à valider

La migration crée les 5 tables, 2 vues, les déclencheurs d'immuabilité, les droits et un bucket confidentiel ; elle ne modifie aucune table existante. Elle a été exécutée et testée sur une base PostgreSQL locale reproduisant vos fonctions de droits ; **elle n'a pas été appliquée sur votre projet Supabase**.

Vérifié lors du test : colonnes `avant_1997` et `avant_1949` calculées, refus de modifier ou supprimer une version ou une signature, `pdf_path` renseignable une seule fois, refus d'une aptitude médicale non confidentielle, refus d'un justificatif à la mauvaise portée, fiche verrouillée non modifiable, suppression d'un chantier ayant une fiche refusée.

Points à confirmer avant application :

- **Bucket confidentiel** : le bucket `chantier-documents` est lisible par tout collaborateur connecté, ouvriers compris. Les aptitudes médicales vont donc dans un nouveau bucket `securite-confidentiel` réservé aux admins.
- **Suppression des chantiers** : `on delete restrict` empêche de supprimer un chantier qui a une fiche. Vérifier qu'aucun traitement existant (synchronisation ProgBat, fusion d'opérations) ne supprime de chantiers ; sinon passer par l'archivage.
- **Identifiant des signataires** : `auth_user_id` reçoit `auth.uid()`. Vérifier que c'est bien cet identifiant qui relie un ouvrier à `planning_resources.auth_user_id`.

Fichier : `20261125_securite_fiches_chantier.sql`.

```sql
-- Fiche de préparation sécurité chantier — migration v1
-- N'altère aucune table existante. À relire avant application.

-- 1. Données bâtiment, au niveau de l'opération
create table public.securite_operations (
  operation_id            text primary key references public.operations(id) on delete cascade,
  date_permis_construire  date,
  avant_1997              boolean generated always as (date_permis_construire < date '1997-07-01') stored,
  avant_1949              boolean generated always as (date_permis_construire < date '1949-01-01') stored,
  copropriete             boolean,
  etage                   smallint check (etage between -5 and 60),
  ascenseur_utilisable    boolean,
  reperage_amiante_statut text not null default 'a_completer'
    check (reperage_amiante_statut in ('a_completer','non_requis','a_demander','demande',
                                       'recu_sans_amiante','recu_amiante_present')),
  notes                   text,
  maj_par                 text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- 2. Fiche en cours d'un chantier
create table public.securite_fiches (
  id               uuid primary key default gen_random_uuid(),
  chantier_id      text not null unique references public.chantiers(id) on delete restrict,
  version          integer not null default 1 check (version >= 1),
  statut           text not null default 'brouillon'
    check (statut in ('brouillon','validee','a_mettre_a_jour','verrouillee')),
  donnees_base     jsonb not null default '{}'::jsonb,   -- point 2
  intervenants     jsonb not null default '[]'::jsonb,   -- point 1
  reponses         jsonb not null default '{}'::jsonb,   -- points 4 à 12
  synthese_risques jsonb not null default '[]'::jsonb,   -- point 3
  validee_le       timestamptz,
  validee_par      text,
  forcage_motif    text,
  forcage_par      text,
  forcage_le       timestamptz,
  cree_par         text,
  maj_par          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (statut <> 'validee' or validee_le is not null),
  check ((forcage_le is null) = (forcage_motif is null))
);

-- 3. Versions figées (immuables)
create table public.securite_fiches_versions (
  id               uuid primary key default gen_random_uuid(),
  fiche_id         uuid not null references public.securite_fiches(id) on delete restrict,
  version          integer not null,
  contenu          jsonb not null,
  motif_changement text,
  empreinte        text not null,            -- sha256 hex du contenu
  pdf_path         text,                     -- renseigné une seule fois après génération
  cree_par         text,
  cree_le          timestamptz not null default now(),
  unique (fiche_id, version)
);

-- 4. Signatures (immuables)
create table public.securite_signatures (
  id                    uuid primary key default gen_random_uuid(),
  fiche_id              uuid not null references public.securite_fiches(id) on delete restrict,
  version               integer not null,
  type                  text not null check (type in ('etablie_par','chef_equipe','accueil')),
  signataire_nom        text not null check (length(trim(signataire_nom)) > 0),
  signataire_entreprise text,
  auth_user_id          uuid default auth.uid(),   -- null pour un sous-traitant sans compte
  image_path            text not null,
  empreinte_version     text not null,
  signe_le              timestamptz not null default now()
);
create index securite_signatures_fiche_idx on public.securite_signatures (fiche_id, version);

-- 5. Justificatifs
create table public.securite_justificatifs (
  id             uuid primary key default gen_random_uuid(),
  portee         text not null check (portee in ('chantier','operation','entreprise')),
  chantier_id    text references public.chantiers(id) on delete restrict,
  operation_id   text references public.operations(id) on delete restrict,
  point          smallint check (point between 1 and 12),
  type_code      text not null check (type_code in (
    'reperage_amiante','dta','mode_operatoire_amiante','formation_ss4','aptitude_medicale',
    'pv_echafaudage','formation_echafaudage','habilitation_electrique','recepisse_dict',
    'autorisation_voirie','fiche_remise_epi','consigne_travail_isole','accord_sanitaires',
    'contrat_location','pgc','ppsps','registre_journal','contrat_sous_traitance','kbis',
    'attestation_decennale','attestation_vigilance_urssaf','duerp','photo','autre')),
  personne       text,
  entreprise_nom text,
  fichier_path   text not null,
  fichier_nom    text,
  date_document  date,
  expire_le      date,
  confidentiel   boolean not null default false,
  ajoute_par     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  archive_le     timestamptz,
  check (
    (portee = 'chantier'   and chantier_id  is not null and operation_id is null) or
    (portee = 'operation'  and operation_id is not null and chantier_id  is null) or
    (portee = 'entreprise' and chantier_id  is null     and operation_id is null)),
  -- les aptitudes médicales sont toujours confidentielles
  check (type_code <> 'aptitude_medicale' or confidentiel)
);
create index securite_justificatifs_chantier_idx  on public.securite_justificatifs (chantier_id)  where archive_le is null;
create index securite_justificatifs_operation_idx on public.securite_justificatifs (operation_id) where archive_le is null;
create index securite_justificatifs_expire_idx    on public.securite_justificatifs (expire_le)    where archive_le is null and expire_le is not null;

-- 6. updated_at (fonction existante)
create trigger securite_operations_updated_at    before update on public.securite_operations
  for each row execute function public.set_updated_at();
create trigger securite_fiches_updated_at        before update on public.securite_fiches
  for each row execute function public.set_updated_at();
create trigger securite_justificatifs_updated_at before update on public.securite_justificatifs
  for each row execute function public.set_updated_at();

-- 7. Immuabilité
create or replace function public.securite_versions_immuables()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Une version de fiche sécurité ne peut pas être supprimée';
  end if;
  -- seule modification permise : renseigner pdf_path une fois
  if old.pdf_path is null and new.pdf_path is not null
     and (to_jsonb(new) - 'pdf_path') = (to_jsonb(old) - 'pdf_path') then
    return new;
  end if;
  raise exception 'Une version de fiche sécurité ne peut pas être modifiée';
end $$;

create trigger securite_fiches_versions_immuables
  before update or delete on public.securite_fiches_versions
  for each row execute function public.securite_versions_immuables();

create or replace function public.securite_signatures_immuables()
returns trigger language plpgsql as $$
begin
  raise exception 'Une signature ne peut être ni modifiée ni supprimée';
end $$;

create trigger securite_signatures_immuables
  before update or delete on public.securite_signatures
  for each row execute function public.securite_signatures_immuables();

-- une fiche verrouillée ne bouge plus
create or replace function public.securite_fiche_verrouillee()
returns trigger language plpgsql as $$
begin
  if old.statut = 'verrouillee' then
    raise exception 'Fiche sécurité verrouillée (chantier terminé)';
  end if;
  return new;
end $$;

create trigger securite_fiches_verrou
  before update on public.securite_fiches
  for each row execute function public.securite_fiche_verrouillee();

-- 8. Vues d'état (pastilles, expirations)
create view public.securite_fiches_etat with (security_invoker = true) as
select
  f.id as fiche_id,
  f.chantier_id,
  f.version,
  f.statut,
  (select count(*) from jsonb_each(f.reponses) r
    where r.value->>'statut' in ('concerne','non_concerne'))
    + (case when f.donnees_base  <> '{}'::jsonb then 1 else 0 end)
    + (case when f.intervenants  <> '[]'::jsonb then 1 else 0 end)
    + (case when f.synthese_risques <> '[]'::jsonb then 1 else 0 end)  as points_completes,
  exists (select 1 from public.securite_signatures s
           where s.fiche_id = f.id and s.version = f.version and s.type = 'etablie_par') as signe_etablie_par,
  exists (select 1 from public.securite_signatures s
           where s.fiche_id = f.id and s.version = f.version and s.type = 'chef_equipe') as signe_chef_equipe,
  (select count(*) from public.securite_signatures s
    where s.fiche_id = f.id and s.version = f.version and s.type = 'accueil') as nb_signatures_accueil,
  (select count(*) from public.securite_justificatifs j
    where j.chantier_id = f.chantier_id and j.archive_le is null) as nb_justificatifs_chantier,
  f.forcage_le is not null as demarrage_force
from public.securite_fiches f;

create view public.securite_justificatifs_expiration with (security_invoker = true) as
select id, portee, chantier_id, operation_id, type_code, personne, entreprise_nom, expire_le,
  case
    when expire_le < current_date then 'expire'
    when expire_le < current_date + 30 then 'expire_bientot'
    else 'valide'
  end as etat
from public.securite_justificatifs
where archive_le is null and expire_le is not null;

-- 9. RLS
alter table public.securite_operations      enable row level security;
alter table public.securite_fiches          enable row level security;
alter table public.securite_fiches_versions enable row level security;
alter table public.securite_signatures      enable row level security;
alter table public.securite_justificatifs   enable row level security;

-- garde-fou commun, comme sur les tables existantes
create policy profero_collaborateurs_seulement on public.securite_operations      as restrictive for all to authenticated using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));
create policy profero_collaborateurs_seulement on public.securite_fiches          as restrictive for all to authenticated using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));
create policy profero_collaborateurs_seulement on public.securite_fiches_versions as restrictive for all to authenticated using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));
create policy profero_collaborateurs_seulement on public.securite_signatures      as restrictive for all to authenticated using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));
create policy profero_collaborateurs_seulement on public.securite_justificatifs   as restrictive for all to authenticated using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));

-- bureau : tout (versions et signatures : lecture + ajout seulement)
create policy "securite operations bureau" on public.securite_operations for all to authenticated
  using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
create policy "securite fiches bureau" on public.securite_fiches for all to authenticated
  using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
create policy "securite versions bureau lecture" on public.securite_fiches_versions for select to authenticated
  using ((select not public.est_ouvrier()));
create policy "securite versions bureau ajout" on public.securite_fiches_versions for insert to authenticated
  with check ((select not public.est_ouvrier()));
create policy "securite versions bureau pdf" on public.securite_fiches_versions for update to authenticated
  using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));  -- le trigger n'autorise que pdf_path
create policy "securite signatures bureau lecture" on public.securite_signatures for select to authenticated
  using ((select not public.est_ouvrier()));
create policy "securite signatures bureau ajout" on public.securite_signatures for insert to authenticated
  with check ((select not public.est_ouvrier()));
create policy "securite justificatifs bureau lecture" on public.securite_justificatifs for select to authenticated
  using ((select not public.est_ouvrier()) and (not confidentiel or (select public.is_admin())));
create policy "securite justificatifs bureau ecriture" on public.securite_justificatifs for insert to authenticated
  with check ((select not public.est_ouvrier()) and (not confidentiel or (select public.is_admin())));
create policy "securite justificatifs bureau modification" on public.securite_justificatifs for update to authenticated
  using ((select not public.est_ouvrier()) and (not confidentiel or (select public.is_admin())))
  with check ((select not public.est_ouvrier()) and (not confidentiel or (select public.is_admin())));

-- ouvriers : lecture des fiches de chantiers actifs, signature d'accueil à leur nom
create policy "securite operations ouvrier lecture" on public.securite_operations for select to authenticated
  using ((select public.est_ouvrier()));
create policy "securite fiches ouvrier lecture" on public.securite_fiches for select to authenticated
  using ((select public.est_ouvrier()) and exists (
    select 1 from public.chantiers c where c.id = chantier_id and c.archive_le is null));
create policy "securite signatures ouvrier lecture" on public.securite_signatures for select to authenticated
  using ((select public.est_ouvrier()) and auth_user_id = (select auth.uid()));
create policy "securite signatures ouvrier accueil" on public.securite_signatures for insert to authenticated
  with check ((select public.est_ouvrier()) and type = 'accueil' and auth_user_id = (select auth.uid()));
create policy "securite justificatifs ouvrier lecture" on public.securite_justificatifs for select to authenticated
  using ((select public.est_ouvrier()) and portee = 'chantier' and not confidentiel
         and archive_le is null and exists (
           select 1 from public.chantiers c where c.id = chantier_id and c.archive_le is null));

-- 10. Stockage des documents confidentiels
-- Le bucket chantier-documents est lisible par tout collaborateur :
-- les aptitudes médicales vont dans un bucket séparé réservé aux admins.
insert into storage.buckets (id, name, public) values ('securite-confidentiel', 'securite-confidentiel', false)
  on conflict (id) do nothing;

create policy "securite confidentiel admin lecture" on storage.objects for select to authenticated
  using (bucket_id = 'securite-confidentiel' and (select public.is_admin()));
create policy "securite confidentiel admin ecriture" on storage.objects for insert to authenticated
  with check (bucket_id = 'securite-confidentiel' and (select public.is_admin()));
```

## Plan de livraison et critères d'acceptation

Quatre livraisons, chacune utilisable seule ; la première suffit pour le prochain contrôle.

1. **Fiche et PDF** : migration, bloc bâtiment sur la page opération, fiche éditable avec les 12 points, justificatifs de chantier, signatures « établie par » et « chef d'équipe », validation, export PDF.
2. **Pré-remplissage** : règles de la section dédiée, propositions affichées avec leur raison, alertes de divergence.
3. **Cycle de vie et équipe** : étape « Fiche sécurité validée » dans le cycle de vie, blocage du passage en cours avec forçage, signature d'accueil côté ouvrier, nouvelles versions, verrouillage à la clôture.
4. **Espace entreprise** : justificatifs permanents, rattachement automatique, alertes d'expiration, bouton « Dossier de contrôle ».

Critères d'acceptation :

- [ ] Depuis une opération, je crée la fiche d'un chantier, je la remplis sur tablette et je la valide en moins de 20 minutes quand les justificatifs sont prêts.
- [ ] Une fiche validée produit un PDF identique dans sa forme au modèle v2, avec les signatures.
- [ ] Un chantier dont la fiche n'est pas validée ne peut pas passer en cours sans forçage motivé par un admin, et le forçage apparaît dans l'historique du chantier.
- [ ] Une fois validée, aucune version ni signature ne peut être modifiée ou supprimée, même par un admin.
- [ ] Un ouvrier voit la fiche de son chantier, signe l'accueil à son nom et ne peut rien modifier d'autre.
- [ ] Une aptitude médicale n'est visible que par un admin, dans l'appli comme dans le stockage.
- [ ] Un permis antérieur au 1er juillet 1997 sans repérage amiante reçu empêche la validation de la fiche.
- [ ] L'ajout d'un prestataire au planning d'un chantier en cours passe sa fiche en « à mettre à jour ».
