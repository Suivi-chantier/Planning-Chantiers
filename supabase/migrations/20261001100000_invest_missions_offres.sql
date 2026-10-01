-- ============================================================================
-- Invest V2 — Chantier 9 : Missions Offre 2 / Offre 3.
--
-- ADDITIVE. Aucune donnée existante modifiée (les 24 missions sont des Offre 2).
--   Offre 2 (accompagnement_acquisition) : Projet → Documents → Recherche →
--     Opportunités → Financement → Acquisition.
--   Offre 3 (audit_patrimonial) : phase Patrimoine (Collecte → Analyse →
--     Stratégie → Rapport & restitution) puis phase Investissement (Cadrage
--     facultatif → mêmes jalons que l'Offre 2). L'Offre 3 contient l'Offre 2.
--   - invest_dossiers : + restitution_le (rapport remis et restitué le même
--     jour), cadrage_statut (NULL = à faire, 'fait', 'non_necessaire'),
--     cadrage_le ; réservés à l'Offre 3 (contraintes) ;
--   - règles (droits de l'appelant) : dossier clos = offre, restitution et
--     cadrage en lecture seule ; pas de restitution datée dans le futur ;
--   - journal lisible : offre_change, restitution_change, cadrage_change ;
--     forfait de mission et lettre de mission en clair (plus de clé technique).
-- Les 11 étapes ne changent pas ; aucune fonction de ce fichier n'écrit dans
-- invest_dossier_etapes (invariant SECURITY DEFINER du CLAUDE.md : vérifié).
-- Logique d'affichage : src/Invest/dossiers/offres.mjs.
--
-- RETOUR ARRIÈRE : sql/202610_invest_missions_offres_rollback.sql
-- VÉRIFICATION  : node scripts/verif-invest-dossiers-t1.mjs
-- ============================================================================

alter table public.invest_dossier_evenements drop constraint if exists invest_dossier_evenements_type_check;
alter table public.invest_dossier_evenements add constraint invest_dossier_evenements_type_check
  check (type in ('dossier_cree','dossier_statut_change','dossier_modifie',
    'lettre_mission_change','conseiller_change','etape_statut_change','etape_balle_change',
    'etape_echeance_change','etape_prochaine_action_change','etape_bloquee','etape_debloquee',
    'reprise_importee','etape_reprise_confirmee',
    'collecte_ajout','collecte_modification','collecte_verification',
    'questionnaire_modifie','questionnaire_soumis','questionnaire_valide',
    'offre_change','restitution_change','cadrage_change'));

alter table public.invest_dossiers
  add column if not exists restitution_le date,
  add column if not exists cadrage_statut text,
  add column if not exists cadrage_le date;
alter table public.invest_dossiers drop constraint if exists invest_dossiers_cadrage_statut_check;
alter table public.invest_dossiers add constraint invest_dossiers_cadrage_statut_check
  check (cadrage_statut is null or cadrage_statut in ('fait','non_necessaire'));
-- Une date de cadrage n'existe que pour un cadrage fait, et un cadrage fait a une date.
alter table public.invest_dossiers drop constraint if exists invest_dossiers_cadrage_date_check;
alter table public.invest_dossiers add constraint invest_dossiers_cadrage_date_check
  check ((coalesce(cadrage_statut, '') = 'fait') = (cadrage_le is not null));
-- Le cadrage suit la restitution.
alter table public.invest_dossiers drop constraint if exists invest_dossiers_cadrage_apres_restitution;
alter table public.invest_dossiers add constraint invest_dossiers_cadrage_apres_restitution
  check (cadrage_statut is null or restitution_le is not null);
alter table public.invest_dossiers drop constraint if exists invest_dossiers_cadrage_date_apres_restitution;
alter table public.invest_dossiers add constraint invest_dossiers_cadrage_date_apres_restitution
  check (cadrage_le is null or cadrage_le >= restitution_le);
-- Restitution et cadrage réservés à l'Offre 3 : un retour en Offre 2 exige de les retirer.
alter table public.invest_dossiers drop constraint if exists invest_dossiers_phase_patrimoine_offre3;
alter table public.invest_dossiers add constraint invest_dossiers_phase_patrimoine_offre3
  check (type_mission = 'audit_patrimonial' or (restitution_le is null and cadrage_statut is null));

-- ── Libellés (identiques à offres.mjs et parcours.mjs, vérifiés par les tests) ─
create or replace function public.invest_libelle_offre(p text)
returns text language sql immutable set search_path = '' as $$
  select case p
    when 'accompagnement_acquisition' then 'Offre 2'
    when 'audit_patrimonial' then 'Offre 3'
    when 'conseil' then 'Conseil' when 'autre' then 'Autre' else coalesce(p, '—') end;
$$;
create or replace function public.invest_libelle_lettre_mission(p text)
returns text language sql immutable set search_path = '' as $$
  select case p
    when 'a_emettre' then 'à émettre' when 'envoyee' then 'envoyée' when 'signee' then 'signée'
    when 'non_applicable' then 'non applicable' when 'inconnu' then 'inconnu (reprise)' else coalesce(p, '—') end;
$$;
-- 3000 → « 3 000 € HT » ; 1234.5 → « 1 234,50 € HT » ; NULL → « non renseigné ».
create or replace function public.invest_montant_ht(p numeric)
returns text language sql immutable set search_path = '' as $$
  select case when p is null then 'non renseigné' else
    regexp_replace(trunc(p)::bigint::text, '(\d)(?=(\d{3})+$)', '\1 ', 'g')
    || case when p <> trunc(p) then ',' || lpad(round((p - trunc(p)) * 100)::int::text, 2, '0') else '' end
    || ' € HT' end;
$$;

-- ── Règles (droits de l'appelant ; la maintenance y échappe) ────────────────
create or replace function public.invest_offre_regles()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('postgres', 'supabase_admin') then return new; end if;
  if new.type_mission is not distinct from old.type_mission
     and new.restitution_le is not distinct from old.restitution_le
     and new.cadrage_statut is not distinct from old.cadrage_statut
     and new.cadrage_le is not distinct from old.cadrage_le then
    return new;
  end if;
  if old.statut in ('clos','abandonne') or new.statut in ('clos','abandonne') then
    raise exception 'Dossier clos : l''offre, la restitution et le cadrage sont en lecture seule.' using errcode = '23514';
  end if;
  if new.restitution_le is distinct from old.restitution_le and new.restitution_le > current_date then
    raise exception 'La restitution ne peut pas être datée dans le futur.' using errcode = '23514';
  end if;
  if new.cadrage_le is distinct from old.cadrage_le and new.cadrage_le > current_date then
    raise exception 'Le cadrage ne peut pas être daté dans le futur.' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ── Journal (droits du propriétaire : écrit UNIQUEMENT dans le journal) ─────
create or replace function public.invest_offre_journal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.type_mission is distinct from old.type_mission then
    perform public.invest_journaliser(new.id, new.client_id, 'offre_change',
      format('Offre : %s → %s.', public.invest_libelle_offre(old.type_mission), public.invest_libelle_offre(new.type_mission)),
      jsonb_build_object('type_mission', old.type_mission), jsonb_build_object('type_mission', new.type_mission));
  end if;
  if new.restitution_le is distinct from old.restitution_le then
    perform public.invest_journaliser(new.id, new.client_id, 'restitution_change',
      case when new.restitution_le is null
           then format('Rapport & restitution : date du %s retirée.', to_char(old.restitution_le, 'DD/MM/YYYY'))
           when old.restitution_le is null
           then format('Rapport patrimonial remis et restitué le %s.', to_char(new.restitution_le, 'DD/MM/YYYY'))
           else format('Rapport & restitution : date corrigée, %s → %s.', to_char(old.restitution_le, 'DD/MM/YYYY'), to_char(new.restitution_le, 'DD/MM/YYYY')) end,
      jsonb_build_object('restitution_le', old.restitution_le), jsonb_build_object('restitution_le', new.restitution_le));
  end if;
  if new.cadrage_statut is distinct from old.cadrage_statut or new.cadrage_le is distinct from old.cadrage_le then
    perform public.invest_journaliser(new.id, new.client_id, 'cadrage_change',
      case new.cadrage_statut
        when 'fait' then format('Cadrage du projet fait le %s.', to_char(new.cadrage_le, 'DD/MM/YYYY'))
        when 'non_necessaire' then 'Cadrage du projet : non nécessaire.'
        else 'Cadrage du projet : remis à faire.' end,
      jsonb_build_object('cadrage_statut', old.cadrage_statut, 'cadrage_le', old.cadrage_le),
      jsonb_build_object('cadrage_statut', new.cadrage_statut, 'cadrage_le', new.cadrage_le));
  end if;
  return null;
end;
$$;

create or replace trigger invest_offre_regles before update on public.invest_dossiers
  for each row execute function public.invest_offre_regles();
create or replace trigger invest_offre_journal after update on public.invest_dossiers
  for each row execute function public.invest_offre_journal();

-- ── Journal T1 : offre, forfait et lettre de mission en clair ───────────────
-- Identique à 20260930190000 sauf : type_mission (→ offre_change) et
-- honoraires_prevus_ht sortent de « Dossier modifié : <clés> » ; forfait et
-- lettre de mission rédigés en français. N'écrit que dans le journal.
create or replace function public.invest_dossiers_journal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  o jsonb; n jsonb;
  v_de text; v_vers text;
  cles_modif constant text[] := array['libelle','date_ouverture',
                                      'date_cloture','portail_visible','motif_cloture'];
begin
  if tg_op = 'INSERT' then
    perform public.invest_journaliser(new.id, new.client_id, 'dossier_cree',
      format('Dossier %s ouvert — %s.', new.reference, new.libelle), null,
      jsonb_build_object('statut', new.statut, 'origine', new.origine, 'conseiller_id', new.conseiller_id));
    return null;
  end if;
  o := to_jsonb(old); n := to_jsonb(new);
  if new.statut is distinct from old.statut then
    perform public.invest_journaliser(new.id, new.client_id, 'dossier_statut_change',
      format('Statut du dossier : %s → %s%s.', public.invest_libelle_statut_dossier(old.statut),
        public.invest_libelle_statut_dossier(new.statut),
        case when new.motif_cloture is not null and new.statut in ('clos','abandonne')
             then ' (' || new.motif_cloture || ')' else '' end),
      jsonb_build_object('statut', old.statut), jsonb_build_object('statut', new.statut, 'motif_cloture', new.motif_cloture));
  end if;
  if new.lettre_mission_statut is distinct from old.lettre_mission_statut
     or new.lettre_mission_signee_le is distinct from old.lettre_mission_signee_le then
    perform public.invest_journaliser(new.id, new.client_id, 'lettre_mission_change',
      format('Lettre de mission : %s → %s%s.', public.invest_libelle_lettre_mission(old.lettre_mission_statut),
        public.invest_libelle_lettre_mission(new.lettre_mission_statut),
        case when new.lettre_mission_signee_le is not null then ' (signée le ' || to_char(new.lettre_mission_signee_le, 'DD/MM/YYYY') || ')' else '' end),
      public.invest_diff(o, n, array['lettre_mission_statut','lettre_mission_signee_le'], 'avant'),
      public.invest_diff(o, n, array['lettre_mission_statut','lettre_mission_signee_le'], 'apres'));
  end if;
  if new.conseiller_id is distinct from old.conseiller_id then
    select nom into v_de from public.utilisateurs where id = old.conseiller_id;
    select nom into v_vers from public.utilisateurs where id = new.conseiller_id;
    perform public.invest_journaliser(new.id, new.client_id, 'conseiller_change',
      format('Conseiller : %s → %s.', coalesce(v_de, 'aucun'), coalesce(v_vers, 'aucun')),
      jsonb_build_object('conseiller_id', old.conseiller_id), jsonb_build_object('conseiller_id', new.conseiller_id));
  end if;
  if new.honoraires_prevus_ht is distinct from old.honoraires_prevus_ht then
    perform public.invest_journaliser(new.id, new.client_id, 'dossier_modifie',
      format('Forfait de mission : %s → %s.', public.invest_montant_ht(old.honoraires_prevus_ht), public.invest_montant_ht(new.honoraires_prevus_ht)),
      jsonb_build_object('honoraires_prevus_ht', old.honoraires_prevus_ht), jsonb_build_object('honoraires_prevus_ht', new.honoraires_prevus_ht));
  end if;
  if public.invest_diff(o, n, cles_modif, 'apres') <> '{}'::jsonb
     and not (new.statut is distinct from old.statut
              and public.invest_diff(o, n, cles_modif, 'apres') - 'date_cloture' - 'motif_cloture' = '{}'::jsonb) then
    perform public.invest_journaliser(new.id, new.client_id, 'dossier_modifie',
      'Dossier modifié : ' || (select string_agg(k, ', ' order by k)
        from jsonb_object_keys(public.invest_diff(o, n, cles_modif, 'apres')) k) || '.',
      public.invest_diff(o, n, cles_modif, 'avant'), public.invest_diff(o, n, cles_modif, 'apres'));
  end if;
  return null;
end;
$$;

revoke all on function public.invest_offre_journal() from public, anon, authenticated;
revoke all on function public.invest_dossiers_journal() from public, anon, authenticated;
revoke execute on function public.invest_offre_regles() from public, anon;
revoke execute on function public.invest_libelle_offre(text) from public, anon;
revoke execute on function public.invest_libelle_lettre_mission(text) from public, anon;
revoke execute on function public.invest_montant_ht(numeric) from public, anon;
