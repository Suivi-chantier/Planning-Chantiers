import assert from "node:assert/strict";
import {
  dateDepuisWeekJourApplicationV1,
  evaluerSecuriteApplicationReplanningV1,
} from "../src/Renovation/planningReplanningApplySafetyV1.js";

const cell = ({ id="CELL", week_id="2026-W36", chantier_id="C1", jour="Lundi", taches=[], ouvriers=[] } = {}) => ({ id, week_id, chantier_id, jour, taches, ouvriers });
const line = (uid, tacheId, text="T") => ({ allocation_uid:uid, tache_id:tacheId, text, duree:1, ouvriers:["Kev"] });
const phasage = ({ date="2026-08-31", updated_at="2026-08-29T12:00:00Z" } = {}) => ({
  id:"PH1", chantier_id:"C1", updated_at,
  ouvrages:[{ id:"O1", taches:[{ id:"T1", nom:"T1", date_prevue:date, avancement:50 }] }],
});
const op = ({ beforeDay="Lundi", afterDay="Mardi", before=true, after=true } = {}) => ({
  cell_key:`2026-W36::C1::${afterDay}`,
  type: before && beforeDay === afterDay ? "update" : (before ? "update" : "insert"),
  expected_before: before ? { exists:true, id:"CELL", payload:cell({ jour:beforeDay, taches:[line("A1","T1")] }) } : { exists:false, id:null, payload:null },
  after: after ? cell({ jour:afterDay, taches:[line("A1","T1")] }) : cell({ jour:afterDay, taches:[] }),
});
const plan = operations => ({ operations });
const cleanDiff = {
  changements:[{ travail_id:"C1::T1", statut:"modifié", changement_a_verifier:false }],
  par_chantier:[{ chantier_id:"C1", proposition_complete:true }],
};

// 1. Conversion ISO, y compris la semaine 53 à cheval sur l'année.
assert.equal(dateDepuisWeekJourApplicationV1("2026-W36", "Lundi"), "2026-08-31");
assert.equal(dateDepuisWeekJourApplicationV1("2026-W53", "Vendredi"), "2027-01-01");

// 2. Un forecast courant sans remplacement bloque toujours l'application et
// distingue les cas horizon/capacité des cas de donnée/dépendance.
{
  const out = evaluerSecuriteApplicationReplanningV1({
    planApplication: plan([op()]),
    cellulesToutes:[cell({ taches:[line("A1","T1")] })],
    diff:{ ...cleanDiff, changements:[{
      travail_id:"C1::T1", statut:"non_replanifié", changement_a_verifier:false,
      raisons:[{ code:"non_planifiable_dans_horizon" }],
    }] },
    phasages:[phasage()], startDate:"2026-08-31",
  });
  assert.equal(out.application_autorisable, false);
  assert.equal(out.resume.changements_non_replanifies, 1);
  assert.equal(out.resume.changements_non_replanifies_horizon_ou_capacite, 1);
  assert.equal(out.resume.changements_non_replanifies_donnee_ou_dependance, 0);
  assert.equal(out.blockers.some(x => x.code === "forecast_courant_sans_remplacement"), true);
}

// 3. Une allocation de la même tâche après l'horizon bloque une application partielle.
{
  const out = evaluerSecuriteApplicationReplanningV1({
    planApplication: plan([op()]),
    cellulesToutes:[
      cell({ taches:[line("A1","T1")] }),
      cell({ id:"LATE", week_id:"2026-W43", jour:"Lundi", taches:[line("A2","T1")] }),
    ],
    diff:cleanDiff, phasages:[phasage()], startDate:"2026-08-31", horizonDays:42,
  });
  assert.equal(out.application_autorisable, false);
  assert.equal(out.resume.allocations_hors_horizon_bloquantes, 1);
  assert.equal(out.blockers.some(x => x.code === "allocation_liee_hors_horizon"), true);
}

// 4. Un changement inexpliqué bloque même si les cellules sont techniquement applicables.
{
  const out = evaluerSecuriteApplicationReplanningV1({
    planApplication: plan([op()]),
    cellulesToutes:[cell({ taches:[line("A1","T1")] })],
    diff:{ ...cleanDiff, changements:[{ travail_id:"C1::T1", statut:"modifié", changement_a_verifier:true }] },
    phasages:[phasage()], startDate:"2026-08-31",
  });
  assert.equal(out.application_autorisable, false);
  assert.equal(out.blockers.some(x => x.code === "changement_inexplique"), true);
}

