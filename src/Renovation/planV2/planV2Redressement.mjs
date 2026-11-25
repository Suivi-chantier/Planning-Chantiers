// ─────────────────────────────────────────────────────────────────────────────
// planV2Redressement — nouvel éditeur de plans : REDRESSEMENT d'un relevé
// iMapper (docs/projets/editeur-plans.md, règles 3 et 4 : « l'existant, c'est
// le relevé redressé » ; « tout déplacement au-delà d'une tolérance devient un
// point à valider au lieu d'être appliqué en silence »).
//
// Module PUR : aucun réseau, aucune horloge, aucun effet de bord, aucune IA. Le
// relevé arrive en paramètre et n'est JAMAIS modifié. La géométrie (poser un
// côté sur une droite, faire suivre murs dessinés et ouvertures) est dans
// planV2RedressementGeo.mjs ; ce module DÉCIDE. Couvert par
// scripts/verif-plan-v2-redressement.mjs.
//
// TROIS NATURES DE CORRECTION
//   « angle »      — le logement a une ou plusieurs directions dominantes (celle
//                    que suivent le plus de mètres de murs, à 90° près). Un côté
//                    qui s'en écarte de moins de `anglePropositionMaxDeg` est
//                    « presque droit » : on le tourne pour le mettre d'équerre.
//                    Au-delà, il est franchement en biais : on n'y touche pas.
//                    Les côtés d'une même pièce tournés du même angle forment UN
//                    groupe, tourné d'un bloc autour de son centre : ses
//                    dimensions (longueurs, surface) ne changent pas.
//   « alignement » — deux côtés parallèles, proches, décalés de moins de
//                    `alignementPropositionMax` : mis sur la même droite (le
//                    plus court s'aligne sur le plus long, au prorata).
//   « epaisseur »  — les deux faces en biais d'un même mur partagé, pas tout à
//                    fait parallèles : rendues parallèles (épaisseur constante).
//                    Aucune épaisseur n'est ramenée à une valeur « standard ».
//
// TOLÉRANCE (règle 3). Une correction n'est APPLIQUÉE que si aucun sommet ne
// finit à plus de `deplacementMax` de sa position relevée — toutes corrections
// cumulées — et si aucun côté ne tourne de plus de `angleMaxDeg`. Sinon elle
// devient un POINT À VALIDER : rien n'est déplacé, la correction proposée est
// jointe (appliquerPointRedressement l'applique sur action de l'utilisateur).
// Deux corrections qui tiennent chacune dans la tolérance mais pas ensemble
// deviennent TOUTES LES DEUX des points à valider : le résultat ne dépend pas
// d'un ordre de passage, et redresser un relevé déjà redressé ne change rien.
//
// PRÉCISION. Le relevé redressé garde la pleine précision du calcul (pas
// d'arrondi au dixième de millimètre : un angle droit ne le serait plus). Un
// sommet qui bougerait de moins de EPSILON_M (1e-9 m) garde ses coordonnées
// d'origine : c'est la précision à laquelle une deuxième passe ne change rien.
// Les points à valider d'une deuxième passe sont les mêmes ; leur ampleur
// proposée peut varier de quelques centièmes de millimètre.
//
// CE QUE RENVOIE redresserReleve(releve, { tolerances, tolerancesMurs })
//   { releve,              // relevé redressé, MÊME forme que l'entrée
//     corrections: [{ cle, nature, pieces: [id…], cotes: [{ piece, cote }],
//                     deplacement_m, rotation_deg }],        // appliquées
//     points_a_valider: [{ cle, code, nature, raison, cible, texte,
//                          pieces, cotes: [{ piece, cote }],
//                          deplacement_m, rotation_deg,      // ampleur proposée
//                          applicable,                       // false : à la main
//                          correction: { cotes: [{ piece, cote, droite: { n, o } }] } | null }],
//         // cle / code / cible / texte : même forme que les points à valider
//         // de releveImapper (pointsAValider), qui ne sont pas modifiés.
//         // raison : "rotation" | "deplacement" | "cumul" | "geometrie"
//         //        | "pieces_superposees"
//     directions: [{ angle_deg, longueur_m, part }],          // dominantes
//     tolerances: { … },
//     bilan: { sommets, sommets_deplaces, deplacement_max_m, deplacement_moyen_m,
//              cotes, cotes_tournes, rotation_max_deg,
//              corrections: { angle, alignement, epaisseur },
//              points_a_valider: { angle, alignement, epaisseur, superposition } } }
// ─────────────────────────────────────────────────────────────────────────────
import { cotesPiece } from "../releveImapper.mjs";
import { calculerMurs, TOLERANCES_MURS } from "./planV2Murs.mjs";
import { reconstruirePolygone, mesurerEcart, deplacerReleve, poserCotes, EPSILON_M } from "./planV2RedressementGeo.mjs";

