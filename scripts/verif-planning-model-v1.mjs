#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function loadPlanningModel() {
  const url = new URL("../src/Renovation/planningModelV1.js", import.meta.url);
  const source = await readFile(url, "utf8");
  const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  return import(dataUrl);
}

const m = await loadPlanningModel();

const ouvrage = {
  id: "ouv-test",
  identifiant: "ouvrages_v2_ouv-test",
  libelle: "E-007 : Point lumineux test",
  sous_taches: [
    { id: "st_a", nom: "Passage alimentation", lotId: "electricite", groupe_type_id: "gt_reseau_elec", ratio: 50, dependance_mode: "parallel" },
    { id: "st_b", nom: "Pose et raccordement", lotId: "electricite", groupe_type_id: "gt_appareillage_elec", ratio: 50, dependance_mode: "sequence" },
  ],
};

assert.equal(m.estOuvrageV2(ouvrage), true);
assert.equal(m.codeOuvrageDepuisLibelle(ouvrage.libelle), "E-007");

// Règle fondamentale : ordre d'affichage ≠ dépendance dure.
const sansMode = m.normaliserSousTacheV2({ id: "st_x", nom: "Tâche sans règle" });
assert.equal(sansMode.dependance_mode, "parallel");
const ouvrageSansMode = {
  ...ouvrage,
  sous_taches: [
    { id: "st_x", nom: "A", lotId: "electricite", groupe_type_id: "gt_reseau_elec", ratio: 50 },
    { id: "st_y", nom: "B", lotId: "electricite", groupe_type_id: "gt_reseau_elec", ratio: 50 },
  ],
};
assert.equal(m.dependancesInternesOuvrage(ouvrageSansMode).length, 0);

const mat = m.maturiteOuvrageV2(ouvrage);
assert.equal(mat.planifiable, true);
assert.equal(mat.stats.sous_taches, 2);
assert.equal(mat.stats.dependances, 1);

const deps = m.dependancesInternesOuvrage(ouvrage);
assert.equal(deps.length, 1);
assert.equal(deps[0].predecesseur_id, "st_a");
assert.equal(deps[0].successeur_id, "st_b");
assert.equal(deps[0].contrainte, "hard");

let n = 0;
const groupeMap = {
  gt_reseau_elec: "g_reseau",
  gt_appareillage_elec: "g_app",
};
const tasks = m.construireTachesDepuisOuvrageV2(ouvrage, {
  makeTaskId: () => `task_${++n}`,
  resolveChronoGroupId: id => groupeMap[id] || null,
  heuresTotales: 10,
});

assert.equal(tasks.length, 2);
assert.equal(tasks[0].source_sous_tache_id, "st_a");
assert.equal(tasks[0].chrono_groupe_id, "g_reseau");
assert.deepEqual(tasks[0].predecesseurs, []);
assert.equal(tasks[1].source_sous_tache_id, "st_b");
assert.equal(tasks[1].chrono_groupe_id, "g_app");
assert.deepEqual(tasks[1].predecesseurs, ["task_1"]);
assert.equal(tasks[0].heures_estimees, 5);
assert.equal(tasks[1].heures_estimees, 5);

const explicite = {
  ...ouvrage,
  sous_taches: [
    { ...ouvrage.sous_taches[0], dependance_mode: "parallel" },
    { ...ouvrage.sous_taches[1], dependance_mode: "explicit", predecesseur_ids: ["st_a"], delai_min_calendaire: 24 },
  ],
};
const d2 = m.dependancesInternesOuvrage(explicite);
assert.equal(d2.length, 1);
assert.equal(d2[0].delai_min_calendaire, 24);

const incomplet = {
  id: "bad",
  identifiant: "ouvrages_v2_bad",
  libelle: "MU-006 : Support Linky",
  sous_taches: [{ nom: "", ratio: 0 }],
};
const bad = m.maturiteOuvrageV2(incomplet);
assert.equal(bad.planifiable, false);
assert.ok(bad.erreurs.some(e => e.includes("sans nom")));
assert.ok(bad.erreurs.some(e => e.includes("sans identifiant stable")));
assert.ok(bad.erreurs.some(e => e.includes("sans groupe d'exécution")));

// Un ratio null reste une donnée absente : il ne doit jamais être transformé
// en 0 h ni permettre à l'ouvrage de devenir planifiable si les autres ratios
// totalisent déjà 100 %.
const ratioManquant = {
  id: "ratio-missing",
  identifiant: "ouvrages_v2_ratio-missing",
  libelle: "E-099 : Test ratio manquant",
  sous_taches: [
    { id: "st_r1", nom: "A", lotId: "electricite", groupe_type_id: "gt_reseau_elec", ratio: 100, dependance_mode: "parallel" },
    { id: "st_r2", nom: "B", lotId: "electricite", groupe_type_id: "gt_appareillage_elec", ratio: null, dependance_mode: "parallel" },
  ],
};
const missingRatio = m.maturiteOuvrageV2(ratioManquant);
assert.equal(missingRatio.planifiable, false);
assert.ok(missingRatio.erreurs.some(e => e.includes("sans ratio")));
let taskCounter = 0;
const missingRatioTasks = m.construireTachesDepuisOuvrageV2(ratioManquant, {
  makeTaskId: () => `ratio_task_${++taskCounter}`,
  heuresTotales: 10,
});
assert.equal(missingRatioTasks[1].ratio, null);
assert.equal(missingRatioTasks[1].heures_estimees, null);

console.log("planningModelV1 fixtures: OK");
