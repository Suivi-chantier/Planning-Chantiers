import React, { useState } from "react";
import { PROFERO_YELLOW } from "../constants";
import { Icon } from "../ui";
import { LayoutDashboard, CalendarDays, ClipboardList, ShoppingCart, LogOut } from "lucide-react";
import { MobileHero } from "../mobileUI";
import OuvrierDashboard from "./OuvrierDashboard";

// ─── THÈME CLAIR (aligné sur le design system mobileUI) ───────────────────────
// Cartes blanches surélevées sur fond clair — clés attendues par le kit.
export const T = {
  bg:        "#f4f6fa",
  surface:   "#ffffff",
  card:      "#eef1f7",
  border:    "#e4e8f2",
  text:      "#1a1f2e",
  textSub:   "#5a6478",
  textMuted: "#8a9ab0",
};
const ACCENT = PROFERO_YELLOW;

// Les 4 onglets. Les id correspondent aux pages dédiées "ouvrier-*" (access.js).
const TABS = [
  { id: "dashboard",        label: "Accueil",      icon: LayoutDashboard, titre: "Tableau de bord" },
  { id: "planning",         label: "Planning",     icon: CalendarDays,    titre: "Mon planning" },
  { id: "compte-rendu",     label: "Compte rendu", icon: ClipboardList,   titre: "Mon compte rendu" },
  { id: "demande-commande", label: "Commande",     icon: ShoppingCart,    titre: "Mes demandes" },
];

const NAV_H = 66; // hauteur bottom-nav

// Placeholder premium tant que le contenu réel n'est pas branché.
function Placeholder({ titre, phase }) {
  return (
    <div style={{
      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      textAlign:"center", gap:12, padding:"48px 24px", color:T.textMuted,
    }}>
      <div style={{
        width:64, height:64, borderRadius:18, background:T.surface, border:`1px solid ${T.border}`,
        display:"flex", alignItems:"center", justifyContent:"center", color:ACCENT,
      }}>
        <Icon as={ClipboardList} size={28} strokeWidth={1.6}/>
      </div>
      <div style={{ fontSize:17, fontWeight:800, color:T.text, letterSpacing:-0.3 }}>{titre}</div>
      <div style={{ fontSize:14, maxWidth:320, lineHeight:1.5 }}>Cet onglet arrive bientôt{phase ? ` (${phase})` : ""}.</div>
    </div>
  );
}

export default function EspaceOuvrier({ user, profil, onLogout }) {
  const [tab, setTab] = useState("dashboard");
  const prenom = profil?.prenom_planning || profil?.nom || "";
  const current = TABS.find(t => t.id === tab) || TABS[0];

  const dateLong = new Date().toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long" });
  const heroTitle = tab === "dashboard" && prenom ? `Bonjour ${prenom}` : current.titre;

  const logoutBtn = (
    <button onClick={onLogout} style={{
      display:"inline-flex", alignItems:"center", gap:6, flexShrink:0,
      background:"rgba(255,255,255,0.10)", border:"1px solid rgba(255,255,255,0.16)",
      borderRadius:13, padding:"8px 12px", color:"#fff", cursor:"pointer",
      fontFamily:"inherit", fontSize:13, fontWeight:700,
    }}>
      <Icon as={LogOut} size={14}/>
      Quitter
    </button>
  );

  return (
    <div style={{
      minHeight:"100vh", background:T.bg, color:T.text,
      fontFamily:"'Barlow Condensed','Arial Narrow',sans-serif",
    }}>
      <div style={{ padding:"14px 12px", paddingBottom:NAV_H + 16, display:"flex", flexDirection:"column", gap:12 }}>
        <MobileHero accent={ACCENT} eyebrow={dateLong} title={heroTitle} right={logoutBtn}/>

        {tab === "dashboard"        && <OuvrierDashboard prenom={prenom} T={T} accent={ACCENT} onGoCompteRendu={() => setTab("compte-rendu")}/>}
        {tab === "planning"         && <Placeholder titre="Mon planning"    phase="Phase 4"/>}
        {tab === "compte-rendu"     && <Placeholder titre="Mon compte rendu" phase="Phase 5"/>}
        {tab === "demande-commande" && <Placeholder titre="Mes demandes"     phase="Phase 6"/>}
      </div>

      {/* ── Bottom-nav ── */}
      <nav style={{
        position:"fixed", bottom:0, left:0, right:0, height:NAV_H,
        background:T.surface, borderTop:`1px solid ${T.border}`,
        display:"flex", boxShadow:"0 -2px 14px rgba(16,24,40,0.08)", zIndex:50,
        paddingBottom:"env(safe-area-inset-bottom)",
      }}>
        {TABS.map(t => {
          const actif = t.id === tab;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4,
              border:"none", background:"transparent", cursor:"pointer", fontFamily:"inherit",
              color: actif ? T.text : T.textMuted,
            }}>
              <div style={{
                display:"flex", alignItems:"center", justifyContent:"center",
                width:38, height:30, borderRadius:11,
                background: actif ? `linear-gradient(135deg, ${ACCENT}, ${ACCENT}cc)` : "transparent",
                color: actif ? "#1a1f2e" : T.textMuted,
                boxShadow: actif ? `0 5px 14px ${ACCENT}55` : "none",
              }}>
                <Icon as={t.icon} size={19} strokeWidth={actif ? 2.4 : 1.9}/>
              </div>
              <span style={{ fontSize:11, fontWeight: actif ? 800 : 600, letterSpacing:0.2 }}>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
