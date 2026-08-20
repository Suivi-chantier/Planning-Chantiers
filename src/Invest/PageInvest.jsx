import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, useMemo } from "react";
import { supabase } from "../supabase";
import { LOGO_INVEST_H, LOGO_INVEST_V, FONT, RADIUS, SPACING, SEMANTIC, getBranchAccent } from "../constants";
import { Icon } from "../ui";
import { loadAccessConfig, canAccess as canAccessInvest, ROLE_PAGES_DEFAULT_INVEST, PAGES_INVEST } from "../access";
import { useIsMobile } from "../hooks";
import { OngletAcces } from "../Renovation/Admin";
import {
  LayoutDashboard, Users, UserPlus, Building2, BarChart3, Settings, Plus, Trash2,
  Pencil, ChevronRight, ChevronLeft, Search, RefreshCw, Save, Download,
  X, Check, Phone, Calendar, MessageSquare, FileText, Mail, Home,
  TrendingUp, Wallet, Euro, MapPin, ExternalLink, Filter, ArrowLeft,
  Lock, AlertTriangle, ChevronDown, ChevronUp, Eye, Image as ImageIcon,
  Upload, Copy, Sparkles, Sun, Moon, LogOut, LayoutGrid, Send, Phone as PhoneIcon,
  Handshake, Bell, Briefcase, Hammer, ClipboardList, Landmark,
} from "lucide-react";

