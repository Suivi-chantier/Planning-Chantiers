#!/usr/bin/env node
// Vérifie la migration 20261002140000 (acquisitions d'une mission) sur un VRAI PostgreSQL (PGlite).
// Elle dépend des scénarios (20261002120000, fonction invest_dossier_modules_client), appliqués d'abord.
// Données : exemple issu des tests, données fictives (aucune donnée réelle).
//   node scripts/verif-invest-acquisition-mission.mjs
import assert from "node:assert/strict";
import { ID, J, lire, nouvelleBase, sous, nouvelleMission, lanceur } from "./lib/banc-invest.mjs";

const ROLLBACK = lire("sql/202610_invest_dossier_acquisitions_rollback.sql");
const base = () => nouvelleBase(["supabase/migrations/20261002120000_invest_dossier_strategies.sql", "supabase/migrations/20261002140000_invest_dossier_acquisitions.sql"]);
const { test, lancer } = lanceur();
const T = "public.invest_dossier_acquisitions";
const n = async (db, w = "true") => (await db.query(`select count(*)::int n from ${T} where ${w}`)).rows[0].n;
const acq = (db, j, cols = "", vals = "", dossier = ID.d2) => sous(db, "authenticated", j, `insert into ${T} (dossier_id, client_id, libelle ${cols ? "," + cols : ""}) values ('${dossier}','${ID.cB}','Bien ${Math.random().toString(16).slice(2, 6)}' ${vals ? "," + vals : ""}) returning id`);

