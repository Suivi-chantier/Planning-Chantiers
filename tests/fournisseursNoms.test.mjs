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

import { normTva, reconnaitreFournisseur } from "../src/fournisseursNoms.mjs";

const REF_TVA = [
  { id: "z", nom: "ZOLPAN", tva_intracom: "FR00111111111", regles_numero: { alias: ["CROMOLOGY", "TOLLENS"] } },
  { id: "r", nom: "REXEL", tva_intracom: "fr00222222222" },
  { id: "w", nom: "WURTH", regles_numero: { alias: ["WURTH PROXI SHOP"] } },
];

test("normTva : majuscules, sans espaces ni points", () => {
  assert.equal(normTva(" fr 00 111.111 111 "), "FR00111111111");
  assert.equal(normTva(null), "");
});

test("reconnaissance par TVA d'abord, même si le nom lu est autre", () => {
  const r = reconnaitreFournisseur({ tva: "FR 00 111 111 111", nom: "Société inconnue" }, REF_TVA);
  assert.equal(r.fournisseur?.id, "z");
  assert.equal(r.par, "tva");
  // TVA en base saisie en minuscules : reconnue quand même
  assert.equal(reconnaitreFournisseur({ tva: "FR00222222222" }, REF_TVA).fournisseur?.id, "r");
});

test("TVA inconnue ou absente : alias puis nom", () => {
  assert.equal(reconnaitreFournisseur({ tva: "FR99999999999", nom: "TOLLENS" }, REF_TVA).par, "nom");
  assert.equal(reconnaitreFournisseur({ tva: "FR99999999999", nom: "TOLLENS" }, REF_TVA).fournisseur?.id, "z");
  assert.equal(reconnaitreFournisseur({ nom: "Wurth Proxi Shop" }, REF_TVA).fournisseur?.id, "w");
});

test("rien de reconnu : fournisseur null, jamais de création", () => {
  const r = reconnaitreFournisseur({ tva: "", nom: "Fournisseur Nouveau SARL" }, REF_TVA);
  assert.equal(r.fournisseur, null);
  assert.equal(r.par, null);
  assert.equal(reconnaitreFournisseur({}, REF_TVA).fournisseur, null);
  assert.equal(reconnaitreFournisseur({ tva: "FR00111111111" }, []).fournisseur, null);
});
