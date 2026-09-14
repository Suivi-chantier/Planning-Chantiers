// ─────────────────────────────────────────────────────────────────────────────
// STYLUS CANVAS — dessin à main levée au stylet (tablette), au doigt ou à la
// souris. Sert aux notes manuscrites et aux croquis du Chiffrage.
//
// Modèle : les tracés (« strokes ») sont stockés en COORDONNÉES LOGIQUES dans
// un repère fixe largeur × hauteur (ex : 1000 × 1400 pour une page portrait),
// indépendant de la taille d'affichage. Un stroke :
//   { id, color, width, alpha, points: [[x, y, p], …] }   p = pression 0..1
// Le rendu (écran, vignette, PDF) passe par la même fonction dessinerStrokes,
// donc ce qu'on voit à l'écran est exactement ce qui sort dans le document.
//
// Entrées tactiles : Pointer Events. En mode « stylet seul » (défaut sur les
// écrans tactiles) le doigt ne dessine pas : il fait défiler la page — on peut
// donc poser la paume. En mode « doigt », tout dessine.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState, useCallback } from "react";
import { Icon } from "../ui";
import { Pen, Highlighter, Eraser, Undo2, Redo2, Trash2, Hand, PenTool } from "lucide-react";

const rid = () => Math.random().toString(36).slice(2, 10);

export const COULEURS_STYLET = ["#111827", "#2563eb", "#dc2626", "#16a34a", "#f59e0b", "#7c3aed"];
const TAILLES = [{ id: "fin", w: 2.2 }, { id: "moyen", w: 4 }, { id: "gros", w: 7 }];
const MARQUEUR = { width: 18, alpha: 0.32 };
const RAYON_GOMME = 16; // en unités logiques

// ── Fond de page (papier) ────────────────────────────────────────────────────
export function dessinerFond(ctx, w, h, fond = "lignes") {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  if (fond === "blanc") return;
  ctx.save();
  ctx.lineWidth = 1;
  if (fond === "grille") {
    const pas = 50;
    ctx.strokeStyle = "rgba(37,99,235,0.10)";
    for (let x = pas; x < w; x += pas) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = pas; y < h; y += pas) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  } else {
    const pas = 44;
    ctx.strokeStyle = "rgba(17,24,39,0.09)";
    for (let y = pas * 2; y < h - pas / 2; y += pas) { ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(w - 40, y); ctx.stroke(); }
    ctx.strokeStyle = "rgba(220,38,38,0.22)";
    ctx.beginPath(); ctx.moveTo(90, 0); ctx.lineTo(90, h); ctx.stroke();
  }
  ctx.restore();
}

