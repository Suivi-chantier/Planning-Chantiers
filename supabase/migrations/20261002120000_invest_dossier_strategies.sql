-- ============================================================================
-- Fiche Mission Invest — onglet Stratégie : démonstration de la stratégie d'une mission.
-- Périmètre : Profero Invest. Décision de Matthieu (02/10/2026) : « toutes les informations nécessaires
-- à la démonstration de stratégie, cela dépendra des clients » → des BLOCS activables mission par mission.
--
-- 1. public.invest_dossier_strategies : UNE stratégie par mission (clé = la mission).
--      blocs        : quels blocs sont affichés pour ce client (objectifs, point de départ, scénarios,
--                     cadre fiscal et juridique, risques, feuille de route, recommandation) ;
--      message_cle  : la thèse en une phrase ; fiscal / risques / feuille_route : contenu des blocs ;
--      recommandation, statut brouillon / validée (exige une recommandation, fige les chiffres du moment),
--      presentee_le : date de présentation au client, posée par un geste explicite, jamais seule.
-- 2. public.invest_dossier_scenarios : 1 à 4 scénarios comparés d'une mission (hypothèses chiffrées,
--    avantages, inconvénients) ; au plus UN scénario recommandé.
-- Les indicateurs (mensualité, rendement, cash-flow, effort d'épargne) ne sont PAS stockés : ils se calculent
-- à partir des hypothèses. client_id est toujours déduit de la mission.
--
-- Accès : CRM (invest_peut_voir('crm')) + restrictive « collaborateurs seulement ». Rien pour le client.
-- RETOUR ARRIÈRE : sql/202610_invest_dossier_strategies_rollback.sql
-- VÉRIFICATION  : node scripts/verif-invest-strategie-mission.mjs
-- ============================================================================

create table public.invest_dossier_strategies (
  dossier_id       uuid primary key references public.invest_dossiers(id) on delete cascade,
  client_id        uuid not null references public.invest_clients(id) on delete cascade,
  blocs            jsonb not null default '["objectifs","point_depart","scenarios","recommandation"]'::jsonb,
  message_cle      text,
  fiscal           jsonb not null default '{}'::jsonb,
  risques          jsonb not null default '[]'::jsonb,
  feuille_route    jsonb not null default '[]'::jsonb,
  recommandation   text,
  statut           text not null default 'brouillon' check (statut in ('brouillon', 'validee')),
  valide_le        timestamptz,
  valide_par       text,
  chiffres_valides jsonb,
  presentee_le     date,
  updated_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint invest_dossier_strategies_types check (
    jsonb_typeof(blocs) = 'array' and jsonb_typeof(fiscal) = 'object' and jsonb_typeof(risques) = 'array' and jsonb_typeof(feuille_route) = 'array'),
  constraint invest_dossier_strategies_tailles check (
    jsonb_array_length(blocs) <= 7 and jsonb_array_length(risques) <= 30 and jsonb_array_length(feuille_route) <= 30),
  constraint invest_dossier_strategies_blocs_connus check (
    blocs <@ '["objectifs","point_depart","scenarios","fiscal","risques","feuille_route","recommandation"]'::jsonb),
  constraint invest_dossier_strategies_validee_complete check (
    statut <> 'validee' or (length(btrim(coalesce(recommandation, ''))) > 0 and valide_le is not null and chiffres_valides is not null)),
  constraint invest_dossier_strategies_presentee_validee check (presentee_le is null or statut = 'validee')
);
create index invest_dossier_strategies_client_idx on public.invest_dossier_strategies (client_id);

create table public.invest_dossier_scenarios (
  id           uuid primary key default gen_random_uuid(),
  dossier_id   uuid not null references public.invest_dossiers(id) on delete cascade,
  client_id    uuid not null references public.invest_clients(id) on delete cascade,
  ordre        smallint not null check (ordre between 1 and 4),
  libelle      text not null check (length(btrim(libelle)) > 0),
  description  text,
  hypotheses   jsonb not null default '{}'::jsonb check (jsonb_typeof(hypotheses) = 'object'),
  avantages    text,
  inconvenients text,
  recommande   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint invest_dossier_scenarios_ordre_unique unique (dossier_id, ordre),
  -- montants jamais négatifs ; taux 0-15 %, durée 1-30 ans, quand ils sont renseignés
  constraint invest_dossier_scenarios_montants check (
    (not hypotheses ? 'prix' or (jsonb_typeof(hypotheses -> 'prix') = 'number' and (hypotheses ->> 'prix')::numeric >= 0))
    and (not hypotheses ? 'travaux' or (jsonb_typeof(hypotheses -> 'travaux') = 'number' and (hypotheses ->> 'travaux')::numeric >= 0))
    and (not hypotheses ? 'frais' or (jsonb_typeof(hypotheses -> 'frais') = 'number' and (hypotheses ->> 'frais')::numeric >= 0))
    and (not hypotheses ? 'apport' or (jsonb_typeof(hypotheses -> 'apport') = 'number' and (hypotheses ->> 'apport')::numeric >= 0))
    and (not hypotheses ? 'loyerMensuel' or (jsonb_typeof(hypotheses -> 'loyerMensuel') = 'number' and (hypotheses ->> 'loyerMensuel')::numeric >= 0))
    and (not hypotheses ? 'chargesMensuelles' or (jsonb_typeof(hypotheses -> 'chargesMensuelles') = 'number' and (hypotheses ->> 'chargesMensuelles')::numeric >= 0))
    and (not hypotheses ? 'tauxPct' or (jsonb_typeof(hypotheses -> 'tauxPct') = 'number' and (hypotheses ->> 'tauxPct')::numeric between 0 and 15))
    and (not hypotheses ? 'dureeAns' or (jsonb_typeof(hypotheses -> 'dureeAns') = 'number' and (hypotheses ->> 'dureeAns')::numeric between 1 and 30)))
);
create index invest_dossier_scenarios_dossier_idx on public.invest_dossier_scenarios (dossier_id);
create unique index invest_dossier_scenarios_un_recommande on public.invest_dossier_scenarios (dossier_id) where recommande;

-- client_id toujours celui de la mission (une fonction pour les deux tables).
create or replace function public.invest_dossier_modules_client()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select d.client_id into new.client_id from public.invest_dossiers d where d.id = new.dossier_id;
  if new.client_id is null then raise exception 'Mission introuvable'; end if;
  return new;
end;
$$;
revoke all on function public.invest_dossier_modules_client() from public, anon, authenticated;
create trigger invest_dossier_strategies_client before insert or update of dossier_id, client_id on public.invest_dossier_strategies
  for each row execute function public.invest_dossier_modules_client();
create trigger invest_dossier_scenarios_client before insert or update of dossier_id, client_id on public.invest_dossier_scenarios
  for each row execute function public.invest_dossier_modules_client();

do $$ declare t text; begin
  foreach t in array array['invest_dossier_strategies', 'invest_dossier_scenarios'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.invest_peut_voir(''crm''))) with check ((select public.invest_peut_voir(''crm'')))', t || '_crm', t);
    -- Règle du dépôt : toute nouvelle table reçoit la restrictive 3a.
    execute format('create policy profero_collaborateurs_seulement on public.%I as restrictive for all to authenticated using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()))', t);
  end loop;
end $$;
