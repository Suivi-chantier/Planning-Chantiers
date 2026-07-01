import React, { useState } from "react";
import { FONT, RADIUS, SEMANTIC, PROFERO_YELLOW, LOGO_RENO_V } from "../constants";
import { Icon } from "../ui";
import { LayoutDashboard, CalendarDays, ClipboardList, ShoppingCart, LogOut } from "lucide-react";

// ─── THÈME LIGHT CHANTIER ─────────────────────────────────────────────────────
// Aligné sur RapportMobile.jsx (lisibilité extérieure, palette claire Profero).
const T = {
  bg:        "#f4f6fa",
  surface:   "#ffffff",
  card:      "#ffffff",
  border:    "#e0e4ef",
  text:      "#1a1f2e",
  textSub:   "#5a6478",
  textMuted: "#8a9ab0",
  accent:    PROFERO_YELLOW,
  accentText:"#1a1f2e",
  info:      SEMANTIC.info.color,
  infoBg:    SEMANTIC.info.bg,
};

// Les 4 onglets de l'espace ouvrier. Les id correspondent aux pages dédiées
// déclarées pour le rôle "ouvrier" dans src/access.js (préfixe "ouvrier-").
const TABS = [
  { id: "dashboard",        label: "Accueil",      icon: LayoutDashboard, titre: "Tableau de bord" },
  { id: "planning",         label: "Planning",     icon: CalendarDays,    titre: "Mon planning" },
  { id: "compte-rendu",     label: "Compte rendu", icon: ClipboardList,   titre: "Mon compte rendu" },
  { id: "demande-commande", label: "Commande",     icon: ShoppingCart,    titre: "Mes demandes de commande" },
];

const NAV_H = 64; // hauteur de la bottom-nav (pour le padding du contenu)

// Placeholder d'onglet tant que le contenu réel n'est pas branché.
function Placeholder({ titre, phase }) {
  return (
    <div style={{
      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      textAlign:"center", gap:12, padding:"48px 24px", minHeight:"50vh", color:T.textMuted,
    }}>
      <div style={{
        width:64, height:64, borderRadius:18, background:T.infoBg, color:T.info,
        display:"flex", alignItems:"center", justifyContent:"center",
      }}>
        <Icon as={ClipboardList} size={28} strokeWidth={1.6}/>
      </div>
      <div style={{ fontSize:FONT.lg.size, fontWeight:800, color:T.text, letterSpacing:-0.3 }}>{titre}</div>
      <div style={{ fontSize:FONT.base.size, maxWidth:320, lineHeight:1.5 }}>
        Cet onglet arrive bientôt{phase ? ` (${phase})` : ""}.
      </div>
    </div>
  );
}

export default function EspaceOuvrier({ user, profil, onLogout }) {
  const [tab, setTab] = useState("dashboard");
  const prenom = profil?.prenom_planning || profil?.nom || "";
  const current = TABS.find(t => t.id === tab) || TABS[0];

  return (
    <div style={{
      minHeight:"100vh", background:T.bg, color:T.text,
      fontFamily:"'Barlow Condensed','Arial Narrow',sans-serif",
    }}>
      {/* ── Header ── */}
      <div style={{ background:"#16181d", padding:"16px 20px 14px", borderBottom:`2px solid ${T.accent}` }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
          <div>
            <img src={LOGO_RENO_V} alt="Profero" style={{ height:38, objectFit:"contain", objectPosition:"left", marginBottom:4 }}/>
            {prenom && <div style={{ fontSize:FONT.sm.size+1, color:T.accent, fontWeight:700 }}>Bonjour {prenom}</div>}
            <div style={{ fontSize:FONT.lg.size, fontWeight:800, color:"#fff", letterSpacing:-0.2 }}>{current.titre}</div>
          </div>
          <button onClick={onLogout} style={{
            display:"inline-flex", alignItems:"center", gap:5,
            background:`${T.accent}1A`, border:`1px solid ${T.accent}4D`,
            borderRadius:RADIUS.md, padding:"6px 12px", color:T.accent,
            fontSize:FONT.sm.size+1, cursor:"pointer", fontFamily:"inherit", fontWeight:600,
          }}>
            <Icon as={LogOut} size={12}/>
            Déconnexion
          </button>
        </div>
      </div>

      {/* ── Contenu de l'onglet ── */}
      <div style={{ paddingBottom:NAV_H + 12 }}>
        {tab === "dashboard"        && <Placeholder titre="Tableau de bord"          phase="Phase 3"/>}
        {tab === "planning"         && <Placeholder titre="Mon planning"             phase="Phase 4"/>}
        {tab === "compte-rendu"     && <Placeholder titre="Mon compte rendu"         phase="Phase 5"/>}
        {tab === "demande-commande" && <Placeholder titre="Mes demandes de commande" phase="Phase 6"/>}
      </div>

      {/* ── Bottom-nav ── */}
      <nav style={{
        position:"fixed", bottom:0, left:0, right:0, height:NAV_H,
        background:T.surface, borderTop:`1px solid ${T.border}`,
        display:"flex", boxShadow:"0 -2px 12px rgba(0,0,0,0.06)", zIndex:50,
        paddingBottom:"env(safe-area-inset-bottom)",
      }}>
        {TABS.map(t => {
          const actif = t.id === tab;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3,
              border:"none", background:"transparent", cursor:"pointer", fontFamily:"inherit",
              color: actif ? T.accentText : T.textMuted,
              borderTop: `2px solid ${actif ? T.accent : "transparent"}`,
            }}>
              <Icon as={t.icon} size={21} strokeWidth={actif ? 2.4 : 1.9}/>
              <span style={{ fontSize:FONT.xs.size, fontWeight: actif ? 800 : 600, letterSpacing:0.2 }}>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
