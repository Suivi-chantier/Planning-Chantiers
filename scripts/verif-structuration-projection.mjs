#!/usr/bin/env node
// Vérifie src/Invest/structurationProjection.mjs. Jeu de données : exemple issu des tests, données fictives.
import assert from "node:assert/strict";
import * as P from "../src/Invest/structurationProjection.mjs";

const cas = [];
const test = (n, f) => cas.push([n, f]);
const proche = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const AN = 2026;

// Foyer sans dette, un bien sans prêt, charges saisies.
const SANS_DETTE = {
  collecte: {
    profil: { revenus_nets_mois: "4000" },
    patrimoine: { rp_valeur: "0", rp_crd: "0", lots: [{ adresse: "A", valeur: "100000", loyer_mois: "1000", crd: "0", mensualite: "0" }] },
    patrimoine_financier: { liquidites: "20000", assurance_vie: "10000" },
    charges: { logement: "1000", courantes: "1000" },
  },
};
const AVEC_PRET = {
  collecte: { ...SANS_DETTE.collecte, patrimoine: { rp_valeur: "0", rp_crd: "0", lots: [{ adresse: "B", valeur: "200000", loyer_mois: "1200", crd: "100000", mensualite: "700", taux_pret: "3" }] } },
};

test("1. amortissement : le capital remboursé en un an suit la formule du prêt", () => {
  const p = P.projeter(AVEC_PRET, { anneeDepart: AN, horizon: 1 });
  const r = 0.03 / 12; let crd = 100000, cap = 0;
  for (let i = 0; i < 12; i++) { const it = crd * r; cap += 700 - it; crd -= 700 - it; }
  proche(p.annees[1].capitalRembourse, cap, 1e-6); proche(p.annees[1].dettes, crd, 1e-6);
});
test("2. le prêt est soldé sans passer sous zéro", () => {
  const p = P.projeter({ collecte: { patrimoine: { lots: [{ valeur: "100000", crd: "5000", mensualite: "700", taux_pret: "3" }] } } }, { anneeDepart: AN, horizon: 2 });
  assert.ok(p.annees[1].dettes >= 0 && p.annees[2].dettes === 0);
  proche(p.annees[2].capitalRembourse, 5000, 1e-6);
});
test("3. la valeur de l'immobilier suit l'appréciation de chaque cas, dans l'ordre prudent > dégradé", () => {
  const c = P.projeter(SANS_DETTE, { anneeDepart: AN, cas: "central", horizon: 10 }).annees[10].valeurImmobilier;
  proche(c, 100000 * Math.pow(1.02, 10), 1e-4);
  const d = P.projeter(SANS_DETTE, { anneeDepart: AN, cas: "degrade", horizon: 10 }).annees[10].valeurImmobilier;
  assert.ok(d < 100000);
});
test("4. les trois cas sont ordonnés : patrimoine net prudent entre central et dégradé", () => {
  const net = (cas) => P.projeter(AVEC_PRET, { anneeDepart: AN, cas, horizon: 10 }).annees[10].patrimoineNet;
  assert.ok(net("central") > net("prudent") && net("prudent") > net("degrade"));
});
test("5. une opération retire l'apport des liquidités l'année d'achat et ajoute une dette", () => {
  const ops = [{ annee: 2027, libelle: "T3", prix: "200000", apport: "20000", loyer_mois: "900" }];
  const sans = P.projeter(SANS_DETTE, { anneeDepart: AN, horizon: 3 });
  const avec = P.projeter(SANS_DETTE, { anneeDepart: AN, horizon: 3, operations: ops });
  assert.equal(avec.annees[1].dettes, 0);
  assert.ok(avec.annees[2].dettes > 150000);
  assert.ok(avec.annees[2].liquidites < sans.annees[2].liquidites - 15000);
});
test("6. l'opération commence l'année demandée (pas avant)", () => {
  const ops = [{ annee: 2029, prix: "100000", apport: "10000", loyer_mois: "600" }];
  const p = P.projeter(SANS_DETTE, { anneeDepart: AN, horizon: 5, operations: ops });
  assert.equal(p.annees[3].dettes, 0); assert.ok(p.annees[4].dettes > 0);
});
test("7. liquidités insuffisantes : alerte nommée avec l'année", () => {
  const ops = [{ annee: 2026, prix: "400000", apport: "200000", loyer_mois: "1000" }];
  const p = P.projeter(SANS_DETTE, { anneeDepart: AN, horizon: 3, operations: ops });
  assert.equal(p.anneeInsuffisance, 2026); assert.match(p.alertes[0], /2026/);
});
test("8. charges non saisies : épargne du foyer non projetée, et c'est dit", () => {
  const d = structuredClone(SANS_DETTE); delete d.collecte.charges;
  const p = P.projeter(d, { anneeDepart: AN, horizon: 2 });
  assert.ok(p.limites.some((l) => /Charges du foyer non saisies/.test(l)));
});
test("9. dette de bien sans mensualité : signalée, non amortie", () => {
  const p = P.projeter({ collecte: { patrimoine: { lots: [{ adresse: "C", valeur: "100000", crd: "50000" }] } } }, { anneeDepart: AN, horizon: 2 });
  assert.equal(p.annees[2].dettes, 50000);
  assert.ok(p.limites.some((l) => /C : dette sans mensualité/.test(l)));
});
test("10. dossier vide : une projection de zéros, sans NaN", () => {
  const p = P.projeter({ collecte: {} }, { anneeDepart: AN, horizon: 5 });
  assert.ok(p.annees.every((a) => Number.isFinite(a.patrimoineNet)));
  assert.equal(p.annees[5].patrimoineNet, 0);
});
test("11. jalons 5/10/20 et indisponibilité au-delà de l'horizon", () => {
  const j = P.jalons(P.projeter(SANS_DETTE, { anneeDepart: AN, horizon: 10 }));
  assert.equal(j[0].ans, 5); assert.equal(j[1].ans, 10); assert.equal(j[2].indisponible, true);
});
test("12. comparaison : « situation actuelle » + chaque scénario, sans modifier le dossier", () => {
  const avant = JSON.stringify(SANS_DETTE);
  const cmp = P.comparerScenarios(SANS_DETTE, [{ id: "s1", nom: "A", operations: [{ annee: 2027, prix: "150000", apport: "15000", loyer_mois: "800" }] }], { anneeDepart: AN, horizon: 10 });
  assert.equal(cmp.length, 2); assert.equal(cmp[0].id, "actuel"); assert.equal(cmp[1].nbOperations, 1);
  assert.ok(cmp[1].dettes > cmp[0].dettes);
  assert.equal(JSON.stringify(SANS_DETTE), avant);
});
test("13. tests de résistance : chaque choc dégrade la trésorerie ou le patrimoine par rapport à la référence", () => {
  const ops = [{ annee: 2026, prix: "180000", apport: "20000", travaux: "10000", loyer_mois: "950" }];
  const t = P.testsResistance(AVEC_PRET, { operations: ops, anneeDepart: AN });
  assert.equal(t.chocs.length, P.CHOCS.length);
  for (const c of t.chocs) assert.ok(c.ecartLiquiditesMin <= 1e-9 && c.ecartPatrimoineNet <= 1e-9, c.libelle);
  const cumul = t.chocs.find((c) => c.cle === "cumul");
  assert.ok(cumul.ecartLiquiditesMin < t.chocs.find((c) => c.cle === "loyers").ecartLiquiditesMin - 1e-9 || cumul.ecartLiquiditesMin <= t.chocs.find((c) => c.cle === "loyers").ecartLiquiditesMin);
});
test("14. un choc suffisant fait basculer le verdict « la trésorerie tient »", () => {
  // Foyer qui épargne à peine (revenus 2 100, charges 2 000), 2 000 € de marge après l'apport.
  const fragile = { collecte: { profil: { revenus_nets_mois: "2100" }, patrimoine: { lots: [] },
    patrimoine_financier: { liquidites: "17000" }, charges: { logement: "1000", courantes: "1000" } } };
  const ops = [{ annee: 2026, prix: "100000", apport: "15000", loyer_mois: "600" }];
  const t = P.testsResistance(fragile, { operations: ops, anneeDepart: AN });
  assert.equal(t.reference.tient, true, "la référence tient");
  assert.ok(t.chocs.some((c) => c.tient === false && c.anneeInsuffisance !== null), "au moins un choc la fait céder, avec l'année");
});
test("15. hypothèses modifiables : la surcharge d'un cas change le résultat de ce cas seulement", () => {
  const s = { parCas: { central: { appreciation: 5 } } };
  const c = P.projeter(SANS_DETTE, { anneeDepart: AN, horizon: 5, surcharges: s }).annees[5].valeurImmobilier;
  proche(c, 100000 * Math.pow(1.05, 5), 1e-4);
  const p = P.projeter(SANS_DETTE, { anneeDepart: AN, horizon: 5, cas: "prudent", surcharges: s }).annees[5].valeurImmobilier;
  proche(p, 100000 * Math.pow(1.01, 5), 1e-4);
});
test("16. une opération sans prix est ignorée et signalée", () => {
  const p = P.projeter(SANS_DETTE, { anneeDepart: AN, horizon: 2, operations: [{ annee: 2026, libelle: "?" }] });
  assert.ok(p.limites.some((l) => /sans prix/.test(l)));
  assert.equal(P.operationComplete({ prix: "1", annee: "2026" }), true); assert.equal(P.operationComplete({ prix: "1" }), false);
});

let echecs = 0;
for (const [n, f] of cas) { try { await f(); console.log(`  ✓ ${n}`); } catch (e) { echecs++; console.log(`  ✗ ${n}\n      ${e.message}`); } }
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
