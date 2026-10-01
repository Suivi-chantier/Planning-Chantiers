#!/usr/bin/env node
// Vérifie l'étape 3a du chantier sécurité (deny by default) sur une RÉPLIQUE de
// la structure de production : les 101 tables de public et storage.objects
// (colonnes, RLS, droits, 162 policies, fonctions utilisées par les policies),
// reconstruites depuis scripts/fixtures/catalogue-prod-20261001.json (catalogue
// PostgreSQL extrait en lecture seule le 01/10/2026 — structure seule, aucune
// ligne de données de production).
//
// Méthode DIFFÉRENTIELLE : la même base fictive est sondée AVANT puis APRÈS la
// migration 20261001150000, pour chaque persona et chaque table : lecture
// (nombre de lignes visibles), création, modification, suppression (chaque
// essai annulé). Attendus :
//   - collaborateurs actifs (admin, commercial, comptable, agent EDL, ouvrier
//     responsable, ouvrier simple) : résultats IDENTIQUES avant / après ;
//   - client Invest, compte sans fiche, collaborateur désactivé, fiche active
//     mais jeton étiqueté client : plus rien après ;
//   - anon : IDENTIQUE avant / après (les ouvertures anonymes relèvent de 3c) ;
//   - service_role : voit tout, avant comme après.
// Données des tables : fictives, générées ici (aucune donnée réelle).
//
//   npm install --no-save @electric-sql/pglite   (une fois)
//   node scripts/verif-collaborateurs-seulement.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
const CAT = JSON.parse(lire("scripts/fixtures/catalogue-prod-20261001.json"));
const MIGRATION = lire("supabase/migrations/20261001150000_profero_collaborateurs_seulement.sql");
const ROLLBACK = lire("sql/202610_profero_collaborateurs_seulement_rollback.sql");
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");

const BUCKETS = ["chantier-documents", "invest-documents", "photos"];
const id = (s) => `"${s.replace(/"/g, '""')}"`;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ── Personas (toutes fictives) ──────────────────────────────────────────────
const P = {
  admin:       { email: "admin@test.fr", role: "admin", actif: true, branches: '["renovation","invest"]', prenom: "Alice" },
  commercial:  { email: "commercial@test.fr", role: "commercial", actif: true, branches: '["invest"]', prenom: "Camille" },
  comptable:   { email: "comptable@test.fr", role: "comptable", actif: true, branches: '["renovation"]', prenom: "Claude" },
  agent_edl:   { email: "edl@test.fr", role: "agent_edl", actif: true, branches: '["invest"]', prenom: "Eddy" },
  ouvrier_resp:{ email: "bernard@test.fr", role: "ouvrier", actif: true, branches: '["renovation"]', prenom: "Bernard" },
  ouvrier:     { email: "paul@test.fr", role: "ouvrier", actif: true, branches: '["renovation"]', prenom: "Paul" },
  desactive:   { email: "ancien@test.fr", role: "commercial", actif: false, branches: '["invest"]', prenom: "Ancien" },
};
const COLLABORATEURS = ["admin", "commercial", "comptable", "agent_edl", "ouvrier_resp", "ouvrier"];
// Comptes connectés qui ne doivent plus rien atteindre après 3a.
const NON_COLLABORATEURS = {
  client_invest: { email: "client@exemple.fr", population: "client_invest" },          // futur client du portail
  sans_fiche: { email: "inconnu@exemple.fr", population: null },                        // jeton sans fiche ni étiquette
  desactive: { email: P.desactive.email, population: "collaborateur" },                // fiche inactive
  fiche_mais_client: { email: P.commercial.email, population: "client_invest" },       // étiqueté client : jamais collaborateur
};

