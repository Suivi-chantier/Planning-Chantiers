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
import { couleurPiece, cotesInterieures, ancrePiece, airePolygone, pointDansPoly } from "./releveImapper.mjs";

export const COULEURS_RELEVE = {
  mur: "#3a4250", murSombre: "#5b6680",
  texte: "#1f2937", cote: "#4b5563", point: "#c2410c", selection: "#d97706",
};

function chemin(ctx, P, toC) {
  ctx.beginPath();
  P.forEach((q, k) => { const [x, y] = toC(q[0], q[1]); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.closePath();
}

// opts : { sombre, points, cotes, pieceSurlignee }
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

  // 5. Cotes intérieures, en cm, le long du côté et à l'intérieur de la pièce.
  //    Tailles de texte ancrées au papier (px logiques), comme le reste du plan.
  if (opts.cotes !== false) {
    pieces.forEach((p) => {
      const ecran = p.polygone.map((q) => toC(q[0], q[1]));
      cotesInterieures(p).forEach((c) => {
        const [ax, ay] = toC(c.a[0], c.a[1]);
        const [bx, by] = toC(c.b[0], c.b[1]);
        const lg = Math.hypot(bx - ax, by - ay);
        if (lg < 18) return;   // côté trop court à cette échelle pour porter un texte
        const ux = (bx - ax) / lg, uy = (by - ay) / lg;
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        let nx = -uy, ny = ux;
        if (!pointDansPoly([mx + nx * 3, my + ny * 3], ecran)) { nx = -nx; ny = -ny; }
        let ang = Math.atan2(uy, ux);
        if (ang > Math.PI / 2) ang -= Math.PI;
        if (ang <= -Math.PI / 2) ang += Math.PI;
        ctx.save();
        ctx.translate(mx + nx * 9, my + ny * 9);
        ctx.rotate(ang);
        ctx.font = "9px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = C.cote;
        ctx.fillText(c.texte, 0, 3);
        ctx.restore();
      });
    });
  }

  // 6. Étiquettes : nom et surface au centre de la pièce.
  pieces.forEach((p) => {
    const [ax, ay] = ancrePiece(p, releve.scanners || {});
    const [x, y] = toC(ax, ay);
    ctx.textAlign = "center";
    ctx.fillStyle = C.texte;
    ctx.font = "bold 12px sans-serif";
    ctx.fillText(p.nom || "", x, y - 2);
    ctx.font = "bold 11px sans-serif";
    ctx.fillText(`${airePolygone(p.polygone).toFixed(2).replace(".", ",")} m²`, x, y + 12);
  });
}
