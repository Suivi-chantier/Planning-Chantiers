#!/usr/bin/env node
// Vérifie l'étape 1 du portail client Invest (migration 20261001190000) sur un
// VRAI PostgreSQL (PGlite, en mémoire) : la migration du hook d'accès et la
// fonction est_collaborateur_actif() sont appliquées DEPUIS LEURS FICHIERS ;
// utilisateurs, invest_clients et auth sont réduits aux colonnes utiles.
// Données : exemple issu des tests, données fictives (aucune donnée réelle).
//
// Parties : 1. hook (population client_invest) · 2. étanchéité entre clients et
// avec le bureau · 3. révocation · 4. retour arrière · 5. lecture seule (vues
// portail_*, indicateurs visible_client / portail_visible).
//
//   npm install --no-save @electric-sql/pglite   (une fois)
//   node scripts/verif-portail-client-invest.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
const HOOK = lire("supabase/migrations/20260930170000_acces_profero_hook_sessions.sql");
const TROIS_A = lire("supabase/migrations/20261001150000_profero_collaborateurs_seulement.sql");
const MIGRATION = lire("supabase/migrations/20261001190000_portail_client_invest_liaison.sql");
const ROLLBACK = lire("sql/202610_portail_client_invest_liaison_rollback.sql");
const LECTURE = lire("supabase/migrations/20261001200000_portail_client_invest_lecture.sql");
const LECTURE_ROLLBACK = lire("sql/202610_portail_client_invest_lecture_rollback.sql");
const DOCUMENTS = lire("supabase/migrations/20261001210000_portail_client_invest_documents.sql");
const DOCUMENTS_ROLLBACK = lire("sql/202610_portail_client_invest_documents_rollback.sql");
const ECRAN = lire("supabase/migrations/20261001220000_portail_client_invest_ecran.sql");
const ECRAN_ROLLBACK = lire("sql/202610_portail_client_invest_ecran_rollback.sql");
const INVITATION = lire("supabase/migrations/20261001230000_portail_client_invest_invitation.sql");
const INVITATION_ROLLBACK = lire("sql/202610_portail_client_invest_invitation_rollback.sql");
const FONCTION_DOC = lire("supabase/functions/portail-document-url/index.ts");
const { PGlite } = await import(
  process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite"
);

// La vraie est_collaborateur_actif() est extraite du fichier 3a (pas réécrite).
const m3a = TROIS_A.match(/create or replace function public\.est_collaborateur_actif\(\)[\s\S]*?grant execute on function public\.est_collaborateur_actif\(\) to authenticated;/);
assert.ok(m3a, "est_collaborateur_actif introuvable dans la migration 3a");

const ID = {
  admin: "00000000-0000-0000-0000-0000000000a1",
  commercial: "00000000-0000-0000-0000-0000000000a2",
  cA1: "00000000-0000-0000-0000-0000000000b1",   // compte client A (1er du couple)
  cA2: "00000000-0000-0000-0000-0000000000b2",   // compte client A (2e du couple)
  cB1: "00000000-0000-0000-0000-0000000000b3",   // compte client B
  libre: "00000000-0000-0000-0000-0000000000c1", // compte Auth sans fiche ni lien
  ouvrier: "00000000-0000-0000-0000-0000000000d1",
  clientA: "11111111-1111-1111-1111-1111111111a1",
  clientB: "11111111-1111-1111-1111-1111111111b1",
};

const SCHEMA = `
create role anon nologin; create role authenticated nologin;
create role service_role nologin bypassrls; create role supabase_admin nologin;
create role supabase_auth_admin nologin;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.email() returns text language sql stable as $$ select auth.jwt() ->> 'email' $$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
-- Droits par défaut de Supabase : tout objet créé ensuite dans public est accordé à anon,
-- authenticated et service_role (c'est ce qui a rendu les vues modifiables en production).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role, supabase_admin;
create table auth.users (id uuid primary key, email varchar, phone text, is_anonymous boolean not null default false);
create table auth.sessions (id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz default now(),
  refresh_token_hmac_key text, refresh_token_counter bigint);
create table auth.refresh_tokens (id bigserial primary key, token varchar, user_id varchar, revoked boolean default false,
  session_id uuid references auth.sessions(id) on delete cascade);
create table public.utilisateurs (id uuid primary key default gen_random_uuid(), email text, nom text,
  role text default 'conducteur', actif boolean default true, branches jsonb default '["renovation"]'::jsonb,
  prenom_planning text, nav_order jsonb);
grant all on public.utilisateurs to anon, authenticated, service_role, supabase_admin;
create function public.is_admin() returns boolean language sql stable security definer as $$
  select exists (select 1 from utilisateurs where email = auth.email() and role = 'admin' and actif = true) $$;
grant execute on function public.is_admin() to anon, authenticated, service_role;
create function public.invest_peut_voir(p text) returns boolean language sql stable security definer as $$
  select exists (select 1 from utilisateurs where email = auth.email() and actif and role in ('admin','commercial')) $$;
grant execute on function public.invest_peut_voir(text) to authenticated;
create table public.invest_clients (id uuid primary key, prenom text, nom text, email text, telephone text, notes_rapides text);
grant all on public.invest_clients to anon, authenticated, service_role;
create table public.invest_dossiers (id uuid primary key, client_id uuid, reference text, libelle text, type_mission text,
  statut text, date_ouverture date, lettre_mission_statut text, lettre_mission_signee_le date,
  honoraires_prevus_ht numeric, questionnaire_data jsonb, portail_visible boolean not null default false);
create table public.invest_dossier_etapes (id uuid primary key default gen_random_uuid(), dossier_id uuid, operation_id uuid, etape text, statut text,
  date_debut date, date_fin date, commentaire text, blocage_motif text, balle text);
create table public.invest_dossier_evenements (id uuid primary key default gen_random_uuid(), dossier_id uuid, client_id uuid,
  type text, resume text, avant jsonb, apres jsonb, survenu_le timestamptz default now(), visible_client boolean not null default false);
create table public.invest_mission_actions (id uuid primary key default gen_random_uuid(), client_id uuid, dossier_id uuid,
  step_label text, action_title text, status text, due_date date, completed_at timestamptz,
  notification_body text, commentaire text, responsable_email text);
do $$ declare t text; begin
  foreach t in array array['invest_dossiers','invest_dossier_etapes','invest_dossier_evenements','invest_mission_actions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant all on public.%I to authenticated, service_role', t);
    -- droits métier existants : tout compte connecté (comme les policies de production avant 3a)
    execute format('create policy ouvert on public.%I for all to authenticated using (true) with check (true)', t);
  end loop; end $$;
insert into auth.users (id, email) values
  ('${ID.admin}','admin@test.fr'), ('${ID.commercial}','commercial@test.fr'),
  ('${ID.cA1}','a1@exemple.fr'), ('${ID.cA2}','a2@exemple.fr'), ('${ID.cB1}','b1@exemple.fr'),
  ('${ID.libre}','libre@exemple.fr'), ('${ID.ouvrier}','ouvrier@test.fr');
insert into public.utilisateurs (email, nom, role, actif) values
  ('admin@test.fr','Admin','admin',true), ('commercial@test.fr','Commercial','commercial',true), ('ouvrier@test.fr','Ouvrier','ouvrier',true);
insert into public.invest_clients (id, prenom, nom, email, telephone, notes_rapides) values ('${ID.clientA}','Alice','Client A','a1@exemple.fr','0600000001','note interne A'), ('${ID.clientB}','','Client B','b1@exemple.fr','0600000002','note interne B');
insert into auth.sessions (user_id) select id from auth.users;
`;

