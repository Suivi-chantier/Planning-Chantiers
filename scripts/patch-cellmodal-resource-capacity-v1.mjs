#!/usr/bin/env node
import fs from "node:fs";

const path = "src/Renovation/CellModal.jsx";
let source = fs.readFileSync(path, "utf8");

const replacements = [
  {
    from: 'import { capaciteJour as capaciteJourRythme } from "../rythmeSemaine";\n',
    to: 'import { capaciteJour as capaciteJourRythme } from "../rythmeSemaine";\nimport { calculerCapaciteRessourcePourDate } from "./planningResourceCapacityV1.js";\nimport { chargerRessourcesPlanningV1, chargerEvenementsRessourcesPourDateV1, indexerRessourcesParNomPlanningV1, ressourcePourNomPlanningV1 } from "./planningResourceDataV1.js";\n',
    label: "imports capacité ressource",
  },
  {
    from: '  const getDateISO = () => {\n    const d = getDateObj();\n    return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` : null;\n  };\n\n',
    to: '  const getDateISO = () => {\n    const d = getDateObj();\n    return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` : null;\n  };\n  const dateISOJour = getDateISO();\n  const [resourceIndex, setResourceIndex] = useState(() => new Map());\n  const [resourceEvents, setResourceEvents] = useState([]);\n  useEffect(() => {\n    let cancelled = false;\n    if (!dateISOJour) { setResourceIndex(new Map()); setResourceEvents([]); return undefined; }\n    Promise.all([chargerRessourcesPlanningV1(), chargerEvenementsRessourcesPourDateV1(dateISOJour)])\n      .then(([resources, events]) => {\n        if (cancelled) return;\n        setResourceIndex(indexerRessourcesParNomPlanningV1(resources));\n        setResourceEvents(events || []);\n      })\n      .catch(e => {\n        if (cancelled) return;\n        console.warn("Capacité ressources indisponible, fallback rythmeSemaine :", e?.message || e);\n        setResourceIndex(new Map());\n        setResourceEvents([]);\n      });\n    return () => { cancelled = true; };\n  }, [dateISOJour]);\n\n',
    label: "chargement ressources du jour",
  },
  {
    from: '  const capaciteJour = capaciteJourRythme(jour, year, week);\n',
    to: '  const capaciteJour = capaciteJourRythme(jour, year, week);\n  const capacitePourOuvrier = (nomOuvrier) => {\n    const resource = ressourcePourNomPlanningV1(resourceIndex, nomOuvrier);\n    if (!resource || !dateISOJour) return capaciteJour;\n    const evenements = resourceEvents.filter(e => e.resource_id === resource.id);\n    return calculerCapaciteRessourcePourDate({\n      resource, dateISO: dateISOJour, evenements, heuresDejaAllouees: 0,\n    }).capacite_apres_exceptions;\n  };\n',
    label: "capacité par ouvrier",
  },
  {
    from: '  const restantJourPour = (taches, cibles, skipIdx = -1) => {\n    const charge = (cibles && cibles.length)\n      ? Math.max(...cibles.map(o => chargeOuvrier(taches, o, skipIdx)))\n      : taches.reduce((s, x, i) => i === skipIdx ? s : s + (parseFloat(x.duree) || 0), 0);\n    return Math.max(0, Math.round((capaciteJour - charge) * 4) / 4);\n  };\n',
    to: '  const restantJourPour = (taches, cibles, skipIdx = -1) => {\n    if (cibles && cibles.length) {\n      const restants = cibles.map(o => capacitePourOuvrier(o) - chargeOuvrier(taches, o, skipIdx));\n      return Math.max(0, Math.round(Math.min(...restants) * 4) / 4);\n    }\n    const charge = taches.reduce((s, x, i) => i === skipIdx ? s : s + (parseFloat(x.duree) || 0), 0);\n    return Math.max(0, Math.round((capaciteJour - charge) * 4) / 4);\n  };\n',
    label: "reste journée par capacité individuelle",
  },
];

for (const r of replacements) {
  if (source.includes(r.to)) continue;
  const count = source.split(r.from).length - 1;
  if (count !== 1) throw new Error(`${r.label}: motif attendu 1 fois, trouvé ${count}`);
  source = source.replace(r.from, r.to);
}

fs.writeFileSync(path, source);
console.log("CellModal raccordé aux capacités ressources V1");
