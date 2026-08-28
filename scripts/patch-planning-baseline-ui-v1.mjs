#!/usr/bin/env node
import fs from "node:fs";

function once(source, from, to, label) {
  if (source.includes(to)) return source;
  const n = source.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: motif attendu 1 fois, trouvé ${n}`);
  return source.replace(from, to);
}

// Planning.jsx
{
  const path = "src/Renovation/Planning.jsx";
  let s = fs.readFileSync(path, "utf8");
  s = once(s,
    'import CellModal from "./CellModal";\n',
    'import CellModal from "./CellModal";\nimport PlanningBaselinePanel from "./PlanningBaselinePanel";\nimport { creerAllocationUid } from "./planningBaselineModelV1.js";\n',
    "imports baseline Planning");
  s = once(s,
    '  ArrowRightLeft, Clock, TriangleAlert, Check,\n',
    '  ArrowRightLeft, Clock, TriangleAlert, Check, Snowflake,\n',
    "icone Snowflake");
  s = once(s,
    '  const [modal, setModal] = useState(null);\n',
    '  const [modal, setModal] = useState(null);\n  const [baselineOpen, setBaselineOpen] = useState(false);\n',
    "state baselineOpen");
  s = once(s,
    '    const taches = parseTachesFromPlanifie(existing.planifie, existing.taches);\n    setCellDraft({ ...existing, taches });\n',
    '    const taches = parseTachesFromPlanifie(existing.planifie, existing.taches)\n      .map(t => t.allocation_uid ? t : { ...t, allocation_uid: creerAllocationUid() });\n    setCellDraft({ ...existing, taches });\n',
    "UID à ouverture cellule");
  s = once(s,
    '    const fromTaches = getDisplayTaches(fromCell).map(t =>\n      String(t.id).startsWith("legacy-") ? { ...t, id: Math.random().toString(36).slice(2) } : t\n    );\n',
    '    const fromTaches = getDisplayTaches(fromCell).map(t => {\n      const base = String(t.id).startsWith("legacy-") ? { ...t, id: Math.random().toString(36).slice(2) } : t;\n      return base.allocation_uid ? base : { ...base, allocation_uid: creerAllocationUid() };\n    });\n',
    "UID source move");
  s = once(s,
    '    const toTaches = getDisplayTaches(toCell).map(t =>\n      String(t.id).startsWith("legacy-") ? { ...t, id: Math.random().toString(36).slice(2) } : t\n    );\n',
    '    const toTaches = getDisplayTaches(toCell).map(t => {\n      const base = String(t.id).startsWith("legacy-") ? { ...t, id: Math.random().toString(36).slice(2) } : t;\n      return base.allocation_uid ? base : { ...base, allocation_uid: creerAllocationUid() };\n    });\n',
    "UID cible move");
  s = once(s,
    '    const taches = (cellDraft.taches || []).filter(t => t.text.trim());\n',
    '    const taches = (cellDraft.taches || []).filter(t => t.text.trim())\n      .map(t => t.allocation_uid ? t : { ...t, allocation_uid: creerAllocationUid() });\n',
    "UID sauvegarde cellule");
  s = once(s,
    '      {modal && cellDraft && <CellModal\n',
    '      {baselineOpen && <PlanningBaselinePanel chantiers={chantiers} T={T} acc={acc} onClose={()=>setBaselineOpen(false)}/>}\n\n      {modal && cellDraft && <CellModal\n',
    "rendu panel baseline");
  s = once(s,
    '        <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>\n          <button title="Imprimer / Exporter" onClick={handlePrint} style={navBtn}\n',
    '        <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>\n          <button title="Planning de référence" onClick={()=>setBaselineOpen(true)} style={{...navBtn,width:"auto",padding:"0 10px",gap:6,fontWeight:800,fontSize:11}}\n            onMouseEnter={e => { e.currentTarget.style.borderColor = acc.accent; e.currentTarget.style.color = acc.accent; }}\n            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSub; }}>\n            <Icon as={Snowflake} size={14}/> Référence\n          </button>\n          <button title="Imprimer / Exporter" onClick={handlePrint} style={navBtn}\n',
    "bouton référence");
  fs.writeFileSync(path, s);
}

// CellModal.jsx
{
  const path = "src/Renovation/CellModal.jsx";
  let s = fs.readFileSync(path, "utf8");
  s = once(s,
    'import { sortByChrono } from "./chronoTemplate";\n',
    'import { sortByChrono } from "./chronoTemplate";\nimport { creerAllocationUid } from "./planningBaselineModelV1.js";\n',
    "import UID CellModal");
  s = once(s,
    '  const heuresDejaPlanifiees = (tacheId, skipDraftId = null) => {\n',
    '  const heuresDejaPlanifiees = (tacheId, skipDraftUid = null) => {\n',
    "param skip UID");
  s = once(s,
    '    (draft.taches || []).forEach(x => {\n      if (x.id === skipDraftId) return;\n',
    '    (draft.taches || []).forEach(x => {\n      if (skipDraftUid && (x.allocation_uid === skipDraftUid || (!x.allocation_uid && x.id === skipDraftUid))) return;\n',
    "skip allocation UID");
  s = once(s,
    '    const restantMO = Math.max(0, total - heuresDejaPlanifiees(line.tache_id, line.id));\n',
    '    const restantMO = Math.max(0, total - heuresDejaPlanifiees(line.tache_id, line.allocation_uid || line.id));\n',
    "recalcul propre UID");
  s = once(s,
    '    const newT = {\n      id: Math.random().toString(36).slice(2),\n      tache_id: t.id,\n',
    '    const newT = {\n      id: Math.random().toString(36).slice(2),\n      allocation_uid: creerAllocationUid(),\n      tache_id: t.id,\n',
    "UID tâche phasage");
  s = once(s,
    '                <div key={tache.id} style={{background:T.fieldBg,border:`1.5px solid ${T.fieldBorder}`,\n',
    '                <div key={tache.allocation_uid || tache.id} style={{background:T.fieldBg,border:`1.5px solid ${T.fieldBorder}`,\n',
    "key UID ligne");
  s = once(s,
    '                const newT={id:Math.random().toString(36).slice(2),text:"",ouvriers:[]};\n',
    '                const newT={id:Math.random().toString(36).slice(2),allocation_uid:creerAllocationUid(),text:"",ouvriers:[]};\n',
    "UID tâche manuelle");
  fs.writeFileSync(path, s);
}

// phasagePlanning.js : expose l'identité physique de placement au futur moteur.
{
  const path = "src/Renovation/phasagePlanning.js";
  let s = fs.readFileSync(path, "utf8");
  s = once(s,
    '        weekId: cell.week_id, jour: cell.jour,\n        date: dateFromWeekJour(cell.week_id, cell.jour),\n        duree: parseFloat(x.duree) || 0,\n',
    '        weekId: cell.week_id, jour: cell.jour,\n        date: dateFromWeekJour(cell.week_id, cell.jour),\n        allocation_uid: x.allocation_uid || null,\n        legacy_id: x.id || null,\n        duree: parseFloat(x.duree) || 0,\n',
    "projection allocation UID");
  fs.writeFileSync(path, s);
}

// Nettoyage d'une expression ambiguë dans le nouveau panel.
{
  const path = "src/Renovation/PlanningBaselinePanel.jsx";
  let s = fs.readFileSync(path, "utf8");
  s = s.replace('opacity:creating===chantier.id?.65:1', 'opacity:creating===chantier.id ? 0.65 : 1');
  s = s.replace('style={{position:"absolute",inset:0,background:', 'style={{position:"fixed",inset:0,background:');
  fs.writeFileSync(path, s);
}

console.log("Planning Baseline UI V1 patch appliqué");
