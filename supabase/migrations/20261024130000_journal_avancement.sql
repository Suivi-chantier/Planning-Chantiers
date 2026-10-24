-- ============================================================================
-- Refonte du Bilan semaine — étape 1C : journal d'avancement daté.
--
-- PROBLÈME
--   L'avancement validé est écrit dans le phasage SANS date : seuls les relevés
--   du vendredi le photographient. Un compte rendu du mardi validé le jeudi
--   produit donc « jeudi », et la production d'une semaine se déduit des points
--   d'avancement du chantier entier (arrondis) × le vendu.
--
-- CHANGEMENT (additif)
--   1. Table avancement_journal : une ligne par changement d'avancement d'une
--      tâche — avant, après, DATE DE RÉALISATION, source, auteur, compte rendu.
--      Lecture : bureau (pas les ouvriers) ; AUCUNE écriture directe depuis
--      l'application : seules les fonctions ci-dessous écrivent.
--   2. UNE fonction d'enregistrement, avancement_journal_enregistrer(), qui
--      compare les tâches avant / après et écrit les lignes. Elle est appelée
--      par un déclencheur sur phasages (insertion et toute modification de
--      `ouvrages`) : AUCUN chemin d'écriture ne peut l'oublier. Les écrans
--      transmettent le contexte (source, date de réalisation, compte rendu)
--      aux deux fonctions d'enregistrement du phasage, qui le posent pour la
--      transaction (set_config local) ; sans contexte : source « phasage »,
--      date = dernier pointage de la tâche, sinon aujourd'hui (Paris).
--      Une erreur du journal n'empêche JAMAIS l'enregistrement du phasage :
--      elle est rattrapée par le contrôle nocturne.
--   3. conducteur_sauvegarder_phasage_v2 : paramètre optionnel p_journal ;
--      conducteur_sauvegarder_phasages_lot : clé optionnelle « journal » par
--      entrée. Corps inchangé par ailleurs (mêmes droits, même verrou).
--   4. avancement_journal_initialiser() : une ligne « initial » par tâche
--      existante (avancement actuel, avant inconnu). Lancée en fin de migration.
--   5. avancement_journal_reconcilier() : contrôle nocturne — compare l'état
--      actuel des tâches à la dernière valeur écrite au journal, écrit une
--      ligne « reconciliation » par écart et consigne le compteur dans
--      avancement_journal_controles (affiché dans Réglages). Compteur ≠ 0 =
--      un chemin d'écriture a échappé au journal.
--   6. avancement_journal_reconstitution_lignes() / _reconstituer(p_appliquer) :
--      reconstitution du passé depuis phasages_history et les pointages.
--      p_appliquer = false : SIMULATION, rien n'est écrit. N'est PAS lancée par
--      cette migration — à appliquer seulement après accord, au vu du résultat.
--
-- RETOUR ARRIÈRE : sql/202610_journal_avancement_rollback.sql (restaure les
-- deux fonctions d'enregistrement d'origine, retire déclencheur et tables).
-- Idempotente.
-- ============================================================================