test("1. client_id déduit de la mission (un client_id fourni ou modifié est ignoré) ; mission inconnue refusée", async () => {
  const db = await base();
  assert.equal((await acq(db, J.commercial)).erreur, null);
  assert.equal((await db.query(`select client_id from ${T}`)).rows[0].client_id, ID.cA);
  await sous(db, "authenticated", J.admin, `update ${T} set client_id='${ID.cB}'`);
  assert.equal((await db.query(`select client_id from ${T}`)).rows[0].client_id, ID.cA);
  assert.ok((await acq(db, J.admin, "", "", "99999999-9999-9999-9999-999999999999")).erreur);
});
test("2. libellé obligatoire ; prix et budget jamais négatifs", async () => {
  const db = await base();
  assert.ok((await sous(db, "authenticated", J.admin, `insert into ${T} (dossier_id, client_id, libelle) values ('${ID.d2}','${ID.cA}','  ')`)).erreur);
  assert.ok((await acq(db, J.admin, "prix_signe", "-1")).erreur); assert.ok((await acq(db, J.admin, "budget_travaux", "-5")).erreur);
  assert.equal((await acq(db, J.admin, "prix_signe, budget_travaux", "180000, 25000")).erreur, null);
});
test("3. la chaîne compromis → acte → clés / travaux / location est imposée par la base", async () => {
  const db = await base();
  assert.ok((await acq(db, J.admin, "acte_signe_le", "'2026-11-01'")).erreur, "acte sans compromis");
  assert.ok((await acq(db, J.admin, "mise_location_le", "'2026-12-01'")).erreur, "location sans acte");
  assert.ok((await acq(db, J.admin, "cles_remises_le", "'2026-12-01'")).erreur, "clés sans acte");
  assert.ok((await acq(db, J.admin, "travaux_debut_le", "'2026-12-01'")).erreur, "travaux sans acte");
  assert.ok((await acq(db, J.admin, "compromis_signe_le, acte_signe_le, travaux_fin_le", "'2026-10-01','2026-11-01','2026-12-01'")).erreur, "fin de travaux sans début");
  assert.equal((await acq(db, J.admin, "compromis_signe_le, acte_signe_le, travaux_debut_le, travaux_fin_le, mise_location_le", "'2026-10-01','2026-11-01','2026-11-05','2026-12-10','2026-12-20'")).erreur, null);
});
test("4. les dates se suivent (offre ≤ compromis ≤ acte ≤ clés, travaux, location ; début ≤ fin)", async () => {
  const db = await base();
  const cas = [["offre_acceptee_le, compromis_signe_le", "'2026-10-10','2026-10-01'"], ["compromis_signe_le, acte_signe_le", "'2026-10-10','2026-10-01'"],
    ["compromis_signe_le, acte_signe_le, cles_remises_le", "'2026-10-01','2026-10-10','2026-10-05'"], ["compromis_signe_le, acte_signe_le, travaux_debut_le", "'2026-10-01','2026-10-10','2026-10-05'"],
    ["compromis_signe_le, acte_signe_le, travaux_debut_le, travaux_fin_le", "'2026-10-01','2026-10-10','2026-10-20','2026-10-15'"], ["compromis_signe_le, acte_signe_le, mise_location_le", "'2026-10-01','2026-10-10','2026-10-05'"]];
  for (const [c, v] of cas) assert.ok((await acq(db, J.admin, c, v)).erreur, c);
  assert.equal((await acq(db, J.admin, "offre_acceptee_le, compromis_signe_le", "'2026-10-01','2026-10-01'")).erreur, null, "même jour accepté");
});
test("5. une acquisition dont l'acte est signé ne peut pas être abandonnée ; abandonnée avant l'acte, c'est possible", async () => {
  const db = await base();
  assert.ok((await acq(db, J.admin, "compromis_signe_le, acte_signe_le, abandon_le", "'2026-10-01','2026-10-10','2026-10-12'")).erreur);
  assert.equal((await acq(db, J.admin, "compromis_signe_le, abandon_le, abandon_motif", "'2026-10-01','2026-10-12','Prêt refusé'")).erreur, null);
});
test("6. conditions suspensives : liste de 15 au plus, jamais un objet", async () => {
  const db = await base(); await acq(db, J.admin);
  const maj = (v) => sous(db, "authenticated", J.admin, `update ${T} set conditions_suspensives=$1::jsonb`, [v]);
  assert.equal((await maj(JSON.stringify([{ libelle: "Prêt", echeance: "2026-11-15", levee_le: null }]))).erreur, null);
  assert.ok((await maj("{}")).erreur);
  assert.ok((await maj(JSON.stringify(Array.from({ length: 16 }, (_, i) => ({ libelle: `c${i}` }))))).erreur);
  assert.equal((await maj(JSON.stringify(Array.from({ length: 15 }, (_, i) => ({ libelle: `c${i}` }))))).erreur, null);
});
test("7. six acquisitions au plus par mission ; une autre mission a sa propre limite", async () => {
  const db = await base(); await nouvelleMission(db, ID.d3, ID.cB, "audit_patrimonial");
  for (let i = 0; i < 6; i++) assert.equal((await acq(db, J.admin)).erreur, null);
  assert.ok((await acq(db, J.admin)).erreur);
  assert.equal((await acq(db, J.admin, "", "", ID.d3)).erreur, null);
  assert.equal(await n(db, `dossier_id='${ID.d2}'`), 6);
});
test("8. le bien du stock est facultatif ; supprimé, l'acquisition reste", async () => {
  const db = await base();
  await db.query(`insert into public.invest_biens values ('aaaaaaaa-0000-0000-0000-000000000001','1 rue Test','Lille')`);
  assert.equal((await acq(db, J.admin, "bien_id", "'aaaaaaaa-0000-0000-0000-000000000001'")).erreur, null);
  assert.ok((await acq(db, J.admin, "bien_id", "'aaaaaaaa-0000-0000-0000-0000000000ff'")).erreur, "bien inconnu refusé");
  await db.query(`delete from public.invest_biens`);
  assert.equal(await n(db), 1); assert.equal(await n(db, "bien_id is null"), 1);
});
test("9. accès : admin et commercial lisent et écrivent ; ouvrier, sans fiche, client, jeton falsifié et anon : rien", async () => {
  const db = await base(); await acq(db, J.admin);
  for (const [nom, j] of [["admin", J.admin], ["commercial", J.commercial]]) {
    assert.equal((await sous(db, "authenticated", j, `select * from ${T}`)).rows.length, 1, nom);
    assert.equal((await sous(db, "authenticated", j, `update ${T} set notaire='Me Test' returning id`)).rows.length, 1, nom);
  }
  for (const [nom, j] of [["ouvrier", J.ouvrier], ["sans fiche", J.libre], ["client", J.client], ["jeton falsifié", J.commercialFalsifie]]) {
    assert.equal((await sous(db, "authenticated", j, `select * from ${T}`)).rows.length, 0, `lecture : ${nom}`);
    await sous(db, "authenticated", j, `delete from ${T}`);
    assert.ok((await acq(db, j)).erreur, `création : ${nom}`);
  }
  assert.ok((await sous(db, "anon", null, `select * from ${T}`)).erreur, "anon");
  assert.equal(await n(db), 1); assert.equal((await db.query(`select notaire from ${T}`)).rows[0].notaire, "Me Test");
});
test("10. règles du dépôt : restrictive 3a, aucun droit anon, fonction interne non appelable", async () => {
  const db = await base();
  const pol = (await db.query(`select policyname, permissive from pg_policies where tablename='invest_dossier_acquisitions' order by 1`)).rows.map((r) => `${r.policyname}:${r.permissive}`);
  assert.deepEqual(pol, ["invest_dossier_acquisitions_crm:PERMISSIVE", "profero_collaborateurs_seulement:RESTRICTIVE"]);
  assert.equal((await db.query(`select has_table_privilege('anon','${T}','select') a`)).rows[0].a, false);
  for (const r of ["anon", "authenticated"]) assert.equal((await db.query(`select has_function_privilege('${r}','public.invest_dossier_acquisitions_limite()','execute') a`)).rows[0].a, false, r);
});
test("11. supprimer une mission supprime ses acquisitions, pas celles d'une autre", async () => {
  const db = await base(); await nouvelleMission(db, ID.d3, ID.cB, "audit_patrimonial");
  await acq(db, J.admin, "", "", ID.d2); await acq(db, J.admin, "", "", ID.d3);
  await db.query(`delete from public.invest_dossiers where id='${ID.d3}'`);
  assert.equal(await n(db), 1); assert.equal(await n(db, `dossier_id='${ID.d2}'`), 1);
});
test("12. retour arrière : table et fonction retirées ; scénarios, missions et biens intacts", async () => {
  const db = await base(); await acq(db, J.admin);
  await db.exec(ROLLBACK);
  assert.equal((await db.query(`select count(*)::int n from pg_class where relname='invest_dossier_acquisitions'`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int n from pg_proc where proname='invest_dossier_acquisitions_limite'`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int n from public.invest_dossiers`)).rows[0].n, 1);
});
await lancer();
