-- ============================================================================
-- Notifications sur téléphone (push PWA) — tâche 1 : abonnements des appareils.
--
-- Une ligne = un appareil (navigateur / application installée) d'un
-- collaborateur qui a activé les notifications. Plusieurs appareils par
-- personne. L'adresse d'envoi (endpoint) est unique : réactiver sur le même
-- appareil met la ligne à jour au lieu d'en créer une deuxième. Une ligne est
-- supprimée par send-push quand le service d'envoi répond 404 ou 410
-- (abonnement expiré ou retiré par le téléphone).
--
-- Accès (journal du projet, 06/11/2026) : AUCUNE policy d'ouverture. Seule la
-- policy restrictive « réservé aux collaborateurs » est posée (invariant
-- CLAUDE.md). Le navigateur ne lit ni n'écrit jamais cette table : tout passe
-- par les Edge Functions push-abonnement et send-push (service role), qui
-- vérifient l'utilisateur connecté par son jeton et ne touchent qu'à ses
-- propres lignes. Aucune fonction SECURITY DEFINER.
-- Purement additive : une nouvelle table, aucune donnée existante touchée.
-- ============================================================================
create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  appareil      text,                 -- libellé lisible (« iPhone », « Android », « Ordinateur »)
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
comment on table public.push_subscriptions is
  'Abonnements Web Push (un par appareil). Accès par Edge Functions seulement (service role). Projet notifications-push, tâche 1.';

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;
revoke all on public.push_subscriptions from authenticated;
grant all on public.push_subscriptions to service_role;

drop policy if exists profero_collaborateurs_seulement on public.push_subscriptions;
create policy profero_collaborateurs_seulement on public.push_subscriptions
  as restrictive for all to authenticated
  using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()));
