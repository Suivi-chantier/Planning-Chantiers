// ─────────────────────────────────────────────────────────────────────────────
// planV2Murs — nouvel éditeur de plans : calcul des MURS à partir des pièces
// d'un relevé iMapper (docs/projets/editeur-plans.md, règle 5 : « mur calculé à
// partir des pièces, partagé entre deux pièces voisines »).
//
// Module PUR : aucun réseau, aucune horloge, aucun effet de bord. Le relevé
// arrive en paramètre et n'est JAMAIS modifié. La géométrie des pièces et les
// mesures d'épaisseur viennent de releveImapper.mjs (cotesPiece, epaisseurMur),
// réutilisées telles quelles. Couvert par scripts/verif-plan-v2-modele.mjs.
//
// PRINCIPE. Chaque côté de pièce est découpé en tronçons ; chaque tronçon est
// la face d'UN mur :
//   • « partage »      — deux faces : le côté d'une pièce et le côté parallèle
//                        en vis-à-vis d'une pièce voisine (ou de la même pièce,
//                        pour un poteau ou un refend entouré). Épaisseur =
//                        distance entre les deux faces (géométrie du relevé).
//   • « limite »       — pas de mur : une autre pièce commence juste derrière
//                        le côté. Deux côtés confondus (séparation virtuelle
//                        d'une pièce ouverte) : deux faces, épaisseur 0. Deux
//                        pièces qui se chevauchent dans le relevé : une face,
//                        épaisseur null, raison « pieces_superposees ».
//   • « peripherique » — une seule face : aucune pièce relevée derrière
//                        (façade, mitoyen, gaine…). Épaisseur mesurée dans les
//                        murs dessinés du relevé (calque A-WALL), sinon null
//                        avec sa raison — jamais une valeur par défaut.
//   • « raccord »      — une seule face, adossée à la matière d'un autre mur
//                        (about d'une cloison perpendiculaire, décrochement) :
//                        pas d'épaisseur propre (null, raison « matiere_continue »).
//
// FORME D'UN MUR
//   { id, type, etat: "existant", corps_etat,
//     nature: null,   // type constructif (cloison 45 / 70, doublage 120 / 160…) :
//                     // le relevé ne le dit pas ; emplacement pour le projet
//     pieces: [idPièce, …],                 // 1 ou 2 identifiants distincts
//     faces: [{ piece, cote, t0, t1, a:[x,y], b:[x,y] }, …],
//         // cote = indice du côté dans le polygone de la pièce ; t0/t1 =
//         // abscisses (m) le long de ce côté ; a/b = extrémités. faces[0] est
//         // la face de référence (celle qui donne l'identifiant).
//     direction: [ux,uy], normale: [nx,ny], // de faces[0] ; normale = vers
//                                           // l'extérieur de sa pièce
//     longueur,                             // de la face de référence (m)
//     epaisseur, epaisseur_min, epaisseur_max,   // m, ou null
//     epaisseur_source: "faces" | "murs_releve" | null,
//     epaisseur_raison: null | "matiere_continue" | "aucun_mur_dessine"
//                     | "releve_sans_murs" | "mesures_discordantes"
//                     | "pieces_superposees",
//     angle_faces_deg,                      // « partage » : défaut de parallélisme
//     plein,                                // part (0–1) de l'entre-deux-faces
//                                           // couverte par les murs dessinés
//     piece_derriere,                       // mur à une face : pièce trouvée
//                                           // juste derrière (faces non
//                                           // parallèles, ou pièces superposées)
//     axe: { a, b } | null,                 // ligne médiane ; null si épaisseur inconnue
//     ouvertures: [idOuverture, …] }        // rempli par planV2Modele
//
// IDENTIFIANT : « mur:‹pièce›:‹côté›:‹rang› » — rang du tronçon le long du côté
// de référence (le plus petit couple pièce / côté des deux faces). Il ne dépend
// ni de l'ordre des pièces dans le relevé ni d'une horloge : même relevé et
// mêmes tolérances → mêmes identifiants.
// ─────────────────────────────────────────────────────────────────────────────
import { cotesPiece, epaisseurMur, pointDansPoly, DETECTION } from "../releveImapper.mjs";

export const ETATS = ["existant", "a_demolir", "a_creer"];
export const TYPES_MUR = ["partage", "limite", "peripherique", "raccord"];
// Corps d'état des murs et des ouvertures : celui de la version « cloisons et
// plâtrerie » du cahier (valeur provisoire, à confirmer avec les versions).
export const CORPS_ETAT_MURS = "cloisons_platrerie";