import {
  INVEST_ACC, LOT_TYPES, NIVEAUX, MAX_LOTS, GESTION_PRICES, DEFAULT_LOTS, BUDGET_SECTIONS, COMP_FISCA, pmt, fmt, fmtPct, fmtMois, actLots, initBudgetState, openFicheClientInvestisseurPDF, THEMES_INV, SU, WA, DA, IN, getCSS, CSS, NumInput, ETAPES_CLIENT, TYPES_PLANNING_INVEST, isoDate, getWeekRange, isActionLateOrThisWeek, normTxt, compareValues, SortableHeader, KPICard, DASH_STAGE_COLORS, fmtDashboardEur, fmtDashboardPct, safeDate, daysBetween, isFilledDash, getClientName, getBienLabel, getBienScore, isBienFicheComplete, hasSimulateurBien, isGeolocBien, CLIENT_STRATEGIES_INVEST, CLIENT_TRAVAUX_ACCEPTES, CLIENT_URGENCE_INVEST, CLIENT_FISCALITES_INVEST, OFFRE_STATUTS_INVEST, CLIENT_DOCUMENT_CHECKLIST, BIEN_DOCUMENT_CHECKLIST, emptyClientStrategy, clientStrategy, checklistPct, getNumberLoose, bienTotalCost, bienLotsCount, computeAutoBienScore, computeClientBienMatch, DashboardPanel, DashboardAlertList, FILE_ICONS, DOCUMENT_CATEGORIES_BIEN, GOOGLE_DRIVE_API_KEY, GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_APP_ID, GOOGLE_DRIVE_SCOPE, GOOGLE_DRIVE_LINKS_TABLE, getGoogleDriveConfig, GOOGLE_DRIVE_SCRIPT_PROMISES, loadExternalScriptOnce, GOOGLE_DRIVE_FOLDER_MIME, GOOGLE_DRIVE_SHORTCUT_MIME, isGoogleDriveFolderMime, isGoogleDriveShortcutMime, getDriveEffectiveId, getDriveEffectiveMimeType, isGoogleDriveFolderItem, isGoogleDriveShortcutItem, getDriveUrlForDoc, normalizeDriveDoc, getFileIcon, fmtSize, GoogleDriveLinksSection, DocumentsSection, MISSION_COLLABORATEURS, HONORAIRE_BASE_CONTRAT_HT, HONORAIRE_CONSEIL_MOYEN_HT, STATUTS_PROP, CompletionBar,
  NAV, normalizeNavTarget
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
import EtatDesLieux from "./EtatDesLieux";
import Urbanisme from "./Urbanisme";
import { ClocheNotifications } from "./notifications";

const INVEST_PAGES_BASE = [
  { id: "dashboard", label: "Tableau de bord" },
  { id: "prospection", label: "Prospection" },
  { id: "crm", label: "CRM Clients" },
  { id: "sourcing", label: "Sourcing" },
  { id: "biens", label: "Biens" },
  { id: "simulateur", label: "Simulateur" },
  { id: "etat_des_lieux", label: "État des lieux" },
  { id: "urbanisme", label: "Urbanisme" },
  { id: "structuration", label: "Structuration" },
  { id: "finance", label: "Finance" },
  { id: "suivi_financier", label: "Suivi financier" },
  { id: "admin", label: "Admin" },
];

const INVEST_PAGES_FALLBACK = INVEST_PAGES_BASE.map(p => p.id);
// Ordre de priorité pour la barre du bas sur téléphone.
//
// Volontairement DIFFÉRENT de l'ordre de la barre latérale, qui suit le
// parcours métier de gauche à droite sur grand écran. Un téléphone sert
// d'autres usages :
//   • États des lieux — saisi sur place, photos prises avec l'appareil. C'est
//     LE cas d'usage mobile du module.
//   • Biens — consulter une fiche en déplacement.
//   • CRM — appeler un client, retrouver une action.
//   • Tableau de bord — voir ce qui est dû.
//
// Quatre entrées maximum : au-delà, les libellés deviennent illisibles sur un
// écran de 375 px. Le reste passe dans la feuille « Plus ».
const INVEST_PRIORITE_MOBILE = ["dashboard", "crm", "biens", "etat_des_lieux"];
const INVEST_MOBILE_MAX = 4;

// Répartit les pages autorisées entre la barre du bas et la feuille « Plus ».
function repartirPourMobile(nav) {
  const parId = new Map(nav.map(n => [n.id, n]));
  const barre = [];
  for (const id of INVEST_PRIORITE_MOBILE) {
    const item = parId.get(id);
    if (item && barre.length < INVEST_MOBILE_MAX) { barre.push(item); parId.delete(id); }
  }
  // Si le rôle n'a pas accès aux pages prioritaires, on complète dans l'ordre
  // de la barre latérale plutôt que de laisser des trous.
  for (const n of nav) {
    if (barre.length >= INVEST_MOBILE_MAX) break;
    if (parId.has(n.id)) { barre.push(n); parId.delete(n.id); }
  }
  return { barre, reste: nav.filter(n => parId.has(n.id)) };
}


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

  // Filet de sécurité : une configuration `access_pages_invest` enregistrée en
  // base avant l'ajout d'une page ne la contient pas, et l'admin se retrouverait
  // sans accès à sa propre configuration d'accès.
  //
  // Quatre `splice` codés en dur remplissaient ce rôle page par page. Ils
  // rendaient les oublis invisibles : `sourcing` était absent de access.js et
  // personne ne l'a vu, parce que l'admin — le seul à tester — voyait l'onglet
  // grâce à la rustine. Les autres rôles ne l'ont jamais eu, et l'écran Admin
  // ne pouvait même pas l'accorder puisqu'il construit sa liste depuis
  // PAGES_INVEST.
  //
  // Désormais l'admin reçoit la liste de référence complète, sans énumération
  // à maintenir : une page ajoutée à INVEST_PAGES_BASE lui parvient seule.
  if (role === "admin") {
    for (const p of INVEST_PAGES_FALLBACK) {
      if (!normalized.includes(p)) normalized.push(p);
    }
    // On rétablit l'ordre de référence plutôt que d'empiler en fin de liste.
    normalized.sort((a, b) => {
      const ia = INVEST_PAGES_FALLBACK.indexOf(a);
      const ib = INVEST_PAGES_FALLBACK.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
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

// Feuille « Plus » : les onglets qui ne tiennent pas dans la barre du bas.
function FeuillePlus({ items, page, onChoisir, onFermer, T }) {
  // Le fond ne doit pas défiler derrière la feuille.
  useEffect(() => {
    const avant = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = avant; };
  }, []);

  useEffect(() => {
    const echap = (e) => { if (e.key === "Escape") onFermer(); };
    document.addEventListener("keydown", echap);
    return () => document.removeEventListener("keydown", echap);
  }, [onFermer]);

  return (
    <div onClick={onFermer} style={{
      position:"fixed", inset:0, zIndex:300, background:"rgba(0,0,0,.5)",
      display:"flex", alignItems:"flex-end",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width:"100%", background:T.sidebar, borderTop:`2px solid ${T.accent}`,
        borderRadius:"16px 16px 0 0", maxHeight:"78vh", overflowY:"auto",
        paddingBottom:"calc(12px + env(safe-area-inset-bottom))",
      }}>
        <div style={{
          display:"flex", justifyContent:"space-between", alignItems:"center",
          padding:"14px 18px 10px", borderBottom:`1px solid ${T.sidebarBorder}`,
          position:"sticky", top:0, background:T.sidebar,
        }}>
          <strong style={{ color:T.text, fontSize:16 }}>Autres onglets</strong>
          <button onClick={onFermer} aria-label="Fermer" style={{
            background:"transparent", border:"none", color:T.textMuted,
            cursor:"pointer", padding:6, display:"flex",
          }}><Icon as={X} size={20}/></button>
        </div>
        {items.map(n => {
          const actif = page === n.id;
          return (
            <button key={n.id} onClick={() => { onChoisir(n.id); onFermer(); }} style={{
              width:"100%", display:"flex", alignItems:"center", gap:14,
              padding:"15px 18px", border:"none", cursor:"pointer",
              background: actif ? T.accentBg : "transparent",
              color: actif ? T.accent : T.textSub,
              fontFamily:"inherit", fontSize:15.5, fontWeight: actif ? 800 : 600,
              textAlign:"left", borderBottom:`1px solid ${T.sidebarBorder}`,
            }}>
              <Icon as={n.icon} size={20} strokeWidth={actif ? 2 : 1.75}/>
              <span style={{ flex:1 }}>{n.label}</span>
              {actif && <span style={{ width:6, height:6, borderRadius:"50%", background:T.accent }}/>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Barre de navigation du bas, sur téléphone.
//
// Convention iOS et Android : la navigation principale vit en bas, à portée du
// pouce. La barre latérale repliée en bandeau horizontal en haut fonctionnait,
// mais imposait d'atteindre le haut de l'écran à chaque changement d'onglet.
//
// `env(safe-area-inset-bottom)` réserve la place de l'indicateur d'accueil des
// iPhone sans encoche physique : sans lui, la dernière rangée passe dessous.
function BarreBasInvest({ nav, page, setPage, T }) {
  const [feuille, setFeuille] = useState(false);
  const { barre, reste } = repartirPourMobile(nav);
  const resteActif = reste.some(n => n.id === page);

  const bouton = (contenu, actif, onClick, cle, libelle) => (
    <button key={cle} onClick={onClick} aria-label={libelle}
      aria-current={actif ? "page" : undefined}
      style={{
        flex:1, minWidth:0, display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center", gap:3,
        padding:"7px 2px 5px", border:"none", cursor:"pointer",
        background: actif ? T.accentBg : "transparent",
        borderTop: `2px solid ${actif ? T.accent : "transparent"}`,
        marginTop:-2, fontFamily:"inherit", transition:"background .12s",
      }}>
      {contenu}
      <span style={{
        fontSize:9, lineHeight:1.15, fontWeight: actif ? 800 : 600,
        color: actif ? T.accent : T.textMuted, letterSpacing:.2,
        textTransform:"uppercase", maxWidth:"100%", overflow:"hidden",
        textOverflow:"ellipsis", whiteSpace:"nowrap",
      }}>{libelle}</span>
    </button>
  );

  return (
    <>
      <nav className="inv-bottom-nav" aria-label="Navigation principale">
        {barre.map(n => bouton(
          <Icon as={n.icon} size={21} strokeWidth={page === n.id ? 2.2 : 1.75}
            color={page === n.id ? T.accent : T.textMuted}/>,
          page === n.id, () => setPage(n.id), n.id, n.label
        ))}
        {reste.length > 0 && bouton(
          <Icon as={LayoutGrid} size={21} strokeWidth={resteActif ? 2.2 : 1.75}
            color={resteActif ? T.accent : T.textMuted}/>,
          resteActif, () => setFeuille(true), "__plus",
          // Quand l'onglet courant est dans la feuille, son nom vaut mieux
          // que « Plus » : l'utilisateur voit où il est.
          resteActif ? (reste.find(n => n.id === page)?.label || "Plus") : "Plus"
        )}
      </nav>
      {feuille && (
        <FeuillePlus items={reste} page={page} T={T}
          onChoisir={setPage} onFermer={() => setFeuille(false)}/>
      )}
    </>
  );
}

function SidebarInvest({ page, setPage, theme, setTheme, profil, onRetourPortail, onLogout, rolePages = null, onNaviguer = null, onNavItems = null }) {
  const role = profil?.role || "admin";
  const T = THEMES_INV[theme];
  const [replieChoisi, setCollapsed] = useState(() => localStorage.getItem("invest_sidebar_collapsed") === "1");

  // Écran étroit : la barre latérale devient horizontale et l'état « réduit »
  // n'a plus de sens. Il est pourtant mémorisé dans le navigateur — et s'il a
  // été posé depuis un ordinateur, les libellés des onglets ne sont PAS rendus
  // du tout sur téléphone. Aucun CSS ne peut les faire réapparaître : c'est le
  // JSX qui ne les produit pas. D'où cette neutralisation côté état.
  const etroit = useIsMobile();
  const collapsed = etroit ? false : replieChoisi;

  const toggle = () => {
    const next = !replieChoisi;
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
    etat_des_lieux: ClipboardList,
    urbanisme:  Landmark,
    finance:    Wallet,
    suivi_financier: Euro,
    structuration: Briefcase,
    admin:      Settings,
  };

  // Construction de la nav depuis PAGES_INVEST, filtrée par les pages autorisées
  // pour le rôle courant (config dynamique avec fallback ROLE_PAGES_DEFAULT_INVEST).
  const allowed = getInvestAllowedPages(rolePages, role);
  const navItems = getInvestPagesList()
    .filter(p => p?.id && allowed.includes(p.id))
    .map(p => ({ id: p.id, label: p.label, icon: ICONS[p.id] || LayoutDashboard }));

  // La barre du bas a besoin de la même liste, déjà filtrée par les droits.
  // On la remonte plutôt que de recalculer les accès à deux endroits.
  // `page` n'entre pas dans les dépendances : la liste des onglets n'en dépend
  // pas, et l'y mettre déclencherait un setState inutile à chaque changement
  // d'onglet. On compare les identifiants, pas la référence du tableau, qui
  // est recréée à chaque rendu.
  const clefNav = navItems.map(n => n.id).join("|");
  useEffect(() => { onNavItems?.(navItems); }, [onNavItems, clefNav]);   // eslint-disable-line react-hooks/exhaustive-deps

  const W = collapsed ? 64 : 220;

  // Bouton footer icône-only 32×32 (même pattern que Profero Rénovation)
  const sidebarBtnStyle = (color) => ({
    display:"flex", alignItems:"center", justifyContent:"center",
    width:32, height:32, borderRadius:RADIUS.md,
    background:"transparent", border:"none", cursor:"pointer",
    color, transition:"background .15s", flexShrink:0,
  });

  return (
    <div className="inv-sidebar" style={{
      width:W, flexShrink:0, background:T.sidebar, borderRight:`1px solid ${T.sidebarBorder}`,
      display:"flex", flexDirection:"column", height:"100%",
      transition:"width .2s ease", overflow:"hidden",
    }}>
      {/* Header + toggle */}
      <div className="inv-sidebar-head" style={{
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
      {/* Sur téléphone, la navigation vit dans BarreBasInvest : la rendre ici
          aussi doublerait les onglets et volerait la hauteur du bandeau. */}
      {!etroit && <nav style={{ flex:1, padding: collapsed ? `${SPACING.sm}px ${SPACING.xs+2}px` : `${SPACING.sm}px`, overflowY:"auto" }}>
        {navItems.map(n => {
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
              {!collapsed && <span className="inv-nav-label" style={{ flex:1 }}>{n.label}</span>}
              {!collapsed && active && <span style={{ width:4, height:18, borderRadius:2, background:T.accent, flexShrink:0 }}/>}
            </button>
          );
        })}
      </nav>}

      {/* Sync indicator (factice mais cohérent avec Profero Rénovation) */}
      <div style={{
        padding: collapsed ? `${SPACING.sm}px 0` : `${SPACING.sm+2}px ${SPACING.md+2}px`,
        borderTop:`1px solid ${T.sidebarBorder}`,
        display:"flex", alignItems:"center",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: SPACING.sm, flexShrink:0,
      }} className="inv-sync-indicator" title="En ligne">
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
        <div className="inv-user-info" style={{
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
      <div className="inv-sidebar-actions" style={{
        padding: collapsed ? `${SPACING.sm}px ${SPACING.xs+2}px ${SPACING.md-2}px` : `${SPACING.sm+2}px ${SPACING.md}px ${SPACING.md-1}px`,
        borderTop:`1px solid ${T.sidebarBorder}`,
        display:"flex", flexDirection: collapsed ? "column" : "row",
        gap: collapsed ? SPACING.xs : SPACING.xs+2, flexShrink:0,
        alignItems:"center", justifyContent: collapsed ? "center" : "space-between",
      }}>
        {/* Notifications : l'e-mail de la veille quotidienne va chercher ceux
            qui ne sont pas dans l'application, la cloche sert ceux qui y sont. */}
        <ClocheNotifications profil={profil} theme={theme} onNaviguer={onNaviguer} collapsed={collapsed}/>
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
  const [prospectionInitialFilter, setProspectionInitialFilter] = useState(null);
  // Entrées de navigation autorisées, remontées par la barre latérale pour que
  // la barre du bas les réutilise sans recalculer les droits.
  const [navItems, setNavItems] = useState([]);
  const estMobile = useIsMobile();
  const [urbanismeInitialFilter, setUrbanismeInitialFilter] = useState(null);
  const [edlInitialFilter, setEdlInitialFilter] = useState(null);
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
  const ouvrirProjet  = (p) => { setProjetOuvert(p); setVueSim("simulateur"); };
  const nouveauProjet = ()  => { setProjetOuvert(null); setVueSim("simulateur"); };
  const ouvrirStructurationDepuisClient = (clientId) => {
    setStructInitialClientId(clientId);
    setPage("structuration");
  };
  const ouvrirBienDepuisClient = (bienId) => {
    if (!bienId) return;
    naviguer("biens", NAV.ficheBien(bienId));
  };
  const fermerSim = () => setVueSim("liste");

  // Point d'entrée unique de la navigation inter-onglets.
  //
  // Avant : seuls "crm" et "biens" étaient routés, et les filtres transmis
  // gardaient un vocabulaire propre à l'émetteur. Le Dashboard envoyait
  // `type:"fiche"` — que personne ne savait lire — et `target:"prospection"`,
  // qui n'était même pas testé ici. Les quatre sauts du bouton « Ouvrir la
  // fiche complète » retombaient donc sur une liste, en silence.
  //
  // Désormais : toute cible passe par `normalizeNavTarget`, qui parle le même
  // vocabulaire que les onglets destinataires. Une cible non routable est
  // signalée en console plutôt qu'ignorée — c'est ce qui rendra visible le
  // prochain onglet branché de travers.
  const naviguer = (target, filter) => {
    const cible = normalizeNavTarget(target, filter);
    if (!cible) {
      console.warn("[Invest] Navigation impossible : onglet inconnu", target, filter);
      return;
    }
    if (!canSee(cible.tab)) {
      console.warn("[Invest] Navigation refusée : accès manquant sur", cible.tab);
      return;
    }
    switch (cible.tab) {
      case "crm":           setCrmInitialFilter(cible); break;
      case "biens":         setBiensInitialFilter(cible); break;
      case "prospection":   setProspectionInitialFilter(cible); break;
      case "urbanisme":     setUrbanismeInitialFilter(cible); break;
      case "etat_des_lieux":setEdlInitialFilter(cible); break;
      case "structuration": if (cible.id) setStructInitialClientId(cible.id); break;
      default: break; // onglets sans cible profonde : on bascule seulement
    }
    setPage(cible.tab);
  };

  // Arrivée depuis un lien extérieur (mail de veille quotidienne, notification).
  //
  // Les liens du cron pointent vers un dossier précis. Sans ce bootstrap, on
  // atterrissait sur le tableau de bord : l'onglet cible n'étant pas monté, son
  // propre effet de lecture d'URL ne se déclenchait jamais. C'était déjà le cas
  // du `?crm_client=` existant, qui ne fonctionnait que si l'utilisateur
  // basculait ensuite sur le CRM à la main.
  //
  // On attend `rolePages` : router avant que la configuration d'accès soit
  // chargée ferait refuser une cible que l'utilisateur a pourtant le droit de
  // voir.
  const bootstrapFait = useRef(false);
  useEffect(() => {
    if (bootstrapFait.current || typeof window === "undefined") return;
    if (!rolePages) return;

    const params = new URLSearchParams(window.location.search || "");
    const liens = [
      ["invest_urbanisme", (v) => NAV.ficheUrbanisme(v)],
      ["invest_edl",       (v) => NAV.ficheEDL(v)],
      ["invest_bien",      (v) => NAV.ficheBien(v)],
      ["invest_prospect",  (v) => NAV.ficheProspect(v)],
      ["crm_client",       (v) => NAV.actionsClient(v, params.get("mission_action") || null)],
      ["client_id",        (v) => NAV.ficheClient(v)],
    ];

    for (const [cle, versCible] of liens) {
      const valeur = params.get(cle);
      if (!valeur) continue;
      const cible = versCible(valeur);
      bootstrapFait.current = true;
      naviguer(cible.tab, cible);
      // L'identifiant est retiré de la barre d'adresse : sans cela, un
      // rechargement rouvrirait indéfiniment la même fiche par-dessus le
      // travail en cours.
      params.delete(cle);
      params.delete("mission_action");
      params.delete("mission_step");
      const reste = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (reste ? `?${reste}` : ""));
      return;
    }
    bootstrapFait.current = true;
  }, [rolePages]);

  const changerPage = (p) => {
    setPage(p);
    // Un filtre de navigation ne vaut que pour le saut qui l'a produit : le
    // conserver ferait rouvrir la même fiche au prochain passage sur l'onglet.
    if (p !== "crm") setCrmInitialFilter(null);
    if (p !== "biens") setBiensInitialFilter(null);
    if (p !== "prospection") setProspectionInitialFilter(null);
    if (p !== "urbanisme") setUrbanismeInitialFilter(null);
    if (p !== "etat_des_lieux") setEdlInitialFilter(null);
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
      <SidebarInvest page={page} setPage={changerPage} theme={theme} setTheme={setTheme} profil={profil} onRetourPortail={onRetourPortail} onLogout={onLogout} rolePages={rolePages} onNaviguer={naviguer} onNavItems={setNavItems} />
      <div className="inv-content" style={{ flex:1, minHeight:0, overflowY:"auto", background:T.bg }}>
        {page === "dashboard"  && (canSee("dashboard")  ? <TableauBord profil={profil} T={T} onNavigate={naviguer} />                                      : <AccesRefuseInvest T={T} page="dashboard"/>)}
        {page === "prospection" && (canSee("prospection") ? <Prospection profil={profil} T={T} initialFilter={prospectionInitialFilter} /> : <AccesRefuseInvest T={T} page="prospection"/>)}
        {page === "crm"        && (canSee("crm")        ? <CRM profil={profil} T={T} initialFilter={crmInitialFilter} onOpenStructuration={ouvrirStructurationDepuisClient} onOpenBien={ouvrirBienDepuisClient} />        : <AccesRefuseInvest T={T} page="crm"/>)}
        {page === "sourcing"   && (canSee("sourcing")   ? <Sourcing profil={profil} T={T} /> : <AccesRefuseInvest T={T} page="sourcing"/>)}
        {page === "biens"      && (canSee("biens")      ? <StockBiens profil={profil} T={T} initialFilter={biensInitialFilter} />                                          : <AccesRefuseInvest T={T} page="biens"/>)}
        {page === "etat_des_lieux" && (canSee("etat_des_lieux") ? <EtatDesLieux profil={profil} T={T} initialFilter={edlInitialFilter} /> : <AccesRefuseInvest T={T} page="etat_des_lieux"/>)}
        {page === "urbanisme" && (canSee("urbanisme") ? <Urbanisme profil={profil} T={T} initialFilter={urbanismeInitialFilter} /> : <AccesRefuseInvest T={T} page="urbanisme"/>)}
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
      {/* Navigation du bas, téléphone uniquement. Rendue en dernier enfant de
          .inv pour être au-dessus du contenu dans l'ordre de peinture. */}
      {estMobile && navItems.length > 0 && (
        <BarreBasInvest nav={navItems} page={page} setPage={changerPage} T={T}/>
      )}
    </div>
  );
}
