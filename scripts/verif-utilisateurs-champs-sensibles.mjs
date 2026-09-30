#!/usr/bin/env node
// Vérifie la migration 20260930150000_utilisateurs_champs_sensibles.sql sur un
// VRAI PostgreSQL (PGlite, en mémoire) reproduisant l'état de production du
// 30/09/2026 : colonnes de public.utilisateurs, droits (anon et authenticated
// ont tout), les 4 policies RLS mot pour mot, is_admin() mot pour mot, auth.email()
// comme Supabase (lue dans les claims du JWT).
//
// Trois parties :
//   1. AVANT migration : la faille est reproduite (sinon le banc ne prouve rien) ;
//   2. APRÈS migration (fichier appliqué tel quel) : utilisateur, compte
//      désactivé, anon, administrateur, service_role, postgres ;
//   3. retour arrière (fichier sql/…_rollback.sql) + analyse statique : la
//      migration ne touche aucune donnée ni policy ; l'inventaire des écritures
//      de l'application vers utilisateurs n'a pas bougé.
//
// Aucun réseau, aucune base Supabase.
//   npm install --no-save @electric-sql/pglite   (une fois)
//   node scripts/verif-utilisateurs-champs-sensibles.mjs
// PGLITE_MODULE=<chemin> permet d'utiliser un PGlite installé ailleurs.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
const MIGRATION = lire("supabase/migrations/20260930150000_utilisateurs_champs_sensibles.sql");
const ROLLBACK = lire("sql/202609_utilisateurs_champs_sensibles_rollback.sql");

const { PGlite } = await import(
  process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite"
);

// ── État de production reproduit ────────────────────────────────────────────
const SCHEMA_PROD = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_admin nologin;
create schema auth;
create function auth.email() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role, supabase_admin;