async function base({ migration = true, lecture = false, documents = false, ecran = false, invitation = false } = {}) {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(HOOK);
  await db.exec(m3a[0]);
  if (migration) await db.exec(MIGRATION);
  if (lecture) {
    // 3a sur les tables métier de la réplique (policy restrictive)
    await db.exec(`do $$ declare t text; begin
      foreach t in array array['invest_dossiers','invest_dossier_etapes','invest_dossier_evenements','invest_mission_actions'] loop
        execute format('create policy profero_collaborateurs_seulement on public.%I as restrictive for all to authenticated using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()))', t);
      end loop; end $$;`);
    await db.exec(LECTURE);
  }
  if (documents) {
    await db.exec(`create policy profero_collaborateurs_seulement on public.invest_dossiers as restrictive for all to authenticated using (true)`).catch(() => {});
    await db.exec(DOCUMENTS);
  }
  if (ecran) await db.exec(ECRAN);
  if (invitation) await db.exec(INVITATION);
  return db;
}
// Jetons tels que le hook les pose : sub, email, role, profero_population.
const jeton = (id, email, population) => ({ sub: id, email, role: "authenticated", ...(population ? { profero_population: population } : {}) });
const J = {
  admin: jeton(ID.admin, "admin@test.fr", "collaborateur"),
  commercial: jeton(ID.commercial, "commercial@test.fr", "collaborateur"),
  cA1: jeton(ID.cA1, "a1@exemple.fr", "client_invest"),
  cA2: jeton(ID.cA2, "a2@exemple.fr", "client_invest"),
  cB1: jeton(ID.cB1, "b1@exemple.fr", "client_invest"),
  libre: jeton(ID.libre, "libre@exemple.fr", null),
  ouvrier: jeton(ID.ouvrier, "ouvrier@test.fr", "collaborateur"),
};
async function sous(db, role, claims, sql, params = []) {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`select set_config('role', $1, true)`, [role]);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role })]);
      const r = await tx.query(sql, params);
      return { rows: r.rows, erreur: null };
    });
  } catch (e) { return { rows: [], erreur: e }; }
}
const lier = (db, client, user, statut = "actif") =>
  db.query(`insert into public.invest_portail_comptes (client_id, auth_user_id, statut) values ($1,$2,$3)`, [client, user, statut]);
