import assert from "node:assert/strict";
import { diffForecastPropositionV1 } from "../src/Renovation/planningEngineDiffV1.js";

const cur = (uid, date, duree, resources = ["R1"], extra = {}) => ({
  allocation_uid: uid, chantier_id: "C1", tache_id: "T1", date, duree,
  resource_ids: resources, ...extra,
});
const prop = (uid, date, duree, resources = ["R1"], extra = {}) => ({
  allocation_uid: uid, proposal: true, travail_id: "C1::T1", chantier_id: "C1", tache_id: "T1",
  date, duree, resource_ids: resources, heures_mo: duree * resources.length, ...extra,
});

// 1. Même résultat métier malgré un nouvel UID => inchangé.
{
  const d = diffForecastPropositionV1({ forecast: [cur("OLD", "2026-09-01", 4)], proposition: [prop("NEW", "2026-09-01", 4)] });
  assert.equal(d.resume.inchangees, 1);
  assert.equal(d.changements[0].statut, "inchangé");
}

// 2. Décalage de date explicite et signé.
{
  const d = diffForecastPropositionV1({ forecast: [cur("OLD", "2026-09-01", 4)], proposition: [prop("NEW", "2026-09-03", 4)] });
  assert.equal(d.changements[0].statut, "modifié");
  assert.deepEqual(d.changements[0].details.sort(), ["debut", "fin"]);
  assert.equal(d.changements[0].impact.decalage_debut_jours, 2);
  assert.equal(d.resume.debut_retarde, 1);
}

// 3. Avance de deux jours => valeur négative.
{
  const d = diffForecastPropositionV1({ forecast: [cur("OLD", "2026-09-03", 4)], proposition: [prop("NEW", "2026-09-01", 4)] });
  assert.equal(d.changements[0].impact.decalage_fin_jours, -2);
  assert.equal(d.resume.fin_avancee, 1);
}

// 4. Changement de ressources détecté indépendamment de l'ordre.
{
  const same = diffForecastPropositionV1({ forecast: [cur("A", "2026-09-01", 2, ["R1", "R2"])], proposition: [prop("B", "2026-09-01", 2, ["R2", "R1"])] });
  assert.equal(same.resume.ressources_changees, 0);
  const changed = diffForecastPropositionV1({ forecast: [cur("A", "2026-09-01", 2, ["R1"])], proposition: [prop("B", "2026-09-01", 2, ["R2"])] });
  assert.equal(changed.resume.ressources_changees, 1);
}

// 5. Fractionnement différent détecté même si début/fin et MO peuvent rester proches.
{
  const d = diffForecastPropositionV1({
    forecast: [cur("A", "2026-09-01", 2), cur("B", "2026-09-02", 2)],
    proposition: [prop("P", "2026-09-01", 4)],
  });
  assert.equal(d.changements[0].details.includes("fractionnement"), true);
  assert.equal(d.resume.fractionnement_change, 1);
}

// 6. Tâche absente du forecast courant = nouvelle proposition.
{
  const d = diffForecastPropositionV1({ forecast: [], proposition: [prop("P", "2026-09-01", 2)] });
  assert.equal(d.resume.nouvelles, 1);
  assert.equal(d.changements[0].statut, "nouveau");
}

// 7. Tâche courante sans proposition = non replanifiée.
{
  const d = diffForecastPropositionV1({ forecast: [cur("A", "2026-09-01", 2)], proposition: [] });
  assert.equal(d.resume.non_replanifiees, 1);
  assert.equal(d.changements[0].statut, "non_replanifié");
}

// 8. Synthèse chantier : fin courante/proposée et impact.
{
  const forecast = [
    cur("A", "2026-09-01", 2, ["R1"], { tache_id: "T1" }),
    cur("B", "2026-09-05", 2, ["R1"], { tache_id: "T2" }),
  ];
  const proposition = [
    prop("P1", "2026-09-02", 2, ["R1"], { travail_id: "C1::T1", tache_id: "T1" }),
    prop("P2", "2026-09-07", 2, ["R1"], { travail_id: "C1::T2", tache_id: "T2" }),
  ];
  const d = diffForecastPropositionV1({ forecast, proposition });
  assert.equal(d.par_chantier.length, 1);
  assert.equal(d.par_chantier[0].fin_courante, "2026-09-05");
  assert.equal(d.par_chantier[0].fin_proposee, "2026-09-07");
  assert.equal(d.par_chantier[0].decalage_fin_jours, 2);
}

console.log("✓ Planning Engine Diff V1 — 8 scénarios métier validés");
