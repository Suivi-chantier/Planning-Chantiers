-- ============================================================================
-- Notes des ouvriers — carnet de notes de l'espace ouvrier (14/10/2026).
--
-- Un ouvrier écrit des notes (texte, liste à cocher, photos), éventuellement
-- rattachées à un chantier. Une note est PRIVÉE par défaut. Il peut la
-- partager avec des collègues (prénoms), avec le bureau, ou l'épingler comme
-- « mémo chantier » (digicode, clés, coupure d'eau…).
--
-- QUI VOIT QUOI (décision du 14/10/2026 : une note privée est réellement
-- invisible pour le bureau, admin compris)
--   auteur            : ses notes, toujours ;
--   collègue          : les notes où son prénom figure dans partage_ouvriers ;
--   tous les ouvriers : les mémos chantier ;
--   bureau            : les notes partagées au bureau + les mémos chantier.
--   Une note privée n'a AUCUNE policy bureau : même un admin ne la lit pas
--   (seul service_role, hors application, contourne la RLS).
--
-- QUI ÉCRIT QUOI
--   ouvrier : crée ses notes ; modifie / supprime uniquement les siennes ;
--   bureau  : ne crée pas de note ; sur une note qu'il voit, ne change QUE le
--             suivi (statut_bureau) — le trigger refuse toute autre colonne ;
--   réponses : tout compte qui voit une note peut y répondre (fil).
--
-- PHOTOS : bucket PRIVÉ « notes-ouvriers » (le bucket « photos » est public,
--   il ne convient pas à une note privée). Chemin : <auth.uid()>/<fichier>.
--   Lecture = son propre dossier, ou une photo citée par une note visible
--   (la RLS de notes_ouvriers s'applique dans la sous-requête).
--
-- Additive : 3 tables, 1 bucket, 1 RPC, des triggers. Ne modifie aucune table,
-- policy ni fonction existante. Rejouable.
-- RETOUR ARRIÈRE : sql/202610_notes_ouvriers_rollback.sql
-- VÉRIFICATION  : node scripts/verif-notes-ouvriers.mjs
-- ============================================================================

-- ── 1. Tables ───────────────────────────────────────────────────────────────
create table if not exists public.notes_ouvriers (
  id                    uuid primary key default gen_random_uuid(),
  auteur                text not null,
  auteur_uid            uuid not null default auth.uid(),
  type                  text not null default 'note' check (type in ('note', 'signaler', 'astuce')),
  titre                 text not null default '' check (char_length(titre) <= 200),
  contenu               text not null default '' check (char_length(contenu) <= 20000),
  checklist             jsonb not null default '[]'::jsonb
                          check (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) <= 100),
  photos                jsonb not null default '[]'::jsonb
                          check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 10),
  chantier_id           text,
  memo_chantier         boolean not null default false,
  partage_bureau        boolean not null default false,
  partage_ouvriers      text[] not null default '{}',
  statut_bureau         text check (statut_bureau in ('nouveau', 'lu', 'traite')),
  statut_par            text,
  statut_le             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  derniere_activite     timestamptz not null default now(),
  derniere_activite_par uuid,
  constraint notes_ouvriers_memo_chantier check (not memo_chantier or chantier_id is not null)
);
create index if not exists notes_ouvriers_auteur_idx   on public.notes_ouvriers (auteur_uid);
create index if not exists notes_ouvriers_chantier_idx on public.notes_ouvriers (chantier_id);
create index if not exists notes_ouvriers_activite_idx on public.notes_ouvriers (derniere_activite desc);

create table if not exists public.notes_ouvriers_reponses (
  id          uuid primary key default gen_random_uuid(),
  note_id     uuid not null references public.notes_ouvriers(id) on delete cascade,
  auteur      text not null,
  auteur_uid  uuid not null default auth.uid(),
  cote        text not null check (cote in ('ouvrier', 'bureau')),
  contenu     text not null check (char_length(btrim(contenu)) between 1 and 5000),
  created_at  timestamptz not null default now()
);
create index if not exists notes_ouvriers_reponses_note_idx on public.notes_ouvriers_reponses (note_id, created_at);

create table if not exists public.notes_ouvriers_lectures (
  note_id     uuid not null references public.notes_ouvriers(id) on delete cascade,
  lecteur_uid uuid not null default auth.uid(),
  lu_le       timestamptz not null default now(),
  primary key (note_id, lecteur_uid)
);

