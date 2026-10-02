#!/usr/bin/env node
// Vérifie l'onglet Analyse d'une mission : calculs purs (calculAnalyse.mjs) et règles du composant.
// Exemples issus des tests, données fictives : aucune donnée réelle.
//   node scripts/verif-invest-analyse-ecran.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "../src/Invest/dossiers/calculAnalyse.mjs";
import { ONGLETS_FICHE } from "../src/Invest/dossiers/ficheDossierVue.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (r) => readFileSync(join(racine, r), "utf8");
const COMP = lire("src/Invest/dossiers/AnalyseMission.jsx");
const FICHE = lire("src/Invest/dossiers/FicheDossier.jsx");
let n = 0, total = 0;
const test = (nom, fn) => { total++; try { fn(); n++; console.log(`  ✔ ${nom}`); } catch (e) { console.log(`  ✘ ${nom}\n      ${e.message.split("\n")[0]}`); process.exitCode = 1; } };
const SIT = { revenusMensuels: 5000, chargesMensuelles: 1500, mensualitesCredits: 600, assuranceCredits: 0, epargneDisponible: 20000, patrimoineNetSimplifie: 150000, incomplets: {} };

test("1. capital empruntable : référence vérifiée par amortissement (1 150 €/mois, 3,8 %, 25 ans = 222 499 €)", () => {
  assert.equal(Math.round(A.capitalEmpruntable(1150, 3.8, 25)), 222499);
  let reste = A.capitalEmpruntable(1150, 3.8, 25); const t = 0.038 / 12;
  for (let i = 0; i < 300; i++) reste = reste * (1 + t) - 1150;
  assert.ok(Math.abs(reste) < 0.01, "le prêt est soldé après 300 mensualités");
  assert.equal(A.capitalEmpruntable(1000, 0, 20), 240000, "taux nul : mensualité × nombre de mois");
  assert.equal(A.capitalEmpruntable(0, 3.8, 25), 0); assert.equal(A.capitalEmpruntable(-50, 3.8, 25), 0);
});
test("2. analyse chiffrée : endettement, reste mensuel, mensualité maximale, capacité d'achat avec apport", () => {
  const a = A.calculerAnalyse({ situation: SIT, projet: { budget: 280000, apport: 30000 } });
  assert.equal(a.tauxEndettementPct, 12); assert.equal(a.resteMensuel, 2900);
  assert.deepEqual(a.hypotheses, A.HYPOTHESES_DEFAUT);
  assert.equal(a.capacite.mensualiteMax, 1150, "35 % de 5 000 € moins 600 € de crédits");
  assert.equal(a.capacite.capitalEmpruntable, 222499); assert.equal(a.capacite.capaciteAchat, 252499);
  assert.deepEqual(a.budget, { renseigne: true, valeur: 280000, ecart: -27501, verdict: "au_dessus" });
  assert.equal(A.calculerAnalyse({ situation: SIT, projet: { budget: 250000, apport: 30000 } }).budget.verdict, "compatible");
});
test("3. une donnée absente rend « non évaluable », jamais zéro : revenus, apport, budget", () => {
  const sans = A.calculerAnalyse({ situation: { ...SIT, revenusMensuels: 0 }, projet: { budget: 100000 } });
  assert.equal(sans.capacite.calculable, false); assert.match(sans.capacite.raison, /Revenus non renseignés/);
  assert.equal(sans.tauxEndettementPct, null); assert.equal(sans.resteMensuel, null); assert.equal(sans.budget.verdict, "non_evaluable");
  const pasApport = A.calculerAnalyse({ situation: SIT, projet: { budget: 200000 } });
  assert.equal(pasApport.capacite.apport, null); assert.equal(pasApport.capacite.capaciteAchat, pasApport.capacite.capitalEmpruntable);
  assert.equal(A.calculerAnalyse({ situation: SIT, projet: { apport: 1000 } }).budget.verdict, "non_evaluable");
  assert.equal(A.calculerAnalyse({}).capacite.calculable, false, "aucune donnée du tout");
});
test("4. déjà endetté au-delà du maximum : mensualité maximale nulle, jamais négative", () => {
  const a = A.calculerAnalyse({ situation: { ...SIT, mensualitesCredits: 2500 }, projet: { budget: 100000, apport: 5000 } });
  assert.equal(a.tauxEndettementPct, 50); assert.equal(a.capacite.mensualiteMax, 0); assert.equal(a.capacite.capitalEmpruntable, 0);
  assert.equal(a.budget.verdict, "au_dessus");
});
test("5. hypothèses : bornes contrôlées, virgule décimale acceptée, valeur invalide = défaut + erreur visible", () => {
  assert.deepEqual(A.validerHypotheses({ tauxPct: "4,2", dureeAns: "20", endettementMaxPct: 33 }), { valides: { tauxPct: 4.2, dureeAns: 20, endettementMaxPct: 33 }, erreurs: [] });
  assert.deepEqual(A.validerHypotheses({}).valides, A.HYPOTHESES_DEFAUT);
  const e = A.validerHypotheses({ tauxPct: "20", dureeAns: "abc", endettementMaxPct: "5" });
  assert.equal(e.erreurs.length, 3); assert.deepEqual(e.valides, A.HYPOTHESES_DEFAUT);
  assert.equal(A.validerHypotheses({ tauxPct: "0" }).valides.tauxPct, 0, "0 % est une valeur valide");
  const plus = A.calculerAnalyse({ situation: SIT, projet: {}, hypotheses: { tauxPct: 2.5, dureeAns: 20, endettementMaxPct: 30 } });
  assert.equal(plus.capacite.mensualiteMax, 900); assert.deepEqual(plus.hypotheses, { tauxPct: 2.5, dureeAns: 20, endettementMaxPct: 30 });
});
test("6. avertissements : données incomplètes signalées (base des revenus, crédits sans mensualité, biens sans valeur)", () => {
  const a = A.calculerAnalyse({ situation: { ...SIT, incomplets: { revenusBaseNonPrecisee: 2, creditsSansMensualite: 1, creditsSansCrd: 1, actifsSansValeur: 3 } }, projet: {} });
  assert.equal(a.avertissements.length, 4); assert.match(a.avertissements[0], /2 revenu\(x\) sans base/);
  assert.deepEqual(A.calculerAnalyse({ situation: SIT, projet: {} }).avertissements, []);
});
test("7. validation : chiffres figés, écarts détectés si la situation change ensuite", () => {
  const avant = A.calculerAnalyse({ situation: SIT, projet: { budget: 250000, apport: 30000 } });
  const figes = A.chiffresPourValidation(avant);
  assert.deepEqual(A.ecartsDepuisValidation(figes, avant), [], "rien n'a bougé");
  assert.deepEqual(A.ecartsDepuisValidation(null, avant), []);
  const apres = A.calculerAnalyse({ situation: { ...SIT, revenusMensuels: 4000 }, projet: { budget: 250000, apport: 30000 } });
  const ecarts = A.ecartsDepuisValidation(figes, apres);
  assert.ok(ecarts.includes("revenus") && ecarts.includes("capacité d'achat indicative") && !ecarts.includes("budget"));
  assert.ok(A.ecartsDepuisValidation(figes, A.calculerAnalyse({ situation: SIT, projet: { budget: 260000, apport: 30000 } })).includes("budget"));
  assert.ok(A.ecartsDepuisValidation(figes, A.calculerAnalyse({ situation: SIT, projet: { budget: 250000, apport: 30000 }, hypotheses: { tauxPct: 5 } })).includes("capacité d'achat indicative"));
});
test("8. composant : n'écrit que invest_dossier_analyses, ne touche ni l'étape ni la situation ni le projet", () => {
  const ecritures = [...COMP.matchAll(/supabase\s*\.from\("([a-z_]+)"\)\s*\.(insert|update|delete|upsert)/g)].map((m) => `${m[1]}.${m[2]}`);
  assert.deepEqual(ecritures, ["invest_dossier_analyses.upsert"]);
  assert.ok(!/invest_dossier_etapes|invest_postes|invest_engagements|invest_actifs|questionnaire|portail_/.test(COMP.replace(/\/\/.*$/gm, "")));
  assert.match(COMP, /calculerAnalyse\(\{ situation: fiche\.situation, projet: fiche\.projet, hypotheses: valides \}\)/, "les chiffres viennent de la fiche, rien n'est recalculé ailleurs");
});
test("9. composant : valider exige une conclusion et une confirmation, fige les chiffres ; modification interdite une fois validée", () => {
  assert.match(COMP, /if \(!textes\.conclusion\.trim\(\)\) \{ setErreur\("La conclusion est obligatoire pour valider l'analyse\."\); return; \}/);
  assert.match(COMP, /window\.confirm\("Valider cette analyse \?/);
  assert.match(COMP, /statut: "validee", valide_le: new Date\(\)\.toISOString\(\), valide_par: auteur, chiffres_valides: chiffresPourValidation\(analyse\)/);
  assert.match(COMP, /const peutEditer = modifiable && !valide;/);
  assert.match(COMP, /window\.confirm\("Rouvrir l'analyse en brouillon/);
  assert.match(COMP, /Les chiffres ont changé depuis la validation/);
});
test("10. composant : situation vide ou revenus absents expliqués, jamais un résultat inventé ; hypothèses invalides refusées à l'enregistrement", () => {
  assert.match(COMP, /La Situation patrimoniale n'est pas renseignée : l'analyse ne peut rien chiffrer/);
  assert.match(COMP, /\{!c\.calculable \? <div[^>]*>\{c\.raison\}<\/div>/);
  assert.match(COMP, /if \(erreurs\.length\) \{ setErreur\(`Hypothèses à corriger/);
  assert.match(COMP, /Hors frais de notaire, garanties et revenus locatifs futurs/);
});
test("11. composants stables et fiche Mission : l'onglet Analyse affiche le composant ; seuls les modules restants sont « en préparation »", () => {
  assert.ok(COMP.indexOf("function Carte({ T,") < COMP.indexOf("export default function AnalyseMission") && !/const (Carte|Chiffre) = \(/.test(COMP));
  assert.match(FICHE, /\{onglet === "analyse" && <AnalyseMission T=\{T\} fiche=\{fiche\} client=\{client\} dossier=\{fiche\.dossier\} profil=\{profil\} modifiable=\{fiche\.modifiable\} onOuvrirEtape=\{setPanneau\} onOnglet=\{setOnglet\} \/>\}/);
  assert.deepEqual(ONGLETS_FICHE.filter((o) => o.enPreparation).map((o) => o.cle), ["strategie", "financement", "acquisition"]);
});

console.log(`\n${n}/${total} contrôles conformes`);
