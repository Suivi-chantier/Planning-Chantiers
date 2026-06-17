-- ============================================================
-- MIGRATION 01 — Nouveau modèle de commandes (création)
-- Non destructif. Ne touche pas commandes_detail / commandes_passees.
-- NOTE : la table des matériaux s'appelle `materiaux_bibliotheque`
--        (et non `materiaux`) — vérifié sur le schéma réel.
-- ============================================================

-- 1) En-tête de document d'achat (BL / ticket / bon de commande)
create table if not exists public.commandes (
  id                 uuid primary key default gen_random_uuid(),
  type_evenement     text not null default 'comptoir'
                       check (type_evenement in ('comptoir','commande','livraison')),
  doc_type           text not null default 'bl'
                       check (doc_type in ('ticket','bon_commande','bl')),
  doc_numero         text,
  numero_en_attente  boolean not null default false,
  fournisseur_id     uuid references public.fournisseurs(id) on delete set null,
  fournisseur_nom    text,
  date_doc           date,
  montant_ht         numeric,
  photo_url          text,
  saisi_par          text,
  statut_completude  text not null default 'a_completer'
                       check (statut_completude in ('a_completer','complete')),
  statut_facturation text not null default 'en_attente_facture'
                       check (statut_facturation in ('en_attente_facture','facture')),
  facture_id         uuid,  -- FK ajoutée plus bas
  source             text default 'mobile'
                       check (source in ('mobile','import_ia','migration','facture','planning')),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- 2) Lignes d'articles (ventilation chantier/phase + prix)
create table if not exists public.commande_lignes (
  id              uuid primary key default gen_random_uuid(),
  commande_id     uuid not null references public.commandes(id) on delete cascade,
  libelle         text not null default '',
  reference       text,
  quantite        numeric,
  unite           text default 'U',
  prix_unitaire   numeric,
  prix_total      numeric,
  prix_verrouille boolean not null default false,  -- true après rapprochement facture
  materiau_id     uuid references public.materiaux_bibliotheque(id) on delete set null,
  chantier_id     text,
  phasage_id      uuid references public.phasages(id) on delete set null,
  phase_id        text,
  created_at      timestamptz not null default now()
);

-- 3) Factures fournisseur (mensuelles)
create table if not exists public.factures (
  id              uuid primary key default gen_random_uuid(),
  fournisseur_id  uuid references public.fournisseurs(id) on delete set null,
  fournisseur_nom text,
  numero          text,
  date_facture    date,
  periode         text,           -- ex: '2026-06'
  montant_ht      numeric,
  photo_url       text,
  statut          text not null default 'a_rapprocher'
                    check (statut in ('a_rapprocher','rapprochee')),
  saisi_par       text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- FK commandes.facture_id -> factures.id (créée après factures)
alter table public.commandes drop constraint if exists commandes_facture_id_fkey;
alter table public.commandes
  add constraint commandes_facture_id_fkey
  foreign key (facture_id) references public.factures(id) on delete set null;

-- 4) Liaison facture <-> BL
create table if not exists public.facture_bl (
  id          uuid primary key default gen_random_uuid(),
  facture_id  uuid not null references public.factures(id) on delete cascade,
  commande_id uuid references public.commandes(id) on delete set null, -- null = BL manquant
  bl_numero   text,
  montant_ht  numeric,
  statut      text not null default 'rapproche'
                check (statut in ('rapproche','manquant','ecart')),
  created_at  timestamptz not null default now()
);

-- 5) Besoins (demandes ouvrier / plan) — flux séparé
create table if not exists public.besoins (
  id                uuid primary key default gen_random_uuid(),
  chantier_id       text,
  materiau_id       uuid references public.materiaux_bibliotheque(id) on delete set null,
  article           text,
  quantite          text,           -- texte libre (ex "2 sacs"), comme l'existant
  unite             text default 'U',
  ouvrier_demandeur text,
  origine           text default 'ouvrier' check (origine in ('ouvrier','plan')),
  statut            text not null default 'en_attente'
                      check (statut in ('en_attente','traite','annule')),
  notes             text,
  created_at        timestamptz not null default now()
);

-- Index
create index if not exists commandes_fournisseur_idx   on public.commandes(fournisseur_id);
create index if not exists commandes_statut_fact_idx   on public.commandes(statut_facturation);
create index if not exists commandes_doc_numero_idx    on public.commandes(doc_numero);
create index if not exists commande_lignes_cmd_idx     on public.commande_lignes(commande_id);
create index if not exists commande_lignes_chantier_idx on public.commande_lignes(chantier_id);
create index if not exists commande_lignes_phase_idx   on public.commande_lignes(phasage_id, phase_id);
create index if not exists factures_fournisseur_idx    on public.factures(fournisseur_id);
create index if not exists facture_bl_facture_idx      on public.facture_bl(facture_id);
create index if not exists facture_bl_commande_idx     on public.facture_bl(commande_id);
create index if not exists besoins_chantier_idx        on public.besoins(chantier_id);
create index if not exists besoins_statut_idx          on public.besoins(statut);

-- Trigger updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_commandes_touch on public.commandes;
create trigger trg_commandes_touch before update on public.commandes
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_factures_touch on public.factures;
create trigger trg_factures_touch before update on public.factures
  for each row execute function public.touch_updated_at();

-- RLS : select/insert/update/delete pour authenticated (pattern existant)
do $$
declare t text;
begin
  foreach t in array array['commandes','commande_lignes','factures','facture_bl','besoins']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "%s_sel" on public.%I;', t, t);
    execute format('create policy "%s_sel" on public.%I for select to authenticated using (true);', t, t);
    execute format('drop policy if exists "%s_ins" on public.%I;', t, t);
    execute format('create policy "%s_ins" on public.%I for insert to authenticated with check (true);', t, t);
    execute format('drop policy if exists "%s_upd" on public.%I;', t, t);
    execute format('create policy "%s_upd" on public.%I for update to authenticated using (true) with check (true);', t, t);
    execute format('drop policy if exists "%s_del" on public.%I;', t, t);
    execute format('create policy "%s_del" on public.%I for delete to authenticated using (true);', t, t);
  end loop;
end $$;
