# Plan de refonte — Système de commandes (Profero)

Document de passation pour **Claude Code**. Il décrit le modèle cible, les
migrations SQL, et une série de prompts séquentiels à exécuter dans l'ordre.

---

## Comment utiliser ce document

1. Ouvre Claude Code à la racine du dépôt de l'application.
2. **Colle d'abord le bloc « Contexte » (Prompt 0)** : il pose le décor et les
   règles métier. Garde-le dans la session.
3. Exécute ensuite **Prompt 1 → Prompt 7 dans l'ordre**, un par un. Vérifie le
   résultat de chaque étape avant de passer à la suivante.
4. Les blocs SQL sont fournis prêts à coller. Les blocs « PROMPT » sont à donner
   tels quels à Claude Code.

## Pré-requis & sécurité (à lire avant de commencer)

- **Sauvegarde la base** (backup Supabase) ou travaille sur une **branche
  Supabase** avant toute migration de données (Prompt 2).
- Les migrations de **création** (Prompt 1) sont non destructives.
- La migration de **données** (Prompt 2) ne supprime rien : elle recopie
  l'existant dans les nouvelles tables. Les anciennes tables (`commandes_detail`,
  `commandes_passees`) ne sont supprimées qu'au tout dernier prompt, après
  vérification.
- Les noms exacts de colonnes de l'existant doivent être **vérifiés sur le
  schéma réel** avant d'exécuter Prompt 2 (une étape de vérification est prévue).

---

## Prompt 0 — Contexte (à coller en début de session)

```text
Tu travailles sur l'application interne de gestion de chantiers "Profero"
(React + Supabase). On refait le système de COMMANDES. Voici le contexte complet.

PROBLÈME ACTUEL
- Les commandes ne sont pas saisies de façon fiable depuis les chantiers : il
  manque une saisie mobile rapide, et le modèle de données est confus.
- Deux tables se chevauchent et créent une double source de vérité :
  * `commandes_detail` : une ligne par article. Sert à la fois aux "besoins
    ouvrier" (statut besoin_ouvrier) ET aux vraies commandes (a_commander /
    commande / retire). Le statut besoin_ouvrier existe sous 3 orthographes.
  * `commandes_passees` : une ligne par groupe fournisseur, articles en JSON.
- La page "Planning des commandes" écrit dans LES DEUX tables pour une même
  commande, d'où des doublons.
- Beaucoup de code défensif gère des colonnes manquantes (erreurs 42703).

MODÈLE CIBLE (ce qu'on construit)
On sépare proprement DEUX objets distincts :

1) LES BESOINS (une demande : "il nous faut X"). Émis par les ouvriers depuis
   le rapport mobile, ou issus du plan de travaux. Pas de document fournisseur.
   -> nouvelle table `besoins`.

2) LES COMMANDES RÉELLES (un achat avec un vrai document : BL, ticket, bon de
   commande). Capté en mobilité. Modèle en 2 tables :
   * `commandes` = EN-TÊTE NEUTRE du document. NE PORTE PAS de chantier.
     Champs clés : type_evenement (comptoir/commande/livraison), doc_type
     (ticket/bon_commande/bl), doc_numero, numero_en_attente, fournisseur,
     date_doc, montant_ht, photo_url, saisi_par, et DEUX axes d'état :
       - statut_completude  : a_completer | complete  (enrichissement bureau)
       - statut_facturation : en_attente_facture | facture
   * `commande_lignes` = les articles. CHAQUE LIGNE porte la ventilation
     analytique : chantier_id, phasage_id, phase_id + quantite + prix. C'est la
     SEULE source des coûts par chantier.

3) LES FACTURES mensuelles (regroupent plusieurs BL, souvent multi-chantiers) :
   * `factures` = en-tête de la facture fournisseur.
   * `facture_bl` = liaison facture <-> BL, avec un statut de rapprochement
     (rapproche | manquant | ecart).

RÈGLES MÉTIER VALIDÉES (importantes)
- Saisie = "capture éclair". Sur le terrain, on capte le minimum vite : une
  photo du document + le chantier. L'IA extrait le reste. Le SEUL champ
  obligatoire est `doc_numero` (n° de BL / facture / ticket). S'il n'est pas
  trouvé par l'IA, on bloque l'enregistrement — SAUF si on coche "numéro en
  attente" (cas d'une commande passée par téléphone, n° fourni plus tard).
- Les BL portent DÉJÀ les prix -> le coût d'un BL est connu dès la capture
  (coût PROVISOIRE). La facture mensuelle viendra le CONFIRMER/VERROUILLER.
- Un même BL peut être réparti sur PLUSIEURS chantiers -> la ventilation est au
  niveau de la LIGNE, jamais du document. Cas courant (1 BL = 1 chantier) =
  un chantier par défaut appliqué à toutes les lignes ; un mode "Répartir"
  permet d'affecter un chantier par ligne.
- Les numéros de BL figurent sur la facture -> le rapprochement de fin de mois
  se fait par APPARIEMENT DE NUMÉRO (déterministe), pas par concordance de
  total (qui reste un simple contrôle de cohérence, remises comprises).
- Si la facture liste un BL JAMAIS SAISI, le système le SIGNALE et empêche de
  confirmer le rapprochement tant qu'il n'est pas saisi. C'est le filet de
  sécurité contre les commandes oubliées.

ACTEURS
- Saisie terrain (mobile) : chef de chantier + conducteur de travaux.
- Enrichissement + rapprochement (bureau) : conducteur.
- Les ouvriers ne saisissent QUE des "besoins" (flux séparé, inchangé pour eux).

CONVENTIONS TECHNIQUES
- Supabase Postgres, RLS activée, policies select/insert/update/delete pour le
  rôle `authenticated` (suis le pattern des tables existantes).
- Statuts en TEXT + CHECK constraint (pas d'enum PG), comme l'existant.
- Le client Supabase est importé via `import { supabase } from "../supabase"`.
- Les pages vivent dans `src/Renovation/`. Réutilise les helpers existants
  (`FONT`, `RADIUS`, `getBranchAccent`, `Icon`, etc.) et le style sombre de
  l'app (accent #FFC200, surfaces sombres).

Confirme que tu as bien intégré ce contexte, puis attends mes prompts suivants.
```

