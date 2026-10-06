-- =====================================================================
-- COMPTE RENDU DU SOIR — Bêta « Nouveau compte rendu » (cr_v2), étape 2
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller).
-- Idempotent : add column if not exists. Aucune donnée modifiée.
--
-- Deux colonnes FACULTATIVES sur rapports, remplies UNIQUEMENT par le
-- nouveau formulaire. L'ancien formulaire ne les envoie pas : ses rapports
-- restent identiques (les deux colonnes y valent null).
--
--   formulaire_version  'v2' pour un rapport du formulaire bêta — sert à
--                       filtrer les rapports bêta (statistiques, repère
--                       « Formulaire bêta » de la Validation).
--   saisie_debut_le     heure de la PREMIÈRE saisie de la journée (gardée
--                       dans le brouillon), identique sur les rapports des
--                       différents chantiers du jour. Avec submitted_at, elle
--                       mesure le temps de remplissage.
--
-- Droits : rapports porte des droits de TABLE pour anon et authenticated ;
-- les nouvelles colonnes en héritent, rien à accorder. Les policies
-- (ouvrier = son prénom-planning) ne regardent pas ces colonnes.
-- Historique : le déclencheur data_history recopie la ligne entière, il les
-- suit sans modification.
--
-- Tant que ce fichier n'est pas appliqué, le nouveau formulaire envoie quand
-- même : il retire ces deux colonnes de l'insert si la base ne les connaît
-- pas (même mécanisme que trajet_* et photos_chantier).
--
-- À appliquer AUSSI : sql/202610_ouvrier_mes_phases.sql (version du
-- 06/10/2026), qui ouvre ouvrier_mes_phases aux testeurs « cr_v2 » et
-- renvoie le dernier motif de dépassement de chaque tâche.
-- =====================================================================

alter table public.rapports
  add column if not exists formulaire_version text,
  add column if not exists saisie_debut_le    timestamptz;

comment on column public.rapports.formulaire_version is
  'Version du formulaire de compte rendu qui a créé le rapport : ''v2'' = formulaire bêta (cr_v2) ; null = ancien formulaire.';
comment on column public.rapports.saisie_debut_le is
  'Heure de la première saisie de la journée dans le formulaire bêta (mesure du temps de remplissage). Null pour l''ancien formulaire.';

-- =====================================================================
-- VÉRIFICATION — voir scripts/verif-compte-rendu-v2.sql
-- =====================================================================
