// ─────────────────────────────────────────────────────────────────────────────
// planV2SceneMurs — nouvel éditeur de plans : géométrie des MURS PLEINS à
// dessiner (docs/projets/editeur-plans.md, étape 1 : « murs pleins à leur
// épaisseur »).
//
// Module PUR : aucun réseau, aucune horloge, aucun effet de bord. Le relevé et
// le modèle (planV2Modele.mjs) arrivent en paramètre et ne sont jamais
// modifiés. Couvert par scripts/verif-plan-v2-scene.mjs.
//
// PRINCIPE. Chaque mur du modèle reste UN objet dessinable :
//   • mur à épaisseur connue (« partage », « peripherique ») → sa BANDE : le
//     quadrilatère de contourMur (ses deux faces, ou sa face décalée de son
//     épaisseur) ;
//   • mur « peripherique » d'épaisseur inconnue → un TRAIT sur sa face, avec sa
//     raison : jamais une bande d'épaisseur par défaut ;
//   • « limite » (pas de mur entre deux pièces) → un TRAIT fin ;
//   • « raccord » (bout de côté adossé à la matière d'un autre mur) → rien : sa
//     matière est celle du mur voisin. Il est listé dans `sans_element`.
// Les bandes ne couvrent pas les angles : à chaque coin SAILLANT d'une pièce
// (angle intérieur < 180°), les deux bandes laissent un coin vide. Il est
// rempli par une JONCTION : le quadrilatère coin de pièce → pied sur la face
// extérieure du 1ᵉʳ mur → rencontre des deux faces extérieures → pied sur la
// face extérieure du 2ᵉ mur (un « onglet »). La même construction, depuis les
// coins des pièces voisines, ferme les rencontres en T et en croix : plusieurs
// jonctions peuvent alors couvrir le même carré (elles se superposent, ce qui
// ne se voit pas en aplat ; chacune liste les murs qu'elle relie).
// À un coin RENTRANT (angle intérieur > 180°) les deux bandes se recouvrent ;
// entre deux murs périphériques elles sont recoupées sur leur diagonale.
//
// CE QUI N'EST PAS INVENTÉ
//   • un mur sans épaisseur connue ne reçoit ni bande ni jonction ;
//   • derrière un « raccord » en coin de pièce (décrochement), la jonction
//     reprend l'épaisseur du mur voisin : elle n'est gardée que si les murs
//     dessinés du relevé (calque A-WALL) y montrent bien de la matière ;
//   • une jonction qui tomberait dans une pièce est écartée et listée.
//
// CE QUE RENVOIE geometrieMurs(releve, modele, tolerances)
//   { murs:      [{ mur, polygone }],                 // bandes, m
//     traits:    [{ mur, genre: "epaisseur_inconnue" | "limite", a, b, raison }],
//     jonctions: [{ id: "jonction:‹pièce›:‹sommet›", piece, sommet,
//                   murs: [idMur, idMur], polygone,
//                   source: "calcul" | "raccord" }],
//     sans_element: [{ mur, raison }],                // raccords
//     jonctions_ecartees: [{ id, raison }] }
// ─────────────────────────────────────────────────────────────────────────────
import { cotesPiece, pointDansPoly } from "../releveImapper.mjs";
import { contourMur } from "./planV2Murs.mjs";

export const TOLERANCES_SCENE_MURS = Object.freeze({
  // Deux côtés consécutifs qui tournent de moins que cet angle sont dans le
  // prolongement l'un de l'autre : pas d'onglet (la rencontre des deux faces
  // extérieures partirait très loin), un simple biseau.
  angleProlongementDeg: 15,
  // Onglet plus long que tant de fois l'épaisseur (angle très aigu) : biseau.
  ongletMax: 4,
  // Jonction supposée derrière un raccord : part minimale couverte par les
  // murs dessinés du relevé (même seuil que `pleinMin` de planV2Murs).
  matiereMin: 0.5,
  // Part d'une jonction tombant dans une pièce au-delà de laquelle on l'écarte
  // (5 % : la mesure se fait sur une grille de 64 points, soit 3 points).
  dansPieceMax: 0.05,
  // Jonction plus petite que cela (m²) : rien à dessiner.
  surfaceMin: 1e-6,
});

