import fs from "node:fs";
import { preparerSimulationPlanningGlobalV1 } from "../src/Renovation/planningEngineAdapterV1.js";
import { preparerSimulationReplanningV1 } from "../src/Renovation/planningReplanningAdapterV1.js";
import { planifierPropositionV1 } from "../src/Renovation/planningEngineV1.js";
import { planifierReplanningPropositionV1 } from "../src/Renovation/planningReplanningEngineV1.js";
import { diffForecastPropositionV1 } from "../src/Renovation/planningEngineDiffV1.js";
import { diffReplanningV1 } from "../src/Renovation/planningReplanningDiffV1.js";
import { parserConfigMoteurV1 } from "../src/Renovation/planningEngineDataHelpersV1.js";
import { capaciteBasePlanningPourDate } from "../src/Renovation/planningResourceCapacityV1.js";

const INPUT = process.argv[2] || "/tmp/replanning-real-snapshot.json";
const OUTPUT = process.argv[3] || "/tmp/replanning-real-audit.json";
const START = "2026-08-31";
const HORIZON = 42;
const FOCUS = {
  briollay: "op_1788020786153",
  fourmond: "op_1785760193820",
  tourbouton: "op_1785759672880",
  tom_camille: "op_1785759754431",
};
const txt = v => String(v ?? "").trim();
const uniq = xs => [...new Set((Array.isArray(xs) ? xs : []).map(txt).filter(Boolean))];
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function previousWorkday(date) { let d = addDays(date, -1); for (let i = 0; i < 14; i++) { if (capaciteBasePlanningPourDate(d) > 0) return d; d = addDays(d, -1); } return null; }
function continuity(allocations = []) {
  const byRes = new Map();
  for (const a of allocations) {
    const site = txt(a?.site_id || a?.chantier_id); if (!site || !a?.date) continue;
    for (const rid of uniq(a?.resource_ids || [])) {
      if (!byRes.has(rid)) byRes.set(rid, new Map());
      const m = byRes.get(rid); const prev = m.get(a.date); if (!prev) m.set(a.date, site); else if (prev !== site) m.set(a.date, "MULTI");
    }
  }
  let transitions = 0, same = 0, switches = 0, aba = 0, multi = 0;
  const per_resource = [];
  for (const [rid, m] of byRes) {
    let rs = 0, rw = 0, ra = 0;
    for (const d of [...m.keys()].sort()) {
      if (m.get(d) === "MULTI") multi++;
      const p = previousWorkday(d); if (!p || !m.has(p)) continue;
      transitions++;
      if (m.get(d) === m.get(p)) { same++; rs++; } else { switches++; rw++; }
      const pp = previousWorkday(p); if (pp && m.has(pp) && m.get(pp) === m.get(d) && m.get(pp) !== m.get(p)) { aba++; ra++; }
    }
    per_resource.push({ resource_id: rid, transitions: rs + rw, same_site: rs, switches: rw, aba: ra });
  }
  return { transitions, same_site: same, switches, aba, multi_site_day: multi, same_site_rate: transitions ? round2(100 * same / transitions) : null, per_resource: per_resource.sort((a,b) => b.switches-a.switches || b.aba-a.aba) };
}
function operationStats(allocs, siteId) {
  const rows = (allocs || []).filter(a => txt(a?.site_id) === siteId);
  const dates = rows.map(a => txt(a?.date)).filter(Boolean).sort();
  return { allocations: rows.length, tasks: uniq(rows.map(a => a?.travail_id)).length, heures_mo: round2(rows.reduce((s,a) => s + Number(a?.heures_mo || 0), 0)), debut: dates[0] || null, fin: dates.at(-1) || null, resources: uniq(rows.flatMap(a => a?.resource_ids || [])).sort() };
}
function groupReasons(non = []) {
  const m = new Map();
  for (const x of non) { const r = txt(x?.raison) || "inconnue"; const p = m.get(r) || { reason:r, count:0, hours:0 }; p.count++; p.hours += Number(x?.heures_mo_restantes || 0); m.set(r,p); }
  return [...m.values()].map(x => ({ ...x, hours: round2(x.hours) })).sort((a,b) => b.count-a.count);
}
const snap = JSON.parse(fs.readFileSync(INPUT, "utf8"));
const config = parserConfigMoteurV1(snap.config_rows || []);
const common = { phasages:snap.phasages||[], chantiers:config.chantiers, cellules:snap.cellules||[], ressources:snap.ressources||[], evenementsRessources:snap.evenements||[], contraintes:snap.contraintes||[], groupesTypes:config.groupesTypes, equipes:config.equipes, startDate:START, horizonDays:HORIZON };
const bprep = preparerSimulationPlanningGlobalV1(common);
const bprop = planifierPropositionV1(bprep.engineInput);
const bdiff = diffForecastPropositionV1({ forecast:bprep.forecastCourant.allocations_recalculables, proposition:bprop.allocations_proposees, nonPlanifies:bprop.non_planifies });
const rprep = preparerSimulationReplanningV1(common);
const rprop = planifierReplanningPropositionV1(rprep.engineInput);
const rdiff = diffReplanningV1({ forecast:rprep.forecastCourant.allocations_recalculables, proposition:rprop, travaux:rprep.engineInput.travaux });
const bc = continuity(bprop.allocations_proposees), rc = continuity(rprop.allocations_proposees);
const chantierNames = new Map(config.chantiers.map(c => [txt(c.id), txt(c.nom) || txt(c.id)]));
const resourceNames = new Map((snap.ressources || []).map(r => [txt(r.id), txt(r.nom_planning || r.nom) || txt(r.id)]));
const enrich = c => ({ ...c, per_resource:c.per_resource.map(x => ({ ...x, resource:resourceNames.get(x.resource_id) || x.resource_id })) });
const operations = {}; for (const [name,id] of Object.entries(FOCUS)) operations[name] = { site_id:id, baseline:operationStats(bprop.allocations_proposees,id), chantier05:operationStats(rprop.allocations_proposees,id) };
const changes_to_verify = (rdiff.changements || []).filter(x => x.changement_a_verifier).slice(0,40).map(x => ({ chantier:chantierNames.get(x.chantier_id)||x.chantier_id, tache_id:x.tache_id, texte:x.texte, details:x.details, courant:x.courant, propose:x.propose, impact:x.impact }));
const top_chantier_impacts = (rdiff.par_chantier || []).slice().sort((a,b) => Math.abs(b.decalage_fin_jours||0)-Math.abs(a.decalage_fin_jours||0)).slice(0,30).map(x => ({ ...x, chantier:chantierNames.get(x.chantier_id)||x.chantier_id }));
const out = {
  source_commit: process.env.GITHUB_SHA || null, engine_reference_commit:"c58964ce8b9933bc028f5c95d5ed9098abe1de65", snapshot_captured_at:snap.captured_at, start_date:START, horizon_days:HORIZON,
  data_counts:{ phasages:(snap.phasages||[]).length, cells:(snap.cellules||[]).length, resources:(snap.ressources||[]).length, events:(snap.evenements||[]).length, constraints:(snap.contraintes||[]).length, chantiers:config.chantiers.length },
  baseline:{ audit:bprep.audit, proposal:bprop.resume, diff:bdiff.resume, continuity:enrich(bc), non_planned_reasons:groupReasons(bprop.non_planifies) },
  chantier05:{ audit:rprep.audit, real_state:rprep.etatReel?.audit||null, forecast_stability:rprep.stabiliteForecast?.audit||null, date_stability:rprop.replanning?.stabilite_dates||null, proposal:rprop.resume, diff:rdiff.resume, reasons:rdiff.raisons_resume, continuity:enrich(rc), non_planned_reasons:groupReasons(rprop.non_planifies), changes_to_verify, top_chantier_impacts },
  comparison:{ resource_changes_delta:(rdiff.resume?.ressources_changees||0)-(bdiff.resume?.ressources_changees||0), modified_tasks_delta:(rdiff.resume?.modifiees||0)-(bdiff.resume?.modifiees||0), non_planned_delta:(rprop.resume?.travaux_non_planifies||0)-(bprop.resume?.travaux_non_planifies||0), site_switches_delta:rc.switches-bc.switches, aba_delta:rc.aba-bc.aba, same_site_rate_delta:round2((rc.same_site_rate||0)-(bc.same_site_rate||0)) },
  operations,
};
fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2));
console.log(`Audit real: baseline switches=${bc.switches}, chantier05 switches=${rc.switches}, baseline ABA=${bc.aba}, chantier05 ABA=${rc.aba}, à vérifier=${rdiff.resume?.changements_a_verifier||0}`);
