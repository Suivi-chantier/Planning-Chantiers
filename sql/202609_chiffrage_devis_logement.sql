-- ═══════════════════════════════════════════════════════════════════════════
-- Chiffrage v3 — un projet = un logement = un futur devis ProGBat.
--   • bibliothèque : taux de marge par ouvrage, « main-d'œuvre seule », coût
--     direct complémentaire, identifiant ProGBat (réservé) ;
--   • lignes sélectionnées : zone par occurrence, snapshot financier figé,
--     TVA par ligne, ordre, FK bibliotheque_id ON DELETE SET NULL, index ;
--   • projets : client structuré, adresse du chantier structurée, référence et
--     type du logement, en-tête de devis (objet, dates, TVA, n° commande,
--     conditions), identifiants ProGBat (réservés).
--
-- Idempotente et SANS PERTE : aucune suppression de données ni de colonne,
-- aucune réécriture des lignes existantes, aucun défaut métier inventé (pas de
-- TVA par défaut, pas de taux de marge par défaut). L'ancien champ
-- profero_projets.logements est conservé tel quel (lecture de repli côté app).
-- Le coût horaire de référence réutilise planning_config.taux_mo_previsionnel
-- (Admin → Taux) : aucune nouvelle clé n'est créée ici.
--
-- À exécuter dans l'éditeur SQL Supabase (aucune exécution automatique).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1) bibliotheque_ratios ────────────────────────────────────────────────
alter table bibliotheque_ratios
  add column if not exists taux_marge_pct        numeric,                       -- % du prix de vente HT (30 = 30 %) ; null = non renseigné (bloquant)
  add column if not exists main_oeuvre_seule     boolean not null default false,-- confirme un ouvrage volontairement sans matériau
  add column if not exists cout_direct_unitaire  numeric,                       -- €/unité : coûts directs complémentaires (location, évacuation…)
  add column if not exists progbat_id            text,                          -- réservé : identifiant ProGBat de l'ouvrage (synchro future, additive)
  add column if not exists progbat_sync_at       timestamptz;                   -- réservé : dernière liaison/synchro ProGBat

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bibliotheque_ratios_taux_marge_pct_check') then
    alter table bibliotheque_ratios
      add constraint bibliotheque_ratios_taux_marge_pct_check
      check (taux_marge_pct is null or (taux_marge_pct >= 0 and taux_marge_pct < 100));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bibliotheque_ratios_cout_direct_check') then
    alter table bibliotheque_ratios
      add constraint bibliotheque_ratios_cout_direct_check
      check (cout_direct_unitaire is null or cout_direct_unitaire >= 0);
  end if;
end $$;

create index if not exists bibliotheque_ratios_progbat_id_idx
  on bibliotheque_ratios(progbat_id) where progbat_id is not null;

