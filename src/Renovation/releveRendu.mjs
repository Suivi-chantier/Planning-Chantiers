// ─────────────────────────────────────────────────────────────────────────────
// releveRendu — dessin de la couche `releve` d'un plan (relevé iMapper) :
// sols des pièces, murs, points bruts (en option), cotes intérieures,
// étiquettes nom + surface. Rendu de référence : page 1 du PDF prototype
// « plan de l'existant » du 15/10/2026.
//
// Appelé par planRendu.dessinerScene (visionneuse ouvrier, export PDF
// vectoriel) ET par l'éditeur bureau : un seul dessin partout. Le dessin est
// recalculé à chaque affichage à partir de `releve` — rien n'est stocké en
// segments.
//
// Module sans effet de bord hors du contexte reçu (canvas 2D ou enregistreur
// SVG de planPdf.js : on n'utilise que le sous-ensemble commun de l'API).
// toC(x, y) → [px, py] : passage du repère plan (m) au repère écran.
// Couvert par scripts/verif-releve-imapper.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import {
  couleurPiece, cotesInterieures, poleInaccessibilite, airePolygone, pointDansPoly, geometrieOuverture,
} from "./releveImapper.mjs";

export const COULEURS_RELEVE = {
  mur: "#3a4250", murSombre: "#5b6680",
  texte: "#1f2937", cote: "#4b5563", point: "#c2410c", selection: "#d97706",
  fondEtiquette: "rgba(255,255,255,0.92)",
  ouverture: "#111827", aVerifier: "#ea580c", trou: "#ffffff",
};

// Pôle d'une pièce, calculé une fois par polygone (le dessin est rejoué à
// chaque mouvement de souris dans l'éditeur).
const cachePoles = new WeakMap();
function pole(P) {
  if (!cachePoles.has(P)) cachePoles.set(P, poleInaccessibilite(P));
  return cachePoles.get(P);
}

