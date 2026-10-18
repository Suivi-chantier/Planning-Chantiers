// ─────────────────────────────────────────────────────────────────────────────
// releveVersEditeur — conversion d'un relevé iMapper en ÉLÉMENTS DE L'ÉDITEUR
// de plans (traits, zones, textes, cotes), pour qu'il se modifie avec les
// outils habituels de la page Plans (décision du 18/10/2026).
//
//   murs      → traits : le BORD réel des murs (contour de leur union, sans
//               les coutures entre tronçons), coupé aux ouvertures sûres ;
//   ouvertures→ groupes de traits (comme la bibliothèque) : porte = vantail +
//               arc, fenêtre = trois traits dans l'épaisseur du mur. Une
//               ouverture « à vérifier » est dessinée en ORANGE par-dessus le
//               mur, sans le couper : la supprimer laisse le mur intact ;
//   pièces    → zones colorées (l'éditeur affiche leur surface) + nom en texte ;
//   côtés     → cotes, à l'intérieur de la pièce (côtés d'au moins 0,80 m).
//
// Le relevé reste attaché au plan comme RÉFÉRENCE (photos, métrés, points à
// valider, IA, dossier PDF) : modifier le dessin ne change pas ses métrés.
//
// Module PUR : aucun accès réseau, aucune horloge, aucun hasard — les
// identifiants viennent de `nouvelId` fourni par l'appelant.
// Couvert par scripts/verif-releve-imapper.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import { pointDansPoly, cotesPiece, poleInaccessibilite, longueursCotes } from "./releveImapper.mjs";

export const COULEUR_TRAIT = "#e8eaf0";      // blanc de l'éditeur (noir à l'impression)
export const COULEUR_DOUTE = "#f5a623";      // orange de la palette de l'éditeur
export const COTE_MIN_EDITEUR_M = 0.8;
// Couleurs de zone de l'éditeur (palette SURFACE_COLORS de Plans.jsx).
export const COULEUR_ZONE = {
  sejour: "#3b82f6", chambre: "#f97316", cuisine: "#22c55e", salle_de_bain: "#06b6d4",
  salle_d_eau: "#06b6d4", wc: "#06b6d4", entree: "#eab308", degagement: "#94a3b8",
  buanderie: "#a855f7", cellier: "#94a3b8", autre: "#94a3b8",
};

const EPS = 1e-9;
const sous = (a, b) => [a[0] - b[0], a[1] - b[1]];
const croix = (a, b) => a[0] * b[1] - a[1] * b[0];

// Paramètres (sur AB, entre 0 et 1) où AB rencontre le segment CD, y compris
// les extrémités d'un recouvrement colinéaire.
function rencontres(A, B, C, D) {
  const r = sous(B, A), s = sous(D, C), den = croix(r, s), qp = sous(C, A);
  if (Math.abs(den) > EPS) {
    const t = croix(qp, s) / den, u = croix(qp, r) / den;
    return t > EPS && t < 1 - EPS && u > -EPS && u < 1 + EPS ? [t] : [];
  }
  if (Math.abs(croix(qp, r)) > 1e-7) return [];       // parallèles distincts
  const rr = r[0] * r[0] + r[1] * r[1];
  if (rr < EPS) return [];
  return [C, D].map((P) => ((P[0] - A[0]) * r[0] + (P[1] - A[1]) * r[1]) / rr).filter((t) => t > EPS && t < 1 - EPS);
}

const aretes = (P) => P.map((p, k) => [p, P[(k + 1) % P.length]]);

