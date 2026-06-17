import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, useMemo } from "react";
import { supabase } from "../supabase";
import { LOGO_INVEST_H, LOGO_INVEST_V, FONT, RADIUS, SPACING, SEMANTIC, getBranchAccent } from "../constants";
import { Icon } from "../ui";
import { loadAccessConfig, canAccess as canAccessInvest, ROLE_PAGES_DEFAULT_INVEST, PAGES_INVEST } from "../access";
import { OngletAcces } from "../Renovation/Admin";
import {
  LayoutDashboard, Users, UserPlus, Building2, BarChart3, Settings, Plus, Trash2,
  Pencil, ChevronRight, ChevronLeft, Search, RefreshCw, Save, Download,
  X, Check, Phone, Calendar, MessageSquare, FileText, Mail, Home,
  TrendingUp, Wallet, Euro, MapPin, ExternalLink, Filter, ArrowLeft,
  Lock, AlertTriangle, ChevronDown, ChevronUp, Eye, Image as ImageIcon,
  Upload, Copy, Sparkles, Sun, Moon, LogOut, LayoutGrid, Send, Phone as PhoneIcon,
  Handshake, Bell, Briefcase, Hammer,
} from "lucide-react";

import {
  INVEST_ACC, LOT_TYPES, NIVEAUX, MAX_LOTS, GESTION_PRICES, DEFAULT_LOTS, BUDGET_SECTIONS, COMP_FISCA, pmt, fmt, fmtPct, fmtMois, actLots, initBudgetState, openFicheClientInvestisseurPDF, THEMES_INV, SU, WA, DA, IN, getCSS, CSS, NumInput, ETAPES_CLIENT, TYPES_PLANNING_INVEST, isoDate, getWeekRange, isActionLateOrThisWeek, normTxt, compareValues, SortableHeader, KPICard, DASH_STAGE_COLORS, fmtDashboardEur, fmtDashboardPct, safeDate, daysBetween, isFilledDash, getClientName, getBienLabel, getBienScore, isBienFicheComplete, hasSimulateurBien, isGeolocBien, CLIENT_STRATEGIES_INVEST, CLIENT_TRAVAUX_ACCEPTES, CLIENT_URGENCE_INVEST, CLIENT_FISCALITES_INVEST, OFFRE_STATUTS_INVEST, CLIENT_DOCUMENT_CHECKLIST, BIEN_DOCUMENT_CHECKLIST, emptyClientStrategy, clientStrategy, checklistPct, getNumberLoose, bienTotalCost, bienLotsCount, computeAutoBienScore, computeClientBienMatch, DashboardPanel, DashboardAlertList, FILE_ICONS, DOCUMENT_CATEGORIES_BIEN, GOOGLE_DRIVE_API_KEY, GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_APP_ID, GOOGLE_DRIVE_SCOPE, GOOGLE_DRIVE_LINKS_TABLE, getGoogleDriveConfig, GOOGLE_DRIVE_SCRIPT_PROMISES, loadExternalScriptOnce, GOOGLE_DRIVE_FOLDER_MIME, GOOGLE_DRIVE_SHORTCUT_MIME, isGoogleDriveFolderMime, isGoogleDriveShortcutMime, getDriveEffectiveId, getDriveEffectiveMimeType, isGoogleDriveFolderItem, isGoogleDriveShortcutItem, getDriveUrlForDoc, normalizeDriveDoc, getFileIcon, fmtSize, GoogleDriveLinksSection, DocumentsSection, MISSION_COLLABORATEURS, HONORAIRE_BASE_CONTRAT_HT, HONORAIRE_CONSEIL_MOYEN_HT, STATUTS_PROP, CompletionBar
} from "./_shared";
import TableauBord from "./Dashboard";
import Prospection from "./Prospection";
import CRM from "./CRM";
import StockBiens from "./Biens";
import DashboardFinancier from "./Finance";
import SuiviFinancier from "./SuiviFinancier";
import StructurationPatrimoniale from "./Structuration";
import AdminInvest from "./Admin";
import Simulateur, { ListeProjets } from "./Simulateur";
import Sourcing from "./Sourcing";

const INVEST_PAGES_BASE = [
  { id: "dashboard", label: "Tableau de bord" },
  { id: "prospection", label: "Prospection" },
  { id: "crm", label: "CRM Clients" },
  { id: "sourcing", label: "Sourcing" },
  { id: "biens", label: "Biens" },
  { id: "simulateur", label: "Simulateur" },
  { id: "structuration", label: "Structuration" },
  { id: "finance", label: "Finance" },
  { id: "suivi_financier", label: "Suivi financier" },
  { id: "admin", label: "Admin" },
];

