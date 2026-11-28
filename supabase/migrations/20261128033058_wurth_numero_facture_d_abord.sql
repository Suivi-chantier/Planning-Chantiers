-- Rapprochement factures (tâche 3, cahier §4 P1) : chez Würth (achat comptoir
-- Proxi Shop, une facture par passage), le ticket comptoir porte le même n° que
-- la facture. Règle fournisseur regles_numero.numero_facture_d_abord = true :
-- le rapprochement essaie le n° de facture avant le n° de BL / de livraison.
-- Les autres fournisseurs (Rexel, Partedis, Zolpan) gardent le n° de BL d'abord.
--
-- Réécriture d'UNE ligne (fournisseur WURTH). Sauvegarde de l'avant :
-- public.sauvegarde_20261128_fournisseur_wurth_regles.
-- Retour arrière : remettre regles_numero depuis la sauvegarde.

create table public.sauvegarde_20261128_fournisseur_wurth_regles as
select id, nom, regles_numero, now() as sauvegarde_le
from public.fournisseurs
where id = 'd5376b4f-778e-49c5-bdcf-2ed4637d4998' and nom = 'WURTH';

alter table public.sauvegarde_20261128_fournisseur_wurth_regles enable row level security;
create policy profero_collaborateurs_seulement on public.sauvegarde_20261128_fournisseur_wurth_regles
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));

do $$
declare n int;
begin
  if (select count(*) from public.sauvegarde_20261128_fournisseur_wurth_regles) <> 1 then
    raise exception 'Sauvegarde incomplète : 1 fournisseur WURTH attendu';
  end if;
  update public.fournisseurs
     set regles_numero = coalesce(regles_numero, '{}'::jsonb) || '{"numero_facture_d_abord":true}'::jsonb
   where id = 'd5376b4f-778e-49c5-bdcf-2ed4637d4998' and nom = 'WURTH' and type_facturation = 'par_livraison';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Fournisseurs mis à jour : % au lieu de 1', n; end if;
end $$;
