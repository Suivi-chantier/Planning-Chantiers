-- ============================================================================
-- RETOUR ARRIÈRE de supabase/migrations/20261001100000_invest_missions_offres.sql
--
-- ⚠️ DESTRUCTIF pour les dates de restitution et de cadrage (colonnes
-- restitution_le, cadrage_statut, cadrage_le). Exporter avant si renseignées.
-- Le type de mission (Offre 2 / Offre 3) est CONSERVÉ : il existait avant.
-- Les événements offre_change / restitution_change / cadrage_change du journal
-- sont CONSERVÉS (contrainte de type 2d remise en « not valid »).
-- invest_dossiers_journal retrouve le texte exact de 20260930190000.
-- ============================================================================

drop trigger if exists invest_offre_journal on public.invest_dossiers;
drop trigger if exists invest_offre_regles on public.invest_dossiers;
drop function if exists public.invest_offre_journal();
drop function if exists public.invest_offre_regles();

alter table public.invest_dossiers drop constraint if exists invest_dossiers_phase_patrimoine_offre3;
alter table public.invest_dossiers drop constraint if exists invest_dossiers_cadrage_date_apres_restitution;
alter table public.invest_dossiers drop constraint if exists invest_dossiers_cadrage_apres_restitution;
alter table public.invest_dossiers drop constraint if exists invest_dossiers_cadrage_date_check;
alter table public.invest_dossiers drop constraint if exists invest_dossiers_cadrage_statut_check;
alter table public.invest_dossiers
  drop column if exists cadrage_le,
  drop column if exists cadrage_statut,
  drop column if exists restitution_le;

alter table public.invest_dossier_evenements drop constraint if exists invest_dossier_evenements_type_check;
alter table public.invest_dossier_evenements add constraint invest_dossier_evenements_type_check
  check (type in ('dossier_cree','dossier_statut_change','dossier_modifie',
    'lettre_mission_change','conseiller_change','etape_statut_change','etape_balle_change',
    'etape_echeance_change','etape_prochaine_action_change','etape_bloquee','etape_debloquee',
    'reprise_importee','etape_reprise_confirmee',
    'collecte_ajout','collecte_modification','collecte_verification',
    'questionnaire_modifie','questionnaire_soumis','questionnaire_valide')) not valid;

-- Journal T1 : texte exact de 20260930190000.
create or replace function public.invest_dossiers_journal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  o jsonb; n jsonb;
  v_de text; v_vers text;
  cles_modif constant text[] := array['libelle','type_mission','honoraires_prevus_ht','date_ouverture',
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
      format('Lettre de mission : %s → %s%s.', old.lettre_mission_statut, new.lettre_mission_statut,
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
revoke all on function public.invest_dossiers_journal() from public, anon, authenticated;

drop function if exists public.invest_montant_ht(numeric);
drop function if exists public.invest_libelle_lettre_mission(text);
drop function if exists public.invest_libelle_offre(text);
