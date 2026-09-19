-- ═══════════════════════════════════════════════════════════════════════════
-- Chiffrage v2 — budget & délai, dessins au stylet (notes manuscrites +
-- croquis), ouvrages repris de la bibliothèque, vidéos dans les médias.
-- À exécuter dans l'éditeur SQL Supabase.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Budget client et délai souhaité (onglet Client & projet)
alter table profero_projets
  add column if not exists budget_client  numeric,          -- € HT annoncé par le client
  add column if not exists delai_souhaite text default '';  -- libre : "Livraison avant juin 2027"

-- 2) Ouvrage sélectionné repris de la bibliothèque (page Bibliothèque,
--    table bibliotheque_ratios) : on garde le lien pour brancher plus tard le
--    chiffrage sur le phasage. Null pour les ouvrages « maison » du chiffrage.
alter table profero_ouvrages_selectionnes
  add column if not exists bibliotheque_id uuid;

-- 3) Dessins au stylet : une ligne = une page de notes manuscrites OU un
--    croquis à main levée. Les tracés sont stockés en coordonnées logiques
--    (largeur × hauteur) pour rester éditables ; le PNG est rendu à la volée
--    (aperçu, export PDF). Table séparée pour ne pas alourdir profero_projets
--    (Realtime + payloads).
create table if not exists profero_dessins (
  id          uuid primary key default gen_random_uuid(),
  projet_id   uuid not null references profero_projets(id) on delete cascade,
  type        text not null check (type in ('note', 'croquis')),
  nom         text not null default '',
  ordre       integer not null default 0,
  largeur     integer not null default 1000,
  hauteur     integer not null default 1400,
  fond        text not null default 'lignes',  -- 'lignes' | 'grille' | 'blanc'
  strokes     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists profero_dessins_projet_idx on profero_dessins(projet_id, type, ordre);

-- Realtime (même logique que profero_cotes) — ignorer l'erreur si déjà membre
do $$
begin
  alter publication supabase_realtime add table profero_dessins;
exception when others then null;
end $$;

-- RLS : même politique que profero_projets / profero_cotes (bureau uniquement)
alter table profero_dessins enable row level security;
drop policy if exists "bureau_all" on profero_dessins;
create policy "bureau_all" on profero_dessins for all to authenticated
  using (not est_ouvrier()) with check (not est_ouvrier());
