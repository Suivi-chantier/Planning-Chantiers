#!/usr/bin/env node
// Vérifie src/Invest/structurationCollecte.mjs. Jeu de données : exemple issu des tests, données fictives.
import assert from "node:assert/strict";
import * as K from "../src/Invest/structurationCollecte.mjs";

const cas = [];
const test = (n, f) => cas.push([n, f]);
const COMPLET = () => ({ collecte: {
  profil: { situation_familiale: "Marié", regime_matrimonial: "Communauté", statut_pro: "Salarié CDI", tmi: "30 %", revenus_nets_mois: "5000" },
  charges: { logement: "1200", epargne_reelle_mois: "800" },
  patrimoine: { residence_principale_statut: "Propriétaire", rp_valeur: "300000", rp_crd: "100000", lots: [{ adresse: "A", valeur: "200000", loyer_mois: "1000", mensualite: "700", crd: "120000" }] },
  patrimoine_financier: { liquidites: "20000" },
  dettes: [{ capital_restant: "5000", mensualite: "200" }],
  objectifs_mesures: [{ montant: "2500", echeance: "2036", priorite: "1" }],
  profil_immo: { tolerance_endettement: "Moyenne", cashflow_negatif_max: "200", appetence_travaux: "Limitée", appetence_gestion: "Délègue tout" },
} });

