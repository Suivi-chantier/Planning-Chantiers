-- Compatibilite BilanSemaine : l'ecran lit encore chantier_avancement_history.
-- La source de verite hebdomadaire est desormais chantier_snapshots_hebdo.

create or replace function public.sync_avancement_history_from_weekly_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.avancement is null then
    return new;
  end if;

  insert into public.chantier_avancement_history (
    chantier_id,
    chantier_nom,
    phasage_id,
    avancement,
    taches_terminees,
    taches_total,
    date_snapshot
  ) values (
    new.chantier_id,
    new.chantier_nom,
    new.phasage_id,
    round(new.avancement)::integer,
    0,
    0,
    new.date_snapshot
  )
  on conflict (chantier_id, date_snapshot)
  do update set
    chantier_nom = excluded.chantier_nom,
    phasage_id = excluded.phasage_id,
    avancement = excluded.avancement;

  return new;
end;
$$;

drop trigger if exists trg_sync_avancement_history_from_weekly_snapshot
  on public.chantier_snapshots_hebdo;

create trigger trg_sync_avancement_history_from_weekly_snapshot
after insert or update of avancement, chantier_nom, phasage_id, date_snapshot
on public.chantier_snapshots_hebdo
for each row
execute function public.sync_avancement_history_from_weekly_snapshot();

-- Rattrapage de l'historique deja present dans le nouveau systeme.
insert into public.chantier_avancement_history (
  chantier_id,
  chantier_nom,
  phasage_id,
  avancement,
  taches_terminees,
  taches_total,
  date_snapshot
)
select
  s.chantier_id,
  s.chantier_nom,
  s.phasage_id,
  round(s.avancement)::integer,
  0,
  0,
  s.date_snapshot
from public.chantier_snapshots_hebdo s
where s.avancement is not null
on conflict (chantier_id, date_snapshot)
do update set
  chantier_nom = excluded.chantier_nom,
  phasage_id = excluded.phasage_id,
  avancement = excluded.avancement;
