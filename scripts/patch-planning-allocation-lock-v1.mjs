#!/usr/bin/env node
import fs from "node:fs";

function once(source, from, to, label) {
  if (source.includes(to)) return source;
  const n = source.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: motif attendu 1 fois, trouvé ${n}`);
  return source.replace(from, to);
}

{
  const path = "src/Renovation/CellModal.jsx";
  let s = fs.readFileSync(path, "utf8");
  s = once(s,
    'import { creerAllocationUid } from "./planningBaselineModelV1.js";\n',
    'import { creerAllocationUid } from "./planningBaselineModelV1.js";\nimport { chargerVerrousAllocationsV1, indexerVerrousAllocationsV1, verrouillerAllocationV1, deverrouillerAllocationV1 } from "./planningAllocationLockDataV1.js";\n',
    "imports verrous CellModal");
  s = once(s,
    '  const [resourceEvents, setResourceEvents] = useState([]);\n',
    '  const [resourceEvents, setResourceEvents] = useState([]);\n  const [allocationLocks, setAllocationLocks] = useState(() => new Map());\n  const [lockingUid, setLockingUid] = useState(null);\n',
    "state verrous");
  s = once(s,
    '  }, [dateISOJour]);\n\n  // ── Tâches du phasage du chantier',
    '  }, [dateISOJour]);\n\n  useEffect(() => {\n    let cancelled = false;\n    if (!chantier?.id) { setAllocationLocks(new Map()); return undefined; }\n    chargerVerrousAllocationsV1(chantier.id)\n      .then(rows => { if (!cancelled) setAllocationLocks(indexerVerrousAllocationsV1(rows)); })\n      .catch(e => { if (!cancelled) console.warn("Chargement verrous allocations :", e?.message || e); });\n    return () => { cancelled = true; };\n  }, [chantier?.id]);\n\n  const toggleAllocationLock = async (tache) => {\n    const uid = tache?.allocation_uid;\n    if (!uid || lockingUid) return;\n    const locked = allocationLocks.has(uid);\n    setLockingUid(uid);\n    try {\n      if (locked) {\n        await deverrouillerAllocationV1(uid);\n        setAllocationLocks(prev => { const next = new Map(prev); next.delete(uid); return next; });\n      } else {\n        // Une ligne sans équipe propre dépend de l’équipe de la cellule. Au verrouillage,\n        // on fige l’équipe effective sur la ligne pour rendre le verrou réellement stable.\n        if (!(tache.ouvriers || []).length && (draft.ouvriers || []).length) {\n          setDraft(p => ({\n            ...p,\n            taches: (p.taches || []).map(x => x.allocation_uid === uid ? { ...x, ouvriers:[...(p.ouvriers || [])] } : x),\n          }));\n        }\n        const row = await verrouillerAllocationV1({ chantierId:chantier.id, allocationUid:uid });\n        setAllocationLocks(prev => new Map(prev).set(uid, row));\n      }\n    } catch (e) {\n      console.warn("Verrou allocation :", e?.message || e);\n      window.alert(`Impossible de ${locked ? "déverrouiller" : "verrouiller"} cette allocation : ${e?.message || e}`);\n    } finally {\n      setLockingUid(null);\n    }\n  };\n\n  // ── Tâches du phasage du chantier',
    "chargement et toggle verrous");
  s = once(s,
    '                <div key={tache.allocation_uid || tache.id} style={{background:T.fieldBg,border:`1.5px solid ${T.fieldBorder}`,\n',
    '                <div key={tache.allocation_uid || tache.id} style={{background:T.fieldBg,border:`1.5px solid ${allocationLocks.has(tache.allocation_uid)?"#f59e0b":T.fieldBorder}`,\n',
    "bordure verrouillée");
  s = once(s,
    '                        type="number" min="0.25" max="24" step="0.25"\n                        value={tache.duree||""}\n',
    '                        type="number" min="0.25" max="24" step="0.25"\n                        disabled={allocationLocks.has(tache.allocation_uid)}\n                        value={tache.duree||""}\n',
    "disable durée verrou");
  s = once(s,
    '                    <button onClick={()=>{\n                      const t=(draft.taches||[]).filter((_,i)=>i!==idx);\n',
    '                    <button onClick={()=>toggleAllocationLock(tache)} disabled={!tache.allocation_uid || lockingUid===tache.allocation_uid}\n                      style={{background:"transparent",border:"none",cursor:"pointer",color:allocationLocks.has(tache.allocation_uid)?"#f59e0b":T.textMuted,fontSize:15,padding:"0 3px",flexShrink:0}}\n                      title={allocationLocks.has(tache.allocation_uid)?"Déverrouiller cette allocation":"Verrouiller date, durée et équipe"}>\n                      {allocationLocks.has(tache.allocation_uid)?"🔒":"🔓"}\n                    </button>\n                    <button disabled={allocationLocks.has(tache.allocation_uid)} onClick={()=>{\n                      const t=(draft.taches||[]).filter((_,i)=>i!==idx);\n',
    "bouton verrou avant suppression");
  s = once(s,
    '                        <button key={o} onClick={()=>{\n',
    '                        <button key={o} disabled={allocationLocks.has(tache.allocation_uid)} onClick={()=>{\n',
    "disable affectation verrou");
  s = once(s,
    '                          cursor:"pointer",fontFamily:"inherit",transition:"all .1s",\n                          background:sel?chantier.couleur:"transparent",\n',
    '                          cursor:allocationLocks.has(tache.allocation_uid)?"not-allowed":"pointer",fontFamily:"inherit",transition:"all .1s",\n                          opacity:allocationLocks.has(tache.allocation_uid)?.6:1,\n                          background:sel?chantier.couleur:"transparent",\n',
    "style affectation verrou");
  // Nettoyage expression conditionnelle pour lisibilité/compatibilité.
  s = s.replace('opacity:allocationLocks.has(tache.allocation_uid)?.6:1', 'opacity:allocationLocks.has(tache.allocation_uid) ? 0.6 : 1');
  fs.writeFileSync(path, s);
}

{
  const path = "src/Renovation/Planning.jsx";
  let s = fs.readFileSync(path, "utf8");
  s = once(s,
    'import { creerAllocationUid } from "./planningBaselineModelV1.js";\n',
    'import { creerAllocationUid } from "./planningBaselineModelV1.js";\nimport { estAllocationVerrouilleeV1 } from "./planningAllocationLockDataV1.js";\n',
    "import verrou Planning");
  s = once(s,
    '    const moved = fromTaches[taskIdx];\n    const newFromTaches = fromTaches.filter((_, i) => i !== taskIdx);\n',
    '    const moved = fromTaches[taskIdx];\n    if (moved?.allocation_uid) {\n      try {\n        if (await estAllocationVerrouilleeV1(moved.allocation_uid)) {\n          window.alert("Cette allocation est verrouillée. Déverrouille-la dans la cellule avant de la déplacer.");\n          return;\n        }\n      } catch (e) {\n        console.warn("Vérification verrou allocation :", e?.message || e);\n        window.alert("Impossible de vérifier le verrou de cette allocation. Le déplacement est annulé par sécurité.");\n        return;\n      }\n    }\n    const newFromTaches = fromTaches.filter((_, i) => i !== taskIdx);\n',
    "blocage move verrouillé");
  fs.writeFileSync(path, s);
}

console.log("Allocation locks V1 patch appliqué");
