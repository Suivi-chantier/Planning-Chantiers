#!/usr/bin/env node
// Vérifie le regroupement Opération → Chantiers de l'espace ouvrier
// (src/Renovation/ouvrierOperations.mjs). Fonctions pures : aucun réseau,
// aucune base, aucune écriture.
//   node scripts/verif-ouvrier-operations.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { grouperParOperation, compterStatuts, statutChantier, ORDRE_STATUTS } =
  await import(new URL("../src/Renovation/ouvrierOperations.mjs", import.meta.url).href);

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// Jeu d'essai couvrant les quatre situations à contrôler.
const OPS = [
  { id: "op_1", nom: "Tourbouton", adresse: "12 square de la Tour Bouton", couleur: "#ef4444" },
  { id: "op_2", nom: "Briollay",   adresse: "",                            couleur: "#14b8a6" },
  { id: "op_3", nom: "Vide",       adresse: "nulle part",                  couleur: "#000000" },
];
const CHANTIERS = [
  { id: "c1", nom: "T2 gauche",  couleur: "#aaa", statut: "en_cours", operation_id: "op_1" },
  { id: "c2", nom: "T3 droite",  couleur: "#bbb", statut: "termine",  operation_id: "op_1" },
  { id: "c3", nom: "Maison",     couleur: "#ccc", statut: "planifie", operation_id: "op_2" },
  { id: "c4", nom: "Sans lien",  couleur: "#ddd", statut: "en_pause" },                       // pas d'operation_id
  { id: "c5", nom: "Lien vide",  couleur: "#eee", statut: "en_cours", operation_id: "" },     // operation_id vide
  { id: "c6", nom: "Lien cassé", couleur: "#fff", statut: "en_cours", operation_id: "op_XX" },// opération inconnue
];

test("chantier avec opération valide → rattaché à son opération", () => {
  const { operations } = grouperParOperation(OPS, CHANTIERS);
  const op1 = operations.find((o) => o.id === "op_1");
  assert.ok(op1, "op_1 doit être présente");
  assert.deepEqual(op1.chantiers.map((c) => c.id), ["c1", "c2"]);
  assert.equal(op1.nom, "Tourbouton", "les champs de l'opération sont conservés");
  assert.equal(op1.adresse, "12 square de la Tour Bouton");
});

test("chantier sans operation_id → hors opération", () => {
  const { horsOperation } = grouperParOperation(OPS, CHANTIERS);
  assert.ok(horsOperation.some((c) => c.id === "c4"), "c4 (champ absent) doit être hors opération");
  assert.ok(horsOperation.some((c) => c.id === "c5"), "c5 (champ vide) doit être hors opération");
});

test("chantier avec operation_id inconnu → hors opération, jamais masqué", () => {
  const { operations, horsOperation } = grouperParOperation(OPS, CHANTIERS);
  assert.ok(horsOperation.some((c) => c.id === "c6"), "c6 doit rester joignable");
  const rattaches = operations.flatMap((o) => o.chantiers.map((c) => c.id));
  assert.ok(!rattaches.includes("c6"), "c6 ne doit être rattaché à aucune opération");
});

test("opération sans chantier → absente de la liste", () => {
  const { operations } = grouperParOperation(OPS, CHANTIERS);
  assert.ok(!operations.some((o) => o.id === "op_3"), "op_3 n'a aucun chantier : ne pas l'afficher");
  assert.deepEqual(operations.map((o) => o.id), ["op_1", "op_2"], "ordre des opérations conservé");
});

test("aucun chantier n'est perdu ni compté deux fois", () => {
  const { operations, horsOperation } = grouperParOperation(OPS, CHANTIERS);
  const vus = [...operations.flatMap((o) => o.chantiers.map((c) => c.id)), ...horsOperation.map((c) => c.id)];
  assert.equal(vus.length, CHANTIERS.length, "autant de chantiers en sortie qu'en entrée");
  assert.equal(new Set(vus).size, CHANTIERS.length, "aucun doublon");
});

test("compteurs de statuts : présents seulement, dans l'ordre d'affichage", () => {
  const { operations } = grouperParOperation(OPS, CHANTIERS);
  const op1 = operations.find((o) => o.id === "op_1");
  assert.deepEqual(op1.statuts, [{ statut: "en_cours", n: 1 }, { statut: "termine", n: 1 }]);
  const melange = compterStatuts([
    { statut: "termine" }, { statut: "en_cours" }, { statut: "planifie" }, { statut: "en_cours" },
  ]);
  assert.deepEqual(melange.map((s) => s.statut), ["en_cours", "planifie", "termine"],
    "l'ordre suit ORDRE_STATUTS, pas l'ordre d'arrivée");
  assert.equal(melange.find((s) => s.statut === "en_cours").n, 2);
});

test("statut absent ou inconnu → replié sur en_cours, jamais ignoré", () => {
  assert.equal(statutChantier({}), "en_cours");
  assert.equal(statutChantier({ statut: "zzz" }), "en_cours");
  assert.equal(statutChantier({ statut: "termine" }), "termine");
  assert.deepEqual(compterStatuts([{}, { statut: "zzz" }]), [{ statut: "en_cours", n: 2 }]);
  assert.deepEqual(ORDRE_STATUTS, ["en_cours", "planifie", "en_pause", "termine"]);
});

test("entrées vides ou absentes → aucun plantage", () => {
  assert.deepEqual(grouperParOperation(), { operations: [], horsOperation: [] });
  assert.deepEqual(grouperParOperation([], []), { operations: [], horsOperation: [] });
  const sansOps = grouperParOperation([], CHANTIERS);
  assert.equal(sansOps.operations.length, 0);
  assert.equal(sansOps.horsOperation.length, CHANTIERS.length,
    "sans référentiel d'opérations, tous les chantiers restent accessibles");
  const avecTrous = grouperParOperation([null, { nom: "sans id" }], [null, { id: "c" }]);
  assert.equal(avecTrous.horsOperation.length, 1);
});

test("le module ne contient aucune notion financière", () => {
  // Garde-fou : ce helper alimente un écran OUVRIER. Aucun prix, aucune marge,
  // aucun taux ne doit y entrer, même par un renommage distrait.
  const source = readFileSync(
    new URL("../src/Renovation/ouvrierOperations.mjs", import.meta.url), "utf8");
  const interdits = ["prix", "marge", "taux", "montant", "cout", "coût", "euro", "vendu", "facture"];
  const code = source.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n").toLowerCase();
  for (const mot of interdits) {
    assert.ok(!code.includes(mot), `le mot « ${mot} » ne doit pas apparaître dans le code du module`);
  }
});

let echecs = 0;
for (const [nom, fn] of cas) {
  try {
    await fn();
    console.log(`  ok   ${nom}`);
  } catch (e) {
    echecs++;
    console.error(`  ÉCHEC ${nom}\n        ${String(e?.message || e).split("\n").join("\n        ")}`);
  }
}
console.log(`\nverif-ouvrier-operations : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
