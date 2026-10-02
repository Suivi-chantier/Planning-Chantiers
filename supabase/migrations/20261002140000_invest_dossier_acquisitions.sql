-- ============================================================================
-- Fiche Mission Invest — onglet Acquisition : suivi de chaque acquisition de la mission.
-- Périmètre : Profero Invest. Décision de Matthieu (02/10/2026) : suivre compromis, conditions
-- suspensives, notaire, acte, travaux, mise en location.
--
-- public.invest_dossier_acquisitions : UNE ligne par acquisition (un bien) d'une mission, 6 au plus.
--   jalons datés : offre acceptée, compromis signé, signature de l'acte prévue, acte signé, remise des clés,
--   début et fin des travaux, mise en location ; abandon (date + motif) ;
--   prix signé, budget travaux, notaire (nom, contact) ;
--   conditions_suspensives : liste (intitulé, échéance, levée) ;
--   bien_id : le bien du stock (facultatif).
-- Cohérence imposée par la base : l'acte exige un compromis ; clés, travaux et mise en location exigent l'acte ;
-- les dates se suivent dans l'ordre ; une acquisition abandonnée n'a pas d'acte.
-- Le stade (« sous compromis », « en location »…) n'est PAS stocké : il se déduit des dates.
--
-- Ce n'est PAS l'objet « Opération » de la Tranche 5 du modèle Dossier (étapes par opération, honoraires par
-- acquisition) : aucune étape du parcours n'est lue ni modifiée ici, aucun lien avec invest_dossier_etapes.operation_id.
--
-- Accès : CRM (invest_peut_voir('crm')) + restrictive « collaborateurs seulement ». Rien pour le client.
-- RETOUR ARRIÈRE : sql/202610_invest_dossier_acquisitions_rollback.sql
-- VÉRIFICATION  : node scripts/verif-invest-acquisition-mission.mjs
-- ============================================================================

create table public.invest_dossier_acquisitions (
  id                     uuid primary key default gen_random_uuid(),
  dossier_id             uuid not null references public.invest_dossiers(id) on delete cascade,
  client_id              uuid not null references public.invest_clients(id) on delete cascade,
  libelle                text not null check (length(btrim(libelle)) > 0),
  bien_id                uuid references public.invest_biens(id) on delete set null,
  prix_signe             numeric check (prix_signe >= 0),
  budget_travaux         numeric check (budget_travaux >= 0),
  notaire                text,
  notaire_contact        text,
  offre_acceptee_le      date,
  compromis_signe_le     date,
  signature_prevue_le    date,
  acte_signe_le          date,
  cles_remises_le        date,
  travaux_debut_le       date,
  travaux_fin_le         date,
  mise_location_le       date,
  abandon_le             date,
  abandon_motif          text,
  conditions_suspensives jsonb not null default '[]'::jsonb,
  commentaire            text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint invest_dossier_acquisitions_conditions check (jsonb_typeof(conditions_suspensives) = 'array' and jsonb_array_length(conditions_suspensives) <= 15),
  -- ce qui suppose un compromis, puis un acte
  constraint invest_dossier_acquisitions_acte_apres_compromis check (acte_signe_le is null or compromis_signe_le is not null),
  constraint invest_dossier_acquisitions_apres_acte check (
    (cles_remises_le is null and travaux_debut_le is null and mise_location_le is null) or acte_signe_le is not null),
  constraint invest_dossier_acquisitions_fin_travaux check (travaux_fin_le is null or travaux_debut_le is not null),
  -- les dates se suivent
  constraint invest_dossier_acquisitions_ordre check (
    (offre_acceptee_le is null or compromis_signe_le is null or compromis_signe_le >= offre_acceptee_le)
    and (compromis_signe_le is null or acte_signe_le is null or acte_signe_le >= compromis_signe_le)
    and (acte_signe_le is null or cles_remises_le is null or cles_remises_le >= acte_signe_le)
    and (acte_signe_le is null or travaux_debut_le is null or travaux_debut_le >= acte_signe_le)
    and (travaux_debut_le is null or travaux_fin_le is null or travaux_fin_le >= travaux_debut_le)
    and (acte_signe_le is null or mise_location_le is null or mise_location_le >= acte_signe_le)),
  -- abandonnée : jamais d'acte signé
  constraint invest_dossier_acquisitions_abandon check (abandon_le is null or acte_signe_le is null)
);
create index invest_dossier_acquisitions_dossier_idx on public.invest_dossier_acquisitions (dossier_id);
create index invest_dossier_acquisitions_bien_idx on public.invest_dossier_acquisitions (bien_id);

-- client_id de la mission (fonction commune créée par la migration des scénarios).
create trigger invest_dossier_acquisitions_client before insert or update of dossier_id, client_id on public.invest_dossier_acquisitions
  for each row execute function public.invest_dossier_modules_client();

-- Six acquisitions au plus par mission.
create or replace function public.invest_dossier_acquisitions_limite()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.invest_dossier_acquisitions a where a.dossier_id = new.dossier_id) >= 6 then
    raise exception 'Six acquisitions au plus par mission';
  end if;
  return new;
end;
$$;
revoke all on function public.invest_dossier_acquisitions_limite() from public, anon, authenticated;
create trigger invest_dossier_acquisitions_limite before insert on public.invest_dossier_acquisitions
  for each row execute function public.invest_dossier_acquisitions_limite();

alter table public.invest_dossier_acquisitions enable row level security;
revoke all on public.invest_dossier_acquisitions from public, anon, authenticated;
grant select, insert, update, delete on public.invest_dossier_acquisitions to authenticated;

create policy invest_dossier_acquisitions_crm on public.invest_dossier_acquisitions
  for all to authenticated
  using ((select public.invest_peut_voir('crm')))
  with check ((select public.invest_peut_voir('crm')));
-- Règle du dépôt : toute nouvelle table reçoit la restrictive 3a.
create policy profero_collaborateurs_seulement on public.invest_dossier_acquisitions
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif()))
  with check ((select public.est_collaborateur_actif()));
