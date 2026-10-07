#!/usr/bin/env node
// Vérifie la migration 20261007120000 (suivi de la mission Offre 2) sur un VRAI PostgreSQL (PGlite).
// Données : exemple issu des tests, données fictives (aucune donnée réelle).
//   node scripts/verif-invest-mission-offre2-suivi.mjs
import assert from "node:assert/strict";
import { ID, J, lire, nouvelleBase, sous, lanceur } from "./lib/banc-invest.mjs";

const MIG = "supabase/migrations/20261007120000_invest_mission_offre2_suivi.sql";
const ROLLBACK = lire("sql/202610_invest_mission_offre2_suivi_rollback.sql");
const base = () => nouvelleBase(["supabase/migrations/20261002120000_invest_dossier_strategies.sql", "supabase/migrations/20261002140000_invest_dossier_acquisitions.sql", MIG]);
const { test, lancer } = lanceur();
const colonnes = async (db, t) => (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='${t}'`)).rows.map((r) => r.column_name);

test("1. deux colonnes facultatives, nulles par défaut : les missions et acquisitions existantes ne changent pas", async () => {
  const db = await base();
  assert.ok((await colonnes(db, "invest_dossiers")).includes("suivi_offre2")); assert.ok((await colonnes(db, "invest_dossier_acquisitions")).includes("suivi"));
  assert.equal((await db.query(`select count(*)::int n from public.invest_dossiers where suivi_offre2 is not null`)).rows[0].n, 0);
});
test("2. objet JSON seulement (un tableau ou un texte est refusé) ; null accepté", async () => {
  const db = await base();
  const maj = (j, v) => sous(db, "authenticated", j, `update public.invest_dossiers set suivi_offre2 = ${v} where id = '${ID.d2}'`);
  assert.equal((await maj(J.admin, `'{"transmission":{"date":"2026-10-05","documents":["Acte"]},"travaux":{"mode":"aucun"}}'::jsonb`)).erreur, null);
  assert.ok((await maj(J.admin, `'[1]'::jsonb`)).erreur); assert.ok((await maj(J.admin, `'"texte"'::jsonb`)).erreur);
  assert.equal((await maj(J.admin, "null")).erreur, null);
  const a = (v) => sous(db, "authenticated", J.admin, `insert into public.invest_dossier_acquisitions (dossier_id, client_id, libelle, suivi) values ('${ID.d2}','${ID.cA}','Bien test', ${v})`);
  assert.equal((await a(`'{"frais":12000,"notaire_vendeur":"Étude fictive"}'::jsonb`)).erreur, null); assert.ok((await a(`'[]'::jsonb`)).erreur);
});
test("3. un collaborateur autorisé écrit dans la nouvelle colonne (politiques inchangées)", async () => {
  const db = await base();
  const r = await sous(db, "authenticated", J.commercial, `update public.invest_dossiers set suivi_offre2 = '{"travaux":{"mode":"externes"}}'::jsonb where id = '${ID.d2}'`);
  assert.equal(r.erreur, null);
  assert.equal((await db.query(`select suivi_offre2->'travaux'->>'mode' m from public.invest_dossiers where id='${ID.d2}'`)).rows[0].m, "externes");
});
test("4. retour arrière : les deux colonnes disparaissent, le reste est intact", async () => {
  const db = await base();
  await db.exec(ROLLBACK);
  assert.ok(!(await colonnes(db, "invest_dossiers")).includes("suivi_offre2")); assert.ok(!(await colonnes(db, "invest_dossier_acquisitions")).includes("suivi"));
  assert.ok((await colonnes(db, "invest_dossiers")).includes("statut"));
  assert.ok((await colonnes(db, "invest_dossier_acquisitions")).includes("conditions_suspensives"));
});
await lancer();
