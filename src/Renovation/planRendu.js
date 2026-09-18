// ─────────────────────────────────────────────────────────────────────────────
// RENDU DE PLAN — moteur partagé, palette « impression » (fond blanc).
// Extrait de PlanViewerOuvrier.jsx pour servir à la fois :
//   • la visionneuse plein écran de l'espace ouvrier (canvas interactif) ;
//   • l'export hors écran en image (renderPlanDataURL) pour les PDF client
//     (dossier de plans d'une opération — bouton du Chemin de fer).
// Le dessin des symboles reste dans planDessin.js (drawLibSym/getBounds/
// calcSurface) : même rendu que l'éditeur bureau. Ne modifier la scène qu'ici.
// ─────────────────────────────────────────────────────────────────────────────
import { getBounds, calcSurface, drawLibSym, pointDansPolygone } from "./planDessin";

// Palette impression (mêmes valeurs que le bloc isPrint du render bureau).
export const PALETTE_IMPRESSION = {
  seg: (col) => {
    if (!col || col === "#7090c0" || col === "#c8d0e0") return "#1a1f2e";
    const r = parseInt(col.slice(1, 3), 16), g = parseInt(col.slice(3, 5), 16), b = parseInt(col.slice(5, 7), 16);
    const lum = (r * 299 + g * 587 + b * 114) / 1000;
    return lum > 180 ? "#1a1f2e" : col;
  },
  cote: "#333333",
  symC: "#1a1f2e",
  symW: "#1a4080",
  symG: "#206040",
  symA: "#204060",
  symT: "#604000",
  txt:  "#1a1f2e",
};
const C = PALETTE_IMPRESSION;

