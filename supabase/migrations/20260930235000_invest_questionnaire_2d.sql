-- ============================================================================
-- Chantier 1.1 — Tranche 2d : questionnaire « Projet & situation » du dossier.
--
-- ADDITIVE. Le questionnaire porte le CONTEXTE, la SITUATION et les OBJECTIFS
-- du dossier (≠ faits durables du foyer, Tranche 2c ; ≠ Analyse ; ≠ Stratégie).
--   - invest_dossiers : + questionnaire_version, questionnaire_data (JSON par
--     réponse : valeur, source, saisie, modification, vérification),
--     questionnaire_statut (brouillon / soumis / a_verifier / valide) et dates ;
--   - catalogue et règles d'affichage : src/Invest/dossiers/questionnaireDossier.mjs
--     (versionné) ; la base ne connaît que le libellé des sections (journal) ;
--   - règles : dossier clos = lecture seule ; modifier une réponse vérifiée la
--     repasse non vérifiée ; vérification et validation par un collaborateur ;
--     correction après validation → « à vérifier » ; aucune réponse supprimée ;
--   - journal : questionnaire_modifie / questionnaire_soumis / questionnaire_valide.
-- Suites 2c : perte de vérification dite dans le résumé collecte_modification ;
-- désarchivage réservé à un collaborateur.
-- Aucune reprise ; invest_clients.strategie_data et invest_structuration_patrimoniale intacts.
--
-- RETOUR ARRIÈRE : sql/202609_invest_questionnaire_2d_rollback.sql
-- VÉRIFICATION  : node scripts/verif-invest-dossiers-t1.mjs
-- ============================================================================

alter table public.invest_dossier_evenements drop constraint if exists invest_dossier_evenements_type_check;
alter table public.invest_dossier_evenements add constraint invest_dossier_evenements_type_check
  check (type in ('dossier_cree','dossier_statut_change','dossier_modifie',
    'lettre_mission_change','conseiller_change','etape_statut_change','etape_balle_change',
    'etape_echeance_change','etape_prochaine_action_change','etape_bloquee','etape_debloquee',
    'reprise_importee','etape_reprise_confirmee',
    'collecte_ajout','collecte_modification','collecte_verification',
    'questionnaire_modifie','questionnaire_soumis','questionnaire_valide'));

alter table public.invest_dossiers
  add column if not exists questionnaire_version integer,
  add column if not exists questionnaire_data jsonb not null default '{}'::jsonb,
  add column if not exists questionnaire_statut text not null default 'brouillon',
  add column if not exists questionnaire_modifie_le timestamptz,
  add column if not exists questionnaire_soumis_le timestamptz,
  add column if not exists questionnaire_valide_le timestamptz,
  add column if not exists questionnaire_valide_par_id uuid references public.utilisateurs(id) on delete set null;
alter table public.invest_dossiers drop constraint if exists invest_dossiers_questionnaire_statut_check;
alter table public.invest_dossiers add constraint invest_dossiers_questionnaire_statut_check
  check (questionnaire_statut in ('brouillon','soumis','a_verifier','valide'));
alter table public.invest_dossiers drop constraint if exists invest_dossiers_questionnaire_data_check;
alter table public.invest_dossiers add constraint invest_dossiers_questionnaire_data_check
  check (jsonb_typeof(questionnaire_data) = 'object');

-- Libellé des sections (identique à SECTIONS_QUESTIONNAIRE, vérifié par les tests).
create or replace function public.invest_questionnaire_section(p text)
returns text language sql immutable set search_path = '' as $$
  select case p
    when 'foyer' then 'Foyer & situation familiale' when 'pro' then 'Situation professionnelle'
    when 'fiscalite' then 'Fiscalité' when 'international' then 'International'
    when 'objectifs' then 'Objectifs d''investissement' when 'banque' then 'Banque & financement déclaré'
    when 'detention' then 'Détention & structuration' else coalesce(p, '—') end;
$$;

-- ── Avant écriture (droits du propriétaire) : métadonnées de chaque réponse ─
-- Le navigateur n'envoie que valeur (+ source) ou un statut de vérification ;
-- dates, auteurs et vérificateur sont TOUJOURS posés ici.
create or replace function public.invest_questionnaire_avant_ecriture()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  a record;
  k text; o jsonb; n jsonb;
  res jsonb := '{}'::jsonb;
  maintenant text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  valeurs_changees boolean := false;
  statut_change boolean;