-- ─── 2) profero_ouvrages_selectionnes ──────────────────────────────────────
-- Une ligne = UNE occurrence d'ouvrage dans UN devis (le même ouvrage de
-- bibliothèque peut apparaître plusieurs fois, dans des zones différentes).
alter table profero_ouvrages_selectionnes
  add column if not exists zone                      text not null default 'Logement entier',
  add column if not exists code_ouvrage              text,          -- snapshot : « MU-001 »
  add column if not exists cout_materiaux_unitaire   numeric,       -- snapshot €/u
  add column if not exists cout_main_oeuvre_unitaire numeric,       -- snapshot €/u
  add column if not exists cout_direct_unitaire      numeric,       -- snapshot €/u
  add column if not exists cout_total_unitaire       numeric,       -- snapshot €/u
  add column if not exists taux_marge_pct            numeric,       -- snapshot % (figé à l'ajout)
  add column if not exists tva_pct                   numeric,       -- TVA de la ligne (null = TVA du projet)
  add column if not exists calcul_version            text,          -- « 1@2026-09-14T10:00:00.000Z » (version@date du calcul)
  add column if not exists calcul_detail             jsonb,         -- détail : coût horaire, heures, matériaux, erreurs
  add column if not exists ordre                     integer,       -- ordre d'affichage dans la zone
  add column if not exists progbat_ligne_id          text,          -- réservé : identifiant de la ligne ProGBat
  add column if not exists created_at                timestamptz default now(),
  add column if not exists updated_at                timestamptz default now();
-- NB : prix_unitaire (existant) reste le PRIX DE VENTE HT UNITAIRE.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profero_ouvrages_selectionnes_taux_marge_pct_check') then
    alter table profero_ouvrages_selectionnes
      add constraint profero_ouvrages_selectionnes_taux_marge_pct_check
      check (taux_marge_pct is null or (taux_marge_pct >= 0 and taux_marge_pct < 100));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profero_ouvrages_selectionnes_tva_pct_check') then
    alter table profero_ouvrages_selectionnes
      add constraint profero_ouvrages_selectionnes_tva_pct_check
      check (tva_pct is null or (tva_pct >= 0 and tva_pct <= 100));
  end if;

  -- FK vers la bibliothèque : ON DELETE SET NULL — un devis garde son snapshot
  -- même si l'ouvrage source est supprimé plus tard. Ajoutée seulement si
  -- aucune ligne orpheline n'existe (sinon message, aucune donnée touchée).
  if not exists (select 1 from pg_constraint where conname = 'profero_ouvrages_selectionnes_bibliotheque_id_fkey') then
    if exists (
      select 1 from profero_ouvrages_selectionnes o
      where o.bibliotheque_id is not null
        and not exists (select 1 from bibliotheque_ratios b where b.id = o.bibliotheque_id)
    ) then
      raise notice 'FK bibliotheque_id NON ajoutée : des lignes pointent vers un ouvrage disparu. Les passer à NULL puis relancer.';
    else
      alter table profero_ouvrages_selectionnes
        add constraint profero_ouvrages_selectionnes_bibliotheque_id_fkey
        foreign key (bibliotheque_id) references bibliotheque_ratios(id) on delete set null;
    end if;
  end if;
end $$;

create index if not exists profero_ouvrages_selectionnes_projet_idx
  on profero_ouvrages_selectionnes(projet_id);
create index if not exists profero_ouvrages_selectionnes_biblio_idx
  on profero_ouvrages_selectionnes(bibliotheque_id) where bibliotheque_id is not null;
create index if not exists profero_ouvrages_selectionnes_projet_zone_idx
  on profero_ouvrages_selectionnes(projet_id, zone);
create index if not exists profero_ouvrages_selectionnes_progbat_idx
  on profero_ouvrages_selectionnes(progbat_ligne_id) where progbat_ligne_id is not null;

-- ─── 3) profero_projets ────────────────────────────────────────────────────
alter table profero_projets
  -- Client (facturation)
  add column if not exists client_societe             text default '',
  add column if not exists client_email               text default '',
  add column if not exists client_telephone           text default '',
  add column if not exists client_adresse             text default '',
  add column if not exists client_adresse_complement  text default '',
  add column if not exists client_code_postal         text default '',
  add column if not exists client_ville               text default '',
  add column if not exists client_pays                text default '',
  -- Chantier (adresse_bien existant conservé comme valeur historique / de repli)
  add column if not exists chantier_adresse           text default '',
  add column if not exists chantier_adresse_complement text default '',
  add column if not exists chantier_code_postal       text default '',
  add column if not exists chantier_ville             text default '',
  add column if not exists chantier_pays              text default '',
  -- Logement (1 projet = 1 logement ; `logements` jsonb conservé en lecture)
  add column if not exists logement_reference         text default '',
  add column if not exists type_logement              text default '',
  -- Devis
  add column if not exists devis_objet                text default '',
  add column if not exists devis_date                 date,
  add column if not exists devis_validite             date,
  add column if not exists tva_pct                    numeric,      -- TVA par défaut du devis ; null = à choisir (bloquant)
  add column if not exists devis_num_commande_client  text default '',
  add column if not exists devis_conditions           text default '',
  -- ProGBat (réservé — aucune API dans cette version)
  add column if not exists progbat_devis_id           text,
  add column if not exists progbat_client_id          text,
  add column if not exists progbat_sync_at            timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profero_projets_tva_pct_check') then
    alter table profero_projets
      add constraint profero_projets_tva_pct_check
      check (tva_pct is null or (tva_pct >= 0 and tva_pct <= 100));
  end if;
end $$;

create index if not exists profero_projets_progbat_devis_idx
  on profero_projets(progbat_devis_id) where progbat_devis_id is not null;

-- ─── 4) planning_config ────────────────────────────────────────────────────
-- Aucun changement de schéma. Clés utilisées par le chiffrage :
--   • taux_mo_previsionnel  (existante) : coût horaire chargé de référence, €/h.
--   • chiffrage_tva_defaut  (optionnelle, réglée dans Admin → Taux) : TVA
--     proposée aux NOUVEAUX projets. Volontairement NON insérée ici : aucun
--     taux ne doit être inventé par la migration.

-- ─── 5) RLS ────────────────────────────────────────────────────────────────
-- Les trois tables ont déjà RLS + policy « bureau_all » (authenticated, hors
-- ouvriers). On la (re)crée uniquement si elle manque.
do $$
declare t text;
begin
  foreach t in array array['bibliotheque_ratios', 'profero_ouvrages_selectionnes', 'profero_projets'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'bureau_all') then
      execute format('create policy "bureau_all" on %I for all to authenticated using (not est_ouvrier()) with check (not est_ouvrier())', t);
    end if;
  end loop;
end $$;

-- ─── 6) Realtime ───────────────────────────────────────────────────────────
-- La page Chiffrage s'abonne déjà à ces tables ; on s'assure qu'elles sont
-- publiées (erreur « déjà membre » ignorée).
do $$
begin
  alter publication supabase_realtime add table profero_ouvrages_selectionnes;
exception when others then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table profero_projets;
exception when others then null;
end $$;

-- ─── 7) Contrôle ───────────────────────────────────────────────────────────
-- select count(*) filter (where zone = 'Logement entier') as zone_defaut,
--        count(*) filter (where calcul_version is not null) as lignes_snapshot,
--        count(*) as total
-- from profero_ouvrages_selectionnes;
