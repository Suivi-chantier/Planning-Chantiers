#!/usr/bin/env node
// Vérifie la migration 20261002100000 (pièces du client et documents Profero d'une mission) sur un
// VRAI PostgreSQL (PGlite) : la migration du hook d'accès et est_collaborateur_actif() sont appliquées
// DEPUIS LEURS FICHIERS ; clients, missions et utilisateurs sont réduits aux colonnes utiles.
// Données : exemple issu des tests, données fictives (aucune donnée réelle).
//   npm install --no-save @electric-sql/pglite   (une fois)
//   node scripts/verif-invest-documents-mission.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
const HOOK = lire("supabase/migrations/20260930170000_acces_profero_hook_sessions.sql");
const TROIS_A = lire("supabase/migrations/20261001150000_profero_collaborateurs_seulement.sql");
const MIGRATION = lire("supabase/migrations/20261002100000_invest_dossier_pieces.sql");
const ROLLBACK = lire("sql/202610_invest_dossier_pieces_rollback.sql");
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");
const m3a = TROIS_A.match(/create or replace function public\.est_collaborateur_actif\(\)[\s\S]*?grant execute on function public\.est_collaborateur_actif\(\) to authenticated;/);
assert.ok(m3a, "est_collaborateur_actif introuvable dans la migration 3a");

const ID = { admin: "00000000-0000-0000-0000-0000000000a1", commercial: "00000000-0000-0000-0000-0000000000a2", ouvrier: "00000000-0000-0000-0000-0000000000a3",
  client: "00000000-0000-0000-0000-0000000000b1", libre: "00000000-0000-0000-0000-0000000000c1",
  cA: "11111111-1111-1111-1111-1111111111a1", cB: "11111111-1111-1111-1111-1111111111b1",
  d2: "22222222-2222-2222-2222-2222222222a1", d3: "22222222-2222-2222-2222-2222222222a2", dB: "22222222-2222-2222-2222-2222222222b1" };

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
create table public.invest_dossiers (id uuid primary key, client_id uuid not null references public.invest_clients(id), reference text,
  type_mission text, statut text default 'actif');
insert into auth.users (id, email) values ('${ID.admin}','admin@test.fr'), ('${ID.commercial}','commercial@test.fr'), ('${ID.ouvrier}','ouvrier@test.fr'),
  ('${ID.client}','client@exemple.fr'), ('${ID.libre}','libre@exemple.fr');
