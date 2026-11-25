// ─────────────────────────────────────────────────────────────────────────────
// planV2SceneTextes — nouvel éditeur de plans : mise en page des TEXTES du
// plan pour une échelle donnée (étiquettes nom + surface, cotes intérieures).
//
// Module PUR : aucun DOM, aucune police installée. Les largeurs de texte sont
// ESTIMÉES par une fonction reçue en paramètre (mesurerTexteDefaut à défaut) :
// le composant de l'éditeur pourra passer une mesure exacte du navigateur.
// Tout est en unités de sortie (repère du dessin, y vers le bas). Utilisé par
// planV2SceneDessin.mjs ; couvert par scripts/verif-plan-v2-scene.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import { pointDansPoly } from "../releveImapper.mjs";

// Largeur estimée d'un texte en police sans empattement (chiffres : 0,56 fois
// la taille). Volontairement un peu large : un texte annoncé « tient » tient.
const ETROITS = new Set([..." .,;:·'’!|ilIjtfr()"]);
const LARGES = new Set([..."mwMW≈²"]);
export function mesurerTexteDefaut(texte, taille, { gras = false } = {}) {
  let w = 0;
  for (const c of String(texte ?? "")) {
    w += ETROITS.has(c) ? 0.32 : LARGES.has(c) ? 0.86 : c >= "0" && c <= "9" ? 0.56 : c === c.toUpperCase() && c !== c.toLowerCase() ? 0.7 : 0.56;
  }
  return w * taille * (gras ? 1.07 : 1);
}

// ── Boîtes orientées ───────────────────────────────────────────────────────
// { cx, cy, dl, dh, angle } : centre, demi-longueur, demi-hauteur, angle (rad).
export function coinsBoite(b) {
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [b.cx + i * b.dl * c - j * b.dh * s, b.cy + i * b.dl * s + j * b.dh * c]);
}
// Deux boîtes orientées se croisent-elles ? (axes séparateurs)
export function boitesSeCroisent(a, b) {
  const A = coinsBoite(a), B = coinsBoite(b);
  for (const ang of [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2]) {
    const ax = [Math.cos(ang), Math.sin(ang)];
    const pa = A.map((q) => q[0] * ax[0] + q[1] * ax[1]), pb = B.map((q) => q[0] * ax[0] + q[1] * ax[1]);
    if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
  }
  return true;
}
const pointDansBoite = (q, b) => {
  const c = Math.cos(b.angle), s = Math.sin(b.angle), dx = q[0] - b.cx, dy = q[1] - b.cy;
  return Math.abs(dx * c + dy * s) < b.dl && Math.abs(-dx * s + dy * c) < b.dh;
};
// La boîte tient-elle DANS le polygone ? Ses coins et les milieux de ses bords
// sont dedans, et aucun sommet du polygone n'entre dans la boîte.
export function boiteDansPolygone(b, P) {
  const C = coinsBoite(b);
  const pts = [...C, ...C.map((q, k) => [(q[0] + C[(k + 1) % 4][0]) / 2, (q[1] + C[(k + 1) % 4][1]) / 2])];
  return pts.every((q) => pointDansPoly(q, P)) && !P.some((q) => pointDansBoite(q, b));
}

// ── Étiquette d'une pièce ──────────────────────────────────────────────────
// Centrée sur l'ancre de la pièce. On essaie, dans l'ordre :
//   1. deux lignes (nom en gras, surface), de 100 % à 65 % de la taille, à
//      l'horizontale puis tournées d'un quart de tour ;
//   2. une seule ligne « Nom · surface », le long du plus grand côté de la
//      pièce (pièce étroite ou en biais), puis à l'horizontale et à la verticale ;
//   3. rien ne tient DANS la pièce : la ligne unique à la taille minimale, le
//      long du plus grand côté — `tient` vaut false et le dessin lui met un
//      fond clair pour qu'elle reste lisible sur un mur.
//   P : polygone de la pièce (unités de sortie) ; ancre : [x, y].
//   T : { etiquetteNom, etiquetteSurface, etiquetteMin, etiquetteMarge }.
// → { x, y, angle, lignes: [{ texte, taille, gras, dy }], boite, tient }
export function placerEtiquette(P, ancre, nom, surface, T, mesurer) {
  const [x, y] = ancre;
  const tailles = [];
  for (let k = 1; k >= 0.65 - 1e-9; k -= 0.05) tailles.push(k);
  for (const k of tailles) {
    const fn = Math.max(T.etiquetteMin, T.etiquetteNom * k), fs = Math.max(T.etiquetteMin, T.etiquetteSurface * k);
    const w = Math.max(nom ? mesurer(nom, fn, { gras: true }) : 0, mesurer(surface, fs, {})) + 2 * T.etiquetteMarge;
    const h = (nom ? fn : 0) + fs + fs * 0.35 + 2 * T.etiquetteMarge;
    for (const angle of [0, -Math.PI / 2]) {
      const boite = { cx: x, cy: y, dl: w / 2, dh: h / 2, angle };
      if (!boiteDansPolygone(boite, P)) continue;
      const haut = -h / 2 + T.etiquetteMarge;
      const lignes = nom
        ? [{ texte: nom, taille: fn, gras: true, dy: haut + fn * 0.5 }, { texte: surface, taille: fs, gras: false, dy: haut + fn + fs * 0.35 + fs * 0.5 }]
        : [{ texte: surface, taille: fs, gras: false, dy: 0 }];
      return { x, y, angle, lignes, boite, tient: true };
    }
  }
  let long = 0, sens = 0;
  P.forEach((a, i) => { const b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > long) { long = L; sens = Math.atan2(b[1] - a[1], b[0] - a[0]); } });
  const lelong = angleLisible(sens), texte = nom ? `${nom} · ${surface}` : surface;
  const ligne = (f, angle) => ({ cx: x, cy: y, dl: mesurer(texte, f, { gras: true }) / 2 + T.etiquetteMarge, dh: f * 0.5 + T.etiquetteMarge, angle });
  for (const k of tailles) {
    const f = Math.max(T.etiquetteMin, T.etiquetteSurface * k);
    for (const angle of [lelong, 0, -Math.PI / 2]) {
      const boite = ligne(f, angle);
      if (boiteDansPolygone(boite, P)) return { x, y, angle, lignes: [{ texte, taille: f, gras: true, dy: 0 }], boite, tient: true };
    }
  }
  return { x, y, angle: lelong, lignes: [{ texte, taille: T.etiquetteMin, gras: true, dy: 0 }], boite: ligne(T.etiquetteMin, lelong), tient: false };
}

