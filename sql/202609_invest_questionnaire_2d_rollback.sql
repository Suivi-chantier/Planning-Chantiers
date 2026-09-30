-- ============================================================================
-- RETOUR ARRIÈRE de supabase/migrations/20260930235000_invest_questionnaire_2d.sql
--
-- ⚠️ DESTRUCTIF pour les réponses du questionnaire (colonnes questionnaire_*
-- de invest_dossiers). Exporter avant si des réponses ont été saisies.
-- Les événements questionnaire_* du journal sont CONSERVÉS (contrainte de type
-- 2c remise en « not valid »). Les fonctions 2c retrouvent leur texte exact.
-- ============================================================================

drop trigger if exists invest_questionnaire_journal on public.invest_dossiers;
drop trigger if exists invest_questionnaire_regles on public.invest_dossiers;
drop trigger if exists invest_questionnaire_avant_ecriture on public.invest_dossiers;
drop function if exists public.invest_questionnaire_enregistrer(uuid, jsonb, integer);
drop function if exists public.invest_questionnaire_verifier(uuid, text[], text, text);
drop function if exists public.invest_questionnaire_statut(uuid, text);
drop function if exists public.invest_questionnaire_journal();
drop function if exists public.invest_questionnaire_regles();
drop function if exists public.invest_questionnaire_avant_ecriture();
drop function if exists public.invest_questionnaire_section(text);

alter table public.invest_dossiers drop constraint if exists invest_dossiers_questionnaire_statut_check;
alter table public.invest_dossiers drop constraint if exists invest_dossiers_questionnaire_data_check;
alter table public.invest_dossiers
  drop column if exists questionnaire_valide_par_id,
  drop column if exists questionnaire_valide_le,
  drop column if exists questionnaire_soumis_le,
  drop column if exists questionnaire_modifie_le,
  drop column if exists questionnaire_statut,
  drop column if exists questionnaire_data,
  drop column if exists questionnaire_version;

alter table public.invest_dossier_evenements drop constraint if exists invest_dossier_evenements_type_check;
alter table public.invest_dossier_evenements add constraint invest_dossier_evenements_type_check
  check (type in ('dossier_cree','dossier_statut_change','dossier_modifie',
    'lettre_mission_change','conseiller_change','etape_statut_change','etape_balle_change',
    'etape_echeance_change','etape_prochaine_action_change','etape_bloquee','etape_debloquee',
    'reprise_importee','etape_reprise_confirmee',
    'collecte_ajout','collecte_modification','collecte_verification')) not valid;

-- Fonctions 2c : texte exact de 20260930230000.
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
      format('Situation patrimoniale — modification : %s (%s).', objet, array_to_string(cles, ', ')),
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
  if tg_op = 'UPDATE' and old.archive_le is not null and new.archive_le is not null
     and public.invest_collecte_metier(to_jsonb(new)) is distinct from public.invest_collecte_metier(to_jsonb(old)) then
    raise exception 'Une donnée archivée ne se modifie plus.' using errcode = '23514';
  end if;
  return new;
end;
$$;
