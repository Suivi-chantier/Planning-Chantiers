// scripts/verif-imports-invest.mjs — Identifiants utilisés mais non importés.
//
// Pourquoi ce script existe : `vite build` ne signale PAS un identifiant
// référencé sans être ni importé, ni déclaré. Le bundle se construit sans
// broncher, et l'application lève un ReferenceError au premier rendu du
// composant concerné — donc en production, sur l'écran de quelqu'un.
//
// Cas rencontrés pendant la remise à niveau :
//   • useRef manquant dans Dashboard.jsx
//   • supabase manquant dans Urbanisme.jsx
// Les deux passaient le build.
//
// Le contrôle est volontairement étroit : une liste fermée d'identifiants
// connus (hooks React, client Supabase, helpers partagés). Un analyseur de
// portée complet demanderait un vrai parseur ; ici on couvre exactement la
// classe d'erreur observée, sans faux positifs.
//
// Usage :  node scripts/verif-imports-invest.mjs
//
// Aucune dépendance.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DOSSIER = "src/Invest";

// Icônes lucide référencées dans le JSX : un nom oublié dans le bloc d'import
// donne exactement le même ReferenceError, invisible au build. La liste suit
// ce qui est réellement employé dans les fiches Invest.
const ICONES_LUCIDE = [
  "Landmark", "ClipboardList", "Building2", "Users", "Mail", "Calendar",
  "BarChart3", "Wallet", "Bell", "Briefcase", "Hammer", "MapPin", "FileText",
];

// Identifiants qui DOIVENT venir d'un import (jamais déclarés localement).
const ATTENDUS = [
  "useState", "useEffect", "useCallback", "useMemo", "useRef",
  "useImperativeHandle", "useLayoutEffect", "useContext",
  "supabase",
  "readNavTarget", "normalizeNavTarget", "NAV",
  "useAnnuaireInvest", "emailPourResponsable", "responsablesInvest",
  "estUtilisateurCourant", "indexerAnnuaire",
  ...ICONES_LUCIDE,
];

// Zone d'imports : tout ce qui précède la première déclaration de haut niveau.
function zoneImports(src) {
  const lignes = src.split("\n");
  const dernierImport = lignes.reduce(
    (acc, l, i) => (/^\s*import\b/.test(l) || /^\s*\}\s*from\s+["']/.test(l) ? i : acc), 0);
  return lignes.slice(0, dernierImport + 1).join("\n");
}

// Déclaré localement ? (function X, const X, let X, class X, ou paramètre
// destructuré d'une signature de composant.)
function declareLocalement(src, nom) {
  const motifs = [
    new RegExp(`\\b(?:function|class)\\s+${nom}\\b`),
    new RegExp(`\\b(?:const|let|var)\\s+${nom}\\s*[=,:]`),
    new RegExp(`\\b(?:const|let|var)\\s*\\{[^}]*\\b${nom}\\b[^}]*\\}\\s*=`),
  ];
  return motifs.some(m => m.test(src));
}

function utilise(src, nom) {
  // Appel de fonction, accès à une propriété, ou passage en prop JSX
  // (`as={Landmark}`, `icone={MapPin}`) — la forme employée par les icônes.
  return new RegExp(`\\b${nom}\\s*[(.]`).test(src)
      || new RegExp(`=\\{\\s*${nom}\\s*\\}`).test(src)
      || new RegExp(`<${nom}[\\s/>]`).test(src);
}

let problemes = 0;
let fichiers = 0;

const cibles = readdirSync(DOSSIER)
  .filter(f => f.endsWith(".jsx") || f.endsWith(".js") || f.endsWith(".mjs"))
  .sort();

for (const fichier of cibles) {
  const chemin = join(DOSSIER, fichier);
  const src = readFileSync(chemin, "utf8");
  const tete = zoneImports(src);
  fichiers++;

  for (const nom of ATTENDUS) {
    if (!utilise(src, nom)) continue;
    const importe = new RegExp(`\\b${nom}\\b`).test(tete);
    if (importe || declareLocalement(src, nom)) continue;
    console.log(`  ✗ ${chemin} : « ${nom} » utilisé, ni importé ni déclaré`);
    problemes++;
  }
}

console.log(`\n${"═".repeat(52)}`);
console.log(problemes === 0
  ? `✓ ${fichiers} fichiers Invest, aucun identifiant non résolu.`
  : `✗ ${problemes} identifiant(s) non résolu(s) — ReferenceError au rendu.`);
process.exit(problemes === 0 ? 0 : 1);
