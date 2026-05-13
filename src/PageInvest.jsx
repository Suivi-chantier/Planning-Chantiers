import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";
import { LOGO_INVEST_H, LOGO_INVEST_V, FONT, RADIUS, SPACING, SEMANTIC, getBranchAccent } from "./constants";
import { Icon } from "./ui";
import {
  LayoutDashboard, Users, Building2, BarChart3, Settings, Plus, Trash2,
  Pencil, ChevronRight, ChevronLeft, Search, RefreshCw, Save, Download,
  X, Check, Phone, Calendar, MessageSquare, FileText, Mail, Home,
  TrendingUp, Wallet, Euro, MapPin, ExternalLink, Filter, ArrowLeft,
  Lock, AlertTriangle, ChevronDown, ChevronUp, Eye, Image as ImageIcon,
  Upload, Copy, Sparkles, Sun, Moon, LogOut, LayoutGrid, Send, Phone as PhoneIcon,
  Handshake, Bell, Briefcase, Hammer,
} from "lucide-react";

// Accent officiel Profero Invest (bleu)
const INVEST_ACC = getBranchAccent("invest");


// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const LOT_TYPES  = ["Sélectionner","Studio","T1","T2","T3","T4","T5","T6","Commerce"];
const NIVEAUX    = ["RDC","R+1","R+2","R+3","R+4","Autre"];
const MAX_LOTS   = 10;
const GESTION_PRICES = {Studio:42,T1:45.6,T2:40.8,T3:44.4,T4:44.4,T5:46.8,T6:49.2,Commerce:60,"Sélectionner":0};
const DEFAULT_LOTS = [
  {type:"T4",m2:134,loyer:900,niveau:"RDC",comment:""},
  {type:"Studio",m2:27,loyer:380,niveau:"R+1",comment:""},
  {type:"T2",m2:40,loyer:490,niveau:"R+1",comment:""},
  {type:"T2",m2:36,loyer:490,niveau:"R+2",comment:""},
];
const BUDGET_SECTIONS = [
  {id:"elec",sec:"⚡ Électricité",items:[
    {id:"elec-studio",label:"Studio",base:"/ logement",autoFn:(l)=>l.filter(x=>x.type.startsWith("Studio")).length,price:7012.1},
    {id:"elec-t1",label:"T1",base:"/ logement",autoFn:(l)=>l.filter(x=>x.type==="T1").length,price:7012.1},
    {id:"elec-t2",label:"T2",base:"/ logement",autoFn:(l)=>l.filter(x=>x.type==="T2").length,price:9271.69},
    {id:"elec-t3",label:"T3",base:"/ logement",autoFn:(l)=>l.filter(x=>x.type==="T3").length,price:11968},
    {id:"elec-t4",label:"T4+",base:"/ logement",autoFn:(l)=>l.filter(x=>["T4","T5","T6"].includes(x.type)).length,price:13625.9},
  ]},
  {id:"plomb",sec:"🔧 Réseaux Plomberie",items:[
    {id:"plomb-cpt",label:"Compteur divisionnaire",base:"/ logement",autoFn:(l)=>l.filter(x=>x.type!=="Sélectionner").length,price:312.6},
    {id:"plomb-gen",label:"Réseau général",base:"/ logement",autoFn:(l)=>l.filter(x=>x.type!=="Sélectionner").length,price:2500},
    {id:"plomb-int",label:"Distribution interne",base:"/ logement",autoFn:(l)=>l.filter(x=>x.type!=="Sélectionner").length,price:1800},
  ]},
  {id:"sdb",sec:"🚿 Salle de Bain",items:[
    {id:"sdb-std",label:"Salle de bain complète",base:"/ unité",autoFn:(l)=>l.filter(x=>x.type!=="Sélectionner").length,price:5884.53},
    {id:"sdb-exist",label:"SDB — éléments conservés",base:"/ unité",autoFn:()=>0,price:3600},
  ]},
  {id:"cuis",sec:"🍳 Cuisine",items:[
    {id:"cuis-droite",label:"Cuisine droite",base:"/ unité",autoFn:(l)=>l.filter(x=>x.type!=="Sélectionner").length,price:2100},
  ]},
  {id:"clois",sec:"🧱 Cloisons",items:[
    {id:"clois-dist",label:"Distribution + isolation phonique",base:"m²",autoFn:()=>0,price:89},
    {id:"clois-dbl",label:"Doublage sans isolation",base:"m²",autoFn:()=>0,price:89},
    {id:"clois-dbli",label:"Doublage avec isolation",base:"m²",autoFn:()=>0,price:100},
  ]},
  {id:"sol",sec:"🏠 Revêtement de Sol",items:[
    {id:"sol-pq",label:"Parquet stratifié + plinthes",base:"m²",autoFn:(_,s)=>s,price:62},
  ]},
  {id:"peinture",sec:"🎨 Peinture",items:[
    {id:"peinture-neuf",label:"Peinture sur placo neuf",base:"m²",autoFn:(_,s)=>Math.round(s*2.5),price:20},
    {id:"peinture-anc",label:"Peinture sur ancien",base:"m²",autoFn:()=>0,price:30},
  ]},
  {id:"plafond",sec:"🏛️ Plafond",items:[
    {id:"plaf-ramp",label:"Faux plafond rampant",base:"m²",autoFn:(_,s)=>s,price:86},
  ]},
  {id:"menext",sec:"🪟 Menuiseries Extérieures",items:[
    {id:"men-fen",label:"Fenêtre double vitrage",base:"/ unité",autoFn:()=>0,price:1400},
    {id:"men-velux",label:"Vélux",base:"/ unité",autoFn:()=>0,price:700},
    {id:"men-baie",label:"Baie vitrée",base:"/ unité",autoFn:()=>0,price:3000},
    {id:"men-pext",label:"Porte extérieure",base:"/ unité",autoFn:(l)=>l.filter(x=>x.type!=="Sélectionner").length,price:1650},
  ]},
  {id:"menint",sec:"🚪 Menuiseries Intérieures",items:[
    {id:"meni-pal",label:"Porte palière 83",base:"/ unité",autoFn:(l)=>l.filter(x=>x.type!=="Sélectionner").length,price:950},
    {id:"meni-por83",label:"Porte intérieure 83",base:"/ unité",autoFn:(l)=>l.filter(x=>x.type!=="Sélectionner").length*3,price:310},
  ]},
  {id:"divers",sec:"🔩 Divers",items:[
    {id:"div-deb",label:"Démolition (à la journée)",base:"journée",autoFn:()=>1,price:300},
  ]},
];
const COMP_FISCA = [
  ["Taux imposition bénéfice","15% / 25%","TMI foyer","0% si amortissement"],
  ["Amortissement du bien","✅ Oui","❌ Non","✅ Oui"],
  ["Amortissement travaux","✅ Oui","❌ Non","✅ Oui"],
  ["Plus-value cession","IS sur +value","Exo 30 ans (IR)","IR / flat tax"],
  ["Déficit foncier","Non applicable","✅ 10 700 €/an","Reportable BIC"],
  ["Recommandé CF positif","✅ Oui","⚠️ Attention TMI","✅ Oui"],
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const pmt = (P,r,n) => { if(!P||!r||!n)return 0; const rm=r/100/12,nm=n*12; return rm?P*rm/(1-Math.pow(1+rm,-nm)):P/nm; };
const fmt = (v) => (v===null||v===undefined||isNaN(v)) ? "—" : new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(v)+" €";
const fmtPct = (v) => isNaN(v) ? "—" : (v*100).toFixed(1)+" %";
const fmtMois = (v) => isNaN(v) ? "—" : v.toFixed(1)+" mois";
const actLots = (lots) => lots.filter(l=>l.type!=="Sélectionner");

// État initial du budget
const initBudgetState = (lots, surface) => {
  const qty={}, price={};
  BUDGET_SECTIONS.forEach(sec=>sec.items.forEach(item=>{
    qty[item.id]  = item.autoFn ? item.autoFn(lots, surface||0) : 0;
    price[item.id]= item.price;
  }));
  return { qty, price };
};

// ─── THÈMES INVEST ────────────────────────────────────────────────────────────
// Aligné sur le design system Profero. Accent = bleu Invest (#4070e8) au lieu
// du cyan #4db8ff vintage. Palette plus profonde et moderne (inspirée Linear /
// Mercury / GitHub) tout en gardant l'esprit Profero Rénovation côté Sidebar/UI.
const THEMES_INV = {
  dark: {
    // Surfaces
    bg:        "#0f1218",
    surface:   "#161a22",
    card:      "#161a22",
    cardHover: "rgba(64,112,232,0.06)",
    cardActive:"rgba(64,112,232,0.10)",
    // Borders
    border:    "rgba(255,255,255,0.07)",
    borderHover: INVEST_ACC.border,
    rowBorder: "rgba(255,255,255,0.05)",
    // Texte
    text:      "#e6edf3",
    textSub:   "#a0a9b8",
    textMuted: "#6b7280",
    // Accent (bleu officiel Profero Invest)
    accent:       INVEST_ACC.accent,
    accentHover:  INVEST_ACC.accentLight,
    accentBg:     INVEST_ACC.bg10,
    accentBg20:   INVEST_ACC.bg20,
    accentBorder: INVEST_ACC.border,
    onAccent:     INVEST_ACC.onAccent,
    // Sidebar / nav (plus sombre que le bg pour créer de la profondeur)
    sidebar:   "#0a0d12",
    sidebarBorder: "rgba(255,255,255,0.05)",
    sectionHd: "rgba(255,255,255,0.025)",
    tabNav:    "#0c1018",
    // Inputs
    input:        "rgba(255,255,255,0.04)",
    inputBorder:  "rgba(255,255,255,0.08)",
    inputBorderHover: INVEST_ACC.border,
    scrollThumb: "#2a2d3a",
    // Shadows
    shadowSm:  "0 1px 2px rgba(0,0,0,0.3)",
    shadowMd:  "0 4px 12px rgba(0,0,0,0.25)",
  },
  light: {
    bg:        "#f5f7fa",
    surface:   "#ffffff",
    card:      "#ffffff",
    cardHover: "rgba(64,112,232,0.04)",
    cardActive:"rgba(64,112,232,0.08)",
    border:    "rgba(0,0,0,0.08)",
    borderHover: INVEST_ACC.border,
    rowBorder: "rgba(0,0,0,0.05)",
    text:      "#0f172a",
    textSub:   "#475569",
    textMuted: "#94a3b8",
    accent:       INVEST_ACC.accent,
    accentHover:  INVEST_ACC.accentDark,
    accentBg:     INVEST_ACC.bg10,
    accentBg20:   INVEST_ACC.bg20,
    accentBorder: INVEST_ACC.border,
    onAccent:     INVEST_ACC.onAccent,
    sidebar:   "#0f172a",
    sidebarBorder: "rgba(255,255,255,0.08)",
    sectionHd: "rgba(0,0,0,0.025)",
    tabNav:    "#ffffff",
    input:        "#ffffff",
    inputBorder:  "rgba(0,0,0,0.10)",
    inputBorderHover: INVEST_ACC.border,
    scrollThumb: "#cbd5e1",
    shadowSm:  "0 1px 2px rgba(0,0,0,0.06)",
    shadowMd:  "0 4px 12px rgba(0,0,0,0.10)",
  },
};

// ─── CSS INVEST — aligné sur le design system Profero ─────────────────────────
// Toutes les valeurs (rayons, fontes, spacings) viennent des constantes
// partagées FONT/RADIUS/SPACING/SEMANTIC pour rester cohérent avec le reste
// de l'appli. Les noms de classes (.inv-*) sont conservés pour ne pas casser
// la compatibilité du JSX existant.
const SU = SEMANTIC.success.color;     // vert
const WA = SEMANTIC.warning.color;     // orange
const DA = SEMANTIC.danger.color;      // rouge
const IN = SEMANTIC.info.color;        // bleu info (utilisé pour le régime IS)

const getCSS = (T) => `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap');

/* ─── BASE ─────────────────────────────────────────────────────────────── */
.inv{font-family:'Barlow Condensed','Arial Narrow',sans-serif;background:${T.bg};color:${T.text};font-size:${FONT.base.size}px;}
.inv *{box-sizing:border-box;margin:0;padding:0;}
.inv ::-webkit-scrollbar{width:6px;height:6px;}
.inv ::-webkit-scrollbar-thumb{background:${T.scrollThumb};border-radius:${RADIUS.sm}px;}
.inv ::-webkit-scrollbar-track{background:transparent;}

/* ─── CARDS ────────────────────────────────────────────────────────────── */
.inv-card{background:${T.card};border-radius:${RADIUS.xl}px;border:1px solid ${T.border};overflow:hidden;box-shadow:${T.shadowSm};transition:border-color .18s, box-shadow .18s;}
.inv-card:hover{border-color:${T.borderHover};}
.inv-card-hd{background:${T.sectionHd};color:${T.text};padding:${SPACING.md}px ${SPACING.lg}px;font-size:${FONT.xs.size}px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;display:flex;align-items:center;justify-content:space-between;gap:${SPACING.sm}px;border-bottom:1px solid ${T.border};}
.inv-card-hd.accent{background:${T.accentBg};color:${T.accent};border-bottom-color:${T.accentBorder};}
.inv-card-hd.danger{background:${SEMANTIC.danger.bg};color:${DA};border-bottom-color:${SEMANTIC.danger.border};}
.inv-card-hd.green{background:${SEMANTIC.success.bg};color:${SU};border-bottom-color:${SEMANTIC.success.border};}
.inv-card-hd.blue{background:${SEMANTIC.info.bg};color:${IN};border-bottom-color:${SEMANTIC.info.border};}
.inv-card-hd.mid{background:rgba(168,85,247,0.10);color:#c084fc;border-bottom-color:rgba(168,85,247,0.25);}
.inv-card-hd.gold{background:rgba(255,194,0,0.10);color:#FFC200;border-bottom-color:rgba(255,194,0,0.25);}
.inv-card-bd{padding:${SPACING.md+2}px ${SPACING.lg}px;}

/* ─── ROWS ─────────────────────────────────────────────────────────────── */
.inv-row{display:grid;grid-template-columns:1fr auto;align-items:center;padding:${SPACING.sm-1}px 0;border-bottom:1px solid ${T.rowBorder};gap:${SPACING.md}px;}
.inv-row:last-child{border-bottom:none;}
.inv-row.total{border-top:2px solid ${T.accent};margin-top:${SPACING.xs}px;padding-top:${SPACING.sm}px;border-bottom:none;}
.inv-row.sub{background:${T.cardHover};margin:0 -${SPACING.lg}px;padding:${SPACING.sm-1}px ${SPACING.lg}px;}
.inv-lbl{font-size:${FONT.sm.size+1}px;color:${T.textSub};}
.inv-lbl.bold{font-weight:700;color:${T.text};}
.inv-val{font-family:'DM Mono',monospace;font-size:${FONT.sm.size+1}px;text-align:right;font-weight:500;white-space:nowrap;color:${T.textSub};}
.inv-val.calc{color:${T.accent};}
.inv-val.green{color:${SU};font-weight:700;}
.inv-val.orange{color:${WA};font-weight:700;}
.inv-val.red{color:${DA};font-weight:700;}

/* ─── INPUTS / SELECTS ─────────────────────────────────────────────────── */
.inv-inp{font-family:'DM Mono',monospace;font-size:${FONT.sm.size+1}px;font-weight:500;color:${T.accent};background:${T.input};border:1.5px solid ${T.inputBorder};border-radius:${RADIUS.md}px;padding:${SPACING.sm-1}px ${SPACING.md-2}px;text-align:right;outline:none;transition:all .18s;}
.inv-inp:focus{border-color:${T.accent};box-shadow:0 0 0 3px ${T.accentBg};}
.inv-inp:hover:not(:focus){border-color:${T.inputBorderHover};}
.inv-sel{font-family:'Barlow Condensed',sans-serif;font-size:${FONT.sm.size+1}px;color:${T.text};background:${T.input};border:1.5px solid ${T.inputBorder};border-radius:${RADIUS.md}px;padding:${SPACING.sm-1}px ${SPACING.md-2}px;outline:none;cursor:pointer;transition:all .18s;}
.inv-sel:focus{border-color:${T.accent};box-shadow:0 0 0 3px ${T.accentBg};}
.inv-sel:hover{border-color:${T.inputBorderHover};}
.inv-textarea{width:100%;font-family:'Barlow Condensed',sans-serif;font-size:${FONT.sm.size+1}px;color:${T.text};background:${T.input};border:1.5px solid ${T.inputBorder};border-radius:${RADIUS.md}px;padding:${SPACING.sm}px ${SPACING.md-2}px;outline:none;resize:vertical;line-height:1.55;transition:all .18s;}
.inv-textarea:focus{border-color:${T.accent};box-shadow:0 0 0 3px ${T.accentBg};}

/* ─── KPI CARDS ────────────────────────────────────────────────────────── */
.inv-kpi{background:${T.card};border-radius:${RADIUS.xl}px;padding:${SPACING.lg}px ${SPACING.lg+2}px;border:1px solid ${T.border};display:flex;flex-direction:column;gap:${SPACING.xs+2}px;transition:all .18s;}
.inv-kpi:hover{border-color:${T.borderHover};box-shadow:${T.shadowMd};}
.inv-kpi-lbl{font-size:${FONT.xs.size-1}px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:${T.textMuted};}
.inv-kpi-val{font-family:'DM Mono',monospace;font-size:${FONT.h2.size}px;font-weight:700;color:${T.text};letter-spacing:-0.3px;line-height:1;}
.inv-kpi-val.green{color:${SU};}
.inv-kpi-val.orange{color:${WA};}
.inv-kpi-val.red{color:${DA};}
.inv-kpi-val.accent{color:${T.accent};}

/* ─── TABS ─────────────────────────────────────────────────────────────── */
.inv-tab-nav{background:${T.tabNav};display:flex;padding:0 ${SPACING.xl}px;gap:${SPACING.xs-2}px;border-bottom:1px solid ${T.border};flex-shrink:0;}
.inv-tab-btn{padding:${SPACING.md-2}px ${SPACING.lg+2}px;font-family:'Barlow Condensed',sans-serif;font-size:${FONT.sm.size+1}px;font-weight:700;color:${T.textMuted};background:transparent;border:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;letter-spacing:0.5px;text-transform:uppercase;transition:all .15s;}
.inv-tab-btn:hover{color:${T.textSub};}
.inv-tab-btn.active{color:${T.accent};border-bottom-color:${T.accent};}

/* ─── BUTTONS ──────────────────────────────────────────────────────────── */
.inv-btn{display:inline-flex;align-items:center;gap:${SPACING.xs+2}px;padding:${SPACING.sm}px ${SPACING.lg}px;border-radius:${RADIUS.md}px;font-family:'Barlow Condensed',sans-serif;font-size:${FONT.sm.size+1}px;font-weight:700;cursor:pointer;border:none;white-space:nowrap;letter-spacing:0.5px;transition:all .15s;}
.inv-btn:disabled{opacity:.5;cursor:not-allowed;}
.inv-btn-accent{background:${T.accent};color:${T.onAccent};}.inv-btn-accent:hover:not(:disabled){background:${T.accentHover};}
.inv-btn-blue{background:${T.accentBg};color:${T.accent};border:1px solid ${T.accentBorder};}.inv-btn-blue:hover:not(:disabled){background:${T.accentBg20};}
.inv-btn-gold{background:${T.accent};color:${T.onAccent};}.inv-btn-gold:hover:not(:disabled){background:${T.accentHover};}
.inv-btn-out{background:transparent;color:${T.textSub};border:1px solid ${T.border};}.inv-btn-out:hover:not(:disabled){background:${T.cardHover};color:${T.text};border-color:${T.borderHover};}
.inv-btn-danger{background:${SEMANTIC.danger.bg};color:${DA};border:1px solid ${SEMANTIC.danger.border};}.inv-btn-danger:hover:not(:disabled){background:rgba(225,90,90,0.20);}
.inv-btn-sm{font-size:${FONT.xs.size+1}px;padding:${SPACING.xs+1}px ${SPACING.md-1}px;}
.inv-rm{background:none;border:none;cursor:pointer;color:${T.textMuted};font-size:18px;padding:0 ${SPACING.xs-1}px;line-height:1;transition:color .15s;}
.inv-rm:hover{color:${DA};}

/* ─── SCÉNARIOS / FISCALITÉ ────────────────────────────────────────────── */
.inv-scen-hd{display:grid;grid-template-columns:1fr 110px 110px;padding:${SPACING.sm}px ${SPACING.lg}px;background:${T.sectionHd};font-size:${FONT.xs.size-1}px;font-weight:700;color:${T.textMuted};letter-spacing:1.2px;text-transform:uppercase;}
.inv-scen-row{display:grid;grid-template-columns:1fr 110px 110px;align-items:center;padding:${SPACING.sm-1}px ${SPACING.lg}px;border-bottom:1px solid ${T.rowBorder};gap:${SPACING.sm}px;}
.inv-scen-row:last-child{border-bottom:none;}
.inv-scen-row.hl{background:${SEMANTIC.success.bg};}
.inv-scen-row.warn{background:${SEMANTIC.warning.bg};}
.inv-s{font-family:'DM Mono',monospace;font-size:${FONT.sm.size+1}px;text-align:right;font-weight:500;color:${T.textSub};}
.inv-s.green{color:${SU};font-weight:700;}
.inv-s.orange{color:${WA};font-weight:700;}

/* ─── LOTS / BUDGET ────────────────────────────────────────────────────── */
.inv-lot-grid{display:grid;grid-template-columns:90px 75px 75px 95px 70px 65px 70px 1fr 55px;gap:${SPACING.xs+1}px;align-items:center;padding:${SPACING.xs+1}px 0;border-bottom:1px solid ${T.rowBorder};min-width:680px;}
.inv-lot-grid.hd{font-size:${FONT.xs.size-1}px;font-weight:700;color:${T.textMuted};letter-spacing:0.8px;text-transform:uppercase;padding-bottom:${SPACING.sm}px;border-bottom:1px solid ${T.border};}
.inv-lot-grid input,.inv-lot-grid select{width:100%;}
.inv-lot-val{font-family:'DM Mono',monospace;font-size:${FONT.sm.size}px;text-align:right;color:${T.textSub};}
.inv-add-lot{display:flex;align-items:center;justify-content:center;gap:${SPACING.xs+2}px;margin-top:${SPACING.sm}px;padding:${SPACING.sm-1}px;background:${T.cardHover};border:1.5px dashed ${T.border};border-radius:${RADIUS.md}px;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-size:${FONT.sm.size+1}px;font-weight:700;color:${T.accent};width:100%;letter-spacing:0.5px;opacity:.8;transition:all .15s;}
.inv-add-lot:hover{opacity:1;border-color:${T.accent};background:${T.accentBg};}
.inv-brow{display:grid;grid-template-columns:1fr 60px 65px 75px 80px;padding:${SPACING.xs+1}px 0;border-bottom:1px solid ${T.rowBorder};align-items:center;gap:${SPACING.xs+1}px;}
.inv-brow.hd{font-size:${FONT.xs.size-1}px;font-weight:700;color:${T.textMuted};text-transform:uppercase;letter-spacing:0.8px;border-bottom:1px solid ${T.border};padding-bottom:${SPACING.sm}px;}
.inv-brow .bl{font-size:${FONT.sm.size}px;color:${T.textSub};}
.inv-brow .bn{font-family:'DM Mono',monospace;font-size:${FONT.sm.size}px;text-align:right;color:${T.textSub};}
.inv-brow input{width:100%;}
.inv-bsec{background:${T.sectionHd};color:${T.accent};padding:${SPACING.xs+1}px 0;font-size:${FONT.xs.size-1}px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;margin:${SPACING.sm}px 0 ${SPACING.xs-1}px;border-bottom:1px solid ${T.border};opacity:.9;}

/* ─── RÉGIMES FISCAUX ──────────────────────────────────────────────────── */
.inv-regime{background:${T.card};border-radius:${RADIUS.xl}px;border:1px solid ${T.border};overflow:hidden;}
.inv-regime-hd{padding:${SPACING.md-2}px ${SPACING.lg-2}px;font-size:${FONT.sm.size+1}px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;}
.inv-regime-hd.is{background:${SEMANTIC.info.bg};color:${IN};}
.inv-regime-hd.ir{background:rgba(168,85,247,0.10);color:#c084fc;}
.inv-regime-hd.lmnp{background:${SEMANTIC.success.bg};color:${SU};}
.inv-regime-row{display:flex;justify-content:space-between;align-items:center;padding:${SPACING.xs+2}px ${SPACING.lg-2}px;border-bottom:1px solid ${T.rowBorder};gap:${SPACING.sm}px;}
.inv-regime-row:last-child{border-bottom:none;}
.inv-regime-row .rl{font-size:${FONT.xs.size+1}px;color:${T.textSub};flex:1;}
.inv-regime-row .rv{font-family:'DM Mono',monospace;font-size:${FONT.sm.size}px;font-weight:600;text-align:right;color:${T.text};}
.inv-regime-row.hl{background:${SEMANTIC.success.bg};}
.inv-regime-row.warn{background:${SEMANTIC.warning.bg};}

/* ─── TOGGLE / PHOTOS ──────────────────────────────────────────────────── */
.inv-toggle-wrap{display:flex;align-items:center;gap:${SPACING.sm+2}px;padding:${SPACING.xs+2}px 0;}
.inv-toggle{position:relative;width:38px;height:20px;}
.inv-toggle input{opacity:0;width:0;height:0;}
.inv-toggle-sl{position:absolute;inset:0;background:${T.border};border-radius:20px;cursor:pointer;transition:.2s;}
.inv-toggle-sl:before{content:'';position:absolute;width:14px;height:14px;left:3px;top:3px;background:${T.textSub};border-radius:50%;transition:.2s;}
input:checked+.inv-toggle-sl{background:${T.accent};}
input:checked+.inv-toggle-sl:before{transform:translateX(18px);background:white;}
.inv-photo-zone{border:2px dashed ${T.border};border-radius:${RADIUS.lg}px;background:${T.input};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${SPACING.xs+2}px;cursor:pointer;transition:all .2s;min-height:100px;position:relative;overflow:hidden;}
.inv-photo-zone:hover{border-color:${T.accent};background:${T.accentBg};}
.inv-photo-zone.has-photo{border-style:solid;}
.inv-photo-zone img{width:100%;height:100%;object-fit:cover;display:block;}
.inv-photo-actions{position:absolute;top:${SPACING.xs+1}px;right:${SPACING.xs+1}px;}

/* ─── SCENARIO TOGGLE / BADGE ──────────────────────────────────────────── */
.inv-scen-toggle{display:flex;gap:${SPACING.xs}px;margin-top:${SPACING.xs+1}px;}
.inv-scen-btn{flex:1;padding:${SPACING.xs}px;border-radius:${RADIUS.sm+1}px;font-family:'Barlow Condensed',sans-serif;font-size:${FONT.sm.size}px;font-weight:700;border:1px solid ${T.border};background:transparent;color:${T.textMuted};cursor:pointer;letter-spacing:0.5px;transition:all .15s;}
.inv-scen-btn:hover:not(.active){border-color:${T.borderHover};color:${T.textSub};}
.inv-scen-btn.active{background:${T.accent};color:${T.onAccent};border-color:${T.accent};}
.inv-badge{display:inline-block;padding:${SPACING.xs-2}px ${SPACING.sm+1}px;border-radius:${RADIUS.pill}px;font-size:${FONT.xs.size-1}px;font-weight:700;letter-spacing:0.5px;}

/* ─── MOBILE ───────────────────────────────────────────────────────────── */
@media(max-width:767px){
  .inv{flex-direction:column!important;overflow:hidden}
  .inv > div:first-child{width:100%!important;height:auto!important;flex-direction:row!important;border-right:none!important;border-bottom:1px solid ${T.border};flex-shrink:0;align-items:center}
  .inv > div:first-child > div:first-child{padding:6px 10px!important;border-bottom:none!important;border-right:1px solid ${T.border};flex-shrink:0;align-self:stretch}
  .inv > div:first-child > div:first-child img{height:24px!important;width:auto!important}
  .inv > div:first-child > div:first-child button{display:none}
  .inv > div:first-child > nav{flex:1;display:flex!important;overflow-x:auto;-webkit-overflow-scrolling:touch;padding:4px 6px!important;gap:2px}
  .inv > div:first-child > nav::-webkit-scrollbar{display:none}
  .inv > div:first-child > nav button{flex:0 0 auto;width:auto!important;padding:8px 12px!important;font-size:${FONT.sm.size}px!important;margin-bottom:0!important;justify-content:center!important}
  .inv > div:first-child > nav button span:last-child{display:inline!important}
  .inv > div:first-child > div:last-child{display:none}
  .inv-card-bd{padding:${SPACING.sm+2}px ${SPACING.md}px!important}
  .inv-row{flex-wrap:wrap;grid-template-columns:1fr!important;gap:${SPACING.xs+2}px!important}
  .inv-kpi{padding:${SPACING.sm+2}px ${SPACING.md}px!important}
  .inv-kpi-val{font-size:${FONT.xl.size}px!important}
  .inv-scen-hd,.inv-scen-row{grid-template-columns:1fr 80px 80px!important;font-size:${FONT.xs.size}px!important}
  .inv-lot-grid{min-width:680px!important}
  .inv-brow{grid-template-columns:1fr 60px 65px 75px 80px!important}
  .inv-tab-nav{overflow-x:auto;-webkit-overflow-scrolling:touch;padding:0 ${SPACING.sm}px!important}
  .inv-tab-nav::-webkit-scrollbar{display:none}
  .inv-tab-btn{padding:${SPACING.sm}px ${SPACING.md}px!important;font-size:${FONT.xs.size}px!important;flex:0 0 auto}
  .inv-grid-2{grid-template-columns:1fr!important;}
  .inv-kpi-bar{grid-template-columns:1fr 1fr!important;}
  .inv-fisca-grid{grid-template-columns:1fr!important;}
}
`;
const CSS = getCSS(THEMES_INV.dark);
function NumInput({value,onChange,style,min,step}) {
  return (
    <input type="number" className="inv-inp" value={value} min={min||0} step={step||1}
      onChange={e=>{onChange(parseFloat(e.target.value)||0);}}
      style={{width:120,...style}}/>
  );
}

// ─── LISTE DES PROJETS ────────────────────────────────────────────────────────
function ListeProjets({ profil, onOuvrir, onNouveauProjet, inline, T=THEMES_INV.dark }) {
  const [projets, setProjets] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [suppId, setSuppId]   = useState(null);
  const [filtreClient, setFiltreClient] = useState("");

  const charger = async () => {
    setLoading(true);
    // Tente avec client_id ; si la colonne n'existe pas (42703), retry sans.
    // Migration SQL nécessaire : ALTER TABLE invest_projets ADD COLUMN client_id UUID REFERENCES invest_clients(id) ON DELETE SET NULL;
    let res = await supabase.from("invest_projets")
      .select("id,nom,created_by,created_at,updated_at,donnees,client_id")
      .order("updated_at",{ascending:false});
    if (res.error?.code === "42703") {
      res = await supabase.from("invest_projets")
        .select("id,nom,created_by,created_at,updated_at,donnees")
        .order("updated_at",{ascending:false});
    }
    setProjets(res.data || []);
    // Charge la liste des clients pour afficher leur nom sur les cards et filtrer
    const { data: cs } = await supabase.from("invest_clients").select("id,nom,prenom").order("nom");
    setClients(cs || []);
    setLoading(false);
  };
  useEffect(()=>{charger();},[]);

  const clientById = Object.fromEntries(clients.map(c => [c.id, c]));
  const projetsFiltres = filtreClient
    ? projets.filter(p => p.client_id === filtreClient)
    : projets;

  const supprimer = async (id) => {
    await supabase.from("invest_projets").delete().eq("id",id);
    setSuppId(null); charger();
  };

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"}) : "—";
  const kpi = (d) => {
    if(!d?.inputs) return null;
    const pN=d.inputs.prixNegocie||0, fn=pN*(d.inputs.tauxNotaire||0.08);
    const total=pN+fn+(d.inputs.honoraires||0)+(d.inputs.enedis||0);
    const lots=(d.lots||[]).filter(l=>l.type!=="Sélectionner");
    return {total, loyer:lots.reduce((s,l)=>s+l.loyer,0), nbLots:lots.length};
  };

  const renderCard = (p) => {
    const k = kpi(p.donnees);
    const client = p.client_id ? clientById[p.client_id] : null;
    return (
      <div key={p.id} className="inv-card" style={{padding:`${SPACING.lg+2}px ${SPACING.lg+4}px`, cursor:"pointer", transition:"all .18s"}}
        onClick={()=>onOuvrir(p)}>
        <div style={{display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:SPACING.sm, marginBottom:SPACING.md-2}}>
          <div style={{flex:1, minWidth:0, display:"flex", alignItems:"flex-start", gap:SPACING.sm}}>
            <div style={{
              width:36, height:36, borderRadius:RADIUS.lg, flexShrink:0,
              background:T.accentBg, color:T.accent,
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>
              <Icon as={FileText} size={18} strokeWidth={2}/>
            </div>
            <div style={{flex:1, minWidth:0}}>
              <div style={{fontSize:FONT.md.size, fontWeight:700, color:T.text, marginBottom:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", letterSpacing:-0.2}}>
                {p.nom}
              </div>
              <div style={{fontSize:FONT.xs.size, color:T.textMuted}}>
                Par {p.created_by} · {fmtDate(p.updated_at)}
              </div>
              {client && (
                <div style={{fontSize:FONT.xs.size, color:T.accent, marginTop:5, display:"inline-flex", alignItems:"center", gap:4, fontWeight:600}}>
                  <Icon as={Users} size={11} strokeWidth={2.2}/>
                  {client.prenom} {client.nom}
                </div>
              )}
            </div>
          </div>
          <button onClick={e=>{e.stopPropagation();setSuppId(p.id);}}
            style={{
              background:"transparent", border:"none", cursor:"pointer", color:T.textMuted,
              padding:SPACING.xs, borderRadius:RADIUS.md, display:"flex", alignItems:"center",
              justifyContent:"center", transition:"all .15s",
            }}
            onMouseEnter={e=>{e.currentTarget.style.background=SEMANTIC.danger.bg; e.currentTarget.style.color=DA;}}
            onMouseLeave={e=>{e.currentTarget.style.background="transparent"; e.currentTarget.style.color=T.textMuted;}}>
            <Icon as={X} size={16} strokeWidth={2.2}/>
          </button>
        </div>
        {k && (
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:SPACING.xs+2, marginBottom:SPACING.md-2}}>
            {[
              {label:"Coût total", val:k.total>0?fmt(k.total):"—", color:T.accent, icon:Wallet},
              {label:"Loyers/mois", val:k.loyer>0?fmt(k.loyer):"—", color:SU, icon:TrendingUp},
              {label:"Lots", val:k.nbLots, color:WA, icon:Home},
            ].map(item=>(
              <div key={item.label} style={{
                background:T.cardHover, borderRadius:RADIUS.md, padding:`${SPACING.xs+2}px ${SPACING.sm+1}px`,
                borderLeft:`3px solid ${item.color}`,
              }}>
                <div style={{fontSize:FONT.xs.size-1, color:T.textMuted, textTransform:"uppercase", letterSpacing:0.5, marginBottom:2, display:"inline-flex", alignItems:"center", gap:4}}>
                  <Icon as={item.icon} size={9} strokeWidth={2}/> {item.label}
                </div>
                <div style={{fontSize:FONT.sm.size+1, fontWeight:800, color:item.color, fontFamily:"'DM Mono',monospace"}}>{item.val}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <span style={{
            fontSize:FONT.xs.size-1, background:T.cardHover, color:T.textSub,
            padding:`${SPACING.xs-2}px ${SPACING.sm}px`, borderRadius:RADIUS.pill, fontWeight:600,
          }}>{fmtDate(p.created_at)}</span>
          <span style={{fontSize:FONT.sm.size, color:T.accent, fontWeight:700, display:"inline-flex", alignItems:"center", gap:4}}>
            Ouvrir <Icon as={ChevronRight} size={12} strokeWidth={2.5}/>
          </span>
        </div>
      </div>
    );
  };

  const modalSuppr = () => (
    <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)"}}>
      <div style={{
        background:T.card, border:`1px solid ${T.border}`, borderRadius:RADIUS.xl,
        padding:`${SPACING.xl+2}px ${SPACING.xl+6}px`, maxWidth:380, width:"90%", textAlign:"center",
        boxShadow:T.shadowMd,
      }}>
        <div style={{
          width:56, height:56, borderRadius:"50%", margin:`0 auto ${SPACING.md}px`,
          background:SEMANTIC.danger.bg, border:`2px solid ${SEMANTIC.danger.border}`,
          display:"flex", alignItems:"center", justifyContent:"center", color:DA,
        }}>
          <Icon as={Trash2} size={26} strokeWidth={2}/>
        </div>
        <div style={{fontSize:FONT.md.size+1, fontWeight:800, color:T.text, marginBottom:6}}>Supprimer ce projet ?</div>
        <div style={{fontSize:FONT.sm.size+1, color:T.textSub, marginBottom:SPACING.xl-2, lineHeight:1.55}}>
          Cette action est <strong>irréversible</strong>.
        </div>
        <div style={{display:"flex", gap:SPACING.sm+2, justifyContent:"center"}}>
          <button className="inv-btn inv-btn-out" onClick={()=>setSuppId(null)}>Annuler</button>
          <button className="inv-btn inv-btn-danger" onClick={()=>supprimer(suppId)}>
            <Icon as={Trash2} size={13} strokeWidth={2.2}/> Supprimer
          </button>
        </div>
      </div>
    </div>
  );

  const emptyState = (label, sub) => (
    <div style={{textAlign:"center", padding:`${SPACING.xxl}px ${SPACING.lg}px`}}>
      <div style={{
        width:64, height:64, borderRadius:RADIUS.xl, margin:`0 auto ${SPACING.md}px`,
        background:T.accentBg, color:T.accent,
        display:"flex", alignItems:"center", justifyContent:"center",
      }}>
        <Icon as={Building2} size={32} strokeWidth={1.5}/>
      </div>
      <div style={{fontSize:FONT.md.size+1, fontWeight:700, color:T.text, marginBottom:6}}>{label}</div>
      {sub && <div style={{fontSize:FONT.sm.size+1, color:T.textSub, marginBottom:SPACING.lg+2}}>{sub}</div>}
      <button className="inv-btn inv-btn-gold" onClick={onNouveauProjet}>
        <Icon as={Plus} size={13} strokeWidth={2.2}/> Créer un projet
      </button>
    </div>
  );

  if (inline) return (
    <div>
      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:SPACING.lg+2, flexWrap:"wrap", gap:SPACING.sm+2}}>
        <div style={{fontSize:FONT.sm.size+1, color:T.textMuted}}>
          {projets.length} projet{projets.length!==1?"s":""} — partagés avec tous les associés
        </div>
        <button className="inv-btn inv-btn-gold" onClick={onNouveauProjet}>
          <Icon as={Plus} size={13} strokeWidth={2.2}/> Nouveau projet
        </button>
      </div>
      {loading ? (
        <div style={{textAlign:"center", padding:`${SPACING.xl+8}px 0`, color:T.textMuted, display:"inline-flex", alignItems:"center", justifyContent:"center", width:"100%", gap:8}}>
          <Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>
          Chargement…
        </div>
      ) : projets.length===0 ? (
        emptyState("Aucun projet pour l'instant", null)
      ) : (
        <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:SPACING.md+2}}>
          {projetsFiltres.map(p=>renderCard(p))}
        </div>
      )}
      {suppId&&modalSuppr()}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div className="inv" style={{position:"fixed",inset:0,zIndex:9999,overflowY:"auto"}}>
      <style>{CSS}</style>
      {/* Header */}
      <div style={{
        background:T.sidebar, padding:`${SPACING.md+2}px ${SPACING.xl}px`,
        display:"flex", alignItems:"center", justifyContent:"space-between",
        position:"sticky", top:0, zIndex:10, borderBottom:`1px solid ${T.sidebarBorder}`,
        boxShadow:T.shadowSm,
      }}>
        <div style={{display:"flex", alignItems:"center", gap:SPACING.md}}>
          <span style={{fontSize:FONT.xs.size, letterSpacing:2, textTransform:"uppercase", color:T.accent, fontWeight:700}}>Profero</span>
          <span style={{fontSize:FONT.xl.size+2, fontWeight:800, color:T.text, letterSpacing:-0.3}}>Invest</span>
          <div style={{width:1, height:20, background:T.border}}/>
          <span style={{fontSize:FONT.sm.size+1, color:T.textSub}}>Portefeuille de projets</span>
        </div>
        <button className="inv-btn inv-btn-gold" onClick={onNouveauProjet}>
          <Icon as={Plus} size={13} strokeWidth={2.2}/> Nouveau projet
        </button>
      </div>
      {/* Contenu */}
      <div style={{maxWidth:1100,margin:"0 auto",padding:"28px 24px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:22,flexWrap:"wrap",gap:12}}>
          <div>
            <div style={{fontSize:20,fontWeight:800,color:"#e8eaf0",letterSpacing:.3}}>Tous les projets</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.35)",marginTop:2}}>
              {projetsFiltres.length} projet{projetsFiltres.length!==1?"s":""}
              {filtreClient && projetsFiltres.length !== projets.length && ` sur ${projets.length}`}
              {" "}— partagés avec tous les associés
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <select className="inv-sel" value={filtreClient} onChange={e=>setFiltreClient(e.target.value)} style={{minWidth:200}}>
              <option value="">👥 Tous les clients</option>
              <option value="" disabled>──────────</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
              ))}
            </select>
            <button className="inv-btn inv-btn-out inv-btn-sm" onClick={charger}>↻ Actualiser</button>
          </div>
        </div>
        {loading ? (
          <div style={{textAlign:"center", padding:`${SPACING.xxxl}px 0`, color:T.textMuted, display:"flex", justifyContent:"center", alignItems:"center", gap:8}}>
            <Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>
            Chargement…
          </div>
        ) : projets.length===0 ? (
          emptyState("Aucun projet pour l'instant", "Créez votre premier projet d'investissement")
        ) : (
          <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:SPACING.md+2}}>
            {projetsFiltres.map(p=>renderCard(p))}
          </div>
        )}
      </div>
      {suppId&&modalSuppr()}
    </div>
  );
}

