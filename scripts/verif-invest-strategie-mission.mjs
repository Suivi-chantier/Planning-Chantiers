#!/usr/bin/env node
// Vérifie la migration 20261002120000 (stratégie et scénarios d'une mission) sur un VRAI PostgreSQL (PGlite).
// Données : exemple issu des tests, données fictives (aucune donnée réelle).
//   npm install --no-save @electric-sql/pglite   (une fois)
//   node scripts/verif-invest-strategie-mission.mjs
import assert from "node:assert/strict";
import { ID, J, lire, nouvelleBase, sous, nouvelleMission, lanceur } from "./lib/banc-invest.mjs";

const MIGRATION = "supabase/migrations/20261002120000_invest_dossier_strategies.sql";
const ROLLBACK = lire("sql/202610_invest_dossier_strategies_rollback.sql");
const base = () => nouvelleBase([MIGRATION]);
const { test, lancer } = lanceur();
const nS = async (db, w = "true") => (await db.query(`select count(*)::int n from public.invest_dossier_strategies where ${w}`)).rows[0].n;
const nC = async (db, w = "true") => (await db.query(`select count(*)::int n from public.invest_dossier_scenarios where ${w}`)).rows[0].n;
const strat = (db, j, set = "", dossier = ID.d2) => sous(db, "authenticated", j, `insert into public.invest_dossier_strategies (dossier_id, client_id ${set ? "," + set.split("=")[0] : ""}) values ('${dossier}','${ID.cB}' ${set ? "," + set.slice(set.indexOf("=") + 1) : ""}) returning dossier_id`);
const scen = (db, j, ordre, extra = "", dossier = ID.d2) => sous(db, "authenticated", j, `insert into public.invest_dossier_scenarios (dossier_id, client_id, ordre, libelle ${extra ? "," + extra.split("=")[0] : ""}) values ('${dossier}','${ID.cB}', ${ordre}, 'Scénario ${ordre}' ${extra ? "," + extra.slice(extra.indexOf("=") + 1) : ""}) returning id`);

