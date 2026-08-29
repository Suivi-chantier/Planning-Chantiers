import assert from "node:assert/strict";
import {
  construirePlanApplicationReplanningV1,
  weekJourDepuisDateV1,
} from "../src/Renovation/planningReplanningApplyPlanV1.js";

const ressources = [
  { id: "R1", nom: "Kev", nom_planning: "Kev" },
  { id: "R2", nom: "Margaux", nom_planning: "Margaux" },
];

const ligne = (uid, text, extra = {}) => ({ allocation_uid: uid, text, ouvriers: [], ...extra });
const cell = ({
  id = "CELL-1",
  week_id = "2026-W36",
  chantier_id = "C1",
  jour = "Lundi",
  planifie,
  reel = "Réel à préserver",
  ouvriers = ["Kev"],
  taches = [],
  vehicules = [{ id: "V1" }],
} = {}) => ({
  id, week_id, chantier_id, jour,
  planifie: planifie ?? taches.map(t => t.text).join("\n"),
  reel, ouvriers, taches, vehicules,
});
const current = (uid, tacheId, date, duree, resourceIds = ["R1"], extra = {}) => ({
  allocation_uid: uid,
  chantier_id: "C1",
  tache_id: tacheId,
  date,
  duree,
  resource_ids: resourceIds,
  ...extra,
});
const proposed = (tacheId, date, duree, resourceIds = ["R1"], extra = {}) => ({
  allocation_uid: `proposal-${tacheId}-${date}`,
  travail_id: `C1::${tacheId}`,
  chantier_id: "C1",
  tache_id: tacheId,
  date,
  duree,
  resource_ids: resourceIds,
  heures_mo: duree * resourceIds.length,
  texte: `Tâche ${tacheId}`,
  ...extra,
});

// 1. Une allocation inchangée au milieu d'une cellule mixte ne crée aucun diff
// et conserve l'ordre Manuel -> Moteur -> Manuel.
{
  const taches = [
    ligne("M1", "Manuel avant"),
    ligne("A1", "Tâche T1", { tache_id: "T1", duree: 4, ouvriers: ["Kev"] }),
    ligne("M2", "Manuel après", { ouvriers: ["Margaux"] }),
  ];
  const cellule = cell({ ouvriers: ["Margaux", "Kev"], taches });
  const out = construirePlanApplicationReplanningV1({
    cellules: [cellule],
    forecastCourant: { allocations_recalculables: [current("A1", "T1", "2026-08-31", 4)], allocations_fixes: [] },
    proposition: { allocations_proposees: [proposed("T1", "2026-08-31", 4)] },
    ressources,
    startDate: "2026-08-31",
  });
  assert.equal(out.operations.length, 0);
  assert.equal(out.resume.allocations_uid_reutilises, 1);
}

// 2. Déplacement : l'UID est réutilisé, la ligne manuelle source reste intacte
// et son fallback cell.ouvriers reste Kev.
{
  const monday = cell({
    id: "MON",
    taches: [
      ligne("M1", "Manuel fallback"),
      ligne("A1", "Tâche T1", { tache_id: "T1", duree: 4, ouvriers: ["Kev"] }),
    ],
    ouvriers: ["Kev"],
  });
  const tuesday = cell({
    id: "TUE", jour: "Mardi",
    taches: [ligne("M2", "Manuel mardi", { ouvriers: ["Margaux"] })],
    ouvriers: ["Margaux"],
    reel: "Réel mardi",
    vehicules: [{ id: "V2" }],
  });
  const out = construirePlanApplicationReplanningV1({
    cellules: [monday, tuesday],
    forecastCourant: { allocations_recalculables: [current("A1", "T1", "2026-08-31", 4)], allocations_fixes: [] },
    proposition: { allocations_proposees: [proposed("T1", "2026-09-01", 4)] },
    ressources,
    startDate: "2026-08-31",
  });
  assert.equal(out.operations.length, 2);
  const mon = out.operations.find(x => x.cell_key.endsWith("::Lundi"));
  const tue = out.operations.find(x => x.cell_key.endsWith("::Mardi"));
  assert.deepEqual(mon.after.taches.map(t => t.allocation_uid), ["M1"]);
  assert.deepEqual(mon.after.ouvriers, ["Kev"]);
  assert.deepEqual(tue.after.taches.map(t => t.allocation_uid), ["M2", "A1"]);
  assert.equal(tue.after.reel, "Réel mardi");
  assert.deepEqual(tue.after.vehicules, [{ id: "V2" }]);
  assert.equal(out.resume.allocations_uid_reutilises, 1);
}

