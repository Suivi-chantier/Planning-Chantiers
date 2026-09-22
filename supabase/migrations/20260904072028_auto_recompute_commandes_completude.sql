create or replace function public.recompute_commande_completude(p_commande_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_complete boolean;
  v_statut text;
begin
  select (
    nullif(btrim(c.doc_numero), '') is not null
    and exists (
      select 1
      from public.commande_lignes l
      where l.commande_id = c.id
    )
    and not exists (
      select 1
      from public.commande_lignes l
      where l.commande_id = c.id
        and (
          nullif(btrim(l.chantier_id), '') is null
          or coalesce(l.prix_total, l.prix_unitaire) is null
        )
    )
  )
  into v_complete
  from public.commandes c
  where c.id = p_commande_id;

  if not found then
    return;
  end if;

  v_statut := case when coalesce(v_complete, false) then 'complete' else 'a_completer' end;

  update public.commandes
  set statut_completude = v_statut,
      updated_at = now()
  where id = p_commande_id
    and statut_completude is distinct from v_statut;
end;
$$;

create or replace function public.trg_recompute_commande_completude_from_lignes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_commande_completude(old.commande_id);
    return old;
  end if;

  perform public.recompute_commande_completude(new.commande_id);

  if tg_op = 'UPDATE' and old.commande_id is distinct from new.commande_id then
    perform public.recompute_commande_completude(old.commande_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_commande_lignes_recompute_completude on public.commande_lignes;
create trigger trg_commande_lignes_recompute_completude
after insert or update or delete on public.commande_lignes
for each row
execute function public.trg_recompute_commande_completude_from_lignes();

create or replace function public.trg_recompute_commande_completude_from_commande()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_commande_completude(new.id);
  return new;
end;
$$;

drop trigger if exists trg_commandes_recompute_completude on public.commandes;
create trigger trg_commandes_recompute_completude
after insert or update of doc_numero on public.commandes
for each row
execute function public.trg_recompute_commande_completude_from_commande();

-- Recalage des données existantes sur la même règle que l'application.
with calc as (
  select c.id,
         case when (
           nullif(btrim(c.doc_numero), '') is not null
           and exists (
             select 1 from public.commande_lignes l where l.commande_id = c.id
           )
           and not exists (
             select 1
             from public.commande_lignes l
             where l.commande_id = c.id
               and (
                 nullif(btrim(l.chantier_id), '') is null
                 or coalesce(l.prix_total, l.prix_unitaire) is null
               )
           )
         ) then 'complete' else 'a_completer' end as statut_calcule
  from public.commandes c
)
update public.commandes c
set statut_completude = calc.statut_calcule,
    updated_at = now()
from calc
where c.id = calc.id
  and c.statut_completude is distinct from calc.statut_calcule;