---

## Vue d'ensemble du modèle cible

```
besoins                 (demande, sans document)         <- flux ouvrier / plan
commandes               (en-tête document : BL/ticket/BC) <- capture mobile
  └─ commande_lignes    (articles + ventilation chantier/phase + prix)
factures                (facture fournisseur mensuelle)   <- rapprochement bureau
  └─ facture_bl         (liaison facture <-> BL + statut rapprochement)

Coût d'un chantier = somme des commande_lignes où chantier_id = X
  (provisoire tant que prix_verrouille = false ; définitif après rapprochement)
```

## Ordre d'exécution

| # | Prompt | Effet | Risque |
|---|--------|-------|--------|
| 1 | Création des tables (DDL) | non destructif | faible |
| 2 | Migration des données | recopie l'existant | moyen (backup requis) |
| 3 | Edge functions IA | extraction BL + facture | faible |
| 4 | Page de capture mobile | nouvelle page | faible |
| 5 | Page de rapprochement | nouvelle page | faible |
| 6 | Bascule du flux "besoins" | repointage écritures | moyen |
| 7 | Refonte page Commandes + coûts + nettoyage | repointage lectures, drop anciennes tables | moyen |

---

## Prompt 1 — Création des tables (SQL DDL)

```text
Crée un fichier de migration SQL `sql/2026xx_commandes_nouveau_modele.sql` avec
le contenu ci-dessous, puis aide-moi à l'exécuter dans le SQL Editor Supabase.
Ce script est NON DESTRUCTIF (création uniquement). Vérifie que les tables
référencées (fournisseurs, materiaux, phasages) existent bien avec ces noms ;
si un nom diffère, signale-le moi AVANT d'exécuter.
```

