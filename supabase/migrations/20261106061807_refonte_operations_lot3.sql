-- ============================================================================
-- Refonte Opérations, lot 3 (06/11/2026) — nouveau cycle de vie du chantier
-- (5 phases) et relances par e-mail.
-- Fichier projet : docs/projets/refonte-operations.md.
-- Compte rendu   : docs/project/REFONTE-OPERATIONS-COMPTE-RENDU.md.
--
-- Migration PUREMENT ADDITIVE : deux tables créées. Aucune donnée existante
-- n'est lue, réécrite ni supprimée ; aucune fonction SECURITY DEFINER, aucune
-- policy existante touchée.
--
--   1. public.chantier_cycle_vie : état des étapes du cycle de vie, une ligne
--      par chantier et par étape. Jusqu'ici l'état vivait dans le phasage
--      (phasages.plan_travaux.meta.cycle_vie_etapes) : un chantier « À
--      l'étude » n'a pas encore de phasage, il ne pouvait donc pas valider
--      « Devis envoyé » ni « Devis signé ». Les états déjà enregistrés dans
--      le phasage NE SONT PAS recopiés : ils sont relus et reportés sur le
--      nouveau cycle à l'affichage (src/Renovation/cycleVieReprise.mjs), et
--      restent intacts en base. Une ligne de cette table, quand elle existe,
--      prime sur l'ancien état du phasage pour la même étape.
--      Bureau : lecture, création, modification. Ouvriers : lecture des seuls
--      plans techniques (ils voyaient déjà les « plans d'exécution » du
--      phasage par ouvrier_chantier_detail). Pas de DELETE.
--   2. public.relances_cycle_vie : journal des relances e-mail (devis non
--      signé, facture d'acompte non réglée) envoyées par la tâche planifiée.
--      Une ligne par chantier, type, date de référence et semaine de relance :
--      la contrainte d'unicité empêche d'envoyer deux fois la même relance.
--      Écrite uniquement par le serveur (clé service) ; le bureau la lit pour
--      afficher le nombre de relances et la date de la dernière.
--
-- Réglages (ni table ni colonne) : clé planning_config « relances_cycle_vie »
-- = { actif, delai_jours }. ABSENTE = relances ÉTEINTES, délai 7 jours.
--
-- Retour arrière : sql/202611_refonte_operations_lot3_rollback.sql.
--
-- APPLIQUÉE le 06/11/2026 (version 20261106061807, apply_migration), après un
-- essai complet dans une transaction annulée (deux policies restrictives
-- posées, une ligne d'essai insérée dans chaque table puis annulée ;
-- 46 chantiers / 49 phasages inchangés). Corps appliqué = ce fichier, aux
-- commentaires près.
-- ============================================================================

-- ─── 1. État des étapes du cycle de vie ─────────────────────────────────────
create table public.chantier_cycle_vie (
  chantier_id  text        not null references public.chantiers(id) on update cascade on delete restrict,
  -- Identifiant d'étape du référentiel src/Renovation/cycleVie.mjs.
  etape_id     text        not null,
  -- { fait, date, auteur, donnees, pieces_jointes, departage } — même forme
  -- que l'ancien meta.cycle_vie_etapes[etapeId].
  etat         jsonb       not null default '{}'::jsonb,
  maj_par      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (chantier_id, etape_id),
  constraint chantier_cycle_vie_etat_objet check (jsonb_typeof(etat) = 'object')
);
create index chantier_cycle_vie_etape_idx on public.chantier_cycle_vie (etape_id);

alter table public.chantier_cycle_vie enable row level security;
revoke all on public.chantier_cycle_vie from anon, authenticated;
grant select, insert, update on public.chantier_cycle_vie to authenticated;
create policy profero_collaborateurs_seulement on public.chantier_cycle_vie
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif()))
  with check ((select public.est_collaborateur_actif()));
create policy "cycle vie bureau lecture" on public.chantier_cycle_vie for select to authenticated
  using ((select not public.est_ouvrier()));
create policy "cycle vie ouvrier plans techniques" on public.chantier_cycle_vie for select to authenticated
  using ((select public.est_ouvrier()) and etape_id = 'plans_techniques');
create policy "cycle vie bureau creation" on public.chantier_cycle_vie for insert to authenticated
  with check ((select not public.est_ouvrier()));
create policy "cycle vie bureau modification" on public.chantier_cycle_vie for update to authenticated
  using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
create trigger chantier_cycle_vie_set_updated_at before update on public.chantier_cycle_vie
  for each row execute function public.set_updated_at();

-- ─── 2. Journal des relances e-mail ─────────────────────────────────────────
create table public.relances_cycle_vie (
  id            bigint      generated always as identity primary key,
  chantier_id   text        not null references public.chantiers(id) on update cascade on delete restrict,
  -- 'devis' (devis envoyé non signé) | 'acompte' (facture d'acompte non réglée)
  type          text        not null,
  -- Date de référence (envoi du devis / émission de la facture), AAAA-MM-JJ :
  -- un nouveau devis repart de zéro.
  reference     text        not null,
  -- 0 = première relance (J + délai), 1 = une semaine plus tard, etc.
  periode       integer     not null,
  destinataire  text,
  -- 'en_cours' (réservée, envoi en cours) | 'envoyee' | 'echec'
  statut        text        not null default 'en_cours',
  detail        text,
  envoye_le     timestamptz not null default now(),
  constraint relances_cycle_vie_type_valide check (type in ('devis', 'acompte')),
  constraint relances_cycle_vie_statut_valide check (statut in ('en_cours', 'envoyee', 'echec')),
  constraint relances_cycle_vie_unique unique (chantier_id, type, reference, periode)
);
create index relances_cycle_vie_chantier_idx on public.relances_cycle_vie (chantier_id, type, envoye_le);

alter table public.relances_cycle_vie enable row level security;
revoke all on public.relances_cycle_vie from anon, authenticated;
-- Lecture seule pour le bureau : seul le serveur (clé service) écrit.
grant select on public.relances_cycle_vie to authenticated;
create policy profero_collaborateurs_seulement on public.relances_cycle_vie
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif()))
  with check ((select public.est_collaborateur_actif()));
create policy "relances bureau lecture" on public.relances_cycle_vie for select to authenticated
  using ((select not public.est_ouvrier()));
