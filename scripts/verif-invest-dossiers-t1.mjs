#!/usr/bin/env node
// Vérifie la Tranche 1 du Chantier 1.1 (Dossier Invest) sur un VRAI PostgreSQL
// (PGlite, en mémoire) qui reproduit la production du 30/09/2026 :
// invest_clients / invest_prospects / invest_notes / invest_propositions /
// invest_mission_actions (colonnes, règle d'unicité, déclencheur de
// notification), utilisateurs, planning_config, invest_role_courant et
// invest_peut_voir mot pour mot, les policies RLS Invest, auth.email().
// La migration 20260930190000 est appliquée DEPUIS SON FICHIER.
// Tranche 2a : la migration 20260930210000 (pilotage) est appliquée par-dessus,
// comme en production ; les cas 32 et suivants couvrent ses règles.
//
// Aucun réseau, aucune base Supabase.
//   npm install --no-save @electric-sql/pglite   (une fois)
//   node scripts/verif-invest-dossiers-t1.mjs
// PGLITE_MODULE=<chemin> permet d'utiliser un PGlite installé ailleurs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as P from "../src/Invest/dossiers/parcours.mjs";
import { planifierReprise, sqlReprise, rapportReprise, rapprocherUtilisateur } from "../src/Invest/dossiers/repriseDossiers.mjs";
import { uuidDepuis } from "./reprise-invest-dossiers-t1.mjs";
import * as TR from "../src/Invest/dossiers/transitions.mjs";
import * as V from "../src/Invest/dossiers/dossierVue.mjs";
import * as SP from "../src/Invest/dossiers/situationPatrimoniale.mjs";
import * as QS from "../src/Invest/dossiers/questionnaireDossier.mjs";
import { sqlClesQuestionnaire } from "./generer-questionnaire-cles-sql.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
const MIGRATION = lire("supabase/migrations/20260930190000_invest_dossiers_tranche1.sql");
const ROLLBACK = lire("sql/202609_invest_dossiers_tranche1_rollback.sql");
const CRM = lire("src/Invest/CRM.jsx");
const MIGRATION_2A = lire("supabase/migrations/20260930210000_invest_dossiers_tranche2a.sql");
const ROLLBACK_2A = lire("sql/202609_invest_dossiers_tranche2a_rollback.sql");
const CARTE = lire("src/Invest/dossiers/DossierInvestCard.jsx");
const MIGRATION_2C = lire("supabase/migrations/20260930230000_invest_situation_patrimoniale_2c.sql");
const ROLLBACK_2C = lire("sql/202609_invest_situation_patrimoniale_2c_rollback.sql");
const CARTE_SP = lire("src/Invest/dossiers/SituationPatrimonialeCard.jsx");
const MIGRATION_2D = lire("supabase/migrations/20260930235000_invest_questionnaire_2d.sql");
const ROLLBACK_2D = lire("sql/202609_invest_questionnaire_2d_rollback.sql");
const MIGRATION_2D1 = lire("supabase/migrations/20260930235500_invest_questionnaire_2d1_catalogue.sql");
const ROLLBACK_2D1 = lire("sql/202609_invest_questionnaire_2d1_rollback.sql");
const CARTE_QS = lire("src/Invest/dossiers/ProjetSituationCard.jsx");
const CATALOGUE_QS = lire("src/Invest/dossiers/questionnaireDossier.mjs");

const { PGlite } = await import(
  process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite"
);

// ── Identités du banc ───────────────────────────────────────────────────────
const U = { // utilisateurs
  matthieu: "10000000-0000-0000-0000-000000000001",
  camille:  "10000000-0000-0000-0000-000000000002",
  francois: "10000000-0000-0000-0000-000000000003",
  compta:   "10000000-0000-0000-0000-000000000004",
};
const C = { // clients
  louison:  "20000000-0000-0000-0000-000000000001",
  prospect: "20000000-0000-0000-0000-000000000002",
  termine:  "20000000-0000-0000-0000-000000000003",
  nu:       "20000000-0000-0000-0000-000000000004",
  vide:     "20000000-0000-0000-0000-000000000005",
};
const PR = { converti: "30000000-0000-0000-0000-000000000001", neuf: "30000000-0000-0000-0000-000000000002" };
const COLLAB = "matthieu@test.fr";   // admin Invest
const COMMERCIAL = "camille@test.fr"; // accès crm + prospection
const HORS_INVEST = "compta@test.fr"; // utilisateur sans branche Invest
const CLIENT_AUTH = "client@exemple.fr"; // futur client : compte Auth, aucune ligne utilisateurs

const SCHEMA_PROD = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_admin nologin;
create schema auth;
create function auth.email() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'))::text $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role, supabase_admin;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table public.utilisateurs (id uuid primary key default gen_random_uuid(), email text, nom text,
  role text default 'conducteur', actif boolean default true, created_at timestamptz default now(),
  branches jsonb default '["renovation"]', prenom_planning text, nav_order jsonb);
create table public.planning_config (key text primary key, value jsonb, updated_at timestamptz default now());

CREATE OR REPLACE FUNCTION public.invest_role_courant()
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select u.role from public.utilisateurs u
  where lower(u.email) = lower(auth.email()) and coalesce(u.actif, false) = true
    and u.branches::text ilike '%invest%' limit 1;
$function$;
CREATE OR REPLACE FUNCTION public.invest_peut_voir(page text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with r as (select public.invest_role_courant() as role),
  cfg as (select value::jsonb as value from public.planning_config where key = 'access_pages_invest' limit 1)
  select case
      when (select role from r) is null then false
      when (select value from cfg) is null then (select role from r) in ('admin', 'super_admin')
      when (select value from cfg) ? (select role from r)
        then coalesce((select value from cfg) -> (select role from r) ? page, false)
      when (select value from cfg) ? lower(replace((select role from r), ' ', '_'))
        then coalesce((select value from cfg) -> lower(replace((select role from r), ' ', '_')) ? page, false)
      else (select role from r) in ('admin', 'super_admin') end;
$function$;

create table public.invest_biens (id uuid primary key default gen_random_uuid(), adresse text);
create table public.invest_clients (
  id uuid primary key default gen_random_uuid(), nom text not null, prenom text, conseiller text, email text,
  telephone text, source text, statut text, budget numeric, etape_num integer, etape text, avancement integer,
  niveau text, prochaine_action text, date_prochaine_action date, date_creation timestamptz default now(),
  date_signature date, notes_rapides text, created_at timestamptz default now(), updated_at timestamptz default now(),
  date_avant_contact date, date_premier_contact date, strategie_data jsonb not null default '{}');
create table public.invest_prospects (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), is_deleted boolean not null default false,
  nom text not null, prenom text not null, statut text not null default 'nouveau', donnees jsonb not null default '{}',
  converted_client_id uuid, converted_at timestamptz);
create table public.invest_notes (id uuid primary key default gen_random_uuid(),
  client_id uuid references public.invest_clients(id) on delete cascade, date timestamptz, auteur text, type text,
  contenu text not null, created_at timestamptz default now());
create table public.invest_propositions (id uuid primary key default gen_random_uuid(),
  client_id uuid references public.invest_clients(id) on delete cascade,
  bien_id uuid references public.invest_biens(id) on delete cascade, date_proposition date, statut text,
  commentaire text, lien_dossier text, created_at timestamptz default now());
create table public.invest_action_notifications (id uuid primary key default gen_random_uuid(), action_id text,
  recipient text, title text, message text, linked_entity_type text, linked_entity_id text, source_module text,
  priority text, status text, created_by text, created_at timestamptz not null default now(),
  read_at timestamptz, resolved_at timestamptz);
create table public.invest_mission_actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.invest_clients(id) on delete cascade,
  step_key text not null, step_label text not null, step_index integer not null default 0,
  sort_order integer not null default 0, action_title text not null, responsable text,
  status text not null default 'a_faire', due_date date, completed_at timestamptz, relance_rule text,
  document_drive_attendu boolean not null default false, drive_folder text, commentaire text, created_by text,
  metadata jsonb not null default '{}', created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), responsable_email text,
  notification_status text not null default 'non_preparee', notification_subject text, notification_body text,
  notification_prepared_at timestamptz, notification_count integer not null default 0, notification_sent_at timestamptz,
  notification_error text, notification_mode text not null default 'gmail_auto', gmail_message_id text,
  notification_last_recipient text, due_reminder_enabled boolean not null default true,
  last_reminder_sent_at timestamptz, reminder_count integer not null default 0, reminder_error text,
  justificatif_drive_file_id text, justificatif_drive_name text, justificatif_drive_url text,
  justificatif_drive_mime_type text, justificatif_drive_linked_at timestamptz, calendar_status text,
  calendar_prepared_at timestamptz, calendar_created_at timestamptz, calendar_event_id text, calendar_html_link text,
  calendar_error text, calendar_date date, calendar_time text, linked_entity_type text, linked_entity_id text,
  source_module text, source_context jsonb default '{}',
  constraint invest_mission_actions_unique unique (client_id, step_key, action_title));

CREATE OR REPLACE FUNCTION public.fn_invest_notify_mission_action_status_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare normalized_status text; action_title text;
begin
  if tg_op <> 'UPDATE' then return new; end if;
  if coalesce(new.status, '') = coalesce(old.status, '') then return new; end if;
  normalized_status := lower(coalesce(new.status, ''));
  action_title := coalesce(new.action_title, 'Action collaborateur');
  if normalized_status in ('termine', 'terminé', 'fait', 'done', 'completed', 'valide', 'validé', 'bloque', 'bloqué') then
    insert into public.invest_action_notifications (action_id, recipient, title, message, linked_entity_type,
      linked_entity_id, source_module, priority, status, created_by)
    values (new.id::text, 'Matthieu', 'Retour collaborateur — ' || action_title,
      'Statut mis à jour par ' || coalesce(new.responsable, 'un collaborateur') || ' : ' || coalesce(new.status, '—'),
      new.linked_entity_type, new.linked_entity_id, coalesce(new.source_module, 'invest_mission_actions'),
      case when normalized_status in ('bloque', 'bloqué') then 'high' else 'normal' end, 'unread',
      coalesce(new.responsable, 'collaborateur'));
  end if;
  return new;
end;
$function$;
create trigger trg_invest_notify_mission_action_status_change after update on public.invest_mission_actions
  for each row execute function public.fn_invest_notify_mission_action_status_change();

alter table public.invest_clients enable row level security;
alter table public.invest_prospects enable row level security;
alter table public.invest_notes enable row level security;
alter table public.invest_propositions enable row level security;
alter table public.invest_mission_actions enable row level security;
alter table public.invest_action_notifications enable row level security;
alter table public.utilisateurs enable row level security;
create policy invest_clients_membres on public.invest_clients for all to authenticated
  using ((select invest_peut_voir('crm')) or (select invest_peut_voir('structuration')) or (select invest_peut_voir('prospection'))
      or (select invest_peut_voir('suivi_financier')) or (select invest_peut_voir('dashboard')))
  with check ((select invest_peut_voir('crm')) or (select invest_peut_voir('structuration')) or (select invest_peut_voir('prospection')));
create policy invest_prospects_select_all on public.invest_prospects for select to anon, authenticated using (true);
create policy invest_prospects_insert_all on public.invest_prospects for insert to anon, authenticated with check (true);
create policy invest_prospects_update_all on public.invest_prospects for update to anon, authenticated using (true);
create policy invest_prospects_delete_all on public.invest_prospects for delete to anon, authenticated using (true);
create policy invest_notes_membres on public.invest_notes for all to authenticated
  using ((select invest_peut_voir('crm'))) with check ((select invest_peut_voir('crm')));
create policy invest_propositions_membres on public.invest_propositions for all to authenticated
  using ((select invest_peut_voir('crm')) or (select invest_peut_voir('biens')) or (select invest_peut_voir('dashboard')))
  with check ((select invest_peut_voir('crm')) or (select invest_peut_voir('biens')));
create policy invest_mission_actions_membres on public.invest_mission_actions for all to authenticated
  using ((select invest_peut_voir('crm')) or (select invest_peut_voir('dashboard'))) with check ((select invest_peut_voir('crm')));
create policy invest_action_notifications_membres on public.invest_action_notifications for all to authenticated using (true);
create policy utilisateurs_select on public.utilisateurs for select to public using (true);

insert into public.planning_config (key, value) values ('access_pages_invest',
  '{"admin":["dashboard","crm","biens","structuration","prospection","finance","suivi_financier","admin"],
    "commercial":["crm","biens","prospection"],"comptable":[]}');
insert into public.utilisateurs (id, email, nom, role, actif, branches) values
  ('${U.matthieu}', 'matthieu@test.fr', 'Matthieu', 'admin', true, '["renovation","invest"]'),
  ('${U.camille}', 'camille@test.fr', 'Camille', 'commercial', true, '["invest"]'),
  ('${U.francois}', 'francois@test.fr', 'François', 'commercial', true, '["invest"]'),
  ('${U.compta}', 'compta@test.fr', 'Compta', 'comptable', true, '["renovation"]');
insert into public.invest_biens (id, adresse) values ('40000000-0000-0000-0000-000000000001', 'Bien test');
insert into public.invest_clients (id, nom, prenom, statut, etape, etape_num, conseiller, date_signature,
  prochaine_action, date_prochaine_action, strategie_data) values
  ('${C.louison}', 'Test', 'Louison', 'Actif', '13 Signature Notaire', 1, 'Matthieu', null,
   'Relancer le notaire', '2026-10-15', '{"objectif":"patrimoine","documents_checklist":{"identite":"recu"}}'),
  ('${C.prospect}', 'Prospect', 'Paul', 'Prospect', '1 Signature contrat', 1, 'Camille', null, null, null, '{}'),
  ('${C.termine}', 'Fini', 'Fanny', 'Terminé', 'Finalisé', 1, 'Personne Inconnue', '2025-11-03', null, null, '{}'),
  ('${C.nu}', 'Nu', 'Nina', 'Actif', '1 Signature contrat', 1, null, null, null, null, '{}'),
  ('${C.vide}', 'Vide', 'Victor', 'Actif', null, 1, 'camille', null, null, null, '{}');
insert into public.invest_prospects (id, nom, prenom, statut, converted_client_id) values
  ('${PR.converti}', 'Fini', 'Fanny', 'converti', '${C.termine}'),
  ('${PR.neuf}', 'Neuf', 'Nadia', 'rdv', null);
insert into public.invest_notes (client_id, contenu, type) values ('${C.louison}', 'Appel notaire', 'relance');
insert into public.invest_propositions (client_id, bien_id, statut) values ('${C.louison}', '40000000-0000-0000-0000-000000000001', 'proposé');
insert into public.invest_mission_actions (id, client_id, step_key, step_label, step_index, action_title, responsable, responsable_email, status) values
  ('50000000-0000-0000-0000-000000000001', '${C.louison}', 'signature', 'Signature', 1, 'Archiver le contrat signé dans le Drive', 'Camille', 'camille@test.fr', 'fait'),
  ('50000000-0000-0000-0000-000000000002', '${C.louison}', 'financement', 'Financement', 6, 'Relancer les interlocuteurs si nécessaire', 'Camille', null, 'fait'),
  ('50000000-0000-0000-0000-000000000003', '${C.louison}', 'urbanisme', 'Urbanisme & administratif', 7, 'Définir les Velux : dimensions et emplacements', 'François', null, 'fait'),
  ('50000000-0000-0000-0000-000000000004', '${C.louison}', 'signature_definitive', 'Signature définitive', 9, 'Suivre la signature chez le notaire', 'Matthieu', 'matthieu@test.fr', 'a_faire'),
  ('50000000-0000-0000-0000-000000000005', '${C.louison}', 'enedis', 'Raccordement Enedis', 8, 'Planifier le RDV Enedis', 'Camille', 'camille@test.fr', 'a_faire'),
  ('50000000-0000-0000-0000-000000000006', '${C.vide}', 'recherche', 'Recherche & suivi', 3, 'Préparer la recherche', 'Inconnu', null, 'en_cours'),
  ('50000000-0000-0000-0000-000000000007', '${C.prospect}', 'signature', 'Signature', 1, 'Envoyer le contrat', 'Camille', null, 'a_faire');