export * from "./planV2RedressementGeo.mjs";

// Version de l'algorithme. À AUGMENTER dès qu'un changement de ce module ou de
// planV2RedressementGeo.mjs peut donner un autre résultat pour un même relevé :
// chaque plan enregistré note la version qui a figé son existant
// (planV2Document.mjs), et scripts/verif-plan-v2-document.mjs échoue si le
// résultat sur le relevé de référence change sans que ce numéro change.
export const VERSION_REDRESSEMENT = 1;

export const NATURES_REDRESSEMENT = ["angle", "alignement", "epaisseur", "superposition"];

export const TOLERANCES_REDRESSEMENT = Object.freeze({
  // Règle 3 du cahier : au-delà, point à valider. Le déplacement est celui de
  // chaque sommet par rapport au relevé, toutes corrections cumulées.
  deplacementMax: 0.01,          // m
  angleMaxDeg: 0.5,              // °
  // Fenêtres de PROPOSITION : au-delà, ce n'est plus « presque », rien n'est
  // proposé. 5° = l'écart déjà retenu pour « parallèles » (planV2Murs).
  anglePropositionMaxDeg: 5,     // ° — au-delà : mur franchement en biais
  alignementPropositionMax: 0.05,// m — décalage entre deux côtés « presque alignés »
  alignementVideMax: 1.0,        // m — vide toléré, le long de la droite, entre deux côtés à aligner
  // Une autre direction que la principale est « dominante » si elle porte au
  // moins cette part de la longueur des côtés (aile de bâtiment en biais).
  partDominanteMin: 0.15,
  // Côtés d'une même pièce tournés du même angle, à cela près : un seul groupe.
  ecartFamilleDeg: 0.1,          // °
  // Le relevé est écrit au dixième de millimètre : la direction d'un côté de
  // longueur L n'est connue qu'à 1,5 × résolution / L près (0,4° pour 2 cm).
  // Ne sert qu'à RANGER un côté très court dans le groupe de sa pièce ; la
  // rotation comparée à `angleMaxDeg` est toujours la rotation brute.
  resolutionReleve: 0.0001,      // m
  // Largeur (°) de la fenêtre qui pèse les côtés autour d'une direction
  // candidate, pour trouver les directions dominantes.
  fenetreDirectionDeg: 0.5,
});

const DEG = 180 / Math.PI;
const arr = (v) => Math.round(v * 1e6) / 1e6;
const fr = (v, d = 1) => v.toFixed(d).replace(".", ",");
const parTexte = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
const scal = (p, q) => p[0] * q[0] + p[1] * q[1];
// Écart d'angle ramené entre −45° et +45° (les directions se comparent à 90° près).
const ecart90 = (a) => { const d = ((a % 90) + 90) % 90; return d >= 45 ? d - 90 : d; };

// Directions dominantes : celle que suivent le plus de mètres de côtés (à 90°
// près, poids dégressif jusqu'à `fenetreDirectionDeg`), puis les suivantes parmi les
// côtés franchement en biais, si elles pèsent assez. Une direction retenue est
// toujours celle d'un côté réel. `cotes` : [{ L, ang }] (ang en degrés).
export function directionsDominantes(cotes, tolerances = {}) {
  const T = { ...TOLERANCES_REDRESSEMENT, ...tolerances };
  const w = Math.max(T.fenetreDirectionDeg, 0.01);
  const total = cotes.reduce((t, c) => t + c.L, 0);
  let restants = cotes.filter((c) => c.L > EPSILON_M).map((c) => ({ L: c.L, a: ((c.ang % 90) + 90) % 90 })).sort((x, y) => x.a - y.a);
  const dirs = [];
  while (restants.length) {
    let best = null;
    for (const c of restants) {
      let score = 0, appui = 0;
      for (const o of restants) {
        const d = Math.abs(ecart90(o.a - c.a));
        if (d < w) { score += o.L * (1 - d / w); appui += o.L; }
      }
      if (!best || score > best.score + 1e-9) best = { angle: c.a, score, appui };
    }
    if (dirs.length && best.appui < T.partDominanteMin * total) break;
    dirs.push({ angle_deg: best.angle, longueur_m: best.appui, part: best.appui / total });
    restants = restants.filter((o) => Math.abs(ecart90(o.a - best.angle)) > T.anglePropositionMaxDeg);
  }
  return dirs;
}

