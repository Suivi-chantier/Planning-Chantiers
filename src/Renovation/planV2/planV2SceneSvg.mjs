// ─────────────────────────────────────────────────────────────────────────────
// planV2SceneSvg — nouvel éditeur de plans : sortie SVG de la scène du plan
// (docs/projets/editeur-plans.md, règle 11 : « rendu en SVG, pas en canvas »).
//
// Module PUR : une chaîne de caractères en sortie, aucun DOM, aucune police
// installée. Il ne fait qu'ÉCRIRE les formes de planV2SceneDessin.mjs : aucune
// géométrie ici. Couvert par scripts/verif-plan-v2-scene.mjs.
//
//   sceneEnSvg(scene, options)  = dessinEnSvg(dessinerScene(scene, options))
//   options : celles de dessinerScene (unitesParMetre, facteurTailles, titre…).
//
// Le SVG a un `viewBox` en unités de sortie (0 0 largeur hauteur) et pas de
// taille imposée : c'est l'appelant qui le place (écran, planche à l'échelle).
// Un groupe par calque (`data-calque`) ; chaque forme porte `data-element`
// (identifiant de l'élément de scène), `data-type` et `data-role`. Les formes
// non interactives (textes, traits de menuiserie) laissent passer le toucher :
// une pièce reste cliquable d'un seul tenant, même sous son étiquette.
// ─────────────────────────────────────────────────────────────────────────────
import { dessinerScene } from "./planV2SceneDessin.mjs";

export * from "./planV2SceneDessin.mjs";

export const POLICE_PLAN = "Helvetica, Arial, sans-serif";

const nb = (v) => String(Math.round(v * 100) / 100 + 0);
const xml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pt = (p) => `${nb(p[0])},${nb(p[1])}`;

function style(f) {
  let s = ` fill="${f.remplissage ? xml(f.remplissage) : "none"}"`;
  if (f.trait) {
    s += ` stroke="${xml(f.trait)}" stroke-width="${nb(f.epaisseur ?? 1)}" stroke-linejoin="round"`;
    if (f.tirets) s += ` stroke-dasharray="${f.tirets.map(nb).join(" ")}"`;
  }
  if (f.opacite != null) s += ` opacity="${nb(f.opacite)}"`;
  return s;
}

function ecrire(f) {
  let s = "";
  if (f.element) s += ` data-element="${xml(f.element)}" data-type="${xml(f.type)}"`;
  s += ` data-role="${xml(f.role)}"`;
  if (!f.interactif) s += ' pointer-events="none"';
  else if (f.role === "zone_toucher") s += ' pointer-events="all"';
  const tourne = (cx, cy) => (f.angle ? ` transform="rotate(${nb(f.angle)} ${nb(cx)} ${nb(cy)})"` : "");
  switch (f.forme) {
    case "polygone": return `<polygon${s} points="${f.points.map(pt).join(" ")}"${style(f)}/>`;
    case "ligne": return `<line${s} x1="${nb(f.a[0])}" y1="${nb(f.a[1])}" x2="${nb(f.b[0])}" y2="${nb(f.b[1])}"${style(f)}/>`;
    case "arc": return `<path${s} d="M${pt(f.de)} A${nb(f.rayon)} ${nb(f.rayon)} 0 0 ${f.sens} ${pt(f.vers)}"${style(f)}/>`;
    case "cercle": return `<circle${s} cx="${nb(f.cx)}" cy="${nb(f.cy)}" r="${nb(f.rayon)}"${style(f)}/>`;
    case "rect": return `<rect${s} x="${nb(f.cx - f.largeur / 2)}" y="${nb(f.cy - f.hauteur / 2)}" width="${nb(f.largeur)}" height="${nb(f.hauteur)}"${f.rayon ? ` rx="${nb(f.rayon)}"` : ""}${tourne(f.cx, f.cy)}${style(f)}/>`;
    case "texte":
      // Centré sur (x, y) : la ligne de base est posée à 0,35 fois la taille
      // sous le centre (pas de `dominant-baseline`, rendu inégal selon les lecteurs).
      return `<text${s} x="${nb(f.x)}" y="${nb(f.y + f.taille * 0.35)}" font-size="${nb(f.taille)}"${f.gras ? ' font-weight="700"' : ""} text-anchor="${f.ancrage === "debut" ? "start" : "middle"}" fill="${xml(f.couleur)}"${tourne(f.x, f.y)}>${xml(f.texte)}</text>`;
    default: throw new Error(`forme inconnue : ${f.forme}`);
  }
}

export function dessinEnSvg(dessin) {
  const L = nb(dessin.largeur), H = nb(dessin.hauteur);
  const lignes = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L} ${H}" font-family="${POLICE_PLAN}" data-unites-par-metre="${nb(dessin.projection.unites_par_metre)}">`,
    `<rect data-role="fond" pointer-events="none" x="0" y="0" width="${L}" height="${H}" fill="${xml(dessin.fond)}"/>`,
  ];
  let calque = null;
  for (const f of dessin.formes) {
    if (f.calque !== calque) {
      if (calque !== null) lignes.push("</g>");
      lignes.push(`<g data-calque="${xml(f.calque)}">`);
      calque = f.calque;
    }
    lignes.push(ecrire(f));
  }
  if (calque !== null) lignes.push("</g>");
  lignes.push("</svg>");
  return lignes.join("\n");
}

export const sceneEnSvg = (scene, options = {}) => dessinEnSvg(dessinerScene(scene, options));
