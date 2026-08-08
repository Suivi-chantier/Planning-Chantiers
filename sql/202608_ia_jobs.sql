-- Chantier 0 — Socle technique IA — Étape 1 : table ia_jobs.
-- Réf. : public/chantier-0-socle-technique-ia.md § 4 (Brique 2).
--
-- Journal de TOUS les appels IA (route /api/ai, plus tard /api/mcp avec
-- tache = 'mcp:<nom_outil>'). Succès ET échecs. La donnée la plus précieuse
-- est le différentiel sortie_brute / sortie_validee : c'est lui qui dira
-- quel prompt améliorer et quelle tâche est mûre pour plus d'automatisation.
--
-- ÉCRITURE SERVEUR UNIQUEMENT : la route /api/ai écrit avec la
-- SUPABASE_SERVICE_ROLE_KEY (qui contourne la RLS). Aucune policy INSERT /
-- UPDATE / DELETE côté client — c'est voulu, ne pas en ajouter.
-- LECTURE : admin voit tout ; un utilisateur voit ses propres jobs.

create table if not exists public.ia_jobs (
  id              uuid primary key default gen_random_uuid(),
  cree_le         timestamptz not null default now(),

  -- Qui / quoi
  utilisateur_id  uuid,
  utilisateur_email text,
  role            text,
  branche         text,
  tache           text not null,

  -- Rattachement métier (nullable, pour filtrer les analyses)
  chantier_id     text,
  entite_type     text,          -- 'commande', 'phasage', 'pointage', ...
  entite_id       text,

  -- Contenu
  entree          jsonb,
  sortie_brute    jsonb,         -- ce que le modèle a répondu
  sortie_validee  jsonb,         -- ce que l'humain a validé, après corrections
  corrige         boolean default false,
  valide_par      text,
  valide_le       timestamptz,

  -- Exécution
  statut          text not null, -- 'succes' | 'echec' | 'en_attente_validation' | 'rejete'
  erreur_code     text,
  erreur_message  text,
  modele          text,
  tokens_entree   integer,
  tokens_sortie   integer,
  cout_eur        numeric(10,5),
  duree_ms        integer
);

create index if not exists idx_ia_jobs_tache_date
  on public.ia_jobs (tache, cree_le desc);
create index if not exists idx_ia_jobs_chantier
  on public.ia_jobs (chantier_id);
create index if not exists idx_ia_jobs_email_date
  on public.ia_jobs (utilisateur_email, cree_le desc);
create index if not exists idx_ia_jobs_en_attente
  on public.ia_jobs (statut) where statut = 'en_attente_validation';

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table public.ia_jobs enable row level security;

-- Lecture : admin → tout ; sinon → ses propres jobs (email du JWT).
drop policy if exists "ia_jobs_lecture" on public.ia_jobs;
create policy "ia_jobs_lecture" on public.ia_jobs
  for select to authenticated
  using (
    public.mon_role() = 'admin'
    or utilisateur_email = auth.email()
  );

-- Aucune policy INSERT/UPDATE/DELETE : avec la RLS activée, tout écrit
-- client est rejeté. Seul le serveur (service role key) écrit.

-- ---------------------------------------------------------------------
-- Rétention (§ 4.3) : au-delà de 12 mois, purger les contenus (entree,
-- sortie_brute, sortie_validee) en conservant les métadonnées (coût,
-- statut, tâche) indéfiniment pour les statistiques.
-- À invoquer manuellement depuis le SQL editor (ou plus tard via un cron,
-- Chantier 3) : select public.purge_ia_jobs_contenus();
-- ---------------------------------------------------------------------

create or replace function public.purge_ia_jobs_contenus()
returns integer
language sql
security definer
set search_path = public
as $$
  with purge as (
    update public.ia_jobs
    set entree = null,
        sortie_brute = null,
        sortie_validee = null,
        erreur_message = null
    where cree_le < now() - interval '12 months'
      and (entree is not null
        or sortie_brute is not null
        or sortie_validee is not null
        or erreur_message is not null)
    returning 1
  )
  select coalesce(count(*), 0)::integer from purge;
$$;

-- Réservée à l'admin (et au service role) : pas d'exécution par défaut.
revoke execute on function public.purge_ia_jobs_contenus() from public, anon, authenticated;
