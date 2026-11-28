-- Rapprochement factures (tâche 1, cahier §4 P1) : reconnaître le fournisseur
-- d'une facture par son n° de TVA intracommunautaire, puis par ses autres noms.
--
-- 1. Additif : colonne fournisseurs.tva_intracom + index unique partiel
--    (un même n° de TVA ne peut désigner qu'un seul fournisseur).
-- 2. Réécriture de 4 lignes (REXEL, Partedis, WURTH, ZOLPAN) : n° de TVA lu
--    sur leurs factures, et autres noms (regles_numero.alias).
--    Sauvegarde de l'avant : public.sauvegarde_20261128_fournisseurs_tva_alias.
--    Retour arrière : remettre regles_numero depuis la sauvegarde, tva_intracom à null.

-- Sauvegarde (avant toute modification)
create table public.sauvegarde_20261128_fournisseurs_tva_alias as
select id, nom, regles_numero, now() as sauvegarde_le
from public.fournisseurs
where id in ('5803ab46-0400-443b-8ec9-40840c6efa82', 'ea6f55a3-d762-49ed-b439-80fd386c1797',
             'd5376b4f-778e-49c5-bdcf-2ed4637d4998', 'a204ae78-317d-4647-88e4-6794bc7f4189');

alter table public.sauvegarde_20261128_fournisseurs_tva_alias enable row level security;
create policy profero_collaborateurs_seulement on public.sauvegarde_20261128_fournisseurs_tva_alias
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));

-- Colonne et index
alter table public.fournisseurs add column tva_intracom text;
create unique index fournisseurs_tva_intracom_uniq
  on public.fournisseurs (upper(tva_intracom)) where tva_intracom is not null;

-- Données (garde-fou : exactement 4 lignes, noms vérifiés)
do $$
declare n int; total int := 0;
begin
  if (select count(*) from public.sauvegarde_20261128_fournisseurs_tva_alias) <> 4 then
    raise exception 'Sauvegarde incomplète : 4 fournisseurs attendus';
  end if;

  update public.fournisseurs
     set tva_intracom = 'FR26309304616',
         regles_numero = coalesce(regles_numero, '{}'::jsonb) || '{"alias":["REXEL France"]}'::jsonb
   where id = '5803ab46-0400-443b-8ec9-40840c6efa82' and nom = 'REXEL';
  get diagnostics n = row_count; total := total + n;

  update public.fournisseurs
     set tva_intracom = 'FR57467200515'
   where id = 'ea6f55a3-d762-49ed-b439-80fd386c1797' and nom = 'Partedis';
  get diagnostics n = row_count; total := total + n;

  update public.fournisseurs
     set tva_intracom = 'FR57668502966',
         regles_numero = coalesce(regles_numero, '{}'::jsonb) || '{"alias":["Würth France","WURTH PROXI SHOP"]}'::jsonb
   where id = 'd5376b4f-778e-49c5-bdcf-2ed4637d4998' and nom = 'WURTH';
  get diagnostics n = row_count; total := total + n;

  update public.fournisseurs
     set tva_intracom = 'FR28306289307',
         regles_numero = coalesce(regles_numero, '{}'::jsonb) || '{"alias":["CROMOLOGY","CROMOLOGY DISTRIBUTION","TOLLENS"]}'::jsonb
   where id = 'a204ae78-317d-4647-88e4-6794bc7f4189' and nom = 'ZOLPAN';
  get diagnostics n = row_count; total := total + n;

  if total <> 4 then raise exception 'Fournisseurs mis à jour : % au lieu de 4', total; end if;
end $$;