`;

async function nouvelleBase({ migration = true, t2a = true, t2c = true, t2d = true, t2d1 = true } = {}) {
  const db = new PGlite();
  await db.exec(SCHEMA_PROD);
  if (migration) await db.exec(MIGRATION);
  if (migration && t2a) await db.exec(MIGRATION_2A);
  if (migration && t2a && t2c) await db.exec(MIGRATION_2C);
  if (migration && t2a && t2c && t2d) await db.exec(MIGRATION_2D);
  if (migration && t2a && t2c && t2d && t2d1) await db.exec(MIGRATION_2D1);
  return db;
}

/** Exécute sous un rôle PostgREST (authenticated/anon/service_role) avec l'email du JWT. */
async function sous(db, role, email, sql, params = []) {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`select set_config('role', $1, true)`, [role]);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(email ? { email, role } : { role })]);
      const liste = Array.isArray(sql) ? sql : [sql];
      let r;
      for (const q of liste) r = await tx.query(q, liste.length === 1 ? params : []);
      return { rows: r.rows, n: r.affectedRows ?? r.rows.length, erreur: null };
    });
  } catch (e) { return { rows: [], n: 0, erreur: e }; }
}
const collab = (db, sql, p) => sous(db, "authenticated", COLLAB, sql, p);
const q1 = async (db, sql, p = []) => (await db.query(sql, p)).rows[0];
const qn = async (db, sql, p = []) => (await db.query(sql, p)).rows;
const ok = (r, msg = "") => assert.equal(r.erreur, null, `${msg} ${r.erreur?.message ?? ""}`);
const refuse = (r, motif) => {
  assert.ok(r.erreur, "la requête devait être refusée");
  if (motif) assert.match(`${r.erreur.code} ${r.erreur.message}`, motif);
};
const ouvrir = async (db, client, options = {}, email = COLLAB) => {
  const r = await sous(db, "authenticated", email, `select public.invest_ouvrir_dossier($1, $2::jsonb) as id`, [client, JSON.stringify(options)]);
  return { ...r, id: r.rows[0]?.id };
};
const etapes = (db, dossier) => qn(db, `select * from public.invest_dossier_etapes where dossier_id = $1 order by created_at, etape`, [dossier]);
const etape = (db, dossier, cle) => q1(db, `select * from public.invest_dossier_etapes where dossier_id = $1 and etape = $2`, [dossier, cle]);
const evenements = (db, dossier) => qn(db, `select * from public.invest_dossier_evenements where dossier_id = $1 order by survenu_le, ordre`, [dossier]);
const aujourdhui = async (db) => (await q1(db, `select current_date::text d`)).d;

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ═══════════════════════════════════════════════════════════════════════════
// 0. Témoin et cohérence du catalogue
// ═══════════════════════════════════════════════════════════════════════════
test("0. banc fidèle : SANS migration, pas de dossier et l'ancienne suppression efface tout", async () => {
  const db = await nouvelleBase({ migration: false });
  assert.equal((await q1(db, `select to_regclass('public.invest_dossiers') t`)).t, null);
  ok(await collab(db, `delete from public.invest_clients where id = '${C.louison}'`));
  assert.equal((await q1(db, `select count(*)::int n from public.invest_notes`)).n, 0, "cascade notes");
  assert.equal((await q1(db, `select count(*)::int n from public.invest_mission_actions where client_id = '${C.louison}'`)).n, 0);
});

test("1. catalogue SQL = catalogue .mjs (étapes, libellés, step_key)", async () => {
  const db = await nouvelleBase();
  for (const e of P.ETAPES_PARCOURS) {
    assert.equal((await q1(db, `select public.invest_libelle_etape($1) l`, [e.cle])).l, e.libelle);
  }
  for (const [k, v] of Object.entries(P.STATUTS_ETAPE)) assert.equal((await q1(db, `select public.invest_libelle_statut_etape($1) l`, [k])).l, v);
  for (const [k, v] of Object.entries(P.BALLES)) assert.equal((await q1(db, `select public.invest_libelle_balle($1) l`, [k])).l, v);
  for (const [k, v] of Object.entries(P.STATUTS_DOSSIER)) assert.equal((await q1(db, `select public.invest_libelle_statut_dossier($1) l`, [k])).l, v);
  const cles = ["signature", "lancement", "recherche", "presentation_bien", "financement", "acquisition",
    "signature_definitive", "enedis", "travaux", "apres_travaux", "urbanisme", "priorite", "", null];
  for (const k of cles) {
    assert.equal((await q1(db, `select public.invest_etape_depuis_step_key($1) e`, [k])).e, P.etapeDepuisStepKey(k), `step_key ${k}`);
  }
  assert.equal(P.etapeDepuisStepKey("urbanisme"), null, "urbanisme jamais classé automatiquement");
  const contraintes = (await q1(db, `select pg_get_constraintdef(oid) d from pg_constraint where conname = 'invest_dossier_etapes_etape_check'`)).d;
  for (const cle of P.CLES_ETAPES) assert.match(contraintes, new RegExp(`'${cle}'`));
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. Création d'un dossier
// ═══════════════════════════════════════════════════════════════════════════
test("2. création : dossier « ouvert », référence, 11 étapes, signature en cours balle Profero", async () => {
  const db = await nouvelleBase();
  const r = await ouvrir(db, C.nu, { conseiller_id: U.camille, libelle: "Dossier Invest 2026" });
  ok(r);
  const d = await q1(db, `select * from public.invest_dossiers where id = $1`, [r.id]);
  assert.equal(d.statut, "ouvert");
  assert.equal(d.origine, "creation_crm");
  assert.match(d.reference, /^INV-\d{4}-0001$/);
  assert.equal(d.cree_par_id, U.matthieu);
  assert.equal(d.date_ouverture.toISOString().slice(0, 10), await aujourdhui(db));
  const es = await etapes(db, r.id);
  assert.equal(es.length, 11);
  assert.deepEqual(es.map((e) => e.etape).sort(), [...P.CLES_ETAPES].sort());
  const sig = es.find((e) => e.etape === "signature");
  assert.equal(sig.statut, "en_cours"); assert.equal(sig.balle, "profero"); assert.equal(sig.balle_utilisateur_id, U.camille);
  assert.ok(es.filter((e) => e.etape !== "signature").every((e) => e.statut === "a_venir" && e.balle === null));
  assert.ok(es.every((e) => !e.reprise_a_confirmer && e.operation_id === null));
  const ev = await evenements(db, r.id);
  assert.equal(ev.length, 1); assert.equal(ev[0].type, "dossier_cree");
  assert.equal(ev[0].auteur_type, "collaborateur"); assert.equal(ev[0].auteur_libelle, "Matthieu");
});

test("3. création : un client « Prospect » est activé ; ses tâches orphelines sont rattachées", async () => {
  const db = await nouvelleBase();
  const r = await ouvrir(db, C.prospect);
  ok(r);
  assert.equal((await q1(db, `select statut from public.invest_clients where id = $1`, [C.prospect])).statut, "Actif");
  assert.equal((await q1(db, `select dossier_id from public.invest_mission_actions where id = '50000000-0000-0000-0000-000000000007'`)).dossier_id, r.id);
});

test("4. D4 : aucune création automatique — une ligne client ne crée jamais de dossier seule", async () => {
  const db = await nouvelleBase();
  ok(await collab(db, `insert into public.invest_clients (nom, statut) values ('Nouveau', 'Prospect'), ('Actif direct', 'Actif')`));
  assert.equal((await q1(db, `select count(*)::int n from public.invest_dossiers`)).n, 0);
  const ctl = await qn(db, `select anomalie, detail from public.invest_controle_dossiers where anomalie = 'client_actif_sans_dossier'`);
  assert.ok(ctl.some((c) => c.detail === "Actif direct"), "le client actif sans dossier est signalé, pas masqué");
});

test("5. unicité : un seul dossier non clos par client (fonction ET insertion directe)", async () => {
  const db = await nouvelleBase();
  ok(await ouvrir(db, C.nu));
  refuse(await ouvrir(db, C.nu), /déjà un dossier en cours/);
  refuse(await collab(db, `insert into public.invest_dossiers (client_id, libelle, origine, date_ouverture, statut)
    values ('${C.nu}', 'Doublon', 'creation_crm', current_date, 'suspendu')`), /23505|unique|duplicate/i);
});

test("6. plusieurs dossiers clos autorisés ; clôture sans motif refusée ; date de clôture posée", async () => {
  const db = await nouvelleBase();
  const a = await ouvrir(db, C.nu);
  refuse(await collab(db, `update public.invest_dossiers set statut = 'clos' where id = '${a.id}'`), /motif_cloture|check/i);
  ok(await collab(db, `update public.invest_dossiers set statut = 'clos', motif_cloture = 'Mission achevée' where id = '${a.id}'`));
  assert.ok((await q1(db, `select date_cloture from public.invest_dossiers where id = $1`, [a.id])).date_cloture);
  const b = await ouvrir(db, C.nu); ok(b);
  ok(await collab(db, `update public.invest_dossiers set statut = 'abandonne', motif_cloture = 'Projet abandonné' where id = '${b.id}'`));
  const c = await ouvrir(db, C.nu); ok(c);
  const n = await qn(db, `select statut from public.invest_dossiers where client_id = $1 order by created_at`, [C.nu]);
  assert.deepEqual(n.map((x) => x.statut), ["clos", "abandonne", "ouvert"]);
  const ev = await evenements(db, a.id);
  assert.ok(ev.some((e) => e.type === "dossier_statut_change" && /Ouvert → Clos \(Mission achevée\)/.test(e.resume)));
});

test("7. création atomique : une panne sur les étapes n'en laisse AUCUNE trace", async () => {
  const db = await nouvelleBase();
  await db.exec(`create function public.panne() returns trigger language plpgsql as $$
      begin if new.etape = 'suivi' then raise exception 'panne simulée'; end if; return new; end $$;
    create trigger panne before insert on public.invest_dossier_etapes for each row execute function public.panne();`);
  refuse(await ouvrir(db, C.prospect), /panne simulée/);
  assert.equal((await q1(db, `select count(*)::int n from public.invest_dossiers`)).n, 0);
  assert.equal((await q1(db, `select count(*)::int n from public.invest_dossier_evenements`)).n, 0);
  assert.equal((await q1(db, `select statut from public.invest_clients where id = $1`, [C.prospect])).statut, "Prospect", "client non activé");
});

test("8. conversion atomique : client + dossier + 11 étapes + prospect « converti » ; panne = rien", async () => {
  const db = await nouvelleBase();
  const payload = JSON.stringify({ nom: "Neuf", prenom: "Nadia", email: "nadia@test.fr", budget: 250000, strategie_data: { objectif: "rendement" } });
  const r = await collab(db, `select public.invest_convertir_prospect($1, $2::jsonb, $3::jsonb) as res`, [PR.neuf, payload, JSON.stringify({ conseiller_id: U.camille })]);
  ok(r);
  const { client_id, dossier_id } = r.rows[0].res;
  const cl = await q1(db, `select * from public.invest_clients where id = $1`, [client_id]);
  assert.equal(cl.statut, "Actif"); assert.equal(cl.etape, "1 Signature contrat"); assert.deepEqual(cl.strategie_data, { objectif: "rendement" });
  const d = await q1(db, `select * from public.invest_dossiers where id = $1`, [dossier_id]);
  assert.equal(d.origine, "conversion_prospect"); assert.equal(d.prospect_id, PR.neuf); assert.equal(d.conseiller_id, U.camille);
  assert.equal((await etapes(db, dossier_id)).length, 11);
  const p = await q1(db, `select * from public.invest_prospects where id = $1`, [PR.neuf]);
  assert.equal(p.statut, "converti"); assert.equal(p.converted_client_id, client_id);
  refuse(await collab(db, `select public.invest_convertir_prospect($1, $2::jsonb) as res`, [PR.neuf, payload]), /déjà été converti/);

  const db2 = await nouvelleBase();
  await db2.exec(`create function public.panne() returns trigger language plpgsql as $$
      begin raise exception 'panne simulée'; end $$;
    create trigger panne before insert on public.invest_dossier_etapes for each row execute function public.panne();`);
  refuse(await collab(db2, `select public.invest_convertir_prospect($1, $2::jsonb) as res`, [PR.neuf, payload]), /panne simulée/);
  assert.equal((await q1(db2, `select count(*)::int n from public.invest_clients where nom = 'Neuf'`)).n, 0, "pas de client orphelin");
  assert.equal((await q1(db2, `select statut from public.invest_prospects where id = $1`, [PR.neuf])).statut, "rdv", "prospect intact");
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Étapes : statut, balle, blocage, prochaine action, échéance
// ═══════════════════════════════════════════════════════════════════════════
test("9. statut : active sans balle refusée ; en cours → date de début ; terminée → fin, balle vidée", async () => {
  const db = await nouvelleBase();
  const { id } = await ouvrir(db, C.nu);
  refuse(await collab(db, `update public.invest_dossier_etapes set statut = 'en_cours' where dossier_id = '${id}' and etape = 'collecte'`), /balle/);
  ok(await collab(db, `update public.invest_dossier_etapes set statut = 'en_cours', balle = 'client' where dossier_id = '${id}' and etape = 'collecte'`));
  const e1 = await etape(db, id, "collecte");
  assert.equal(e1.date_debut.toISOString().slice(0, 10), await aujourdhui(db));
  ok(await collab(db, `update public.invest_dossier_etapes set statut = 'terminee' where dossier_id = '${id}' and etape = 'collecte'`));
  const e2 = await etape(db, id, "collecte");
  assert.equal(e2.balle, null, "plus personne n'a la balle");
  assert.equal(e2.date_fin.toISOString().slice(0, 10), await aujourdhui(db));
  assert.equal(e2.modifie_par_id, U.matthieu);
  const ev = (await evenements(db, id)).filter((e) => e.type === "etape_statut_change").map((e) => e.resume);
  assert.deepEqual(ev, ["Collecte : À venir → En cours.", "Collecte : En cours → Terminée."]);
});

test("10. balle : Client / Profero / Banque / Notaire / Tiers, avec les bons compléments", async () => {
  const db = await nouvelleBase();
  const { id } = await ouvrir(db, C.nu);
  const maj = (set) => collab(db, `update public.invest_dossier_etapes set ${set} where dossier_id = '${id}' and etape = 'signature'`);
  for (const b of ["client", "profero", "banque", "notaire", "tiers"]) ok(await maj(`balle = '${b}', balle_utilisateur_id = null`), b);
  ok(await maj(`balle = 'profero', balle_utilisateur_id = '${U.francois}'`));
  ok(await maj(`balle = 'notaire', balle_utilisateur_id = null, balle_tiers_libelle = 'Étude Martin'`));
  refuse(await maj(`balle = 'client', balle_utilisateur_id = '${U.camille}', balle_tiers_libelle = null`), /balle_utilisateur/);
  refuse(await maj(`balle = 'profero', balle_tiers_libelle = 'Banque X'`), /balle_tiers/);
  refuse(await maj(`balle = 'personne'`), /check/);
  const ev = (await evenements(db, id)).filter((e) => e.type === "etape_balle_change").map((e) => e.resume);
  assert.ok(ev.includes("Signature : balle Profero (François) → Notaire (Étude Martin)."), ev.join(" | "));
  const courante = P.etapeCourante(await etapes(db, id));
  assert.equal(courante.balle, "notaire"); assert.equal(courante.balle_tiers_libelle, "Étude Martin");
});

test("11. blocage / déblocage : motif exigé, date posée, motif effacé, deux événements", async () => {
  const db = await nouvelleBase();
  const { id } = await ouvrir(db, C.nu);
  const maj = (set) => collab(db, `update public.invest_dossier_etapes set ${set} where dossier_id = '${id}' and etape = 'signature'`);
  refuse(await maj(`statut = 'bloquee'`), /blocage/);
  ok(await maj(`statut = 'bloquee', blocage_motif = 'Pièce d''identité manquante', balle = 'client', balle_utilisateur_id = null`));
  const e1 = await etape(db, id, "signature");
  assert.ok(e1.bloquee_depuis);
  ok(await maj(`statut = 'en_cours', balle = 'profero'`));
  const e2 = await etape(db, id, "signature");
  assert.equal(e2.blocage_motif, null); assert.equal(e2.bloquee_depuis, null);
  const types = (await evenements(db, id)).map((e) => e.type);
  assert.ok(types.includes("etape_bloquee") && types.includes("etape_debloquee"));
  assert.ok((await evenements(db, id)).some((e) => e.resume === "Signature bloquée : Pièce d'identité manquante."));
});

test("12. prochaine action et échéance : journalisées ; tâche d'un autre dossier refusée", async () => {
  const db = await nouvelleBase();
  const a = await ouvrir(db, C.nu);
  const b = await ouvrir(db, C.prospect);
  ok(await collab(db, `update public.invest_dossier_etapes set prochaine_action = 'Envoyer la lettre de mission', echeance = '2026-10-10'
    where dossier_id = '${a.id}' and etape = 'signature'`));
  refuse(await collab(db, `update public.invest_dossier_etapes set prochaine_action_id = '50000000-0000-0000-0000-000000000007'
    where dossier_id = '${a.id}' and etape = 'signature'`), /tâche de ce dossier/);
  ok(await collab(db, `update public.invest_dossier_etapes set prochaine_action_id = '50000000-0000-0000-0000-000000000007'
    where dossier_id = '${b.id}' and etape = 'signature'`));
  const ev = await evenements(db, a.id);
  assert.ok(ev.some((e) => e.type === "etape_echeance_change" && e.resume === "Signature : échéance aucune → 10/10/2026."));
  assert.ok(ev.some((e) => e.type === "etape_prochaine_action_change" && /Envoyer la lettre de mission/.test(e.resume)));
  refuse(await collab(db, `update public.invest_dossier_etapes set etape = 'suivi' where dossier_id = '${a.id}' and etape = 'signature'`), /ni de dossier ni de nature/);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Journal
// ═══════════════════════════════════════════════════════════════════════════
test("13. journal : lisible par l'équipe, jamais modifiable ni supprimable depuis le navigateur", async () => {
  const db = await nouvelleBase();
  const { id } = await ouvrir(db, C.nu);
  ok(await collab(db, `update public.invest_dossiers set conseiller_id = '${U.camille}', lettre_mission_statut = 'signee',
    lettre_mission_signee_le = '2026-09-01', honoraires_prevus_ht = 4500 where id = '${id}'`));
  const types = (await evenements(db, id)).map((e) => e.type).sort();
  assert.deepEqual(types, ["conseiller_change", "dossier_cree", "dossier_modifie", "lettre_mission_change"]);
  const lus = await collab(db, `select count(*)::int n from public.invest_dossier_evenements where dossier_id = '${id}'`);
  assert.equal(lus.rows[0].n, 4);
  refuse(await collab(db, `update public.invest_dossier_evenements set resume = 'falsifié'`), /permission denied/);
  refuse(await collab(db, `delete from public.invest_dossier_evenements`), /permission denied/);
  refuse(await collab(db, `insert into public.invest_dossier_evenements (dossier_id, client_id, type, resume, auteur_type, auteur_libelle)
    values ('${id}', '${C.nu}', 'dossier_cree', 'faux', 'systeme', 'x')`), /permission denied/);
  refuse(await sous(db, "service_role", null, `update public.invest_dossier_evenements set resume = 'falsifié'`), /ne se modifie pas/);
  refuse(await sous(db, "service_role", null, `delete from public.invest_dossier_evenements`), /ne se modifie pas/);
  assert.equal((await q1(db, `select count(*)::int n from public.invest_dossier_evenements where resume = 'falsifié'`)).n, 0);
});

test("14. accès : anon, compte hors Invest et futur client ne voient ni ne créent rien", async () => {
  const db = await nouvelleBase();
  const { id } = await ouvrir(db, C.nu);
  for (const [role, email] of [["anon", null], ["authenticated", HORS_INVEST], ["authenticated", CLIENT_AUTH]]) {
    for (const t of ["invest_dossiers", "invest_dossier_etapes", "invest_dossier_evenements", "invest_controle_dossiers"]) {
      const r = await sous(db, role, email, `select count(*)::int n from public.${t}`);
      assert.ok(r.erreur || r.rows[0].n === 0, `${role}/${email} lit ${t}`);
    }
    refuse(await sous(db, role, email, `select public.invest_ouvrir_dossier('${C.prospect}') id`), /permission denied|introuvable/);
    const u = await sous(db, role, email, `update public.invest_dossier_etapes set commentaire = 'x' where dossier_id = '${id}'`);
    assert.ok(u.erreur || u.n === 0);
  }
  refuse(await collab(db, `delete from public.invest_dossiers where id = '${id}'`), /permission denied/);
  refuse(await collab(db, `delete from public.invest_dossier_etapes where dossier_id = '${id}'`), /permission denied/);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Tâches de mission (anciens écrans)
// ═══════════════════════════════════════════════════════════════════════════
test("15. anciens écrans : une tâche créée par le CRM est rattachée (dossier, étape, responsable)", async () => {
  const db = await nouvelleBase();
  const { id } = await ouvrir(db, C.nu);
  // Charge utile exacte du CRM (CRM.jsx L3266) : aucune colonne nouvelle.
  const r = await collab(db, `insert into public.invest_mission_actions (client_id, step_key, step_label, step_index, sort_order,
    action_title, responsable, responsable_email, status, due_date, relance_rule, document_drive_attendu, due_reminder_enabled,
    drive_folder, created_by, metadata) values ('${C.nu}', 'travaux', 'Travaux', 11, 999, 'Lancer les devis', 'Camille',
    'Camille@Test.fr', 'a_faire', null, 'x', false, true, 'clients/x', 'Matthieu', '{"source":"crm"}') returning *`);
  ok(r);
  const a = r.rows[0];
  assert.equal(a.dossier_id, id); assert.equal(a.etape, "suivi"); assert.equal(a.responsable_id, U.camille);
  assert.equal(a.nature, "tache"); assert.equal(a.acteur_type, "profero");
  ok(await collab(db, `update public.invest_mission_actions set status = 'fait' where id = '${a.id}'`));
  assert.equal((await q1(db, `select count(*)::int n from public.invest_action_notifications where action_id = $1`, [a.id])).n, 1,
    "le déclencheur de notification existant fonctionne toujours");
});

test("16. correspondance step_key → étape ; urbanisme et clés inconnues restent « à classer »", async () => {
  const db = await nouvelleBase();
  await ouvrir(db, C.nu);
  const insere = async (sk, titre) => (await collab(db, `insert into public.invest_mission_actions (client_id, step_key, step_label, action_title)
    values ('${C.nu}', '${sk}', 'x', '${titre}') returning etape`)).rows[0]?.etape ?? null;
  for (const [sk, attendu] of Object.entries(P.STEP_KEY_VERS_ETAPE)) assert.equal(await insere(sk, `t-${sk}`), attendu, sk);
  assert.equal(await insere("urbanisme", "Dépôt DP"), null);
  assert.equal(await insere("priorite", "Priorité"), null);
  // Changement de step_key : l'étape automatique suit ; une étape saisie à la main est conservée.
  ok(await collab(db, `update public.invest_mission_actions set step_key = 'travaux' where client_id = '${C.nu}' and action_title = 'Dépôt DP'`));
  assert.equal((await q1(db, `select etape from public.invest_mission_actions where action_title = 'Dépôt DP'`)).etape, "suivi");
  ok(await collab(db, `update public.invest_mission_actions set etape = 'acquisition' where action_title = 't-enedis'`));
  ok(await collab(db, `update public.invest_mission_actions set step_key = 'recherche' where action_title = 't-enedis'`));
  assert.equal((await q1(db, `select etape from public.invest_mission_actions where action_title = 't-enedis'`)).etape, "acquisition");
  const ctl = await qn(db, `select detail from public.invest_controle_dossiers where anomalie = 'action_etape_a_classer'`);
  assert.ok(ctl.some((c) => /priorite/.test(c.detail)));
});

test("17. rattachement jamais bloquant ; dossier d'un autre client refusé explicitement", async () => {
  const db = await nouvelleBase();
  const a = await ouvrir(db, C.nu);
  ok(await collab(db, `insert into public.invest_mission_actions (client_id, step_key, step_label, action_title)
    values ('${C.vide}', 'recherche', 'x', 'Sans dossier')`), "client sans dossier : la tâche est enregistrée");
  assert.equal((await q1(db, `select dossier_id from public.invest_mission_actions where action_title = 'Sans dossier'`)).dossier_id, null);
  assert.ok((await qn(db, `select 1 from public.invest_controle_dossiers where anomalie = 'action_sans_dossier'`)).length > 0);
  refuse(await collab(db, `insert into public.invest_mission_actions (client_id, step_key, step_label, action_title, dossier_id)
    values ('${C.vide}', 'recherche', 'x', 'Mauvais dossier', '${a.id}')`), /autre client/);
  const n = await collab(db, `select public.invest_rattacher_actions_dossier('${a.id}') n`);
  ok(n); assert.equal(n.rows[0].n, 0, "rien à rattacher pour ce client");
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Suppression d'un client (D3)
// ═══════════════════════════════════════════════════════════════════════════
test("18. D3 : client AVEC dossier → suppression refusée, RIEN n'est effacé (ni notes, ni propositions)", async () => {
  const db = await nouvelleBase();
  await ouvrir(db, C.louison);
  // Nouveau chemin CRM : une seule suppression.
  const r = await collab(db, `delete from public.invest_clients where id = '${C.louison}' returning id`);
  refuse(r, /23001|23503|foreign key/i);
  assert.equal(r.erreur.code, "23001", "RESTRICT : code 23001");
  for (const code of ["23001", "23503"]) {
    assert.ok(P.messageSuppressionClient({ code }, 0).startsWith("Ce client possède un Dossier Invest"), code);
  }
  assert.ok(P.messageSuppressionClient(r.erreur, 0).startsWith("Ce client possède un Dossier Invest"));
  assert.equal((await q1(db, `select count(*)::int n from public.invest_notes where client_id = $1`, [C.louison])).n, 1);
  assert.equal((await q1(db, `select count(*)::int n from public.invest_propositions where client_id = $1`, [C.louison])).n, 1);
  assert.equal((await q1(db, `select count(*)::int n from public.invest_mission_actions where client_id = $1`, [C.louison])).n, 5);
});

test("19. D3 : client SANS dossier → suppression comme avant (notes, propositions, tâches en cascade)", async () => {
  const db = await nouvelleBase();
  const r = await collab(db, `delete from public.invest_clients where id = '${C.louison}' returning id`);
  ok(r); assert.equal(r.rows.length, 1);
  assert.equal(P.messageSuppressionClient(null, 1), null);
  assert.equal((await q1(db, `select count(*)::int n from public.invest_notes`)).n, 0);
  assert.equal((await q1(db, `select count(*)::int n from public.invest_propositions`)).n, 0);
  assert.equal((await q1(db, `select count(*)::int n from public.invest_mission_actions where client_id = $1`, [C.louison])).n, 0);
  assert.match(P.messageSuppressionClient(null, 0), /n'a pas été supprimé/);
});

test("20. CRM.jsx : suppression en UN appel vérifié (plus d'effacement préalable des notes/propositions)", () => {
  const debut = CRM.indexOf("Supprimer ${client.prenom}");
  const bloc = CRM.slice(debut, CRM.indexOf("Supprimer</button>", debut));
  assert.ok(bloc.length > 0);
  assert.ok(!/from\("invest_notes"\)\.delete/.test(bloc), "notes non effacées à part");
  assert.ok(!/from\("invest_propositions"\)\.delete/.test(bloc), "propositions non effacées à part");
  assert.match(bloc, /from\("invest_clients"\)\.delete\(\)\.eq\("id", id\)\.select\("id"\)/);
  assert.match(bloc, /messageSuppressionClient\(error, supprimes\?\.length \?\? 0\)/);
  assert.match(bloc, /if \(refus\) \{ window\.alert\(refus\); return; \}/);
  assert.match(CRM, /import \{ messageSuppressionClient \} from "\.\/dossiers\/parcours";/);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Compatibilité des anciens écrans et fonctions
// ═══════════════════════════════════════════════════════════════════════════
test("21. compatibilité : lectures, mises à jour et écritures existantes inchangées", async () => {
  const avant = await nouvelleBase({ migration: false });
  const apres = await nouvelleBase();
  await ouvrir(apres, C.louison);
  for (const db of [avant, apres]) {
    // CRM L587 : liste des tâches
    ok(await collab(db, `select id,client_id,step_key,step_label,action_title,status,due_date,completed_at,updated_at from public.invest_mission_actions limit 4000`));
    // tableauBord : select * avec jointure client
    ok(await collab(db, `select a.*, c.nom from public.invest_mission_actions a left join public.invest_clients c on c.id = a.client_id`));
    // CRM L2501 : patch d'une tâche ; Edge Functions (service_role) : colonnes notification/calendrier par id
    ok(await collab(db, `update public.invest_mission_actions set commentaire = 'ok', justificatif_drive_url = 'u' where id = '50000000-0000-0000-0000-000000000005'`));
    ok(await sous(db, "service_role", null, `update public.invest_mission_actions set notification_status = 'envoyee', notification_sent_at = now(),
      notification_error = null, gmail_message_id = 'g', updated_at = now() where id = '50000000-0000-0000-0000-000000000005'`));
    ok(await sous(db, "service_role", null, `update public.invest_mission_actions set calendar_status = 'cree', calendar_date = '2026-10-01',
      calendar_event_id = 'e', calendar_created_at = now() where id = '50000000-0000-0000-0000-000000000005'`));
    // Cron : relances
    ok(await sous(db, "service_role", null, `update public.invest_mission_actions set last_reminder_sent_at = now(), reminder_count = reminder_count + 1
      where id = '50000000-0000-0000-0000-000000000004'`));
    // Règle d'unicité inchangée
    refuse(await collab(db, `insert into public.invest_mission_actions (client_id, step_key, step_label, action_title)
      values ('${C.louison}', 'enedis', 'x', 'Planifier le RDV Enedis')`), /unique|duplicate/i);
    // Dashboard L273 : sans step_key → échouait déjà avant (colonne obligatoire) : même comportement.
    refuse(await collab(db, `insert into public.invest_mission_actions (client_id, action_title, step_label, status)
      values ('${C.louison}', 'Depuis le tableau de bord', 'Dashboard V9 — client', 'a_faire')`), /step_key|not-null|null value/i);
    // Création de client par les anciens écrans (CRM / Prospection / Structuration)
    ok(await collab(db, `insert into public.invest_clients (nom, prenom, statut, etape) values ('Ancien', 'Écran', 'actif', '1. Signature contrat')`));
  }
  const cols = await qn(apres, `select column_name, is_nullable, column_default from information_schema.columns
    where table_name = 'invest_mission_actions' and column_name in ('dossier_id','operation_id','etape','nature','acteur_type','responsable_id')`);
  assert.equal(cols.length, 6);
  for (const c of cols) assert.ok(c.is_nullable === "YES" || c.column_default, `${c.column_name} facultatif ou avec défaut`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Reprise
// ═══════════════════════════════════════════════════════════════════════════
async function exporter(db) {
  return {
    clients: await qn(db, `select id, nom, prenom, statut, etape, date_signature::text, conseiller, prochaine_action, date_prochaine_action::text from public.invest_clients`),
    actions: await qn(db, `select id, client_id, step_key, action_title, status, responsable, responsable_email, dossier_id, etape, responsable_id from public.invest_mission_actions`),
    prospects: await qn(db, `select id, converted_client_id from public.invest_prospects where converted_client_id is not null`),
    utilisateurs: await qn(db, `select id, nom, email, actif from public.utilisateurs`),
    dossiers: await qn(db, `select id, client_id from public.invest_dossiers`),
  };
}

test("22. reprise : missions identifiées, cas ambigus signalés, rien d'inventé", async () => {
  const db = await nouvelleBase();
  const plan = planifierReprise(await exporter(db), { uuidDepuis });
  const parClient = Object.fromEntries(plan.dossiers.map((d) => [d.client_id, d]));
  // Louison : mission (tâches + étape 13) ; Fanny : Terminé → clos ; Victor : Actif + tâche → dossier.
  assert.ok(parClient[C.louison] && parClient[C.termine] && parClient[C.vide]);
  assert.equal(parClient[C.termine].statut, "clos");
  assert.equal(parClient[C.termine].date_ouverture, "2025-11-03", "date de signature réelle");
  assert.equal(parClient[C.termine].prospect_id, PR.converti);
  // Paul (Prospect avec une tâche) et Nina (Actif, étape 1, aucune trace) : PAS de dossier.
  assert.equal(parClient[C.prospect], undefined);
  assert.equal(parClient[C.nu], undefined);
  const types = plan.anomalies.map((a) => `${a.client_id}:${a.type}`);
  assert.ok(types.includes(`${C.prospect}:prospect_avec_traces_de_mission`));
  assert.ok(types.includes(`${C.nu}:mission_non_identifiable`));
  assert.ok(types.includes(`${C.termine}:conseiller_non_reconnu`), "« Personne Inconnue » n'est rattaché à personne");
  assert.ok(types.includes(`${C.louison}:lettre_mission_date_inconnue`));
  // Aucune date inventée
  const L = parClient[C.louison];
  assert.equal(L.date_ouverture, null); assert.equal(L.lettre_mission_signee_le, null); assert.equal(L.lettre_mission_statut, "signee");
  assert.equal(L.conseiller_id, U.matthieu);
  assert.equal(parClient[C.vide].conseiller_id, U.camille, "« camille » reconnu sans ambiguïté");
  const eL = plan.etapes.filter((e) => e.dossier_id === L.id);
  assert.equal(eL.length, 11);
  assert.ok(eL.every((e) => e.reprise_a_confirmer));
  assert.equal(eL.find((e) => e.etape === "acquisition").statut, "en_cours");
  assert.equal(eL.find((e) => e.etape === "acquisition").prochaine_action, "Relancer le notaire");
  assert.equal(eL.find((e) => e.etape === "acquisition").echeance, "2026-10-15");
  assert.equal(eL.find((e) => e.etape === "financement").statut, "terminee");
  assert.equal(eL.find((e) => e.etape === "suivi").statut, "a_venir");
  assert.ok(types.includes(`${C.louison}:suggestion_etape_en_cours`), "Enedis ouvert : suggestion, pas d'application");
  // Victor : étape client vide → déduite des tâches
  assert.equal(plan.etapes.find((e) => e.dossier_id === parClient[C.vide].id && e.etape === "recherche").statut, "en_cours");
  // Tâches : urbanisme à classer, responsables rapprochés
  const aVelux = plan.actions.find((a) => a.id === "50000000-0000-0000-0000-000000000003");
  assert.equal(aVelux.etape, null);
  assert.equal(plan.urbanisme.length, 1);
  assert.equal(plan.actions.find((a) => a.id === "50000000-0000-0000-0000-000000000002").responsable_id, U.camille, "par le nom « Camille »");
  assert.equal(plan.actions.find((a) => a.id === "50000000-0000-0000-0000-000000000006").responsable_id, null, "« Inconnu » non rapproché");
  assert.ok(!plan.actions.some((a) => a.client_id === C.prospect), "tâches du prospect non rattachées");
  assert.match(rapportReprise(plan), /Points à examiner/);
});

test("23. reprise : SQL rejouable (idempotent), auditable, sans suppression ni JSON modifié", async () => {
  const db = await nouvelleBase();
  const avant = {
    clients: await qn(db, `select id, statut, etape, strategie_data, date_signature from public.invest_clients order by id`),
    actions: (await q1(db, `select count(*)::int n from public.invest_mission_actions`)).n,
  };
  const sql = sqlReprise(planifierReprise(await exporter(db), { uuidDepuis }));
  await db.exec(sql);
  const compte = async () => ({
    dossiers: (await q1(db, `select count(*)::int n from public.invest_dossiers`)).n,
    etapes: (await q1(db, `select count(*)::int n from public.invest_dossier_etapes`)).n,
    evenements: (await q1(db, `select count(*)::int n from public.invest_dossier_evenements`)).n,
    rattachees: (await q1(db, `select count(*)::int n from public.invest_mission_actions where dossier_id is not null`)).n,
  });
  const premier = await compte();
  assert.deepEqual(premier, { dossiers: 3, etapes: 33, evenements: 6, rattachees: 6 });
  await db.exec(sql);
  assert.deepEqual(await compte(), premier, "deuxième passage : aucun changement");
  // Un plan recalculé APRÈS la reprise ne recrée rien.
  const plan2 = planifierReprise(await exporter(db), { uuidDepuis });
  assert.equal(plan2.dossiers.length, 0);
  await db.exec(sqlReprise(plan2));
  assert.deepEqual(await compte(), premier);
  // Rien d'effacé, aucun JSON ni colonne historique modifié.
  assert.equal((await q1(db, `select count(*)::int n from public.invest_mission_actions`)).n, avant.actions);
  assert.deepEqual(await qn(db, `select id, statut, etape, strategie_data, date_signature from public.invest_clients order by id`), avant.clients);
  // Auditable : dossier_cree + reprise_importee par dossier, auteur « Reprise Tranche 1 », dates d'étapes vides.
  const ev = await qn(db, `select type, auteur_type, auteur_libelle from public.invest_dossier_evenements order by type`);
  assert.ok(ev.every((e) => e.auteur_type === "systeme" && e.auteur_libelle === "Reprise Tranche 1"));
  assert.equal(ev.filter((e) => e.type === "reprise_importee").length, 3);
  assert.equal((await q1(db, `select count(*)::int n from public.invest_dossier_etapes where date_debut is not null or date_fin is not null`)).n, 0);
  assert.equal((await q1(db, `select count(*)::int n from public.invest_dossier_etapes where not reprise_a_confirmer`)).n, 0);
  assert.equal((await q1(db, `select etape from public.invest_mission_actions where id = '50000000-0000-0000-0000-000000000003'`)).etape, null, "urbanisme à classer");
  // Contrôle : ce qui reste à faire est visible
  const anomalies = (await qn(db, `select distinct anomalie from public.invest_controle_dossiers order by 1`)).map((a) => a.anomalie);
  for (const attendu of ["action_etape_a_classer", "action_sans_dossier", "client_actif_sans_dossier", "etapes_reprise_a_confirmer", "lettre_mission_signee_sans_date"]) {
    assert.ok(anomalies.includes(attendu), attendu);
  }
});

test("24. reprise : un dossier saisi avant la reprise n'est jamais doublé", async () => {
  const db = await nouvelleBase();
  await ouvrir(db, C.louison);
  const plan = planifierReprise(await exporter(db), { uuidDepuis });
  assert.ok(!plan.dossiers.some((d) => d.client_id === C.louison));
  assert.ok(plan.ignores.some((i) => i.client_id === C.louison && /déjà un dossier/.test(i.raison)));
  await db.exec(sqlReprise(plan));
  assert.equal((await q1(db, `select count(*)::int n from public.invest_dossiers where client_id = $1`, [C.louison])).n, 1);
});

test("25. identifiants déterministes ; SQL refuse un identifiant non UUID", () => {
  assert.equal(uuidDepuis("a"), uuidDepuis("a"));
  assert.notEqual(uuidDepuis("a"), uuidDepuis("b"));
  assert.match(uuidDepuis("x"), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.throws(() => sqlReprise({ dossiers: [{ id: "x'; drop table t; --", client_id: C.nu, reprise: {} }], etapes: [], actions: [], evenements: [] }), /invalide/);
  const u = [{ id: U.camille, nom: "Camille", email: "camille@test.fr" }, { id: U.francois, nom: "Camille Bis", email: "cb@test.fr" }];
  assert.equal(rapprocherUtilisateur(u, { nom: "camille" }).ambigu, true, "deux « Camille » : ambigu, aucun choix");
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Modules purs, retour arrière, statique
// ═══════════════════════════════════════════════════════════════════════════
test("26. parcours.mjs : lecture des anciennes étapes, étape courante, suggestions", () => {
  assert.deepEqual(P.lireEtapeClient("13 Signature Notaire"), { position: 13 });
  assert.deepEqual(P.lireEtapeClient("1. Signature contrat"), { position: 1 });
  assert.deepEqual(P.lireEtapeClient("Finalisé"), { finalise: true });
  assert.equal(P.lireEtapeClient(""), null);
  assert.equal(P.lireEtapeClient("Signature contrat"), null);
  const es = [
    { etape: "signature", statut: "terminee" },
    { etape: "financement", statut: "en_cours", balle: "banque", balle_tiers_libelle: "Banque A" },
    { etape: "acquisition", statut: "en_cours", balle: "notaire" },
    { etape: "suivi", statut: "a_venir" },
  ];
  assert.equal(P.etapeCourante(es).etape, "acquisition", "la plus avancée des étapes en cours");
  assert.equal(P.etapeCourante([...es, { etape: "documents", statut: "bloquee", balle: "client" }]).etape, "documents", "bloquée prioritaire");
  assert.equal(P.etapeCourante([{ etape: "signature", statut: "terminee" }]), null);
  const s = P.suggestionsDepuisActions(es, [
    { etape: "suivi", status: "a_faire" }, { etape: "acquisition", status: "fait" }, { etape: null, status: "a_faire" }]);
  assert.deepEqual(s.map((x) => [x.etape, x.statut_suggere]), [["acquisition", "terminee"], ["suivi", "en_cours"]]);
});

test("27. retour arrière : tables et colonnes retirées, données historiques intactes", async () => {
  const db = await nouvelleBase();
  await ouvrir(db, C.louison);
  await db.exec(ROLLBACK_2D1);
  await db.exec(ROLLBACK_2D);
  await db.exec(ROLLBACK_2C);
  await db.exec(ROLLBACK_2A);
  await db.exec(ROLLBACK);
  assert.equal((await q1(db, `select to_regclass('public.invest_dossiers') t`)).t, null);
  const cols = await qn(db, `select column_name from information_schema.columns where table_name = 'invest_mission_actions'
    and column_name in ('dossier_id','etape','nature','acteur_type','responsable_id','operation_id')`);
  assert.equal(cols.length, 0);
  assert.equal((await q1(db, `select count(*)::int n from public.invest_mission_actions`)).n, 7);
  assert.equal((await q1(db, `select count(*)::int n from public.invest_clients`)).n, 5);
  ok(await collab(db, `delete from public.invest_clients where id = '${C.louison}'`), "suppression redevenue libre");
});

test("28. migration : additive (aucun DML hors fonctions, aucune suppression, aucune policy existante touchée)", () => {
  const code = MIGRATION.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  const horsCorps = code.replace(/\$\$[\s\S]*?\$\$/g, "$$…$$");
  assert.ok(!/\bupdate\s+(public\.)?\w+\s+set\b|\bdelete\s+from\b|\binsert\s+into\b|\btruncate\s+(table\s+)?public\b/i.test(horsCorps), "aucun DML");
  assert.ok(!/\bdrop\s+(table|column|policy|index|function)\b/i.test(code), "aucune suppression");
  assert.ok(!/\balter\s+policy\b|\bdrop\s+policy\b/i.test(code));
  const policies = [...code.matchAll(/create policy (\w+) on public\.(\w+)/g)].map((m) => m[2]);
  assert.ok(policies.every((t) => ["invest_dossiers", "invest_dossier_etapes", "invest_dossier_evenements"].includes(t)));
  assert.ok(!/\bto (anon|public)\b/.test(code.replace(/from public, anon/g, "").replace(/from anon/g, "")), "rien d'accordé à anon");
  assert.match(code, /alter table public\.invest_mission_actions\s+add column if not exists dossier_id/);
});

test("29. migration rejouable sur une base déjà migrée", async () => {
  const db = await nouvelleBase();
  const { id } = await ouvrir(db, C.nu);
  // Les policies ne sont pas « create or replace » : on rejoue tout le reste.
  await db.exec(MIGRATION.replace(/create policy[\s\S]*?;/g, ""));
  await db.exec(MIGRATION_2A);
  await db.exec(MIGRATION_2C);
  await db.exec(MIGRATION_2D);
  await db.exec(MIGRATION_2D1);
  assert.equal((await etapes(db, id)).length, 11);
  ok(await ouvrir(db, C.prospect));
});

test("30. arbitrages : inclusion d'un prospect, exclusion, statuts d'étapes, conseiller, lettre, urbanisme", async () => {
  const db = await nouvelleBase();
  const arbitrages = {
    [C.prospect]: { inclure: true, statut_dossier: "actif", lettre: { statut: "signee", date: "2026-09-17" } },
    [C.louison]: { etapes: { acquisition: "terminee", suivi: "en_cours" }, lettre: { statut: "signee", date: null } },
    [C.termine]: { statut_dossier: "clos", etapes: { acquisition: "terminee", suivi: "non_applicable" }, conseiller_id: U.francois },
    [C.vide]: { exclure: true, motif: "test" },
  };
  const plan = planifierReprise(await exporter(db), { uuidDepuis, arbitrages, urbanismeVers: "acquisition" });
  const d = Object.fromEntries(plan.dossiers.map((x) => [x.client_id, x]));
  assert.ok(d[C.prospect], "prospect inclus par arbitrage");
  assert.equal(d[C.prospect].lettre_mission_signee_le, "2026-09-17");
  assert.equal(d[C.prospect].date_ouverture, "2026-09-17");
  assert.equal(d[C.vide], undefined, "exclu");
  assert.equal(d[C.termine].conseiller_id, U.francois);
  const e = (cid, et) => plan.etapes.find((x) => x.dossier_id === d[cid].id && x.etape === et);
  assert.equal(e(C.louison, "acquisition").statut, "terminee");
  assert.equal(e(C.louison, "acquisition").balle, null);
  assert.equal(e(C.louison, "suivi").statut, "en_cours");
  assert.equal(e(C.louison, "suivi").balle, "profero");
  assert.equal(e(C.louison, "suivi").prochaine_action, "Relancer le notaire", "prochaine action portée par l'étape active");
  assert.equal(d[C.louison].lettre_mission_signee_le, null, "date inconnue non inventée");
  assert.equal(e(C.termine, "suivi").statut, "non_applicable");
  assert.equal(plan.actions.find((a) => a.id === "50000000-0000-0000-0000-000000000003").etape, "acquisition", "urbanisme → acquisition");
  assert.ok(!plan.anomalies.some((a) => a.client_id === C.termine && a.type === "dossier_clos_avec_etape_active"));
  const exp = await exporter(db);
  assert.throws(() => planifierReprise(exp, { uuidDepuis, arbitrages: { [C.louison]: { etapes: { inconnue: "terminee" } } } }), /étape inconnue/);
});

test("31. SQL par groupes = SQL tâche par tâche (même état final), rejouable", async () => {
  const arbitrages = { [C.louison]: { etapes: { acquisition: "terminee", suivi: "en_cours" } } };
  const etat = async (db) => ({
    dossiers: await qn(db, `select id, client_id, statut, conseiller_id, lettre_mission_statut, lettre_mission_signee_le::text, date_ouverture::text from public.invest_dossiers order by id`),
    etapes: await qn(db, `select dossier_id, etape, statut, balle, balle_utilisateur_id, prochaine_action, echeance::text from public.invest_dossier_etapes order by dossier_id, etape`),
    actions: await qn(db, `select id, dossier_id, etape, responsable_id from public.invest_mission_actions order by id`),
  });
  const a = await nouvelleBase(); const b = await nouvelleBase();
  const planA = planifierReprise(await exporter(a), { uuidDepuis, arbitrages, urbanismeVers: "acquisition" });
  const planB = planifierReprise(await exporter(b), { uuidDepuis, arbitrages, urbanismeVers: "acquisition" });
  await a.exec(sqlReprise(planA));
  const sqlG = sqlReprise(planB, { parGroupes: true, urbanismeVers: "acquisition" });
  await b.exec(sqlG);
  assert.deepEqual(await etat(b), await etat(a));
  await b.exec(sqlG);
  assert.deepEqual(await etat(b), await etat(a), "rejouable");
  assert.ok(!/\bdelete\b|\bdrop\b|\btruncate\b/i.test(sqlG));
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Tranche 2a — pilotage du dossier dans le CRM
// ═══════════════════════════════════════════════════════════════════════════
const STATUTS = Object.keys(P.STATUTS_ETAPE);
const ACTIFS = ["en_cours", "en_attente", "bloquee"];
/** Place une étape dans un état donné, en maintenance (hors règles 2a), comme la reprise. */
const placer = (db, dossier, cle, statut, commentaire = "état initial") => db.query(
  `update public.invest_dossier_etapes set statut = $3, balle = $4, balle_utilisateur_id = null, balle_tiers_libelle = null,
     blocage_motif = $5, bloquee_depuis = $6::date, commentaire = $7
   where dossier_id = $1 and etape = $2`,
  [dossier, cle, statut, ACTIFS.includes(statut) ? "client" : null,
   statut === "bloquee" ? "motif initial" : null, statut === "bloquee" ? "2026-09-01" : null, commentaire]);
const majEtape = (db, dossier, cle, set, email = COLLAB) =>
  sous(db, "authenticated", email, `update public.invest_dossier_etapes set ${set} where dossier_id = '${dossier}' and etape = '${cle}'`);
const clientsHistorique = (db) => qn(db, `select id, etape, etape_num, statut from public.invest_clients order by id`);

test("32. 2a : matrice des enchaînements — chaque passage autorisé passe, chaque passage interdit est refusé", async () => {
  const db = await nouvelleBase();
  const { id } = await ouvrir(db, C.nu);
  for (const de of STATUTS) for (const vers of STATUTS) {
    assert.equal((await q1(db, `select public.invest_transition_etape_autorisee($1, $2) a`, [de, vers])).a,
      TR.transitionAutorisee(de, vers), `matrice SQL = matrice JS (${de} → ${vers})`);
    if (de === vers) continue;
    await placer(db, id, "collecte", de);
    const r = await majEtape(db, id, "collecte", `statut = '${vers}', balle = ${ACTIFS.includes(vers) ? "'profero'" : "null"},
      blocage_motif = ${vers === "bloquee" ? "'Pièce manquante'" : "null"}, commentaire = 'Motif du passage ${de} → ${vers}'`);
    if (TR.transitionAutorisee(de, vers)) ok(r, `${de} → ${vers} devait passer`);
    else refuse(r, /Enchaînement interdit/);
    assert.equal((await etape(db, id, "collecte")).statut, TR.transitionAutorisee(de, vers) ? vers : de);
  }
  // Exemples explicites (lecture humaine) : on ne saute pas d'« à venir » à « terminée ».
  assert.equal(TR.transitionAutorisee("a_venir", "terminee"), false);
  assert.equal(TR.transitionAutorisee("bloquee", "terminee"), false, "débloquer d'abord");
  assert.equal(TR.transitionAutorisee("terminee", "non_applicable"), false);
});

test("33. 2a : balle obligatoire, motif de blocage, motif « non applicable », motif de réouverture", async () => {
  const db = await nouvelleBase();
  const { id } = await ouvrir(db, C.nu);
  refuse(await majEtape(db, id, "collecte", `statut = 'en_cours'`), /balle/);
  refuse(await majEtape(db, id, "signature", `statut = 'bloquee'`), /blocage/);
  // Non applicable : commentaire exigé ET nouveau.
  refuse(await majEtape(db, id, "structuration", `statut = 'non_applicable'`), /Non applicable.*motif/);
  refuse(await majEtape(db, id, "structuration", `statut = 'non_applicable', commentaire = '   '`), /motif/);
  await db.query(`update public.invest_dossier_etapes set commentaire = 'ancien commentaire' where dossier_id = $1 and etape = 'structuration'`, [id]);
  refuse(await majEtape(db, id, "structuration", `statut = 'non_applicable'`), /motif/, "un commentaire inchangé n'est pas un motif");
  ok(await majEtape(db, id, "structuration", `statut = 'non_applicable', commentaire = 'ancien commentaire' || chr(10) || '30/09/2026 · Non applicable : achat en nom propre'`));
  // Réouverture : motif exigé depuis « non applicable » et depuis « terminée ».
  refuse(await majEtape(db, id, "structuration", `statut = 'en_cours', balle = 'client'`), /Rouvrir.*motif/);
  ok(await majEtape(db, id, "structuration", `statut = 'en_cours', balle = 'client', commentaire = commentaire || chr(10) || 'Rouvrir : SCI finalement envisagée'`));
  ok(await majEtape(db, id, "signature", `statut = 'terminee'`));
  refuse(await majEtape(db, id, "signature", `statut = 'en_cours', balle = 'profero'`), /Rouvrir.*motif/);
  ok(await majEtape(db, id, "signature", `statut = 'en_cours', balle = 'profero', commentaire = 'Rouvrir : avenant à signer'`));
  // Données de reprise : une étape déjà « non applicable » sans commentaire reste valide et modifiable.
  await placer(db, id, "suivi", "non_applicable", null);
  ok(await majEtape(db, id, "suivi", `echeance = '2026-12-01'`), "règle au passage seulement");
  // Le service (clé serveur) est soumis aux mêmes règles ; seule la maintenance postgres y échappe.
  refuse(await sous(db, "service_role", null, `update public.invest_dossier_etapes set statut = 'terminee' where dossier_id = '${id}' and etape = 'documents'`), /Enchaînement interdit/);
});

test("34. 2a : reprise à confirmer — jamais implicite, confirmée seulement par le geste, journalisée", async () => {
  const db = await nouvelleBase();
  const { id } = await ouvrir(db, C.nu);
  await db.query(`update public.invest_dossier_etapes set reprise_a_confirmer = true where dossier_id = $1`, [id]);
  // Corrections de statut, de balle, d'échéance, de prochaine action : le drapeau reste.
  ok(await majEtape(db, id, "collecte", `statut = 'en_cours', balle = 'client'`));
  ok(await majEtape(db, id, "collecte", `balle = 'notaire', balle_tiers_libelle = 'Étude Martin'`));
  ok(await majEtape(db, id, "collecte", `echeance = '2026-11-02', prochaine_action = 'Relancer'`));
  ok(await majEtape(db, id, "collecte", `statut = 'terminee'`));
  assert.equal((await etape(db, id, "collecte")).reprise_a_confirmer, true, "aucune confirmation implicite");
  assert.ok(!(await evenements(db, id)).some((e) => e.type === "etape_reprise_confirmee"));
  // Le geste « Confirmer la reprise » (patch préparé par transitions.mjs).
  const { patch, erreurs } = TR.preparerGeste(await etape(db, id, "collecte"), "confirmer_reprise", {}, "2026-09-30");
  assert.deepEqual(erreurs, []); assert.deepEqual(patch, { reprise_a_confirmer: false });
  ok(await majEtape(db, id, "collecte", `reprise_a_confirmer = false`));
  const ev = (await evenements(db, id)).filter((e) => e.type === "etape_reprise_confirmee");
  assert.equal(ev.length, 1);
  assert.equal(ev[0].resume, "Collecte : reprise confirmée (Terminée).");
  assert.equal(ev[0].auteur_libelle, "Matthieu");
  assert.deepEqual(ev[0].apres, { reprise_a_confirmer: false, statut: "terminee" });
  // Retour en arrière interdit ; les autres étapes restent à confirmer.
  refuse(await majEtape(db, id, "collecte", `reprise_a_confirmer = true`), /ne redevient pas/);
  assert.equal((await q1(db, `select count(*)::int n from public.invest_dossier_etapes where dossier_id = $1 and reprise_a_confirmer`, [id])).n, 10);
  assert.equal(TR.gestesDisponibles(await etape(db, id, "collecte")).some((g) => g.cle === "confirmer_reprise"), false, "geste masqué une fois confirmé");
  assert.equal(TR.gestesDisponibles(await etape(db, id, "suivi")).some((g) => g.cle === "confirmer_reprise"), true);
  const anomalie = await q1(db, `select detail from public.invest_controle_dossiers where anomalie = 'etapes_reprise_a_confirmer' and dossier_id = $1`, [id]);
  assert.match(anomalie.detail, /10 étape\(s\) à confirmer/);
});

test("35. 2a : journal — heure réelle, numéro d'ordre unique, tri canonique entièrement déterministe", async () => {
  const db = await nouvelleBase();
  const { id } = await ouvrir(db, C.nu);
  // Une seule modification produit trois événements ; puis plusieurs gestes dans UNE transaction.
  ok(await majEtape(db, id, "collecte", `statut = 'en_cours', balle = 'client', echeance = '2026-10-20'`));
  ok(await sous(db, "authenticated", COLLAB, [
    `update public.invest_dossier_etapes set balle = 'banque', balle_tiers_libelle = 'Banque A' where dossier_id = '${id}' and etape = 'collecte'`,
    `update public.invest_dossier_etapes set statut = 'en_attente' where dossier_id = '${id}' and etape = 'collecte'`,
    `update public.invest_dossier_etapes set statut = 'non_applicable', commentaire = '30/09/2026 · Non applicable : pas de SCI' where dossier_id = '${id}' and etape = 'structuration'`,
  ]));
  // Ordre d'écriture = ordre croissant des numéros ; aucune heure ne recule.
  const ev = await qn(db, `select id, ordre, type, resume, avant, apres, survenu_le, to_char(survenu_le, 'YYYY-MM-DD"T"HH24:MI:SS.US') t
    from public.invest_dossier_evenements where dossier_id = $1 order by ordre`, [id]);
  assert.deepEqual(ev.map((e) => e.type), ["dossier_cree", "etape_statut_change", "etape_balle_change", "etape_echeance_change",
    "etape_balle_change", "etape_statut_change", "etape_statut_change"], "numéros attribués dans l'ordre d'écriture");
  for (let i = 1; i < ev.length; i++) {
    assert.ok(BigInt(ev[i].ordre) > BigInt(ev[i - 1].ordre), "numéro strictement croissant");
    assert.ok(ev[i].t >= ev[i - 1].t, "l'heure ne recule jamais");
  }
  assert.equal(new Set(ev.map((e) => String(e.ordre))).size, ev.length, "numéros uniques");
  assert.equal(ev[2].resume, "Collecte : balle personne → Client.", "plus de « balle — → Client »");
  assert.equal(ev[4].resume, "Collecte : balle Client → Banque (Banque A).");
  assert.equal(ev[6].resume, "Structuration : À venir → Non applicable. Motif : 30/09/2026 · Non applicable : pas de SCI");
  assert.equal(ev[6].apres.commentaire, "30/09/2026 · Non applicable : pas de SCI", "le commentaire est dans le journal");

  // Même heure possible (précision de l'horloge) : démontré par des événements
  // de maintenance écrits à la MÊME heure exacte. Le numéro les départage.
  const meme = "2026-09-30 10:00:00.123456+00";
  await db.query(`insert into public.invest_dossier_evenements (dossier_id, client_id, type, resume, auteur_type, auteur_libelle, survenu_le)
    select $1, $2, 'dossier_modifie', 'Maintenance ' || g, 'systeme', 'Test', $3::timestamptz from generate_series(1, 4) g`, [id, C.nu, meme]);
  const ex = await qn(db, `select id, ordre, resume, survenu_le, to_char(survenu_le, 'YYYY-MM-DD"T"HH24:MI:SS.USTZH:TZM') t
    from public.invest_dossier_evenements where dossier_id = $1 and auteur_libelle = 'Test' order by ordre`, [id]);
  assert.equal(new Set(ex.map((e) => e.t)).size, 1, "quatre événements, une seule heure");
  assert.equal(new Set(ex.map((e) => String(e.ordre))).size, 4, "quatre numéros distincts");
  // Tri SQL canonique = tri de l'écran (dossierVue.journal), quel que soit l'ordre de lecture.
  const canon = (await qn(db, `select id from public.invest_dossier_evenements where dossier_id = $1 order by survenu_le desc, ordre desc`, [id])).map((e) => e.id);
  const tous = await qn(db, `select id, ordre, type, resume, auteur_libelle, auteur_type, etape_id,
    to_char(survenu_le, 'YYYY-MM-DD"T"HH24:MI:SS.USTZH:TZM') survenu_le from public.invest_dossier_evenements where dossier_id = $1`, [id]);
  for (const melange of [tous, [...tous].reverse(), [...tous].sort((a, b) => String(a.id).localeCompare(String(b.id)))]) {
    assert.deepEqual(V.journal(melange).map((e) => e.id), canon, "affichage identique, quel que soit l'ordre reçu");
  }
  assert.deepEqual(V.journal(ex.map((e) => ({ ...e, survenu_le: e.t }))).map((e) => e.resume),
    ["Maintenance 4", "Maintenance 3", "Maintenance 2", "Maintenance 1"], "à heure égale : le dernier enregistré en premier");
  // Deux événements consécutifs ne sont jamais indiscernables : (survenu_le, ordre) est unique,
  // le numéro ne se choisit pas, et l'écran ne rend jamais deux clés égales.
  assert.equal((await q1(db, `select count(*)::int n from (select survenu_le, ordre from public.invest_dossier_evenements
    group by 1, 2 having count(*) > 1) x`)).n, 0);
  await assert.rejects(db.query(`insert into public.invest_dossier_evenements (dossier_id, client_id, type, resume, auteur_type, auteur_libelle, ordre)
    values ($1, $2, 'dossier_modifie', 'x', 'systeme', 'x', 1)`, [id, C.nu]), /ordre|generated|identity|GENERATED/i, "numéro jamais saisi à la main");
  const cles = V.journal(tous).map((e) => `${e.quand}|${e.ordre}`);
  assert.equal(new Set(cles).size, cles.length);
  assert.ok(V.comparerEvenements({ survenu_le: meme, ordre: "10" }, { survenu_le: meme, ordre: "9" }) < 0, "comparaison numérique, pas alphabétique");
  // Défaut de colonne : heure réelle aussi.
  assert.match((await q1(db, `select column_default d from information_schema.columns where table_name = 'invest_dossier_evenements' and column_name = 'survenu_le'`)).d, /clock_timestamp/);
});

test("36. 2a : aucune progression automatique (étape terminée, tâches faites, tâche créée)", async () => {
  const db = await nouvelleBase();
  const { id } = await ouvrir(db, C.nu);
  const photo = async () => (await etapes(db, id)).map((e) => `${e.etape}:${e.statut}:${e.balle}`).sort();
  ok(await majEtape(db, id, "signature", `statut = 'terminee'`));
  const apres = await photo();
  assert.ok(apres.includes("collecte:a_venir:null"), "l'étape suivante ne démarre pas seule");
  // Des tâches de Collecte créées puis toutes faites : l'étape ne bouge pas.
  ok(await collab(db, `insert into public.invest_mission_actions (client_id, dossier_id, etape, step_key, step_label, action_title, status)
    values ('${C.nu}', '${id}', 'collecte', 'lancement', 'Lancement mission', 'Vérifier la complétude', 'a_faire'),
           ('${C.nu}', '${id}', 'collecte', 'lancement', 'Lancement mission', 'Vérifier les fonds', 'a_faire')`));
  assert.deepEqual(await photo(), apres, "créer des tâches ne démarre pas l'étape");
  ok(await collab(db, `update public.invest_mission_actions set status = 'fait' where dossier_id = '${id}'`));
  assert.deepEqual(await photo(), apres, "tâches faites ≠ étape terminée");
  assert.equal((await q1(db, `select statut from public.invest_dossiers where id = $1`, [id])).statut, "ouvert", "statut du dossier inchangé");
  // La suggestion existe… mais n'est qu'une suggestion.
  const s = V.suggestions(await etapes(db, id), await qn(db, `select * from public.invest_mission_actions where dossier_id = $1`, [id]), id);
  assert.deepEqual(s.map((x) => [x.etape, x.statut_suggere]), []);
  const s2 = V.suggestions((await etapes(db, id)).map((e) => e.etape === "collecte" ? { ...e, statut: "en_cours" } : e),
    await qn(db, `select * from public.invest_mission_actions where dossier_id = $1`, [id]), id);
  assert.deepEqual(s2.map((x) => [x.etape, x.statut_suggere]), [["collecte", "terminee"]]);
  assert.equal((await etape(db, id, "collecte")).statut, "a_venir");
});

test("37. 2a : une tâche créée depuis la fiche porte explicitement dossier ET étape", async () => {
  const db = await nouvelleBase();
  const { id } = await ouvrir(db, C.nu);
  // Tâche collaborateur (FicheClient) : champsNouvelleTache.
  const champs = V.champsNouvelleTache(id, "analyse");
  assert.deepEqual(champs, { dossier_id: id, etape: "analyse", step_key: "analyse", step_label: "Analyse", step_index: 4 });
  const r = await collab(db, `insert into public.invest_mission_actions (client_id, dossier_id, etape, step_key, step_label, step_index,
      sort_order, action_title, responsable, responsable_email, status, due_reminder_enabled, created_by, metadata)
    values ($1, $2, $3, $4, $5, $6, 999, 'Préparer l''analyse', 'Camille', 'camille@test.fr', 'a_faire', true, 'Matthieu', '{}') returning dossier_id, etape, responsable_id`,
    [C.nu, champs.dossier_id, champs.etape, champs.step_key, champs.step_label, champs.step_index]);
  ok(r);
  assert.deepEqual(r.rows[0], { dossier_id: id, etape: "analyse", responsable_id: U.camille });
  // Modèle « Urbanisme » généré depuis l'onglet Acquisition : l'étape explicite l'emporte (jamais « à classer »).
  assert.equal(P.etapePourNouvelleTache("urbanisme"), "acquisition");
  const u = await collab(db, `insert into public.invest_mission_actions (client_id, dossier_id, etape, step_key, step_label, action_title)
    values ('${C.nu}', '${id}', '${P.etapePourNouvelleTache("urbanisme")}', 'urbanisme', 'Urbanisme & administratif', 'Déposer la DP') returning etape`);
  ok(u); assert.equal(u.rows[0].etape, "acquisition");
  // Sans dossier en cours, aucune tâche nouvelle : refus explicite côté écran.
  assert.throws(() => V.champsNouvelleTache(null, "analyse"), /Démarrez d'abord une mission/);
  assert.throws(() => V.champsNouvelleTache(id, "inconnue"), /étape/);
  // Rangement par étape (dossierVue) : la tâche Urbanisme est dans Acquisition, pas « à classer ».
  const t = V.tachesParEtape(await qn(db, `select * from public.invest_mission_actions where client_id = $1`, [C.nu]), id);
  assert.equal(t.acquisition.ouvertes.length, 1); assert.equal(t.analyse.ouvertes.length, 1); assert.equal(t[V.A_CLASSER].ouvertes.length, 0);
});

test("38. 2a : l'ancienne étape du client (invest_clients.etape / etape_num) n'est jamais modifiée", async () => {
  const db = await nouvelleBase();
  const avant = await clientsHistorique(db);
  const { id } = await ouvrir(db, C.louison);
  for (const [cle, geste, saisie] of [
    ["collecte", "demarrer", { balle: "client" }], ["collecte", "bloquer", { balle: "client", motif: "CNI" }],
    ["collecte", "debloquer", { balle: "profero" }], ["collecte", "terminer", {}],
    ["collecte", "rouvrir", { balle: "profero", motif: "pièce à refaire" }], ["structuration", "non_applicable", { motif: "nom propre" }],
    ["signature", "prochaine_action", { prochaine_action: "Envoyer la lettre" }], ["signature", "echeance", { echeance: "2026-10-31" }],
  ]) {
    const { patch, erreurs } = TR.preparerGeste(await etape(db, id, cle), geste, saisie, "2026-09-30");
    assert.deepEqual(erreurs, [], `${cle}/${geste}`);
    const sets = Object.entries(patch).map(([k, v]) => `${k} = ${v === null ? "null" : `'${String(v).replace(/'/g, "''")}'`}`).join(", ");
    ok(await majEtape(db, id, cle, sets), `${cle}/${geste}`);
  }
  const apres = await clientsHistorique(db);
  assert.deepEqual(apres.map(({ id: i, etape: e, etape_num: n }) => [i, e, n]), avant.map(({ id: i, etape: e, etape_num: n }) => [i, e, n]));
});

test("39. 2a : transitions.mjs et dossierVue.mjs (gestes, saisies, affichage, impossibilités visibles)", () => {
  const e = (statut, extra = {}) => ({ id: "e1", etape: "collecte", statut, commentaire: null, reprise_a_confirmer: false, ...extra });
  assert.deepEqual(TR.gestesDisponibles(e("a_venir")).map((g) => g.cle), ["demarrer", "non_applicable", "prochaine_action", "echeance"]);
  assert.deepEqual(TR.gestesDisponibles(e("bloquee", { balle: "client" })).map((g) => g.cle), ["debloquer", "changer_balle", "prochaine_action", "echeance"]);
  assert.deepEqual(TR.gestesDisponibles(e("terminee")).map((g) => g.cle), ["rouvrir", "prochaine_action", "echeance"]);
  assert.ok(TR.gestesDisponibles(e("terminee", { reprise_a_confirmer: true })).some((g) => g.cle === "confirmer_reprise"));
  assert.deepEqual(TR.gestesDisponibles(e("en_cours", { operation_id: "x" })), [], "étapes d'opération : Tranche 5");
  // Chaque geste proposé mène à un passage autorisé.
  for (const s of STATUTS) for (const g of TR.gestesDisponibles(e(s, { balle: ACTIFS.includes(s) ? "client" : null }))) {
    if (g.vers) assert.ok(TR.transitionAutorisee(s, g.vers), `${s} → ${g.cle}`);
  }
  assert.deepEqual(TR.preparerGeste(e("a_venir"), "demarrer", {}).erreurs, ["Indiquez qui a la balle."]);
  assert.deepEqual(TR.preparerGeste(e("en_cours", { balle: "client" }), "bloquer", { balle: "client" }).erreurs, ["Un motif est obligatoire."]);
  assert.deepEqual(TR.preparerGeste(e("en_cours", { balle: "client" }), "non_applicable", {}).erreurs, ["Un motif est obligatoire."]);
  assert.deepEqual(TR.preparerGeste(e("terminee"), "rouvrir", { balle: "client" }).erreurs, ["Un motif est obligatoire."]);
  assert.match(TR.preparerGeste(e("a_venir"), "terminer", {}).erreurs[0], /n'est pas possible/);
  assert.match(TR.preparerGeste(e("a_venir"), "confirmer_reprise", {}).erreurs[0], /n'est pas possible/);
  assert.deepEqual(TR.preparerGeste(e("a_venir"), "echeance", { echeance: "31/10/2026" }).erreurs, ["Date d'échéance invalide."]);
  const na = TR.preparerGeste(e("a_venir", { commentaire: "Note" }), "non_applicable", { motif: " pas de SCI " }, "2026-09-30");
  assert.deepEqual(na.patch, { statut: "non_applicable", commentaire: "Note\n30/09/2026 · Non applicable : pas de SCI" }, "motif ajouté, jamais d'écrasement");
  const pro = TR.preparerGeste(e("a_venir"), "demarrer", { balle: "profero", balle_utilisateur_id: U.camille, balle_tiers_libelle: "ignoré" });
  assert.deepEqual(pro.patch, { balle: "profero", balle_utilisateur_id: U.camille, balle_tiers_libelle: null, statut: "en_cours" });
  assert.equal(TR.preparerGeste(e("en_cours", { balle: "client" }), "changer_balle", { balle: "notaire", balle_tiers_libelle: "Étude X" }).patch.statut, undefined, "changer la balle ne change pas le statut");

  // Affichage
  const us = [{ id: U.matthieu, nom: "Matthieu" }];
  const etapesD = [
    { id: "a", etape: "signature", statut: "terminee" },
    { id: "b", etape: "financement", statut: "en_cours", balle: "banque", balle_tiers_libelle: "Banque A", reprise_a_confirmer: true },
    { id: "c", etape: "acquisition", statut: "en_attente", balle: "profero", balle_utilisateur_id: U.matthieu, prochaine_action: "Relancer", echeance: "2026-09-01" },
  ];
  const r = V.ruban(etapesD, us);
  assert.equal(r.length, 11);
  assert.equal(r.find((x) => x.cle === "collecte").statutLibelle, "Étape absente", "une étape manquante se voit");
  assert.equal(r.find((x) => x.cle === "financement").aConfirmer, true);
  assert.deepEqual(r.filter((x) => x.active).map((x) => x.cle), ["financement", "acquisition"], "toutes les étapes actives");
  const m = V.maintenant(etapesD, us, "2026-09-30");
  assert.equal(m.etape, "financement", "en cours prime sur en attente");
  assert.equal(m.balle, "Banque (Banque A)");
  assert.equal(m.actives.length, 2);
  assert.equal(m.actives[1].balle, "Profero (Matthieu)");
  assert.deepEqual(V.libelleEcheance(null, "2026-09-30"), { texte: "aucune", depassee: false });
  assert.deepEqual(V.libelleEcheance("2026-09-01", "2026-09-30"), { texte: "01/09/2026", depassee: true });
  assert.equal(V.maintenant([{ etape: "signature", statut: "terminee" }], us).aucune, true);
  // Sélection du dossier : le dossier en cours d'abord, sinon le dernier clos.
  const ds = [{ id: "d1", statut: "clos", date_cloture: "2026-01-01", reference: "INV-1", libelle: "A" },
              { id: "d2", statut: "clos", date_cloture: "2026-06-01", reference: "INV-2", libelle: "B" }];
  assert.equal(V.choisirDossier(ds).id, "d2");
  assert.equal(V.choisirDossier([...ds, { id: "d3", statut: "suspendu", reference: "INV-3", libelle: "C" }]).id, "d3");
  assert.equal(V.choisirDossier(ds, "d1").id, "d1");
  assert.equal(V.choisirDossier([]), null);
  // Anomalies : libellés métier, regroupées.
  const an = V.anomalies([{ anomalie: "action_etape_a_classer", dossier_id: "d3", detail: "urbanisme — Velux" },
    { anomalie: "action_etape_a_classer", dossier_id: "d3", detail: "urbanisme — DP" }, { anomalie: "client_actif_sans_dossier", dossier_id: null, detail: "X" }], "d3");
  assert.deepEqual(an.map((a) => [a.libelle, a.nombre]), [["Tâche à classer dans une étape", 2],
    ["Client « Actif » sans dossier en cours : mettre à jour son statut ou démarrer une mission", 1]]);
  // Statut client : signalé, jamais corrigé.
  assert.match(V.incoherenceStatutClient({ statut: "Terminé" }, [{ statut: "actif", reference: "INV-9" }]), /Statut client « Terminé ».*INV-9.*rien n'est corrigé/);
  assert.equal(V.incoherenceStatutClient({ statut: "Actif" }, [{ statut: "actif", reference: "INV-9" }]), null);
  // En-tête : lettre signée sans date = anomalie visible, pas une date inventée.
  const h = V.entete({ reference: "INV-1", libelle: "A", statut: "actif", lettre_mission_statut: "signee", conseiller_id: null }, us);
  assert.equal(h.lettre, "Signée (date inconnue)"); assert.equal(h.lettreAnomalie, true); assert.equal(h.conseiller, "aucun");
});

test("40. 2a : CRM.jsx et la carte — plus d'écriture de l'ancienne étape, tâches avec dossier + étape", () => {
  const code = CRM.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  // Aucune écriture de invest_clients.etape / etape_num dans les écrans basculés.
  assert.ok(!/updateClientPatch\(\{\s*etape/.test(code), "fiche : étape en lecture seule");
  assert.ok(!/\betape_num\b/.test(code));
  const form = code.slice(code.indexOf("function FormulaireClient"), code.indexOf("function FormulaireClient") + 6000);
  assert.ok(!/\betape\s*:/.test(form.slice(form.indexOf("const payload"), form.indexOf("Object.keys(payload)"))), "formulaire : etape absente du payload");
  const frise = code.slice(code.indexOf("const saveTimelineDraft"), code.indexOf("const saveTimelineDraft") + 900);
  assert.ok(!/\betape\s*:/.test(frise), "frise : etape absente de la mise à jour");
  assert.ok(!/advanceClientTimelineStep|applyInferredTimelineStep/.test(code), "« Valider étape » retiré");
  assert.ok(!/setTimelineDraft\(client\.id, \{ etape/.test(code));
  // Parcours mission : onglets canoniques, tâches générées avec dossier + étape.
  const gen = code.slice(code.indexOf("const genererActions"), code.indexOf("const notifyActionCompletionToMatthieu"));
  assert.equal((gen.match(/dossier_id: dossierId,/g) || []).length, 2, "Générer étape + Tout générer");
  assert.match(gen, /etape: onglet\.key,/); assert.match(gen, /etape: etapePourNouvelleTache\(step\.key\),/);
  assert.match(gen, /if \(!dossierId\) \{ setError\(MSG_SANS_DOSSIER\); return; \}/);
  assert.match(code, /const missionEtapeDeTache = \(a\) => \(a\?\.etape && CLES_ETAPES\.includes\(a\.etape\) \? a\.etape : A_CLASSER\);/);
  assert.match(code, /\{ongletsEtapes\.map\(missionOngletEtape\)\.map\(/);
  // Tâche collaborateur : champsNouvelleTache (dossier en cours + étape).
  const assign = code.slice(code.indexOf("const assignerTacheCollaborateur"), code.indexOf("const assignerTacheCollaborateur") + 4000);
  assert.match(assign, /champsNouvelleTache\(dossierInfo\?\.dossierEnCoursId/);
  assert.match(assign, /\.\.\.champsEtape,/);
  assert.match(code, /<DossierInvestCard client=\{client\}/);
  // Carte : n'écrit jamais invest_clients, démarre par invest_ouvrir_dossier, gestes via preparerGeste.
  assert.ok(!/from\("invest_clients"\)/.test(CARTE), "la carte ne touche pas au client");
  assert.match(CARTE, /supabase\.rpc\("invest_ouvrir_dossier"/);
  assert.match(CARTE, /\.order\("survenu_le", \{ ascending: false \}\)\.order\("ordre", \{ ascending: false \}\)/, "tri canonique du journal");
  assert.match(CARTE, /preparerGeste\(etape, geste\.cle, saisie, aujourdhui\)/);
  assert.ok(!/reprise_a_confirmer\s*:/.test(CARTE), "le drapeau de reprise n'est écrit que par le geste préparé");
  assert.ok(!/invest_dossier_evenements"\)\.(insert|update|delete)/.test(CARTE), "journal en lecture seule");
  assert.ok(!/\.delete\(/.test(CARTE), "aucune suppression");
});

test("41. 2a : migration additive et courte (aucune donnée touchée, rien sur Foyer / Patrimoine)", () => {
  const code = MIGRATION_2A.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  const horsCorps = code.replace(/\$\$[\s\S]*?\$\$/g, "$$…$$");
  assert.ok(!/\bupdate\s+(public\.)?\w+\s+set\b|\bdelete\s+from\b|\binsert\s+into\b|\btruncate\b/i.test(horsCorps), "aucun DML");
  assert.ok(!/\bcreate\s+table\b|\bdrop\s+(table|column|policy|index|view|trigger)\b|\bpolicy\b/i.test(code));
  // Règles 2a : déclencheur aux droits de l'appelant (sinon current_user = propriétaire et tout le monde « est » maintenance).
  const regles = code.slice(code.indexOf("function public.invest_etapes_regles_pilotage"));
  assert.match(regles.slice(0, 200), /security invoker/);
  assert.ok(!/invest_etapes_avant_ecriture/.test(code), "la fonction Tranche 1 n'est pas réécrite");
  const drops = [...code.matchAll(/\bdrop\s+(\w+)\s+(?:if exists\s+)?(\w+)/gi)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(drops, ["constraint invest_dossier_evenements_type_check"], "seule la liste des types d'événements est remplacée");
  const tables = [...code.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]);
  assert.ok(tables.every((t) => t === "invest_dossier_evenements"));
  assert.ok(!/foyer|patrimoine/i.test(code));
  assert.ok(!/\bto (anon|public)\b/.test(code));
});

test("42. 2a : rejouable, et retour arrière non destructif vers le texte exact de la Tranche 1", async () => {
  const t1 = await nouvelleBase({ t2a: false });
  const db = await nouvelleBase();
  await db.exec(MIGRATION_2A); // rejouable
  const { id } = await ouvrir(db, C.nu);
  await db.query(`update public.invest_dossier_etapes set reprise_a_confirmer = true where dossier_id = $1 and etape = 'collecte'`, [id]);
  ok(await majEtape(db, id, "collecte", `reprise_a_confirmer = false`));
  await db.exec(ROLLBACK_2A);
  const def = async (b, f) => (await q1(b, `select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1`, [f]))?.d;
  for (const f of ["invest_journaliser", "invest_etapes_avant_ecriture", "invest_etapes_journal"]) {
    assert.equal(await def(db, f), await def(t1, f), `${f} identique à la Tranche 1`);
  }
  for (const f of ["invest_transition_etape_autorisee", "invest_derniere_ligne", "invest_etapes_regles_pilotage"]) assert.equal(await def(db, f), undefined);
  assert.equal((await q1(db, `select count(*)::int n from pg_trigger where tgname = 'invest_etapes_regles_pilotage'`)).n, 0);
  assert.equal((await q1(db, `select count(*)::int n from public.invest_dossier_evenements where type = 'etape_reprise_confirmee'`)).n, 1, "historique conservé");
  assert.equal((await q1(db, `select count(*)::int n from public.invest_dossier_evenements where ordre is null`)).n, 0, "colonne d'ordre conservée et remplie");
  assert.match((await q1(db, `select column_default d from information_schema.columns where table_name = 'invest_dossier_evenements' and column_name = 'survenu_le'`)).d, /now\(\)/);
  ok(await majEtape(db, id, "documents", `statut = 'en_cours', balle = 'client'`), "fonctionnement Tranche 1 retrouvé");
  // Et on peut réappliquer la 2a après le retour arrière.
  await db.exec(MIGRATION_2A);
  refuse(await majEtape(db, id, "analyse", `statut = 'terminee'`), /Enchaînement interdit/);
});

test("43. 2a : colonne d'ordre ajoutée sur un journal DÉJÀ rempli — un numéro unique par événement, contenu inchangé", async () => {
  // État de production avant la 2a : Tranche 1 + reprise (événements écrits avec now(), heures partagées).
  const db = await nouvelleBase({ t2a: false });
  await db.exec(sqlReprise(planifierReprise(await exporter(db), { uuidDepuis })));
  const { id } = await ouvrir(db, C.nu);
  ok(await majEtape(db, id, "collecte", `statut = 'en_cours', balle = 'client', echeance = '2026-10-20'`));
  const empreinte = `select id, dossier_id, client_id, etape_id, mission_action_id, type, avant, apres, resume, auteur_type,
    auteur_utilisateur_id, auteur_libelle, visible_client, survenu_le from public.invest_dossier_evenements order by id`;
  const avant = await qn(db, empreinte);
  assert.ok(avant.length >= 9);
  assert.ok((await q1(db, `select count(*)::int n from (select survenu_le from public.invest_dossier_evenements group by 1 having count(*) > 1) x`)).n > 0,
    "cas réel : des événements historiques partagent la même heure");
  const insertion = (await qn(db, `select id from public.invest_dossier_evenements order by ctid`)).map((e) => e.id);
  await db.exec(MIGRATION_2A);
  const lignes = await qn(db, `select id, ordre from public.invest_dossier_evenements`);
  assert.equal(lignes.length, avant.length);
  assert.ok(lignes.every((l) => l.ordre !== null), "chaque événement historique reçoit un numéro");
  assert.equal(new Set(lignes.map((l) => String(l.ordre))).size, lignes.length, "numéros uniques");
  assert.deepEqual(lignes.map((l) => Number(l.ordre)).sort((a, b) => a - b), lignes.map((_, i) => i + 1), "1, 2, 3… sans trou");
  assert.deepEqual((await qn(db, `select id from public.invest_dossier_evenements order by ordre`)).map((e) => e.id), insertion,
    "numéros attribués dans l'ordre de stockage (= ordre d'insertion d'un journal jamais modifié)");
  assert.deepEqual(await qn(db, empreinte), avant, "aucun contenu métier modifié");
  // Les nouveaux événements prennent la suite, jamais un numéro déjà utilisé.
  ok(await majEtape(db, id, "collecte", `balle = 'profero'`));
  const dernier = await q1(db, `select ordre from public.invest_dossier_evenements order by ordre desc limit 1`);
  assert.equal(Number(dernier.ordre), avant.length + 1);
  assert.match((await q1(db, `select pg_get_serial_sequence('public.invest_dossier_evenements', 'ordre') s`)).s, /invest_dossier_evenements_ordre_seq/, "séquence IDENTITY, pas MAX()+1");
  assert.equal((await q1(db, `select attidentity a from pg_attribute where attrelid = 'public.invest_dossier_evenements'::regclass and attname = 'ordre'`)).a, "a", "generated always");
});

test("44. 2a : statut du client — seule l'ouverture explicite d'une mission le modifie", async () => {
  const db = await nouvelleBase();
  const statuts = async () => (await qn(db, `select id, statut from public.invest_clients order by id`)).map((r) => `${r.id}:${r.statut}`);
  const avant = await statuts();
  const { id } = await ouvrir(db, C.prospect);
  const apresOuverture = await statuts();
  assert.deepEqual(apresOuverture.filter((x) => !avant.includes(x)), [`${C.prospect}:Actif`], "ouverture : Prospect → Actif, rien d'autre");
  await db.query(`update public.invest_dossier_etapes set reprise_a_confirmer = true where dossier_id = $1`, [id]);
  for (const [cle, geste, saisie] of [
    ["collecte", "demarrer", { balle: "client" }], ["collecte", "mettre_en_attente", { balle: "client" }],
    ["collecte", "reprendre", { balle: "profero" }], ["collecte", "changer_balle", { balle: "notaire", balle_tiers_libelle: "Étude" }],
    ["collecte", "prochaine_action", { prochaine_action: "Relancer" }], ["collecte", "echeance", { echeance: "2026-12-01" }],
    ["collecte", "bloquer", { balle: "client", motif: "CNI" }], ["collecte", "debloquer", { balle: "profero" }],
    ["collecte", "terminer", {}], ["collecte", "rouvrir", { balle: "profero", motif: "pièce à refaire" }],
    ["collecte", "confirmer_reprise", {}], ["structuration", "non_applicable", { motif: "nom propre" }],
    ["signature", "terminer", {}], ["suivi", "demarrer", { balle: "client" }], ["suivi", "terminer", {}],
  ]) {
    const { patch, erreurs } = TR.preparerGeste(await etape(db, id, cle), geste, saisie, "2026-09-30");
    assert.deepEqual(erreurs, [], `${cle}/${geste}`);
    const sets = Object.entries(patch).map(([k, v]) => `${k} = ${v === null ? "null" : typeof v === "boolean" ? v : `'${String(v).replace(/'/g, "''")}'`}`).join(", ");
    ok(await majEtape(db, id, cle, sets), `${cle}/${geste}`);
    assert.deepEqual(await statuts(), apresOuverture, `${cle}/${geste} ne touche pas au statut client`);
  }
  assert.equal((await etape(db, id, "collecte")).reprise_a_confirmer, false, "la confirmation de reprise a bien eu lieu");
  const t = V.champsNouvelleTache(id, "analyse");
  ok(await collab(db, `insert into public.invest_mission_actions (client_id, dossier_id, etape, step_key, step_label, step_index, action_title)
    values ('${C.prospect}', '${t.dossier_id}', '${t.etape}', '${t.step_key}', '${t.step_label}', ${t.step_index}, 'Préparer l''analyse')`));
  assert.deepEqual(await statuts(), apresOuverture, "création de tâche");
  ok(await collab(db, `update public.invest_mission_actions set status = 'fait', completed_at = now() where client_id = '${C.prospect}'`));
  assert.deepEqual(await statuts(), apresOuverture, "achèvement de tâches");
  // Un client déjà « Terminé » : ouvrir une mission ne change pas son statut (seul « Prospect » est activé).
  const avantT = await statuts();
  ok(await ouvrir(db, C.termine));
  assert.deepEqual(await statuts(), avantT);
});


// ═══════════════════════════════════════════════════════════════════════════
// 10. Tranche 2c — Foyer & situation patrimoniale
// ═══════════════════════════════════════════════════════════════════════════
const ins = (db, table, obj, email = COLLAB) => sous(db, "authenticated", email,
  `insert into public.${table} (${Object.keys(obj).join(", ")}) values (${Object.keys(obj).map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
  Object.values(obj).map((v) => (v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : Array.isArray(v) && v.length && typeof v[0] === "object" ? JSON.stringify(v) : v)));
const majSP = (db, table, id, set, email = COLLAB) => sous(db, "authenticated", email, `update public.${table} set ${set} where id = '${id}' returning *`);
const baseSP = async () => { const db = await nouvelleBase(); const { id } = await ouvrir(db, C.nu); return { db, dossier: id }; };

test("45. 2c foyer : un principal et un conjoint actifs au plus, plusieurs enfants, archivage, aucune personne déduite du nom", async () => {
  const { db } = await baseSP();
  assert.equal((await q1(db, `select count(*)::int n from public.invest_personnes`)).n, 0, "ouvrir un dossier ne crée aucune personne");
  const p1 = await ins(db, "invest_personnes", { client_id: C.nu, lien: "principal", prenom: "Nina", nom: "Nu" }); ok(p1);
  refuse(await ins(db, "invest_personnes", { client_id: C.nu, lien: "principal", prenom: "Autre" }), /invest_personnes_un_principal|unique|duplicate/i);
  ok(await ins(db, "invest_personnes", { client_id: C.nu, lien: "conjoint", prenom: "Paul" }));
  refuse(await ins(db, "invest_personnes", { client_id: C.nu, lien: "conjoint", prenom: "Pierre" }), /un_conjoint|unique|duplicate/i);
  for (const prenom of ["Léo", "Léa", "Lou"]) ok(await ins(db, "invest_personnes", { client_id: C.nu, lien: "enfant", prenom, a_charge: true }));
  refuse(await ins(db, "invest_personnes", { client_id: C.nu, lien: "autre" }), /invest_personnes_identite/);
  ok(await majSP(db, "invest_personnes", p1.rows[0].id, `archive_le = now()`));
  ok(await ins(db, "invest_personnes", { client_id: C.nu, lien: "principal", prenom: "Nina", nom: "Nouvelle" }), "archivé : un nouveau principal est possible");
  refuse(await majSP(db, "invest_personnes", p1.rows[0].id, `profession = 'x'`), /archivée ne se modifie plus/);
  assert.equal((await q1(db, `select count(*)::int n from public.invest_personnes where client_id = $1 and lien = 'enfant'`, [C.nu])).n, 3);
  // Préremplissage : jamais de découpage d'un nom de foyer.
  const foyer = SP.personnePrincipaleProposee({ nom: "TOM ET CAMILLE", email: "tc@test.fr", telephone: "06" });
  assert.deepEqual([foyer.prenom, foyer.nom, foyer.email], ["", "", "tc@test.fr"]); assert.match(foyer.avertissement, /désigne un foyer/);
  assert.deepEqual([SP.personnePrincipaleProposee({ prenom: "LEO et LEA", nom: "MARTIN" }).prenom, SP.personnePrincipaleProposee({ prenom: "Nina", nom: "Nu" }).prenom], ["", "Nina"]);
  assert.equal(SP.personnePrincipaleProposee({ nom: "Dupont & Durand" }).nom, "");
});

test("46. 2c revenus, charges, épargne : périodicité des flux, stocks sans périodicité, base du revenu, cohérence des catégories", async () => {
  const { db } = await baseSP();
  const nina = (await ins(db, "invest_personnes", { client_id: C.nu, lien: "principal", prenom: "Nina" })).rows[0].id;
  ok(await ins(db, "invest_postes_financiers", { client_id: C.nu, personne_id: nina, famille: "revenu", categorie: "salaire", montant: 3000, periodicite: "mensuelle", base_revenu: "net_avant_impot" }));
  ok(await ins(db, "invest_postes_financiers", { client_id: C.nu, famille: "revenu", categorie: "dividendes", montant: 12000, periodicite: "annuelle", base_revenu: "non_precisee" }), "revenu historique : base non précisée");
  ok(await ins(db, "invest_postes_financiers", { client_id: C.nu, famille: "actif_financier", categorie: "assurance_vie", montant: 50000, date_valeur: "2026-06-30" }), "stock sans périodicité");
  refuse(await ins(db, "invest_postes_financiers", { client_id: C.nu, famille: "actif_financier", categorie: "pea", montant: 1, periodicite: "mensuelle" }), /invest_postes_periodicite/);
  refuse(await ins(db, "invest_postes_financiers", { client_id: C.nu, famille: "charge", categorie: "impot", montant: 100 }), /invest_postes_periodicite/);
  refuse(await ins(db, "invest_postes_financiers", { client_id: C.nu, famille: "revenu", categorie: "salaire", montant: 1, periodicite: "mensuelle" }), /invest_postes_base/);
  refuse(await ins(db, "invest_postes_financiers", { client_id: C.nu, famille: "charge", categorie: "salaire", montant: 1, periodicite: "mensuelle" }), /invest_postes_categorie/);
  await ouvrir(db, C.prospect);
  const autre = (await ins(db, "invest_personnes", { client_id: C.prospect, lien: "principal", prenom: "Paul" })).rows[0].id;
  refuse(await ins(db, "invest_postes_financiers", { client_id: C.nu, personne_id: autre, famille: "charge", categorie: "impot", montant: 1, periodicite: "annuelle" }), /autre foyer/);
});

test("47. 2c crédits, patrimoine, structures : CRD daté, crédit lié à un bien, bien détenu via une SCI, associés incomplets acceptés", async () => {
  const { db } = await baseSP();
  const nina = (await ins(db, "invest_personnes", { client_id: C.nu, lien: "principal", prenom: "Nina" })).rows[0].id;
  const sci = await ins(db, "invest_structures", { client_id: C.nu, type: "sci", denomination: "SCI Nu", regime_fiscal: "ir", associes: [{ personne_id: nina, pourcentage: 60, role: "gérante" }] });
  ok(sci, "associés à 60 % : accepté"); assert.deepEqual(SP.avertissements("invest_structures", sci.rows[0]), ["Associés : 60 % renseignés sur 100 %."]);
  refuse(await ins(db, "invest_actifs_patrimoniaux", { client_id: C.nu, usage: "locatif", mode_detention: "structure" }), /invest_actifs_structure/);
  const bien = await ins(db, "invest_actifs_patrimoniaux", { client_id: C.nu, usage: "locatif", typologie: "appartement", mode_detention: "structure",
    structure_id: sci.rows[0].id, valeur_estimee: 200000, date_valeur: "2026-09-01", loyer_mensuel: 800 });
  ok(bien);
  const credit = await ins(db, "invest_engagements", { client_id: C.nu, type: "credit_immobilier", preteur_beneficiaire: "Banque A", mensualite: 900,
    assurance_mensuelle: 30, capital_restant_du: 120000, crd_date: "2026-09-01", taux: 1.5, type_taux: "fixe", personne_id: nina, asset_id: bien.rows[0].id });
  ok(credit); assert.equal(credit.rows[0].asset_id, bien.rows[0].id);
  assert.deepEqual(SP.avertissements("invest_engagements", { ...credit.rows[0], crd_date: null }), ["Date du capital restant dû manquante."]);
  await ouvrir(db, C.prospect);
  const autre = (await ins(db, "invest_personnes", { client_id: C.prospect, lien: "principal", prenom: "Paul" })).rows[0].id;
  refuse(await ins(db, "invest_engagements", { client_id: C.nu, type: "pret_personnel", co_emprunteurs: `{${autre}}` }), /autre foyer/);
  refuse(await ins(db, "invest_structures", { client_id: C.nu, type: "sci", denomination: "X", associes: [{ personne_id: autre, pourcentage: 100 }] }), /autre foyer/);
  refuse(await ins(db, "invest_structures", { client_id: C.nu, type: "sci", denomination: "X", siren: "123" }), /siren/);
  // Patrimoine détenu ≠ biens recherchés : aucune ligne invest_biens créée, lien facultatif possible.
  assert.equal((await q1(db, `select count(*)::int n from public.invest_biens`)).n, 1);
  ok(await ins(db, "invest_actifs_patrimoniaux", { client_id: C.nu, usage: "residence_principale", bien_id: "40000000-0000-0000-0000-000000000001" }));
  assert.equal((await q1(db, `select count(*)::int n from public.invest_biens`)).n, 1);
});

test("48. 2c vérification : collaborateur seulement, modifier une donnée vérifiée la repasse non vérifiée, « à corriger » motivé", async () => {
  const { db } = await baseSP();
  const r = (await ins(db, "invest_postes_financiers", { client_id: C.nu, famille: "charge", categorie: "impot", montant: 1200, periodicite: "annuelle" })).rows[0];
  assert.equal(r.verification_statut, "non_verifiee"); assert.equal(r.cree_par_id, U.matthieu); assert.equal(r.source, "profero");
  const v = await majSP(db, "invest_postes_financiers", r.id, `verification_statut = 'verifiee'`); ok(v);
  assert.equal(v.rows[0].verifie_par_id, U.matthieu); assert.ok(v.rows[0].verifie_le);
  const m = await majSP(db, "invest_postes_financiers", r.id, `montant = 1300`); ok(m);
  assert.equal(m.rows[0].verification_statut, "non_verifiee", "donnée métier modifiée : à revérifier"); assert.equal(m.rows[0].verifie_par_id, null);
  ok(await majSP(db, "invest_postes_financiers", r.id, `verification_statut = 'verifiee'`));
  const c = await majSP(db, "invest_postes_financiers", r.id, `verification_commentaire = 'vu avec le client'`); ok(c);
  assert.equal(c.rows[0].verification_statut, "verifiee", "un champ technique ne dévérifie pas");
  refuse(await majSP(db, "invest_postes_financiers", r.id, `verification_statut = 'a_corriger', verification_commentaire = null`), /à corriger/);
  ok(await majSP(db, "invest_postes_financiers", r.id, `verification_statut = 'a_corriger', verification_commentaire = 'Montant 2025 ?'`));
  refuse(await sous(db, "service_role", null, `update public.invest_postes_financiers set verification_statut = 'verifiee' where id = '${r.id}'`), /Seul un collaborateur/);
  refuse(await sous(db, "authenticated", COLLAB, `delete from public.invest_postes_financiers where id = '${r.id}'`), /permission|42501/);
  refuse(await sous(db, "anon", null, `select * from public.invest_personnes`), /permission|42501/);
});

test("49. 2c journal : ajout, modification (champs), archivage, vérification — dans le dossier en cours, pas pour un champ technique", async () => {
  const { db, dossier } = await baseSP();
  const r = (await ins(db, "invest_personnes", { client_id: C.nu, lien: "principal", prenom: "Nina", nom: "Nu" })).rows[0];
  assert.equal(r.dossier_id, dossier, "contexte de collecte : le dossier en cours");
  ok(await majSP(db, "invest_personnes", r.id, `profession = 'Ingénieure', employeur = 'X'`));
  ok(await majSP(db, "invest_personnes", r.id, `verification_statut = 'verifiee'`));
  ok(await majSP(db, "invest_personnes", r.id, `verification_commentaire = 'ok'`));
  ok(await majSP(db, "invest_personnes", r.id, `archive_le = now()`));
  const ev = (await qn(db, `select type, resume from public.invest_dossier_evenements where dossier_id = $1 and type like 'collecte_%' order by ordre`, [dossier]));
  assert.deepEqual(ev.map((e) => e.type), ["collecte_ajout", "collecte_modification", "collecte_verification", "collecte_modification"]);
  assert.equal(ev[0].resume, "Situation patrimoniale — ajout : Foyer : Nina Nu (principal).");
  assert.equal(ev[1].resume, "Situation patrimoniale — modification : Foyer : Nina Nu (principal) (employeur, profession).");
  assert.equal(ev[2].resume, "Situation patrimoniale — vérification : Foyer : Nina Nu (principal) → vérifiée.");
  assert.equal(ev[3].resume, "Situation patrimoniale — archivage : Foyer : Nina Nu (principal).");
  assert.equal((await q1(db, `select auteur_libelle a from public.invest_dossier_evenements where dossier_id = $1 and type = 'collecte_ajout'`, [dossier])).a, "Matthieu");
});

test("50. 2c dossier clos : collecte lisible mais non modifiable ; pas de collecte sans dossier ; maintenance (reprise) possible", async () => {
  const { db, dossier } = await baseSP();
  const r = (await ins(db, "invest_personnes", { client_id: C.nu, lien: "principal", prenom: "Nina" })).rows[0];
  ok(await collab(db, `update public.invest_dossiers set statut = 'clos', motif_cloture = 'Fin' where id = '${dossier}'`));
  refuse(await majSP(db, "invest_personnes", r.id, `profession = 'x'`), /Dossier Invest en cours/);
  refuse(await ins(db, "invest_personnes", { client_id: C.nu, lien: "enfant", prenom: "Léo" }), /Dossier Invest en cours/);
  const lu = await sous(db, "authenticated", COLLAB, `select prenom from public.invest_personnes where client_id = '${C.nu}'`);
  ok(lu); assert.equal(lu.rows[0].prenom, "Nina", "lecture conservée");
  refuse(await ins(db, "invest_personnes", { client_id: C.vide, lien: "principal", prenom: "Victor" }), /Dossier Invest en cours/);
  // Nouveau dossier : la même donnée du foyer redevient modifiable, journalisée dans CE dossier.
  const nouveau = await ouvrir(db, C.nu); ok(nouveau);
  const m = await majSP(db, "invest_personnes", r.id, `profession = 'Architecte'`); ok(m);
  assert.equal(m.rows[0].dossier_id, nouveau.id);
  assert.equal((await q1(db, `select count(*)::int n from public.invest_dossier_evenements where dossier_id = $1 and type = 'collecte_modification'`, [nouveau.id])).n, 1);
  await db.query(`insert into public.invest_personnes (client_id, lien, prenom, source) values ($1, 'enfant', 'Reprise', 'reprise')`, [C.vide]);
  assert.equal((await q1(db, `select source from public.invest_personnes where client_id = $1`, [C.vide])).source, "reprise");
});

test("51. 2c calculs : flux mensualisés, stocks, crédits, immobilier, patrimoine net, trous signalés", () => {
  const c = SP.calculerSituation({
    postes: [
      { famille: "revenu", categorie: "salaire", montant: 3000, periodicite: "mensuelle", base_revenu: "net_avant_impot" },
      { famille: "revenu", categorie: "dividendes", montant: 12000, periodicite: "annuelle", base_revenu: "non_precisee" },
      { famille: "revenu", categorie: "salaire", montant: 9999, periodicite: "mensuelle", base_revenu: "net_avant_impot", archive_le: "2026-01-01" },
      { famille: "charge", categorie: "impot", montant: 2400, periodicite: "annuelle" },
      { famille: "actif_financier", categorie: "epargne_disponible", montant: 15000 },
      { famille: "actif_financier", categorie: "assurance_vie", montant: 50000 },
    ],
    engagements: [
      { type: "credit_immobilier", mensualite: 900, assurance_mensuelle: 30, capital_restant_du: 120000 },
      { type: "credit_consommation", mensualite: 200, capital_restant_du: 5000 },
      { type: "credit_immobilier", mensualite: 500, capital_restant_du: 1, solde: true },
      { type: "pension_versee", mensualite: 300 },
      { type: "caution", montant_garanti: 50000 },
      { type: "pret_personnel", mensualite: null, capital_restant_du: null },
    ],
    actifsImmo: [{ statut: "detenu", valeur_estimee: 200000 }, { statut: "vendu", valeur_estimee: 999999 }, { statut: "detenu", valeur_estimee: null }],
  });
  assert.equal(c.revenusMensuels, 4000); assert.deepEqual(c.revenusParBase, { net_avant_impot: 3000, net_apres_impot: 0, non_precisee: 1000 });
  assert.equal(c.chargesMensuelles, 500, "200 d'impôt mensualisé + 300 de pension versée");
  assert.equal(c.mensualitesCredits, 1100); assert.equal(c.assuranceCredits, 30);
  assert.equal(c.epargneDisponible, 15000); assert.equal(c.actifsFinanciers, 65000);
  assert.equal(c.valeurImmobiliereBrute, 200000); assert.equal(c.detteImmobiliereRestante, 120000); assert.equal(c.patrimoineImmobilierNet, 80000);
  assert.equal(c.patrimoineNetSimplifie, 65000 + 200000 - 125000, "caution hors bilan exclue, crédit soldé exclu");
  assert.deepEqual(c.incomplets, { actifsSansValeur: 1, creditsSansCrd: 1, creditsSansMensualite: 1, revenusBaseNonPrecisee: 1 });
  assert.equal(SP.mensualiser(1200, "annuelle"), 100); assert.equal(SP.mensualiser(1200, null), null, "un stock ne se mensualise pas");
});

test("52. 2c migration : additive, rejouable, sans reprise ; retour arrière sans toucher T1/2a ni le journal ; écran sans confusion avec invest_biens", async () => {
  const code = MIGRATION_2C.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  const horsCorps = code.replace(/\$\$[\s\S]*?\$\$/g, "$$…$$").replace(/\$f\$[\s\S]*?\$f\$/g, "").replace(/\$p\$[\s\S]*?\$p\$/g, "");
  assert.ok(!/\bupdate\s+(public\.)?\w+\s+set\b|\bdelete\s+from\b|\binsert\s+into\b|\btruncate\b/i.test(horsCorps), "aucun DML, aucune reprise");
  assert.ok(!/invest_structuration_patrimoniale|invest_foyers/.test(code), "ancienne structuration intacte, pas de table foyer");
  const altered = [...code.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]).filter((t) => t !== "%1$I");
  assert.deepEqual([...new Set(altered)], ["invest_dossier_evenements"], "seule table existante touchée : la liste des types du journal");
  const db = await nouvelleBase();
  const { id } = await ouvrir(db, C.nu);
  ok(await ins(db, "invest_personnes", { client_id: C.nu, lien: "principal", prenom: "Nina" }));
  await db.exec(MIGRATION_2C); // rejouable
  await db.exec(MIGRATION_2D);
  assert.equal((await q1(db, `select count(*)::int n from public.invest_personnes`)).n, 1);
  await db.exec(ROLLBACK_2D);
  await db.exec(ROLLBACK_2C);
  assert.equal((await q1(db, `select to_regclass('public.invest_personnes') t`)).t, null);
  assert.equal((await etapes(db, id)).length, 11, "dossier et étapes intacts");
  assert.equal((await q1(db, `select count(*)::int n from public.invest_dossier_evenements where type = 'collecte_ajout'`)).n, 1, "journal conservé");
  ok(await majEtape(db, id, "collecte", `statut = 'en_cours', balle = 'client'`), "2a toujours active");
  // Écran : patrimoine détenu ≠ biens recherchés ; pas de suppression ; jamais invest_clients.
  assert.ok(!/invest_biens/.test(CARTE_SP) && !/from\("invest_clients"\)/.test(CARTE_SP) && !/\.delete\(/.test(CARTE_SP));
  assert.equal((CARTE_SP.match(/table: "invest_[a-z_]+"/g) || []).length >= 0, true);
  assert.deepEqual(SP.SECTIONS.map((s) => s.libelle), ["Foyer", "Revenus, charges & épargne", "Crédits & engagements", "Patrimoine immobilier", "Structures"]);
  assert.match(CARTE_SP, /Valeur détenue/); assert.match(CARTE_SP, /mobiliser comme apport ne se saisit pas ici/);
  assert.match(CRM, /<SituationPatrimonialeCard client=\{client\}/);
  // Référence : celle du dossier EN COURS, jamais celle d'un ancien dossier consulté.
  assert.match(CRM, /dossierReference=\{dossierInfo\?\.referenceEnCours \|\| null\}/);
  assert.match(CARTE, /referenceEnCours: dossierEnCours\?\.reference \?\? null/);
  assert.match(CARTE_SP, /Modifications rattachées à/);
  assert.match(CARTE_SP, /Patrimoine net simplifié \(biens à 100 %\)/);
  assert.match(CARTE_SP, /PAS la part patrimoniale personnelle exacte/);
});


// ═══════════════════════════════════════════════════════════════════════════
// 11. Tranche 2d — Projet & situation (questionnaire du dossier)
// ═══════════════════════════════════════════════════════════════════════════
const qsEnreg = (db, dossier, reponses, email = COLLAB, role = "authenticated") => sous(db, role, email,
  `select public.invest_questionnaire_enregistrer($1, $2::jsonb, $3) as r`, [dossier, JSON.stringify(reponses), QS.QUESTIONNAIRE_VERSION]);
const qsVerif = (db, dossier, cles, statut, commentaire = null, email = COLLAB, role = "authenticated") => sous(db, role, email,
  `select public.invest_questionnaire_verifier($1, $2::text[], $3, $4) as r`, [dossier, `{${cles.join(",")}}`, statut, commentaire]);
const qsStatut = (db, dossier, statut, email = COLLAB, role = "authenticated") => sous(db, role, email,
  `select public.invest_questionnaire_statut($1, $2) as r`, [dossier, statut]);
const qsLire = (db, dossier) => q1(db, `select * from public.invest_dossiers where id = $1`, [dossier]);
const qsEv = (db, dossier) => qn(db, `select type, resume from public.invest_dossier_evenements where dossier_id = $1 and type like 'questionnaire_%' order by ordre`, [dossier]);

test("53. 2d catalogue : version, clés, sections identiques en base, aucune valeur par défaut ni reprise", async () => {
  assert.equal(QS.QUESTIONNAIRE_VERSION, 1);
  const cles = QS.QUESTIONS.map((q) => q.cle);
  assert.equal(new Set(cles).size, cles.length, "clés uniques");
  assert.ok(cles.every((k) => /^[a-z]+__[a-z0-9_]+$/.test(k)), "format accepté par la base");
  assert.deepEqual(QS.SECTIONS_QUESTIONNAIRE.map((s) => s.lettre).join(""), "ABCDEFG");
  const db = await nouvelleBase();
  for (const s of QS.SECTIONS_QUESTIONNAIRE) assert.equal((await q1(db, `select public.invest_questionnaire_section($1) l`, [s.cle])).l, s.libelle);
  assert.ok(QS.QUESTIONS.every((q) => !("defaut" in q) && !("valeurParDefaut" in q)), "aucune valeur par défaut");
  const { id } = await ouvrir(db, C.louison);
  const d = await qsLire(db, id);
  assert.deepEqual(d.questionnaire_data, {}, "questionnaire vide à l'ouverture : jamais « France », « 15 ans »…");
  assert.equal(d.questionnaire_statut, "brouillon");
  assert.ok(!/strategie_data|structuration_patrimoniale|invest_clients/.test(CATALOGUE_QS + CARTE_QS), "aucune lecture des anciennes données");
  assert.equal((await q1(db, `select strategie_data s from public.invest_clients where id = $1`, [C.louison])).s.objectif, "patrimoine", "strategie_data intact");
});

test("54. 2d conditions : mariage, international, transmission ; une réponse masquée est conservée", () => {
  const rep = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { valeur: v }]));
  const foyer = QS.SECTIONS_QUESTIONNAIRE.find((s) => s.cle === "foyer");
  const vis = (s, r) => QS.questionsVisibles(QS.SECTIONS_QUESTIONNAIRE.find((x) => x.cle === s), r).map((q) => q.cle);
  assert.ok(!vis("foyer", {}).includes("foyer__regime_matrimonial"));
  assert.ok(vis("foyer", rep({ foyer__situation_familiale: "marie" })).includes("foyer__regime_matrimonial"));
  assert.ok(vis("foyer", rep({ foyer__situation_familiale: "pacse" })).includes("foyer__regime_pacs"));
  assert.deepEqual(vis("international", {}), ["international__concerne"], "international : une seule question tant que non concerné");
  assert.ok(vis("international", rep({ international__concerne: "oui" })).length >= 7);
  assert.ok(!vis("detention", {}).includes("detention__objectifs_successoraux"));
  assert.ok(vis("detention", rep({ objectifs__objectif_principal: "transmission" })).includes("detention__objectifs_successoraux"));
  assert.ok(vis("detention", rep({ objectifs__objectifs_secondaires: ["transmission"] })).includes("detention__objectifs_successoraux"));
  assert.ok(!vis("banque", {}).includes("banque__financement_detail"));
  // Masquée ≠ supprimée ; la progression ne compte que ce qui est affiché.
  const r = rep({ foyer__situation_familiale: "celibataire", foyer__regime_matrimonial: "separation_biens" });
  const p = QS.progression(r);
  assert.equal(p.masqueesConservees, 1);
  assert.equal(p.sections.find((x) => x.cle === "foyer").repondues, 1);
  assert.equal(QS.progression({}).pourcentage, 0);
  assert.ok(foyer.questions.length > 5);
});

