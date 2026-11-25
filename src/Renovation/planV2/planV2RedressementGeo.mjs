// ─────────────────────────────────────────────────────────────────────────────
// planV2RedressementGeo — nouvel éditeur de plans : la GÉOMÉTRIE du redressement
// (docs/projets/editeur-plans.md, règle 3). Ce module ne décide rien : il sait
// seulement poser des côtés de pièces sur des droites, puis faire suivre le
// reste du relevé. Les décisions (quoi corriger, dans quelle tolérance) sont
// dans planV2Redressement.mjs.
//
// Module PUR : aucun réseau, aucune horloge, aucun effet de bord. Le relevé
// reçu n'est JAMAIS modifié : chaque fonction renvoie un nouveau relevé (les
// parties inchangées sont partagées, comme le fait traiterPointAValider).
// Couvert par scripts/verif-plan-v2-redressement.mjs.
//
// UNE DROITE est { n: [nx, ny], o } : les points p tels que n·p = o (n unitaire).
//
// CE QUE DEVIENT LE RESTE DU RELEVÉ quand des sommets de pièces bougent
// (deplacerReleve) :
//   • murs dessinés (calque A-WALL, `releve.murs`) : ils SUIVENT. Un sommet de
//     mur posé sur un sommet de pièce (à 1 mm) prend son déplacement ; posé
//     sur un côté de pièce, le déplacement du côté à cet endroit ; ailleurs
//     (face extérieure d'un mur périphérique), le déplacement du sommet
//     accroché le plus proche du même mur. L'épaisseur DESSINÉE est donc
//     conservée telle quelle : rien n'est régularisé ni inventé de ce côté, et
//     planV2Murs y relit les mêmes épaisseurs périphériques qu'avant ;
//   • ouvertures : même identifiant, même côté, même LARGEUR, même position
//     réelle (t0 / t1 recalculés depuis le nouveau départ du côté, puis
//     glissés si besoin pour rester dans le côté). Une ouverture qui couvrait
//     tout son côté le couvre toujours. Une ouverture « pas encore placée »
//     (t0 nul) reste telle quelle ;
//   • points de mesure et scanners : inchangés (ce sont des mesures brutes).
// ─────────────────────────────────────────────────────────────────────────────

// En dessous de cet angle entre deux côtés consécutifs, leur point de
// rencontre ne se calcule plus par intersection (il partirait très loin pour
// un déplacement infime) : le sommet est projeté sur la droite corrigée.
export const ANGLE_QUASI_PARALLELE_DEG = 10;
// Un sommet de mur dessiné est « posé » sur une pièce en dessous de cette distance.
export const RAYON_ANCRAGE_M = 0.001;
// En dessous (m), un point recalculé est considéré inchangé : il garde ses
// coordonnées d'origine au chiffre près (redresser deux fois ne dérive pas).
export const EPSILON_M = 1e-9;

const SIN_QP = Math.sin((ANGLE_QUASI_PARALLELE_DEG * Math.PI) / 180);
const r4 = (v) => Math.round(v * 10000) / 10000;       // 0,1 mm, comme t0 / t1 du relevé
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// Droite portée par le côté k d'un polygone.
export function droiteDeCote(P, k) {
  const a = P[k], b = P[(k + 1) % P.length];
  const L = dist(a, b) || 1e-9;
  const n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
  return { n, o: n[0] * a[0] + n[1] * a[1] };
}
const projeter = (p, D) => {
  const e = D.n[0] * p[0] + D.n[1] * p[1] - D.o;
  return [p[0] - e * D.n[0], p[1] - e * D.n[1]];
};

// Polygone dont certains côtés sont posés sur une nouvelle droite.
// `droites[k]` = droite du côté k, ou null (le côté garde sa droite actuelle).
// Chaque sommet est la rencontre des droites de ses deux côtés ; deux côtés
// dans le prolongement l'un de l'autre : le sommet est projeté sur la droite.
// Le polygone reçu n'est pas modifié ; un sommet qui ne bouge pas garde ses
// coordonnées exactes.
export function reconstruirePolygone(P, droites) {
  const n = P.length;
  if (!droites || !droites.some(Boolean)) return P;
  return P.map((p, k) => {
    const j = (k - 1 + n) % n;
    const A = droites[j], B = droites[k];
    if (!A && !B) return p;
    const DA = A || droiteDeCote(P, j), DB = B || droiteDeCote(P, k);
    const det = DA.n[0] * DB.n[1] - DA.n[1] * DB.n[0];
    let q;
    if (Math.abs(det) >= SIN_QP) {
      q = [(DA.o * DB.n[1] - DB.o * DA.n[1]) / det, (DA.n[0] * DB.o - DB.n[0] * DA.o) / det];
    } else {
      const pts = [A && projeter(p, A), B && projeter(p, B)].filter(Boolean);
      q = pts.length === 2 ? [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2] : pts[0];
    }
    return dist(p, q) < EPSILON_M ? p : [q[0] + 0, q[1] + 0];     // + 0 : jamais de « −0 »
  });
}

