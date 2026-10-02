#!/usr/bin/env node
// Vérifie src/Invest/structurationDonnees.mjs. Jeu de données : exemple issu des tests, données fictives.
import assert from "node:assert/strict";
import * as D from "../src/Invest/structurationDonnees.mjs";

const cas = [];
const test = (n, f) => cas.push([n, f]);
const proche = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

const BIEN = { valeur: "210000", valeur_acquisition: "180000", loyer_mois: "1000", vacance_pct: "5", charges_annuelles: "1200", taxe_fonciere: "900",
  assurance_pno: "200", entretien_annuel: "400", gestion_pct: "0", mensualite: "650", crd: "140000", apport_initial: "30000" };

test("1. un bien complet : rendements, cash-flow, valeur nette, plus-value", () => {
  const b = D.analyserBien(BIEN);
  proche(b.rendementBrut, 12000 / 180000);
  const encaisse = 12000 * 0.95, charges = 1200 + 900 + 200 + 400;
  proche(b.rendementNet, (encaisse - charges) / 180000);
  proche(b.cashflowMois, (encaisse - charges) / 12 - 650);
  assert.equal(b.valeurNette, 70000);
  assert.equal(b.plusValueLatente, 30000);
  proche(b.rentabiliteFondsPropres, (b.cashflowMois * 12) / 30000);
  assert.deepEqual(b.manquants, []);
});
test("2. une donnée manquante donne null et est nommée, jamais zéro", () => {
  const b = D.analyserBien({ loyer_mois: "800" });
  assert.equal(b.rendementBrut, null); assert.equal(b.cashflowMois, null); assert.equal(b.valeurNette, null);
  assert.ok(b.manquants.includes("prix d'acquisition") && b.manquants.includes("mensualité"));
  assert.equal(D.analyserBien({}).rentabiliteFondsPropres, null);
});
test("3. sans apport, pas de rentabilité des fonds propres (division impossible)", () => {
  assert.equal(D.analyserBien({ ...BIEN, apport_initial: "" }).rentabiliteFondsPropres, null);
  assert.equal(D.analyserBien({ ...BIEN, apport_initial: "0" }).rentabiliteFondsPropres, null);
});
test("4. la gestion locative se prélève sur les loyers encaissés, la vacance les réduit", () => {
  const sans = D.analyserBien({ ...BIEN, vacance_pct: "0", gestion_pct: "0" });
  const avec = D.analyserBien({ ...BIEN, vacance_pct: "0", gestion_pct: "8" });
  proche(sans.chargesAnnuelles - avec.chargesAnnuelles, -960);
  assert.ok(D.analyserBien({ ...BIEN, vacance_pct: "20" }).cashflowMois < sans.cashflowMois);
});
test("5. l'effort d'épargne n'existe que si le cash-flow est négatif", () => {
  assert.equal(D.analyserBien({ ...BIEN, mensualite: "300" }).effortEpargneMois, 0);
  assert.ok(D.analyserBien({ ...BIEN, mensualite: "1200" }).effortEpargneMois > 0);
});
test("6. dettes : capital et mensualités additionnés, dettes incomplètes comptées", () => {
  const r = D.analyserDettes([{ capital_restant: "10000", mensualite: "300" }, { capital_restant: "5000", mensualite: "" }]);
  assert.equal(r.capitalRestant, 15000); assert.equal(r.mensualites, 300); assert.equal(r.incompletes, 1);
});
test("7. capacité d'épargne : revenus + résultat des biens − charges − autres dettes ; revenus exceptionnels exclus", () => {
  const collecte = {
    profil: { revenus_nets_mois: "4000", revenus_conjoint_mois: "2000", dividendes_an: "6000", revenus_exceptionnels_an: "20000" },
    patrimoine: { lots: [BIEN] },
    charges: { logement: "1500", courantes: "1200", epargne_reelle_mois: "1000" },
    dettes: [{ capital_restant: "8000", mensualite: "200" }],
  };
  const f = D.analyserFlux(collecte);
  proche(f.revenusRecurrentsMois, 6500);
  const cf = D.analyserBien(BIEN).cashflowMois;
  proche(f.capaciteEpargneTheorique, 6500 + cf - 2700 - 200);
  proche(f.ecart, 1000 - f.capaciteEpargneTheorique);
  assert.equal(f.revenusExceptionnelsAn, 20000);
});
test("8. sans charges saisies, la capacité d'épargne est inconnue (pas une épargne maximale)", () => {
  const f = D.analyserFlux({ profil: { revenus_nets_mois: "4000" } });
  assert.equal(f.capaciteEpargneTheorique, null); assert.equal(f.ecart, null);
});
test("9. un bien incomplet est signalé dans les flux au lieu d'être compté à zéro en silence", () => {
  const f = D.analyserFlux({ profil: { revenus_nets_mois: "3000" }, charges: { logement: "800" }, patrimoine: { lots: [BIEN, { loyer_mois: "500" }] } });
  assert.equal(f.biensIncomplets, 1);
});
test("10. objectifs : exploitable = montant + échéance + priorité ; tri par priorité puis échéance", () => {
  const r = D.analyserObjectifs([
    { libelle: "A", montant: "2500", echeance: "2036", priorite: "2" },
    { libelle: "B", montant: "", echeance: "2030", priorite: "1" },
    { libelle: "C", montant: "300000", echeance: "2031", priorite: "1" },
  ]);
  assert.equal(r.exploitables, 2); assert.equal(r.incomplets, 1);
  assert.deepEqual(r.parPriorite.map((o) => o.libelle), ["B", "C", "A"]);
});
test("11. profil investisseur : 13 dimensions, complet seulement si toutes renseignées", () => {
  assert.equal(D.analyserProfilImmo({}).total, 13);
  const p = Object.fromEntries(D.DIMENSIONS_PROFIL_IMMO.map(([k]) => [k, "x"]));
  assert.equal(D.analyserProfilImmo(p).complet, true);
  assert.equal(D.analyserProfilImmo({ ...p, besoin_liquidite: "" }).complet, false);
});

let echecs = 0;
for (const [n, f] of cas) { try { await f(); console.log(`  ✓ ${n}`); } catch (e) { echecs++; console.log(`  ✗ ${n}\n      ${e.message}`); } }
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
