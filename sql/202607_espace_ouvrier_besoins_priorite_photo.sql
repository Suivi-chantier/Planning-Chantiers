-- =====================================================================
-- ESPACE OUVRIER — PHASE 6 : onglet Demande commande
-- Ajoute à la table besoins : priorite (normal/urgent) + photo_url.
-- Non destructif. Réutilise le flux besoins existant (remonte dans Commandes,
-- Dashboard conducteur, cron-recap-commandes).
--   - priorite : allume le badge "URGENT" déjà présent côté Commandes
--     (Commandes.jsx : urgent = d.priorite === "urgent").
--   - photo_url : photo optionnelle jointe à la demande.
-- À exécuter dans le SQL Editor Supabase avant d'utiliser l'onglet.
-- =====================================================================

alter table public.besoins
  add column if not exists priorite text not null default 'normal';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'besoins_priorite_check') then
    alter table public.besoins
      add constraint besoins_priorite_check check (priorite in ('normal','urgent'));
  end if;
end $$;

alter table public.besoins
  add column if not exists photo_url text;