const hook = async (db, userId) => (await db.transaction(async (tx) => {
  await tx.query(`select set_config('role','supabase_auth_admin',true)`);
  const ev = { user_id: userId, claims: { sub: userId, role: "authenticated" }, authentication_method: "password" };
  return tx.query(`select public.acces_profero_hook($1::jsonb) as r`, [JSON.stringify(ev)]);
})).rows[0].r;
const sessions = async (db, id) => (await db.query(`select count(*)::int n from auth.sessions where user_id=$1`, [id])).rows[0].n;

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ── 1. Hook ────────────────────────────────────────────────────────────
test("1.1 sans lien, un compte Auth reste refusé (la migration seule n'ouvre rien)", async () => {
  const db = await base();
  assert.equal((await hook(db, ID.cA1)).error?.http_code, 403);
  assert.equal((await hook(db, ID.libre)).error?.http_code, 403);
});
test("1.2 compte lié et actif : jeton accordé, population client_invest", async () => {
  const db = await base(); await lier(db, ID.clientA, ID.cA1);
  assert.equal((await hook(db, ID.cA1)).claims.profero_population, "client_invest");
  assert.equal((await hook(db, ID.cB1)).error?.http_code, 403, "un autre compte non lié reste refusé");
});
test("1.3 compte révoqué : refusé", async () => {
  const db = await base(); await lier(db, ID.clientA, ID.cA1, "revoque");
  assert.equal((await hook(db, ID.cA1)).error?.http_code, 403);
});
test("1.4 collaborateurs inchangés ; collaborateur ET client : refusé", async () => {
  const db = await base();
  assert.equal((await hook(db, ID.admin)).claims.profero_population, "collaborateur");
  await lier(db, ID.clientA, ID.admin);
  assert.equal((await hook(db, ID.admin)).error?.http_code, 403, "les deux populations ne se mélangent jamais");
});
test("1.5 un couple : deux comptes pour un client, les deux acceptés", async () => {
  const db = await base(); await lier(db, ID.clientA, ID.cA1); await lier(db, ID.clientA, ID.cA2);
  assert.equal((await hook(db, ID.cA1)).claims.profero_population, "client_invest");
  assert.equal((await hook(db, ID.cA2)).claims.profero_population, "client_invest");
});
test("1.6 un compte ne peut pas être lié à deux clients", async () => {
  const db = await base(); await lier(db, ID.clientA, ID.cA1);
  await assert.rejects(() => lier(db, ID.clientB, ID.cA1));
});

// ── 2. Étanchéité ──────────────────────────────────────────────────────
test("2.1 portail_client_id : chaque compte ne voit que SON client", async () => {
  const db = await base();
  await lier(db, ID.clientA, ID.cA1); await lier(db, ID.clientA, ID.cA2); await lier(db, ID.clientB, ID.cB1);
  const q = (j) => sous(db, "authenticated", j, `select public.portail_client_id() as c`);
  assert.equal((await q(J.cA1)).rows[0].c, ID.clientA);
  assert.equal((await q(J.cA2)).rows[0].c, ID.clientA);
  assert.equal((await q(J.cB1)).rows[0].c, ID.clientB);
});
test("2.2 portail_client_id : null sans jeton client, avec jeton collaborateur, sans lien, ou en anon", async () => {
  const db = await base(); await lier(db, ID.clientA, ID.cA1);
  const q = (j, r = "authenticated") => sous(db, r, j, `select public.portail_client_id() as c`);
  assert.equal((await q({ ...J.cA1, profero_population: "collaborateur" })).rows[0].c, null, "étiquette falsifiée");
  assert.equal((await q({ ...J.cA1, profero_population: undefined })).rows[0].c, null, "sans étiquette");
  assert.equal((await q(J.libre)).rows[0].c, null);
  assert.equal((await q(J.admin)).rows[0].c, null);
  assert.ok((await q(J.cA1, "anon")).erreur, "anon n'a pas le droit d'exécuter la fonction");
});
test("2.3 un client ne lit, n'écrit et ne supprime rien dans la table de liaison", async () => {
  const db = await base(); await lier(db, ID.clientA, ID.cA1); await lier(db, ID.clientB, ID.cB1);
  const lecture = await sous(db, "authenticated", J.cA1, `select * from public.invest_portail_comptes`);
  assert.equal(lecture.rows.length, 0, "ne voit même pas sa propre ligne");
  const ecr = await sous(db, "authenticated", J.cA1, `update public.invest_portail_comptes set client_id = '${ID.clientB}'`);
  assert.equal(ecr.rows.length, 0);
  const ins = await sous(db, "authenticated", J.cA1, `insert into public.invest_portail_comptes (client_id, auth_user_id) values ('${ID.clientA}','${ID.libre}')`);
  assert.ok(ins.erreur, "un client ne peut pas se lier ni lier quelqu'un");
  assert.equal((await db.query(`select count(*)::int n from public.invest_portail_comptes`)).rows[0].n, 2);
});
test("2.4 anon : aucun accès à la table", async () => {
  const db = await base(); await lier(db, ID.clientA, ID.cA1);
  assert.ok((await sous(db, "anon", null, `select * from public.invest_portail_comptes`)).erreur);
});
test("2.5 [avant l'invitation] seul un administrateur gère les liens (un commercial non)", async () => {
  const db = await base();
  const adm = await sous(db, "authenticated", J.admin, `insert into public.invest_portail_comptes (client_id, auth_user_id) values ('${ID.clientA}','${ID.cA1}') returning id`);
  assert.equal(adm.erreur, null);
  const com = await sous(db, "authenticated", J.commercial, `insert into public.invest_portail_comptes (client_id, auth_user_id) values ('${ID.clientB}','${ID.cB1}')`);
  assert.ok(com.erreur);
  assert.equal((await sous(db, "authenticated", J.commercial, `select * from public.invest_portail_comptes`)).rows.length, 0);
  assert.equal((await sous(db, "authenticated", J.admin, `select * from public.invest_portail_comptes`)).rows.length, 1);
});
test("2.6 un compte lié ne devient pas collaborateur : est_collaborateur_actif() reste faux", async () => {
  const db = await base(); await lier(db, ID.clientA, ID.cA1);
  assert.equal((await sous(db, "authenticated", J.cA1, `select public.est_collaborateur_actif() as ok`)).rows[0].ok, false);
});

