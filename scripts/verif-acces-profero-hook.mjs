#!/usr/bin/env node
// Vérifie la migration 20260930170000_acces_profero_hook_sessions.sql sur un
// VRAI PostgreSQL (PGlite, en mémoire) reproduisant la production du 30/09/2026
// APRÈS la migration 20260930150000 (appliquée depuis son fichier) :
// public.utilisateurs, ses 4 policies, is_admin(), le déclencheur de champs
// sensibles, et un schéma auth réduit (users, sessions, refresh_tokens avec les
// mêmes ON DELETE CASCADE qu'en production), rôle supabase_auth_admin compris.
//
// Quatre parties :
//   1. le hook, appelé comme Supabase Auth l'appelle (rôle supabase_auth_admin) ;
//   2. l'extensibilité clients Invest (Chantier 1.1) sans perte d'isolation ;
//   3. le déclencheur de suppression des sessions ;
//   4. migration sans effet immédiat, retour arrière, App.jsx, analyse statique.
//
// Aucun réseau, aucune base Supabase.
//   npm install --no-save @electric-sql/pglite   (une fois)
//   node scripts/verif-acces-profero-hook.mjs
// PGLITE_MODULE=<chemin> permet d'utiliser un PGlite installé ailleurs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
const MIGRATION_PRECEDENTE = lire("supabase/migrations/20260930150000_utilisateurs_champs_sensibles.sql");
const MIGRATION = lire("supabase/migrations/20260930170000_acces_profero_hook_sessions.sql");
const ROLLBACK = lire("sql/202609_acces_profero_hook_sessions_rollback.sql");
const APP = lire("src/App.jsx");

const { PGlite } = await import(
  process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite"
);

const U = {
  admin:   "00000000-0000-0000-0000-0000000000a1",
  user:    "00000000-0000-0000-0000-0000000000b1",
  inactif: "00000000-0000-0000-0000-0000000000c1",
  local:   "00000000-0000-0000-0000-0000000000c2",
  orphelin:"00000000-0000-0000-0000-0000000000d1",
  tel:     "00000000-0000-0000-0000-0000000000e1",
  doublon: "00000000-0000-0000-0000-0000000000f1",
  double:  "00000000-0000-0000-0000-0000000000f2",
};

const SCHEMA_PROD = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_admin nologin;
create role supabase_auth_admin nologin;
create schema auth;
create function auth.email() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role, supabase_admin;

create table auth.users (
  id uuid primary key, email varchar, phone text, is_anonymous boolean not null default false
);
create table auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  refresh_token_hmac_key text, refresh_token_counter bigint
);
create table auth.refresh_tokens (
  id bigserial primary key, token varchar, user_id varchar, revoked boolean default false,
  session_id uuid references auth.sessions(id) on delete cascade
);

create table public.utilisateurs (
  id uuid primary key default gen_random_uuid(),
  email text, nom text, role text default 'conducteur'::text, actif boolean default true,
  created_at timestamptz default now(), branches jsonb default '["renovation"]'::jsonb,
  prenom_planning text, nav_order jsonb
);
grant all on table public.utilisateurs to anon, authenticated, service_role, supabase_admin;
alter table public.utilisateurs enable row level security;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM utilisateurs
    WHERE email = auth.email() AND role = 'admin' AND actif = true
  );
$function$;
grant execute on function public.is_admin() to anon, authenticated, service_role;

create policy utilisateurs_delete on public.utilisateurs for delete to public using (is_admin());
create policy utilisateurs_insert on public.utilisateurs for insert to public with check (is_admin());
create policy utilisateurs_select on public.utilisateurs for select to public using ((auth.email() = email) OR is_admin());
create policy utilisateurs_update on public.utilisateurs for update to public using ((auth.email() = email) OR is_admin());