// Tolérances de rapprochement, toutes réglables (2ᵉ paramètre de calculerMurs).
export const TOLERANCES_MURS = Object.freeze({
  // Deux côtés sont « parallèles » en dessous de cet angle (comme la détection
  // des ouvertures de releveImapper).
  angleMaxDeg: DETECTION.ANGLE_MAX_DEG,
  // Écart entre deux faces : en dessous, les côtés sont confondus (« limite ») ;
  // au-dessus du maximum, ce n'est plus un mur.
  epaisseurMin: 0.02,
  epaisseurMax: DETECTION.EPAISSEUR_MAX_M,
  // Longueur commune minimale pour que deux côtés se fassent face.
  recouvrementMin: 0.03,
  // Un reste de côté plus court est rattaché au tronçon voisin.
  longueurMin: 0.01,
  // Part minimale de matière (murs dessinés du relevé) entre deux faces pour
  // que ce soit UN mur ; en dessous, il y a un vide entre les deux pièces.
  pleinMin: 0.5,
  // Nombre de mesures d'épaisseur le long d'un tronçon à une seule face.
  mesuresParTroncon: 5,
});

const arr = (v) => Math.round(v * 10000) / 10000;       // 0,1 mm, comme le relevé
const pt = (p) => [arr(p[0]), arr(p[1])];
const pointCote = (c, t) => [c.a[0] + c.u[0] * t, c.a[1] + c.u[1] * t];
const abscisse = (c, p) => (p[0] - c.a[0]) * c.u[0] + (p[1] - c.a[1]) * c.u[1];
// Écart entre le point d'abscisse t du côté c et la droite du côté o, compté
// vers l'extérieur de la pièce de o (positif = o est derrière le mur de c).
const ecart = (c, o, t) => {
  const p = pointCote(c, t);
  return -((p[0] - o.a[0]) * o.n[0] + (p[1] - o.a[1]) * o.n[1]);
};
const ordreCotes = (x, y) => (x.piece === y.piece ? x.k - y.k : x.piece < y.piece ? -1 : 1);
const mediane = (v) => { const s = [...v].sort((a, b) => a - b); return s[(s.length - 1) >> 1]; };

// Côtés qui font face à c : presque parallèles, normales opposées, longueur
// commune suffisante. Retourne [{ o, t0, t1 }] (abscisses le long de c).
function candidats(c, cotes, T, cosMax) {
  const res = [];
  for (const o of cotes) {
    if (o === c) continue;
    if (Math.abs(o.u[0] * c.u[0] + o.u[1] * c.u[1]) < cosMax) continue;
    if (o.n[0] * c.n[0] + o.n[1] * c.n[1] >= 0) continue;
    let s0 = abscisse(c, o.a), s1 = abscisse(c, o.b);
    if (s0 > s1) [s0, s1] = [s1, s0];
    const t0 = Math.max(0, s0), t1 = Math.min(c.L, s1);
    if (t1 - t0 >= T.recouvrementMin) res.push({ o, t0, t1 });
  }
  return res;
}

// Découpe le côté c : sur chaque portion, le côté en vis-à-vis le plus proche
// (ou null). Retourne [{ t0, t1, o }] couvrant [0, L].
function segmenter(c, cands, T) {
  const bornes = [...new Set([0, c.L, ...cands.flatMap((k) => [k.t0, k.t1])])].sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i + 1 < bornes.length; i++) {
    const x0 = bornes[i], x1 = bornes[i + 1];
    if (x1 - x0 < 1e-9) continue;
    const m = (x0 + x1) / 2;
    let best = null, bd = Infinity;
    for (const k of cands) {
      if (m < k.t0 || m > k.t1) continue;
      const d = ecart(c, k.o, m);
      if (d < -T.epaisseurMin || d > T.epaisseurMax) continue;
      if (d < bd) { bd = d; best = k.o; }
    }
    const dernier = segs[segs.length - 1];
    if (dernier && dernier.o === best) dernier.t1 = x1; else segs.push({ t0: x0, t1: x1, o: best });
  }
  return segs;
}

// Part de l'entre-deux-faces couverte par les murs dessinés du relevé.
function partPleine(c, t0, t1, o, polysMurs) {
  let dedans = 0, total = 0;
  for (const ft of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const t = t0 + ft * (t1 - t0);
    const p = pointCote(c, t), d = ecart(c, o, t);
    for (const fd of [0.25, 0.5, 0.75]) {
      const q = [p[0] - c.n[0] * d * fd, p[1] - c.n[1] * d * fd];
      total++;
      if (polysMurs.some((P) => pointDansPoly(q, P))) dedans++;
    }
  }
  return dedans / total;
}

