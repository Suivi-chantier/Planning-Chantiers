-- Notifications sur téléphone : déclenchement par la base, à la minute près.
--
-- Pourquoi : les créneaux GitHub Actions (« schedule ») des 7 notifications
-- n'ont jamais tourné, et les plus anciens partent avec des heures de retard
-- (GitHub ne garantit pas l'heure). Décision de François : c'est la base
-- Supabase qui appelle le dispatcher, avec pg_cron + pg_net (déjà utilisés par
-- les jobs ProGBat).
--
-- Heure de Paris, été comme hiver : pg_cron tourne en UTC (cron.timezone =
-- GMT sur Supabase). Chaque job est planifié sur les DEUX heures UTC possibles
-- (été et hiver), et sa commande ne fait rien si l'heure de Paris
-- (now() at time zone 'Europe/Paris') n'est pas l'heure voulue. Un seul des
-- deux passages appelle donc le dispatcher, à l'heure exacte. Le paramètre
-- `pas_avant` des anciens créneaux est conservé en seconde garde, côté
-- dispatcher.
--
-- Secret : la clé est lue au moment de l'appel dans Supabase Vault, sous le
-- nom `cron_secret` (saisie par François, jamais écrite dans le dépôt). La
-- valeur à y saisir est celle de CRON_SECRET_BASE (variable Vercel distincte,
-- acceptée par le seul dispatcher), PAS celle de CRON_SECRET, dont la valeur
-- n'est plus lisible dans Vercel. (Commentaire mis à jour après application de
-- la migration : le SQL ci-dessous est inchangé.) Les
-- jobs pg_cron tournent en tant que postgres, qui lit vault.decrypted_secrets
-- sans fonction SECURITY DEFINER (même mécanisme que progbat-billing-sync).
-- Secret absent ou vide : AUCUN appel, et le passage échoue avec un message
-- clair dans cron.job_run_details (jamais silencieux).
--
-- Contenu : uniquement des planifications cron (aucune table, aucune policy,
-- aucune fonction). Idempotent : chaque job est déplanifié s'il existe déjà,
-- puis replanifié.

select cron.unschedule(jobname)
from cron.job
where jobname in (
  'profero_push_reportes',
  'profero_push_materiaux',
  'profero_push_factures_a_emettre',
  'profero_push_synthese_semaine',
  'profero_push_nouveaux_chantiers',
  'profero_push_alertes_chantiers',
  'profero_push_point_conducteurs'
);

-- Notifications reportées par la plage de silence : 7h05 Paris, jours ouvrés.
-- 05h05 UTC = 7h05 en été ; 06h05 UTC = 7h05 en hiver.
select cron.schedule(
  'profero_push_reportes',
  '5 5,6 * * 1-5',
  $cmd$
do $do$
declare v_secret text;
begin
  if extract(hour from (now() at time zone 'Europe/Paris')) <> 7 then
    return; -- passage de l'autre saison : rien à faire
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if coalesce(v_secret, '') = '' then
    raise exception 'profero_push_reportes : secret cron_secret absent du Vault, aucun appel envoyé';
  end if;
  perform net.http_get(
    url := 'https://planning-chantiers.vercel.app/api/cron-dispatcher?job=push_reportes',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 120000
  );
end
$do$;
$cmd$
);

-- Commandes à passer (C3) : 8h05 Paris, jours ouvrés.
-- 06h05 UTC = 8h05 en été ; 07h05 UTC = 8h05 en hiver.
select cron.schedule(
  'profero_push_materiaux',
  '5 6,7 * * 1-5',
  $cmd$
do $do$
declare v_secret text;
begin
  if extract(hour from (now() at time zone 'Europe/Paris')) <> 8 then
    return; -- passage de l'autre saison : rien à faire
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if coalesce(v_secret, '') = '' then
    raise exception 'profero_push_materiaux : secret cron_secret absent du Vault, aucun appel envoyé';
  end if;
  perform net.http_get(
    url := 'https://planning-chantiers.vercel.app/api/cron-dispatcher?job=push_materiaux',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 120000
  );
end
$do$;
$cmd$
);