insert into public.utilisateurs (email, nom, role, actif) values ('admin@test.fr','Admin','admin',true), ('commercial@test.fr','Commercial','commercial',true), ('ouvrier@test.fr','Ouvrier','ouvrier',true);
insert into public.invest_clients values ('${ID.cA}','Alice','Client A'), ('${ID.cB}','','Client B');
`;
// Une mission AVANT la migration (ne doit pas être touchée par la migration).
const AVANT = `insert into public.invest_dossiers (id, client_id, reference, type_mission) values ('${ID.d2}','${ID.cA}','INV-A2','accompagnement_acquisition');`;

async function base({ migration = true } = {}) {
  const db = new PGlite();
  await db.exec(SCHEMA); await db.exec(HOOK); await db.exec(m3a[0]); await db.exec(AVANT);
  if (migration) await db.exec(MIGRATION);
  return db;
}
const jeton = (id, email, population = "collaborateur") => ({ sub: id, email, role: "authenticated", ...(population ? { profero_population: population } : {}) });
const J = { admin: jeton(ID.admin, "admin@test.fr"), commercial: jeton(ID.commercial, "commercial@test.fr"), ouvrier: jeton(ID.ouvrier, "ouvrier@test.fr"),
  client: jeton(ID.client, "client@exemple.fr", "client_invest"), libre: jeton(ID.libre, "libre@exemple.fr", null),
  commercialFalsifie: jeton(ID.commercial, "commercial@test.fr", "client_invest") };
async function sous(db, role, claims, sql, params = []) {
  try { return await db.transaction(async (tx) => {
    await tx.query(`select set_config('role', $1, true)`, [role]);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role })]);
    const r = await tx.query(sql, params); return { rows: r.rows, erreur: null }; }); }
  catch (e) { return { rows: [], erreur: e }; }
}
const n = async (db, where = "true") => (await db.query(`select count(*)::int n from public.invest_dossier_pieces where ${where}`)).rows[0].n;
const nouvelle = (db, id, client, type) => db.query(`insert into public.invest_dossiers (id, client_id, reference, type_mission) values ($1,$2,$3,$4)`, [id, client, `INV-${id.slice(-2)}`, type]);

const cas = []; const test = (nom, fn) => cas.push([nom, fn]);
const OFFRE2 = 12, OFFRE3 = 50; // 11 pièces + lettre ; 47 pièces + 3 documents

test("1. une NOUVELLE mission reçoit sa liste : 12 éléments en Offre 2, 50 en Offre 3 dont le rapport de restitution", async () => {
  const db = await base();
  await nouvelle(db, ID.d3, ID.cA, "audit_patrimonial"); await nouvelle(db, ID.dB, ID.cB, "accompagnement_acquisition");
  assert.equal(await n(db, `dossier_id='${ID.dB}'`), OFFRE2);
  assert.equal(await n(db, `dossier_id='${ID.d3}'`), OFFRE3);
  assert.equal(await n(db, `dossier_id='${ID.dB}' and categorie='rapport_restitution'`), 0, "pas de rapport de restitution en Offre 2");
  assert.equal(await n(db, `dossier_id='${ID.d3}' and categorie='rapport_restitution' and genre='document_profero' and statut='a_produire'`), 1);
  assert.equal(await n(db, `dossier_id='${ID.d3}' and genre='document_profero'`), 3);
  assert.equal(await n(db, `statut not in ('a_demander','a_produire')`), 0, "tout démarre « à demander » / « à produire »");
});
test("2. la mission existante AVANT la migration n'est pas touchée", async () => {
  const db = await base();
  assert.equal(await n(db, `dossier_id='${ID.d2}'`), 0);
});
test("3. préparer la liste d'une mission existante : réservé au CRM, idempotent, rien d'écrasé", async () => {
  const db = await base();
  const q = (j) => sous(db, "authenticated", j, `select public.invest_dossier_pieces_preparer('${ID.d2}') as n`);
  for (const [nom, j] of [["ouvrier", J.ouvrier], ["sans fiche", J.libre], ["client", J.client], ["jeton falsifié", J.commercialFalsifie]]) assert.ok((await q(j)).erreur, `refusé : ${nom}`);
  assert.ok((await sous(db, "anon", null, `select public.invest_dossier_pieces_preparer('${ID.d2}')`)).erreur, "anon refusé");
  assert.equal(await n(db), 0);
  assert.equal((await q(J.commercial)).rows[0].n, OFFRE2);
  await db.query(`update public.invest_dossier_pieces set statut='recue', commentaire='reçue par mail' where libelle='RIB'`);
  assert.equal((await q(J.admin)).rows[0].n, 0, "deuxième appel : rien à ajouter");
  assert.equal((await db.query(`select statut, commentaire from public.invest_dossier_pieces where libelle='RIB'`)).rows[0].statut, "recue", "modification conservée");
});
test("4. passer en Offre 3 puis préparer : seul ce qui manque est ajouté", async () => {
  const db = await base();
  await sous(db, "authenticated", J.admin, `select public.invest_dossier_pieces_preparer('${ID.d2}')`);
  await db.query(`update public.invest_dossiers set type_mission='audit_patrimonial' where id='${ID.d2}'`);
  assert.equal((await sous(db, "authenticated", J.admin, `select public.invest_dossier_pieces_preparer('${ID.d2}') as n`)).rows[0].n, OFFRE3 - OFFRE2);
  assert.equal(await n(db, `dossier_id='${ID.d2}'`), OFFRE3);
});
test("5. le fichier ne peut être que dans le dossier de SA mission (autre mission, autre client, .., sans préfixe : refusés)", async () => {
  const db = await base(); await nouvelle(db, ID.dB, ID.cB, "accompagnement_acquisition");
  const ok = `clients/${ID.cA}/mission/${ID.d2}/piece_client/1_cni.pdf`;
  const ins = (chemin) => sous(db, "authenticated", J.commercial, `insert into public.invest_dossier_pieces (dossier_id, client_id, genre, categorie, libelle, statut, chemin) values ('${ID.d2}','${ID.cA}','piece_client','identite','Test ${Math.random()}','recue',$1)`, [chemin]);
  assert.equal((await ins(ok)).erreur, null);
  for (const mauvais of [`clients/${ID.cA}/mission/${ID.dB}/x.pdf`, `clients/${ID.cB}/mission/${ID.d2}/x.pdf`, `clients/${ID.cA}/mission/${ID.d2}/../${ID.dB}/x.pdf`,
    `clients/${ID.cA}/x.pdf`, `biens/x/y.pdf`, `clients/${ID.cA}/mission/${ID.d2}`]) assert.ok((await ins(mauvais)).erreur, `refusé : ${mauvais}`);
});
test("6. statuts : un statut de pièce n'est pas valable pour un document Profero (et inversement)", async () => {
  const db = await base();
  const ins = (genre, statut, l) => sous(db, "authenticated", J.admin, `insert into public.invest_dossier_pieces (dossier_id, client_id, genre, categorie, libelle, statut) values ('${ID.d2}','${ID.cA}','${genre}','autre','${l}','${statut}')`);
  assert.equal((await ins("piece_client", "validee", "a")).erreur, null);
  assert.equal((await ins("document_profero", "remis_client", "b")).erreur, null);
  assert.ok((await ins("piece_client", "depose", "c")).erreur); assert.ok((await ins("document_profero", "recue", "d")).erreur);
  assert.ok((await ins("piece_client", "n_importe_quoi", "e")).erreur); assert.ok((await ins("autre_genre", "recue", "f")).erreur);
});
test("7. client_id est toujours celui de la mission, même si on en saisit un autre", async () => {
  const db = await base();
  await sous(db, "authenticated", J.admin, `insert into public.invest_dossier_pieces (dossier_id, client_id, genre, categorie, libelle, statut) values ('${ID.d2}','${ID.cB}','piece_client','autre','Pièce','a_demander')`);
  assert.equal((await db.query(`select client_id from public.invest_dossier_pieces where libelle='Pièce'`)).rows[0].client_id, ID.cA);
  await sous(db, "authenticated", J.admin, `update public.invest_dossier_pieces set client_id='${ID.cB}' where libelle='Pièce'`);
  assert.equal((await db.query(`select client_id from public.invest_dossier_pieces where libelle='Pièce'`)).rows[0].client_id, ID.cA, "un changement de client est annulé");
  assert.ok((await sous(db, "authenticated", J.admin, `insert into public.invest_dossier_pieces (dossier_id, genre, categorie, libelle, statut) values ('99999999-9999-9999-9999-999999999999','piece_client','a','b','a_demander')`)).erreur, "mission inconnue refusée");
});
test("8. accès : admin et commercial lisent et écrivent ; ouvrier, sans fiche, client, jeton falsifié et anon : rien", async () => {
  const db = await base(); await sous(db, "authenticated", J.admin, `select public.invest_dossier_pieces_preparer('${ID.d2}')`);
  for (const [nom, j] of [["admin", J.admin], ["commercial", J.commercial]]) {
    assert.equal((await sous(db, "authenticated", j, `select * from public.invest_dossier_pieces`)).rows.length, OFFRE2, nom);
    assert.equal((await sous(db, "authenticated", j, `update public.invest_dossier_pieces set statut='demandee' where libelle='RIB' returning id`)).rows.length, 1, nom);
  }
  for (const [nom, j] of [["ouvrier", J.ouvrier], ["sans fiche", J.libre], ["client", J.client], ["jeton falsifié", J.commercialFalsifie]]) {
    assert.equal((await sous(db, "authenticated", j, `select * from public.invest_dossier_pieces`)).rows.length, 0, `lecture : ${nom}`);
    assert.equal((await sous(db, "authenticated", j, `update public.invest_dossier_pieces set statut='validee' returning id`)).rows.length, 0, `modification : ${nom}`);
    assert.ok((await sous(db, "authenticated", j, `delete from public.invest_dossier_pieces`)).erreur || (await n(db)) === OFFRE2, `suppression : ${nom}`);
  }
  assert.ok((await sous(db, "anon", null, `select * from public.invest_dossier_pieces`)).erreur, "anon");
  assert.equal(await n(db), OFFRE2, "rien n'a été supprimé");
});
test("9. règles du dépôt : restrictive 3a présente, aucun droit anon, fonctions internes non appelables", async () => {
  const db = await base();
  const pol = (await db.query(`select policyname, permissive from pg_policies where tablename='invest_dossier_pieces' order by 1`)).rows.map((r) => `${r.policyname}:${r.permissive}`);
  assert.deepEqual(pol, ["invest_dossier_pieces_crm:PERMISSIVE", "profero_collaborateurs_seulement:RESTRICTIVE"]);
  assert.equal((await db.query(`select has_table_privilege('anon','public.invest_dossier_pieces','select') a`)).rows[0].a, false);
  for (const f of ["invest_dossier_pieces_semer(uuid)", "invest_dossiers_semer_pieces()", "invest_dossier_pieces_client()"])
    for (const r of ["anon", "authenticated"]) assert.equal((await db.query(`select has_function_privilege('${r}','public.${f}','execute') a`)).rows[0].a, false, `${f} / ${r}`);
  assert.equal((await db.query(`select has_function_privilege('anon','public.invest_dossier_pieces_preparer(uuid)','execute') a`)).rows[0].a, false);
});
test("10. un incident de préparation ne bloque JAMAIS l'ouverture d'une mission", async () => {
  const db = await base();
  await db.exec(`alter table public.invest_dossier_pieces rename to pieces_cassee`);
  await nouvelle(db, ID.dB, ID.cB, "accompagnement_acquisition");
  assert.equal((await db.query(`select count(*)::int n from public.invest_dossiers where id='${ID.dB}'`)).rows[0].n, 1, "la mission est bien créée");
});
test("11. supprimer une mission supprime ses pièces ; supprimer un client aussi", async () => {
  const db = await base(); await nouvelle(db, ID.d3, ID.cA, "audit_patrimonial");
  await db.query(`delete from public.invest_dossiers where id='${ID.d3}'`);
  assert.equal(await n(db, `dossier_id='${ID.d3}'`), 0);
});
test("12. retour arrière : tout est retiré, les missions sont intactes, ouvrir une mission fonctionne encore", async () => {
  const db = await base(); await nouvelle(db, ID.d3, ID.cA, "audit_patrimonial");
  await db.exec(ROLLBACK);
  assert.equal((await db.query(`select count(*)::int n from pg_class where relname='invest_dossier_pieces'`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int n from pg_proc where proname like 'invest_dossier%pieces%'`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int n from public.invest_dossiers`)).rows[0].n, 2);
  await nouvelle(db, ID.dB, ID.cB, "accompagnement_acquisition");
});

let echecs = 0;
for (const [nom, fn] of cas) { try { await fn(); console.log(`  ✔ ${nom}`); } catch (e) { echecs++; console.log(`  ✘ ${nom}\n      ${e.message.split("\n")[0]}`); } }
console.log(`\n${cas.length - echecs}/${cas.length} contrôles conformes`);
process.exit(echecs ? 1 : 0);
