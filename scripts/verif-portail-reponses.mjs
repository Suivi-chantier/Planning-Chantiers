#!/usr/bin/env node
// Vérifie la saisie du client dans son espace (migration 20261002180000) sur un VRAI PostgreSQL (PGlite).
// Données : exemple issu des tests, données fictives (aucune donnée réelle).
//   npm install --no-save @electric-sql/pglite   (une fois)
//   node scripts/verif-portail-reponses.mjs
import assert from "node:assert/strict";
import { ID, J, jeton, lire, nouvelleBase, sous, lanceur } from "./lib/banc-invest.mjs";
import * as C from "../src/Portail/portailChamps.mjs";

const { test, lancer } = lanceur();
const LIAISON = "supabase/migrations/20261001190000_portail_client_invest_liaison.sql";
const REPONSES = "supabase/migrations/20261002180000_portail_client_invest_reponses.sql";
const ROLLBACK = lire("sql/202610_portail_client_invest_reponses_rollback.sql");
const CLIENT_B = "00000000-0000-0000-0000-0000000000b9";
const JB = jeton(CLIENT_B, "b@exemple.fr", "client_invest");

const DOSSIER = {
  collecte: {
    profil: { situation_familiale: "Marié(e)", regime_matrimonial: "Communauté réduite aux acquêts", statut_pro: "Salarié CDI", profession: "Ingénieur", revenus_nets_mois: "4800", tmi: "30 %", notes_crm: "NOTE INTERNE" },
    charges: { logement: "1350", epargne_reelle_mois: "2200" },
    patrimoine: { rp_valeur: "310000", lots: [{ id: "x", adresse: "12 rue A", valeur: "185000", loyer_mois: "780", valeur_acquisition: "150000", taxe_fonciere: "950" }] },
    patrimoine_financier: { liquidites: "28000" },
    enfants_liste: [{ prenom: "Léo", naissance: "2014-05-12" }],
    objectifs_mesures: [{ type: "Retraite", montant: "2500", echeance: "2036", priorite: "1", flexibilite: "Souple" }],
    profil_immo: { tolerance_endettement: "Moyenne" },
  },
  analyse: { diagnostic: "CONFIDENTIEL : analyse interne" },
  conformite: { der_remis_le: "2026-09-15" },
};

async function base() {
  const db = await nouvelleBase([LIAISON]);
  await db.exec(`alter table public.invest_clients add column if not exists telephone text; alter table public.invest_clients add column if not exists email text;
    create table public.invest_structuration_patrimoniale (id uuid primary key default gen_random_uuid(), client_id uuid, donnees jsonb, created_at timestamptz default now());
    grant all on public.invest_structuration_patrimoniale to authenticated, service_role;
    insert into auth.users (id, email) values ('${CLIENT_B}','b@exemple.fr');
    insert into public.invest_clients (id, prenom, nom) values ('11111111-1111-1111-1111-1111111111b9','Bob','Client B');
    insert into public.invest_portail_comptes (client_id, auth_user_id) values ('${ID.cA}','${ID.client}'), ('11111111-1111-1111-1111-1111111111b9','${CLIENT_B}');
    insert into public.invest_structuration_patrimoniale (client_id, donnees) values ('${ID.cA}', '${JSON.stringify(DOSSIER).replace(/'/g, "''")}'::jsonb);`);
  await db.exec(lire(REPONSES));
  return db;
}
const rpc = (db, jt, section, donnees, soumettre = false) =>
  sous(db, "authenticated", jt, `select public.portail_enregistrer_reponse($1, $2::jsonb, $3) as r`, [section, JSON.stringify(donnees), soumettre]);

