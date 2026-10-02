#!/usr/bin/env node
// Vérifie l'onglet Financement d'une mission : calculs purs (calculFinancement.mjs) et règles du composant.
// Exemples issus des tests, données fictives : aucune donnée réelle.
//   node scripts/verif-invest-financement-ecran.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as F from "../src/Invest/dossiers/calculFinancement.mjs";
import { mensualiteCredit } from "../src/Invest/dossiers/calculStrategie.mjs";
import { ONGLETS_FICHE } from "../src/Invest/dossiers/ficheDossierVue.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (r) => readFileSync(join(racine, r), "utf8");
const COMP = lire("src/Invest/dossiers/FinancementMission.jsx");
const FICHE = lire("src/Invest/dossiers/FicheDossier.jsx");
let n = 0, total = 0;
const test = (nom, fn) => { total++; try { fn(); n++; console.log(`  ✔ ${nom}`); } catch (e) { console.log(`  ✘ ${nom}\n      ${e.message.split("\n")[0]}`); process.exitCode = 1; } };
const SC = { id: "s1", libelle: "Ancien rénové", recommande: true, hypotheses: { prix: 200000, travaux: 20000, frais: 6000, apport: 40000 } };
const B = (x = {}) => ({ id: "b" + Math.random(), banque: "Banque A", statut: "offre_acceptee", retenue: true, montant_accorde: 186000, taux_pct: 3.8, duree_ans: 25, frais_dossier: 1000, frais_garantie: 2000, assurance_mensuelle: 40, ...x });

