// scripts/lib/banc-invest.mjs — banc de test commun aux modules de la fiche Mission Invest.
// Un VRAI PostgreSQL en mémoire (PGlite) reproduisant ce dont les migrations ont besoin :
// rôles Supabase, auth, utilisateurs, invest_peut_voir, clients et missions réduits aux colonnes
// utiles. Le hook d'accès et est_collaborateur_actif() sont appliqués DEPUIS LEURS FICHIERS.
// Données : exemple issu des tests, données fictives (aucune donnée réelle).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const racine = fileURLToPath(new URL("../..", import.meta.url));
export const lire = (rel) => readFileSync(join(racine, rel), "utf8");
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");

const HOOK = lire("supabase/migrations/20260930170000_acces_profero_hook_sessions.sql");
const TROIS_A = lire("supabase/migrations/20261001150000_profero_collaborateurs_seulement.sql");
const m3a = TROIS_A.match(/create or replace function public\.est_collaborateur_actif\(\)[\s\S]*?grant execute on function public\.est_collaborateur_actif\(\) to authenticated;/);
if (!m3a) throw new Error("est_collaborateur_actif introuvable dans la migration 3a");

export const ID = {
  admin: "00000000-0000-0000-0000-0000000000a1", commercial: "00000000-0000-0000-0000-0000000000a2", ouvrier: "00000000-0000-0000-0000-0000000000a3",
  client: "00000000-0000-0000-0000-0000000000b1", libre: "00000000-0000-0000-0000-0000000000c1",
  cA: "11111111-1111-1111-1111-1111111111a1", cB: "11111111-1111-1111-1111-1111111111b1",
  d2: "22222222-2222-2222-2222-2222222222a1", d3: "22222222-2222-2222-2222-2222222222a2", dB: "22222222-2222-2222-2222-2222222222b1",
};

const SCHEMA = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create role supabase_admin nologin; create role supabase_auth_admin nologin;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.email() returns text language sql stable as $$ select auth.jwt() ->> 'email' $$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
grant usage on schema public to anon, authenticated, service_role, supabase_admin;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email varchar, phone text, is_anonymous boolean not null default false);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(), refresh_token_hmac_key text, refresh_token_counter bigint);
create table auth.refresh_tokens (id bigserial primary key, token varchar, user_id varchar, revoked boolean default false,
  session_id uuid references auth.sessions(id) on delete cascade);
create table public.utilisateurs (id uuid primary key default gen_random_uuid(), email text, nom text, role text default 'conducteur',
  actif boolean default true, branches jsonb default '["renovation"]'::jsonb, prenom_planning text, nav_order jsonb);
grant all on public.utilisateurs to anon, authenticated, service_role, supabase_admin;
create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from utilisateurs where email = auth.email() and role = 'admin' and actif = true) $$;
create function public.invest_peut_voir(p text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from utilisateurs where email = auth.email() and actif and role in ('admin','commercial')) $$;
grant execute on function public.invest_peut_voir(text) to authenticated;
create table public.invest_clients (id uuid primary key, prenom text, nom text);
create table public.invest_biens (id uuid primary key, adresse text, ville text);
create table public.invest_dossiers (id uuid primary key, client_id uuid not null references public.invest_clients(id), reference text,
  type_mission text, statut text default 'actif', restitution_le date);
insert into auth.users (id, email) values ('${ID.admin}','admin@test.fr'), ('${ID.commercial}','commercial@test.fr'), ('${ID.ouvrier}','ouvrier@test.fr'),
  ('${ID.client}','client@exemple.fr'), ('${ID.libre}','libre@exemple.fr');
insert into public.utilisateurs (email, nom, role, actif) values ('admin@test.fr','Admin','admin',true), ('commercial@test.fr','Commercial','commercial',true), ('ouvrier@test.fr','Ouvrier','ouvrier',true);
insert into public.invest_clients values ('${ID.cA}','Alice','Client A'), ('${ID.cB}','','Client B');
insert into public.invest_dossiers (id, client_id, reference, type_mission) values ('${ID.d2}','${ID.cA}','INV-A2','accompagnement_acquisition');
`;

/** Nouvelle base de test ; `migrations` = chemins (relatifs au dépôt) appliqués dans l'ordre. */
export async function nouvelleBase(migrations = []) {
  const db = new PGlite();
  await db.exec(SCHEMA); await db.exec(HOOK); await db.exec(m3a[0]);
  for (const m of migrations) await db.exec(lire(m));
  return db;
}
export const jeton = (id, email, population = "collaborateur") => ({ sub: id, email, role: "authenticated", ...(population ? { profero_population: population } : {}) });
export const J = {
  admin: jeton(ID.admin, "admin@test.fr"), commercial: jeton(ID.commercial, "commercial@test.fr"), ouvrier: jeton(ID.ouvrier, "ouvrier@test.fr"),
  client: jeton(ID.client, "client@exemple.fr", "client_invest"), libre: jeton(ID.libre, "libre@exemple.fr", null),
  commercialFalsifie: jeton(ID.commercial, "commercial@test.fr", "client_invest"),
};
/** Exécute une requête sous un rôle PostgREST avec les claims du jeton. */
export async function sous(db, role, claims, sql, params = []) {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`select set_config('role', $1, true)`, [role]);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role })]);
      const r = await tx.query(sql, params); return { rows: r.rows, erreur: null };
    });
  } catch (e) { return { rows: [], erreur: e }; }
}
export const nouvelleMission = (db, id, client, type) =>
  db.query(`insert into public.invest_dossiers (id, client_id, reference, type_mission) values ($1,$2,$3,$4)`, [id, client, `INV-${id.slice(-2)}`, type]);

/** Petit lanceur : enregistre des cas puis les exécute. */
export function lanceur() {
  const cas = [];
  return {
    test: (nom, fn) => cas.push([nom, fn]),
    async lancer() {
      let echecs = 0;
      for (const [nom, fn] of cas) { try { await fn(); console.log(`  ✔ ${nom}`); } catch (e) { echecs++; console.log(`  ✘ ${nom}\n      ${e.message.split("\n")[0]}`); } }
      console.log(`\n${cas.length - echecs}/${cas.length} contrôles conformes`);
      process.exit(echecs ? 1 : 0);
    },
  };
}