```sql
-- ============================================================
-- MIGRATION 01 — Nouveau modèle de commandes (création)
-- Non destructif. Ne touche pas commandes_detail / commandes_passees.
-- ============================================================

-- 1) En-tête de document d'achat (BL / ticket / bon de commande)
create table if not exists public.commandes (
  id                 uuid primary key default gen_random_uuid(),
  type_evenement     text not null default 'comptoir'
                       check (type_evenement in ('comptoir','commande','livraison')),
  doc_type           text not null default 'bl'
                       check (doc_type in ('ticket','bon_commande','bl')),
  doc_numero         text,
  numero_en_attente  boolean not null default false,
  fournisseur_id     uuid references public.fournisseurs(id) on delete set null,
  fournisseur_nom    text,
  date_doc           date,
  montant_ht         numeric,
  photo_url          text,
  saisi_par          text,
  statut_completude  text not null default 'a_completer'
                       check (statut_completude in ('a_completer','complete')),
  statut_facturation text not null default 'en_attente_facture'
                       check (statut_facturation in ('en_attente_facture','facture')),
  facture_id         uuid,  -- FK ajoutée plus bas
  source             text default 'mobile'
                       check (source in ('mobile','import_ia','migration','facture')),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- 2) Lignes d'articles (ventilation chantier/phase + prix)
create table if not exists public.commande_lignes (
  id              uuid primary key default gen_random_uuid(),
  commande_id     uuid not null references public.commandes(id) on delete cascade,
  libelle         text not null default '',
  reference       text,
  quantite        numeric,
  unite           text default 'U',
  prix_unitaire   numeric,
  prix_total      numeric,
  prix_verrouille boolean not null default false,  -- true après rapprochement facture
  materiau_id     uuid references public.materiaux(id) on delete set null,
  chantier_id     text,
  phasage_id      uuid references public.phasages(id) on delete set null,
  phase_id        text,
  created_at      timestamptz not null default now()
);

-- 3) Factures fournisseur (mensuelles)
create table if not exists public.factures (
  id              uuid primary key default gen_random_uuid(),
  fournisseur_id  uuid references public.fournisseurs(id) on delete set null,
  fournisseur_nom text,
  numero          text,
  date_facture    date,
  periode         text,           -- ex: '2026-06'
  montant_ht      numeric,
  photo_url       text,
  statut          text not null default 'a_rapprocher'
                    check (statut in ('a_rapprocher','rapprochee')),
  saisi_par       text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- FK commandes.facture_id -> factures.id (créée après factures)
alter table public.commandes drop constraint if exists commandes_facture_id_fkey;
alter table public.commandes
  add constraint commandes_facture_id_fkey
  foreign key (facture_id) references public.factures(id) on delete set null;

-- 4) Liaison facture <-> BL
create table if not exists public.facture_bl (
  id          uuid primary key default gen_random_uuid(),
  facture_id  uuid not null references public.factures(id) on delete cascade,
  commande_id uuid references public.commandes(id) on delete set null, -- null = BL manquant
  bl_numero   text,
  montant_ht  numeric,
  statut      text not null default 'rapproche'
                check (statut in ('rapproche','manquant','ecart')),
  created_at  timestamptz not null default now()
);

-- 5) Besoins (demandes ouvrier / plan) — flux séparé
create table if not exists public.besoins (
  id                uuid primary key default gen_random_uuid(),
  chantier_id       text,
  materiau_id       uuid references public.materiaux(id) on delete set null,
  article           text,
  quantite          text,           -- texte libre (ex "2 sacs"), comme l'existant
  unite             text default 'U',
  ouvrier_demandeur text,
  origine           text default 'ouvrier' check (origine in ('ouvrier','plan')),
  statut            text not null default 'en_attente'
                      check (statut in ('en_attente','traite','annule')),
  notes             text,
  created_at        timestamptz not null default now()
);

-- Index
create index if not exists commandes_fournisseur_idx   on public.commandes(fournisseur_id);
create index if not exists commandes_statut_fact_idx   on public.commandes(statut_facturation);
create index if not exists commandes_doc_numero_idx    on public.commandes(doc_numero);
create index if not exists commande_lignes_cmd_idx     on public.commande_lignes(commande_id);
create index if not exists commande_lignes_chantier_idx on public.commande_lignes(chantier_id);
create index if not exists commande_lignes_phase_idx   on public.commande_lignes(phasage_id, phase_id);
create index if not exists factures_fournisseur_idx    on public.factures(fournisseur_id);
create index if not exists facture_bl_facture_idx      on public.facture_bl(facture_id);
create index if not exists facture_bl_commande_idx     on public.facture_bl(commande_id);
create index if not exists besoins_chantier_idx        on public.besoins(chantier_id);
create index if not exists besoins_statut_idx          on public.besoins(statut);

-- Trigger updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_commandes_touch on public.commandes;
create trigger trg_commandes_touch before update on public.commandes
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_factures_touch on public.factures;
create trigger trg_factures_touch before update on public.factures
  for each row execute function public.touch_updated_at();

-- RLS : select/insert/update/delete pour authenticated (pattern existant)
do $$
declare t text;
begin
  foreach t in array array['commandes','commande_lignes','factures','facture_bl','besoins']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "%s_sel" on public.%I;', t, t);
    execute format('create policy "%s_sel" on public.%I for select to authenticated using (true);', t, t);
    execute format('drop policy if exists "%s_ins" on public.%I;', t, t);
    execute format('create policy "%s_ins" on public.%I for insert to authenticated with check (true);', t, t);
    execute format('drop policy if exists "%s_upd" on public.%I;', t, t);
    execute format('create policy "%s_upd" on public.%I for update to authenticated using (true) with check (true);', t, t);
    execute format('drop policy if exists "%s_del" on public.%I;', t, t);
    execute format('create policy "%s_del" on public.%I for delete to authenticated using (true);', t, t);
  end loop;
end $$;
```

