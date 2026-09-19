-- =====================================================================
-- PHASAGES — verrouillage optimiste : colonne `revision` + sauvegarde RPC
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller).
-- Idempotent : add column if not exists, create or replace function,
-- drop trigger if exists puis create.
--
-- LE RISQUE CORRIGÉ
-- -----------------
-- PhasageV2 réécrivait la colonne `ouvrages` ENTIÈRE, sans condition, depuis
-- son état React. Séquence démontrée :
--   1. un conducteur ouvre l'éditeur et charge les ouvrages ;
--   2. ailleurs, une suggestion de matériau est acceptée — la RPC ajoute le
--      matériau en base ;
--   3. le conducteur modifie une tâche dans son éditeur resté ouvert ;
--   4. son auto-save réécrit tout le tableau depuis l'état d'avant l'ajout ;
--   5. le matériau accepté DISPARAÎT, sans message.
-- La seule garde existante (confirmPerteMassive) ne se déclenche qu'en cas de
-- perte de plus de la moitié des OUVRAGES : ajouter ou retirer un matériau ne
-- change pas leur nombre, elle ne voyait donc rien.
--
-- POURQUOI PAS updated_at
-- -----------------------
-- Vérifié dans le dépôt : `updated_at` est posé À LA MAIN par certains
-- appelants (PhasageV2) et PAS DU TOUT par d'autres — PagePlanningCommandes
-- et Validation écrivent `ouvrages` ou `plan_travaux` sans y toucher. Un
-- horodatage qui ne bouge pas à chaque écriture ne peut pas servir de numéro
-- de version : une écriture concurrente passerait inaperçue. Il faut une
-- valeur incrémentée par la BASE, pour toute mise à jour, sans exception.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) La colonne de version
-- ---------------------------------------------------------------------
-- bigint, jamais nulle, à 0 pour les lignes existantes : aucune donnée
-- métier n'est touchée, seule une colonne technique s'ajoute.
alter table public.phasages
  add column if not exists revision bigint not null default 0;

comment on column public.phasages.revision is
  'Numéro de version incrémenté par la base à CHAQUE update (trigger trg_phasages_revision). Sert au verrouillage optimiste de l''éditeur de phasage. Jamais choisi par le client.';

-- ---------------------------------------------------------------------
-- 2) Le trigger : la révision n'appartient qu'à la base
-- ---------------------------------------------------------------------
-- INCONDITIONNEL, contrairement au trigger d'historique voisin qui ne se
-- déclenche que si ouvrages ou plan_travaux changent : ici toute mise à jour
-- de la ligne doit faire avancer la version, sinon deux écritures
-- successives pourraient partager le même numéro.
--
-- Le client ne peut ni choisir ni baisser la révision : quelle que soit la
-- valeur envoyée, elle est écrasée par old.revision + 1.
create or replace function public.phasages_incrementer_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.revision := coalesce(old.revision, 0) + 1;
  return new;
end;
$$;

drop trigger if exists trg_phasages_revision on public.phasages;
create trigger trg_phasages_revision
  before update on public.phasages
  for each row
  execute function public.phasages_incrementer_revision();

-- ---------------------------------------------------------------------
-- 3) La sauvegarde versionnée de l'éditeur
-- ---------------------------------------------------------------------
-- Signature FERMÉE : seuls les deux champs que PhasageV2 enregistre
-- réellement sont acceptés. Pas d'objet libre permettant d'écrire n'importe
-- quelle colonne. Un paramètre à NULL = « ne touche pas à cette colonne ».
--
-- Garde d'appelant, dans l'ordre : session réelle (auth.uid()), profil dans
-- public.utilisateurs (jointure par EMAIL — utilisateurs.id n'est pas l'uuid
-- auth), compte actif, puis rôle autorisé. Le périmètre retenu est
-- exactement celui de la policy de la table (`not est_ouvrier()`) : aucun
-- rôle bureau ne perd l'accès qu'il avait. user_metadata n'est jamais
-- consulté.
--
-- SECURITY DEFINER est nécessaire : la fonction doit verrouiller la ligne et
-- lire la révision avant d'écrire, de façon atomique, sans dépendre de la
-- RLS de l'appelant au milieu de la séquence. Elle ne renvoie jamais le
-- contenu du phasage — seulement ok / code / revision.
create or replace function public.conducteur_sauvegarder_phasage_v2(
  p_phasage_id        uuid,
  p_revision_attendue bigint,
  p_ouvrages          jsonb default null,
  p_plan_travaux      jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_role     text;
  v_actif    boolean;
  v_revision bigint;
begin
  if auth.uid() is null or auth.email() is null then return null; end if;
  select u.role, u.actif into v_role, v_actif
  from public.utilisateurs u where u.email = auth.email() limit 1;
  if v_role is null or v_actif is distinct from true then return null; end if;
  -- Même périmètre que la policy bureau_all de la table.
  if v_role = 'ouvrier' then return null; end if;

  if p_phasage_id is null or p_revision_attendue is null then
    return jsonb_build_object('ok', false, 'code', 'parametres_invalides');
  end if;
  -- Rien à écrire : on refuse plutôt que de faire avancer la révision pour rien.
  if p_ouvrages is null and p_plan_travaux is null then
    return jsonb_build_object('ok', false, 'code', 'rien_a_ecrire');
  end if;

  -- Verrou : une écriture concurrente attend son tour, elle ne peut pas se
  -- glisser entre la lecture de la révision et la mise à jour.
  select p.revision into v_revision
  from public.phasages p where p.id = p_phasage_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'phasage_introuvable');
  end if;

  -- Le cœur du mécanisme : si la ligne a bougé depuis le chargement de
  -- l'éditeur, on n'écrit RIEN et on renvoie la version réelle. Pas de
  -- fusion, pas d'écrasement, pas de « forcer ».
  if v_revision is distinct from p_revision_attendue then
    return jsonb_build_object('ok', false, 'code', 'conflit', 'revision', v_revision);
  end if;

  update public.phasages
  set ouvrages     = coalesce(p_ouvrages, ouvrages),
      plan_travaux = coalesce(p_plan_travaux, plan_travaux),
      updated_at   = now()
  where id = p_phasage_id;
  -- La révision est posée par le trigger, jamais ici.

  select p.revision into v_revision from public.phasages p where p.id = p_phasage_id;
  return jsonb_build_object('ok', true, 'code', 'enregistre', 'revision', v_revision);
end;
$$;

revoke all on function public.conducteur_sauvegarder_phasage_v2(uuid, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.conducteur_sauvegarder_phasage_v2(uuid, bigint, jsonb, jsonb) to authenticated;

-- =====================================================================
-- VÉRIFICATION (transaction annulée)
-- =====================================================================
-- Attendu : sauvegarde à la révision courante → enregistre + révision + 1 ;
-- sauvegarde à une révision périmée → conflit, et AUCUNE écriture ;
-- toute écriture externe (suggestion acceptée, Validation, commandes)
-- incrémente aussi la révision et invalide donc un éditeur périmé.
-- =====================================================================
