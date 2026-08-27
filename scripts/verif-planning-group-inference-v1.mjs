#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function loadModule(relative) {
  const url = new URL(relative, import.meta.url);
  const source = await readFile(url, "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const m = await loadModule("../src/Renovation/planningGroupInferenceV1.js");
const { infererGroupeExecutionV1: infer, GROUPES_EXECUTION_V1: G, CONFIANCE_GROUPE_V1: C } = m;

const cases = [
  [{ code: "E-002", nom: "Pose tableau + GTL", lotId: "electricite", position: 5 }, G.RESEAU_ELEC, C.CERTAIN],
  [{ code: "E-002", nom: "Pose de l'appareillage", lotId: "electricite", position: 6 }, G.APPAREILLAGE_ELEC, C.CERTAIN],
  [{ code: "E-006", nom: "Passage alimentation point lumineux", lotId: "electricite", position: 1 }, G.RESEAU_ELEC, C.CERTAIN],
  [{ code: "E-006", nom: "Pose et raccordement plafonnier", lotId: "electricite", position: 2 }, G.APPAREILLAGE_ELEC, C.CERTAIN],
  [{ code: "E-021", nom: "Passages des gaines VMC", lotId: "electricite", position: 2 }, G.RESEAU_ELEC, C.CERTAIN],
  [{ code: "E-021", nom: "Pose des bouches VMC", lotId: "electricite", position: 4 }, G.APPAREILLAGE_ELEC, C.CERTAIN],
  [{ code: "P-800", nom: "Mise en place d'une nourrice EF", lotId: "plomberie", position: 6 }, G.RESEAU_PLOMBERIE, C.CERTAIN],
  [{ code: "P-800", nom: "Raccordement électrique + groupe sécu Chauffe-eau", lotId: "electricite", position: 5 }, G.APPAREILLAGE_PLOMBERIE, C.CERTAIN],
  [{ code: "P-1100", nom: "Montage des meubles cuisine", lotId: "plomberie", position: 3 }, G.APPAREILLAGE_PLOMBERIE, C.CERTAIN],
  [{ code: "MU-001", nom: "Pose ossature métallique doublage", lotId: "murs_cloison", position: 1 }, G.OSSATURE_MENUISERIE_INT, C.CERTAIN],
  [{ code: "MU-001", nom: "Bandes et 1ère passe doublage", lotId: "murs_cloison", position: 4 }, G.LAINE_PLACO_ENDUIT, C.CERTAIN],
  [{ code: "MU-021", nom: "Couche d'impression", lotId: "murs_cloison", position: 4 }, G.PEINTURE, C.CERTAIN],
  [{ code: "PL-001", nom: "Pose ossature faux plafonds", lotId: "murs_cloison", position: 1 }, G.OSSATURE_MENUISERIE_INT, C.CERTAIN],
  [{ code: "PL-001", nom: "Plaquage BA13 faux plafonds", lotId: "murs_cloison", position: 2 }, G.LAINE_PLACO_ENDUIT, C.CERTAIN],
  [{ code: "S-001", nom: "Pose des barres de seuils et finitions de pose", lotId: "sol", position: 3 }, G.SOLS, C.CERTAIN],
  [{ code: "ME-003", nom: "Mise en place et fixation du bloc-porte", lotId: "menuiserie", position: 1 }, G.OSSATURE_MENUISERIE_INT, C.CERTAIN],
  [{ code: "ME-003", nom: "Pose serrure, poignée et accessoires", lotId: "finitions_gen", position: 2 }, G.FINITION_GENERALE, C.CERTAIN],
];

for (const [input, expectedGroup, expectedConfidence] of cases) {
  const got = infer(input);
  assert.equal(got.groupe_type_id, expectedGroup, `${input.code} / ${input.nom}`);
  assert.equal(got.confiance, expectedConfidence, `${input.code} / ${input.nom}`);
  assert.ok(got.regle);
  assert.ok(got.raison);
}

const dAnomaly = infer({ code: "D-003.1", nom: "Raccordement évacuation générale", lotId: "plomberie", position: 2 });
assert.equal(dAnomaly.groupe_type_id, null);
assert.equal(dAnomaly.confiance, C.REVIEW);

const muAnomaly = infer({ code: "MU-006", nom: "", lotId: "", position: 1 });
assert.equal(muAnomaly.confiance, C.REVIEW);

const meFire = infer({ code: "ME-001", nom: "Mise en place et fixation bloc porte coupe-feu", lotId: "menuiserie", position: 1 });
assert.equal(meFire.groupe_type_id, G.MENUISERIE_EXT);
assert.equal(meFire.confiance, C.PROBABLE);

const e008 = infer({ code: "E-008", nom: "Mise en place disjoncteur 500mA", lotId: "electricite", position: 2 });
assert.equal(e008.groupe_type_id, G.RESEAU_ELEC);
assert.equal(e008.confiance, C.PROBABLE);

console.log("planningGroupInferenceV1 fixtures: OK");