-- ── 2. Droits ───────────────────────────────────────────────────────────────
alter table public.notes_ouvriers          enable row level security;
alter table public.notes_ouvriers_reponses enable row level security;
alter table public.notes_ouvriers_lectures enable row level security;
revoke all on public.notes_ouvriers, public.notes_ouvriers_reponses, public.notes_ouvriers_lectures from anon, authenticated;
grant select, insert, update, delete on public.notes_ouvriers          to authenticated;
grant select, insert, delete         on public.notes_ouvriers_reponses to authenticated;
grant select, insert, update, delete on public.notes_ouvriers_lectures to authenticated;
grant all on public.notes_ouvriers, public.notes_ouvriers_reponses, public.notes_ouvriers_lectures to service_role;

-- ── 3. Visibilité d'une note pour l'appelant (ouvrier) ──────────────────────
-- Comparaison des prénoms par norm_prenom (casse, accents, espaces), comme
-- les autres RPC de l'espace ouvrier.
create or replace function public.note_partagee_avec_moi(p_partage text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from unnest(coalesce(p_partage, '{}')) p
    where public.norm_prenom(p) <> ''
      and public.norm_prenom(p) = public.norm_prenom(public.mon_prenom_planning())
  );
$$;
revoke all on function public.note_partagee_avec_moi(text[]) from public, anon;
grant execute on function public.note_partagee_avec_moi(text[]) to authenticated;

-- ── 4. Policies ─────────────────────────────────────────────────────────────
do $do$
declare t text;
begin
  foreach t in array array['notes_ouvriers', 'notes_ouvriers_reponses', 'notes_ouvriers_lectures'] loop
    execute format('drop policy if exists profero_collaborateurs_seulement on public.%I', t);
    execute format(
      'create policy profero_collaborateurs_seulement on public.%I as restrictive for all to authenticated '
      'using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()))', t);
  end loop;
end $do$;

drop policy if exists notes_ouvrier_select  on public.notes_ouvriers;
drop policy if exists notes_ouvrier_insert  on public.notes_ouvriers;
drop policy if exists notes_ouvrier_update  on public.notes_ouvriers;
drop policy if exists notes_ouvrier_delete  on public.notes_ouvriers;
drop policy if exists notes_bureau_select   on public.notes_ouvriers;
drop policy if exists notes_bureau_update   on public.notes_ouvriers;

create policy notes_ouvrier_select on public.notes_ouvriers for select to authenticated
  using ((select public.est_ouvrier()) and (
    auteur_uid = (select auth.uid()) or memo_chantier or public.note_partagee_avec_moi(partage_ouvriers)));
create policy notes_ouvrier_insert on public.notes_ouvriers for insert to authenticated
  with check ((select public.est_ouvrier()) and auteur_uid = (select auth.uid()));
create policy notes_ouvrier_update on public.notes_ouvriers for update to authenticated
  using ((select public.est_ouvrier()) and auteur_uid = (select auth.uid()))
  with check ((select public.est_ouvrier()) and auteur_uid = (select auth.uid()));
create policy notes_ouvrier_delete on public.notes_ouvriers for delete to authenticated
  using ((select public.est_ouvrier()) and auteur_uid = (select auth.uid()));
-- Bureau : « not est_ouvrier() » vaut NULL (donc refus) pour un compte sans
-- fiche active — voir sql/202609_helpers_role_faille_profil_absent.sql.
create policy notes_bureau_select on public.notes_ouvriers for select to authenticated
  using ((select not public.est_ouvrier()) and (partage_bureau or memo_chantier));
create policy notes_bureau_update on public.notes_ouvriers for update to authenticated
  using ((select not public.est_ouvrier()) and (partage_bureau or memo_chantier))
  with check ((select not public.est_ouvrier()) and (partage_bureau or memo_chantier));

-- Réponses et lectures : visibles si la note l'est (la RLS de notes_ouvriers
-- s'applique dans la sous-requête, pour l'appelant).
drop policy if exists notes_reponses_select on public.notes_ouvriers_reponses;
drop policy if exists notes_reponses_insert on public.notes_ouvriers_reponses;
drop policy if exists notes_reponses_delete on public.notes_ouvriers_reponses;
create policy notes_reponses_select on public.notes_ouvriers_reponses for select to authenticated
  using (exists (select 1 from public.notes_ouvriers n where n.id = note_id));
