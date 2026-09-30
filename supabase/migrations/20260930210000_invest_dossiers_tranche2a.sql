-- ============================================================================
-- Chantier 1.1 — Dossier Invest, Tranche 2a : pilotage dans le CRM.
--
-- Migration ADDITIVE et courte. Aucune table créée, aucune colonne retirée,
-- aucune donnée modifiée, aucune table Foyer / Patrimoine touchée.
--
--   1. Journal : chaque événement porte l'heure réelle de son écriture
--      (clock_timestamp) — deux événements d'une même transaction ne partagent
--      plus la même heure, l'ordre du journal est fiable.
--   2. Journal : « balle personne → Client » quand personne n'avait la balle
--      (au lieu de « balle — → Client »).
--   3. Nouvel événement « etape_reprise_confirmee » : seul le geste explicite
--      « Confirmer la reprise » fait passer reprise_a_confirmer de vrai à faux ;
--      l'inverse est refusé ; rien d'autre ne touche ce drapeau.
--   4. Enchaînements de statut d'étape contrôlés par la base (même matrice que
--      src/Invest/dossiers/transitions.mjs).
--   5. « Non applicable » exige un commentaire (motif), au moment du passage
--      seulement : les étapes reprises déjà « non applicable » restent valides.
--   6. Rouvrir une étape terminée ou non applicable exige un motif.
--
-- Les règles 3 à 6 (déclencheur invest_etapes_regles_pilotage) ne s'appliquent
-- pas à la maintenance (postgres, supabase_admin), comme l'immutabilité du
-- journal en Tranche 1. La clé serveur (service_role) y est soumise.
-- Aucun automatisme ne fait avancer une étape.
--
-- RETOUR ARRIÈRE : sql/202609_invest_dossiers_tranche2a_rollback.sql
-- VÉRIFICATION  : node scripts/verif-invest-dossiers-t1.mjs
-- ============================================================================

-- ── 1. Heure réelle des événements ──────────────────────────────────────────
alter table public.invest_dossier_evenements alter column survenu_le set default clock_timestamp();

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
     auteur_type, auteur_utilisateur_id, auteur_libelle, survenu_le)
  values (p_dossier_id, p_client_id, p_etape_id, p_mission_action_id, p_type,
          nullif(p_avant, '{}'::jsonb), nullif(p_apres, '{}'::jsonb), p_resume,
          a.auteur_type, a.auteur_utilisateur_id, a.auteur_libelle, clock_timestamp());
end;
$$;

-- ── 3. Nouveau type d'événement ─────────────────────────────────────────────
alter table public.invest_dossier_evenements drop constraint if exists invest_dossier_evenements_type_check;
alter table public.invest_dossier_evenements add constraint invest_dossier_evenements_type_check
  check (type in ('dossier_cree','dossier_statut_change','dossier_modifie',
    'lettre_mission_change','conseiller_change','etape_statut_change','etape_balle_change',
    'etape_echeance_change','etape_prochaine_action_change','etape_bloquee','etape_debloquee',
    'reprise_importee','etape_reprise_confirmee'));

-- Matrice des enchaînements (identique à TRANSITIONS de transitions.mjs).
create or replace function public.invest_transition_etape_autorisee(p_de text, p_vers text)
returns boolean language sql immutable set search_path = '' as $$
  select p_de is not distinct from p_vers or case p_de
    when 'a_venir'        then p_vers in ('en_cours','non_applicable')
    when 'en_cours'       then p_vers in ('en_attente','bloquee','terminee','non_applicable')
    when 'en_attente'     then p_vers in ('en_cours','bloquee','terminee','non_applicable')
    when 'bloquee'        then p_vers in ('en_cours','en_attente')
    when 'terminee'       then p_vers in ('en_cours')
    when 'non_applicable' then p_vers in ('en_cours')
    else false end;
$$;