test("55. 2d réponses : provenance, dates et auteur posés par la base ; métadonnées envoyées ignorées ; fusion sans écrasement", async () => {
  const db = await nouvelleBase(); const { id } = await ouvrir(db, C.nu);
  ok(await qsEnreg(db, id, { fiscalite__residence_foyer: { valeur: "mixte" }, fiscalite__pays: { valeur: "France, Suisse", source: "client" } }));
  ok(await qsEnreg(db, id, { objectifs__budget: { valeur: 300000, verification: "verifiee", verifie_par_id: U.camille, saisi_par_id: U.camille } }));
  const d = (await qsLire(db, id)).questionnaire_data;
  assert.deepEqual(Object.keys(d).sort(), ["fiscalite__pays", "fiscalite__residence_foyer", "objectifs__budget"], "fusion : rien d'écrasé");
  assert.equal(d.fiscalite__residence_foyer.source, "profero"); assert.equal(d.fiscalite__pays.source, "client");
  assert.equal(d.objectifs__budget.saisi_par_id, U.matthieu, "auteur = session, pas la valeur envoyée");
  assert.equal(d.objectifs__budget.verification, "non_verifiee", "une réponse ne s'auto-vérifie pas");
  assert.equal(d.objectifs__budget.verifie_par_id, null);
  assert.ok(d.objectifs__budget.saisi_le && d.objectifs__budget.modifie_le);
  refuse(await qsEnreg(db, id, { "fiscalite.tmi": { valeur: "30" } }), /Question inconnue/);
  assert.equal((await qsLire(db, id)).questionnaire_version, 1);
  // L'écran n'envoie que les valeurs changées.
  assert.deepEqual(QS.reponsesModifiees(d, { fiscalite__residence_foyer: "mixte", objectifs__budget: 350000 }), { objectifs__budget: { valeur: 350000, source: "profero" } });
  assert.throws(() => QS.reponsesModifiees(d, { inconnue__x: 1 }), /Question inconnue/);
});

