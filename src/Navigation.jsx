import React, { useState, useEffect } from "react";
import {
  LayoutDashboard, HardHat, Calendar, CalendarDays, ClipboardList, Package,
  Users, Ruler, ListChecks, BookOpen, Layers, Search, IdCard, FileText, Settings,
  ChevronLeft, ChevronRight, Sun, Moon, LogOut, LayoutGrid, Menu, X, ShoppingCart,
  TrendingUp,
} from "lucide-react";
import { LOGO_RENO_H, LOGO_RENO_V, getBranchAccent, RADIUS, FONT } from "./constants";
import { Icon } from "./ui";

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

const ROLE_LABELS = { admin:"Administrateur", conducteur:"Conducteur de travaux", commercial:"Commercial", comptable:"Comptable" };

// ─── PAGES PAR RÔLE ───────────────────────────────────────────────────────────
const ROLE_PAGES = {
  admin: [
    "dashboard","chantiers","planning","planning-mensuel","notes-todo","commandes","planning-commandes",
    "equipe","plans","phasage","bibliotheque","biblio-materiaux",
    "visite","info-client","compte-rendu","admin"
  ],
  conducteur: [
    "dashboard","chantiers","planning","planning-mensuel","notes-todo","commandes","planning-commandes",
    "equipe","plans","phasage","bibliotheque","biblio-materiaux",
    "visite","info-client","compte-rendu"
  ],
  commercial: [
    "dashboard","chantiers","planning","plans","visite","info-client","compte-rendu"
  ],
  comptable: [
    "dashboard","chantiers","commandes","biblio-materiaux","phasage"
  ],
};

// ─── NAVIGATION BAS (MOBILE) ──────────────────────────────────────────────────
// Liste complète des pages avec icône + label court (pour bottom-nav) + label long (pour la feuille modale).
const ALL_NAV_ITEMS = [
  { id:"dashboard",        icon:LayoutDashboard, label:"Accueil",    longLabel:"Tableau de bord"     },
  { id:"chantiers",        icon:HardHat,         label:"Chantiers",  longLabel:"Chantiers"           },
  { id:"planning",         icon:Calendar,        label:"Planning",   longLabel:"Planning semaine"    },
  { id:"notes-todo",       icon:ClipboardList,   label:"Notes",      longLabel:"Notes & To-do"       },
  { id:"planning-mensuel", icon:CalendarDays,    label:"Mensuel",    longLabel:"Planning mensuel"    },
  { id:"commandes",        icon:Package,         label:"Cmd.",       longLabel:"Commandes"           },
  { id:"planning-commandes", icon:ShoppingCart,  label:"Cmd. 5S",    longLabel:"Planning commandes (5 sem.)" },
  { id:"equipe",           icon:Users,           label:"Équipe",     longLabel:"Équipe"              },
  { id:"plans",            icon:Ruler,           label:"Plans",      longLabel:"Plans"               },
  { id:"phasage",          icon:ListChecks,      label:"Phasage",    longLabel:"Phasage"             },
  { id:"bibliotheque",     icon:BookOpen,        label:"Biblio.",    longLabel:"Biblio. ouvrages"    },
  { id:"biblio-materiaux", icon:Layers,          label:"Matériaux",  longLabel:"Biblio. matériaux"   },
  { id:"visite",           icon:Search,          label:"Visites",    longLabel:"Visites chantier"    },
  { id:"info-client",      icon:IdCard,          label:"Client",     longLabel:"Infos Client"        },
  { id:"compte-rendu",     icon:FileText,        label:"CR",         longLabel:"Compte rendu client" },
  { id:"dashboard-analyse",icon:TrendingUp,      label:"Analyse",    longLabel:"Dashboard Analyse"   },
  { id:"admin",            icon:Settings,        label:"Réglages",   longLabel:"Réglages"            },
];

