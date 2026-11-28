-- Rapprochement factures : correction des policies qui identifiaient
-- l'utilisateur par `utilisateurs.id = auth.uid()`.
--
-- Chez Profero, `utilisateurs.id` n'est jamais égal à `auth.uid()` : le lien
-- entre `utilisateurs` et `auth.users` se fait par e-mail (vérifié en base le
-- 28/11/2026 : 0 utilisateur sur 20 avec le même id, 18 avec le même e-mail).
-- Conséquence : tous les envois dans le bucket `factures-privees` et toutes
-- les écritures dans `facture_frais` étaient refusés (bucket vide depuis sa
-- création le 15/10/2026, table vide).
--
-- On ne remplace PAS le filtre par `est_collaborateur_actif()` seul : cette
-- fonction renvoie vrai pour tout utilisateur actif, ouvriers compris. Les
-- factures privées restent réservées aux rôles admin, conducteur, bureau,
-- comptable ; le rôle est désormais lu par e-mail (comme
-- `acces_collaborateur_autorise`).
--
-- Seules autres policies de la base contenant `auth.uid()` : elles comparent
-- `auth.uid()` à des colonnes qui stockent bien un id auth (auteur_uid,
-- lecteur_uid, auth_user_id, created_by, dossier = uid) — pas concernées.

drop policy if exists factures_privees_collaborateurs on storage.objects;
create policy factures_privees_collaborateurs on storage.objects
  as permissive for all to authenticated
  using (
    bucket_id = 'factures-privees'
    and (select public.est_collaborateur_actif())
    and exists (
      select 1 from public.utilisateurs u
      where lower(btrim(u.email)) = lower(btrim(coalesce((select auth.jwt()) ->> 'email', '')))
        and u.actif is true
        and u.role = any (array['admin','conducteur','bureau','comptable'])
    )
  )
  with check (
    bucket_id = 'factures-privees'
    and (select public.est_collaborateur_actif())
    and exists (
      select 1 from public.utilisateurs u
      where lower(btrim(u.email)) = lower(btrim(coalesce((select auth.jwt()) ->> 'email', '')))
        and u.actif is true
        and u.role = any (array['admin','conducteur','bureau','comptable'])
    )
  );

drop policy if exists facture_frais_collaborateurs on public.facture_frais;
create policy facture_frais_collaborateurs on public.facture_frais
  as permissive for all to authenticated
  using (
    (select public.est_collaborateur_actif())
    and exists (
      select 1 from public.utilisateurs u
      where lower(btrim(u.email)) = lower(btrim(coalesce((select auth.jwt()) ->> 'email', '')))
        and u.actif is true
        and u.role = any (array['admin','conducteur','bureau','comptable'])
    )
  )
  with check (
    (select public.est_collaborateur_actif())
    and exists (
      select 1 from public.utilisateurs u
      where lower(btrim(u.email)) = lower(btrim(coalesce((select auth.jwt()) ->> 'email', '')))
        and u.actif is true
        and u.role = any (array['admin','conducteur','bureau','comptable'])
    )
  );

-- Invariant « Réservé aux collaborateurs » : facture_frais ne portait pas
-- encore la policy RESTRICTIVE commune.
drop policy if exists profero_collaborateurs_seulement on public.facture_frais;
create policy profero_collaborateurs_seulement on public.facture_frais
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif()))
  with check ((select public.est_collaborateur_actif()));
