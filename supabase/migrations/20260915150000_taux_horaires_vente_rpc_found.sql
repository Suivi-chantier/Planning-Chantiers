-- Correctif : dans definir_taux_horaire_vente_defaut, le contrôle « ligne mise à
-- jour » lisait FOUND après un PERFORM set_config(...), qui remet FOUND à vrai.
-- Un appelant non administrateur (RLS : 0 ligne modifiée) obtenait donc un
-- retour NULL au lieu de l'erreur « Modification refusée ». Aucune écriture
-- n'était possible pour autant (la RLS l'empêchait déjà) ; seul le message manquait.
-- La version corrigée est aussi reportée dans 20260915140000_taux_horaires_vente.sql.
create or replace function public.definir_taux_horaire_vente_defaut(p_id uuid)
returns public.taux_horaires_vente
language plpgsql
security invoker
set search_path = public
as $$
declare
  cible public.taux_horaires_vente;
  n integer;
begin
  select * into cible from public.taux_horaires_vente where id = p_id;
  if not found then
    raise exception 'Taux horaire introuvable.';
  end if;
  if not cible.actif then
    raise exception 'Un taux désactivé ne peut pas devenir le taux par défaut : le réactiver d''abord.';
  end if;
  if cible.est_defaut then
    return cible;
  end if;
  perform set_config('profero.taux_defaut_basculement', '1', true);
  update public.taux_horaires_vente set est_defaut = false where est_defaut and id <> p_id;
  update public.taux_horaires_vente set est_defaut = true where id = p_id returning * into cible;
  get diagnostics n = row_count;
  perform set_config('profero.taux_defaut_basculement', '0', true);
  if n <> 1 then
    raise exception 'Modification refusée : réservée aux administrateurs.';
  end if;
  return cible;
end;
$$;

revoke all on function public.definir_taux_horaire_vente_defaut(uuid) from public, anon;
grant execute on function public.definir_taux_horaire_vente_defaut(uuid) to authenticated;

-- Suites des advisors Supabase : les fonctions trigger ne sont pas exposées en RPC,
-- et la FK profero_ouvrages_selectionnes.taux_horaire_vente_id est indexée.
revoke execute on function public.bibliotheque_ratios_taux_horaire_garde() from public, anon, authenticated;
revoke execute on function public.taux_horaires_vente_garde() from public, anon, authenticated;
create index if not exists profero_ouvrages_selectionnes_taux_horaire_vente_idx
  on public.profero_ouvrages_selectionnes (taux_horaire_vente_id) where taux_horaire_vente_id is not null;
