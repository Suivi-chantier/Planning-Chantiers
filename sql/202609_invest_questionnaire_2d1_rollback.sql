-- ============================================================================
-- RETOUR ARRIÈRE de supabase/migrations/20260930235500_invest_questionnaire_2d1_catalogue.sql
-- Non destructif : la fonction d'écriture retrouve son texte exact de la 2d
-- (contrôle de forme seulement) ; la liste des clés est retirée.
-- ============================================================================

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

drop function if exists public.invest_questionnaire_cles(integer);