// Lignes des légendes élec/plomberie/chauffage — copie du référentiel bureau
// (rendu tableau des symboles legende_* dans Plans.jsx).
export const LEGENDE_ROWS = {
  elec: [
    { symType: "elec_inter_simple", color: "#FFC200", label: "INT",  name: "Interrupteur simple" },
    { symType: "elec_inter_double", color: "#FFC200", label: "INT×2", name: "Interrupteur double" },
    { symType: "elec_va_vient",     color: "#FFC200", label: "VV",   name: "Va-et-vient" },
    { symType: "elec_minuterie",    color: "#FFC200", label: "MIN",  name: "Minuterie" },
    { symType: "elec_variateur",    color: "#FFC200", label: "VAR",  name: "Variateur" },
    { symType: "elec_prise",        color: "#5b8af5", label: "16A",  name: "Prise 2P+T 16A" },
    { symType: "elec_prise",        color: "#5b8af5", label: "20A",  name: "Prise 20A spécialisée" },
    { symType: "elec_prise_double", color: "#5b8af5", label: "×2",   name: "Prise double 2P+T" },
    { symType: "elec_prise_data",   color: "#40d0e0", label: "RJ45", name: "Prise RJ45" },
    { symType: "elec_prise_data",   color: "#40d0e0", label: "TV",   name: "Prise TV / Antenne" },
    { symType: "elec_luminaire",    color: "#f5d08a", label: "PL",   name: "Plafonnier" },
    { symType: "elec_spot",         color: "#f5d08a", label: "SP",   name: "Spot encastré" },
    { symType: "elec_applique",     color: "#f5d08a", label: "AP",   name: "Applique murale" },
    { symType: "elec_hublot",       color: "#f5d08a", label: "IP",   name: "Hublot IP" },
    { symType: "elec_tableau",      color: "#e05c5c", label: "TBL",  name: "Tableau / TGBT" },
    { symType: "elec_disjoncteur",  color: "#e05c5c", label: "DJ",   name: "Disjoncteur" },
    { symType: "elec_differentiel", color: "#e05c5c", label: "30mA", name: "Différentiel 30mA" },
    { symType: "elec_detecteur",    color: "#e05c5c", label: "FUM",  name: "Détecteur fumée" },
    { symType: "elec_sonnette",     color: "#f5a623", label: "SON",  name: "Sonnette" },
  ],
  plomb: [
    { symType: "plomb_robinet",     color: "#5b8af5", label: "ROB", name: "Robinet" },
    { symType: "plomb_robinet_eq",  color: "#5b8af5", label: "EQ",  name: "Robinet équerre" },
    { symType: "plomb_clapet",      color: "#5b8af5", label: "CAR", name: "Clapet anti-retour" },
    { symType: "plomb_vanne",       color: "#5b8af5", label: "VAN", name: "Vanne papillon" },
    { symType: "plomb_siphon",      color: "#7090c0", label: "SIP", name: "Siphon / Bonde" },
    { symType: "plomb_compteur",    color: "#40d0e0", label: "CPT", name: "Compteur d'eau" },
    { symType: "plomb_chauffe_eau", color: "#f5a623", label: "CE",  name: "Chauffe-eau élec." },
    { symType: "plomb_chaudiere",   color: "#f5a623", label: "CHD", name: "Chaudière" },
    { symType: "plomb_colonne",     color: "#7090c0", label: "EU",  name: "Colonne EU/EV" },
    { symType: "plomb_colonne",     color: "#40d0e0", label: "EP",  name: "Eaux pluviales" },
    { symType: "plomb_regard",      color: "#7090c0", label: "RG",  name: "Regard" },
    { symType: "plomb_pompe",       color: "#50c878", label: "PMP", name: "Pompe / Circulateur" },
    { symType: "plomb_nourrice",    color: "#50c878", label: "NOU", name: "Nourrice" },
    { symType: "plomb_vase",        color: "#50c878", label: "VE",  name: "Vase d'expansion" },
  ],
  chauff: [
    { symType: "rad_elec",   color: "#f5a623", label: "RAD", name: "Radiateur élec. 60cm" },
    { symType: "rad_elec_l", color: "#f5a623", label: "RAD", name: "Radiateur élec. 120cm" },
    { symType: "rad_eau",    color: "#e05c5c", label: "RAD", name: "Radiateur eau ch. 60cm" },
    { symType: "rad_eau_l",  color: "#e05c5c", label: "RAD", name: "Radiateur eau ch. 120cm" },
    { symType: "ss_elec",    color: "#5b8af5", label: "SS",  name: "Sèche-serviettes élec." },
    { symType: "ss_eau",     color: "#e05c5c", label: "SS",  name: "Sèche-serviettes eau ch." },
    { symType: "ss_mixte",   color: "#b060ff", label: "SS",  name: "Sèche-serviettes mixte" },
    { symType: "plomb_chauffe_eau", color: "#f5a623", label: "CE",  name: "Chauffe-eau électrique" },
    { symType: "plomb_chaudiere",   color: "#f5a623", label: "CHD", name: "Chaudière gaz/fioul" },
  ],
};
export const LEGENDE_TITRES = {
  elec: "LÉGENDE ÉLECTRICITÉ", plomb: "LÉGENDE PLOMBERIE",
  chauff: "LÉGENDE CHAUFFAGE", global: "LÉGENDE GÉNÉRALE",
};

