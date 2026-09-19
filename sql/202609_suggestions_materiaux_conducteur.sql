-- =====================================================================
-- SUGGESTIONS DE MATÉRIAUX — côté conducteur : lister, accepter, refuser
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller).
-- Idempotent : create or replace function uniquement. Aucune table créée,
-- aucune colonne ajoutée, aucune policy touchée.
--
-- Suite de sql/202609_suggestions_materiaux_ouvriers.sql (tranche ouvrier).
-- La table suggestions_materiaux_ouvriers reste INACCESSIBLE en direct :
-- RLS active sans aucune policy, aucun GRANT client. Tout passe par RPC.
--
-- ⚠ AUCUNE DONNÉE FINANCIÈRE ne sort de ces fonctions : ni prix_unitaire,
--   ni cout_materiaux, ni prix_ht, ni marge, ni coefficient, ni notes
--   internes, ni le contenu complet du phasage.
--
-- OÙ VIVENT RÉELLEMENT LES OUVRAGES
-- ---------------------------------
-- Dans la COLONNE phasages.ouvrages (jsonb, tableau), pas dans
-- plan_travaux.meta. Les liens matériaux sont ouvrages[].materiaux_liens,
-- de forme { materiau_id, quantite, commande_le? } où `quantite` est la
-- quantité POUR UNE UNITÉ D'OUVRAGE. C'est exactement le format écrit par
-- PhasageV2 et par son éditeur de matériaux : aucune seconde structure
-- n'est introduite ici.
--
-- CONCURRENCE AVEC L'AUTO-SAVE DE PhasageV2 — limite connue
-- ---------------------------------------------------------
-- PhasageV2 réécrit le TABLEAU ENTIER ouvrages à chaque modification
-- (scheduleSave, débounce 800 ms), depuis son état React. Sa seule garde
-- (confirmPerteMassive) ne se déclenche qu'en cas de perte de plus de la
-- moitié des OUVRAGES : ajouter un matériau ne change pas leur nombre, elle
-- ne protège donc rien ici.
--   • Dans le sens RPC → éditeur : la ligne phasages est verrouillée par
--     `select ... for update` pendant tout le traitement, et l'écriture est
--     un read-modify-write sur l'état LE PLUS RÉCENT. Un auto-save
--     concurrent attend son tour, il ne peut pas se glisser au milieu.
--   • Dans le sens éditeur → RPC : si un conducteur a PhasageV2 OUVERT sur
--     ce chantier et qu'il modifie quoi que ce soit APRÈS l'acceptation,
--     son prochain auto-save réécrit le tableau depuis un état chargé avant,
--     et le matériau accepté disparaît SILENCIEUSEMENT.
--     Cette seconde direction ne peut pas être fermée ici : il faudrait
--     changer la persistance de PhasageV2 (écriture conditionnée à
--     updated_at, ou fusion par identifiant), ce qui dépasse cette tranche.
--     Le garde-fou posé ici est une détection de version : l'écriture est
--     conditionnée à l'updated_at relu sous verrou, et renvoie `conflit`
--     plutôt que d'écraser si la ligne a bougé entre-temps.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Lecture — liste des suggestions pour le bureau
-- ---------------------------------------------------------------------
-- Garde, dans l'ordre : session réelle (auth.uid()), profil dans
-- public.utilisateurs (jointure par EMAIL — utilisateurs.id n'est pas
-- l'uuid auth), compte actif, puis rôle bureau autorisé. user_metadata
-- n'est jamais consulté : c'est une donnée que l'utilisateur peut modifier.
-- Un profil absent, inactif ou non autorisé reçoit NULL, comme les autres
-- RPC du projet.
create or replace function public.conducteur_lister_suggestions_materiaux(
  p_chantier_id text default null,
  p_statut      text default 'en_attente'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role   text;
  v_actif  boolean;
  v_statut text;
  v_out    jsonb;
begin
  if auth.uid() is null or auth.email() is null then return null; end if;
  select u.role, u.actif into v_role, v_actif
  from public.utilisateurs u where u.email = auth.email() limit 1;
  if v_role is null or v_actif is distinct from true then return null; end if;
  if v_role not in ('admin', 'conducteur') then return null; end if;

  v_statut := nullif(btrim(coalesce(p_statut, '')), '');
  if v_statut is not null and v_statut not in ('en_attente', 'acceptee', 'refusee') then
    v_statut := 'en_attente';
  end if;

  select coalesce(jsonb_agg(x.ligne order by x.tri_statut, x.cree_le, x.id), '[]'::jsonb)
  into v_out
  from (
    select
      s.id,
      s.cree_le,
      -- « en attente » d'abord, puis du plus ancien au plus récent.
      case when s.statut = 'en_attente' then 0 else 1 end as tri_statut,
      jsonb_build_object(
        'id',          s.id,
        'statut',      s.statut,
        'cree_le',     s.cree_le,
        'chantier_id', s.chantier_id,
        'chantier_nom', coalesce(ch.nom, ph.chantier_nom),
        'phasage_id',  s.phasage_id,
        'ouvrage', jsonb_build_object(
          'id',       s.ouvrage_id,
          'code',     ouv.value->>'code_ouvrage',
          'libelle',  ouv.value->>'libelle',
          'quantite', case when (ouv.value->>'quantite') ~ '^-?[0-9]+([.,][0-9]+)?$'
                           then replace(ouv.value->>'quantite', ',', '.')::numeric else null end,
          'unite',    nullif(btrim(coalesce(ouv.value->>'unite', '')), ''),
          -- Liens matériaux DÉJÀ prévus sur cet ouvrage, réduits à
          -- l'identifiant et à la quantité par unité : c'est ce qui permet à
          -- l'écran de validation de dire « ce matériau est déjà prévu, à
          -- telle quantité » sans jamais renvoyer le phasage entier ni le
          -- moindre prix.
          'materiaux_liens', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'materiau_id', ml.value->>'materiau_id',
                     'quantite',    case when (ml.value->>'quantite') ~ '^-?[0-9]+([.,][0-9]+)?$'
                                         then replace(ml.value->>'quantite', ',', '.')::numeric else null end)
                   order by ml.ordinality)
            from jsonb_array_elements(
              case when jsonb_typeof(ouv.value->'materiaux_liens') = 'array'
                   then ouv.value->'materiaux_liens' else '[]'::jsonb end
            ) with ordinality ml(value, ordinality)
          ), '[]'::jsonb)
        ),
        'auteur', jsonb_build_object(
          'id',  s.propose_par,
          'nom', coalesce(nullif(btrim(coalesce(au.prenom_planning, '')), ''), au.nom)
        ),
        'materiau', case when s.materiau_id is null then null else jsonb_build_object(
          'id',          mb.id,
          'nom',         mb.nom,
          'reference',   mb.reference,
          'unite',       mb.unite,
          'fournisseur', mb.fournisseur
        ) end,
        'designation_libre', s.designation_libre,
        'unite',             s.unite,
        'quantite_totale',   s.quantite_totale,
        'precision',         s.precision_ouvrier,
        'traitement', case when s.statut = 'en_attente' then null else jsonb_build_object(
          'le',          s.traite_le,
          'par',         coalesce(nullif(btrim(coalesce(tr.prenom_planning, '')), ''), tr.nom),
          'motif_refus', s.motif_refus
        ) end
      ) as ligne
    from public.suggestions_materiaux_ouvriers s
    left join public.phasages ph on ph.id = s.phasage_id
    left join lateral (
      select o.value
      from jsonb_array_elements(
        case when jsonb_typeof(ph.ouvrages) = 'array' then ph.ouvrages else '[]'::jsonb end
      ) o
      where o.value->>'id' = s.ouvrage_id
      limit 1
    ) ouv on true
    left join lateral (
      select c.value->>'nom' as nom
      from public.planning_config pc
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(pc.value) = 'array' then pc.value else '[]'::jsonb end
      ) c(value)
      where pc.key = 'chantiers' and c.value->>'id' = s.chantier_id
      limit 1
    ) ch on true
    left join public.materiaux_bibliotheque mb on mb.id = s.materiau_id
    left join public.utilisateurs au on au.id = s.propose_par
    left join public.utilisateurs tr on tr.id = s.traite_par
    where (v_statut is null or s.statut = v_statut)
      -- Filtre chantier appliqué CÔTÉ SERVEUR, jamais laissé au client.
      and (p_chantier_id is null or s.chantier_id = p_chantier_id)
  ) x;

  return v_out;
