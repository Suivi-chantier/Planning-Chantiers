-- ZOLPAN facture au nom de sa raison sociale « CROMOLOGY DISTRIBUTION CENTRE OUEST ».
-- Autre nom reconnu (fournisseurs.regles_numero.alias), lu par matchFournisseur.
-- Valeur avant : regles_numero = {} (une seule ligne). Retour arrière : retirer la clé "alias".
do $$
declare n int;
begin
  update public.fournisseurs
     set regles_numero = coalesce(regles_numero, '{}'::jsonb) || '{"alias":["CROMOLOGY"]}'::jsonb
   where id = 'a204ae78-317d-4647-88e4-6794bc7f4189' and nom = 'ZOLPAN';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Fournisseur ZOLPAN introuvable (% ligne)', n; end if;
end $$;
