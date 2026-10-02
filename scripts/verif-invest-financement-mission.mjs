#!/usr/bin/env node
// Vérifie la migration 20261002130000 (financement et banques d'une mission) sur un VRAI PostgreSQL (PGlite).
// Elle dépend des scénarios (20261002120000), appliqués d'abord depuis leur fichier.
// Données : exemple issu des tests, données fictives (aucune donnée réelle).
//   npm install --no-save @electric-sql/pglite   (une fois)
//   node scripts/verif-invest-financement-mission.mjs
import assert from "node:assert/strict";
import { ID, J, lire, nouvelleBase, sous, nouvelleMission, lanceur } from "./lib/banc-invest.mjs";

const ROLLBACK = lire("sql/202610_invest_dossier_financements_rollback.sql");
const base = () => nouvelleBase(["supabase/migrations/20261002120000_invest_dossier_strategies.sql", "supabase/migrations/20261002130000_invest_dossier_financements.sql"]);
const { test, lancer } = lanceur();
const nF = async (db, w = "true") => (await db.query(`select count(*)::int n from public.invest_dossier_financements where ${w}`)).rows[0].n;
const nB = async (db, w = "true") => (await db.query(`select count(*)::int n from public.invest_dossier_banques where ${w}`)).rows[0].n;
const fin = (db, j, set = "", dossier = ID.d2) => sous(db, "authenticated", j, `insert into public.invest_dossier_financements (dossier_id, client_id ${set ? "," + set.split("=")[0] : ""}) values ('${dossier}','${ID.cB}' ${set ? "," + set.slice(set.indexOf("=") + 1) : ""}) returning dossier_id`);
const banque = (db, j, cols = "", vals = "", dossier = ID.d2) => sous(db, "authenticated", j, `insert into public.invest_dossier_banques (dossier_id, client_id, banque ${cols ? "," + cols : ""}) values ('${dossier}','${ID.cB}','Banque ${Math.random().toString(16).slice(2, 6)}' ${vals ? "," + vals : ""}) returning id`);
const scenario = (db, ordre, dossier = ID.d2) => db.query(`insert into public.invest_dossier_scenarios (id, dossier_id, client_id, ordre, libelle) values (gen_random_uuid(), $1, $2, $3, 'S') returning id`, [dossier, ID.cA, ordre]).then((r) => r.rows[0].id);

