create or replace function public.valider_rapprochement_facture(p_facture_id uuid)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare f public.factures%rowtype; n integer;
begin
 if not public.est_collaborateur_actif() then raise exception 'Acces refuse'; end if;
 select * into f from public.factures where id=p_facture_id for update;
 if not found then raise exception 'Facture introuvable'; end if;
 if f.statut='rapprochee' then return jsonb_build_object('statut','deja_validee'); end if;
 if f.statut='archivee' then raise exception 'Facture archivee'; end if;
 if not exists(select 1 from public.facture_bl where facture_id=f.id) then raise exception 'Aucun BL'; end if;
 if exists(
   select 1 from public.facture_bl b left join public.commandes c on c.id=b.commande_id
   where b.facture_id=f.id and (c.id is null or c.fournisseur_id is distinct from f.fournisseur_id
     or c.statut_facturation <> 'en_attente_facture' or c.facture_id is not null
     or b.statut <> 'rapproche' or b.mode_rapprochement is distinct from 'numero'
     or b.montant_ht is null or b.montant_commande_ht is null
     or abs(b.montant_ht-b.montant_commande_ht)>coalesce((select tolerance_ht from public.fournisseurs where id=f.fournisseur_id),0.05))
 ) then raise exception 'Liaisons non conformes ou ambiguës'; end if;
 if exists(select 1 from public.facture_bl where facture_id=f.id group by commande_id having count(*)>1)
 or exists(select 1 from public.facture_bl b join public.facture_bl o on o.commande_id=b.commande_id and o.facture_id<>b.facture_id where b.facture_id=f.id)
 then raise exception 'Document utilise plusieurs fois'; end if;
 if f.montant_ht is null or abs(f.montant_ht
   -coalesce((select sum(montant_ht) from public.facture_bl where facture_id=f.id),0)
   -coalesce((select sum(montant_ht) from public.facture_frais where facture_id=f.id),0))
   >coalesce((select tolerance_ht from public.fournisseurs where id=f.fournisseur_id),0.05)
 then raise exception 'Total HT incoherent'; end if;
 update public.commandes set statut_facturation='facture',facture_id=f.id
 where id in(select commande_id from public.facture_bl where facture_id=f.id);
 get diagnostics n = row_count;
 update public.factures set statut='rapprochee',statut_rapprochement='conforme' where id=f.id;
 return jsonb_build_object('statut','conforme','documents',n);
end $$;
revoke all on function public.valider_rapprochement_facture(uuid) from public,anon;
grant execute on function public.valider_rapprochement_facture(uuid) to authenticated;