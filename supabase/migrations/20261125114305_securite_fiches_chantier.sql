-- ============================================================================
-- Fiche de préparation sécurité chantier — migration v1 (tâche 1 du projet
-- docs/projets/fiche-securite-chantier.md).
--
-- Additive : 5 tables securite_, 2 vues, déclencheurs d'immuabilité, droits,
-- un bucket privé securite-confidentiel. Aucune table existante n'est modifiée.
-- Seul objet existant touché : la policy RESTRICTIVE profero_collaborateurs_seulement
-- de storage.objects, recréée à l'identique avec le nouveau bucket en plus.
--
-- Écarts avec le SQL de la spécification du 25/11/2026 (détail et raisons dans
-- le journal du fichier projet) :
--   a. bucket securite-confidentiel ajouté à profero_collaborateurs_seulement ;
--   b. droits explicites (revoke all + grant minimal), sur le modèle de
--      chantiers_statut_journal : pas de DELETE ni TRUNCATE pour authenticated,
--      UPDATE des versions limité à la colonne pdf_path ;
--   c. TRUNCATE refusé aussi par déclencheur sur versions et signatures ;
--   d. signature d'accueil d'un ouvrier : seulement sur la version validée en
--      cours d'une fiche d'un chantier non archivé, avec la bonne empreinte ;
--      l'ouvrier lit les versions des fiches qu'il voit (pour signer) ;
--   e. une signature saisie au bureau ne peut pas porter le compte d'un autre
--      utilisateur (auth_user_id vide ou égal au compte connecté) ;
--   f. colonnes qualifiées dans les sous-requêtes des policies ouvrier ;
--   g. search_path figé sur les fonctions de déclencheur ;
--   h. garde-fou final : la migration échoue si une table securite_ n'a pas la
--      RLS et profero_collaborateurs_seulement, ou si le bucket n'est pas couvert.
-- ============================================================================

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
create function public.securite_versions_immuables()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
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
create trigger securite_fiches_versions_sans_truncate
  before truncate on public.securite_fiches_versions
  for each statement execute function public.securite_versions_immuables();

create function public.securite_signatures_immuables()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Une signature ne peut être ni modifiée ni supprimée';
end $$;

create trigger securite_signatures_immuables
  before update or delete on public.securite_signatures
  for each row execute function public.securite_signatures_immuables();
create trigger securite_signatures_sans_truncate
  before truncate on public.securite_signatures
  for each statement execute function public.securite_signatures_immuables();

-- une fiche verrouillée ne bouge plus
create function public.securite_fiche_verrouillee()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.statut = 'verrouillee' then
    raise exception 'Fiche sécurité verrouillée (chantier terminé)';
  end if;
  return new;
end $$;

create trigger securite_fiches_verrou
  before update on public.securite_fiches
  for each row execute function public.securite_fiche_verrouillee();

-- 8. Vues d'état (pastilles, expirations). security_invoker : chaque lecteur
-- n'y voit que ce que la RLS des tables lui montre (aptitudes médicales
-- comprises : invisibles pour un non-admin). « Prêt à démarrer » et
-- « justificatifs requis manquants » sont calculés dans l'appli.
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

-- 9. Droits SQL (modèle chantiers_statut_journal) : rien pour anon, aucun
-- DELETE ni TRUNCATE pour authenticated.
revoke all on public.securite_operations, public.securite_fiches, public.securite_fiches_versions,
  public.securite_signatures, public.securite_justificatifs,
  public.securite_fiches_etat, public.securite_justificatifs_expiration
  from anon, authenticated;
grant select, insert, update on public.securite_operations    to authenticated;
grant select, insert, update on public.securite_fiches        to authenticated;
grant select, insert         on public.securite_fiches_versions to authenticated;
grant update (pdf_path)      on public.securite_fiches_versions to authenticated;
grant select, insert         on public.securite_signatures    to authenticated;
grant select, insert, update on public.securite_justificatifs to authenticated;
grant select on public.securite_fiches_etat, public.securite_justificatifs_expiration to authenticated;

-- 10. RLS
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
  using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));  -- le déclencheur n'autorise que pdf_path, une fois
create policy "securite signatures bureau lecture" on public.securite_signatures for select to authenticated
  using ((select not public.est_ouvrier()));
create policy "securite signatures bureau ajout" on public.securite_signatures for insert to authenticated
  with check ((select not public.est_ouvrier())
              and (auth_user_id is null or auth_user_id = (select auth.uid())));
create policy "securite justificatifs bureau lecture" on public.securite_justificatifs for select to authenticated
  using ((select not public.est_ouvrier()) and (not confidentiel or (select public.is_admin())));
create policy "securite justificatifs bureau ecriture" on public.securite_justificatifs for insert to authenticated
  with check ((select not public.est_ouvrier()) and (not confidentiel or (select public.is_admin())));
