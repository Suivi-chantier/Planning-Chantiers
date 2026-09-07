-- 202609_inventaire_equipes.sql — Inventaire du matériel mis à disposition des ouvriers.
-- À exécuter dans Supabase SQL Editor.
--
-- Modèle : une ligne = un outil physique identifié par le CODE UNIQUE inscrit
-- dessus (ex. « P-012 » sur une perceuse). L'affectation se fait par prénom
-- d'ouvrier (la clé de jointure de toute l'appli — cf. planning_config.ouvriers) ;
-- ouvrier_prenom NULL = matériel au dépôt, non affecté.

create table if not exists public.materiel (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,             -- code unique inscrit sur l'outil
  nom            text not null,             -- ex. « Perceuse Makita 18V »
  categorie      text,                      -- ex. « Électroportatif », « EPI »…
  ouvrier_prenom text,                      -- prénom planning ; NULL = dépôt
  date_remise    date,                      -- date de mise à disposition
  etat           text not null default 'bon' check (etat in ('bon','use','hs')),
  notes          text,
  saisi_par      text,                      -- acteur de la dernière écriture (traçabilité data_history)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Le code est unique quelle que soit la casse / les espaces parasites à la saisie.
create unique index if not exists materiel_code_uniq
  on public.materiel (upper(btrim(code)));
create index if not exists materiel_ouvrier_idx
  on public.materiel (ouvrier_prenom);

-- updated_at automatique
create or replace function public.materiel_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists trg_materiel_touch on public.materiel;
create trigger trg_materiel_touch before update on public.materiel
  for each row execute function public.materiel_touch_updated_at();

-- Filet de sécurité : historique universel (restauration depuis Admin → Historique).
drop trigger if exists trg_data_history on public.materiel;
create trigger trg_data_history before update or delete on public.materiel
  for each row execute function public.log_data_history();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.materiel enable row level security;
revoke all on table public.materiel from anon;

-- Bureau : accès complet (tous rôles sauf ouvrier).
drop policy if exists materiel_bureau_all on public.materiel;
create policy materiel_bureau_all on public.materiel
  for all to authenticated
  using (not public.est_ouvrier())
  with check (not public.est_ouvrier());

-- Ouvrier : lecture de son propre matériel uniquement (pour un futur affichage
-- dans l'espace ouvrier ; aucune écriture).
drop policy if exists materiel_ouvrier_sel on public.materiel;
create policy materiel_ouvrier_sel on public.materiel
  for select to authenticated
  using (public.est_ouvrier() and ouvrier_prenom = public.mon_prenom_planning());