end;
$$;

revoke all on function public.conducteur_lister_suggestions_materiaux(text, text) from public, anon;
grant execute on function public.conducteur_lister_suggestions_materiaux(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2) Acceptation — atomique
-- ---------------------------------------------------------------------
-- Une seule transaction : soit le phasage ET la suggestion changent, soit
-- rien. Une exception à n'importe quelle étape annule tout.
-- p_action_existant : 'ajouter' | 'remplacer' | 'nouveau' | null.
--   'nouveau' et null ne valent QUE si le matériau n'est pas déjà lié ;
--   sinon la RPC renvoie `action_requise` et n'écrit rien. C'est le
--   contrôle refait sur l'état le plus récent, pas sur ce que le
--   navigateur croyait savoir.
create or replace function public.conducteur_accepter_suggestion_materiau(
  p_suggestion_id      uuid,
  p_materiau_id        uuid,
  p_quantite_par_unite numeric,
  p_action_existant    text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_bureau     uuid;
  v_role       text;
  v_actif      boolean;
  s            record;
  v_ouvrages   jsonb;
  v_maj        timestamptz;
  v_ouvrage    jsonb;
  v_liens      jsonb;
  v_existant   numeric;
  v_deja       boolean;
  v_action     text;
  v_finale     numeric;
  v_liens_next jsonb;
  v_ouv_next   jsonb;
  v_touche     int;
begin
  if auth.uid() is null or auth.email() is null then return null; end if;
  select u.id, u.role, u.actif into v_bureau, v_role, v_actif
  from public.utilisateurs u where u.email = auth.email() limit 1;
  if v_bureau is null or v_actif is distinct from true then return null; end if;
  if v_role not in ('admin', 'conducteur') then return null; end if;

  -- Verrou sur la suggestion : deux conducteurs ne peuvent pas la traiter
  -- en même temps.
  select * into s
  from public.suggestions_materiaux_ouvriers
  where id = p_suggestion_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'suggestion_inconnue'); end if;
  if s.statut <> 'en_attente' then return jsonb_build_object('ok', false, 'code', 'deja_traitee'); end if;

  if p_quantite_par_unite is null
     or p_quantite_par_unite <> p_quantite_par_unite          -- NaN
     or p_quantite_par_unite <= 0
     or p_quantite_par_unite > 1000000000 then                -- Infinity / démesure
    return jsonb_build_object('ok', false, 'code', 'quantite_invalide');
  end if;

  if p_materiau_id is null
     or not exists (select 1 from public.materiaux_bibliotheque m where m.id = p_materiau_id) then
    return jsonb_build_object('ok', false, 'code', 'materiau_inconnu');
  end if;

  -- Verrou sur le phasage + relecture de l'état LE PLUS RÉCENT.
  select p.ouvrages, p.updated_at into v_ouvrages, v_maj
  from public.phasages p where p.id = s.phasage_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'phasage_introuvable'); end if;
  if jsonb_typeof(v_ouvrages) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'phasage_introuvable');
  end if;

  select o.value into v_ouvrage
  from jsonb_array_elements(v_ouvrages) o
  where o.value->>'id' = s.ouvrage_id
  limit 1;
  if v_ouvrage is null then return jsonb_build_object('ok', false, 'code', 'ouvrage_introuvable'); end if;

  v_liens := case when jsonb_typeof(v_ouvrage->'materiaux_liens') = 'array'
                  then v_ouvrage->'materiaux_liens' else '[]'::jsonb end;

  select case when (ml.value->>'quantite') ~ '^-?[0-9]+([.,][0-9]+)?$'
              then replace(ml.value->>'quantite', ',', '.')::numeric else null end
  into v_existant
  from jsonb_array_elements(v_liens) ml
  where ml.value->>'materiau_id' = p_materiau_id::text
  limit 1;
  v_deja := exists (
    select 1 from jsonb_array_elements(v_liens) ml
    where ml.value->>'materiau_id' = p_materiau_id::text);

  v_action := nullif(btrim(lower(coalesce(p_action_existant, ''))), '');

  if v_deja then
    -- Le matériau est déjà prévu : le conducteur DOIT avoir tranché. Aucune
    -- valeur par défaut, aucun doublon créé en silence.
    if v_action not in ('ajouter', 'remplacer') or v_action is null then
      return jsonb_build_object('ok', false, 'code', 'action_requise',
        'quantite_existante', v_existant);
    end if;
    v_finale := case when v_action = 'ajouter'
                     then coalesce(v_existant, 0) + p_quantite_par_unite
                     else p_quantite_par_unite end;
    if v_finale <= 0 or v_finale > 1000000000 then
      return jsonb_build_object('ok', false, 'code', 'quantite_invalide');
    end if;
    -- jsonb_set sur l'objet EXISTANT : commande_le et tout champ inconnu
    -- sont conservés tels quels.
    select coalesce(jsonb_agg(
      case when ml.value->>'materiau_id' = p_materiau_id::text
           then jsonb_set(ml.value, '{quantite}', to_jsonb(v_finale))
           else ml.value end
      order by ml.ordinality), '[]'::jsonb)
    into v_liens_next
    from jsonb_array_elements(v_liens) with ordinality ml(value, ordinality);
  else
    v_finale := p_quantite_par_unite;
    -- Ligne neuve : jamais de commande_le, rien n'a été commandé.
    v_liens_next := v_liens || jsonb_build_array(
      jsonb_build_object('materiau_id', p_materiau_id::text, 'quantite', v_finale));
  end if;

  -- Reconstruction du tableau : SEUL l'ouvrage visé change, et seulement sa
  -- clé materiaux_liens. Ordre d'origine conservé, tâches et autres champs
  -- intacts.
  select jsonb_agg(
    case when o.value->>'id' = s.ouvrage_id
         then jsonb_set(o.value, '{materiaux_liens}', v_liens_next, true)
         else o.value end
    order by o.ordinality)
  into v_ouv_next
  from jsonb_array_elements(v_ouvrages) with ordinality o(value, ordinality);

  -- Détection de version : si la ligne a bougé depuis la relecture sous
  -- verrou, on refuse plutôt que d'écraser.
  update public.phasages
  set ouvrages = v_ouv_next, updated_at = now()
  where id = s.phasage_id and updated_at is not distinct from v_maj;
  get diagnostics v_touche = row_count;
  if v_touche <> 1 then return jsonb_build_object('ok', false, 'code', 'conflit'); end if;

  update public.suggestions_materiaux_ouvriers
  set statut = 'acceptee', traite_par = v_bureau, traite_le = now(), motif_refus = null
  where id = s.id;

  return jsonb_build_object('ok', true, 'code', 'acceptee', 'quantite_finale', v_finale);