// Épaisseur d'un tronçon à une seule face, mesurée dans les murs dessinés du
// relevé (epaisseurMur de releveImapper, sans son minimum de 8 cm : ici une
// absence de mur doit rester une absence).
function mesurerTroncon(c, t0, t1, polysMurs, pieces, T) {
  const vide = { epaisseur: null, epaisseur_min: null, epaisseur_max: null, epaisseur_source: null, piece_derriere: null };
  const n = Math.max(1, T.mesuresParTroncon);
  const positions = Array.from({ length: n }, (_, i) => t0 + ((i + 0.5) / n) * (t1 - t0));
  const pieceEn = (q) => pieces.find((p) => pointDansPoly(q, p.polygone || []));
  // Une pièce commence juste derrière le côté, sans vis-à-vis parallèle : les
  // deux pièces se chevauchent dans le relevé. Pas de mur, et on le dit.
  const collees = positions.map((t) => {
    const p = pointCote(c, t), r = T.epaisseurMin + 0.005;
    return pieceEn([p[0] - c.n[0] * r, p[1] - c.n[1] * r]);
  }).filter(Boolean);
  if (collees.length * 2 > n) {
    return { ...vide, type: "limite", epaisseur_raison: "pieces_superposees", piece_derriere: collees[(collees.length - 1) >> 1].id };
  }
  if (!polysMurs.length) return { ...vide, type: "peripherique", epaisseur_raison: "releve_sans_murs" };
  const D = { ...DETECTION, EPAISSEUR_MIN_M: 0, EPAISSEUR_MAX_M: T.epaisseurMax };
  const mesures = positions.map((t) => epaisseurMur(c, t, polysMurs, D));
  const continues = mesures.filter((e) => e >= T.epaisseurMax - 0.015).length;
  const valides = mesures.filter((e) => e > 0 && e < T.epaisseurMax - 0.015);
  if (valides.length * 2 > n) {
    const e = mediane(valides);
    // Pièce juste derrière le mur (ses faces ne sont pas parallèles, sinon le
    // mur serait « partage »).
    const m = pointCote(c, (t0 + t1) / 2);
    const derriere = pieceEn([m[0] - c.n[0] * (e + 0.05), m[1] - c.n[1] * (e + 0.05)]);
    return {
      type: "peripherique", epaisseur: e, epaisseur_min: Math.min(...valides), epaisseur_max: Math.max(...valides),
      epaisseur_source: "murs_releve", epaisseur_raison: null, piece_derriere: derriere ? derriere.id : null,
    };
  }
  if (continues * 2 > n) return { ...vide, type: "raccord", epaisseur_raison: "matiere_continue" };
  const aucune = mesures.filter((e) => e <= 0).length;
  return { ...vide, type: "peripherique", epaisseur_raison: aucune * 2 > n ? "aucun_mur_dessine" : "mesures_discordantes" };
}

// Mur à deux faces entre le côté c [t0,t1] et le côté o [y0,y1].
function murDeuxFaces(c, t0, t1, o, y0, y1, polysMurs, T) {
  const d = [
    ecart(c, o, t0), ecart(c, o, t1),
    ecart(o, c, y0), ecart(o, c, y1),
  ];
  const moyenne = d.reduce((a, b) => a + b, 0) / d.length;
  const limite = Math.max(...d.map(Math.abs)) < T.epaisseurMin;
  if (!limite && moyenne < T.epaisseurMin) return null;
  const plein = limite || !polysMurs.length ? null : partPleine(c, t0, t1, o, polysMurs);
  const angle = (Math.acos(Math.min(1, Math.abs(c.u[0] * o.u[0] + c.u[1] * o.u[1]))) * 180) / Math.PI;
  return {
    type: limite ? "limite" : "partage",
    refs: [{ c, t0, t1 }, { c: o, t0: y0, t1: y1 }],
    epaisseur: limite ? 0 : moyenne,
    epaisseur_min: limite ? 0 : Math.max(0, Math.min(...d)),
    epaisseur_max: limite ? 0 : Math.max(...d),
    epaisseur_source: "faces", epaisseur_raison: null,
    angle_faces_deg: angle, plein, piece_derriere: null,
  };
}

