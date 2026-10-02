#!/usr/bin/env node
// Vérifie l'onglet Stratégie d'une mission : calculs purs (calculStrategie.mjs) et règles du composant.
// Exemples issus des tests, données fictives : aucune donnée réelle.
//   node scripts/verif-invest-strategie-ecran.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as S from "../src/Invest/dossiers/calculStrategie.mjs";
import { calculerAnalyse } from "../src/Invest/dossiers/calculAnalyse.mjs";
import { ONGLETS_FICHE } from "../src/Invest/dossiers/ficheDossierVue.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (r) => readFileSync(join(racine, r), "utf8");
const COMP = lire("src/Invest/dossiers/StrategieMission.jsx");
const FICHE = lire("src/Invest/dossiers/FicheDossier.jsx");
let n = 0, total = 0;
const test = (nom, fn) => { total++; try { fn(); n++; console.log(`  ✔ ${nom}`); } catch (e) { console.log(`  ✘ ${nom}\n      ${e.message.split("\n")[0]}`); process.exitCode = 1; } };
const H = { prix: 200000, travaux: 20000, apport: 40000, tauxPct: 3.8, dureeAns: 25, loyerMensuel: 1100, chargesMensuelles: 250 };

test("1. mensualité : le prêt est soldé après toutes les mensualités ; taux nul = capital / mois ; rien à emprunter = 0", () => {
  const m = S.mensualiteCredit(180000, 3.8, 25); let reste = 180000; const t = 0.038 / 12;
  for (let i = 0; i < 300; i++) reste = reste * (1 + t) - m;
  assert.ok(Math.abs(reste) < 0.01); assert.equal(Math.round(m), 930);
  assert.equal(S.mensualiteCredit(120000, 0, 10), 1000); assert.equal(S.mensualiteCredit(0, 3.8, 25), 0); assert.equal(S.mensualiteCredit(-5, 3.8, 25), 0);
  assert.ok(Math.abs(S.capitalEmpruntable(m, 3.8, 25) - 180000) < 0.01, "cohérent avec le calcul de l'Analyse");
});
test("2. indicateurs d'un scénario : coût, emprunt, mensualité, rendements, cash-flow, effort d'épargne", () => {
  const i = S.indicateursScenario(H, { mensualiteMax: 1150, epargneDisponible: 50000 });
  assert.deepEqual([i.cout, i.emprunt, i.mensualite, i.rendementBrutPct, i.rendementNetPct, i.cashflowMensuel, i.effortEpargneMensuel], [220000, 180000, 930, 6, 4.6, -80, 80]);
  assert.equal(i.compatibleCapacite, true); assert.equal(i.apportDisponible, true);
  const confortable = S.indicateursScenario({ ...H, loyerMensuel: 1500 });
  assert.equal(confortable.cashflowMensuel, 320); assert.equal(confortable.effortEpargneMensuel, 0, "jamais d'effort négatif");
});
test("3. donnée absente = « non évaluable » (null), jamais zéro : prix, taux, loyer, charges, contexte", () => {
  assert.deepEqual(S.indicateursScenario({}), { evaluable: false, raison: "Prix d'acquisition non renseigné." });
  assert.equal(S.indicateursScenario({ prix: 0 }).evaluable, false);
  const sansTaux = S.indicateursScenario({ prix: 200000, apport: 20000 });
  assert.equal(sansTaux.mensualite, null); assert.equal(sansTaux.cashflowMensuel, null);
  const sansLoyer = S.indicateursScenario({ prix: 200000, apport: 40000, tauxPct: 3.8, dureeAns: 25, chargesMensuelles: 100 });
  assert.equal(sansLoyer.rendementBrutPct, null); assert.equal(sansLoyer.rendementNetPct, null); assert.equal(sansLoyer.cashflowMensuel, null); assert.ok(sansLoyer.mensualite > 0);
  const sansCharges = S.indicateursScenario({ ...H, chargesMensuelles: undefined });
  assert.ok(sansCharges.rendementBrutPct > 0); assert.equal(sansCharges.rendementNetPct, null); assert.equal(sansCharges.cashflowMensuel, null);
  const sansContexte = S.indicateursScenario(H);
  assert.equal(sansContexte.compatibleCapacite, null); assert.equal(sansContexte.apportDisponible, null);
});
test("4. sans emprunt (apport ≥ coût) : mensualité nulle sans exiger taux ni durée ; sans apport : financement à 100 % signalé", () => {
  const cash = S.indicateursScenario({ prix: 100000, apport: 100000, loyerMensuel: 600, chargesMensuelles: 100 });
  assert.equal(cash.emprunt, 0); assert.equal(cash.mensualite, 0); assert.equal(cash.cashflowMensuel, 500);
  const cent = S.indicateursScenario({ prix: 100000, tauxPct: 3, dureeAns: 20 });
  assert.equal(cent.apportRenseigne, false); assert.equal(cent.emprunt, 100000);
});
test("5. compatibilité avec la capacité du client : mensualité et apport comparés à ce que dit l'Analyse", () => {
  const sit = { revenusMensuels: 5000, chargesMensuelles: 1500, mensualitesCredits: 600, assuranceCredits: 0, epargneDisponible: 20000, incomplets: {} };
  const a = calculerAnalyse({ situation: sit, projet: { budget: 250000, apport: 30000 } });
  const ctx = { mensualiteMax: a.capacite.mensualiteMax, epargneDisponible: a.epargneDisponible };
  const ok = S.indicateursScenario({ ...H, apport: 10000 }, ctx);
  assert.equal(ok.mensualite, 1085); assert.equal(ok.compatibleCapacite, true, "1 085 € ≤ 1 150 €");
  const trop = S.indicateursScenario({ ...H, prix: 260000, apport: 10000 }, ctx);
  assert.equal(trop.compatibleCapacite, false, "mensualité > 1 150 €"); assert.equal(trop.apportDisponible, true);
  assert.equal(S.indicateursScenario({ ...H, apport: 40000 }, ctx).apportDisponible, false, "apport 40 000 € > épargne 20 000 €");
});
test("6. saisie : bornes et nombres contrôlés, virgule décimale acceptée, champs vides retirés", () => {
  assert.deepEqual(S.normaliserHypotheses({ prix: "200 000", tauxPct: "3,8", dureeAns: "", travaux: null, inconnu: 5 }), { prix: 200000, tauxPct: 3.8 });
  assert.deepEqual(S.erreursScenario({ libelle: "A", hypotheses: H }), []);
  assert.equal(S.erreursScenario({ libelle: "  ", hypotheses: {} }).length, 1);
  assert.equal(S.erreursScenario({ libelle: "A", hypotheses: { prix: "abc", tauxPct: "20", dureeAns: "40", loyerMensuel: "-5" } }).length, 4);
  assert.deepEqual(S.erreursScenario({ libelle: "A", hypotheses: { tauxPct: "0", prix: "" } }), [], "0 % est valide");
});
test("7. blocs : connus seulement, sans doublon, dans l'ordre ; valeur par défaut = objectifs, point de départ, scénarios, recommandation", () => {
  assert.deepEqual(S.BLOCS_PAR_DEFAUT, ["objectifs", "point_depart", "scenarios", "recommandation"]);
  assert.deepEqual(S.normaliserBlocs(["recommandation", "fiscal", "fiscal", "inconnu", "objectifs"]), ["objectifs", "fiscal", "recommandation"]);
  assert.deepEqual(S.normaliserBlocs(null), []); assert.deepEqual(S.normaliserBlocs([]), []);
  assert.equal(S.BLOCS.length, 7);
});
test("8. risques et feuille de route : lignes vides ignorées, niveau et date invalides ramenés à une valeur sûre", () => {
  assert.deepEqual(S.nettoyerRisques([{ libelle: " Vacance ", niveau: "eleve", mesure: " garantie loyers " }, { libelle: "", niveau: "x", mesure: "" }, { libelle: "Taux", niveau: "bizarre" }]),
    [{ libelle: "Vacance", niveau: "eleve", mesure: "garantie loyers" }, { libelle: "Taux", niveau: "moyen", mesure: "" }]);
  assert.deepEqual(S.nettoyerFeuilleRoute([{ etape: "Signer", echeance: "2026-12-01", responsable: "Tom" }, { etape: "", echeance: "", responsable: "" }, { etape: "Visiter", echeance: "demain" }]),
    [{ etape: "Signer", echeance: "2026-12-01", responsable: "Tom" }, { etape: "Visiter", echeance: "", responsable: "" }]);
  assert.deepEqual(S.nettoyerRisques(null), []);
});
test("9. validation : chiffres figés (capacité, budget, scénario recommandé), écarts détectés", () => {
  const sit = { revenusMensuels: 5000, chargesMensuelles: 1500, mensualitesCredits: 600, assuranceCredits: 0, epargneDisponible: 20000, incomplets: {} };
  const analyse = calculerAnalyse({ situation: sit, projet: { budget: 250000, apport: 30000 } });
  const sc = [{ id: "s1", libelle: "Ancien rénové", recommande: true, hypotheses: H }, { id: "s2", libelle: "Neuf", recommande: false, hypotheses: { ...H, prix: 250000 } }];
  const ind = Object.fromEntries(sc.map((s) => [s.id, S.indicateursScenario(s.hypotheses)]));
  const figes = S.chiffresPourValidation({ analyse, scenarios: sc, indicateurs: ind });
  assert.equal(figes.nbScenarios, 2); assert.equal(figes.recommande.id, "s1"); assert.equal(figes.recommande.mensualite, 930);
  assert.deepEqual(S.ecartsDepuisValidation(figes, figes), []); assert.deepEqual(S.ecartsDepuisValidation(null, figes), []);
  const autre = S.chiffresPourValidation({ analyse, scenarios: [{ ...sc[0], recommande: false }, { ...sc[1], recommande: true }], indicateurs: ind });
  assert.deepEqual(S.ecartsDepuisValidation(figes, autre), ["scénario recommandé"]);
  assert.ok(S.ecartsDepuisValidation(figes, S.chiffresPourValidation({ analyse, scenarios: [sc[0]], indicateurs: ind })).includes("nombre de scénarios"));
  const autreAnalyse = calculerAnalyse({ situation: { ...sit, revenusMensuels: 4000 }, projet: { budget: 250000, apport: 30000 } });
  assert.ok(S.ecartsDepuisValidation(figes, S.chiffresPourValidation({ analyse: autreAnalyse, scenarios: sc, indicateurs: ind })).includes("capacité d'achat indicative"));
  const sansReco = S.chiffresPourValidation({ analyse, scenarios: [{ ...sc[0], recommande: false }], indicateurs: ind });
  assert.equal(sansReco.recommande, null);
});
test("10. composant : n'écrit que les stratégies et les scénarios, ni l'étape, ni le projet, ni l'analyse, ni le portail", () => {
  const ecritures = [...COMP.matchAll(/supabase\s*\.from\("([a-z_]+)"\)\s*\.(insert|update|delete|upsert)/g)].map((m) => `${m[1]}.${m[2]}`);
  assert.ok(ecritures.length >= 4);
  for (const e of ecritures) assert.match(e, /^invest_dossier_(strategies|scenarios)\./, e);
  assert.ok(!/invest_dossier_etapes|questionnaire|invest_postes|invest_engagements|invest_documents_partages|portail_/.test(COMP.replace(/\/\/.*$/gm, "")));
  assert.match(COMP, /from\("invest_dossier_analyses"\)\.select\("hypotheses,statut"\)/, "lit les hypothèses de l'Analyse, ne les modifie pas");
  assert.match(COMP, /calculerAnalyse\(\{ situation: fiche\.situation, projet: fiche\.projet, hypotheses: validerHypotheses\(hypAnalyse\)\.valides \}\)/);
});
test("11. composant : valider exige une recommandation et une confirmation ; « présentée » est un geste explicite, jamais automatique", () => {
  assert.match(COMP, /if \(!recommandation\.trim\(\)\) \{ setErreur\("La recommandation est obligatoire pour valider la stratégie\."\); return; \}/);
  assert.match(COMP, /window\.confirm\("Valider cette stratégie \?/);
  assert.match(COMP, /statut: "validee", valide_le: new Date\(\)\.toISOString\(\), valide_par: auteur, chiffres_valides: chiffres/);
  assert.match(COMP, /window\.confirm\(`Marquer la stratégie comme présentée au client le/);
  assert.equal((COMP.match(/presentee_le:/g) || []).length, 2, "écrit seulement dans « présenter » et « rouvrir » (remise à vide)");
  assert.match(COMP, /presentee_le: null/);
  assert.match(COMP, /const peutEditer = modifiable && !valide;/);
});
test("12. composant : en cas d'erreur la saisie est conservée ; un seul scénario recommandé ; 4 scénarios au plus", () => {
  assert.match(COMP, /catch \(e\) \{ setErreur\(e\.message \|\| String\(e\)\); setOccupe\(false\); return false; \}/);
  assert.ok(!/catch \(e\)[^}]*charger\(/.test(COMP), "pas de rechargement après erreur");
  assert.match(COMP, /recommande: s\.id === id \? !s\.recommande : false/);
  assert.match(COMP, /scenarios\.length < MAX_SCENARIOS/); assert.equal(S.MAX_SCENARIOS, 4);
  assert.match(COMP, /update\(\{ recommande: false \}\)\.eq\("dossier_id", dossier\.id\)/, "libère l'ancien recommandé avant d'écrire");
});
test("12bis. cartes à champs : les champs restent dans leur carte (pas de débordement sur la carte voisine)", () => {
  assert.match(COMP, /\.mod-carte input,\.mod-carte select,\.mod-carte textarea\{width:100%;min-width:0;box-sizing:border-box\}/);
  assert.match(COMP, /className="mod-carte"/);
});
test("13. composants stables et fiche Mission : l'onglet Stratégie affiche le composant ; seuls Financement et Acquisition sont « en préparation »", () => {
  assert.ok(COMP.indexOf("function Carte({ T,") < COMP.indexOf("export default function StrategieMission") && !/const (Carte|Chiffre) = \(/.test(COMP));
  assert.match(FICHE, /\{onglet === "strategie" && <StrategieMission T=\{T\} fiche=\{fiche\} client=\{client\} dossier=\{fiche\.dossier\} profil=\{profil\} modifiable=\{fiche\.modifiable\} onOnglet=\{setOnglet\} \/>\}/);
  assert.deepEqual(ONGLETS_FICHE.filter((o) => o.enPreparation).map((o) => o.cle), []);
});

console.log(`\n${n}/${total} contrôles conformes`);
