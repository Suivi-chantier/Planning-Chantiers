import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preparerSimulationPlanningGlobalV1 } from "../src/Renovation/planningEngineAdapterV1.js";
import { preparerSimulationReplanningV1 } from "../src/Renovation/planningReplanningAdapterV1.js";

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, "../src/Renovation/planningReplanningAdapterV1.js"), "utf8");
assert.equal(/(?:\bimport\b|\bfrom\b)[^\n]*supabase/i.test(source), false, "le pont replanning doit rester pur");
assert.equal(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(/.test(source), false, "le pont replanning ne doit rien persister");

const res = (id, nom = id) => ({ id, nom, nom_planning: nom, kind: "personne", actif: true, capacite_facteur: 1 });
const task = (id, extra = {}) => ({
  id, nom: id, heures_vendues: 10, heures_estimees: 8, avancement: 0,
  chrono_groupe_id: "G1", chrono_ordre: 0, ouvriers: [], ...extra,
});
const phasage = (taches = [task("T1")]) => ({
  id: "PH-C1", chantier_id: "C1", updated_at: "2026-08-30T18:00:00Z",
  ouvrages: [{ id: "O1", code_ouvrage: "E-001", taches }],
  plan_travaux: { meta: { chrono_groupes: [{ id: "G1", ordre: 10, groupe_type_id: "gt_reseau_elec" }] } },
});
const options = overrides => ({
  phasages: [phasage()],
  chantiers: [{ id: "C1", nom: "Chantier 1", statut: "en_cours" }],
  cellules: [],
  ressources: [res("R1")],
  evenementsRessources: [],
  contraintes: [],
  groupesTypes: [{ id: "gt_reseau_elec", ordre: 70, equipe_id: "EQ1", ouvriers_prio: [] }],
  equipes: [{ id: "EQ1", nom: "Élec", responsable: "R1", membres: [], externe: false }],
  startDate: "2026-08-31",
  horizonDays: 10,
  ...overrides,
});

// 1. Le raccordement chantier 05 ne change pas le contrat fonctionnel du chantier 04.
{
  const input = options();
  const old = preparerSimulationPlanningGlobalV1(input);
  const next = preparerSimulationReplanningV1(input);
  assert.deepEqual(next.engineInput.travaux.map(t => ({ ...t, provenance: { ...t.provenance, etat_reel: undefined } })), old.engineInput.travaux);
  assert.deepEqual(next.engineInput.ressources, old.engineInput.ressources);
  assert.deepEqual(next.engineInput.allocationsExistantes, old.engineInput.allocationsExistantes);
  assert.deepEqual(next.forecastCourant, old.forecastCourant);
}

// 2. Une tâche 10 h à 60 % apporte 4 h brutes au moteur et garde sa provenance réelle.
{
  const out = preparerSimulationReplanningV1(options({ phasages: [phasage([task("T1", { avancement: 60 })])] }));
  const t = out.engineInput.travaux[0];
  assert.equal(t.heures_mo_restantes, 4);
  assert.equal(t.provenance.restant_brut_mo, 4);
  assert.equal(t.provenance.etat_reel.reste_a_faire_heures, 4);
  assert.equal(t.provenance.etat_reel.source_verite, "phasage");
}

// 3. Une tâche prévue hier mais incomplète reste dans le moteur et est signalée en retard.
{
  const out = preparerSimulationReplanningV1(options({
    phasages: [phasage([task("T1", { avancement: 60, date_prevue: "2026-08-30" })])],
  }));
  const t = out.engineInput.travaux[0];
  assert.equal(t.heures_mo_restantes, 4);
  assert.equal(t.provenance.etat_reel.statut, "en_cours");
  assert.equal(t.provenance.etat_reel.en_retard, true);
}

// 4. Un verrou réserve de la MO future sans falsifier le reste réel brut.
{
  const cell = {
    id: "CELL-1", week_id: "2026-W36", chantier_id: "C1", jour: "Lundi", ouvriers: ["R1"],
    taches: [{ allocation_uid: "LOCK-1", tache_id: "T1", text: "T1", duree: 2, ouvriers: ["R1"] }],
  };
  const contrainte = {
    id: "K1", type: "allocation_lock", scope: "allocation", allocation_id: "LOCK-1",
    hard: true, priority: 100, config: {}, source: "test", actif: true,
  };
  const out = preparerSimulationReplanningV1(options({
    phasages: [phasage([task("T1", { avancement: 60 })])], cellules: [cell], contraintes: [contrainte],
  }));
  const t = out.engineInput.travaux[0];
  assert.equal(t.provenance.etat_reel.reste_a_faire_heures, 4);
  assert.equal(t.provenance.restant_brut_mo, 4);
  assert.equal(t.provenance.mo_reservee_verrou, 2);
  assert.equal(t.heures_mo_restantes, 2);
}

// 5. Une tâche terminée ne revient pas dans les travaux moteur.
{
  const out = preparerSimulationReplanningV1(options({ phasages: [phasage([task("T1", { avancement: 100 })])] }));
  assert.equal(out.engineInput.travaux.length, 0);
  assert.deepEqual(out.engineInput.completedTaskIds, ["C1::T1"]);
}

// 6. Déterminisme strict.
{
  const input = options({ phasages: [phasage([task("T1", { avancement: 35, date_prevue: "2026-08-29" })])] });
  assert.deepEqual(preparerSimulationReplanningV1(input), preparerSimulationReplanningV1(input));
}

console.log("OK — planning replanning adapter V1: 6 scénarios");
