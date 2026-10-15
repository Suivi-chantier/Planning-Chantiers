-- Registre des corrections de facturation, sans modification des achats d'origine.
create table if not exists public.facture_couts_chantiers (
 id uuid primary key default gen_random_uuid(),
 facture_id uuid not null references public.factures(id) on delete restrict,
 facture_bl_id uuid references public.facture_bl(id) on delete restrict,
 facture_frais_id uuid references public.facture_frais(id) on delete restrict,
 chantier_id text not null,
 montant_ht numeric(14,2) not null,
 nature text not null check (nature in ('ecart','frais')),
 date_imputation date not null,
 created_at timestamptz not null default now(),
 constraint facture_couts_source_unique check ((facture_bl_id is not null)::int + (facture_frais_id is not null)::int = 1),
 unique(facture_bl_id,chantier_id),unique(facture_frais_id,chantier_id)
);
create index if not exists facture_couts_chantier_date_idx on public.facture_couts_chantiers(chantier_id,date_imputation);
alter table public.facture_couts_chantiers enable row level security;
revoke all on public.facture_couts_chantiers from anon,public,authenticated;
grant select on public.facture_couts_chantiers to authenticated;
create policy facture_couts_lecture on public.facture_couts_chantiers for select to authenticated using (public.est_collaborateur_actif());
-- Les coûts ne peuvent être écrits que par la validation transactionnelle.
create or replace function public.comptabiliser_couts_facture(p_facture_id uuid)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare f public.factures%rowtype; b record; frais record; ligne record; total numeric; restant numeric; part numeric; idx integer; nb integer:=0;
begin
 if auth.uid() is null or not public.est_collaborateur_actif() then raise exception 'Acces refuse'; end if;
 select * into f from public.factures where id=p_facture_id for update;
 if not found or f.statut<>'rapprochee' then raise exception 'Facture non validee'; end if;
 if exists(select 1 from public.facture_couts_chantiers where facture_id=f.id) then return 0; end if;
 for b in select * from public.facture_bl where facture_id=f.id and coalesce(ecart_ht,0)<>0 loop
   if b.commande_id is null or (b.resolution is distinct from 'accepte' and
     (b.statut<>'rapproche' or abs(b.ecart_ht)>coalesce((select tolerance_ht from public.fournisseurs where id=f.fournisseur_id),0.05)))
     then raise exception 'Ecart non accepte'; end if;
   select coalesce(sum(coalesce(prix_total,prix_unitaire*quantite,0)),0) into total
   from public.commande_lignes where commande_id=b.commande_id and chantier_id is not null;
   if total<=0 then raise exception 'Achat sans repartition chantier valide'; end if;
   restant:=round(b.ecart_ht,2); idx:=0;
   for ligne in
     select chantier_id,sum(coalesce(prix_total,prix_unitaire*quantite,0)) as montant
     from public.commande_lignes where commande_id=b.commande_id and chantier_id is not null
     group by chantier_id order by chantier_id
   loop
     idx:=idx+1;
     select count(distinct chantier_id) into nb from public.commande_lignes where commande_id=b.commande_id and chantier_id is not null;
     part:=case when idx=nb then restant else round(b.ecart_ht*ligne.montant/total,2) end;
     restant:=restant-part;
     insert into public.facture_couts_chantiers(facture_id,facture_bl_id,chantier_id,montant_ht,nature,date_imputation)
     values(f.id,b.id,ligne.chantier_id,part,'ecart',coalesce(f.date_facture,current_date));
   end loop;
 end loop;
 for frais in select * from public.facture_frais where facture_id=f.id loop
   if frais.chantier_id is null then raise exception 'Frais sans chantier'; end if;
   insert into public.facture_couts_chantiers(facture_id,facture_frais_id,chantier_id,montant_ht,nature,date_imputation)
   values(f.id,frais.id,frais.chantier_id,round(frais.montant_ht,2),'frais',coalesce(f.date_facture,current_date));
 end loop;
 return (select count(*) from public.facture_couts_chantiers where facture_id=f.id);
end $$;
revoke all on function public.comptabiliser_couts_facture(uuid) from public,anon;
grant execute on function public.comptabiliser_couts_facture(uuid) to authenticated;
-- Le contrôle d'état et le verrou de la facture empêchent une comptabilisation anticipée.