function chemin(ctx, P, toC) {
  ctx.beginPath();
  P.forEach((q, k) => { const [x, y] = toC(q[0], q[1]); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.closePath();
}

// opts : { sombre, points, cotes, pieceSurlignee, ouvertureSelectionnee, murSurligne:{piece, mur} }
export function dessinerReleve(ctx, releve, toC, opts = {}) {
  if (!ctx || !releve) return;
  const C = COULEURS_RELEVE;
  const pieces = (releve.pieces || []).filter((p) => (p.polygone || []).length >= 3);

  // 1. Sols : couleur pastel du type de pièce.
  pieces.forEach((p) => {
    chemin(ctx, p.polygone, toC);
    ctx.fillStyle = couleurPiece(p.type);
    ctx.fill();
  });

  // 2. Murs : polygones A-WALL en gris anthracite (le contour comble les
  //    joints d'un pixel entre deux tronçons voisins).
  const couleurMur = opts.sombre ? C.murSombre : C.mur;
  (releve.murs || []).forEach((m) => {
    if ((m.polygone || []).length < 3) return;
    chemin(ctx, m.polygone, toC);
    ctx.fillStyle = couleurMur;
    ctx.fill();
    ctx.strokeStyle = couleurMur;
    ctx.lineWidth = 0.6;
    ctx.stroke();
  });

  // 3. Points bruts du scan (calque « points de relevé », masqué par défaut) :
  //    le moyen de contrôler une ouverture douteuse.
  if (opts.points) {
    ctx.fillStyle = C.point;
    Object.values(releve.points || {}).forEach((liste) => liste.forEach((q) => {
      const [x, y] = toC(q[0], q[1]);
      ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
    }));
  }

  // 4. Pièce surlignée (sélection dans l'éditeur).
  if (opts.pieceSurlignee) {
    const p = pieces.find((x) => x.id === opts.pieceSurlignee);
    if (p) {
      chemin(ctx, p.polygone, toC);
      ctx.strokeStyle = C.selection;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

  // 4 bis. Mur surligné (photo affichée dans le panneau de la pièce).
  if (opts.murSurligne) {
    const p = pieces.find((x) => x.id === opts.murSurligne.piece);
    const k = opts.murSurligne.mur;
    if (p && k != null && p.polygone[k]) {
      const a = toC(...p.polygone[k]), b = toC(...p.polygone[(k + 1) % p.polygone.length]);
      ctx.strokeStyle = C.selection;
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }

  // 4 ter. Ouvertures (portes, fenêtres, baies, placards) et leurs pastilles.
  const pastilles = dessinerOuvertures(ctx, releve, toC, opts);

  // 5. Mise en page des étiquettes AVANT les cotes (voir miseEnPageEtiquettes).
  const ecrans = new Map(pieces.map((p) => [p.id, p.polygone.map((q) => toC(q[0], q[1]))]));
  const mesurer = (t, fs) => { ctx.font = `bold ${fs}px sans-serif`; return ctx.measureText(t).width; };
  const etiquettes = miseEnPageEtiquettes(pieces, toC, mesurer);
  const boites = [...etiquettes.map((e) => e.boite), ...pastilles];   // zones déjà occupées par du texte
  const croise = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

  // 6. Cotes intérieures, en cm, le long du côté et à l'intérieur de la pièce.
  //    Tailles de texte ancrées au papier (px logiques), comme le reste du plan.
  //    Une cote qui chevaucherait une étiquette ou une autre cote, ou qui ne
  //    tient pas sur son côté à cette échelle, n'est pas dessinée.
  if (opts.cotes !== false) {
    ctx.font = "9px sans-serif";
    pieces.forEach((p) => {
      const ecran = ecrans.get(p.id);
      cotesInterieures(p).forEach((c) => {
        const [ax, ay] = toC(c.a[0], c.a[1]);
        const [bx, by] = toC(c.b[0], c.b[1]);
        const lg = Math.hypot(bx - ax, by - ay);
        const tw = ctx.measureText(c.texte).width;
        if (lg < tw + 8) return;
        const ux = (bx - ax) / lg, uy = (by - ay) / lg;
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        let nx = -uy, ny = ux;
        if (!pointDansPoly([mx + nx * 3, my + ny * 3], ecran)) { nx = -nx; ny = -ny; }
        const cx = mx + nx * 9, cy = my + ny * 9;
        // Encombrement du texte tourné : boîte englobante.
        const hx = Math.abs(ux) * tw / 2 + Math.abs(nx) * 5, hy = Math.abs(uy) * tw / 2 + Math.abs(ny) * 5;
        const b = { x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy };
        if (boites.some((o) => croise(b, o))) return;
        boites.push(b);
        let ang = Math.atan2(uy, ux);
        if (ang > Math.PI / 2) ang -= Math.PI;
        if (ang <= -Math.PI / 2) ang += Math.PI;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang);
        ctx.font = "9px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = C.cote;
        ctx.fillText(c.texte, 0, 3);
        ctx.restore();
      });
    });
  }

  // 7. Étiquettes : nom et surface (tournées d'un quart de tour dans une
  //    pièce étroite et haute).
  //    Une étiquette qui déborde de sa pièce (vue éloignée, pièce minuscule)
  //    passe sur un mur ou une pièce voisine : un fond clair la garde lisible
  //    (texte foncé sur mur anthracite = invisible, cas réel du 15/10).
  etiquettes.filter((e) => !e.tient).forEach((e) => {
    const b = e.boite;
    ctx.fillStyle = C.fondEtiquette;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(b.x0 - 2, b.y0 - 1, b.x1 - b.x0 + 4, b.y1 - b.y0 + 2, 3);
    else ctx.rect(b.x0 - 2, b.y0 - 1, b.x1 - b.x0 + 4, b.y1 - b.y0 + 2);
    ctx.fill();
  });
  ctx.textAlign = "center";
  ctx.fillStyle = C.texte;
  etiquettes.forEach((e) => e.lignes.forEach(([t, fs, dy]) => {
    ctx.font = `bold ${fs}px sans-serif`;
    if (!e.vertical) { ctx.fillText(t, e.x, e.y + dy); return; }
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(t, 0, dy);
    ctx.restore();
  }));
}

// ── Mise en page des étiquettes (nom + surface), en repère écran ──────────
// Chaque étiquette se place au point de la pièce le plus éloigné des murs et
// rétrécit (12 px → 8 px) jusqu'à tenir DANS la pièce, à l'horizontale, ou
// tournée d'un quart de tour si la pièce est étroite et haute. Si rien ne
// tient, une seule ligne en 8 px (« Chambre 3 · 2,13 m² »), dans le sens le
// plus long de la pièce : `tient` vaut alors false.
// mesurer(texte, taillePx) → largeur en px. Retourne une entrée par pièce :
// { id, x, y, vertical, lignes:[[texte, taille, décalage y]], boite, tient }.
export function miseEnPageEtiquettes(pieces, toC, mesurer) {
  const liste = pieces.map((p) => {
    const ecran = p.polygone.map((q) => toC(q[0], q[1]));
    const { point } = pole(p.polygone);
    const [x, y] = toC(point[0], point[1]);
    const surface = `${airePolygone(p.polygone).toFixed(2).replace(".", ",")} m²`;
    const nom = p.nom || "";
    // Boîte relative à l'ancre (dx0, dx1, dy0, dy1) → boîte écran, tournée ou non.
    const boite = (r, vertical) => (vertical
      ? { x0: x + r.dy0, x1: x + r.dy1, y0: y - r.dx1, y1: y - r.dx0 }
      : { x0: x + r.dx0, x1: x + r.dx1, y0: y + r.dy0, y1: y + r.dy1 });
    const tient = (b) => [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1],
      [(b.x0 + b.x1) / 2, b.y0], [(b.x0 + b.x1) / 2, b.y1], [b.x0, (b.y0 + b.y1) / 2], [b.x1, (b.y0 + b.y1) / 2]]
      .every((q) => pointDansPoly(q, ecran));
    for (let k = 1; k >= 0.6; k -= 0.05) {
      const fn = Math.max(8, 12 * k), fa = Math.max(8, 11 * k);
      const w = Math.max(mesurer(nom, fn), mesurer(surface, fa)) + 4;
      const r = { dx0: -w / 2, dx1: w / 2, dy0: -fn - 2, dy1: fa + 3 };
      for (const vertical of [false, true]) {
        const b = boite(r, vertical);
        if (tient(b)) return { id: p.id, x, y, vertical, lignes: [[nom, fn, -2], [surface, fa, fa + 1]], boite: b, tient: true };
      }
    }
    const t = `${nom} · ${surface}`, fs = 8;
    const w = mesurer(t, fs) + 4;
    const xs = ecran.map((q) => q[0]), ys = ecran.map((q) => q[1]);
    const vertical = Math.max(...ys) - Math.min(...ys) > Math.max(...xs) - Math.min(...xs);
    const r = { dx0: -w / 2, dx1: w / 2, dy0: -fs + 1, dy1: 5 };
    return { id: p.id, x, y, vertical, lignes: [[t, fs, 3]], boite: boite(r, vertical), tient: false };
  });
  // Dernier recours : une étiquette qui ne tient pas dans sa pièce déborde ;
  // on la décale (perpendiculairement au texte) jusqu'à une place où elle ne
  // recouvre aucune autre étiquette.
  const croise = (u, v) => u.x0 < v.x1 && v.x0 < u.x1 && u.y0 < v.y1 && v.y0 < u.y1;
  liste.filter((e) => !e.tient).forEach((e) => {
    const autres = liste.filter((o) => o !== e).map((o) => o.boite);
    // Positions candidates, des plus proches aux plus lointaines : pas de la
    // hauteur du texte en travers, de sa demi-longueur en long.
    const larg = e.boite.x1 - e.boite.x0, haut = e.boite.y1 - e.boite.y0;
    const candidats = [];
    for (let i = -6; i <= 6; i++) for (let j = -3; j <= 3; j++) {
      const dx = i * (e.vertical ? larg + 2 : larg / 2), dy = j * (e.vertical ? haut / 2 : haut + 2);
      candidats.push([dx, dy]);
    }
    candidats.sort((u, v) => Math.hypot(u[0], u[1]) - Math.hypot(v[0], v[1]));
    for (const [dx, dy] of candidats) {
      const b = { x0: e.boite.x0 + dx, x1: e.boite.x1 + dx, y0: e.boite.y0 + dy, y1: e.boite.y1 + dy };
      if (!autres.some((o) => croise(b, o))) { e.x += dx; e.y += dy; e.boite = b; break; }
    }
  });
  return liste;
}

// ── Ouvertures ─────────────────────────────────────────────────────────────
// Pour chaque ouverture non masquée : la zone de mur est effacée (rectangle
// dans l'épaisseur du mur), puis le symbole est tracé, à la largeur réelle :
//   porte / placard : vantail + arc de débattement (charnière, côté) ;
//   fenêtre : trois traits parallèles dans l'épaisseur du mur ;
//   porte-fenêtre : traits de fenêtre + vantail ; baie : pointillés.
// Noir pour « détectée », « confirmée sur photo » et « validée » ; orange et
// pointillé pour « à vérifier ». Code (P1, F1…) dans une pastille côté pièce.
// Retourne les boîtes écran des pastilles (pour que les cotes les évitent).
export function dessinerOuvertures(ctx, releve, toC, opts = {}) {
  const C = COULEURS_RELEVE;
  const boites = [];
  for (const o of releve?.ouvertures || []) {
    if (o.masque) continue;
    const g = geometrieOuverture(releve, o);
    if (!g || g.largeur <= 0) continue;
    const e = g.epaisseur;
    const ext = (p, d) => [p[0] - g.n[0] * d, p[1] - g.n[1] * d];   // vers l'extérieur de la pièce
    const S = (p) => toC(p[0], p[1]);
    const [a, b, a2, b2] = [S(g.p0), S(g.p1), S(ext(g.p0, e)), S(ext(g.p1, e))];
    const douteux = o.statut === "a_verifier";
    const sel = opts.ouvertureSelectionnee === o.id;
    const col = sel ? C.selection : douteux ? C.aVerifier : C.ouverture;

    // Zone de mur effacée.
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(b2[0], b2[1]); ctx.lineTo(a2[0], a2[1]);
    ctx.closePath();
    ctx.fillStyle = C.trou;
    ctx.fill();

    ctx.strokeStyle = col;
    ctx.lineWidth = sel ? 2.2 : 1.2;
    ctx.setLineDash(douteux ? [4, 3] : []);
    const trait = (p, q) => { ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); };
    // Tableaux (bords du trou dans le mur).
    trait(a, a2); trait(b, b2);

    if (o.type === "fenetre" || o.type === "porte_fenetre") {
      [0, e / 2, e].forEach((d) => trait(S(ext(g.p0, d)), S(ext(g.p1, d))));
    }
    if (o.type === "baie") {
      ctx.setLineDash([3, 3]);
      trait(a, b); trait(a2, b2);
    }
    if (o.type === "porte" || o.type === "placard" || o.type === "porte_fenetre") {
      const versInterieur = (o.sens?.cote || "interieur") === "interieur";
      // Le vantail tourne sur la face du mur du côté où il s'ouvre.
      const face = (p) => (versInterieur ? p : ext(p, e));
      const charT1 = o.sens?.charniere === "t1";
      const gond = face(charT1 ? g.p1 : g.p0), autre = face(charT1 ? g.p0 : g.p1);
      const d = versInterieur ? g.n : [-g.n[0], -g.n[1]];
      const bout = [gond[0] + d[0] * g.largeur, gond[1] + d[1] * g.largeur];
      const [G, B, A] = [S(gond), S(bout), S(autre)];
      trait(G, B);
      const r = Math.hypot(B[0] - G[0], B[1] - G[1]);
      const a1 = Math.atan2(B[1] - G[1], B[0] - G[0]), a2b = Math.atan2(A[1] - G[1], A[0] - G[0]);
      let delta = a2b - a1;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta <= -Math.PI) delta += 2 * Math.PI;
      ctx.setLineDash(douteux ? [4, 3] : [3, 2]);
      ctx.lineWidth = sel ? 1.6 : 0.8;
      ctx.beginPath();
      ctx.arc(G[0], G[1], r, a1, a1 + delta, delta < 0);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Pastille du code, côté pièce, au milieu de l'ouverture.
    const m = S([(g.p0[0] + g.p1[0]) / 2 + g.n[0] * 0.01, (g.p0[1] + g.p1[1]) / 2 + g.n[1] * 0.01]);
    const m0 = S([(g.p0[0] + g.p1[0]) / 2, (g.p0[1] + g.p1[1]) / 2]);
    const nx = m[0] - m0[0], ny = m[1] - m0[1], nl = Math.hypot(nx, ny) || 1;
    const cx = m0[0] + (nx / nl) * 13, cy = m0[1] + (ny / nl) * 13;
    const texte = o.code || "?";
    ctx.font = "bold 9px sans-serif";
    const tw = ctx.measureText(texte).width + 6;
    const bt = { x0: cx - tw / 2, x1: cx + tw / 2, y0: cy - 7, y1: cy + 6 };
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bt.x0, bt.y0, tw, 13, 3); else ctx.rect(bt.x0, bt.y0, tw, 13);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.setLineDash(douteux ? [2, 2] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = col;
    ctx.textAlign = "center";
    ctx.fillText(texte, cx, cy + 3);
    boites.push(bt);
  }
  return boites;
}
