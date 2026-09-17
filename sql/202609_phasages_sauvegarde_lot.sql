-- =====================================================================
-- PHASAGES — sauvegarde versionnée EN LOT (plusieurs phasages, une action)
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller).
-- Idempotent : create or replace function uniquement. Aucune table, aucune
-- colonne, aucune policy, aucun grant de table modifiés.
--
-- Complète sql/202609_phasages_revision_verrou_optimiste.sql, qui a posé la
-- colonne `revision`, le trigger d'incrémentation et la sauvegarde d'UN
-- phasage (conducteur_sauvegarder_phasage_v2). Cette RPC-ci ne sert qu'au cas
-- où UNE action utilisateur doit modifier PLUSIEURS phasages ensemble :
-- « marquer commandé » dans Planning commandes coche des matériaux répartis
-- sur plusieurs chantiers.
--
-- POURQUOI UN LOT PLUTÔT QU'UNE BOUCLE
-- ------------------------------------
-- Une boucle d'appels unitaires peut réussir à moitié : trois chantiers
-- marqués commandés, le quatrième refusé pour conflit. L'utilisateur n'a
-- alors aucun moyen de savoir où il en est. Ici, TOUTES les révisions sont
-- vérifiées AVANT la première écriture : si une seule est périmée, aucune
-- ligne n'est modifiée et la liste des phasages en conflit est renvoyée —
-- sans jamais exposer leur contenu.
--
-- La signature reste FERMÉE : chaque entrée du lot ne peut porter que
-- phasage_id, revision_attendue, et les deux colonnes que les écrans
-- réécrivent réellement. Pas d'objet libre permettant d'écrire n'importe
-- quelle colonne.
-- =====================================================================

create or replace function public.conducteur_sauvegarder_phasages_lot(p_lot jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
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
  -- Mêmes gardes que la sauvegarde unitaire : session réelle, profil
  -- applicatif (jointure par email), compte actif, rôle non-ouvrier — le
  -- périmètre exact de la policy bureau_all de la table. user_metadata n'est
  -- jamais consulté.
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

  -- ── Passe 1 : verrouiller et vérifier TOUTES les révisions ──────────
  -- Aucune écriture tant que cette passe n'est pas entièrement validée.
  -- Les lignes sont verrouillées dans l'ordre du lot et le restent jusqu'au
  -- commit : une écriture concurrente ne peut pas se glisser entre les deux
  -- passes.
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
      -- On note l'identifiant, jamais le contenu.
      v_conflits := v_conflits || to_jsonb(v_id);
    end if;
  end loop;

  if jsonb_array_length(v_conflits) > 0 then
    -- Tout ou rien : pas une seule ligne n'est touchée.
    return jsonb_build_object('ok', false, 'code', 'conflit', 'conflits', v_conflits);
  end if;

  -- ── Passe 2 : écrire ────────────────────────────────────────────────
  for e in select value from jsonb_array_elements(p_lot) loop
    v_id := (e->>'phasage_id')::uuid;
    update public.phasages
    set ouvrages     = coalesce(e->'ouvrages', ouvrages),
        plan_travaux = coalesce(e->'plan_travaux', plan_travaux),
        updated_at   = now()
    where id = v_id;
    -- La révision est posée par le trigger, jamais ici.
    select p.revision into v_actuelle from public.phasages p where p.id = v_id;
    v_revisions := jsonb_set(v_revisions, array[v_id::text], to_jsonb(v_actuelle));
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'code', 'enregistre',
    'phasages', v_n, 'revisions', v_revisions);
end;
$$;

revoke all on function public.conducteur_sauvegarder_phasages_lot(jsonb) from public, anon;
grant execute on function public.conducteur_sauvegarder_phasages_lot(jsonb) to authenticated;

-- =====================================================================
-- VÉRIFICATION (transaction annulée)
-- =====================================================================
-- Attendu : lot dont toutes les révisions sont à jour → enregistre + une
-- révision par phasage ; lot dont UNE SEULE révision est périmée → conflit,
-- la liste des identifiants concernés, et AUCUNE ligne modifiée.
-- =====================================================================