**Critère d'acceptation** : les 5 tables existent, RLS activée, aucune erreur.

---

## Prompt 2 — Migration des données (SQL)

```text
On va recopier les données existantes dans les nouvelles tables. AVANT TOUT :
1) Confirme qu'un backup / une branche Supabase est en place.
2) Inspecte le schéma réel des tables `commandes_detail` et `commandes_passees`
   (liste exacte des colonnes et leurs types). Compare avec les colonnes
   utilisées dans le script ci-dessous et signale-moi tout écart (nom ou type)
   AVANT d'exécuter. En particulier vérifie le type de `commandes_detail.phasage_id`
   (uuid attendu) et le fait que `quantite` est du TEXT.
3) Exécute ensuite le script. Il NE SUPPRIME RIEN. À la fin, lance les requêtes
   de vérification (comptages) et donne-moi les résultats.

Logique de déduplication importante : la page "Planning des commandes" insérait
la MÊME commande à la fois dans commandes_passees ET dans commandes_detail (avec
une note commençant par "Commandé via Planning des commandes"). Pour éviter les
doublons : on migre commandes_passees comme source des commandes "passées", et
on EXCLUT de commandes_detail les lignes dont la note commence par ce texte.
```

```sql
-- ============================================================
-- MIGRATION 02 — Reprise des données (NON destructif)
-- ============================================================

-- Helper : cast numérique sûr depuis un texte libre
create or replace function public.safe_numeric(t text)
returns numeric language sql immutable as $$
  select case when t ~ '^\s*[0-9]+([.,][0-9]+)?\s*$'
              then replace(btrim(t), ',', '.')::numeric
         else null end;
$$;

-- (A) BESOINS : commandes_detail (statut besoin_ouvrier*) -> besoins
insert into public.besoins
  (chantier_id, materiau_id, article, quantite, ouvrier_demandeur, origine, statut, notes, created_at)
select cd.chantier_id, cd.materiau_id, cd.article, cd.quantite, cd.ouvrier_demandeur,
       'ouvrier', 'en_attente', cd.notes, coalesce(cd.created_at, now())
from public.commandes_detail cd
where cd.statut in ('besoin_ouvrier','besoin ouvrier','besoin_ouvriers');

-- (B) COMMANDES PASSÉES : commandes_passees -> commandes + commande_lignes
--     On réutilise l'id de commandes_passees comme id de commandes pour relier
--     facilement les lignes.
insert into public.commandes
  (id, type_evenement, doc_type, doc_numero, numero_en_attente, fournisseur_id,
   fournisseur_nom, date_doc, montant_ht, statut_completude, statut_facturation,
   source, notes, created_at)
select cp.id, 'commande', 'bon_commande', null, true, cp.fournisseur_id,
       cp.fournisseur_nom, cp.date_commande::date, cp.total_ht,
       'a_completer', 'en_attente_facture', 'migration',
       coalesce(cp.notes,'') || ' [Migré de commandes_passees]',
       coalesce(cp.date_commande, now())
from public.commandes_passees cp;

insert into public.commande_lignes
  (commande_id, libelle, quantite, unite, prix_unitaire, prix_total,
   chantier_id, phasage_id, phase_id)
select cp.id,
       coalesce(a->>'libelle',''),
       public.safe_numeric(a->>'quantite'),
       coalesce(nullif(a->>'unite',''),'U'),
       public.safe_numeric(a->>'prix_ht'),
       case when public.safe_numeric(a->>'prix_ht') is not null
             and public.safe_numeric(a->>'quantite') is not null
            then public.safe_numeric(a->>'prix_ht') * public.safe_numeric(a->>'quantite')
       end,
       cp.chantier_id, cp.phasage_id, cp.phase_id
from public.commandes_passees cp
cross join lateral jsonb_array_elements(coalesce(cp.articles,'[]'::jsonb)) as a;

-- (C) COMMANDES MANUELLES / IMPORTS IA : commandes_detail (hors besoins et hors
--     doublons du Planning) -> commandes + 1 ligne chacune.
with src as (
  select * from public.commandes_detail
  where statut in ('a_commander','commande','retire')
    and coalesce(notes,'') not like 'Commandé via Planning des commandes%'
)
insert into public.commandes
  (id, type_evenement, doc_type, doc_numero, numero_en_attente, fournisseur_nom,
   montant_ht, saisi_par, statut_completude, statut_facturation, source, notes, created_at)
select s.id, 'commande', 'bl', null, true, s.fournisseur, s.prix_ht,
       s.ouvrier_demandeur, 'a_completer', 'en_attente_facture', 'migration',
       coalesce(s.notes,'') || ' [Migré de commandes_detail / statut ' || s.statut || ']',
       coalesce(s.created_at, now())
from src s;

insert into public.commande_lignes
  (commande_id, libelle, quantite, prix_total, materiau_id, chantier_id, phasage_id, phase_id)
select s.id, s.article, public.safe_numeric(s.quantite), s.prix_ht,
       s.materiau_id, s.chantier_id, s.phasage_id, s.phase_id
from public.commandes_detail s
where s.statut in ('a_commander','commande','retire')
  and coalesce(s.notes,'') not like 'Commandé via Planning des commandes%';
```