// Déplacement de chaque sommet et rotation de chaque côté entre deux versions
// d'un même polygone : { deplacements: [m…], rotations: [°…], longueurs: [m…],
// renverses: [bool…] } (renversé = le côté a changé de sens ou s'est écrasé).
export function mesurerEcart(P, Q) {
  const n = P.length, deplacements = [], rotations = [], longueurs = [], renverses = [];
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    deplacements.push(dist(P[k], Q[k]));
    const u = [P[j][0] - P[k][0], P[j][1] - P[k][1]], w = [Q[j][0] - Q[k][0], Q[j][1] - Q[k][1]];
    const scal = u[0] * w[0] + u[1] * w[1], vect = u[0] * w[1] - u[1] * w[0];
    const L = Math.hypot(u[0], u[1]), Lw = Math.hypot(w[0], w[1]);
    longueurs.push(Lw);
    renverses.push(L > 0 && (scal <= 0 || Lw < 0.25 * L));
    rotations.push(L > 0 && Lw > 0 ? (Math.atan2(Math.abs(vect), scal) * 180) / Math.PI : 0);
  }
  return { deplacements, rotations, longueurs, renverses };
}

// Champ de déplacement défini par les pièces : pour un point posé sur un
// sommet ou sur un côté de pièce, son déplacement ; sinon null.
function champDeplacement(paires) {
  const sommets = [], cotes = [];
  for (const { P, Q } of paires) {
    const d = P.map((p, k) => [Q[k][0] - p[0], Q[k][1] - p[1]]);
    P.forEach((a, k) => {
      const j = (k + 1) % P.length;
      sommets.push({ p: a, d: d[k] });
      cotes.push({ a, b: P[j], da: d[k], db: d[j] });
    });
  }
  return (w) => {
    let best = null, bd = RAYON_ANCRAGE_M;
    for (const s of sommets) { const x = dist(w, s.p); if (x < bd) { bd = x; best = s.d; } }
    if (best) return best;
    for (const c of cotes) {
      const vx = c.b[0] - c.a[0], vy = c.b[1] - c.a[1], L2 = vx * vx + vy * vy;
      if (!L2) continue;
      const t = ((w[0] - c.a[0]) * vx + (w[1] - c.a[1]) * vy) / L2;
      if (t < 0 || t > 1) continue;
      const x = dist(w, [c.a[0] + t * vx, c.a[1] + t * vy]);
      if (x < bd) { bd = x; best = [(1 - t) * c.da[0] + t * c.db[0], (1 - t) * c.da[1] + t * c.db[1]]; }
    }
    return best;
  };
}

// Murs dessinés : chaque sommet suit les pièces (voir l'en-tête).
function suivreMurs(murs, paires) {
  const champ = champDeplacement(paires);
  const polys = murs.map((m) => m.polygone || []);
  const ancres = polys.map((W) => W.map(champ));
  // Sommets libres : un même point (partagé par deux murs dessinés) reçoit un
  // seul déplacement, celui du sommet accroché le plus proche.
  const cle = (w) => `${Math.round(w[0] * 1e4)}:${Math.round(w[1] * 1e4)}`;
  const libres = new Map();
  polys.forEach((W, i) => W.forEach((w, v) => {
    if (ancres[i][v]) return;
    const e = libres.get(cle(w)) || { d: null, x: Infinity };
    W.forEach((q, y) => {
      const d = ancres[i][y];
      if (!d) return;
      const x = dist(w, q);
      if (x < e.x) { e.x = x; e.d = d; }
    });
    libres.set(cle(w), e);
  }));
  return murs.map((m, i) => {
    let change = false;
    const W = polys[i].map((w, v) => {
      const d = ancres[i][v] || libres.get(cle(w)).d;
      if (!d || Math.hypot(d[0], d[1]) < EPSILON_M) return w;
      change = true;
      return [w[0] + d[0], w[1] + d[1]];
    });
    return change ? { ...m, polygone: W } : m;
  });
}

