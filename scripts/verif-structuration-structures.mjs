#!/usr/bin/env node
// Vérifie src/Invest/structurationStructures.mjs. Jeu de données : exemple issu des tests, données fictives.
// Les valeurs attendues sont calculées à la main à partir des règles du module (voir son en-tête).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../src/Invest/structurationStructures.mjs";

const cas = [];
const test = (n, f) => cas.push([n, f]);
const proche = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const dossier = (tmi = "30 %", extra = {}) => ({ collecte: { profil: { tmi, revenus_nets_mois: "6000", ...extra } } });
const OP = { prix: "100000", apport: "100000", loyer_mois: "1000" };   // sans prêt : les chiffres se calculent à la main
const get = (r, cle) => r.structures.find((x) => x.cle === cle);

test("1. abattements pour durée de détention (particuliers) : 6e année, 21e, 22e, 30e", () => {
  assert.deepEqual(S.abattementsDuree(5), { ir: 0, ps: 0 });
  assert.deepEqual(S.abattementsDuree(6), { ir: 6, ps: 1.65 });
  proche(S.abattementsDuree(21).ir, 96, 1e-9); proche(S.abattementsDuree(21).ps, 26.4, 1e-9);
  assert.equal(S.abattementsDuree(22).ir, 100); proche(S.abattementsDuree(22).ps, 28, 1e-9);
  assert.equal(S.abattementsDuree(30).ps, 100);
});
test("2. impôt sur les sociétés : 15 % jusqu'à 42 500 €, 25 % au-delà", () => {
  proche(S.impotSocietes(42500), 6375); proche(S.impotSocietes(100000), 6375 + 14375); assert.equal(S.impotSocietes(-5000), 0);
});
test("3. la TMI se lit « 30 % » ; une valeur non chiffrée est inconnue", () => {
  assert.equal(S.lireTmi("30 %"), 30); assert.equal(S.lireTmi("À vérifier"), null); assert.equal(S.lireTmi(""), null); assert.equal(S.lireTmi("90 %"), null);
});
test("4. sans prix, sans loyer ou sans TMI : aucune comparaison, les manques sont nommés", () => {
  const r = S.comparerStructures({ collecte: {} }, {});
  assert.equal(r.structures.length, 0);
  assert.deepEqual(r.manquants, ["prix de l'acquisition", "loyer attendu", "tranche marginale d'imposition (TMI) du foyer"]);
  assert.equal(S.comparerStructures({ collecte: {} }, OP, { parametres: { tmi: "30 %" } }).structures.length, 4);
});
test("5. location nue sans prêt, année 1 : micro-foncier (70 % des recettes) retenu quand il est plus favorable", () => {
  const r = get(S.comparerStructures(dossier(), OP), "nom_propre_nu");
  assert.equal(r.regime, "micro");
  proche(r.annees[0].impot, 11400 * 0.7 * 0.472);
});
test("6. déficit foncier : le déficit hors intérêts s'impute sur le revenu global (économie = déficit × TMI)", () => {
  // SCI à l'IR, recettes 570, charges 150, frais de comptabilité 600 : déficit 180, tout hors intérêts.
  const r = get(S.comparerStructures(dossier(), { prix: "100000", apport: "100000", loyer_mois: "50" }), "sci_ir");
  proche(r.annees[0].impot, -180 * 0.30);
});
test("7. déficit foncier dû aux intérêts : pas d'imputation sur le revenu global, impôt nul", () => {
  const r = get(S.comparerStructures(dossier(), { prix: "300000", apport: "0", loyer_mois: "600" }), "sci_ir");
  assert.equal(r.annees[0].impot, 0);
});
test("8. SCI à l'IS sans prêt, année 1 : 15 % du résultat après charges, frais et amortissement", () => {
  const r = get(S.comparerStructures(dossier(), OP), "sci_is");
  const amort = (100000 * 0.85) / 30;
  proche(r.annees[0].impot, (11400 - 3000 - 1500 - amort) * 0.15);
});
test("9. plus-value d'un particulier à 10 ans (nom propre, sans amortissement)", () => {
  const r = get(S.comparerStructures(dossier(), { ...OP, loyer_mois: "50" }), "nom_propre_nu");
  const vente = 100000 * Math.pow(1.02, 10), pv = vente - 107500;
  const impot = pv * 0.7 * 0.19 + pv * (1 - 0.0825) * 0.172;
  proche(r.sortie.impotSortie, impot, 0.5);
});
test("10. LMNP au réel : les amortissements sont réintégrés dans la plus-value (depuis le 15/02/2025)", () => {
  const r = S.comparerStructures(dossier(), { ...OP, loyer_mois: "1500" });
  const l = get(r, "lmnp");
  if (l.regime === "reel") assert.match(l.sortie.detail, /Amortissements réintégrés/);
  const reel = S.comparerStructures(dossier(), { ...OP, loyer_mois: "8000" });   // recettes > 77 700 € : le micro-BIC n'est plus ouvert
  const lr = get(reel, "lmnp");
  assert.equal(lr.regime, "reel"); assert.match(lr.sortie.detail, /Amortissements réintégrés/);
});
test("11. SCI à l'IS : plus-value sur valeur nette comptable puis impôt de distribution (double imposition)", () => {
  const r = get(S.comparerStructures(dossier(), OP), "sci_is");
  assert.ok(r.sortie.impotSociete > 0 && r.sortie.impotDistribution > 0);
  proche(r.sortie.impotSortie, r.sortie.impotSociete + r.sortie.impotDistribution, 1e-6);
  assert.match(r.sortie.detail, /valeur nette comptable/);
});
test("12. bascule en LMP signalée au-delà de 23 000 € de recettes et des autres revenus professionnels", () => {
  const faibleRevenu = S.comparerStructures({ collecte: { profil: { tmi: "30 %", revenus_nets_mois: "1000" } } }, { ...OP, loyer_mois: "3000" });
  assert.ok(get(faibleRevenu, "lmnp").alertes.some((a) => /LMP/.test(a)));
  const fortRevenu = S.comparerStructures({ collecte: { profil: { tmi: "30 %", revenus_nets_mois: "9000" } } }, { ...OP, loyer_mois: "3000" });
  assert.ok(!get(fortRevenu, "lmnp").alertes.some((a) => /LMP/.test(a)));
});
test("13. identité : gain net = cash-flow cumulé après impôt + (vente − dette) − apport − impôt de sortie", () => {
  const r = S.comparerStructures(dossier(), { prix: "200000", apport: "30000", loyer_mois: "1100", taux: "3.5", duree: "20" });
  for (const s of r.structures) {
    const attendu = s.tresorerie.cumulCashApresImpot + (s.sortie.vente - s.tresorerie.crdFin) - 30000 - s.sortie.impotSortie;
    proche(s.gainNet, attendu, 1e-6);
  }
});
test("14. quatre structures dans l'ordre, avertissements notaire / expert-comptable, aucune décote de parts modélisée", () => {
  const r = S.comparerStructures(dossier(), OP);
  assert.deepEqual(r.structures.map((s) => s.cle), ["nom_propre_nu", "lmnp", "sci_ir", "sci_is"]);
  assert.ok(r.avertissements.some((a) => /notaire/.test(a)) && r.avertissements.some((a) => /expert-comptable/.test(a)));
  const source = readFileSync(new URL("../src/Invest/structurationStructures.mjs", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/d[ée]cote/i.test(source), "la décote de parts n'est pas une règle légale : elle n'est pas dans le code");
});
test("15. la TMI saisie dans le paramètre prime sur celle du dossier ; plus de TMI, plus d'impôt sur les revenus", () => {
  const a = get(S.comparerStructures(dossier("11 %"), OP), "nom_propre_nu").annees[0].impot;
  const b = get(S.comparerStructures(dossier("11 %"), OP, { parametres: { tmi: "41 %" } }), "nom_propre_nu").annees[0].impot;
  assert.ok(b > a);
});
test("16. l'horizon change la sortie : plus long, plus d'abattement de plus-value", () => {
  const c = (h) => get(S.comparerStructures(dossier(), { ...OP, loyer_mois: "50" }, { parametres: { horizon: h } }), "nom_propre_nu");
  const tauxEffectif = (r) => r.sortie.impotSortie / r.sortie.plusValue;
  assert.ok(tauxEffectif(c(20)) < tauxEffectif(c(7)));
});

let echecs = 0;
for (const [n, f] of cas) { try { await f(); console.log(`  ✓ ${n}`); } catch (e) { echecs++; console.log(`  ✗ ${n}\n      ${e.message}`); } }
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