// 3. Une allocation fixe/verrouillée n'est jamais modifiée par le plan.
{
  const locked = ligne("LOCK", "Verrouillée", { tache_id: "TL", duree: 2, ouvriers: ["Margaux"], custom: { keep: true } });
  const cellule = cell({ taches: [locked, ligne("A1", "Tâche T1", { tache_id: "T1", duree: 4, ouvriers: ["Kev"] })], ouvriers: ["Margaux", "Kev"] });
  const out = construirePlanApplicationReplanningV1({
    cellules: [cellule],
    forecastCourant: {
      allocations_recalculables: [current("A1", "T1", "2026-08-31", 4)],
      allocations_fixes: [current("LOCK", "TL", "2026-08-31", 2, ["R2"], { locked: true })],
    },
    proposition: { allocations_proposees: [proposed("T1", "2026-08-31", 3)] },
    ressources,
    startDate: "2026-08-31",
  });
  assert.equal(out.operations.length, 1);
  assert.deepEqual(out.operations[0].after.taches[0], locked);
  assert.equal(out.invariants.allocations_manuelles_et_verrouillees_preservees, true);
}

// 4. Nouveau fractionnement : un UID existant est réutilisé et le second est
// déterministe à entrées identiques.
{
  const cellule = cell({ taches: [ligne("A1", "Tâche T1", { tache_id: "T1", duree: 7, ouvriers: ["Kev"] })] });
  const args = {
    cellules: [cellule],
    forecastCourant: { allocations_recalculables: [current("A1", "T1", "2026-08-31", 7)], allocations_fixes: [] },
    proposition: { allocations_proposees: [proposed("T1", "2026-08-31", 4), proposed("T1", "2026-09-01", 3)] },
    ressources,
    startDate: "2026-08-31",
  };
  const a = construirePlanApplicationReplanningV1(args);
  const b = construirePlanApplicationReplanningV1(args);
  const uidsA = a.operations.flatMap(o => o.after.taches).filter(t => t.tache_id === "T1").map(t => t.allocation_uid).sort();
  const uidsB = b.operations.flatMap(o => o.after.taches).filter(t => t.tache_id === "T1").map(t => t.allocation_uid).sort();
  assert.deepEqual(uidsA, uidsB);
  assert.equal(uidsA.includes("A1"), true);
  assert.equal(uidsA.some(uid => uid.startsWith("replan_v1_")), true);
  assert.equal(a.resume.allocations_uid_nouveaux, 1);
}

// 5. Une tâche sans forecast peut créer une nouvelle cellule, explicitement
// marquée comme insert avec expected_before absent.
{
  const out = construirePlanApplicationReplanningV1({
    cellules: [],
    forecastCourant: { allocations_recalculables: [], allocations_fixes: [] },
    proposition: { allocations_proposees: [proposed("T2", "2026-09-02", 2)] },
    ressources,
    startDate: "2026-08-31",
  });
  assert.equal(out.operations.length, 1);
  assert.equal(out.operations[0].type, "insert");
  assert.equal(out.operations[0].expected_before.exists, false);
  assert.equal(out.operations[0].after.week_id, "2026-W36");
  assert.equal(out.operations[0].after.jour, "Mercredi");
}

// 6. Une ressource proposée non mappée bloque la construction avant écriture.
{
  assert.throws(() => construirePlanApplicationReplanningV1({
    cellules: [],
    forecastCourant: { allocations_recalculables: [], allocations_fixes: [] },
    proposition: { allocations_proposees: [proposed("T2", "2026-09-02", 2, ["UNKNOWN"])] },
    ressources,
    startDate: "2026-08-31",
  }), /sans nom_planning/);
}

// 7. Le week-end et les propositions hors horizon sont refusés explicitement.
{
  assert.throws(() => construirePlanApplicationReplanningV1({
    cellules: [],
    forecastCourant: { allocations_recalculables: [], allocations_fixes: [] },
    proposition: { allocations_proposees: [proposed("T2", "2026-09-05", 2)] },
    ressources,
    startDate: "2026-08-31",
  }), /week-end/);
  assert.throws(() => construirePlanApplicationReplanningV1({
    cellules: [],
    forecastCourant: { allocations_recalculables: [], allocations_fixes: [] },
    proposition: { allocations_proposees: [proposed("T2", "2026-10-20", 2)] },
    ressources,
    startDate: "2026-08-31",
    horizonDays: 42,
  }), /hors horizon/);
}

// 8. Un snapshot courant avec allocation_uid globalement dupliqué est refusé.
{
  assert.throws(() => construirePlanApplicationReplanningV1({
    cellules: [
      cell({ id: "A", taches: [ligne("DUP", "A")] }),
      cell({ id: "B", jour: "Mardi", taches: [ligne("DUP", "B")] }),
    ],
    forecastCourant: { allocations_recalculables: [], allocations_fixes: [] },
    proposition: { allocations_proposees: [] },
    ressources,
    startDate: "2026-08-31",
  }), /allocation_uid dupliqué/);
}

// 9. Vérification ISO aux frontières d'année : le vendredi 01/01/2027 appartient
// encore à la semaine ISO 53 de 2026.
{
  assert.deepEqual(weekJourDepuisDateV1("2027-01-01"), {
    week_id: "2026-W53", jour: "Vendredi", date: "2027-01-01",
  });
}

console.log("OK — planning replanning apply plan V1: 9 scénarios");