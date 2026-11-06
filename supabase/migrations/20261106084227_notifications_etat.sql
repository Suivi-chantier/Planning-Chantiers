-- ============================================================================
-- Notifications sur téléphone (push PWA) — état déjà notifié, table GÉNÉRIQUE.
--
-- public.notifications_etat : une ligne = un objet métier déjà notifié pour un
-- type du catalogue. Sert à notifier un CHANGEMENT d'état une seule fois, même
-- quand plusieurs objets sont regroupés dans une seule notification (règle 5).
--   - F1 (tâche 7) : cle_objet = « <phasage>-<échéance> », inscrite après une
--     écriture réussie en boîte de réception ; une échéance inscrite n'est
--     plus jamais renotifiée.
--   - C4 / C5 / D1 (tâche 6) : réutilisable pour le dernier niveau d'alerte
--     notifié par chantier (etat = niveau).
--
-- Accès : AUCUNE policy d'ouverture. Seule la policy restrictive « réservé aux
-- collaborateurs » est posée (invariant CLAUDE.md). Seul le serveur (jobs du
-- dispatcher, clé service role) lit et écrit cette table.
-- Aucune fonction, aucune fonction SECURITY DEFINER.
-- Purement additive : une nouvelle table, aucune donnée existante touchée.
-- ============================================================================
create table if not exists public.notifications_etat (
  type        text not null check (type in ('C1','C2','C3','C4','C5','F1','F2','D1','D2','D3','D4')),
  cle_objet   text not null check (char_length(cle_objet) between 1 and 300),
  etat        text,
  notifie_le  timestamptz not null default now(),
  maj_le      timestamptz not null default now(),
  primary key (type, cle_objet)
);
comment on table public.notifications_etat is
  'État déjà notifié par type et par objet (F1 : échéance de facturation ; C4/C5/D1 : niveau d''alerte). Accès serveur seulement (service role). Projet notifications-push.';

alter table public.notifications_etat enable row level security;
revoke all on public.notifications_etat from anon;
revoke all on public.notifications_etat from authenticated;
grant all on public.notifications_etat to service_role;

drop policy if exists profero_collaborateurs_seulement on public.notifications_etat;
create policy profero_collaborateurs_seulement on public.notifications_etat
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));
