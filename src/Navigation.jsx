import React, { useState, useEffect } from "react";
import { LOGO_HORIZ, LOGO_SQ } from "./constants";

// ─── HOOK MOBILE ──────────────────────────────────────────────────────────────
function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return mobile;
}

// ─── NAVIGATION BAS (MOBILE) ──────────────────────────────────────────────────
function BottomNav({ page, setPage, T }) {
  const nav = [
    { id:"dashboard", icon:"⊞", label:"Accueil"  },
    { id:"planning",  icon:"📅", label:"Planning" },
    { id:"commandes", icon:"📦", label:"Commandes"},
    { id:"visite",    icon:"🔍", label:"Visites"  },
    { id:"admin",     icon:"⚙️", label:"Réglages" },
  ];
  return (
    <div className="bottom-nav-mobile">
      {nav.map(n => {
        const active = page === n.id;
        return (
          <button key={n.id} onClick={() => setPage(n.id)} style={{
            flex:1, display:"flex", flexDirection:"column", alignItems:"center",
            justifyContent:"center", padding:"8px 2px 6px", border:"none",
            background: active ? "rgba(255,194,0,0.1)" : "transparent",
            cursor:"pointer", fontFamily:"inherit", transition:"all .12s",
            borderTop: active ? "2px solid #FFC200" : "2px solid transparent",
            marginTop: -2,
          }}>
            <span style={{ fontSize:18, lineHeight:1 }}>{n.icon}</span>
            <span style={{
              fontSize:9, fontWeight: active ? 700 : 500, marginTop:3,
              color: active ? "#FFC200" : "rgba(255,255,255,0.4)",
              letterSpacing:.3, textTransform:"uppercase",
            }}>{n.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function Sidebar({page,setPage,T}){
  const[collapsed,setCollapsed]=useState(()=>localStorage.getItem("sidebar_collapsed")==="1");
  const nav=[
    {id:"dashboard",   icon:"⊞",  label:"Tableau de bord"},
    {id:"planning",    icon:"📅", label:"Planning"},
    {id:"commandes",   icon:"📦", label:"Commandes"},
    {id:"equipe",      icon:"👷", label:"Équipe"},
    {id:"plans",       icon:"📐", label:"Plans"},
    {id:"phasage",     icon:"📋", label:"Phasage"},
    {id:"bibliotheque",icon:"📚", label:"Bibliothèque"},
    {id:"visite",      icon:"🔍", label:"Visites chantier"},
    {id:"admin",       icon:"⚙️", label:"Réglages"},
  ];
  const toggle=()=>{
    const next=!collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar_collapsed",next?"1":"0");
  };
  const W=collapsed?64:220;
  return(
    <div style={{width:W,flexShrink:0,background:T.sidebar,borderRight:`1px solid ${T.sidebarBorder}`,
      display:"flex",flexDirection:"column",position:"sticky",top:0,height:"100vh",zIndex:50,
      transition:"width .2s ease",overflow:"hidden"}}>

      {/* Logo + toggle */}
      <div style={{padding:collapsed?"14px 0":"16px 14px 12px",display:"flex",
        alignItems:"center",justifyContent:collapsed?"center":"space-between",gap:8,flexShrink:0,
        borderBottom:`1px solid ${T.sidebarBorder}`}}>
        {!collapsed&&(
          <img src={LOGO_HORIZ} alt="Profero" style={{height:34,objectFit:"contain",objectPosition:"left"}}/>
        )}
        {collapsed&&(
          <div style={{width:34,height:34,borderRadius:6,overflow:"hidden",display:"flex",
            alignItems:"center",justifyContent:"center"}}>
            <img src={LOGO_SQ} alt="P" style={{width:34,height:34,objectFit:"contain"}}/>
          </div>
        )}
        <button onClick={toggle} title={collapsed?"Agrandir le menu":"Réduire le menu"} style={{
          background:"rgba(255,255,255,0.06)",border:"none",borderRadius:6,
          width:28,height:28,cursor:"pointer",color:"rgba(255,255,255,0.5)",
          fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",
          flexShrink:0,transition:"background .15s",
        }}
        onMouseEnter={e=>e.currentTarget.style.background="rgba(255,194,0,0.2)"}
        onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}>
          {collapsed?"▶":"◀"}
        </button>
      </div>

      {/* Nav items */}
      <nav style={{flex:1,padding:collapsed?"8px 6px":"0 8px",overflowY:"auto"}}>
        {nav.map(n=>{
          const active=page===n.id;
          return(
            <button key={n.id} onClick={()=>setPage(n.id)}
              title={collapsed?n.label:""} style={{
              width:"100%",display:"flex",alignItems:"center",
              justifyContent:collapsed?"center":"flex-start",
              gap:10,padding:collapsed?"12px 0":"11px 14px",
              borderRadius:10,border:"none",cursor:"pointer",fontFamily:"inherit",
              fontSize:15,fontWeight:active?700:500,letterSpacing:.3,
              background:active?T.sidebarActive:"transparent",
              color:active?"#FFC200":"rgba(255,255,255,0.45)",
              marginBottom:4,transition:"all .15s",textAlign:"left",
              whiteSpace:"nowrap",
            }}>
              <span style={{fontSize:20,width:24,textAlign:"center",flexShrink:0}}>{n.icon}</span>
              {!collapsed&&<>
                <span>{n.label}</span>
                {active&&<span style={{marginLeft:"auto",width:4,height:18,borderRadius:2,background:T.accent,display:"block"}}/>}
              </>}
            </button>
          );
        })}
      </nav>

      {/* Date en bas */}
      {!collapsed&&<div style={{padding:"12px 16px",borderTop:`1px solid ${T.sidebarBorder}`,flexShrink:0}}>
        <div style={{fontSize:11,color:"rgba(255,255,255,0.25)",lineHeight:1.5}}>
          {new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}
        </div>
      </div>}
    </div>
  );
}

export { useIsMobile, BottomNav, Sidebar };