insert into auth.users (id, email, phone) values
  ('${U.admin}',    'admin@test.fr',          null),
  ('${U.user}',     'user@test.fr',           null),
  ('${U.inactif}',  'inactif@test.fr',        null),
  ('${U.local}',    'ouvrier@profero.local',  null),
  ('${U.orphelin}', 'client@exemple.fr',      null),
  ('${U.tel}',      null,                     '+33600000000'),
  ('${U.doublon}',  'doublon@test.fr',        null),
  ('${U.double}',   'double@test.fr',         null);

insert into public.utilisateurs (email, nom, role, actif) values
  ('admin@test.fr',          'Admin',       'admin',      true),
  ('User@Test.fr ',          'Utilisateur', 'commercial', true),
  ('inactif@test.fr',        'Inactif',     'ouvrier',    false),
  ('ouvrier@profero.local',  'Local',       'ouvrier',    true),
  ('doublon@test.fr',        'Doublon A',   'commercial', true),
  ('doublon@test.fr',        'Doublon B',   'commercial', false),
  ('double@test.fr',         'Double A',    'ouvrier',    true),
  ('double@test.fr',         'Double B',    'ouvrier',    true);

-- 2 sessions par compte, chacune avec un refresh token.
insert into auth.sessions (user_id) select id from auth.users;
insert into auth.sessions (user_id) select id from auth.users;
insert into auth.refresh_tokens (token, user_id, session_id)
  select md5(s.id::text), s.user_id::text, s.id from auth.sessions s;
`;

async function nouvelleBase({ migration = true } = {}) {
  const db = new PGlite();
  await db.exec(SCHEMA_PROD);
  await db.exec(MIGRATION_PRECEDENTE);
  if (migration) await db.exec(MIGRATION);
  return db;
}

const evenement = (userId, methode = "password", email = "x@test.fr") => ({
  user_id: userId,
  claims: {
    aud: "authenticated", exp: 1790000000, iat: 1789996400, sub: userId, email, phone: "",
    app_metadata: {}, user_metadata: {}, role: "authenticated", aal: "aal1",
    amr: [{ method: methode, timestamp: 1789996400 }], session_id: "11111111-1111-1111-1111-111111111111",
    is_anonymous: false,
  },
  authentication_method: methode,
});

/** Appelle le hook comme Supabase Auth : rôle supabase_auth_admin. */
async function hook(db, event, role = "supabase_auth_admin") {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('role', $1, true)`, [role]);
    const r = await tx.query(`select public.acces_profero_hook($1::jsonb) as r`, [JSON.stringify(event)]);
    return r.rows[0].r;
  });
}
const accorde = (r, population) => {
  assert.equal(r.error, undefined, `refus inattendu : ${JSON.stringify(r.error)}`);
  assert.equal(r.claims.profero_population, population);
};
const refuse = (r) => {
  assert.equal(r.error?.http_code, 403, JSON.stringify(r));
  assert.match(r.error.message, /^Accès Profero refusé/);
  assert.equal(r.claims, undefined, "aucune claim renvoyée avec un refus");
};

/** Exécute sous un rôle PostgREST avec l'email du JWT. */
async function sous(db, role, email, sql, params = []) {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`select set_config('role', $1, true)`, [role]);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify(email ? { email, role } : { role })]);
      const r = await tx.query(sql, params);
      return { rows: r.rows, erreur: null };
    });
  } catch (e) { return { rows: [], erreur: e }; }
}
const sessions = async (db, id) =>
  (await db.query(`select count(*)::int n from auth.sessions where user_id = $1`, [id])).rows[0].n;
const jetons = async (db, id) =>
  (await db.query(`select count(*)::int n from auth.refresh_tokens where user_id = $1`, [id])).rows[0].n;
