-- ============================================================================
-- Refonte Opérations, lot 1 (06/11/2026) — opérations et chantiers en tables.
-- Fichier projet : docs/projets/refonte-operations.md.
-- Compte rendu   : docs/project/REFONTE-OPERATIONS-COMPTE-RENDU.md.
--
-- AVANT : opérations et chantiers vivent dans planning_config, deux blocs JSON
--   - clé "operations" : { items: [{ id, nom, adresse, couleur }] }
--   - clé "chantiers"  : [{ id, nom, couleur, statut?, operation_id? }]
-- réécrits EN ENTIER à chaque modification : deux personnes qui modifient deux
-- chantiers différents s'écrasent l'une l'autre.
--
-- APRÈS : deux vraies tables, une ligne par opération / par chantier.
--   - public.operations
--   - public.chantiers, operation_id NOT NULL + clé étrangère vers operations.
-- Les identifiants sont REPRIS À L'IDENTIQUE (texte) : les ~40 tables qui
-- portent un chantier_id continuent de pointer vers le même chantier.
--
-- Aucune suppression :
--   - les clés planning_config "chantiers" et "operations" restent en place et
--     sont tenues à jour automatiquement (MIROIR, voir plus bas) : tout ce qui
--     les lit encore (3 fonctions SQL de l'espace ouvrier, formulaire de
--     rapport public, tâches serveur à clé anonyme) voit la même chose qu'avant ;
--   - les tables n'acceptent pas la suppression (aucun droit DELETE) : un
--     chantier « supprimé » depuis l'Administration est ARCHIVÉ (archive_le),
--     donc récupérable ;
--   - sauvegarde datée des trois clés touchées dans
--     public.planning_config_sauvegarde_refonte avant toute reprise.
--
-- Synchronisation dans les deux sens, pour que l'ordre de déploiement ne
-- fasse rien perdre :
--   1. tables → planning_config (MIROIR) : après chaque écriture dans une
--      table, le bloc JSON correspondant est régénéré depuis la table (verrou
--      sur la ligne planning_config pour que deux écritures simultanées ne se
--      croisent pas).
--   2. planning_config → tables (ANCIENNE APPLICATION) : une écriture directe
--      du bloc JSON (ancienne version de l'application encore ouverte dans un
--      onglet, avant ou après la mise en ligne) est reportée dans les tables,
--      UNIQUEMENT pour les éléments qui ont changé entre l'ancien et le
--      nouveau bloc. Jamais de suppression : un chantier absent du nouveau
--      bloc reste dans la table.
--   Garde anti-boucle : pg_trigger_depth().
--
-- Règle « un chantier a toujours une opération » : un chantier créé sans
-- opération (reprise, ancienne application, Administration) reçoit une
-- opération créée automatiquement, à son nom, avec un seul logement
-- (operations.creee_automatiquement = true).
--
-- Re-synchronisation manuelle, idempotente (à lancer juste avant la fusion) :
--   select public.refonte_resynchroniser_depuis_config();
--
-- Retour arrière : sql/202611_refonte_operations_lot1_rollback.sql.
--
-- APPLIQUÉE le 06/11/2026 (version 20261106045027, apply_migration), après un
-- essai complet dans une transaction annulée. Corps appliqué = ce fichier, aux
-- commentaires près.
-- Accès : identiques à planning_config (bureau = lecture/écriture, ouvrier =
-- lecture, anonyme = rien de nouveau) + policy RESTRICTIVE
-- profero_collaborateurs_seulement sur les trois nouvelles tables.
-- Aucune fonction SECURITY DEFINER.
-- ============================================================================

-- ─── 0. Sauvegarde datée ────────────────────────────────────────────────────
create table public.planning_config_sauvegarde_refonte (
  id            bigint generated always as identity primary key,
  key           text        not null,
  value         jsonb,
  updated_at    timestamptz,
  sauvegarde_le timestamptz not null default now(),
  motif         text        not null
);
alter table public.planning_config_sauvegarde_refonte enable row level security;
revoke all on public.planning_config_sauvegarde_refonte from anon, authenticated;
create policy profero_collaborateurs_seulement on public.planning_config_sauvegarde_refonte
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif()))
  with check ((select public.est_collaborateur_actif()));

