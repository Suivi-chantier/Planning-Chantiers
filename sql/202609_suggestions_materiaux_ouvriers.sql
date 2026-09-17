-- =====================================================================
-- SUGGESTIONS DE MATÉRIAUX PAR LES OUVRIERS — tranche 1 : envoi et lecture
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller).
-- Idempotent : create table if not exists + create or replace function.
--
-- Un ouvrier, depuis la préparation du chantier, signale un matériau qui
-- manque sur un ouvrage. La suggestion part en `en_attente` et N'A AUCUN
-- EFFET automatique : elle ne touche ni phasages.ouvrages[].materiaux_liens,
-- ni materiaux_bibliotheque, ni cout_materiaux, ni aucune commande. Le
-- traitement par le conducteur viendra dans une tranche suivante.
--
-- ⚠ AUCUN CHAMP DE PRIX NI DE COÛT dans cette table, et aucune des RPC ne
--   renvoie prix_unitaire, lien_fournisseur, notes ou stock_min.
--
-- MODÈLE D'AUTORISATION
-- ---------------------
-- La table n'est JAMAIS touchée par le navigateur : RLS active, aucune
-- policy, et les GRANT que Supabase pose automatiquement sur toute table
-- neuve sont révoqués. Tout passe par trois RPC SECURITY DEFINER, chacune
-- avec search_path figé, garde d'appelant explicite et droits d'exécution
-- posés à la main (PUBLIC révoqué d'abord).
--
-- La garde vérifie, dans cet ordre : une session réelle (auth.uid()), un
-- profil applicatif existant (public.utilisateurs, joint par email — la
-- colonne id de cette table n'est PAS l'uuid auth, vérifié : 0/18), le
-- compte actif, puis le rôle attendu. user_metadata n'est jamais consulté :
-- c'est une donnée modifiable par l'utilisateur, pas une autorisation.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Table
-- ---------------------------------------------------------------------
create table if not exists public.suggestions_materiaux_ouvriers (
  id                 uuid primary key default gen_random_uuid(),
  chantier_id        text        not null,
  phasage_id         uuid        not null references public.phasages(id) on delete cascade,
  ouvrage_id         text        not null,
  -- Soit un matériau de la bibliothèque, soit une désignation libre.
  materiau_id        uuid        references public.materiaux_bibliotheque(id) on delete restrict,
  designation_libre  text,
  unite              text        not null,
  quantite_totale    numeric     not null,
  precision_ouvrier  text,
  statut             text        not null default 'en_attente',
  propose_par        uuid        not null references public.utilisateurs(id),
  cree_le            timestamptz not null default now(),
  -- Traitement futur : nullable tant que la suggestion est en attente.
  traite_par         uuid        references public.utilisateurs(id),
  traite_le          timestamptz,
  motif_refus        text,

  -- L'un OU l'autre, jamais les deux, jamais aucun. Une désignation vide ou
  -- faite d'espaces ne vaut pas une désignation.
  constraint sugg_source_exclusive check (
    (materiau_id is not null and designation_libre is null)
    or (materiau_id is null and designation_libre is not null and btrim(designation_libre) <> '')
  ),
  -- Strictement positive ET finie : en numeric, 'NaN' échoue toute
  -- comparaison (donc rejeté) et 'Infinity' est écarté par la borne haute.
  constraint sugg_quantite_positive check (quantite_totale > 0 and quantite_totale <= 1000000000),
  constraint sugg_unite_non_vide     check (btrim(unite) <> ''),
  constraint sugg_statut_connu       check (statut in ('en_attente', 'acceptee', 'refusee')),
  constraint sugg_precision_bornee   check (precision_ouvrier is null or length(precision_ouvrier) <= 500)
);

comment on table public.suggestions_materiaux_ouvriers is
  'Matériaux signalés manquants par les ouvriers depuis la préparation de chantier. Aucun effet automatique sur le phasage, la bibliothèque ou les commandes. Accès uniquement par RPC.';

-- Pas deux fois la même demande en attente, par le même auteur, sur le même
-- ouvrage. Index partiels : une suggestion traitée ne bloque plus rien.
create unique index if not exists sugg_doublon_materiau
  on public.suggestions_materiaux_ouvriers (phasage_id, ouvrage_id, propose_par, materiau_id)
  where statut = 'en_attente' and materiau_id is not null;

create unique index if not exists sugg_doublon_libre
  on public.suggestions_materiaux_ouvriers (phasage_id, ouvrage_id, propose_par, lower(btrim(designation_libre)))
  where statut = 'en_attente' and designation_libre is not null;

create index if not exists sugg_par_phasage
  on public.suggestions_materiaux_ouvriers (phasage_id, ouvrage_id)
  where statut = 'en_attente';

-- ---------------------------------------------------------------------
-- 2) Verrouillage de la table
-- ---------------------------------------------------------------------
-- RLS active SANS AUCUNE POLICY : personne ne passe en direct. Les RPC,
-- SECURITY DEFINER, traversent. Les GRANT automatiques de Supabase sur une
-- table neuve sont retirés — sans quoi la table serait jointe à la Data API
-- dès sa création.
alter table public.suggestions_materiaux_ouvriers enable row level security;
revoke all on table public.suggestions_materiaux_ouvriers from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- 3) RPC — recherche dans la bibliothèque
-- ---------------------------------------------------------------------
-- materiaux_bibliotheque est bureau-only depuis le 17/09/2026. Cette RPC est
-- le guichet du terrain : cinq colonnes, jamais le prix ni le lien
-- fournisseur, jamais les notes internes.
create or replace function public.ouvrier_rechercher_materiaux(p_recherche text)
returns table (id uuid, nom text, reference text, unite text, fournisseur text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actif boolean;
  v_q     text;
begin
  -- Session réelle + profil applicatif ACTIF. Ouvriers et bureau : la
  -- recherche sert aussi à l'aperçu administrateur.
  if auth.uid() is null or auth.email() is null then return; end if;
  select u.actif into v_actif
  from public.utilisateurs u where u.email = auth.email() limit 1;
  if v_actif is distinct from true then return; end if;

  v_q := btrim(coalesce(p_recherche, ''));
  if length(v_q) < 2 then return; end if;

  return query
  select m.id, m.nom, m.reference, m.unite, m.fournisseur
  from public.materiaux_bibliotheque m
  where m.nom ilike '%' || v_q || '%'
     or m.reference ilike '%' || v_q || '%'
  order by m.nom, m.id   -- ordre déterministe
  limit 8;
end;
$$;

revoke all on function public.ouvrier_rechercher_materiaux(text) from public, anon;
grant execute on function public.ouvrier_rechercher_materiaux(text) to authenticated;

-- ---------------------------------------------------------------------
-- 4) RPC — création d'une suggestion
-- ---------------------------------------------------------------------
-- Rien de ce que le navigateur envoie n'est cru sur parole : le phasage est
-- résolu ici, l'appartenance de l'ouvrage est vérifiée ici, l'unité d'un
-- matériau de bibliothèque est relue ici, et l'auteur, la date et le statut
-- sont imposés ici. Le client ne peut fournir ni propose_par, ni cree_le,
-- ni statut : ces paramètres n'existent pas.
-- Renvoie null si l'appelant n'a pas le droit d'écrire ; sinon un objet
-- { ok, code } que l'interface traduit en message lisible.
create or replace function public.ouvrier_suggerer_materiau(
  p_chantier_id       text,
  p_ouvrage_id        text,
  p_materiau_id       uuid    default null,
  p_designation_libre text    default null,
  p_unite             text    default null,
  p_quantite_totale   numeric default null,
  p_precision         text    default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_auteur   uuid;
  v_role     text;
  v_actif    boolean;
  v_phasage  uuid;
  v_ouvrages jsonb;
  v_unite    text;
  v_design   text;
  v_precis   text;
  v_id       uuid;
begin
  -- ── Garde d'appelant ────────────────────────────────────────────────
  if auth.uid() is null or auth.email() is null then return null; end if;
  select u.id, u.role, u.actif into v_auteur, v_role, v_actif
  from public.utilisateurs u where u.email = auth.email() limit 1;
  if v_auteur is null or v_actif is distinct from true then return null; end if;
  -- ÉCRITURE réservée au terrain : le bureau lit et cherche, mais n'envoie
  -- pas de suggestion (l'aperçu administrateur ne doit rien produire).
  if v_role is distinct from 'ouvrier' then return null; end if;

  -- ── Quantité ────────────────────────────────────────────────────────
  if p_quantite_totale is null
     or p_quantite_totale <> p_quantite_totale          -- NaN
     or p_quantite_totale <= 0
     or p_quantite_totale > 1000000000 then             -- Infinity / démesure
    return jsonb_build_object('ok', false, 'code', 'quantite_invalide');
  end if;

  -- ── Chantier → phasage, puis appartenance de l'ouvrage ──────────────
  select p.id, p.ouvrages into v_phasage, v_ouvrages
  from public.phasages p where p.chantier_id = p_chantier_id limit 1;
  if v_phasage is null then
    return jsonb_build_object('ok', false, 'code', 'phasage_introuvable');
  end if;

  if coalesce(trim(p_ouvrage_id), '') = ''
     or not exists (
       select 1 from jsonb_array_elements(
         case when jsonb_typeof(v_ouvrages) = 'array' then v_ouvrages else '[]'::jsonb end
       ) o where o.value->>'id' = p_ouvrage_id
     ) then
    return jsonb_build_object('ok', false, 'code', 'ouvrage_inconnu');
  end if;

  -- ── Source : bibliothèque OU texte libre, exactement une ────────────
  v_design := nullif(btrim(coalesce(p_designation_libre, '')), '');
  if (p_materiau_id is not null and v_design is not null)
     or (p_materiau_id is null and v_design is null) then
    return jsonb_build_object('ok', false, 'code', 'source_invalide');
  end if;

  if p_materiau_id is not null then
    -- L'unité vient de la bibliothèque, jamais du navigateur.
    select m.unite into v_unite
    from public.materiaux_bibliotheque m where m.id = p_materiau_id;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'materiau_inconnu');
    end if;
    v_unite := coalesce(nullif(btrim(coalesce(v_unite, '')), ''), 'U');
  else
    -- Saisie libre : l'unité est obligatoire, c'est la seule source.
    v_unite := nullif(btrim(coalesce(p_unite, '')), '');
    if v_unite is null then
      return jsonb_build_object('ok', false, 'code', 'unite_requise');
    end if;
  end if;

  -- ── Doublon encore en attente, même auteur, même ouvrage ────────────
  if exists (
    select 1 from public.suggestions_materiaux_ouvriers s
    where s.statut = 'en_attente'
      and s.phasage_id = v_phasage
      and s.ouvrage_id = p_ouvrage_id
      and s.propose_par = v_auteur
      and ( (p_materiau_id is not null and s.materiau_id = p_materiau_id)
         or (v_design is not null and lower(btrim(s.designation_libre)) = lower(v_design)) )
  ) then
    return jsonb_build_object('ok', false, 'code', 'doublon');
  end if;

  v_precis := nullif(btrim(coalesce(p_precision, '')), '');
  if v_precis is not null then v_precis := left(v_precis, 500); end if;

  insert into public.suggestions_materiaux_ouvriers
    (chantier_id, phasage_id, ouvrage_id, materiau_id, designation_libre,
     unite, quantite_totale, precision_ouvrier, statut, propose_par, cree_le)
  values
    (p_chantier_id, v_phasage, p_ouvrage_id, p_materiau_id, v_design,
     v_unite, p_quantite_totale, v_precis, 'en_attente', v_auteur, now())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'code', 'envoyee');
