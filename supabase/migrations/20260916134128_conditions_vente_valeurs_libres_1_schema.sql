-- Partie 1/3 de 20260917090000_conditions_vente_valeurs_libres.sql
-- Bibliothèque d'ouvrages : valeurs saisies sur la fiche + lignes de chiffrage.

-- ═══════════════════════════════════════════════════════════════════════════
-- Coefficient et taux horaire de VENTE : valeurs libres partout
--
-- Les listes déroulantes disparaissent des trois endroits où un coefficient ou
-- un taux horaire de vente se choisissait :
--   • fiche ouvrage (bibliotheque_ratios)          → valeur saisie sur la fiche
--   • conditions globales d'un chiffrage           → valeur saisie sur le projet
--   • dérogation d'une ligne de devis              → valeur saisie sur la ligne
--
-- Les référentiels (coefficients_vente, taux_horaires_vente) RESTENT : ils ne
-- servent plus qu'à proposer une valeur par défaut dans les champs, jamais à
-- imposer un choix. Les colonnes d'identifiant sont conservées telles quelles
-- (historique lisible) mais ne sont plus écrites.
--
-- Ce que ça change côté règles :
--   • plus de notion d'option « désactivée » sur un ouvrage, un chiffrage ou une
--     ligne : la valeur saisie est toujours utilisable ;
--   • une valeur reste FIGÉE là où elle est écrite — modifier le référentiel
--     n'a jamais d'effet rétroactif (c'était déjà le cas, ça l'est encore plus) ;
--   • les RPC reçoivent une valeur numérique au lieu d'un identifiant ; elles
--     continuent de calculer elles-mêmes prix et marge depuis les SEULES données
--     figées des lignes (le navigateur n'envoie jamais de prix ni de marge).
--
-- Reprise SANS PERTE : chaque ouvrage récupère la valeur du coefficient / taux
-- qu'il référençait ; aucune ligne de chiffrage n'est recalculée.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1) Bibliothèque d'ouvrages : valeurs saisies sur la fiche ─────────────
alter table public.bibliotheque_ratios
  add column if not exists coefficient_vente_valeur  numeric(8,4),
  add column if not exists taux_horaire_vente_valeur numeric(10,2);

comment on column public.bibliotheque_ratios.coefficient_vente_valeur is
  'Coefficient de vente SAISI sur la fiche, appliqué aux matériaux (et au coût direct) de l''ouvrage. Remplace coefficient_vente_id (conservé pour l''historique, plus écrit).';
comment on column public.bibliotheque_ratios.taux_horaire_vente_valeur is
  'Taux horaire de vente SAISI sur la fiche (€ HT/h, prix MO = cadence × taux). Remplace taux_horaire_vente_id (conservé pour l''historique, plus écrit).';

-- Reprise : valeur du coefficient / taux actuellement référencé, à défaut celle
-- du défaut actif. Aucune autre colonne n'est touchée, aucun prix n'est recalculé.
update public.bibliotheque_ratios b
   set coefficient_vente_valeur = coalesce(
         (select c.valeur from public.coefficients_vente c where c.id = b.coefficient_vente_id),
         (select c.valeur from public.coefficients_vente c where c.est_defaut and c.actif limit 1),
         (select c.valeur from public.coefficients_vente c where c.actif order by c.created_at, c.libelle limit 1))
 where b.coefficient_vente_valeur is null;

update public.bibliotheque_ratios b
   set taux_horaire_vente_valeur = coalesce(
         (select t.taux_ht from public.taux_horaires_vente t where t.id = b.taux_horaire_vente_id),
         (select t.taux_ht from public.taux_horaires_vente t where t.est_defaut and t.actif limit 1),
         (select t.taux_ht from public.taux_horaires_vente t where t.actif order by t.created_at, t.libelle limit 1))
 where b.taux_horaire_vente_valeur is null;

do $$
declare n integer;
begin
  select count(*) into n from public.bibliotheque_ratios
   where coefficient_vente_valeur is null or taux_horaire_vente_valeur is null;
  if n > 0 then
    raise exception 'Reprise incomplète : % ouvrage(s) sans coefficient ou sans taux horaire. Vérifier qu''il existe au moins un coefficient et un taux actifs dans les Réglages.', n;
  end if;
end $$;

-- Les anciens gardes imposaient un identifiant de référentiel existant et actif :
-- ils n'ont plus lieu d'être. Les colonnes d'identifiant deviennent facultatives.
drop trigger if exists bibliotheque_ratios_coefficient_garde_trg on public.bibliotheque_ratios;
drop trigger if exists bibliotheque_ratios_taux_horaire_garde_trg on public.bibliotheque_ratios;
drop function if exists public.bibliotheque_ratios_coefficient_garde();
drop function if exists public.bibliotheque_ratios_taux_horaire_garde();