// ── Construction de la réplique ─────────────────────────────────────────────
const LETTRES = { r: "select", a: "insert", w: "update", d: "delete", D: "truncate", x: "references", t: "trigger" };
function grants(acl, objet) {
  const out = [];
  for (const m of acl.replace(/[{}"]/g, "").split(",").filter(Boolean)) {
    const [qui, reste] = m.split("=");
    const droits = (reste || "").split("/")[0];
    if (!["anon", "authenticated", "service_role"].includes(qui)) continue;
    const privs = [...droits].map((l) => LETTRES[l]).filter(Boolean);
    if (privs.length) out.push(`grant ${privs.join(", ")} on ${objet} to ${qui};`);
  }
  return out.join("\n");
}

function valeur(type, nomCol, rang) {
  const t = type.toLowerCase();
  const prenom = rang === 0 ? "Bernard" : rang === 1 ? "Paul" : "Zoé";
  if (t === "uuid") return "gen_random_uuid()";
  if (t === "uuid[]") return "array[gen_random_uuid()]";
  if (t === "text[]") return `array[${lit(prenom)}]`;
  if (t === "bigint[]") return `array[${rang + 1}]::bigint[]`;
  if (t === "jsonb" || t === "json") return `'{}'::jsonb`;
  if (t === "boolean") return rang === 1 ? "false" : "true";
  if (t.startsWith("timestamp")) return "now()";
  if (t === "date") return "current_date";
  if (t.startsWith("time")) return "'12:00'";
  if (/^(numeric|integer|bigint|smallint|double|real)/.test(t)) return String(rang + 1);
  // Texte : la première ligne « appartient » à l'ouvrier responsable, au client fictif ou à l'admin selon le nom de colonne.
  if (/mail/.test(nomCol)) return lit([P.admin.email, P.ouvrier.email, "client@exemple.fr"][rang]);
  if (nomCol === "bucket_id") return lit(BUCKETS[rang]);
  if (nomCol === "name") return lit(`chantiers/fichier-${rang}.jpg`);
  return lit(prenom);
}

async function construire() {
  const db = new PGlite();
  await db.exec(`
    set check_function_bodies = off;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role supabase_auth_admin nologin; create role supabase_storage_admin nologin;
    create schema auth; create schema storage;
    grant usage on schema auth, storage, public to anon, authenticated, service_role;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.email() returns text language sql stable as $$ select auth.jwt() ->> 'email' $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table storage.buckets (id text primary key, public boolean);
    insert into storage.buckets values ${BUCKETS.map((b) => `(${lit(b)}, ${b === "photos"})`).join(", ")};
  `);
  for (const t of CAT.tables) {
    const nom = `${t.schema}.${id(t.nom)}`;
    await db.exec(`create table ${nom} (${t.colonnes.map((c) => `${id(c.nom)} ${c.type}`).join(", ")});`);
    if (t.rls) await db.exec(`alter table ${nom} enable row level security;`);
    const g = grants(t.acl, nom);
    if (g) await db.exec(g);
  }
  for (const f of CAT.storage_fonctions) await db.exec(f);
  for (const f of CAT.fonctions) {
    await db.exec(f.def);
    if (f.acl) {
      const sig = f.def.match(/FUNCTION (public\.\w+\([^)]*\))/)[1].replace(/\b(\w+) (text|uuid|jsonb)\b/g, "$2");
      await db.exec(`revoke all on function ${sig} from public;`);
      for (const m of f.acl.replace(/[{}"]/g, "").split(",").filter(Boolean)) {
        const [qui, reste] = m.split("=");
        if (["anon", "authenticated", "service_role", "supabase_auth_admin"].includes(qui) && (reste || "").includes("X")) {
          await db.exec(`grant execute on function ${sig} to ${qui};`);
        }
      }
    }
  }
  for (const p of CAT.policies) {
    const roles = p.roles.map((r) => (r === "public" ? "public" : r)).join(", ");
    await db.exec(`create policy ${id(p.nom)} on ${p.schema}.${id(p.table)} as ${p.permissive} for ${p.cmd} to ${roles}`
      + (p.qual ? ` using (${p.qual})` : "") + (p.with_check ? ` with check (${p.with_check})` : "") + ";");
  }
  // Données fictives : 3 lignes par table (première = ouvrier responsable / admin, deuxième = ouvrier simple, troisième = tiers).
  for (const t of CAT.tables) {
    if (t.nom === "utilisateurs" || t.nom === "planning_config") continue;
    for (let rang = 0; rang < 3; rang++) {
      await db.exec(`insert into ${t.schema}.${id(t.nom)} (${t.colonnes.map((c) => id(c.nom)).join(", ")})
        values (${t.colonnes.map((c) => valeur(c.type, c.nom, rang)).join(", ")});`);
    }
  }
  const colsU = new Set(CAT.tables.find((t) => t.nom === "utilisateurs").colonnes.map((c) => c.nom));
  for (const u of Object.values(P)) {
    const champs = { id: "gen_random_uuid()", email: lit(u.email), nom: lit(u.prenom), role: lit(u.role), actif: String(u.actif),
      branches: `${lit(u.branches)}::jsonb`, prenom_planning: lit(u.prenom) };
    const k = Object.keys(champs).filter((c) => colsU.has(c));
    await db.exec(`insert into public.utilisateurs (${k.map(id).join(", ")}) values (${k.map((c) => champs[c]).join(", ")});`);
  }
  const colsC = CAT.tables.find((t) => t.nom === "planning_config").colonnes.map((c) => c.nom);
  const cfg = (key, value) => `insert into public.planning_config (${["key", "value"].filter((c) => colsC.includes(c)).join(", ")}) values (${lit(key)}, ${lit(JSON.stringify(value))}::jsonb);`;
  await db.exec(cfg("access_pages_invest", CAT.access_pages_invest));
  await db.exec(cfg("equipes", { items: [{ nom: "Équipe test", responsable: "Bernard", membres: ["Bernard", "Paul"] }] }));
  return db;
}

// ── Sondes ──────────────────────────────────────────────────────────────────
// Chaque essai s'exécute dans sa transaction, annulée : la base reste identique.
async function essai(db, role, claims, sql) {
  let res = null;
  try {
    await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await tx.query(`select set_config('role', $1, true)`, [role]);
      const r = await tx.query(sql);
      res = { n: r.rows?.[0]?.n ?? r.affectedRows ?? 0 };
      throw new Error("__annuler__");
    });
  } catch (e) {
    if (e.message !== "__annuler__") res = { erreur: e.code || e.message.slice(0, 40) };
  }
  return res;
}
const claimsDe = (email, population, role = "authenticated") => ({ role, ...(email ? { email, sub: "00000000-0000-0000-0000-000000000099" } : {}), ...(population ? { profero_population: population } : {}) });

async function sonder(db, role, claims) {
  const out = {};
  for (const t of CAT.tables) {
    const nom = `${t.schema}.${id(t.nom)}`;
    const c0 = t.colonnes[0];
    const autre = t.colonnes.find((c) => c.nom !== "id") || c0;
    out[nom] = {
      lecture: await essai(db, role, claims, `select count(*)::int n from ${nom}`),
      creation: await essai(db, role, claims, `insert into ${nom} (${t.colonnes.map((c) => id(c.nom)).join(", ")}) values (${t.colonnes.map((c) => valeur(c.type, c.nom, 0)).join(", ")})`),
      modification: await essai(db, role, claims, `update ${nom} set ${id(autre.nom)} = ${id(autre.nom)}`),
      suppression: await essai(db, role, claims, `delete from ${nom}`),
    };
  }
  return out;
}
const visible = (s) => Object.entries(s).filter(([, v]) => v.lecture?.n > 0 || v.creation?.n > 0 || v.modification?.n > 0 || v.suppression?.n > 0).map(([k]) => k);

// ── Vérifications ───────────────────────────────────────────────────────────
const cas = [];
const test = (n, f) => cas.push([n, f]);
const db = await construire();
const politiquesAvant = (await db.query(`select schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check from pg_policies order by 1,2,3`)).rows;
const AVANT = {};
for (const k of COLLABORATEURS) AVANT[k] = await sonder(db, "authenticated", claimsDe(P[k].email, "collaborateur"));
for (const [k, v] of Object.entries(NON_COLLABORATEURS)) AVANT[k] = await sonder(db, "authenticated", claimsDe(v.email, v.population));
AVANT.anon = await sonder(db, "anon", { role: "anon" });
AVANT.service = await sonder(db, "service_role", { role: "service_role" });
await db.exec(MIGRATION);
const APRES = {};
for (const k of COLLABORATEURS) APRES[k] = await sonder(db, "authenticated", claimsDe(P[k].email, "collaborateur"));
for (const [k, v] of Object.entries(NON_COLLABORATEURS)) APRES[k] = await sonder(db, "authenticated", claimsDe(v.email, v.population));
APRES.anon = await sonder(db, "anon", { role: "anon" });
APRES.service = await sonder(db, "service_role", { role: "service_role" });

test("0. réplique fidèle : 101 tables public + storage.objects, 162 policies, fonctions des policies chargées", async () => {
  assert.equal(CAT.tables.filter((t) => t.schema === "public").length, 101);
  assert.equal(politiquesAvant.length, 162);
  assert.ok(visible(AVANT.admin).length > 50, "l'admin voit l'essentiel");
  // Témoin du problème. NB : les 54 policies « NOT est_ouvrier() » ne s'ouvrent PAS à un compte sans fiche
  // (mon_role() NULL → NOT NULL = NULL = refus) ; l'exposition réelle d'un client est plus étroite mais existe.
  const avant = visible(AVANT.client_invest);
  for (const t of ["public.\"cr_comptes_rendus\"", "public.\"invest_events\"", "public.\"invest_morning_routines\"", "storage.\"objects\""]) {
    assert.ok(avant.includes(t), `témoin : AVANT, un compte client atteint ${t}`);
  }
  assert.ok(avant.length >= 12, `témoin : AVANT, un compte client atteint ${avant.length} tables`);
});

test("1. couverture : chaque table de public et storage.objects porte la policy restrictive ; les 162 policies métier sont intactes", async () => {
  const apres = (await db.query(`select schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check from pg_policies order by 1,2,3`)).rows;
  const metier = apres.filter((p) => p.policyname !== "profero_collaborateurs_seulement");
  assert.deepEqual(metier, politiquesAvant, "aucune policy métier modifiée ni supprimée");
  const ajout = apres.filter((p) => p.policyname === "profero_collaborateurs_seulement");
  assert.equal(ajout.length, 102);
  assert.ok(ajout.every((p) => p.permissive === "RESTRICTIVE" && p.roles === "{authenticated}" && p.cmd === "ALL"));
  for (const b of BUCKETS) assert.ok(ajout.find((p) => p.tablename === "objects").qual.includes(b), `bucket ${b} identifié`);
});

for (const k of COLLABORATEURS) {
  test(`2. ${k} : droits strictement identiques avant / après sur les 102 tables (lecture, création, modification, suppression)`, async () => {
    assert.deepEqual(APRES[k], AVANT[k]);
  });
}

for (const k of Object.keys(NON_COLLABORATEURS)) {
  test(`3. ${k} : plus aucune ligne lue, créée, modifiée ni supprimée sur aucune table`, async () => {
    assert.deepEqual(visible(APRES[k]), []);
    for (const [t, v] of Object.entries(APRES[k])) {
      if (v.lecture.erreur) continue;                 // table sans droit SELECT : déjà fermée
      assert.equal(v.lecture.n, 0, `${t} lisible`);
      assert.ok(v.creation.erreur, `${t} : création acceptée`);
    }
  });
}

test("4. anon : comportement strictement identique (les ouvertures anonymes sont traitées en 3c, pas masquées)", async () => {
  assert.deepEqual(APRES.anon, AVANT.anon);
  assert.ok(visible(APRES.anon).length > 0, "témoin : des ouvertures anonymes existent encore (3c)");
});

test("5. service_role (Edge Functions, n8n/Fluidify, crons) : tout reste accessible", async () => {
  assert.deepEqual(APRES.service, AVANT.service);
  assert.ok(Object.values(APRES.service).every((v) => v.lecture.n === 3 || v.lecture.n === 7 || v.lecture.n === 2));
});

test("6. est_collaborateur_actif : condition positive, sans récursion, sans nouveau chemin d'accès", async () => {
  const f = async (claims) => (await essai(db, "authenticated", claims, `select public.est_collaborateur_actif()::int n`)).n;
  assert.equal(await f(claimsDe(P.ouvrier.email, "collaborateur")), 1);
  assert.equal(await f(claimsDe(P.ouvrier.email, null)), 1, "jeton sans étiquette : la fiche active suffit");
  assert.equal(await f(claimsDe("INCONNU@exemple.fr", "collaborateur")), 0, "étiquette collaborateur sans fiche : refus");
  assert.equal(await f(claimsDe(P.desactive.email, "collaborateur")), 0);
  assert.equal(await f(claimsDe(P.commercial.email, "client_invest")), 0);
  assert.equal(await f({ role: "authenticated" }), 0, "sans adresse : refus");
  assert.deepEqual(await essai(db, "anon", { role: "anon" }, `select public.est_collaborateur_actif()::int n`), { erreur: "42501" }, "anon ne peut pas l'appeler");
  const def = (await db.query(`select pg_get_functiondef('public.est_collaborateur_actif'::regproc) d, pronargs from pg_proc where proname = 'est_collaborateur_actif'`)).rows[0];
  assert.equal(def.pronargs, 0, "aucun paramètre : on ne peut interroger que soi-même");
  assert.ok(!/insert|update|delete/i.test(def.d), "n'écrit nulle part");
  // Lecture de utilisateurs par un collaborateur avec la policy restrictive sur utilisateurs : pas de récursion infinie.
  const u = await essai(db, "authenticated", claimsDe(P.admin.email, "collaborateur"), `select count(*)::int n from public.utilisateurs`);
  assert.equal(u.erreur, undefined);
});

test("7. retour arrière : état d'avant exactement (policies et sondes) ; migration rejouable", async () => {
  await db.exec(ROLLBACK);
  const p = (await db.query(`select schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check from pg_policies order by 1,2,3`)).rows;
  assert.deepEqual(p, politiquesAvant);
  assert.equal((await db.query(`select count(*)::int n from pg_proc where proname = 'est_collaborateur_actif'`)).rows[0].n, 0);
  assert.deepEqual(await sonder(db, "authenticated", claimsDe(NON_COLLABORATEURS.client_invest.email, "client_invest")), AVANT.client_invest);
  await db.exec(MIGRATION); await db.exec(MIGRATION);
  assert.deepEqual(await sonder(db, "authenticated", claimsDe(P.ouvrier_resp.email, "collaborateur")), AVANT.ouvrier_resp);
});

test("8. garde-fous de la migration : table ou bucket non couverts → la migration échoue sans rien laisser", async () => {
  const b = await construire();
  await b.exec(`create table public.table_oubliee (id uuid); alter table public.table_oubliee enable row level security;`);
  await assert.rejects(b.exec(MIGRATION), /non couvertes par profero_collaborateurs_seulement : table_oubliee/);
  const c = await construire();
  await c.exec(`insert into storage.buckets values ('nouveau-bucket', false)`);
  await assert.rejects(c.exec(MIGRATION), /Buckets non couverts.*nouveau-bucket/);
});

test("9. migration : aucune donnée touchée, aucune policy métier retirée", () => {
  const code = MIGRATION.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  assert.ok(!/\b(insert into|update\s+\w+\s+set|delete from|truncate)\b/i.test(code));
  assert.equal([...code.matchAll(/drop policy if exists (\w+)/g)].every((m) => m[1] === "profero_collaborateurs_seulement"), true);
});

let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message.split("\n").slice(0, 12).join("\n      ")}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