-- ── 1. Tables ───────────────────────────────────────────────────────────────
create table if not exists public.avancement_journal (
  id               uuid primary key default gen_random_uuid(),
  chantier_id      text not null,
  phasage_id       uuid,
  ouvrage_id       text,
  tache_id         text not null,
  avancement_avant numeric,          -- null = inconnu (ligne initiale, début d'historique)
  avancement_apres numeric not null,
  date_realisation date not null,
  source           text not null
    check (source in ('validation_cr', 'phasage', 'correction', 'reconciliation', 'initial', 'reconstitution')),
  auteur           text,
  rapport_id       uuid,
  created_at       timestamptz not null default now()
);
create index if not exists avancement_journal_tache_idx
  on public.avancement_journal (chantier_id, tache_id, date_realisation, created_at);
create index if not exists avancement_journal_date_idx on public.avancement_journal (date_realisation);
create index if not exists avancement_journal_rapport_idx on public.avancement_journal (rapport_id) where rapport_id is not null;
comment on table public.avancement_journal is
  'Journal daté des changements d''avancement des tâches (étape 1C). État d''une tâche à la date D = valeur « après » de la ligne la plus récemment écrite parmi celles datées ≤ D (chantierFinance.etatTachesALaDate). Écrit uniquement par avancement_journal_enregistrer (déclencheur sur phasages) et les fonctions de contrôle.';

create table if not exists public.avancement_journal_controles (
  id          uuid primary key default gen_random_uuid(),
  execute_le  timestamptz not null default now(),
  nb_taches   int not null,
  nb_ecarts   int not null,
  ecarts      jsonb not null default '[]'::jsonb
);
comment on table public.avancement_journal_controles is
  'Résultat du contrôle nocturne du journal d''avancement : nb_ecarts ≠ 0 = un chemin d''écriture a échappé au journal.';

alter table public.avancement_journal enable row level security;
alter table public.avancement_journal_controles enable row level security;
-- Lecture seule pour l'application : le journal ne se réécrit pas à la main.
revoke all on public.avancement_journal, public.avancement_journal_controles from authenticated, anon;
grant select on public.avancement_journal, public.avancement_journal_controles to authenticated;
grant all on public.avancement_journal, public.avancement_journal_controles to service_role;

do $do$
declare t text;
begin
  foreach t in array array['avancement_journal', 'avancement_journal_controles'] loop
    execute format('drop policy if exists bureau_lecture on public.%I', t);
    execute format('create policy bureau_lecture on public.%I for select to authenticated using (not public.est_ouvrier())', t);
    execute format('drop policy if exists profero_collaborateurs_seulement on public.%I', t);
    execute format(
      'create policy profero_collaborateurs_seulement on public.%I as restrictive for all to authenticated '
      'using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()))', t);
  end loop;
end $do$;

-- ── 2. Outils ───────────────────────────────────────────────────────────────
-- Avancement d'une tâche (jsonb) : nombre borné 0-100 ; vide ou illisible → 0.
create or replace function public._avancement_valeur(t jsonb)
returns numeric language plpgsql immutable as $$
declare v numeric;
begin
  begin
    v := nullif(btrim(replace(coalesce(t->>'avancement', ''), ',', '.')), '')::numeric;
  exception when others then v := null;
  end;
  return greatest(0, least(100, coalesce(v, 0)));
end $$;

create or replace function public._date_sure(s text)
returns date language plpgsql immutable as $$
begin
  if s is null or s !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  return left(s, 10)::date;
exception when others then return null;
end $$;

create or replace function public._uuid_sur(s text)
returns uuid language plpgsql immutable as $$
begin
  return nullif(btrim(coalesce(s, '')), '')::uuid;
exception when others then return null;
end $$;

-- ── 3. LA fonction d'enregistrement ─────────────────────────────────────────
-- Compare les tâches (ouvrages[].taches[]) avant / après et écrit une ligne
-- par tâche dont l'avancement a changé. Une tâche nouvelle part de 0.
-- Contexte (jsonb, tout est optionnel) :
--   source     : validation_cr | phasage | correction (défaut : phasage)
--   date       : date de réalisation de toutes les lignes (ex. date du rapport)
--   dates      : { tache_id: "AAAA-MM-JJ" } — prioritaire sur `date`
--   auteur     : défaut = adresse du compte connecté
--   rapport_id : compte rendu à l'origine du changement
-- Date par défaut : dernier pointage de la tâche (≤ aujourd'hui), sinon
-- aujourd'hui (heure de Paris). Rend le nombre de lignes écrites.
create or replace function public.avancement_journal_enregistrer(
  p_phasage_id uuid, p_chantier_id text, p_avant jsonb, p_apres jsonb, p_contexte jsonb default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source     text := coalesce(nullif(p_contexte->>'source', ''), 'phasage');
  v_auteur     text := coalesce(nullif(p_contexte->>'auteur', ''), auth.email());
  v_rapport    uuid := public._uuid_sur(p_contexte->>'rapport_id');
  v_date       date := public._date_sure(p_contexte->>'date');
  v_aujourdhui date := (now() at time zone 'Europe/Paris')::date;
  n int;
begin
  if p_chantier_id is null then return 0; end if;
  if v_source not in ('validation_cr', 'phasage', 'correction') then v_source := 'phasage'; end if;

  insert into public.avancement_journal
    (chantier_id, phasage_id, ouvrage_id, tache_id, avancement_avant, avancement_apres,
     date_realisation, source, auteur, rapport_id)
  select p_chantier_id, p_phasage_id, d.ouvrage_id, d.tache_id, d.avant, d.apres,
    coalesce(
      public._date_sure(p_contexte->'dates'->>d.tache_id),
      v_date,
      (select max(pt.date) from public.pointages pt
        where pt.chantier_id = p_chantier_id and pt.tache_id::text = d.tache_id and pt.date <= v_aujourdhui),
      v_aujourdhui),
    v_source, v_auteur, v_rapport
  from (
    select ap.ouvrage_id, ap.tache_id, coalesce(av.av, 0) as avant, ap.av as apres
    from (
      select distinct on (t->>'id') o->>'id' as ouvrage_id, t->>'id' as tache_id, public._avancement_valeur(t) as av
      from jsonb_array_elements(case when jsonb_typeof(p_apres) = 'array' then p_apres else '[]'::jsonb end) o,
           jsonb_array_elements(case when jsonb_typeof(o->'taches') = 'array' then o->'taches' else '[]'::jsonb end) t
      where nullif(t->>'id', '') is not null
    ) ap
    left join (
      select t->>'id' as tache_id, max(public._avancement_valeur(t)) as av
      from jsonb_array_elements(case when jsonb_typeof(p_avant) = 'array' then p_avant else '[]'::jsonb end) o,
           jsonb_array_elements(case when jsonb_typeof(o->'taches') = 'array' then o->'taches' else '[]'::jsonb end) t
      where nullif(t->>'id', '') is not null
      group by t->>'id'
    ) av on av.tache_id = ap.tache_id
    where coalesce(av.av, 0) <> ap.av
  ) d;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.avancement_journal_enregistrer(uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;

-- Déclencheur : toute écriture de `ouvrages` passe par la fonction ci-dessus.
-- Le contexte vient de la transaction (posé par les fonctions d'enregistrement).
create or replace function public.trg_avancement_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_ctx jsonb;
begin
  begin
    v_ctx := nullif(current_setting('profero.journal_avancement', true), '')::jsonb;
  exception when others then v_ctx := null;
  end;
  begin
    perform public.avancement_journal_enregistrer(
      new.id, new.chantier_id,
      case when tg_op = 'UPDATE' then old.ouvrages else '[]'::jsonb end,
      new.ouvrages, v_ctx);
  exception when others then
    -- Jamais d'échec du phasage à cause du journal : le contrôle nocturne
    -- rattrapera l'écart (et le comptera).
    raise warning 'journal d''avancement non écrit (phasage %) : %', new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_avancement_journal on public.phasages;
create trigger trg_avancement_journal
  after insert or update of ouvrages on public.phasages
  for each row execute function public.trg_avancement_journal();

-- ── 4. Fonctions d'enregistrement du phasage : contexte du journal ─────────
-- Corps identique à la version en production (relu le 24/10/2026), plus le
-- contexte posé pour la transaction avant l'écriture.
drop function if exists public.conducteur_sauvegarder_phasage_v2(uuid, bigint, jsonb, jsonb);
create or replace function public.conducteur_sauvegarder_phasage_v2(
  p_phasage_id uuid, p_revision_attendue bigint, p_ouvrages jsonb default null::jsonb,
  p_plan_travaux jsonb default null::jsonb, p_journal jsonb default null::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role     text;
  v_actif    boolean;
  v_revision bigint;
begin
  if auth.uid() is null or auth.email() is null then return null; end if;
  select u.role, u.actif into v_role, v_actif
  from public.utilisateurs u where u.email = auth.email() limit 1;
  if v_role is null or v_actif is distinct from true then return null; end if;
  if v_role = 'ouvrier' then return null; end if;

  if p_phasage_id is null or p_revision_attendue is null then
    return jsonb_build_object('ok', false, 'code', 'parametres_invalides');
  end if;
  if p_ouvrages is null and p_plan_travaux is null then
    return jsonb_build_object('ok', false, 'code', 'rien_a_ecrire');
  end if;

  select p.revision into v_revision
  from public.phasages p where p.id = p_phasage_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'phasage_introuvable');
  end if;

  if v_revision is distinct from p_revision_attendue then
    return jsonb_build_object('ok', false, 'code', 'conflit', 'revision', v_revision);
  end if;

  -- Contexte du journal d'avancement, pour CETTE transaction seulement.
  perform set_config('profero.journal_avancement', coalesce(p_journal::text, ''), true);

  update public.phasages
  set ouvrages     = coalesce(p_ouvrages, ouvrages),
      plan_travaux = coalesce(p_plan_travaux, plan_travaux),
      updated_at   = now()
  where id = p_phasage_id;

  perform set_config('profero.journal_avancement', '', true);

  select p.revision into v_revision from public.phasages p where p.id = p_phasage_id;
  return jsonb_build_object('ok', true, 'code', 'enregistre', 'revision', v_revision);
end;
$function$;
revoke all on function public.conducteur_sauvegarder_phasage_v2(uuid, bigint, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.conducteur_sauvegarder_phasage_v2(uuid, bigint, jsonb, jsonb, jsonb) to authenticated;

create or replace function public.conducteur_sauvegarder_phasages_lot(p_lot jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role     text;
  v_actif    boolean;
  e          jsonb;
  v_id       uuid;
  v_attendue bigint;
  v_actuelle bigint;
  v_conflits jsonb := '[]'::jsonb;
  v_revisions jsonb := '{}'::jsonb;
  v_n        int := 0;
begin
  if auth.uid() is null or auth.email() is null then return null; end if;
  select u.role, u.actif into v_role, v_actif
  from public.utilisateurs u where u.email = auth.email() limit 1;
  if v_role is null or v_actif is distinct from true then return null; end if;
  if v_role = 'ouvrier' then return null; end if;

  if p_lot is null or jsonb_typeof(p_lot) <> 'array' or jsonb_array_length(p_lot) = 0 then
    return jsonb_build_object('ok', false, 'code', 'lot_invalide');
  end if;
  if jsonb_array_length(p_lot) > 100 then
    return jsonb_build_object('ok', false, 'code', 'lot_trop_grand');
  end if;

  for e in select value from jsonb_array_elements(p_lot) loop
    begin
      v_id := (e->>'phasage_id')::uuid;
      v_attendue := (e->>'revision_attendue')::bigint;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'lot_invalide');
    end;
    if v_id is null or v_attendue is null then
      return jsonb_build_object('ok', false, 'code', 'lot_invalide');
    end if;
    if (e->'ouvrages') is null and (e->'plan_travaux') is null then
      return jsonb_build_object('ok', false, 'code', 'rien_a_ecrire');
    end if;

    select p.revision into v_actuelle
    from public.phasages p where p.id = v_id
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'phasage_introuvable',
        'conflits', jsonb_build_array(v_id));
    end if;
    if v_actuelle is distinct from v_attendue then
      v_conflits := v_conflits || to_jsonb(v_id);
    end if;
  end loop;

  if jsonb_array_length(v_conflits) > 0 then
    return jsonb_build_object('ok', false, 'code', 'conflit', 'conflits', v_conflits);
  end if;

  for e in select value from jsonb_array_elements(p_lot) loop
    v_id := (e->>'phasage_id')::uuid;
    -- Contexte du journal propre à cette entrée (optionnel).
    perform set_config('profero.journal_avancement', coalesce((e->'journal')::text, ''), true);
    update public.phasages
    set ouvrages     = coalesce(e->'ouvrages', ouvrages),
        plan_travaux = coalesce(e->'plan_travaux', plan_travaux),
        updated_at   = now()
    where id = v_id;
    select p.revision into v_actuelle from public.phasages p where p.id = v_id;
    v_revisions := jsonb_set(v_revisions, array[v_id::text], to_jsonb(v_actuelle));
    v_n := v_n + 1;
  end loop;
  perform set_config('profero.journal_avancement', '', true);

  return jsonb_build_object('ok', true, 'code', 'enregistre',
    'phasages', v_n, 'revisions', v_revisions);
end;
$function$;

-- ── 5. Initialisation ───────────────────────────────────────────────────────
-- Une ligne « initial » par tâche qui n'a encore aucune ligne : avancement
-- actuel, avant inconnu, datée du jour (Paris). Rejouable sans doublon.
create or replace function public.avancement_journal_initialiser()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  insert into public.avancement_journal
    (chantier_id, phasage_id, ouvrage_id, tache_id, avancement_avant, avancement_apres,
     date_realisation, source, auteur)
  select distinct on (p.chantier_id, t->>'id')
    p.chantier_id, p.id, o->>'id', t->>'id', null, public._avancement_valeur(t),
    (now() at time zone 'Europe/Paris')::date, 'initial', 'initialisation du journal'
  from public.phasages p,
       jsonb_array_elements(case when jsonb_typeof(p.ouvrages) = 'array' then p.ouvrages else '[]'::jsonb end) o,
       jsonb_array_elements(case when jsonb_typeof(o->'taches') = 'array' then o->'taches' else '[]'::jsonb end) t
  where p.chantier_id is not null and nullif(t->>'id', '') is not null
    and not exists (select 1 from public.avancement_journal j
                    where j.chantier_id = p.chantier_id and j.tache_id = t->>'id')
  order by p.chantier_id, t->>'id', p.updated_at desc;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.avancement_journal_initialiser() from public, anon, authenticated;

-- ── 6. Contrôle nocturne ────────────────────────────────────────────────────
-- Pour chaque tâche : valeur actuelle vs dernière valeur ÉCRITE au journal
-- (created_at le plus récent). Écart → ligne « reconciliation » datée du jour.
create or replace function public.avancement_journal_reconcilier()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ecarts jsonb;
  v_nb_taches int;
  v_nb int;
begin
  create temp table _actuel on commit drop as
  select distinct on (p.chantier_id, t->>'id')
    p.chantier_id, p.id as phasage_id, o->>'id' as ouvrage_id, t->>'id' as tache_id,
    public._avancement_valeur(t) as av
  from public.phasages p,
       jsonb_array_elements(case when jsonb_typeof(p.ouvrages) = 'array' then p.ouvrages else '[]'::jsonb end) o,
       jsonb_array_elements(case when jsonb_typeof(o->'taches') = 'array' then o->'taches' else '[]'::jsonb end) t
  where p.chantier_id is not null and nullif(t->>'id', '') is not null
  order by p.chantier_id, t->>'id', p.updated_at desc;

  create temp table _ecarts on commit drop as
  select a.*, j.avancement_apres as journal
  from _actuel a
  left join lateral (
    select j.avancement_apres from public.avancement_journal j
    where j.chantier_id = a.chantier_id and j.tache_id = a.tache_id
    order by j.created_at desc limit 1
  ) j on true
  -- Sans ligne : seul un avancement non nul est un écart (une tâche créée à 0 %
  -- n'a rien à journaliser).
  where (j.avancement_apres is null and a.av <> 0) or (j.avancement_apres is not null and j.avancement_apres <> a.av);

  select count(*) into v_nb_taches from _actuel;
  select count(*) into v_nb from _ecarts;

  insert into public.avancement_journal
    (chantier_id, phasage_id, ouvrage_id, tache_id, avancement_avant, avancement_apres,
     date_realisation, source, auteur)
  select chantier_id, phasage_id, ouvrage_id, tache_id, journal, av,
    (now() at time zone 'Europe/Paris')::date, 'reconciliation', 'contrôle nocturne'
  from _ecarts;

  select coalesce(jsonb_agg(jsonb_build_object('chantier_id', chantier_id, 'tache_id', tache_id,
           'journal', journal, 'actuel', av)), '[]'::jsonb)
    into v_ecarts from (select * from _ecarts limit 200) x;

  insert into public.avancement_journal_controles (nb_taches, nb_ecarts, ecarts)
  values (v_nb_taches, v_nb, v_ecarts);

  return jsonb_build_object('ok', true, 'nb_taches', v_nb_taches, 'nb_ecarts', v_nb);
end $$;
revoke all on function public.avancement_journal_reconcilier() from public, anon, authenticated;
grant execute on function public.avancement_journal_reconcilier() to service_role;

-- ── 7. Reconstitution du passé (SIMULATION par défaut) ──────────────────────
-- Source : phasages_history (une ligne = l'état AVANT une écriture ; son
-- prev_updated_at = l'instant où cet état avait été écrit) + l'état courant.
-- Pour chaque tâche, chaque changement de valeur entre deux états successifs
-- devient une ligne « reconstitution » :
--   date de réalisation = dernier pointage de la tâche ≤ jour de l'écriture
--   (heure de Paris), sinon le jour de l'écriture ;
--   created_at = l'instant de l'écriture (l'ordre d'écriture reste vrai) ;
--   première apparition (TOUJOURS une ligne, même à 0 : c'est le point de
--   départ connu de la tâche) : depuis 0 si le phasage était déjà suivi avant,
--   sinon avant inconnu (null) — on ne sait pas ce qui précède l'historique.
-- Seules les écritures ANTÉRIEURES au début du journal sont reconstituées.
--
-- <reconstitution-lignes>
create or replace function public.avancement_journal_reconstitution_lignes(p_jusqua timestamptz)
returns table (chantier_id text, phasage_id uuid, ouvrage_id text, tache_id text,
               avancement_avant numeric, avancement_apres numeric,
               date_realisation date, ecrit_le timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with etats as (
    -- États successifs de chaque phasage, datés de leur écriture.
    select h.phasage_id, h.chantier_id, coalesce(h.prev_updated_at, h.saved_at) as ecrit_le, h.ouvrages
    from public.phasages_history h
    where h.chantier_id is not null and coalesce(h.prev_updated_at, h.saved_at) < p_jusqua
    union all
    select p.id, p.chantier_id, p.updated_at, p.ouvrages
    from public.phasages p
    where p.chantier_id is not null and p.updated_at < p_jusqua
  ),
  premiers as (
    select e.phasage_id, min(e.ecrit_le) as premier from etats e group by e.phasage_id
  ),
  taches as (
    select distinct on (e.phasage_id, e.ecrit_le, t->>'id')
      e.phasage_id, e.chantier_id, e.ecrit_le, o->>'id' as ouvrage_id, t->>'id' as tache_id,
      public._avancement_valeur(t) as av
    from etats e,
         jsonb_array_elements(case when jsonb_typeof(e.ouvrages) = 'array' then e.ouvrages else '[]'::jsonb end) o,
         jsonb_array_elements(case when jsonb_typeof(o->'taches') = 'array' then o->'taches' else '[]'::jsonb end) t
    where nullif(t->>'id', '') is not null
  ),
  suites as (
    select tk.*, pr.premier,
      lag(tk.av) over w as av_prec,
      row_number() over w as rang
    from taches tk join premiers pr on pr.phasage_id = tk.phasage_id
    window w as (partition by tk.phasage_id, tk.tache_id order by tk.ecrit_le)
  ),
  changements as (
    select s.chantier_id, s.phasage_id, s.ouvrage_id, s.tache_id,
      case when s.rang = 1 then (case when s.ecrit_le > s.premier then 0 else null end) else s.av_prec end as avant,
      s.av as apres, s.ecrit_le
    from suites s
    where s.rang = 1 or s.av <> s.av_prec
  )
  select c.chantier_id, c.phasage_id, c.ouvrage_id, c.tache_id, c.avant, c.apres,
    coalesce(
      (select max(pt.date) from public.pointages pt
        where pt.chantier_id = c.chantier_id and pt.tache_id::text = c.tache_id
          and pt.date <= (c.ecrit_le at time zone 'Europe/Paris')::date),
      (c.ecrit_le at time zone 'Europe/Paris')::date) as date_realisation,
    c.ecrit_le
  from changements c
$$;
-- </reconstitution-lignes>
revoke all on function public.avancement_journal_reconstitution_lignes(timestamptz) from public, anon, authenticated;

create or replace function public.avancement_journal_reconstituer(p_appliquer boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debut timestamptz;
  v_nb int;
  v_resume jsonb;
begin
  -- Début du journal : la première ligne « initial » (sinon maintenant).
  select coalesce(min(created_at), now()) into v_debut
  from public.avancement_journal where source = 'initial';
  if exists (select 1 from public.avancement_journal where source = 'reconstitution') then
    return jsonb_build_object('ok', false, 'code', 'deja_reconstitue');
  end if;

  create temp table _reco on commit drop as
  select * from public.avancement_journal_reconstitution_lignes(v_debut);

  select count(*) into v_nb from _reco;
  select jsonb_build_object(
    'ok', true, 'applique', p_appliquer, 'jusqua', v_debut, 'nb_lignes', v_nb,
    'nb_taches', (select count(distinct (chantier_id, tache_id)) from _reco),
    'nb_chantiers', (select count(distinct chantier_id) from _reco),
    'premiere_date', (select min(date_realisation) from _reco),
    'derniere_date', (select max(date_realisation) from _reco))
  into v_resume;

  if p_appliquer then
    insert into public.avancement_journal
      (chantier_id, phasage_id, ouvrage_id, tache_id, avancement_avant, avancement_apres,
       date_realisation, source, auteur, created_at)
    select chantier_id, phasage_id, ouvrage_id, tache_id, avancement_avant, avancement_apres,
      date_realisation, 'reconstitution', 'reconstitution (phasages_history)', ecrit_le
    from _reco;
  end if;
  return v_resume;
end $$;
revoke all on function public.avancement_journal_reconstituer(boolean) from public, anon, authenticated;
grant execute on function public.avancement_journal_reconstituer(boolean) to service_role;

-- ── 8. Lancement de l'initialisation ────────────────────────────────────────
select public.avancement_journal_initialiser();

-- ── Contrôle ────────────────────────────────────────────────────────────────
--   select source, count(*) from public.avancement_journal group by 1;   -- « initial » = nombre de tâches
--   select public.avancement_journal_reconstituer(false);                -- simulation