test("56. 2d vérification : par réponse, collaborateur seulement ; modifier une réponse vérifiée la repasse non vérifiée", async () => {
  const db = await nouvelleBase(); const { id } = await ouvrir(db, C.nu);
  ok(await qsEnreg(db, id, { fiscalite__tmi: { valeur: "30" }, fiscalite__ifi: { valeur: "non" } }));
  ok(await qsVerif(db, id, ["fiscalite__tmi", "fiscalite__ifi"], "verifiee"));
  let d = (await qsLire(db, id)).questionnaire_data;
  assert.equal(d.fiscalite__tmi.verification, "verifiee"); assert.equal(d.fiscalite__tmi.verifie_par_id, U.matthieu); assert.ok(d.fiscalite__tmi.verifie_le);
  ok(await qsEnreg(db, id, { fiscalite__tmi: { valeur: "41" } }));
  d = (await qsLire(db, id)).questionnaire_data;
  assert.equal(d.fiscalite__tmi.verification, "non_verifiee"); assert.equal(d.fiscalite__tmi.verifie_par_id, null);
  assert.equal(d.fiscalite__ifi.verification, "verifiee", "les autres réponses gardent leur vérification");
  refuse(await qsVerif(db, id, ["fiscalite__ifi"], "a_corriger", null), /à corriger/);
  ok(await qsVerif(db, id, ["fiscalite__ifi"], "a_corriger", "Montant IFI à confirmer"));
  refuse(await qsVerif(db, id, ["fiscalite__tmi"], "verifiee", null, null, "service_role"), /Seul un collaborateur/);
  refuse(await qsVerif(db, id, ["fiscalite__tmi"], "verifiee", null, HORS_INVEST), /introuvable ou non modifiable/);
});

