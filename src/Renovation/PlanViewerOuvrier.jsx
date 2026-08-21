// ─────────────────────────────────────────────────────────────────────────────
// VISIONNEUSE DE PLAN — lecture seule, plein écran, pour l'espace ouvrier.
// Charge le dessin complet à la demande (RPC ouvrier_plan_data) et le rend
// sur canvas avec la palette « impression » de l'éditeur bureau (fond blanc,
// lisible en extérieur). Le dessin des symboles est partagé avec l'éditeur
// via planDessin.js (drawLibSym/getBounds/calcSurface) : même rendu.
// Interactions : 1 doigt = déplacer, pincement = zoom, double-tap = recadrer.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../supabase";
import { Icon } from "../ui";
import { X, Plus, Minus, Maximize2 } from "lucide-react";
import { getBounds, calcSurface, drawLibSym } from "./planDessin";

// Palette impression (mêmes valeurs que le bloc isPrint du render bureau).
const C = {
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

// Lignes des légendes élec/plomberie/chauffage — copie du référentiel bureau
// (rendu tableau des symboles legende_* dans Plans.jsx).
const LEGENDE_ROWS = {
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
const LEGENDE_TITRES = {
  elec: "LÉGENDE ÉLECTRICITÉ", plomb: "LÉGENDE PLOMBERIE",
  chauff: "LÉGENDE CHAUFFAGE", global: "LÉGENDE GÉNÉRALE",
};

export default function PlanViewerOuvrier({ planId, name, onClose }) {
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur]   = useState(false);
  const canvasRef = useRef(null);
  const wrapRef   = useRef(null);
  const dataRef   = useRef(null);                 // plan.data chargé
  const vpRef     = useRef({ x: 0, y: 0, scale: 50 });
  const rafRef    = useRef(0);
  const gestRef   = useRef({ touches: [], lastTap: 0, mouse: null });

  // ── Rendu (palette impression, dérivé du render bureau) ────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current, d = dataRef.current;
    if (!canvas || !d) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    const vp = vpRef.current;
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
    (d.surfaces || []).forEach(surf => {
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
      const { cx: lx, cy: ly } = toC(cx_c, cy_c);
      const area = calcSurface(pts);
      const label = area >= 1 ? `${area.toFixed(2)} m²` : `${(area * 10000).toFixed(0)} cm²`;
      const fontSize = Math.max(10, Math.min(14, vp.scale * 0.4));
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
    (d.segments || []).forEach(s => {
      if (s.deleted) return;
      const { cx: x1, cy: y1 } = toC(s.x1, s.y1);
      const { cx: x2, cy: y2 } = toC(s.x2, s.y2);
      if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) return;
      ctx.strokeStyle = C.seg(s.color);
      ctx.lineWidth = s.user ? 2 : 1.5;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    });

    // Cotes (ligne décalée, flèches, rappels, étiquette m/cm)
    (d.cotes || []).forEach(c => {
      if (c.deleted) return;
      const { cx: x1, cy: y1 } = toC(c.x1, c.y1);
      const { cx: x2, cy: y2 } = toC(c.x2, c.y2);
      if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) return;
      const dist = Math.sqrt((c.x2 - c.x1) ** 2 + (c.y2 - c.y1) ** 2);
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
      const fs = 12;
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
    (d.symbols || []).forEach(sym => {
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
      if (sym.text && sym.type !== "text") {
        ctx.fillStyle = C.txt; ctx.font = `bold ${Math.max(10, sz * 0.5)}px sans-serif`;
        ctx.textAlign = "center"; ctx.fillText(sym.text, 0, sz + 12);
      }
      if (sym.type === "text") {
        ctx.fillStyle = C.symT; ctx.font = `bold ${Math.max(11, sz * 0.6)}px sans-serif`;
        ctx.textAlign = "center"; ctx.fillText(sym.text || "", 0, 4);
      }
      ctx.restore();
    });
  }, []);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; draw(); });
  }, [draw]);

  // Écran → monde (inverse de toC, rotation comprise).
  const toWorld = useCallback((cx, cy) => {
    const canvas = canvasRef.current, d = dataRef.current;
    const vp = vpRef.current;
    const W = canvas?.clientWidth || 1, H = canvas?.clientHeight || 1;
    const rot = ((parseFloat(d?.planRotation) || 0)) * Math.PI / 180;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const cx0 = W / 2, cy0 = H / 2;
    const dx = cx - cx0, dy = cy - cy0;
    const ux = dx * cosR + dy * sinR;
    const uy = -dx * sinR + dy * cosR;
    return { wx: vp.x + (ux + cx0) / vp.scale, wy: vp.y + (uy + cy0) / vp.scale };
  }, []);

  // Cadrage : englobe segments, symboles, surfaces et cotes.
  const fitView = useCallback(() => {
    const canvas = canvasRef.current, d = dataRef.current;
    if (!canvas || !d) return;
    const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1;
    const segs = (d.segments || []).filter(s => !s.deleted);
    const syms = (d.symbols || []).filter(s => !s.deleted);
    const b = getBounds(segs, syms);
    let { minX, maxX, minY, maxY } = b;
    (d.surfaces || []).filter(s => !s.deleted).forEach(s => (s.points || []).forEach(p => {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }));
    (d.cotes || []).filter(c => !c.deleted).forEach(c => {
      minX = Math.min(minX, c.x1, c.x2); maxX = Math.max(maxX, c.x1, c.x2);
      minY = Math.min(minY, c.y1, c.y2); maxY = Math.max(maxY, c.y1, c.y2);
    });
    const w = Math.max(maxX - minX, 0.01), h = Math.max(maxY - minY, 0.01);
    const scale = Math.min(W / (w * 1.15), H / (h * 1.15));
    if (!isFinite(scale) || scale <= 0) return;
    vpRef.current = {
      scale,
      x: minX - (W / scale - w) / 2,
      y: minY - (H / scale - h) / 2,
    };
    scheduleDraw();
  }, [scheduleDraw]);

  const zoomAt = useCallback((cx, cy, ratio) => {
    const vp = vpRef.current;
    const newScale = Math.min(100000, Math.max(0.01, vp.scale * ratio));
    if (newScale === vp.scale) return;
    const { wx, wy } = toWorld(cx, cy);
    const canvas = canvasRef.current, d = dataRef.current;
    const W = canvas?.clientWidth || 1, H = canvas?.clientHeight || 1;
    const rot = ((parseFloat(d?.planRotation) || 0)) * Math.PI / 180;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const cx0 = W / 2, cy0 = H / 2;
    const dx = cx - cx0, dy = cy - cy0;
    const ux = dx * cosR + dy * sinR;
    const uy = -dx * sinR + dy * cosR;
    vpRef.current = { scale: newScale, x: wx - (ux + cx0) / newScale, y: wy - (uy + cy0) / newScale };
    scheduleDraw();
  }, [toWorld, scheduleDraw]);

  const panBy = useCallback((ddx, ddy) => {
    const vp = vpRef.current, d = dataRef.current;
    const rot = ((parseFloat(d?.planRotation) || 0)) * Math.PI / 180;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const ux = ddx * cosR + ddy * sinR;
    const uy = -ddx * sinR + ddy * cosR;
    vpRef.current = { ...vp, x: vp.x - ux / vp.scale, y: vp.y - uy / vp.scale };
    scheduleDraw();
  }, [scheduleDraw]);

  // ── Chargement du plan ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErreur(false);
    supabase.rpc("ouvrier_plan_data", { p_plan_id: planId }).then(({ data, error }) => {
      if (cancelled) return;
      setLoading(false);
      if (error || !data?.data) { console.error("ouvrier_plan_data:", error); setErreur(true); return; }
      dataRef.current = data.data;
      // fitView après le premier layout du canvas
      requestAnimationFrame(() => { fitView(); });
    });
    return () => { cancelled = true; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [planId, fitView]);

  // Redimensionnement (rotation d'écran, clavier…)
  useEffect(() => {
    const onResize = () => scheduleDraw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [scheduleDraw]);

  // ── Gestes tactiles + souris ────────────────────────────────────────────────
  const pos = (t) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  };
  const onTouchStart = (e) => {
    const g = gestRef.current;
    g.touches = [...e.touches].map(pos);
    if (e.touches.length === 1) {
      const now = Date.now();
      if (now - g.lastTap < 300) fitView(); // double-tap = recadrer
      g.lastTap = now;
    }
  };
  const onTouchMove = (e) => {
    e.preventDefault();
    const g = gestRef.current;
    const cur = [...e.touches].map(pos);
    if (cur.length === 1 && g.touches.length === 1) {
      panBy(cur[0].x - g.touches[0].x, cur[0].y - g.touches[0].y);
    } else if (cur.length === 2 && g.touches.length === 2) {
      const d0 = Math.hypot(g.touches[0].x - g.touches[1].x, g.touches[0].y - g.touches[1].y);
      const d1 = Math.hypot(cur[0].x - cur[1].x, cur[0].y - cur[1].y);
      const mid = { x: (cur[0].x + cur[1].x) / 2, y: (cur[0].y + cur[1].y) / 2 };
      const pmid = { x: (g.touches[0].x + g.touches[1].x) / 2, y: (g.touches[0].y + g.touches[1].y) / 2 };
      panBy(mid.x - pmid.x, mid.y - pmid.y);
      if (d0 > 0) zoomAt(mid.x, mid.y, d1 / d0);
    }
    g.touches = cur;
  };
  const onTouchEnd = (e) => { gestRef.current.touches = [...e.touches].map(pos); };
  const onMouseDown = (e) => { gestRef.current.mouse = pos(e); };
  const onMouseMove = (e) => {
    const g = gestRef.current;
    if (!g.mouse) return;
    const p = pos(e);
    panBy(p.x - g.mouse.x, p.y - g.mouse.y);
    g.mouse = p;
  };
  const onMouseUp = () => { gestRef.current.mouse = null; };
  const onWheel = (e) => {
    e.preventDefault();
    const p = pos(e);
    zoomAt(p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  };

  const btnStyle = {
    width: 42, height: 42, borderRadius: 12, border: "none", cursor: "pointer",
    background: "rgba(26,31,46,0.85)", color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
  };

  return (
    <div ref={wrapRef} style={{
      position: "fixed", inset: 0, zIndex: 100, background: "#ffffff",
      display: "flex", flexDirection: "column",
      fontFamily: "'Barlow Condensed','Arial Narrow',sans-serif",
    }}>
      {/* Barre de titre */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
        background: "#1a1f2e", color: "#fff", flexShrink: 0,
        paddingTop: "calc(10px + env(safe-area-inset-top))",
      }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {name || "Plan"}
        </div>
        <button onClick={onClose} style={{
          display: "inline-flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer",
          background: "rgba(255,255,255,0.14)", color: "#fff", borderRadius: 10,
          padding: "8px 13px", fontFamily: "inherit", fontSize: 13.5, fontWeight: 700,
        }}>
          <Icon as={X} size={15}/> Fermer
        </button>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#8a9ab0", fontSize: 13, letterSpacing: 2 }}>
            CHARGEMENT DU PLAN…
          </div>
        )}
        {erreur && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#8a9ab0", fontSize: 14, padding: 24, textAlign: "center" }}>
            Impossible de charger ce plan. Réessaie plus tard.
          </div>
        )}
        <canvas
          ref={canvasRef}
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
          onWheel={onWheel}
          style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: "grab" }}
        />
        {/* Contrôles zoom */}
        {!loading && !erreur && (
          <div style={{
            position: "absolute", right: 12, bottom: "calc(14px + env(safe-area-inset-bottom))",
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            <button style={btnStyle} onClick={() => { const c = canvasRef.current; zoomAt(c.clientWidth / 2, c.clientHeight / 2, 1.3); }}>
              <Icon as={Plus} size={19}/>
            </button>
            <button style={btnStyle} onClick={() => { const c = canvasRef.current; zoomAt(c.clientWidth / 2, c.clientHeight / 2, 1 / 1.3); }}>
              <Icon as={Minus} size={19}/>
            </button>
            <button style={btnStyle} onClick={fitView}>
              <Icon as={Maximize2} size={17}/>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