exception
  when unique_violation then
    -- Filet si deux envois se croisent : l'index partiel tranche.
    return jsonb_build_object('ok', false, 'code', 'doublon');
end;
$$;

revoke all on function public.ouvrier_suggerer_materiau(text, text, uuid, text, text, numeric, text) from public, anon;
grant execute on function public.ouvrier_suggerer_materiau(text, text, uuid, text, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5) RPC — lecture des suggestions en attente d'un chantier
-- ---------------------------------------------------------------------
-- Tous les ouvriers actifs voient les suggestions EN ATTENTE des ouvrages de
-- ce chantier : c'est ce qui évite deux demandes pour le même manque.
-- L'auteur n'est jamais renvoyé — ni nom, ni email, ni identifiant : la
-- suggestion est un signalement d'équipe, pas un dossier nominatif.
create or replace function public.ouvrier_suggestions_chantier(p_chantier_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actif   boolean;
  v_phasage uuid;
  v_out     jsonb;
begin
  if auth.uid() is null or auth.email() is null then return null; end if;
  select u.actif into v_actif
  from public.utilisateurs u where u.email = auth.email() limit 1;
  if v_actif is distinct from true then return null; end if;

  select p.id into v_phasage
  from public.phasages p where p.chantier_id = p_chantier_id limit 1;
  if v_phasage is null then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',          s.id,
      'ouvrage_id',  s.ouvrage_id,
      'designation', coalesce(m.nom, s.designation_libre),
      'reference',   m.reference,
      'quantite_totale', s.quantite_totale,
      'unite',       s.unite,
      'precision',   s.precision_ouvrier,
      'statut',      s.statut,
      'cree_le',     s.cree_le
    ) order by s.cree_le desc, s.id
  ), '[]'::jsonb)
  into v_out
  from public.suggestions_materiaux_ouvriers s
  left join public.materiaux_bibliotheque m on m.id = s.materiau_id
  where s.phasage_id = v_phasage        -- jamais un autre chantier
    and s.statut = 'en_attente';

  return v_out;
end;
$$;

revoke all on function public.ouvrier_suggestions_chantier(text) from public, anon;
grant execute on function public.ouvrier_suggestions_chantier(text) to authenticated;