create policy notes_reponses_insert on public.notes_ouvriers_reponses for insert to authenticated
  with check (auteur_uid = (select auth.uid()) and exists (select 1 from public.notes_ouvriers n where n.id = note_id));
create policy notes_reponses_delete on public.notes_ouvriers_reponses for delete to authenticated
  using (auteur_uid = (select auth.uid()));

drop policy if exists notes_lectures_miennes on public.notes_ouvriers_lectures;
create policy notes_lectures_miennes on public.notes_ouvriers_lectures for all to authenticated
  using (lecteur_uid = (select auth.uid()))
  with check (lecteur_uid = (select auth.uid()) and exists (select 1 from public.notes_ouvriers n where n.id = note_id));

-- ── 5. Garde : auteur, partage, suivi bureau ────────────────────────────────
create or replace function public.notes_textes_checklist(p jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(e -> 'texte'), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) e;
$$;
revoke all on function public.notes_textes_checklist(jsonb) from public, anon;

create or replace function public.notes_ouvriers_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_ouvrier boolean := public.est_ouvrier();
  v_moi     text := public.mon_prenom_planning();
  v_visible_avant boolean;
begin
  -- Mise à jour faite par le trigger des réponses (activité) : laissée passer.
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  -- service_role (hors application) : aucune contrainte métier.
  if v_uid is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if v_ouvrier is not true then
      raise exception 'Seul un ouvrier crée une note.' using errcode = '42501';
    end if;
    new.auteur := coalesce(nullif(btrim(v_moi), ''), 'Ouvrier');
    new.auteur_uid := v_uid;
    new.created_at := now();
  else
    if v_ouvrier is true then
      -- L'auteur ne réécrit ni son identité ni le suivi du bureau.
      new.auteur := old.auteur;
      new.auteur_uid := old.auteur_uid;
      new.created_at := old.created_at;
      new.statut_bureau := old.statut_bureau;
      new.statut_par := old.statut_par;
      new.statut_le := old.statut_le;
    else
      -- Bureau : seul le suivi change.
      if (new.auteur, new.auteur_uid, new.type, new.titre, new.contenu, new.checklist, new.photos,
          new.chantier_id, new.memo_chantier, new.partage_bureau, new.partage_ouvriers, new.created_at)
         is distinct from
         (old.auteur, old.auteur_uid, old.type, old.titre, old.contenu, old.checklist, old.photos,
          old.chantier_id, old.memo_chantier, old.partage_bureau, old.partage_ouvriers, old.created_at) then
        raise exception 'Le bureau ne peut modifier que le suivi d''une note.' using errcode = '42501';
      end if;
      if new.statut_bureau is distinct from old.statut_bureau then
        new.statut_par := coalesce(
          (select nullif(btrim(u.nom), '') from public.utilisateurs u where u.email = auth.email() limit 1),
          auth.email());
        new.statut_le := now();
      else
        new.statut_par := old.statut_par;
        new.statut_le := old.statut_le;
      end if;
      new.updated_at := old.updated_at;
      new.derniere_activite := old.derniere_activite;
      new.derniere_activite_par := old.derniere_activite_par;
      return new;
    end if;
  end if;

  -- Ouvrier (création ou modification de sa note).
  new.titre := btrim(coalesce(new.titre, ''));
  new.contenu := coalesce(new.contenu, '');
  -- Partage : prénoms dédoublonnés (normalisés), jamais soi-même.
  new.partage_ouvriers := coalesce((
    select array_agg(p order by p)
    from (
      select distinct on (public.norm_prenom(x)) btrim(x) as p
      from unnest(coalesce(new.partage_ouvriers, '{}')) x
      where public.norm_prenom(x) <> ''
        and public.norm_prenom(x) <> public.norm_prenom(coalesce(v_moi, ''))
      order by public.norm_prenom(x), btrim(x)
    ) s
  ), '{}');
  new.updated_at := now();
  new.derniere_activite := now();
  new.derniere_activite_par := v_uid;

  -- Suivi bureau : « nouveau » dès que la note devient visible du bureau, ou
  -- que son contenu change alors qu'elle l'est déjà (une note traitée puis
  -- modifiée revient en tête). Cocher une case de la liste ne compte pas :
  -- seuls les textes des éléments sont comparés. Plus visible du bureau →
  -- plus de suivi.
  if new.partage_bureau or new.memo_chantier then
    v_visible_avant := tg_op = 'UPDATE' and (old.partage_bureau or old.memo_chantier);
    if not v_visible_avant
       or (new.type, new.titre, new.contenu, public.notes_textes_checklist(new.checklist), new.photos, new.chantier_id)
          is distinct from
          (old.type, old.titre, old.contenu, public.notes_textes_checklist(old.checklist), old.photos, old.chantier_id) then
      new.statut_bureau := 'nouveau';
      new.statut_par := null;
      new.statut_le := null;
    end if;
  else
    new.statut_bureau := null;
    new.statut_par := null;
    new.statut_le := null;
  end if;
  return new;
