import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { completerGardesPhasagesApplicationV1 } from "../src/Renovation/planningReplanningPhasageGuardsV1.js";

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, "../src/Renovation/planningReplanningPhasageGuardsV1.js"), "utf8");
assert.equal(/(?:\bimport\b|\bfrom\b)[^\n]*supabase/i.test(source), false);
assert.equal(/\.(?:insert|update|upsert|delete|rpc)\s*\(/.test(source), false);

const security = extra => ({
  application_autorisable:true,
  blockers:[],
  phasage_updates:[],
  resume:{ cellules_a_ecrire:1 },
  preconditions_transaction:{}, invariants:{},
  ...extra,
});
const linkedOp = (chantier="C1") => ({
  cell_key:`2026-W36::${chantier}::Lundi`,
  expected_before:{ exists:true, payload:{ chantier_id:chantier, taches:[{ allocation_uid:"A1", tache_id:"T1" }] } },
  after:{ chantier_id:chantier, taches:[{ allocation_uid:"A1", tache_id:"T1" }] },
});
const manualOp = () => ({
  cell_key:"2026-W36::C1::Lundi",
  expected_before:{ exists:true, payload:{ chantier_id:"C1", taches:[{ allocation_uid:"M1", text:"Réunion" }] } },
  after:{ chantier_id:"C1", taches:[{ allocation_uid:"M1", text:"Réunion" }] },
});
const ph = (id="P1", chantier="C1", updated="2026-08-29T20:00:00Z") => ({ id, chantier_id:chantier, updated_at:updated });

// 1. Une tâche liée touchée verrouille son phasage même sans changement date_prevue.
{
  const out = completerGardesPhasagesApplicationV1({
    securiteApplication:security(), planApplication:{ operations:[linkedOp()] }, phasages:[ph()],
  });
  assert.equal(out.application_autorisable, true);
  assert.deepEqual(out.phasage_guards, [{ phasage_id:"P1", chantier_id:"C1", expected_updated_at:"2026-08-29T20:00:00Z" }]);
  assert.equal(out.resume.phasages_a_verrouiller, 1);
}

// 2. Sans updated_at, l'application devient impossible plutôt que de perdre la garde de concurrence.
{
  const out = completerGardesPhasagesApplicationV1({
    securiteApplication:security(), planApplication:{ operations:[linkedOp()] }, phasages:[ph("P1","C1","")],
  });
  assert.equal(out.application_autorisable, false);
  assert.equal(out.blockers.some(b => b.code === "phasage_garde_version_absente"), true);
}

// 3. Deux phasages pour un même chantier sont ambigus et bloquants.
{
  const out = completerGardesPhasagesApplicationV1({
    securiteApplication:security(), planApplication:{ operations:[linkedOp()] }, phasages:[ph("P1"), ph("P2")],
  });
  assert.equal(out.application_autorisable, false);
  assert.equal(out.blockers.some(b => b.code === "phasage_duplique_pour_chantier"), true);
}

// 4. Toute mise à jour date_prevue doit être couverte par la même garde versionnée.
{
  const out = completerGardesPhasagesApplicationV1({
    securiteApplication:security({ phasage_updates:[{ phasage_id:"P2", chantier_id:"C2", task_updates:[] }] }),
    planApplication:{ operations:[linkedOp("C1")] }, phasages:[ph("P1","C1"), ph("P2","C2")],
  });
  assert.equal(out.application_autorisable, false);
  assert.equal(out.blockers.some(b => b.code === "phasage_update_sans_garde"), true);
}

// 5. Une cellule purement manuelle n'invente pas de garde phasage.
{
  const out = completerGardesPhasagesApplicationV1({
    securiteApplication:security(), planApplication:{ operations:[manualOp()] }, phasages:[ph()],
  });
  assert.equal(out.phasage_guards.length, 0);
  assert.equal(out.application_autorisable, true);
}

// 6. Déterminisme strict.
{
  const input = { securiteApplication:security(), planApplication:{ operations:[linkedOp()] }, phasages:[ph()] };
  assert.deepEqual(completerGardesPhasagesApplicationV1(structuredClone(input)), completerGardesPhasagesApplicationV1(structuredClone(input)));
}

console.log("OK — replanning phasage guards V1: 6 scénarios");
