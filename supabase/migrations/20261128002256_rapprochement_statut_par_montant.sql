-- Rapprochement factures : le statut d'une liaison BL ↔ achat dépend uniquement
-- des montants (|facture − commande| <= tolérance du fournisseur).
--
-- 1. valider_rapprochement_facture : on retire la condition qui exigeait un
--    appariement « par numéro » (ou un écart accepté avec justification) pour
--    toute autre façon d'apparier. Un BL choisi parmi les propositions au même
--    montant est une confirmation humaine. Toutes les autres vérifications
--    (montants ligne par ligne, total HT, frais affectés, document utilisé une
--    seule fois, fournisseur identique) sont inchangées.
--    mode_rapprochement reste enregistré pour la traçabilité.
--
-- 2. Reprise : les lignes facture_bl en « ecart » dont l'écart est dans la
--    tolérance du fournisseur passent en « rapproche ». Au 28/11/2026 : 6 lignes,
--    toutes sur la facture REXEL 960676175, écart 0,00 € chacune.
--    Sauvegarde : public.sauvegarde_20261128_facture_bl_statut.

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
 if exists(select 1 from public.facture_frais where facture_id=f.id and (chantier_id is null or nullif(btrim(justification),'') is null)) then
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

-- Sauvegarde des lignes reprises (retour arrière : remettre statut depuis cette table).
create table public.sauvegarde_20261128_facture_bl_statut as
select b.id, b.facture_id, b.bl_numero, b.statut, b.mode_rapprochement, b.ecart_ht, now() as sauvegarde_le
from public.facture_bl b
join public.factures f on f.id = b.facture_id
left join public.fournisseurs fo on fo.id = f.fournisseur_id
where b.statut = 'ecart' and b.resolution is null and f.statut = 'a_rapprocher'
  and b.ecart_ht is not null and abs(b.ecart_ht) <= coalesce(fo.tolerance_ht, 0.05);

alter table public.sauvegarde_20261128_facture_bl_statut enable row level security;
create policy profero_collaborateurs_seulement on public.sauvegarde_20261128_facture_bl_statut
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));
create policy sauvegarde_lecture_bureau on public.sauvegarde_20261128_facture_bl_statut
  for select to authenticated using (not public.est_ouvrier());

update public.facture_bl b set statut = 'rapproche'
from public.sauvegarde_20261128_facture_bl_statut s
where s.id = b.id and b.statut = 'ecart';
