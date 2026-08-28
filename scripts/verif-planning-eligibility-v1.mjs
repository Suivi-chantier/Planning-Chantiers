#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rulesSource = await readFile(new URL("../src/Renovation/planningRulesV1.js", import.meta.url), "utf8");
const rulesUrl = `data:text/javascript;base64,${Buffer.from(rulesSource).toString("base64")}`;
let eligibilitySource = await readFile(new URL("../src/Renovation/planningEligibilityV1.js", import.meta.url), "utf8");
eligibilitySource = eligibilitySource.replace('"./planningRulesV1.js"', JSON.stringify(rulesUrl));
const eligibilityUrl = `data:text/javascript;base64,${Buffer.from(eligibilitySource).toString("base64")}`;
const { evaluerEligibiliteTacheV1 } = await import(eligibilityUrl);

const reseau = { id: "r1", nom: "Réseau plomberie SDB", groupe_type_id: "gt_reseau_plomberie", avancement: 40 };
const placo = { id: "p1", nom: "Fermeture BA13 SDB", groupe_type_id: "gt_laine_placo", avancement: 0, predecesseurs: [] };

// Sans information de zone/support, la règle globale ne doit pas bloquer tout le chantier.
const unknownScope = evaluerEligibiliteTacheV1(placo, { taches: [reseau, placo] });
assert.equal(unknownScope.eligible, true);
assert.ok(unknownScope.warnings.some(w => w.type === "scope_technique_inconnu"));

// Si le moteur sait que les travaux concernent le même support, le blocage devient réel.
const sameScope = evaluerEligibiliteTacheV1(placo, {
  taches: [reseau, placo],
  resolveScope: () => true,
});
assert.equal(sameScope.eligible, false);
assert.ok(sameScope.blockers.some(b => b.type === "predecesseur_non_termine"));

// Une dépendance explicite d'ouvrage bloque indépendamment du scope global.
const explicite = { ...placo, predecesseurs: ["r1"] };
const explicitResult = evaluerEligibiliteTacheV1(explicite, { taches: [reseau, explicite] });
assert.equal(explicitResult.eligible, false);

// Délai technique calendrier après un prédécesseur terminé.
const fini = { ...reseau, avancement: 100, completed_at: "2026-08-27T10:00:00.000Z" };
const avecDelai = {
  id: "enduit2",
  nom: "Deuxième passe",
  groupe_type_id: "gt_laine_placo",
  avancement: 0,
  dependances: [{
    predecesseur_id: "r1",
    contrainte: "hard",
    delai_min_calendaire: 24,
    unite_delai: "heures",
    origine: "ouvrage_v2",
  }],
  predecesseurs: ["r1"],
};
const delayResult = evaluerEligibiliteTacheV1(avecDelai, {
  taches: [fini, avecDelai],
  maintenant: "2026-08-27T20:00:00.000Z",
});
assert.equal(delayResult.eligible, false);
assert.equal(delayResult.earliest_start, "2026-08-28T10:00:00.000Z");
assert.ok(delayResult.blockers.some(b => b.type === "delai_technique"));

// Une préférence SOFT ne rend jamais la tâche inéligible.
const peinture = { id: "paint", nom: "Peinture", groupe_type_id: "gt_peinture", avancement: 50 };
const sol = { id: "floor", nom: "Sol PVC", groupe_type_id: "gt_sols", avancement: 0, predecesseurs: [] };
const soft = evaluerEligibiliteTacheV1(sol, { taches: [peinture, sol] });
assert.equal(soft.eligible, true);
assert.ok(soft.preferences.some(p => p.rule_id === "pref_peinture_avant_sols"));

console.log("planningEligibilityV1 fixtures: OK");
