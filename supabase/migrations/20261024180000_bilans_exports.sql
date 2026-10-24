-- ============================================================================
-- Refonte du Bilan — étape 3.5 : bilans figés.
--
-- Chaque export du Bilan (PDF ou e-mail) est archivé : période, bornes de
-- comparaison, chantiers, chiffres affichés, version (direction / détaillée),
-- document exporté (HTML, qui redonne exactement le PDF), auteur et date.
-- Un bilan exporté ne change plus : les écarts constatés ensuite sur la même
-- période apparaissent dans la ligne « Rectifications » du bilan suivant.
--
-- Accès (accord de Loris du 24/10/2026) : lecture et écriture pour le bureau
-- seulement (pas les ouvriers), comme achats_lots_termines, + la règle
-- restrictive « réservé aux collaborateurs ». Les documents ne sont PAS mis
-- dans le stockage « chantier-documents » (lisible par tous les collaborateurs,
-- ouvriers compris).
-- Purement additive : une nouvelle table, aucune donnée existante touchée.
-- Un bilan figé ne se modifie pas : le bureau peut lire et ajouter, jamais
-- modifier ni supprimer (aucun droit update / delete accordé).
-- ============================================================================
create table if not exists public.bilans_exports (
  id             uuid primary key default gen_random_uuid(),
  periode_cle    text not null,          -- « S:2026-W43 », « M:2026-10 », « L:2026-10-01_2026-10-15 »
  periode_libelle text,
  periode_debut  date not null,
  periode_fin    date not null,
  date_depart    date not null,          -- relevé de départ (dernier jour travaillé avant la période)
  date_fin       date not null,          -- relevé de fin (dernier jour travaillé de la période)
  version        text not null check (version in ('direction', 'detaillee')),
  chantier_ids   jsonb not null default '[]'::jsonb,
  chiffres       jsonb not null default '{}'::jsonb,
  document_html  text,
  exporte_par    text,
  exporte_le     timestamptz not null default now()
);
create index if not exists bilans_exports_periode_idx on public.bilans_exports (periode_fin);
comment on table public.bilans_exports is
  'Bilans exportés (figés) : période, chantiers, chiffres affichés, document. Étape 3.5 de la refonte du Bilan.';

alter table public.bilans_exports enable row level security;
revoke all on public.bilans_exports from anon;
grant select, insert on public.bilans_exports to authenticated;
grant all on public.bilans_exports to service_role;

drop policy if exists bureau_all on public.bilans_exports;
create policy bureau_all on public.bilans_exports for all to authenticated
  using (not public.est_ouvrier()) with check (not public.est_ouvrier());

drop policy if exists profero_collaborateurs_seulement on public.bilans_exports;
create policy profero_collaborateurs_seulement on public.bilans_exports
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));


-- Un bilan figé ne se modifie pas : retrait des droits par défaut de Supabase
-- (appliqué par Loris le 24/10/2026).
revoke update, delete, truncate on public.bilans_exports from authenticated;
