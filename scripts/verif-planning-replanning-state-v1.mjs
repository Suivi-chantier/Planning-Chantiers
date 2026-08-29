import assert from "node:assert/strict";
import {
  heuresReferenceTacheV1,
  resteAFaireTacheV1,
  etatReelTacheV1,
  construireEtatReelPhasagesV1,
} from "../src/Renovation/planningReplanningStateV1.js";

const task = (id, extra = {}) => ({
  id,
  nom: id,
  heures_vendues: 10,
  heures_estimees: 8,
  avancement: 0,
  ...extra,
});

// 1. Les heures vendues restent la référence prioritaire, puis heures estimées.
assert.equal(heuresReferenceTacheV1(task("T1", { heures_vendues: 10, heures_estimees: 20 })), 10);
assert.equal(heuresReferenceTacheV1(task("T1", { heures_vendues: 0, heures_estimees: 20 })), 20);

// 2. 10 h à 60 % => seulement 4 h à replanifier.
assert.equal(resteAFaireTacheV1(task("T1", { heures_vendues: 10, avancement: 60 })), 4);

// 3. Une tâche prévue hier mais encore en cours reste planifiable et devient en retard.
{
  const out = etatReelTacheV1({
    chantierId: "C1",
    today: "2026-08-31",
    tache: task("T1", { avancement: 60, date_prevue: "2026-08-30" }),
  });
  assert.equal(out.statut_reel, "en_cours");
  assert.equal(out.reste_a_faire_heures, 4);
  assert.equal(out.en_retard, true);
  assert.equal(out.planifiable, true);
}

// 4. Une tâche terminée ne revient jamais dans le besoin futur.
{
  const out = etatReelTacheV1({ chantierId: "C1", today: "2026-08-31", tache: task("T1", { avancement: 100 }) });
  assert.equal(out.statut_reel, "terminee");
  assert.equal(out.reste_a_faire_heures, 0);
  assert.equal(out.planifiable, false);
}

// 5. heures_reelles est un historique : elle ne réduit pas le reste à faire.
{
  const out = etatReelTacheV1({
    chantierId: "C1",
    today: "2026-08-31",
    tache: task("T1", { avancement: 20, heures_reelles: 9 }),
  });
  assert.equal(out.reste_a_faire_heures, 8);
  assert.equal(out.audit.heures_reelles_observees, 9);
  assert.equal(out.audit.heures_reelles_utilisees_pour_reste, false);
}

// 6. Une date future ne suffit jamais à qualifier une tâche comme terminée ou en retard.
{
  const out = etatReelTacheV1({
    chantierId: "C1",
    today: "2026-08-31",
    tache: task("T1", { avancement: 0, date_prevue: "2026-09-02" }),
  });
  assert.equal(out.statut_reel, "a_faire");
  assert.equal(out.en_retard, false);
  assert.equal(out.planifiable, true);
}

// 7. Le même chantier::tâche conserve une identité unique : doublon signalé, pas recréé.
{
  const ph = {
    chantier_id: "C1",
    updated_at: "2026-08-30T18:00:00Z",
    ouvrages: [
      { id: "O1", taches: [task("T1", { avancement: 20 })] },
      { id: "O2", taches: [task("T1", { avancement: 20 })] },
    ],
  };
  const out = construireEtatReelPhasagesV1([ph], { today: "2026-08-31" });
  assert.equal(out.travaux.length, 1);
  assert.equal(out.travaux[0].id, "C1::T1");
  assert.equal(out.warnings.length, 1);
  assert.equal(out.warnings[0].type, "tache_identite_dupliquee");
}

// 8. Les tâches sans identité stable sont exclues explicitement.
{
  const ph = { chantier_id: "C1", ouvrages: [{ id: "O1", taches: [task("")] }] };
  const out = construireEtatReelPhasagesV1([ph], { today: "2026-08-31" });
  assert.equal(out.travaux.length, 0);
  assert.equal(out.warnings[0].type, "tache_sans_identite_stable");
}

// 9. Agrégation : tâche terminée exclue du reste, tâche partielle conservée.
{
  const ph = {
    chantier_id: "C1",
    ouvrages: [{ id: "O1", taches: [
      task("A", { avancement: 100 }),
      task("B", { avancement: 50, date_prevue: "2026-08-29" }),
    ] }],
  };
  const out = construireEtatReelPhasagesV1([ph], { today: "2026-08-31" });
  assert.equal(out.audit.taches_total, 2);
  assert.equal(out.audit.taches_terminees, 1);
  assert.equal(out.audit.taches_en_cours, 1);
  assert.equal(out.audit.taches_en_retard, 1);
  assert.equal(out.audit.reste_a_faire_heures, 5);
}

// 10. Déterminisme strict : mêmes entrées => même sortie.
{
  const ph = {
    chantier_id: "C1",
    updated_at: "2026-08-30T18:00:00Z",
    ouvrages: [{ id: "O1", taches: [task("B", { avancement: 30 }), task("A", { avancement: 10 })] }],
  };
  const a = construireEtatReelPhasagesV1([ph], { today: "2026-08-31" });
  const b = construireEtatReelPhasagesV1([ph], { today: "2026-08-31" });
  assert.deepEqual(a, b);
  assert.deepEqual(a.travaux.map(t => t.id), ["C1::A", "C1::B"]);
}

console.log("OK — planning replanning state V1: 10 scénarios");
