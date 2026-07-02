-- ============================================================
-- Ajoute le mode de facturation par fournisseur.
-- 'comptant'  -> achat payé sur place (coché "déjà payé" à la saisie)
-- 'echeance'  -> facturé (ex. 30j fin de mois) -> en attente de la facture
-- NULL = non défini (comportement par défaut selon le type d'événement).
-- NON destructif.
-- ============================================================
alter table public.fournisseurs add column if not exists mode_paiement text;