```sql
-- ---- VÉRIFICATIONS (à exécuter après la migration) ----
select 'besoins'         as t, count(*) from public.besoins
union all select 'commandes',        count(*) from public.commandes
union all select 'commande_lignes',  count(*) from public.commande_lignes;

-- Contrôle : aucune commande sans lignes (devrait être 0 ou marginal)
select count(*) as commandes_sans_lignes
from public.commandes c
left join public.commande_lignes l on l.commande_id = c.id
where l.id is null;

-- Contrôle : lignes avec quantité non convertie (texte libre type "2 sacs")
-- -> à re-saisir manuellement plus tard si nécessaire
select count(*) as quantites_perdues
from public.commande_lignes where quantite is null;
```

**Critère d'acceptation** : comptages cohérents avec l'existant, pas de
commande orpheline, écart de doublons résolu (les lignes "Commandé via Planning"
ne sont pas re-créées).

---

## Prompt 3 — Edge functions IA (extraction)

```text
Mets à jour l'extraction IA pour le nouveau modèle.

1) Edge function existante `analyse-commande` (Supabase) : adapte le prompt
   envoyé au modèle pour qu'il retourne en plus du fournisseur et des lignes :
   - doc_type : "ticket" | "bon_commande" | "bl"
   - doc_numero : le numéro du document (n° de BL, ticket, etc.) ou null
   - date_doc : date du document (ISO) ou null
   - montant_ht : total HT ou null
   Garde le format JSON strict (objet avec { fournisseur, doc_type, doc_numero,
   date_doc, montant_ht, lignes:[{designation, reference, quantite,
   prix_unitaire, prix_total}] }). Conserve le parsing tolérant côté client.

2) Nouvelle Edge function `analyse-facture` : prend une image/PDF de facture
   fournisseur et retourne :
   { fournisseur, numero, date_facture, periode, montant_ht,
     bls: [ { bl_numero, montant_ht } ] }
   Le point critique : extraire la LISTE DES NUMÉROS DE BL référencés sur la
   facture (avec leur montant si présent). Demande explicitement au modèle de
   repérer tous les numéros de bons de livraison.

Réutilise la structure d'appel et la gestion d'erreur de `analyse-commande`.
Documente l'URL de la nouvelle fonction.
```