// releve → { murs, cotes, voisinages_ecartes }.
//   murs  : voir la forme en tête de fichier, triés par identifiant de référence ;
//   cotes : [{ piece, cote, longueur, murs: [idMur…] }] — pour chaque côté de
//           chaque pièce, ses murs dans l'ordre du côté (tout le côté est couvert) ;
//   voisinages_ecartes : paires de côtés en vis-à-vis NON retenues comme un
//           mur, avec leur raison (vide entre les deux pièces).
export function calculerMurs(releve, tolerances = {}) {
  const T = { ...TOLERANCES_MURS, ...tolerances };
  const pieces = releve?.pieces || [];
  const polysMurs = (releve?.murs || []).map((m) => m.polygone || []).filter((P) => P.length >= 3);
  const cotes = pieces.flatMap((p) => cotesPiece(p));
  cotes.forEach((c, i) => { c.i = i; });
  const cosMax = Math.cos((T.angleMaxDeg * Math.PI) / 180);
  const segs = cotes.map((c) => segmenter(c, candidats(c, cotes, T, cosMax), T));

  // 1. Murs à deux faces : c et o se voient mutuellement comme plus proche voisin.
  const bruts = [], ecartes = [];
  const facesPar = cotes.map(() => []);
  for (const c of cotes) {
    for (const s of segs[c.i]) {
      const o = s.o;
      if (!o || o.i < c.i) continue;
      let x0 = abscisse(o, pointCote(c, s.t0)), x1 = abscisse(o, pointCote(c, s.t1));
      if (x0 > x1) [x0, x1] = [x1, x0];
      for (const r of segs[o.i]) {
        if (r.o !== c) continue;
        const y0 = Math.max(x0, r.t0), y1 = Math.min(x1, r.t1);
        if (y1 - y0 < T.recouvrementMin) continue;
        let t0 = abscisse(c, pointCote(o, y0)), t1 = abscisse(c, pointCote(o, y1));
        if (t0 > t1) [t0, t1] = [t1, t0];
        t0 = Math.max(s.t0, t0); t1 = Math.min(s.t1, t1);
        if (t1 - t0 < T.recouvrementMin) continue;
        const m = murDeuxFaces(c, t0, t1, o, y0, y1, polysMurs, T);
        if (!m) continue;
        if (m.plein != null && m.plein < T.pleinMin) {
          ecartes.push({
            cotes: [{ piece: c.piece, cote: c.k }, { piece: o.piece, cote: o.k }],
            raison: "vide_entre_les_faces", ecart: arr(m.epaisseur), plein: arr(m.plein), longueur: arr(t1 - t0),
          });
          continue;
        }
        bruts.push(m);
        m.refs.forEach((f) => facesPar[f.c.i].push(f));
      }
    }
  }

  // 2. Reste de chaque côté : tronçons à une seule face. Un reste plus court
  //    que longueurMin est rattaché au tronçon voisin (rien n'est perdu).
  for (const c of cotes) {
    const F = facesPar[c.i].sort((a, b) => a.t0 - b.t0);
    for (let i = 1; i < F.length; i++) if (F[i].t0 < F[i - 1].t1) F[i].t0 = Math.min(F[i - 1].t1, F[i].t1);
    const trous = [];
    let curseur = 0;
    F.forEach((f, i) => {
      if (f.t0 - curseur >= T.longueurMin) trous.push([curseur, f.t0]);
      else if (f.t0 > curseur) { if (i > 0) F[i - 1].t1 = f.t0; else f.t0 = curseur; }
      curseur = Math.max(curseur, f.t1);
    });
    if (!F.length) trous.push([0, c.L]);
    else if (c.L - curseur >= T.longueurMin) trous.push([curseur, c.L]);
    else F[F.length - 1].t1 = Math.max(F[F.length - 1].t1, c.L);
    for (const [t0, t1] of trous) {
      const f = { c, t0, t1 };
      bruts.push({ ...mesurerTroncon(c, t0, t1, polysMurs, pieces, T), refs: [f], angle_faces_deg: null, plein: null });
      F.push(f);
    }
    F.sort((a, b) => a.t0 - b.t0).forEach((f, rang) => { f.rang = rang; });
  }

  // 3. Mise en forme : face de référence, identifiant, axe, arrondis.
  const murs = bruts.map((m) => {
    const refs = [...m.refs].sort((x, y) => ordreCotes(x.c, y.c));
    const ref = refs[0], c = ref.c;
    const faces = refs.map((f) => ({
      piece: f.c.piece, cote: f.c.k, t0: arr(f.t0), t1: arr(f.t1),
      a: pt(pointCote(f.c, f.t0)), b: pt(pointCote(f.c, f.t1)),
    }));
    const e = m.epaisseur;
    let axe = null;
    if (faces.length === 2) {
      // Les deux faces sont parcourues en sens opposés (ou non) : on apparie
      // chaque extrémité de la face 0 à l'extrémité la plus proche de la face 1.
      const [f0, f1] = faces;
      const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
      const [qa, qb] = d(f0.a, f1.a) + d(f0.b, f1.b) <= d(f0.a, f1.b) + d(f0.b, f1.a) ? [f1.a, f1.b] : [f1.b, f1.a];
      axe = { a: pt([(f0.a[0] + qa[0]) / 2, (f0.a[1] + qa[1]) / 2]), b: pt([(f0.b[0] + qb[0]) / 2, (f0.b[1] + qb[1]) / 2]) };
    } else if (e != null) {
      const dec = (p) => pt([p[0] - c.n[0] * e / 2, p[1] - c.n[1] * e / 2]);
      axe = { a: dec(pointCote(c, ref.t0)), b: dec(pointCote(c, ref.t1)) };
    }
    m.id = `mur:${c.piece}:${c.k}:${ref.rang}`;
    return {
      id: m.id,
      type: m.type, etat: "existant", corps_etat: CORPS_ETAT_MURS, nature: null,
      pieces: [...new Set(faces.map((f) => f.piece))],
      faces,
      direction: [c.u[0], c.u[1]], normale: [-c.n[0], -c.n[1]],
      longueur: arr(ref.t1 - ref.t0),
      epaisseur: e == null ? null : arr(e),
      epaisseur_min: m.epaisseur_min == null ? null : arr(m.epaisseur_min),
      epaisseur_max: m.epaisseur_max == null ? null : arr(m.epaisseur_max),
      epaisseur_source: m.epaisseur_source, epaisseur_raison: m.epaisseur_raison,
      angle_faces_deg: m.angle_faces_deg == null ? null : Math.round(m.angle_faces_deg * 100) / 100,
      plein: m.plein == null ? null : arr(m.plein),
      piece_derriere: m.piece_derriere,
      axe,
      ouvertures: [],
      _ordre: [c.i, ref.rang],
    };
  }).sort((x, y) => x._ordre[0] - y._ordre[0] || x._ordre[1] - y._ordre[1]);
  murs.forEach((m) => { delete m._ordre; });

  // 4. Chaque côté de pièce → ses murs, dans l'ordre du côté.
  const idParFace = new Map();
  bruts.forEach((m) => m.refs.forEach((f) => idParFace.set(f, m.id)));
  const cotesMurs = cotes.map((c) => ({
    piece: c.piece, cote: c.k, longueur: arr(c.L),
    murs: facesPar[c.i].map((f) => idParFace.get(f)),
  }));
  return { murs, cotes: cotesMurs, voisinages_ecartes: ecartes };
}