test("1. une stratégie par mission ; blocs par défaut = objectifs, point de départ, scénarios, recommandation", async () => {
  const db = await base();
  assert.equal((await strat(db, J.commercial)).erreur, null); assert.ok((await strat(db, J.commercial)).erreur, "doublon refusé");
  assert.deepEqual((await db.query(`select blocs from public.invest_dossier_strategies`)).rows[0].blocs, ["objectifs", "point_depart", "scenarios", "recommandation"]);
});
test("2. client_id est toujours celui de la mission, pour la stratégie ET pour les scénarios", async () => {
  const db = await base(); await strat(db, J.admin); await scen(db, J.admin, 1);
  assert.equal((await db.query(`select client_id from public.invest_dossier_strategies`)).rows[0].client_id, ID.cA);
  assert.equal((await db.query(`select client_id from public.invest_dossier_scenarios`)).rows[0].client_id, ID.cA);
  await sous(db, "authenticated", J.admin, `update public.invest_dossier_scenarios set client_id='${ID.cB}'`);
  assert.equal((await db.query(`select client_id from public.invest_dossier_scenarios`)).rows[0].client_id, ID.cA);
  assert.ok((await strat(db, J.admin, "", "99999999-9999-9999-9999-999999999999")).erreur, "mission inconnue refusée");
});
test("3. blocs : seuls les blocs connus, 7 au plus, doit être une liste ; contenus de blocs aux bons types", async () => {
  const db = await base();
  const b = (v) => sous(db, "authenticated", J.admin, `insert into public.invest_dossier_strategies (dossier_id, client_id, blocs) values ('${ID.d2}','${ID.cA}', $1::jsonb) on conflict (dossier_id) do update set blocs = excluded.blocs returning dossier_id`, [JSON.stringify(v)]);
  for (const ok of [[], ["objectifs"], ["objectifs", "point_depart", "scenarios", "fiscal", "risques", "feuille_route", "recommandation"]]) assert.equal((await b(ok)).erreur, null, JSON.stringify(ok));
  for (const mauvais of [["inconnu"], ["objectifs", "pirate"], { objectifs: true }, "objectifs", [1]]) assert.ok((await b(mauvais)).erreur, `refusé : ${JSON.stringify(mauvais)}`);
  for (const [col, val] of [["fiscal", "'[]'"], ["risques", "'{}'"], ["feuille_route", "'{}'"], ["fiscal", "'\"x\"'"]]) assert.ok((await sous(db, "authenticated", J.admin, `update public.invest_dossier_strategies set ${col}=${val}::jsonb`)).erreur, `${col} = ${val}`);
  const trop = JSON.stringify(Array.from({ length: 31 }, (_, i) => ({ libelle: `R${i}` })));
  assert.ok((await sous(db, "authenticated", J.admin, `update public.invest_dossier_strategies set risques=$1::jsonb`, [trop])).erreur, "31 risques refusés");
});
test("4. valider exige une recommandation, une date et les chiffres figés ; « présentée » exige une stratégie validée", async () => {
  const db = await base(); await strat(db, J.admin);
  const maj = (set) => sous(db, "authenticated", J.admin, `update public.invest_dossier_strategies set ${set} returning statut`);
  assert.ok((await maj(`statut='validee'`)).erreur);
  assert.ok((await maj(`statut='validee', recommandation='  ', valide_le=now(), chiffres_valides='{}'`)).erreur, "recommandation vide");
  assert.ok((await maj(`statut='validee', recommandation='Scénario 1', chiffres_valides='{}'`)).erreur, "sans date");
  assert.ok((await maj(`statut='validee', recommandation='Scénario 1', valide_le=now()`)).erreur, "sans chiffres");
  assert.ok((await maj(`presentee_le='2026-10-02'`)).erreur, "présentée sans validation");
  assert.equal((await maj(`statut='validee', recommandation='Scénario 1', valide_le=now(), valide_par='Tom', chiffres_valides='{"nbScenarios":2}'`)).erreur, null);
  assert.equal((await maj(`presentee_le='2026-10-02'`)).erreur, null);
  assert.ok((await maj(`statut='brouillon'`)).erreur, "on ne repasse pas en brouillon en gardant la date de présentation");
  assert.equal((await maj(`statut='brouillon', valide_le=null, valide_par=null, chiffres_valides=null, presentee_le=null`)).erreur, null);
});
test("5. scénarios : 1 à 4 par mission, jamais deux avec le même rang, intitulé obligatoire", async () => {
  const db = await base();
  for (const o of [1, 2, 3, 4]) assert.equal((await scen(db, J.admin, o)).erreur, null, `rang ${o}`);
  assert.ok((await scen(db, J.admin, 1)).erreur, "rang en double");
  for (const mauvais of [0, 5, -1]) assert.ok((await scen(db, J.admin, mauvais)).erreur, `rang ${mauvais}`);
  assert.ok((await sous(db, "authenticated", J.admin, `insert into public.invest_dossier_scenarios (dossier_id, client_id, ordre, libelle) values ('${ID.d2}','${ID.cA}',1,'  ')`)).erreur);
  assert.equal(await nC(db), 4);
});
test("6. au plus UN scénario recommandé par mission ; une autre mission a son propre recommandé", async () => {
  const db = await base(); await nouvelleMission(db, ID.d3, ID.cB, "audit_patrimonial");
  assert.equal((await scen(db, J.admin, 1, "recommande=true")).erreur, null);
  assert.ok((await scen(db, J.admin, 2, "recommande=true")).erreur, "deuxième recommandé refusé");
  assert.equal((await scen(db, J.admin, 2)).erreur, null);
  assert.equal((await scen(db, J.admin, 1, "recommande=true", ID.d3)).erreur, null, "autre mission");
});
test("7. hypothèses d'un scénario : montants jamais négatifs, taux 0-15, durée 1-30, nombres uniquement", async () => {
  const db = await base();
  const h = (json) => sous(db, "authenticated", J.admin, `insert into public.invest_dossier_scenarios (dossier_id, client_id, ordre, libelle, hypotheses) values ('${ID.d2}','${ID.cA}', ${1 + Math.floor(Math.random() * 3)}, 'T', $1::jsonb) returning id`, [JSON.stringify(json)]);
  const ok = async (json) => { await db.query(`delete from public.invest_dossier_scenarios`); return (await h(json)).erreur; };
  for (const bon of [{}, { prix: 200000, travaux: 0, frais: 1000, apport: 0, tauxPct: 0, dureeAns: 1, loyerMensuel: 800, chargesMensuelles: 100 }, { tauxPct: 15, dureeAns: 30 }]) assert.equal(await ok(bon), null, JSON.stringify(bon));
  for (const mauvais of [{ prix: -1 }, { travaux: -5 }, { frais: -1 }, { apport: -1 }, { loyerMensuel: -10 }, { chargesMensuelles: -10 }, { tauxPct: 15.5 }, { tauxPct: -1 }, { dureeAns: 0 }, { dureeAns: 31 }, { prix: "200000" }, { prix: null }])
    assert.ok(await ok(mauvais), `refusé : ${JSON.stringify(mauvais)}`);
  assert.ok((await sous(db, "authenticated", J.admin, `insert into public.invest_dossier_scenarios (dossier_id, client_id, ordre, libelle, hypotheses) values ('${ID.d2}','${ID.cA}',1,'T','[]'::jsonb)`)).erreur, "doit être un objet");
});
test("8. accès : admin et commercial lisent et écrivent ; ouvrier, sans fiche, client, jeton falsifié et anon : rien (deux tables)", async () => {
  const db = await base(); await strat(db, J.admin); await scen(db, J.admin, 1);
  for (const [nom, j] of [["admin", J.admin], ["commercial", J.commercial]]) {
    assert.equal((await sous(db, "authenticated", j, `select * from public.invest_dossier_strategies`)).rows.length, 1, nom);
    assert.equal((await sous(db, "authenticated", j, `update public.invest_dossier_scenarios set description='x' returning id`)).rows.length, 1, nom);
  }
  for (const [nom, j] of [["ouvrier", J.ouvrier], ["sans fiche", J.libre], ["client", J.client], ["jeton falsifié", J.commercialFalsifie]]) {
    for (const t of ["invest_dossier_strategies", "invest_dossier_scenarios"]) {
      assert.equal((await sous(db, "authenticated", j, `select * from public.${t}`)).rows.length, 0, `lecture ${t} : ${nom}`);
      assert.ok((await sous(db, "authenticated", j, `delete from public.${t}`)).erreur || (await db.query(`select count(*)::int n from public.${t}`)).rows[0].n === 1, `suppression ${t} : ${nom}`);
    }
    assert.ok((await strat(db, j, "", ID.d2)).erreur, `création stratégie : ${nom}`); assert.ok((await scen(db, j, 2)).erreur, `création scénario : ${nom}`);
  }
  for (const t of ["invest_dossier_strategies", "invest_dossier_scenarios"]) assert.ok((await sous(db, "anon", null, `select * from public.${t}`)).erreur, `anon ${t}`);
  assert.equal(await nS(db), 1); assert.equal(await nC(db), 1); assert.equal((await db.query(`select description from public.invest_dossier_scenarios`)).rows[0].description, "x");
});
test("9. règles du dépôt : restrictive 3a sur les deux tables, aucun droit anon, fonction interne non appelable", async () => {
  const db = await base();
  for (const t of ["invest_dossier_strategies", "invest_dossier_scenarios"]) {
    const pol = (await db.query(`select policyname, permissive from pg_policies where tablename='${t}' order by 1`)).rows.map((r) => `${r.policyname}:${r.permissive}`);
    assert.deepEqual(pol, [`${t}_crm:PERMISSIVE`, "profero_collaborateurs_seulement:RESTRICTIVE"], t);
    assert.equal((await db.query(`select has_table_privilege('anon','public.${t}','select') a`)).rows[0].a, false);
  }
  for (const r of ["anon", "authenticated"]) assert.equal((await db.query(`select has_function_privilege('${r}','public.invest_dossier_modules_client()','execute') a`)).rows[0].a, false, r);
});
test("10. supprimer une mission supprime sa stratégie et ses scénarios, pas ceux d'une autre mission", async () => {
  const db = await base(); await nouvelleMission(db, ID.d3, ID.cB, "audit_patrimonial");
  await strat(db, J.admin, "", ID.d2); await strat(db, J.admin, "", ID.d3); await scen(db, J.admin, 1, "", ID.d2); await scen(db, J.admin, 1, "", ID.d3);
  await db.query(`delete from public.invest_dossiers where id='${ID.d3}'`);
  assert.equal(await nS(db), 1); assert.equal(await nC(db), 1); assert.equal(await nS(db, `dossier_id='${ID.d2}'`), 1);
});
test("11. retour arrière : tables et fonction retirées, missions intactes", async () => {
  const db = await base(); await strat(db, J.admin); await scen(db, J.admin, 1);
  await db.exec(ROLLBACK);
  assert.equal((await db.query(`select count(*)::int n from pg_class where relname in ('invest_dossier_strategies','invest_dossier_scenarios')`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int n from pg_proc where proname='invest_dossier_modules_client'`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int n from public.invest_dossiers`)).rows[0].n, 1);
});
await lancer();
