-- ============================================================================
-- Nouvel éditeur de plans — tâche 3 : la table des plans du nouvel éditeur.
-- Fichier projet : docs/projets/editeur-plans.md (règle 1 : « le nouvel
-- éditeur a sa propre table, rattachée à un chantier, avec la policy
-- profero_collaborateurs_seulement »).
--
-- Une ligne = un plan du nouvel éditeur. Le document du plan (relevé d'origine
-- copié, existant figé, points à valider, projet, réglages) est dans `data` :
-- sa forme est décrite dans src/Renovation/planV2/planV2Document.mjs.
--
-- PUREMENT ADDITIVE : une nouvelle table, ses deux index, son déclencheur de
-- date de modification, ses droits. Aucune table existante n'est modifiée,
-- aucune donnée existante n'est touchée. En particulier l'ancienne table des
-- plans n'est nommée nulle part dans ce fichier : `origine_plan_id` est une
-- simple colonne uuid, SANS clé étrangère (une clé étrangère poserait des
-- déclencheurs internes sur l'ancienne table, que la règle 1 veut intacte).
-- Contrôlé par scripts/verif-plan-v2-aucune-ecriture-plans.mjs.
--
-- Rattachement au chantier : clé étrangère vers public.chantiers, comme les
-- trois tables créées depuis que les chantiers ont leur table (journal des
-- statuts, cycle de vie, relances — lots 2 et 3 de la refonte Opérations) :
-- `on update cascade on delete restrict`. Un plan ne peut pas désigner un
-- chantier qui n'existe pas ; un chantier qui a des plans ne peut pas être
-- supprimé (il s'archive, comme le veut déjà la refonte : aucun droit DELETE
-- sur public.chantiers).
--
-- Accès (accord de Loris du 25/11/2026, question 1 du fichier projet) : les
-- mêmes règles que l'ancienne table des plans — tout le bureau, pas les
-- ouvriers (`bureau_all`) — plus la règle restrictive « réservé aux
-- collaborateurs ». Rien d'autre : aucune autre policy, aucune fonction,
-- aucun SECURITY DEFINER. Privilèges : comptes connectés seulement (lecture,
-- création, modification, suppression) ; aucun accès anonyme.
--
-- Déclencheur : public.set_updated_at() existe déjà (clients, chantiers,
-- cycle de vie…) ; elle n'est pas modifiée. C'est la base qui date chaque
-- modification : l'éditeur s'en sert pour ne pas écraser une version plus
-- récente enregistrée ailleurs.
--
-- Rejouable. Retour arrière : sql/202611_plans_v2_rollback.sql.
-- ============================================================================
create table if not exists public.plans_v2 (
  id               uuid        primary key default gen_random_uuid(),
  chantier_id      text        not null references public.chantiers(id) on update cascade on delete restrict,
  nom              text        not null default 'Sans titre',
  -- Texte libre (« Appt 1 — T3 », « RDC »…) : il ira dans le cartouche des PDF.
  logement         text        not null default '',
  -- Le document du plan. Pas de valeur par défaut : un plan sans document
  -- n'existe pas. Aucune miniature en image n'est stockée ici.
  data             jsonb       not null,
  -- Chiffres de la liste (pièces, surface, points à valider restants), écrits
  -- en même temps que `data` par le même service : la liste des plans n'a pas
  -- à charger les documents.
  resume           jsonb       not null default '{}'::jsonb,
  -- Identifiant du plan de l'ancien éditeur dont le relevé a été copié ; vide
  -- pour un import direct. Simple repère, sans contrainte.
  origine_plan_id  uuid,
  cree_par         text,
  modifie_par      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint plans_v2_chantier_non_vide check (btrim(chantier_id) <> ''),
  constraint plans_v2_nom_non_vide check (btrim(nom) <> ''),
  constraint plans_v2_data_document check (jsonb_typeof(data) = 'object' and data ? 'version'),
  constraint plans_v2_resume_objet check (jsonb_typeof(resume) = 'object')
);
create index if not exists plans_v2_chantier_idx on public.plans_v2 (chantier_id, updated_at desc);
create index if not exists plans_v2_origine_idx on public.plans_v2 (origine_plan_id) where origine_plan_id is not null;
comment on table public.plans_v2 is
  'Plans du nouvel éditeur (un plan = une ligne, document dans data). Projet editeur-plans, tâche 3.';

drop trigger if exists plans_v2_set_updated_at on public.plans_v2;
create trigger plans_v2_set_updated_at before update on public.plans_v2
  for each row execute function public.set_updated_at();

alter table public.plans_v2 enable row level security;
revoke all on public.plans_v2 from anon, authenticated;
grant select, insert, update, delete on public.plans_v2 to authenticated;
grant all on public.plans_v2 to service_role;

drop policy if exists bureau_all on public.plans_v2;
create policy bureau_all on public.plans_v2 for all to authenticated
  using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));

drop policy if exists profero_collaborateurs_seulement on public.plans_v2;
create policy profero_collaborateurs_seulement on public.plans_v2
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));
