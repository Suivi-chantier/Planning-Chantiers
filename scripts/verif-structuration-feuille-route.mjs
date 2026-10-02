#!/usr/bin/env node
// Vérifie src/Invest/structurationFeuilleRoute.mjs. Jeu de données : exemple issu des tests, données fictives.
import assert from "node:assert/strict";
import * as F from "../src/Invest/structurationFeuilleRoute.mjs";

const cas = [];
const test = (n, f) => cas.push([n, f]);
const AN = 2026;
const DOSSIER = () => ({
  collecte: {
    profil: { revenus_nets_mois: "5000" },
    patrimoine: { lots: [{ valeur: "100000", loyer_mois: "600", mensualite: "400", crd: "60000" }] },
    patrimoine_financier: { liquidites: "5000" },
    charges: { logement: "1000", courantes: "1000" },
    objectifs_mesures: [{ id: "o1", libelle: "2 500 €/mois de revenus nets", montant: "2500", echeance: "2036", priorite: "1", flexibilite: "Souple" }, { id: "o2", libelle: "Études", echeance: "2040" }],
  },
  scenarios_chiffres: [{ id: "s1", nom: "Équilibré", operations: [
    { id: "a", annee: "2027", libelle: "Immeuble de rapport", prix: "180000", apport: "20000", loyer_mois: "1100" },
    { id: "b", annee: "2029", libelle: "T3 patrimonial", prix: "200000", apport: "25000", loyer_mois: "900" },
    { id: "c", libelle: "sans année", prix: "1" },
  ] }],
  scenario_retenu_id: "s1",
  mise_en_oeuvre: { actions: [{ titre: "Créer la SCI", echeance: "2027-02-15", responsable: "Notaire", statut: "En cours", dependance: "Accord du client" }, { titre: "", echeance: "2027-03-01" }],
    intervenants: [{ role: "Notaire", nom: "Me X", statut: "À contacter" }, { role: "Banque / courtier", statut: "Mandaté" }], prochaine_revue_le: "2027-10-01" },
});

test("1. sans scénario retenu : aucune opération déduite et le manque est nommé", () => {
  const d = DOSSIER(); delete d.scenario_retenu_id;
  const r = F.construireFeuilleRoute(d, { anneeDepart: AN });
  assert.equal(r.scenario, null); assert.ok(r.manquants[0].includes("scénario retenu"));
  assert.ok(!r.items.some((i) => i.type === "operation"));
});
test("2. le scénario retenu donne, pour chaque opération datée, un point bancaire puis l'acquisition", () => {
  const r = F.construireFeuilleRoute(DOSSIER(), { anneeDepart: AN });
  const ops = r.items.filter((i) => i.type === "operation");
  assert.deepEqual(ops.map((o) => o.annee), [2027, 2029]);
  assert.ok(r.items.some((i) => /Point bancaire avant Immeuble de rapport/.test(i.titre)));
  assert.match(ops[0].detail, /rendement brut visé 7,3 %/);
});
test("3. une opération sans année n'entre pas dans la feuille de route", () => {
  const r = F.construireFeuilleRoute(DOSSIER(), { anneeDepart: AN });
  assert.ok(!r.items.some((i) => /sans année/.test(i.titre)));
});
test("4. dépendances : la 2e opération dépend de la 1re ; la 1re de la réserve si elle est à constituer", () => {
  const r = F.construireFeuilleRoute(DOSSIER(), { anneeDepart: AN });
  const pb = r.items.filter((i) => /Point bancaire/.test(i.titre));
  assert.equal(pb[0].dependance, "Réserve de sécurité constituée");
  assert.equal(pb[1].dependance, "Après Immeuble de rapport");
});
test("5. réserve : proposée si les liquidités sont sous la cible, avec un montant arrondi au millier", () => {
  const r = F.construireFeuilleRoute(DOSSIER(), { anneeDepart: AN });
  const res = r.items.find((i) => i.type === "reserve");
  assert.ok(res && r.besoinReserve % 1000 === 0 && r.besoinReserve > 0);
  const riche = DOSSIER(); riche.collecte.patrimoine_financier.liquidites = "500000";
  assert.ok(!F.construireFeuilleRoute(riche, { anneeDepart: AN }).items.some((i) => i.type === "reserve"));
  const inconnu = DOSSIER(); delete inconnu.collecte.charges; inconnu.collecte.patrimoine.lots = [];
  assert.ok(!F.construireFeuilleRoute(inconnu, { anneeDepart: AN }).items.some((i) => i.type === "reserve"), "dépenses inconnues : rien d'inventé");
});
test("6. objectifs : jalons à leur échéance, triés par priorité ; un objectif sans échéance n'a pas de ligne", () => {
  const r = F.construireFeuilleRoute(DOSSIER(), { anneeDepart: AN });
  const obj = r.items.filter((i) => i.type === "objectif");
  assert.deepEqual(obj.map((o) => o.annee), [2036, 2040]);
  assert.match(obj[0].detail, /2\s?500 €/);
});
test("7. actions de mise en œuvre : année de l'échéance, dépendance conservée, ligne vide ignorée", () => {
  const r = F.construireFeuilleRoute(DOSSIER(), { anneeDepart: AN });
  const a = r.items.find((i) => i.titre === "Créer la SCI");
  assert.equal(a.annee, 2027); assert.equal(a.dependance, "Accord du client"); assert.equal(a.statut, "En cours");
  assert.equal(r.items.filter((i) => i.source === "mise_en_oeuvre" && i.titre === "").length, 0);
});
test("8. intervenants : seuls ceux « à contacter » deviennent une action ; la revue est planifiée", () => {
  const r = F.construireFeuilleRoute(DOSSIER(), { anneeDepart: AN });
  assert.ok(r.items.some((i) => /Contacter notaire \(Me X\)/.test(i.titre)));
  assert.ok(!r.items.some((i) => /Contacter banque/.test(i.titre)));
  assert.equal(r.items.find((i) => i.type === "revue").annee, 2027);
});
test("9. regroupement par année croissante, et dans une année : réserve, actions, acquisition, objectifs, revue", () => {
  const r = F.construireFeuilleRoute(DOSSIER(), { anneeDepart: AN });
  const annees = r.parAnnee.map((g) => g.annee);
  assert.deepEqual(annees, [...annees].sort((a, b) => a - b));
  const g2027 = r.parAnnee.find((g) => g.annee === 2027).items.map((i) => i.type);
  assert.ok(g2027.indexOf("action") < g2027.indexOf("operation") && g2027.indexOf("operation") < g2027.indexOf("revue"));
});
test("10. alertes : opération antérieure à l'année de départ, plusieurs opérations la même année", () => {
  const d = DOSSIER(); d.scenarios_chiffres[0].operations = [{ annee: "2024", libelle: "Vieille", prix: "1" }, { annee: "2027", libelle: "A", prix: "1" }, { annee: "2027", libelle: "B", prix: "1" }];
  const r = F.construireFeuilleRoute(d, { anneeDepart: AN });
  assert.ok(r.alertes.some((a) => /avant 2026/.test(a))); assert.ok(r.alertes.some((a) => /2 opérations en 2027/.test(a)));
});
test("11. dossier vide : feuille de route vide, sans erreur", () => {
  const r = F.construireFeuilleRoute({ collecte: {} }, { anneeDepart: AN });
  assert.equal(r.items.length, 0); assert.equal(r.scenario, null);
});

let echecs = 0;
for (const [n, f] of cas) { try { await f(); console.log(`  ✓ ${n}`); } catch (e) { echecs++; console.log(`  ✗ ${n}\n      ${e.message}`); } }
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
