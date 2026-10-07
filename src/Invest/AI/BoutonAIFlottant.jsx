import React, { useState, useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import { Icon } from "../../ui";

// Bouton Profero AI flottant, déplaçable n'importe où sur la page (glisser) ;
// un simple clic ouvre le volet. La position est mémorisée par appareil.
const TAILLE = 52;
const CLE = "invest_ai_bouton_pos";

const lire = () => {
  try { const p = JSON.parse(localStorage.getItem(CLE)); if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p; } catch {}
  return null;
};
const borner = (p) => ({
  x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - TAILLE - 8)),
  y: Math.min(Math.max(8, p.y), Math.max(8, window.innerHeight - TAILLE - 8)),
});

export default function BoutonAIFlottant({ onOuvrir, T, estMobile }) {
  const defaut = () => ({ x: window.innerWidth - TAILLE - 20, y: window.innerHeight - TAILLE - (estMobile ? 82 : 24) });
  const [pos, setPos] = useState(() => borner(lire() || defaut()));
  const drag = useRef(null);

  useEffect(() => {
    const onResize = () => setPos(p => borner(p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const down = (e) => {
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, x0: e.clientX, y0: e.clientY, bouge: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    const d = drag.current; if (!d) return;
    if (!d.bouge && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
    d.bouge = true;
    setPos(borner({ x: e.clientX - d.dx, y: e.clientY - d.dy }));
  };
  const up = () => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.bouge) { try { localStorage.setItem(CLE, JSON.stringify(pos)); } catch {} }
    else onOuvrir();
  };

  return (
    <button
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOuvrir(); } }}
      title="Profero AI — glissez pour déplacer" aria-label="Ouvrir Profero AI"
      style={{
        position:"fixed", left:pos.x, top:pos.y, width:TAILLE, height:TAILLE, zIndex:11000,
        borderRadius:"50%", border:`1px solid ${T.accent}`, background:T.accent, color:T.bg,
        display:"flex", alignItems:"center", justifyContent:"center", cursor:"grab", touchAction:"none",
        boxShadow:"0 6px 18px rgba(0,0,0,0.35)", padding:0,
      }}>
      <Icon as={Sparkles} size={22}/>
    </button>
  );
}