// Angle d'un texte écrit le long d'une direction, jamais la tête en bas. Un
// texte presque vertical se lit toujours de bas en haut (entre −100° et +80°),
// pour que deux murs qui penchent de part et d'autre de la verticale ne
// donnent pas deux sens de lecture.
export function angleLisible(angle) {
  let a = angle;
  while (a > (80 * Math.PI) / 180) a -= Math.PI;
  while (a <= (-100 * Math.PI) / 180) a += Math.PI;
  return a;
}

// ── Cotes intérieures ──────────────────────────────────────────────────────
// Chaque cote s'écrit le long de son côté, à l'intérieur de la pièce, lisible
// (jamais la tête en bas). Les plus longues passent d'abord. Une cote n'est
// pas affichée à cette échelle si :
//   « masquee »        l'utilisateur l'a masquée ;
//   « doublon »        même cote déjà écrite sur l'autre face d'une cloison ;
//   « cote_trop_court » son texte est plus long que son côté ;
//   « hors_piece »     le texte sortirait de la pièce (recoin étroit) ;
//   « chevauchement »  il recouvrirait un texte ou un repère déjà posé.
// Une cote déplacée à la main (`decalage`, unités de sortie) est toujours
// affichée, là où on l'a mise.
//   cotes : [{ id, a, b, n, texte, longueur, masquee, doublon, decalage, polygone }]
//           a, b, polygone en unités de sortie ; n = normale vers la pièce.
//   occupees : boîtes déjà prises (étiquettes, repères) — complétée au passage.
// → [{ id, visible, raison, x, y, angle, texte, boite }] dans l'ordre reçu.
export function placerCotes(cotes, occupees, T, mesurer) {
  const res = new Map();
  const ordre = [...cotes].sort((u, v) => v.longueur - u.longueur || (u.id < v.id ? -1 : u.id > v.id ? 1 : 0));
  for (const c of ordre) {
    const non = (raison) => res.set(c.id, { id: c.id, visible: false, raison, texte: c.texte });
    if (c.masquee) { non("masquee"); continue; }
    if (c.doublon && !c.decalage) { non("doublon"); continue; }
    const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1], lg = Math.hypot(dx, dy);
    const tw = mesurer(c.texte, T.cote, {});
    const angle = angleLisible(Math.atan2(dy, dx));
    const m = [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2];
    // Le bord du texte reste à `coteEcart` du mur, quelle que soit sa taille.
    const dh = T.cote * 0.5 + 1, recul = dh + T.coteEcart;
    const boite = { cx: m[0] + c.n[0] * recul, cy: m[1] + c.n[1] * recul, dl: tw / 2 + T.coteMarge, dh, angle };
    const pose = () => { occupees.push(boite); res.set(c.id, { id: c.id, visible: true, raison: null, x: boite.cx, y: boite.cy, angle, texte: c.texte, boite }); };
    if (c.decalage) { boite.cx += c.decalage[0]; boite.cy += c.decalage[1]; pose(); continue; }
    if (!(lg >= tw + 2 * T.coteMarge)) { non("cote_trop_court"); continue; }
    if (!boiteDansPolygone(boite, c.polygone)) { non("hors_piece"); continue; }
    if (occupees.some((o) => boitesSeCroisent(boite, o))) { non("chevauchement"); continue; }
    pose();
  }
  return cotes.map((c) => res.get(c.id));
}