begin
  select * into a from public.invest_auteur_courant();
  if new.questionnaire_data is distinct from old.questionnaire_data then
    if jsonb_typeof(new.questionnaire_data) <> 'object' then
      raise exception 'Questionnaire invalide.' using errcode = '22023';
    end if;
    for k in select jsonb_object_keys(old.questionnaire_data) union select jsonb_object_keys(new.questionnaire_data) loop
      if k !~ '^[a-z]+__[a-z0-9_]+$' then
        raise exception 'Question inconnue : %.', k using errcode = '22023';
      end if;
      o := old.questionnaire_data -> k;
      n := new.questionnaire_data -> k;
      if n is null or jsonb_typeof(n) <> 'object' then
        res := res || jsonb_build_object(k, o);                       -- jamais supprimée
      elsif o is null then
        res := res || jsonb_build_object(k, jsonb_build_object('valeur', n -> 'valeur',
          'source', coalesce(nullif(n ->> 'source', ''), 'profero'),
          'saisi_le', maintenant, 'saisi_par_id', a.auteur_utilisateur_id,
          'modifie_le', maintenant, 'modifie_par_id', a.auteur_utilisateur_id,
          'verification', 'non_verifiee', 'verifie_par_id', null, 'verifie_le', null, 'verification_commentaire', null));
        valeurs_changees := true;
      elsif (n -> 'valeur') is distinct from (o -> 'valeur') then
        res := res || jsonb_build_object(k, o || jsonb_build_object('valeur', n -> 'valeur',
          'source', coalesce(nullif(n ->> 'source', ''), o ->> 'source', 'profero'),
          'modifie_le', maintenant, 'modifie_par_id', a.auteur_utilisateur_id,
          'verification', 'non_verifiee', 'verifie_par_id', null, 'verifie_le', null, 'verification_commentaire', null));
        valeurs_changees := true;
      elsif (n ->> 'verification') is distinct from (o ->> 'verification') then
        if coalesce(n ->> 'verification', '') not in ('non_verifiee','verifiee','a_corriger') then
          raise exception 'Statut de vérification inconnu : %.', n ->> 'verification' using errcode = '22023';
        end if;
        res := res || jsonb_build_object(k, o || jsonb_build_object('verification', n ->> 'verification',
          'verifie_par_id', case when n ->> 'verification' = 'non_verifiee' then null else a.auteur_utilisateur_id end,
          'verifie_le', case when n ->> 'verification' = 'non_verifiee' then null else maintenant end,
          'verification_commentaire', nullif(btrim(coalesce(n ->> 'verification_commentaire', '')), '')));
      else
        res := res || jsonb_build_object(k, o);                       -- métadonnées envoyées ignorées
      end if;
    end loop;
    new.questionnaire_data := res;
  end if;

  if valeurs_changees then
    new.questionnaire_modifie_le := now();
    -- Correction après validation : le questionnaire est à revérifier.
    if old.questionnaire_statut = 'valide' and new.questionnaire_statut is not distinct from old.questionnaire_statut then
      new.questionnaire_statut := 'a_verifier';
    end if;
  else
    new.questionnaire_modifie_le := old.questionnaire_modifie_le;
  end if;
  statut_change := new.questionnaire_statut is distinct from old.questionnaire_statut;
  new.questionnaire_soumis_le := case when statut_change and new.questionnaire_statut = 'soumis' then now() else old.questionnaire_soumis_le end;
  new.questionnaire_valide_le := case when statut_change and new.questionnaire_statut = 'valide' then now() else old.questionnaire_valide_le end;
  new.questionnaire_valide_par_id := case when statut_change and new.questionnaire_statut = 'valide' then a.auteur_utilisateur_id else old.questionnaire_valide_par_id end;
  return new;
end;
$$;

