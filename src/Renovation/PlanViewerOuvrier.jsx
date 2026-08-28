// ─────────────────────────────────────────────────────────────────────────────
// VISIONNEUSE DE PLAN — lecture seule, plein écran, pour l'espace ouvrier.
// Charge le dessin complet à la demande (RPC ouvrier_plan_data) et le rend
// sur canvas avec la palette « impression » (fond blanc, lisible en
// extérieur). Le rendu de la scène est PARTAGÉ via planRendu.js
// (dessinerScene/calerVue — aussi utilisé par l'export PDF des plans) ;
// le dessin des symboles vit dans planDessin.js : même rendu que le bureau.
// Interactions : 1 doigt = déplacer, pincement = zoom, double-tap = recadrer.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../supabase";
import { Icon } from "../ui";
import { X, Plus, Minus, Maximize2 } from "lucide-react";
import { dessinerScene, calerVue } from "./planRendu";

export default function PlanViewerOuvrier({ planId, name, onClose }) {
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur]   = useState(false);
  const canvasRef = useRef(null);
  const wrapRef   = useRef(null);
  const dataRef   = useRef(null);                 // plan.data chargé
  const vpRef     = useRef({ x: 0, y: 0, scale: 50 });
  const rafRef    = useRef(0);
  const gestRef   = useRef({ touches: [], lastTap: 0, mouse: null });

  // ── Rendu : préparation du canvas (dpr, fond blanc) puis scène partagée
  //    planRendu.dessinerScene — même dessin que l'export PDF des plans. ──────
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

    dessinerScene(ctx, d, W, H, vpRef.current);
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

  // Cadrage : englobe segments, symboles, surfaces et cotes (planRendu).
  const fitView = useCallback(() => {
    const canvas = canvasRef.current, d = dataRef.current;
    if (!canvas || !d) return;
    const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1;
    const vp = calerVue(d, W, H);
    if (!vp) return;
    vpRef.current = vp;
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