const INVEST_PAGES_FALLBACK = INVEST_PAGES_BASE.map(p => p.id);

function getInvestPagesList() {
  const existing = Array.isArray(PAGES_INVEST) ? PAGES_INVEST : [];
  const byId = new Map();

  for (const p of existing) {
    if (p?.id) byId.set(p.id, { ...p });
  }

  for (const p of INVEST_PAGES_BASE) {
    if (!byId.has(p.id)) byId.set(p.id, { ...p });
  }

  const order = INVEST_PAGES_BASE.map(p => p.id);

  return Array.from(byId.values()).sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function uniquePages(pages = []) {
  return Array.from(new Set((Array.isArray(pages) ? pages : []).filter(Boolean)));
}

function getInvestAllowedPages(rolePages, role) {
  const pagesFromConfig = rolePages?.[role];
  const pagesFromDefaultRole = ROLE_PAGES_DEFAULT_INVEST?.[role];
  const pagesFromAdmin = ROLE_PAGES_DEFAULT_INVEST?.admin;

  let allowed = null;

  if (Array.isArray(pagesFromConfig)) allowed = pagesFromConfig;
  else if (Array.isArray(pagesFromDefaultRole)) allowed = pagesFromDefaultRole;
  else if (Array.isArray(pagesFromAdmin)) allowed = pagesFromAdmin;
  else allowed = INVEST_PAGES_FALLBACK;

  const normalized = uniquePages(allowed);

  // Sécurité : l'admin doit toujours pouvoir voir les nouvelles pages,
  // même si l'ancienne configuration Supabase access_pages_invest ne les contient pas encore.
  if (role === "admin" && !normalized.includes("prospection")) {
    normalized.splice(1, 0, "prospection");
  }
  if (role === "admin" && !normalized.includes("sourcing")) {
    const insertIndex = normalized.includes("crm") ? normalized.indexOf("crm") + 1 : normalized.length;
    normalized.splice(insertIndex, 0, "sourcing");
  }

  return normalized;
}

function canSeeInvestPage(rolePages, role, pageId) {
  const allowed = getInvestAllowedPages(rolePages, role);

  if (allowed.includes(pageId)) return true;

  try {
    return !!canAccessInvest(rolePages, role, pageId);
  } catch {
    return false;
  }
}

function SidebarInvest({ page, setPage, theme, setTheme, profil, onRetourPortail, onLogout, rolePages = null }) {
  const role = profil?.role || "admin";
  const T = THEMES_INV[theme];
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("invest_sidebar_collapsed") === "1");

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("invest_sidebar_collapsed", next ? "1" : "0");
  };

  // Icônes par page Invest (utilisé pour mapper la liste PAGES_INVEST)
  const ICONS = {
    dashboard:  LayoutDashboard,
    prospection: UserPlus,
    crm:        Users,
    sourcing:   Search,
    biens:      Building2,
    simulateur: BarChart3,
    finance:    Wallet,
    suivi_financier: Euro,
    structuration: Briefcase,
    admin:      Settings,
  };

  // Construction de la nav depuis PAGES_INVEST, filtrée par les pages autorisées
  // pour le rôle courant (config dynamique avec fallback ROLE_PAGES_DEFAULT_INVEST).
  const allowed = getInvestAllowedPages(rolePages, role);
  const NAV = getInvestPagesList()
    .filter(p => p?.id && allowed.includes(p.id))
    .map(p => ({ id: p.id, label: p.label, icon: ICONS[p.id] || LayoutDashboard }));

  const W = collapsed ? 64 : 220;

  // Bouton footer icône-only 32×32 (même pattern que Profero Rénovation)
  const sidebarBtnStyle = (color) => ({
    display:"flex", alignItems:"center", justifyContent:"center",
    width:32, height:32, borderRadius:RADIUS.md,
    background:"transparent", border:"none", cursor:"pointer",
    color, transition:"background .15s", flexShrink:0,
  });

  return (
    <div style={{
      width:W, flexShrink:0, background:T.sidebar, borderRight:`1px solid ${T.sidebarBorder}`,
      display:"flex", flexDirection:"column", height:"100%",
      transition:"width .2s ease", overflow:"hidden",
    }}>
      {/* Header + toggle */}
      <div style={{
        padding: collapsed ? "14px 0" : `${SPACING.lg}px ${SPACING.md+2}px ${SPACING.md}px`,
        borderBottom:`1px solid ${T.sidebarBorder}`, display:"flex", alignItems:"center",
        justifyContent: collapsed ? "center" : "space-between", gap:SPACING.sm, flexShrink:0,
      }}>
        {!collapsed
          ? <img src={LOGO_INVEST_H} alt="Profero Invest" style={{ height:44, objectFit:"contain", objectPosition:"left" }}/>
          : <img src={LOGO_INVEST_V} alt="P" style={{ width:44, height:44, objectFit:"contain", borderRadius:RADIUS.sm }}/>
        }
        <button onClick={toggle} title={collapsed ? "Agrandir" : "Réduire"} style={{
          background:"rgba(255,255,255,0.06)", border:"none", borderRadius:RADIUS.md,
          width:28, height:28, cursor:"pointer", color:T.textMuted,
          display:"flex", alignItems:"center", justifyContent:"center",
          flexShrink:0, transition:"all .15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = T.accentBg; e.currentTarget.style.color = T.accent; }}
        onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = T.textMuted; }}>
          <Icon as={collapsed ? ChevronRight : ChevronLeft} size={14}/>
        </button>
      </div>

      {/* Nav */}
      <nav style={{ flex:1, padding: collapsed ? `${SPACING.sm}px ${SPACING.xs+2}px` : `${SPACING.sm}px`, overflowY:"auto" }}>
        {NAV.map(n => {
          const active = page === n.id;
          return (
            <button key={n.id} onClick={() => setPage(n.id)}
              title={collapsed ? n.label : ""}
              style={{
                width:"100%", display:"flex", alignItems:"center",
                justifyContent: collapsed ? "center" : "flex-start",
                gap:SPACING.md-2, padding: collapsed ? `${SPACING.md-1}px 0` : `${SPACING.md-1}px ${SPACING.md+2}px`,
                borderRadius:RADIUS.lg, border:"none", cursor:"pointer",
                fontFamily:"'Barlow Condensed',sans-serif", fontSize:FONT.md.size,
                fontWeight: active ? 700 : 500, letterSpacing:0.3,
                background: active ? T.accentBg : "transparent",
                color: active ? T.accent : T.textMuted,
                marginBottom:SPACING.xs-1, transition:"all .12s", textAlign:"left", whiteSpace:"nowrap",
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.color = T.textSub; }}}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = T.textMuted; }}}>
              <Icon as={n.icon} size={18} strokeWidth={active ? 2 : 1.75}/>
              {!collapsed && <span style={{ flex:1 }}>{n.label}</span>}
              {!collapsed && active && <span style={{ width:4, height:18, borderRadius:2, background:T.accent, flexShrink:0 }}/>}
            </button>
          );
        })}
      </nav>

      {/* Sync indicator (factice mais cohérent avec Profero Rénovation) */}
      <div style={{
        padding: collapsed ? `${SPACING.sm}px 0` : `${SPACING.sm+2}px ${SPACING.md+2}px`,
        borderTop:`1px solid ${T.sidebarBorder}`,
        display:"flex", alignItems:"center",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: SPACING.sm, flexShrink:0,
      }} title="En ligne">
        <span style={{
          width:8, height:8, borderRadius:"50%",
          background:"#22c55e", flexShrink:0,
          animation:"pulse 2s infinite",
        }}/>
        {!collapsed && (
          <span style={{ fontSize:FONT.xs.size+1, color:T.textSub, letterSpacing:0.2 }}>
            En ligne
          </span>
        )}
      </div>

      {/* User info */}
      {profil && !collapsed && (
        <div style={{
          padding:`${SPACING.sm+2}px ${SPACING.md+2}px`, borderTop:`1px solid ${T.sidebarBorder}`,
          display:"flex", flexDirection:"column", gap:1, flexShrink:0,
        }}>
          <span style={{ fontSize:FONT.sm.size, fontWeight:700, color:T.text, letterSpacing:0.1,
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
          }}>{profil?.nom || profil?.email}</span>
          <span style={{ fontSize:FONT.xs.size, letterSpacing:0.8, textTransform:"uppercase",
            color: T.accent, opacity:0.85, fontWeight:600,
          }}>{profil?.role || "—"}</span>
        </div>
      )}

      {/* Boutons bas — icône-only 32×32 (style Profero Rénovation) */}
      <div style={{
        padding: collapsed ? `${SPACING.sm}px ${SPACING.xs+2}px ${SPACING.md-2}px` : `${SPACING.sm+2}px ${SPACING.md}px ${SPACING.md-1}px`,
        borderTop:`1px solid ${T.sidebarBorder}`,
        display:"flex", flexDirection: collapsed ? "column" : "row",
        gap: collapsed ? SPACING.xs : SPACING.xs+2, flexShrink:0,
        alignItems:"center", justifyContent: collapsed ? "center" : "space-between",
      }}>
        {onRetourPortail && (
          <button onClick={onRetourPortail} title="Retour au portail"
            style={sidebarBtnStyle(T.accent)}
            onMouseEnter={e => e.currentTarget.style.background = T.accentBg}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <Icon as={LayoutGrid} size={16}/>
          </button>
        )}
        <button onClick={() => { const n = theme==="dark"?"light":"dark"; setTheme(n); localStorage.setItem("invest_theme",n); }}
          title={theme==="dark" ? "Mode clair" : "Mode sombre"}
          style={sidebarBtnStyle(T.textSub)}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <Icon as={theme==="dark" ? Sun : Moon} size={16}/>
        </button>
        <button onClick={onLogout} title="Se déconnecter"
          style={sidebarBtnStyle("#e15a5a")}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(225,90,90,0.10)"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <Icon as={LogOut} size={16}/>
        </button>
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}

