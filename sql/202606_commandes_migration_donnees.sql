-- ============================================================
-- MIGRATION 02 — Reprise des données (NON destructif)
-- Lit commandes_detail / commandes_passees, écrit dans les
-- nouvelles tables (besoins / commandes / commande_lignes).
-- Ne supprime ni ne modifie aucune donnée existante.
--
-- ÉCART SCHÉMA traité : commandes_detail.phasage_id est en TEXT
-- (commandes_passees.phasage_id est en UUID). On convertit via
-- safe_uuid() pour alimenter commande_lignes.phasage_id (UUID).
-- ============================================================

-- Helper : cast numérique sûr depuis un texte libre
create or replace function public.safe_numeric(t text)
returns numeric language sql immutable as $$
  select case when t ~ '^\s*[0-9]+([.,][0-9]+)?\s*$'
              then replace(btrim(t), ',', '.')::numeric
         else null end;
$$;

-- Helper : cast uuid sûr depuis un texte (null si pas un uuid valide)
create or replace function public.safe_uuid(t text)
returns uuid language sql immutable as $$
  select case when btrim(coalesce(t,'')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then btrim(t)::uuid
         else null end;
$$;

-- (A) BESOINS : commandes_detail (statut besoin_ouvrier*) -> besoins
insert into public.besoins
  (chantier_id, materiau_id, article, quantite, ouvrier_demandeur, origine, statut, notes, created_at)
select cd.chantier_id, cd.materiau_id, cd.article, cd.quantite, cd.ouvrier_demandeur,
       'ouvrier', 'en_attente', cd.notes, coalesce(cd.created_at, now())
from public.commandes_detail cd
where cd.statut in ('besoin_ouvrier','besoin ouvrier','besoin_ouvriers');

-- (B) COMMANDES PASSÉES : commandes_passees -> commandes + commande_lignes
--     On réutilise l'id de commandes_passees comme id de commandes pour relier
--     facilement les lignes.
insert into public.commandes
  (id, type_evenement, doc_type, doc_numero, numero_en_attente, fournisseur_id,
   fournisseur_nom, date_doc, montant_ht, statut_completude, statut_facturation,
   source, notes, created_at)
select cp.id, 'commande', 'bon_commande', null, true, cp.fournisseur_id,
       cp.fournisseur_nom, cp.date_commande::date, cp.total_ht,
       'a_completer', 'en_attente_facture', 'migration',
       coalesce(cp.notes,'') || ' [Migré de commandes_passees]',
       coalesce(cp.date_commande, now())
from public.commandes_passees cp;

insert into public.commande_lignes
  (commande_id, libelle, quantite, unite, prix_unitaire, prix_total,
   chantier_id, phasage_id, phase_id)
select cp.id,
       coalesce(a->>'libelle',''),
       public.safe_numeric(a->>'quantite'),
       coalesce(nullif(a->>'unite',''),'U'),
       public.safe_numeric(a->>'prix_ht'),
       case when public.safe_numeric(a->>'prix_ht') is not null
             and public.safe_numeric(a->>'quantite') is not null
            then public.safe_numeric(a->>'prix_ht') * public.safe_numeric(a->>'quantite')
       end,
       cp.chantier_id, cp.phasage_id, cp.phase_id
from public.commandes_passees cp
cross join lateral jsonb_array_elements(coalesce(cp.articles,'[]'::jsonb)) as a;

-- (C) COMMANDES MANUELLES / IMPORTS IA : commandes_detail (hors besoins et hors
--     doublons du Planning) -> commandes + 1 ligne chacune.
with src as (
  select * from public.commandes_detail
  where statut in ('a_commander','commande','retire')
    and coalesce(notes,'') not like 'Commandé via Planning des commandes%'
)
insert into public.commandes
  (id, type_evenement, doc_type, doc_numero, numero_en_attente, fournisseur_nom,
   montant_ht, saisi_par, statut_completude, statut_facturation, source, notes, created_at)
select s.id, 'commande', 'bl', null, true, s.fournisseur, s.prix_ht,
       s.ouvrier_demandeur, 'a_completer', 'en_attente_facture', 'migration',
       coalesce(s.notes,'') || ' [Migré de commandes_detail / statut ' || s.statut || ']',
       coalesce(s.created_at, now())
from src s;

insert into public.commande_lignes
  (commande_id, libelle, quantite, prix_total, materiau_id, chantier_id, phasage_id, phase_id)
select s.id, s.article, public.safe_numeric(s.quantite), s.prix_ht,
       s.materiau_id, s.chantier_id, public.safe_uuid(s.phasage_id), s.phase_id
from public.commandes_detail s
where s.statut in ('a_commander','commande','retire')
  and coalesce(s.notes,'') not like 'Commandé via Planning des commandes%';
