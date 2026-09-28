-- ============================================================================
-- RESTAURATION — 59 ouvrages de bibliothèque supprimés le 14/09/2026
-- ============================================================================
--
-- NE PAS EXÉCUTER AVANT RELECTURE. Appliquer APRÈS la migration
-- supabase/migrations/20260924130000_data_history_planning_cells_bibliotheque.sql
-- (pour qu'une éventuelle annulation soit elle-même historisée).
--
-- LE PROBLÈME (mesuré en base le 24/09/2026) : 167 identifiants de
-- bibliothèque sont référencés par des ouvrages de phasage ; 63 n'existent
-- plus. 153 ouvrages de chantier, sur 20 chantiers, pointent vers un
-- identifiant disparu : leurs heures réelles ne peuvent plus être comparées à
-- une cadence, et la jauge d'échantillon les ignore.
--
-- 59 de ces 63 identifiants ont été supprimés le 14/09/2026 à 10:08 par un
-- script (changed_by = « Codex — nettoyage bibliothèque hors Ouvrages V2 ou
-- sans code (2026-09-14) »), qui avait pris soin de sauvegarder chaque ligne
-- complète dans data_history (op = DELETE). Ce script les réinsère avec LEUR
-- identifiant d'origine : 140 des 153 ouvrages de chantier retrouvent leur
-- lien. Les 13 autres pointent vers 4 identifiants introuvables (liste en bas
-- de fichier).
--
-- L'INTENTION DU 14/09 EST RESPECTÉE : les 59 sont ajoutés aux archivés
-- (planning_config.bibliotheque_archives, mécanisme du bouton « Archiver »,
-- PR #25). Ils ne réapparaissent donc dans AUCUNE liste de choix (phasage,
-- import devis, chiffrage) ; ils redeviennent seulement lisibles par
-- identifiant, là où un chantier les cite déjà.
--
-- ─── POURQUOI UNE RÉINSERTION TELLE QUELLE ÉCHOUERAIT ────────────────────────
-- Les sauvegardes du 14/09 ne contiennent que 8 colonnes (id, identifiant,
-- libelle, unite, sous_taches, updated_at, cadence, materiaux_liens) : les
-- colonnes de vente et de provenance ont été ajoutées du 15 au 17/09, après la
-- suppression. Or :
--
--  1. jsonb_populate_record() met NULL — et non la valeur par défaut — dans
--     toute colonne absente du JSON. main_oeuvre_seule (NOT NULL, défaut
--     false) ferait échouer l'insertion.
--     ⇒ on liste explicitement les colonnes insérées ; les autres prennent
--       leur valeur par défaut, comme pour tout ouvrage créé.
--
--  2. coefficient_vente_valeur et taux_horaire_vente_valeur sont NOT NULL
--     sans défaut. La garde bibliotheque_ratios_valeurs_vente_garde les
--     remplirait en silence avec les valeurs par défaut des Réglages.
--     ⇒ on les renseigne EXPLICITEMENT avec ces mêmes valeurs par défaut
--       (au 24/09 : coefficient « standard » 1,5 et taux « MO investisseur »
--       80 €/h), lues au moment de l'exécution. C'est ce que les reprises
--       des 15 et 16/09 ont donné aux ouvrages qui n'avaient choisi aucun
--       coefficient ni aucun taux — ces 59 n'en avaient choisi aucun. La
--       garde s'exécute normalement et valide (> 0) ; elle n'a rien à combler.
--       Si aucun défaut actif n'existe, le script s'arrête avec un message.
--
--  3. bibliotheque_ratios_colonnes_obsoletes_garde refuse toute insertion
--     avec coef_vente ou taux_marge_pct renseigné. Les sauvegardes n'ont pas
--     ces colonnes : elles restent NULL, la garde laisse passer.
--
--  4. bibliotheque_ratios_cadence_provenance marquerait « profero » toute
--     cadence insérée sans provenance. C'est exact ici : ces cadences ont été
--     saisies dans Profero avant le 14/09, l'import ProGBat date du 16/09.
--     ⇒ on écrit cadence_source = 'profero' explicitement (57 ouvrages sur
--       59 ont une cadence ; les 2 autres restent sans provenance).
--
--  AUCUNE garde n'est désactivée, contournée ni neutralisée : pas de
--  ALTER TABLE … DISABLE TRIGGER, pas de session_replication_role, pas de
--  réglage profero.cadence_import. Les trois gardes s'exécutent et acceptent.
--
-- ─── REJOUABLE ───────────────────────────────────────────────────────────────
-- Un identifiant déjà présent n'est pas réinséré (ni écrasé). Un identifiant
-- déjà archivé n'est pas ajouté deux fois. La liste des archives n'est
-- réécrite que si elle change. Une seconde exécution ne modifie rien et
-- repasse les mêmes contrôles.
--
-- ─── TOUT OU RIEN ────────────────────────────────────────────────────────────
-- Toute la logique est dans UN SEUL bloc DO, dans une transaction : si un
-- contrôle échoue, rien n'est écrit — ni ouvrage, ni archive.
--
-- ─── ANNULATION ──────────────────────────────────────────────────────────────
-- sql/202609_restauration_bibliotheque_14-09_annulation.sql
-- ============================================================================

begin;

do $$
declare
  c_auteur constant text :=
    'Codex — nettoyage bibliothèque hors Ouvrages V2 ou sans code (2026-09-14)';

  -- Les 59 identifiants supprimés le 14/09 ET cités par au moins un ouvrage de
  -- phasage au 24/09/2026. (Le script du 14/09 en a supprimé 68 : les 9
  -- autres ne sont cités par aucun chantier et restent supprimés.)
  -- Classés par identifiant ; entre parenthèses : ouvrages de chantier / chantiers.
  ids constant text[] := array[
    '57a0500e-2911-432a-9c66-ab9bcd5b9807', -- autre_1776722933492        Démolition cloisons briques/carreaux plâtre (10/3)
    'd1d07796-3823-47a9-baa4-af51c8bfd143', -- autre_1776723094686        Dépose WC au sol (2/2)
    '3659c0bb-0cf3-4b9f-bbcd-3ab5fbafe5e2', -- autre_1776723191632        Dépose lavabo sur colonne (1/1)
    'f8b98ba9-8668-4ccc-b5de-57514364ce71', -- autre_1776723247360        Dépose cuisine non équipée (1/1)
    'dba8b7e7-de60-497b-ab31-fc08bca7a1ea', -- autre_1777014509195        Traitement poutres anti-humidité (1/1)
    'fb705fd4-7f84-4e2c-b04d-a45ae3f0908d', -- autre_1777024500557        Obturation béton cellulaire (1/1)
    '9311d5dd-c4a9-4ac4-a836-185029bfa93b', -- autre_1778507830538        Abri garage à vélos (1/1)
    'afa3805b-5523-4804-a30f-9359b2c944f4', -- autre_1778509622672        Démolition cloisons plaque de plâtre (1/1)
    'ede57186-bf4d-4f7d-b7f8-6408308029c3', -- autre_1778509708413        Démolition parement collé (1/1)
    '3e05bcda-9445-466c-8222-fbaefae34d33', -- autre_1782974993519        E-001 Installation électrique T1 non chauffé (2/2)
    '52f36295-80a3-4e1a-ac48-8362d8183116', -- chauffe_eau_1776723984568  Chauffe-eau électrique 60 L (10/10)
    '3f7a7f7f-e34e-4bee-a9d9-a7f6daf56ecc', -- chauffe_eau_1776725314052  Compteur d'eau divisionnaire (10/10)
    '09051c8e-ce6d-40f3-9ef4-93beb8b2de10', -- chauffe_eau_1776743849357  Colonne de douche + mitigeur baignoire (1/1)
    'b689dd51-8401-4be8-a40c-b9049ba84e85', -- chauffe_eau_1777015838849  Lave-mains (1/1)
    'c210f005-d0f5-47aa-b96f-16b687e1f957', -- chauffe_eau_1777017057221  Alimentation/évacuation machine à laver (2/2)
    '42dba44b-bb2a-4989-aef4-1a7e447f7967', -- chauffe_eau_1777025551676  Vasque encastrée (2/2)
    '30d631ce-f584-498f-9a2a-76527643eb06', -- chauffe_eau_1778511527224  Arrivée d'eau lave-vaisselle (1/1)
    'fa920471-bc08-4cc3-82db-fc9342f27478', -- chauffe_eau_1779435934866  WC suspendu complet (1/1)
    '64dd0da9-6ea6-4c51-881c-ea453b06e748', -- cloison_1776723654453      Cloison séparative SAD (1/1)
    '534d2624-8167-4883-b5f3-057ab507fabc', -- cloison_1776723856566      Cloison distribution hydrofuge 2 ml (6/5)
    '03b7e951-c512-4bab-aa78-3ec8c433a9eb', -- cloison_1776780202737      Doublage BA13 + laine de verre 120 mm (6/5)
    'b232d988-e697-4cfa-973c-60643b8e16e2', -- cloison_1776780614047      Faux-plafond F530 isolé posé horizontalement (2/2)
    'e08620bc-d9f8-48dc-b78e-4c7ddbd90a58', -- cloison_1776782739038      Cloison distribution 2,93 ml (1/1)
    'fa16f016-154d-4472-a2fc-c7980696fdf2', -- cloison_1777015243524      Cloison distribution h 2,5 ml (4/3)
    '4d448589-5748-4acd-b97b-88132d3bce5b', -- cloison_1777026438228      Faux-plafond ossature bois (2/2)
    'c4fdd915-cf02-414f-a9cb-60a7110f8f4f', -- cloison_1779438313624      Faux-plafond F530 isolé (1/1)
    '63d3ffe0-04ec-497e-9521-53172a8a4a1f', -- d_molition_1779435184717   Dépose cuisine existante (1/1)
    'd4f83acb-e0cd-429c-82bd-08c295477d32', -- install_elec_1776725091458 VMC simple flux autoréglable (4/4)
    '05ea2e74-bc08-4ed5-abdb-ee379aa1fdb1', -- install_elec_1776779846338 Installation électrique T1+ chauffé (1/1)
    'd5b6de39-03cd-46a6-9561-4db3519acfbd', -- install_elec_1776840315850 Installation électrique T1 chauffé (2/2)
    '59d416cc-50dd-434f-9042-68301eecb8f5', -- install_elec_1777014757905 Aérateur extracteur 150 mm (1/1)
    'ed735405-e022-46fd-b426-03301f7ca2ec', -- install_elec_1777022811556 Installation électrique T2 chauffé (1/1)
    '1e8373a4-f629-483f-83c9-ee652bed2a89', -- install_elec_1777024197543 VMC simple flux hygroréglable (3/3)
    '5da2efee-80d6-476b-a4fc-aaa13b7ce579', -- install_elec_1778507575861 Goulotte 40x60 (1/1)
    '2670e12a-6439-466f-93cd-8326cb0cb63a', -- install_elec_1778507985792 Goulotte 82x130 (1/1)
    'b60a769f-1328-44ea-aa5d-2b084271757e', -- install_elec_1778508161760 GTL (1/1)
    '850b2942-5a87-4f33-9878-35f80e3dd51f', -- install_elec_1778510789908 Tableau de protections (1/1)
    'ca6f9b56-1a7c-4dbf-96cd-1b27bee73ca4', -- install_elec_1778511087605 Ligne dédiée four 32 A (1/1)
    '67a74647-6bd6-4af8-9805-fa2bd5c66d9a', -- install_elec_1778511243534 Prise de courant 2P+T (1/1)
    '3b840a45-37c4-40ce-9be7-d29509d8f3e4', -- install_elec_1778511403692 Changement prise double (1/1)
    '16699eed-2daf-470d-bf45-162f4a4744d0', -- install_elec_t3_avec_chauf Installation électrique T3 chauffé (3/3)
    '551f4fbd-2160-4a51-9fa3-ee57cb3b3c5a', -- MAC_1778510010146          Dalle béton BPS (1/1)
    '5866389f-bdd4-42f3-ab43-2a24892f5291', -- MUR_1778506921835          Décollage tapisserie (1/1)
    'aa0fe462-8bb7-426a-86ee-9682206ff221', -- MUR_1778507369863          MU-001 Toile de verre (2/2)
    '1e874758-c82d-4998-b2bb-3730121b081c', -- MUR_1778510264903          Parquet PVC clipsable (1/1)
    '74659fbf-a336-45b2-b0ca-95f2ce42c6fd', -- peinture_1776723361608     Revêtement plastique pose libre (3/3)
    '2e747179-da0f-4e56-b30c-fca298a6f7e3', -- peinture_1776724154523     Cuisine équipée Eleki (5/5)
    '4c065ea8-451f-4061-ba32-f01948363686', -- peinture_1776725704355     Faïence murale 30x60 (3/3)
    'fd17c0ba-65e4-432a-adcd-130e029552c0', -- peinture_1776797419109     Peinture plafond mate (2/2)
    'e6f9a484-d3fa-4746-8809-413a8a2666d2', -- peinture_e6f9a484-…        Peinture finition C sur plaques (1/1)
    '8d179fa8-0b2f-445d-aa6d-c0147ea314c8', -- porte_1776780975155        Porte palière coupe-feu (6/6)
    'd9fb2cc1-f2c5-4e39-a30d-d9804225d7ff', -- porte_1776783031879        Porte intérieure isoplane (4/4)
    '76af0d8f-7d06-4502-b242-2d74fb5bdabb', -- porte_1777023713416        Fenêtre bois double vantail (8/5)
    'f516846f-7f79-4cf1-96b0-9a9840132e66', -- porte_1777025340915        Escalier quart tournant (1/1)
    '7cbcb234-101a-4e39-b286-e20789d22602', -- porte_1777025700287        Plancher OSB 18 mm (3/2)
    'e5226f55-da20-4288-9920-93c5f31805e7', -- porte_1777026254479        Plancher solives + OSB (1/1)
    '018f5390-0599-4589-81fd-bf22264b1986', -- porte_1777026591916        Fixations renforcement poutres (1/1)
    '2d6a6dbb-2104-413f-8f9b-1aa062fbc1c5', -- porte_1777026636175        Échelle mezzanine (1/1)
    '202f4391-ad4c-4475-8e06-ba5e6caff87e'  -- porte_1778511701006        Vernis escalier (1/1)
  ];

  -- Les 4 identifiants cités par des chantiers mais absents des sauvegardes
  -- du 14/09 : ils ne sont PAS restaurés (voir la fin du fichier).
  introuvables constant text[] := array[
    '0753c8ad-6721-4cbe-9486-dd47a3856ff7',
    '3c98148e-c0e4-4841-8104-720987ae5f82',
    '64ed05c5-71cc-4645-a631-62795ceda7a4',
    '8e1cba47-7514-491d-94c7-3371b39bc560'
  ];

  -- Orphelins attendus après restauration : les 13 ouvrages de chantier qui
  -- pointent vers les 4 introuvables (mesure du 24/09/2026).
  c_orphelins_attendus constant int := 13;

  -- Colonnes présentes dans les sauvegardes du 14/09. Toute autre clé serait
  -- une donnée qu'on perdrait sans le dire : le script refuse de continuer.
  cles_connues constant text[] := array[
    'id', 'identifiant', 'libelle', 'unite', 'sous_taches',
    'updated_at', 'cadence', 'materiaux_liens'
  ];

  v_coef        numeric;
  v_taux        numeric;
  n_sauvegardes int;
  n_deja        int;
  n_inseres     int;
  n_presents    int;
  n_archives    int;
  n_cles_inconnues int;
  orph_avant    int;
  orph_apres    int;
  orph_hors_introuvables int;
  cfg           jsonb;
  items_avant   text[];
  items_apres   text[];
begin
  -- ── 0. La liste elle-même ──────────────────────────────────────────────────
  if cardinality(ids) <> 59 or (select count(distinct x) from unnest(ids) x) <> 59 then
    raise exception 'Liste interne incohérente : 59 identifiants distincts attendus.';
  end if;

  -- ── 1. La source : une sauvegarde DELETE du 14/09 pour chacun des 59 ───────
  select count(distinct h.row_id) into n_sauvegardes
    from public.data_history h
   where h.table_name = 'bibliotheque_ratios' and h.op = 'DELETE'
     and h.changed_by = c_auteur and h.row_id = any(ids);
  if n_sauvegardes <> 59 then
    raise exception 'Sauvegardes du 14/09 : % trouvée(s) sur 59. Rien n''est restauré.', n_sauvegardes;
  end if;

  select count(*) into n_cles_inconnues
    from public.data_history h, jsonb_object_keys(h.row_data) k
   where h.table_name = 'bibliotheque_ratios' and h.op = 'DELETE'
     and h.changed_by = c_auteur and h.row_id = any(ids)
     and k <> all(cles_connues);
  if n_cles_inconnues > 0 then
    raise exception 'Les sauvegardes contiennent % valeur(s) de colonne non prévue(s) par ce script : elles seraient perdues. Rien n''est restauré.', n_cles_inconnues;
  end if;

  -- ── 2. Valeurs de vente par défaut (Réglages) ──────────────────────────────
  select c.valeur into v_coef
    from public.coefficients_vente c where c.est_defaut and c.actif limit 1;
  select t.taux_ht into v_taux
    from public.taux_horaires_vente t where t.est_defaut and t.actif limit 1;
  if v_coef is null or v_taux is null then
    raise exception 'Aucun coefficient de vente ou taux horaire par défaut actif dans les Réglages : impossible de compléter les ouvrages restaurés. Rien n''est restauré.';
  end if;

  -- ── 3. Mesure avant ────────────────────────────────────────────────────────
  select count(*) into orph_avant
    from public.phasages p,
         jsonb_array_elements(case when jsonb_typeof(p.ouvrages) = 'array' then p.ouvrages else '[]'::jsonb end) o
   where coalesce(o->>'bibliotheque_id', '') <> ''
     and not exists (select 1 from public.bibliotheque_ratios b where b.id::text = o->>'bibliotheque_id');

  select count(*) into n_deja
    from public.bibliotheque_ratios b where b.id::text = any(ids);

  -- ── 4. Réinsertion, avec les identifiants d'origine ───────────────────────
  -- Colonnes listées une à une : celles qui n'existaient pas le 14/09 prennent
  -- leur valeur par défaut (main_oeuvre_seule = false, identifiants de
  -- référentiel NULL, colonnes ProGBat NULL), sauf les trois renseignées
  -- ci-dessous pour les raisons données en tête de fichier.
  insert into public.bibliotheque_ratios (
    id, identifiant, libelle, unite, sous_taches, updated_at, cadence, materiaux_liens,
    cadence_source, coefficient_vente_valeur, taux_horaire_vente_valeur
  )
  select r.id, r.identifiant, r.libelle, r.unite, r.sous_taches, r.updated_at, r.cadence, r.materiaux_liens,
         case when r.cadence is not null then 'profero' end,
         v_coef, v_taux
    from (
      select distinct on (h.row_id) h.row_data
        from public.data_history h
       where h.table_name = 'bibliotheque_ratios' and h.op = 'DELETE'
         and h.changed_by = c_auteur and h.row_id = any(ids)
       order by h.row_id, h.saved_at desc
    ) s
    cross join lateral jsonb_populate_record(null::public.bibliotheque_ratios, s.row_data) r
   where not exists (select 1 from public.bibliotheque_ratios b where b.id = r.id)
  on conflict (id) do nothing;
  get diagnostics n_inseres = row_count;

  -- ── 5. Archivage (même clé et même forme que le bouton « Archiver ») ──────
  -- La ligne est créée vide si elle n'existe pas, puis verrouillée : une
  -- écriture simultanée depuis l'application ne peut pas être écrasée.
  insert into public.planning_config (key, value, updated_at)
  values ('bibliotheque_archives', '{"items": []}'::jsonb, now())
  on conflict (key) do nothing;

  select pc.value into cfg
    from public.planning_config pc where pc.key = 'bibliotheque_archives'
     for update;

  -- Même règle que archivesBibliothequeV1 : une liste illisible n'est JAMAIS
  -- remplacée — on ne sait pas ce qu'elle contenait.
  if cfg is not null and (jsonb_typeof(cfg) <> 'object' or jsonb_typeof(cfg->'items') <> 'array') then
    raise exception 'planning_config.bibliotheque_archives a une forme inattendue : on ne l''écrase pas. Rien n''est restauré.';
  end if;

  select coalesce(array_agg(v order by ord), array[]::text[]) into items_avant
    from (
      select btrim(e) v, min(ord) ord
        from jsonb_array_elements_text(coalesce(cfg->'items', '[]'::jsonb)) with ordinality as t(e, ord)
       where btrim(e) <> ''
       group by btrim(e)
    ) x;

  -- Les archivés existants d'abord, dans leur ordre ; puis les 59 manquants.
  items_apres := items_avant || coalesce(
    (select array_agg(i order by i) from unnest(ids) i where i <> all(items_avant)),
    array[]::text[]);

  -- Réécriture seulement s'il manque un identifiant : une seconde exécution
  -- n'écrit rien (pas de mise à jour, pas d'événement temps réel).
  if cardinality(items_apres) > cardinality(items_avant) then
    update public.planning_config
       set value = coalesce(cfg, '{}'::jsonb) || jsonb_build_object('items', to_jsonb(items_apres)),
           updated_at = now()
     where key = 'bibliotheque_archives';
  end if;

  -- ── 6. Contrôles finaux — un seul échec annule tout ───────────────────────
  select count(*) into n_presents
    from public.bibliotheque_ratios b where b.id::text = any(ids);
  if n_presents <> 59 then
    raise exception 'Contrôle : % ouvrage(s) présent(s) sur 59. Tout est annulé.', n_presents;
  end if;

  select count(distinct btrim(e)) into n_archives
    from public.planning_config pc, jsonb_array_elements_text(pc.value->'items') e
   where pc.key = 'bibliotheque_archives' and btrim(e) = any(ids);
  if n_archives <> 59 then
    raise exception 'Contrôle : % identifiant(s) archivé(s) sur 59. Tout est annulé.', n_archives;
  end if;

  select count(*),
         count(*) filter (where not (o->>'bibliotheque_id' = any(introuvables)))
    into orph_apres, orph_hors_introuvables
    from public.phasages p,
         jsonb_array_elements(case when jsonb_typeof(p.ouvrages) = 'array' then p.ouvrages else '[]'::jsonb end) o
   where coalesce(o->>'bibliotheque_id', '') <> ''
     and not exists (select 1 from public.bibliotheque_ratios b where b.id::text = o->>'bibliotheque_id');

  if orph_hors_introuvables > 0 then
    raise exception 'Contrôle : % ouvrage(s) de chantier orphelin(s) hors des 4 introuvables connus — un phasage a changé depuis le 24/09, re-mesurer avant d''appliquer. Tout est annulé.', orph_hors_introuvables;
  end if;
  if orph_apres <> c_orphelins_attendus then
    raise exception 'Contrôle : % ouvrage(s) de chantier orphelin(s) après restauration, % attendu(s) — un phasage a changé depuis le 24/09, re-mesurer avant d''appliquer. Tout est annulé.', orph_apres, c_orphelins_attendus;
  end if;

  raise notice 'Restauration bibliothèque 14/09 : % réinséré(s), % déjà présent(s) avant ce script ; 59/59 présents ; 59/59 archivés (% archivé(s) au total).',
    n_inseres, n_deja, cardinality(items_apres);
  raise notice 'Coefficient de vente % et taux horaire % €/h appliqués aux ouvrages réinsérés (valeurs par défaut des Réglages).',
    v_coef, v_taux;
  raise notice 'Ouvrages de chantier orphelins : % avant, % après (tous rattachés aux 4 identifiants introuvables).',
    orph_avant, orph_apres;