**Critère d'acceptation** : `analyse-commande` renvoie `doc_numero` ;
`analyse-facture` renvoie une liste `bls`.

---

## Prompt 4 — Page de capture mobile

```text
Crée une nouvelle page mobile `src/Renovation/CaptureCommandeMobile.jsx`,
pensée pour le chef de chantier et le conducteur, reliée aux tables `commandes`
et `commande_lignes`. Style sombre cohérent avec l'app (accent #FFC200).

FLUX (capture éclair) :
1) Accueil : bouton "Nouvelle commande" + liste des commandes récentes triées
   par statut_completude (pastille ambre = a_completer, verte = complete ;
   rouge si doc_numero manquant et numero_en_attente=false).
2) Choix : chantier par défaut (pré-sélectionné, mémorisé en localStorage du
   dernier utilisé) + type_evenement (comptoir / commande / livraison).
3) Capture : photo du document (input capture="environment") OU import galerie.
   Upload vers le bucket Supabase Storage EXISTANT nommé "photos", dans un
   sous-dossier "commandes/" (chemin type "commandes/{timestamp}_{rand}.{ext}").
   Réutilise le helper d'upload déjà en place dans le projet (cf. uploadRapportPhoto
   dans src/Renovation/RapportMobile.jsx : supabase.storage.from("photos")
   .upload(path, file) puis getPublicUrl) -> photo_url. Pour les vignettes dans
   la liste, utilise photoTransform() de src/supabase.js.
4) Analyse : appel à l'Edge function `analyse-commande`. Pré-remplit fournisseur,
   doc_numero, date_doc, montant_ht, lignes.
5) Vérification : tout est éditable. RÈGLE STRICTE : on ne peut pas enregistrer
   tant que `doc_numero` est vide, SAUF si la bascule "Numéro en attente" est
   activée (alors numero_en_attente=true). Affiche le champ en rouge + message
   quand l'IA ne l'a pas trouvé.
   Ventilation chantier : par défaut toutes les lignes prennent le chantier
   choisi à l'étape 2. Une bascule "Répartir sur plusieurs chantiers" révèle un
   sélecteur de chantier par ligne (écrit chantier_id sur chaque commande_ligne).
6) Enregistrement : insert dans `commandes` (source='mobile') + insert des
   `commande_lignes`. statut_completude = 'complete' si chantier(s), prix et
   doc_numero présents, sinon 'a_completer'. statut_facturation='en_attente_facture'.

Ajoute l'entrée de navigation/route vers cette page (mobile).

Référence d'UX : reprendre le flux validé en maquette (écran type -> photo ->
analyse -> vérification avec n° obligatoire + ventilation par ligne).
```