function BottomNav({ page, setPage, T, role = "admin", branch = "renovation", rolePages = null }) {
  const acc = getBranchAccent(branch);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Si rolePages (config dynamique) est fourni : on l'utilise.
  // Sinon : fallback sur la matrice par défaut hardcodée ROLE_PAGES.
  const allowed = (rolePages && rolePages[role]) || ROLE_PAGES[role] || ROLE_PAGES.admin;
  const allowedItems = ALL_NAV_ITEMS.filter(n => allowed.includes(n.id));

  // Si ≤ 5 pages au total : on les affiche toutes, pas de bouton Plus.
  // Sinon : 4 raccourcis prioritaires + bouton Plus qui ouvre la feuille avec le reste.
  const useSheet = allowedItems.length > 5;
  const mainItems = useSheet ? allowedItems.slice(0, 4) : allowedItems;
  const sheetItems = useSheet ? allowedItems.slice(4) : [];

  // Si la page courante est dans la feuille, on met le bouton Plus en "actif" pour le signaler visuellement.
  const sheetActive = useSheet && sheetItems.some(n => n.id === page);

  const handleSelect = (id) => {
    setPage(id);
    setSheetOpen(false);
  };

  return (
    <>
      <div className="bottom-nav-mobile">
        {mainItems.map(n => {
          const active = page === n.id;
          return (
            <button key={n.id} onClick={() => handleSelect(n.id)} style={{
              flex:1, display:"flex", flexDirection:"column", alignItems:"center",
              justifyContent:"center", padding:"8px 2px 6px", border:"none",
              background: active ? acc.bg10 : "transparent",
              cursor:"pointer", fontFamily:"inherit", transition:"all .12s",
              borderTop: active ? `2px solid ${acc.accent}` : "2px solid transparent",
              marginTop: -2,
            }}>
              <Icon as={n.icon} size={20} strokeWidth={active ? 2 : 1.75}
                color={active ? acc.accent : "rgba(255,255,255,0.45)"} />
              <span style={{
                fontSize:9, fontWeight: active ? 700 : 500, marginTop:4,
                color: active ? acc.accent : "rgba(255,255,255,0.45)",
                letterSpacing:.3, textTransform:"uppercase",
              }}>{n.label}</span>
            </button>
          );
        })}
        {useSheet && (
          <button onClick={() => setSheetOpen(true)} style={{
            flex:1, display:"flex", flexDirection:"column", alignItems:"center",
            justifyContent:"center", padding:"8px 2px 6px", border:"none",
            background: sheetActive ? acc.bg10 : "transparent",
            cursor:"pointer", fontFamily:"inherit", transition:"all .12s",
            borderTop: sheetActive ? `2px solid ${acc.accent}` : "2px solid transparent",
            marginTop: -2,
          }}>
            <Icon as={Menu} size={20} strokeWidth={sheetActive ? 2 : 1.75}
              color={sheetActive ? acc.accent : "rgba(255,255,255,0.45)"} />
            <span style={{
              fontSize:9, fontWeight: sheetActive ? 700 : 500, marginTop:4,
              color: sheetActive ? acc.accent : "rgba(255,255,255,0.45)",
              letterSpacing:.3, textTransform:"uppercase",
            }}>Plus</span>
          </button>
        )}
      </div>

      {sheetOpen && (
        <MoreSheet
          items={sheetItems}
          currentPage={page}
          onSelect={handleSelect}
          onClose={() => setSheetOpen(false)}
          T={T}
          acc={acc}
        />
      )}
    </>
  );
}