-- Facture à émettre (F1) : 8h15 Paris, jours ouvrés.
-- 06h15 UTC = 8h15 en été ; 07h15 UTC = 8h15 en hiver.
select cron.schedule(
  'profero_push_factures_a_emettre',
  '15 6,7 * * 1-5',
  $cmd$
do $do$
declare v_secret text;
begin
  if extract(hour from (now() at time zone 'Europe/Paris')) <> 8 then
    return; -- passage de l'autre saison : rien à faire
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if coalesce(v_secret, '') = '' then
    raise exception 'profero_push_factures_a_emettre : secret cron_secret absent du Vault, aucun appel envoyé';
  end if;
  perform net.http_get(
    url := 'https://planning-chantiers.vercel.app/api/cron-dispatcher?job=factures_a_emettre&pas_avant=8',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 120000
  );
end
$do$;
$cmd$
);

-- Synthèse de la semaine (D3) : lundi 8h30 Paris.
-- 06h30 UTC = 8h30 en été ; 07h30 UTC = 8h30 en hiver.
select cron.schedule(
  'profero_push_synthese_semaine',
  '30 6,7 * * 1',
  $cmd$
do $do$
declare v_secret text;
begin
  if extract(hour from (now() at time zone 'Europe/Paris')) <> 8 then
    return; -- passage de l'autre saison : rien à faire
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if coalesce(v_secret, '') = '' then
    raise exception 'profero_push_synthese_semaine : secret cron_secret absent du Vault, aucun appel envoyé';
  end if;
  perform net.http_get(
    url := 'https://planning-chantiers.vercel.app/api/cron-dispatcher?job=synthese_semaine&pas_avant=8',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 120000
  );
end
$do$;
$cmd$
);

-- Nouveau chantier signé (D2) : 8h45 Paris, jours ouvrés.
-- 06h45 UTC = 8h45 en été ; 07h45 UTC = 8h45 en hiver.
select cron.schedule(
  'profero_push_nouveaux_chantiers',
  '45 6,7 * * 1-5',
  $cmd$
do $do$
declare v_secret text;
begin
  if extract(hour from (now() at time zone 'Europe/Paris')) <> 8 then
    return; -- passage de l'autre saison : rien à faire
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if coalesce(v_secret, '') = '' then
    raise exception 'profero_push_nouveaux_chantiers : secret cron_secret absent du Vault, aucun appel envoyé';
  end if;
  perform net.http_get(
    url := 'https://planning-chantiers.vercel.app/api/cron-dispatcher?job=nouveaux_chantiers&pas_avant=8',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 120000
  );
end
$do$;
$cmd$
);

-- Alertes chantiers (C4, C5, D1) : 9h05 Paris, jours ouvrés.
-- 07h05 UTC = 9h05 en été ; 08h05 UTC = 9h05 en hiver.
select cron.schedule(
  'profero_push_alertes_chantiers',
  '5 7,8 * * 1-5',
  $cmd$
do $do$
declare v_secret text;
begin
  if extract(hour from (now() at time zone 'Europe/Paris')) <> 9 then
    return; -- passage de l'autre saison : rien à faire
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if coalesce(v_secret, '') = '' then
    raise exception 'profero_push_alertes_chantiers : secret cron_secret absent du Vault, aucun appel envoyé';
  end if;
  perform net.http_get(
    url := 'https://planning-chantiers.vercel.app/api/cron-dispatcher?job=alertes_chantiers&pas_avant=9',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 120000
  );
end
$do$;
$cmd$
);

-- Point du soir des conducteurs (C1 + C2) : 18h30 Paris, jours ouvrés.
-- 16h30 UTC = 18h30 en été ; 17h30 UTC = 18h30 en hiver.
select cron.schedule(
  'profero_push_point_conducteurs',
  '30 16,17 * * 1-5',
  $cmd$
do $do$
declare v_secret text;
begin
  if extract(hour from (now() at time zone 'Europe/Paris')) <> 18 then
    return; -- passage de l'autre saison : rien à faire
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if coalesce(v_secret, '') = '' then
    raise exception 'profero_push_point_conducteurs : secret cron_secret absent du Vault, aucun appel envoyé';
  end if;
  perform net.http_get(
    url := 'https://planning-chantiers.vercel.app/api/cron-dispatcher?job=point_conducteurs&pas_avant=18:30',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 120000
  );
end
$do$;
$cmd$
);