test("57. 2d cycle : soumission, validation (collaborateur, sans réponse à corriger), correction après validation → à vérifier", async () => {
  const db = await nouvelleBase(); const { id } = await ouvrir(db, C.nu);
  ok(await qsEnreg(db, id, { objectifs__objectif_principal: { valeur: "rendement" }, objectifs__horizon: { valeur: "10_15" } }));
  ok(await qsStatut(db, id, "soumis"));
  let d = await qsLire(db, id); assert.equal(d.questionnaire_statut, "soumis"); assert.ok(d.questionnaire_soumis_le);
  ok(await qsVerif(db, id, ["objectifs__horizon"], "a_corriger", "Horizon à préciser"));
  refuse(await qsStatut(db, id, "valide"), /à corriger : validation impossible/);
  ok(await qsVerif(db, id, ["objectifs__horizon"], "verifiee"));
  refuse(await qsStatut(db, id, "valide", null, "service_role"), /Seul un collaborateur/);
  ok(await qsStatut(db, id, "valide"));
  d = await qsLire(db, id); assert.equal(d.questionnaire_statut, "valide"); assert.equal(d.questionnaire_valide_par_id, U.matthieu); assert.ok(d.questionnaire_valide_le);
  ok(await qsEnreg(db, id, { objectifs__horizon: { valeur: "plus_15" } }), "la validation n'empêche pas une correction");
  d = await qsLire(db, id);
  assert.equal(d.questionnaire_statut, "a_verifier"); assert.equal(d.questionnaire_valide_par_id, U.matthieu, "historique de validation conservé");
  const ev = await qsEv(db, id);
  assert.ok(ev.some((e) => e.type === "questionnaire_soumis" && e.resume === "Projet & situation : questionnaire soumis."));
  assert.ok(ev.some((e) => e.type === "questionnaire_valide" && e.resume === "Projet & situation : questionnaire validé."));
  assert.equal(ev[ev.length - 1].resume, "Projet & situation : section Objectifs d'investissement mise à jour (1 réponse). 1 réponse vérifiée à revérifier. Questionnaire validé : à revérifier.");
});

