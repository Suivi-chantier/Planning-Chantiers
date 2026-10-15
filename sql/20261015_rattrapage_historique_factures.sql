-- Rattrapage strictement manuel : aucun traitement de masse automatique.
create or replace function public.diagnostiquer_rattrapage_facture(p_facture_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.factures%rowtype; n integer; n_reg integer; n_ecarts integer; n_frais integer; motif text:=null;
begin
 if auth.uid() is null or not public.est_collaborateur_actif() or public.est_ouvrier() then raise exception 'Acces refuse'; end if;
 select * into f from public.factures where id=p_facture_id;
 if not found then raise exception 'Facture introuvable'; end if;
 select count(*) into n_reg from public.facture_couts_chantiers where facture_id=f.id;
 select count(*) into n from public.facture_bl where facture_id=f.id;
 select count(*) into n_ecarts from public.facture_bl where facture_id=f.id and coalesce(ecart_ht,0)<>0;
 select count(*) into n_frais from public.facture_frais where facture_id=f.id;
 if f.type_document='avoir' then motif:='avoir_hors_rattrapage';
 elsif f.statut<>'rapprochee' then motif:='facture_non_validee';
 elsif n_reg>0 then motif:='ecritures_deja_presentes';
 elsif n=0 then motif:='aucun_bon_lie';
 elsif exists(select 1 from public.facture_bl b where b.facture_id=f.id and b.commande_id is null)
 then motif:='bon_non_rattache';
 elsif exists(select 1 from public.facture_bl b join public.commandes c on c.id=b.commande_id
    where b.facture_id=f.id and c.facture_id is distinct from f.id)
 then motif:='commande_non_facturee_sur_ce_document';
 elsif exists(select 1 from public.facture_bl b where b.facture_id=f.id and coalesce(ecart_ht,0)<>0
   and (b.resolution is distinct from 'accepte' and
    (b.statut<>'rapproche' or abs(b.ecart_ht)>coalesce((select tolerance_ht from public.fournisseurs where id=f.fournisseur_id),0.05))))
 then motif:='ecart_non_resolu';
 elsif exists(select 1 from public.facture_bl b where b.facture_id=f.id and coalesce(ecart_ht,0)<>0
    and not exists(select 1 from public.commande_lignes l where l.commande_id=b.commande_id
       and l.chantier_id is not null and coalesce(l.prix_total,l.prix_unitaire*l.quantite,0)>0))
 then motif:='achat_sans_ventilation';
 elsif exists(select 1 from public.facture_frais fr where fr.facture_id=f.id and fr.chantier_id is null)
 then motif:='frais_non_affectes';
 elsif n_ecarts=0 and n_frais=0 then motif:='aucun_cout_a_rattraper';
 end if;
 return jsonb_build_object('facture_id',f.id,'eligible',motif is null,
   'motif',motif,'ecritures_existantes',n_reg,'ecarts',n_ecarts,'frais',n_frais);
end $$;
revoke all on function public.diagnostiquer_rattrapage_facture(uuid) from public,anon;
grant execute on function public.diagnostiquer_rattrapage_facture(uuid) to authenticated;

create or replace function public.rattraper_couts_facture(p_facture_id uuid,p_confirmation text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d jsonb; n integer;
begin
 if auth.uid() is null or not public.est_collaborateur_actif() or public.est_ouvrier() then raise exception 'Acces refuse'; end if;
 if p_confirmation is distinct from 'CONFIRMER RATTRAPAGE' then raise exception 'Confirmation explicite requise'; end if;
 perform 1 from public.factures where id=p_facture_id for update;
 d:=public.diagnostiquer_rattrapage_facture(p_facture_id);
 if not (d->>'eligible')::boolean then raise exception 'Rattrapage refuse : %',d->>'motif'; end if;
 n:=public.comptabiliser_couts_facture(p_facture_id);
 return jsonb_build_object('facture_id',p_facture_id,'ecritures_creees',n,'statut','rattrape');
end $$;
revoke all on function public.rattraper_couts_facture(uuid,text) from public,anon;
grant execute on function public.rattraper_couts_facture(uuid,text) to authenticated;
