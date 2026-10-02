#!/usr/bin/env node
// Vérifie src/Invest/structurationDiagnostic.mjs. Jeu de données : exemple issu des tests, données fictives.
import assert from "node:assert/strict";
import * as G from "../src/Invest/structurationDiagnostic.mjs";

const cas = [];
const test = (n, f) => cas.push([n, f]);
const proche = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

const DOSSIER = {
  collecte: {
    profil: { revenus_nets_mois: "5000", revenus_conjoint_mois: "2000", situation_familiale: "Marié", tmi: "30 %" },
    patrimoine: { rp_valeur: "300000", rp_crd: "150000",
      lots: [{ adresse: "12 rue A", valeur: "200000", valeur_acquisition: "170000", loyer_mois: "1000", mensualite: "700", crd: "120000", structure: "PP direct" }] },
    patrimoine_financier: { liquidites: "30000", assurance_vie: "40000" },
    charges: { logement: "1200", courantes: "1500", epargne_reelle_mois: "1500" },
    dettes: [{ capital_restant: "10000", mensualite: "300" }],
  },
};

test("1. situation : brut = biens + résidence + financier ; net = brut − toutes les dettes", () => {
  const s = G.situation(DOSSIER);
  assert.equal(s.patrimoineBrut, 200000 + 300000 + 30000 + 40000);
  assert.equal(s.dettes, 120000 + 150000 + 10000);
  assert.equal(s.patrimoineNet, s.patrimoineBrut - 280000);
  proche(s.composition.partImmobilier, 500000 / 570000);
  assert.equal(s.mensualitesTotal, 700 + 300);
});
test("2. le total de mensualités saisi à la main prime, comme dans l'écran existant", () => {
  const d = structuredClone(DOSSIER); d.collecte.financement = { mensualites_total: "2500" };
  assert.equal(G.situation(d).mensualitesTotal, 2500);
});
test("3. résidence secondaire et patrimoine professionnel : signalés, pas ajoutés en silence", () => {
  const d = structuredClone(DOSSIER); d.collecte.patrimoine.residence_secondaire_valeur = "90000";
  const s = G.situation(d);
  assert.deepEqual(s.nonCompte, ["résidence secondaire"]);
  assert.equal(s.patrimoineBrut, G.situation(DOSSIER).patrimoineBrut);
});
test("4. mensualité et capital empruntable sont des fonctions réciproques", () => {
  const m = G.mensualitePret(200000, 3.6, 20);
  proche(G.capitalPourMensualite(m, 3.6, 20), 200000, 1e-4);
  assert.equal(G.mensualitePret(null, 3, 20), null);
  proche(G.mensualitePret(120000, 0, 10), 1000);
});
test("5. trajectoire : « Aujourd'hui » puis une ligne par opération, l'endettement monte, la marge baisse", () => {
  const t = G.trajectoireCapacite(DOSSIER, [{ prix: "200000", apport: "20000", loyer_mois: "900", libelle: "T3" }, { prix: "150000", apport: "0", loyer_mois: "700" }]);
  assert.equal(t.etapes.length, 3);
  assert.ok(t.etapes[1].tauxEndettement > t.etapes[0].tauxEndettement);
  assert.ok(t.etapes[1].mensualiteDisponible < t.etapes[0].mensualiteDisponible);
  assert.ok(t.etapes[2].mensualitesTotal > t.etapes[1].mensualitesTotal);
  assert.match(t.etapes[1].libelle, /opération 1 — T3/);
});
test("6. le plafond d'endettement se lit : « dans la norme » / « limite » / « au-dessus du plafond »", () => {
  const lecture = (plafond) => G.trajectoireCapacite(DOSSIER, [], { plafondEndettement: plafond }).etapes[0].lecture;
  assert.equal(lecture(35), "dans la norme");
  assert.equal(lecture(1), "au-dessus du plafond");
  const taux = G.trajectoireCapacite(DOSSIER).etapes[0].tauxEndettement * 100;
  assert.equal(lecture(taux * 1.05), "limite");
});
test("7. une opération sans prix est signalée incomplète et n'ajoute rien", () => {
  const t = G.trajectoireCapacite(DOSSIER, [{ libelle: "?", apport: "1000" }]);
  assert.equal(t.etapes[1].incomplete, true);
  assert.equal(t.etapes[1].mensualitesTotal, t.etapes[0].mensualitesTotal);
});
test("8. sans revenus, taux et capacité sont non calculables (null), pas zéro", () => {
  const t = G.trajectoireCapacite({ collecte: {} });
  assert.equal(t.etapes[0].tauxEndettement, null); assert.equal(t.etapes[0].mensualiteDisponible, null); assert.equal(t.etapes[0].lecture, "non calculable");
});
test("9. SWOT : concentration immobilière détectée avec son chiffre ; capacité bancaire en opportunité", () => {
  const sw = G.analyserSwot(DOSSIER);
  assert.ok(sw.faiblesses.some((x) => /concentré/.test(x.titre) && /88 %/.test(x.detail)));
  assert.ok(sw.opportunites.some((x) => /Capacité bancaire/.test(x.titre)));
});
test("10. SWOT : plus-value latente en SCI IS = risque avec renvoi aux professionnels", () => {
  const d = structuredClone(DOSSIER); d.collecte.patrimoine.lots[0].structure = "SCI IS"; d.collecte.patrimoine.lots[0].valeur_acquisition = "120000";
  const r = G.analyserSwot(d).risques.find((x) => /SCI à l'IS/.test(x.titre));
  assert.ok(r && /notaire/.test(r.detail));
});
test("11. SWOT : effort d'épargne et protection du conjoint non documentée", () => {
  const d = structuredClone(DOSSIER); d.collecte.patrimoine.lots[0].mensualite = "1500";
  const sw = G.analyserSwot(d);
  assert.ok(sw.risques.some((x) => /Effort d'épargne/.test(x.titre)));
  assert.ok(sw.risques.some((x) => /conjoint/.test(x.titre)));
  d.collecte.situation_familiale_detail = { testament_donation: "Donation entre époux" };
  assert.ok(!G.analyserSwot(d).risques.some((x) => /conjoint/.test(x.titre)));
});
test("12. SWOT : donnée manquante = règle muette (dossier vide : aucune conclusion inventée)", () => {
  const sw = G.analyserSwot({ collecte: {} });
  assert.deepEqual(Object.values(sw).map((l) => l.length), [0, 0, 0, 0]);
});
test("13. réserve de sécurité : faiblesse sous 3 mois, force au-delà de la cible", () => {
  const d = structuredClone(DOSSIER);
  d.collecte.patrimoine_financier.liquidites = "2000";
  assert.ok(G.analyserSwot(d).faiblesses.some((x) => /Réserve/.test(x.titre)));
  d.collecte.patrimoine_financier.liquidites = "80000";
  assert.ok(G.analyserSwot(d).forces.some((x) => /Réserve/.test(x.titre)));
});
test("14. texte de synthèse : contient le net et la mention « avant impôt »", () => {
  const t = G.texteSynthese(DOSSIER);
  assert.match(t, /patrimoine net/); assert.match(t, /avant impôt/);
});

let echecs = 0;
for (const [n, f] of cas) { try { await f(); console.log(`  ✓ ${n}`); } catch (e) { echecs++; console.log(`  ✗ ${n}\n      ${e.message}`); } }
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
