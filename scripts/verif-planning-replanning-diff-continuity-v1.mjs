import assert from "node:assert/strict";
import { diffReplanningAvecContinuiteV1 } from "../src/Renovation/planningReplanningDiffContinuityV1.js";

const travail = {
  id: "C1::T1", chantier_id: "C1", tache_id: "T1", site_id: "OP1",
  candidate_resource_ids: ["R1", "R2"], preferred_resource_ids: ["R1"],
  provenance: { etat_reel: { avancement: 0, reste_a_faire_heures: 4, source_verite: "phasage", en_retard: false } },
};
const forecast = [{
  allocation_uid: "OLD", chantier_id: "C1", tache_id: "T1", date: "2026-09-02",
  duree: 4, resource_ids: ["R2"], ouvriers_noms: ["R2"],
}];

// 1. Une trace moteur de continuité transforme le changement en cause explicitement démontrée.
{
  const proposition = {
    allocations_proposees: [{
      allocation_uid: "NEW", travail_id: "C1::T1", chantier_id: "C1", tache_id: "T1",
      date: "2026-09-02", duree: 4, resource_ids: ["R1"], heures_mo: 4,
      explication: { jour_planifiable_precedent: "2026-09-01", continuite_site_jour_precedent: ["R1"] },
    }],
    non_planifies: [],
    replanning: { decisions_stabilite_dates: [] },
  };
  const out = diffReplanningAvecContinuiteV1({ forecast, proposition, travaux: [travail] });
  const c = out.changements[0];
  assert.equal(c.details.includes("ressources"), true);
  assert.equal(c.raisons.some(r => r.code === "continuite_site_jour_precedent"), true);
  assert.equal(c.qualite_explication, "explique");
  assert.equal(c.changement_a_verifier, false);
  assert.equal(out.raisons_resume.some(r => r.code === "continuite_site_jour_precedent" && r.count === 1), true);
}

// 2. Sans trace moteur, aucune fausse cause de continuité n'est ajoutée.
{
  const proposition = {
    allocations_proposees: [{
      allocation_uid: "NEW", travail_id: "C1::T1", chantier_id: "C1", tache_id: "T1",
      date: "2026-09-02", duree: 4, resource_ids: ["R1"], heures_mo: 4, explication: {},
    }],
    non_planifies: [], replanning: { decisions_stabilite_dates: [] },
  };
  const out = diffReplanningAvecContinuiteV1({ forecast, proposition, travaux: [travail] });
  const c = out.changements[0];
  assert.equal(c.raisons.some(r => r.code === "continuite_site_jour_precedent"), false);
}

console.log("OK — planning replanning diff continuity V1: 2 scénarios");
