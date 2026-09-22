-- Suites des advisors Supabase après la migration taux_horaires_vente :
--   • la fonction trigger SECURITY DEFINER bibliotheque_ratios_taux_horaire_garde()
--     ne doit pas être exposée en RPC (anon / authenticated) ;
--   • la FK profero_ouvrages_selectionnes.taux_horaire_vente_id n'était pas indexée.
revoke execute on function public.bibliotheque_ratios_taux_horaire_garde() from public, anon, authenticated;
revoke execute on function public.taux_horaires_vente_garde() from public, anon, authenticated;
create index if not exists profero_ouvrages_selectionnes_taux_horaire_vente_idx
  on public.profero_ouvrages_selectionnes (taux_horaire_vente_id) where taux_horaire_vente_id is not null;