**Critère d'acceptation** : on peut capter un BL multi-chantiers de bout en
bout ; impossible d'enregistrer sans n° (hors "en attente").

---

## Prompt 5 — Page de rapprochement (bureau)

```text
Crée `src/Renovation/RapprochementFactures.jsx` (écran bureau), relié à
`factures` et `facture_bl`.

FLUX :
1) Capture/upload de la facture -> Edge function `analyse-facture` -> on obtient
   numero, fournisseur, date, periode, montant_ht et la liste `bls`.
2) Création d'une `factures` (statut 'a_rapprocher').
3) Pour chaque bl_numero lu : recherche d'une `commandes` (doc_type='bl') ayant
   ce doc_numero ET ce fournisseur, non encore facturée.
   - Trouvé  -> facture_bl { commande_id, bl_numero, montant_ht, statut:'rapproche' }
   - Manquant -> facture_bl { commande_id:null, bl_numero, montant_ht, statut:'manquant' }
4) Affichage : liste des BL appariés (vert) + BL manquants (rouge) avec un bouton
   "Saisir" qui ouvre la capture pré-remplie (n°, montant, fournisseur connus ;
   il restera à affecter le chantier). Bloc de comparaison : total des BL
   rapprochés vs montant facture ; écart résiduel (après remises) en contrôle.
5) CONFIRMATION : bouton DÉSACTIVÉ tant qu'il reste au moins un BL 'manquant'.
   À la confirmation :
   - factures.statut = 'rapprochee'
   - pour chaque BL rapproché : commandes.statut_facturation='facture',
     commandes.facture_id = facture.id, et report des prix de la facture sur les
     commande_lignes concernées avec prix_verrouille=true.
   - si écart de prix détecté sur un BL : statut facture_bl='ecart' (à signaler).

Réutilise l'appariement par NUMÉRO comme mécanisme principal ; la concordance de
total n'est qu'un contrôle de cohérence (remises comprises).
```

**Critère d'acceptation** : un BL listé sur la facture mais absent en base est
signalé et bloque la confirmation ; après confirmation, les prix des lignes
concernées sont verrouillés.

---

## Prompt 6 — Bascule du flux "besoins" vers la table `besoins`

```text
Repointe le flux "besoin" (demandes ouvrier / plan) vers la nouvelle table
`besoins`, sans toucher à l'UX des ouvriers.

1) `src/Renovation/RapportMobile.jsx` (et `BesoinCommandeDrawer.jsx` si besoin) :
   à la soumission du rapport, insère les articles du panier dans `besoins`
   (origine='ouvrier', statut='en_attente') au lieu de commandes_detail avec
   statut besoin_ouvrier.
2) `src/Renovation/PagePlanningCommandes.jsx` :
   - LECTURE des besoins : lire la table `besoins` (statut 'en_attente') au lieu
     de commandes_detail (besoin_ouvrier*).
   - ÉCRITURE des commandes : à l'envoi d'une commande, écrire UNIQUEMENT dans
     `commandes` + `commande_lignes` (type_evenement='commande',
     doc_type='bon_commande'). SUPPRIME la double écriture vers commandes_passees
     ET commandes_detail. Marque les `besoins` couverts comme statut='traite'.
   - Conserve l'écriture du coût/log dans phasages.plan_travaux si elle sert
     encore l'affichage du Plan de travaux (à vérifier avec le Prompt 7).
3) `api/cron-recap-commandes.js` : lire les demandes ouvrier depuis `besoins`
   (statut 'en_attente') au lieu de commandes_detail.

Ne supprime pas encore commandes_detail / commandes_passees.
```

