-- Un brouillon ProGBat supprimé CHEZ EUX laissait Profero verrouillé : la ligne
-- progbat_quote_exports restait en 'created' et l'index unique partiel
-- interdisait toute nouvelle création pour le logement.
--
-- Statut ajouté : 'absent' — ProGBat a répondu 404 à la lecture du devis, donc
-- il n'existe plus. Il est volontairement HORS de l'index d'unicité
-- (creating/created/uncertain), ce qui rend une nouvelle création possible.
--
-- Le verrou n'est jamais levé sur la seule affirmation de l'utilisateur : il
-- faut ce 404 de ProGBat. Une erreur de lecture (réseau, 401, 5xx) ne libère
-- rien, l'action verifier_existant de l'Edge Function progbat-quote s'en
-- assure.

alter table public.progbat_quote_exports
  drop constraint if exists progbat_quote_exports_statut_check;
alter table public.progbat_quote_exports
  add constraint progbat_quote_exports_statut_check
  check (statut in ('preparing', 'creating', 'created', 'failed', 'uncertain', 'absent'));
