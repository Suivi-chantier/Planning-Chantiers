import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  filtrerSnapshotPourHorizonReplanningV1,
  simulerSensibiliteHorizonsReplanningDepuisSnapshotV1,
} from "../src/Renovation/planningReplanningHorizonSensitivityV1.js";

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, "../src/Renovation/planningReplanningHorizonSensitivityV1.js"), "utf8");
assert.equal(/(?:\bimport\b|\bfrom\b)[^\n]*supabase/i.test(source), false, "la sensibilité d'horizon doit rester pure");
assert.equal(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.rpc\s*\(/.test(source), false, "la sensibilité d'horizon ne doit rien persister");

const resource = (id, nom) => ({ id, nom, nom_planning:nom, kind:"personne", actif:true, capacite_facteur:1 });
const task = (id, hours, group, extra = {}) => ({
  id, nom:id, heures_vendues:hours, heures_estimees:hours, avancement:0,
  chrono_groupe_id:group, chrono_ordre:0, ouvriers:[], predecesseurs:[], ...extra,
});
const phasage = (chantierId, tasks, groups) => ({
  id:`PH-${chantierId}`, chantier_id:chantierId, updated_at:"2026-08-30T18:00:00Z",
  ouvrages:[{ id:`O-${chantierId}`, code_ouvrage:"E-001", taches:tasks }],
  plan_travaux:{ meta:{ chrono_groupes:groups } },
});
const cell = (chantierId, taskId, worker, uid) => ({
  id:`CELL-${uid}`, week_id:"2026-W36", chantier_id:chantierId, jour:"Lundi",
  planifie:true, reel:false, ouvriers:[worker], vehicules:[],
  taches:[{ allocation_uid:uid, tache_id:taskId, text:taskId, duree:1, ouvriers:[worker] }],
});

// C1 : le prédécesseur consomme exactement les 207 h de capacité des 6 semaines
// W36→W41. Son successeur forecasté n'a donc aucune place à 42 jours, mais en a
// dès W42 lorsque l'horizon passe à 56 jours.
const c1Tasks = [
  task("PRE1", 207, "CG1", { chrono_ordre:0, predecesseurs:[] }),
  task("SUC1", 1, "CG1", { chrono_ordre:1, predecesseurs:["PRE1"] }),
];

// C2 : le prédécesseur est physiquement ouvert mais sans charge quantifiable.
// Son successeur doit rester bloqué, même en allongeant l'horizon à 12 semaines.
const c2Tasks = [
  task("PRE2", 0, "CG2", { chrono_ordre:0, avancement:50, heures_vendues:0, heures_estimees:0, predecesseurs:[] }),
  task("SUC2", 1, "CG2", { chrono_ordre:1, predecesseurs:["PRE2"] }),
];

const snapshot = {
  phasages:[
    phasage("C1", c1Tasks, [{ id:"CG1", ordre:10, groupe_type_id:"GT1" }]),
    phasage("C2", c2Tasks, [{ id:"CG2", ordre:10, groupe_type_id:"GT2" }]),
  ],
  chantiers:[{ id:"C1", nom:"Capacité", statut:"en_cours" }, { id:"C2", nom:"Donnée", statut:"en_cours" }],
  cellules:[cell("C1","SUC1","R1","A1"), cell("C2","SUC2","R2","A2")],
  cellulesToutes:[cell("C1","SUC1","R1","A1"), cell("C2","SUC2","R2","A2")],
  ressources:[resource("RID1","R1"), resource("RID2","R2")],
  evenementsRessources:[
    { id:"EV-IN", resource_id:"RID1", type:"absence", date_debut:"2026-09-01", date_fin:"2026-09-01", toute_journee:false, heures_indisponibles:0, actif:true },
    { id:"EV-OUT", resource_id:"RID1", type:"absence", date_debut:"2026-12-01", date_fin:"2026-12-01", toute_journee:true, actif:true },
  ],
  contraintes:[],
  groupesTypes:[
    { id:"GT1", ordre:10, equipe_id:"EQ1", ouvriers_prio:[] },
    { id:"GT2", ordre:10, equipe_id:"EQ2", ouvriers_prio:[] },
  ],
  equipes:[
    { id:"EQ1", nom:"Equipe 1", responsable:"R1", membres:[], externe:false },
    { id:"EQ2", nom:"Equipe 2", responsable:"R2", membres:[], externe:false },
  ],
};

// 1. Le filtre horizon réutilise seulement les semaines et événements utiles.
{
  const out = filtrerSnapshotPourHorizonReplanningV1(snapshot, { startDate:"2026-08-31", horizonDays:42 });
  assert.deepEqual(out.horizon.week_ids, ["2026-W36","2026-W37","2026-W38","2026-W39","2026-W40","2026-W41"]);
  assert.equal(out.cellules.length, 2);
  assert.equal(out.evenementsRessources.length, 1);
  assert.equal(out.evenementsRessources[0].id, "EV-IN");
}

const result = simulerSensibiliteHorizonsReplanningDepuisSnapshotV1({
  snapshot,
  startDate:"2026-08-31",
  horizons:[42,56,84],
  baseHorizonDays:42,
});
const h42 = result.resultats.find(x => x.horizon_days === 42);
const h56 = result.resultats.find(x => x.horizon_days === 56);
const h84 = result.resultats.find(x => x.horizon_days === 84);
const c56 = result.comparaison.find(x => x.horizon_days === 56);
const c84 = result.comparaison.find(x => x.horizon_days === 84);

// 2. À 6 semaines, on distingue bien horizon/capacité et donnée/dépendance.
assert.equal(h42.non_replanifies.total, 2);
assert.equal(h42.non_replanifies.horizon_ou_capacite, 1);
assert.equal(h42.non_replanifies.donnee_ou_dependance, 1);
assert.deepEqual(h42.non_replanifies.horizon_ou_capacite_ids, ["C1::SUC1"]);
assert.deepEqual(h42.non_replanifies.donnee_ou_dependance_ids, ["C2::SUC2"]);

// 3. À 8 semaines, le pur manque d'horizon est résolu exactement.
assert.equal(h56.non_replanifies.total, 1);
assert.equal(h56.non_replanifies.horizon_ou_capacite, 0);
assert.deepEqual(c56.resolus_depuis_base_ids, ["C1::SUC1"]);
assert.deepEqual(c56.encore_bloques_depuis_base_ids, ["C2::SUC2"]);

// 4. À 12 semaines, une donnée/dépendance manquante ne devient jamais un faux problème d'horizon.
assert.equal(h84.non_replanifies.total, 1);
assert.equal(h84.non_replanifies.donnee_ou_dependance, 1);
assert.deepEqual(c84.resolus_depuis_base_ids, ["C1::SUC1"]);
assert.deepEqual(c84.encore_bloques_depuis_base_ids, ["C2::SUC2"]);

// 5. Le résumé porte bien sur les blockers du forecast de base, pas sur les nouveaux forecasts éventuellement visibles plus loin.
assert.equal(result.resume.non_replanifies_base, 2);
assert.equal(result.resume.resolus_au_plus_long, 1);
assert.equal(result.resume.encore_bloques_au_plus_long, 1);
assert.equal(result.base_horizon_days, 42);

// 6. La sécurité reste bloquée tant que le cas donnée/dépendance subsiste.
assert.equal(h56.application_autorisable, false);
assert.equal(h84.application_autorisable, false);
assert.equal(h84.blocker_codes.includes("forecast_courant_sans_remplacement"), true);

// 7. Un ordre d'horizons arbitraire est normalisé et dédupliqué.
{
  const out = simulerSensibiliteHorizonsReplanningDepuisSnapshotV1({ snapshot, startDate:"2026-08-31", horizons:[84,42,56,42] });
  assert.deepEqual(out.horizons, [42,56,84]);
}

// 8. Déterminisme strict.
assert.deepEqual(
  simulerSensibiliteHorizonsReplanningDepuisSnapshotV1({ snapshot:structuredClone(snapshot), startDate:"2026-08-31", horizons:[42,56,84] }),
  simulerSensibiliteHorizonsReplanningDepuisSnapshotV1({ snapshot:structuredClone(snapshot), startDate:"2026-08-31", horizons:[42,56,84] })
);

console.log("OK — replanning horizon sensitivity V1: 8 scénarios");