// ── 3. Révocation ──────────────────────────────────────────────────────
test("3.1 révoquer un compte supprime SES sessions seulement", async () => {
  const db = await base(); await lier(db, ID.clientA, ID.cA1); await lier(db, ID.clientB, ID.cB1);
  await db.query(`update public.invest_portail_comptes set statut='revoque' where auth_user_id=$1`, [ID.cA1]);
  assert.equal(await sessions(db, ID.cA1), 0);
  assert.equal(await sessions(db, ID.cB1), 1);
  assert.equal((await hook(db, ID.cA1)).error?.http_code, 403);
});
test("3.2 supprimer le lien supprime les sessions ; modifier un champ anodin non", async () => {
  const db = await base(); await lier(db, ID.clientA, ID.cA1); await lier(db, ID.clientB, ID.cB1);
  await db.query(`update public.invest_portail_comptes set invite_par='x' where auth_user_id=$1`, [ID.cB1]);
  assert.equal(await sessions(db, ID.cB1), 1);
  await db.query(`delete from public.invest_portail_comptes where auth_user_id=$1`, [ID.cA1]);
  assert.equal(await sessions(db, ID.cA1), 0);
});
test("3.3 supprimer un client supprime ses liens", async () => {
  const db = await base(); await lier(db, ID.clientA, ID.cA1);
  await db.query(`delete from public.invest_clients where id=$1`, [ID.clientA]);
  assert.equal((await db.query(`select count(*)::int n from public.invest_portail_comptes`)).rows[0].n, 0);
});

// ── 4. Retour arrière + règles du dépôt ───────────────────────────────
test("4.1 retour arrière : table retirée, hook de nouveau fermé", async () => {
  const db = await base(); await lier(db, ID.clientA, ID.cA1);
  await db.exec(ROLLBACK);
  assert.equal((await db.query(`select count(*)::int n from pg_class where relname='invest_portail_comptes'`)).rows[0].n, 0);
  assert.equal((await hook(db, ID.cA1)).error?.http_code, 403);
});
test("4.2 règles du dépôt : restrictive 3a présente, aucun droit anon, fonction sans accès anon", async () => {
  const db = await base();
  const p = await db.query(`select policyname, permissive from pg_policies where tablename='invest_portail_comptes' order by 1`);
  assert.deepEqual(p.rows.map((r) => `${r.policyname}:${r.permissive}`),
    ["invest_portail_comptes_admin:PERMISSIVE", "profero_collaborateurs_seulement:RESTRICTIVE"]);
  assert.equal((await db.query(`select has_table_privilege('anon','public.invest_portail_comptes','select') as a`)).rows[0].a, false);
  assert.equal((await db.query(`select has_function_privilege('anon','public.portail_client_id()','execute') as a`)).rows[0].a, false);
  assert.equal((await db.query(`select has_function_privilege('authenticated','public.acces_client_invest_autorise(uuid)','execute') as a`)).rows[0].a, false);
});


// ── 5. Lecture seule : uniquement ce que Profero montre ───────────────
const DA = "22222222-2222-2222-2222-2222222222a1", DA2 = "22222222-2222-2222-2222-2222222222a2", DB = "22222222-2222-2222-2222-2222222222b1";
async function jeu(db, { dossierAVisible = true } = {}) {
  await db.exec(`
    insert into public.invest_dossiers (id, client_id, reference, libelle, statut, honoraires_prevus_ht, questionnaire_data, portail_visible) values
      ('${DA}','${ID.clientA}','INV-A','Dossier A','actif',9999,'{"secret":1}',${dossierAVisible}),
      ('${DA2}','${ID.clientA}','INV-A2','Dossier A non montré','actif',1,'{}',false),
      ('${DB}','${ID.clientB}','INV-B','Dossier B','actif',8888,'{}',true);
    insert into public.invest_dossier_etapes (dossier_id, etape, statut, commentaire, blocage_motif) values
      ('${DA}','recherche','en_cours','note interne A','motif interne A'), ('${DA2}','projet','termine','x','x'), ('${DB}','recherche','en_cours','note B','motif B');
    insert into public.invest_dossier_evenements (dossier_id, client_id, type, resume, avant, visible_client) values
      ('${DA}','${ID.clientA}','etape_statut_change','Recherche démarrée','{"k":1}',true),
      ('${DA}','${ID.clientA}','etape_bloquee','INTERNE : client difficile','{"k":2}',false),
      ('${DB}','${ID.clientB}','etape_statut_change','Événement de B','{}',true);
    insert into public.invest_mission_actions (client_id, dossier_id, step_label, action_title, status, notification_body, commentaire, responsable_email) values
      ('${ID.clientA}','${DA}','Recherche','Envoyer la sélection de biens','a_faire','corps de mail interne','commentaire interne','camille@profero.fr'),
      ('${ID.clientA}','${DA}','Recherche','Relancer le vendeur (interne)','a_faire',null,null,null),
      ('${ID.clientA}','${DA2}','Projet','Tâche d''un dossier non montré','a_faire',null,null,null),
      ('${ID.clientB}','${DB}','Recherche','Tâche de B','a_faire',null,null,null);
    update public.invest_mission_actions set visible_client = true
      where action_title in ('Envoyer la sélection de biens', 'Tâche d''un dossier non montré', 'Tâche de B');`);
}
const lireVue = (db, j, v) => sous(db, "authenticated", j, `select * from public.${v}`);