test("58. 2d dossier clos : Projet & situation en lecture seule", async () => {
  const db = await nouvelleBase(); const { id } = await ouvrir(db, C.nu);
  ok(await qsEnreg(db, id, { banque__principale: { valeur: "Banque A" } }));
  ok(await collab(db, `update public.invest_dossiers set statut = 'clos', motif_cloture = 'Fin' where id = '${id}'`));
  refuse(await qsEnreg(db, id, { banque__principale: { valeur: "Banque B" } }), /lecture seule/);
  refuse(await qsStatut(db, id, "soumis"), /lecture seule/);
  const lu = await sous(db, "authenticated", COLLAB, `select questionnaire_data from public.invest_dossiers where id = '${id}'`);
  ok(lu); assert.equal(lu.rows[0].questionnaire_data.banque__principale.valeur, "Banque A");
});

test("59. 2d journal : un événement par enregistrement, lisible par section, jamais de clé technique", async () => {
  const db = await nouvelleBase(); const { id } = await ouvrir(db, C.nu);
  ok(await qsEnreg(db, id, { fiscalite__tmi: { valeur: "30" }, fiscalite__impot_revenu: { valeur: 8000 } }));
  ok(await qsEnreg(db, id, { fiscalite__ifi: { valeur: "non" }, objectifs__zones: { valeur: "Nantes" } }));
  ok(await qsVerif(db, id, ["fiscalite__tmi", "fiscalite__ifi"], "verifiee"));
  const ev = await qsEv(db, id);
  assert.deepEqual(ev.map((e) => e.resume), [
    "Projet & situation : section Fiscalité mise à jour (2 réponses).",
    "Projet & situation : sections Fiscalité, Objectifs d'investissement mises à jour (2 réponses).",
    "Projet & situation : 2 réponses vérifiées (Fiscalité).",
  ]);
  assert.ok(ev.every((e) => !/__|questionnaire_data/.test(e.resume)));
  assert.equal((await q1(db, `select count(*)::int n from public.invest_dossier_evenements where dossier_id = $1 and type = 'dossier_modifie'`, [id])).n, 0, "pas d'événement « dossier modifié » en double");
});