// Bord de (murs \ trous) : chaque arête candidate est découpée à ses
// rencontres avec toutes les autres ; un morceau est gardé quand il sépare
// « dans un mur » de « hors mur ». Les coutures entre deux tronçons de mur
// (mur des deux côtés) et les faces de mur devant une ouverture coupée (hors
// mur des deux côtés) disparaissent d'elles-mêmes.
export function bordDesMurs(murs, trous = []) {
  const dedans = (p) => murs.some((M) => pointDansPoly(p, M)) && !trous.some((T) => pointDansPoly(p, T));
  const toutes = [...murs, ...trous].flatMap(aretes);
  const res = [], vus = new Set();
  const cle = (a, b) => {
    const k = (p) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
    const [x, y] = [k(a), k(b)];
    return x < y ? `${x}|${y}` : `${y}|${x}`;
  };
  for (const [A, B] of toutes) {
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (L < 1e-4) continue;
    const ts = new Set([0, 1]);
    for (const [C, D] of toutes) rencontres(A, B, C, D).forEach((t) => ts.add(t));
    const tri = [...ts].sort((a, b) => a - b);
    const n = [-(B[1] - A[1]) / L, (B[0] - A[0]) / L];
    let debut = null;
    const pousser = (t0, t1) => {
      const a = [A[0] + (B[0] - A[0]) * t0, A[1] + (B[1] - A[1]) * t0];
      const b = [A[0] + (B[0] - A[0]) * t1, A[1] + (B[1] - A[1]) * t1];
      const k = cle(a, b);
      if (!vus.has(k) && Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.002) { vus.add(k); res.push([a, b]); }
    };
    for (let i = 0; i + 1 < tri.length; i++) {
      const [t0, t1] = [tri[i], tri[i + 1]];
      if ((t1 - t0) * L < 0.001) continue;
      const m = [A[0] + (B[0] - A[0]) * (t0 + t1) / 2, A[1] + (B[1] - A[1]) * (t0 + t1) / 2];
      const e = 0.002;
      const bord = dedans([m[0] + n[0] * e, m[1] + n[1] * e]) !== dedans([m[0] - n[0] * e, m[1] - n[1] * e]);
      if (bord) { if (debut === null) debut = t0; } else if (debut !== null) { pousser(debut, t0); debut = null; }
    }
    if (debut !== null) pousser(debut, 1);
  }
  return res;
}

// Géométrie d'une ouverture placée (null si « à placer » ou côté disparu).
function geoOuverture(releve, o) {
  if (o.t0 == null || o.t1 == null || o.masque) return null;
  const piece = (releve.pieces || []).find((p) => p.id === o.piece);
  const c = piece && cotesPiece(piece)[o.mur];
  if (!c) return null;
  const pt = (t) => [c.a[0] + c.u[0] * t, c.a[1] + c.u[1] * t];
  const t0 = Math.max(0, Math.min(c.L, o.t0)), t1 = Math.max(0, Math.min(c.L, o.t1));
  return { p0: pt(t0), p1: pt(t1), u: c.u, n: c.n, e: o.epaisseur || 0.08, w: t1 - t0 };
}

// Trou découpé dans les murs pour une ouverture sûre : du côté pièce (1 cm)
// jusqu'au-delà de l'épaisseur du mur (3 cm), pour traverser le mur entier.
function trouOuverture(g) {
  const dep = (p, d) => [p[0] - g.n[0] * d, p[1] - g.n[1] * d];
  return [dep(g.p0, -0.01), dep(g.p1, -0.01), dep(g.p1, g.e + 0.03), dep(g.p0, g.e + 0.03)];
}

// Traits du symbole d'une ouverture (repère du plan, en m).
export function traitsOuverture(releve, o) {
  const g = geoOuverture(releve, o);
  if (!g) return [];
  const dep = (p, d) => [p[0] - g.n[0] * d, p[1] - g.n[1] * d];   // d > 0 : vers l'extérieur de la pièce
  const t = [];
  const douteuse = o.statut === "a_verifier";
  if (o.type === "fenetre" || o.type === "porte_fenetre") {
    [0, g.e / 2, g.e].forEach((d) => t.push([dep(g.p0, d), dep(g.p1, d)]));
    if (douteuse) { t.push([g.p0, dep(g.p0, g.e)]); t.push([g.p1, dep(g.p1, g.e)]); }
  }
  if (o.type === "baie" && douteuse) {
    // Passage sans porte, non coupé : deux tableaux pour le repérer.
    t.push([g.p0, dep(g.p0, g.e)]); t.push([g.p1, dep(g.p1, g.e)]);
  }
  if (o.type === "porte" || o.type === "placard" || o.type === "porte_fenetre") {
    const interieur = (o.sens?.cote || "interieur") === "interieur";
    const face = (p) => (interieur ? p : dep(p, g.e));
    const charT1 = o.sens?.charniere === "t1";
    const gond = face(charT1 ? g.p1 : g.p0), autre = face(charT1 ? g.p0 : g.p1);
    const d = interieur ? g.n : [-g.n[0], -g.n[1]];
    const bout = [gond[0] + d[0] * g.w, gond[1] + d[1] * g.w];
    t.push([gond, bout]);
    // Arc de débattement : du bout du vantail ouvert à l'autre tableau.
    const a1 = Math.atan2(bout[1] - gond[1], bout[0] - gond[0]), a2 = Math.atan2(autre[1] - gond[1], autre[0] - gond[0]);
    let delta = a2 - a1;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    const N = 12;
    for (let i = 0; i < N; i++) {
      const b0 = a1 + (delta * i) / N, b1 = a1 + (delta * (i + 1)) / N;
      t.push([[gond[0] + g.w * Math.cos(b0), gond[1] + g.w * Math.sin(b0)], [gond[0] + g.w * Math.cos(b1), gond[1] + g.w * Math.sin(b1)]]);
    }
  }
  return t;
}

