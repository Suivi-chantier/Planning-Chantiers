-- ============================================================================
-- Fiche Mission Invest — onglet Financement : dossier, conditions, plan de financement, banques.
-- Périmètre : Profero Invest. Décision de Matthieu (02/10/2026) : « le dossier, les conditions, le plan
-- de financement du scénario retenu, les banques ».
-- Dépend de 20261002120000 (scénarios) : le scénario retenu est l'un des scénarios de la mission.
--
-- 1. public.invest_dossier_financements : UN financement par mission (clé = la mission) :
--      scenario_id   scénario retenu (celui de la mission uniquement) ; vide = le scénario recommandé ;
--      dossier_statut / transmis_le  avancement du dossier bancaire ; « transmis » ⇔ date de transmission ;
--      conditions    conditions générales (assurance, garanties, conditions suspensives…) ;
--      autres_emplois / autres_ressources  lignes libres du plan (subvention, prêt familial, mobilier…).
-- 2. public.invest_dossier_banques : les banques consultées (12 au plus par mission) : statut, montants
--    demandé et accordé, taux, durée, assurance, frais, garantie, conditions, dates, retenue.
--    « Retenue » exige un accord de principe, une offre reçue ou acceptée ET un montant accordé.
-- Le plan de financement, les mensualités et les écarts ne sont PAS stockés : ils se calculent à partir du
-- scénario retenu et des banques retenues. client_id est toujours déduit de la mission.
--
-- Accès : CRM (invest_peut_voir('crm')) + restrictive « collaborateurs seulement ». Rien pour le client.
-- RETOUR ARRIÈRE : sql/202610_invest_dossier_financements_rollback.sql
-- VÉRIFICATION  : node scripts/verif-invest-financement-mission.mjs
-- ============================================================================

create table public.invest_dossier_financements (
  dossier_id       uuid primary key references public.invest_dossiers(id) on delete cascade,
  client_id        uuid not null references public.invest_clients(id) on delete cascade,
  scenario_id      uuid references public.invest_dossier_scenarios(id) on delete set null,
  dossier_statut   text not null default 'a_constituer' check (dossier_statut in ('a_constituer', 'en_cours', 'pret', 'transmis')),
  transmis_le      date,
  conditions       text,
  autres_emplois   jsonb not null default '[]'::jsonb,
  autres_ressources jsonb not null default '[]'::jsonb,
  notes            text,
  updated_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint invest_dossier_financements_transmis check ((dossier_statut = 'transmis') = (transmis_le is not null)),
  constraint invest_dossier_financements_lignes check (
    jsonb_typeof(autres_emplois) = 'array' and jsonb_typeof(autres_ressources) = 'array'
    and jsonb_array_length(autres_emplois) <= 15 and jsonb_array_length(autres_ressources) <= 15)
);
create index invest_dossier_financements_client_idx on public.invest_dossier_financements (client_id);

create table public.invest_dossier_banques (
  id                  uuid primary key default gen_random_uuid(),
  dossier_id          uuid not null references public.invest_dossiers(id) on delete cascade,
  client_id           uuid not null references public.invest_clients(id) on delete cascade,
  banque              text not null check (length(btrim(banque)) > 0),
  contact             text,
  statut              text not null default 'a_consulter'
                        check (statut in ('a_consulter', 'dossier_depose', 'accord_principe', 'offre_recue', 'offre_acceptee', 'refus', 'abandon')),
  montant_demande     numeric check (montant_demande >= 0),
  montant_accorde     numeric check (montant_accorde >= 0),
  taux_pct            numeric check (taux_pct between 0 and 15),
  duree_ans           numeric check (duree_ans between 1 and 30),
  assurance_mensuelle numeric check (assurance_mensuelle >= 0),
  frais_dossier       numeric check (frais_dossier >= 0),
  frais_garantie      numeric check (frais_garantie >= 0),
  garantie            text,
  conditions          text,
  demande_le          date,
  reponse_le          date,
  validite_offre_le   date,
  retenue             boolean not null default false,
  commentaire         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint invest_dossier_banques_retenue_possible check (
    not retenue or (statut in ('accord_principe', 'offre_recue', 'offre_acceptee') and montant_accorde is not null)),
  constraint invest_dossier_banques_dates check (demande_le is null or reponse_le is null or reponse_le >= demande_le)
);
create index invest_dossier_banques_dossier_idx on public.invest_dossier_banques (dossier_id);

-- client_id de la mission (fonction commune créée par la migration des scénarios).
create trigger invest_dossier_financements_client before insert or update of dossier_id, client_id on public.invest_dossier_financements
  for each row execute function public.invest_dossier_modules_client();
create trigger invest_dossier_banques_client before insert or update of dossier_id, client_id on public.invest_dossier_banques
  for each row execute function public.invest_dossier_modules_client();

-- Le scénario retenu appartient à la mission ; 12 banques au plus par mission.
create or replace function public.invest_dossier_financements_controle()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.scenario_id is not null and not exists (select 1 from public.invest_dossier_scenarios s where s.id = new.scenario_id and s.dossier_id = new.dossier_id) then
    raise exception 'Le scénario retenu doit être un scénario de cette mission';
  end if;
  return new;
end;
$$;
revoke all on function public.invest_dossier_financements_controle() from public, anon, authenticated;
create trigger invest_dossier_financements_controle before insert or update of scenario_id, dossier_id on public.invest_dossier_financements
  for each row execute function public.invest_dossier_financements_controle();

create or replace function public.invest_dossier_banques_limite()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.invest_dossier_banques b where b.dossier_id = new.dossier_id) >= 12 then
    raise exception 'Douze banques au plus par mission';
  end if;
  return new;
end;
$$;
revoke all on function public.invest_dossier_banques_limite() from public, anon, authenticated;
create trigger invest_dossier_banques_limite before insert on public.invest_dossier_banques
  for each row execute function public.invest_dossier_banques_limite();

do $$ declare t text; begin
  foreach t in array array['invest_dossier_financements', 'invest_dossier_banques'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.invest_peut_voir(''crm''))) with check ((select public.invest_peut_voir(''crm'')))', t || '_crm', t);
    -- Règle du dépôt : toute nouvelle table reçoit la restrictive 3a.
    execute format('create policy profero_collaborateurs_seulement on public.%I as restrictive for all to authenticated using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()))', t);
  end loop;
end $$;
