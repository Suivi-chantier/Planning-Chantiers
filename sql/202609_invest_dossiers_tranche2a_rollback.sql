-- ============================================================================
-- RETOUR ARRIÈRE de supabase/migrations/20260930210000_invest_dossiers_tranche2a.sql
--
-- NON DESTRUCTIF : aucune ligne n'est supprimée ni modifiée. Les fonctions du
-- journal et des étapes reprennent EXACTEMENT leur texte de la Tranche 1
-- (copié de 20260930190000_invest_dossiers_tranche1.sql).
--
-- Les événements « etape_reprise_confirmee » déjà écrits sont CONSERVÉS : la
-- contrainte de type de la Tranche 1 est remise en « not valid » (elle refuse
-- toute nouvelle écriture de ce type sans rejeter l'historique).
-- Les commentaires/motifs saisis restent dans les étapes.
-- La colonne technique « ordre » (et ses index) est CONSERVÉE : elle est
-- attribuée par PostgreSQL, sans effet sur les fonctions de la Tranche 1, et la
-- retirer effacerait l'ordre d'enregistrement des événements.
-- ============================================================================

alter table public.invest_dossier_evenements alter column survenu_le set default now();

alter table public.invest_dossier_evenements drop constraint if exists invest_dossier_evenements_type_check;
alter table public.invest_dossier_evenements add constraint invest_dossier_evenements_type_check
  check (type in ('dossier_cree','dossier_statut_change','dossier_modifie',
    'lettre_mission_change','conseiller_change','etape_statut_change','etape_balle_change',
    'etape_echeance_change','etape_prochaine_action_change','etape_bloquee','etape_debloquee',
    'reprise_importee')) not valid;

create or replace function public.invest_journaliser(
  p_dossier_id uuid, p_client_id uuid, p_type text, p_resume text,
  p_avant jsonb default null, p_apres jsonb default null,
  p_etape_id uuid default null, p_mission_action_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from public.invest_auteur_courant();
  insert into public.invest_dossier_evenements
    (dossier_id, client_id, etape_id, mission_action_id, type, avant, apres, resume,
     auteur_type, auteur_utilisateur_id, auteur_libelle)
  values (p_dossier_id, p_client_id, p_etape_id, p_mission_action_id, p_type,
          nullif(p_avant, '{}'::jsonb), nullif(p_apres, '{}'::jsonb), p_resume,
          a.auteur_type, a.auteur_utilisateur_id, a.auteur_libelle);
end;
$$;

create or replace function public.invest_etapes_journal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid;
  o jsonb := to_jsonb(old); n jsonb := to_jsonb(new);
  lib text := public.invest_libelle_etape(new.etape);
  v_de text; v_vers text;
begin
  select client_id into v_client from public.invest_dossiers where id = new.dossier_id;
  if new.statut is distinct from old.statut then
    if new.statut = 'bloquee' then
      perform public.invest_journaliser(new.dossier_id, v_client, 'etape_bloquee',
        format('%s bloquée : %s.', lib, new.blocage_motif),
        jsonb_build_object('statut', old.statut), jsonb_build_object('statut', new.statut, 'blocage_motif', new.blocage_motif), new.id);
    elsif old.statut = 'bloquee' then
      perform public.invest_journaliser(new.dossier_id, v_client, 'etape_debloquee',
        format('%s débloquée (%s).', lib, public.invest_libelle_statut_etape(new.statut)),
        jsonb_build_object('statut', old.statut, 'blocage_motif', old.blocage_motif), jsonb_build_object('statut', new.statut), new.id);
    else
      perform public.invest_journaliser(new.dossier_id, v_client, 'etape_statut_change',
        format('%s : %s → %s.', lib, public.invest_libelle_statut_etape(old.statut), public.invest_libelle_statut_etape(new.statut)),
        public.invest_diff(o, n, array['statut','date_debut','date_fin'], 'avant'),
        public.invest_diff(o, n, array['statut','date_debut','date_fin'], 'apres'), new.id);
    end if;
  end if;
  if new.balle is not null and (new.balle is distinct from old.balle
      or new.balle_utilisateur_id is distinct from old.balle_utilisateur_id
      or new.balle_tiers_libelle is distinct from old.balle_tiers_libelle) then
    select nom into v_de from public.utilisateurs where id = old.balle_utilisateur_id;
    select nom into v_vers from public.utilisateurs where id = new.balle_utilisateur_id;
    perform public.invest_journaliser(new.dossier_id, v_client, 'etape_balle_change',
      format('%s : balle %s → %s.', lib,
        coalesce(public.invest_libelle_balle(old.balle) || coalesce(' (' || coalesce(v_de, old.balle_tiers_libelle) || ')', ''), 'personne'),
        public.invest_libelle_balle(new.balle) || coalesce(' (' || coalesce(v_vers, new.balle_tiers_libelle) || ')', '')),
      public.invest_diff(o, n, array['balle','balle_utilisateur_id','balle_tiers_libelle'], 'avant'),
      public.invest_diff(o, n, array['balle','balle_utilisateur_id','balle_tiers_libelle'], 'apres'), new.id);
  end if;
  if new.echeance is distinct from old.echeance then
    perform public.invest_journaliser(new.dossier_id, v_client, 'etape_echeance_change',
      format('%s : échéance %s → %s.', lib,
        coalesce(to_char(old.echeance, 'DD/MM/YYYY'), 'aucune'), coalesce(to_char(new.echeance, 'DD/MM/YYYY'), 'aucune')),
      jsonb_build_object('echeance', old.echeance), jsonb_build_object('echeance', new.echeance), new.id);
  end if;
  if new.prochaine_action is distinct from old.prochaine_action
     or new.prochaine_action_id is distinct from old.prochaine_action_id then
    perform public.invest_journaliser(new.dossier_id, v_client, 'etape_prochaine_action_change',
      format('%s : prochaine action « %s ».', lib, coalesce(new.prochaine_action, 'aucune')),
      public.invest_diff(o, n, array['prochaine_action','prochaine_action_id'], 'avant'),
      public.invest_diff(o, n, array['prochaine_action','prochaine_action_id'], 'apres'), new.id, new.prochaine_action_id);
  end if;
  return null;
end;
$$;

drop trigger if exists invest_etapes_regles_pilotage on public.invest_dossier_etapes;
drop function if exists public.invest_etapes_regles_pilotage();
drop function if exists public.invest_transition_etape_autorisee(text, text);
drop function if exists public.invest_derniere_ligne(text);
