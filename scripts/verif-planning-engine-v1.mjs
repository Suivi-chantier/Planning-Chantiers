import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { planifierPropositionV1 } from "../src/Renovation/planningEngineV1.js";

const here = dirname(fileURLToPath(import.meta.url));
const engineSource = await readFile(resolve(here, "../src/Renovation/planningEngineV1.js"), "utf8");

const res = (id, extra = {}) => ({
  id,
  nom: id,
  nom_planning: id,
  kind: "personne",
  actif: true,
  capacite_facteur: 1,
  ...extra,
});

const task = (id, heures, extra = {}) => ({
  id,
  tache_id: id,
  chantier_id: "chantier-A",
  groupe_type_id: "gt_reseau_elec",
  texte: id,
  heures_mo_restantes: heures,
  crew_size: 1,
  ...extra,
});

const run = overrides => planifierPropositionV1({
  travaux: [task("T1", 2)],
  ressources: [res("R1")],
  startDate: "2026-08-31", // lundi, semaine ISO 36 : capacité planning 7 h
  horizonDays: 5,
  ...overrides,
});

// 1. Le moteur reste un pur moteur de proposition : aucun import de couche Supabase.
assert.equal(/(?:\bimport\b|\bfrom\b)[^\n]*supabase/i.test(engineSource), false, "planningEngineV1 ne doit pas importer Supabase");
assert.equal(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(/.test(engineSource), false, "aucune primitive de persistance ne doit exister dans le noyau");

// 2. Cas simple : 2 h MO, 1 personne -> 2 h de durée le jour même.
{
  const out = run({});
  assert.equal(out.resume.travaux_planifies, 1);
  assert.equal(out.allocations_proposees.length, 1);
  assert.equal(out.allocations_proposees[0].date, "2026-08-31");
  assert.equal(out.allocations_proposees[0].duree, 2);
  assert.equal(out.allocations_proposees[0].heures_mo, 2);
  assert.deepEqual(out.allocations_proposees[0].resource_ids, ["R1"]);
  assert.equal(out.invariants.aucune_ecriture_persistante, true);
}

// 3. Les heures de tâche sont des heures de MO : 10 h MO avec 2 personnes = 5 h de durée.
{
  const out = run({
    travaux: [task("T2", 10, { crew_size: 2 })],
    ressources: [res("R1"), res("R2")],
  });
  assert.equal(out.allocations_proposees.length, 1);
  assert.equal(out.allocations_proposees[0].duree, 5);
  assert.equal(out.allocations_proposees[0].heures_mo, 10);
  assert.equal(out.allocations_proposees[0].resource_ids.length, 2);
}

// 4. Une absence journée entière repousse le travail au prochain jour disponible.
{
  const out = run({
    evenementsRessources: [{
      id: "ABS1", resource_id: "R1", type: "absence",
      date_debut: "2026-08-31", date_fin: "2026-08-31", toute_journee: true, actif: true,
    }],
  });
  assert.equal(out.allocations_proposees[0].date, "2026-09-01");
}

// 5. Le rythme Profero reste la source : vendredi S35 = 0 h, week-end = 0 h, reprise lundi S36.
{
  const out = run({ startDate: "2026-08-28", horizonDays: 4 });
  assert.equal(out.allocations_proposees[0].date, "2026-08-31");
}

// 6. Une allocation courante consomme déjà la capacité sans être déplacée ni modifiée.
{
  const existing = [{
    allocation_uid: "EX1", chantier_id: "chantier-Z", tache_id: "OLD",
    date: "2026-08-31", duree: 6, resource_ids: ["R1"], locked: true,
  }];
  const before = structuredClone(existing);
  const out = run({ travaux: [task("T3", 3)], allocationsExistantes: existing, horizonDays: 2 });
  assert.deepEqual(existing, before, "le moteur ne doit jamais muter les allocations existantes");
  assert.equal(out.allocations_proposees.length, 2);
  assert.equal(out.allocations_proposees[0].date, "2026-08-31");
  assert.equal(out.allocations_proposees[0].duree, 1);
  assert.equal(out.allocations_proposees[1].date, "2026-09-01");
  assert.equal(out.allocations_proposees[1].duree, 2);
}

// 7. Dépendances explicites : le successeur ne devient éligible qu'après l'achèvement du prédécesseur.
// Il peut néanmoins démarrer le même jour s'il reste de la capacité.
{
  const out = run({
    travaux: [
      task("A", 2, { ordre_tache: 1 }),
      task("B", 2, { predecesseur_ids: ["A"], ordre_tache: 2 }),
    ],
  });
  assert.deepEqual(out.allocations_proposees.map(a => a.travail_id), ["A", "B"]);
  assert.deepEqual(out.allocations_proposees.map(a => a.date), ["2026-08-31", "2026-08-31"]);
}

// 8. Un prédécesseur inconnu n'est jamais ignoré silencieusement.
{
  const out = run({ travaux: [task("B", 2, { predecesseur_ids: ["INCONNU"] })] });
  assert.equal(out.allocations_proposees.length, 0);
  assert.equal(out.non_planifies.length, 1);
  assert.match(out.non_planifies[0].raison, /Prédécesseur\(s\) introuvable\(s\).*INCONNU/);
}

// 9. not_before : aucune allocation avant la date autorisée.
{
  const out = run({
    contraintes: [{
      id: "NB1", type: "not_before", scope: "tache", tache_id: "T1",
      date_debut: "2026-09-02", hard: true, actif: true,
    }],
  });
  assert.equal(out.allocations_proposees[0].date, "2026-09-02");
}

// 10. fixed_date : le travail est positionné dans la fenêtre imposée.
{
  const out = run({
    contraintes: [{
      id: "FIX1", type: "fixed_date", scope: "tache", tache_id: "T1",
      date_debut: "2026-09-03", date_fin: "2026-09-03", hard: true, actif: true,
    }],
  });
  assert.equal(out.allocations_proposees[0].date, "2026-09-03");
}

// 11. Deadline dépassée : violation explicite, mais le travail reste planifiable.
{
  const out = run({
    contraintes: [{
      id: "DL1", type: "deadline", scope: "tache", tache_id: "T1",
      date_fin: "2026-08-30", hard: true, actif: true,
    }],
  });
  assert.equal(out.allocations_proposees[0].date, "2026-08-31");
  assert.equal(out.allocations_proposees[0].explication.violations.length, 1);
  assert.equal(out.allocations_proposees[0].explication.violations[0].type, "deadline");
}

// 12. Ressource requise : une autre ressource disponible ne peut pas se substituer.
{
  const out = run({
    ressources: [res("R1"), res("R2")],
    contraintes: [{
      id: "REQ1", type: "resource_required", scope: "tache", tache_id: "T1",
      config: { resource_ids: ["R2"] }, hard: true, actif: true,
    }],
  });
  assert.deepEqual(out.allocations_proposees[0].resource_ids, ["R2"]);
}

// 13. Ressource interdite : même préférée, elle doit être écartée.
{
  const out = run({
    travaux: [task("T1", 2, { preferred_resource_ids: ["R1"] })],
    ressources: [res("R1"), res("R2")],
    contraintes: [{
      id: "FORB1", type: "resource_forbidden", scope: "tache", tache_id: "T1",
      config: { resource_ids: ["R1"] }, hard: true, actif: true,
    }],
  });
  assert.deepEqual(out.allocations_proposees[0].resource_ids, ["R2"]);
}

// 14. Priorité : si la capacité ne permet qu'un seul travail, le plus prioritaire gagne.
{
  const out = run({
    travaux: [
      task("LOW", 7, { priority: 0 }),
      task("HIGH", 7, { priority: 100 }),
    ],
    horizonDays: 1,
  });
  assert.deepEqual(out.allocations_proposees.map(a => a.travail_id), ["HIGH"]);
  assert.equal(out.non_planifies[0].travail_id, "LOW");
}

// 15. Changement de chantier dans la même journée : autorisé comme préférence dégradée et signalé.
{
  const out = run({
    travaux: [task("T4", 1, { chantier_id: "chantier-A", candidate_resource_ids: ["R1"] })],
    allocationsExistantes: [{
      allocation_uid: "OTHER", chantier_id: "chantier-B", tache_id: "OLD",
      date: "2026-08-31", duree: 1, resource_ids: ["R1"],
    }],
  });
  assert.equal(out.allocations_proposees.length, 1);
  assert.equal(out.warnings.some(w => w.type === "changement_chantier_meme_jour"), true);
  assert.deepEqual(out.allocations_proposees[0].explication.changement_chantier_ressources, ["R1"]);
}

// 16. Un prestataire externe n'est jamais auto-planifié comme une personne Profero.
{
  const out = run({ ressources: [res("EXT", { kind: "prestataire" })] });
  assert.equal(out.allocations_proposees.length, 0);
  assert.equal(out.resume.travaux_non_planifies, 1);
}

// 17. completedTaskIds permet de satisfaire un prédécesseur déjà terminé hors horizon.
{
  const out = run({
    travaux: [task("B", 2, { predecesseur_ids: ["A"] })],
    completedTaskIds: ["A"],
  });
  assert.equal(out.allocations_proposees.length, 1);
  assert.equal(out.allocations_proposees[0].travail_id, "B");
}

// 18. Une tâche non fractionnable attend un créneau complet au lieu d'être découpée.
{
  const out = run({
    travaux: [task("NF", 5, { fractionnable: false })],
    allocationsExistantes: [{
      allocation_uid: "EX-NF", chantier_id: "chantier-Z", tache_id: "OLD",
      date: "2026-08-31", duree: 3, resource_ids: ["R1"],
    }],
    horizonDays: 2,
  });
  assert.equal(out.allocations_proposees.length, 1);
  assert.equal(out.allocations_proposees[0].date, "2026-09-01");
  assert.equal(out.allocations_proposees[0].duree, 5);
  assert.equal(out.allocations_proposees[0].explication.fractionnable, false);
}

// 19. Déterminisme : mêmes entrées, même proposition bit-à-bit.
{
  const input = {
    travaux: [
      task("T1", 4, { preferred_resource_ids: ["R2"] }),
      task("T2", 3, { chantier_id: "chantier-B", priority: 20 }),
    ],
    ressources: [res("R1"), res("R2")],
    startDate: "2026-08-31",
    horizonDays: 4,
  };
  const a = planifierPropositionV1(structuredClone(input));
  const b = planifierPropositionV1(structuredClone(input));
  assert.deepEqual(a, b);
}

// 20. Explicabilité minimale obligatoire sur toute allocation proposée.
{
  const out = run({});
  const e = out.allocations_proposees[0].explication;
  assert.equal(typeof e.formule, "string");
  assert.equal(typeof e.restant_avant_mo, "number");
  assert.equal(typeof e.capacite_limitante_h, "number");
  assert.equal(typeof e.score_travail, "number");
}

console.log("✓ Planning Engine V1 — 20 scénarios métier validés");

// 21. candidate_resource_ids est un pool hard : une ressource hors pool n'est jamais choisie, même préférée.
{
  const out = run({
    travaux: [task("POOL", 2, { candidate_resource_ids:["R2"], preferred_resource_ids:["R1"] })],
    ressources: [res("R1"), res("R2")],
  });
  assert.deepEqual(out.allocations_proposees[0].resource_ids, ["R2"]);
}