-- ── Règles (droits de l'appelant ; la maintenance y échappe) ────────────────
create or replace function public.invest_questionnaire_regles()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('postgres', 'supabase_admin') then return new; end if;
  if new.questionnaire_data is not distinct from old.questionnaire_data
     and new.questionnaire_statut is not distinct from old.questionnaire_statut then
    return new;
  end if;
  if old.statut in ('clos','abandonne') or new.statut in ('clos','abandonne') then
    raise exception 'Dossier clos : Projet & situation est en lecture seule.' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_each(new.questionnaire_data) e(k, v)
             where v ->> 'verification' in ('verifiee','a_corriger')
               and (old.questionnaire_data -> k ->> 'verification') is distinct from (v ->> 'verification')
               and (v ->> 'verifie_par_id') is null) then
    raise exception 'Seul un collaborateur Profero peut vérifier une réponse.' using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_each(new.questionnaire_data) e(k, v)
             where v ->> 'verification' = 'a_corriger'
               and (old.questionnaire_data -> k ->> 'verification') is distinct from 'a_corriger'
               and btrim(coalesce(v ->> 'verification_commentaire', '')) = '') then
    raise exception 'Indiquez ce qui est à corriger.' using errcode = '23514';
  end if;
  if new.questionnaire_statut = 'valide' and old.questionnaire_statut is distinct from 'valide' then
    if new.questionnaire_valide_par_id is null then
      raise exception 'Seul un collaborateur Profero valide le questionnaire.' using errcode = '42501';
    end if;
    if exists (select 1 from jsonb_each(new.questionnaire_data) e(k, v) where v ->> 'verification' = 'a_corriger') then
      raise exception 'Des réponses sont à corriger : validation impossible.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- ── Journal (lisible : sections, pas de clé technique) ──────────────────────
create or replace function public.invest_questionnaire_journal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  secs text[]; nb int; pertes int;
  vsecs text[]; nv int; nc int; nn int;
  plusieurs boolean;
  revalider boolean := old.questionnaire_statut = 'valide' and new.questionnaire_statut = 'a_verifier';
begin
  if new.questionnaire_data is distinct from old.questionnaire_data then
    select array_agg(distinct public.invest_questionnaire_section(split_part(k, '__', 1))), count(*),
           count(*) filter (where old.questionnaire_data -> k ->> 'verification' = 'verifiee')
      into secs, nb, pertes
    from jsonb_each(new.questionnaire_data) e(k, v)
    where (v -> 'valeur') is distinct from (old.questionnaire_data -> k -> 'valeur');
    if nb > 0 then
      plusieurs := array_length(secs, 1) > 1;
      perform public.invest_journaliser(new.id, new.client_id, 'questionnaire_modifie',
        format('Projet & situation : %s %s %s à jour (%s réponse%s).%s%s',
          case when plusieurs then 'sections' else 'section' end, array_to_string(secs, ', '),
          case when plusieurs then 'mises' else 'mise' end, nb, case when nb > 1 then 's' else '' end,
          case when pertes > 0 then format(' %s réponse%s vérifiée%s à revérifier.', pertes, case when pertes > 1 then 's' else '' end, case when pertes > 1 then 's' else '' end) else '' end,
          case when revalider then ' Questionnaire validé : à revérifier.' else '' end),
        null, jsonb_build_object('sections', to_jsonb(secs), 'reponses', nb));
    end if;
    select array_agg(distinct public.invest_questionnaire_section(split_part(k, '__', 1))),
           count(*) filter (where v ->> 'verification' = 'verifiee'),
           count(*) filter (where v ->> 'verification' = 'a_corriger'),
           count(*) filter (where v ->> 'verification' = 'non_verifiee')
      into vsecs, nv, nc, nn
    from jsonb_each(new.questionnaire_data) e(k, v)
    where (v -> 'valeur') is not distinct from (old.questionnaire_data -> k -> 'valeur')
      and (v ->> 'verification') is distinct from (old.questionnaire_data -> k ->> 'verification');
    if coalesce(nv, 0) + coalesce(nc, 0) + coalesce(nn, 0) > 0 then
      perform public.invest_journaliser(new.id, new.client_id, 'questionnaire_modifie',
        format('Projet & situation : %s (%s).',
          array_to_string(array_remove(array[
            case when nv > 0 then format('%s réponse%s vérifiée%s', nv, case when nv > 1 then 's' else '' end, case when nv > 1 then 's' else '' end) end,
            case when nc > 0 then format('%s réponse%s à corriger', nc, case when nc > 1 then 's' else '' end) end,
            case when nn > 0 then format('%s vérification%s retirée%s', nn, case when nn > 1 then 's' else '' end, case when nn > 1 then 's' else '' end) end], null), ', '),
          array_to_string(vsecs, ', ')),
        null, jsonb_build_object('sections', to_jsonb(vsecs), 'verifiees', nv, 'a_corriger', nc));
    end if;
  end if;
  if new.questionnaire_statut is distinct from old.questionnaire_statut and not revalider then
    if new.questionnaire_statut = 'soumis' then
      perform public.invest_journaliser(new.id, new.client_id, 'questionnaire_soumis', 'Projet & situation : questionnaire soumis.',
        jsonb_build_object('statut', old.questionnaire_statut), jsonb_build_object('statut', new.questionnaire_statut));
    elsif new.questionnaire_statut = 'valide' then
      perform public.invest_journaliser(new.id, new.client_id, 'questionnaire_valide', 'Projet & situation : questionnaire validé.',
        jsonb_build_object('statut', old.questionnaire_statut), jsonb_build_object('statut', new.questionnaire_statut));
    else
      perform public.invest_journaliser(new.id, new.client_id, 'questionnaire_modifie',
        format('Projet & situation : questionnaire %s → %s.',
          case old.questionnaire_statut when 'brouillon' then 'brouillon' when 'soumis' then 'soumis' when 'a_verifier' then 'à vérifier' else 'validé' end,
          case new.questionnaire_statut when 'brouillon' then 'brouillon' when 'soumis' then 'soumis' when 'a_verifier' then 'à vérifier' else 'validé' end),
        jsonb_build_object('statut', old.questionnaire_statut), jsonb_build_object('statut', new.questionnaire_statut));
    end if;
  end if;
  return null;
