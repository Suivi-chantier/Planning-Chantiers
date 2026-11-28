// Données fictives : aucun appel à la base.
import test from "node:test";
import assert from "node:assert/strict";
import { matchFournisseur, nomsFournisseur } from "../src/fournisseursNoms.mjs";

const REF = [
  { id: "z", nom: "ZOLPAN", regles_numero: { alias: ["CROMOLOGY"] } },
  { id: "r", nom: "REXEL", regles_numero: { prefixes: ["CL-4900-"] } },
  { id: "pp", nom: "Point P" }, { id: "pv", nom: "Point Vert" },
];

test("raison sociale ≠ enseigne : Cromology → ZOLPAN grâce à l'alias", () => {
  assert.equal(matchFournisseur("CROMOLOGY DISTRIBUTION CENTRE OUEST", REF).fournisseur?.id, "z");
  assert.equal(matchFournisseur("Zolpan Angers", REF).fournisseur?.id, "z");
  assert.equal(matchFournisseur("CROMOLOGY DISTRIBUTION CENTRE OUEST", [{ id: "z", nom: "ZOLPAN" }]).fournisseur, null);
});

test("comportement existant inchangé", () => {
  assert.equal(matchFournisseur("Rexel France", REF).fournisseur?.id, "r");
  assert.equal(matchFournisseur("Point", REF).score > 0, true);
  assert.equal(matchFournisseur("", REF).fournisseur, null);
  assert.deepEqual(nomsFournisseur({ nom: "A", regles_numero: { alias: ["B", ""] } }), ["A", "B"]);
  assert.deepEqual(nomsFournisseur({ nom: "A" }), ["A"]);
});
