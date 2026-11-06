-- ============================================================================
-- Retour arrière du lot 3 de la Refonte Opérations (cycle de vie 5 phases,
-- relances). À n'exécuter qu'après avoir annulé la demande de fusion du lot 3.
--
-- Rien n'est supprimé : les deux tables du lot 3 sont RENOMMÉES en
-- *_sauvegarde_refonte (elles gardent leurs policies, dont
-- profero_collaborateurs_seulement) et ne sont plus lues par l'ancien code.
-- Les états de l'ancien cycle (phasages.plan_travaux.meta.cycle_vie_etapes)
-- n'ont jamais été modifiés par le lot 3 : l'ancien écran les retrouve tels
-- quels. Les validations faites APRÈS la mise en ligne du lot 3 restent
-- lisibles dans chantier_cycle_vie_sauvegarde_refonte.
-- La clé planning_config « relances_cycle_vie » est éteinte (actif = false).
-- ============================================================================
begin;
alter table public.chantier_cycle_vie rename to chantier_cycle_vie_sauvegarde_refonte;
alter table public.relances_cycle_vie rename to relances_cycle_vie_sauvegarde_refonte;
update public.planning_config
   set value = jsonb_set(coalesce(value, '{}'::jsonb), '{actif}', 'false'::jsonb)
 where key = 'relances_cycle_vie';
commit;
