-- ─────────────────────────────────────────────────────────────────────────────
-- Grouper les demandes ouvrier par « panier »
-- ─────────────────────────────────────────────────────────────────────────────
-- Un ouvrier compose un panier de N articles pour un chantier et l'envoie d'un
-- coup. Jusqu'ici, chaque article devenait une ligne `besoins` indépendante : le
-- bureau ne pouvait traiter qu'article par article. On ajoute `panier_id` pour que
-- toutes les lignes d'un même envoi partagent un identifiant → validation du panier
-- entier côté bureau (page « À passer »).
--
-- À lancer manuellement dans Supabase (SQL editor).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.besoins add column if not exists panier_id uuid;
create index if not exists besoins_panier_idx on public.besoins(panier_id);

-- Backfill : regroupe les demandes existantes envoyées ensemble
-- (même ouvrier + même chantier + même minute) sous un panier_id commun.
update public.besoins b
set panier_id = sub.pid
from (
  select gen_random_uuid() as pid, ouvrier_demandeur, chantier_id,
         date_trunc('minute', created_at) as m
  from public.besoins
  where panier_id is null
  group by ouvrier_demandeur, chantier_id, date_trunc('minute', created_at)
) sub
where b.panier_id is null
  and b.ouvrier_demandeur is not distinct from sub.ouvrier_demandeur
  and b.chantier_id is not distinct from sub.chantier_id
  and date_trunc('minute', b.created_at) = sub.m;