// ── Rendu d'un tracé ─────────────────────────────────────────────────────────
// Stylo : largeur variable selon la pression, segment par segment (les bouts
// ronds masquent les raccords). Marqueur (alpha < 1) : un seul chemin à
// largeur fixe, sinon les recouvrements assombriraient les raccords.
function dessinerStroke(ctx, s) {
  const pts = s.points || [];
  if (pts.length === 0) return;
  ctx.save();
  ctx.strokeStyle = s.color || "#111827";
  ctx.fillStyle = s.color || "#111827";
  ctx.globalAlpha = s.alpha ?? 1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const base = s.width || 3;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], base / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  if ((s.alpha ?? 1) < 1) {
    ctx.lineWidth = base;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  } else {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const p = ((a[2] ?? 0.5) + (b[2] ?? 0.5)) / 2;
      ctx.lineWidth = base * (0.45 + 1.1 * p);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function dessinerStrokes(ctx, strokes) {
  (strokes || []).forEach(s => dessinerStroke(ctx, s));
}

// ── Export PNG (vignettes + PDF) ─────────────────────────────────────────────
// pixelWidth : largeur de l'image produite ; la hauteur suit le ratio logique.
export function renderStrokesDataURL(strokes, { largeur = 1000, hauteur = 1400, fond = "lignes", pixelWidth = 1200 } = {}) {
  const canvas = document.createElement("canvas");
  const k = pixelWidth / largeur;
  canvas.width = Math.round(largeur * k);
  canvas.height = Math.round(hauteur * k);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(k, 0, 0, k, 0, 0);
  dessinerFond(ctx, largeur, hauteur, fond);
  dessinerStrokes(ctx, strokes);
  try { return canvas.toDataURL("image/png"); } catch { return ""; }
}

const estTactile = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
const lireStyletSeul = () => {
  try { const v = localStorage.getItem("stylus_only"); if (v != null) return v === "1"; } catch {}
  return estTactile();
};

// Plus proche ancêtre qui défile verticalement (pour le défilement au doigt
// en mode stylet seul, puisque touch-action:none bloque le défilement natif).
function parentDefilant(el) {
  let n = el?.parentElement;
  while (n) {
    const st = window.getComputedStyle(n);
    if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight) return n;
    n = n.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

/**
 * strokes / onChange : liste des tracés (contrôlée par le parent).
 * largeur / hauteur  : repère logique. fond : "lignes" | "grille" | "blanc".
 * T, acc             : thème + accent de branche (styles de la barre d'outils).
 */
export default function StylusCanvas({ strokes = [], onChange, largeur = 1000, hauteur = 1400, fond = "lignes", T, acc, readOnly = false }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const baseRef = useRef(null);            // canvas hors écran : fond + tracés validés
  const strokesRef = useRef(strokes);      // copie de travail (gomme en cours)
  const drawingRef = useRef(null);         // { pointerId, stroke } | { pointerId, erasing, touched } | { pointerId, scroll }
  const [cssW, setCssW] = useState(0);
  const [tool, setTool] = useState("pen"); // pen | marker | eraser | hand
  const [taille, setTaille] = useState("moyen");
  const [color, setColor] = useState(COULEURS_STYLET[0]);
  const [styletSeul, setStyletSeul] = useState(lireStyletSeul);
  const [redoStack, setRedoStack] = useState([]);
  const scale = cssW > 0 ? cssW / largeur : 1;
  const cssH = Math.round(cssW * hauteur / largeur);

  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  useEffect(() => { try { localStorage.setItem("stylus_only", styletSeul ? "1" : "0"); } catch {} }, [styletSeul]);

  // Largeur d'affichage = largeur du conteneur.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const mesure = () => setCssW(Math.max(0, Math.floor(el.getBoundingClientRect().width)));
    mesure();
    const ro = new ResizeObserver(mesure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Redessine le canvas de base (fond + tracés) puis l'affiche.
  const redessinerBase = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || cssW === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (!baseRef.current) baseRef.current = document.createElement("canvas");
    const base = baseRef.current;
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
    if (base.width !== pw || base.height !== ph) { base.width = pw; base.height = ph; }
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    const bctx = base.getContext("2d");
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, pw, ph);
    bctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    dessinerFond(bctx, largeur, hauteur, fond);
    dessinerStrokes(bctx, strokesRef.current);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(base, 0, 0);
  }, [cssW, cssH, scale, largeur, hauteur, fond]);

  useEffect(() => { redessinerBase(); }, [redessinerBase, strokes]);

  // Affiche base + tracé en cours.
  const rafraichir = useCallback(() => {
    const canvas = canvasRef.current, base = baseRef.current;
    if (!canvas || !base) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(base, 0, 0);
    const d = drawingRef.current;
    if (d?.stroke) {
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      dessinerStroke(ctx, d.stroke);
    }
  }, [scale]);

  const versLogique = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
    const p = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 100) / 100];
  };

  const gommerA = (pt) => {
    const r2 = RAYON_GOMME * RAYON_GOMME;
    const avant = strokesRef.current;
    const apres = avant.filter(s => !(s.points || []).some(q => (q[0] - pt[0]) ** 2 + (q[1] - pt[1]) ** 2 <= r2));
    if (apres.length !== avant.length) {
      strokesRef.current = apres;
      drawingRef.current.touched = true;
      redessinerBase();
    }
  };

  const onPointerDown = (e) => {
    if (readOnly || !canvasRef.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (drawingRef.current) return; // un seul pointeur actif à la fois
    const doigt = e.pointerType === "touch";
    // Défilement au doigt (mode stylet seul) ou outil main.
    if ((doigt && styletSeul) || tool === "hand") {
      const parent = parentDefilant(canvasRef.current);
      drawingRef.current = { pointerId: e.pointerId, scroll: { parent, y: e.clientY, top: parent.scrollTop } };
      try { canvasRef.current.setPointerCapture(e.pointerId); } catch {}
      return;
    }
    e.preventDefault();
    try { canvasRef.current.setPointerCapture(e.pointerId); } catch {}
    const pt = versLogique(e);
    if (tool === "eraser") {
      drawingRef.current = { pointerId: e.pointerId, erasing: true, touched: false };
      gommerA(pt);
      return;
    }
    const w = TAILLES.find(t => t.id === taille)?.w || 4;
    const stroke = tool === "marker"
      ? { id: rid(), color, width: MARQUEUR.width, alpha: MARQUEUR.alpha, points: [pt] }
      : { id: rid(), color, width: w, alpha: 1, points: [pt] };
    drawingRef.current = { pointerId: e.pointerId, stroke };
    rafraichir();
  };

  const onPointerMove = (e) => {
    const d = drawingRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (d.scroll) {
      d.scroll.parent.scrollTop = d.scroll.top - (e.clientY - d.scroll.y);
      return;
    }
    e.preventDefault();
    const evts = typeof e.nativeEvent?.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [e];
    const liste = evts.length ? evts : [e];
    if (d.erasing) { liste.forEach(ev => gommerA(versLogique(ev))); return; }
    liste.forEach(ev => {
      const pt = versLogique(ev);
      const last = d.stroke.points[d.stroke.points.length - 1];
      if (Math.abs(pt[0] - last[0]) < 0.6 && Math.abs(pt[1] - last[1]) < 0.6) return;
      d.stroke.points.push(pt);
    });
    rafraichir();
  };

  const finPointer = (e) => {
    const d = drawingRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drawingRef.current = null;
    try { canvasRef.current?.releasePointerCapture(e.pointerId); } catch {}
    if (d.scroll) return;
    if (d.erasing) { if (d.touched) onChange?.(strokesRef.current); return; }
    setRedoStack([]);
    onChange?.([...strokesRef.current, d.stroke]);
  };

  const annuler = () => {
    if (strokes.length === 0) return;
    setRedoStack(r => [...r, strokes[strokes.length - 1]]);
    onChange?.(strokes.slice(0, -1));
  };
  const retablir = () => {
    if (redoStack.length === 0) return;
    const s = redoStack[redoStack.length - 1];
    setRedoStack(r => r.slice(0, -1));
    onChange?.([...strokes, s]);
  };
  const effacer = () => {
    if (strokes.length === 0) return;
    if (!window.confirm("Effacer tout le dessin de cette page ?")) return;
    setRedoStack([]);
    onChange?.([]);
  };

  const th = T || {};
  const accent = acc?.accent || th.accent || "#FFC200";
  const onAccent = acc?.onAccent || "#000";
  const btn = (actif, extra = {}) => ({
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
    minWidth: 38, height: 38, padding: "0 10px", borderRadius: 9, cursor: "pointer",
    border: `1px solid ${actif ? "transparent" : (th.border || "#ccc")}`,
    background: actif ? accent : (th.card || "#fff"),
    color: actif ? onAccent : (th.textSub || "#666"),
    fontFamily: "inherit", fontSize: 12, fontWeight: 700, flexShrink: 0,
    ...extra,
  });

  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      {!readOnly && (
        <div className="stylus-toolbar" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <button title="Stylo" onClick={() => setTool("pen")} style={btn(tool === "pen")}><Icon as={Pen} size={15}/></button>
          <button title="Marqueur / surligneur" onClick={() => setTool("marker")} style={btn(tool === "marker")}><Icon as={Highlighter} size={15}/></button>
          <button title="Gomme (efface le trait touché)" onClick={() => setTool("eraser")} style={btn(tool === "eraser")}><Icon as={Eraser} size={15}/></button>
          <button title="Main : faire défiler la page" onClick={() => setTool("hand")} style={btn(tool === "hand")}><Icon as={Hand} size={15}/></button>
          <span style={{ width: 1, height: 24, background: th.border || "#ddd", margin: "0 2px" }}/>
          {TAILLES.map(t => (
            <button key={t.id} title={`Trait ${t.id}`} onClick={() => { setTaille(t.id); if (tool !== "pen") setTool("pen"); }} style={btn(taille === t.id && tool === "pen", { minWidth: 34, padding: 0 })}>
              <span style={{ width: t.w * 2.2, height: t.w * 2.2, borderRadius: "50%", background: "currentColor", display: "inline-block" }}/>
            </button>
          ))}
          <span style={{ width: 1, height: 24, background: th.border || "#ddd", margin: "0 2px" }}/>
          {COULEURS_STYLET.map(c => (
            <button key={c} title="Couleur" onClick={() => { setColor(c); if (tool === "eraser" || tool === "hand") setTool("pen"); }} style={{
              width: 30, height: 30, borderRadius: "50%", background: c, cursor: "pointer", padding: 0, flexShrink: 0,
              border: color === c ? `3px solid ${accent}` : "3px solid transparent",
              boxShadow: color === c ? `0 0 0 2px ${th.surface || "#fff"} inset` : "none",
            }}/>
          ))}
          <span style={{ flex: 1 }}/>
          <button title="Annuler le dernier trait" onClick={annuler} disabled={strokes.length === 0} style={btn(false, { opacity: strokes.length === 0 ? .4 : 1 })}><Icon as={Undo2} size={15}/></button>
          <button title="Rétablir" onClick={retablir} disabled={redoStack.length === 0} style={btn(false, { opacity: redoStack.length === 0 ? .4 : 1 })}><Icon as={Redo2} size={15}/></button>
          <button title="Tout effacer" onClick={effacer} disabled={strokes.length === 0} style={btn(false, { color: "#e15a5a", opacity: strokes.length === 0 ? .4 : 1 })}><Icon as={Trash2} size={15}/></button>
          <button title={styletSeul ? "Seul le stylet dessine — le doigt fait défiler (paume posée OK)" : "Le doigt dessine aussi"} onClick={() => setStyletSeul(v => !v)} style={btn(styletSeul, { fontSize: 11 })}>
            <Icon as={PenTool} size={14}/> {styletSeul ? "Stylet seul" : "Doigt + stylet"}
          </button>
        </div>
      )}
      <div style={{ borderRadius: 12, overflow: "hidden", border: `1px solid ${th.border || "#ddd"}`, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", background: "#fff", lineHeight: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ width: cssW || "100%", height: cssH || "auto", display: "block", touchAction: "none",
            cursor: readOnly ? "default" : tool === "hand" ? "grab" : tool === "eraser" ? "cell" : "crosshair" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finPointer}
          onPointerCancel={finPointer}
          onContextMenu={e => e.preventDefault()}
        />
      </div>
    </div>
  );
}