const arr = (v) => Math.round(v * 1e6) / 1e6 + 0;          // + 0 : jamais de « −0 »
const pt = (p) => [arr(p[0]), arr(p[1])];
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const scal = (p, q) => p[0] * q[0] + p[1] * q[1];
const vect = (p, q) => p[0] * q[1] - p[1] * q[0];
const aire = (P) => Math.abs(P.reduce((t, p, k) => { const q = P[(k + 1) % P.length]; return t + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);

// Rencontre de deux droites { o, u } ; null si elles sont parallèles.
function rencontre(d1, d2) {
  const det = vect(d1.u, d2.u);
  if (Math.abs(det) < 1e-12) return null;
  const t = vect([d2.o[0] - d1.o[0], d2.o[1] - d1.o[1]], d2.u) / det;
  return [d1.o[0] + d1.u[0] * t, d1.o[1] + d1.u[1] * t];
}

// Part (0–1) du polygone P couverte par l'un des polygones `polys` (grille de
// points pris à l'intérieur de P ; son centre si P est trop fin).
export function partCouverte(P, polys) {
  if (!polys.length) return 0;
  const xs = P.map((q) => q[0]), ys = P.map((q) => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const N = 8, pts = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const q = [x0 + ((i + 0.5) / N) * (x1 - x0), y0 + ((j + 0.5) / N) * (y1 - y0)];
    if (pointDansPoly(q, P)) pts.push(q);
  }
  if (!pts.length) pts.push([xs.reduce((a, b) => a + b, 0) / P.length, ys.reduce((a, b) => a + b, 0) / P.length]);
  return pts.filter((q) => polys.some((Q) => pointDansPoly(q, Q))).length / pts.length;
}

// Face extérieure du mur `m`, vue du côté `c` de pièce, au coin V : droite
// { o, u, e } (o = pied de V sur la face, e = épaisseur au coin), ou null.
function faceExterieure(m, c, V) {
  if (!m || !(m.epaisseur > 0)) return null;
  if (m.type === "peripherique") {
    return { o: [V[0] - c.n[0] * m.epaisseur, V[1] - c.n[1] * m.epaisseur], u: c.u, e: m.epaisseur };
  }
  if (m.type !== "partage" || m.faces.length !== 2) return null;
  const f = m.faces.find((x) => !(x.piece === c.piece && x.cote === c.k));
  const L = f ? dist(f.a, f.b) : 0;
  if (L < 1e-9) return null;
  const u = [(f.b[0] - f.a[0]) / L, (f.b[1] - f.a[1]) / L];
  const s = scal([V[0] - f.a[0], V[1] - f.a[1]], u);
  const o = [f.a[0] + u[0] * s, f.a[1] + u[1] * s];
  const e = -scal([o[0] - V[0], o[1] - V[1]], c.n);         // > 0 : la face est bien derrière le mur
  return e > 0 ? { o, u, e } : null;
}

export function geometrieMurs(releve, modele, tolerances = {}) {
  const T = { ...TOLERANCES_SCENE_MURS, ...tolerances };
  const pieces = (releve?.pieces || []).filter((p) => (p.polygone || []).length >= 3);
  const mursModele = modele?.existant?.murs || [];
  const parId = new Map(mursModele.map((m) => [m.id, m]));
  const matiere = (releve?.murs || []).map((m) => m.polygone || []).filter((P) => P.length >= 3);
  const sols = pieces.map((p) => p.polygone);
  const sinMin = Math.sin((T.angleProlongementDeg * Math.PI) / 180);

  // 1. Bandes, traits, raccords.
  const bandes = new Map(), traits = [], sans = [];
  for (const m of mursModele) {
    const f0 = m.faces[0];
    if (m.type === "raccord") { sans.push({ mur: m.id, raison: m.epaisseur_raison || "matiere_continue" }); continue; }
    if (m.type === "limite") { traits.push({ mur: m.id, genre: "limite", a: f0.a, b: f0.b, raison: m.epaisseur_raison || "pieces_contigues" }); continue; }
    const c = contourMur(m);
    if (!c) { traits.push({ mur: m.id, genre: "epaisseur_inconnue", a: f0.a, b: f0.b, raison: m.epaisseur_raison || "epaisseur_inconnue" }); continue; }
    bandes.set(m.id, c.map((q) => [q[0], q[1]]));
  }

  // 2. Coins de pièces : jonctions (saillants), recoupe des bandes (rentrants).
  const jonctions = [], ecartees = [], recoupes = new Map();
  for (const p of pieces) {
    const C = cotesPiece(p), n = C.length;
    const mp = (modele?.existant?.pieces || []).find((x) => x.id === p.id);
    const mursCote = (k) => ((mp?.cotes || []).find((x) => x.cote === k)?.murs || []).map((id) => parId.get(id)).filter(Boolean);
    for (let k = 0; k < n; k++) {
      const V = p.polygone[k], c1 = C[(k - 1 + n) % n], c2 = C[k];
      const m1 = mursCote(c1.k).at(-1), m2 = mursCote(c2.k)[0];
      if (!m1 || !m2 || m1 === m2) continue;
      const sinus = Math.abs(vect(c1.u, c2.u));
      const saillant = scal(c2.u, c1.n) > 0;
      let d1 = faceExterieure(m1, c1, V), d2 = faceExterieure(m2, c2, V);
      const id = `jonction:${p.id}:${k}`;
      if (!saillant) {
        // Coin rentrant entre deux murs périphériques : les bandes se
        // recouvrent ; on les recoupe sur leur diagonale.
        if (!d1 || !d2 || sinus < sinMin || m1.type !== "peripherique" || m2.type !== "peripherique") continue;
        const M = rencontre(d1, d2);
        if (!M) continue;
        const r1 = scal([d1.o[0] - M[0], d1.o[1] - M[1]], c1.u), r2 = scal([M[0] - d2.o[0], M[1] - d2.o[1]], c2.u);
        const deja1 = recoupes.get(m1.id) || 0, deja2 = recoupes.get(m2.id) || 0;
        if (!(r1 > 0 && r2 > 0) || deja1 + r1 >= m1.longueur || deja2 + r2 >= m2.longueur) continue;
        bandes.get(m1.id)[2] = pt(M); recoupes.set(m1.id, deja1 + r1);
        bandes.get(m2.id)[3] = pt(M); recoupes.set(m2.id, deja2 + r2);
        continue;
      }
      // Coin saillant.
      let source = "calcul", bout = null;
      if (!d1 && !d2) continue;
      if (!d1 || !d2) {
        const [manque, c, autre] = d1 ? [m2, c2, d1] : [m1, c1, d2];
        if (manque.type !== "raccord") { ecartees.push({ id, raison: manque.type === "limite" ? "limite_sans_mur" : "epaisseur_inconnue" }); continue; }
        // Raccord (décrochement, bout de cloison) : sa matière est celle du mur
        // voisin. La jonction reprend l'épaisseur de ce voisin et longe tout le
        // raccord (iMapper dessine les décrochements ainsi).
        const d = { o: [V[0] - c.n[0] * autre.e, V[1] - c.n[1] * autre.e], u: c.u, e: autre.e };
        const f = manque.faces[0], loin = d1 ? f.b : f.a;
        bout = [loin, [loin[0] - c.n[0] * autre.e, loin[1] - c.n[1] * autre.e]];
        if (d1) d2 = d; else d1 = d;
        source = "raccord";
      }
      const R = sinus < sinMin ? null : rencontre(d1, d2);
      const M = R && dist(R, V) <= T.ongletMax * Math.max(d1.e, d2.e) ? [R] : [];
      // Contour : coin → pied sur la 1ʳᵉ face extérieure → onglet → pied sur la
      // 2ᵉ ; derrière un raccord, le pied est remplacé par le bout du raccord.
      const P = !bout ? [V, d1.o, ...M, d2.o]
        : m2.type === "raccord" ? [V, d1.o, ...M, bout[1], bout[0]] : [V, bout[0], bout[1], ...M, d2.o];
      if (aire(P) < T.surfaceMin) continue;
      if (source === "raccord" && partCouverte(P, matiere) < T.matiereMin) { ecartees.push({ id, raison: "pas_de_matiere_dessinee" }); continue; }
      if (partCouverte(P, sols) > T.dansPieceMax) { ecartees.push({ id, raison: "dans_une_piece" }); continue; }
      jonctions.push({ id, piece: p.id, sommet: k, murs: [m1.id, m2.id], polygone: P.map(pt), source });
    }
  }
  return {
    murs: [...bandes].map(([mur, polygone]) => ({ mur, polygone })),
    traits, jonctions, sans_element: sans, jonctions_ecartees: ecartees,
  };
}

// ── Mesure d'emprise (vérifications, comptes rendus) ───────────────────────
// Surface de la réunion des polygones A et part de cette surface couverte par
// les polygones B, sur une grille de pas `pas` (m). Sert à mesurer ce que les
// murs dessinés recouvrent de l'intérieur des pièces.
function lignesPleines(P, pas, y0, marquer) {
  const ys = P.map((q) => q[1]);
  const j0 = Math.floor((Math.min(...ys) - y0) / pas), j1 = Math.ceil((Math.max(...ys) - y0) / pas);
  for (let j = j0; j <= j1; j++) {
    const y = y0 + (j + 0.5) * pas, xs = [];
    for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
      const [xi, yi] = P[a], [xj, yj] = P[b];
      if ((yi > y) !== (yj > y)) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
    }
    xs.sort((u, v) => u - v);
    for (let i = 0; i + 1 < xs.length; i += 2) marquer(j, xs[i], xs[i + 1]);
  }
}
export function mesurerRecouvrement(polysA, polysB, { pas = 0.01 } = {}) {
  const tous = [...polysA, ...polysB].flat();
  if (!tous.length) return { surface_m2: 0, commune_m2: 0, part: 0 };
  const x0 = Math.min(...tous.map((q) => q[0])), y0 = Math.min(...tous.map((q) => q[1]));
  const cases = (polys) => {
    const S = new Set();
    for (const P of polys) {
      lignesPleines(P, pas, y0, (j, xa, xb) => {
        const i0 = Math.ceil((xa - x0) / pas - 0.5), i1 = Math.floor((xb - x0) / pas - 0.5);
        for (let i = i0; i <= i1; i++) S.add(j * 1e6 + i);
      });
    }
    return S;
  };
  const A = cases(polysA), B = cases(polysB);
  let commune = 0;
  for (const k of A) if (B.has(k)) commune++;
  return { surface_m2: A.size * pas * pas, commune_m2: commune * pas * pas, part: A.size ? commune / A.size : 0 };
}
