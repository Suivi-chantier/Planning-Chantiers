-- Avoirs fournisseurs : écritures négatives indépendantes des achats initiaux.
create table if not exists public.avoirs_fournisseurs_imputations (
 id uuid primary key default gen_random_uuid(),
 facture_id uuid not null references public.factures(id) on delete restrict,
 chantier_id text not null,
 montant_ht numeric(14,2) not null check (montant_ht < 0),
 justification text not null check (length(btrim(justification)) >= 12),
 date_imputation date not null,
 created_at timestamptz not null default now(),
 created_by uuid not null default auth.uid(),
 unique(facture_id,chantier_id)
);
create index if not exists avoirs_fournisseurs_imputations_chantier_idx
 on public.avoirs_fournisseurs_imputations(chantier_id,date_imputation);
alter table public.avoirs_fournisseurs_imputations enable row level security;
revoke all on public.avoirs_fournisseurs_imputations from public,anon,authenticated;
grant select on public.avoirs_fournisseurs_imputations to authenticated;
create policy avoirs_imputations_lecture on public.avoirs_fournisseurs_imputations
 for select to authenticated using (public.est_collaborateur_actif());

create or replace function public.imputer_avoir_fournisseur(
 p_facture_id uuid,p_chantier_id text,p_montant_ht numeric,p_justification text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.factures%rowtype; v_total numeric;
begin
 if auth.uid() is null or not public.est_collaborateur_actif() or public.est_ouvrier() then raise exception 'Acces refuse'; end if;
 if nullif(btrim(p_chantier_id),'') is null then raise exception 'Chantier obligatoire'; end if;
 if length(btrim(coalesce(p_justification,''))) < 12 then raise exception 'Justification obligatoire'; end if;
 if p_montant_ht is null or p_montant_ht>=0 or round(p_montant_ht,2)<>p_montant_ht then
   raise exception 'Montant HT negatif au centime obligatoire';
 end if;
 select * into f from public.factures where id=p_facture_id for update;
 if not found or f.type_document is distinct from 'avoir' or f.statut<>'a_rapprocher'
   then raise exception 'Document non admissible comme avoir'; end if;
 if f.montant_ht is null or f.montant_ht>=0 then raise exception 'Avoir sans montant HT negatif'; end if;
 if f.facture_origine_id is not null and not exists(
   select 1 from public.factures origine where origine.id=f.facture_origine_id
     and origine.fournisseur_id is not distinct from f.fournisseur_id
     and origine.type_document is distinct from 'avoir'
 ) then raise exception 'Facture origine invalide'; end if;
 -- Un chantier doit être relié à la facture d'origine, lorsqu'elle est renseignée.
 if f.facture_origine_id is not null and not exists(
   select 1 from public.facture_bl b join public.commande_lignes l on l.commande_id=b.commande_id
   where b.facture_id=f.facture_origine_id and l.chantier_id=p_chantier_id
 ) and not exists(
   select 1 from public.facture_frais fr where fr.facture_id=f.facture_origine_id and fr.chantier_id=p_chantier_id
 ) then raise exception 'Chantier non rattache a la facture origine'; end if;
 if exists(select 1 from public.avoirs_fournisseurs_imputations
   where facture_id=f.id and chantier_id=p_chantier_id) then raise exception 'Chantier deja impute'; end if;
 select coalesce(sum(montant_ht),0)+p_montant_ht into v_total
 from public.avoirs_fournisseurs_imputations where facture_id=f.id;
 if v_total < f.montant_ht then raise exception 'Ventilation superieure au total de l avoir'; end if;
 insert into public.avoirs_fournisseurs_imputations
 (facture_id,chantier_id,montant_ht,justification,date_imputation)
 values(f.id,p_chantier_id,p_montant_ht,btrim(p_justification),coalesce(f.date_facture,current_date));
 return jsonb_build_object('total_impute_ht',v_total,'reste_a_imputer_ht',f.montant_ht-v_total);
end $$;
revoke all on function public.imputer_avoir_fournisseur(uuid,text,numeric,text) from public,anon;
grant execute on function public.imputer_avoir_fournisseur(uuid,text,numeric,text) to authenticated;

create or replace function public.cloturer_avoir_fournisseur(p_facture_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.factures%rowtype; total numeric;
begin
 if auth.uid() is null or not public.est_collaborateur_actif() or public.est_ouvrier() then raise exception 'Acces refuse'; end if;
 select * into f from public.factures where id=p_facture_id for update;
 if not found or f.type_document is distinct from 'avoir' or f.statut='archivee'
 then raise exception 'Avoir introuvable ou archive'; end if;
 select coalesce(sum(montant_ht),0) into total from public.avoirs_fournisseurs_imputations where facture_id=f.id;
 if f.montant_ht is null or total<>f.montant_ht then raise exception 'Ventilation de l avoir incomplete'; end if;
 update public.factures set statut='rapprochee',statut_rapprochement='conforme' where id=f.id;
 return jsonb_build_object('statut','conforme','total_impute_ht',total);
end $$;
revoke all on function public.cloturer_avoir_fournisseur(uuid) from public,anon;
grant execute on function public.cloturer_avoir_fournisseur(uuid) to authenticated;