test("1. le client enregistre un brouillon ; la base ne garde que les clés et valeurs prévues", async () => {
  const db = await base();
  const r = await rpc(db, J.client, "flux", { revenus_nets_mois: "4 800", charges_logement: 1350.5, epargne_reelle_mois: "abc", clef_inconnue: "x", role: "admin" });
  assert.equal(r.erreur, null);
  const v = await sous(db, "authenticated", J.client, `select donnees, statut from public.portail_reponses where section = 'flux'`);
  assert.equal(v.rows[0].statut, "brouillon");
  assert.deepEqual(v.rows[0].donnees, { charges_logement: "1350.5" });          // "4 800" (espace) et "abc" écartés, clés inconnues perdues
});
test("2. nombres : virgule acceptée, valeurs absurdes écartées", async () => {
  const db = await base();
  await rpc(db, J.client, "flux", { revenus_nets_mois: "4800,50", dividendes_an: "1e9999", autres_revenus_an: "99999999999", charges_autres: "-120", revenus_conjoint_mois: "0" });
  const v = (await sous(db, "authenticated", J.client, `select donnees from public.portail_reponses where section='flux'`)).rows[0].donnees;
  assert.equal(v.revenus_nets_mois, "4800.5"); assert.equal(v.charges_autres, "-120"); assert.equal(v.revenus_conjoint_mois, "0");
  assert.ok(!("dividendes_an" in v) && !("autres_revenus_an" in v));
});
test("3. choix : une valeur hors liste est écartée ; texte nettoyé et plafonné", async () => {
  const db = await base();
  await rpc(db, J.client, "foyer", { situation_familiale: "Marié(e)", regime_matrimonial: "Régime inventé", statut_pro: "Autre", profession: "  Dév\u0001eloppeur " + "x".repeat(400) });
  const v = (await sous(db, "authenticated", J.client, `select donnees from public.portail_reponses where section='foyer'`)).rows[0].donnees;
  assert.equal(v.situation_familiale, "Marié(e)"); assert.ok(!("regime_matrimonial" in v));
  assert.ok(v.profession.startsWith("Développeur") && v.profession.length === 200 && !/[\u0000-\u001f]/.test(v.profession));
});
test("4. listes : plafonnées, éléments vides ou non-objets écartés, dates contrôlées", async () => {
  const db = await base();
  const enfants = Array.from({ length: 20 }, (_, i) => ({ prenom: `E${i}`, naissance: "2015-02-30" }));
  await rpc(db, J.client, "foyer", { enfants_liste: [...enfants, "texte", { rien: "x" }] });
  const v = (await sous(db, "authenticated", J.client, `select donnees from public.portail_reponses where section='foyer'`)).rows[0].donnees;
  assert.equal(v.enfants_liste.length, 8); assert.ok(v.enfants_liste.every((e) => !("naissance" in e)), "30 février = date invalide");
  await rpc(db, J.client, "foyer", { enfants_liste: [{ prenom: "Léo", naissance: "2014-05-12" }] });
  const w = (await sous(db, "authenticated", J.client, `select donnees from public.portail_reponses where section='foyer'`)).rows[0].donnees;
  assert.deepEqual(w.enfants_liste, [{ prenom: "Léo", naissance: "2014-05-12" }]);
});
test("5. un second enregistrement met à jour le même brouillon (un seul brouillon par section)", async () => {
  const db = await base();
  await rpc(db, J.client, "flux", { revenus_nets_mois: "1000" }); await rpc(db, J.client, "flux", { revenus_nets_mois: "2000" });
  const n = await db.query(`select count(*)::int c, max(donnees->>'revenus_nets_mois') v from public.invest_portail_reponses where statut = 'brouillon'`);
  assert.equal(n.rows[0].c, 1); assert.equal(n.rows[0].v, "2000");
});
test("6. soumettre : statut « soumis » ; une nouvelle soumission remplace la précédente", async () => {
  const db = await base();
  await rpc(db, J.client, "flux", { revenus_nets_mois: "1000" }, true);
  await rpc(db, J.client, "flux", { revenus_nets_mois: "1500" }, true);
  const t = await db.query(`select statut, donnees->>'revenus_nets_mois' v from public.invest_portail_reponses order by cree_le`);
  assert.deepEqual(t.rows.map((r) => r.statut), ["remplace", "soumis"]);
  const v = await sous(db, "authenticated", J.client, `select statut, donnees->>'revenus_nets_mois' v from public.portail_reponses where section='flux'`);
  assert.equal(v.rows.length, 1); assert.equal(v.rows[0].statut, "soumis"); assert.equal(v.rows[0].v, "1500");
});
test("7. après soumission, un nouvel enregistrement ouvre un brouillon sans toucher à la réponse soumise", async () => {
  const db = await base();
  await rpc(db, J.client, "flux", { revenus_nets_mois: "1000" }, true);
  await rpc(db, J.client, "flux", { revenus_nets_mois: "1200" });
  const t = await db.query(`select statut from public.invest_portail_reponses order by cree_le`);
  assert.deepEqual(t.rows.map((r) => r.statut), ["soumis", "brouillon"]);
  const v = await sous(db, "authenticated", J.client, `select statut from public.portail_reponses where section='flux'`);
  assert.equal(v.rows[0].statut, "brouillon", "le brouillon en cours est montré en premier");
});
test("8. étanchéité : chaque client ne voit et n'écrit que ses propres réponses", async () => {
  const db = await base();
  await rpc(db, J.client, "flux", { revenus_nets_mois: "1111" }); await rpc(db, JB, "flux", { revenus_nets_mois: "2222" });
  const a = await sous(db, "authenticated", J.client, `select donnees->>'revenus_nets_mois' v from public.portail_reponses`);
  const b = await sous(db, "authenticated", JB, `select donnees->>'revenus_nets_mois' v from public.portail_reponses`);
  assert.deepEqual(a.rows.map((r) => r.v), ["1111"]); assert.deepEqual(b.rows.map((r) => r.v), ["2222"]);
});
test("9. refusé : collaborateur sans lien, compte libre, jeton falsifié, anonyme", async () => {
  const db = await base();
  for (const [nom, jt, role] of [["admin", J.admin, "authenticated"], ["libre", J.libre, "authenticated"], ["commercial falsifié", J.commercialFalsifie, "authenticated"], ["anonyme", {}, "anon"]]) {
    const r = await sous(db, role, jt, `select public.portail_enregistrer_reponse('flux', '{"revenus_nets_mois":"1"}'::jsonb, false)`);
    assert.ok(r.erreur, `${nom} doit être refusé`);
  }
  assert.equal((await db.query(`select count(*)::int c from public.invest_portail_reponses`)).rows[0].c, 0);
});
test("10. le client n'a aucun accès direct à la table (lecture, écriture, validation de sa propre réponse)", async () => {
  const db = await base();
  await rpc(db, J.client, "flux", { revenus_nets_mois: "1" }, true);
  assert.equal((await sous(db, "authenticated", J.client, `select * from public.invest_portail_reponses`)).rows.length, 0);
  for (const sql of [`insert into public.invest_portail_reponses (client_id, section, donnees) values ('${ID.cA}','flux','{}')`,
    `update public.invest_portail_reponses set statut = 'valide'`, `delete from public.invest_portail_reponses`]) {
    const r = await sous(db, "authenticated", J.client, sql);
    assert.ok(r.erreur || r.rows.length === 0, sql);
  }
  assert.equal((await db.query(`select statut from public.invest_portail_reponses`)).rows[0].statut, "soumis");
});
test("11. le collaborateur lit les réponses et les valide ; il n'insère ni ne supprime", async () => {
  const db = await base();
  await rpc(db, J.client, "flux", { revenus_nets_mois: "5000" }, true);
  const lu = await sous(db, "authenticated", J.commercial, `select donnees->>'revenus_nets_mois' v from public.invest_portail_reponses`);
  assert.deepEqual(lu.rows.map((r) => r.v), ["5000"]);
  const maj = await sous(db, "authenticated", J.commercial, `update public.invest_portail_reponses set statut='valide', traite_par='Commercial', traite_le=now() returning statut`);
  assert.equal(maj.rows[0].statut, "valide");
  const ins = await sous(db, "authenticated", J.commercial, `insert into public.invest_portail_reponses (client_id, section, donnees) values ('${ID.cA}','flux','{}')`);
  assert.ok(ins.erreur, "pas d'insertion directe");
  const sup = await sous(db, "authenticated", J.commercial, `delete from public.invest_portail_reponses returning id`);
  assert.ok(sup.erreur || sup.rows.length === 0, "pas de suppression");
});
test("12. contraintes : section et statut inconnus refusés par la base, taille de la réponse plafonnée", async () => {
  const db = await base();
  assert.ok((await sous(db, "authenticated", J.client, `select public.portail_enregistrer_reponse('admin', '{}'::jsonb, false)`)).erreur);
  assert.ok((await sous(db, "authenticated", J.client, `select public.portail_enregistrer_reponse('flux', '[1,2]'::jsonb, false)`)).erreur, "une réponse doit être un objet");
  await assert.rejects(db.query(`insert into public.invest_portail_reponses (client_id, section, donnees, statut) values ('${ID.cA}','flux','{}','nimporte')`));
});
test("13. valeurs connues de Profero : seulement les champs du schéma, jamais analyses ni notes ni conformité", async () => {
  const db = await base();
  const r = await sous(db, "authenticated", J.client, `select public.portail_donnees_dossier() as d`);
  const d = r.rows[0].d;
  assert.equal(d.foyer.situation_familiale, "Marié(e)"); assert.equal(d.flux.charges_logement, "1350"); assert.equal(d.patrimoine.liquidites, "28000");
  assert.equal(d.patrimoine.lots[0].valeur, "185000"); assert.equal(d.objectifs.objectifs_mesures[0].echeance, "2036");
  const texte = JSON.stringify(d);
  for (const interdit of ["NOTE INTERNE", "CONFIDENTIEL", "der_remis_le", "tmi", "valeur_acquisition", "taxe_fonciere", "notes_crm"]) assert.ok(!texte.includes(interdit), `fuite : ${interdit}`);
});
test("14. valeurs connues : un client sans dossier reçoit un objet vide ; refusé sans lien", async () => {
  const db = await base();
  const b = await sous(db, "authenticated", JB, `select public.portail_donnees_dossier() as d`);
  assert.deepEqual(b.rows[0].d, {});
  assert.ok((await sous(db, "authenticated", J.admin, `select public.portail_donnees_dossier()`)).erreur);
});
test("15. téléphone : modifiable par le client sur sa fiche uniquement, format contrôlé", async () => {
  const db = await base();
  assert.equal((await sous(db, "authenticated", J.client, `select public.portail_maj_telephone('06 12 34 56 78')`)).erreur, null);
  assert.equal((await db.query(`select telephone from public.invest_clients where id = '${ID.cA}'`)).rows[0].telephone, "06 12 34 56 78");
  assert.equal((await db.query(`select telephone from public.invest_clients where id <> '${ID.cA}' and telephone is not null`)).rows.length, 0, "les autres fiches ne bougent pas");
  for (const mauvais of ["abc", "'; drop table x;--", "1", ""]) assert.ok((await sous(db, "authenticated", J.client, `select public.portail_maj_telephone($1)`, [mauvais])).erreur, mauvais);
  assert.ok((await sous(db, "authenticated", J.admin, `select public.portail_maj_telephone('0600000000')`)).erreur);
});
test("16. le schéma JavaScript et celui de la base sont identiques (types, choix, plafonds)", async () => {
  const db = await base();
  const sql = (await db.query(`select public.portail_schema_reponses() as s`)).rows[0].s;
  assert.deepEqual(JSON.parse(JSON.stringify(C.schemaTechnique())), JSON.parse(JSON.stringify(sql)));
});
test("17. la lecture du dossier côté base et côté JavaScript donne les mêmes valeurs (aller-retour)", async () => {
  const db = await base();
  const d = (await sous(db, "authenticated", J.client, `select public.portail_donnees_dossier() as d`)).rows[0].d;
  for (const s of C.SECTIONS) {
    const attendu = Object.fromEntries(Object.entries(C.extraireSection(DOSSIER, s.cle)).filter(([k, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)));
    const recu = Object.fromEntries(Object.entries(d[s.cle]).filter(([, v]) => !(Array.isArray(v) && v.length === 0)));
    for (const [k, v] of Object.entries(recu)) {
      if (Array.isArray(v)) assert.deepEqual(v.map((e) => Object.keys(e).sort()), attendu[k].map((e) => Object.keys(Object.fromEntries(Object.entries(e).filter(([kk]) => k && Object.keys(C.SCHEMA[s.cle].listes[k].champs).includes(kk)))).sort()), `${s.cle}.${k}`);
      else assert.equal(v, String(attendu[k]), `${s.cle}.${k}`);
    }
  }
});
test("18. appliquer une réponse validée : champs renseignés remplacés, autres conservés, détails des biens conservés", () => {
  const rep = { lots: [{ adresse: "12 rue A", valeur: "190000", loyer_mois: "800" }], liquidites: "30000" };
  const apres = C.appliquerSection(DOSSIER, "patrimoine", rep);
  assert.equal(apres.collecte.patrimoine_financier.liquidites, "30000");
  assert.equal(apres.collecte.patrimoine.rp_valeur, "310000", "champ non envoyé : conservé");
  assert.equal(apres.collecte.patrimoine.lots[0].valeur, "190000");
  assert.equal(apres.collecte.patrimoine.lots[0].valeur_acquisition, "150000", "détail invisible du client : conservé");
  assert.equal(apres.collecte.patrimoine.lots[0].id, "x");
  assert.equal(DOSSIER.collecte.patrimoine.lots[0].valeur, "185000", "le dossier d'origine n'est pas modifié");
  assert.equal(apres.analyse.diagnostic, DOSSIER.analyse.diagnostic);
});
test("19. appliquer : un bien retiré par le client est retiré du dossier, et l'écart le signale", () => {
  const rep = { lots: [] };
  assert.equal(C.appliquerSection(DOSSIER, "patrimoine", rep).collecte.patrimoine.lots.length, 0);
  const e = C.ecarts(DOSSIER, "patrimoine", rep);
  assert.ok(e.some((x) => x.retrait && /retiré par le client/.test(x.apres)));
});
test("20. écarts : seules les différences sont listées, avec avant et après", () => {
  const e = C.ecarts(DOSSIER, "flux", { revenus_nets_mois: "5200", charges_logement: "1350", epargne_reelle_mois: "2400" });
  assert.deepEqual(e.map((x) => x.cle).sort(), ["epargne_reelle_mois", "revenus_nets_mois"]);
  const r = e.find((x) => x.cle === "revenus_nets_mois"); assert.ok(r.avant.startsWith("4800") && r.apres.startsWith("5200"));
});
test("21. retour arrière : tout disparaît proprement", async () => {
  const db = await base();
  await db.exec(ROLLBACK);
  const o = await db.query(`select (select count(*) from pg_proc where proname like 'portail_%reponse%' or proname in ('portail_donnees_dossier','portail_maj_telephone','portail_schema_reponses','portail_nettoyer_valeur'))::int f,
    (select count(*) from pg_class where relname in ('invest_portail_reponses','portail_reponses'))::int t`);
  assert.deepEqual(o.rows[0], { f: 0, t: 0 });
});

test("22. la vue d'accueil donne au client son propre téléphone, jamais celui d'un autre ; le retour arrière la remet à deux colonnes", async () => {
  const db = await base();
  await db.exec(`update public.invest_clients set telephone = '0611111111' where id = '${ID.cA}'; update public.invest_clients set telephone = '0622222222' where id <> '${ID.cA}'`);
  const a = await sous(db, "authenticated", J.client, `select prenom, telephone from public.portail_client`);
  assert.deepEqual(a.rows, [{ prenom: "Alice", telephone: "0611111111" }]);
  await db.exec(ROLLBACK);
  const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'portail_client' order by ordinal_position`)).rows.map((r) => r.column_name);
  assert.deepEqual(cols, ["prenom", "nom"]);
});

await lancer();
