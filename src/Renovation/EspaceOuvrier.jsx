import React, { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { PROFERO_YELLOW, LOGO_RENO_H } from "../constants";
import { Icon } from "../ui";
import {
  LayoutDashboard, CalendarDays, ClipboardList, ShoppingCart, LogOut, ChevronRight,
  Sun, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, Zap,
} from "lucide-react";
import { MobileHero } from "../mobileUI";
import OuvrierDashboard from "./OuvrierDashboard";
import OuvrierPlanning from "./OuvrierPlanning";

// Météo (Open-Meteo) — même mapping que Dashboard/Planning.
function weatherInfo(code) {
  if (code === 0)                 return { icon: Sun,          label: "Ensoleillé" };
  if (code >= 1 && code <= 3)     return { icon: Cloud,        label: "Nuageux" };
  if (code === 45 || code === 48) return { icon: CloudFog,     label: "Brouillard" };
  if (code >= 51 && code <= 57)   return { icon: CloudDrizzle, label: "Bruine" };
  if (code >= 61 && code <= 67)   return { icon: CloudRain,    label: "Pluie" };
  if (code >= 71 && code <= 77)   return { icon: CloudSnow,    label: "Neige" };
  if (code >= 80 && code <= 82)   return { icon: CloudRain,    label: "Averses" };
  if (code >= 95 && code <= 99)   return { icon: Zap,          label: "Orage" };
  return                                 { icon: Cloud,        label: "Variable" };
}

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
  const [weather, setWeather] = useState(null);
  const prenom = profil?.prenom_planning || profil?.nom || "";
  const current = TABS.find(t => t.id === tab) || TABS[0];

  // Météo du jour — ville partagée avec le Dashboard conducteur (config locale).
  useEffect(() => {
    let cancelled = false;
    const city = localStorage.getItem("dash_weather_city") || "Paris";
    (async () => {
      try {
        const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fr&format=json`).then(r => r.json());
        const loc = geo?.results?.[0];
        if (!loc) return;
        const f = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code&timezone=Europe%2FParis`).then(r => r.json());
        if (!cancelled) setWeather({ current: f.current });
      } catch { /* silencieux : la météo est secondaire */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const dateLong = new Date().toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long" });
  const heroTitle = tab === "dashboard" && prenom ? `Bonjour ${prenom}` : current.titre;
  const wi = weather?.current ? weatherInfo(weather.current.weather_code) : null;

  const heroRight = (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:8, flexShrink:0 }}>
      {wi && (
        <div style={{
          display:"flex", alignItems:"center", gap:7,
          background:"rgba(255,255,255,0.10)", border:"1px solid rgba(255,255,255,0.14)",
          borderRadius:13, padding:"8px 12px",
        }}>
          <Icon as={wi.icon} size={19} style={{ color:"#fff" }}/>
          <span style={{ fontSize:17, fontWeight:800, color:"#fff" }}>{Math.round(weather.current.temperature_2m)}°</span>
        </div>
      )}
      <button onClick={onLogout} style={{
        display:"inline-flex", alignItems:"center", gap:6,
        background:"rgba(255,255,255,0.10)", border:"1px solid rgba(255,255,255,0.16)",
        borderRadius:13, padding:"7px 11px", color:"#fff", cursor:"pointer",
        fontFamily:"inherit", fontSize:13, fontWeight:700,
      }}>
        <Icon as={LogOut} size={14}/>
        Quitter
      </button>
    </div>
  );

  return (
    <div style={{
      minHeight:"100vh", background:T.bg, color:T.text,
      fontFamily:"'Barlow Condensed','Arial Narrow',sans-serif",
    }}>
      <div style={{
        padding:"14px 12px", display:"flex", flexDirection:"column", gap:12,
        // Sur l'accueil, on réserve la place de la barre CTA collante en plus de la nav.
        paddingBottom: NAV_H + (tab === "dashboard" ? 88 : 16),
      }}>
        <MobileHero accent={ACCENT} logo={LOGO_RENO_H} eyebrow={dateLong} title={heroTitle} right={heroRight}/>

        {tab === "dashboard"        && <OuvrierDashboard prenom={prenom} T={T} accent={ACCENT}/>}
        {tab === "planning"         && <OuvrierPlanning prenom={prenom} T={T} accent={ACCENT}/>}
        {tab === "compte-rendu"     && <Placeholder titre="Mon compte rendu" phase="Phase 5"/>}
        {tab === "demande-commande" && <Placeholder titre="Mes demandes"     phase="Phase 6"/>}
      </div>

      {/* Barre d'action collante — accès direct au compte rendu sans scroller */}
      {tab === "dashboard" && (
        <div style={{
          position:"fixed", left:0, right:0, bottom:NAV_H, zIndex:49,
          padding:"10px 12px 12px",
          background:`linear-gradient(to top, ${T.bg} 62%, ${T.bg}cc 82%, transparent)`,
        }}>
          <button onClick={() => setTab("compte-rendu")} style={{
            width:"100%", padding:"15px", border:"none", borderRadius:15,
            background:`linear-gradient(135deg, ${ACCENT}, ${ACCENT}cc)`, color:"#1a1f2e",
            fontFamily:"inherit", fontSize:16, fontWeight:800, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", gap:8,
            boxShadow:`0 8px 20px ${ACCENT}66`,
          }}>
            <Icon as={ClipboardList} size={18} strokeWidth={2.3}/>
            Faire mon compte rendu
            <Icon as={ChevronRight} size={18} strokeWidth={2.5}/>
          </button>
        </div>
      )}

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