// ─── FEUILLE MODALE « PLUS » (MOBILE) ─────────────────────────────────────────
function MoreSheet({ items, currentPage, onSelect, onClose, T, acc }) {
  // Empêche le scroll du body pendant l'ouverture de la feuille
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      onClick={onClose}
      style={{
        position:"fixed", inset:0, zIndex:300,
        background:"rgba(0,0,0,0.55)",
        display:"flex", alignItems:"flex-end",
        animation:"moreSheetFadeIn .15s ease-out",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width:"100%", maxHeight:"85vh", overflowY:"auto",
          background: T.surface, color: T.text,
          borderRadius:"20px 20px 0 0",
          borderTop:`2px solid ${acc.accent}`,
          paddingBottom:"calc(env(safe-area-inset-bottom) + 12px)",
          animation:"moreSheetSlideUp .22s ease-out",
        }}
      >
        {/* Poignée */}
        <div style={{ display:"flex", justifyContent:"center", padding:"10px 0 4px" }}>
          <div style={{ width:40, height:4, borderRadius:2, background:T.border }}/>
        </div>

        {/* En-tête */}
        <div style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"6px 18px 12px", borderBottom:`1px solid ${T.border}`,
        }}>
          <span style={{ fontSize:13, fontWeight:700, letterSpacing:.5, textTransform:"uppercase", color:T.textSub }}>
            Toutes les pages
          </span>
          <button onClick={onClose} aria-label="Fermer" style={{
            background:"transparent", border:"none", cursor:"pointer",
            color:T.textSub, padding:6, display:"flex", alignItems:"center", justifyContent:"center",
            borderRadius:RADIUS.md,
          }}>
            <Icon as={X} size={20}/>
          </button>
        </div>

        {/* Liste des pages */}
        <div style={{ padding:"8px 10px 4px" }}>
          {items.map(n => {
            const active = currentPage === n.id;
            return (
              <button key={n.id} onClick={() => onSelect(n.id)} style={{
                width:"100%", display:"flex", alignItems:"center", gap:14,
                padding:"14px 14px", border:"none", borderRadius:RADIUS.md,
                background: active ? acc.bg10 : "transparent",
                color: active ? acc.accent : T.text,
                cursor:"pointer", fontFamily:"inherit", fontSize:15,
                fontWeight: active ? 700 : 500, textAlign:"left",
                marginBottom:2,
              }}>
                <Icon as={n.icon} size={20} strokeWidth={active ? 2 : 1.75}
                  color={active ? acc.accent : T.textSub}/>
                <span style={{ flex:1 }}>{n.longLabel}</span>
                {active && <span style={{ width:4, height:18, borderRadius:2, background:acc.accent }}/>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function Sidebar({
  page, setPage, T, role = "admin", branch = "renovation",
  rolePages = null,
  // Tout l'ancien contenu de la topbar :
  profil, theme, setTheme, onLogout, peutChangerBranche, onRetourPortail,
  syncing = false, connected = true, lastSync = null,
}) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar_collapsed") === "1");
  const acc = getBranchAccent(branch);

  const allNav = [
    { id:"dashboard",        icon:LayoutDashboard, label:"Tableau de bord"  },
    { id:"chantiers",        icon:HardHat,         label:"Chantiers"        },
    { id:"planning",         icon:Calendar,        label:"Planning semaine" },
    { id:"planning-mensuel", icon:CalendarDays,    label:"Planning mensuel" },
    { id:"notes-todo",       icon:ClipboardList,   label:"Notes & To-do"    },
    { id:"commandes",        icon:Package,         label:"Commandes"        },
    { id:"planning-commandes", icon:ShoppingCart,  label:"Planning commandes" },
    { id:"equipe",           icon:Users,           label:"Équipe"           },
    { id:"plans",            icon:Ruler,           label:"Plans"            },
    { id:"phasage",          icon:ListChecks,      label:"Phasage"          },
    { id:"bibliotheque",     icon:BookOpen,        label:"Biblio. ouvrages" },
    { id:"biblio-materiaux", icon:Layers,          label:"Biblio. matériaux"},
    { id:"visite",           icon:Search,          label:"Visites chantier" },
    { id:"info-client",      icon:IdCard,          label:"Infos Client"     },
    { id:"compte-rendu",     icon:FileText,        label:"Compte rendu client"},
    { id:"dashboard-analyse",icon:TrendingUp,      label:"Dashboard Analyse"  },
    { id:"admin",            icon:Settings,        label:"Réglages"         },
  ];

  const allowed = (rolePages && rolePages[role]) || ROLE_PAGES[role] || ROLE_PAGES.admin;
  const nav = allNav.filter(n => allowed.includes(n.id));

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar_collapsed", next ? "1" : "0");
  };

  const switchTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
  };

  const W = collapsed ? 64 : 220;
  const sidebarBtnStyle = (color, bgHover) => ({
    display:"flex", alignItems:"center", justifyContent:"center",
    width: 32, height: 32, borderRadius: RADIUS.md,
    background: "transparent", border:"none", cursor:"pointer",
    color: color, transition:"background .15s",
    flexShrink: 0,
  });

  return (
    <div style={{
      width:W, flexShrink:0, background:T.sidebar, borderRight:`1px solid ${T.sidebarBorder}`,
      display:"flex", flexDirection:"column", position:"sticky", top:0, height:"100vh", zIndex:50,
      transition:"width .2s ease", overflow:"hidden",
    }}>

      {/* Logo + toggle */}
      <div style={{
        padding: collapsed ? "14px 0" : "16px 14px 12px",
        display:"flex", alignItems:"center",
        justifyContent: collapsed ? "center" : "space-between",
        gap:8, flexShrink:0, borderBottom:`1px solid ${T.sidebarBorder}`,
      }}>
        {!collapsed && (
          <img src={LOGO_RENO_H} alt="Profero Rénovation" style={{ height:44, objectFit:"contain", objectPosition:"left" }}/>
        )}
        {collapsed && (
          <div style={{ width:44, height:44, borderRadius:RADIUS.md, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <img src={LOGO_RENO_V} alt="P" style={{ width:44, height:44, objectFit:"contain" }}/>
          </div>
        )}
        <button onClick={toggle} title={collapsed ? "Agrandir le menu" : "Réduire le menu"} style={{
          background:"rgba(255,255,255,0.06)", border:"none", borderRadius:RADIUS.md,
          width:28, height:28, cursor:"pointer", color:"rgba(255,255,255,0.5)",
          display:"flex", alignItems:"center", justifyContent:"center",
          flexShrink:0, transition:"background .15s",
        }}
        onMouseEnter={e => e.currentTarget.style.background = acc.bg20}
        onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}>
          <Icon as={collapsed ? ChevronRight : ChevronLeft} size={14} />
        </button>
      </div>

      {/* Nav items */}
      <nav style={{ flex:1, padding: collapsed ? "8px 6px" : "8px", overflowY:"auto" }}>
        {nav.map(n => {
          const active = page === n.id;
          const separateur = n.id === "info-client";
          return (
            <React.Fragment key={n.id}>
              {separateur && (
                <div style={{
                  height:1, background:acc.bg20,
                  margin: collapsed ? "8px 4px" : "8px 10px",
                }}/>
              )}
              <button
                onClick={() => setPage(n.id)}
                title={collapsed ? n.label : ""}
                style={{
                  width:"100%", display:"flex", alignItems:"center",
                  justifyContent: collapsed ? "center" : "flex-start",
                  gap:12, padding: collapsed ? "11px 0" : "10px 12px",
                  borderRadius:RADIUS.md, border:"none", cursor:"pointer", fontFamily:"inherit",
                  fontSize:13.5, fontWeight: active ? 700 : 500, letterSpacing:.1,
                  background: active ? acc.bg10 : "transparent",
                  color: active ? acc.accent : "rgba(255,255,255,0.55)",
                  marginBottom:2, transition:"background .12s, color .12s", textAlign:"left",
                  whiteSpace:"nowrap",
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                <Icon as={n.icon} size={18} strokeWidth={active ? 2 : 1.75}
                  style={{ flexShrink:0 }} />
                {!collapsed && <>
                  <span style={{ flex:1 }}>{n.label}</span>
                  {active && <span style={{ width:3, height:18, borderRadius:2, background:acc.accent, display:"block" }}/>}
                </>}
              </button>
            </React.Fragment>
          );
        })}
      </nav>

      {/* ── Sync indicator ── */}
      <div style={{
        padding: collapsed ? "8px 0" : "10px 14px",
        borderTop:`1px solid ${T.sidebarBorder}`,
        display:"flex",
        alignItems:"center",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: 8,
        flexShrink:0,
      }} title={syncing ? "Synchronisation en cours" : connected ? "En ligne" : "Hors ligne"}>
        <span style={{
          width:8, height:8, borderRadius:"50%",
          background: syncing ? "#f5a623" : connected ? "#22c55e" : "#ef4444",
          flexShrink:0,
          animation: connected && !syncing ? "pulse 2s infinite" : "none",
        }}/>
        {!collapsed && (
          <span style={{ fontSize: FONT.xs.size + 1, color: "rgba(255,255,255,0.55)", letterSpacing: .2 }}>
            {syncing ? "Synchronisation…" : connected ? `En ligne${lastSync ? ` · ${lastSync.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}` : ""}` : "Hors ligne"}
          </span>
        )}
      </div>

      {/* ── User info ── */}
      {profil && !collapsed && (
        <div style={{
          padding:"10px 14px",
          borderTop:`1px solid ${T.sidebarBorder}`,
          display:"flex", flexDirection:"column", gap:1,
          flexShrink:0,
        }}>
          <span style={{ fontSize: FONT.sm.size, fontWeight:700, color:"#fff", letterSpacing:.1,
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
          }}>{profil?.nom || profil?.email}</span>
          <span style={{ fontSize: FONT.xs.size, letterSpacing:.8, textTransform:"uppercase",
            color: acc.accent, opacity:.75, fontWeight:600,
          }}>{ROLE_LABELS[role] || role}</span>
        </div>
      )}

      {/* ── Action buttons : Portail / Theme / Logout ── */}
      <div style={{
        padding: collapsed ? "8px 6px 10px" : "10px 12px 12px",
        borderTop:`1px solid ${T.sidebarBorder}`,
        display:"flex",
        flexDirection: collapsed ? "column" : "row",
        gap: collapsed ? 4 : 6,
        flexShrink:0,
        alignItems:"center",
        justifyContent: collapsed ? "center" : "space-between",
      }}>
        {peutChangerBranche && (
          <button onClick={onRetourPortail} title="Retour au portail"
            style={sidebarBtnStyle(acc.accent)}
            onMouseEnter={e => e.currentTarget.style.background = acc.bg10}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <Icon as={LayoutGrid} size={16}/>
          </button>
        )}
        <button onClick={switchTheme} title={theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre"}
          style={sidebarBtnStyle("rgba(255,255,255,0.55)")}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <Icon as={theme === "dark" ? Sun : Moon} size={16}/>
        </button>
        <button onClick={onLogout} title="Se déconnecter"
          style={sidebarBtnStyle("#e15a5a")}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(225,90,90,0.10)"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <Icon as={LogOut} size={16}/>
        </button>
      </div>
    </div>
  );
}

export { useIsMobile, BottomNav, Sidebar };
