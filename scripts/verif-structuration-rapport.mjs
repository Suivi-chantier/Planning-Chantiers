#!/usr/bin/env node
// Vérifie src/Invest/structurationRapport.mjs. Jeu de données : exemple issu des tests, données fictives.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as R from "../src/Invest/structurationRapport.mjs";

const cas = [];
const test = (n, f) => cas.push([n, f]);
const AN = 2026;
const lisible = (h) => h.replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const nbPages = (h) => (h.match(/<section class="page/g) || []).length;
const DOSSIER = () => ({
  collecte: {
    profil: { revenus_nets_mois: "5000", revenus_conjoint_mois: "2000", tmi: "30 %", situation_familiale: "Marié", regime_matrimonial: "Communauté légale" },
    patrimoine: { rp_valeur: "300000", rp_crd: "150000", lots: [{ adresse: "12 rue des Lilas", structure: "PP direct", valeur: "200000", valeur_acquisition: "170000", loyer_mois: "1000", mensualite: "700", crd: "120000", taux_pret: "3" }] },
    patrimoine_financier: { liquidites: "30000", assurance_vie: "40000" },
    charges: { logement: "1200", courantes: "1500", epargne_reelle_mois: "1500" },
    objectifs_mesures: [{ libelle: "2 500 €/mois de revenus nets", montant: "2500", echeance: "2036", priorite: "1", flexibilite: "Souple" }],
  },
  analyse: { diagnostic: "Patrimoine solide.\nSuite.", strategie_recommandee: "Deux acquisitions étalées sur trois ans." },
  scenarios_chiffres: [{ id: "s1", nom: "Équilibré", operations: [{ id: "a", annee: "2027", libelle: "Immeuble de rapport", prix: "180000", apport: "20000", loyer_mois: "1100" }] }],
  scenario_retenu_id: "s1",
  mise_en_oeuvre: { actions: [{ titre: "Créer la SCI", echeance: "2027-02-15", statut: "En cours" }] },
});
const opts = { clientNom: "Jean Dupont", titre: "Étude Dupont", conseiller: "Camille", dateLongue: "2 octobre 2026", anneeDepart: AN };

test("1. synthèse exécutive : couverture + 10 pages ; rapport complet : la synthèse + les annexes", () => {
  const s = R.construireRapportHtml(DOSSIER(), { ...opts, niveau: "synthese" });
  const c = R.construireRapportHtml(DOSSIER(), { ...opts, niveau: "complet" });
  assert.equal(nbPages(s), 11);
  assert.ok(nbPages(c) > nbPages(s));
  assert.ok(!/Annexe H/.test(s) && /Annexe H/.test(c));
});
test("2. les dix pages de la synthèse portent les titres convenus", () => {
  const h = lisible(R.construireRapportHtml(DOSSIER(), { ...opts }));
  for (const t of ["Votre situation en un coup d'œil", "Vos objectifs", "Votre patrimoine actuel", "Vos flux et votre capacité d'investissement", "Notre diagnostic",
    "Les stratégies étudiées", "La stratégie retenue", "Projection à 5, 10 et 20 ans", "Risques et tests de résistance", "Votre plan d'action"]) assert.ok(h.includes(t), t);
});
test("3. tout texte du dossier est échappé (aucune balise injectée)", () => {
  const d = DOSSIER();
  d.collecte.patrimoine.lots[0].adresse = '"><img src=x onerror=alert(1)>';
  d.analyse.diagnostic = "<script>alert(2)</script>";
  const h = R.construireRapportHtml(d, { ...opts, clientNom: "<b>Hack</b>", niveau: "complet" });
  assert.ok(!/<img src=x/.test(h) && !/<script>alert/.test(h) && !/<b>Hack<\/b>/.test(h));
  assert.ok(h.includes("&lt;script&gt;"));
});
test("4. dossier vide : aucun NaN, aucun « undefined », les manques sont écrits « À préciser » ou « non calculable »", () => {
  const h = R.construireRapportHtml({ collecte: {} }, { ...opts, niveau: "complet" });
  assert.ok(!/NaN|undefined|Infinity/.test(h));
  assert.ok(h.includes("non calculable") && h.includes("À préciser"));
  assert.ok(h.includes("Aucun scénario n'a encore été retenu"));
});
test("5. dossier renseigné : client, scénario, objectif, plan d'action et mention avant impôt", () => {
  const h = lisible(R.construireRapportHtml(DOSSIER(), { ...opts, niveau: "complet" }));
  for (const t of ["Jean Dupont", "Équilibré", "2 500 €/mois de revenus nets", "Créer la SCI", "Acquisition — Immeuble de rapport", "avant impôt", "2 octobre 2026"]) assert.ok(h.includes(t), t);
});
test("6. notaire et expert-comptable sont cités dans la synthèse comme dans le rapport complet", () => {
  for (const niveau of ["synthese", "complet"]) {
    const h = R.construireRapportHtml(DOSSIER(), { ...opts, niveau });
    assert.ok(/notaire/.test(h) && /expert-comptable/.test(h), niveau);
  }
});
test("7. aucune structure n'est présentée comme la meilleure", () => {
  const h = R.construireRapportHtml(DOSSIER(), { ...opts, niveau: "complet" });
  assert.ok(h.includes("Aucune structure n'est présentée comme la meilleure"));
  assert.ok(!/meilleure structure|structure optimale/i.test(h));
});
test("8. les hypothèses du cas prudent, central et dégradé figurent dans le rapport complet", () => {
  const h = lisible(R.construireRapportHtml(DOSSIER(), { ...opts, niveau: "complet" }));
  for (const t of ["Prudent", "Central", "Dégradé", "Valeur de l'immobilier", "Limites du modèle"]) assert.ok(h.includes(t), t);
});
test("9. un chiffre manquant n'est jamais écrit zéro : biens sans prêt renseigné → non calculable", () => {
  const d = DOSSIER(); d.collecte.patrimoine.lots = [{ adresse: "Sans chiffres", valeur: "100000" }];
  const h = R.construireRapportHtml(d, { ...opts });
  const ligne = h.match(/Sans chiffres[\s\S]*?<\/tr>/)[0];
  assert.ok(ligne.includes("non calculable"));
});
test("10. module pur : ni horloge, ni base de données", () => {
  const src = readFileSync(new URL("../src/Invest/structurationRapport.mjs", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/new Date\(|Date\.now|supabase|fetch\(|window\.(?!print)/.test(src));
});

test("11. graphiques : anneaux, barres et frise présents, aucun graphique ne s'affiche sur un dossier vide", () => {
  const plein = R.construireRapportHtml(DOSSIER(), { ...opts, niveau: "synthese" });
  assert.ok((plein.match(/<svg /g) || []).length >= 7, "anneaux, barres, courbe et frise");
  for (const t of ["Composition du patrimoine", "Répartition des dettes", "Où va chaque mois", "Patrimoine net à 10 ans, par trajectoire", "Frise des échéances"]) assert.ok(plein.includes(t), t);
  const vide = R.construireRapportHtml({ collecte: {} }, { ...opts, niveau: "synthese" });
  assert.ok(!/NaN|undefined|Infinity/.test(vide));
  assert.ok(vide.includes("rien à représenter"));
});
test("12. impression : format A4 sans marge et saut de page unique (plus de page blanche)", () => {
  const h = R.construireRapportHtml(DOSSIER(), { ...opts });
  assert.ok(h.includes("@page{size:A4;margin:0}"));
  assert.ok(/\.page\{[^}]*break-after:page/.test(h) && h.includes(".page:last-of-type"));
});

let echecs = 0;
for (const [n, f] of cas) { try { await f(); console.log(`  ✓ ${n}`); } catch (e) { echecs++; console.log(`  ✗ ${n}\n      ${e.message}`); } }
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
