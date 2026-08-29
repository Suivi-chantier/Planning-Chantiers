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

const res = (id, nom = id, kind = "personne", facteur = 1) => ({ id, nom, nom_planning: nom, kind, actif: true, capacite_facteur: facteur });
const task = (id, extra = {}) => ({
  id, nom: id, heures_vendues: 10, heures_estimees: 8, avancement: 0,
  chrono_groupe_id: "G1", chrono_ordre: 0, ouvriers: [], ...extra,
});
const phasage = (taches = [task("T1")], groupeTypeId = "gt_reseau_elec") => ({
  id: "PH-C1", chantier_id: "C1", updated_at: "2026-08-30T18:00:00Z",
  ouvrages: [{ id: "O1", code_ouvrage: "E-001", taches }],
  plan_travaux: { meta: { chrono_groupes: [{ id: "G1", ordre: 10, groupe_type_id: groupeTypeId }] } },
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
const forecastCell = (ouvriers, jour = "Mardi", tacheId = "T1") => ({
  id: `CELL-${jour}-${tacheId}`, week_id: "2026-W36", chantier_id: "C1", jour, ouvriers,
  taches: [{ allocation_uid: `A-${jour}-${tacheId}`, tache_id: tacheId, text: tacheId, duree: 2, ouvriers }],
});
const externalOptions = (cellules = [], ressources = [res("R1"), res("EXT", "Externe", "prestataire", 0)]) => options({
  phasages: [phasage([task("T1")], "gt_ext")],
  cellules,
  ressources,
  groupesTypes: [{ id: "gt_ext", ordre: 10, equipe_id: "EQ_EXT", ouvriers_prio: [] }],
  equipes: [{ id: "EQ_EXT", nom: "Externe", responsable: "", membres: [], externe: true }],
});

function retirerEtatReel(travaux) {
  return travaux.map(t => {
    const { etat_reel: _etat, ...provenance } = t.provenance || {};
    return { ...t, provenance };
  });
}

// 1. Le raccordement chantier 05 ne change pas le contrat fonctionnel du chantier 04 sans exception explicite.
{
  const input = options();
  const old = preparerSimulationPlanningGlobalV1(input);
  const next = preparerSimulationReplanningV1(input);
  assert.deepEqual(retirerEtatReel(next.engineInput.travaux), old.engineInput.travaux);
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
  const out = preparerSimulationReplanningV1(options({ phasages: [phasage([task("T1", { avancement: 60, date_prevue: "2026-08-30" })])] }));
  const t = out.engineInput.travaux[0];
  assert.equal(t.heures_mo_restantes, 4);
  assert.equal(t.provenance.etat_reel.statut, "en_cours");
  assert.equal(t.provenance.etat_reel.en_retard, true);
}

// 4. Un verrou réserve de la MO future sans falsifier le reste réel brut.
{
  const cell = { id: "CELL-1", week_id: "2026-W36", chantier_id: "C1", jour: "Lundi", ouvriers: ["R1"], taches: [{ allocation_uid: "LOCK-1", tache_id: "T1", text: "T1", duree: 2, ouvriers: ["R1"] }] };
  const contrainte = { id: "K1", type: "allocation_lock", scope: "allocation", allocation_id: "LOCK-1", hard: true, priority: 100, config: {}, source: "test", actif: true };
  const out = preparerSimulationReplanningV1(options({ phasages: [phasage([task("T1", { avancement: 60 })])], cellules: [cell], contraintes: [contrainte] }));
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

// 7. Groupe externe sans affectation forecast interne : exclusion inchangée.
{
  const out = preparerSimulationReplanningV1(externalOptions());
  assert.equal(out.engineInput.travaux.length, 0);
  assert.equal(out.travaux_exclus[0]?.type, "equipe_groupe_externe");
  assert.equal(out.audit.overrides_groupes_externes_depuis_forecast, 0);
}

// 8. Affectation forecast interne explicite sur groupe externe : override limité à cette ressource.
{
  const out = preparerSimulationReplanningV1(externalOptions([forecastCell(["R1"])]));
  assert.equal(out.engineInput.travaux.length, 1);
  assert.deepEqual(out.engineInput.travaux[0].candidate_resource_ids, ["R1"]);
  assert.deepEqual(out.engineInput.travaux[0].preferred_resource_ids, ["R1"]);
  assert.deepEqual(out.engineInput.travaux[0].provenance.override_groupe_externe_forecast.ressource_noms, ["R1"]);
  assert.equal(out.audit.overrides_groupes_externes_depuis_forecast, 1);
}

// 9. Une allocation vers le prestataire « Externe » ne devient jamais un salarié candidat.
{
  const out = preparerSimulationReplanningV1(externalOptions([forecastCell(["Externe"])]));
  assert.equal(out.engineInput.travaux.length, 0);
  assert.equal(out.audit.overrides_groupes_externes_depuis_forecast, 0);
}

// 10. Sur un groupe interne normal, le forecast ne peut toujours pas élargir le pool HARD.
{
  const out = preparerSimulationReplanningV1(options({
    cellules: [forecastCell(["R2"])],
    ressources: [res("R1"), res("R2")],
  }));
  assert.deepEqual(out.engineInput.travaux[0].candidate_resource_ids, ["R1"]);
  assert.deepEqual(out.engineInput.travaux[0].preferred_resource_ids, ["R1"]);
  assert.deepEqual(out.engineInput.travaux[0].stability_forecast.resource_ids_hors_pool, ["R2"]);
  assert.equal(out.audit.overrides_groupes_externes_depuis_forecast, 0);
}

// 11. Un prédécesseur à 80 % sans charge n'est ni terminé ni inventé : il devient un bloqueur connu.
{
  const t0 = task("T0", { avancement: 80, heures_vendues: null, heures_estimees: null, chrono_ordre: 0 });
  const t1 = task("T1", { avancement: 0, chrono_ordre: 1 });
  const out = preparerSimulationReplanningV1(options({ phasages: [phasage([t0, t1])] }));
  assert.equal(out.engineInput.completedTaskIds.includes("C1::T0"), false);
  assert.equal(out.engineInput.travaux.some(t => t.id === "C1::T0"), false);
  assert.deepEqual(out.engineInput.travaux.find(t => t.id === "C1::T1")?.predecesseur_ids, ["C1::T0"]);
  const ex = out.travaux_exclus.find(x => x.travail_id === "C1::T0");
  assert.equal(ex?.type, "charge_reference_manquante");
  assert.equal(ex?.avancement, 80);
  assert.equal(ex?.bloque_ses_successeurs, true);
  assert.equal(out.engineInput.replanning_exclusions.some(x => x.travail_id === "C1::T0"), true);
}

// 12. Une tâche incomplète sans charge mais déjà forecastée est explicitement signalée, sans réutiliser sa durée comme vérité physique.
{
  const t0 = task("T0", { avancement: 60, heures_vendues: null, heures_estimees: null, chrono_groupe_id: null });
  const out = preparerSimulationReplanningV1(options({
    phasages: [phasage([t0])],
    cellules: [forecastCell(["R1"], "Lundi", "T0")],
  }));
  const ex = out.travaux_exclus.find(x => x.travail_id === "C1::T0");
  assert.equal(ex?.type, "charge_reference_manquante");
  assert.equal(ex?.forecast_existant, true);
  assert.equal(out.engineInput.travaux.some(t => t.id === "C1::T0"), false);
  assert.equal(out.etatReel.travaux.find(t => t.id === "C1::T0")?.reste_a_faire_heures, null);
}

console.log("OK — planning replanning adapter V1: 12 scénarios");