end;
$$;

revoke all on function public.conducteur_accepter_suggestion_materiau(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.conducteur_accepter_suggestion_materiau(uuid, uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Refus — ne touche jamais le phasage ni la bibliothèque
-- ---------------------------------------------------------------------
create or replace function public.conducteur_refuser_suggestion_materiau(
  p_suggestion_id uuid,
  p_motif         text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_bureau uuid;
  v_role   text;
  v_actif  boolean;
  v_motif  text;
  v_statut text;
begin
  if auth.uid() is null or auth.email() is null then return null; end if;
  select u.id, u.role, u.actif into v_bureau, v_role, v_actif
  from public.utilisateurs u where u.email = auth.email() limit 1;
  if v_bureau is null or v_actif is distinct from true then return null; end if;
  if v_role not in ('admin', 'conducteur') then return null; end if;

  v_motif := nullif(btrim(coalesce(p_motif, '')), '');
  if v_motif is null then return jsonb_build_object('ok', false, 'code', 'motif_requis'); end if;
  v_motif := left(v_motif, 500);

  select statut into v_statut
  from public.suggestions_materiaux_ouvriers
  where id = p_suggestion_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'suggestion_inconnue'); end if;
  if v_statut <> 'en_attente' then return jsonb_build_object('ok', false, 'code', 'deja_traitee'); end if;

  update public.suggestions_materiaux_ouvriers
  set statut = 'refusee', traite_par = v_bureau, traite_le = now(), motif_refus = v_motif
  where id = p_suggestion_id;

  return jsonb_build_object('ok', true, 'code', 'refusee');
end;
$$;

revoke all on function public.conducteur_refuser_suggestion_materiau(uuid, text) from public, anon;
grant execute on function public.conducteur_refuser_suggestion_materiau(uuid, text) to authenticated;