test("1. un financement par mission ; client_id déduit de la mission pour le financement ET les banques", async () => {
  const db = await base();
  assert.equal((await fin(db, J.commercial)).erreur, null); assert.ok((await fin(db, J.commercial)).erreur, "doublon refusé");
  await banque(db, J.admin);
  assert.equal((await db.query(`select client_id from public.invest_dossier_financements`)).rows[0].client_id, ID.cA);
  assert.equal((await db.query(`select client_id from public.invest_dossier_banques`)).rows[0].client_id, ID.cA);
  await sous(db, "authenticated", J.admin, `update public.invest_dossier_banques set client_id='${ID.cB}'`);
  assert.equal((await db.query(`select client_id from public.invest_dossier_banques`)).rows[0].client_id, ID.cA);
  assert.ok((await fin(db, J.admin, "", "99999999-9999-9999-9999-999999999999")).erreur, "mission inconnue refusée");
});
test("2. le scénario retenu doit être un scénario DE CETTE mission ; supprimé, le financement reste et retombe sur le recommandé", async () => {
  const db = await base(); await nouvelleMission(db, ID.d3, ID.cB, "audit_patrimonial");
  const sA = await scenario(db, 1, ID.d2), sB = await scenario(db, 1, ID.d3);
  assert.equal((await fin(db, J.admin, `scenario_id='${sA}'`)).erreur, null);
  assert.ok((await sous(db, "authenticated", J.admin, `update public.invest_dossier_financements set scenario_id='${sB}'`)).erreur, "scénario d'une autre mission refusé");
  assert.ok((await fin(db, J.admin, `scenario_id='${sB}'`, ID.d3)).erreur === null, "son propre scénario accepté");
  await db.query(`delete from public.invest_dossier_scenarios where id='${sA}'`);
  assert.equal((await db.query(`select scenario_id from public.invest_dossier_financements where dossier_id='${ID.d2}'`)).rows[0].scenario_id, null);
  assert.equal(await nF(db, `dossier_id='${ID.d2}'`), 1);
});
test("3. « transmis » ⇔ date de transmission (dans les deux sens)", async () => {
  const db = await base(); await fin(db, J.admin);
  const maj = (set) => sous(db, "authenticated", J.admin, `update public.invest_dossier_financements set ${set} returning dossier_statut`);
  assert.ok((await maj(`dossier_statut='transmis'`)).erreur, "transmis sans date");
  assert.ok((await maj(`transmis_le='2026-10-02'`)).erreur, "date sans transmis");
  assert.ok((await maj(`dossier_statut='pret', transmis_le='2026-10-02'`)).erreur, "date avec un autre statut");
  assert.equal((await maj(`dossier_statut='transmis', transmis_le='2026-10-02'`)).erreur, null);
  assert.ok((await maj(`dossier_statut='pret'`)).erreur, "on ne repasse pas en prêt en gardant la date");
  assert.equal((await maj(`dossier_statut='pret', transmis_le=null`)).erreur, null);
  assert.ok((await maj(`dossier_statut='inconnu'`)).erreur);
});
test("4. lignes libres : listes de 15 au plus ; une banque : statut connu, nom obligatoire", async () => {
  const db = await base(); await fin(db, J.admin);
  assert.ok((await sous(db, "authenticated", J.admin, `update public.invest_dossier_financements set autres_emplois='{}'::jsonb`)).erreur, "doit être une liste");
  const seize = JSON.stringify(Array.from({ length: 16 }, (_, i) => ({ libelle: `L${i}`, montant: 1 })));
  assert.ok((await sous(db, "authenticated", J.admin, `update public.invest_dossier_financements set autres_ressources=$1::jsonb`, [seize])).erreur);
  assert.equal((await sous(db, "authenticated", J.admin, `update public.invest_dossier_financements set autres_ressources=$1::jsonb`, [JSON.stringify([{ libelle: "Prêt familial", montant: 10000 }])])).erreur, null);
  assert.ok((await banque(db, J.admin, "statut", "'inconnu'")).erreur); assert.ok((await sous(db, "authenticated", J.admin, `insert into public.invest_dossier_banques (dossier_id, client_id, banque) values ('${ID.d2}','${ID.cA}','  ')`)).erreur);
  for (const s of ["a_consulter", "dossier_depose", "accord_principe", "offre_recue", "offre_acceptee", "refus", "abandon"]) assert.equal((await banque(db, J.admin, "statut", `'${s}'`)).erreur, null, s);
});
test("5. montants, taux et durée d'une banque : bornes respectées", async () => {
  const db = await base();
  for (const [col, bon, mauvais] of [["montant_demande", "100000", "-1"], ["montant_accorde", "0", "-5"], ["taux_pct", "15", "15.1"], ["duree_ans", "30", "31"], ["assurance_mensuelle", "0", "-1"], ["frais_dossier", "0", "-1"], ["frais_garantie", "0", "-1"]]) {
    await db.query(`delete from public.invest_dossier_banques`);
    assert.equal((await banque(db, J.admin, col, bon)).erreur, null, `${col} = ${bon}`); assert.ok((await banque(db, J.admin, col, mauvais)).erreur, `${col} = ${mauvais}`);
  }
  assert.ok((await banque(db, J.admin, "taux_pct", "-0.1")).erreur); assert.ok((await banque(db, J.admin, "duree_ans", "0.5")).erreur);
});
test("6. « retenue » exige un accord de principe, une offre reçue ou acceptée ET un montant accordé", async () => {
  const db = await base();
  assert.equal((await banque(db, J.admin, "statut, montant_accorde, retenue", "'offre_acceptee', 180000, true")).erreur, null);
  assert.equal((await banque(db, J.admin, "statut, montant_accorde, retenue", "'accord_principe', 1, true")).erreur, null);
  assert.ok((await banque(db, J.admin, "statut, montant_accorde, retenue", "'dossier_depose', 180000, true")).erreur, "statut non compatible");
  assert.ok((await banque(db, J.admin, "statut, montant_accorde, retenue", "'refus', 180000, true")).erreur, "refus");
  assert.ok((await banque(db, J.admin, "statut, retenue", "'offre_recue', true")).erreur, "sans montant accordé");
  assert.equal((await banque(db, J.admin, "statut, retenue", "'refus', false")).erreur, null);
  assert.equal((await banque(db, J.admin, "statut, montant_accorde, retenue", "'offre_recue', 100000, true")).erreur, null, "plusieurs prêts retenus possibles");
  const b = (await banque(db, J.admin, "statut, montant_accorde, retenue", "'offre_acceptee', 50000, true")).rows[0].id;
  assert.ok((await sous(db, "authenticated", J.admin, `update public.invest_dossier_banques set statut='refus' where id='${b}'`)).erreur, "on ne refuse pas une banque encore retenue");
});
test("7. dates d'une banque : la réponse ne précède pas la demande", async () => {
  const db = await base();
  assert.equal((await banque(db, J.admin, "demande_le, reponse_le", "'2026-09-01', '2026-09-20'")).erreur, null);
  assert.equal((await banque(db, J.admin, "demande_le, reponse_le", "'2026-09-01', '2026-09-01'")).erreur, null);
  assert.ok((await banque(db, J.admin, "demande_le, reponse_le", "'2026-09-10', '2026-09-01'")).erreur);
  assert.equal((await banque(db, J.admin, "reponse_le", "'2026-09-01'")).erreur, null, "réponse sans date de demande acceptée");
});
test("8. douze banques au plus par mission, par mission", async () => {
  const db = await base(); await nouvelleMission(db, ID.d3, ID.cB, "audit_patrimonial");
  for (let i = 0; i < 12; i++) assert.equal((await banque(db, J.admin)).erreur, null, `banque ${i + 1}`);
  const treizieme = await banque(db, J.admin); assert.ok(treizieme.erreur); assert.match(treizieme.erreur.message, /Douze banques/);
  assert.equal((await banque(db, J.admin, "", "", ID.d3)).erreur, null, "une autre mission a sa propre limite");
  assert.equal(await nB(db, `dossier_id='${ID.d2}'`), 12);
});
test("9. accès : admin et commercial lisent et écrivent ; ouvrier, sans fiche, client, jeton falsifié et anon : rien (deux tables)", async () => {
  const db = await base(); await fin(db, J.admin); await banque(db, J.admin);
  for (const [nom, j] of [["admin", J.admin], ["commercial", J.commercial]]) {
    assert.equal((await sous(db, "authenticated", j, `select * from public.invest_dossier_banques`)).rows.length, 1, nom);
    assert.equal((await sous(db, "authenticated", j, `update public.invest_dossier_financements set notes='x' returning dossier_id`)).rows.length, 1, nom);
  }
  for (const [nom, j] of [["ouvrier", J.ouvrier], ["sans fiche", J.libre], ["client", J.client], ["jeton falsifié", J.commercialFalsifie]]) {
    for (const t of ["invest_dossier_financements", "invest_dossier_banques"]) {
      assert.equal((await sous(db, "authenticated", j, `select * from public.${t}`)).rows.length, 0, `lecture ${t} : ${nom}`);
      assert.ok((await sous(db, "authenticated", j, `delete from public.${t}`)).erreur || (await db.query(`select count(*)::int n from public.${t}`)).rows[0].n === 1, `suppression ${t} : ${nom}`);
    }
    assert.ok((await fin(db, j)).erreur, `création financement : ${nom}`); assert.ok((await banque(db, j)).erreur, `création banque : ${nom}`);
  }
  for (const t of ["invest_dossier_financements", "invest_dossier_banques"]) assert.ok((await sous(db, "anon", null, `select * from public.${t}`)).erreur, `anon ${t}`);
  assert.equal(await nF(db), 1); assert.equal(await nB(db), 1); assert.equal((await db.query(`select notes from public.invest_dossier_financements`)).rows[0].notes, "x");
});
test("10. règles du dépôt : restrictive 3a sur les deux tables, aucun droit anon, fonctions internes non appelables", async () => {
  const db = await base();
  for (const t of ["invest_dossier_financements", "invest_dossier_banques"]) {
    const pol = (await db.query(`select policyname, permissive from pg_policies where tablename='${t}' order by 1`)).rows.map((r) => `${r.policyname}:${r.permissive}`);
    assert.deepEqual(pol, [`${t}_crm:PERMISSIVE`, "profero_collaborateurs_seulement:RESTRICTIVE"], t);
    assert.equal((await db.query(`select has_table_privilege('anon','public.${t}','select') a`)).rows[0].a, false);
  }
  for (const f of ["invest_dossier_financements_controle()", "invest_dossier_banques_limite()"]) for (const r of ["anon", "authenticated"]) assert.equal((await db.query(`select has_function_privilege('${r}','public.${f}','execute') a`)).rows[0].a, false, `${f} / ${r}`);
});
test("11. supprimer une mission supprime son financement et ses banques, pas ceux d'une autre", async () => {
  const db = await base(); await nouvelleMission(db, ID.d3, ID.cB, "audit_patrimonial");
  await fin(db, J.admin, "", ID.d2); await fin(db, J.admin, "", ID.d3); await banque(db, J.admin, "", "", ID.d2); await banque(db, J.admin, "", "", ID.d3);
  await db.query(`delete from public.invest_dossiers where id='${ID.d3}'`);
  assert.equal(await nF(db), 1); assert.equal(await nB(db), 1); assert.equal(await nB(db, `dossier_id='${ID.d2}'`), 1);
});
test("12. retour arrière : tables et fonctions du financement retirées ; scénarios et missions intacts", async () => {
  const db = await base(); await scenario(db, 1); await fin(db, J.admin); await banque(db, J.admin);
  await db.exec(ROLLBACK);
  assert.equal((await db.query(`select count(*)::int n from pg_class where relname in ('invest_dossier_financements','invest_dossier_banques')`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int n from pg_proc where proname in ('invest_dossier_financements_controle','invest_dossier_banques_limite')`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int n from public.invest_dossier_scenarios`)).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int n from public.invest_dossiers`)).rows[0].n, 1);
});
await lancer();
