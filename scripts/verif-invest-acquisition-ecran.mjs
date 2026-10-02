#!/usr/bin/env node
// Vérifie l'onglet Acquisition d'une mission : calculs purs (calculAcquisition.mjs) et règles du composant.
// Exemples issus des tests, données fictives : aucune donnée réelle.
//   node scripts/verif-invest-acquisition-ecran.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "../src/Invest/dossiers/calculAcquisition.mjs";
import { ONGLETS_FICHE } from "../src/Invest/dossiers/ficheDossierVue.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (r) => readFileSync(join(racine, r), "utf8");
const COMP = lire("src/Invest/dossiers/AcquisitionMission.jsx");
const FICHE = lire("src/Invest/dossiers/FicheDossier.jsx");
let n = 0, total = 0;
const test = (nom, fn) => { total++; try { fn(); n++; console.log(`  ✔ ${nom}`); } catch (e) { console.log(`  ✘ ${nom}\n      ${e.message.split("\n")[0]}`); process.exitCode = 1; } };
const JOUR = "2026-10-02";

test("1. le stade se déduit des dates, du plus avancé au moins avancé ; l'abandon l'emporte", () => {
  const s = (x) => A.stadeAcquisition(x);
  assert.equal(s({}), "recherche"); assert.equal(s({ offre_acceptee_le: "2026-09-01" }), "offre_acceptee");
  assert.equal(s({ compromis_signe_le: "2026-09-10" }), "sous_compromis"); assert.equal(s({ compromis_signe_le: "2026-09-10", acte_signe_le: "2026-10-01" }), "acte_signe");
  assert.equal(s({ acte_signe_le: "x", compromis_signe_le: "2026-09-10" }), "sous_compromis", "date invalide ignorée");
  assert.equal(s({ acte_signe_le: "2026-10-01", travaux_debut_le: "2026-10-02" }), "en_travaux");
  assert.equal(s({ acte_signe_le: "2026-10-01", travaux_debut_le: "2026-10-02", travaux_fin_le: "2026-10-20" }), "prete_louer");
  assert.equal(s({ acte_signe_le: "2026-10-01", mise_location_le: "2026-10-25" }), "en_location");
  assert.equal(s({ compromis_signe_le: "2026-09-10", abandon_le: "2026-09-20" }), "abandonnee");
});
test("2. conditions suspensives : levées, en attente, en retard et proches (≤ 7 jours) ; liste vide ≠ toutes levées", () => {
  const e = A.etatConditions([{ libelle: "Prêt", echeance: "2026-10-01" }, { libelle: "Urbanisme", echeance: "2026-10-05" }, { libelle: "Servitudes", echeance: "2026-12-01" }, { libelle: "Vente", levee_le: "2026-09-20" }, { libelle: " " }], JOUR);
  assert.equal(e.total, 4); assert.equal(e.levees, 1); assert.equal(e.enAttente, 3);
  assert.deepEqual(e.enRetard.map((x) => [x.libelle, x.jours]), [["Prêt", 1]]); assert.deepEqual(e.proches.map((x) => [x.libelle, x.jours]), [["Urbanisme", 3]]);
  assert.equal(e.toutesLevees, false);
  assert.equal(A.etatConditions([], JOUR).toutesLevees, false); assert.equal(A.etatConditions([{ libelle: "a", levee_le: "2026-09-01" }], JOUR).toutesLevees, true);
  assert.equal(A.etatConditions(null, JOUR).total, 0);
  const auj = A.etatConditions([{ libelle: "Aujourd'hui", echeance: JOUR }], JOUR);
  assert.equal(auj.enRetard.length, 0, "échéance le jour même : pas en retard"); assert.deepEqual(auj.proches.map((x) => x.jours), [0]);
});
test("3. alertes : conditions en retard (rouge) ou proches (orange) et signature dépassée ou proche, seulement sous compromis", () => {
  const sc = { compromis_signe_le: "2026-09-10", signature_prevue_le: "2026-10-01", conditions_suspensives: [{ libelle: "Prêt", echeance: "2026-10-01" }, { libelle: "Urba", echeance: "2026-10-04" }] };
  const al = A.alertesAcquisition(sc, JOUR);
  assert.deepEqual(al.map((x) => x.niveau), ["rouge", "orange", "rouge"]);
  assert.match(al[0].texte, /« Prêt » : échéance dépassée de 1 jour$/); assert.match(al[2].texte, /dépassée de 1 jour, acte non signé/);
  assert.equal(A.alertesAcquisition({ ...sc, signature_prevue_le: "2026-10-10" }, JOUR).at(-1).texte, "Signature de l'acte dans 8 jours");
  assert.deepEqual(A.alertesAcquisition({ ...sc, acte_signe_le: "2026-10-01" }, JOUR), [], "acte signé : plus d'alerte de condition");
  assert.deepEqual(A.alertesAcquisition({ ...sc, abandon_le: "2026-10-01" }, JOUR), []);
  assert.equal(A.alertesAcquisition({ compromis_signe_le: "2026-09-01", acte_signe_le: "2026-09-30", budget_travaux: 30000 }, JOUR)[0].niveau, "info");
});
test("4. fin de délai de rétractation indicative : compromis + 10 jours ; sans compromis, rien", () => {
  assert.equal(A.finRetractation({ compromis_signe_le: "2026-09-25" }), "2026-10-05"); assert.equal(A.finRetractation({ compromis_signe_le: "2026-12-25" }), "2027-01-04");
  assert.equal(A.finRetractation({}), null);
});
test("5. coût d'acquisition : non évaluable sans prix (jamais zéro) ; travaux absents signalés", () => {
  assert.deepEqual(A.coutAcquisition({ prix_signe: 180000, budget_travaux: 25000 }), { prix: 180000, travaux: 25000, travauxRenseignes: true, total: 205000 });
  assert.equal(A.coutAcquisition({ budget_travaux: 25000 }).total, null);
  assert.deepEqual(A.coutAcquisition({ prix_signe: "180 000" }), { prix: 180000, travaux: null, travauxRenseignes: false, total: 180000 });
});
test("6. synthèse : stades comptés ; coût des réalisées non évaluable dès qu'un prix manque", () => {
  const l = [{ compromis_signe_le: "2026-09-01", acte_signe_le: "2026-10-01", prix_signe: 100000 }, { compromis_signe_le: "2026-09-01" }, { abandon_le: "2026-09-01" }, { acte_signe_le: "2026-09-30", mise_location_le: "2026-10-01", prix_signe: 50000, budget_travaux: 5000 }];
  const s = A.syntheseAcquisitions(l);
  assert.equal(s.nombre, 4); assert.equal(s.enCours, 2); assert.equal(s.realisees, 2); assert.equal(s.coutRealise, 155000);
  assert.equal(s.parStade.sous_compromis, 1); assert.equal(s.parStade.abandonnee, 1);
  assert.equal(A.syntheseAcquisitions([...l, { acte_signe_le: "2026-10-01" }]).coutRealise, null);
  assert.equal(A.syntheseAcquisitions([{}]).coutRealise, null); assert.equal(A.syntheseAcquisitions([]).nombre, 0);
});
test("7. erreurs avant envoi : les mêmes règles que la base (chaîne, ordre, abandon, montants, libellé, conditions)", () => {
  assert.deepEqual(A.erreursAcquisition({ libelle: "1 rue Test", compromis_signe_le: "2026-09-01", acte_signe_le: "2026-10-01" }), []);
  const e = (x) => A.erreursAcquisition({ libelle: "X", ...x }).join(" | ");
  assert.match(e({ libelle: " " }), /libellé/); assert.match(e({ acte_signe_le: "2026-10-01" }), /suppose un compromis/);
  assert.match(e({ mise_location_le: "2026-10-01" }), /supposent l'acte signé/); assert.match(e({ travaux_fin_le: "2026-10-01" }), /suppose un début/);
  assert.match(e({ compromis_signe_le: "2026-09-01", acte_signe_le: "2026-10-01", abandon_le: "2026-10-02" }), /ne peut pas être abandonnée/);
  assert.match(e({ compromis_signe_le: "2026-10-01", acte_signe_le: "2026-09-01" }), /L'acte ne peut pas précéder/);
  assert.match(e({ prix_signe: "-5" }), /prix signé doit être/); assert.match(e({ budget_travaux: "abc" }), /budget travaux/);
  assert.match(e({ conditions_suspensives: [{ libelle: "", echeance: "2026-10-01" }] }), /Condition 1/);
  assert.match(e({ conditions_suspensives: Array.from({ length: 16 }, (_, i) => ({ libelle: "c" + i })) }), /15 conditions/);
});
test("8. conditions nettoyées : intitulé obligatoire, dates vides → null", () => {
  assert.deepEqual(A.nettoyerConditions([{ libelle: " Prêt ", echeance: "", levee_le: "2026-10-01" }, { libelle: "", echeance: "2026-10-01" }]), [{ libelle: "Prêt", echeance: null, levee_le: "2026-10-01" }]);
});
test("9. le composant lit et écrit les bonnes tables, vérifie les droits et garde la saisie en cas d'erreur", () => {
  assert.match(COMP, /from\("invest_dossier_acquisitions"\)\.select\("\*"\)\.eq\("dossier_id", dossier\.id\)/);
  assert.match(COMP, /from\("invest_biens"\)\.select\("id,adresse,ville"\)/);
  assert.match(COMP, /upsert\(lignes, \{ onConflict: "id" \}\)/);
  assert.match(COMP, /r\.data\?\.length !== lignes\.length\) throw new Error\("Enregistrement refusé/);
  assert.ok(!/catch \(e\) \{[^}]*charger\(\)/.test(COMP), "pas de rechargement en cas d'erreur");
  assert.match(COMP, /erreursAcquisition\(a\)/);
  assert.match(COMP, /confirm\(`Retirer l'acquisition/);
});
test("10. aucune règle recalculée dans le composant ; aucune écriture hors acquisitions (étapes, financement, opérations)", () => {
  assert.ok(!/from\("invest_dossier_etapes"\)|from\("invest_dossier_financements"\)|from\("invest_dossier_banques"\)|invest_operations|operation_id/.test(COMP));
  assert.ok(!/\.insert\(|\.update\(/.test(COMP), "seul l'upsert et le delete de ses lignes");
  assert.match(COMP, /stadeAcquisition\(a\)/); assert.ok(!/mise_location_le\s*\?\s*"en_location"/.test(COMP));
});
test("11. mise en page : champs contenus dans leur carte ; composants stables hors du rendu", () => {
  assert.match(COMP, /\.mod-carte input,\.mod-carte select,\.mod-carte textarea\{width:100%;min-width:0;box-sizing:border-box\}/);
  assert.match(COMP, /className="mod-carte"/);
  assert.ok(COMP.indexOf("function Carte({ T,") < COMP.indexOf("export default function AcquisitionMission") && !/const (Carte|Chiffre) = \(/.test(COMP));
});
test("12. fiche Mission : l'onglet Acquisition affiche le composant ; plus aucun onglet « en préparation »", () => {
  assert.match(FICHE, /\{onglet === "acquisition" && <AcquisitionMission T=\{T\} fiche=\{fiche\} client=\{client\} dossier=\{fiche\.dossier\} profil=\{profil\} modifiable=\{fiche\.modifiable\} \/>\}/);
  assert.deepEqual(ONGLETS_FICHE.filter((o) => o.enPreparation).map((o) => o.cle), []);
  assert.ok(ONGLETS_FICHE.some((o) => o.cle === "acquisition" && o.etapes.join() === "structuration,acquisition,suivi"));
});

console.log(`\n${n}/${total} contrôles conformes`);
