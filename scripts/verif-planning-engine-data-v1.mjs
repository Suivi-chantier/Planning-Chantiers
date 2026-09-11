import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ajouterJoursISOv1,
  finHorizonPlanningV1,
  metaHorizonMoteurV1,
  parserConfigMoteurV1,
  semaineISOv1,
  semainesPourHorizonV1,
} from "../src/Renovation/planningEngineDataHelpersV1.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataSource = await readFile(resolve(here, "../src/Renovation/planningEngineDataV1.js"), "utf8");

// 1. La couche connectée est strictement en lecture seule.
assert.equal(/\.(?:insert|update|upsert|delete)\s*\(/.test(dataSource), false, "planningEngineDataV1 ne doit contenir aucune écriture Supabase");
assert.equal(/\.rpc\s*\(/.test(dataSource), false, "planningEngineDataV1 ne doit pas contourner la lecture seule via RPC");
assert.equal(dataSource.includes('.from("planning_cells")'), true);
assert.equal(dataSource.includes('.in("week_id", horizon.week_ids)'), true);
assert.equal(dataSource.includes('.lte("date_debut", horizon.end_date)'), true);
assert.equal(dataSource.includes('.gte("date_fin", horizon.start_date)'), true);

// 2. Arithmétique de date pure.
assert.equal(ajouterJoursISOv1("2026-08-31", 1), "2026-09-01");
assert.equal(ajouterJoursISOv1("2026-12-31", 1), "2027-01-01");
assert.equal(finHorizonPlanningV1("2026-08-31", 42), "2026-10-11");

// 3. Semaines ISO connues autour de la bascule d'année.
assert.deepEqual(semaineISOv1("2026-12-31"), { year: 2026, week: 53, week_id: "2026-W53" });
assert.deepEqual(semaineISOv1("2027-01-03"), { year: 2026, week: 53, week_id: "2026-W53" });
assert.deepEqual(semaineISOv1("2027-01-04"), { year: 2027, week: 1, week_id: "2027-W01" });
assert.deepEqual(semainesPourHorizonV1("2026-12-28", 8), ["2026-W53", "2027-W01"]);

// 4. Horizon opérationnel de 42 jours : liste dédupliquée et ordonnée.
{
  const h = metaHorizonMoteurV1("2026-08-31", 42);
  assert.equal(h.start_date, "2026-08-31");
  assert.equal(h.end_date, "2026-10-11");
  assert.equal(h.horizon_days, 42);
  assert.deepEqual(h.week_ids, ["2026-W36", "2026-W37", "2026-W38", "2026-W39", "2026-W40", "2026-W41"]);
}

// 5. Les deux formes historiques de planning_config sont acceptées.
{
  const cfg = parserConfigMoteurV1([
    { key: "chantiers", value: [{ id: "C1" }, { id: "C2" }] },
    { key: "groupes_types", value: { items: [{ id: "G1" }] } },
    { key: "equipes", value: { items: [{ id: "E1" }] } },
  ]);
  assert.deepEqual(cfg.chantiers.map(x => x.id), ["C1", "C2"]);
  assert.deepEqual(cfg.groupesTypes.map(x => x.id), ["G1"]);
  assert.deepEqual(cfg.equipes.map(x => x.id), ["E1"]);
}

// 6. Formes absentes ou invalides = listes vides, jamais exception implicite.
assert.deepEqual(parserConfigMoteurV1([{ key: "chantiers", value: { nope: true } }]), {
  chantiers: [], groupesTypes: [], equipes: [],
});

// 7. Horizon borné : au minimum 1 jour, au maximum 366.
assert.equal(metaHorizonMoteurV1("2026-08-31", 0).horizon_days, 1);
assert.equal(metaHorizonMoteurV1("2026-08-31", 999).horizon_days, 366);

console.log("✓ Planning Engine Data V1 — 7 scénarios de lecture validés");
