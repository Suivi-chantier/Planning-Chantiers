-- Retour arrière de supabase/migrations/20261024130000_journal_avancement.sql
-- (étape 1C, journal d'avancement daté). Restaure les deux fonctions
-- d'enregistrement du phasage dans leur version d'avant (relue en production
-- le 24/10/2026), retire le déclencheur, les fonctions et les tables du journal.
-- ⚠ Supprime le contenu du journal : l'exporter avant si on veut le garder.

drop trigger if exists trg_avancement_journal on public.phasages;
drop function if exists public.trg_avancement_journal();

drop function if exists public.conducteur_sauvegarder_phasage_v2(uuid, bigint, jsonb, jsonb, jsonb);
create or replace function public.conducteur_sauvegarder_phasage_v2(
  p_phasage_id uuid, p_revision_attendue bigint, p_ouvrages jsonb default null::jsonb, p_plan_travaux jsonb default null::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role     text;
  v_actif    boolean;
  v_revision bigint;
begin
  if auth.uid() is null or auth.email() is null then return null; end if;
  select u.role, u.actif into v_role, v_actif
  from public.utilisateurs u where u.email = auth.email() limit 1;
  if v_role is null or v_actif is distinct from true then return null; end if;
  if v_role = 'ouvrier' then return null; end if;

  if p_phasage_id is null or p_revision_attendue is null then
    return jsonb_build_object('ok', false, 'code', 'parametres_invalides');
  end if;
  if p_ouvrages is null and p_plan_travaux is null then
    return jsonb_build_object('ok', false, 'code', 'rien_a_ecrire');
  end if;

  select p.revision into v_revision
  from public.phasages p where p.id = p_phasage_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'phasage_introuvable');
  end if;

  if v_revision is distinct from p_revision_attendue then
    return jsonb_build_object('ok', false, 'code', 'conflit', 'revision', v_revision);
  end if;

  update public.phasages
  set ouvrages     = coalesce(p_ouvrages, ouvrages),
      plan_travaux = coalesce(p_plan_travaux, plan_travaux),
      updated_at   = now()
  where id = p_phasage_id;

  select p.revision into v_revision from public.phasages p where p.id = p_phasage_id;
  return jsonb_build_object('ok', true, 'code', 'enregistre', 'revision', v_revision);
end;
$function$;
revoke all on function public.conducteur_sauvegarder_phasage_v2(uuid, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.conducteur_sauvegarder_phasage_v2(uuid, bigint, jsonb, jsonb) to authenticated;

-- La version « lot » d'origine ne lisait pas la clé « journal » : APRÈS ce
-- fichier, relancer tel quel sql/202609_phasages_sauvegarde_lot.sql (même
-- signature, create or replace : les droits sont conservés).

drop function if exists public.avancement_journal_reconstituer(boolean);
drop function if exists public.avancement_journal_reconstitution_lignes(timestamptz);
drop function if exists public.avancement_journal_reconcilier();
drop function if exists public.avancement_journal_initialiser();
drop function if exists public.avancement_journal_enregistrer(uuid, text, jsonb, jsonb, jsonb);
drop function if exists public._uuid_sur(text);
drop function if exists public._date_sure(text);
drop function if exists public._avancement_valeur(jsonb);
drop table if exists public.avancement_journal_controles;
drop table if exists public.avancement_journal;