test("1. le socle compte quatorze questions, réparties sur cinq étapes", () => {
  assert.equal(K.QUESTIONS_SOCLE.length, 14);
  assert.deepEqual(new Set(K.QUESTIONS_SOCLE.map((q) => q.etape)), new Set(K.ETAPES_COLLECTE.map((e) => e.cle)));
});
test("2. dossier vide : rien de répondu, et la liste de ce qui manque est complète", () => {
  const r = K.avancementCollecte({});
  // Seule « régime matrimonial » est sans objet pour un dossier vide (pas de couple déclaré).
  assert.deepEqual(r.questions.filter((q) => q.ok).map((q) => q.cle), ["regime"]);
  assert.equal(r.manquantes.length, 13); assert.equal(r.pretPourDiagnostic, false); assert.equal(r.diagnosticPossible, false);
});
test("3. dossier complet : 14/14, prêt pour le diagnostic", () => {
  const r = K.avancementCollecte(COMPLET());
  assert.equal(r.faites, 14); assert.equal(r.pretPourDiagnostic, true); assert.equal(r.pourcentage, 100);
});
test("4. le régime matrimonial n'est demandé qu'aux couples mariés ou pacsés", () => {
  const d = COMPLET(); d.collecte.profil.situation_familiale = "Célibataire"; delete d.collecte.profil.regime_matrimonial;
  assert.ok(K.avancementCollecte(d).questions.find((q) => q.cle === "regime").ok);
  d.collecte.profil.situation_familiale = "Pacsé";
  assert.ok(!K.avancementCollecte(d).questions.find((q) => q.cle === "regime").ok);
});
test("5. « aucun bien » et « aucune autre dette » comptent comme des réponses ; le silence non", () => {
  const d = COMPLET(); d.collecte.patrimoine.lots = []; d.collecte.dettes = [];
  let r = K.avancementCollecte(d);
  assert.ok(!r.questions.find((q) => q.cle === "biens").ok && !r.questions.find((q) => q.cle === "dettes").ok);
  d.collecte.patrimoine.aucun_bien = true; d.collecte.patrimoine.aucune_autre_dette = true;
  r = K.avancementCollecte(d);
  assert.ok(r.questions.find((q) => q.cle === "biens").ok && r.questions.find((q) => q.cle === "biens_complets").ok && r.questions.find((q) => q.cle === "dettes").ok);
});
test("6. un bien incomplet (loyer manquant) bloque « biens complets », mais pas le prix d'acquisition", () => {
  const d = COMPLET(); delete d.collecte.patrimoine.lots[0].loyer_mois;
  assert.ok(!K.avancementCollecte(d).questions.find((q) => q.cle === "biens_complets").ok);
  const e = COMPLET(); assert.ok(K.avancementCollecte(e).questions.find((q) => q.cle === "biens_complets").ok, "pas de prix d'acquisition exigé");
});
test("7. « TMI à vérifier » n'est pas une réponse", () => {
  const d = COMPLET(); d.collecte.profil.tmi = "À vérifier";
  assert.ok(!K.avancementCollecte(d).questions.find((q) => q.cle === "tmi").ok);
});
test("8. un objectif incomplet empêche la question objectifs", () => {
  const d = COMPLET(); d.collecte.objectifs_mesures.push({ libelle: "vague" });
  assert.ok(!K.avancementCollecte(d).questions.find((q) => q.cle === "objectifs").ok);
});
test("9. profil investisseur : les quatre critères clés suffisent", () => {
  const d = COMPLET(); delete d.collecte.profil_immo.appetence_gestion;
  assert.ok(!K.avancementCollecte(d).questions.find((q) => q.cle === "profil").ok);
});
test("10. avancement par étape : les totaux des étapes somment à 14", () => {
  const r = K.avancementCollecte(COMPLET());
  assert.equal(r.parEtape.reduce((s, e) => s + e.total, 0), 14); assert.equal(r.parEtape.reduce((s, e) => s + e.faites, 0), 14);
});
test("11. pièces : un salarié propriétaire reçoit le socle, l'immobilier et les bulletins, pas les pièces de dirigeant", () => {
  const p = K.documentsPertinents(COMPLET());
  for (const id of ["piece_identite", "avis_imposition", "actes_notaries", "baux", "credits_en_cours", "bulletins_salaire", "contrat_mariage"]) assert.ok(p.has(id), id);
  for (const id of ["bilans_entreprise", "urssaf", "statuts_societes", "declaration_ifi", "declarations_etrangeres"]) assert.ok(!p.has(id), id);
});
test("12. chaque module ouvre ses pièces, et dirigeant retire les bulletins de salaire", () => {
  const d = COMPLET(); d.collecte.modules = { dirigeant: true, structure_existante: true, expatrie: true, ifi: true };
  const p = K.documentsPertinents(d);
  for (const id of ["bilans_entreprise", "liasse_fiscale", "statuts_societes", "kbis_sci", "declarations_etrangeres", "declaration_ifi"]) assert.ok(p.has(id), id);
  assert.ok(!p.has("bulletins_salaire"));
});
test("13. sans bien ni dette : pas de pièces immobilières ni de crédits", () => {
  const p = K.documentsPertinents({ collecte: { profil: { situation_familiale: "Célibataire" } } });
  assert.ok(!p.has("actes_notaries") && !p.has("credits_en_cours") && !p.has("contrat_mariage"));
  assert.ok(p.has("piece_identite") && p.has("consentement_rgpd"));
});
test("14. pièces conditionnées par les placements saisis (assurance-vie, PEA, PER)", () => {
  const d = COMPLET(); d.collecte.patrimoine_financier = { liquidites: "1", assurance_vie: "40000", per: "10000" };
  const p = K.documentsPertinents(d);
  assert.ok(p.has("assurance_vie") && p.has("per_retraite") && !p.has("pea_cto"));
});
test("15. une pièce sans identifiant est pertinente (données anciennes)", () => {
  assert.equal(K.estPertinent(new Set(), { label: "x" }), true);
  assert.equal(K.estPertinent(new Set(["a"]), { id: "b" }), false);
});
test("16. le diagnostic n'est possible qu'avec les huit questions chiffrées, et dit lesquelles manquent", () => {
  const d = COMPLET(); delete d.collecte.profil_immo; delete d.collecte.objectifs_mesures;   // objectifs et profil ne bloquent pas le diagnostic
  assert.equal(K.avancementCollecte(d).diagnosticPossible, true);
  delete d.collecte.charges;
  const r = K.avancementCollecte(d);
  assert.equal(r.diagnosticPossible, false); assert.deepEqual(r.manquantesDiagnostic.map((q) => q.cle), ["charges", "epargne"]);
});
test("17. tous les identifiants cités existent dans la liste de pièces du dossier", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/Invest/Structuration.jsx", import.meta.url), "utf8");
  const ids = new Set([...src.matchAll(/\{ id:"([a-z_0-9]+)", categorie:/g)].map((m) => m[1]));
  const cites = new Set([...K.documentsPertinents({ collecte: { profil: { situation_familiale: "Marié" }, patrimoine: { lots: [{ adresse: "a" }] }, dettes: [{}], patrimoine_financier: { assurance_vie: "1", pea_cto: "1", per: "1" }, modules: Object.fromEntries(K.MODULES.map((m) => [m.cle, true])) } })]);
  for (const id of cites) assert.ok(ids.has(id), `pièce inconnue : ${id}`);
});

let echecs = 0;
for (const [n, f] of cas) { try { await f(); console.log(`  ✓ ${n}`); } catch (e) { echecs++; console.log(`  ✗ ${n}\n      ${e.message}`); } }
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