// Contour d'un mur (polygone à dessiner, m) : les deux faces, ou la face et
// son décalage de l'épaisseur. null quand l'épaisseur est inconnue ou nulle
// (une impossibilité reste visible : pas de contour inventé).
export function contourMur(mur) {
  if (!mur || !(mur.epaisseur > 0)) return null;
  const f0 = mur.faces[0];
  if (mur.faces.length === 2) {
    const f1 = mur.faces[1];
    const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const [qa, qb] = d(f0.a, f1.a) + d(f0.b, f1.b) <= d(f0.a, f1.b) + d(f0.b, f1.a) ? [f1.a, f1.b] : [f1.b, f1.a];
    return [f0.a, f0.b, qb, qa];
  }
  const dec = (p) => pt([p[0] + mur.normale[0] * mur.epaisseur, p[1] + mur.normale[1] * mur.epaisseur]);
  return [f0.a, f0.b, dec(f0.b), dec(f0.a)];
}

// Tronçons d'un côté de pièce : [{ mur, face, t0, t1 }] dans l'ordre du côté
// (face = indice dans mur.faces).
export function tronconsCote(murs, pieceId, cote) {
  const res = [];
  for (const m of murs || []) {
    m.faces.forEach((f, i) => { if (f.piece === pieceId && f.cote === cote) res.push({ mur: m.id, face: i, t0: f.t0, t1: f.t1 }); });
  }
  return res.sort((a, b) => a.t0 - b.t0);
}

// Voisinages entre pièces : [{ pieces: [a, b], murs: [id…], longueur }] — une
// entrée par paire de pièces qui partagent au moins un mur ou une limite.
export function voisinagesPieces(murs) {
  const par = new Map();
  for (const m of murs || []) {
    if (m.pieces.length !== 2) continue;
    const cle = [...m.pieces].sort().join("|");
    const v = par.get(cle) || { pieces: [...m.pieces].sort(), murs: [], longueur: 0 };
    v.murs.push(m.id);
    v.longueur = arr(v.longueur + m.longueur);
    par.set(cle, v);
  }
  return [...par.values()];
}