alter table public.bibliotheque_ratios alter column coefficient_vente_id  drop not null;
alter table public.bibliotheque_ratios alter column taux_horaire_vente_id drop not null;

-- Nouveau garde : valeurs strictement positives ; un ouvrage créé sans valeur
-- reçoit celle par défaut des Réglages (le champ de l'interface est pré-rempli,
-- ceci ne couvre que les écritures faites ailleurs).
create or replace function public.bibliotheque_ratios_valeurs_vente_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.coefficient_vente_valeur is null then
    select c.valeur into new.coefficient_vente_valeur
      from public.coefficients_vente c where c.est_defaut and c.actif limit 1;
    if new.coefficient_vente_valeur is null then
      raise exception 'Coefficient de vente obligatoire : saisir une valeur sur la fiche de l''ouvrage.';
    end if;
  end if;
  if new.taux_horaire_vente_valeur is null then
    select t.taux_ht into new.taux_horaire_vente_valeur
      from public.taux_horaires_vente t where t.est_defaut and t.actif limit 1;
    if new.taux_horaire_vente_valeur is null then
      raise exception 'Taux horaire de main-d''œuvre obligatoire : saisir une valeur sur la fiche de l''ouvrage.';
    end if;
  end if;
  if new.coefficient_vente_valeur <= 0 then
    raise exception 'Coefficient de vente invalide (nul ou négatif) : %.', new.coefficient_vente_valeur;
  end if;
  if new.taux_horaire_vente_valeur <= 0 then
    raise exception 'Taux horaire de main-d''œuvre invalide (nul ou négatif) : %.', new.taux_horaire_vente_valeur;
  end if;
  return new;
end;
$$;
revoke execute on function public.bibliotheque_ratios_valeurs_vente_garde() from public, anon, authenticated;
drop trigger if exists bibliotheque_ratios_valeurs_vente_garde_trg on public.bibliotheque_ratios;
create trigger bibliotheque_ratios_valeurs_vente_garde_trg
  before insert or update of coefficient_vente_valeur, taux_horaire_vente_valeur on public.bibliotheque_ratios
  for each row execute function public.bibliotheque_ratios_valeurs_vente_garde();

alter table public.bibliotheque_ratios alter column coefficient_vente_valeur  set not null;
alter table public.bibliotheque_ratios alter column taux_horaire_vente_valeur set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bibliotheque_ratios_valeurs_vente_positives_check') then
    alter table public.bibliotheque_ratios add constraint bibliotheque_ratios_valeurs_vente_positives_check
      check (coefficient_vente_valeur > 0 and taux_horaire_vente_valeur > 0);
  end if;
end $$;

-- ─── 2) Lignes de chiffrage : la dérogation n'a plus d'identifiant ─────────
-- Mode « specifique » ⇒ une VALEUR strictement positive suffit (l'identifiant
-- reste accepté sur les lignes déjà enregistrées, il n'est simplement plus exigé).
alter table public.profero_ouvrages_selectionnes
  drop constraint if exists profero_ouvrages_selectionnes_coefficient_ligne_coherence_check;
alter table public.profero_ouvrages_selectionnes
  add constraint profero_ouvrages_selectionnes_coefficient_ligne_coherence_check
  check ((mode_coefficient_ligne = 'specifique' and coefficient_ligne_valeur > 0)
      or (mode_coefficient_ligne in ('heritage', 'ouvrage') and coefficient_ligne_id is null and coefficient_ligne_valeur is null and coefficient_ligne_libelle is null));

alter table public.profero_ouvrages_selectionnes
  drop constraint if exists profero_ouvrages_selectionnes_taux_ligne_coherence_check;
alter table public.profero_ouvrages_selectionnes
  add constraint profero_ouvrages_selectionnes_taux_ligne_coherence_check
  check ((mode_taux_horaire_ligne = 'specifique' and taux_horaire_ligne_valeur > 0)
      or (mode_taux_horaire_ligne in ('heritage', 'ouvrage') and taux_horaire_ligne_id is null and taux_horaire_ligne_valeur is null and taux_horaire_ligne_libelle is null));

comment on column public.profero_ouvrages_selectionnes.coefficient_ligne_valeur is
  'Coefficient SAISI et FIGÉ sur la ligne (mode specifique). Aucun lien avec les Réglages : les modifier ne le change jamais.';
comment on column public.profero_ouvrages_selectionnes.taux_horaire_ligne_valeur is
  'Taux horaire SAISI et FIGÉ sur la ligne (mode specifique). Aucun lien avec les Réglages : les modifier ne le change jamais.';

