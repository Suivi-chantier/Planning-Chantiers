-- ═══════════════════════════════════════════════════════════════════════════
-- Chiffrage v3.1 — saisie du prix par COEFFICIENT DE VENTE (× coût).
--   Le métier raisonne « coût × 1,5 » plutôt qu'en % du prix de vente. On
--   ajoute coef_vente (source de saisie) ; taux_marge_pct reste la marge
--   équivalente en % du prix de vente, dérivée et figée dans les snapshots
--   (×1,5 ⇒ 33,33 %, ×2 ⇒ 50 %).
--
-- Idempotente et SANS PERTE. Reprise des ouvrages déjà renseignés en taux :
-- coef = 1 / (1 − taux/100) — strictement équivalent, aucun prix ne change.
-- À exécuter APRÈS sql/202609_chiffrage_devis_logement.sql.
-- ═══════════════════════════════════════════════════════════════════════════

alter table bibliotheque_ratios
  add column if not exists coef_vente numeric;   -- ex : 1.5 = coût × 1,5 ; null = non renseigné (bloquant)

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bibliotheque_ratios_coef_vente_check') then
    alter table bibliotheque_ratios
      add constraint bibliotheque_ratios_coef_vente_check
      check (coef_vente is null or coef_vente >= 1);
  end if;
end $$;

-- Reprise équivalente des taux déjà saisis (uniquement là où coef_vente est vide)
update bibliotheque_ratios
   set coef_vente = round((1 / (1 - taux_marge_pct / 100))::numeric, 4)
 where coef_vente is null
   and taux_marge_pct is not null
   and taux_marge_pct >= 0 and taux_marge_pct < 100;

-- Snapshot des lignes : le coefficient utilisé à l'ajout (audit)
alter table profero_ouvrages_selectionnes
  add column if not exists coef_vente numeric;

-- Contrôle :
-- select libelle, coef_vente, taux_marge_pct from bibliotheque_ratios where coef_vente is not null order by libelle;