end;
$$;
revoke all on function public.notes_ouvriers_garde() from public, anon, authenticated;
drop trigger if exists notes_ouvriers_garde on public.notes_ouvriers;
create trigger notes_ouvriers_garde before insert or update on public.notes_ouvriers
  for each row execute function public.notes_ouvriers_garde();

-- Réponse : auteur et côté imposés ; la note remonte (activité), et revient
-- « nouveau » pour le bureau quand c'est un ouvrier qui répond.
create or replace function public.notes_ouvriers_reponse_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ouvrier boolean := public.est_ouvrier();
begin
  if auth.uid() is not null then
    new.auteur_uid := auth.uid();
    new.cote := case when v_ouvrier is true then 'ouvrier' else 'bureau' end;
    new.auteur := case when v_ouvrier is true
      then coalesce(nullif(btrim(public.mon_prenom_planning()), ''), 'Ouvrier')
      else coalesce((select nullif(btrim(u.nom), '') from public.utilisateurs u where u.email = auth.email() limit 1),
                    auth.email(), 'Bureau')
    end;
  end if;
  new.contenu := btrim(new.contenu);
  new.created_at := now();
  return new;
end;
$$;
revoke all on function public.notes_ouvriers_reponse_garde() from public, anon, authenticated;
drop trigger if exists notes_ouvriers_reponse_garde on public.notes_ouvriers_reponses;
create trigger notes_ouvriers_reponse_garde before insert on public.notes_ouvriers_reponses
  for each row execute function public.notes_ouvriers_reponse_garde();

create or replace function public.notes_ouvriers_reponse_activite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notes_ouvriers n
     set derniere_activite = new.created_at,
         derniere_activite_par = new.auteur_uid,
         statut_bureau = case
           when new.cote = 'ouvrier' and (n.partage_bureau or n.memo_chantier) then 'nouveau'
           else n.statut_bureau end
   where n.id = new.note_id;
  return null;
end;
$$;
revoke all on function public.notes_ouvriers_reponse_activite() from public, anon, authenticated;
drop trigger if exists notes_ouvriers_reponse_activite on public.notes_ouvriers_reponses;
create trigger notes_ouvriers_reponse_activite after insert on public.notes_ouvriers_reponses
  for each row execute function public.notes_ouvriers_reponse_activite();

-- ── 6. Destinataires possibles : prénoms des comptes ouvriers actifs ────────
-- Les ouvriers ne lisent pas utilisateurs : cette RPC ne renvoie QUE des
-- prénoms de planning (aucune adresse, aucun rôle), sans l'appelant.
create or replace function public.notes_destinataires()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select u.prenom_planning
  from public.utilisateurs u
  where public.est_collaborateur_actif()
    and u.role = 'ouvrier' and u.actif is true
    and nullif(btrim(u.prenom_planning), '') is not null
    and u.email is distinct from auth.email()
  order by 1;
$$;
revoke all on function public.notes_destinataires() from public, anon;
grant execute on function public.notes_destinataires() to authenticated;

-- ── 7. Photos : bucket privé ────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notes-ouvriers', 'notes-ouvriers', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists notes_ouvriers_photos_insert on storage.objects;
drop policy if exists notes_ouvriers_photos_select on storage.objects;
drop policy if exists notes_ouvriers_photos_delete on storage.objects;
create policy notes_ouvriers_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'notes-ouvriers'
    and (select public.est_collaborateur_actif()) and (select public.est_ouvrier())
    and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy notes_ouvriers_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'notes-ouvriers'
    and (select public.est_collaborateur_actif())
    and ((storage.foldername(name))[1] = (select auth.uid())::text
         or exists (select 1 from public.notes_ouvriers n where n.photos ? name)));
create policy notes_ouvriers_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'notes-ouvriers'
    and (select public.est_collaborateur_actif())
    and (storage.foldername(name))[1] = (select auth.uid())::text);
