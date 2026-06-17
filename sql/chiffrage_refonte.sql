-- ═══════════════════════════════════════════════════════════════════════════
-- Refonte page « Info Client » → « Chiffrage »
-- À exécuter dans l'éditeur SQL Supabase.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Notes libres par projet de chiffrage
alter table profero_projets
  add column if not exists notes text default '';

-- 2) Lier un plan riche (table `plans` partagée avec la page Plans) à un projet
--    de chiffrage. Un plan créé dans le chiffrage a projet_id = id du projet et
--    chantier_id vide ; on lui assigne un chantier_id pour l'« envoyer » vers la
--    page Plans (où il reste filtrable par chantier).
alter table plans
  add column if not exists projet_id uuid;

create index if not exists plans_projet_id_idx on plans(projet_id);
