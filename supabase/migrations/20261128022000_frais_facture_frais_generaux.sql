-- Frais de facture : imputation « frais généraux » (décision de François, 28/11/2026).
--   Frais liés au compte ou à la facture (ex. « Frais facturation » Partedis)
--   → frais généraux : comptés dans le total de la facture, sur AUCUN chantier.
--   Frais causés par une livraison (port…) → chantier, comme avant.
--
-- 1. facture_frais.imputation : 'chantier' (défaut, comportement existant) | 'frais_generaux'.
-- 2. affecter_frais_generaux(frais, justification) : nouvelle fonction (pas SECURITY DEFINER,
--    mêmes contrôles qu'affecter_frais_facture).
-- 3. affecter_frais_facture : repasse l'imputation à 'chantier' (sinon inchangée).
-- 4. valider_rapprochement_facture : un frais en frais généraux n'a pas besoin de chantier
--    (justification toujours obligatoire). Le reste est inchangé.
-- 5. comptabiliser_couts_facture (SECURITY DEFINER, inchangée sauf la boucle des frais) :
--    n'écrit de coût chantier que pour les frais imputés 'chantier'. Aucune écriture dans
--    invest_dossier_etapes : hors du périmètre de l'audit Dossier Invest.

alter table public.facture_frais
  add column imputation text not null default 'chantier'
  check (imputation in ('chantier', 'frais_generaux'));

create or replace function public.affecter_frais_generaux(p_frais_id uuid, p_justification text)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare v_facture public.factures%rowtype; v_frais public.facture_frais%rowtype;
begin
 if not public.est_collaborateur_actif() then raise exception 'Acces refuse'; end if;
 if length(btrim(coalesce(p_justification,'')))<12 then raise exception 'Justification obligatoire (12 caracteres minimum)'; end if;
 select * into v_frais from public.facture_frais where id=p_frais_id for update;
 if not found then raise exception 'Frais introuvables'; end if;
 select * into v_facture from public.factures where id=v_frais.facture_id for update;
 if v_facture.statut <> 'a_rapprocher' then raise exception 'Facture deja finalisee'; end if;
 update public.facture_frais set imputation='frais_generaux', chantier_id=null, justification=btrim(p_justification) where id=p_frais_id;
 return jsonb_build_object('statut','frais_generaux');
end $function$;

create or replace function public.affecter_frais_facture(p_frais_id uuid, p_chantier_id text, p_justification text)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
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
 update public.facture_frais set imputation='chantier', chantier_id=p_chantier_id, justification=btrim(p_justification) where id=p_frais_id;
 return jsonb_build_object('statut','affecte','chantier_id',p_chantier_id);
end $function$;

create or replace function public.valider_rapprochement_facture(p_facture_id uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
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
     or (b.statut <> 'rapproche' and not (b.statut='ecart' and b.resolution='accepte' and nullif(btrim(b.justification),'') is not null))
     or b.montant_ht is null or b.montant_commande_ht is null
     or (abs(b.montant_ht-b.montant_commande_ht)>coalesce((select tolerance_ht from public.fournisseurs where id=f.fournisseur_id),0.05)
       and not (b.resolution='accepte' and nullif(btrim(b.justification),'') is not null)))
 ) then raise exception 'Liaisons non conformes ou ambiguës'; end if;
 if exists(select 1 from public.facture_bl where facture_id=f.id group by commande_id having count(*)>1)
 or exists(select 1 from public.facture_bl b join public.facture_bl o on o.commande_id=b.commande_id and o.facture_id<>b.facture_id where b.facture_id=f.id)
 then raise exception 'Document utilise plusieurs fois'; end if;
 if exists(select 1 from public.facture_frais where facture_id=f.id and ((imputation='chantier' and chantier_id is null) or nullif(btrim(justification),'') is null)) then
   raise exception 'Frais non affectes : choisir un chantier et justifier avant validation';
 end if;
 if f.montant_ht is null or abs(f.montant_ht
   -coalesce((select sum(montant_ht) from public.facture_bl where facture_id=f.id),0)
   -coalesce((select sum(montant_ht) from public.facture_frais where facture_id=f.id),0))
   >coalesce((select tolerance_ht from public.fournisseurs where id=f.fournisseur_id),0.05)
 then raise exception 'Total HT incoherent'; end if;
 update public.commandes set statut_facturation='facture',facture_id=f.id
 where id in(select commande_id from public.facture_bl where facture_id=f.id)
 and facture_id is null and statut_facturation='en_attente_facture';
 get diagnostics n = row_count;
 if n<>(select count(*) from public.facture_bl where facture_id=f.id) then
   raise exception 'Conflit concurrent : commande déjà affectée';
 end if;
 update public.commande_lignes set prix_verrouille=true where commande_id in
 (select commande_id from public.facture_bl where facture_id=f.id);
 update public.factures set statut='rapprochee',
 statut_rapprochement=case when exists(select 1 from public.facture_bl where facture_id=f.id and resolution='accepte') then 'cloturee_avec_ecarts' else 'conforme' end where id=f.id;
 perform public.comptabiliser_couts_facture(f.id);
 return jsonb_build_object('statut','conforme','documents',n);
end $function$;

create or replace function public.comptabiliser_couts_facture(p_facture_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
 -- Frais en frais généraux : aucun coût chantier (ils restent dans le total de la facture).
 for frais in select * from public.facture_frais where facture_id=f.id and imputation='chantier' loop
   if frais.chantier_id is null then raise exception 'Frais sans chantier'; end if;
   insert into public.facture_couts_chantiers(facture_id,facture_frais_id,chantier_id,montant_ht,nature,date_imputation)
   values(f.id,frais.id,frais.chantier_id,round(frais.montant_ht,2),'frais',coalesce(f.date_facture,current_date));
 end loop;
 return (select count(*) from public.facture_couts_chantiers where facture_id=f.id);
end $function$;
