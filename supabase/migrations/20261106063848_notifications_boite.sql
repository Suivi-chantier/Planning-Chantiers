-- ============================================================================
-- Notifications sur téléphone (push PWA) — tâche 2 : boîte de réception et
-- préférences par utilisateur.
--
-- 1. public.notifications : une ligne = une notification reçue par une
--    personne (ce qui est envoyé reste consultable dans l'application, même si
--    le téléphone était éteint ou les notifications refusées). push_statut dit
--    ce qu'il est advenu du push : envoyé, reporté (plage de silence, part à
--    push_prevu_le), aucun appareil, préférence coupée, serveur non
--    configuré… jamais un faux « envoyé ».
--    Regroupement : l'index unique (user_id, type, cle_regroupement) empêche
--    tout doublon quand le même envoi est rejoué (une notification par type et
--    par créneau). Une clé vide (notification de test) n'est jamais regroupée.
-- 2. public.notifications_preferences : par utilisateur, les types qu'il a
--    coupés ({"C1": false, …}). Absent = tout activé (règle 6 du projet).
--
-- Les RÉGLAGES (interrupteur général, rôles par type, plage de silence) ne
-- sont pas ici : ils vivent dans planning_config, clé « notifications_push »,
-- absente à la livraison (= valeurs par défaut, interrupteur COUPÉ).
--
-- Accès (journal du projet, 06/11/2026) : AUCUNE policy d'ouverture. Seule la
-- policy restrictive « réservé aux collaborateurs » est posée (invariant
-- CLAUDE.md). Le navigateur ne lit ni n'écrit jamais ces tables : tout passe
-- par les Edge Functions send-push et notifications-boite (service role), qui
-- vérifient l'utilisateur connecté et ne touchent qu'à ses propres lignes.
-- Aucune fonction, aucune fonction SECURITY DEFINER.
-- Purement additive : deux nouvelles tables, aucune donnée existante touchée.
-- ============================================================================
create table if not exists public.notifications (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  type              text not null check (type in ('C1','C2','C3','C4','C5','F1','F2','D1','D2','D3','D4','test')),
  titre             text not null check (char_length(titre) between 1 and 200),
  texte             text not null default '' check (char_length(texte) <= 2000),
  lien              text not null default '/' check (lien like '/%'),
  cle_regroupement  text,
  created_at        timestamptz not null default now(),
  lu_le             timestamptz,
  push_statut       text not null check (push_statut in (
                      'a_envoyer','envoye','echec','reporte','aucun_creneau','aucun_appareil',
                      'desactive','boite_seule','serveur_non_configure','annule')),
  push_prevu_le     timestamptz,
  push_envoye_le    timestamptz
);
create unique index if not exists notifications_regroupement_uniq
  on public.notifications (user_id, type, cle_regroupement);
create index if not exists notifications_user_recentes_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_non_lues_idx
  on public.notifications (user_id) where lu_le is null;
create index if not exists notifications_reportees_idx
  on public.notifications (push_prevu_le) where push_statut = 'reporte';
create index if not exists notifications_type_recentes_idx
  on public.notifications (type, created_at desc);
comment on table public.notifications is
  'Boîte de réception des notifications (une ligne par destinataire). Accès par Edge Functions seulement (service role). Projet notifications-push, tâche 2.';

alter table public.notifications enable row level security;
revoke all on public.notifications from anon;
revoke all on public.notifications from authenticated;
grant all on public.notifications to service_role;

drop policy if exists profero_collaborateurs_seulement on public.notifications;
create policy profero_collaborateurs_seulement on public.notifications
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));

create table if not exists public.notifications_preferences (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  types       jsonb not null default '{}'::jsonb check (jsonb_typeof(types) = 'object'),
  updated_at  timestamptz not null default now()
);
comment on table public.notifications_preferences is
  'Types de notification coupés par chaque utilisateur ({"C1": false}). Absent = activé. Accès par Edge Functions seulement (service role). Projet notifications-push, tâche 2.';

alter table public.notifications_preferences enable row level security;
revoke all on public.notifications_preferences from anon;
revoke all on public.notifications_preferences from authenticated;
grant all on public.notifications_preferences to service_role;

drop policy if exists profero_collaborateurs_seulement on public.notifications_preferences;
create policy profero_collaborateurs_seulement on public.notifications_preferences
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));
