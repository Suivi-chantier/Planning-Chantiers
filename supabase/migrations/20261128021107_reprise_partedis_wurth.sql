-- Reprises du 28/11/2026 (demandées par François) :
-- 1. Achat WURTH saisi avec le n° de la facture (4335906658) au lieu du n° de BL (8169781139).
-- 2. Règle fournisseur Partedis : montant du BL = TOTAL HT de la facture (hors « Frais facturation »).
-- 3. Facture Partedis 9302111/571678 : BL 12211060 lu à 42,61 € au lieu de 52,61 € (port compris
--    dans le bon d'emporte) → « rapproche » ; ligne de frais « Participation frais de port » 10,00 €
--    supprimée (sinon double comptage).
-- Sauvegardes : sauvegarde_20261128_partedis_wurth (une ligne JSON par enregistrement touché).

create table public.sauvegarde_20261128_partedis_wurth (
  table_source text not null, id_source uuid not null, avant jsonb not null, sauvegarde_le timestamptz not null default now()
);
alter table public.sauvegarde_20261128_partedis_wurth enable row level security;
create policy profero_collaborateurs_seulement on public.sauvegarde_20261128_partedis_wurth
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));
create policy sauvegarde_lecture_bureau on public.sauvegarde_20261128_partedis_wurth
  for select to authenticated using ((select not public.est_ouvrier()));

insert into public.sauvegarde_20261128_partedis_wurth(table_source, id_source, avant)
select 'commandes', c.id, to_jsonb(c) from public.commandes c
 where c.id = '91c3cdd7-8704-43ab-87e1-d593f68e5509' and c.doc_numero = '4335906658'
union all
select 'fournisseurs', f.id, to_jsonb(f) from public.fournisseurs f
 where f.id = 'ea6f55a3-d762-49ed-b439-80fd386c1797'
union all
select 'factures', f.id, to_jsonb(f) from public.factures f
 where f.numero = '9302111/571678' and f.statut = 'a_rapprocher'
union all
select 'facture_bl', b.id, to_jsonb(b) from public.facture_bl b join public.factures f on f.id = b.facture_id
 where f.numero = '9302111/571678' and f.statut = 'a_rapprocher' and b.bl_numero = '12211060'
union all
select 'facture_frais', x.id, to_jsonb(x) from public.facture_frais x join public.factures f on f.id = x.facture_id
 where f.numero = '9302111/571678' and f.statut = 'a_rapprocher' and x.libelle ilike '%frais de port%' and x.montant_ht = 10 and x.chantier_id is null;

do $$
declare n int;
begin
  select count(*) into n from public.sauvegarde_20261128_partedis_wurth;
  if n <> 5 then raise exception 'Reprise interrompue : % enregistrements au lieu des 5 attendus', n; end if;
end $$;

update public.commandes set doc_numero = '8169781139'
 where id = '91c3cdd7-8704-43ab-87e1-d593f68e5509' and doc_numero = '4335906658';

update public.fournisseurs set regles_numero = coalesce(regles_numero, '{}'::jsonb) || '{"montant_bl":"total_ht_facture"}'::jsonb
 where id = 'ea6f55a3-d762-49ed-b439-80fd386c1797';

update public.facture_bl b set montant_ht = 52.61, ecart_ht = 0, statut = 'rapproche'
  from public.sauvegarde_20261128_partedis_wurth s
 where s.table_source = 'facture_bl' and s.id_source = b.id;

delete from public.facture_frais x
 using public.sauvegarde_20261128_partedis_wurth s
 where s.table_source = 'facture_frais' and s.id_source = x.id;

update public.factures f set frais_ht = 0
  from public.sauvegarde_20261128_partedis_wurth s
 where s.table_source = 'factures' and s.id_source = f.id;
