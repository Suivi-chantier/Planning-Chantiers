-- ============================================================================
-- Fiche Mission Invest — onglet Analyse : lecture de l'analyste et hypothèses d'une mission.
-- Périmètre : Profero Invest. Chantier « construire les modules de la fiche Mission » (02/10/2026).
--
-- public.invest_dossier_analyses : UNE analyse par mission (clé = la mission).
--   - hypotheses : taux, durée, taux d'endettement maximal utilisés pour la capacité d'investissement
--     indicative (bornes contrôlées ici ET dans l'écran) ;
--   - points forts, points de vigilance, conclusion de l'analyste ;
--   - statut brouillon / validée. Valider exige une conclusion et fige les chiffres du moment
--     (chiffres_valides) : si la situation du foyer change ensuite, l'écran le signale.
-- Les chiffres eux-mêmes ne sont PAS stockés : ils se calculent à partir de la Situation patrimoniale
-- et du Projet de la mission (une seule source). L'étape « Analyse » du parcours n'est pas modifiée ici.
--
-- Accès : CRM (invest_peut_voir('crm')) + restrictive « collaborateurs seulement ». Rien pour le client.
-- RETOUR ARRIÈRE : sql/202610_invest_dossier_analyses_rollback.sql
-- VÉRIFICATION  : node scripts/verif-invest-analyse-mission.mjs
-- ============================================================================

create table public.invest_dossier_analyses (
  dossier_id       uuid primary key references public.invest_dossiers(id) on delete cascade,
  client_id        uuid not null references public.invest_clients(id) on delete cascade,
  hypotheses       jsonb not null default '{}'::jsonb check (jsonb_typeof(hypotheses) = 'object'),
  points_forts     text,
  points_vigilance text,
  conclusion       text,
  statut           text not null default 'brouillon' check (statut in ('brouillon', 'validee')),
  valide_le        timestamptz,
  valide_par       text,
  chiffres_valides jsonb,
  updated_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint invest_dossier_analyses_validee_complete check (
    statut <> 'validee' or (length(btrim(coalesce(conclusion, ''))) > 0 and valide_le is not null and chiffres_valides is not null)),
  constraint invest_dossier_analyses_bornes check (
    (not hypotheses ? 'tauxPct' or (jsonb_typeof(hypotheses -> 'tauxPct') = 'number' and (hypotheses ->> 'tauxPct')::numeric between 0 and 15))
    and (not hypotheses ? 'dureeAns' or (jsonb_typeof(hypotheses -> 'dureeAns') = 'number' and (hypotheses ->> 'dureeAns')::numeric between 5 and 30))
    and (not hypotheses ? 'endettementMaxPct' or (jsonb_typeof(hypotheses -> 'endettementMaxPct') = 'number' and (hypotheses ->> 'endettementMaxPct')::numeric between 10 and 50)))
);
create index invest_dossier_analyses_client_idx on public.invest_dossier_analyses (client_id);

-- client_id toujours celui de la mission.
create or replace function public.invest_dossier_analyses_client()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select d.client_id into new.client_id from public.invest_dossiers d where d.id = new.dossier_id;
  if new.client_id is null then raise exception 'Mission introuvable'; end if;
  return new;
end;
$$;
revoke all on function public.invest_dossier_analyses_client() from public, anon, authenticated;
create trigger invest_dossier_analyses_client
  before insert or update of dossier_id, client_id on public.invest_dossier_analyses
  for each row execute function public.invest_dossier_analyses_client();

alter table public.invest_dossier_analyses enable row level security;
revoke all on public.invest_dossier_analyses from public, anon, authenticated;
grant select, insert, update, delete on public.invest_dossier_analyses to authenticated;

create policy invest_dossier_analyses_crm on public.invest_dossier_analyses
  for all to authenticated
  using ((select public.invest_peut_voir('crm')))
  with check ((select public.invest_peut_voir('crm')));
-- Règle du dépôt : toute nouvelle table reçoit la restrictive 3a.
create policy profero_collaborateurs_seulement on public.invest_dossier_analyses
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif()))
  with check ((select public.est_collaborateur_actif()));
