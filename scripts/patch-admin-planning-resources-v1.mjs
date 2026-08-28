#!/usr/bin/env node
import fs from "node:fs";

function replaceOnceOrAlready(source, { from, to, already, label }) {
  if (source.includes(already || to)) return source;
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: motif attendu 1 fois, trouvé ${count}`);
  return source.replace(from, to);
}

const adminPath = "src/Renovation/Admin.jsx";
let admin = fs.readFileSync(adminPath, "utf8");

admin = replaceOnceOrAlready(admin, {
  from: 'import EspaceOuvrier from "./EspaceOuvrier";\n',
  to: 'import EspaceOuvrier from "./EspaceOuvrier";\nimport PlanningResourcesAdmin from "./PlanningResourcesAdmin";\n',
  already: 'import PlanningResourcesAdmin from "./PlanningResourcesAdmin";',
  label: "import PlanningResourcesAdmin",
});
admin = replaceOnceOrAlready(admin, {
  from: '    { id:"personnes", label:"Personnes & accès", icon:HardHat, tabs:[\n      ["ouvriers", "Ouvriers", HardHat],\n',
  to: '    { id:"personnes", label:"Personnes & accès", icon:HardHat, tabs:[\n      ["ressources", "Ressources & absences", Clock],\n      ["ouvriers", "Ouvriers", HardHat],\n',
  already: '["ressources", "Ressources & absences", Clock]',
  label: "onglet ressources",
});
admin = replaceOnceOrAlready(admin, {
  from: '      {adminTab==="utilisateurs" && isAdmin && (\n        <OngletUtilisateurs T={T} acc={acc}/>\n      )}\n\n',
  to: '      {adminTab==="ressources" && (\n        <PlanningResourcesAdmin T={T} acc={acc}/>\n      )}\n\n      {adminTab==="utilisateurs" && isAdmin && (\n        <OngletUtilisateurs T={T} acc={acc}/>\n      )}\n\n',
  already: 'adminTab==="ressources"',
  label: "rendu ressources",
});
fs.writeFileSync(adminPath, admin);

const componentPath = "src/Renovation/PlanningResourcesAdmin.jsx";
let component = fs.readFileSync(componentPath, "utf8");
const ambiguous = 'opacity:saving?.6:1';
if (component.includes(ambiguous)) component = component.replace(ambiguous, 'opacity:saving ? 0.6 : 1');
fs.writeFileSync(componentPath, component);

console.log("Admin et PlanningResourcesAdmin raccordés/nettoyés");
