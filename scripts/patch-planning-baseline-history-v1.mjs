#!/usr/bin/env node
import fs from "node:fs";
const path = "src/Renovation/PlanningBaselinePanel.jsx";
let s = fs.readFileSync(path, "utf8");
function once(from,to,label){ if(s.includes(to)) return; const n=s.split(from).length-1; if(n!==1) throw new Error(`${label}: motif attendu 1 fois, trouvé ${n}`); s=s.replace(from,to); }

once(
'  const [expanded, setExpanded] = useState(() => new Set());\n',
'  const [expanded, setExpanded] = useState(() => new Set());\n  const [selectedVersion, setSelectedVersion] = useState({});\n',
"state selectedVersion");

once(
'  const baselineByChantier = useMemo(() => indexerDerniereBaselineParChantierV1(data?.baselines || []), [data]);\n\n  const rows = useMemo(() => (chantiers || []).map(chantier => {\n    const cells = cellsByChantier.get(String(chantier.id)) || [];\n    const baseline = baselineByChantier.get(String(chantier.id)) || null;\n',
'  const baselineByChantier = useMemo(() => indexerDerniereBaselineParChantierV1(data?.baselines || []), [data]);\n  const versionsByChantier = useMemo(() => {\n    const map = new Map();\n    for (const b of (data?.baselines || [])) {\n      const key = String(b.chantier_id || "");\n      if (!map.has(key)) map.set(key, []);\n      map.get(key).push(b);\n    }\n    for (const list of map.values()) list.sort((a,b)=>Number(b.version||0)-Number(a.version||0));\n    return map;\n  }, [data]);\n\n  const rows = useMemo(() => (chantiers || []).map(chantier => {\n    const cells = cellsByChantier.get(String(chantier.id)) || [];\n    const versions = versionsByChantier.get(String(chantier.id)) || [];\n    const latestBaseline = baselineByChantier.get(String(chantier.id)) || null;\n    const wanted = selectedVersion[chantier.id];\n    const baseline = versions.find(b => Number(b.version) === Number(wanted)) || latestBaseline;\n',
"versions par chantier");

once(
'    return { chantier, cells, baseline, state };\n  }).sort((a,b) => String(a.chantier.nom||"").localeCompare(String(b.chantier.nom||""), "fr")), [chantiers, cellsByChantier, baselineByChantier, data]);\n',
'    return { chantier, cells, baseline, latestBaseline, versions, state };\n  }).sort((a,b) => String(a.chantier.nom||"").localeCompare(String(b.chantier.nom||""), "fr")), [chantiers, cellsByChantier, baselineByChantier, versionsByChantier, selectedVersion, data]);\n',
"retour row versions");

once(
'        derniereBaseline: row.baseline,\n',
'        derniereBaseline: row.latestBaseline,\n',
"rebaseline sur dernière version");

once(
'            const { chantier, baseline, state } = row;\n            const diff = state.diff?.resume;\n            const isExpanded = expanded.has(chantier.id);\n            const noChange = baseline && diff?.total === 0;\n            const nextVersion = Number(baseline?.version || 0) + 1;\n',
'            const { chantier, baseline, latestBaseline, versions, state } = row;\n            const diff = state.diff?.resume;\n            const isExpanded = expanded.has(chantier.id);\n            const noChange = baseline && diff?.total === 0;\n            const nextVersion = Number(latestBaseline?.version || 0) + 1;\n            const historical = baseline && latestBaseline && Number(baseline.version) !== Number(latestBaseline.version);\n',
"variables historique");

once(
'                    {chip(`RÉF. V${baseline.version}`, acc.accent, acc.bg10)}\n                    {noChange ? chip("AUCUN ÉCART", "#16a34a", "rgba(34,197,94,.12)") : diff?.total>0 ? chip(`${diff.total} ÉCART${diff.total>1?"S":""}`, "#f97316", "rgba(249,115,22,.12)") : null}\n',
'                    {chip(`RÉF. V${baseline.version}`, acc.accent, acc.bg10)}\n                    {historical && chip("HISTORIQUE", "#64748b", "rgba(100,116,139,.12)")}\n                    {noChange ? chip("AUCUN ÉCART", "#16a34a", "rgba(34,197,94,.12)") : diff?.total>0 ? chip(`${diff.total} ÉCART${diff.total>1?"S":""}`, "#f97316", "rgba(249,115,22,.12)") : null}\n',
"badge historique");

once(
'                  <span>{baseline.allocation_count} allocation{baseline.allocation_count!==1?"s":""} figée{baseline.allocation_count!==1?"s":""}</span>\n                  {baseline.source==="manual_rebaseline" && <span>Rebaseline explicite</span>}\n',
'                  <span>{baseline.allocation_count} allocation{baseline.allocation_count!==1?"s":""} figée{baseline.allocation_count!==1?"s":""}</span>\n                  {baseline.source==="manual_rebaseline" && <span>Rebaseline explicite</span>}\n                  {versions.length>1 && <label style={{marginLeft:"auto",display:"inline-flex",alignItems:"center",gap:6}}>Comparer à\n                    <select value={baseline.version} onChange={e=>setSelectedVersion(v=>({...v,[chantier.id]:Number(e.target.value)}))} style={{background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:6,padding:"3px 7px",fontFamily:"inherit",fontWeight:800}}>\n                      {versions.map(v=><option key={v.id} value={v.version}>V{v.version} · {fmtDateTime(v.created_at)}</option>)}\n                    </select>\n                  </label>}\n',
"sélecteur historique");

once(
'          const isRebaseline = !!row.baseline;\n',
'          const isRebaseline = !!row.latestBaseline;\n',
"confirmation latest");

once(
'                  ? `La V${row.baseline.version} restera conservée. Le planning actuel de ${row.chantier.nom} deviendra simplement la nouvelle référence V${confirm.nextVersion}.`\n',
'                  ? `La V${row.latestBaseline.version} restera conservée. Le planning actuel de ${row.chantier.nom} deviendra simplement la nouvelle référence V${confirm.nextVersion}.`\n',
"texte confirmation latest");

fs.writeFileSync(path,s);
console.log("Historique Planning Baseline V1 patch appliqué");