// Relevé → { segments, symbols, surfaces, cotes, bilan } au format de l'éditeur.
// nouvelId() : identifiant unique (fourni par l'appelant).
export function convertirEnElementsEditeur(releve, { nouvelId, prefixeGroupe = "grp_releve_" } = {}) {
  if (!releve || typeof nouvelId !== "function") return { segments: [], symbols: [], surfaces: [], cotes: [], bilan: null };
  const murs = (releve.murs || []).map((m) => m.polygone || []).filter((P) => P.length >= 3);
  const ouvertures = (releve.ouvertures || []).filter((o) => !o.masque && o.t0 != null && o.t1 != null);
  const sures = ouvertures.filter((o) => o.statut !== "a_verifier");
  const trous = sures.map((o) => geoOuverture(releve, o)).filter(Boolean).map(trouOuverture);

  const segments = bordDesMurs(murs, trous).map(([a, b]) => ({
    x1: a[0], y1: a[1], x2: b[0], y2: b[1], color: COULEUR_TRAIT, layer: "releve", user: true, id: nouvelId(),
  }));
  const symbols = [];
  let nbOuv = 0;
  for (const o of ouvertures) {
    const traits = traitsOuverture(releve, o);
    if (!traits.length && o.type !== "baie") continue;
    nbOuv++;
    const groupId = `${prefixeGroupe}${o.code || o.id}_${nouvelId()}`;
    const color = o.statut === "a_verifier" ? COULEUR_DOUTE : COULEUR_TRAIT;
    traits.forEach(([a, b]) => segments.push({
      x1: a[0], y1: a[1], x2: b[0], y2: b[1], color, layer: "library", user: true, id: nouvelId(), groupId,
    }));
    if (o.type === "placard") {
      const g = geoOuverture(releve, o);
      if (g) symbols.push({ type: "text", text: "placard", size: 0.7, id: nouvelId(),
        x: (g.p0[0] + g.p1[0]) / 2 + g.n[0] * (g.w * 0.5), y: (g.p0[1] + g.p1[1]) / 2 + g.n[1] * (g.w * 0.5) });
    }
  }

  const surfaces = [], cotes = [];
  for (const p of releve.pieces || []) {
    const P = p.polygone || [];
    if (P.length < 3) continue;
    surfaces.push({ id: nouvelId(), points: P.map((q) => ({ x: q[0], y: q[1] })), color: COULEUR_ZONE[p.type] || COULEUR_ZONE.autre, alpha: 0.15 });
    const { point } = poleInaccessibilite(P);
    symbols.push({ type: "text", text: p.nom, x: point[0], y: point[1], id: nouvelId() });
    // Cotes intérieures, comme sur un plan d'architecte : une par direction de
    // mur (la plus longue), soit largeur et profondeur d'une pièce droite, plus
    // les murs en biais — une cote par côté encombrait le plan (72 sur un
    // relevé de 12 pièces). Le côté du texte de cote de l'éditeur est à gauche
    // du sens de tracé (perpendiculaire « angle − 90° ») : on oriente chaque
    // cote pour que son texte tombe DANS la pièce.
    const L = longueursCotes(P);
    const parDirection = [];
    cotesPiece(p).forEach((c, k) => {
      if (L[k] < COTE_MIN_EDITEUR_M) return;
      const ang = ((Math.atan2(c.u[1], c.u[0]) % Math.PI) + Math.PI) % Math.PI;
      const g = parDirection.find((x) => { const d = Math.abs(x.ang - ang); return Math.min(d, Math.PI - d) < (8 * Math.PI) / 180; });
      if (!g) parDirection.push({ ang, c, L: L[k] });
      else if (L[k] > g.L) Object.assign(g, { c, L: L[k] });
    });
    parDirection.forEach(({ c }) => {
      const gauche = [c.u[1], -c.u[0]];
      const versDedans = gauche[0] * c.n[0] + gauche[1] * c.n[1] > 0;
      const [a, b] = versDedans ? [c.a, c.b] : [c.b, c.a];
      cotes.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], id: nouvelId() });
    });
  }
  return {
    segments, symbols, surfaces, cotes,
    bilan: { murs: segments.filter((s) => s.layer === "releve").length, ouvertures: nbOuv, coupees: trous.length, pieces: surfaces.length, cotes: cotes.length },
  };
}