create table public.utilisateurs (
  id uuid primary key default gen_random_uuid(),
  email text,
  nom text,
  role text default 'conducteur'::text,
  actif boolean default true,
  created_at timestamptz default now(),
  branches jsonb default '["renovation"]'::jsonb,
  prenom_planning text,
  nav_order jsonb
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

insert into public.utilisateurs (id, email, nom, role, actif, branches) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.fr',     'Admin',          'admin',      true,  '["renovation","invest"]'),
  ('00000000-0000-0000-0000-00000000000b', 'user@test.fr',      'Utilisateur',    'commercial', true,  '["invest"]'),
  ('00000000-0000-0000-0000-00000000000c', 'inactif@test.fr',   'Inactif',        'ouvrier',    false, '["renovation"]'),
  ('00000000-0000-0000-0000-00000000000d', 'exadmin@test.fr',   'Admin inactif',  'admin',      false, '["renovation"]');
`;

const ID = { admin: "00000000-0000-0000-0000-00000000000a", user: "00000000-0000-0000-0000-00000000000b",
  inactif: "00000000-0000-0000-0000-00000000000c", exadmin: "00000000-0000-0000-0000-00000000000d" };

async function nouvelleBase({ migration = true } = {}) {
  const db = new PGlite();
  await db.exec(SCHEMA_PROD);
  if (migration) await db.exec(MIGRATION);
  return db;
}

/** Exécute `sql` sous un rôle PostgREST, avec l'email du JWT. Renvoie { rows, erreur }. */
async function sous(db, role, email, sql, params = []) {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`select set_config('role', $1, true)`, [role]);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify(email ? { email, role } : { role })]);
      // Plusieurs instructions : tableau, exécutées dans la même transaction.
      const liste = Array.isArray(sql) ? sql : [sql];
      let r;
      for (const q of liste) r = await tx.query(q, liste.length === 1 ? params : []);
      return { rows: r.rows, n: r.affectedRows ?? r.rows.length, erreur: null };
    });
  } catch (e) {
    return { rows: [], n: 0, erreur: e };
  }
}
const utilisateur = (db, email, sql, p) => sous(db, "authenticated", email, sql, p);
const ligne = async (db, id) =>
  (await db.query(`select * from public.utilisateurs where id = $1`, [id])).rows[0];
const refuse = (r, motif = /42501|seul l'ordre|réservée|permission|must be owner/i) => {
  assert.ok(r.erreur, "la requête devait être refusée");
  assert.match(`${r.erreur.code} ${r.erreur.message}`, motif);
};

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ═══════════════════════════════════════════════════════════════════════════
// 1. AVANT migration : la faille existe sur le banc
// ═══════════════════════════════════════════════════════════════════════════
test("1. banc fidèle : SANS la migration, un utilisateur se promeut admin", async () => {
  const db = await nouvelleBase({ migration: false });
  const r = await utilisateur(db, "user@test.fr",
    `update public.utilisateurs set role = 'admin' where email = auth.email()`);
  assert.equal(r.erreur, null);
  assert.equal((await ligne(db, ID.user)).role, "admin");
  const r2 = await utilisateur(db, "inactif@test.fr",
    `update public.utilisateurs set actif = true where email = auth.email()`);
  assert.equal(r2.erreur, null);
  assert.equal((await ligne(db, ID.inactif)).actif, true, "compte désactivé réactivé par lui-même");
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. APRÈS migration
// ═══════════════════════════════════════════════════════════════════════════
test("2. utilisateur : nav_order modifiable (valeur puis NULL), comme Navigation.jsx", async () => {
  const db = await nouvelleBase();
  const ordre = ["dashboard", "planning", "chantiers"];
  const r = await utilisateur(db, "user@test.fr",
    `update public.utilisateurs set nav_order = $1 where id = $2`, [JSON.stringify(ordre), ID.user]);
  assert.equal(r.erreur, null, r.erreur?.message);
  assert.deepEqual((await ligne(db, ID.user)).nav_order, ordre);
  const r2 = await utilisateur(db, "user@test.fr",
    `update public.utilisateurs set nav_order = null where id = $1`, [ID.user]);
  assert.equal(r2.erreur, null, r2.erreur?.message);
  assert.equal((await ligne(db, ID.user)).nav_order, null);
});

test("3. utilisateur : role → admin refusé, ligne inchangée", async () => {
  const db = await nouvelleBase();
  refuse(await utilisateur(db, "user@test.fr",
    `update public.utilisateurs set role = 'admin' where email = auth.email()`));
  assert.equal((await ligne(db, ID.user)).role, "commercial");
});

test("4. compte désactivé : actif false → true refusé", async () => {
  const db = await nouvelleBase();
  refuse(await utilisateur(db, "inactif@test.fr",
    `update public.utilisateurs set actif = true where email = auth.email()`));
  assert.equal((await ligne(db, ID.inactif)).actif, false);
});

test("5. utilisateur : branches refusé", async () => {
  const db = await nouvelleBase();
  refuse(await utilisateur(db, "user@test.fr",
    `update public.utilisateurs set branches = '["renovation","invest"]' where email = auth.email()`));
  assert.deepEqual((await ligne(db, ID.user)).branches, ["invest"]);
});

test("6. utilisateur : email refusé", async () => {
  const db = await nouvelleBase();
  refuse(await utilisateur(db, "user@test.fr",
    `update public.utilisateurs set email = 'autre@test.fr' where email = auth.email()`));
  assert.equal((await ligne(db, ID.user)).email, "user@test.fr");
});

test("7. liste blanche : nom, prenom_planning, id, created_at refusés aussi", async () => {
  const db = await nouvelleBase();
  for (const set of [`nom = 'X'`, `prenom_planning = 'Jean'`,
    `id = gen_random_uuid()`, `created_at = now() - interval '1 year'`]) {
    refuse(await utilisateur(db, "user@test.fr",
      `update public.utilisateurs set ${set} where email = auth.email()`), undefined);
  }
  const l = await ligne(db, ID.user);
  assert.equal(l.nom, "Utilisateur");
  assert.equal(l.prenom_planning, null);
});

test("8. nav_order + role dans la même requête : tout est refusé", async () => {
  const db = await nouvelleBase();
  refuse(await utilisateur(db, "user@test.fr",
    `update public.utilisateurs set nav_order = '["x"]', role = 'admin' where email = auth.email()`));
  const l = await ligne(db, ID.user);
  assert.equal(l.role, "commercial");
  assert.equal(l.nav_order, null);
});

test("9. utilisateur : INSERT d'une 2e ligne admin à son email refusé, upsert aussi", async () => {
  const db = await nouvelleBase();
  refuse(await utilisateur(db, "user@test.fr",
    `insert into public.utilisateurs (email, role, actif) values ('user@test.fr', 'admin', true)`),
    /42501|réservée|row-level security/i);
  refuse(await utilisateur(db, "user@test.fr",
    `insert into public.utilisateurs (id, email, role) values ($1, 'user@test.fr', 'admin')
     on conflict (id) do update set role = 'admin'`, [ID.user]),
    /42501|réservée|row-level security/i);
  const n = (await db.query(`select count(*)::int n from public.utilisateurs`)).rows[0].n;
  assert.equal(n, 4);
  assert.equal((await ligne(db, ID.user)).role, "commercial");
});

test("10. utilisateur : la ligne d'un autre reste hors d'atteinte (RLS inchangée)", async () => {
  const db = await nouvelleBase();
  const r = await utilisateur(db, "user@test.fr",
    `update public.utilisateurs set nav_order = '["x"]' where id = $1`, [ID.admin]);
  assert.equal(r.erreur, null);
  assert.equal(r.n, 0, "0 ligne touchée");
  assert.equal((await ligne(db, ID.admin)).nav_order, null);
});

test("11. utilisateur : TRUNCATE, CREATE/DROP TRIGGER, DISABLE TRIGGER impossibles", async () => {
  const db = await nouvelleBase();
  refuse(await utilisateur(db, "user@test.fr", `truncate public.utilisateurs`), /permission|42501/i);
  refuse(await utilisateur(db, "user@test.fr",
    `create trigger t before update on public.utilisateurs for each row execute function public.utilisateurs_proteger_champs_sensibles()`),
    /permission|42501|owner/i);
  refuse(await utilisateur(db, "user@test.fr",
    `drop trigger utilisateurs_proteger_champs_sensibles on public.utilisateurs`), /owner|42501|permission/i);
  refuse(await utilisateur(db, "user@test.fr",
    `alter table public.utilisateurs disable trigger utilisateurs_proteger_champs_sensibles`), /owner|42501|permission/i);
  const n = (await db.query(`select count(*)::int n from public.utilisateurs`)).rows[0].n;
  assert.equal(n, 4);
});

test("12. utilisateur : ne peut ni désactiver la protection ni se faire passer pour le serveur", async () => {
  const db = await nouvelleBase();
  refuse(await utilisateur(db, "user@test.fr", [
    `set local session_replication_role = replica`,
    `update public.utilisateurs set role = 'admin' where email = auth.email()`]),
    /permission|42501|seul l'ordre/i);
  // « SET ROLE service_role » n'est pas testable ici : la session du banc est
  // superutilisateur, donc autorisée à tout rôle. En production, un client
  // n'envoie pas de SQL : PostgREST choisit le rôle d'après le JWT vérifié,
  // et aucune fonction public n'exécute de SQL dynamique (vérifié le 30/09).
  // Un claim « role: service_role » dans le JWT ne change pas current_user.
  refuse(await sous(db, "authenticated", "user@test.fr", [
    `select set_config('request.jwt.claims', '{"email":"user@test.fr","role":"service_role"}', true)`,
    `update public.utilisateurs set role = 'admin' where email = auth.email()`]));
  assert.equal((await ligne(db, ID.user)).role, "commercial");
});

test("13. anon : aucune écriture", async () => {
  const db = await nouvelleBase();
  const r = await sous(db, "anon", null, `update public.utilisateurs set role = 'admin'`);
  assert.ok(r.erreur || r.n === 0);
  refuse(await sous(db, "anon", null,
    `insert into public.utilisateurs (email, role) values ('x@test.fr', 'admin')`),
    /42501|réservée|row-level security/i);
  assert.equal((await ligne(db, ID.user)).role, "commercial");
});

test("14. administrateur actif : édition, activation, invitation, suppression (écrans Admin)", async () => {
  const db = await nouvelleBase();
  const a = (sql, p) => utilisateur(db, "admin@test.fr", sql, p);
  // Admin.jsx sauvegarder()
  let r = await a(`update public.utilisateurs set nom = 'Jean', role = 'comptable', branches = '["renovation"]' where id = $1`, [ID.user]);
  assert.equal(r.erreur, null, r.erreur?.message);
  // Admin.jsx toggleActif()
  r = await a(`update public.utilisateurs set actif = not actif where id = $1`, [ID.inactif]);
  assert.equal(r.erreur, null, r.erreur?.message);
  // Admin.jsx inviter() : ligne profil
  r = await a(`insert into public.utilisateurs (email, nom, role, branches, actif, prenom_planning)
               values ('nouveau@test.fr', 'Nouveau', 'ouvrier', '["renovation"]', true, 'Paul')`);
  assert.equal(r.erreur, null, r.erreur?.message);
  // son propre nav_order
  r = await a(`update public.utilisateurs set nav_order = '["admin"]' where id = $1`, [ID.admin]);
  assert.equal(r.erreur, null, r.erreur?.message);
  r = await a(`delete from public.utilisateurs where email = 'nouveau@test.fr'`);
  assert.equal(r.erreur, null, r.erreur?.message);
  const u = await ligne(db, ID.user);
  assert.equal(u.role, "comptable");
  assert.deepEqual(u.branches, ["renovation"]);
  assert.equal((await ligne(db, ID.inactif)).actif, true);
});

test("15. administrateur DÉSACTIVÉ : traité comme un utilisateur ordinaire", async () => {
  const db = await nouvelleBase();
  refuse(await utilisateur(db, "exadmin@test.fr",
    `update public.utilisateurs set actif = true where email = auth.email()`));
  assert.equal((await ligne(db, ID.exadmin)).actif, false);
});

test("16. service_role : set_email d'admin-users-local et création serveur fonctionnent", async () => {
  const db = await nouvelleBase();
  let r = await sous(db, "service_role", null,
    `update public.utilisateurs set email = 'user2@test.fr' where email = 'user@test.fr'`);
  assert.equal(r.erreur, null, r.erreur?.message);
  assert.equal((await ligne(db, ID.user)).email, "user2@test.fr");
  r = await sous(db, "service_role", null,
    `insert into public.utilisateurs (email, role) values ('srv@test.fr', 'ouvrier')`);
  assert.equal(r.erreur, null, r.erreur?.message);
});

test("17. postgres (migrations, tableau de bord) : non bloqué", async () => {
  const db = await nouvelleBase();
  await db.query(`update public.utilisateurs set role = 'conducteur' where id = $1`, [ID.user]);
  assert.equal((await ligne(db, ID.user)).role, "conducteur");
});

test("18. is_admin() : search_path fixé, résultat inchangé", async () => {
  const db = await nouvelleBase();
  const cfg = (await db.query(`select proconfig from pg_proc where proname = 'is_admin'`)).rows[0].proconfig;
  assert.deepEqual(cfg, ["search_path=public, pg_temp"]);
  const oui = await utilisateur(db, "admin@test.fr", `select public.is_admin() v`);
  const non = await utilisateur(db, "user@test.fr", `select public.is_admin() v`);
  const ex = await utilisateur(db, "exadmin@test.fr", `select public.is_admin() v`);
  assert.equal(oui.rows[0].v, true);
  assert.equal(non.rows[0].v, false);
  assert.equal(ex.rows[0].v, false);
});

test("19. migration rejouable (idempotente)", async () => {
  const db = await nouvelleBase();
  await db.exec(MIGRATION);
  const n = (await db.query(`select count(*)::int n from pg_trigger where tgrelid = 'public.utilisateurs'::regclass and not tgisinternal`)).rows[0].n;
  assert.equal(n, 1);
  refuse(await utilisateur(db, "user@test.fr",
    `update public.utilisateurs set role = 'admin' where email = auth.email()`));
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Retour arrière et analyse statique
// ═══════════════════════════════════════════════════════════════════════════
test("20. retour arrière : rétablit exactement l'état précédent", async () => {
  const db = await nouvelleBase();
  await db.exec(ROLLBACK);
  const trig = (await db.query(`select count(*)::int n from pg_trigger where tgrelid = 'public.utilisateurs'::regclass and not tgisinternal`)).rows[0].n;
  assert.equal(trig, 0);
  const cfg = (await db.query(`select proconfig from pg_proc where proname = 'is_admin'`)).rows[0].proconfig;
  assert.equal(cfg, null);
  const tr = (await db.query(`select has_table_privilege('authenticated', 'public.utilisateurs', 'TRUNCATE') t`)).rows[0].t;
  assert.equal(tr, true);
});

test("21. la migration ne touche ni données ni policies", () => {
  const code = MIGRATION.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  const corps = code.replace(/\$\$[\s\S]*?\$\$/g, "$$…$$"); // le corps plpgsql n'est pas du DML exécuté
  assert.ok(!/\bupdate\s+(public\.)?\w+\s+set\b|\bdelete\s+from\b|\binsert\s+into\b|\btruncate\s+(table\s+)?public\b/i.test(corps), "aucun DML");
  assert.ok(!/\b(drop|alter|create)\s+policy\b/i.test(code), "aucune policy touchée");
  assert.ok(!/\bdrop\s+(table|column|function|trigger)\b/i.test(code), "rien de supprimé");
  assert.ok(!/alter\s+table/i.test(code), "aucune colonne modifiée");
});

// Inventaire des écritures de l'application vers utilisateurs (30/09/2026).
// Si ce test échoue, une écriture a été ajoutée : vérifier qu'elle passe le
// déclencheur (utilisateur : nav_order seul ; sinon admin ou service_role).
const ECRITURES_CONNUES = [
  "src/Invest/Admin.jsx:insert",                        // inviter()        — admin
  "src/Invest/Admin.jsx:update",                        // sauvegarder()    — admin
  "src/Invest/Admin.jsx:update",                        // toggleActif()    — admin
  "src/Renovation/Admin.jsx:insert",                    // inviter()        — admin
  "src/Renovation/Admin.jsx:update",                    // sauvegarder()    — admin
  "src/Renovation/Admin.jsx:update",                    // toggleActif()    — admin
  "src/Renovation/Navigation.jsx:update",               // nav_order        — soi-même
  "src/Renovation/Navigation.jsx:update",               // nav_order = null — soi-même
  "supabase/functions/admin-users-local/index.ts:update", // set_email      — service_role
].sort();

function fichiers(dir) {
  const out = [];
  for (const nom of readdirSync(join(racine, dir))) {
    const rel = `${dir}/${nom}`;
    if (statSync(join(racine, rel)).isDirectory()) out.push(...fichiers(rel));
    else if (/\.(jsx?|mjs|ts)$/.test(nom)) out.push(rel);
  }
  return out;
}

test("22. inventaire des écritures vers utilisateurs inchangé", () => {
  const trouvees = [];
  for (const f of [...fichiers("src"), ...fichiers("api"), ...fichiers("supabase/functions")]) {
    const src = readFileSync(join(racine, f), "utf8");
    const re = /from\(\s*["'`]utilisateurs["'`]\s*\)([\s\S]{0,200})/g;
    for (const m of src.matchAll(re)) {
      const w = /^\s*\.(update|insert|upsert|delete)\(/.exec(m[1]);
      if (w) trouvees.push(`${f}:${w[1]}`);
    }
  }
  assert.deepEqual(trouvees.sort(), ECRITURES_CONNUES);
  const nav = lire("src/Renovation/Navigation.jsx");
  assert.match(nav, /from\("utilisateurs"\)\.update\(\{ nav_order: ids \}\)/);
  assert.match(nav, /from\("utilisateurs"\)\.update\(\{ nav_order: null \}\)/);
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