end $$;

commit;

-- ============================================================================
-- LES 4 IDENTIFIANTS INTROUVABLES (non restaurés, mesure du 24/09/2026)
-- ============================================================================
-- Aucun n'a de sauvegarde DELETE dans data_history : ils ont été supprimés
-- sans laisser de trace, avant que la suppression d'un ouvrage utilisé ne
-- soit bloquée (PR #24).
--
--   8e1cba47-7514-491d-94c7-3371b39bc560  10 ouvrages sur 10 chantiers
--       peinture mate murs/plafonds (libellés variés selon les chantiers)
--       14 BOULEVARD DU ROI RENÉ, BRIOLLAY APPT 1 à 5, GILDAS BAUGE 2,
--       TOM & CAMILLE RDC / R+1 / R+2
--       Aucune trace dans data_history.
--
--   0753c8ad-6721-4cbe-9486-dd47a3856ff7  1 ouvrage — LOUISON APPT 2 (T2)
--       P-910 receveur de douche 80 x 80
--       PAS supprimé le 14/09, mais DEUX copies partielles existent : sauvegardes
--       UPDATE du 27/08/2026 (identifiant ouvrages_v2_1787068938948), prises par
--       les scripts planning-model-v1 AVANT deux modifications. L'état final de
--       l'ouvrage (après la seconde modification du 27/08) n'est conservé nulle
--       part. Récupérable en partie, sur décision : hors du périmètre de ce script.
--
--   3c98148e-c0e4-4841-8104-720987ae5f82  1 ouvrage — FOURMOND 001
--       ME-023 porte-fenêtre avec volet roulant PVC
--       Aucune trace dans data_history.
--
--   64ed05c5-71cc-4645-a631-62795ceda7a4  1 ouvrage — LOUISON APPT 1 (T2)
--       P-930 receveur de douche 90 x 90
--       Aucune trace dans data_history.
--
-- Total : 13 ouvrages de chantier, qui resteront orphelins.
-- ============================================================================