// ─── SIMULATEUR ───────────────────────────────────────────────────────────────
function Simulateur({ projet, profil, onRetour }) {
  const isNew = !projet?.id;
  const projetIdRef = useRef(projet?.id||null);

  // ── État principal ──────────────────────────────────────────────────────────
  const [nom,    setNom]    = useState(projet?.donnees?.projectName || projet?.nom || "Nouveau projet");
  const [tab,    setTab]    = useState("simulateur");
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [showReset, setShowReset] = useState(false);
  // Lien client (optionnel) — ajouté au BLOC B
  const [clientId, setClientId] = useState(projet?.client_id || "");
  const [clientsList, setClientsList] = useState([]);
  useEffect(() => {
    supabase.from("invest_clients").select("id,nom,prenom").order("nom")
      .then(({ data }) => setClientsList(data || []));
  }, []);

  // ── Entrées ──────────────────────────────────────────────────────────────────
  const d0 = projet?.donnees?.inputs || {};
  const s0 = projet?.donnees?.selects || {};
  const [prixAffiche,   setPrixAffiche]   = useState(d0.prixAffiche||280000);
  const [prixNegocie,   setPrixNegocie]   = useState(d0.prixNegocie||250000);
  const [tauxNotaire,   setTauxNotaire]   = useState(d0.tauxNotaire||0.08);
  const [surface,       setSurface]       = useState(d0.surface||237);
  const [budgetTravaux, setBudgetTravaux] = useState(d0.budgetTravaux||0);
  const [honoraires,    setHonoraires]    = useState(d0.honoraires||0);
  const [enedis,        setEnedis]        = useState(d0.enedis||0);
  const [taxeFonciere,  setTaxeFonciere]  = useState(d0.taxeFonciere||1000);
  const [assurance,     setAssurance]     = useState(d0.assurance||600);
  const [compta,        setCompta]        = useState(d0.compta||800);
  const [provisions,    setProvisions]    = useState(d0.provisions||1500);
  const [apport1,       setApport1]       = useState(d0.apport1||20000);
  const [apport2,       setApport2]       = useState(d0.apport2||20000);
  const [taux1,         setTaux1]         = useState(d0.taux1||4.32);
  const [taux2,         setTaux2]         = useState(d0.taux2||3.14);
  const [duree1,        setDuree1]        = useState(d0.duree1||20);
  const [duree2,        setDuree2]        = useState(d0.duree2||25);
  const [coefEtat,      setCoefEtat]      = useState(d0.coefEtat||1.0);
  const [imprevusPct,   setImprevusPct]   = useState(d0.imprevusPct||10);
  const [gestionActive, setGestionActive] = useState(s0.gestionActive||false);
  const [modeDetention, setModeDetention] = useState(s0.modeDetention||"IS");
  const [tmi,           setTmi]           = useState(parseFloat(s0.tmi)||0.30);
  const [selectedScen,  setSelectedScen]  = useState(s0.selectedScenario||1);
  const [lots, setLots] = useState(projet?.donnees?.lots || DEFAULT_LOTS.map(l=>({...l})));
  const [budgetQty,   setBudgetQty]   = useState(()=>{
    const b=initBudgetState(projet?.donnees?.lots||DEFAULT_LOTS, d0.surface||237);
    if(projet?.donnees?.budgetQty) Object.assign(b.qty, projet.donnees.budgetQty);
    return b.qty;
  });
  const [budgetPrice, setBudgetPrice] = useState(()=>{
    const b=initBudgetState(projet?.donnees?.lots||DEFAULT_LOTS, d0.surface||237);
    if(projet?.donnees?.budgetPrice) Object.assign(b.price, projet.donnees.budgetPrice);
    return b.price;
  });
  const [customDivers, setCustomDivers] = useState(projet?.donnees?.customDivers||[]);
  const [desc,      setDesc]      = useState(projet?.donnees?.descriptions?.description||"");
  const [travaux,   setTravaux]   = useState(projet?.donnees?.descriptions?.travaux||"");
  const [atouts,    setAtouts]    = useState(projet?.donnees?.descriptions?.atouts||"");
  const [photos,    setPhotos]    = useState(projet?.donnees?.photos||[null,null,null,null]);

  // ── Calculs dérivés ─────────────────────────────────────────────────────────
  const fn          = prixNegocie * tauxNotaire;
  const prixAchat   = prixNegocie + fn;
  const coutTotal   = prixAchat + budgetTravaux + honoraires + enedis;
  const aLots       = actLots(lots);
  const totLoyer    = aLots.reduce((s,l)=>s+l.loyer,0);
  const totLoyerAn  = totLoyer*12;
  const totGestMois = gestionActive ? aLots.reduce((s,l)=>s+(GESTION_PRICES[l.type]||0),0) : 0;
  const totGestAn   = totGestMois*12;
  const totCharges  = taxeFonciere+assurance+compta+totGestAn+provisions;
  const af1=coutTotal-apport1, af2=coutTotal-apport2;
  const m1=pmt(af1,taux1,duree1), m2=pmt(af2,taux2,duree2);
  const ann1=m1*12, ann2=m2*12;
  const rb = coutTotal>0 ? totLoyerAn/coutTotal : 0;
  const rn = coutTotal>0 ? (totLoyerAn-totCharges)/coutTotal : 0;
  const cfm1=(totLoyerAn-totCharges)/12-m1, cfm2=(totLoyerAn-totCharges)/12-m2;
  const ct1=totCharges+ann1, ct2=totCharges+ann2;
  const pe1=totLoyerAn>0?ct1/totLoyerAn:0, pe2=totLoyerAn>0?ct2/totLoyerAn:0;
  const cfSel=selectedScen===1?cfm1:cfm2, peSel=selectedScen===1?pe1:pe2;

  // Fiscalité rapide
  const res=totLoyerAn-totCharges-ann1;
  const ab=coutTotal*0.85/30, at=budgetTravaux/10;
  let impotRapide=0;
  if(modeDetention==="IS"){const r2=totLoyerAn-totCharges-ann1*.7-ab;impotRapide=r2>0?Math.min(r2,42500)*.15+Math.max(r2-42500,0)*.25:0;}
  else if(modeDetention==="IR"){const rf=totLoyerAn-totCharges-ann1*.7;impotRapide=Math.max(rf,0)*(tmi+.172);}
  else{const rl=res-ab-at;impotRapide=Math.max(rl,0)*tmi;}
  const cfNetRapide=res-impotRapide;

  // Fiscalité détaillée
  const rIS=totLoyerAn-totCharges-ann1*.7-ab;
  const isT1=Math.min(Math.max(rIS,0),42500)*.15, isT2=Math.max(rIS-42500,0)*.25;
  const cfIS=res-(isT1+isT2);
  const rf=totLoyerAn-totCharges-ann1*.7;
  const irImp=Math.max(rf,0)*tmi, irPS=Math.max(rf,0)*.172, cfIR=res-irImp-irPS;
  const rL=res-ab-at, lImp=Math.max(rL,0)*tmi, cfL=res-lImp;

  // Budget travaux
  let budgetSub=0;
  BUDGET_SECTIONS.forEach(sec=>sec.items.forEach(item=>{budgetSub+=(budgetQty[item.id]||0)*(budgetPrice[item.id]||0);}));
  customDivers.forEach(cd=>{budgetSub+=(cd.qty||0)*(cd.price||0);});
  const budgetImp=budgetSub*(imprevusPct/100);
  const budgetCoef=(budgetSub+budgetImp)*coefEtat;
  const budgetTTC=budgetCoef*1.10;

  // ── Sauvegarde Supabase ─────────────────────────────────────────────────────
  const collectState = useCallback(()=>({
    version:4, savedAt:new Date().toISOString(), projectName:nom,
    inputs:{prixAffiche,prixNegocie,budgetTravaux,tauxNotaire,surface,honoraires,enedis,taxeFonciere,assurance,compta,provisions,apport1,apport2,taux1,taux2,duree1,duree2,coefEtat,imprevusPct},
    selects:{gestionActive,modeDetention,tmi:tmi.toString(),selectedScenario:selectedScen},
    lots:lots.map(l=>({...l})), budgetQty:{...budgetQty}, budgetPrice:{...budgetPrice},
    customDivers:customDivers.map(c=>({...c})),
    descriptions:{description:desc,travaux,atouts},
    photos:photos.slice(),
  }),[nom,prixAffiche,prixNegocie,budgetTravaux,tauxNotaire,surface,honoraires,enedis,taxeFonciere,assurance,compta,provisions,apport1,apport2,taux1,taux2,duree1,duree2,coefEtat,imprevusPct,gestionActive,modeDetention,tmi,selectedScen,lots,budgetQty,budgetPrice,customDivers,desc,travaux,atouts,photos]);

  const sauvegarder = useCallback(async()=>{
    setSaving(true);
    const state = collectState();
    // Inclut client_id (peut être null si non lié). Si la colonne n'existe pas
    // encore en base (code 42703), on retry sans pour ne pas bloquer la save.
    const payload = {
      nom,
      created_by: profil?.email||profil?.nom||"inconnu",
      updated_at: new Date().toISOString(),
      donnees: state,
      client_id: clientId || null,
    };
    const tryWrite = async (p) => {
      if (projetIdRef.current) {
        return await supabase.from("invest_projets").update(p).eq("id", projetIdRef.current);
      } else {
        return await supabase.from("invest_projets").insert({...p, created_at:new Date().toISOString()}).select("id").single();
      }
    };
    let res = await tryWrite(payload);
    if (res.error?.code === "42703") {
      console.warn("Colonne client_id manquante sur invest_projets — fallback. Migration nécessaire.");
      const { client_id, ...payloadSansClient } = payload;
      res = await tryWrite(payloadSansClient);
    }
    if (res.error) {
      console.error("Erreur sauvegarde projet:", res.error);
    } else if (!projetIdRef.current && res.data?.id) {
      projetIdRef.current = res.data.id;
    }
    setSaving(false); setSaved(true); setTimeout(()=>setSaved(false),2500);
  },[collectState, nom, profil, clientId]);

  // Autosave 30s
  const autoRef = useRef(null);
  const scheduleAutoSave = useCallback(()=>{
    if(autoRef.current) clearTimeout(autoRef.current);
    autoRef.current = setTimeout(()=>sauvegarder(), 30000);
  },[sauvegarder]);
  useEffect(()=>()=>{if(autoRef.current)clearTimeout(autoRef.current);},[]);

  // ── Reset ───────────────────────────────────────────────────────────────────
  const doReset = () => {
    setPrixAffiche(0);setPrixNegocie(0);setSurface(0);setBudgetTravaux(0);
    setHonoraires(0);setEnedis(0);setTaxeFonciere(0);setAssurance(0);setCompta(0);setProvisions(0);
    setApport1(0);setApport2(0);setTaux1(0);setTaux2(0);setDuree1(0);setDuree2(0);
    setCoefEtat(1);setImprevusPct(10);setGestionActive(false);setModeDetention("IS");setTmi(0.30);
    setLots([{type:"Sélectionner",m2:0,loyer:0,niveau:"RDC",comment:""}]);
    setDesc("");setTravaux("");setAtouts("");setPhotos([null,null,null,null]);
    setCustomDivers([]);
    const b=initBudgetState([],0); setBudgetQty(b.qty); setBudgetPrice(b.price);
    setShowReset(false);
  };

  // ── Gestion lots ─────────────────────────────────────────────────────────────
  const addLot=()=>{if(lots.length>=MAX_LOTS)return;setLots([...lots,{type:"T2",m2:35,loyer:450,niveau:"RDC",comment:""}]);scheduleAutoSave();};
  const removeLot=(i)=>{if(lots.length<=1)return;setLots(lots.filter((_,idx)=>idx!==i));scheduleAutoSave();};
  const dupLot=(i)=>{if(lots.length>=MAX_LOTS)return;const n=[...lots];n.splice(i+1,0,{...lots[i]});setLots(n);scheduleAutoSave();};
  const updateLot=(i,k,v)=>{const n=[...lots];n[i]={...n[i],[k]:v};setLots(n);scheduleAutoSave();};

  // ── Export Excel ─────────────────────────────────────────────────────────────
  const exportXLSX = async()=>{
    const XLSX = await import("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js").catch(()=>null);
    if(!XLSX){alert("Export Excel non disponible.");return;}
    // Fallback simple si XLSX non dispo
    alert("Pour exporter, utilisez le bouton Export depuis l'interface.");
  };

  // ── Fiche PDF ────────────────────────────────────────────────────────────────
  const genererFiche=()=>{
    const win=window.open("","_blank","width=900,height=700");
    if(!win){alert("Autorisez les pop-ups.");return;}
    const fmtN=v=>Math.round(v).toLocaleString("fr-FR");
    const lotRows=aLots.map((l,i)=>`<tr><td>Appt ${i+1}${l.comment?` — <span style="color:#888;font-size:9px">${l.comment}</span>`:""}</td><td style="text-align:center">${l.type}</td><td style="text-align:center">${l.niveau||"—"}</td><td style="text-align:right">${l.m2} m²</td><td style="text-align:right;font-weight:700;color:#1a7a4a">${l.loyer.toLocaleString("fr-FR")} €</td></tr>`).join("");
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Fiche — ${nom}</title>
    <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Helvetica',sans-serif;background:white;padding:14mm;font-size:11px;color:#2c3040;}
    .hd{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #1f4ea1;}
    .brand{font-size:16px;font-weight:800;color:#1a2d4a;}.title{font-size:18px;font-weight:800;color:#1a2d4a;}
    .kpi-bar{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px;}
    .kpi{background:#f8f9fb;border-radius:7px;padding:9px 11px;border-left:3px solid #1f4ea1;}
    .kpi.green{border-left-color:#1a7a4a;}.kpi.gold{border-left-color:#c9a84c;}
    .kv{font-size:14px;font-weight:800;color:#1a2d4a;}.kv.green{color:#1a7a4a;}.kv.orange{color:#d4610a;}
    .kl{font-size:9px;font-weight:600;color:#9aa0b0;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;}
    .sec-hd{background:#1a2d4a;color:white;padding:5px 9px;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;border-radius:4px 4px 0 0;}
    .sec-bd{border:1px solid #eef0f5;border-top:none;border-radius:0 0 4px 4px;padding:9px 11px;}
    .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:11px;}
    table{width:100%;border-collapse:collapse;font-size:10px;}th{background:#1e3a5f;color:white;padding:4px 7px;text-align:left;font-size:9px;text-transform:uppercase;}
    td{padding:4px 7px;border-bottom:1px solid #eef0f5;}tr:nth-child(even) td{background:#f8f9fb;}
    .footer{border-top:1px solid #eef0f5;padding-top:7px;margin-top:12px;text-align:center;font-size:9px;color:#9aa0b0;}
    .no-print{position:fixed;top:14px;right:14px;display:flex;gap:7px;}
    .pbtn{padding:9px 18px;background:#1f4ea1;color:white;border:none;border-radius:5px;font-size:12px;font-weight:700;cursor:pointer;}
    .cbtn{padding:9px 14px;background:#f8f9fb;color:#1a2d4a;border:1px solid #d8dce6;border-radius:5px;font-size:12px;cursor:pointer;}
    @media print{.no-print{display:none!important;}body{padding:0;}@page{size:A4;margin:14mm;}}
    </style></head><body>
    <div class="no-print"><button class="cbtn" onclick="window.close()">✕ Fermer</button><button class="pbtn" onclick="window.print()">🖨️ Imprimer / PDF</button></div>
    <div class="hd"><div class="brand">🏢 Profero Invest</div><div><div class="title">${nom}</div><div style="font-size:11px;color:#1f4ea1;margin-top:3px">Analyse de Rentabilité · ${new Date().toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"})}</div></div></div>
    <div class="kpi-bar">
      <div class="kpi green"><div class="kv green">${(rb*100).toFixed(2)} %</div><div class="kl">Rendement brut</div></div>
      <div class="kpi green"><div class="kv green">${(rn*100).toFixed(2)} %</div><div class="kl">Rendement net</div></div>
      <div class="kpi ${cfm1>=0?"green":""}"><div class="kv ${cfm1>=0?"green":"orange"}">${fmtN(cfm1)} €/mois</div><div class="kl">Cash-flow S1</div></div>
      <div class="kpi"><div class="kv">${fmtN(coutTotal)} €</div><div class="kl">Coût total</div></div>
      <div class="kpi gold"><div class="kv">${fmtN(totLoyer)} €/mois</div><div class="kl">Loyers mensuels</div></div>
    </div>
    <div class="grid-2" style="margin-bottom:12px">
      <div><div class="sec-hd">🏢 Acquisition</div><div class="sec-bd">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 10px">
          <div><div style="font-size:9px;color:#9aa0b0;text-transform:uppercase">Prix négocié</div><div style="font-weight:700">${fmtN(prixNegocie)} €</div></div>
          <div><div style="font-size:9px;color:#9aa0b0;text-transform:uppercase">Budget travaux</div><div style="font-weight:700">${fmtN(budgetTravaux)} €</div></div>
          <div><div style="font-size:9px;color:#9aa0b0;text-transform:uppercase">Surface</div><div style="font-weight:700">${surface} m²</div></div>
          <div><div style="font-size:9px;color:#9aa0b0;text-transform:uppercase">Coût total</div><div style="font-weight:700;color:#1a7a4a">${fmtN(coutTotal)} €</div></div>
        </div>
        ${desc?`<div style="margin-top:7px;padding:5px 7px;background:#f0f4ff;border-radius:4px;border-left:3px solid #1f4ea1;font-size:10px;color:#5a6070;line-height:1.5">${desc}</div>`:""}
      </div></div>
      <div><div class="sec-hd">🏘️ Lots (${aLots.length})</div><div class="sec-bd" style="padding:0">
        <table><thead><tr><th>Lot</th><th>Type</th><th>Niv.</th><th>m²</th><th>Loyer</th></tr></thead>
        <tbody>${lotRows}<tr style="background:#1a2d4a"><td colspan="4" style="color:white;font-weight:700;padding:4px 7px">TOTAL</td><td style="text-align:right;color:#50c878;font-weight:700;padding:4px 7px">${fmtN(totLoyer)} €</td></tr></tbody></table>
      </div></div>
    </div>
    <div class="footer">Profero Invest · Document confidentiel · ${new Date().toLocaleDateString("fr-FR")}</div>
    </body></html>`);
    win.document.close();
  };

  // ── Champ numérique : utilise NumInput (défini top-level) ──────────────────

  // ── Photo handlers ───────────────────────────────────────────────────────────
  const handlePhoto=(i,file)=>{
    if(!file||file.size>5*1024*1024){alert("Photo max 5 Mo");return;}
    const r=new FileReader();
    r.onload=e=>{const p=[...photos];p[i]=e.target.result;setPhotos(p);scheduleAutoSave();};
    r.readAsDataURL(file);
  };

  const PHOTO_LABELS=["Photo principale","Vue intérieure","Vue extérieure","Autre"];

  const T = THEMES_INV.dark;
  return (
    <div className="inv" style={{position:"fixed",inset:0,zIndex:9999,display:"flex",flexDirection:"column"}}>
      <style>{CSS}</style>

      {/* Topbar moderne — fond sombre avec accent bleu (au lieu du navy/doré vintage) */}
      <div style={{
        background:T.sidebar,borderBottom:`1px solid ${T.sidebarBorder}`,
        padding:`${SPACING.sm+2}px ${SPACING.xl-4}px`,
        display:"flex",alignItems:"center",gap:SPACING.md,flexShrink:0,
        boxShadow:T.shadowSm,
      }}>
        <button className="inv-btn inv-btn-out inv-btn-sm" onClick={onRetour}>
          <Icon as={ArrowLeft} size={13} strokeWidth={2.2}/>
          Projets
        </button>
        <div style={{width:1,height:20,background:T.border}}/>
        <span style={{fontSize:FONT.xs.size,letterSpacing:1.8,textTransform:"uppercase",color:T.accent,fontWeight:700}}>
          Profero Invest
        </span>
        <input
          value={nom} onChange={e=>{setNom(e.target.value);scheduleAutoSave();}}
          style={{
            background:T.input,border:`1px solid ${T.inputBorder}`,
            borderRadius:RADIUS.md,padding:`${SPACING.xs+1}px ${SPACING.md}px`,
            color:T.text,fontFamily:"'Barlow Condensed',sans-serif",
            fontSize:FONT.base.size,fontWeight:700,outline:"none",minWidth:200,
            transition:"all .15s",
          }}
          onFocus={e=>{e.target.style.borderColor=T.accent; e.target.style.boxShadow=`0 0 0 3px ${T.accentBg}`;}}
          onBlur={e=>{e.target.style.borderColor=T.inputBorder; e.target.style.boxShadow="none";}}
        />
        {/* Sélecteur client lié (optionnel) */}
        <span style={{fontSize:FONT.xs.size,color:T.textMuted,letterSpacing:1.2,textTransform:"uppercase",fontWeight:700}}>Client</span>
        <select
          value={clientId}
          onChange={e=>{setClientId(e.target.value); scheduleAutoSave();}}
          style={{
            background: clientId ? T.accentBg : T.input,
            border:`1px solid ${clientId ? T.accentBorder : T.inputBorder}`,
            borderRadius:RADIUS.md,padding:`${SPACING.xs+1}px ${SPACING.md}px`,
            color: clientId ? T.accent : T.textSub,
            fontFamily:"'Barlow Condensed',sans-serif",fontSize:FONT.sm.size+1,
            fontWeight:600,outline:"none",cursor:"pointer",minWidth:170,
          }}
        >
          <option value="">— Aucun —</option>
          {clientsList.map(c => (
            <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
          ))}
        </select>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:SPACING.sm}}>
          {saving && (
            <span style={{fontSize:FONT.xs.size+1,color:T.textMuted,display:"inline-flex",alignItems:"center",gap:4}}>
              <Icon as={RefreshCw} size={11} strokeWidth={2.2} style={{animation:"spin 1s linear infinite"}}/>
              Sync…
            </span>
          )}
          {saved && !saving && (
            <span style={{fontSize:FONT.xs.size+1,color:SU,display:"inline-flex",alignItems:"center",gap:4,fontWeight:700}}>
              <Icon as={Check} size={12} strokeWidth={2.5}/> Sauvegardé
            </span>
          )}
          <button className="inv-btn inv-btn-sm inv-btn-danger" onClick={()=>setShowReset(true)}>
            <Icon as={RefreshCw} size={12} strokeWidth={2.2}/> Reset
          </button>
          <button className="inv-btn inv-btn-sm inv-btn-out" onClick={genererFiche}>
            <Icon as={FileText} size={12} strokeWidth={2.2}/> Fiche PDF
          </button>
          <button className="inv-btn inv-btn-sm inv-btn-gold" onClick={sauvegarder}>
            <Icon as={Save} size={12} strokeWidth={2.2}/> Enregistrer
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Tabs nav */}
      <div className="inv-tab-nav">
        {[["simulateur","📊 Simulateur"],["budget","🔨 Budget Travaux"],["fiscalite","⚖️ Fiscalité"]].map(([k,l])=>(
          <button key={k} className={`inv-tab-btn${tab===k?" active":""}`} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {/* Contenu scrollable */}
      <div style={{flex:1,overflowY:"auto",background:"#1e2128"}}>

        {/* ══ TAB SIMULATEUR ══ */}
        {tab==="simulateur"&&(
          <div style={{padding:"18px 22px",maxWidth:1200,margin:"0 auto"}}>
            {/* KPIs */}
            <div className="inv-kpi-bar" style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:18}}>
              <div className="inv-kpi"><div className="inv-kpi-lbl">Coût total opération</div><div className="inv-kpi-val">{fmt(coutTotal)}</div></div>
              <div className="inv-kpi"><div className="inv-kpi-lbl">Rentabilité nette</div><div className="inv-kpi-val green">{fmtPct(rn)}</div></div>
              <div className="inv-kpi">
                <div className="inv-kpi-lbl">Cash-flow mensuel</div>
                <div className={`inv-kpi-val ${cfSel>0?"green":cfSel<0?"red":"orange"}`}>{fmt(cfSel)}</div>
                <div className="inv-scen-toggle">
                  <button className={`inv-scen-btn${selectedScen===1?" active":""}`} onClick={()=>setSelectedScen(1)}>S1</button>
                  <button className={`inv-scen-btn${selectedScen===2?" active":""}`} onClick={()=>setSelectedScen(2)}>S2</button>
                </div>
              </div>
              <div className="inv-kpi"><div className="inv-kpi-lbl">Point d'équilibre</div><div className="inv-kpi-val orange">{fmtMois(peSel*12)}</div></div>
              <div className="inv-kpi"><div className="inv-kpi-lbl">Marge de sécurité</div><div className={`inv-kpi-val ${(1-peSel)>.2?"green":(1-peSel)>0?"orange":"red"}`}>{fmtPct(1-peSel)}</div></div>
            </div>

            <div className="inv-grid-2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
              {/* Colonne gauche */}
              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                {/* A — Acquisition */}
                <div className="inv-card">
                  <div className="inv-card-hd blue">🏠 A — Acquisition</div>
                  <div className="inv-card-bd">
                    {[
                      ["Prix affiché (€)", prixAffiche, setPrixAffiche],
                      ["Prix négocié (€)", prixNegocie, setPrixNegocie],
                    ].map(([label,val,set])=>(
                      <div key={label} className="inv-row"><span className="inv-lbl">{label}</span><NumInput value={val} onChange={set}/></div>
                    ))}
                    <div className="inv-row"><span className="inv-lbl">Négociation obtenue</span><span className="inv-val calc">{fmtPct(prixAffiche>0?(prixAffiche-prixNegocie)/prixAffiche:0)}</span></div>
                    <div className="inv-row">
                      <span className="inv-lbl">Taux frais notaire</span>
                      <select className="inv-sel" value={tauxNotaire} onChange={e=>{setTauxNotaire(parseFloat(e.target.value));scheduleAutoSave();}}>
                        <option value="0.08">8% (ancien)</option><option value="0.03">3% (neuf)</option>
                        <option value="0.025">2,5%</option><option value="0.07">7%</option>
                      </select>
                    </div>
                    <div className="inv-row"><span className="inv-lbl">Frais de notaire</span><span className="inv-val calc">{fmt(fn)}</span></div>
                    <div className="inv-row"><span className="inv-lbl">Surface totale (m²)</span><NumInput value={surface} onChange={setSurface}/></div>
                    <div className="inv-row"><span className="inv-lbl">Prix d'achat / m²</span><span className="inv-val calc">{surface>0?(prixAchat/surface).toFixed(0)+" €/m²":"—"}</span></div>
                    <div className="inv-row"><span className="inv-lbl">Budget travaux TTC (€)</span><NumInput value={budgetTravaux} onChange={setBudgetTravaux}/></div>
                    <div className="inv-row"><span className="inv-lbl">Honoraires (€)</span><NumInput value={honoraires} onChange={setHonoraires}/></div>
                    <div className="inv-row"><span className="inv-lbl">Raccordement Enedis (€)</span><NumInput value={enedis} onChange={setEnedis}/></div>
                    <div className="inv-row total"><span className="inv-lbl bold">COÛT TOTAL OPÉRATION</span><span className="inv-val green">{fmt(coutTotal)}</span></div>
                  </div>
                </div>

                {/* C — Charges */}
                <div className="inv-card">
                  <div className="inv-card-hd mid">📋 C — Charges d'Exploitation</div>
                  <div className="inv-card-bd">
                    {[["Taxe foncière (€/an)",taxeFonciere,setTaxeFonciere],["Assurance PNO (€/an)",assurance,setAssurance],["Comptabilité société (€/an)",compta,setCompta],["Provisions travaux (€/an)",provisions,setProvisions]].map(([l,v,s])=>(
                      <div key={l} className="inv-row"><span className="inv-lbl">{l}</span><NumInput value={v} onChange={s}/></div>
                    ))}
                    <div className="inv-row sub"><span className="inv-lbl">Frais gestion locative (€/an)</span><span className="inv-val calc">{gestionActive?fmt(totGestAn):"0 €"}</span></div>
                    <div className="inv-row total"><span className="inv-lbl bold">TOTAL CHARGES (€/an)</span><span className="inv-val orange">{fmt(totCharges)}</span></div>
                  </div>
                </div>
              </div>

              {/* Colonne droite */}
              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                {/* B — Lots */}
                <div className="inv-card">
                  <div className="inv-card-hd">🏘️ B — Lots & Loyers</div>
                  <div className="inv-card-bd">
                    <div className="inv-toggle-wrap">
                      <label className="inv-toggle">
                        <input type="checkbox" checked={gestionActive} onChange={e=>{setGestionActive(e.target.checked);scheduleAutoSave();}}/>
                        <span className="inv-toggle-sl"/>
                      </label>
                      <span style={{fontSize:12,fontWeight:600,color:"#5a6070"}}>Gestion locative externalisée</span>
                    </div>
                    <div style={{overflowX:"auto"}}>
                      <div className="inv-lot-grid hd">
                        <div>Type</div><div>m²</div><div>Niveau</div><div>Loyer/mois</div>
                        <div>Loyer/an</div><div>€/m²</div><div>Gestion</div><div>Note</div><div/>
                      </div>
                      {lots.map((lot,i)=>{
                        const gP=gestionActive?(GESTION_PRICES[lot.type]||0):0;
                        return (
                          <div key={i} className="inv-lot-grid">
                            <select className="inv-sel" value={lot.type} style={{fontSize:11,padding:"4px 5px"}}
                              onChange={e=>updateLot(i,"type",e.target.value)}>
                              {LOT_TYPES.map(t=><option key={t}>{t}</option>)}
                            </select>
                            <input type="number" className="inv-inp" value={lot.m2} style={{fontSize:12,padding:"4px 6px"}}
                              onChange={e=>updateLot(i,"m2",parseFloat(e.target.value)||0)}/>
                            <select className="inv-sel" value={lot.niveau||"RDC"} style={{fontSize:11,padding:"4px 5px"}}
                              onChange={e=>updateLot(i,"niveau",e.target.value)}>
                              {NIVEAUX.map(n=><option key={n}>{n}</option>)}
                            </select>
                            <input type="number" className="inv-inp" value={lot.loyer} style={{fontSize:12,padding:"4px 6px"}}
                              onChange={e=>updateLot(i,"loyer",parseFloat(e.target.value)||0)}/>
                            <div className="inv-lot-val">{fmt(lot.loyer*12)}</div>
                            <div className="inv-lot-val">{lot.m2>0?(lot.loyer/lot.m2).toFixed(2):"—"}</div>
                            <div className="inv-lot-val" style={{color:gestionActive?"#d4610a":"#9aa0b0"}}>{gestionActive?fmt(gP):"—"}</div>
                            <input type="text" className="inv-inp" value={lot.comment||""} placeholder="Note…"
                              style={{fontSize:11,padding:"3px 6px",textAlign:"left",background:"#f8f9fb",borderColor:"#d8dce6"}}
                              onChange={e=>updateLot(i,"comment",e.target.value)}/>
                            <div style={{display:"flex",gap:2}}>
                              <button className="inv-rm" title="Dupliquer" style={{color:"#1f4ea1",fontSize:13}} onClick={()=>dupLot(i)}>⧉</button>
                              <button className="inv-rm" onClick={()=>removeLot(i)}>×</button>
                            </div>
                          </div>
                        );
                      })}
                      {/* Total */}
                      <div className="inv-lot-grid" style={{fontWeight:700,fontSize:12,color:"#1a2d4a"}}>
                        <div style={{gridColumn:"1/3"}}>TOTAL</div><div/><div/>
                        <div className="inv-lot-val" style={{color:"#1a7a4a",fontWeight:700}}>{fmt(totLoyer)}</div>
                        <div className="inv-lot-val" style={{color:"#1a7a4a",fontWeight:700}}>{fmt(totLoyerAn)}</div>
                        <div/><div className="inv-lot-val" style={{color:"#d4610a",fontWeight:700}}>{gestionActive?fmt(totGestMois):"—"}</div>
                        <div/><div/>
                      </div>
                    </div>
                    {lots.length<MAX_LOTS&&(
                      <button className="inv-add-lot" onClick={addLot}>＋ Ajouter un lot</button>
                    )}
                  </div>
                </div>

                {/* Description */}
                <div className="inv-card">
                  <div className="inv-card-hd mid">📝 Description du Projet</div>
                  <div className="inv-card-bd" style={{display:"flex",flexDirection:"column",gap:10}}>
                    {[["Description générale","Localisation, contexte…",desc,setDesc],["Travaux envisagés","Rénovation toiture, électricité…",travaux,setTravaux],["Atouts / Points de vigilance","Emplacement, potentiel, risques…",atouts,setAtouts]].map(([label,ph,val,set])=>(
                      <div key={label}>
                        <label style={{fontSize:10,fontWeight:700,color:"#9aa0b0",textTransform:"uppercase",letterSpacing:1.2,display:"block",marginBottom:5}}>{label}</label>
                        <textarea className="inv-textarea" rows={2} placeholder={ph} value={val}
                          onChange={e=>{set(e.target.value);scheduleAutoSave();}}/>
                      </div>
                    ))}
                    {/* Photos */}
                    <div>
                      <label style={{fontSize:10,fontWeight:700,color:"#9aa0b0",textTransform:"uppercase",letterSpacing:1.2,display:"block",marginBottom:8}}>Photos du bien</label>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                        {photos.map((photo,i)=>(
                          <div key={i}>
                            <div style={{fontSize:9,fontWeight:700,color:"#9aa0b0",textTransform:"uppercase",letterSpacing:.8,marginBottom:4}}>{PHOTO_LABELS[i]}</div>
                            <div className={`inv-photo-zone${photo?" has-photo":""}`}
                              onClick={()=>document.getElementById(`photo-input-${i}`).click()}>
                              {photo
                                ? <>
                                    <img src={photo} alt={`Photo ${i+1}`} style={{width:"100%",height:90,objectFit:"cover"}}/>
                                    <div className="inv-photo-actions">
                                      <button style={{background:"rgba(0,0,0,.55)",color:"white",border:"none",borderRadius:3,padding:"3px 7px",fontSize:10,cursor:"pointer"}}
                                        onClick={e=>{e.stopPropagation();const p=[...photos];p[i]=null;setPhotos(p);}}>✕</button>
                                    </div>
                                  </>
                                : <>
                                    <span style={{fontSize:22}}>📷</span>
                                    <span style={{fontSize:11,fontWeight:600,color:"#9aa0b0",textAlign:"center"}}>Cliquer ou glisser</span>
                                  </>
                              }
                            </div>
                            <input id={`photo-input-${i}`} type="file" accept="image/*" style={{display:"none"}}
                              onChange={e=>handlePhoto(i,e.target.files[0])}/>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* D+E — Financement + Rentabilité */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginTop:16}}>
              <div className="inv-card">
                <div className="inv-card-hd mid">🏦 D — Plan de Financement</div>
                <div className="inv-card-bd">
                  <div className="inv-scen-hd"><div>Paramètre</div><div style={{textAlign:"right"}}>Scénario 1</div><div style={{textAlign:"right"}}>Scénario 2</div></div>
                  <div className="inv-scen-row"><div className="inv-lbl">Montant opération</div><div className="inv-s">{fmt(coutTotal)}</div><div className="inv-s">{fmt(coutTotal)}</div></div>
                  <div className="inv-scen-row">
                    <div className="inv-lbl">Apport (€)</div>
                    <div><input type="number" className="inv-inp" value={apport1} style={{width:95,fontSize:12,padding:"4px 6px"}} onChange={e=>{setApport1(parseFloat(e.target.value)||0);scheduleAutoSave();}}/></div>
                    <div><input type="number" className="inv-inp" value={apport2} style={{width:95,fontSize:12,padding:"4px 6px"}} onChange={e=>{setApport2(parseFloat(e.target.value)||0);scheduleAutoSave();}}/></div>
                  </div>
                  <div className="inv-scen-row"><div className="inv-lbl">À financer</div><div className="inv-s">{fmt(af1)}</div><div className="inv-s">{fmt(af2)}</div></div>
                  <div className="inv-scen-row">
                    <div className="inv-lbl">Taux TAEG (%)</div>
                    <div><input type="number" className="inv-inp" value={taux1} step="0.01" style={{width:75,fontSize:12,padding:"4px 6px"}} onChange={e=>{setTaux1(parseFloat(e.target.value)||0);scheduleAutoSave();}}/></div>
                    <div><input type="number" className="inv-inp" value={taux2} step="0.01" style={{width:75,fontSize:12,padding:"4px 6px"}} onChange={e=>{setTaux2(parseFloat(e.target.value)||0);scheduleAutoSave();}}/></div>
                  </div>
                  <div className="inv-scen-row">
                    <div className="inv-lbl">Durée (années)</div>
                    <div><input type="number" className="inv-inp" value={duree1} style={{width:75,fontSize:12,padding:"4px 6px"}} onChange={e=>{setDuree1(parseFloat(e.target.value)||0);scheduleAutoSave();}}/></div>
                    <div><input type="number" className="inv-inp" value={duree2} style={{width:75,fontSize:12,padding:"4px 6px"}} onChange={e=>{setDuree2(parseFloat(e.target.value)||0);scheduleAutoSave();}}/></div>
                  </div>
                  <div className="inv-scen-row hl"><div className="inv-lbl bold">Mensualité</div><div className="inv-s green">{fmt(m1)}</div><div className="inv-s green">{fmt(m2)}</div></div>
                  <div className="inv-scen-row"><div className="inv-lbl">Annuité</div><div className="inv-s">{fmt(ann1)}</div><div className="inv-s">{fmt(ann2)}</div></div>
                </div>
              </div>

              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                <div className="inv-card">
                  <div className="inv-card-hd gold">📈 E — Rentabilité</div>
                  <div className="inv-card-bd">
                    <div className="inv-scen-hd"><div>Indicateur</div><div style={{textAlign:"right"}}>S1</div><div style={{textAlign:"right"}}>S2</div></div>
                    <div className="inv-scen-row"><div className="inv-lbl">Loyers bruts annuels</div><div className="inv-s">{fmt(totLoyerAn)}</div><div className="inv-s"></div></div>
                    <div className="inv-scen-row"><div className="inv-lbl">Rentabilité brute</div><div className="inv-s">{fmtPct(rb)}</div><div className="inv-s"></div></div>
                    <div className="inv-scen-row hl"><div className="inv-lbl bold">Rentabilité nette</div><div className="inv-s green">{fmtPct(rn)}</div><div className="inv-s green">{fmtPct(rn)}</div></div>
                    <div className="inv-scen-row hl"><div className="inv-lbl bold">Cash-flow mensuel</div><div className={`inv-s ${cfm1>0?"green":cfm1<0?"orange":""}`}>{fmt(cfm1)}</div><div className={`inv-s ${cfm2>0?"green":cfm2<0?"orange":""}`}>{fmt(cfm2)}</div></div>
                    <div className="inv-scen-row"><div className="inv-lbl">Cash-flow annuel</div><div className="inv-s">{fmt(cfm1*12)}</div><div className="inv-s">{fmt(cfm2*12)}</div></div>
                  </div>
                </div>
                <div className="inv-card">
                  <div className="inv-card-hd danger">⚖️ F — Point d'Équilibre</div>
                  <div className="inv-card-bd">
                    <div className="inv-scen-hd"><div>Indicateur</div><div style={{textAlign:"right"}}>S1</div><div style={{textAlign:"right"}}>S2</div></div>
                    <div className="inv-scen-row warn"><div className="inv-lbl bold">Point d'équilibre (%)</div><div className="inv-s orange">{fmtPct(pe1)}</div><div className="inv-s orange">{fmtPct(pe2)}</div></div>
                    <div className="inv-scen-row warn"><div className="inv-lbl bold">Point d'équilibre (mois)</div><div className="inv-s orange">{fmtMois(pe1*12)}</div><div className="inv-s orange">{fmtMois(pe2*12)}</div></div>
                    <div className="inv-scen-row hl"><div className="inv-lbl bold">Marge de sécurité</div><div className="inv-s green">{fmtPct(1-pe1)}</div><div className="inv-s green">{fmtPct(1-pe2)}</div></div>
                    <div className="inv-scen-row"><div className="inv-lbl">Loyer minimum viable</div><div className="inv-s">{fmt(ct1/12)}</div><div className="inv-s">{fmt(ct2/12)}</div></div>
                  </div>
                </div>
              </div>
            </div>

            {/* G — Fiscalité rapide */}
            <div className="inv-card" style={{marginTop:16}}>
              <div className="inv-card-hd">🧾 G — Fiscalité Rapide (Scénario 1)</div>
              <div className="inv-card-bd">
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
                  <div>
                    <div className="inv-row"><span className="inv-lbl">Mode de détention</span>
                      <select className="inv-sel" value={modeDetention} onChange={e=>{setModeDetention(e.target.value);scheduleAutoSave();}}>
                        <option value="IS">SCI à l'IS</option><option value="IR">SCI à l'IR</option><option value="LMNP">LMNP au réel</option>
                      </select>
                    </div>
                    <div className="inv-row"><span className="inv-lbl">TMI du foyer</span>
                      <select className="inv-sel" value={tmi} onChange={e=>{setTmi(parseFloat(e.target.value));scheduleAutoSave();}}>
                        {[0,0.11,0.30,0.41,0.45].map(v=><option key={v} value={v}>{(v*100).toFixed(0)}%</option>)}
                      </select>
                    </div>
                    <div className="inv-row"><span className="inv-lbl">Résultat avant impôt (€/an)</span><span className="inv-val calc">{fmt(res)}</span></div>
                    <div className="inv-row"><span className="inv-lbl">Impôt estimé (€/an)</span><span className="inv-val calc">{fmt(impotRapide)}</span></div>
                  </div>
                  <div>
                    <div className="inv-row"><span className="inv-lbl">CF net après impôt (€/an)</span><span className="inv-val green">{fmt(cfNetRapide)}</span></div>
                    <div className="inv-row"><span className="inv-lbl">CF net après impôt (€/mois)</span><span className="inv-val green">{fmt(cfNetRapide/12)}</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ TAB BUDGET ══ */}
        {tab==="budget"&&(
          <div style={{padding:"18px 22px",maxWidth:1200,margin:"0 auto"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
              <div className="inv-card">
                <div className="inv-card-hd mid">⚙️ Paramètres</div>
                <div className="inv-card-bd">
                  {[["Surface totale",surface+" m²"],["Logements",actLots(lots).length],["Studios",lots.filter(l=>l.type==="Studio").length],["T1",lots.filter(l=>l.type==="T1").length],["T2",lots.filter(l=>l.type==="T2").length],["T3",lots.filter(l=>l.type==="T3").length],["T4+",lots.filter(l=>["T4","T5","T6"].includes(l.type)).length]].map(([l,v])=>(
                    <div key={l} className="inv-row"><span className="inv-lbl">{l}</span><span className="inv-val calc">{v}</span></div>
                  ))}
                </div>
              </div>
              <div className="inv-card">
                <div className="inv-card-hd mid">🏗️ Coefficient État Général</div>
                <div className="inv-card-bd">
                  {[["Bon état général","× 0,70","#1a7a4a"],["État moyen","× 1,00","#2c3040"],["Mauvais état","× 1,30","#d4610a"],["Passoire / ruine","× 1,60","#c0392b"]].map(([l,v,c])=>(
                    <div key={l} className="inv-row"><span className="inv-lbl">{l}</span><span className="inv-val" style={{color:c}}>{v}</span></div>
                  ))}
                  <div className="inv-row total">
                    <span className="inv-lbl bold">▶ Coefficient retenu</span>
                    <input type="number" className="inv-inp" value={coefEtat} step="0.05" min="0.5" max="2" style={{width:80}}
                      onChange={e=>{setCoefEtat(parseFloat(e.target.value)||1);scheduleAutoSave();}}/>
                  </div>
                </div>
              </div>
            </div>

            <div className="inv-card">
              <div className="inv-card-hd">🔨 Détail par Corps de Métier</div>
              <div className="inv-card-bd">
                <div className="inv-brow hd">
                  <div>Corps de métier</div><div style={{textAlign:"center"}}>Base</div>
                  <div style={{textAlign:"right"}}>Qté</div><div style={{textAlign:"right"}}>Prix unit.</div><div style={{textAlign:"right"}}>Total HT</div>
                </div>
                {BUDGET_SECTIONS.map(sec=>(
                  <React.Fragment key={sec.id}>
                    <div className="inv-bsec">{sec.sec}</div>
                    {sec.items.map(item=>{
                      const tot=(budgetQty[item.id]||0)*(budgetPrice[item.id]||0);
                      return (
                        <div key={item.id} className="inv-brow">
                          <div className="bl">{item.label}</div>
                          <div style={{textAlign:"center",fontSize:11,color:"#9aa0b0"}}>{item.base}</div>
                          <div><input type="number" className="inv-inp" value={budgetQty[item.id]||0} min="0"
                            style={{width:"100%",fontSize:12,padding:"3px 6px"}}
                            onChange={e=>{setBudgetQty(q=>({...q,[item.id]:parseFloat(e.target.value)||0}));scheduleAutoSave();}}/></div>
                          <div><input type="number" className="inv-inp" value={budgetPrice[item.id]||0} min="0"
                            style={{width:"100%",fontSize:12,padding:"3px 6px"}}
                            onChange={e=>{setBudgetPrice(p=>({...p,[item.id]:parseFloat(e.target.value)||0}));scheduleAutoSave();}}/></div>
                          <div className="bn" style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:12}}>{fmt(tot)}</div>
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
                {/* Lignes personnalisées */}
                {customDivers.map((cd,ci)=>(
                  <div key={ci} className="inv-brow">
                    <div><input type="text" className="inv-inp" value={cd.label||""} placeholder="Désignation"
                      style={{width:"100%",fontSize:12,padding:"3px 6px",textAlign:"left"}}
                      onChange={e=>{const n=[...customDivers];n[ci]={...n[ci],label:e.target.value};setCustomDivers(n);scheduleAutoSave();}}/></div>
                    <div style={{textAlign:"center",fontSize:11,color:"#9aa0b0"}}>unité</div>
                    <div><input type="number" className="inv-inp" value={cd.qty||0} min="0"
                      style={{width:"100%",fontSize:12,padding:"3px 6px"}}
                      onChange={e=>{const n=[...customDivers];n[ci]={...n[ci],qty:parseFloat(e.target.value)||0};setCustomDivers(n);scheduleAutoSave();}}/></div>
                    <div><input type="number" className="inv-inp" value={cd.price||0} min="0"
                      style={{width:"100%",fontSize:12,padding:"3px 6px"}}
                      onChange={e=>{const n=[...customDivers];n[ci]={...n[ci],price:parseFloat(e.target.value)||0};setCustomDivers(n);scheduleAutoSave();}}/></div>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:4}}>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:12}}>{fmt((cd.qty||0)*(cd.price||0))}</span>
                      <button className="inv-rm" onClick={()=>{setCustomDivers(customDivers.filter((_,j)=>j!==ci));scheduleAutoSave();}}>×</button>
                    </div>
                  </div>
                ))}
                <button className="inv-add-lot" style={{marginTop:8}}
                  onClick={()=>{setCustomDivers([...customDivers,{label:"",qty:1,price:0}]);}}>
                  ＋ Ligne personnalisée
                </button>

                {/* Imprévus */}
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0 4px",borderTop:"1px solid #d8dce6",marginTop:8,gap:8}}>
                  <span style={{fontSize:12,fontWeight:600,color:"#d4610a"}}>Provision imprévus</span>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <input type="number" className="inv-inp" value={imprevusPct} min="0" max="50" style={{width:60,borderColor:"#d4610a"}}
                      onChange={e=>{setImprevusPct(parseFloat(e.target.value)||0);scheduleAutoSave();}}/>
                    <span style={{fontSize:12,color:"#d4610a",fontWeight:600}}>%</span>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,color:"#d4610a",minWidth:90,textAlign:"right"}}>{fmt(budgetImp)}</span>
                  </div>
                </div>

                {/* Totaux */}
                <div style={{display:"grid",gridTemplateColumns:"1fr auto",padding:"6px 0",borderTop:"2px solid #1a2d4a",marginTop:5,fontSize:12,fontWeight:700,color:"#1a2d4a"}}>
                  <div>Sous-total HT + imprévus</div><div style={{fontFamily:"'DM Mono',monospace"}}>{fmt(budgetSub+budgetImp)}</div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr auto",padding:"4px 0",fontSize:12,fontWeight:600,color:"#1e3a5f"}}>
                  <div>× Coefficient état (×{coefEtat.toFixed(2).replace(".",",")})</div><div style={{fontFamily:"'DM Mono',monospace"}}>{fmt(budgetCoef)}</div>
                </div>
                <div style={{background:"#1a2d4a",margin:"7px -16px 0",padding:"10px 16px",borderRadius:"0 0 10px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{color:"white",fontSize:13,fontWeight:800}}>TOTAL TTC (TVA 10%)</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:18,fontWeight:700,color:"#c9a84c"}}>{fmt(budgetTTC)}</span>
                </div>
                <div style={{display:"flex",gap:20,marginTop:12,paddingTop:10,borderTop:"1px solid #eef0f5"}}>
                  <div><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:.6,color:"#9aa0b0"}}>Budget HT/m²</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:18,fontWeight:700,color:"#1a2d4a"}}>{surface>0?Math.round(budgetCoef/surface)+" €/m²":"—"}</div></div>
                  <div><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:.6,color:"#9aa0b0"}}>Budget TTC/m²</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:18,fontWeight:700,color:"#1a2d4a"}}>{surface>0?Math.round(budgetTTC/surface)+" €/m²":"—"}</div></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ TAB FISCALITÉ ══ */}
        {tab==="fiscalite"&&(
          <div style={{padding:"18px 22px",maxWidth:1200,margin:"0 auto"}}>
            {/* Comparatif */}
            <div className="inv-card" style={{marginBottom:16}}>
              <div className="inv-card-hd">⚖️ Comparatif des Régimes Fiscaux</div>
              <div className="inv-card-bd" style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead><tr>
                    <th style={{textAlign:"left",padding:8,borderBottom:"2px solid #d8dce6",color:"#9aa0b0",fontSize:10,textTransform:"uppercase",letterSpacing:.5}}>Critère</th>
                    <th style={{textAlign:"center",padding:8,borderBottom:"2px solid #1e3a5f",color:"#1e3a5f",background:"rgba(30,58,95,.04)"}}>SCI à l'IS</th>
                    <th style={{textAlign:"center",padding:8,borderBottom:"2px solid #6b3a8a",color:"#6b3a8a",background:"rgba(107,58,138,.04)"}}>SCI à l'IR</th>
                    <th style={{textAlign:"center",padding:8,borderBottom:"2px solid #1a7a4a",color:"#1a7a4a",background:"rgba(26,122,74,.04)"}}>LMNP (réel)</th>
                  </tr></thead>
                  <tbody>
                    {COMP_FISCA.map((r,i)=>(
                      <tr key={i} style={{background:i%2===0?"rgba(255,255,255,0.03)":"transparent"}}>
                        <td style={{padding:8,fontWeight:600,color:"#e8eaf0",borderBottom:"1px solid #2a2d3a"}}>{r[0]}</td>
                        {[1,2,3].map(j=><td key={j} style={{padding:8,textAlign:"center",borderBottom:"1px solid #2a2d3a"}}>{r[j]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 3 régimes */}
            <div className="inv-fisca-grid" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16}}>
              {/* IS */}
              <div className="inv-regime">
                <div className="inv-regime-hd is">🏢 SCI à l'IS</div>
                {[["Loyers bruts",fmt(totLoyerAn)],["− Charges exploitation",fmt(totCharges)],["− Intérêts emprunt ~70%",fmt(ann1*.7)],["− Amortissement bien /30 ans",fmt(ab)],[" Résultat imposable",fmt(rIS),rIS<0?"warn":""],["IS tranche 1 (15%)",fmt(isT1)],["IS tranche 2 (25%)",fmt(isT2)],["IS total",fmt(isT1+isT2)],["CF net annuel après IS",fmt(cfIS),"hl"],["CF net mensuel",fmt(cfIS/12),"hl"]].map(([l,v,cls])=>(
                  <div key={l} className={`inv-regime-row ${cls||""}`}><div className="rl">{l}</div><div className="rv">{v}</div></div>
                ))}
              </div>
              {/* IR */}
              <div className="inv-regime">
                <div className="inv-regime-hd ir">👤 SCI à l'IR</div>
                {[["Loyers bruts",fmt(totLoyerAn)],["− Charges déductibles",fmt(totCharges)],["− Intérêts emprunt ~70%",fmt(ann1*.7)],[" Revenu foncier net",fmt(rf),rf<0?"warn":""],["Impôt IR (TMI)",fmt(irImp)],["Prélèvements sociaux 17,2%",fmt(irPS)],["Total imposition",fmt(irImp+irPS)],["CF net annuel",fmt(cfIR),"hl"],["CF net mensuel",fmt(cfIR/12),"hl"]].map(([l,v,cls])=>(
                  <div key={l} className={`inv-regime-row ${cls||""}`}><div className="rl">{l}</div><div className="rv">{v}</div></div>
                ))}
              </div>
              {/* LMNP */}
              <div className="inv-regime">
                <div className="inv-regime-hd lmnp">🏨 LMNP au Réel</div>
                {[["Loyers bruts",fmt(totLoyerAn)],["− Charges",fmt(totCharges)],["− Amortissement bien /30 ans",fmt(ab)],["− Amortissement travaux /10 ans",fmt(at)],[" Résultat imposable",fmt(rL),rL<0?"warn":""],["Déficit reportable",fmt(Math.min(rL,0)),rL<0?"hl":""],["Imposition BIC (TMI)",fmt(lImp)],["CF net annuel",fmt(cfL),"hl"],["CF net mensuel",fmt(cfL/12),"hl"]].map(([l,v,cls])=>(
                  <div key={l} className={`inv-regime-row ${cls||""}`}><div className="rl">{l}</div><div className="rv">{v}</div></div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal Reset */}
      {showReset&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
          <div style={{background:"#111318",border:"1px solid #2a2d3a",borderRadius:14,padding:"26px 30px",maxWidth:380,width:"90%",textAlign:"center"}}>
            <div style={{fontSize:34,marginBottom:10}}>⚠️</div>
            <div style={{fontSize:15,fontWeight:800,color:"#1a2d4a",marginBottom:7}}>Réinitialiser le simulateur ?</div>
            <div style={{fontSize:13,color:"#5a6070",marginBottom:22,lineHeight:1.6}}>Toutes les données saisies seront effacées. Cette action est irréversible.</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <button className="inv-btn inv-btn-out" onClick={()=>setShowReset(false)}>Annuler</button>
              <button className="inv-btn" style={{background:"#c0392b",color:"white"}} onClick={doReset}>Réinitialiser</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TABLEAU DE BORD INVEST ───────────────────────────────────────────────────
function KPICard({ label, value, color, icon: IconComp }) {
  const c = color || "#FFC200";
  return (
    <div className="inv-kpi" style={{
      display:"flex", flexDirection:"row", alignItems:"center", gap:SPACING.md,
      borderLeft:`3px solid ${c}`,
    }}>
      {IconComp && (
        <div style={{
          width:38, height:38, borderRadius:RADIUS.md, flexShrink:0,
          background:`${c}18`, color:c,
          display:"flex", alignItems:"center", justifyContent:"center",
        }}>
          <Icon as={IconComp} size={19} strokeWidth={2}/>
        </div>
      )}
      <div style={{minWidth:0, flex:1}}>
        <div className="inv-kpi-lbl">{label}</div>
        <div className="inv-kpi-val" style={{ color:c, fontSize:FONT.xl.size+2 }}>{value}</div>
      </div>
    </div>
  );
}

function TableauBord({ profil, T=THEMES_INV.dark }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const charger = async () => {
      setLoading(true);
      const [{ data: clients }, { data: biens }, { data: props }] = await Promise.all([
        supabase.from("invest_clients").select("statut,budget,date_signature,prochaine_action"),
        supabase.from("invest_biens").select("statut,date_relance,rendement_brut,cashflow_estime"),
        supabase.from("invest_propositions").select("client_id,bien_id,created_at"),
      ]);
      const c = clients || [], b = biens || [], p = props || [];
      const today = new Date().toISOString().slice(0, 10);
      setStats({
        prospects:       c.filter(x => x.statut === "Prospect").length,
        actifs:          c.filter(x => x.statut === "Actif").length,
        inactifs:        c.filter(x => x.statut === "Inactif").length,
        termines:        c.filter(x => x.statut === "Terminé").length,
        totalSignes:     c.filter(x => x.date_signature).length,
        sommeBudgets:    c.filter(x => x.date_signature).reduce((s, x) => s + (x.budget || 0), 0),
        biensTotaux:     b.length,
        biensARelancer:  b.filter(x => x.date_relance && x.date_relance <= today).length,
        visitesProg:     b.filter(x => x.statut === "Visite programmée").length,
        offreEnvoyees:   b.filter(x => x.statut === "Offre envoyée").length,
        offresAcceptees: b.filter(x => x.statut === "Offre acceptée").length,
        sansProchaineAction: c.filter(x => !x.prochaine_action).length,
        nbPropositions:  p.length,
        moyBiensParClient: c.length > 0 ? (p.length / Math.max(c.filter(x => x.date_signature).length, 1)).toFixed(1) : "—",
      });
      setLoading(false);
    };
    charger();
  }, []);

  const fmt = v => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v);


  const sectionTitle = (icon, label) => (
    <div style={{
      fontSize:FONT.xs.size, fontWeight:700, color:T.textMuted, textTransform:"uppercase",
      letterSpacing:1.8, marginBottom:SPACING.md, display:"flex", alignItems:"center", gap:SPACING.sm-2,
    }}>
      <Icon as={icon} size={13} strokeWidth={2}/>
      {label}
    </div>
  );

  return (
    <div style={{ padding:`${SPACING.xl}px ${SPACING.xl+4}px`, maxWidth:1200, margin:"0 auto" }}>
      <div style={{ marginBottom:SPACING.xl, display:"flex", alignItems:"center", gap:SPACING.md }}>
        <div style={{
          width:48, height:48, borderRadius:RADIUS.lg, flexShrink:0,
          background:T.accentBg, color:T.accent,
          display:"flex", alignItems:"center", justifyContent:"center",
        }}>
          <Icon as={LayoutDashboard} size={24} strokeWidth={2}/>
        </div>
        <div>
          <div style={{ fontSize:FONT.h2.size, fontWeight:800, color:T.text, letterSpacing:-0.3 }}>Tableau de bord</div>
          <div style={{ fontSize:FONT.sm.size+1, color:T.textSub, marginTop:2 }}>Vue globale de l'activité Profero Invest</div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign:"center", padding:`${SPACING.xxxl}px 0`, color:T.textMuted, display:"flex", justifyContent:"center", alignItems:"center", gap:8 }}>
          <Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>
          Chargement…
        </div>
      ) : stats && (
        <>
          {sectionTitle(Users, "Clients & Prospects")}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:SPACING.md, marginBottom:SPACING.xxl-2 }}>
            <KPICard icon={Users}        label="Prospects"             value={stats.prospects}       color="#4db8ff" />
            <KPICard icon={Check}        label="Clients actifs"        value={stats.actifs}          color={SU} />
            <KPICard icon={Bell}         label="Clients inactifs"      value={stats.inactifs}        color={WA} />
            <KPICard icon={Lock}         label="Terminés"              value={stats.termines}        color={T.textMuted} />
            <KPICard icon={Handshake}    label="Total signés"          value={stats.totalSignes}     color={SU} />
            <KPICard icon={Wallet}       label="Budget total signé"    value={stats.sommeBudgets > 0 ? fmt(stats.sommeBudgets)+" €" : "—"} color="#FFC200" />
            <KPICard icon={AlertTriangle} label="Sans prochaine action" value={stats.sansProchaineAction} color={DA} />
            <KPICard icon={Briefcase}    label="Moy. biens / client"   value={stats.moyBiensParClient} color="#c084fc" />
          </div>

          {sectionTitle(Building2, "Stock de Biens")}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:SPACING.md }}>
            <KPICard icon={Home}         label="Biens en stock"        value={stats.biensTotaux}      color="#4db8ff" />
            <KPICard icon={Bell}         label="À relancer"            value={stats.biensARelancer}   color={DA} />
            <KPICard icon={Calendar}     label="Visites programmées"   value={stats.visitesProg}      color={SU} />
            <KPICard icon={Send}         label="Offres envoyées"       value={stats.offreEnvoyees}    color="#FFC200" />
            <KPICard icon={Check}        label="Offres acceptées"      value={stats.offresAcceptees}  color={SU} />
            <KPICard icon={Hammer}       label="Propositions totales"  value={stats.nbPropositions}   color="#c084fc" />
          </div>
        </>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── CRM CLIENTS ──────────────────────────────────────────────────────────────
const STATUTS_CLIENT  = ["Prospect","Actif","Inactif","Terminé"];
const SOURCES_CLIENT  = ["Fluidify","Réseau personnel","Cold calling","Autre"];
const TYPES_NOTE      = ["appel","rendez-vous","relance","commentaire","document","autre"];
const STATUTS_PROP    = ["proposé","intéressé","refusé","en analyse","offre en cours"];

function CRM({ profil, T=THEMES_INV.dark, onOuvrirSimulation }) {
  const [clients, setClients]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [ficheId, setFicheId]     = useState(null);
  const [showForm, setShowForm]   = useState(false);
  const [filtreStatut, setFiltreStatut] = useState("");
  const [filtreConseiller, setFiltreConseiller] = useState("");
  const [filtreSource, setFiltreSource] = useState("");
  const [search, setSearch]       = useState("");

  const charger = async () => {
    setLoading(true);
    const { data } = await supabase.from("invest_clients").select("*").order("created_at", { ascending: false });
    setClients(data || []);
    setLoading(false);
  };
  useEffect(() => { charger(); }, []);

  const conseillers = [...new Set(clients.map(c => c.conseiller).filter(Boolean))];

  const filtered = clients.filter(c => {
    if (filtreStatut && c.statut !== filtreStatut) return false;
    if (filtreConseiller && c.conseiller !== filtreConseiller) return false;
    if (filtreSource && c.source !== filtreSource) return false;
    if (search && !`${c.nom} ${c.prenom} ${c.email}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const STATUT_COLORS = { Prospect:"#4db8ff", Actif:"#50c878", Inactif:"#FFC200", Terminé:"rgba(255,255,255,0.3)" };
  const fmtDate = d => d ? new Date(d).toLocaleDateString("fr-FR", { day:"2-digit", month:"short" }) : "—";
  const fmtBudget = v => v > 0 ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits:0 }).format(v)+" €" : "—";

  if (ficheId) return <FicheClient id={ficheId} profil={profil} T={T} onRetour={() => { setFicheId(null); charger(); }} onOuvrirSimulation={onOuvrirSimulation} />;

  return (
    <div style={{ padding:`${SPACING.xl}px ${SPACING.xl+4}px`, maxWidth:1400, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:SPACING.xl-4, flexWrap:"wrap", gap:SPACING.sm+2 }}>
        <div style={{ display:"flex", alignItems:"center", gap:SPACING.md }}>
          <div style={{
            width:44, height:44, borderRadius:RADIUS.lg, flexShrink:0,
            background:T.accentBg, color:T.accent,
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>
            <Icon as={Users} size={22} strokeWidth={2}/>
          </div>
          <div>
            <div style={{ fontSize:FONT.h2.size, fontWeight:800, color:T.text, letterSpacing:-0.3 }}>CRM Clients / Prospects</div>
            <div style={{ fontSize:FONT.sm.size+1, color:T.textSub, marginTop:2 }}>{filtered.length} contact{filtered.length!==1?"s":""}</div>
          </div>
        </div>
        <button className="inv-btn inv-btn-gold" onClick={() => setShowForm(true)}>
          <Icon as={Plus} size={13} strokeWidth={2.2}/> Nouveau contact
        </button>
      </div>

      {/* Filtres */}
      <div style={{ display:"flex", gap:SPACING.sm+2, marginBottom:SPACING.lg, flexWrap:"wrap" }}>
        <div style={{position:"relative", width:240}}>
          <Icon as={Search} size={13} color={T.textMuted}
            style={{position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", pointerEvents:"none"}}/>
          <input className="inv-inp" placeholder="Rechercher…" value={search} onChange={e=>setSearch(e.target.value)}
            style={{ width:"100%", textAlign:"left", paddingLeft:30, fontSize:FONT.sm.size+1 }}/>
        </div>
        <select className="inv-sel" value={filtreStatut} onChange={e=>setFiltreStatut(e.target.value)}>
          <option value="">Tous statuts</option>
          {STATUTS_CLIENT.map(s=><option key={s}>{s}</option>)}
        </select>
        <select className="inv-sel" value={filtreConseiller} onChange={e=>setFiltreConseiller(e.target.value)}>
          <option value="">Tous conseillers</option>
          {conseillers.map(c=><option key={c}>{c}</option>)}
        </select>
        <select className="inv-sel" value={filtreSource} onChange={e=>setFiltreSource(e.target.value)}>
          <option value="">Toutes sources</option>
          {SOURCES_CLIENT.map(s=><option key={s}>{s}</option>)}
        </select>
      </div>

      {/* Liste */}
      {loading ? (
        <div style={{ textAlign:"center", padding:`${SPACING.xl}px 0`, color:T.textMuted, display:"flex", justifyContent:"center", alignItems:"center", gap:8 }}>
          <Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>
          Chargement…
        </div>
      ) : (
        <div style={{ background:T.card, borderRadius:RADIUS.xl, border:`1px solid ${T.border}`, overflow:"hidden", boxShadow:T.shadowSm }}>
          <div style={{
            display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr 1fr 80px",
            padding:`${SPACING.md-2}px ${SPACING.lg}px`, background:T.sectionHd,
            borderBottom:`1px solid ${T.border}`, fontSize:FONT.xs.size-1, fontWeight:700,
            color:T.textMuted, textTransform:"uppercase", letterSpacing:0.8,
          }}>
            <div>Contact</div><div>Statut</div><div>Budget</div><div>Conseiller</div><div>Étape</div><div>Prochaine action</div><div/>
          </div>
          {filtered.length === 0 ? (
            <div style={{ textAlign:"center", padding:`${SPACING.xl}px 0`, color:T.textMuted, fontSize:FONT.base.size, fontStyle:"italic" }}>Aucun contact trouvé</div>
          ) : filtered.map(c => {
            const initials = `${c.prenom?.[0]||""}${c.nom?.[0]||""}`.toUpperCase();
            const enRetard = c.date_prochaine_action && c.date_prochaine_action < new Date().toISOString().slice(0,10);
            return (
              <div key={c.id} style={{
                display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr 1fr 80px",
                padding:`${SPACING.md+2}px ${SPACING.lg}px`,
                borderBottom:`1px solid ${T.rowBorder}`, alignItems:"center",
                cursor:"pointer", transition:"background .12s",
              }}
                onMouseEnter={e=>e.currentTarget.style.background=T.cardHover}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                onClick={() => setFicheId(c.id)}>
                <div style={{display:"flex", alignItems:"center", gap:SPACING.sm+2, minWidth:0}}>
                  <div style={{
                    width:34, height:34, borderRadius:"50%", flexShrink:0,
                    background:T.accentBg, color:T.accent,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:FONT.sm.size+1, fontWeight:800,
                  }}>{initials}</div>
                  <div style={{minWidth:0}}>
                    <div style={{ fontWeight:700, color:T.text, fontSize:FONT.base.size, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.prenom} {c.nom}</div>
                    <div style={{ fontSize:FONT.xs.size, color:T.textMuted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.email || c.telephone || "—"}</div>
                  </div>
                </div>
                <div>
                  <span style={{
                    background:`${STATUT_COLORS[c.statut]}18`, color:STATUT_COLORS[c.statut],
                    border:`1px solid ${STATUT_COLORS[c.statut]}33`, borderRadius:RADIUS.pill,
                    padding:`${SPACING.xs-2}px ${SPACING.sm+2}px`, fontSize:FONT.xs.size, fontWeight:700,
                  }}>{c.statut}</span>
                </div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:FONT.sm.size+1, fontWeight:600, color:T.accent }}>{fmtBudget(c.budget)}</div>
                <div style={{ fontSize:FONT.sm.size+1, color:T.textSub }}>{c.conseiller||"—"}</div>
                <div style={{ fontSize:FONT.sm.size, color:T.textSub }}>{c.etape||"—"}</div>
                <div style={{ fontSize:FONT.sm.size, color: enRetard ? DA : T.textMuted }}>
                  {enRetard && <Icon as={AlertTriangle} size={11} strokeWidth={2.2} style={{marginRight:3, verticalAlign:-1}}/>}
                  {fmtDate(c.date_prochaine_action)}
                  {c.prochaine_action && <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:1, opacity:0.7 }}>{c.prochaine_action.slice(0,30)}</div>}
                </div>
                <div style={{ textAlign:"right" }}>
                  <span style={{ fontSize:FONT.sm.size, color:T.accent, fontWeight:700, display:"inline-flex", alignItems:"center", gap:3 }}>
                    Ouvrir <Icon as={ChevronRight} size={12} strokeWidth={2.5}/>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal nouveau contact */}
      {showForm && <FormulaireClient profil={profil} T={T} onSave={() => { setShowForm(false); charger(); }} onClose={() => setShowForm(false)} />}
    </div>
  );
}

function FormulaireClient({ client, profil, onSave, onClose, T=THEMES_INV.dark }) {
  const isEdit = !!client;
  const [form, setForm] = useState({
    nom: client?.nom||"", prenom: client?.prenom||"",
    email: client?.email||"", telephone: client?.telephone||"",
    conseiller: client?.conseiller || profil?.nom||"",
    source: client?.source||"Autre", statut: client?.statut||"Prospect",
    budget: client?.budget||0, etape: client?.etape||"",
    prochaine_action: client?.prochaine_action||"",
    date_prochaine_action: client?.date_prochaine_action||"",
    notes_rapides: client?.notes_rapides||"",
  });
  const [saving, setSaving] = useState(false);

  const sauvegarder = async () => {
    if (!form.nom.trim()) return;
    setSaving(true);
    // Seuls les champs existants dans la table sont envoyés
    const payload = {
      nom:                   form.nom.trim(),
      prenom:                form.prenom.trim() || null,
      email:                 form.email.trim() || null,
      telephone:             form.telephone.trim() || null,
      conseiller:            form.conseiller.trim() || null,
      source:                form.source || "Autre",
      statut:                form.statut || "Prospect",
      budget:                parseFloat(form.budget) || 0,
      etape:                 form.etape.trim() || null,
      prochaine_action:      form.prochaine_action.trim() || null,
      date_prochaine_action: form.date_prochaine_action || null,
      notes_rapides:         form.notes_rapides.trim() || null,
    };
    // Nettoyer les null pour éviter les conflits de type
    Object.keys(payload).forEach(k => { if (payload[k] === "") payload[k] = null; });
    const { error } = isEdit
      ? await supabase.from("invest_clients").update(payload).eq("id", client.id)
      : await supabase.from("invest_clients").insert(payload);
    if (error) { console.error("Erreur sauvegarde client:", error); alert("Erreur : " + error.message); }
    setSaving(false);
    if (!error) onSave();
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 }}>
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, padding:"28px 30px", width:"90%", maxWidth:580, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 30px 80px rgba(0,0,0,.5)" }}>
        <div style={{ fontSize:17, fontWeight:800, color:T.text, marginBottom:20 }}>{isEdit ? "Modifier le contact" : "Nouveau contact"}</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 16px" }}>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Nom *</label><input className="inv-inp" value={form.nom} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,nom:e.target.value})}/></div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Prénom</label><input className="inv-inp" value={form.prenom} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,prenom:e.target.value})}/></div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Email</label><input className="inv-inp" type="email" value={form.email} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,email:e.target.value})}/></div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Téléphone</label><input className="inv-inp" value={form.telephone} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,telephone:e.target.value})}/></div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Conseiller référent</label><input className="inv-inp" value={form.conseiller} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,conseiller:e.target.value})}/></div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Source</label>
            <select className="inv-sel" value={form.source} style={{ width:"100%" }} onChange={e=>setForm({...form,source:e.target.value})}>
              {SOURCES_CLIENT.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Statut</label>
            <select className="inv-sel" value={form.statut} style={{ width:"100%" }} onChange={e=>setForm({...form,statut:e.target.value})}>
              {STATUTS_CLIENT.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Budget (€)</label><input className="inv-inp" type="number" value={form.budget} style={{ width:"100%" }} onChange={e=>setForm({...form,budget:e.target.value})}/></div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Étape en cours</label><input className="inv-inp" value={form.etape} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,etape:e.target.value})}/></div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Date prochaine action</label><input className="inv-inp" type="date" value={form.date_prochaine_action} style={{ width:"100%" }} onChange={e=>setForm({...form,date_prochaine_action:e.target.value})}/></div>
        </div>
        <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Prochaine action</label><input className="inv-inp" value={form.prochaine_action} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,prochaine_action:e.target.value})}/></div>
        <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Notes rapides</label><textarea className="inv-textarea" rows={3} value={form.notes_rapides} onChange={e=>setForm({...form,notes_rapides:e.target.value})}/></div>
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
          <button className="inv-btn inv-btn-out" onClick={onClose}>Annuler</button>
          <button className="inv-btn inv-btn-gold" onClick={sauvegarder} disabled={saving}>{saving?"Enregistrement…":"Enregistrer"}</button>
        </div>
      </div>
    </div>
  );
}


// ─── DOCUMENTS (Supabase Storage) ────────────────────────────────────────────
// Bucket requis : "invest-documents" (public: false, RLS: authenticated)
// Chemin des fichiers : clients/{client_id}/{filename} ou biens/{bien_id}/{filename}

const FILE_ICONS = {
  pdf: "📄", doc: "📝", docx: "📝", xls: "📊", xlsx: "📊",
  jpg: "🖼️", jpeg: "🖼️", png: "🖼️", gif: "🖼️", webp: "🖼️",
  zip: "🗜️", rar: "🗜️", mp4: "🎥", mp3: "🎵", txt: "📃",
};

function getFileIcon(name) {
  const ext = (name || "").split(".").pop().toLowerCase();
  return FILE_ICONS[ext] || "📎";
}

function fmtSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " o";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " Ko";
  return (bytes / (1024 * 1024)).toFixed(1) + " Mo";
}

function DocumentsSection({ folder, T = THEMES_INV.dark }) {
  // folder = "clients/uuid" ou "biens/uuid"
  const [fichiers, setFichiers]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [uploading, setUploading]   = useState(false);
  const [uploadPct, setUploadPct]   = useState(0);
  const [erreur, setErreur]         = useState("");
  const [dragOver, setDragOver]     = useState(false);
  const fileRef                     = useRef();

  const BUCKET = "invest-documents";

  const charger = async () => {
    setLoading(true);
    const { data, error } = await supabase.storage.from(BUCKET).list(folder, { sortBy: { column: "created_at", order: "desc" } });
    if (error) { setErreur("Bucket introuvable. Voir instructions ci-dessous."); setLoading(false); return; }
    setFichiers(data || []);
    setLoading(false);
    setErreur("");
  };

  useEffect(() => { charger(); }, [folder]);

  const uploader = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setErreur("");
    for (const file of Array.from(files)) {
      if (file.size > 50 * 1024 * 1024) { setErreur(`${file.name} dépasse 50 Mo`); continue; }
      // Nom unique pour éviter les collisions
      const ext   = file.name.split(".").pop();
      const base  = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 40);
      const uname = `${base}_${Date.now()}.${ext}`;
      const path  = `${folder}/${uname}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (error) setErreur(`Erreur upload : ${error.message}`);
    }
    setUploading(false);
    charger();
  };

  const telecharger = async (nom) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(`${folder}/${nom}`, 300);
    if (error || !data?.signedUrl) { alert("Impossible de générer le lien."); return; }
    window.open(data.signedUrl, "_blank");
  };

  const supprimer = async (nom) => {
    if (!window.confirm(`Supprimer "${nom}" ?`)) return;
    await supabase.storage.from(BUCKET).remove([`${folder}/${nom}`]);
    charger();
  };

  const border  = T.border;
  const text    = T.text;
  const textSub = T.textSub;
  const accent  = T.accent;
  const card    = T.card;

  return (
    <div className="inv-card">
      <div className="inv-card-hd" style={{ justifyContent:"space-between" }}>
        <span>📎 Documents ({fichiers.length})</span>
        <button
          className="inv-btn inv-btn-sm"
          style={{ background:"rgba(255,255,255,0.15)", color:"white", border:"none" }}
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Upload…" : "＋ Ajouter"}
        </button>
        <input
          ref={fileRef} type="file" multiple style={{ display:"none" }}
          onChange={e => uploader(e.target.files)}
        />
      </div>
      <div className="inv-card-bd">

        {/* Zone drag & drop */}
        <div
          style={{
            border: `2px dashed ${dragOver ? accent : border}`,
            borderRadius: 8, padding: "14px 12px", textAlign: "center",
            marginBottom: 12, cursor: "pointer", transition: "all .2s",
            background: dragOver ? `rgba(77,184,255,0.05)` : "transparent",
          }}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); uploader(e.dataTransfer.files); }}
        >
          {uploading ? (
            <div style={{ fontSize: 13, color: accent }}>⏳ Upload en cours…</div>
          ) : (
            <div style={{ fontSize: 12, color: textSub }}>
              Glissez des fichiers ici ou <span style={{ color: accent, fontWeight: 700 }}>cliquez</span>
              <div style={{ fontSize: 11, marginTop: 4, opacity: .6 }}>PDF, images, Word, Excel… · max 50 Mo</div>
            </div>
          )}
        </div>

        {/* Erreur */}
        {erreur && (
          <div style={{ fontSize: 12, color: "#e05c5c", marginBottom: 10, padding: "8px 10px", background: "rgba(224,92,92,0.08)", borderRadius: 6, border: "1px solid rgba(224,92,92,0.2)" }}>
            ⚠ {erreur}
            {erreur.includes("Bucket") && (
              <div style={{ marginTop: 6, lineHeight: 1.6, color: textSub }}>
                Créez le bucket dans Supabase :<br/>
                Storage → New bucket → Nom : <strong style={{color:text}}>invest-documents</strong> → Public : <strong style={{color:"#e05c5c"}}>OFF</strong> → Save<br/>
                Puis activez le RLS du bucket (voir documentation fournie).
              </div>
            )}
          </div>
        )}

        {/* Liste fichiers */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "16px 0", color: textSub, fontSize: 13 }}>Chargement…</div>
        ) : fichiers.length === 0 ? (
          <div style={{ textAlign: "center", padding: "16px 0", color: textSub, fontSize: 13, fontStyle: "italic" }}>Aucun document</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {fichiers.map(f => (
              <div key={f.name} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 10px", borderRadius: 7,
                background: card, border: `1px solid ${border}`,
                transition: "background .12s",
              }}
                onMouseEnter={e => e.currentTarget.style.background = T.cardHover}
                onMouseLeave={e => e.currentTarget.style.background = card}
              >
                <span style={{ fontSize: 20, flexShrink: 0 }}>{getFileIcon(f.name)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Affiche le nom original sans le suffixe timestamp */}
                  <div style={{ fontSize: 13, fontWeight: 600, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.name.replace(/_\d{13}(\.\w+)$/, "$1")}
                  </div>
                  <div style={{ fontSize: 11, color: textSub, marginTop: 1 }}>
                    {fmtSize(f.metadata?.size)}
                    {f.created_at && ` · ${new Date(f.created_at).toLocaleDateString("fr-FR", { day:"2-digit", month:"short", year:"numeric" })}`}
                  </div>
                </div>
                <button
                  onClick={() => telecharger(f.name)}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 17, color: accent, padding: "2px 4px" }}
                  title="Télécharger / Ouvrir"
                >⬇️</button>
                <button
                  onClick={() => supprimer(f.name)}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 17, color: "#e05c5c", padding: "2px 4px", opacity: .6 }}
                  title="Supprimer"
                  onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                  onMouseLeave={e => e.currentTarget.style.opacity = ".6"}
                >🗑️</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FicheClient({ id, profil, onRetour, T=THEMES_INV.dark, onOuvrirSimulation }) {
  const [client, setClient]   = useState(null);
  const [notes, setNotes]     = useState([]);
  const [props, setProps]     = useState([]);
  const [biens, setBiens]     = useState([]); // liste des biens du stock pour la modale "Proposer un bien"
  const [simulations, setSimulations] = useState([]); // simulations liées à ce client
  const [showEdit, setShowEdit] = useState(false);
  const [newNote, setNewNote] = useState({ type:"commentaire", contenu:"" });
  const [savingNote, setSavingNote] = useState(false);
  const [showProp, setShowProp] = useState(false);
  const [newProp, setNewProp] = useState({ bien_id:"", statut:"proposé", commentaire:"", lien_dossier:"" });
  const [savingProp, setSavingProp] = useState(false);

  const charger = async () => {
    const [{ data: c }, { data: n }, { data: p }, { data: b }] = await Promise.all([
      supabase.from("invest_clients").select("*").eq("id", id).single(),
      supabase.from("invest_notes").select("*").eq("client_id", id).order("date", { ascending: false }),
      supabase.from("invest_propositions").select("*, bien:invest_biens(adresse,ville,statut)").eq("client_id", id).order("created_at", { ascending: false }),
      supabase.from("invest_biens").select("id,adresse,ville,statut").order("adresse"),
    ]);
    setClient(c); setNotes(n||[]); setProps(p||[]); setBiens(b||[]);

    // Charge les simulations liées à ce client. Tente avec client_id ; si la
    // colonne n'existe pas (42703), on désactive la section silencieusement.
    const sRes = await supabase.from("invest_projets")
      .select("id,nom,created_by,created_at,updated_at,donnees,client_id")
      .eq("client_id", id)
      .order("updated_at", { ascending:false });
    if (sRes.error?.code === "42703") {
      setSimulations([]); // colonne pas encore créée — on cache la section
    } else {
      setSimulations(sRes.data || []);
    }
  };
  useEffect(() => { charger(); }, [id]);

  const ajouterNote = async () => {
    if (!newNote.contenu.trim()) return;
    setSavingNote(true);
    await supabase.from("invest_notes").insert({ client_id: id, auteur: profil?.nom||"", type: newNote.type, contenu: newNote.contenu });
    setNewNote({ type:"commentaire", contenu:"" });
    setSavingNote(false);
    charger();
  };

  const ajouterProp = async () => {
    if (!newProp.bien_id) return;
    setSavingProp(true);
    await supabase.from("invest_propositions").insert({
      client_id: id,
      ...newProp,
      date_proposition: new Date().toISOString().slice(0,10),
    });
    setNewProp({ bien_id:"", statut:"proposé", commentaire:"", lien_dossier:"" });
    setSavingProp(false);
    setShowProp(false);
    charger();
  };

  // Biens déjà proposés à ce client : on les marque pour les retirer/distinguer dans la modale
  const idsDejaProposes = new Set(props.map(p => p.bien?.id || p.bien_id).filter(Boolean));
  const biensDispo = biens.filter(b => !idsDejaProposes.has(b.id));

  const STATUT_COLORS = { Prospect:"#4db8ff", Actif:"#50c878", Inactif:"#FFC200", Terminé:"rgba(255,255,255,0.3)" };
  const fmtDate = d => d ? new Date(d).toLocaleDateString("fr-FR", { day:"2-digit", month:"long", year:"numeric" }) : "—";
  const fmtBudget = v => v > 0 ? new Intl.NumberFormat("fr-FR").format(v)+" €" : "—";
  const NOTE_ICONS = { appel:"📞", "rendez-vous":"🤝", relance:"🔔", commentaire:"💬", document:"📄", autre:"📝" };

  if (!client) return <div style={{ textAlign:"center", padding:"60px", color:T.textMuted }}>Chargement…</div>;

  return (
    <div style={{ padding:"24px 28px", maxWidth:1100, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
        <button className="inv-btn inv-btn-out inv-btn-sm" onClick={onRetour}>← CRM</button>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:22, fontWeight:800, color:T.text }}>{client.prenom} {client.nom}</div>
          <div style={{ fontSize:13, color:T.textSub, marginTop:2 }}>{client.email} {client.telephone ? `· ${client.telephone}` : ""}</div>
        </div>
        <span style={{ background:`${STATUT_COLORS[client.statut]}18`, color:STATUT_COLORS[client.statut], border:`1px solid ${STATUT_COLORS[client.statut]}33`, borderRadius:20, padding:"4px 14px", fontSize:12, fontWeight:700 }}>{client.statut}</span>
        <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => setShowEdit(true)}>✏️ Modifier</button>
        <button className="inv-btn inv-btn-danger inv-btn-sm" onClick={async () => {
          if (!window.confirm(`Supprimer ${client.prenom} ${client.nom} ? Cette action est irréversible.`)) return;
          await supabase.from("invest_notes").delete().eq("client_id", id);
          await supabase.from("invest_propositions").delete().eq("client_id", id);
          await supabase.from("invest_clients").delete().eq("id", id);
          onRetour();
        }}>🗑️ Supprimer</button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        {/* Infos */}
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <div className="inv-card">
            <div className="inv-card-hd blue">👤 Informations</div>
            <div className="inv-card-bd">
              {[["Conseiller", client.conseiller],["Source", client.source],["Budget", fmtBudget(client.budget)],["Étape", client.etape||"—"],["Date signature", fmtDate(client.date_signature)],["Avancement", client.avancement ? client.avancement+"%" : "—"]].map(([l,v])=>(
                <div key={l} className="inv-row"><span className="inv-lbl">{l}</span><span className="inv-val calc">{v||"—"}</span></div>
              ))}
            </div>
          </div>
          <div className="inv-card">
            <div className="inv-card-hd mid">📅 Prochaine Action</div>
            <div className="inv-card-bd">
              <div className="inv-row"><span className="inv-lbl">Action</span><span className="inv-val calc">{client.prochaine_action||"—"}</span></div>
              <div className="inv-row"><span className="inv-lbl">Date</span><span className="inv-val calc" style={{ color: client.date_prochaine_action < new Date().toISOString().slice(0,10) ? "#e05c5c" : T.text }}>{fmtDate(client.date_prochaine_action)}</span></div>
              {client.notes_rapides && <div style={{ marginTop:10, padding:"8px 10px", background:"#f8f9fb", borderRadius:7, fontSize:12, color:"#5a6070", lineHeight:1.6 }}>{client.notes_rapides}</div>}
            </div>
          </div>
          {/* Propositions */}
          <div className="inv-card">
            <div className="inv-card-hd" style={{ justifyContent:"space-between" }}>
              <span>🏠 Biens proposés ({props.length})</span>
              <button className="inv-btn inv-btn-sm" style={{ background:"rgba(255,255,255,0.15)", color:"white", border:"none" }} onClick={() => setShowProp(true)}>＋ Proposer</button>
            </div>
            <div className="inv-card-bd">
              {props.length === 0 ? (
                <div style={{ fontSize:13, color:"#9aa0b0", fontStyle:"italic", textAlign:"center", padding:"20px 0" }}>Aucun bien proposé</div>
              ) : props.map(p => (
                <div key={p.id} style={{ padding:"10px 0", borderBottom:`1px solid ${T.border}` }}>
                  <div style={{ fontWeight:600, fontSize:13, color:T.text }}>{p.bien?.adresse||"Bien"} {p.bien?.ville ? `— ${p.bien.ville}` : ""}</div>
                  <div style={{ fontSize:11, color:T.textMuted, marginTop:2 }}>
                    {new Date(p.date_proposition).toLocaleDateString("fr-FR")} · <span style={{ fontWeight:600, color:T.accent }}>{p.statut}</span>
                    {p.commentaire && ` · ${p.commentaire}`}
                  </div>
                  {p.lien_dossier && <a href={p.lien_dossier} target="_blank" rel="noreferrer" style={{ fontSize:11, color:T.accent }}>📄 Dossier présenté ↗</a>}
                </div>
              ))}
            </div>
          </div>
          {/* Simulations liées au client */}
          {onOuvrirSimulation && (
            <div className="inv-card">
              <div className="inv-card-hd" style={{ justifyContent:"space-between" }}>
                <span>📊 Simulations ({simulations.length})</span>
                <button className="inv-btn inv-btn-sm" style={{ background:"rgba(255,255,255,0.15)", color:"white", border:"none" }}
                  onClick={() => onOuvrirSimulation({ client_id: id })}>
                  ＋ Nouvelle simulation
                </button>
              </div>
              <div className="inv-card-bd">
                {simulations.length === 0 ? (
                  <div style={{ fontSize:13, color:"#9aa0b0", fontStyle:"italic", textAlign:"center", padding:"20px 0" }}>
                    Aucune simulation liée
                  </div>
                ) : simulations.map(s => {
                  const k = (() => {
                    const d = s.donnees;
                    if (!d?.inputs) return null;
                    const pN = d.inputs.prixNegocie || 0;
                    const fn = pN * (d.inputs.tauxNotaire || 0.08);
                    const total = pN + fn + (d.inputs.honoraires || 0) + (d.inputs.enedis || 0);
                    const lots = (d.lots || []).filter(l => l.type !== "Sélectionner");
                    const loyer = lots.reduce((sum, l) => sum + (l.loyer || 0), 0);
                    return { total, loyer, nbLots: lots.length };
                  })();
                  return (
                    <div key={s.id}
                      onClick={() => onOuvrirSimulation(s)}
                      style={{ padding:"10px 0", borderBottom:`1px solid ${T.border}`, cursor:"pointer", transition:"background .12s" }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(77,184,255,0.05)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                        <div style={{ fontWeight:600, fontSize:13, color:T.text }}>📄 {s.nom}</div>
                        <span style={{ fontSize:11, color:"#4db8ff", fontWeight:700 }}>Ouvrir →</span>
                      </div>
                      <div style={{ fontSize:11, color:T.textMuted, marginTop:3 }}>
                        Mise à jour {fmtDate(s.updated_at)} · Par {s.created_by}
                        {k && k.total > 0 && (
                          <> · <span style={{ color:T.accent, fontWeight:600 }}>{new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(k.total)} €</span></>
                        )}
                        {k && k.nbLots > 0 && <> · {k.nbLots} lot{k.nbLots>1?"s":""}</>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* Documents */}
          <DocumentsSection folder={`clients/${id}`} T={T} />
        </div>

        {/* Notes */}
        <div className="inv-card">
          <div className="inv-card-hd">📝 Historique des notes ({notes.length})</div>
          <div className="inv-card-bd">
            {/* Ajouter une note */}
            <div style={{ marginBottom:16, padding:"12px 14px", background:"#f8f9fb", borderRadius:8, border:"1px solid #eef0f5" }}>
              <div style={{ display:"flex", gap:8, marginBottom:8 }}>
                <select className="inv-sel" value={newNote.type} onChange={e=>setNewNote({...newNote,type:e.target.value})} style={{ fontSize:12 }}>
                  {TYPES_NOTE.map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
              <textarea className="inv-textarea" rows={3} placeholder="Ajouter une note…" value={newNote.contenu}
                onChange={e=>setNewNote({...newNote,contenu:e.target.value})}/>
              <div style={{ marginTop:8, display:"flex", justifyContent:"flex-end" }}>
                <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={ajouterNote} disabled={savingNote}>
                  {savingNote ? "…" : "＋ Ajouter"}
                </button>
              </div>
            </div>
            {/* Liste notes */}
            <div style={{ maxHeight:500, overflowY:"auto" }}>
              {notes.length === 0 ? (
                <div style={{ fontSize:13, color:"#9aa0b0", fontStyle:"italic", textAlign:"center", padding:"20px 0" }}>Aucune note</div>
              ) : notes.map(n => (
                <div key={n.id} style={{ padding:"10px 0", borderBottom:`1px solid ${T.border}` }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                    <span style={{ fontSize:16 }}>{NOTE_ICONS[n.type]||"📝"}</span>
                    <span style={{ fontSize:11, fontWeight:700, color:T.accent, textTransform:"uppercase" }}>{n.type}</span>
                    <span style={{ fontSize:11, color:T.textMuted, marginLeft:"auto" }}>
                      {new Date(n.date).toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"})} · {n.auteur||"—"}
                    </span>
                  </div>
                  <div style={{ fontSize:13, color:T.text, lineHeight:1.6, paddingLeft:24 }}>{n.contenu}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showEdit && <FormulaireClient client={client} profil={profil} T={T} onSave={() => { setShowEdit(false); charger(); }} onClose={() => setShowEdit(false)} />}

      {showProp && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 }}>
          <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, padding:"24px 26px", width:"90%", maxWidth:440 }}>
            <div style={{ fontSize:16, fontWeight:800, color:T.text, marginBottom:16 }}>Proposer un bien à {client.prenom} {client.nom}</div>
            <div style={{ marginBottom:12 }}>
              <label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Bien</label>
              <select className="inv-sel" value={newProp.bien_id} style={{ width:"100%" }} onChange={e=>setNewProp({...newProp,bien_id:e.target.value})}>
                <option value="">Sélectionner un bien…</option>
                {biensDispo.length === 0 && (
                  <option value="" disabled>Tous les biens ont déjà été proposés</option>
                )}
                {biensDispo.map(b=>(
                  <option key={b.id} value={b.id}>
                    {b.adresse || "(sans adresse)"}{b.ville ? ` — ${b.ville}` : ""}{b.statut ? ` · ${b.statut}` : ""}
                  </option>
                ))}
              </select>
              {biens.length === 0 && (
                <div style={{ fontSize:11, color:T.textMuted, marginTop:6, fontStyle:"italic" }}>
                  Aucun bien dans le stock. Ajoute d'abord un bien depuis l'onglet « Stock de biens ».
                </div>
              )}
            </div>
            <div style={{ marginBottom:12 }}>
              <label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Statut</label>
              <select className="inv-sel" value={newProp.statut} style={{ width:"100%" }} onChange={e=>setNewProp({...newProp,statut:e.target.value})}>
                {STATUTS_PROP.map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:12 }}>
              <label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Commentaire</label>
              <textarea className="inv-textarea" rows={2} value={newProp.commentaire} onChange={e=>setNewProp({...newProp,commentaire:e.target.value})}/>
            </div>
            <div style={{ marginBottom:16 }}>
              <label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Lien dossier présenté</label>
              <input className="inv-inp" value={newProp.lien_dossier} style={{ width:"100%", textAlign:"left" }} onChange={e=>setNewProp({...newProp,lien_dossier:e.target.value})} placeholder="https://…"/>
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button className="inv-btn inv-btn-out" onClick={() => { setShowProp(false); setNewProp({ bien_id:"", statut:"proposé", commentaire:"", lien_dossier:"" }); }}>Annuler</button>
              <button className="inv-btn inv-btn-blue" onClick={ajouterProp} disabled={savingProp||!newProp.bien_id}>{savingProp?"…":"Proposer"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── STOCK DE BIENS ───────────────────────────────────────────────────────────
const STATUTS_BIEN = ["À analyser","Agent contacté","Visite programmée","Visité","À relancer","Offre à faire","Offre envoyée","Offre refusée","Offre acceptée","Abandonné","Proposé à un client","En cours d'acquisition"];
const STATUT_BIEN_COLORS = {
  "À analyser":"#9aa0b0","Agent contacté":"#1f4ea1","Visite programmée":"#6b3a8a",
  "Visité":"#1a7a4a","À relancer":"#c0392b","Offre à faire":"#c9a84c",
  "Offre envoyée":"#d4610a","Offre refusée":"#c0392b","Offre acceptée":"#1a7a4a",
  "Abandonné":"#5a6070","Proposé à un client":"#1f4ea1","En cours d'acquisition":"#1a7a4a",
};

function StockBiens({ profil, T=THEMES_INV.dark }) {
  const [biens, setBiens]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [ficheId, setFicheId]   = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [filtreStatut, setFiltreStatut] = useState("");
  const [filtreVille, setFiltreVille]   = useState("");
  const [search, setSearch]     = useState("");
  const [sortBy, setSortBy]     = useState("");

  const charger = async () => {
    setLoading(true);
    const { data } = await supabase.from("invest_biens").select("*").order("created_at", { ascending: false });
    setBiens(data || []);
    setLoading(false);
  };
  useEffect(() => { charger(); }, []);

  const today = new Date().toISOString().slice(0,10);
  const villes = [...new Set(biens.map(b => b.ville).filter(Boolean))];

  let filtered = biens.filter(b => {
    if (filtreStatut && b.statut !== filtreStatut) return false;
    if (filtreVille && b.ville !== filtreVille) return false;
    if (search && !`${b.adresse||""} ${b.ville||""} ${b.agence||""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (sortBy === "rendement") filtered = [...filtered].sort((a,b) => (b.rendement_brut||0)-(a.rendement_brut||0));
  if (sortBy === "cashflow")  filtered = [...filtered].sort((a,b) => (b.cashflow_estime||0)-(a.cashflow_estime||0));
  if (sortBy === "cout")      filtered = [...filtered].sort((a,b) => (b.cout_total||0)-(a.cout_total||0));
  if (sortBy === "relance")   filtered = [...filtered].sort((a,b) => (a.date_relance||"9999") < (b.date_relance||"9999") ? -1 : 1);

  const fmtDate = d => d ? new Date(d).toLocaleDateString("fr-FR",{day:"2-digit",month:"short"}) : "—";
  const fmtEur  = v => v > 0 ? new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(v)+" €" : "—";

  const aRelancer = biens.filter(b => b.date_relance && b.date_relance <= today).length;

  if (ficheId) return <FicheBien id={ficheId} profil={profil} T={T} onRetour={() => { setFicheId(null); charger(); }} />;

  return (
    <div style={{ padding:`${SPACING.xl}px ${SPACING.xl+4}px`, maxWidth:1400, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:SPACING.xl-4, flexWrap:"wrap", gap:SPACING.sm+2 }}>
        <div style={{ display:"flex", alignItems:"center", gap:SPACING.md }}>
          <div style={{
            width:44, height:44, borderRadius:RADIUS.lg, flexShrink:0,
            background:T.accentBg, color:T.accent,
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>
            <Icon as={Building2} size={22} strokeWidth={2}/>
          </div>
          <div>
            <div style={{ fontSize:FONT.h2.size, fontWeight:800, color:T.text, letterSpacing:-0.3 }}>Stock de Biens</div>
            <div style={{ fontSize:FONT.sm.size+1, color:T.textMuted, marginTop:2, display:"inline-flex", alignItems:"center", gap:8 }}>
              {filtered.length} bien{filtered.length!==1?"s":""}
              {aRelancer > 0 && (
                <span style={{ display:"inline-flex", alignItems:"center", gap:4, color:DA, fontWeight:700 }}>
                  · <Icon as={Bell} size={11} strokeWidth={2.2}/> {aRelancer} à relancer
                </span>
              )}
            </div>
          </div>
        </div>
        <button className="inv-btn inv-btn-gold" onClick={() => setShowForm(true)}>
          <Icon as={Plus} size={13} strokeWidth={2.2}/> Nouveau bien
        </button>
      </div>

      {/* Filtres */}
      <div style={{ display:"flex", gap:SPACING.sm+2, marginBottom:SPACING.lg, flexWrap:"wrap" }}>
        <div style={{position:"relative", width:240}}>
          <Icon as={Search} size={13} color={T.textMuted}
            style={{position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", pointerEvents:"none"}}/>
          <input className="inv-inp" placeholder="Rechercher…" value={search} onChange={e=>setSearch(e.target.value)}
            style={{ width:"100%", textAlign:"left", paddingLeft:30, fontSize:FONT.sm.size+1 }}/>
        </div>
        <select className="inv-sel" value={filtreStatut} onChange={e=>setFiltreStatut(e.target.value)}>
          <option value="">Tous statuts</option>
          {STATUTS_BIEN.map(s=><option key={s}>{s}</option>)}
        </select>
        <select className="inv-sel" value={filtreVille} onChange={e=>setFiltreVille(e.target.value)}>
          <option value="">Toutes villes</option>
          {villes.map(v=><option key={v}>{v}</option>)}
        </select>
        <select className="inv-sel" value={sortBy} onChange={e=>setSortBy(e.target.value)}>
          <option value="">Trier par…</option>
          <option value="rendement">Rendement brut ↓</option>
          <option value="cashflow">Cash-flow ↓</option>
          <option value="cout">Coût total ↓</option>
          <option value="relance">Date relance ↑</option>
        </select>
        <button className="inv-btn inv-btn-danger inv-btn-sm"
          onClick={() => { setFiltreStatut("À relancer"); setSortBy("relance"); }}>
          <Icon as={Bell} size={12} strokeWidth={2.2}/> Voir à relancer
        </button>
      </div>

      {/* Liste */}
      {loading ? (
        <div style={{ textAlign:"center", padding:`${SPACING.xl}px 0`, color:T.textMuted, display:"flex", justifyContent:"center", alignItems:"center", gap:8 }}>
          <Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>
          Chargement…
        </div>
      ) : (
        <div style={{ background:T.card, borderRadius:RADIUS.xl, border:`1px solid ${T.border}`, overflow:"hidden", boxShadow:T.shadowSm }}>
          <div style={{
            display:"grid", gridTemplateColumns:"2fr 1.2fr 1fr 1fr 1fr 1fr 80px",
            padding:`${SPACING.md-2}px ${SPACING.lg}px`, background:T.sectionHd,
            borderBottom:`1px solid ${T.border}`, fontSize:FONT.xs.size-1, fontWeight:700,
            color:T.textMuted, textTransform:"uppercase", letterSpacing:0.8,
          }}>
            <div>Bien</div><div>Statut</div><div>Coût total</div><div>Rendement</div><div>Cash-flow</div><div>Relance</div><div/>
          </div>
          {filtered.length === 0 ? (
            <div style={{ textAlign:"center", padding:`${SPACING.xl}px 0`, color:T.textMuted, fontSize:FONT.base.size, fontStyle:"italic" }}>Aucun bien trouvé</div>
          ) : filtered.map(b => {
            const couleurStatut = STATUT_BIEN_COLORS[b.statut] || T.textMuted;
            const enRelance = b.date_relance && b.date_relance <= today;
            const rendCol = b.rendement_brut >= 8 ? SU : b.rendement_brut >= 5 ? WA : T.textMuted;
            const cfVal = b.cashflow_estime || 0;
            const cfCol = cfVal > 0 ? SU : cfVal < 0 ? DA : T.textMuted;
            return (
              <div key={b.id} style={{
                display:"grid", gridTemplateColumns:"2fr 1.2fr 1fr 1fr 1fr 1fr 80px",
                padding:`${SPACING.md+2}px ${SPACING.lg}px`,
                borderBottom:`1px solid ${T.rowBorder}`, alignItems:"center",
                cursor:"pointer", transition:"background .12s",
              }}
                onMouseEnter={e=>e.currentTarget.style.background=T.cardHover}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                onClick={() => setFicheId(b.id)}>
                <div style={{display:"flex", alignItems:"center", gap:SPACING.sm+2, minWidth:0}}>
                  <div style={{
                    width:34, height:34, borderRadius:RADIUS.md, flexShrink:0,
                    background:`${couleurStatut}22`, color:couleurStatut,
                    border:`1px solid ${couleurStatut}40`,
                    display:"flex", alignItems:"center", justifyContent:"center",
                  }}>
                    <Icon as={Home} size={17} strokeWidth={2}/>
                  </div>
                  <div style={{minWidth:0}}>
                    <div style={{ fontWeight:700, color:T.text, fontSize:FONT.base.size, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{b.adresse||"Adresse non renseignée"}</div>
                    <div style={{ fontSize:FONT.xs.size, color:T.textMuted, display:"inline-flex", alignItems:"center", gap:4 }}>
                      {b.ville && <><Icon as={MapPin} size={10}/> {b.ville}</>}
                      {b.agence && <span> · {b.agence}</span>}
                    </div>
                  </div>
                </div>
                <div>
                  <span style={{
                    background:`${couleurStatut}18`, color:couleurStatut,
                    border:`1px solid ${couleurStatut}33`, borderRadius:RADIUS.pill,
                    padding:`${SPACING.xs-2}px ${SPACING.sm+1}px`, fontSize:FONT.xs.size-1, fontWeight:700, whiteSpace:"nowrap",
                  }}>{b.statut}</span>
                </div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:FONT.sm.size, fontWeight:600, color:T.textSub }}>{fmtEur(b.cout_total)}</div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:FONT.sm.size+1, fontWeight:700, color:rendCol }}>
                  {b.rendement_brut > 0 ? b.rendement_brut.toFixed(1)+"%" : "—"}
                </div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:FONT.sm.size, color:cfCol, fontWeight:cfVal !== 0 ? 600 : 400 }}>
                  {b.cashflow_estime ? fmtEur(b.cashflow_estime)+"/mois" : "—"}
                </div>
                <div style={{ fontSize:FONT.sm.size, color: enRelance ? DA : T.textMuted, fontWeight: enRelance ? 700 : 400, display:"inline-flex", alignItems:"center", gap:3 }}>
                  {enRelance && <Icon as={Bell} size={11} strokeWidth={2.2}/>}
                  {fmtDate(b.date_relance)}
                </div>
                <div style={{ textAlign:"right" }}>
                  <span style={{ fontSize:FONT.sm.size, color:T.accent, fontWeight:700, display:"inline-flex", alignItems:"center", gap:3 }}>
                    Ouvrir <Icon as={ChevronRight} size={12} strokeWidth={2.5}/>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && <FormulaireBien profil={profil} T={T} onSave={() => { setShowForm(false); charger(); }} onClose={() => setShowForm(false)} />}
    </div>
  );
}

function InpText(props) { return <input className="inv-inp" {...props} style={{ width:"100%", textAlign:"left", ...props.style }}/>; }
function InpNum(props) { return <input className="inv-inp" type="number" {...props} style={{ width:"100%", ...props.style }}/>; }

function FormulaireBien({ bien, profil, onSave, onClose, T=THEMES_INV.dark }) {
  const isEdit = !!bien;
  const [form, setForm] = useState({
    adresse: bien?.adresse||"", ville: bien?.ville||"", code_postal: bien?.code_postal||"",
    commentaire: bien?.commentaire||"", interlocuteur: bien?.interlocuteur||"",
    telephone_interlocuteur: bien?.telephone_interlocuteur||"", agence: bien?.agence||"",
    lien_annonce: bien?.lien_annonce||"", prix_vente: bien?.prix_vente||0,
    prix_travaux: bien?.prix_travaux||0, cout_total: bien?.cout_total||0,
    rendement_brut: bien?.rendement_brut||0, cashflow_estime: bien?.cashflow_estime||0,
    lien_drive: bien?.lien_drive||"", lien_rentabilite: bien?.lien_rentabilite||"",
    montant_offre: bien?.montant_offre||0, statut: bien?.statut||"À analyser",
    date_relance: bien?.date_relance||"", statut_relance: bien?.statut_relance||"",
    date_visite: bien?.date_visite||"",
  });
  const [saving, setSaving] = useState(false);

  // Auto-calcul coût total
  useEffect(() => {
    const ct = (parseFloat(form.prix_vente)||0) + (parseFloat(form.prix_travaux)||0);
    if (ct > 0) setForm(f => ({ ...f, cout_total: ct }));
  }, [form.prix_vente, form.prix_travaux]);

  const sauvegarder = async () => {
    setSaving(true);
    const NUM = ["prix_vente","prix_travaux","cout_total","rendement_brut","cashflow_estime","montant_offre"];
    const DATE = ["date_relance","date_visite"];
    const payload = {
      adresse:                 form.adresse?.trim() || null,
      ville:                   form.ville?.trim() || null,
      code_postal:             form.code_postal?.trim() || null,
      commentaire:             form.commentaire?.trim() || null,
      interlocuteur:           form.interlocuteur?.trim() || null,
      telephone_interlocuteur: form.telephone_interlocuteur?.trim() || null,
      agence:                  form.agence?.trim() || null,
      lien_annonce:            form.lien_annonce?.trim() || null,
      lien_drive:              form.lien_drive?.trim() || null,
      lien_rentabilite:        form.lien_rentabilite?.trim() || null,
      statut_relance:          form.statut_relance?.trim() || null,
      statut:                  form.statut || "À analyser",
      prix_vente:              parseFloat(form.prix_vente) || 0,
      prix_travaux:            parseFloat(form.prix_travaux) || 0,
      cout_total:              parseFloat(form.cout_total) || 0,
      rendement_brut:          parseFloat(form.rendement_brut) || 0,
      cashflow_estime:         parseFloat(form.cashflow_estime) || 0,
      montant_offre:           parseFloat(form.montant_offre) || 0,
      date_relance:            form.date_relance || null,
      date_visite:             form.date_visite || null,
    };
    const { error } = isEdit
      ? await supabase.from("invest_biens").update(payload).eq("id", bien.id)
      : await supabase.from("invest_biens").insert(payload);
    if (error) { console.error("Erreur bien:", error); alert("Erreur : " + error.message); }
    setSaving(false);
    if (!error) onSave();
  };



  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 }}>
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, padding:"28px 30px", width:"90%", maxWidth:680, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 30px 80px rgba(0,0,0,.5)" }}>
        <div style={{ fontSize:17, fontWeight:800, color:T.text, marginBottom:20 }}>{isEdit ? "Modifier le bien" : "Nouveau bien"}</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 16px" }}>
          <div style={{ marginBottom:12, gridColumn: 1 / 3 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Adresse</label><InpText value={form.adresse} onChange={e=>setForm({...form,adresse:e.target.value})} placeholder="123 rue de la Paix"/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Ville</label><InpText value={form.ville} onChange={e=>setForm({...form,ville:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Code postal</label><InpText value={form.code_postal} onChange={e=>setForm({...form,code_postal:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Interlocuteur</label><InpText value={form.interlocuteur} onChange={e=>setForm({...form,interlocuteur:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Téléphone</label><InpText value={form.telephone_interlocuteur} onChange={e=>setForm({...form,telephone_interlocuteur:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Agence</label><InpText value={form.agence} onChange={e=>setForm({...form,agence:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Statut</label>
            <select className="inv-sel" value={form.statut} style={{ width:"100%" }} onChange={e=>setForm({...form,statut:e.target.value})}>
              {STATUTS_BIEN.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Prix de vente (€)</label><InpNum value={form.prix_vente} onChange={e=>setForm({...form,prix_vente:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Prix travaux (€)</label><InpNum value={form.prix_travaux} onChange={e=>setForm({...form,prix_travaux:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Coût total (€)</label><InpNum value={form.cout_total} onChange={e=>setForm({...form,cout_total:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Rendement brut (%)</label><InpNum value={form.rendement_brut} step="0.1" onChange={e=>setForm({...form,rendement_brut:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Cash-flow estimé (€/mois)</label><InpNum value={form.cashflow_estime} onChange={e=>setForm({...form,cashflow_estime:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Montant offre (€)</label><InpNum value={form.montant_offre} onChange={e=>setForm({...form,montant_offre:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Date visite</label><InpText type="date" value={form.date_visite} onChange={e=>setForm({...form,date_visite:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Date relance</label><InpText type="date" value={form.date_relance} onChange={e=>setForm({...form,date_relance:e.target.value})}/></div>
          <div style={{ marginBottom:12, gridColumn: 1 / 3 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Lien annonce</label><InpText value={form.lien_annonce} onChange={e=>setForm({...form,lien_annonce:e.target.value})} placeholder="https://…"/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Lien Drive</label><InpText value={form.lien_drive} onChange={e=>setForm({...form,lien_drive:e.target.value})} placeholder="https://…"/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Lien dossier rentabilité</label><InpText value={form.lien_rentabilite} onChange={e=>setForm({...form,lien_rentabilite:e.target.value})} placeholder="https://…"/></div>
          <div style={{ marginBottom:12, gridColumn: 1 / 3 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Commentaire</label><textarea className="inv-textarea" rows={3} value={form.commentaire} onChange={e=>setForm({...form,commentaire:e.target.value})}/></div>
        </div>
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
          <button className="inv-btn inv-btn-out" onClick={onClose}>Annuler</button>
          <button className="inv-btn inv-btn-gold" onClick={sauvegarder} disabled={saving}>{saving?"Enregistrement…":"Enregistrer"}</button>
        </div>
      </div>
    </div>
  );
}

function FicheBien({ id, profil, onRetour, T=THEMES_INV.dark }) {
  const [bien, setBien]       = useState(null);
  const [props, setProps]     = useState([]);
  const [clients, setClients] = useState([]);
  const [showEdit, setShowEdit] = useState(false);
  const [showProp, setShowProp] = useState(false);
  const [newProp, setNewProp] = useState({ client_id:"", statut:"proposé", commentaire:"", lien_dossier:"" });
  const [savingProp, setSavingProp] = useState(false);

  const charger = async () => {
    const [{ data: b }, { data: p }, { data: c }] = await Promise.all([
      supabase.from("invest_biens").select("*").eq("id", id).single(),
      supabase.from("invest_propositions").select("*, client:invest_clients(nom,prenom)").eq("bien_id", id).order("created_at",{ascending:false}),
      supabase.from("invest_clients").select("id,nom,prenom").order("nom"),
    ]);
    setBien(b); setProps(p||[]); setClients(c||[]);
  };
  useEffect(() => { charger(); }, [id]);

  const ajouterProp = async () => {
    if (!newProp.client_id) return;
    setSavingProp(true);
    await supabase.from("invest_propositions").insert({ bien_id: id, ...newProp, date_proposition: new Date().toISOString().slice(0,10) });
    setNewProp({ client_id:"", statut:"proposé", commentaire:"", lien_dossier:"" });
    setSavingProp(false);
    setShowProp(false);
    charger();
  };

  const fmtDate = d => d ? new Date(d).toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"}) : "—";
  const fmtEur  = v => v > 0 ? new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(v)+" €" : "—";

  if (!bien) return <div style={{ textAlign:"center", padding:"60px", color:T.textMuted }}>Chargement…</div>;

  const couleur = STATUT_BIEN_COLORS[bien.statut] || "#9aa0b0";

  return (
    <div style={{ padding:"24px 28px", maxWidth:1100, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
        <button className="inv-btn inv-btn-out inv-btn-sm" onClick={onRetour}>← Stock de biens</button>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:22, fontWeight:800, color:T.text }}>{bien.adresse||"Bien sans adresse"}</div>
          <div style={{ fontSize:13, color:T.textSub, marginTop:2 }}>{bien.ville||""}{bien.code_postal ? ` ${bien.code_postal}` : ""}{bien.agence ? ` · ${bien.agence}` : ""}</div>
        </div>
        <span style={{ background:`${couleur}18`, color:couleur, border:`1px solid ${couleur}33`, borderRadius:20, padding:"4px 14px", fontSize:12, fontWeight:700 }}>{bien.statut}</span>
        <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => setShowEdit(true)}>✏️ Modifier</button>
        <button className="inv-btn inv-btn-danger inv-btn-sm" onClick={async () => {
          if (!window.confirm(`Supprimer ce bien (${bien.adresse||"sans adresse"}) ? Cette action est irréversible.`)) return;
          await supabase.from("invest_propositions").delete().eq("bien_id", id);
          await supabase.from("invest_biens").delete().eq("id", id);
          onRetour();
        }}>🗑️ Supprimer</button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <div className="inv-card">
            <div className="inv-card-hd blue">🏠 Informations</div>
            <div className="inv-card-bd">
              {[["Interlocuteur", bien.interlocuteur],["Téléphone", bien.telephone_interlocuteur],["Lien annonce", bien.lien_annonce ? <a href={bien.lien_annonce} target="_blank" rel="noreferrer" style={{color:T.accent}}>Voir l'annonce ↗</a> : "—"],["Date visite", fmtDate(bien.date_visite)],["Date relance", fmtDate(bien.date_relance)],["Statut relance", bien.statut_relance||"—"]].map(([l,v])=>(
                <div key={l} className="inv-row"><span className="inv-lbl">{l}</span><span className="inv-val calc">{v||"—"}</span></div>
              ))}
            </div>
          </div>
          <div className="inv-card">
            <div className="inv-card-hd gold">💰 Données Financières</div>
            <div className="inv-card-bd">
              {[["Prix de vente", fmtEur(bien.prix_vente)],["Prix travaux", fmtEur(bien.prix_travaux)],["Coût total", fmtEur(bien.cout_total)],["Montant offre", fmtEur(bien.montant_offre)],["Rendement brut", bien.rendement_brut > 0 ? bien.rendement_brut.toFixed(1)+"%" : "—"],["Cash-flow estimé", bien.cashflow_estime ? fmtEur(bien.cashflow_estime)+"/mois" : "—"]].map(([l,v])=>(
                <div key={l} className="inv-row"><span className="inv-lbl">{l}</span><span className="inv-val calc" style={{fontFamily:"'DM Mono',monospace",fontWeight:700}}>{v}</span></div>
              ))}
              {(bien.lien_drive || bien.lien_rentabilite) && (
                <div style={{ marginTop:12, display:"flex", gap:8, flexWrap:"wrap" }}>
                  {bien.lien_drive && <a href={bien.lien_drive} target="_blank" rel="noreferrer" className="inv-btn inv-btn-out inv-btn-sm" style={{color:T.accent,borderColor:`${T.accent}55`}}>📁 Dossier Drive</a>}
                  {bien.lien_rentabilite && <a href={bien.lien_rentabilite} target="_blank" rel="noreferrer" className="inv-btn inv-btn-out inv-btn-sm" style={{color:T.accent,borderColor:`${T.accent}55`}}>📊 Rentabilité</a>}
                </div>
              )}
            </div>
          </div>
          {bien.commentaire && (
            <div className="inv-card">
              <div className="inv-card-hd mid">💬 Commentaire</div>
              <div className="inv-card-bd" style={{ fontSize:13, color:T.textSub, lineHeight:1.7 }}>{bien.commentaire}</div>
            </div>
          )}

          {/* Documents */}
          <DocumentsSection folder={`biens/${id}`} T={T} />
        </div>

        {/* Propositions clients */}
        <div className="inv-card">
          <div className="inv-card-hd" style={{ justifyContent:"space-between" }}>
            <span>👥 Clients associés ({props.length})</span>
            <button className="inv-btn inv-btn-sm" style={{ background:"rgba(255,255,255,0.15)", color:"white", border:"none" }} onClick={() => setShowProp(true)}>＋ Proposer</button>
          </div>
          <div className="inv-card-bd">
            {props.length === 0 ? (
              <div style={{ fontSize:13, color:"#9aa0b0", fontStyle:"italic", textAlign:"center", padding:"20px 0" }}>Aucun client associé</div>
            ) : props.map(p => (
              <div key={p.id} style={{ padding:"10px 0", borderBottom:`1px solid ${T.border}` }}>
                <div style={{ fontWeight:700, fontSize:13, color:T.text }}>{p.client?.prenom} {p.client?.nom}</div>
                <div style={{ fontSize:11, color:T.textMuted, marginTop:2 }}>
                  {new Date(p.date_proposition).toLocaleDateString("fr-FR")} · <span style={{ fontWeight:600, color:T.accent }}>{p.statut}</span>
                  {p.commentaire && ` · ${p.commentaire}`}
                </div>
                {p.lien_dossier && <a href={p.lien_dossier} target="_blank" rel="noreferrer" style={{ fontSize:11, color:T.accent }}>📄 Dossier présenté ↗</a>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {showEdit && <FormulaireBien bien={bien} profil={profil} T={T} onSave={() => { setShowEdit(false); charger(); }} onClose={() => setShowEdit(false)} />}

      {showProp && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 }}>
          <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, padding:"24px 26px", width:"90%", maxWidth:440 }}>
            <div style={{ fontSize:16, fontWeight:800, color:T.text, marginBottom:16 }}>Proposer ce bien à un client</div>
            <div style={{ marginBottom:12 }}>
              <label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Client</label>
              <select className="inv-sel" value={newProp.client_id} style={{ width:"100%" }} onChange={e=>setNewProp({...newProp,client_id:e.target.value})}>
                <option value="">Sélectionner un client…</option>
                {clients.map(c=><option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:12 }}>
              <label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Statut</label>
              <select className="inv-sel" value={newProp.statut} style={{ width:"100%" }} onChange={e=>setNewProp({...newProp,statut:e.target.value})}>
                {STATUTS_PROP.map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:12 }}>
              <label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Commentaire</label>
              <textarea className="inv-textarea" rows={2} value={newProp.commentaire} onChange={e=>setNewProp({...newProp,commentaire:e.target.value})}/>
            </div>
            <div style={{ marginBottom:16 }}>
              <label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Lien dossier présenté</label>
              <input className="inv-inp" value={newProp.lien_dossier} style={{ width:"100%", textAlign:"left" }} onChange={e=>setNewProp({...newProp,lien_dossier:e.target.value})} placeholder="https://…"/>
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button className="inv-btn inv-btn-out" onClick={() => setShowProp(false)}>Annuler</button>
              <button className="inv-btn inv-btn-blue" onClick={ajouterProp} disabled={savingProp||!newProp.client_id}>{savingProp?"…":"Proposer"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ADMIN INVEST ─────────────────────────────────────────────────────────────
function AdminInvest({ profil, T, theme, setTheme }) {
  const [onglet, setOnglet] = useState("utilisateurs");
  const isAdmin = profil?.role === "admin";

  if (!isAdmin) return (
    <div style={{ padding:"40px 28px", textAlign:"center" }}>
      <div style={{ fontSize:36, marginBottom:14 }}>🔒</div>
      <div style={{ fontSize:18, fontWeight:700, color:T.text, marginBottom:8 }}>Accès restreint</div>
      <div style={{ fontSize:14, color:T.textSub }}>Seuls les administrateurs peuvent accéder à cette section.</div>
    </div>
  );

  return (
    <div style={{ padding:"24px 28px", maxWidth:900, margin:"0 auto" }}>
      <div style={{ fontSize:26, fontWeight:800, color:T.text, letterSpacing:.5, marginBottom:4 }}>Réglages</div>
      <div style={{ fontSize:14, color:T.textSub, marginBottom:24 }}>Administration de l'application Profero Invest.</div>

      {/* Onglets */}
      <div style={{ display:"flex", gap:4, marginBottom:24, borderBottom:`1px solid ${T.border}`, paddingBottom:8 }}>
        {[["utilisateurs","👥 Utilisateurs"],["apparence","🎨 Apparence"]].map(([k,l])=>(
          <button key={k}
            onClick={() => setOnglet(k)}
            style={{
              padding:"8px 18px", border:"none", borderRadius:6, cursor:"pointer",
              fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:700,
              letterSpacing:.5, textTransform:"uppercase",
              background: onglet===k ? T.accent : "transparent",
              color: onglet===k ? "white" : T.textSub,
              transition:"all .15s",
            }}>
            {l}
          </button>
        ))}
      </div>

      {/* Onglet Utilisateurs — réutilise le même composant que Rénovation */}
      {onglet === "utilisateurs" && <OngletUtilisateursInvest T={T} />}

      {/* Onglet Apparence */}
      {onglet === "apparence" && (
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"20px 18px" }}>
          <div style={{ fontWeight:700, fontSize:16, marginBottom:4, color:T.text }}>Thème d'affichage</div>
          <div style={{ color:T.textSub, fontSize:13, marginBottom:18 }}>Sauvegardé sur cet appareil, indépendant de Rénovation.</div>
          <div style={{ display:"flex", gap:14 }}>
            {[["dark","🌙","Sombre"],["light","☀️","Clair"]].map(([k,ic,lb])=>(
              <div key={k} onClick={() => { setTheme(k); localStorage.setItem("invest_theme",k); }}
                style={{
                  flex:1, background: k==="dark"?"#1a1d24":"#f0f4f8",
                  border:`3px solid ${theme===k ? T.accent : T.border}`,
                  borderRadius:12, padding:"22px 16px", cursor:"pointer", textAlign:"center", transition:"border .15s",
                }}>
                <div style={{ fontSize:30, marginBottom:8 }}>{ic}</div>
                <div style={{ fontSize:14, fontWeight:700, color: k==="dark"?"#e8eaf0":"#1a2d4a" }}>{lb}</div>
                {theme===k && <div style={{ fontSize:11, color:T.accent, marginTop:6 }}>✓ Actif</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Copie de OngletUtilisateurs adaptée au thème Invest
function OngletUtilisateursInvest({ T }) {
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [erreur, setErreur]             = useState("");
  const [succes, setSucces]             = useState("");
  const [showForm, setShowForm]         = useState(false);
  const [invEmail, setInvEmail]         = useState("");
  const [invNom, setInvNom]             = useState("");
  const [invRole, setInvRole]           = useState("conducteur");
  const [invBranches, setInvBranches]   = useState(["renovation"]);
  const [invLoading, setInvLoading]     = useState(false);
  const [editId, setEditId]             = useState(null);
  const [editData, setEditData]         = useState({});
  const [resetId, setResetId]           = useState(null);
  const [resetEmail, setResetEmail]     = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  const ROLES = [
    { value:"admin",      label:"Administrateur" },
    { value:"conducteur", label:"Conducteur de travaux" },
    { value:"commercial", label:"Commercial" },
    { value:"comptable",  label:"Comptable" },
  ];
  const BRANCHES = [
    { value:"renovation", label:"Rénovation" },
    { value:"invest",     label:"Invest" },
  ];
  const ROLE_LABELS   = { admin:"Administrateur", conducteur:"Conducteur de travaux", commercial:"Commercial", comptable:"Comptable" };
  const BRANCHE_LABELS = { renovation:"Rénovation", invest:"Invest" };
  const ROLE_COLORS   = { admin:"#FFC200", conducteur:"#50c878", commercial:"#4db8ff", comptable:"#c084fc" };

  const charger = async () => {
    setLoading(true);
    const { data } = await supabase.from("utilisateurs").select("*").order("nom");
    setUtilisateurs(data || []);
    setLoading(false);
  };
  useEffect(() => { charger(); }, []);

  const flash = (type, msg) => {
    if (type==="ok") { setSucces(msg); setErreur(""); setTimeout(()=>setSucces(""),4000); }
    else             { setErreur(msg); setSucces(""); setTimeout(()=>setErreur(""),5000); }
  };
  const toggleBranche = (branches, val) =>
    branches.includes(val) ? branches.filter(b=>b!==val) : [...branches, val];

  const callAdminUsers = async (payload) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`,
      {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "Authorization":`Bearer ${session?.access_token}`,
          "apikey": import.meta.env.VITE_SUPABASE_KEY,
        },
        body: JSON.stringify(payload),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur serveur");
    return data;
  };

  const inviter = async () => {
    if (!invEmail.trim() || !invNom.trim()) { flash("err","Email et nom obligatoires."); return; }
    if (!invBranches.length) { flash("err","Sélectionnez au moins une branche."); return; }
    setInvLoading(true);
    try {
      const { data: exist } = await supabase.from("utilisateurs").select("id").eq("email",invEmail.trim().toLowerCase()).single();
      if (exist) { flash("err","Cet email est déjà enregistré."); setInvLoading(false); return; }
      await callAdminUsers({ action:"invite", email:invEmail.trim().toLowerCase() });
      const { error: dbErr } = await supabase.from("utilisateurs").insert({
        email:invEmail.trim().toLowerCase(), nom:invNom.trim(),
        role:invRole, branches:invBranches, actif:true,
      });
      if (dbErr) { flash("err","Profil non créé : "+dbErr.message); setInvLoading(false); return; }
      flash("ok",`✓ Invitation envoyée à ${invEmail}.`);
      setInvEmail(""); setInvNom(""); setInvRole("conducteur"); setInvBranches(["renovation"]);
      setShowForm(false); charger();
    } catch(e) { flash("err","Erreur : "+e.message); }
    setInvLoading(false);
  };

  const sauvegarder = async (id) => {
    if (!editData.nom?.trim()) { flash("err","Nom obligatoire."); return; }
    const { error } = await supabase.from("utilisateurs")
      .update({ nom:editData.nom.trim(), role:editData.role, branches:editData.branches }).eq("id",id);
    if (error) { flash("err","Erreur : "+error.message); return; }
    flash("ok","✓ Modifications enregistrées."); setEditId(null); charger();
  };

  const toggleActif = async (u) => {
    const { error } = await supabase.from("utilisateurs").update({ actif:!u.actif }).eq("id",u.id);
    if (error) { flash("err","Erreur : "+error.message); return; }
    flash("ok", u.actif ? `✓ ${u.nom} désactivé(e).` : `✓ ${u.nom} réactivé(e).`);
    charger();
  };

  const resetPassword = async () => {
    setResetLoading(true);
    try {
      await callAdminUsers({ action:"reset_password", email:resetEmail });
      flash("ok",`✓ Email de réinitialisation envoyé à ${resetEmail}.`);
      setResetId(null); setResetEmail("");
    } catch(e) { flash("err","Erreur : "+e.message); }
    setResetLoading(false);
  };

  // Styles adaptés au thème Invest
  const cardStyle = { background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"20px 18px" };
  const labelStyle = { fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:6 };
  const inputStyle = { width:"100%", background:T.input, border:`1.5px solid ${T.border}`, borderRadius:6, padding:"8px 12px", color:T.text, fontFamily:"'Barlow Condensed',sans-serif", fontSize:13, outline:"none" };
  const rowStyle   = { padding:"14px 0", borderBottom:`1px solid ${T.border}` };

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:16, color:T.text, marginBottom:3 }}>Collaborateurs</div>
          <div style={{ color:T.textSub, fontSize:13 }}>Gérez les accès, rôles et branches.</div>
        </div>
        <button className="inv-btn inv-btn-gold" onClick={() => { setShowForm(!showForm); setErreur(""); }}>
          {showForm ? "✕ Annuler" : "+ Inviter"}
        </button>
      </div>

      {/* Messages */}
      {succes && <div style={{ background:"rgba(80,200,120,0.12)", border:"1px solid rgba(80,200,120,0.3)", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#50c878", marginBottom:14, lineHeight:1.6 }}>{succes}</div>}
      {erreur && <div style={{ background:"rgba(224,92,92,0.12)", border:"1px solid rgba(224,92,92,0.3)", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#e05c5c", marginBottom:14 }}>{erreur}</div>}

      {/* Formulaire invitation */}
      {showForm && (
        <div style={{ ...cardStyle, marginBottom:20 }}>
          <div style={{ fontWeight:700, fontSize:14, color:T.text, marginBottom:16 }}>Nouveau collaborateur</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
            <div><label style={labelStyle}>Nom complet *</label><input style={inputStyle} value={invNom} onChange={e=>setInvNom(e.target.value)} placeholder="Prénom Nom"/></div>
            <div><label style={labelStyle}>Email *</label><input style={{...inputStyle,textAlign:"left"}} type="email" value={invEmail} onChange={e=>setInvEmail(e.target.value)} placeholder="email@profero.fr"/></div>
            <div>
              <label style={labelStyle}>Rôle</label>
              <select style={inputStyle} value={invRole} onChange={e=>setInvRole(e.target.value)}>
                {ROLES.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Branches</label>
              <div style={{ display:"flex", gap:8 }}>
                {BRANCHES.map(b=>(
                  <button key={b.value} onClick={()=>setInvBranches(toggleBranche(invBranches,b.value))}
                    style={{ flex:1, padding:"8px 0", borderRadius:8, border:"1.5px solid", fontFamily:"'Barlow Condensed',sans-serif", fontSize:13, fontWeight:700, cursor:"pointer",
                      background: invBranches.includes(b.value) ? "rgba(77,184,255,0.12)" : "transparent",
                      borderColor: invBranches.includes(b.value) ? T.accent : T.border,
                      color: invBranches.includes(b.value) ? T.accent : T.textSub,
                    }}>{b.label}</button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ background:"rgba(77,184,255,0.08)", border:"1px solid rgba(77,184,255,0.2)", borderRadius:8, padding:"10px 14px", fontSize:12, color:"#4db8ff", marginBottom:14, lineHeight:1.6 }}>
            📧 Un lien d'invitation sera envoyé à <strong>{invEmail||"l'adresse saisie"}</strong>.
          </div>
          <button className="inv-btn inv-btn-gold" style={{ width:"100%", padding:"11px", justifyContent:"center" }} onClick={inviter} disabled={invLoading}>
            {invLoading ? "Envoi…" : "Envoyer l'invitation →"}
          </button>
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <div style={{ textAlign:"center", padding:"40px 0", color:T.textSub }}>Chargement…</div>
      ) : (
        <div style={cardStyle}>
          {utilisateurs.length === 0 ? (
            <div style={{ color:T.textSub, fontSize:13, fontStyle:"italic" }}>Aucun collaborateur.</div>
          ) : utilisateurs.map(u => (
            <div key={u.id} style={rowStyle}>
              {editId === u.id ? (
                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <div><label style={labelStyle}>Nom</label><input style={inputStyle} value={editData.nom} onChange={e=>setEditData({...editData,nom:e.target.value})}/></div>
                    <div>
                      <label style={labelStyle}>Rôle</label>
                      <select style={inputStyle} value={editData.role} onChange={e=>setEditData({...editData,role:e.target.value})}>
                        {ROLES.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>Branches</label>
                    <div style={{ display:"flex", gap:8 }}>
                      {BRANCHES.map(b=>(
                        <button key={b.value} onClick={()=>setEditData({...editData,branches:toggleBranche(editData.branches||[],b.value)})}
                          style={{ padding:"7px 18px", borderRadius:8, border:"1.5px solid", fontFamily:"'Barlow Condensed',sans-serif", fontSize:13, fontWeight:700, cursor:"pointer",
                            background:(editData.branches||[]).includes(b.value)?"rgba(77,184,255,0.12)":"transparent",
                            borderColor:(editData.branches||[]).includes(b.value)?T.accent:T.border,
                            color:(editData.branches||[]).includes(b.value)?T.accent:T.textSub,
                          }}>{b.label}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={()=>sauvegarder(u.id)}>✓ Enregistrer</button>
                    <button className="inv-btn inv-btn-out inv-btn-sm" onClick={()=>setEditId(null)}>Annuler</button>
                  </div>
                </div>
              ) : (
                <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
                  {/* Avatar */}
                  <div style={{ width:38, height:38, borderRadius:10, flexShrink:0, background:`${ROLE_COLORS[u.role]}22`, border:`1.5px solid ${ROLE_COLORS[u.role]}55`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:800, color:ROLE_COLORS[u.role] }}>
                    {u.nom?.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}
                  </div>
                  {/* Infos */}
                  <div style={{ flex:1, minWidth:160 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontWeight:700, fontSize:15, color: u.actif ? T.text : T.textMuted }}>{u.nom}</span>
                      {!u.actif && <span style={{ fontSize:10, padding:"2px 7px", borderRadius:4, background:"rgba(224,92,92,0.12)", color:"#e05c5c", fontWeight:700 }}>Désactivé</span>}
                    </div>
                    <div style={{ fontSize:12, color:T.textMuted, marginTop:2 }}>{u.email}</div>
                    <div style={{ display:"flex", gap:6, marginTop:5, flexWrap:"wrap" }}>
                      <span style={{ fontSize:11, padding:"2px 8px", borderRadius:4, fontWeight:700, background:`${ROLE_COLORS[u.role]}18`, color:ROLE_COLORS[u.role], border:`1px solid ${ROLE_COLORS[u.role]}33` }}>
                        {ROLE_LABELS[u.role]||u.role}
                      </span>
                      {(u.branches||["renovation"]).map(b=>(
                        <span key={b} style={{ fontSize:11, padding:"2px 8px", borderRadius:4, fontWeight:600, background:"rgba(77,184,255,0.08)", color:T.accent, border:`1px solid rgba(77,184,255,0.2)` }}>
                          {BRANCHE_LABELS[b]||b}
                        </span>
                      ))}
                    </div>
                  </div>
                  {/* Actions */}
                  <div style={{ display:"flex", gap:6, flexShrink:0, flexWrap:"wrap" }}>
                    <button className="inv-btn inv-btn-out inv-btn-sm" onClick={()=>{ setEditId(u.id); setEditData({nom:u.nom,role:u.role,branches:u.branches||["renovation"]}); }}>✏️ Modifier</button>
                    <button className="inv-btn inv-btn-sm" style={{ background:"rgba(77,184,255,0.08)", color:"#4db8ff", border:"1px solid rgba(77,184,255,0.3)" }} onClick={()=>{ setResetId(u.id); setResetEmail(u.email); }}>🔑 Réinit.</button>
                    <button className="inv-btn inv-btn-sm" style={{ background: u.actif?"rgba(224,92,92,0.08)":"rgba(80,200,120,0.08)", color: u.actif?"#e05c5c":"#50c878", border:`1px solid ${u.actif?"rgba(224,92,92,0.3)":"rgba(80,200,120,0.3)"}` }} onClick={()=>toggleActif(u)}>
                      {u.actif?"Désactiver":"Réactiver"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal reset MDP */}
      {resetId && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:500 }}>
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"28px 30px", maxWidth:380, width:"90%", textAlign:"center" }}>
            <div style={{ fontSize:34, marginBottom:10 }}>🔑</div>
            <div style={{ fontSize:16, fontWeight:800, color:T.text, marginBottom:8 }}>Réinitialiser le mot de passe ?</div>
            <div style={{ fontSize:13, color:T.textSub, marginBottom:6, lineHeight:1.6 }}>Un email sera envoyé à</div>
            <div style={{ fontSize:14, fontWeight:700, color:T.accent, marginBottom:22 }}>{resetEmail}</div>
            <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
              <button className="inv-btn inv-btn-out" onClick={()=>{ setResetId(null); setResetEmail(""); }}>Annuler</button>
              <button className="inv-btn inv-btn-gold" onClick={resetPassword} disabled={resetLoading}>{resetLoading?"Envoi…":"Envoyer →"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SIDEBAR INVEST ───────────────────────────────────────────────────────────
function SidebarInvest({ page, setPage, theme, setTheme, profil, onRetourPortail, onLogout }) {
  const isAdmin = profil?.role === "admin";
  const T = THEMES_INV[theme];
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("invest_sidebar_collapsed") === "1");

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("invest_sidebar_collapsed", next ? "1" : "0");
  };

  const NAV = [
    { id:"dashboard",  label:"Tableau de bord", icon: LayoutDashboard },
    { id:"crm",        label:"CRM Clients",     icon: Users },
    { id:"biens",      label:"Stock de biens",  icon: Building2 },
    { id:"simulateur", label:"Simulateur",      icon: BarChart3 },
    ...(isAdmin ? [{ id:"admin", label:"Réglages", icon: Settings }] : []),
  ];

  const W = collapsed ? 64 : 220;

  const footerBtn = (onClick, icon, color, bg, border, title) => (
    <button onClick={onClick} title={collapsed ? title : ""} style={{
      width:"100%", background:bg, border, borderRadius:RADIUS.md,
      padding: collapsed ? "10px 0" : `${SPACING.sm}px ${SPACING.md}px`,
      color, fontFamily:"'Barlow Condensed',sans-serif", fontSize:FONT.sm.size+1, fontWeight:700,
      cursor:"pointer", display:"flex", alignItems:"center",
      justifyContent: collapsed ? "center" : "flex-start",
      gap:SPACING.sm, letterSpacing:0.5, transition:"all .15s",
    }}>
      <Icon as={icon} size={16} strokeWidth={2}/>
      {!collapsed && <span>{title}</span>}
    </button>
  );

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

      {/* User info (light card) */}
      {profil && !collapsed && (
        <div style={{
          padding:`${SPACING.sm+2}px ${SPACING.md+2}px`, borderTop:`1px solid ${T.sidebarBorder}`,
          display:"flex", flexDirection:"column", gap:1, flexShrink:0,
        }}>
          <span style={{ fontSize:FONT.sm.size, fontWeight:700, color:"#fff", letterSpacing:0.1,
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
          }}>{profil?.nom || profil?.email}</span>
          <span style={{ fontSize:FONT.xs.size, letterSpacing:0.8, textTransform:"uppercase",
            color: T.accent, opacity:0.75, fontWeight:600,
          }}>{profil?.role || "—"}</span>
        </div>
      )}

      {/* Boutons bas */}
      <div style={{
        padding: collapsed ? `${SPACING.sm}px ${SPACING.xs+2}px` : `${SPACING.md-2}px ${SPACING.sm+2}px`,
        borderTop:`1px solid ${T.sidebarBorder}`,
        display:"flex", flexDirection: collapsed ? "column" : "row",
        gap: collapsed ? SPACING.xs : SPACING.xs+1, flexShrink:0,
        alignItems:"center", justifyContent: collapsed ? "center" : "space-between",
      }}>
        {(() => {
          const buttons = [
            footerBtn(
              () => { const n = theme==="dark"?"light":"dark"; setTheme(n); localStorage.setItem("invest_theme",n); },
              theme === "dark" ? Sun : Moon,
              T.accent, T.accentBg, `1px solid ${T.accentBorder}`,
              theme==="dark" ? "Mode clair" : "Mode sombre"
            ),
            onRetourPortail && footerBtn(
              onRetourPortail, LayoutGrid,
              "rgba(255,194,0,0.85)", "rgba(255,194,0,0.08)", "1px solid rgba(255,194,0,0.20)",
              "Portail"
            ),
            footerBtn(
              onLogout, LogOut,
              "#e15a5a", "rgba(225,90,90,0.08)", "1px solid rgba(225,90,90,0.25)",
              "Déconnexion"
            ),
          ].filter(Boolean);

          // Wrap to make collapsed buttons stack vertically full-width, row otherwise
          return collapsed ? buttons : buttons.map((btn, i) => <div key={i} style={{ flex:1 }}>{btn}</div>);
        })()}
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
  const fermerSim = () => {
    setVueSim("liste");
    if (simOrigine === "crm") setPage("crm");
  };

  // Simulateur plein écran — uniquement quand une fiche projet est ouverte
  if (page === "simulateur" && vueSim === "simulateur") {
    return (
      <div className="inv" style={{ position:"fixed", inset:0, zIndex:9999 }}>
        <style>{CSS}</style>
        <Simulateur projet={projetOuvert} profil={profil} onRetour={fermerSim} />
      </div>
    );
  }

  return (
    <div className="inv" style={{ position:"fixed", inset:0, zIndex:9999, display:"flex", background:T.bg }}>
      <style>{CSS}</style>
      <SidebarInvest page={page} setPage={setPage} theme={theme} setTheme={setTheme} profil={profil} onRetourPortail={onRetourPortail} onLogout={onLogout} />
      <div style={{ flex:1, overflowY:"auto", background:T.bg }}>
        {page === "dashboard"  && <TableauBord profil={profil} T={T} />}
        {page === "crm"        && <CRM profil={profil} T={T} onOuvrirSimulation={ouvrirSimulationDepuisCRM} />}
        {page === "biens"      && <StockBiens profil={profil} T={T} />}
        {page === "admin"      && <AdminInvest profil={profil} T={T} theme={theme} setTheme={setTheme} />}
        {page === "simulateur" && (
          <div style={{ padding:"24px 28px", maxWidth:1200, margin:"0 auto" }}>
            <div style={{ fontSize:26, fontWeight:800, color:T.text, letterSpacing:.5, marginBottom:6 }}>Simulateur de projets</div>
            <div style={{ fontSize:14, color:T.textSub, marginBottom:24 }}>Créez et analysez vos projets d'investissement</div>
            <ListeProjets profil={profil} onOuvrir={ouvrirProjet} onNouveauProjet={nouveauProjet} inline={true} T={T} />
          </div>
        )}
      </div>
    </div>
  );
}