// 5. Sémantique historique conservée : s'il existe déjà un ancien planning passé,
// date_prevue reste ce premier jour, même si le futur est déplacé.
{
  const past = cell({ id:"PAST", week_id:"2026-W34", jour:"Jeudi", taches:[line("OLD","T1")] }); // 20/08
  const currentFuture = cell({ id:"CUR", week_id:"2026-W36", jour:"Lundi", taches:[line("A1","T1")] });
  const moveOperation = {
    cell_key:"2026-W36::C1::Lundi",
    type:"update",
    expected_before:{ exists:true, id:"CUR", payload:currentFuture },
    after:cell({ id:"CUR", week_id:"2026-W36", jour:"Lundi", taches:[] }),
  };
  const insertOperation = {
    cell_key:"2026-W36::C1::Jeudi",
    type:"insert",
    expected_before:{ exists:false, id:null, payload:null },
    after:cell({ id:undefined, week_id:"2026-W36", jour:"Jeudi", taches:[line("A1","T1")] }),
  };
  const out = evaluerSecuriteApplicationReplanningV1({
    planApplication:plan([moveOperation, insertOperation]),
    cellulesToutes:[past, currentFuture], diff:cleanDiff,
    phasages:[phasage({ date:"2026-08-20" })], startDate:"2026-08-31",
  });
  assert.equal(out.phasage_updates.length, 0);
}

// 6. Sans historique passé, déplacer le premier créneau produit une mise à jour
// date_prevue transactionnelle, avec la version phasage attendue.
{
  const currentFuture = cell({ id:"CUR", taches:[line("A1","T1")] });
  const moveOut = {
    cell_key:"2026-W36::C1::Lundi", type:"update",
    expected_before:{ exists:true, id:"CUR", payload:currentFuture },
    after:cell({ id:"CUR", taches:[] }),
  };
  const moveIn = {
    cell_key:"2026-W36::C1::Jeudi", type:"insert",
    expected_before:{ exists:false, id:null, payload:null },
    after:cell({ id:undefined, jour:"Jeudi", taches:[line("A1","T1")] }),
  };
  const out = evaluerSecuriteApplicationReplanningV1({
    planApplication:plan([moveOut, moveIn]), cellulesToutes:[currentFuture], diff:cleanDiff,
    phasages:[phasage({ date:"2026-08-31", updated_at:"2026-08-29T15:00:00Z" })], startDate:"2026-08-31",
  });
  assert.equal(out.application_autorisable, true);
  assert.equal(out.phasage_updates.length, 1);
  assert.equal(out.phasage_updates[0].expected_updated_at, "2026-08-29T15:00:00Z");
  assert.deepEqual(out.phasage_updates[0].task_updates[0], {
    travail_id:"C1::T1", tache_id:"T1", expected_date_prevue:"2026-08-31", after_date_prevue:"2026-09-03",
  });
}

// 7. Retirer la dernière allocation d'une tâche demande date_prevue = null.
{
  const currentFuture = cell({ id:"CUR", taches:[line("A1","T1")] });
  const remove = {
    cell_key:"2026-W36::C1::Lundi", type:"update",
    expected_before:{ exists:true, id:"CUR", payload:currentFuture },
    after:cell({ id:"CUR", taches:[] }),
  };
  const out = evaluerSecuriteApplicationReplanningV1({
    planApplication:plan([remove]), cellulesToutes:[currentFuture], diff:cleanDiff,
    phasages:[phasage()], startDate:"2026-08-31",
  });
  assert.equal(out.phasage_updates[0].task_updates[0].after_date_prevue, null);
}

// 8. Une ligne liée à une tâche disparue du phasage bloque la transaction.
{
  const out = evaluerSecuriteApplicationReplanningV1({
    planApplication:plan([op()]), cellulesToutes:[cell({ taches:[line("A1","T1")] })],
    diff:cleanDiff, phasages:[], startDate:"2026-08-31",
  });
  assert.equal(out.application_autorisable, false);
  assert.equal(out.blockers.some(x => x.code === "tache_phasage_introuvable"), true);
}

// 9. Aucun changement nécessaire : pas bloqué métier, mais rien à appliquer.
{
  const out = evaluerSecuriteApplicationReplanningV1({
    planApplication:plan([]), cellulesToutes:[], diff:{ changements:[], par_chantier:[] },
    phasages:[phasage()], startDate:"2026-08-31",
  });
  assert.equal(out.aucune_mutation_necessaire, true);
  assert.equal(out.application_autorisable, false);
  assert.equal(out.blockers.length, 0);
}

// 10. Une tâche manuelle sans équipe propre hérite de cell.ouvriers : élargir
// cette équipe serait une réaffectation silencieuse et doit bloquer V1.
{
  const manualFallback = { allocation_uid:"M1", text:"Rangement manuel", duree:1, ouvriers:[] };
  const before = cell({ id:"MIX", taches:[manualFallback], ouvriers:["Kev"] });
  const after = cell({ id:"MIX", taches:[manualFallback, line("A1","T1")], ouvriers:["Kev","Margaux"] });
  const operation = {
    cell_key:"2026-W36::C1::Lundi", type:"update",
    expected_before:{ exists:true, id:"MIX", payload:before }, after,
  };
  const out = evaluerSecuriteApplicationReplanningV1({
    planApplication:plan([operation]), cellulesToutes:[before], diff:cleanDiff,
    phasages:[phasage()], startDate:"2026-08-31",
  });
  assert.equal(out.application_autorisable, false);
  assert.equal(out.resume.cellules_fallback_manuel_bloquantes, 1);
  assert.equal(out.blockers.some(x => x.code === "fallback_manuel_cellule_modifie"), true);
}

console.log("OK — planning replanning apply safety V1: 10 scénarios");