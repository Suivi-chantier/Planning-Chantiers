#!/usr/bin/env node
// Vérifie la migration 20261002110000 (analyse d'une mission) sur un VRAI PostgreSQL (PGlite).
// Données : exemple issu des tests, données fictives (aucune donnée réelle).
//   npm install --no-save @electric-sql/pglite   (une fois)
//   node scripts/verif-invest-analyse-mission.mjs
import assert from "node:assert/strict";
import { ID, J, lire, nouvelleBase, sous, nouvelleMission, lanceur } from "./lib/banc-invest.mjs";

const MIGRATION = "supabase/migrations/20261002110000_invest_dossier_analyses.sql";
const ROLLBACK = lire("sql/202610_invest_dossier_analyses_rollback.sql");
const base = () => nouvelleBase([MIGRATION]);
const { test, lancer } = lanceur();
const n = async (db, where = "true") => (await db.query(`select count(*)::int n from public.invest_dossier_analyses where ${where}`)).rows[0].n;
const ins = (db, j, champs = "", valeurs = "", dossier = ID.d2) => sous(db, "authenticated", j, `insert into public.invest_dossier_analyses (dossier_id, client_id ${champs}) values ('${dossier}','${ID.cB}' ${valeurs}) returning dossier_id`);

test("1. une analyse par mission : créée par le CRM, jamais deux pour la même mission", async () => {
  const db = await base();
  assert.equal((await ins(db, J.commercial)).erreur, null);
  assert.ok((await ins(db, J.commercial)).erreur, "doublon refusé");
  assert.equal(await n(db), 1);
});
test("2. client_id est toujours celui de la mission (même si on en saisit un autre)", async () => {
  const db = await base(); await ins(db, J.admin);
  assert.equal((await db.query(`select client_id from public.invest_dossier_analyses`)).rows[0].client_id, ID.cA);
  await sous(db, "authenticated", J.admin, `update public.invest_dossier_analyses set client_id='${ID.cB}'`);
  assert.equal((await db.query(`select client_id from public.invest_dossier_analyses`)).rows[0].client_id, ID.cA);
  assert.ok((await ins(db, J.admin, "", "", "99999999-9999-9999-9999-999999999999")).erreur, "mission inconnue refusée");
});
test("3. hypothèses : bornes contrôlées par la base (taux 0-15, durée 5-30, endettement 10-50) ; valeurs non numériques refusées", async () => {
  const db = await base();
  const h = (json) => sous(db, "authenticated", J.admin, `insert into public.invest_dossier_analyses (dossier_id, client_id, hypotheses) values ('${ID.d2}','${ID.cA}', $1::jsonb) on conflict (dossier_id) do update set hypotheses = excluded.hypotheses returning dossier_id`, [JSON.stringify(json)]);
  for (const ok of [{}, { tauxPct: 3.8, dureeAns: 25, endettementMaxPct: 35 }, { tauxPct: 0 }, { tauxPct: 15, dureeAns: 5, endettementMaxPct: 50 }]) assert.equal((await h(ok)).erreur, null, JSON.stringify(ok));
  for (const mauvais of [{ tauxPct: 15.1 }, { tauxPct: -1 }, { dureeAns: 4 }, { dureeAns: 31 }, { endettementMaxPct: 9 }, { endettementMaxPct: 51 }, { tauxPct: "3,8" }, { tauxPct: null }]) assert.ok((await h(mauvais)).erreur, `refusé : ${JSON.stringify(mauvais)}`);
  assert.ok((await sous(db, "authenticated", J.admin, `update public.invest_dossier_analyses set hypotheses='[1,2]'::jsonb`)).erreur, "doit être un objet");
});
test("4. valider exige une conclusion, une date et les chiffres figés ; revenir en brouillon est possible", async () => {
  const db = await base(); await ins(db, J.admin);
  const maj = (set) => sous(db, "authenticated", J.admin, `update public.invest_dossier_analyses set ${set} returning statut`);
  assert.ok((await maj(`statut='validee'`)).erreur, "sans rien");
  assert.ok((await maj(`statut='validee', conclusion='   ', valide_le=now(), chiffres_valides='{}'`)).erreur, "conclusion vide");
  assert.ok((await maj(`statut='validee', conclusion='OK', chiffres_valides='{}'`)).erreur, "sans date");
  assert.ok((await maj(`statut='validee', conclusion='OK', valide_le=now()`)).erreur, "sans chiffres figés");
  assert.equal((await maj(`statut='validee', conclusion='Dossier finançable', valide_le=now(), valide_par='Tom', chiffres_valides='{"revenus":5000}'`)).erreur, null);
  assert.equal((await maj(`statut='brouillon', valide_le=null, valide_par=null, chiffres_valides=null`)).erreur, null);
  assert.ok((await maj(`statut='archivee'`)).erreur, "statut inconnu refusé");
});
test("5. accès : admin et commercial lisent et écrivent ; ouvrier, sans fiche, client, jeton falsifié et anon : rien", async () => {
  const db = await base(); await ins(db, J.admin);
  for (const [nom, j] of [["admin", J.admin], ["commercial", J.commercial]]) {
    assert.equal((await sous(db, "authenticated", j, `select * from public.invest_dossier_analyses`)).rows.length, 1, nom);
    assert.equal((await sous(db, "authenticated", j, `update public.invest_dossier_analyses set conclusion='x' returning dossier_id`)).rows.length, 1, nom);
  }
  for (const [nom, j] of [["ouvrier", J.ouvrier], ["sans fiche", J.libre], ["client", J.client], ["jeton falsifié", J.commercialFalsifie]]) {
    assert.equal((await sous(db, "authenticated", j, `select * from public.invest_dossier_analyses`)).rows.length, 0, `lecture : ${nom}`);
    assert.equal((await sous(db, "authenticated", j, `update public.invest_dossier_analyses set conclusion='piraté' returning dossier_id`)).rows.length, 0, `modification : ${nom}`);
    assert.ok((await ins(db, j, "", "", ID.d2)).erreur, `création : ${nom}`);
  }
  assert.ok((await sous(db, "anon", null, `select * from public.invest_dossier_analyses`)).erreur, "anon");
  assert.equal((await db.query(`select conclusion from public.invest_dossier_analyses`)).rows[0].conclusion, "x", "rien n'a été piraté");
});
test("6. règles du dépôt : restrictive 3a présente, aucun droit anon, fonction interne non appelable", async () => {
  const db = await base();
  const pol = (await db.query(`select policyname, permissive from pg_policies where tablename='invest_dossier_analyses' order by 1`)).rows.map((r) => `${r.policyname}:${r.permissive}`);
  assert.deepEqual(pol, ["invest_dossier_analyses_crm:PERMISSIVE", "profero_collaborateurs_seulement:RESTRICTIVE"]);
  assert.equal((await db.query(`select has_table_privilege('anon','public.invest_dossier_analyses','select') a`)).rows[0].a, false);
  for (const r of ["anon", "authenticated"]) assert.equal((await db.query(`select has_function_privilege('${r}','public.invest_dossier_analyses_client()','execute') a`)).rows[0].a, false, r);
});
test("7. supprimer une mission supprime son analyse ; l'analyse d'une autre mission n'est pas touchée", async () => {
  const db = await base(); await nouvelleMission(db, ID.d3, ID.cB, "audit_patrimonial");
  await ins(db, J.admin, "", "", ID.d2); await ins(db, J.admin, "", "", ID.d3);
  await db.query(`delete from public.invest_dossiers where id='${ID.d3}'`);
  assert.equal(await n(db), 1); assert.equal(await n(db, `dossier_id='${ID.d2}'`), 1);
});
test("8. retour arrière : table et fonction retirées, missions intactes", async () => {
  const db = await base(); await ins(db, J.admin);
  await db.exec(ROLLBACK);
  assert.equal((await db.query(`select count(*)::int n from pg_class where relname='invest_dossier_analyses'`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int n from pg_proc where proname='invest_dossier_analyses_client'`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int n from public.invest_dossiers`)).rows[0].n, 1);
});
await lancer();
