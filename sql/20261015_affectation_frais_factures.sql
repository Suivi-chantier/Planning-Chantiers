create or replace function public.affecter_frais_facture(p_frais_id uuid, p_chantier_id text, p_justification text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_facture public.factures%rowtype; v_frais public.facture_frais%rowtype;
begin
 if not public.est_collaborateur_actif() then raise exception 'Acces refuse'; end if;
 if nullif(btrim(coalesce(p_chantier_id,'')),'') is null then raise exception 'Chantier obligatoire'; end if;
 if length(btrim(coalesce(p_justification,'')))<12 then raise exception 'Justification obligatoire (12 caracteres minimum)'; end if;
 select * into v_frais from public.facture_frais where id=p_frais_id for update;
 if not found then raise exception 'Frais introuvables'; end if;
 select * into v_facture from public.factures where id=v_frais.facture_id for update;
 if v_facture.statut <> 'a_rapprocher' then raise exception 'Facture deja finalisee'; end if;
 if not exists (
   select 1 from public.facture_bl b join public.commande_lignes l on l.commande_id=b.commande_id
   where b.facture_id=v_facture.id and l.chantier_id=p_chantier_id
 ) then raise exception 'Chantier absent des achats rattaches a cette facture'; end if;
 update public.facture_frais set chantier_id=p_chantier_id, justification=btrim(p_justification) where id=p_frais_id;
 return jsonb_build_object('statut','affecte','chantier_id',p_chantier_id);
end $$;
revoke all on function public.affecter_frais_facture(uuid,text,text) from public,anon;
grant execute on function public.affecter_frais_facture(uuid,text,text) to authenticated;