create policy "securite justificatifs bureau modification" on public.securite_justificatifs for update to authenticated
  using ((select not public.est_ouvrier()) and (not confidentiel or (select public.is_admin())))
  with check ((select not public.est_ouvrier()) and (not confidentiel or (select public.is_admin())));

-- ouvriers : lecture des fiches de chantiers non archivés, signature d'accueil à leur nom
create policy "securite operations ouvrier lecture" on public.securite_operations for select to authenticated
  using ((select public.est_ouvrier()));
create policy "securite fiches ouvrier lecture" on public.securite_fiches for select to authenticated
  using ((select public.est_ouvrier()) and exists (
    select 1 from public.chantiers c
     where c.id = securite_fiches.chantier_id and c.archive_le is null));
create policy "securite versions ouvrier lecture" on public.securite_fiches_versions for select to authenticated
  using ((select public.est_ouvrier()) and exists (
    select 1 from public.securite_fiches f join public.chantiers c on c.id = f.chantier_id
     where f.id = securite_fiches_versions.fiche_id and c.archive_le is null));
create policy "securite signatures ouvrier lecture" on public.securite_signatures for select to authenticated
  using ((select public.est_ouvrier()) and auth_user_id = (select auth.uid()));
create policy "securite signatures ouvrier accueil" on public.securite_signatures for insert to authenticated
  with check ((select public.est_ouvrier()) and type = 'accueil' and auth_user_id = (select auth.uid())
    and exists (
      select 1
        from public.securite_fiches f
        join public.chantiers c on c.id = f.chantier_id
        join public.securite_fiches_versions v on v.fiche_id = f.id and v.version = f.version
       where f.id = securite_signatures.fiche_id
         and f.version = securite_signatures.version
         and v.empreinte = securite_signatures.empreinte_version
         and f.statut = 'validee'
         and c.archive_le is null));
create policy "securite justificatifs ouvrier lecture" on public.securite_justificatifs for select to authenticated
  using ((select public.est_ouvrier()) and portee = 'chantier' and not confidentiel
         and archive_le is null and exists (
           select 1 from public.chantiers c
            where c.id = securite_justificatifs.chantier_id and c.archive_le is null));

-- 11. Stockage des documents confidentiels
-- Le bucket chantier-documents est lisible par tout collaborateur :
-- les aptitudes médicales vont dans un bucket séparé réservé aux admins.
insert into storage.buckets (id, name, public) values ('securite-confidentiel', 'securite-confidentiel', false)
  on conflict (id) do nothing;

create policy "securite confidentiel admin lecture" on storage.objects for select to authenticated
  using (bucket_id = 'securite-confidentiel' and (select public.is_admin()));
create policy "securite confidentiel admin ecriture" on storage.objects for insert to authenticated
  with check (bucket_id = 'securite-confidentiel' and (select public.is_admin()));

-- Verrou commun (deny by default) : définition en place au 25/11/2026,
-- recréée à l'identique avec 'securite-confidentiel' en plus. Rien d'autre.
drop policy if exists profero_collaborateurs_seulement on storage.objects;
create policy profero_collaborateurs_seulement on storage.objects as restrictive for all to authenticated
  using (bucket_id not in ('chantier-documents', 'invest-documents', 'photos', 'securite-confidentiel') or (select public.est_collaborateur_actif()))
  with check (bucket_id not in ('chantier-documents', 'invest-documents', 'photos', 'securite-confidentiel') or (select public.est_collaborateur_actif()));

-- 12. Garde-fous : rien n'est appliqué si la couverture n'est pas complète.
do $do$
declare manquantes text;
begin
  select string_agg(t, ', ' order by t) into manquantes
  from unnest(array['securite_operations','securite_fiches','securite_fiches_versions',
                    'securite_signatures','securite_justificatifs']) t
  where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and c.relname = t and c.relrowsecurity)
     or not exists (select 1 from pg_policies p
                     where p.schemaname = 'public' and p.tablename = t
                       and p.policyname = 'profero_collaborateurs_seulement' and p.permissive = 'RESTRICTIVE');
  if manquantes is not null then
    raise exception 'Tables securite_ sans RLS ou sans profero_collaborateurs_seulement : %', manquantes;
  end if;
  if not exists (select 1 from pg_policies p
                  where p.schemaname = 'storage' and p.tablename = 'objects'
                    and p.policyname = 'profero_collaborateurs_seulement' and p.permissive = 'RESTRICTIVE'
                    and p.qual like '%securite-confidentiel%' and p.with_check like '%securite-confidentiel%') then
    raise exception 'Bucket securite-confidentiel non couvert par profero_collaborateurs_seulement';
  end if;
end
$do$;