// Ouverture : même côté, même largeur, même position réelle (voir l'en-tête).
function suivreOuverture(o, P, Q) {
  if (o.t0 == null || o.t1 == null || !P[o.mur]) return o;
  const n = P.length, k = o.mur, j = (k + 1) % n;
  if (P[k] === Q[k] && P[j] === Q[j]) return o;
  const L = dist(P[k], P[j]), L2 = dist(Q[k], Q[j]);
  if (!(L > 0) || !(L2 > 0)) return o;
  const lo = Math.min(o.t0, o.t1), hi = Math.max(o.t0, o.t1), largeur = hi - lo;
  let n0, n1;
  if ((lo <= RAYON_ANCRAGE_M && hi >= L - RAYON_ANCRAGE_M) || largeur >= L2) { n0 = 0; n1 = L2; }
  else {
    const u = [(P[j][0] - P[k][0]) / L, (P[j][1] - P[k][1]) / L], u2 = [(Q[j][0] - Q[k][0]) / L2, (Q[j][1] - Q[k][1]) / L2];
    const reel = [P[k][0] + u[0] * lo, P[k][1] + u[1] * lo];
    n0 = Math.max(0, Math.min(L2 - largeur, (reel[0] - Q[k][0]) * u2[0] + (reel[1] - Q[k][1]) * u2[1]));
    n1 = n0 + largeur;
  }
  const [t0, t1] = o.t0 <= o.t1 ? [r4(n0), r4(n1)] : [r4(n1), r4(n0)];
  return t0 === o.t0 && t1 === o.t1 ? o : { ...o, t0, t1 };
}

// Relevé dont certaines pièces reçoivent un nouveau polygone (même nombre de
// sommets). `polygones` : Map ‹idPièce› → polygone. Murs dessinés et
// ouvertures suivent. Rien n'a bougé → le MÊME relevé est renvoyé.
export function deplacerReleve(releve, polygones) {
  const paires = [];                          // toutes les pièces : P avant, Q après
  let change = false;
  const pieces = (releve?.pieces || []).map((p) => {
    const P = p.polygone || [], Q = polygones.get(p.id);
    const immobile = !Q || Q === P || Q.length !== P.length || Q.every((q, k) => q === P[k]);
    paires.push({ id: p.id, P, Q: immobile ? P : Q });
    if (immobile) return p;
    change = true;
    return { ...p, polygone: Q };
  });
  if (!change) return releve;
  paires.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));   // indépendant de l'ordre des pièces
  const parId = new Map(paires.map((x) => [x.id, x]));
  return {
    ...releve,
    pieces,
    // Les pièces immobiles retiennent aussi les murs dessinés posés sur elles.
    murs: Array.isArray(releve.murs) ? suivreMurs(releve.murs, paires) : releve.murs,
    ouvertures: Array.isArray(releve.ouvertures)
      ? releve.ouvertures.map((o) => (parId.has(o.piece) ? suivreOuverture(o, parId.get(o.piece).P, parId.get(o.piece).Q) : o))
      : releve.ouvertures,
  };
}

// Pose les côtés désignés sur leurs droites : `cotes` = [{ piece, cote,
// droite: { n, o } }]. Retourne Map ‹idPièce› → nouveau polygone (seulement
// les pièces touchées). Un côté ou une pièce introuvable est ignoré.
export function poserCotes(releve, cotes) {
  const parPiece = new Map();
  for (const c of cotes || []) {
    const p = (releve?.pieces || []).find((x) => x.id === c.piece);
    if (!p || !c.droite || !(p.polygone || [])[c.cote]) continue;
    if (!parPiece.has(p.id)) parPiece.set(p.id, { P: p.polygone, droites: new Array(p.polygone.length).fill(null) });
    parPiece.get(p.id).droites[c.cote] = c.droite;
  }
  return new Map([...parPiece].map(([id, x]) => [id, reconstruirePolygone(x.P, x.droites)]));
}

// Applique UN point à valider du redressement, sur action de l'utilisateur.
// Pur : renvoie un nouveau relevé. Un point sans correction applicable
// (pièces superposées…) renvoie le relevé tel quel.
export function appliquerPointRedressement(releve, point) {
  if (!releve || !point || !point.applicable || !point.correction) return releve;
  return deplacerReleve(releve, poserCotes(releve, point.correction.cotes));
}