test("60. 2d apport souhaité ≠ épargne détenue ; aucune capacité d'emprunt ; international déclaratif", async () => {
  const db = await nouvelleBase(); const { id } = await ouvrir(db, C.nu);
  ok(await ins(db, "invest_postes_financiers", { client_id: C.nu, famille: "actif_financier", categorie: "epargne_disponible", montant: 50000 }));
  ok(await qsEnreg(db, id, { objectifs__apport_souhaite: { valeur: 20000 }, objectifs__budget: { valeur: 250000 }, international__concerne: { valeur: "oui" }, international__pays: { valeur: "Suisse" } }));
  const r = (await qsLire(db, id)).questionnaire_data;
  assert.deepEqual(QS.syntheseObjectifs(r), { budget: 250000, apport: 20000, zones: null, objectif: null, horizon: null });
  assert.equal(SP.calculerSituation({ postes: await qn(db, `select * from public.invest_postes_financiers`) }).epargneDisponible, 50000, "l'épargne 2c reste 50 000 : aucune confusion");
  assert.ok(!QS.QUESTIONS.some((q) => /capacite|endettement|mensualite_max/.test(q.cle)), "aucune capacité d'emprunt dans le questionnaire");
  assert.ok(!/capaciteEmprunt|tauxEndettement/.test(CATALOGUE_QS + CARTE_QS));
  assert.ok(QS.SECTIONS_QUESTIONNAIRE.find((s) => s.cle === "international").aide.includes("Aucune conclusion fiscale"));
  assert.equal(QS.questionsVisibles(QS.SECTIONS_QUESTIONNAIRE.find((s) => s.cle === "fiscalite"), {}).find((q) => q.cle === "fiscalite__residence_foyer").defaut, undefined, "jamais France par défaut");
});