end;
$$;

create or replace trigger invest_questionnaire_avant_ecriture before update on public.invest_dossiers
  for each row execute function public.invest_questionnaire_avant_ecriture();
create or replace trigger invest_questionnaire_regles before update on public.invest_dossiers
  for each row execute function public.invest_questionnaire_regles();
create or replace trigger invest_questionnaire_journal after update on public.invest_dossiers
  for each row execute function public.invest_questionnaire_journal();

-- ── Gestes (droits de l'appelant, sous la RLS) ──────────────────────────────
-- Fusion côté base : on n'écrase jamais les réponses que l'écran n'envoie pas.
create or replace function public.invest_questionnaire_enregistrer(p_dossier_id uuid, p_reponses jsonb, p_version integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r jsonb;
begin
  if jsonb_typeof(coalesce(p_reponses, '{}'::jsonb)) <> 'object' then raise exception 'Réponses invalides.' using errcode = '22023'; end if;
  update public.invest_dossiers
     set questionnaire_data = questionnaire_data || p_reponses, questionnaire_version = p_version
   where id = p_dossier_id returning questionnaire_data into r;
  if not found then raise exception 'Dossier introuvable ou non modifiable.' using errcode = '42501'; end if;
  return r;
end;
$$;

create or replace function public.invest_questionnaire_verifier(p_dossier_id uuid, p_cles text[], p_statut text, p_commentaire text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r jsonb; patch jsonb;
begin
  select coalesce(jsonb_object_agg(k, (d.questionnaire_data -> k) || jsonb_build_object('verification', p_statut, 'verification_commentaire', p_commentaire)), '{}'::jsonb)
    into patch
  from public.invest_dossiers d, unnest(p_cles) k
  where d.id = p_dossier_id and d.questionnaire_data ? k;
  update public.invest_dossiers set questionnaire_data = questionnaire_data || patch
   where id = p_dossier_id returning questionnaire_data into r;
  if not found then raise exception 'Dossier introuvable ou non modifiable.' using errcode = '42501'; end if;
  return r;
end;
$$;

create or replace function public.invest_questionnaire_statut(p_dossier_id uuid, p_statut text)
returns text language plpgsql security invoker set search_path = '' as $$
declare s text;
begin
  update public.invest_dossiers set questionnaire_statut = p_statut where id = p_dossier_id returning questionnaire_statut into s;
  if not found then raise exception 'Dossier introuvable ou non modifiable.' using errcode = '42501'; end if;
  return s;
end;
$$;

revoke all on function public.invest_questionnaire_avant_ecriture() from public, anon, authenticated;
revoke all on function public.invest_questionnaire_journal() from public, anon, authenticated;
revoke execute on function public.invest_questionnaire_regles() from public, anon;
revoke execute on function public.invest_questionnaire_section(text) from public, anon;
revoke all on function public.invest_questionnaire_enregistrer(uuid, jsonb, integer) from public, anon;
revoke all on function public.invest_questionnaire_verifier(uuid, text[], text, text) from public, anon;
revoke all on function public.invest_questionnaire_statut(uuid, text) from public, anon;
grant execute on function public.invest_questionnaire_enregistrer(uuid, jsonb, integer) to authenticated;
grant execute on function public.invest_questionnaire_verifier(uuid, text[], text, text) to authenticated;
grant execute on function public.invest_questionnaire_statut(uuid, text) to authenticated;

-- ── Suites 2c ───────────────────────────────────────────────────────────────
create or replace function public.invest_collecte_journal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb;
  objet text := public.invest_collecte_objet(tg_table_name, n);
  cles text[];
begin
  if new.dossier_id is null then return null; end if;
  if tg_op = 'INSERT' then
    perform public.invest_journaliser(new.dossier_id, new.client_id, 'collecte_ajout',
      format('Situation patrimoniale — ajout : %s.', objet), null,
      jsonb_build_object('table', tg_table_name, 'id', new.id, 'source', new.source));
    return null;
  end if;
  o := to_jsonb(old);
  select array_agg(k order by k) into cles
  from jsonb_object_keys(public.invest_collecte_metier(n)) k
  where (public.invest_collecte_metier(n) -> k) is distinct from (public.invest_collecte_metier(o) -> k);
  if cles is not null then
    perform public.invest_journaliser(new.dossier_id, new.client_id, 'collecte_modification',
      format('Situation patrimoniale — modification : %s (%s).%s', objet, array_to_string(cles, ', '),
        -- Tranche 2d : la perte automatique de vérification est dite dans CE résumé (pas d'événement de plus).
        case when old.verification_statut = 'verifiee' and new.verification_statut = 'non_verifiee'
             then ' Donnée auparavant vérifiée : à revérifier.' else '' end),
      jsonb_build_object('table', tg_table_name, 'id', new.id) || public.invest_diff(public.invest_collecte_metier(o), public.invest_collecte_metier(n), cles, 'avant'),
      jsonb_build_object('table', tg_table_name, 'id', new.id) || public.invest_diff(public.invest_collecte_metier(o), public.invest_collecte_metier(n), cles, 'apres'));
  end if;
  if new.archive_le is distinct from old.archive_le then
    perform public.invest_journaliser(new.dossier_id, new.client_id, 'collecte_modification',
      format('Situation patrimoniale — %s : %s.', case when new.archive_le is null then 'désarchivage' else 'archivage' end, objet),
      jsonb_build_object('table', tg_table_name, 'id', new.id, 'archive_le', old.archive_le),
      jsonb_build_object('table', tg_table_name, 'id', new.id, 'archive_le', new.archive_le));
  end if;
  if new.verification_statut is distinct from old.verification_statut
     and not (new.verification_statut = 'non_verifiee' and cles is not null) then
    perform public.invest_journaliser(new.dossier_id, new.client_id, 'collecte_verification',
      format('Situation patrimoniale — vérification : %s → %s%s.', objet,
        case new.verification_statut when 'verifiee' then 'vérifiée' when 'a_corriger' then 'à corriger' else 'non vérifiée' end,
        coalesce(' (' || nullif(btrim(new.verification_commentaire), '') || ')', '')),
      jsonb_build_object('table', tg_table_name, 'id', new.id, 'verification_statut', old.verification_statut),
      jsonb_build_object('table', tg_table_name, 'id', new.id, 'verification_statut', new.verification_statut));
  end if;
  return null;
end;
$$;

create or replace function public.invest_collecte_regles()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;
  if not exists (select 1 from public.invest_dossiers d
                 where d.client_id = new.client_id and d.statut in ('ouvert','actif','suspendu')) then
    raise exception 'La situation patrimoniale se complète dans un Dossier Invest en cours : aucun dossier en cours pour ce client (un dossier clos reste lisible, pas modifiable).'
      using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' and new.verification_statut <> 'non_verifiee')
     or (tg_op = 'UPDATE' and new.verification_statut is distinct from old.verification_statut and new.verification_statut <> 'non_verifiee') then
    if new.verifie_par_id is null then
      raise exception 'Seul un collaborateur Profero peut vérifier une donnée.' using errcode = '42501';
    end if;
    if new.verification_statut = 'a_corriger' and btrim(coalesce(new.verification_commentaire, '')) = '' then
      raise exception 'Indiquez ce qui est à corriger (commentaire de vérification).' using errcode = '23514';
    end if;
  end if;
  -- Tranche 2d : le désarchivage est réservé à un collaborateur (et journalisé).
  if tg_op = 'UPDATE' and old.archive_le is not null and new.archive_le is null and new.modifie_par_id is null then
    raise exception 'Seul un collaborateur Profero peut désarchiver une donnée.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.archive_le is not null and new.archive_le is not null
     and public.invest_collecte_metier(to_jsonb(new)) is distinct from public.invest_collecte_metier(to_jsonb(old)) then
    raise exception 'Une donnée archivée ne se modifie plus.' using errcode = '23514';
  end if;
  return new;
end;
$$;
