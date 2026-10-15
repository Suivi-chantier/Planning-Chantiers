create or replace function public.creer_avoir_fournisseur(
 p_fournisseur_id uuid,p_numero text,p_date date,p_montant_ht numeric,p_facture_origine_id uuid default null
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare fournisseur public.fournisseurs%rowtype; origine public.factures%rowtype; nouveau uuid;
begin
 if auth.uid() is null or not public.est_collaborateur_actif() then raise exception 'Acces refuse'; end if;
 if nullif(btrim(p_numero),'') is null then raise exception 'Numero obligatoire'; end if;
 if p_date is null then raise exception 'Date obligatoire'; end if;
 if p_montant_ht is null or p_montant_ht>=0 or round(p_montant_ht,2)<>p_montant_ht then
   raise exception 'Montant HT negatif au centime obligatoire'; end if;
 select * into fournisseur from public.fournisseurs where id=p_fournisseur_id;
 if not found then raise exception 'Fournisseur inconnu'; end if;
 if exists(select 1 from public.factures where fournisseur_id=p_fournisseur_id and lower(btrim(numero))=lower(btrim(p_numero)))
 then raise exception 'Document deja existant chez ce fournisseur'; end if;
 if p_facture_origine_id is not null then
   select * into origine from public.factures where id=p_facture_origine_id;
   if not found or origine.fournisseur_id is distinct from p_fournisseur_id or origine.type_document='avoir'
   then raise exception 'Facture origine incompatible'; end if;
 end if;
 insert into public.factures(fournisseur_id,fournisseur_nom,numero,date_facture,montant_ht,
   type_document,facture_origine_id,statut,statut_rapprochement)
 values(p_fournisseur_id,fournisseur.nom,btrim(p_numero),p_date,p_montant_ht,
   'avoir',p_facture_origine_id,'a_rapprocher','a_rapprocher')
 returning id into nouveau;
 return nouveau;
end $$;
revoke all on function public.creer_avoir_fournisseur(uuid,text,date,numeric,uuid) from public,anon;
grant execute on function public.creer_avoir_fournisseur(uuid,text,date,numeric,uuid) to authenticated;