test("1. scénario retenu : le choix explicite s'il existe encore, sinon le recommandé, sinon aucun", () => {
  const l = [{ id: "a", recommande: false }, { id: "b", recommande: true }];
  assert.deepEqual(F.scenarioRetenu(l, "a"), { scenario: l[0], origine: "choisi" });
  assert.deepEqual(F.scenarioRetenu(l, null), { scenario: l[1], origine: "recommande" });
  assert.equal(F.scenarioRetenu(l, "supprime").origine, "recommande", "un choix supprimé retombe sur le recommandé");
  assert.deepEqual(F.scenarioRetenu([{ id: "a", recommande: false }], null), { scenario: null, origine: null });
  assert.deepEqual(F.scenarioRetenu([], null), { scenario: null, origine: null });
});
test("2. plan de financement : emplois (prix, travaux, frais, frais bancaires) contre ressources (apport, prêts) ; écart exact", () => {
  const p = F.planFinancement({ scenario: SC, banques: [B()] });
  assert.deepEqual(p.emplois.map((x) => [x.cle, x.montant]), [["prix", 200000], ["travaux", 20000], ["frais", 6000], ["frais_bancaires", 3000]]);
  assert.deepEqual(p.ressources.map((x) => [x.cle, x.montant]), [["apport", 40000], ["pret", 186000]]);
  assert.deepEqual([p.totalEmplois, p.totalRessources, p.ecart, p.etat], [229000, 226000, -3000, "insuffisant"]);
  const eq = F.planFinancement({ scenario: SC, banques: [B({ montant_accorde: 189000 })] });
  assert.equal(eq.ecart, 0); assert.equal(eq.etat, "equilibre");
  assert.equal(F.planFinancement({ scenario: SC, banques: [B({ montant_accorde: 200000 })] }).etat, "excedentaire");
  assert.equal(F.planFinancement({ scenario: SC, banques: [B({ montant_accorde: 189000.6 })] }).etat, "equilibre", "tolérance d'un euro d'arrondi");
});
test("3. lignes libres du plan (subvention, prêt familial, mobilier) : prises en compte, lignes vides ignorées", () => {
  const p = F.planFinancement({ scenario: SC, banques: [B({ montant_accorde: 150000 })], autresEmplois: [{ libelle: "Mobilier", montant: "4 000" }, { libelle: "", montant: "" }], autresRessources: [{ libelle: "Prêt familial", montant: "37000" }, { libelle: "Nul", montant: "0" }] });
  assert.ok(p.emplois.some((x) => x.libelle === "Mobilier" && x.montant === 4000)); assert.ok(p.ressources.some((x) => x.libelle === "Prêt familial" && x.montant === 37000));
  assert.ok(!p.ressources.some((x) => x.libelle === "Nul"), "montant nul ignoré");
  assert.deepEqual(p.ressources.map((x) => x.montant), [40000, 150000, 37000]); assert.equal(p.totalEmplois, 233000); assert.equal(p.ecart, -6000);
  assert.deepEqual(F.nettoyerLignes([{ libelle: " A ", montant: "1 000,5" }, { libelle: "", montant: "" }, null]), [{ libelle: "A", montant: 1000.5 }]);
});
test("4. sans scénario retenu, sans prix, sans prêt retenu, sans apport : expliqué, jamais un plan inventé", () => {
  assert.match(F.planFinancement({}).raison, /Aucun scénario retenu/); assert.equal(F.planFinancement({}).evaluable, false);
  assert.match(F.planFinancement({ scenario: { hypotheses: {} } }).raison, /prix d'acquisition/);
  const sans = F.planFinancement({ scenario: SC, banques: [B({ retenue: false })] });
  assert.equal(sans.aucunPretRetenu, true); assert.equal(sans.ressources.length, 1); assert.equal(sans.etat, "insuffisant");
  assert.equal(F.planFinancement({ scenario: { hypotheses: { prix: 100000 } }, banques: [] }).apportRenseigne, false);
});
test("5. une banque n'entre dans le plan que si elle est retenue, à un statut compatible, avec un montant accordé", () => {
  const liste = [B(), B({ retenue: false }), B({ statut: "refus" }), B({ statut: "dossier_depose" }), B({ montant_accorde: null }), B({ statut: "accord_principe", montant_accorde: 5000 })];
  assert.equal(F.banquesRetenues(liste).length, 2);
  assert.deepEqual(F.banquesRetenues(liste).map((b) => b.montant_accorde), [186000, 5000]);
});
test("6. synthèse des prêts : mensualité vérifiée par amortissement, assurance, taux pondéré, compatibilité avec la capacité", () => {
  const s = F.syntheseCredits([B()], 1150);
  const m = mensualiteCredit(186000, 3.8, 25); let reste = 186000; const t = 0.038 / 12; for (let i = 0; i < 300; i++) reste = reste * (1 + t) - m;
  assert.ok(Math.abs(reste) < 0.01); assert.equal(s.mensualite, Math.round(m)); assert.equal(s.mensualiteAvecAssurance, Math.round(m) + 40); assert.equal(s.compatibleCapacite, true);
  assert.equal(F.syntheseCredits([B()], 900).compatibleCapacite, false);
  assert.equal(F.syntheseCredits([B()], null).compatibleCapacite, null, "capacité inconnue : non évaluable");
  const deux = F.syntheseCredits([B({ montant_accorde: 100000, taux_pct: 3 }), B({ montant_accorde: 50000, taux_pct: 4.5, assurance_mensuelle: 20 })], null);
  assert.equal(deux.nombre, 2); assert.equal(deux.montantTotal, 150000); assert.equal(deux.tauxMoyenPct, 3.5); assert.equal(deux.assurance, 60);
});
test("7. prêt incomplet (taux ou durée absents) : mensualité « non évaluable », jamais zéro ; aucun prêt retenu : rien d'inventé", () => {
  const inc = F.syntheseCredits([B({ taux_pct: null })], 1150);
  assert.equal(inc.mensualite, null); assert.equal(inc.mensualiteAvecAssurance, null); assert.equal(inc.compatibleCapacite, null); assert.equal(inc.incomplets, 1);
  const vide = F.syntheseCredits([B({ retenue: false })], 1150);
  assert.deepEqual([vide.nombre, vide.montantTotal, vide.mensualite, vide.tauxMoyenPct, vide.compatibleCapacite], [0, 0, null, null, null]);
});
test("8. alertes : offre expirée ou qui expire sous 15 jours, dossier déposé sans réponse depuis 21 jours", () => {
  const AUJ = "2026-10-02";
  const a = F.alertesBanques([B({ banque: "X", statut: "offre_recue", validite_offre_le: "2026-09-30" }), B({ banque: "Y", statut: "offre_recue", validite_offre_le: "2026-10-10" }),
    B({ banque: "Z", statut: "offre_recue", validite_offre_le: "2026-12-01" }), B({ banque: "W", statut: "dossier_depose", demande_le: "2026-09-01" }),
    B({ banque: "V", statut: "dossier_depose", demande_le: "2026-09-20" }), B({ banque: "U", statut: "dossier_depose", demande_le: "2026-09-01", reponse_le: "2026-09-10" }),
    B({ banque: "T", statut: "offre_acceptee", validite_offre_le: "2026-09-01" })], AUJ);
  assert.deepEqual(a.map((x) => [x.banque, x.code, x.niveau]), [["X", "offre_expiree", "danger"], ["Y", "offre_expire_bientot", "warning"], ["W", "sans_reponse", "warning"]]);
  assert.match(a[0].libelle, /expiré depuis 2 j/); assert.match(a[1].libelle, /dans 8 j/); assert.match(a[2].libelle, /depuis 31 j/);
  assert.equal(F.alertesBanques([B({ statut: "offre_recue", validite_offre_le: AUJ })], AUJ)[0].libelle.includes("aujourd'hui"), true);
});
test("9. saisie d'une banque : nom, nombres, bornes, retenue et dates contrôlés", () => {
  assert.deepEqual(F.erreursBanque(B()), []);
  assert.equal(F.erreursBanque(B({ banque: " " })).length, 1);
  assert.equal(F.erreursBanque(B({ taux_pct: "16", duree_ans: "0", montant_accorde: "-1", frais_dossier: "abc" })).length, 4);
  assert.equal(F.erreursBanque(B({ statut: "dossier_depose" })).length, 1, "retenue sans accord ni offre");
  assert.equal(F.erreursBanque(B({ montant_accorde: "" })).length, 1, "retenue sans montant accordé");
  assert.equal(F.erreursBanque(B({ retenue: false, statut: "refus", montant_accorde: null })).length, 0);
  assert.equal(F.erreursBanque(B({ demande_le: "2026-09-10", reponse_le: "2026-09-01" })).length, 1);
  assert.deepEqual(F.erreursLignes([{ libelle: "", montant: "5" }, { libelle: "A", montant: "" }, { libelle: "B", montant: "-3" }, { libelle: "", montant: "" }]).length, 3);
  assert.deepEqual(F.pipelineBanques([B({ statut: "refus" }), B({ statut: "refus" })]).refus, 2); assert.equal(F.pipelineBanques([]).offre_recue, 0);
});
test("10. dossier du client : pièces OBLIGATOIRES reçues ou validées ; sans pièce suivie = indisponible, jamais « complet »", () => {
  const P = (statut, obligatoire = true, genre = "piece_client", libelle = statut) => ({ genre, obligatoire, statut, libelle });
  const c = F.completudeDossierClient([P("recue", true, "piece_client", "CNI"), P("validee", true, "piece_client", "Avis"), P("demandee", true, "piece_client", "RIB"), P("a_demander", false), P("sans_objet", true), P("a_produire", true, "document_profero")]);
  assert.deepEqual([c.disponible, c.total, c.recues, c.manquantes], [true, 3, 2, ["RIB"]]);
  assert.deepEqual(F.completudeDossierClient([]), { disponible: false, total: 0, recues: 0, manquantes: [] });
  assert.equal(F.completudeDossierClient([P("a_demander", false)]).disponible, false);
});
test("11. composant : n'écrit que les financements et les banques ; ne touche ni stratégie, ni pièces, ni étape, ni portail", () => {
  const ecritures = [...COMP.matchAll(/supabase\s*\.from\("([a-z_]+)"\)\s*\.(insert|update|delete|upsert)/g)].map((m) => `${m[1]}.${m[2]}`);
  assert.ok(ecritures.length >= 3);
  for (const e of ecritures) assert.match(e, /^invest_dossier_(financements|banques)\./, e);
  assert.ok(!/invest_dossier_etapes|invest_dossier_pieces"\)\s*\.(insert|update|delete|upsert)|questionnaire|portail_|invest_dossier_strategies"\)\s*\.(insert|update|delete|upsert)/.test(COMP.replace(/\/\/.*$/gm, "")));
  assert.match(COMP, /calculerAnalyse\(\{ situation: fiche\.situation, projet: fiche\.projet, hypotheses: validerHypotheses\(hypAnalyse\)\.valides \}\)/);
  assert.match(COMP, /planFinancement\(\{ scenario: retenu\.scenario, banques, autresEmplois, autresRessources \}\)/, "le plan est calculé, pas saisi");
});
test("12. composant : « transmis » est un geste explicite avec confirmation ; retenue réservée aux banques qui le permettent ; saisie conservée en cas d'erreur", () => {
  assert.match(COMP, /window\.confirm\(`Marquer le dossier comme transmis aux banques le/);
  assert.match(COMP, /window\.confirm\("Annuler la transmission aux banques/);
  assert.match(COMP, /Object\.entries\(STATUTS_DOSSIER\)\.filter\(\(\[k\]\) => k !== "transmis" \|\| transmis\)/, "« transmis » ne se choisit pas dans la liste");
  assert.match(COMP, /retenue: !!b\.retenue && retenable\(b\)/);
  assert.match(COMP, /catch \(e\) \{ setErreur\(e\.message \|\| String\(e\)\); setOccupe\(false\); return false; \}/);
  assert.ok(!/catch \(e\)[^}]*charger\(/.test(COMP));
  assert.match(COMP, /banques\.length < MAX_BANQUES/); assert.equal(F.MAX_BANQUES, 12);
});
test("12bis. cartes à champs : les champs restent dans leur carte (pas de débordement sur la carte voisine)", () => {
  assert.match(COMP, /\.mod-carte input,\.mod-carte select,\.mod-carte textarea\{width:100%;min-width:0;box-sizing:border-box\}/);
  assert.match(COMP, /className="mod-carte"/);
});
test("13. composants stables et fiche Mission : l'onglet Financement affiche le composant ; seule l'Acquisition reste « en préparation »", () => {
  assert.ok(COMP.indexOf("function Carte({ T,") < COMP.indexOf("export default function FinancementMission") && !/const (Carte|Chiffre) = \(/.test(COMP));
  assert.match(FICHE, /\{onglet === "financement" && <FinancementMission T=\{T\} fiche=\{fiche\} client=\{client\} dossier=\{fiche\.dossier\} profil=\{profil\} modifiable=\{fiche\.modifiable\} onOnglet=\{setOnglet\} \/>\}/);
  assert.deepEqual(ONGLETS_FICHE.filter((o) => o.enPreparation).map((o) => o.cle), ["acquisition"]);
});

console.log(`\n${n}/${total} contrôles conformes`);
