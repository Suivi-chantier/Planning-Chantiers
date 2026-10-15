create or replace function public.contester_ecart_facture_bl(p_ligne_id uuid,p_justification text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_ligne public.facture_bl%rowtype; v_facture public.factures%rowtype;
begin
 if not public.est_collaborateur_actif() then raise exception 'Acces refuse'; end if;
 if length(btrim(coalesce(p_justification,'')))<12 then raise exception 'Motif du litige obligatoire (12 caracteres minimum)'; end if;
 select * into v_ligne from public.facture_bl where id=p_ligne_id for update;
 if not found then raise exception 'Ligne introuvable'; end if;
 select * into v_facture from public.factures where id=v_ligne.facture_id for update;
 if v_facture.statut <> 'a_rapprocher' then raise exception 'Facture deja finalisee'; end if;
 update public.facture_bl set resolution='conteste',justification=btrim(p_justification) where id=p_ligne_id;
 update public.factures set statut_rapprochement='en_litige' where id=v_facture.id;
 return jsonb_build_object('statut','conteste','ligne_id',p_ligne_id);
end $$;
revoke all on function public.contester_ecart_facture_bl(uuid,text) from public,anon;
grant execute on function public.contester_ecart_facture_bl(uuid,text) to authenticated;