// Un côté reçoit une direction cible `t` (classe = côtés de même direction).
// Par défaut sa droite cible passe par son milieu (rotation autour du milieu :
// c'est ce qui déplace le moins ses deux bouts).
const milieu = (s) => [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
function viser(s, classe, t, delta) {
  s.classe = classe; s.delta = delta;
  s.nC = [-t[1] + 0, t[0] + 0];                  // + 0 : jamais de « −0 »
  s.surAxe = (s.L * Math.abs(delta)) / DEG <= EPSILON_M;
  s.oC = scal(s.nC, milieu(s));
}
// Rotation d'un point de `deg` degrés autour de C.
function tourner(p, C, deg) {
  const a = deg / DEG, co = Math.cos(a), si = Math.sin(a), x = p[0] - C[0], y = p[1] - C[1];
  return [C[0] + x * co - y * si, C[1] + x * si + y * co];
}

// Côtés d'une pièce tournés du même angle (à `ecartFamilleDeg` près) → groupes.
// Les côtés trop courts pour que leur angle soit fiable rejoignent le groupe
// le plus proche, sans relier deux groupes entre eux.
function familles(liste, T) {
  const tri = [...liste].sort((x, y) => x.delta - y.delta || x.k - y.k);
  const groupes = [];
  for (const s of tri.filter((x) => x.bruit <= T.ecartFamilleDeg)) {
    const g = groupes[groupes.length - 1];
    if (g && s.delta - g.max <= T.ecartFamilleDeg) { g.max = s.delta; g.cotes.push(s); }
    else groupes.push({ min: s.delta, max: s.delta, marge: 0, cotes: [s] });
  }
  for (const s of tri.filter((x) => x.bruit > T.ecartFamilleDeg)) {
    let best = null, bd = Infinity;
    for (const g of groupes) {
      const d = Math.max(0, g.min - s.delta, s.delta - g.max) - g.marge;
      if (d < bd) { bd = d; best = g; }
    }
    if (best && bd <= T.ecartFamilleDeg + s.bruit) best.cotes.push(s);
    else groupes.push({ min: s.delta, max: s.delta, marge: s.bruit, cotes: [s] });
  }
  return groupes.map((g) => g.cotes.sort((x, y) => x.k - y.k));
}

// Relevé → pièces (triées par identifiant : le résultat ne dépend pas de leur
// ordre), côtés, directions dominantes, et corrections candidates de nature
// « angle » et « epaisseur » (`unites`).
function contexte(releve, T, TM) {
  const pieces = [...(releve?.pieces || [])].filter((p) => (p.polygone || []).length >= 3)
    .sort((x, y) => parTexte(x.id, y.id))
    .map((p) => ({ id: p.id, nom: p.nom || p.id, P: p.polygone, cotes: cotesPiece(p).map((c) => ({
      piece: p.id, k: c.k, cle: `${p.id}:${c.k}`, a: c.a, b: c.b, u: c.u, L: c.L, nInt: c.n,
      ang: Math.atan2(c.u[1], c.u[0]) * DEG,
      // Incertitude (°) sur la direction du côté, due à la résolution du relevé.
      bruit: T.resolutionReleve > 0 ? Math.min(45, ((1.5 * T.resolutionReleve) / c.L) * DEG) : 0,
      classe: null, unite: null, delta: 0, surAxe: false,
    })) }));
  const cotes = pieces.flatMap((p) => p.cotes);
  const dirs = directionsDominantes(cotes, T).map((d, i) => {
    const t = d.angle_deg / DEG, e = [Math.cos(t), Math.sin(t)];
    return { ...d, i, axes: [e, [-e[1], e[0]]] };
  });
  const unites = [];

  // « angle » : côtés presque d'équerre avec une direction dominante.
  for (const s of cotes) {
    if (s.L <= 1e-6) continue;                 // côté écrasé : pas de direction
    let best = null;
    for (const d of dirs) {
      const dl = ecart90(s.ang - d.angle_deg);
      if (!best || Math.abs(dl) < Math.abs(best.dl)) best = { d, dl };
    }
    if (!best || Math.abs(best.dl) > T.anglePropositionMaxDeg) continue;
    const m = Math.abs(scal(s.u, best.d.axes[0])) >= Math.abs(scal(s.u, best.d.axes[1])) ? 0 : 1;
    s.dir = best.d;
    viser(s, `d${best.d.i}:${m}`, best.d.axes[m], best.dl);
  }
  for (const p of pieces) for (const d of dirs) {
    for (const groupe of familles(p.cotes.filter((s) => s.dir === d && !s.surAxe), T)) {
      // Pivot : centre de l'emprise du groupe, dans le repère de la direction.
      const pts = groupe.flatMap((s) => [s.a, s.b]);
      const mil = (e) => { const v = pts.map((q) => scal(q, e)); return (Math.min(...v) + Math.max(...v)) / 2; };
      const [e0, e1] = d.axes, cx = mil(e0), cy = mil(e1);
      const C = [cx * e0[0] + cy * e1[0], cx * e0[1] + cy * e1[1]];
      // Le groupe tourne D'UN BLOC de son angle moyen autour de ce pivot (ses
      // dimensions sont conservées) ; ce qui reste d'écart sur chaque côté —
      // le bruit du relevé — se corrige autour du milieu du côté.
      const total = groupe.reduce((t, s) => t + s.L, 0), moyen = groupe.reduce((t, s) => t + s.L * s.delta, 0) / total;
      const cle = `angle:${p.id}:${groupe.map((s) => s.k).join(",")}`;
      groupe.forEach((s) => { s.unite = cle; s.oC = scal(s.nC, tourner(milieu(s), C, -moyen)); });
      unites.push({ cle, nature: "angle", pieces: [p.id], cotes: groupe });
    }
  }

  // « epaisseur » : faces en biais d'un même mur (partagé ou limite), reliées
  // de proche en proche, mises à leur direction moyenne.
  const parCle = new Map(cotes.map((s) => [s.cle, s]));
  const parent = new Map();
  const racine = (c) => { while (parent.has(c)) c = parent.get(c); return c; };
  for (const m of calculerMurs(releve, TM).murs) {
    if (m.faces.length !== 2) continue;
    const [x, y] = m.faces.map((f) => parCle.get(`${f.piece}:${f.cote}`));
    if (!x || !y || x === y || x.classe || y.classe) continue;
    const rx = racine(x.cle), ry = racine(y.cle);
    if (rx !== ry) parent.set(rx > ry ? rx : ry, rx > ry ? ry : rx);
    x.lie = y.lie = true;
  }
  const amas = new Map();
  cotes.filter((s) => s.lie).forEach((s) => { const r = racine(s.cle); amas.set(r, [...(amas.get(r) || []), s]); });
  for (const liste of amas.values()) {
    liste.sort((x, y) => parTexte(x.cle, y.cle));
    const ref = liste.reduce((a, b) => (b.L > a.L + 1e-12 ? b : a));
    let sx = 0, sy = 0;
    liste.forEach((s) => { const g = scal(s.u, ref.u) >= 0 ? s.L : -s.L; sx += g * s.u[0]; sy += g * s.u[1]; });
    const N = Math.hypot(sx, sy) || 1, t = [sx / N, sy / N], noms = liste.map((s) => s.cle).join("|");
    liste.forEach((s) => {
      const g = scal(s.u, t) >= 0 ? 1 : -1;
      viser(s, `e:${noms}`, t, Math.atan2(g * (t[0] * s.u[1] - t[1] * s.u[0]), g * scal(t, s.u)) * DEG);
    });
    const groupe = liste.filter((s) => !s.surAxe);
    if (!groupe.length) continue;
    groupe.forEach((s) => { s.unite = `epaisseur:${noms}`; });
    unites.push({ cle: `epaisseur:${noms}`, nature: "epaisseur", pieces: [...new Set(liste.map((s) => s.piece))], cotes: groupe });
  }
  unites.forEach((u) => { u.lignes = u.cotes.map((s) => ({ s, n: s.nC, o: s.oC })); });
  unites.sort((x, y) => parTexte(x.cle, y.cle));
  return { pieces, cotes, dirs, unites, nom: new Map(pieces.map((p) => [p.id, p.nom])) };
}

// Géométrie pour un jeu de corrections actives. Les côtés consécutifs de même
// direction cible forment une CHAÎNE posée sur une seule droite (moyenne de
// leurs droites, au prorata des longueurs). `alignes` : Map ‹chaîne› → position
// imposée par un alignement. Retourne { polys, chaines, chaineDe }.
function assembler(ctx, actifs, alignes = null) {
  const polys = new Map(), chaines = [], chaineDe = new Map();
  for (const p of ctx.pieces) {
    const n = p.cotes.length;
    const vise = p.cotes.map((s) => (s.classe && (!s.unite || actifs.has(s.unite)) ? s : null));
    const droites = new Array(n).fill(null);
    for (let k = 0; k < n; k++) {
      const s = vise[k], prec = vise[(k - 1 + n) % n];
      if (!s || (prec && prec.classe === s.classe)) continue;
      const membres = [s];
      for (let j = (k + 1) % n; j !== k && vise[j] && vise[j].classe === s.classe; j = (j + 1) % n) membres.push(vise[j]);
      const longueur = membres.reduce((t, m) => t + m.L, 0);
      const c = {
        cle: `${p.id}:${k}`, piece: p, classe: s.classe, n: s.nC, membres, longueur,
        o: membres.length === 1 ? s.oC : membres.reduce((t, m) => t + m.L * m.oC, 0) / longueur,
        unites: [...new Set(membres.map((m) => m.unite).filter(Boolean))],
      };
      const o = alignes && alignes.has(c.cle) ? alignes.get(c.cle) : c.o;
      membres.forEach((m) => { droites[m.k] = { n: c.n, o }; chaineDe.set(m.cle, c); });
      chaines.push(c);
    }
    polys.set(p.id, reconstruirePolygone(p.P, droites));
  }
  return { polys, chaines, chaineDe };
}

// Ce qui sort de la tolérance, par rapport au relevé : [{ piece, k, genre,
// cote }] — genre "deplacement" (sommet k), "rotation" ou "geometrie" (côté k).
function ecarts(ctx, polys, T) {
  const E = [];
  for (const p of ctx.pieces) {
    const Q = polys.get(p.id);
    if (Q === p.P) continue;
    const m = mesurerEcart(p.P, Q);
    m.deplacements.forEach((d, k) => { if (d > T.deplacementMax + EPSILON_M) E.push({ piece: p, k, genre: "deplacement", cote: false }); });
    p.cotes.forEach((s, k) => {
      if (m.renverses[k]) E.push({ piece: p, k, genre: "geometrie", cote: true });
      else if (m.rotations[k] > T.angleMaxDeg + 1e-9) E.push({ piece: p, k, genre: "rotation", cote: true });
    });
  }
  return E;
}
const pire = (E) => ["geometrie", "rotation", "deplacement"].find((g) => E.some((e) => e.genre === g));
// Côtés qui se rencontrent au sommet (ou autour du côté) fautif.
const voisins = (e) => {
  const n = e.piece.cotes.length;
  return (e.cote ? [e.k - 1, e.k, e.k + 1] : [e.k - 1, e.k]).map((k) => e.piece.cotes[(k + n) % n]);
};
// Plus grand déplacement et plus grande rotation entre deux géométries.
function ampleur(ctx, polys, ref = null) {
  let deplacement = 0, rotation = 0;
  for (const p of ctx.pieces) {
    const A = ref ? ref.get(p.id) : p.P, B = polys.get(p.id);
    if (A === B) continue;
    const m = mesurerEcart(A, B);
    deplacement = Math.max(deplacement, ...m.deplacements);
    rotation = Math.max(rotation, ...m.rotations);
  }
  return { deplacement, rotation };
}

// Alignements candidats entre chaînes de même direction (voir l'en-tête).
function alignements(ctx, base, T, TM) {
  const parClasse = new Map();
  for (const c of base.chaines) {
    const Q = base.polys.get(c.piece.id), n = Q.length, t = [c.n[1], -c.n[0]];
    const v = c.membres.flatMap((m) => [scal(Q[m.k], t), scal(Q[(m.k + 1) % n], t)]);
    c.s0 = Math.min(...v); c.s1 = Math.max(...v);
    c.dedans = scal(c.membres[0].nInt, c.n) >= 0 ? 1 : -1;
    c.k0 = c.membres[0].k; c.k1 = c.membres[c.membres.length - 1].k;
    parClasse.set(c.classe, [...(parClasse.get(c.classe) || []), c]);
  }
  const unites = [];
  const decoupe = (liste) => {            // amas trop étalé : coupé au plus grand écart
    if (liste.length < 2) return;
    if (liste[liste.length - 1].o - liste[0].o <= T.alignementPropositionMax) {
      if (liste[liste.length - 1].o - liste[0].o <= EPSILON_M) return;
      const total = liste.reduce((t, c) => t + c.longueur, 0);
      const o = liste.reduce((t, c) => t + c.longueur * c.o, 0) / total;
      const cotes = liste.flatMap((c) => c.membres).sort((x, y) => parTexte(x.cle, y.cle));
      unites.push({
        cle: `alignement:${cotes.map((s) => s.cle).join("|")}`, nature: "alignement", o,
        chaines: liste.map((c) => c.cle), pieces: [...new Set(cotes.map((s) => s.piece))], cotes,
        lignes: liste.flatMap((c) => c.membres.map((s) => ({ s, n: c.n, o }))),
      });
      return;
    }
    let i = 1;
    for (let k = 2; k < liste.length; k++) if (liste[k].o - liste[k - 1].o > liste[i].o - liste[i - 1].o + 1e-12) i = k;
    decoupe(liste.slice(0, i)); decoupe(liste.slice(i));
  };
  for (const liste of parClasse.values()) {
    const parent = liste.map((_, i) => i);
    const racine = (i) => { while (parent[i] !== i) i = parent[i]; return i; };
    for (let i = 0; i < liste.length; i++) for (let j = i + 1; j < liste.length; j++) {
      const x = liste[i], y = liste[j];
      if (x.piece === y.piece) {
        const n = x.piece.cotes.length;
        // Même pièce : jamais deux faces opposées, ni deux côtés que sépare un
        // seul petit décrochement (il disparaîtrait : la forme de la pièce changerait).
        if (x.dedans !== y.dedans || (x.k1 + 2) % n === y.k0 || (y.k1 + 2) % n === x.k0) continue;
      }
      const fenetre = x.dedans === y.dedans ? T.alignementPropositionMax : Math.min(T.alignementPropositionMax, TM.epaisseurMin);
      if (Math.abs(x.o - y.o) > fenetre) continue;
      if (Math.max(x.s0, y.s0) - Math.min(x.s1, y.s1) > T.alignementVideMax) continue;
      parent[Math.max(racine(i), racine(j))] = Math.min(racine(i), racine(j));
    }
    const amas = new Map();
    liste.forEach((c, i) => { const r = racine(i); amas.set(r, [...(amas.get(r) || []), c]); });
    for (const a of amas.values()) decoupe(a.sort((x, y) => x.o - y.o || parTexte(x.cle, y.cle)));
  }
  return unites.sort((x, y) => parTexte(x.cle, y.cle));
}

// Choisit les corrections appliquées. Retourne { polys, appliquees, refusees }
// (polys : Map ‹idPièce› → polygone redressé ; refusees : [{ u, raison }]).
function resoudre(ctx, T, TM) {
  const interdits = new Map();
  for (let tour = 0; tour <= ctx.unites.length; tour++) {
    // 1. Angles et épaisseurs : chacune seule, puis toutes ensemble.
    const refus = new Map(interdits);
    for (const u of ctx.unites) {
      if (refus.has(u.cle)) continue;
      const { polys } = assembler(ctx, new Set([u.cle]));
      const E = ecarts(ctx, polys, T);
      if (E.length) refus.set(u.cle, pire(E));
      else Object.assign(u, ampleur(ctx, polys));
    }
    const actifs = new Set(ctx.unites.filter((u) => !refus.has(u.cle)).map((u) => u.cle));
    for (;;) {
      const g = assembler(ctx, actifs);
      const fautifs = new Set();
      ecarts(ctx, g.polys, T).forEach((e) => voisins(e).forEach((s) => (g.chaineDe.get(s.cle)?.unites || []).forEach((c) => fautifs.add(c))));
      if (!fautifs.size) break;
      fautifs.forEach((c) => { actifs.delete(c); refus.set(c, "cumul"); });
    }
    // 2. Alignements, sur la géométrie obtenue.
    const base = assembler(ctx, actifs);
    const candidats = alignements(ctx, base, T, TM);
    const droitesDe = (liste) => new Map(liste.flatMap((b) => b.chaines.map((c) => [c, b.o])));
    for (const b of candidats) {
      const { polys } = assembler(ctx, actifs, droitesDe([b]));
      const E = ecarts(ctx, polys, T).filter((e) => e.genre !== "deplacement");
      Object.assign(b, ampleur(ctx, polys, base.polys));
      if (E.length) refus.set(b.cle, pire(E));
      else if (b.deplacement > T.deplacementMax + EPSILON_M) refus.set(b.cle, "deplacement");
    }
    let alignes = candidats.filter((b) => !refus.has(b.cle));
    let reprise = false, polys = base.polys;
    for (;;) {
      const g = assembler(ctx, actifs, droitesDe(alignes));
      const E = ecarts(ctx, g.polys, T);
      polys = g.polys;
      if (!E.length) break;
      const fautifs = new Set();
      for (const e of E) {
        const cotes = voisins(e);
        alignes.filter((b) => cotes.some((s) => b.chaines.includes(g.chaineDe.get(s.cle)?.cle))).forEach((b) => fautifs.add(b.cle));
        // L'alignement seul tient dans la tolérance : c'est le cumul avec un
        // angle déjà corrigé qui dépasse → les deux deviennent des points à valider.
        const seul = Math.hypot(g.polys.get(e.piece.id)[e.k][0] - base.polys.get(e.piece.id)[e.k][0], g.polys.get(e.piece.id)[e.k][1] - base.polys.get(e.piece.id)[e.k][1]);
        if (e.genre === "deplacement" && seul <= T.deplacementMax + EPSILON_M) {
          cotes.forEach((s) => (g.chaineDe.get(s.cle)?.unites || []).forEach((c) => { interdits.set(c, "cumul"); reprise = true; }));
        }
      }
      if (reprise) break;
      if (!fautifs.size) { alignes = []; continue; }     // sécurité : ne devrait pas arriver
      alignes = alignes.filter((b) => !fautifs.has(b.cle));
      fautifs.forEach((c) => refus.set(c, "cumul"));
    }
    if (reprise) continue;
    if (ecarts(ctx, polys, T).length) break;             // sécurité : ne devrait pas arriver
    const toutes = [...ctx.unites, ...candidats];
    return { polys, appliquees: toutes.filter((u) => !refus.has(u.cle)), refusees: toutes.filter((u) => refus.has(u.cle)).map((u) => ({ u, raison: refus.get(u.cle) })) };
  }
  // Sécurité : aucune combinaison stable trouvée → rien n'est appliqué.
  return { polys: new Map(ctx.pieces.map((p) => [p.id, p.P])), appliquees: [], refusees: ctx.unites.map((u) => ({ u, raison: "cumul" })) };
}

const TEXTE_RAISON = {
  rotation: "rotation au-delà de la tolérance",
  deplacement: "déplacement au-delà de la tolérance",
  cumul: "dépasse la tolérance une fois ajoutée à une autre correction",
  geometrie: "ne peut pas être appliquée sans déformer la pièce : à corriger à la main",
};

// Effet d'une correction posée sur le relevé redressé : plus grand
// déplacement, plus grande rotation, et « casse » si un côté se renverse.
function essayer(redresse, cotes) {
  const r = { deplacement: 0, rotation: 0, casse: false };
  for (const [id, Q] of poserCotes(redresse, cotes)) {
    const m = mesurerEcart(redresse.pieces.find((p) => p.id === id).polygone, Q);
    r.deplacement = Math.max(r.deplacement, ...m.deplacements);
    r.rotation = Math.max(r.rotation, ...m.rotations);
    r.casse = r.casse || m.renverses.some(Boolean);
  }
  return r;
}

// Point à valider d'une correction non appliquée, mesurée sur le relevé
// redressé (c'est ce que ferait appliquerPointRedressement).
function pointAValider({ u, raison }, redresse, ctx, T) {
  const versCotes = (lignes) => lignes.map((l) => ({ piece: l.s.piece, cote: l.s.k, droite: { n: l.n, o: l.o } }));
  let cotes = versCotes(u.lignes), effet = essayer(redresse, cotes);
  // Un côté seul dont la rotation autour du milieu renverse un petit côté
  // voisin : on essaie de le faire tourner autour d'un de ses deux bouts.
  if (effet.casse && u.nature === "angle" && u.cotes.length === 1) {
    for (const pivot of [u.cotes[0].a, u.cotes[0].b]) {
      const autres = versCotes([{ s: u.cotes[0], n: u.cotes[0].nC, o: scal(u.cotes[0].nC, pivot) }]), e = essayer(redresse, autres);
      if (!e.casse) { cotes = autres; effet = e; if (raison === "geometrie") raison = Math.abs(u.cotes[0].delta) > T.angleMaxDeg ? "rotation" : "deplacement"; break; }
    }
  }
  if (effet.casse) raison = "geometrie";
  const noms = u.pieces.map((id) => `« ${ctx.nom.get(id)} »`).join(", ");
  const quoi = {
    angle: `${noms} : ${u.cotes.length} côté${u.cotes.length > 1 ? "s" : ""} presque d'équerre avec le reste du logement, à redresser`,
    epaisseur: `${noms} : les deux faces d'un mur en biais ne sont pas parallèles, à rendre parallèles`,
    alignement: `${noms} : ${u.cotes.length} côtés presque alignés, à mettre sur la même ligne`,
  }[u.nature];
  const mesure = effet.casse ? "" : ` (rotation jusqu'à ${fr(effet.rotation, 2)}°, déplacement jusqu'à ${fr(effet.deplacement * 100)} cm)`;
  return {
    cle: `redressement:${u.cle}`, code: `redressement_${u.nature}`, nature: u.nature, raison,
    cible: { type: "piece", id: u.pieces[0] },
    texte: `${quoi}${mesure} — ${TEXTE_RAISON[raison]}.`,
    pieces: u.pieces, cotes: cotes.map((c) => ({ piece: c.piece, cote: c.cote })),
    // Ampleur de la correction proposée ; null quand elle n'est pas applicable.
    deplacement_m: effet.casse ? null : arr(effet.deplacement), rotation_deg: effet.casse ? null : arr(effet.rotation),
    applicable: !effet.casse, correction: effet.casse ? null : { cotes },
  };
}

// Deux pièces qui se chevauchent dans le relevé : un point à valider par paire,
// sans correction automatique (rien ne dit laquelle des deux a raison).
function pointsSuperposition(redresse, ctx, TM) {
  const paires = new Map();
  for (const m of calculerMurs(redresse, TM).murs) {
    if (m.epaisseur_raison !== "pieces_superposees") continue;
    const ids = [m.faces[0].piece, m.piece_derriere].sort(parTexte), cle = ids.join("|");
    const x = paires.get(cle) || { ids, cotes: [], longueur: 0 };
    x.cotes.push({ piece: m.faces[0].piece, cote: m.faces[0].cote });
    x.longueur += m.longueur;
    paires.set(cle, x);
  }
  return [...paires.values()].sort((x, y) => parTexte(x.ids.join("|"), y.ids.join("|"))).map((x) => ({
    cle: `redressement:superposition:${x.ids.join("|")}`, code: "redressement_superposition", nature: "superposition",
    raison: "pieces_superposees", cible: { type: "piece", id: x.ids[0] },
    texte: `${x.ids.map((id) => `« ${ctx.nom.get(id) ?? id} »`).join(" et ")} se chevauchent dans le relevé (sur ${fr(x.longueur, 2)} m de côté) : à corriger à la main, aucun déplacement n'est proposé.`,
    pieces: x.ids, cotes: x.cotes, deplacement_m: null, rotation_deg: null, applicable: false, correction: null,
  }));
}

// Écart global entre deux relevés de même forme (avant / après redressement).
export function bilanDeplacement(avant, apres) {
  const b = { sommets: 0, sommets_deplaces: 0, deplacement_max_m: 0, deplacement_moyen_m: 0, cotes: 0, cotes_tournes: 0, rotation_max_deg: 0 };
  let somme = 0;
  for (const p of avant?.pieces || []) {
    const q = (apres?.pieces || []).find((x) => x.id === p.id);
    if (!q || (q.polygone || []).length !== (p.polygone || []).length) continue;
    const m = mesurerEcart(p.polygone || [], q.polygone || []);
    b.sommets += m.deplacements.length; b.cotes += m.rotations.length;
    m.deplacements.forEach((d) => { if (d > EPSILON_M) b.sommets_deplaces++; somme += d; b.deplacement_max_m = Math.max(b.deplacement_max_m, d); });
    m.rotations.forEach((r) => { if (r > 1e-7) b.cotes_tournes++; b.rotation_max_deg = Math.max(b.rotation_max_deg, r); });
  }
  b.deplacement_moyen_m = b.sommets ? arr(somme / b.sommets) : 0;
  b.deplacement_max_m = arr(b.deplacement_max_m); b.rotation_max_deg = arr(b.rotation_max_deg);
  return b;
}

// Relevé → relevé redressé, corrections appliquées, points à valider (forme
// en tête de fichier). `tolerances` : surcharge de TOLERANCES_REDRESSEMENT ;
// `tolerancesMurs` : surcharge de TOLERANCES_MURS (reconnaissance des murs).
export function redresserReleve(releve, { tolerances = {}, tolerancesMurs = {} } = {}) {
  const T = { ...TOLERANCES_REDRESSEMENT, ...tolerances }, TM = { ...TOLERANCES_MURS, ...tolerancesMurs };
  const ctx = contexte(releve, T, TM);
  const { polys, appliquees, refusees } = resoudre(ctx, T, TM);
  const redresse = deplacerReleve(releve, polys);
  const corrections = appliquees.map((u) => ({
    cle: `redressement:${u.cle}`, nature: u.nature, pieces: u.pieces,
    cotes: u.cotes.map((s) => ({ piece: s.piece, cote: s.k })),
    deplacement_m: arr(u.deplacement), rotation_deg: arr(u.rotation),
  }));
  const points = [...refusees.map((r) => pointAValider(r, redresse, ctx, T)), ...pointsSuperposition(redresse, ctx, TM)];
  const compte = (liste, natures) => Object.fromEntries(natures.map((n) => [n, liste.filter((x) => x.nature === n).length]));
  return {
    releve: redresse,
    corrections,
    points_a_valider: points,
    directions: ctx.dirs.map((d) => ({ angle_deg: arr(d.angle_deg), longueur_m: arr(d.longueur_m), part: arr(d.part) })),
    tolerances: { ...T },
    bilan: {
      ...bilanDeplacement(releve, redresse),
      corrections: compte(corrections, NATURES_REDRESSEMENT.filter((n) => n !== "superposition")),
      points_a_valider: compte(points, NATURES_REDRESSEMENT),
    },
  };
}