// ─── ACCÈS REFUSÉ (vue interne Invest) ───────────────────────────────────────
function AccesRefuseInvest({ T, page }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column",
      gap: 14, padding: 40, minHeight: 400, color: T.textMuted, textAlign: "center",
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: 16,
        background: "rgba(225,90,90,0.10)", color: "#e15a5a",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon as={Lock} size={28} strokeWidth={1.5}/>
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>Accès refusé</div>
      <div style={{ fontSize: 13, maxWidth: 400, lineHeight: 1.5 }}>
        Vous n'avez pas accès à cette page{page ? ` (« ${page} »)` : ""}. Contactez un administrateur si vous pensez qu'il s'agit d'une erreur.
      </div>
    </div>
  );
}

// ─── PAGE INVEST (routeur interne) ────────────────────────────────────────────
export default function PageInvest({ profil, onRetourPortail, onLogout }) {
  const [theme, setTheme] = useState(() => localStorage.getItem("invest_theme") || "dark");
  const T = THEMES_INV[theme];
  const CSS = getCSS(T);
  const [page, setPage]                 = useState("dashboard");
  const [projetOuvert, setProjetOuvert] = useState(null);
  const [vueSim, setVueSim]             = useState("liste");
  const [crmInitialFilter, setCrmInitialFilter] = useState(null);
  const [biensInitialFilter, setBiensInitialFilter] = useState(null);
  const [structInitialClientId, setStructInitialClientId] = useState(null);

  // Config d'accès Invest (chargée depuis planning_config, fallback hardcodé)
  const role = profil?.role || "admin";
  const [rolePages, setRolePages] = React.useState(ROLE_PAGES_DEFAULT_INVEST);
  React.useEffect(() => {
    let cancelled = false;
    loadAccessConfig("invest").then(({ rolePages: rp }) => {
      if (!cancelled) setRolePages(rp);
    });
    const ch = supabase.channel("access-invest")
      .on("postgres_changes",
          { event: "*", schema: "public", table: "planning_config", filter: "key=eq.access_pages_invest" },
          () => loadAccessConfig("invest").then(({ rolePages: rp }) => setRolePages(rp)))
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, []);
  const canSee = (p) => canSeeInvestPage(rolePages, role, p);
  // Origine de l'ouverture du Simulateur : "liste" (depuis Simulateur) ou "crm"
  // (depuis FicheClient). Détermine où on retombe au "← Retour".
  const [simOrigine, setSimOrigine]     = useState("liste");

  const ouvrirProjet  = (p) => { setProjetOuvert(p); setVueSim("simulateur"); setSimOrigine("liste"); };
  const nouveauProjet = ()  => { setProjetOuvert(null); setVueSim("simulateur"); setSimOrigine("liste"); };
  // Appelé depuis FicheClient pour ouvrir une simulation (existante ou nouvelle pour ce client)
  const ouvrirSimulationDepuisCRM = (p) => {
    setProjetOuvert(p);
    setSimOrigine("crm");
    setVueSim("simulateur");
    setPage("simulateur"); // bascule le routeur sur la vue plein écran
  };
  const ouvrirStructurationDepuisClient = (clientId) => {
    setStructInitialClientId(clientId);
    setPage("structuration");
  };
  const ouvrirBienDepuisClient = (bienId) => {
    if (!bienId) return;
    setBiensInitialFilter({ type:"open_bien", bien_id:bienId, _ts: Date.now() });
    setPage("biens");
  };
  const fermerSim = () => {
    setVueSim("liste");
    if (simOrigine === "crm") setPage("crm");
  };

  const naviguerDepuisDashboard = (target, filter) => {
    if (target === "crm") {
      setCrmInitialFilter({ ...(filter || {}), _ts: Date.now() });
      setPage("crm");
    }
    if (target === "biens") {
      setBiensInitialFilter({ ...(filter || {}), _ts: Date.now() });
      setPage("biens");
    }
  };

  const changerPage = (p) => {
    setPage(p);
    if (p !== "crm") setCrmInitialFilter(null);
    if (p !== "biens") setBiensInitialFilter(null);
    if (p !== "structuration") setStructInitialClientId(null);
  };

  // Simulateur plein écran — uniquement quand une fiche projet est ouverte
  if (page === "simulateur" && vueSim === "simulateur") {
    return (
      <div className="inv" style={{ position:"fixed", inset:0, zIndex:9999 }}>
        <style>{CSS}</style>
        <Simulateur projet={projetOuvert} profil={profil} onRetour={fermerSim}
          theme={theme} setTheme={setTheme}/>
      </div>
    );
  }

  return (
    <div className="inv" style={{ position:"fixed", inset:0, zIndex:9999, display:"flex", background:T.bg }}>
      <style>{CSS}</style>
      <SidebarInvest page={page} setPage={changerPage} theme={theme} setTheme={setTheme} profil={profil} onRetourPortail={onRetourPortail} onLogout={onLogout} rolePages={rolePages} />
      <div style={{ flex:1, overflowY:"auto", background:T.bg }}>
        {page === "dashboard"  && (canSee("dashboard")  ? <TableauBord profil={profil} T={T} onNavigate={naviguerDepuisDashboard} />                                      : <AccesRefuseInvest T={T} page="dashboard"/>)}
        {page === "prospection" && (canSee("prospection") ? <Prospection profil={profil} T={T} /> : <AccesRefuseInvest T={T} page="prospection"/>)}
        {page === "crm"        && (canSee("crm")        ? <CRM profil={profil} T={T} initialFilter={crmInitialFilter} onOuvrirSimulation={ouvrirSimulationDepuisCRM} onOpenStructuration={ouvrirStructurationDepuisClient} onOpenBien={ouvrirBienDepuisClient} />        : <AccesRefuseInvest T={T} page="crm"/>)}
        {page === "sourcing"   && (canSee("sourcing")   ? <Sourcing profil={profil} T={T} /> : <AccesRefuseInvest T={T} page="sourcing"/>)}
        {page === "biens"      && (canSee("biens")      ? <StockBiens profil={profil} T={T} initialFilter={biensInitialFilter} />                                          : <AccesRefuseInvest T={T} page="biens"/>)}
        {page === "structuration" && (canSee("structuration") ? <StructurationPatrimoniale profil={profil} T={T} initialClientId={structInitialClientId} /> : <AccesRefuseInvest T={T} page="structuration"/>)}
        {page === "finance"    && (canSee("finance")    ? <DashboardFinancier profil={profil} T={T} />                                        : <AccesRefuseInvest T={T} page="finance"/>)}
        {page === "suivi_financier" && (canSee("suivi_financier") ? <SuiviFinancier profil={profil} T={T} /> : <AccesRefuseInvest T={T} page="suivi_financier"/>)}
        {page === "admin"      && (canSee("admin")      ? <AdminInvest profil={profil} T={T} theme={theme} setTheme={setTheme} />                                           : <AccesRefuseInvest T={T} page="admin"/>)}
        {page === "simulateur" && (canSee("simulateur") ? (
          <div style={{ padding:"24px 28px", maxWidth:1200, margin:"0 auto" }}>
            <div style={{ fontSize:26, fontWeight:800, color:T.text, letterSpacing:.5, marginBottom:6 }}>Simulateur de projets</div>
            <div style={{ fontSize:14, color:T.textSub, marginBottom:24 }}>Créez et analysez vos projets d'investissement</div>
            <ListeProjets profil={profil} onOuvrir={ouvrirProjet} onNouveauProjet={nouveauProjet} inline={true} T={T} />
          </div>
        ) : <AccesRefuseInvest T={T} page="simulateur"/>)}
      </div>
    </div>
  );
}
