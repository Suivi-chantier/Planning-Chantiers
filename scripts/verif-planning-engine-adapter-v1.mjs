import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  heuresMoRestantesTacheV1,
  heuresPlanifieesTacheV1,
  preparerSimulationPlanningGlobalV1,
} from "../src/Renovation/planningEngineAdapterV1.js";

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, "../src/Renovation/planningEngineAdapterV1.js"), "utf8");
assert.equal(/(?:\bimport\b|\bfrom\b)[^\n]*supabase/i.test(source), false, "l'adaptateur pur ne doit pas importer Supabase");
assert.equal(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(/.test(source), false, "l'adaptateur pur ne doit pas persister");

const res = (id, nom = id, extra = {}) => ({ id, nom, nom_planning: nom, kind: "personne", actif: true, capacite_facteur: 1, ...extra });
const task = (id, extra = {}) => ({
  id, nom: id, heures_vendues: 10, heures_estimees: 8, avancement: 0,
  chrono_groupe_id: "G1", chrono_ordre: 0, ouvriers: [], ...extra,
});
const phasage = ({ chantier = "C1", taches = [task("T1")], groupes = [{ id: "G1", ordre: 10, groupe_type_id: "gt_reseau_elec" }] } = {}) => ({
  id: `PH-${chantier}`,
  chantier_id: chantier,
  ouvrages: [{ id: `O-${chantier}`, code_ouvrage: "E-001", taches }],
  plan_travaux: { meta: { chrono_groupes: groupes } },
});
const cell = ({ uid = "A1", chantier = "C1", tacheId = "T1", text = "T1", duree = 2, ouvriers = ["R1"], jour = "Lundi", week = "2026-W36" } = {}) => ({
  id: `CELL-${uid}`, week_id: week, chantier_id: chantier, jour, ouvriers,
  taches: [{ allocation_uid: uid, tache_id: tacheId, text, duree, ouvriers }],
});
const manualCell = ({ uid = "M1", chantier = "C1", duree = 2, ouvriers = ["R1"] } = {}) => ({
  id: `CELL-${uid}`, week_id: "2026-W36", chantier_id: chantier, jour: "Lundi", ouvriers,
  taches: [{ allocation_uid: uid, text: "Réunion", duree, ouvriers }],
});
const base = overrides => preparerSimulationPlanningGlobalV1({
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

// 1. Formule métier : heures vendues prioritaires, avancement physique pour le reste.
assert.equal(heuresPlanifieesTacheV1({ heures_vendues: 10, heures_estimees: 20 }), 10);
assert.equal(heuresPlanifieesTacheV1({ heures_vendues: 0, heures_estimees: 20 }), 20);
assert.equal(heuresMoRestantesTacheV1({ heures_vendues: 10, avancement: 50 }), 5);

// 2. Un chantier terminé n'entre pas dans le moteur.
{
  const out = base({ chantiers: [{ id: "C1", statut: "termine" }] });
  assert.equal(out.engineInput.travaux.length, 0);
  assert.equal(out.audit.phasages_utilises, 0);
}

// 3. Compatibilité legacy : absence de predecesseurs => rang.js conserve son chaînage historique.
{
  const out = base({ phasages: [phasage({ taches: [task("A", { chrono_ordre: 0 }), task("B", { chrono_ordre: 1 })] })] });
  const a = out.engineInput.travaux.find(t => t.tache_id === "A");
  const b = out.engineInput.travaux.find(t => t.tache_id === "B");
  assert.deepEqual(a.predecesseur_ids, []);
  assert.deepEqual(b.predecesseur_ids, ["C1::A"]);
  assert.equal(b.provenance.dependances, "defaut");
  assert.equal(out.audit.dependances_legacy_defaut, 2);
}

// 4. Nouveau modèle : [] explicite signifie réellement parallèle/libre.
{
  const out = base({ phasages: [phasage({ taches: [task("A", { chrono_ordre: 0, predecesseurs: [] }), task("B", { chrono_ordre: 1, predecesseurs: [] })] })] });
  assert.deepEqual(out.engineInput.travaux.find(t => t.tache_id === "B").predecesseur_ids, []);
  assert.equal(out.audit.dependances_explicites, 2);
}

// 5. groupe_type_id direct gagne ; sinon résolution via le groupe chrono.
{
  const out = base({ phasages: [phasage({ taches: [task("T1", { groupe_type_id: "gt_peinture" })] })], groupesTypes: [
    { id: "gt_reseau_elec", ordre: 70 }, { id: "gt_peinture", ordre: 90 },
  ] });
  const t = out.engineInput.travaux[0];
  assert.equal(t.groupe_type_id, "gt_peinture");
  assert.equal(t.provenance.groupe_type, "tache");
}
{
  const out = base({});
  assert.equal(out.engineInput.travaux[0].groupe_type_id, "gt_reseau_elec");
  assert.equal(out.engineInput.travaux[0].provenance.groupe_type, "chrono_groupe");
}

// 6. Allocation future déverrouillée = forecast recalculable, pas charge fixe et pas déduite de la MO.
{
  const out = base({ cellules: [cell({ duree: 3 })] });
  assert.equal(out.forecastCourant.allocations_recalculables.length, 1);
  assert.equal(out.forecastCourant.allocations_fixes.length, 0);
  assert.equal(out.engineInput.allocationsExistantes.length, 0);
  assert.equal(out.engineInput.travaux[0].heures_mo_restantes, 10);
}

// 7. Allocation verrouillée = fixe + MO réservée ; pas de double planification.
{
  const out = base({
    cellules: [cell({ uid: "LOCK1", duree: 3 })],
    contraintes: [{ id: "L1", type: "allocation_lock", scope: "allocation", allocation_id: "LOCK1", chantier_id: "C1", hard: true, actif: true }],
  });
  assert.equal(out.forecastCourant.allocations_fixes.length, 1);
  assert.equal(out.engineInput.allocationsExistantes.length, 1);
  assert.equal(out.engineInput.travaux[0].heures_mo_restantes, 7);
  assert.equal(out.audit.heures_mo_reservees_par_verrous, 3);
}

// 8. Une ligne manuelle future reste fixe même sans verrou.
{
  const out = base({ cellules: [manualCell()] });
  assert.equal(out.engineInput.allocationsExistantes.length, 1);
  assert.equal(out.forecastCourant.allocations_recalculables.length, 0);
}

// 9. Les ouvriers portés par la tâche sont des préférences, jamais une contrainte hard implicite.
{
  const out = base({
    ressources: [res("RID1", "R1"), res("RID2", "R2")],
    phasages: [phasage({ taches: [task("T1", { ouvriers: ["R2"] })] })],
    equipes: [], groupesTypes: [{ id: "gt_reseau_elec", ordre: 70 }],
  });
  const t = out.engineInput.travaux[0];
  assert.deepEqual(t.preferred_resource_ids, ["RID2"]);
  assert.deepEqual(t.candidate_resource_ids, []);
  assert.equal(t.crew_size, 1);
}

// 10. Sans affectation tâche, l'équipe du groupe n'est qu'une préférence ; la taille d'équipe n'est pas inventée.
{
  const out = base({
    ressources: [res("RID1", "R1"), res("RID2", "R2")],
    groupesTypes: [{ id: "gt_reseau_elec", ordre: 70, equipe_id: "EQ1", ouvriers_prio: [] }],
    equipes: [{ id: "EQ1", nom: "Élec", responsable: "R1", membres: [{ ouvrier: "R2" }], externe: false }],
  });
  const t = out.engineInput.travaux[0];
  assert.deepEqual(t.preferred_resource_ids.sort(), ["RID1", "RID2"]);
  assert.equal(t.crew_size, 1);
}

// 11. Une ressource historique non mappée est signalée explicitement.
{
  const out = base({ cellules: [cell({ ouvriers: ["Stev"] })] });
  assert.equal(out.warnings.some(w => w.type === "allocation_ressource_non_mappee"), true);
}

// 12. Les tâches externes ne sont jamais affectées automatiquement à un salarié.
{
  const out = base({ phasages: [phasage({ taches: [task("EXT", { externe: true })] })] });
  assert.equal(out.engineInput.travaux.length, 0);
  assert.equal(out.travaux_exclus[0].type, "intervention_externe");
}

// 13. Un délai technique positif n'est jamais ignoré : tâche exclue tant que le moteur ne le supporte pas.
{
  const out = base({ phasages: [phasage({ taches: [task("DRY", {
    predecesseurs: ["A"],
    dependances: [{ contrainte: "hard", predecesseur_id: "A", delai_min_calendaire: 24, unite_delai: "heures" }],
  }), task("A", { avancement: 100, chrono_ordre: -1, predecesseurs: [] })] })] });
  assert.equal(out.engineInput.travaux.some(t => t.tache_id === "DRY"), false);
  assert.equal(out.travaux_exclus.some(t => t.type === "delai_technique_non_supporte"), true);
}

// 14. Identité globale composite : deux chantiers peuvent avoir le même id de tâche sans collision.
{
  const out = base({
    chantiers: [{ id: "C1" }, { id: "C2" }],
    phasages: [phasage({ chantier: "C1" }), phasage({ chantier: "C2" })],
  });
  assert.deepEqual(out.engineInput.travaux.map(t => t.id).sort(), ["C1::T1", "C2::T1"]);
}

// 15. Déterminisme de l'adaptateur.
{
  const input = {
    phasages: [phasage({ taches: [task("A"), task("B", { chrono_ordre: 1 })] })],
    chantiers: [{ id: "C1", statut: "en_cours" }],
    cellules: [cell({ uid: "X1", tacheId: "A" })],
    ressources: [res("R1")], groupesTypes: [{ id: "gt_reseau_elec", ordre: 70 }], equipes: [],
    startDate: "2026-08-31", horizonDays: 10,
  };
  assert.deepEqual(preparerSimulationPlanningGlobalV1(structuredClone(input)), preparerSimulationPlanningGlobalV1(structuredClone(input)));
}

// 16. Sans groupe métier ni ouvrier mappé, une tâche legacy est exclue plutôt qu'affectée arbitrairement.
{
  const out = base({
    phasages: [phasage({
      taches: [task("LEGACY", { chrono_groupe_id: "G_INCONNU", ouvriers: [] })],
      groupes: [],
    })],
  });
  assert.equal(out.engineInput.travaux.some(t => t.tache_id === "LEGACY"), false);
  assert.equal(out.travaux_exclus.some(t => t.tache_id === "LEGACY" && t.type === "contexte_affectation_insuffisant"), true);
}

console.log("✓ Planning Engine Adapter V1 — 16 scénarios métier validés");