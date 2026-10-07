#!/usr/bin/env node
// Vérifie src/Invest/crm/crmQuotidien.mjs (CRM du suivi quotidien) et son câblage dans CrmV2.jsx / CrmCartes.jsx.
// Jeu de données : exemple issu des tests, données fictives. Aucune lecture de la base.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as Q from "../src/Invest/crm/crmQuotidien.mjs";

const cas = [];
const test = (n, f) => cas.push([n, f]);
const lire = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const sig = (o = {}) => ({ enRetard: false, bloquee: false, aujourdhui: false, attenteClient: false, sansAction: false, aFaireProfero: false, ...o });
const M = (id, signaux, extra = {}) => ({ dossierId: id, clientId: `c${id}`, client: `Client ${id}`, signaux: sig(signaux), conseiller: "Camille", responsable: "Camille", ...extra });
const moi = (nom) => /camille/i.test(String(nom || ""));

test("1. une mission est « à moi » si je suis son conseiller OU le responsable de sa prochaine action", () => {
  assert.equal(Q.missionEstAMoi(M(1, {}), moi), true);
  assert.equal(Q.missionEstAMoi(M(2, {}, { conseiller: "Tom", responsable: "Camille" }), moi), true);
  assert.equal(Q.missionEstAMoi(M(3, {}, { conseiller: "Camille", responsable: "Tom" }), moi), true);
  assert.equal(Q.missionEstAMoi(M(4, {}, { conseiller: "Tom", responsable: "Tom" }), moi), false);
  assert.equal(Q.missionEstAMoi(M(5, {}, { conseiller: null, responsable: null }), moi), false);
});
test("2. quatre groupes, une mission dans UN seul, dans l'ordre urgent > aujourd'hui > à faire > attente", () => {
  const g = Q.repartirQuotidien([M(1, { enRetard: true, aujourdhui: true }), M(2, { bloquee: true }), M(3, { aujourdhui: true, aFaireProfero: true }), M(4, { aFaireProfero: true }), M(5, { sansAction: true }), M(6, { attenteClient: true })]);
  assert.deepEqual(g.map((x) => x.cle), ["urgent", "aujourdhui", "a_faire", "attente"]);
  assert.deepEqual(g.map((x) => x.missions.map((m) => m.dossierId)), [[1, 2], [3], [4, 5], [6]]);
});
test("3. une mission sans signal (échéance lointaine) n'est dans aucun groupe : on ne la montre pas inutilement", () => {
  const g = Q.repartirQuotidien([M(1, {})]);
  assert.equal(g.reduce((s, x) => s + x.missions.length, 0), 0);
});
test("4. le périmètre « moi » ne contient que les clients dont je suis conseiller ou qui ont une mission à moi", () => {
  const lignes = [{ id: "a", conseiller: "Camille", missions: [] }, { id: "b", conseiller: "Tom", missions: [{ dossierId: 9 }] }, { id: "c", conseiller: "Tom", missions: [{ dossierId: 7 }] }, { id: "d", conseiller: null, missions: [] }];
  const r = Q.clientsDuPerimetre(lignes, new Set([9]), moi);
  assert.deepEqual(r.map((x) => x.id), ["a", "b"]);
});
test("5. périmètre par défaut : « moi » seulement si j'ai des missions, sinon l'équipe ; un choix explicite est respecté", () => {
  assert.equal(Q.perimetreEffectif(null, 3), "moi");
  assert.equal(Q.perimetreEffectif(null, 0), "equipe");
  assert.equal(Q.perimetreEffectif("equipe", 3), "equipe");
  assert.equal(Q.perimetreEffectif("moi", 0), "moi");
});
test("6. câblage : l'écran passe par le périmètre, ne montre plus le portail ni les filtres fins, et n'écrit rien", () => {
  const V2 = lire("src/Invest/crm/CrmV2.jsx"), L = lire("src/Invest/crm/CrmCartes.jsx");
  assert.match(V2, /missionEstAMoi\(m, estMoi\)/); assert.match(V2, /perimetreEffectif\(perimetreChoisi, missionsMoi\.length\)/);
  assert.match(V2, /<ATraiterListe[^>]*perimetre=\{perimetre\}/); assert.match(V2, /<ClientsListe[^>]*perimetre=\{perimetre\}/);
  assert.ok(!/AccesPortail|Inviter au portail|invest_portail_comptes/.test(L + V2), "l'invitation au portail reste dans la fiche client");
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(L + V2));
  assert.match(L, /onMission\(m\.clientId, m\.dossierId\)/); assert.match(L, /onClient\(l\.id\)/);
});
test("7. fiche client : cinq onglets, plus d'« Opérations », plus de bloc « Plus d'informations », rubriques sans numéros", () => {
  const F = ["FicheClientV2", "FicheEnsemble", "FicheMissions", "FichePatrimoine", "FicheDocuments", "FicheActivite"].map((f) => lire(`src/Invest/crm/${f}.jsx`)).join("\n");
  assert.match(F, /onglets=\{ONGLETS_CLIENT\}/);
  assert.ok(!/operations/.test(lire("src/Invest/crm/crmV2Vue.mjs").split("ONGLET_HERITE")[0]), "plus d'onglet Opérations");
  assert.ok(!/<details[\s\S]*Plus d'informations/.test(F));
  assert.ok(!/titre="[123] ·/.test(F) && !/titre=\{`1 ·/.test(F), "plus de rubriques numérotées");
});

let echecs = 0;
for (const [n, f] of cas) { try { await f(); console.log(`  ✓ ${n}`); } catch (e) { echecs++; console.log(`  ✗ ${n}\n      ${e.message}`); } }
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