**Critère d'acceptation** : un nouveau besoin ouvrier atterrit dans `besoins` ;
le Planning n'écrit plus qu'une seule fois (dans le nouveau modèle).

---

## Prompt 7 — Refonte de la page Commandes + coûts + nettoyage

```text
Finalise la bascule sur le nouveau modèle, puis nettoie.

1) `src/Renovation/Commandes.jsx` (PageCommandes) : c'est désormais la VUE BUREAU
   de suivi/enrichissement. Lire `commandes` + `commande_lignes` (plus
   commandes_detail). 
   - File "À compléter" = commandes.statut_completude='a_completer' (champs
     manquants : chantier sur une ligne, prix, ou doc_numero en attente).
   - Édition : permettre d'affecter chantier/phase par ligne, valider les prix,
     passer en 'complete'.
   - Le PanneauDemandes lit la table `besoins` (statut 'en_attente') et permet
     de les convertir (les transformer en `commandes`/lignes ou les marquer
     'traite' une fois commandées).
   - Vues liste / fournisseur / chantier et export CSV : recalculer depuis le
     nouveau modèle.
   - L'ancien import IA de la modale peut rester, mais doit écrire dans
     `commandes`/`commande_lignes`.
2) COÛTS PAR CHANTIER : remplace toute lecture de coût matériel par une
   agrégation `sum(commande_lignes.prix_total)` (ou prix_unitaire*quantite)
   groupée par chantier_id / phase_id. Distingue visuellement provisoire
   (prix_verrouille=false) et définitif (true) si pertinent dans le Plan de
   travaux.
3) NETTOYAGE (seulement après validation complète en conditions réelles) :
   - Vérifie qu'aucune lecture/écriture ne pointe encore vers commandes_detail
     ni commandes_passees (grep dans le repo).
   - Une fois sûr : crée une migration `sql/2026xx_drop_anciennes_tables.sql` qui
     renomme d'abord les tables en _archive (au lieu de drop direct) :
       alter table public.commandes_detail  rename to commandes_detail_archive;
       alter table public.commandes_passees rename to commandes_passees_archive;
     On supprimera réellement après quelques semaines de recul.

Liste-moi tous les fichiers modifiés et les éventuelles références résiduelles
aux anciennes tables.
```

**Critère d'acceptation** : plus aucune référence active à `commandes_detail` /
`commandes_passees` dans le code ; les coûts chantier s'agrègent depuis
`commande_lignes` ; anciennes tables archivées (renommées), pas encore
supprimées.

---

## Annexe — Rollback rapide (si besoin pendant la mise au point)

```sql
-- Vide les nouvelles tables sans toucher à l'existant (l'existant est intact
-- tant que le Prompt 7 n'a pas archivé/supprimé les anciennes tables).
truncate public.facture_bl, public.factures,
         public.commande_lignes, public.commandes,
         public.besoins restart identity cascade;
```

Pour réinitialiser complètement le schéma cible :
`drop table if exists public.facture_bl, public.factures, public.commande_lignes,
public.commandes, public.besoins cascade;` puis ré-exécuter le Prompt 1.

---

### Points à surveiller pendant l'exécution
- Le cast des quantités texte -> numérique (Prompt 2) peut perdre des valeurs du
  type "2 sacs" : la requête de contrôle `quantites_perdues` les comptabilise.
- Vérifier le type réel de `commandes_detail.phasage_id` (uuid attendu).
- Le bucket Supabase Storage `photos` existe déjà et sert d'autres modules
  (rapports, visites, chantiers) ; le Prompt 4 le réutilise dans le sous-dossier
  `commandes/`. Aucune création de bucket ni de policy n'est nécessaire.
- L'appariement par numéro (Prompt 5) suppose des `doc_numero` propres : prévoir
  une normalisation simple (trim, casse) à la comparaison.
