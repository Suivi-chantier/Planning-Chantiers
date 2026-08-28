#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function loadModule(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  return import(dataUrl);
}

const m = await loadModule("../src/Renovation/planningDependencyInferenceV1.js");

const e007 = {
  libelle: "E-007 : Point lumineux",
  sous_taches: [
    { id: "a", nom: "Passage alimentation", dependance_mode: "parallel", predecesseur_ids: [] },
    { id: "b", nom: "Pose et raccordement", dependance_mode: "parallel", predecesseur_ids: [] },
  ],
};
const p1 = m.proposerDependancesOuvrageV1(e007);
assert.equal(p1.applicable, true);
assert.equal(p1.confiance, "certain");
assert.equal(p1.suggestions.length, 2);
assert.equal(p1.suggestions[0].dependance_mode, "parallel");
assert.deepEqual(p1.suggestions[0].predecesseur_ids, []);
assert.equal(p1.suggestions[1].dependance_mode, "explicit");
assert.deepEqual(p1.suggestions[1].predecesseur_ids, ["a"]);

const e007Applied = m.appliquerPropositionDependancesV1(e007, p1);
assert.equal(e007Applied.sous_taches[0].dependance_mode, "parallel");
assert.equal(e007Applied.sous_taches[1].dependance_mode, "explicit");
assert.deepEqual(e007Applied.sous_taches[1].predecesseur_ids, ["a"]);

const composite = {
  libelle: "P-021.2 : Salle de bain complète",
  sous_taches: [
    { id: "r1", nom: "Passage alimentation PER douche" },
    { id: "r2", nom: "Passage évacuation douche" },
    { id: "o1", nom: "Pose ossature cloison" },
  ],
};
const p2 = m.proposerDependancesOuvrageV1(composite);
assert.equal(p2.applicable, false);
assert.equal(p2.confiance, "review");
assert.ok(p2.suggestions.every(s => s.predecesseur_ids.length === 0));
assert.ok(p2.suggestions.every(s => s.dependance_mode === "parallel"));

const sansId = {
  libelle: "MU-001 : Doublage",
  sous_taches: [{ nom: "Ossature" }, { id: "b", nom: "Isolation" }],
};
const p3 = m.proposerDependancesOuvrageV1(sansId);
assert.equal(p3.applicable, false);
assert.ok(p3.raison.includes("Identifiants stables"));

console.log("planningDependencyInferenceV1 fixtures: OK");
