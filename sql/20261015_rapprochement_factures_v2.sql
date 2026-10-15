-- Rapprochement fournisseurs v2 — migration additive, sans réécriture des coûts historiques.
alter table public.fournisseurs
 add column if not exists type_facturation text,
 add column if not exists delai_paiement text,
 add column if not exists regles_numero jsonb not null default '{}'::jsonb,
 add column if not exists tolerance_ht numeric(12,2) not null default 0.05,
 add column if not exists consignes_ia text;
alter table public.commandes
 add column if not exists numero_normalise text,
 add column if not exists numero_commande_fournisseur text,
 add column if not exists remplace_par_id uuid references public.commandes(id) on delete set null;
alter table public.factures
 add column if not exists type_document text not null default 'facture',
 add column if not exists facture_origine_id uuid references public.factures(id) on delete set null,
 add column if not exists montant_tva numeric(14,2),
 add column if not exists montant_ttc numeric(14,2),
 add column if not exists frais_ht numeric(14,2),
 add column if not exists date_echeance date,
 add column if not exists mode_reglement text,
 add column if not exists fichiers jsonb not null default '[]'::jsonb,
 add column if not exists extraction jsonb,
 add column if not exists statut_rapprochement text not null default 'a_rapprocher';
alter table public.facture_bl
 add column if not exists numero_commande_fournisseur text,
 add column if not exists date_livraison date,
 add column if not exists montant_commande_ht numeric(14,2),
 add column if not exists ecart_ht numeric(14,2),
 add column if not exists mode_rapprochement text,
 add column if not exists justification text,
 add column if not exists resolution text;
create table if not exists public.facture_frais (
 id uuid primary key default gen_random_uuid(),
 facture_id uuid not null references public.factures(id) on delete cascade,
 libelle text not null,
 montant_ht numeric(14,2) not null,
 chantier_id text,
 justification text,
 created_at timestamptz not null default now()
);
create index if not exists facture_frais_facture_idx on public.facture_frais(facture_id);
create unique index if not exists factures_fournisseur_numero_unique_v2
 on public.factures(fournisseur_id,upper(trim(numero)),type_document)
 where fournisseur_id is not null and numero is not null and trim(numero)<>'';
create index if not exists commandes_numero_normalise_idx on public.commandes(fournisseur_id,numero_normalise);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values ('factures-privees','factures-privees',false,26214400,array['application/pdf','image/jpeg','image/png','image/webp'])
 on conflict (id) do update set public=false;
alter table public.facture_frais enable row level security;
drop policy if exists facture_frais_collaborateurs on public.facture_frais;
create policy facture_frais_collaborateurs on public.facture_frais
 for all to authenticated
 using (exists(select 1 from public.utilisateurs u where u.id=(select auth.uid()) and u.actif=true and u.role in ('admin','conducteur','bureau','comptable')))
 with check (exists(select 1 from public.utilisateurs u where u.id=(select auth.uid()) and u.actif=true and u.role in ('admin','conducteur','bureau','comptable')));
grant select,insert,update,delete on public.facture_frais to authenticated;
drop policy if exists factures_privees_collaborateurs on storage.objects;
create policy factures_privees_collaborateurs on storage.objects
 for all to authenticated
 using (bucket_id='factures-privees' and exists(select 1 from public.utilisateurs u where u.id=(select auth.uid()) and u.actif=true and u.role in ('admin','conducteur','bureau','comptable')))
 with check (bucket_id='factures-privees' and exists(select 1 from public.utilisateurs u where u.id=(select auth.uid()) and u.actif=true and u.role in ('admin','conducteur','bureau','comptable')));