// ── Emprise du dessin en mètres (null si plan vide). Le cadre de référence
//    est celui de l'ÉDITEUR bureau (Plans.jsx fitView) : segments + symboles
//    — c'est le dessin lui-même. Les surfaces et cotes n'étendent le cadre que
//    si elles restent PROCHES du dessin (marge de 35 % de son emprise) : un
//    polygone parasite créé par erreur à des centaines de mètres (cas réel :
//    zone « 90 028 m² ») n'écrase plus le cadrage — il sera simplement hors
//    champ. `calerVue` en déduit le viewport qui remplit le canvas. ───────────
export function cadreDessin(d) {
  const segs = (d?.segments || []).filter(s => !s.deleted);
  const syms = (d?.symbols || []).filter(s => !s.deleted);
  const surfPts = (d?.surfaces || []).filter(s => !s.deleted).flatMap(s => s.points || []);
  const cotePts = (d?.cotes || []).filter(c => !c.deleted)
    .flatMap(c => [{ x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }]);

  let minX, maxX, minY, maxY;
  if (segs.length > 0 || syms.length > 0) {
    const b = getBounds(segs, syms);
    ({ minX, maxX, minY, maxY } = b);
    const marge = Math.max(b.w, b.h, 1) * 0.35;
    const dans = (p) => p.x >= b.minX - marge && p.x <= b.maxX + marge &&
                        p.y >= b.minY - marge && p.y <= b.maxY + marge;
    [...surfPts, ...cotePts].filter(dans).forEach(p => {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
  } else {
    // Pas de dessin : cadrer sur ce qui existe (surfaces / cotes seules).
    const pts = [...surfPts, ...cotePts];
    if (pts.length === 0) return null;
    minX = Math.min(...pts.map(p => p.x)); maxX = Math.max(...pts.map(p => p.x));
    minY = Math.min(...pts.map(p => p.y)); maxY = Math.max(...pts.map(p => p.y));
  }
  const w = Math.max(maxX - minX, 0.01), h = Math.max(maxY - minY, 0.01);
  return { minX, maxX, minY, maxY, w, h };
}

// ── Viewport { x, y, scale } pour une ÉCHELLE IMPOSÉE (px logiques par mètre)
//    dans un canvas W×H : le dessin est centré, rien n'est ajusté. Sert à
//    l'export A4 à l'échelle (1:50, 1:100…) où c'est l'échelle qui commande. ──
export function calerVueEchelle(cadre, W, H, scale) {
  if (!cadre || !isFinite(scale) || scale <= 0) return null;
  return {
    scale,
    x: cadre.minX - (W / scale - cadre.w) / 2,
    y: cadre.minY - (H / scale - cadre.h) / 2,
  };
}

export function calerVue(d, W, H) {
  const cadre = cadreDessin(d);
  if (!cadre) return null;
  const scale = Math.min(W / (cadre.w * 1.15), H / (cadre.h * 1.15));
  if (!isFinite(scale) || scale <= 0) return null;
  return calerVueEchelle(cadre, W, H, scale);
}

// ── Dessin de la scène complète (surfaces, segments, cotes, symboles) dans un
//    contexte déjà mis à l'échelle. W/H : taille LOGIQUE du canvas ; vp :
//    viewport { x, y, scale }. Le fond n'est PAS peint ici (à la charge de
//    l'appelant : blanc pour la visionneuse comme pour l'export).
//    opts.calques  : { surfaces, segments, cotes, symbols } — masque une
//                    famille d'objets (repris de l'éditeur bureau) ;
//    opts.coteFont : taille du texte des cotes (12 par défaut, réglable dans
//                    l'éditeur). Le contexte peut être un vrai canvas 2D ou
//    l'enregistreur SVG de planPdf.js (même sous-ensemble d'API). ─────────────
export function dessinerScene(ctx, d, W, H, vp, opts = {}) {
  if (!ctx || !d || !vp) return;
  const CAL = { surfaces: true, segments: true, cotes: true, symbols: true, ...(opts.calques || {}) };
  const coteFont = opts.coteFont || 12;
  const rot = (parseFloat(d.planRotation) || 0) * Math.PI / 180;
  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  const cx0 = W / 2, cy0 = H / 2;
  const toC = (wx, wy) => {
    const sx = (wx - vp.x) * vp.scale;
    const sy = (wy - vp.y) * vp.scale;
    const dx = sx - cx0, dy = sy - cy0;
    return { cx: cx0 + dx * cosR - dy * sinR, cy: cy0 + dx * sinR + dy * cosR };
  };

  // Surfaces (polygones + étiquette d'aire)
  if (CAL.surfaces) (d.surfaces || []).forEach(surf => {
    if (surf.deleted || !Array.isArray(surf.points) || surf.points.length < 3) return;
    const pts = surf.points;
    ctx.save();
    ctx.beginPath();
    const { cx: fx, cy: fy } = toC(pts[0].x, pts[0].y);
    ctx.moveTo(fx, fy);
    for (let i = 1; i < pts.length; i++) { const { cx, cy } = toC(pts[i].x, pts[i].y); ctx.lineTo(cx, cy); }
    ctx.closePath();
    const col = surf.color || "#3b82f6";
    const r = parseInt(col.slice(1, 3), 16) || 59, g = parseInt(col.slice(3, 5), 16) || 130, b = parseInt(col.slice(5, 7), 16) || 246;
    ctx.fillStyle = `rgba(${r},${g},${b},${surf.alpha || 0.15})`;
    ctx.fill();
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    const cx_c = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy_c = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    // Étiquette d'aire : au centre de la zone, SAUF si l'utilisateur a nommé
    // la pièce (symbole texte posé dedans) — elle se range alors juste sous ce
    // nom, comme sur un plan d'architecte : « Cuisine » puis « 8,20 m² ». Les
    // deux libellés visaient sinon le même point et se recouvraient.
    const nom = (d.symbols || [])
      .filter(sy => !sy.deleted && sy.type === "text" && (sy.text || "").trim() && pointDansPolygone(sy.x, sy.y, pts))
      .sort((a, b) => ((a.x - cx_c) ** 2 + (a.y - cy_c) ** 2) - ((b.x - cx_c) ** 2 + (b.y - cy_c) ** 2))[0];
    const ancre = nom ? toC(nom.x, nom.y) : toC(cx_c, cy_c);
    const lx = ancre.cx, ly = ancre.cy + (nom ? 13 * (nom.size || 1) + 8 : 0);
    const area = calcSurface(pts);
    const label = area >= 1 ? `${area.toFixed(2)} m²` : `${(area * 10000).toFixed(0)} cm²`;
    const fontSize = 12;   // ancrée au papier : ne dépend PAS du zoom
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = "rgba(245,245,240,0.9)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(lx - tw / 2, ly - fontSize - 2, tw, fontSize + 8, 4);
    else ctx.rect(lx - tw / 2, ly - fontSize - 2, tw, fontSize + 8);
    ctx.fill();
    ctx.fillStyle = "#333";
    ctx.fillText(label, lx, ly + 2);
  });

  // Segments
  if (CAL.segments) (d.segments || []).forEach(s => {
    if (s.deleted) return;
    const { cx: x1, cy: y1 } = toC(s.x1, s.y1);
    const { cx: x2, cy: y2 } = toC(s.x2, s.y2);
    if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) return;
    ctx.strokeStyle = C.seg(s.color);
    ctx.lineWidth = s.user ? 2 : 1.5;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  });

  // Cotes (ligne décalée, flèches, rappels, étiquette m/cm)
  if (CAL.cotes) (d.cotes || []).forEach(c => {
    if (c.deleted) return;
    const { cx: x1, cy: y1 } = toC(c.x1, c.y1);
    const { cx: x2, cy: y2 } = toC(c.x2, c.y2);
    if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) return;
    const dist = Math.sqrt((c.x2 - c.x1) ** 2 + (c.y2 - c.y1) ** 2);
    // Cote dégénérée (double-clic, point posé deux fois) : elle n'imprime
    // qu'un « 0 cm » et un tas de flèches sur un point. Aucune information,
    // que de l'encombrement — l'éditeur, lui, continue de l'afficher pour
    // qu'elle reste repérable et supprimable.
    if (dist < 0.02) return;
    const label = dist >= 1 ? `${dist.toFixed(2)} m` : `${(dist * 100).toFixed(0)} cm`;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const perp = angle - Math.PI / 2;
    const offset = (c.offset || 0) + 24;
    const ox = Math.cos(perp) * offset, oy = Math.sin(perp) * offset;
    ctx.strokeStyle = C.cote;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x1 + ox, y1 + oy); ctx.lineTo(x2 + ox, y2 + oy); ctx.stroke();
    const aw = 10;
    [0, 1].forEach(end => {
      const [bx, by] = end === 0 ? [x1 + ox, y1 + oy] : [x2 + ox, y2 + oy];
      const dir = end === 0 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(angle) * aw * dir, by + Math.sin(angle) * aw * dir);
      ctx.stroke();
    });
    [[x1, y1], [x2, y2]].forEach(([px, py]) => {
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + ox * 1.2, py + oy * 1.2); ctx.stroke();
    });
    ctx.save();
    ctx.translate(mx + ox, my + oy - 8);
    ctx.rotate(Math.abs(angle) > Math.PI / 2 ? angle + Math.PI : angle);
    const fs = coteFont;
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#f5f5f0";
    const tw = ctx.measureText(label).width + 8;
    if (ctx.roundRect) ctx.roundRect(-tw / 2, -fs - 2, tw, fs + 6, 3); else ctx.rect(-tw / 2, -fs - 2, tw, fs + 6);
    ctx.fill();
    ctx.fillStyle = C.cote;
    ctx.fillText(label, 0, 0);
    ctx.restore();
  });

  // Symboles
  if (CAL.symbols) (d.symbols || []).forEach(sym => {
    if (sym.deleted) return;
    const { cx, cy } = toC(sym.x, sym.y);
    if (!isFinite(cx) || !isFinite(cy)) return;
    const sz = Math.max(12, vp.scale * 0.6) * (sym.size || 1);

    if (sym.libSym) {
      // Légende : tableau complet (même rendu que le bureau en impression)
      if (sym.symType && sym.symType.startsWith("legende_")) {
        const ltype = sym.legendeType || sym.symType.replace("legende_", "");
        const allRows = [...LEGENDE_ROWS.elec, ...LEGENDE_ROWS.plomb, ...LEGENDE_ROWS.chauff];
        const rows = ltype === "global" ? allRows : (LEGENDE_ROWS[ltype] || []);
        const colSym = 34, colLabel = 44, colName = 160;
        const rowH = 22, headerH = 26, padX = 10, padY = 8;
        const totalW = colSym + colLabel + colName + padX * 2;
        const totalH = headerH + rows.length * rowH + padY * 2;
        ctx.save();
        ctx.translate(cx, cy);
        if (sym.angle) ctx.rotate(sym.angle * Math.PI / 180);
        ctx.fillStyle = "rgba(248,248,245,0.97)";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(0, 0, totalW, totalH, 6); else ctx.rect(0, 0, totalW, totalH);
        ctx.fill();
        ctx.strokeStyle = sym.color || "#50c878";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(0, 0, totalW, totalH, 6); else ctx.rect(0, 0, totalW, totalH);
        ctx.stroke();
        ctx.fillStyle = `${sym.color || "#50c878"}22`;
        ctx.fillRect(0, 0, totalW, headerH);
        ctx.fillStyle = "#1a1f2e";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(LEGENDE_TITRES[ltype] || "LÉGENDE", padX, headerH * 0.68);
        ctx.strokeStyle = "#ccc";
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(0, headerH); ctx.lineTo(totalW, headerH); ctx.stroke();
        ctx.fillStyle = "#666";
        ctx.font = "9px sans-serif";
        ctx.fillText("SYM", padX, headerH + padY * 0.8);
        ctx.fillText("CODE", padX + colSym, headerH + padY * 0.8);
        ctx.fillText("DÉSIGNATION", padX + colSym + colLabel, headerH + padY * 0.8);
        ctx.beginPath(); ctx.moveTo(0, headerH + padY + 2); ctx.lineTo(totalW, headerH + padY + 2); ctx.stroke();
        rows.forEach((row, i) => {
          const ry = headerH + padY + 4 + i * rowH;
          if (i % 2 === 0) { ctx.fillStyle = "rgba(0,0,0,0.02)"; ctx.fillRect(0, ry - 2, totalW, rowH); }
          ctx.save();
          ctx.translate(padX + colSym * 0.45, ry + rowH * 0.38);
          drawLibSym(ctx, row.symType, "", row.color, 16, true);
          ctx.restore();
          ctx.fillStyle = "#1a1f2e";
          ctx.font = "bold 9px sans-serif";
          ctx.textAlign = "left";
          ctx.fillText(row.label, padX + colSym, ry + rowH * 0.62);
          ctx.font = "9px sans-serif";
          ctx.fillText(row.name, padX + colSym + colLabel, ry + rowH * 0.62);
          ctx.strokeStyle = "rgba(0,0,0,0.06)";
          ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(0, ry + rowH - 2); ctx.lineTo(totalW, ry + rowH - 2); ctx.stroke();
        });
        ctx.restore();
        return;
      }
      // Symbole bibliothèque standard (taille fixe écran)
      const fixedSz = 22 * (sym.size || 1);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((sym.angle || 0) * Math.PI / 180);
      drawLibSym(ctx, sym.symType, sym.label || "", sym.color || "#e8eaf0", fixedSz, true);
      ctx.restore();
      return;
    }

    // Symboles simples : porte / fenêtre / escalier / WC / texte
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((sym.angle || 0) * Math.PI / 180);
    if (sym.type === "door") {
      ctx.strokeStyle = C.symC; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sz, 0); ctx.lineTo(0, 0); ctx.lineTo(0, sz); ctx.stroke();
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.arc(0, 0, sz, 0, Math.PI / 2); ctx.stroke();
      ctx.setLineDash([]);
    } else if (sym.type === "window") {
      ctx.strokeStyle = C.symW; ctx.lineWidth = 2;
      ctx.strokeRect(-sz / 2, -sz / 4, sz, sz / 2);
      ctx.beginPath(); ctx.moveTo(-sz / 2, 0); ctx.lineTo(sz / 2, 0); ctx.stroke();
    } else if (sym.type === "stair") {
      ctx.strokeStyle = C.symG; ctx.lineWidth = 1.5;
      for (let k = 0; k < 4; k++) ctx.strokeRect(-sz / 2 + k * sz / 4, -sz / 2, sz / 4, sz);
    } else if (sym.type === "wc") {
      ctx.strokeStyle = C.symA; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(0, 0, sz / 2, sz / 3, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // Textes : taille ANCRÉE AU PAPIER (13 px logiques par unité de taille,
    // soit ~3,2 mm sur la planche A4). Elle ne suit plus `sz`, qui vaut
    // 0,60 m de dessin : un libellé ne change donc plus de corps selon le
    // zoom de l'éditeur ni selon l'échelle d'impression — ce qui est placé
    // dans l'éditeur sort à la même taille relative sur la feuille.
    const szTxt = 13 * (sym.size || 1);
    // Fond clair sous le texte : sans lui, un nom de pièce qui croise une
    // cloison, une cote ou une étiquette de surface devient illisible.
    const texteAvecFond = (t, fs, y, couleur) => {
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.textAlign = "center";
      const tw = ctx.measureText(t).width + 8;
      ctx.fillStyle = "rgba(250,250,247,0.88)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-tw / 2, y - fs * 0.82, tw, fs * 1.08, 3);
      else ctx.rect(-tw / 2, y - fs * 0.82, tw, fs * 1.08);
      ctx.fill();
      ctx.fillStyle = couleur;
      ctx.fillText(t, 0, y);
    };
    if (sym.text && sym.type !== "text") texteAvecFond(sym.text, Math.max(9, szTxt * 0.8), sz + 12, C.txt);
    if (sym.type === "text" && (sym.text || "")) texteAvecFond(sym.text, Math.max(10, szTxt), 4, C.symT);
    ctx.restore();
  });
}

// ── Export hors écran : rend le plan cadré dans un canvas de W×H logiques à
//    `dpi`× la résolution (netteté à l'impression) et retourne un PNG en
//    data-URL — "" si le plan est vide. Les tailles de textes/symboles fixes
//    restent proportionnées à W×H, seule la densité de pixels augmente. ───────
export function renderPlanDataURL(d, { largeur = 1000, hauteur = 700, dpi = 2 } = {}) {
  const vp = calerVue(d, largeur, hauteur);
  if (!vp) return "";
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(largeur * dpi);
  canvas.height = Math.round(hauteur * dpi);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpi, 0, 0, dpi, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, largeur, hauteur);
  dessinerScene(ctx, d, largeur, hauteur, vp);
  try { return canvas.toDataURL("image/png"); } catch { return ""; }
}
