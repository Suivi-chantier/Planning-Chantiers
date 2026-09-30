-- ============================================================================
-- Chantier 1.1 — Mini-correctif 2d.1 : intégrité du catalogue du questionnaire.
--
-- Une réponse nouvelle ou modifiée dont la clé n'existe pas dans le catalogue
-- de la version du questionnaire (questionnaire_version) est REFUSÉE par la
-- base (auparavant seule la forme de la clé était contrôlée).
--
-- Source unique : src/Invest/dossiers/questionnaireDossier.mjs (CLES_PAR_VERSION).
-- La fonction invest_questionnaire_cles(version) ci-dessous est GÉNÉRÉE par
-- scripts/generer-questionnaire-cles-sql.mjs ; un test exige l'identité exacte
-- (texte de la migration et ensemble des clés en base).
--
-- Seul changement de comportement : ce refus. Validation avec réponses non
-- vérifiées, updated_at du dossier : inchangés. Aucune donnée modifiée.
-- RETOUR ARRIÈRE : sql/202609_invest_questionnaire_2d1_rollback.sql
-- ============================================================================

-- GÉNÉRÉ par scripts/generer-questionnaire-cles-sql.mjs depuis questionnaireDossier.mjs — ne pas modifier à la main.
create or replace function public.invest_questionnaire_cles(p_version integer)
returns text[] language sql immutable set search_path = '' as $$
  select case p_version
    when 1 then array[
      'banque__contraintes',
      'banque__courtier',
      'banque__courtier_nom',
      'banque__financement_detail',
      'banque__financement_en_discussion',
      'banque__principale',
      'banque__refus_detail',
      'banque__refus_recents',
      'banque__relation',
      'detention__associes_envisages',
      'detention__investir',
      'detention__objectifs_successoraux',
      'detention__preferences',
      'detention__protection_conjoint',
      'detention__structures_envisagees',
      'detention__transmission',
      'fiscalite__deficit_foncier',
      'fiscalite__deficit_foncier_montant',
      'fiscalite__ifi',
      'fiscalite__ifi_montant',
      'fiscalite__impot_revenu',
      'fiscalite__particularites',
      'fiscalite__pays',
      'fiscalite__residence_foyer',
      'fiscalite__tmi',
      'foyer__clause_beneficiaire_a_revoir',
      'foyer__complement_charge',
      'foyer__contrat_mariage',
      'foyer__date_union',
      'foyer__donations_anterieures',
      'foyer__donations_detail',
      'foyer__regime_matrimonial',
      'foyer__regime_pacs',
      'foyer__separation_en_cours',
      'foyer__situation_familiale',
      'foyer__testament',
      'international__actifs_etranger',
      'international__concerne',
      'international__contrat_etranger',
      'international__date',
      'international__expatriation',
      'international__pays',
      'international__problematiques',
      'international__revenus_etrangers',
      'international__structures_etrangeres',
      'objectifs__apport_souhaite',
      'objectifs__autofinancement_minimum',
      'objectifs__budget',
      'objectifs__cashflow',
      'objectifs__effort_mensuel_max',
      'objectifs__gestion',
      'objectifs__horizon',
      'objectifs__implication',
      'objectifs__objectif_principal',
      'objectifs__objectifs_secondaires',
      'objectifs__rendement_minimum',
      'objectifs__rythme',
      'objectifs__travaux',
      'objectifs__typologies',
      'objectifs__urgence',
      'objectifs__zones',
      'pro__changement_detail',
      'pro__evolution_revenus',
      'pro__evolution_revenus_detail',
      'pro__fin_periode_essai',
      'pro__particularites',
      'pro__periode_essai',
      'pro__projet_entrepreneurial',
      'pro__projet_entrepreneurial_detail',
      'pro__stabilite'
    ]::text[]
    else null end;
$$;

revoke execute on function public.invest_questionnaire_cles(integer) from public, anon;

-- Fonction 2d reprise à l'identique, avec le seul contrôle de catalogue en plus.
create or replace function public.invest_questionnaire_avant_ecriture()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  a record;
  k text; o jsonb; n jsonb;
  res jsonb := '{}'::jsonb;
  maintenant text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  valeurs_changees boolean := false;
  statut_change boolean;
  -- 2d.1 : clés du catalogue de la version du questionnaire (générées depuis questionnaireDossier.mjs).
  v_version integer := coalesce(new.questionnaire_version, old.questionnaire_version, 1);
  v_cles text[] := public.invest_questionnaire_cles(coalesce(new.questionnaire_version, old.questionnaire_version, 1));
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
      -- 2d.1 : toute réponse nouvelle ou modifiée doit exister dans le catalogue de sa version.
      if n is not null and jsonb_typeof(n) = 'object' and (o is null or (n -> 'valeur') is distinct from (o -> 'valeur')) then
        if v_cles is null then
          raise exception 'Version de questionnaire inconnue : %.', v_version using errcode = '22023';
        end if;
        if not (k = any (v_cles)) then
          raise exception 'Question inconnue du catalogue (version %) : %.', v_version, k using errcode = '22023';
        end if;
      end if;
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