test("61. suites 2c : perte de vérification dite dans le résumé (un seul événement) ; désarchivage réservé au collaborateur", async () => {
  const db = await nouvelleBase(); const { id } = await ouvrir(db, C.nu);
  const r = (await ins(db, "invest_postes_financiers", { client_id: C.nu, famille: "charge", categorie: "impot", montant: 1200, periodicite: "annuelle" })).rows[0];
  ok(await majSP(db, "invest_postes_financiers", r.id, `verification_statut = 'verifiee'`));
  const avant = (await q1(db, `select count(*)::int n from public.invest_dossier_evenements where dossier_id = $1`, [id])).n;
  ok(await majSP(db, "invest_postes_financiers", r.id, `montant = 1300`));
  const ev = await qn(db, `select type, resume from public.invest_dossier_evenements where dossier_id = $1 order by ordre offset $2`, [id, avant]);
  assert.equal(ev.length, 1, "un seul événement");
  assert.equal(ev[0].resume, "Situation patrimoniale — modification : Charge : impot 1300.00 €/an (montant). Donnée auparavant vérifiée : à revérifier.");
  ok(await majSP(db, "invest_postes_financiers", r.id, `archive_le = now()`));
  refuse(await sous(db, "service_role", null, `update public.invest_postes_financiers set archive_le = null where id = '${r.id}'`), /Seul un collaborateur Profero peut désarchiver/);
  ok(await majSP(db, "invest_postes_financiers", r.id, `archive_le = null`), "collaborateur : désarchivage autorisé");
  assert.ok((await qn(db, `select resume from public.invest_dossier_evenements where dossier_id = $1 and resume like '%désarchivage%'`, [id])).length === 1);
});

test("62. 2d migration : additive, rejouable ; retour arrière rend les fonctions 2c à l'identique", async () => {
  const code = MIGRATION_2D.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  const horsCorps = code.replace(/\$\$[\s\S]*?\$\$/g, "$$…$$");
  assert.ok(!/\bupdate\s+(public\.)?\w+\s+set\b|\bdelete\s+from\b|\binsert\s+into\b|\btruncate\b/i.test(horsCorps), "aucun DML : aucune reprise");
  assert.ok(!/\bdrop\s+(table|column)\b/i.test(code));
  assert.ok(!/strategie_data|invest_structuration_patrimoniale/.test(code));
  const avec2c = await nouvelleBase({ t2d: false });
  const db = await nouvelleBase();
  await db.exec(MIGRATION_2D); // rejouable
  const def = async (b, f) => (await q1(b, `select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1`, [f]))?.d;
  await db.exec(ROLLBACK_2D);
  for (const f of ["invest_collecte_journal", "invest_collecte_regles"]) assert.equal(await def(db, f), await def(avec2c, f), `${f} rendue à la 2c`);
  assert.equal(await def(db, "invest_questionnaire_avant_ecriture"), undefined);
  assert.match(CRM, /<ProjetSituationCard T=\{T\} dossierId=\{dossierInfo\?\.dossierId \|\| null\} dossierEnCoursId=\{dossierInfo\?\.dossierEnCoursId \|\| null\} \/>/);
});


// ═══════════════════════════════════════════════════════════════════════════
// 12. Mini-correctif 2d.1 — intégrité du catalogue
// ═══════════════════════════════════════════════════════════════════════════
test("63. 2d.1 : clés du catalogue en base = catalogue .mjs (généré, versionné) ; clé inconnue refusée ; fusion inchangée", async () => {
  // Synchronisation déterministe : le bloc SQL de la migration est exactement la sortie du générateur.
  assert.ok(MIGRATION_2D1.includes(sqlClesQuestionnaire()), "bloc généré recopié tel quel");
  const db = await nouvelleBase();
  const enBase = (await q1(db, `select public.invest_questionnaire_cles(1) c`)).c;
  assert.deepEqual(enBase, [...QS.QUESTIONS.map((q) => q.cle)].sort(), "même ensemble, même ordre");
  assert.deepEqual([...QS.CLES_PAR_VERSION[1]], enBase);
  assert.equal(enBase.length, 70);
  assert.equal((await q1(db, `select public.invest_questionnaire_cles(2) c`)).c, null, "version inconnue : aucune clé");
  const { id } = await ouvrir(db, C.nu);
  // Toutes les clés V1 reconnues (une sauvegarde de chaque, valeur fictive).
  const tout = Object.fromEntries(QS.QUESTIONS.map((q) => [q.cle, { valeur: q.type === "choix" ? Object.keys(q.options)[0] : q.type === "choix_multiple" ? [Object.keys(q.options)[0]] : q.type === "montant" || q.type === "pourcentage" ? 1 : q.type === "date" ? "2026-01-01" : "Texte RECETTE" }]));
  ok(await qsEnreg(db, id, tout), "les 70 clés V1 acceptées");
  assert.equal(Object.keys((await qsLire(db, id)).questionnaire_data).length, 70);
  const ev = (await q1(db, `select count(*)::int n from public.invest_dossier_evenements where dossier_id = $1`, [id])).n;
  const h = (await q1(db, `select md5(questionnaire_data::text) h from public.invest_dossiers where id = $1`, [id])).h;
  refuse(await qsEnreg(db, id, { inconnue__cle_recette: { valeur: "x" } }), /Question inconnue du catalogue \(version 1\) : inconnue__cle_recette/);
  refuse(await qsEnreg(db, id, { "fiscalite.tmi": { valeur: "30" } }), /Question inconnue : fiscalite\.tmi/, "clé mal formée toujours refusée");
  refuse(await sous(db, "authenticated", COLLAB, `select public.invest_questionnaire_enregistrer($1, '{"fiscalite__tmi":{"valeur":"41"}}'::jsonb, 2)`, [id]), /Version de questionnaire inconnue : 2/);
  assert.equal((await q1(db, `select md5(questionnaire_data::text) h from public.invest_dossiers where id = $1`, [id])).h, h, "rien d'écrit");
  assert.equal((await q1(db, `select count(*)::int n from public.invest_dossier_evenements where dossier_id = $1`, [id])).n, ev, "aucun événement parasite");
  // Clé connue acceptée, sauvegarde partielle : fusion inchangée.
  ok(await qsEnreg(db, id, { fiscalite__tmi: { valeur: "41" } }));
  const d = (await qsLire(db, id)).questionnaire_data;
  assert.equal(d.fiscalite__tmi.valeur, "41"); assert.equal(Object.keys(d).length, 70);
  // Une réponse déjà stockée n'est pas re-contrôlée tant qu'elle ne change pas (compatibilité des réponses existantes).
  // Même la maintenance ne peut plus écrire une clé hors catalogue ; on simule une réponse historique déclencheur coupé.
  await assert.rejects(db.query(`update public.invest_dossiers set questionnaire_data = questionnaire_data || '{"ancienne__cle":{"valeur":"x"}}'::jsonb where id = $1`, [id]), /Question inconnue du catalogue/);
  await db.exec(`alter table public.invest_dossiers disable trigger invest_questionnaire_avant_ecriture;
    update public.invest_dossiers set questionnaire_data = questionnaire_data || '{"ancienne__cle":{"valeur":"historique"}}'::jsonb where id = '${id}';
    alter table public.invest_dossiers enable trigger invest_questionnaire_avant_ecriture;`);
  ok(await qsEnreg(db, id, { banque__principale: { valeur: "Banque RECETTE" } }), "une clé historique déjà présente ne bloque pas les autres sauvegardes");
  refuse(await qsEnreg(db, id, { ancienne__cle: { valeur: "modifiée" } }), /Question inconnue du catalogue/);
  // Retour arrière : texte 2d exact.
  const ref = await nouvelleBase({ t2d1: false });
  await db.exec(ROLLBACK_2D1);
  const def = async (b, f) => (await q1(b, `select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1`, [f]))?.d;
  assert.equal(await def(db, "invest_questionnaire_avant_ecriture"), await def(ref, "invest_questionnaire_avant_ecriture"));
  assert.equal(await def(db, "invest_questionnaire_cles"), undefined);
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
