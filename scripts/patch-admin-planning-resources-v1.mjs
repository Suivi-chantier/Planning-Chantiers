#!/usr/bin/env node
import fs from "node:fs";

const path = "src/Renovation/Admin.jsx";
let source = fs.readFileSync(path, "utf8");

const replacements = [
  {
    from: 'import EspaceOuvrier from "./EspaceOuvrier";\n',
    to: 'import EspaceOuvrier from "./EspaceOuvrier";\nimport PlanningResourcesAdmin from "./PlanningResourcesAdmin";\n',
    label: "import PlanningResourcesAdmin",
  },
  {
    from: '    { id:"personnes", label:"Personnes & accès", icon:HardHat, tabs:[\n      ["ouvriers", "Ouvriers", HardHat],\n',
    to: '    { id:"personnes", label:"Personnes & accès", icon:HardHat, tabs:[\n      ["ressources", "Ressources & absences", Clock],\n      ["ouvriers", "Ouvriers", HardHat],\n',
    label: "onglet ressources",
  },
  {
    from: '      {adminTab==="utilisateurs" && isAdmin && (\n        <OngletUtilisateurs T={T} acc={acc}/>\n      )}\n\n',
    to: '      {adminTab==="ressources" && (\n        <PlanningResourcesAdmin T={T} acc={acc}/>\n      )}\n\n      {adminTab==="utilisateurs" && isAdmin && (\n        <OngletUtilisateurs T={T} acc={acc}/>\n      )}\n\n',
    label: "rendu ressources",
  },
];

for (const r of replacements) {
  const count = source.split(r.from).length - 1;
  if (count !== 1) throw new Error(`${r.label}: motif attendu 1 fois, trouvé ${count}`);
  source = source.replace(r.from, r.to);
}

fs.writeFileSync(path, source);
console.log("Admin.jsx raccordé à PlanningResourcesAdmin");