insert into public.planning_config_sauvegarde_refonte (key, value, updated_at, motif)
select key, value, updated_at, 'lot1 : avant reprise en tables (06/11/2026)'
from public.planning_config
where key in ('chantiers', 'operations', 'chantier_adresses');

-- ─── 1. Tables ──────────────────────────────────────────────────────────────
create table public.operations (
  id                     text        primary key,
  nom                    text        not null default '',
  adresse                text        not null default '',
  couleur                text        not null default '#888888',
  ordre                  integer     not null default 0,
  -- Champs de l'ancien bloc JSON que la table ne connaît pas encore : gardés
  -- tels quels et restitués dans le miroir. Rien ne se perd.
  donnees                jsonb       not null default '{}'::jsonb,
  creee_automatiquement  boolean     not null default false,
  archive_le             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint operations_id_non_vide check (btrim(id) <> ''),
  constraint operations_donnees_objet check (jsonb_typeof(donnees) = 'object')
);

create table public.chantiers (
  id            text        primary key,
  operation_id  text        not null references public.operations(id) on update cascade on delete restrict,
  nom           text        not null default '',
  couleur       text        not null default '#888888',
  -- null = aucun statut saisi (l'écran affiche alors « Planifié »).
  -- Valeurs actuelles : planifie, en_cours, en_pause, termine. Le lot 2
  -- ajoutera a_l_etude et perdu (règle unique : src/Renovation/chantierActif.mjs).
  statut        text,
  ordre         integer     not null default 0,
  donnees       jsonb       not null default '{}'::jsonb,
  archive_le    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint chantiers_id_non_vide check (btrim(id) <> ''),
  constraint chantiers_operation_non_vide check (btrim(operation_id) <> ''),
  constraint chantiers_donnees_objet check (jsonb_typeof(donnees) = 'object')
);
create index chantiers_operation_id_idx on public.chantiers (operation_id);

-- ─── 2. Droits (équivalents à planning_config) ──────────────────────────────
alter table public.operations enable row level security;
alter table public.chantiers  enable row level security;
revoke all on public.operations, public.chantiers from anon, authenticated;
-- Pas de DELETE : un chantier ou une opération s'archive, ne se supprime pas.
grant select, insert, update on public.operations, public.chantiers to authenticated;

create policy profero_collaborateurs_seulement on public.operations
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif()))
  with check ((select public.est_collaborateur_actif()));
create policy profero_collaborateurs_seulement on public.chantiers
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif()))
  with check ((select public.est_collaborateur_actif()));

-- Bureau : comme config_bureau_all sur planning_config.
create policy "operations bureau lecture" on public.operations for select to authenticated
  using ((select not public.est_ouvrier()));
create policy "operations bureau creation" on public.operations for insert to authenticated
  with check ((select not public.est_ouvrier()));
create policy "operations bureau modification" on public.operations for update to authenticated
  using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));
create policy "chantiers bureau lecture" on public.chantiers for select to authenticated
  using ((select not public.est_ouvrier()));
create policy "chantiers bureau creation" on public.chantiers for insert to authenticated
  with check ((select not public.est_ouvrier()));
create policy "chantiers bureau modification" on public.chantiers for update to authenticated
  using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()));

-- Ouvrier : comme config_ouvrier_sel (clés "chantiers" et "operations"), qui
-- ne montrait que les éléments présents dans les blocs = non archivés.
create policy "operations ouvrier lecture" on public.operations for select to authenticated
  using ((select public.est_ouvrier()) and archive_le is null);
create policy "chantiers ouvrier lecture" on public.chantiers for select to authenticated
  using ((select public.est_ouvrier()) and archive_le is null);