-- Dernière ligne d'un commentaire (le motif du dernier geste).
create or replace function public.invest_derniere_ligne(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(btrim((regexp_split_to_array(btrim(coalesce(p, '')), E'\n'))[
    array_length(regexp_split_to_array(btrim(coalesce(p, '')), E'\n'), 1)]), '');
$$;

-- ── 4 à 6. Règles de pilotage d'une étape ──────────────────────────────────
-- Déclencheur SÉPARÉ, exécuté avec les droits de l'appelant (security invoker) :
-- dans une fonction « security definer », current_user vaut toujours le
-- propriétaire, et la dérogation de maintenance s'appliquerait à tout le monde.
-- Il s'exécute après invest_etapes_avant_ecriture (ordre alphabétique) et ne
-- lit que le statut, le commentaire et le drapeau de reprise, que ce dernier ne
-- modifie pas.
create or replace function public.invest_etapes_regles_pilotage()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_motif_nouveau boolean;
begin
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;
  -- Seul « Confirmer la reprise » touche ce drapeau, et seulement de vrai à faux.
  if new.reprise_a_confirmer and not old.reprise_a_confirmer then
    raise exception 'Une étape confirmée ne redevient pas « à confirmer ».' using errcode = '23514';
  end if;
  if new.statut is distinct from old.statut then
    if not public.invest_transition_etape_autorisee(old.statut, new.statut) then
      raise exception 'Enchaînement interdit : % → %.', public.invest_libelle_statut_etape(old.statut),
        public.invest_libelle_statut_etape(new.statut) using errcode = '23514';
    end if;
    v_motif_nouveau := btrim(coalesce(new.commentaire, '')) <> ''
                       and new.commentaire is distinct from old.commentaire;
    if new.statut = 'non_applicable' and not v_motif_nouveau then
      raise exception 'Passer une étape en « Non applicable » exige un motif (commentaire).' using errcode = '23514';
    end if;
    if old.statut in ('terminee','non_applicable') and not v_motif_nouveau then
      raise exception 'Rouvrir une étape % exige un motif (commentaire).',
        lower(public.invest_libelle_statut_etape(old.statut)) using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create or replace trigger invest_etapes_regles_pilotage
  before update on public.invest_dossier_etapes
  for each row execute function public.invest_etapes_regles_pilotage();

-- ── Journal d'une étape (2 : libellé « personne » ; 3 : reprise confirmée) ──
create or replace function public.invest_etapes_journal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid;
  o jsonb := to_jsonb(old); n jsonb := to_jsonb(new);
  lib text := public.invest_libelle_etape(new.etape);
  v_de text; v_vers text;
  v_motif text;
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
      v_motif := case when new.commentaire is distinct from old.commentaire
                      then public.invest_derniere_ligne(new.commentaire) end;
      perform public.invest_journaliser(new.dossier_id, v_client, 'etape_statut_change',
        format('%s : %s → %s.%s', lib, public.invest_libelle_statut_etape(old.statut), public.invest_libelle_statut_etape(new.statut),
          coalesce(' Motif : ' || v_motif, '')),
        public.invest_diff(o, n, array['statut','date_debut','date_fin','commentaire'], 'avant'),
        public.invest_diff(o, n, array['statut','date_debut','date_fin','commentaire'], 'apres'), new.id);
    end if;
  end if;
  if new.balle is not null and (new.balle is distinct from old.balle
      or new.balle_utilisateur_id is distinct from old.balle_utilisateur_id
      or new.balle_tiers_libelle is distinct from old.balle_tiers_libelle) then
    select nom into v_de from public.utilisateurs where id = old.balle_utilisateur_id;
    select nom into v_vers from public.utilisateurs where id = new.balle_utilisateur_id;
    perform public.invest_journaliser(new.dossier_id, v_client, 'etape_balle_change',
      format('%s : balle %s → %s.', lib,
        case when old.balle is null then 'personne'
             else public.invest_libelle_balle(old.balle) || coalesce(' (' || coalesce(v_de, old.balle_tiers_libelle) || ')', '') end,
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
  if old.reprise_a_confirmer and not new.reprise_a_confirmer then
    perform public.invest_journaliser(new.dossier_id, v_client, 'etape_reprise_confirmee',
      format('%s : reprise confirmée (%s).', lib, public.invest_libelle_statut_etape(new.statut)),
      jsonb_build_object('reprise_a_confirmer', true),
      jsonb_build_object('reprise_a_confirmer', false, 'statut', new.statut), new.id);
  end if;
  return null;
end;
$$;

revoke execute on function public.invest_transition_etape_autorisee(text, text) from public, anon;
revoke execute on function public.invest_derniere_ligne(text) from public, anon;
revoke execute on function public.invest_etapes_regles_pilotage() from public, anon;