test("5.1 rien n'est visible par défaut : indicateurs à faux, le client ne voit aucune ligne", async () => {
  const db = await base({ lecture: true }); await lier(db, ID.clientA, ID.cA1);
  await db.exec(`insert into public.invest_dossiers (id, client_id, reference) values ('${DA}','${ID.clientA}','INV-A');
    insert into public.invest_mission_actions (client_id, dossier_id, action_title) values ('${ID.clientA}','${DA}','t');
    insert into public.invest_dossier_evenements (dossier_id, client_id, type, resume) values ('${DA}','${ID.clientA}','x','y');
    insert into public.invest_dossier_etapes (dossier_id, etape) values ('${DA}','recherche');`);
  for (const v of ["portail_dossier", "portail_etapes", "portail_taches", "portail_evenements"])
    assert.equal((await lireVue(db, J.cA1, v)).rows.length, 0, v);
});
test("5.2 le client A voit uniquement ce qui est coché ET à lui ; jamais B", async () => {
  const db = await base({ lecture: true }); await lier(db, ID.clientA, ID.cA1); await lier(db, ID.clientB, ID.cB1); await jeu(db);
  assert.deepEqual((await lireVue(db, J.cA1, "portail_dossier")).rows.map((r) => r.reference), ["INV-A"]);
  assert.deepEqual((await lireVue(db, J.cA1, "portail_etapes")).rows.map((r) => r.etape), ["recherche"]);
  assert.deepEqual((await lireVue(db, J.cA1, "portail_taches")).rows.map((r) => r.action_title), ["Envoyer la sélection de biens"]);
  assert.deepEqual((await lireVue(db, J.cA1, "portail_evenements")).rows.map((r) => r.resume), ["Recherche démarrée"]);
  assert.deepEqual((await lireVue(db, J.cB1, "portail_taches")).rows.map((r) => r.action_title), ["Tâche de B"]);
  assert.deepEqual((await lireVue(db, J.cB1, "portail_dossier")).rows.map((r) => r.reference), ["INV-B"]);
});
test("5.3 une tâche cochée dans un dossier NON montré reste cachée (double verrou)", async () => {
  const db = await base({ lecture: true }); await lier(db, ID.clientA, ID.cA1); await jeu(db);
  assert.ok(!(await lireVue(db, J.cA1, "portail_taches")).rows.some((r) => /non montré/.test(r.action_title)));
  const db2 = await base({ lecture: true }); await lier(db2, ID.clientA, ID.cA1); await jeu(db2, { dossierAVisible: false });
  assert.equal((await lireVue(db2, J.cA1, "portail_taches")).rows.length, 0, "dossier A masqué : ses tâches aussi");
  assert.equal((await lireVue(db2, J.cA1, "portail_evenements")).rows.length, 0);
});
test("5.4 colonnes sensibles absentes des vues (honoraires, questionnaire, mails, notes, motifs, avant/après)", async () => {
  const db = await base({ lecture: true });
  const cols = (await db.query(`select table_name, column_name from information_schema.columns where table_schema='public' and table_name like 'portail\\_%'`)).rows;
  const interdit = /honoraires|questionnaire|notification|commentaire|blocage|balle|responsable|avant|apres|client_id/;
  assert.deepEqual(cols.filter((c) => interdit.test(c.column_name)), []);
  assert.ok(cols.length >= 20);
});
test("5.5 le client ne lit AUCUNE table de base directement (3a)", async () => {
  const db = await base({ lecture: true }); await lier(db, ID.clientA, ID.cA1); await jeu(db);
  for (const t of ["invest_dossiers", "invest_dossier_etapes", "invest_dossier_evenements", "invest_mission_actions"])
    assert.equal((await sous(db, "authenticated", J.cA1, `select * from public.${t}`)).rows.length, 0, t);
});
test("5.6 lecture seule : aucune écriture possible via les vues ni les tables", async () => {
  const db = await base({ lecture: true }); await lier(db, ID.clientA, ID.cA1); await jeu(db);
  assert.ok((await sous(db, "authenticated", J.cA1, `update public.portail_taches set status = 'termine'`)).erreur);
  assert.ok((await sous(db, "authenticated", J.cA1, `delete from public.portail_dossier`)).erreur);
  assert.equal((await sous(db, "authenticated", J.cA1, `update public.invest_mission_actions set visible_client = true`)).rows.length, 0);
  assert.equal((await db.query(`select count(*)::int n from public.invest_mission_actions where visible_client`)).rows[0].n, 3, "inchangé");
});
test("5.7 anon : aucun accès ; collaborateur : vues vides ; compte révoqué ou falsifié : vide", async () => {
  const db = await base({ lecture: true }); await lier(db, ID.clientA, ID.cA1); await jeu(db);
  for (const v of ["portail_dossier", "portail_etapes", "portail_taches", "portail_evenements"]) {
    assert.ok((await sous(db, "anon", null, `select * from public.${v}`)).erreur, `anon ${v}`);
    assert.equal((await lireVue(db, J.admin, v)).rows.length, 0, `admin ${v}`);
    assert.equal((await lireVue(db, { ...J.cA1, profero_population: "collaborateur" }, v)).rows.length, 0, `falsifié ${v}`);
  }
  await db.query(`update public.invest_portail_comptes set statut='revoque'`);
  assert.equal((await lireVue(db, J.cA1, "portail_dossier")).rows.length, 0, "révoqué");
});
test("5.8 la colonne visible_client ajoutée à la volée : défaut faux sur l'existant ; retour arrière propre", async () => {
  const db = await base(); // sans lecture : tables métier présentes, pas encore de colonne
  await db.exec(`insert into public.invest_mission_actions (client_id, action_title) values ('${ID.clientA}','existante');`);
  await db.exec(LECTURE);
  assert.equal((await db.query(`select visible_client from public.invest_mission_actions`)).rows[0].visible_client, false);
  await db.exec(LECTURE_ROLLBACK);
  assert.equal((await db.query(`select count(*)::int n from pg_class where relname like 'portail\\_%' and relkind='v'`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int n from information_schema.columns where table_name='invest_mission_actions' and column_name='visible_client'`)).rows[0].n, 0);
});

// ── 6. Documents partagés ──────────────────────────────────────────────
const CH_A = `clients/${ID.clientA}/contrat_1700000000000.pdf`;
const CH_A2 = `clients/${ID.clientA}/interne_1700000000001.pdf`;
const CH_B = `clients/${ID.clientB}/contrat_B_1700000000002.pdf`;
const partager = (db, j, client, chemin, extra = "") => sous(db, "authenticated", j,
  `insert into public.invest_documents_partages (client_id, chemin, libelle ${extra ? ", " + extra.split("=")[0] : ""}) values ('${client}','${chemin}','Contrat' ${extra ? ", " + extra.split("=")[1] : ""}) returning id`);
const docsVue = async (db, j) => (await sous(db, "authenticated", j, `select * from public.portail_documents`)).rows;

test("6.1 rien n'est partagé par défaut : le client ne voit aucun document", async () => {
  const db = await base({ lecture: true, documents: true }); await lier(db, ID.clientA, ID.cA1);
  assert.equal((await docsVue(db, J.cA1)).length, 0);
});
test("6.2 le client ne voit que les documents PARTAGÉS de SON client, jamais le chemin", async () => {
  const db = await base({ lecture: true, documents: true }); await lier(db, ID.clientA, ID.cA1); await lier(db, ID.clientB, ID.cB1);
  assert.equal((await partager(db, J.commercial, ID.clientA, CH_A)).erreur, null);
  assert.equal((await partager(db, J.commercial, ID.clientB, CH_B)).erreur, null);
  const vuA = await docsVue(db, J.cA1);
  assert.equal(vuA.length, 1);
  assert.deepEqual(Object.keys(vuA[0]).sort(), ["dossier_id", "id", "libelle", "partage_le"], "aucun chemin, aucun client_id");
  const vuB = await docsVue(db, J.cB1);
  assert.equal(vuB.length, 1);
  assert.notEqual(vuA[0].id, vuB[0].id);
  const interneA = await docsVue(db, J.cA2);
  assert.equal(interneA.length, 0, "un compte non lié ne voit rien");
});
test("6.3 impossible de partager le fichier d'un autre client, d'un bien, ou de sortir du dossier", async () => {
  const db = await base({ lecture: true, documents: true });
  for (const chemin of [CH_B, "biens/x/contrat.pdf", `clients/${ID.clientA}/../${ID.clientB}/x.pdf`, `clients/${ID.clientA}`, "edl/x/photo.jpg"]) {
    const r = await partager(db, J.commercial, ID.clientA, chemin);
    assert.ok(r.erreur, `refusé : ${chemin}`);
  }
});
test("6.4 retirer un partage le masque ; le re-partager le réaffiche", async () => {
  const db = await base({ lecture: true, documents: true }); await lier(db, ID.clientA, ID.cA1);
  await partager(db, J.commercial, ID.clientA, CH_A);
  await sous(db, "authenticated", J.commercial, `update public.invest_documents_partages set statut='retire', retire_le=now()`);
  assert.equal((await docsVue(db, J.cA1)).length, 0);
  await sous(db, "authenticated", J.commercial, `update public.invest_documents_partages set statut='partage', retire_le=null`);
  assert.equal((await docsVue(db, J.cA1)).length, 1);
});
test("6.5 un document rattaché à un dossier NON montré reste caché", async () => {
  const db = await base({ lecture: true, documents: true }); await lier(db, ID.clientA, ID.cA1);
  await db.exec(`insert into public.invest_dossiers (id, client_id, reference, portail_visible) values ('${DA}','${ID.clientA}','INV-A',false)`);
  await partager(db, J.commercial, ID.clientA, CH_A, `dossier_id='${DA}'`);
  assert.equal((await docsVue(db, J.cA1)).length, 0);
  await db.exec(`update public.invest_dossiers set portail_visible = true where id = '${DA}'`);
  assert.equal((await docsVue(db, J.cA1)).length, 1);
});
test("6.6 un client ne crée, ne modifie, ne supprime aucun partage ; ni via la vue ; anon aucun accès", async () => {
  const db = await base({ lecture: true, documents: true }); await lier(db, ID.clientA, ID.cA1);
  await partager(db, J.commercial, ID.clientA, CH_A);
  assert.ok((await partager(db, J.cA1, ID.clientA, CH_A2)).erreur, "insertion");
  assert.equal((await sous(db, "authenticated", J.cA1, `update public.invest_documents_partages set statut='retire'`)).rows.length, 0);
  assert.equal((await sous(db, "authenticated", J.cA1, `select * from public.invest_documents_partages`)).rows.length, 0, "table illisible");
  assert.ok((await sous(db, "authenticated", J.cA1, `update public.portail_documents set libelle='x'`)).erreur);
  assert.ok((await sous(db, "authenticated", J.cA1, `delete from public.portail_documents`)).erreur);
  assert.ok((await sous(db, "anon", null, `select * from public.portail_documents`)).erreur);
  assert.ok((await sous(db, "anon", null, `select * from public.invest_documents_partages`)).erreur);
  assert.equal((await db.query(`select count(*)::int n from public.invest_documents_partages`)).rows[0].n, 1);
});
test("6.7 qui peut partager : CRM (admin, commercial) oui ; ouvrier et compte sans fiche non", async () => {
  const db = await base({ lecture: true, documents: true });
  assert.equal((await partager(db, J.admin, ID.clientA, CH_A)).erreur, null);
  assert.ok((await partager(db, J.ouvrier, ID.clientA, CH_A2)).erreur);
  assert.ok((await partager(db, J.libre, ID.clientA, CH_A2)).erreur);
});
test("6.8 compte révoqué ou jeton falsifié : aucun document", async () => {
  const db = await base({ lecture: true, documents: true }); await lier(db, ID.clientA, ID.cA1);
  await partager(db, J.commercial, ID.clientA, CH_A);
  assert.equal((await docsVue(db, { ...J.cA1, profero_population: "collaborateur" })).length, 0);
  await db.query(`update public.invest_portail_comptes set statut='revoque'`);
  assert.equal((await docsVue(db, J.cA1)).length, 0);
});
test("6.9 règles du dépôt : restrictive 3a, aucun droit anon, vue en lecture seule, retour arrière propre", async () => {
  const db = await base({ lecture: true, documents: true });
  const pol = (await db.query(`select policyname, permissive from pg_policies where tablename='invest_documents_partages' order by 1`)).rows.map((r) => `${r.policyname}:${r.permissive}`);
  assert.deepEqual(pol, ["invest_documents_partages_crm:PERMISSIVE", "profero_collaborateurs_seulement:RESTRICTIVE"]);
  const droit = async (r, o, d) => (await db.query(`select has_table_privilege('${r}','${o}','${d}') a`)).rows[0].a;
  assert.equal(await droit("anon", "public.invest_documents_partages", "select"), false);
  assert.equal(await droit("authenticated", "public.portail_documents", "select"), true);
  for (const d of ["insert", "update", "delete"]) assert.equal(await droit("authenticated", "public.portail_documents", d), false, d);
  await db.exec(DOCUMENTS_ROLLBACK);
  assert.equal((await db.query(`select count(*)::int n from pg_class where relname in ('invest_documents_partages','portail_documents')`)).rows[0].n, 0);
});
test("6.10 fonction de lien : jeton → droit par la vue → ensuite seulement le service_role ; chemin jamais renvoyé", async () => {
  const f = FONCTION_DOC;
  const i = (t) => f.indexOf(t);
  assert.ok(i("auth.getUser") > 0 && i("auth.getUser") < i('.from("portail_documents")'), "authentification avant le droit");
  assert.ok(i('.from("portail_documents")') < i("createClient(url, cleService"), "le service_role n'est créé qu'après la vérification par la vue");
  assert.ok(i("createClient(url, cleService") < i("createSignedUrl"), "signature en dernier");
  assert.match(f, /TTL_SECONDES = (\d+)/);
  assert.ok(Number(f.match(/TTL_SECONDES = (\d+)/)[1]) <= 120, "lien de courte durée");
  assert.ok(!/json\(\{[^}]*chemin/.test(f), "le chemin n'est jamais renvoyé");
  assert.match(f, /UUID\.test\(documentId\)/, "identifiant validé");
});

// ── 7. Données de l'écran client ───────────────────────────────────────
test("7.1 portail_client : prénom et nom du SEUL client de l'appelant, rien d'autre", async () => {
  const db = await base({ lecture: true, ecran: true }); await lier(db, ID.clientA, ID.cA1); await lier(db, ID.clientB, ID.cB1);
  const a = (await sous(db, "authenticated", J.cA1, `select * from public.portail_client`)).rows;
  assert.deepEqual(a, [{ prenom: "Alice", nom: "Client A" }], "ni e-mail, ni téléphone, ni notes internes");
  assert.deepEqual((await sous(db, "authenticated", J.cB1, `select nom from public.portail_client`)).rows, [{ nom: "Client B" }]);
  assert.equal((await sous(db, "authenticated", J.libre, `select * from public.portail_client`)).rows.length, 0, "compte non lié");
  assert.equal((await sous(db, "authenticated", J.admin, `select * from public.portail_client`)).rows.length, 0, "collaborateur");
  assert.equal((await sous(db, "authenticated", { ...J.cA1, profero_population: "collaborateur" }, `select * from public.portail_client`)).rows.length, 0, "jeton falsifié");
});
test("7.2 portail_client : lecture seule, aucun accès anon", async () => {
  const db = await base({ lecture: true, ecran: true }); await lier(db, ID.clientA, ID.cA1);
  assert.ok((await sous(db, "authenticated", J.cA1, `update public.portail_client set nom = 'x'`)).erreur);
  assert.ok((await sous(db, "anon", null, `select * from public.portail_client`)).erreur);
  for (const d of ["insert", "update", "delete"]) assert.equal((await db.query(`select has_table_privilege('authenticated','public.portail_client','${d}') a`)).rows[0].a, false, d);
});
test("7.3 portail_etapes : seulement les étapes du dossier (pas d'opération), droits conservés", async () => {
  const db = await base({ lecture: true, ecran: true }); await lier(db, ID.clientA, ID.cA1);
  await db.exec(`insert into public.invest_dossiers (id, client_id, reference, portail_visible) values ('${DA}','${ID.clientA}','INV-A',true);
    insert into public.invest_dossier_etapes (dossier_id, operation_id, etape, statut) values
      ('${DA}', null, 'financement', 'en_cours'), ('${DA}', '33333333-3333-3333-3333-333333333333', 'financement', 'terminee');`);
  const r = (await sous(db, "authenticated", J.cA1, `select etape, statut from public.portail_etapes`)).rows;
  assert.deepEqual(r, [{ etape: "financement", statut: "en_cours" }]);
  for (const d of ["insert", "update", "delete"]) assert.equal((await db.query(`select has_table_privilege('authenticated','public.portail_etapes','${d}') a`)).rows[0].a, false, d);
  assert.equal((await db.query(`select has_table_privilege('anon','public.portail_etapes','select') a`)).rows[0].a, false);
});
test("7.4 retour arrière : portail_client retirée, portail_etapes d'avant", async () => {
  const db = await base({ lecture: true, ecran: true });
  await db.exec(ECRAN_ROLLBACK);
  assert.equal((await db.query(`select count(*)::int n from pg_class where relname='portail_client'`)).rows[0].n, 0);
  assert.ok(!/operation_id/.test((await db.query(`select pg_get_viewdef('public.portail_etapes'::regclass) d`)).rows[0].d));
});

// ── 8. Qui gère les accès clients : administrateurs et commerciaux ───────
test("8.1 portail_gestionnaire : admin et commercial actifs oui ; comptable, ouvrier, sans fiche, client non", async () => {
  const db = await base({ invitation: true });
  await db.exec(`insert into public.utilisateurs (email, nom, role, actif) values ('compta@test.fr','Compta','comptable',true), ('inactif@test.fr','Inactif','commercial',false)`);
  const q = (j) => sous(db, "authenticated", j, `select public.portail_gestionnaire() as g`).then((r) => r.rows[0]?.g);
  assert.equal(await q(J.admin), true);
  assert.equal(await q(J.commercial), true);
  assert.equal(await q(jeton(ID.admin, "compta@test.fr", "collaborateur")), false, "comptable");
  assert.equal(await q(J.ouvrier), false);
  assert.equal(await q(J.libre), false);
  assert.equal(await q(jeton(ID.admin, "inactif@test.fr", "collaborateur")), false, "commercial désactivé");
  assert.equal(await q({ ...J.commercial, profero_population: "client_invest" }), false, "jeton étiqueté client");
  assert.ok((await sous(db, "anon", null, `select public.portail_gestionnaire()`)).erreur, "anon n'exécute pas la fonction");
});
test("8.2 administrateurs et commerciaux lisent les accès ; les autres n'en voient aucun", async () => {
  const db = await base({ invitation: true }); await lier(db, ID.clientA, ID.cA1);
  const n = async (j) => (await sous(db, "authenticated", j, `select * from public.invest_portail_comptes`)).rows.length;
  assert.equal(await n(J.admin), 1);
  assert.equal(await n(J.commercial), 1);
  assert.equal(await n(J.ouvrier), 0);
  assert.equal(await n(J.libre), 0);
  assert.equal(await n(J.cA1), 0, "le client lui-même ne lit pas la table");
});
test("8.3 un commercial révoque un accès : sessions coupées, hook refuse ; un ouvrier ne le peut pas", async () => {
  const db = await base({ invitation: true }); await lier(db, ID.clientA, ID.cA1); await lier(db, ID.clientB, ID.cB1);
  const refus = await sous(db, "authenticated", J.ouvrier, `update public.invest_portail_comptes set statut='revoque'`);
  assert.equal(refus.rows.length, 0);
  assert.equal(await sessions(db, ID.cA1), 1, "rien n'a changé");
  const ok = await sous(db, "authenticated", J.commercial, `update public.invest_portail_comptes set statut='revoque', revoque_le=now(), revoque_par='commercial@test.fr' where client_id='${ID.clientA}' returning id`);
  assert.equal(ok.erreur, null);
  assert.equal(ok.rows.length, 1);
  assert.equal(await sessions(db, ID.cA1), 0);
  assert.equal(await sessions(db, ID.cB1), 1, "l'autre client n'est pas touché");
  assert.equal((await hook(db, ID.cA1)).error?.http_code, 403);
  assert.equal((await hook(db, ID.cB1)).claims.profero_population, "client_invest");
});
test("8.4 aucun gestionnaire ne peut créer, supprimer ni relier un accès à un autre client/compte", async () => {
  const db = await base({ invitation: true }); await lier(db, ID.clientA, ID.cA1);
  for (const j of [J.admin, J.commercial]) {
    assert.ok((await sous(db, "authenticated", j, `insert into public.invest_portail_comptes (client_id, auth_user_id) values ('${ID.clientB}','${ID.libre}')`)).erreur, "insertion");
    assert.ok((await sous(db, "authenticated", j, `update public.invest_portail_comptes set client_id='${ID.clientB}'`)).erreur, "changer le client");
    assert.ok((await sous(db, "authenticated", j, `update public.invest_portail_comptes set auth_user_id='${ID.libre}'`)).erreur, "changer le compte");
    assert.ok((await sous(db, "authenticated", j, `delete from public.invest_portail_comptes`)).erreur, "suppression");
  }
  const r = (await db.query(`select client_id, auth_user_id, statut from public.invest_portail_comptes`)).rows;
  assert.deepEqual(r, [{ client_id: ID.clientA, auth_user_id: ID.cA1, statut: "actif" }], "inchangé");
});
test("8.5 retour arrière : retour à « administrateurs seuls »", async () => {
  const db = await base({ invitation: true });
  await db.exec(INVITATION_ROLLBACK);
  assert.equal((await sous(db, "authenticated", J.admin, `insert into public.invest_portail_comptes (client_id, auth_user_id) values ('${ID.clientA}','${ID.cA1}') returning id`)).erreur, null);
  assert.ok((await sous(db, "authenticated", J.commercial, `insert into public.invest_portail_comptes (client_id, auth_user_id) values ('${ID.clientB}','${ID.cB1}')`)).erreur);
  assert.equal((await db.query(`select count(*)::int n from pg_proc where proname='portail_gestionnaire'`)).rows[0].n, 0);
});

let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✔ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✘ ${nom}\n      ${e.message.split("\n")[0]}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} contrôles conformes`);
process.exit(echecs ? 1 : 0);