const totalSessions = async (db) => (await db.query(`select count(*)::int n from auth.sessions`)).rows[0].n;

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ═══════════════════════════════════════════════════════════════════════════
// 0. Témoin
// ═══════════════════════════════════════════════════════════════════════════
test("0. banc fidèle : SANS la migration, aucun hook et la désactivation laisse les sessions", async () => {
  const db = await nouvelleBase({ migration: false });
  const f = (await db.query(`select count(*)::int n from pg_proc where proname = 'acces_profero_hook'`)).rows[0].n;
  assert.equal(f, 0);
  await sous(db, "authenticated", "admin@test.fr",
    `update public.utilisateurs set actif = false where email = 'admin@test.fr'`);
  // (l'admin se désactive lui-même : autorisé, is_admin() est évalué avant)
  assert.equal(await sessions(db, U.admin), 2, "sessions intactes : la faille existe");
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. Le hook
// ═══════════════════════════════════════════════════════════════════════════
test("1. collaborateur actif : jeton accordé, claims d'origine intactes + profero_population", async () => {
  const db = await nouvelleBase();
  const ev = evenement(U.admin, "password", "admin@test.fr");
  const r = await hook(db, ev);
  accorde(r, "collaborateur");
  const { profero_population, ...reste } = r.claims;
  assert.deepEqual(reste, ev.claims, "aucune autre claim modifiée");
  assert.equal(r.user_id, U.admin);
});

test("2. toutes les méthodes (connexion, renouvellement, invitation, réinitialisation, lien)", async () => {
  const db = await nouvelleBase();
  for (const m of ["password", "token_refresh", "invite", "recovery", "magiclink", "otp"]) {
    accorde(await hook(db, evenement(U.user, m)), "collaborateur");
    refuse(await hook(db, evenement(U.inactif, m)));
  }
});

test("3. adresse en casse/espaces différents dans utilisateurs : reconnue", async () => {
  const db = await nouvelleBase();
  accorde(await hook(db, evenement(U.user)), "collaborateur"); // profil « User@Test.fr »
});

test("4. compte sans email (@profero.local) actif : accordé", async () => {
  const db = await nouvelleBase();
  accorde(await hook(db, evenement(U.local)), "collaborateur");
});

test("5. profil désactivé : refus 403", async () => {
  const db = await nouvelleBase();
  refuse(await hook(db, evenement(U.inactif)));
});

test("6. identité Auth sans profil ni client (futur client non branché, compte orphelin) : refus", async () => {
  const db = await nouvelleBase();
  refuse(await hook(db, evenement(U.orphelin)));
});

test("7. identité sans email (téléphone) : refus", async () => {
  const db = await nouvelleBase();
  refuse(await hook(db, evenement(U.tel)));
});

test("8. doublon d'adresse actif + inactif : ambiguïté = refus ; deux actifs : accordé", async () => {
  const db = await nouvelleBase();
  refuse(await hook(db, evenement(U.doublon)));
  accorde(await hook(db, evenement(U.double)), "collaborateur");
});

test("9. événements invalides : user_id absent, non-UUID, inconnu, claims absentes → refus", async () => {
  const db = await nouvelleBase();
  refuse(await hook(db, { claims: {} }));
  refuse(await hook(db, { ...evenement(U.admin), user_id: "pas-un-uuid" }));
  refuse(await hook(db, evenement("99999999-9999-9999-9999-999999999999")));
  refuse(await hook(db, { user_id: U.admin, authentication_method: "password" }));
  refuse(await hook(db, { user_id: U.admin, claims: "texte" }));
});

test("10. erreur interne (table illisible) : refus, jamais d'ouverture", async () => {
  const db = await nouvelleBase();
  await db.exec(`create or replace function public.acces_collaborateur_autorise(p_email text)
    returns boolean language plpgsql stable set search_path = '' as $$
    begin raise exception 'panne simulée'; end $$;`);
  refuse(await hook(db, evenement(U.admin)));
});

test("11. le hook ignore les claims fournies : c'est la base qui décide", async () => {
  const db = await nouvelleBase();
  const ev = evenement(U.inactif, "password", "admin@test.fr"); // email trompeur dans les claims
  ev.claims.profero_population = "collaborateur";
  refuse(await hook(db, ev));
});

test("12. anon et authenticated ne peuvent ni appeler le hook ni sonder les populations", async () => {
  const db = await nouvelleBase();
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(() => hook(db, evenement(U.admin), role), /permission denied/);
    for (const q of [`select public.acces_collaborateur_autorise('admin@test.fr')`,
                     `select public.acces_client_invest_autorise('${U.orphelin}')`]) {
      const r = await sous(db, role, "user@test.fr", q);
      assert.match(String(r.erreur?.message), /permission denied/, `${role} : ${q}`);
    }
  }
  const droits = (await db.query(`select has_function_privilege('supabase_auth_admin', 'public.acces_profero_hook(jsonb)', 'EXECUTE') h`)).rows[0].h;
  assert.equal(droits, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Clients Invest (Chantier 1.1) : extensible sans perte d'isolation
// ═══════════════════════════════════════════════════════════════════════════
test("13. emplacement client : false aujourd'hui pour toute identité", async () => {
  const db = await nouvelleBase();
  for (const id of Object.values(U)) {
    const v = (await db.query(`select public.acces_client_invest_autorise($1) v`, [id])).rows[0].v;
    assert.equal(v, false);
  }
});

test("14. simulation 1.1 : un client branché obtient client_invest, sans ligne utilisateurs", async () => {
  const db = await nouvelleBase();
  await db.exec(`create or replace function public.acces_client_invest_autorise(p_user_id uuid)
    returns boolean language sql stable set search_path = '' as $$
    select p_user_id = '${U.orphelin}'::uuid $$;`);
  const r = await hook(db, evenement(U.orphelin));
  accorde(r, "client_invest");
  const n = (await db.query(`select count(*)::int n from public.utilisateurs where lower(email) = 'client@exemple.fr'`)).rows[0].n;
  assert.equal(n, 0, "aucune ligne collaborateur");
});

test("15. isolation : une identité à la fois collaborateur et client est REFUSÉE", async () => {
  const db = await nouvelleBase();
  await db.exec(`create or replace function public.acces_client_invest_autorise(p_user_id uuid)
    returns boolean language sql stable set search_path = '' as $$
    select p_user_id = '${U.admin}'::uuid $$;`);
  refuse(await hook(db, evenement(U.admin)));
});

test("16. un client ne devient jamais collaborateur par son adresse, et inversement", async () => {
  const db = await nouvelleBase();
  await db.exec(`create or replace function public.acces_client_invest_autorise(p_user_id uuid)
    returns boolean language sql stable set search_path = '' as $$
    select p_user_id = '${U.orphelin}'::uuid $$;`);
  assert.equal((await hook(db, evenement(U.orphelin))).claims.profero_population, "client_invest");
  assert.equal((await hook(db, evenement(U.user))).claims.profero_population, "collaborateur");
  refuse(await hook(db, evenement(U.inactif)), "désactivé : ni l'un ni l'autre");
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Déclencheur de suppression des sessions
// ═══════════════════════════════════════════════════════════════════════════
test("17. MIGRATION SANS EFFET IMMÉDIAT : les sessions des comptes déjà inactifs restent", async () => {
  const db = await nouvelleBase();
  assert.equal(await sessions(db, U.inactif), 2);
  assert.equal(await jetons(db, U.inactif), 2);
  assert.equal(await totalSessions(db), 16);
});

test("18. admin désactive un compte (toggleActif) : ses sessions et jetons disparaissent, rien d'autre", async () => {
  const db = await nouvelleBase();
  const r = await sous(db, "authenticated", "admin@test.fr",
    `update public.utilisateurs set actif = false where lower(btrim(email)) = 'user@test.fr'`);
  assert.equal(r.erreur, null, r.erreur?.message);
  assert.equal(await sessions(db, U.user), 0);
  assert.equal(await jetons(db, U.user), 0, "refresh tokens supprimés en cascade");
  assert.equal(await totalSessions(db), 14, "les autres comptes gardent leurs sessions");
  refuse(await hook(db, evenement(U.user, "token_refresh")));
});

test("19. compte sans email désactivé : sessions supprimées aussi", async () => {
  const db = await nouvelleBase();
  await sous(db, "authenticated", "admin@test.fr",
    `update public.utilisateurs set actif = false where email = 'ouvrier@profero.local'`);
  assert.equal(await sessions(db, U.local), 0);
});

test("20. réactivation : aucune suppression, accès rendu au prochain jeton", async () => {
  const db = await nouvelleBase();
  const r = await sous(db, "authenticated", "admin@test.fr",
    `update public.utilisateurs set actif = true where email = 'inactif@test.fr'`);
  assert.equal(r.erreur, null, r.erreur?.message);
  assert.equal(await sessions(db, U.inactif), 2, "rien supprimé");
  accorde(await hook(db, evenement(U.inactif)), "collaborateur");
});

test("21. autres modifications (nom, rôle, branches, nav_order) : aucune session touchée", async () => {
  const db = await nouvelleBase();
  await sous(db, "authenticated", "admin@test.fr",
    `update public.utilisateurs set nom = 'X', role = 'comptable', branches = '["invest"]' where email = 'admin@test.fr'`);
  await sous(db, "authenticated", "user@test.fr",
    `update public.utilisateurs set nav_order = '["a"]' where email = auth.email()`);
  assert.equal(await totalSessions(db), 16);
});

test("22. suppression du profil : sessions supprimées", async () => {
  const db = await nouvelleBase();
  const r = await sous(db, "authenticated", "admin@test.fr",
    `delete from public.utilisateurs where lower(btrim(email)) = 'user@test.fr'`);
  assert.equal(r.erreur, null, r.erreur?.message);
  assert.equal(await sessions(db, U.user), 0);
  assert.equal(await totalSessions(db), 14);
});

test("23. doublon : désactiver une ligne quand une autre reste active ne coupe rien", async () => {
  const db = await nouvelleBase();
  await sous(db, "authenticated", "admin@test.fr",
    `update public.utilisateurs set actif = false where nom = 'Double A'`);
  assert.equal(await sessions(db, U.double), 2);
  await sous(db, "authenticated", "admin@test.fr",
    `update public.utilisateurs set actif = false where nom = 'Double B'`);
  assert.equal(await sessions(db, U.double), 0, "dernière ligne active retirée : coupé");
});

test("24. suppression des sessions impossible : la désactivation passe quand même (avertissement)", async () => {
  const db = await nouvelleBase();
  await db.exec(`create function auth.bloque() returns trigger language plpgsql as $$
    begin raise exception 'schéma auth modifié'; end $$;
    create trigger bloque before delete on auth.sessions for each row execute function auth.bloque();`);
  const r = await sous(db, "authenticated", "admin@test.fr",
    `update public.utilisateurs set actif = false where lower(btrim(email)) = 'user@test.fr'`);
  assert.equal(r.erreur, null, "la désactivation n'est pas bloquée");
  const actif = (await db.query(`select actif from public.utilisateurs where lower(btrim(email)) = 'user@test.fr'`)).rows[0].actif;
  assert.equal(actif, false);
  assert.equal(await sessions(db, U.user), 2, "sessions restées…");
  refuse(await hook(db, evenement(U.user, "token_refresh")), "…mais le hook refuse leur renouvellement");
});

test("25. un utilisateur ordinaire ne déclenche rien sur les autres (RLS + champs sensibles)", async () => {
  const db = await nouvelleBase();
  const r = await sous(db, "authenticated", "user@test.fr",
    `update public.utilisateurs set actif = false where email = 'admin@test.fr'`);
  assert.equal(r.erreur, null);
  assert.equal(await sessions(db, U.admin), 2);
  // (profil à l'adresse exacte : la policy existante compare sans normaliser)
  const r2 = await sous(db, "authenticated", "ouvrier@profero.local",
    `update public.utilisateurs set actif = false where email = auth.email()`);
  assert.ok(r2.erreur, "se désactiver soi-même reste refusé (champ sensible)");
  assert.equal(await totalSessions(db), 16);
});

test("26. anon / authenticated ne peuvent pas lire ni supprimer les sessions directement", async () => {
  const db = await nouvelleBase();
  for (const role of ["anon", "authenticated"]) {
    const r = await sous(db, role, "user@test.fr", `delete from auth.sessions`);
    assert.match(String(r.erreur?.message), /permission denied/);
  }
  assert.equal(await totalSessions(db), 16);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Rejeu, retour arrière, App.jsx, statique
// ═══════════════════════════════════════════════════════════════════════════
test("27. migration rejouable ; protection des champs sensibles toujours en place", async () => {
  const db = await nouvelleBase();
  await db.exec(MIGRATION);
  const t = (await db.query(`select string_agg(tgname, ',' order by tgname) t from pg_trigger
    where tgrelid = 'public.utilisateurs'::regclass and not tgisinternal`)).rows[0].t;
  assert.equal(t, "utilisateurs_proteger_champs_sensibles,utilisateurs_revoquer_sessions");
  accorde(await hook(db, evenement(U.admin)), "collaborateur");
});

test("28. retour arrière : fonctions et déclencheur retirés, rien d'autre", async () => {
  const db = await nouvelleBase();
  await db.exec(ROLLBACK);
  const f = (await db.query(`select count(*)::int n from pg_proc where proname in
    ('acces_profero_hook','acces_collaborateur_autorise','acces_client_invest_autorise','utilisateurs_revoquer_sessions')`)).rows[0].n;
  assert.equal(f, 0);
  const t = (await db.query(`select string_agg(tgname, ',') t from pg_trigger
    where tgrelid = 'public.utilisateurs'::regclass and not tgisinternal`)).rows[0].t;
  assert.equal(t, "utilisateurs_proteger_champs_sensibles", "la protection précédente reste");
  assert.equal(await totalSessions(db), 16);
});

test("29. migration : aucune écriture de données, aucune policy, rien sur les champs sensibles", () => {
  const code = MIGRATION.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  const horsCorps = code.replace(/\$\$[\s\S]*?\$\$/g, "$$…$$");
  assert.ok(!/\bupdate\s+(public\.|auth\.)?\w+\s+set\b|\bdelete\s+from\b|\binsert\s+into\b|\btruncate\b/i.test(horsCorps), "aucun DML hors fonctions");
  assert.ok(!/\b(drop|alter|create)\s+policy\b/i.test(code));
  assert.ok(!/\bdrop\s+(table|column|trigger|function)\b/i.test(code));
  assert.ok(!/alter\s+table/i.test(code));
  assert.ok(!/utilisateurs_proteger_champs_sensibles/.test(code), "migration précédente non touchée");
  assert.ok(!/security definer/i.test(code.match(/acces_collaborateur_autorise[\s\S]*?\$\$;/)[0]));
});

test("30. App.jsx : SIGNED_OUT ramène à la connexion ; refus du hook affiché clairement", () => {
  assert.match(APP, /if \(event === "SIGNED_OUT"\) \{\s*setUser\(null\); setProfil\(null\); setAuthState\("login"\);\s*return;\s*\}/);
  const iSignedOut = APP.indexOf(`if (event === "SIGNED_OUT")`);
  const iGarde = APP.indexOf("if (!session?.user) return;", iSignedOut - 400);
  assert.ok(iSignedOut > 0 && iSignedOut < iGarde, "SIGNED_OUT traité avant le garde « pas de session »");
  assert.match(APP, /\/Accès Profero refusé\/\.test\(error\.message \|\| ""\)/);
  assert.match(APP, /"Email\/identifiant ou mot de passe incorrect\."/, "message habituel conservé");
  assert.match(MIGRATION, /'message', 'Accès Profero refusé : compte désactivé ou non autorisé\.'/,
    "le texte reconnu par App.jsx est bien celui du hook");
  // Les contrôles existants au chargement restent.
  assert.equal((APP.match(/if \(p && p\.actif\)/g) || []).length, 2);
  assert.match(APP, /if \(!profil\.actif\) \{/);
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