-- Temps réel (l'application se met à jour quand un collègue modifie).
alter publication supabase_realtime add table public.operations, public.chantiers;

-- ─── 3. updated_at ──────────────────────────────────────────────────────────
create trigger operations_set_updated_at before update on public.operations
  for each row execute function public.set_updated_at();
create trigger chantiers_set_updated_at before update on public.chantiers
  for each row execute function public.set_updated_at();

-- ─── 4. Un chantier a toujours une opération ────────────────────────────────
create function public.refonte_chantier_operation_auto()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_op_id   text;
  v_adresse text;
begin
  if coalesce(btrim(new.operation_id), '') <> '' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    -- On ne détache jamais un chantier de son opération.
    new.operation_id := old.operation_id;
    return new;
  end if;
  -- Création sans opération : une opération à son nom, un seul logement.
  v_op_id := 'op_auto_' || new.id;
  select coalesce(pc.value -> new.id ->> 'adresse', '') into v_adresse
    from public.planning_config pc where pc.key = 'chantier_adresses';
  insert into public.operations (id, nom, adresse, couleur, ordre, creee_automatiquement)
  values (v_op_id, coalesce(nullif(btrim(new.nom), ''), new.id), coalesce(v_adresse, ''),
          coalesce(new.couleur, '#888888'),
          (select coalesce(max(o.ordre), -1) + 1 from public.operations o), true)
  on conflict (id) do nothing;
  new.operation_id := v_op_id;
  return new;
end;
$$;
create trigger chantiers_operation_auto before insert or update of operation_id on public.chantiers
  for each row execute function public.refonte_chantier_operation_auto();

-- ─── 5. Miroir tables → planning_config ─────────────────────────────────────
create function public.refonte_miroir_chantiers()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v jsonb;
begin
  -- Verrou : deux écritures simultanées régénèrent l'une après l'autre, la
  -- seconde voit la première (lecture fraîche après l'attente du verrou).
  perform 1 from public.planning_config where key = 'chantiers' for update;
  select coalesce(jsonb_agg(
           c.donnees || jsonb_strip_nulls(jsonb_build_object(
             'id', c.id, 'nom', c.nom, 'couleur', c.couleur,
             'statut', c.statut, 'operation_id', c.operation_id))
           order by c.ordre, c.created_at, c.id), '[]'::jsonb)
    into v
    from public.chantiers c
   where c.archive_le is null;
  insert into public.planning_config as pc (key, value, updated_at)
  values ('chantiers', v, now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at
   where pc.value is distinct from excluded.value;
  return null;
end;
$$;

create function public.refonte_miroir_operations()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v jsonb;
begin
  perform 1 from public.planning_config where key = 'operations' for update;
  select coalesce(jsonb_agg(
           o.donnees || jsonb_build_object(
             'id', o.id, 'nom', o.nom, 'adresse', o.adresse, 'couleur', o.couleur)
           order by o.ordre, o.created_at, o.id), '[]'::jsonb)
    into v
    from public.operations o
   where o.archive_le is null;
  insert into public.planning_config as pc (key, value, updated_at)
  values ('operations', jsonb_build_object('items', v), now())
  on conflict (key) do update
    set value = coalesce(pc.value, '{}'::jsonb) || jsonb_build_object('items', v),
        updated_at = excluded.updated_at
   where pc.value is distinct from (coalesce(pc.value, '{}'::jsonb) || jsonb_build_object('items', v));
  return null;
end;
$$;

-- ─── 6. Report planning_config → tables (ancienne application, reprise) ─────
-- p_avant null = reprise complète (chaque élément est comparé à la table) ;
-- sinon seuls les éléments qui diffèrent entre p_avant et p_items sont repris.
-- Jamais de suppression, jamais de désarchivage.
create function public.refonte_appliquer_operations(p_items jsonb, p_avant jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  r         record;
  n         integer := 0;
  v_id      text;
  v_avant   jsonb;
  v_ordre_change boolean := false;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return 0;
  end if;
  if p_avant is null or jsonb_typeof(p_avant) <> 'array' then
    v_ordre_change := true;
  else
    v_ordre_change := (select array_agg(e->>'id' order by o) from jsonb_array_elements(p_items) with ordinality t(e, o))
       is distinct from (select array_agg(e->>'id' order by o) from jsonb_array_elements(p_avant) with ordinality t(e, o));
  end if;

  for r in select e, (o - 1)::integer as pos from jsonb_array_elements(p_items) with ordinality t(e, o) loop
    continue when jsonb_typeof(r.e) <> 'object' or coalesce(btrim(r.e->>'id'), '') = '';
    v_id := r.e->>'id';
    if p_avant is not null and jsonb_typeof(p_avant) = 'array' then
      select e into v_avant from jsonb_array_elements(p_avant) e where e->>'id' = v_id limit 1;
      if v_avant is not null and v_avant = r.e then
        if v_ordre_change then
          update public.operations set ordre = r.pos where id = v_id and ordre is distinct from r.pos;
        end if;
        continue;
      end if;
    end if;
    insert into public.operations as op (id, nom, adresse, couleur, ordre, donnees)
    values (v_id, coalesce(r.e->>'nom', ''), coalesce(r.e->>'adresse', ''),
            coalesce(nullif(r.e->>'couleur', ''), '#888888'), r.pos,
            r.e - array['id', 'nom', 'adresse', 'couleur'])
    on conflict (id) do update
      set nom = excluded.nom, adresse = excluded.adresse, couleur = excluded.couleur,
          donnees = excluded.donnees,
          ordre = case when v_ordre_change then excluded.ordre else op.ordre end
    where (op.nom, op.adresse, op.couleur, op.donnees) is distinct from
          (excluded.nom, excluded.adresse, excluded.couleur, excluded.donnees)
       or (v_ordre_change and op.ordre is distinct from excluded.ordre);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create function public.refonte_appliquer_chantiers(p_items jsonb, p_avant jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  r         record;
  n         integer := 0;
  v_id      text;
  v_op      text;
  v_statut  text;
  v_avant   jsonb;
  v_donnees jsonb;
  v_ordre_change boolean := false;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return 0;
  end if;
  if p_avant is null or jsonb_typeof(p_avant) <> 'array' then
    v_ordre_change := true;
  else
    v_ordre_change := (select array_agg(e->>'id' order by o) from jsonb_array_elements(p_items) with ordinality t(e, o))
       is distinct from (select array_agg(e->>'id' order by o) from jsonb_array_elements(p_avant) with ordinality t(e, o));
  end if;

  for r in select e, (o - 1)::integer as pos from jsonb_array_elements(p_items) with ordinality t(e, o) loop
    continue when jsonb_typeof(r.e) <> 'object' or coalesce(btrim(r.e->>'id'), '') = '';
    v_id := r.e->>'id';
    if p_avant is not null and jsonb_typeof(p_avant) = 'array' then
      select e into v_avant from jsonb_array_elements(p_avant) e where e->>'id' = v_id limit 1;
      if v_avant is not null and v_avant = r.e then
        if v_ordre_change then
          update public.chantiers set ordre = r.pos where id = v_id and ordre is distinct from r.pos;
        end if;
        continue;
      end if;
    end if;
    v_op := nullif(btrim(coalesce(r.e->>'operation_id', '')), '');
    if v_op is not null and not exists (select 1 from public.operations where id = v_op) then
      v_op := null;   -- opération inconnue : on garde celle du chantier (ou auto)
    end if;
    v_statut  := nullif(btrim(coalesce(r.e->>'statut', '')), '');
    v_donnees := r.e - array['id', 'nom', 'couleur', 'statut', 'operation_id'];
    if exists (select 1 from public.chantiers where id = v_id) then
      update public.chantiers c
         set nom = coalesce(r.e->>'nom', ''),
             couleur = coalesce(nullif(r.e->>'couleur', ''), '#888888'),
             statut = v_statut,
             operation_id = coalesce(v_op, c.operation_id),
             donnees = v_donnees,
             ordre = case when v_ordre_change then r.pos else c.ordre end
       where c.id = v_id
         and ((c.nom, c.couleur, c.statut, c.operation_id, c.donnees) is distinct from
              (coalesce(r.e->>'nom', ''), coalesce(nullif(r.e->>'couleur', ''), '#888888'), v_statut,
               coalesce(v_op, c.operation_id), v_donnees)
              or (v_ordre_change and c.ordre is distinct from r.pos));
    else
      insert into public.chantiers (id, operation_id, nom, couleur, statut, ordre, donnees)
      values (v_id, v_op, coalesce(r.e->>'nom', ''), coalesce(nullif(r.e->>'couleur', ''), '#888888'),
              v_statut, r.pos, v_donnees);
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create function public.refonte_config_vers_tables()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Seulement une écriture DIRECTE du bloc (ancienne application). Les
  -- écritures du miroir (profondeur > 1) ne reviennent pas dans les tables.
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if new.key = 'operations' then
    perform public.refonte_appliquer_operations(new.value -> 'items',
      case when tg_op = 'UPDATE' then old.value -> 'items' end);
  elsif new.key = 'chantiers' then
    perform public.refonte_appliquer_chantiers(new.value,
      case when tg_op = 'UPDATE' then old.value end);
  end if;
  return null;
end;
$$;

-- ─── 7. Re-synchronisation manuelle (idempotente) ───────────────────────────
create function public.refonte_resynchroniser_depuis_config()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ops   integer;
  v_ch    integer;
begin
  v_ops := public.refonte_appliquer_operations(
    (select value -> 'items' from public.planning_config where key = 'operations'), null);
  v_ch := public.refonte_appliquer_chantiers(
    (select value from public.planning_config where key = 'chantiers'), null);
  return jsonb_build_object(
    'operations_lues_dans_config', v_ops,
    'chantiers_lus_dans_config',   v_ch,
    'operations_en_table',         (select count(*) from public.operations),
    'operations_auto',             (select count(*) from public.operations where creee_automatiquement),
    'chantiers_en_table',          (select count(*) from public.chantiers),
    'chantiers_archives',          (select count(*) from public.chantiers where archive_le is not null),
    'chantiers_absents_des_tables', (select count(*) from jsonb_array_elements(
        (select case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end
           from public.planning_config where key = 'chantiers')) e
        where not exists (select 1 from public.chantiers c where c.id = e->>'id')));
end;
$$;

revoke all on function public.refonte_resynchroniser_depuis_config() from public, anon, authenticated;
revoke all on function public.refonte_appliquer_operations(jsonb, jsonb) from public, anon;
revoke all on function public.refonte_appliquer_chantiers(jsonb, jsonb) from public, anon;
grant execute on function public.refonte_appliquer_operations(jsonb, jsonb) to authenticated;
grant execute on function public.refonte_appliquer_chantiers(jsonb, jsonb) to authenticated;
revoke all on function public.refonte_chantier_operation_auto() from public, anon, authenticated;
revoke all on function public.refonte_miroir_chantiers() from public, anon, authenticated;
revoke all on function public.refonte_miroir_operations() from public, anon, authenticated;
revoke all on function public.refonte_config_vers_tables() from public, anon, authenticated;

-- ─── 8. Reprise de l'existant ───────────────────────────────────────────────
select public.refonte_resynchroniser_depuis_config();

-- ─── 9. Branchement des synchronisations (après la reprise) ─────────────────
create trigger operations_miroir_config after insert or update on public.operations
  for each statement execute function public.refonte_miroir_operations();
create trigger chantiers_miroir_config after insert or update on public.chantiers
  for each statement execute function public.refonte_miroir_chantiers();
create trigger planning_config_vers_tables after insert or update on public.planning_config
  for each row when (new.key in ('chantiers', 'operations'))
  execute function public.refonte_config_vers_tables();

-- Premier miroir : ajoute aux blocs les opérations créées automatiquement et
-- l'operation_id des chantiers qui n'en avaient pas.
update public.operations set ordre = ordre where false;
update public.chantiers  set ordre = ordre where false;
