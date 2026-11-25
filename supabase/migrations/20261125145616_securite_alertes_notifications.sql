-- ============================================================================
-- Fiche sécurité chantier — tâche 7b : alertes dans la boîte de réception.
-- Projet docs/projets/fiche-securite-chantier.md ; accord de François du
-- 25/11/2026 (« 3 oui » : modification de la table notifications et tâche
-- planifiée).
--
-- Même mécanisme que les notifications existantes (aucun nouveau modèle) :
--   1. les types S1 (alertes fiche sécurité, admin + conducteur) et S2
--      (aptitude médicale expirée, administrateurs seulement) sont ajoutés aux
--      contrôles de type de public.notifications et public.notifications_etat
--      (liste fermée, comme C1…D4). Les lignes existantes ne changent pas :
--      le contrôle est seulement élargi ;
--   2. un job pg_cron appelle le dispatcher Vercel
--      (?job=alertes_securite&pas_avant=7), exactement comme les 7 jobs
--      « profero_push_* » de 20261109134233_cron_notifications_push.sql :
--      7h35 Paris les jours ouvrés, été comme hiver (deux heures UTC, la
--      commande ne fait rien si l'heure de Paris n'est pas 7h), clé lue dans
--      le Vault (`cron_secret`), jamais écrite ici.
-- Le calcul des alertes vit dans l'appli (src/Renovation/securiteCycleVie.mjs,
-- alertesSecurite) et le job serveur api/_cron/cron-alertes-securite.js : aucune
-- règle recopiée en SQL (« même chiffre = même service »).
--
-- Droits : AUCUN changement. Aucune table, aucune policy, aucun GRANT, aucune
-- fonction (ni SECURITY DEFINER). notifications et notifications_etat restent
-- fermées au navigateur ; seul le serveur (service role) y écrit.
-- invest_dossier_etapes n'est pas concernée.
-- ============================================================================

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('C1','C2','C3','C4','C5','F1','F2','D1','D2','D3','D4','S1','S2','test'));

alter table public.notifications_etat drop constraint if exists notifications_etat_type_check;
alter table public.notifications_etat add constraint notifications_etat_type_check
  check (type in ('C1','C2','C3','C4','C5','F1','F2','D1','D2','D3','D4','S1','S2'));

select cron.unschedule(jobname)
from cron.job
where jobname = 'profero_push_alertes_securite';

-- Alertes fiche sécurité (S1, S2) : 7h35 Paris, jours ouvrés.
-- 05h35 UTC = 7h35 en été ; 06h35 UTC = 7h35 en hiver.
select cron.schedule(
  'profero_push_alertes_securite',
  '35 5,6 * * 1-5',
  $cmd$
do $do$
declare v_secret text;
begin
  if extract(hour from (now() at time zone 'Europe/Paris')) <> 7 then
    return; -- passage de l'autre saison : rien à faire
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if coalesce(v_secret, '') = '' then
    raise exception 'profero_push_alertes_securite : secret cron_secret absent du Vault, aucun appel envoyé';
  end if;
  perform net.http_get(
    url := 'https://planning-chantiers.vercel.app/api/cron-dispatcher?job=alertes_securite&pas_avant=7',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 120000
  );
end
$do$;
$cmd$
);
