// ══════════════════════════════════════════════════════════════════════════════
//  PageInvest.jsx — Profero Invest — Version complète
//  MIGRATIONS SUPABASE :
//  CREATE TABLE IF NOT EXISTS invest_events (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, titre TEXT NOT NULL, date DATE NOT NULL, type TEXT DEFAULT 'Autre', notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT now());
//  ALTER TABLE invest_events ENABLE ROW LEVEL SECURITY;
//  DROP POLICY IF EXISTS "auth_all" ON invest_events;
//  CREATE POLICY "auth_all" ON invest_events FOR ALL TO authenticated USING (true);
//  ALTER TABLE invest_clients ADD COLUMN IF NOT EXISTS date_avant_contact DATE;
// ══════════════════════════════════════════════════════════════════════════════

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
const ETAPES_CLIENT = [
  "","1 — Signature contrat","2 — Envoi des documents d'analyse",
  "3 — Définition de la stratégie d'investissement","4 — Recherche du projet (visites et analyse)",
  "5 — Présentation des projets","6 — Offre d'achat","7 — Réalisation des devis précis",
  "8 — Signature du compromis","9 — Réalisation du dossier bancaire",
  "10 — Obtention du financement","11 — Réalisation des dossiers d'urbanismes",
  "12 — Validation des conditions suspensives d'achat","13 — Signature Notaire",
];
const EVENT_TYPES  = ["Visite","RDV Commercial","Réunion","Appel","Autre"];
const EVENT_ICONS  = {Visite:"🏠","RDV Commercial":"🤝",Réunion:"👥",Appel:"📞",Autre:"📌"};
const EVENT_COLORS = {Visite:"#4070e8","RDV Commercial":"#50c878",Réunion:"#c084fc",Appel:"#FFC200",Autre:"#9aa0b0"};
const STATUTS_CLIENT  = ["Prospect","Actif","Inactif","Terminé"];
const SOURCES_CLIENT  = ["Fluidify","Réseau personnel","Cold calling","Autre"];
const TYPES_NOTE      = ["appel","rendez-vous","relance","commentaire","document","autre"];
const STATUTS_PROP    = ["proposé","intéressé","refusé","en analyse","offre en cours"];
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
const STATUTS_BIEN = ["À analyser","Agent contacté","Visite programmée","Visité","À relancer","Offre à faire","Offre envoyée","Offre refusée","Offre acceptée","Abandonné","Proposé à un client","En cours d'acquisition"];
const STATUT_BIEN_COLORS = {
  "À analyser":"#9aa0b0","Agent contacté":"#1f4ea1","Visite programmée":"#6b3a8a",
  "Visité":"#1a7a4a","À relancer":"#c0392b","Offre à faire":"#c9a84c",
  "Offre envoyée":"#d4610a","Offre refusée":"#c0392b","Offre acceptée":"#1a7a4a",
  "Abandonné":"#5a6070","Proposé à un client":"#1f4ea1","En cours d'acquisition":"#1a7a4a",
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const pmt = (P,r,n)=>{ if(!P||!r||!n)return 0; const rm=r/100/12,nm=n*12; return rm?P*rm/(1-Math.pow(1+rm,-nm)):P/nm; };
const fmt = (v)=>(v===null||v===undefined||isNaN(v))?"—":new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(v)+" €";
const fmtPct = (v)=>isNaN(v)?"—":(v*100).toFixed(1)+" %";
const fmtMois = (v)=>isNaN(v)?"—":v.toFixed(1)+" mois";
const actLots = (lots)=>lots.filter(l=>l.type!=="Sélectionner");
const initBudgetState = (lots,surface)=>{
  const qty={},price={};
  BUDGET_SECTIONS.forEach(sec=>sec.items.forEach(item=>{
    qty[item.id]=item.autoFn?item.autoFn(lots,surface||0):0;
    price[item.id]=item.price;
  }));
  return {qty,price};
};
const _geoCache={};
async function geocodeAddress(adresse,ville){
  const q=[adresse,ville,"France"].filter(Boolean).join(", ");
  if(_geoCache[q])return _geoCache[q];
  try{
    await new Promise(r=>setTimeout(r,320));
    const r=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=fr`,{headers:{"User-Agent":"ProferoInvest/2.0"}});
    const d=await r.json();
    if(d?.[0]){const res={lat:parseFloat(d[0].lat),lng:parseFloat(d[0].lon)};_geoCache[q]=res;return res;}
  }catch{}
  return null;
}

// ─── THÈMES ───────────────────────────────────────────────────────────────────
const SU=SEMANTIC.success.color,WA=SEMANTIC.warning.color,DA=SEMANTIC.danger.color,IN=SEMANTIC.info.color;
const THEMES_INV={
  dark:{
    bg:"#1e2128",surface:"#262a32",card:"#262a32",cardHover:"rgba(64,112,232,0.07)",cardActive:"rgba(64,112,232,0.12)",
    border:"rgba(255,255,255,0.07)",borderHover:INVEST_ACC.border,rowBorder:"rgba(255,255,255,0.05)",
    text:"#f0f0f0",textSub:"#9aa5c0",textMuted:"#5b6a8a",
    accent:INVEST_ACC.accent,accentHover:INVEST_ACC.accentLight,accentBg:INVEST_ACC.bg10,accentBg20:INVEST_ACC.bg20,accentBorder:INVEST_ACC.border,onAccent:INVEST_ACC.onAccent,
    sidebar:"#16181d",sidebarBorder:"rgba(255,255,255,0.06)",sectionHd:"rgba(255,255,255,0.03)",tabNav:"#1a1d24",
    input:"rgba(255,255,255,0.05)",inputBorder:"rgba(255,255,255,0.10)",inputBorderHover:INVEST_ACC.border,scrollThumb:"#3a4060",
    shadowSm:"0 1px 2px rgba(0,0,0,0.3)",shadowMd:"0 4px 12px rgba(0,0,0,0.25)",
  },
  light:{
    bg:"#f7f7f7",surface:"#ffffff",card:"#ffffff",cardHover:"rgba(64,112,232,0.05)",cardActive:"rgba(64,112,232,0.10)",
    border:"rgba(0,0,0,0.09)",borderHover:INVEST_ACC.border,rowBorder:"rgba(0,0,0,0.06)",
    text:"#1a1f2e",textSub:"#4a5568",textMuted:"#8a9ab0",
    accent:INVEST_ACC.accent,accentHover:INVEST_ACC.accentDark,accentBg:INVEST_ACC.bg10,accentBg20:INVEST_ACC.bg20,accentBorder:INVEST_ACC.border,onAccent:INVEST_ACC.onAccent,
    sidebar:"#1a1f2e",sidebarBorder:"rgba(255,255,255,0.08)",sectionHd:"rgba(0,0,0,0.03)",tabNav:"#ffffff",
    input:"rgba(0,0,0,0.04)",inputBorder:"rgba(0,0,0,0.10)",inputBorderHover:INVEST_ACC.border,scrollThumb:"#c0c8d8",
    shadowSm:"0 1px 2px rgba(0,0,0,0.06)",shadowMd:"0 4px 12px rgba(0,0,0,0.10)",
  },
};

const getCSS=(T)=>`
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap');
.inv{font-family:'Barlow Condensed','Arial Narrow',sans-serif;background:${T.bg};color:${T.text};font-size:${FONT.base.size}px;}
.inv *{box-sizing:border-box;margin:0;padding:0;}
.inv ::-webkit-scrollbar{width:6px;height:6px;}
.inv ::-webkit-scrollbar-thumb{background:${T.scrollThumb};border-radius:${RADIUS.sm}px;}
.inv ::-webkit-scrollbar-track{background:transparent;}
.inv-card{background:${T.card};border-radius:${RADIUS.xl}px;border:1px solid ${T.border};overflow:hidden;box-shadow:${T.shadowSm};transition:border-color .18s,box-shadow .18s;}
.inv-card:hover{border-color:${T.borderHover};}
.inv-card-hd{background:${T.sectionHd};color:${T.text};padding:${SPACING.md}px ${SPACING.lg}px;font-size:${FONT.xs.size}px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;display:flex;align-items:center;justify-content:space-between;gap:${SPACING.sm}px;border-bottom:1px solid ${T.border};}
.inv-card-hd.accent{background:${T.accentBg};color:${T.accent};border-bottom-color:${T.accentBorder};}
.inv-card-hd.danger{background:${SEMANTIC.danger.bg};color:${DA};border-bottom-color:${SEMANTIC.danger.border};}
.inv-card-hd.green{background:${SEMANTIC.success.bg};color:${SU};border-bottom-color:${SEMANTIC.success.border};}
.inv-card-hd.blue{background:${SEMANTIC.info.bg};color:${IN};border-bottom-color:${SEMANTIC.info.border};}
.inv-card-hd.mid{background:rgba(168,85,247,0.10);color:#c084fc;border-bottom-color:rgba(168,85,247,0.25);}
.inv-card-hd.gold{background:rgba(255,194,0,0.10);color:#FFC200;border-bottom-color:rgba(255,194,0,0.25);}
.inv-card-bd{padding:${SPACING.md+2}px ${SPACING.lg}px;}
.inv-row{display:grid;grid-template-columns:1fr auto;align-items:center;padding:${SPACING.sm-1}px 0;border-bottom:1px solid ${T.rowBorder};gap:${SPACING.md}px;}
.inv-row:last-child{border-bottom:none;}.inv-row.total{border-top:2px solid ${T.accent};margin-top:${SPACING.xs}px;padding-top:${SPACING.sm}px;border-bottom:none;}
.inv-row.sub{background:${T.cardHover};margin:0 -${SPACING.lg}px;padding:${SPACING.sm-1}px ${SPACING.lg}px;}
.inv-lbl{font-size:${FONT.sm.size+1}px;color:${T.textSub};}.inv-lbl.bold{font-weight:700;color:${T.text};}
.inv-val{font-family:'DM Mono',monospace;font-size:${FONT.sm.size+1}px;text-align:right;font-weight:500;white-space:nowrap;color:${T.textSub};}
.inv-val.calc{color:${T.accent};}.inv-val.green{color:${SU};font-weight:700;}.inv-val.orange{color:${WA};font-weight:700;}.inv-val.red{color:${DA};font-weight:700;}
.inv-inp{font-family:'DM Mono',monospace;font-size:${FONT.sm.size+1}px;font-weight:500;color:${T.accent};background:${T.input};border:1.5px solid ${T.inputBorder};border-radius:${RADIUS.md}px;padding:${SPACING.sm-1}px ${SPACING.md-2}px;text-align:right;outline:none;transition:all .18s;}
.inv-inp:focus{border-color:${T.accent};box-shadow:0 0 0 3px ${T.accentBg};}
.inv-inp:hover:not(:focus){border-color:${T.inputBorderHover};}
.inv-sel{font-family:'Barlow Condensed',sans-serif;font-size:${FONT.sm.size+1}px;color:${T.text};background:${T.input};border:1.5px solid ${T.inputBorder};border-radius:${RADIUS.md}px;padding:${SPACING.sm-1}px ${SPACING.md-2}px;outline:none;cursor:pointer;transition:all .18s;}
.inv-sel:focus{border-color:${T.accent};box-shadow:0 0 0 3px ${T.accentBg};}.inv-sel:hover{border-color:${T.inputBorderHover};}
.inv-textarea{width:100%;font-family:'Barlow Condensed',sans-serif;font-size:${FONT.sm.size+1}px;color:${T.text};background:${T.input};border:1.5px solid ${T.inputBorder};border-radius:${RADIUS.md}px;padding:${SPACING.sm}px ${SPACING.md-2}px;outline:none;resize:vertical;line-height:1.55;transition:all .18s;}
.inv-textarea:focus{border-color:${T.accent};box-shadow:0 0 0 3px ${T.accentBg};}
.inv-kpi{background:${T.card};border-radius:${RADIUS.xl}px;padding:${SPACING.lg}px ${SPACING.lg+2}px;border:1px solid ${T.border};display:flex;flex-direction:column;gap:${SPACING.xs+2}px;transition:all .18s;}
.inv-kpi:hover{border-color:${T.borderHover};box-shadow:${T.shadowMd};}
.inv-kpi-lbl{font-size:${FONT.xs.size-1}px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:${T.textMuted};}
.inv-kpi-val{font-family:'DM Mono',monospace;font-size:${FONT.h2.size}px;font-weight:700;color:${T.text};letter-spacing:-0.3px;line-height:1;}
.inv-kpi-val.green{color:${SU};}.inv-kpi-val.orange{color:${WA};}.inv-kpi-val.red{color:${DA};}.inv-kpi-val.accent{color:${T.accent};}
.inv-tab-nav{background:${T.tabNav};display:flex;padding:0 ${SPACING.xl}px;gap:${SPACING.xs-2}px;border-bottom:1px solid ${T.border};flex-shrink:0;}
.inv-tab-btn{padding:${SPACING.md-2}px ${SPACING.lg+2}px;font-family:'Barlow Condensed',sans-serif;font-size:${FONT.sm.size+1}px;font-weight:700;color:${T.textMuted};background:transparent;border:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;letter-spacing:0.5px;text-transform:uppercase;transition:all .15s;}
.inv-tab-btn:hover{color:${T.textSub};}.inv-tab-btn.active{color:${T.accent};border-bottom-color:${T.accent};}
.inv-btn{display:inline-flex;align-items:center;gap:${SPACING.xs+2}px;padding:${SPACING.sm}px ${SPACING.lg}px;border-radius:${RADIUS.md}px;font-family:'Barlow Condensed',sans-serif;font-size:${FONT.sm.size+1}px;font-weight:700;cursor:pointer;border:none;white-space:nowrap;letter-spacing:0.5px;transition:all .15s;}
.inv-btn:disabled{opacity:.5;cursor:not-allowed;}
.inv-btn-accent{background:${T.accent};color:${T.onAccent};}.inv-btn-accent:hover:not(:disabled){background:${T.accentHover};}
.inv-btn-blue{background:${T.accentBg};color:${T.accent};border:1px solid ${T.accentBorder};}.inv-btn-blue:hover:not(:disabled){background:${T.accentBg20};}
.inv-btn-gold{background:${T.accent};color:${T.onAccent};}.inv-btn-gold:hover:not(:disabled){background:${T.accentHover};}
.inv-btn-out{background:transparent;color:${T.textSub};border:1px solid ${T.border};}.inv-btn-out:hover:not(:disabled){background:${T.cardHover};color:${T.text};border-color:${T.borderHover};}
.inv-btn-danger{background:${SEMANTIC.danger.bg};color:${DA};border:1px solid ${SEMANTIC.danger.border};}.inv-btn-danger:hover:not(:disabled){background:rgba(225,90,90,0.20);}
.inv-btn-sm{font-size:${FONT.xs.size+1}px;padding:${SPACING.xs+1}px ${SPACING.md-1}px;}
.inv-rm{background:none;border:none;cursor:pointer;color:${T.textMuted};font-size:18px;padding:0 ${SPACING.xs-1}px;line-height:1;transition:color .15s;}.inv-rm:hover{color:${DA};}
.inv-scen-hd{display:grid;grid-template-columns:1fr 110px 110px;padding:${SPACING.sm}px ${SPACING.lg}px;background:${T.sectionHd};font-size:${FONT.xs.size-1}px;font-weight:700;color:${T.textMuted};letter-spacing:1.2px;text-transform:uppercase;}
.inv-scen-row{display:grid;grid-template-columns:1fr 110px 110px;align-items:center;padding:${SPACING.sm-1}px ${SPACING.lg}px;border-bottom:1px solid ${T.rowBorder};gap:${SPACING.sm}px;}
.inv-scen-row:last-child{border-bottom:none;}.inv-scen-row.hl{background:${SEMANTIC.success.bg};}.inv-scen-row.warn{background:${SEMANTIC.warning.bg};}
.inv-s{font-family:'DM Mono',monospace;font-size:${FONT.sm.size+1}px;text-align:right;font-weight:500;color:${T.textSub};}
.inv-s.green{color:${SU};font-weight:700;}.inv-s.orange{color:${WA};font-weight:700;}
.inv-lot-grid{display:grid;grid-template-columns:90px 75px 75px 95px 70px 65px 70px 1fr 55px;gap:${SPACING.xs+1}px;align-items:center;padding:${SPACING.xs+1}px 0;border-bottom:1px solid ${T.rowBorder};min-width:680px;}
.inv-lot-grid.hd{font-size:${FONT.xs.size-1}px;font-weight:700;color:${T.textMuted};letter-spacing:0.8px;text-transform:uppercase;padding-bottom:${SPACING.sm}px;border-bottom:1px solid ${T.border};}
.inv-lot-grid input,.inv-lot-grid select{width:100%;}
.inv-lot-val{font-family:'DM Mono',monospace;font-size:${FONT.sm.size}px;text-align:right;color:${T.textSub};}
.inv-add-lot{display:flex;align-items:center;justify-content:center;gap:${SPACING.xs+2}px;margin-top:${SPACING.sm}px;padding:${SPACING.sm-1}px;background:${T.cardHover};border:1.5px dashed ${T.border};border-radius:${RADIUS.md}px;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-size:${FONT.sm.size+1}px;font-weight:700;color:${T.accent};width:100%;letter-spacing:0.5px;opacity:.8;transition:all .15s;}
.inv-add-lot:hover{opacity:1;border-color:${T.accent};background:${T.accentBg};}
.inv-brow{display:grid;grid-template-columns:1fr 60px 65px 75px 80px;padding:${SPACING.xs+1}px 0;border-bottom:1px solid ${T.rowBorder};align-items:center;gap:${SPACING.xs+1}px;}
.inv-brow.hd{font-size:${FONT.xs.size-1}px;font-weight:700;color:${T.textMuted};text-transform:uppercase;letter-spacing:0.8px;border-bottom:1px solid ${T.border};padding-bottom:${SPACING.sm}px;}
.inv-brow .bl{font-size:${FONT.sm.size}px;color:${T.textSub};}.inv-brow .bn{font-family:'DM Mono',monospace;font-size:${FONT.sm.size}px;text-align:right;color:${T.textSub};}
.inv-brow input{width:100%;}
.inv-bsec{background:${T.sectionHd};color:${T.accent};padding:${SPACING.xs+1}px 0;font-size:${FONT.xs.size-1}px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;margin:${SPACING.sm}px 0 ${SPACING.xs-1}px;border-bottom:1px solid ${T.border};opacity:.9;}
.inv-regime{background:${T.card};border-radius:${RADIUS.xl}px;border:1px solid ${T.border};overflow:hidden;}
.inv-regime-hd{padding:${SPACING.md-2}px ${SPACING.lg-2}px;font-size:${FONT.sm.size+1}px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;}
.inv-regime-hd.is{background:${SEMANTIC.info.bg};color:${IN};}.inv-regime-hd.ir{background:rgba(168,85,247,0.10);color:#c084fc;}.inv-regime-hd.lmnp{background:${SEMANTIC.success.bg};color:${SU};}
.inv-regime-row{display:flex;justify-content:space-between;align-items:center;padding:${SPACING.xs+2}px ${SPACING.lg-2}px;border-bottom:1px solid ${T.rowBorder};gap:${SPACING.sm}px;}
.inv-regime-row:last-child{border-bottom:none;}.inv-regime-row .rl{font-size:${FONT.xs.size+1}px;color:${T.textSub};flex:1;}
.inv-regime-row .rv{font-family:'DM Mono',monospace;font-size:${FONT.sm.size}px;font-weight:600;text-align:right;color:${T.text};}
.inv-regime-row.hl{background:${SEMANTIC.success.bg};}.inv-regime-row.warn{background:${SEMANTIC.warning.bg};}
.inv-toggle-wrap{display:flex;align-items:center;gap:${SPACING.sm+2}px;padding:${SPACING.xs+2}px 0;}
.inv-toggle{position:relative;width:38px;height:20px;}.inv-toggle input{opacity:0;width:0;height:0;}
.inv-toggle-sl{position:absolute;inset:0;background:${T.border};border-radius:20px;cursor:pointer;transition:.2s;}
.inv-toggle-sl:before{content:'';position:absolute;width:14px;height:14px;left:3px;top:3px;background:${T.textSub};border-radius:50%;transition:.2s;}
input:checked+.inv-toggle-sl{background:${T.accent};}input:checked+.inv-toggle-sl:before{transform:translateX(18px);background:white;}
.inv-photo-zone{border:2px dashed ${T.border};border-radius:${RADIUS.lg}px;background:${T.input};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${SPACING.xs+2}px;cursor:pointer;transition:all .2s;min-height:100px;position:relative;overflow:hidden;}
.inv-photo-zone:hover{border-color:${T.accent};background:${T.accentBg};}.inv-photo-zone.has-photo{border-style:solid;}
.inv-photo-zone img{width:100%;height:100%;object-fit:cover;display:block;}
.inv-photo-actions{position:absolute;top:${SPACING.xs+1}px;right:${SPACING.xs+1}px;}
.inv-scen-toggle{display:flex;gap:${SPACING.xs}px;margin-top:${SPACING.xs+1}px;}
.inv-scen-btn{flex:1;padding:${SPACING.xs}px;border-radius:${RADIUS.sm+1}px;font-family:'Barlow Condensed',sans-serif;font-size:${FONT.sm.size}px;font-weight:700;border:1px solid ${T.border};background:transparent;color:${T.textMuted};cursor:pointer;letter-spacing:0.5px;transition:all .15s;}
.inv-scen-btn:hover:not(.active){border-color:${T.borderHover};color:${T.textSub};}
.inv-scen-btn.active{background:${T.accent};color:${T.onAccent};border-color:${T.accent};}
.inv-badge{display:inline-block;padding:${SPACING.xs-2}px ${SPACING.sm+1}px;border-radius:${RADIUS.pill}px;font-size:${FONT.xs.size-1}px;font-weight:700;letter-spacing:0.5px;}
@media(max-width:767px){
  .inv{flex-direction:column!important;overflow:hidden}
  .inv-card-bd{padding:${SPACING.sm+2}px ${SPACING.md}px!important}
  .inv-kpi{padding:${SPACING.sm+2}px ${SPACING.md}px!important}
  .inv-kpi-val{font-size:${FONT.xl.size}px!important}
  .inv-scen-hd,.inv-scen-row{grid-template-columns:1fr 80px 80px!important;font-size:${FONT.xs.size}px!important}
  .inv-lot-grid{min-width:680px!important}
  .inv-tab-nav{overflow-x:auto;-webkit-overflow-scrolling:touch;padding:0 ${SPACING.sm}px!important}
  .inv-tab-nav::-webkit-scrollbar{display:none}
  .inv-tab-btn{padding:${SPACING.sm}px ${SPACING.md}px!important;font-size:${FONT.xs.size}px!important;flex:0 0 auto}
  .inv-grid-2{grid-template-columns:1fr!important;}
  .inv-kpi-bar{grid-template-columns:1fr 1fr!important;}
  .inv-fisca-grid{grid-template-columns:1fr!important;}
}
`;
const CSS=getCSS(THEMES_INV.dark);

function NumInput({value,onChange,style,min,step}){
  return <input type="number" className="inv-inp" value={value} min={min||0} step={step||1} onChange={e=>{onChange(parseFloat(e.target.value)||0);}} style={{width:120,...style}}/>;
}

// ─── LISTE DES PROJETS ────────────────────────────────────────────────────────
function ListeProjets({profil,onOuvrir,onNouveauProjet,inline,T=THEMES_INV.dark}){
  const [projets,setProjets]=useState([]);
  const [clients,setClients]=useState([]);
  const [loading,setLoading]=useState(true);
  const [suppId,setSuppId]=useState(null);
  const [filtreClient,setFiltreClient]=useState("");
  const charger=async()=>{
    setLoading(true);
    let res=await supabase.from("invest_projets").select("id,nom,created_by,created_at,updated_at,donnees,client_id").order("updated_at",{ascending:false});
    if(res.error?.code==="42703")res=await supabase.from("invest_projets").select("id,nom,created_by,created_at,updated_at,donnees").order("updated_at",{ascending:false});
    setProjets(res.data||[]);
    const{data:cs}=await supabase.from("invest_clients").select("id,nom,prenom").order("nom");
    setClients(cs||[]);setLoading(false);
  };
  useEffect(()=>{charger();},[]);
  const clientById=Object.fromEntries(clients.map(c=>[c.id,c]));
  const projetsFiltres=filtreClient?projets.filter(p=>p.client_id===filtreClient):projets;
  const supprimer=async(id)=>{await supabase.from("invest_projets").delete().eq("id",id);setSuppId(null);charger();};
  const fmtDate=(iso)=>iso?new Date(iso).toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"}):"—";
  const kpi=(d)=>{
    if(!d?.inputs)return null;
    const pN=d.inputs.prixNegocie||0,fn=pN*(d.inputs.tauxNotaire||0.08);
    const total=pN+fn+(d.inputs.honoraires||0)+(d.inputs.enedis||0);
    const lots=(d.lots||[]).filter(l=>l.type!=="Sélectionner");
    return{total,loyer:lots.reduce((s,l)=>s+l.loyer,0),nbLots:lots.length};
  };
  const renderCard=(p)=>{
    const k=kpi(p.donnees);const client=p.client_id?clientById[p.client_id]:null;
    return(
      <div key={p.id} className="inv-card" style={{padding:`${SPACING.lg+2}px ${SPACING.lg+4}px`,cursor:"pointer",transition:"all .18s"}} onClick={()=>onOuvrir(p)}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:SPACING.sm,marginBottom:SPACING.md-2}}>
          <div style={{flex:1,minWidth:0,display:"flex",alignItems:"flex-start",gap:SPACING.sm}}>
            <div style={{width:36,height:36,borderRadius:RADIUS.lg,flexShrink:0,background:T.accentBg,color:T.accent,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon as={FileText} size={18} strokeWidth={2}/></div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:FONT.md.size,fontWeight:700,color:T.text,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",letterSpacing:-0.2}}>{p.nom}</div>
              <div style={{fontSize:FONT.xs.size,color:T.textMuted}}>Par {p.created_by} · {fmtDate(p.updated_at)}</div>
              {client&&<div style={{fontSize:FONT.xs.size,color:T.accent,marginTop:5,display:"inline-flex",alignItems:"center",gap:4,fontWeight:600}}><Icon as={Users} size={11} strokeWidth={2.2}/>{client.prenom} {client.nom}</div>}
            </div>
          </div>
          <button onClick={e=>{e.stopPropagation();setSuppId(p.id);}} style={{background:"transparent",border:"none",cursor:"pointer",color:T.textMuted,padding:SPACING.xs,borderRadius:RADIUS.md,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s"}} onMouseEnter={e=>{e.currentTarget.style.background=SEMANTIC.danger.bg;e.currentTarget.style.color=DA;}} onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color=T.textMuted;}}><Icon as={X} size={16} strokeWidth={2.2}/></button>
        </div>
        {k&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:SPACING.xs+2,marginBottom:SPACING.md-2}}>
          {[{label:"Coût total",val:k.total>0?fmt(k.total):"—",color:T.accent,icon:Wallet},{label:"Loyers/mois",val:k.loyer>0?fmt(k.loyer):"—",color:SU,icon:TrendingUp},{label:"Lots",val:k.nbLots,color:WA,icon:Home}].map(item=>(
            <div key={item.label} style={{background:T.cardHover,borderRadius:RADIUS.md,padding:`${SPACING.xs+2}px ${SPACING.sm+1}px`,borderLeft:`3px solid ${item.color}`}}>
              <div style={{fontSize:FONT.xs.size-1,color:T.textMuted,textTransform:"uppercase",letterSpacing:0.5,marginBottom:2,display:"inline-flex",alignItems:"center",gap:4}}><Icon as={item.icon} size={9} strokeWidth={2}/> {item.label}</div>
              <div style={{fontSize:FONT.sm.size+1,fontWeight:800,color:item.color,fontFamily:"'DM Mono',monospace"}}>{item.val}</div>
            </div>
          ))}
        </div>}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:FONT.xs.size-1,background:T.cardHover,color:T.textSub,padding:`${SPACING.xs-2}px ${SPACING.sm}px`,borderRadius:RADIUS.pill,fontWeight:600}}>{fmtDate(p.created_at)}</span>
          <span style={{fontSize:FONT.sm.size,color:T.accent,fontWeight:700,display:"inline-flex",alignItems:"center",gap:4}}>Ouvrir <Icon as={ChevronRight} size={12} strokeWidth={2.5}/></span>
        </div>
      </div>
    );
  };
  const modalSuppr=()=>(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,backdropFilter:"blur(4px)"}}>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:RADIUS.xl,padding:`${SPACING.xl+2}px ${SPACING.xl+6}px`,maxWidth:380,width:"90%",textAlign:"center",boxShadow:T.shadowMd}}>
        <div style={{width:56,height:56,borderRadius:"50%",margin:`0 auto ${SPACING.md}px`,background:SEMANTIC.danger.bg,border:`2px solid ${SEMANTIC.danger.border}`,display:"flex",alignItems:"center",justifyContent:"center",color:DA}}><Icon as={Trash2} size={26} strokeWidth={2}/></div>
        <div style={{fontSize:FONT.md.size+1,fontWeight:800,color:T.text,marginBottom:6}}>Supprimer ce projet ?</div>
        <div style={{fontSize:FONT.sm.size+1,color:T.textSub,marginBottom:SPACING.xl-2,lineHeight:1.55}}>Cette action est <strong>irréversible</strong>.</div>
        <div style={{display:"flex",gap:SPACING.sm+2,justifyContent:"center"}}>
          <button className="inv-btn inv-btn-out" onClick={()=>setSuppId(null)}>Annuler</button>
          <button className="inv-btn inv-btn-danger" onClick={()=>supprimer(suppId)}><Icon as={Trash2} size={13} strokeWidth={2.2}/> Supprimer</button>
        </div>
      </div>
    </div>
  );
  const emptyState=(label,sub)=>(
    <div style={{textAlign:"center",padding:`${SPACING.xxl}px ${SPACING.lg}px`}}>
      <div style={{width:64,height:64,borderRadius:RADIUS.xl,margin:`0 auto ${SPACING.md}px`,background:T.accentBg,color:T.accent,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon as={Building2} size={32} strokeWidth={1.5}/></div>
      <div style={{fontSize:FONT.md.size+1,fontWeight:700,color:T.text,marginBottom:6}}>{label}</div>
      {sub&&<div style={{fontSize:FONT.sm.size+1,color:T.textSub,marginBottom:SPACING.lg+2}}>{sub}</div>}
      <button className="inv-btn inv-btn-gold" onClick={onNouveauProjet}><Icon as={Plus} size={13} strokeWidth={2.2}/> Créer un projet</button>
    </div>
  );
  if(inline)return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:SPACING.lg+2,flexWrap:"wrap",gap:SPACING.sm+2}}>
        <div style={{fontSize:FONT.sm.size+1,color:T.textMuted}}>{projets.length} projet{projets.length!==1?"s":""} — partagés avec tous les associés</div>
        <button className="inv-btn inv-btn-gold" onClick={onNouveauProjet}><Icon as={Plus} size={13} strokeWidth={2.2}/> Nouveau projet</button>
      </div>
      {loading?<div style={{textAlign:"center",padding:`${SPACING.xl+8}px 0`,color:T.textMuted,display:"inline-flex",alignItems:"center",justifyContent:"center",width:"100%",gap:8}}><Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>Chargement…</div>:projets.length===0?emptyState("Aucun projet pour l'instant",null):<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:SPACING.md+2}}>{projetsFiltres.map(p=>renderCard(p))}</div>}
      {suppId&&modalSuppr()}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
  return(
    <div className="inv" style={{position:"fixed",inset:0,zIndex:9999,overflowY:"auto"}}>
      <style>{CSS}</style>
      <div style={{background:T.sidebar,padding:`${SPACING.md+2}px ${SPACING.xl}px`,display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:10,borderBottom:`1px solid ${T.sidebarBorder}`,boxShadow:T.shadowSm}}>
        <div style={{display:"flex",alignItems:"center",gap:SPACING.md}}>
          <span style={{fontSize:FONT.xs.size,letterSpacing:2,textTransform:"uppercase",color:T.accent,fontWeight:700}}>Profero</span>
          <span style={{fontSize:FONT.xl.size+2,fontWeight:800,color:T.text,letterSpacing:-0.3}}>Invest</span>
          <div style={{width:1,height:20,background:T.border}}/>
          <span style={{fontSize:FONT.sm.size+1,color:T.textSub}}>Portefeuille de projets</span>
        </div>
        <button className="inv-btn inv-btn-gold" onClick={onNouveauProjet}><Icon as={Plus} size={13} strokeWidth={2.2}/> Nouveau projet</button>
      </div>
      <div style={{maxWidth:1100,margin:"0 auto",padding:"28px 24px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:22,flexWrap:"wrap",gap:12}}>
          <div>
            <div style={{fontSize:20,fontWeight:800,color:"#e8eaf0",letterSpacing:.3}}>Tous les projets</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.35)",marginTop:2}}>{projetsFiltres.length} projet{projetsFiltres.length!==1?"s":""} — partagés avec tous les associés</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <select className="inv-sel" value={filtreClient} onChange={e=>setFiltreClient(e.target.value)} style={{minWidth:200}}>
              <option value="">👥 Tous les clients</option>
              {clients.map(c=><option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>)}
            </select>
            <button className="inv-btn inv-btn-out inv-btn-sm" onClick={charger}>↻ Actualiser</button>
          </div>
        </div>
        {loading?<div style={{textAlign:"center",padding:`${SPACING.xxxl}px 0`,color:T.textMuted,display:"flex",justifyContent:"center",alignItems:"center",gap:8}}><Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>Chargement…</div>:projets.length===0?emptyState("Aucun projet pour l'instant","Créez votre premier projet d'investissement"):<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:SPACING.md+2}}>{projetsFiltres.map(p=>renderCard(p))}</div>}
      </div>
      {suppId&&modalSuppr()}
    </div>
  );
}

// ─── SIMULATEUR ───────────────────────────────────────────────────────────────
// IMPORTANT : Ce composant est identique à votre version originale.
// Copiez-collez ici votre fonction Simulateur complète depuis l'original.
// Elle commence par : function Simulateur({ projet, profil, onRetour, theme="dark", setTheme }) {
// Elle se termine juste avant le commentaire TableauBord.

// ══════════════════════════════════════════════════════════════════════════════
// ─── TABLEAU DE BORD (MODIFIÉ) ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
function TableauBord({profil,T=THEMES_INV.dark}){
  const [stats,setStats]=useState(null);
  const [loading,setLoading]=useState(true);
  const [actionsUrg,setActionsUrg]=useState([]);
  const [planning,setPlanning]=useState([]);
  const [modal,setModal]=useState(null);
  const [newEvent,setNewEvent]=useState({titre:"",date:new Date().toISOString().slice(0,10),type:"Visite",notes:""});
  const [savingEv,setSavingEv]=useState(false);
  const todayStr=new Date().toISOString().slice(0,10);
  const weekEnd=new Date();weekEnd.setDate(weekEnd.getDate()+7);
  const weekEndStr=weekEnd.toISOString().slice(0,10);
  const charger=async()=>{
    setLoading(true);
    const [{data:clients},{data:biens},{data:props}]=await Promise.all([
      supabase.from("invest_clients").select("*").order("date_prochaine_action"),
      supabase.from("invest_biens").select("*").order("created_at",{ascending:false}),
      supabase.from("invest_propositions").select("client_id,bien_id,created_at"),
    ]);
    let manualEvs=[];
    const evR=await supabase.from("invest_events").select("*").gte("date",todayStr).lte("date",weekEndStr).order("date");
    if(!evR.error)manualEvs=evR.data||[];
    const c=clients||[],b=biens||[],p=props||[];
    setActionsUrg(c.filter(x=>x.date_prochaine_action&&x.date_prochaine_action<=weekEndStr).sort((a,bb)=>a.date_prochaine_action.localeCompare(bb.date_prochaine_action)));
    const visitesWeek=b.filter(x=>x.date_visite&&x.date_visite>=todayStr&&x.date_visite<=weekEndStr).map(x=>({id:`bien-${x.id}`,titre:`Visite — ${x.adresse||x.ville||"Bien"}`,date:x.date_visite,type:"Visite",source:"bien"}));
    setPlanning([...visitesWeek,...manualEvs.map(e=>({...e,source:"manual"}))].sort((a,bb)=>a.date.localeCompare(bb.date)));
    setStats({
      prospects:c.filter(x=>x.statut==="Prospect").length,actifs:c.filter(x=>x.statut==="Actif").length,
      inactifs:c.filter(x=>x.statut==="Inactif").length,termines:c.filter(x=>x.statut==="Terminé").length,
      totalSignes:c.filter(x=>x.date_signature).length,
      sommeBudgets:c.filter(x=>x.date_signature).reduce((s,x)=>s+(x.budget||0),0),
      biensTotaux:b.length,biensARelancer:b.filter(x=>x.date_relance&&x.date_relance<=todayStr).length,
      visitesProg:b.filter(x=>x.statut==="Visite programmée").length,
      offreEnvoyees:b.filter(x=>x.statut==="Offre envoyée").length,
      offresAcceptees:b.filter(x=>x.statut==="Offre acceptée").length,
      sansProchaineAction:c.filter(x=>!x.prochaine_action).length,
      nbPropositions:p.length,_c:c,_b:b,
    });
    setLoading(false);
  };
  useEffect(()=>{charger();},[]);
  const ajouterEvent=async()=>{
    if(!newEvent.titre.trim()||!newEvent.date)return;
    setSavingEv(true);
    await supabase.from("invest_events").insert({titre:newEvent.titre.trim(),date:newEvent.date,type:newEvent.type,notes:newEvent.notes||null,created_by:profil?.nom||profil?.email||"—"});
    setSavingEv(false);setNewEvent({titre:"",date:new Date().toISOString().slice(0,10),type:"Visite",notes:""});charger();
  };
  const supprimerEvent=async(id)=>{await supabase.from("invest_events").delete().eq("id",id);charger();};
  const fmtN=v=>new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(v);
  const fmtD=d=>d?new Date(d+"T00:00:00").toLocaleDateString("fr-FR",{weekday:"short",day:"2-digit",month:"short"}):"—";
  const SC={Prospect:"#4db8ff",Actif:SU,Inactif:WA,Terminé:"rgba(255,255,255,0.3)"};
  const KPI=({label,value,color,icon:IC,onClick,disabled})=>{
    const c=color||"#FFC200";
    return(
      <div className="inv-kpi" onClick={!disabled&&onClick?onClick:undefined} style={{display:"flex",flexDirection:"row",alignItems:"center",gap:SPACING.md,borderLeft:`3px solid ${c}`,cursor:!disabled&&onClick?"pointer":"default",transition:"all .15s"}} onMouseEnter={e=>{if(!disabled&&onClick)e.currentTarget.style.boxShadow=T.shadowMd;}} onMouseLeave={e=>{e.currentTarget.style.boxShadow="none";}}>
        {IC&&<div style={{width:38,height:38,borderRadius:RADIUS.md,flexShrink:0,background:`${c}18`,color:c,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon as={IC} size={19} strokeWidth={2}/></div>}
        <div style={{minWidth:0,flex:1}}>
          <div className="inv-kpi-lbl">{label}</div>
          <div className="inv-kpi-val" style={{color:c,fontSize:FONT.xl.size+2}}>{value}</div>
        </div>
        {!disabled&&onClick&&<Icon as={ChevronRight} size={14} color={T.textMuted}/>}
      </div>
    );
  };
  const Modal=()=>{
    if(!modal)return null;
    const{title,items,itemType}=modal;
    return(
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.65)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,backdropFilter:"blur(4px)"}} onClick={()=>setModal(null)}>
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:RADIUS.xl,padding:`${SPACING.xl}px`,maxWidth:700,width:"93%",maxHeight:"82vh",overflowY:"auto",boxShadow:T.shadowMd}} onClick={e=>e.stopPropagation()}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:SPACING.lg}}>
            <div style={{fontSize:FONT.h2.size,fontWeight:800,color:T.text}}>{title} <span style={{color:T.textMuted,fontWeight:400}}>({items.length})</span></div>
            <button onClick={()=>setModal(null)} style={{background:"none",border:"none",cursor:"pointer",color:T.textMuted,fontSize:22,lineHeight:1}}>×</button>
          </div>
          {items.length===0?<div style={{textAlign:"center",padding:`${SPACING.xxl}px 0`,color:T.textMuted,fontStyle:"italic"}}>Aucun élément</div>:(
            <div style={{display:"flex",flexDirection:"column",gap:SPACING.sm-2}}>
              {items.map(item=>(
                <div key={item.id} style={{padding:`${SPACING.md}px ${SPACING.lg-2}px`,background:T.cardHover,borderRadius:RADIUS.md,border:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:SPACING.md}}>
                  {itemType==="client"?(<>
                    <div style={{width:34,height:34,borderRadius:"50%",flexShrink:0,background:`${SC[item.statut]||T.accent}18`,color:SC[item.statut]||T.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:FONT.sm.size+1,fontWeight:800}}>{`${item.prenom?.[0]||""}${item.nom?.[0]||""}`.toUpperCase()}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,color:T.text}}>{item.prenom} {item.nom}</div>
                      <div style={{fontSize:FONT.xs.size+1,color:T.textMuted}}>{item.email||item.telephone||"—"}</div>
                      {item.etape&&<div style={{fontSize:FONT.xs.size,color:T.accent,marginTop:2}}>{item.etape}</div>}
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      {item.budget>0&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:FONT.sm.size,fontWeight:700,color:T.accent}}>{fmtN(item.budget)} €</div>}
                      {item.date_prochaine_action&&<div style={{fontSize:FONT.xs.size,color:item.date_prochaine_action<todayStr?DA:T.textMuted,marginTop:2}}>{item.date_prochaine_action<todayStr?"⚠ ":""}{new Date(item.date_prochaine_action+"T00:00:00").toLocaleDateString("fr-FR")}</div>}
                    </div>
                  </>):(<>
                    <div style={{width:34,height:34,borderRadius:RADIUS.md,flexShrink:0,background:`${STATUT_BIEN_COLORS[item.statut]||T.textMuted}18`,color:STATUT_BIEN_COLORS[item.statut]||T.textMuted,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon as={Home} size={17} strokeWidth={2}/></div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.adresse||"Sans adresse"}</div>
                      <div style={{fontSize:FONT.xs.size+1,color:T.textMuted}}>{item.ville||"—"}</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      {item.cout_total>0&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:FONT.sm.size,color:T.accent,fontWeight:700}}>{fmtN(item.cout_total)} €</div>}
                      {item.date_relance&&<div style={{fontSize:FONT.xs.size,color:item.date_relance<todayStr?DA:T.textMuted,marginTop:2}}>Relance : {new Date(item.date_relance+"T00:00:00").toLocaleDateString("fr-FR")}</div>}
                    </div>
                  </>)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };
  const SecT=({icon:IC,label})=><div style={{fontSize:FONT.xs.size,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:1.8,marginBottom:SPACING.md,display:"flex",alignItems:"center",gap:SPACING.sm-2}}><Icon as={IC} size={13} strokeWidth={2}/> {label}</div>;
  return(
    <div style={{padding:`${SPACING.xl}px ${SPACING.xl+4}px`,maxWidth:1200,margin:"0 auto"}}>
      <div style={{marginBottom:SPACING.xl,display:"flex",alignItems:"center",gap:SPACING.md}}>
        <div style={{width:48,height:48,borderRadius:RADIUS.lg,background:T.accentBg,color:T.accent,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icon as={LayoutDashboard} size={24} strokeWidth={2}/></div>
        <div>
          <div style={{fontSize:FONT.h2.size,fontWeight:800,color:T.text,letterSpacing:-0.3}}>Tableau de bord</div>
          <div style={{fontSize:FONT.sm.size+1,color:T.textSub,marginTop:2}}>Vue globale · cliquez sur une case pour voir le détail</div>
        </div>
      </div>
      {loading?<div style={{textAlign:"center",padding:`${SPACING.xxxl}px 0`,color:T.textMuted,display:"flex",justifyContent:"center",alignItems:"center",gap:8}}><Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>Chargement…</div>:stats&&(<>
        <SecT icon={Users} label="Clients & Prospects"/>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:SPACING.md,marginBottom:SPACING.xxl-2}}>
          <KPI icon={Users} label="Prospects" value={stats.prospects} color="#4db8ff" onClick={()=>setModal({title:"Prospects",items:stats._c.filter(x=>x.statut==="Prospect"),itemType:"client"})}/>
          <KPI icon={Check} label="Clients actifs" value={stats.actifs} color={SU} onClick={()=>setModal({title:"Clients actifs",items:stats._c.filter(x=>x.statut==="Actif"),itemType:"client"})}/>
          <KPI icon={Bell} label="Clients inactifs" value={stats.inactifs} color={WA} onClick={()=>setModal({title:"Clients inactifs",items:stats._c.filter(x=>x.statut==="Inactif"),itemType:"client"})}/>
          <KPI icon={Lock} label="Terminés" value={stats.termines} color={T.textMuted} onClick={()=>setModal({title:"Terminés",items:stats._c.filter(x=>x.statut==="Terminé"),itemType:"client"})}/>
          <KPI icon={Handshake} label="Total signés" value={stats.totalSignes} color={SU} onClick={()=>setModal({title:"Dossiers signés",items:stats._c.filter(x=>x.date_signature),itemType:"client"})}/>
          <KPI icon={Wallet} label="Budget total signé" value={stats.sommeBudgets>0?fmtN(stats.sommeBudgets)+" €":"—"} color="#FFC200" disabled/>
          <KPI icon={AlertTriangle} label="Sans prochaine action" value={stats.sansProchaineAction} color={DA} onClick={()=>setModal({title:"Sans prochaine action",items:stats._c.filter(x=>!x.prochaine_action),itemType:"client"})}/>
        </div>
        <SecT icon={Building2} label="Stock de Biens"/>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:SPACING.md,marginBottom:SPACING.xxl-2}}>
          <KPI icon={Home} label="Biens en stock" value={stats.biensTotaux} color="#4db8ff" disabled/>
          <KPI icon={Bell} label="À relancer" value={stats.biensARelancer} color={DA} onClick={()=>setModal({title:"Biens à relancer",items:stats._b.filter(x=>x.date_relance&&x.date_relance<=todayStr),itemType:"bien"})}/>
          <KPI icon={Calendar} label="Visites programmées" value={stats.visitesProg} color={SU} onClick={()=>setModal({title:"Visites programmées",items:stats._b.filter(x=>x.statut==="Visite programmée"),itemType:"bien"})}/>
          <KPI icon={Send} label="Offres envoyées" value={stats.offreEnvoyees} color="#FFC200" onClick={()=>setModal({title:"Offres envoyées",items:stats._b.filter(x=>x.statut==="Offre envoyée"),itemType:"bien"})}/>
          <KPI icon={Check} label="Offres acceptées" value={stats.offresAcceptees} color={SU} onClick={()=>setModal({title:"Offres acceptées",items:stats._b.filter(x=>x.statut==="Offre acceptée"),itemType:"bien"})}/>
          <KPI icon={Hammer} label="Propositions totales" value={stats.nbPropositions} color="#c084fc" disabled/>
        </div>
        <SecT icon={AlertTriangle} label="Actions & Planning de la semaine"/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:SPACING.lg}}>
          <div className="inv-card">
            <div className="inv-card-hd danger" style={{justifyContent:"space-between"}}>
              <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={AlertTriangle} size={13} strokeWidth={2.2}/>Actions en retard / à venir (7 j)</span>
              <span style={{background:"rgba(255,255,255,.18)",color:"white",borderRadius:RADIUS.pill,padding:"1px 9px",fontSize:FONT.xs.size-1,fontWeight:700}}>{actionsUrg.length}</span>
            </div>
            <div className="inv-card-bd" style={{maxHeight:380,overflowY:"auto",padding:`${SPACING.sm+2}px ${SPACING.lg}px`}}>
              {actionsUrg.length===0?<div style={{textAlign:"center",padding:`${SPACING.xl}px 0`,color:T.textMuted,fontStyle:"italic"}}>✅ Aucune action urgente cette semaine</div>:actionsUrg.map(c=>{
                const enRetard=c.date_prochaine_action<todayStr,auj=c.date_prochaine_action===todayStr;
                return(<div key={c.id} style={{display:"flex",alignItems:"flex-start",gap:SPACING.sm+2,padding:`${SPACING.md-2}px 0`,borderBottom:`1px solid ${T.rowBorder}`}}>
                  <div style={{width:8,height:8,borderRadius:"50%",flexShrink:0,marginTop:6,background:enRetard?DA:auj?WA:SU}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:FONT.sm.size+1,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.prenom} {c.nom}</div>
                    <div style={{fontSize:FONT.sm.size,color:T.textSub,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.prochaine_action||"Action non précisée"}</div>
                  </div>
                  <div style={{fontSize:FONT.xs.size+1,fontWeight:700,color:enRetard?DA:auj?WA:T.textMuted,whiteSpace:"nowrap",flexShrink:0}}>{enRetard?"⚠ ":auj?"→ ":""}{fmtD(c.date_prochaine_action)}</div>
                </div>);
              })}
            </div>
          </div>
          <div className="inv-card">
            <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Calendar} size={13} strokeWidth={2.2}/>Planning de la semaine</span></div>
            <div className="inv-card-bd">
              <div style={{background:T.cardHover,borderRadius:RADIUS.md,padding:`${SPACING.md-2}px ${SPACING.md}px`,marginBottom:SPACING.md,border:`1px solid ${T.border}`}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:SPACING.sm,marginBottom:SPACING.sm}}>
                  <input className="inv-inp" placeholder="Titre de l'événement…" value={newEvent.titre} onChange={e=>setNewEvent({...newEvent,titre:e.target.value})} onKeyDown={e=>e.key==="Enter"&&ajouterEvent()} style={{textAlign:"left",fontSize:FONT.sm.size,padding:"5px 9px"}}/>
                  <input className="inv-inp" type="date" value={newEvent.date} onChange={e=>setNewEvent({...newEvent,date:e.target.value})} style={{fontSize:FONT.sm.size,padding:"5px 9px"}}/>
                </div>
                <div style={{display:"flex",gap:SPACING.sm}}>
                  <select className="inv-sel" value={newEvent.type} onChange={e=>setNewEvent({...newEvent,type:e.target.value})} style={{flex:1,fontSize:FONT.sm.size,padding:"5px 9px"}}>{EVENT_TYPES.map(t=><option key={t}>{t}</option>)}</select>
                  <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={ajouterEvent} disabled={savingEv||!newEvent.titre.trim()}><Icon as={Plus} size={12} strokeWidth={2.2}/> Ajouter</button>
                </div>
              </div>
              <div style={{maxHeight:280,overflowY:"auto"}}>
                {planning.length===0?<div style={{textAlign:"center",padding:`${SPACING.lg}px 0`,color:T.textMuted,fontStyle:"italic"}}>Aucun événement cette semaine</div>:planning.map((ev,i)=>{
                  const col=EVENT_COLORS[ev.type]||T.textMuted;
                  return(<div key={ev.id||i} style={{display:"flex",alignItems:"center",gap:SPACING.sm+2,padding:`${SPACING.sm}px 0`,borderBottom:`1px solid ${T.rowBorder}`}}>
                    <div style={{width:30,height:30,borderRadius:RADIUS.sm+1,flexShrink:0,background:`${col}18`,color:col,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>{EVENT_ICONS[ev.type]||"📌"}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:600,fontSize:FONT.sm.size+1,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ev.titre}</div>
                      <div style={{fontSize:FONT.xs.size+1,color:col,fontWeight:700}}>{ev.type}</div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:SPACING.sm,flexShrink:0}}>
                      <span style={{fontSize:FONT.xs.size+1,color:T.textMuted}}>{fmtD(ev.date)}</span>
                      {ev.source==="manual"&&<button onClick={()=>supprimerEvent(ev.id)} style={{background:"none",border:"none",cursor:"pointer",color:T.textMuted,fontSize:16,lineHeight:1,padding:"0 2px",transition:"color .12s"}} onMouseEnter={e=>e.currentTarget.style.color=DA} onMouseLeave={e=>e.currentTarget.style.color=T.textMuted} title="Supprimer">×</button>}
                    </div>
                  </div>);
                })}
              </div>
            </div>
          </div>
        </div>
      </>)}
      {modal&&<Modal/>}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ─── CRM (MODIFIÉ) ────────────────────────────────────────────────────────────
function CRM({profil,T=THEMES_INV.dark,onOuvrirSimulation}){
  const [clients,setClients]=useState([]);
  const [loading,setLoading]=useState(true);
  const [ficheId,setFicheId]=useState(null);
  const [showForm,setShowForm]=useState(false);
  const [showFiltres,setShowFiltres]=useState(false);
  const [search,setSearch]=useState("");
  const [filtreStatut,setFiltreStatut]=useState("");
  const [filtreConseiller,setFiltreConseiller]=useState("");
  const [filtreSource,setFiltreSource]=useState("");
  const [filtreEtape,setFiltreEtape]=useState("");
  const [filtreBudgetMin,setFiltreBudgetMin]=useState("");
  const [filtreBudgetMax,setFiltreBudgetMax]=useState("");
  const [filtreAvant,setFiltreAvant]=useState("");
  const [sortCol,setSortCol]=useState("created_at");
  const [sortDir,setSortDir]=useState("desc");
  const charger=async()=>{setLoading(true);const{data}=await supabase.from("invest_clients").select("*").order("created_at",{ascending:false});setClients(data||[]);setLoading(false);};
  useEffect(()=>{charger();},[]);
  const conseillers=[...new Set(clients.map(c=>c.conseiller).filter(Boolean))];
  const hasFilters=filtreStatut||filtreConseiller||filtreSource||filtreEtape||filtreBudgetMin||filtreBudgetMax||filtreAvant;
  const toggleSort=(col)=>{if(sortCol===col)setSortDir(d=>d==="asc"?"desc":"asc");else{setSortCol(col);setSortDir("asc");}};
  const SI=({col})=>{if(sortCol!==col)return<Icon as={ChevronDown} size={10} color="rgba(255,255,255,.3)"/>;return sortDir==="asc"?<Icon as={ChevronUp} size={11} color="white"/>:<Icon as={ChevronDown} size={11} color="white"/>;};
  let filtered=clients.filter(c=>{
    if(filtreStatut&&c.statut!==filtreStatut)return false;
    if(filtreConseiller&&c.conseiller!==filtreConseiller)return false;
    if(filtreSource&&c.source!==filtreSource)return false;
    if(filtreEtape&&c.etape!==filtreEtape)return false;
    if(filtreBudgetMin&&(c.budget||0)<parseFloat(filtreBudgetMin))return false;
    if(filtreBudgetMax&&(c.budget||0)>parseFloat(filtreBudgetMax))return false;
    if(filtreAvant&&c.date_avant_contact!==filtreAvant)return false;
    if(search&&!`${c.nom} ${c.prenom} ${c.email||""} ${c.telephone||""}`.toLowerCase().includes(search.toLowerCase()))return false;
    return true;
  });
  filtered=[...filtered].sort((a,b)=>{let va=a[sortCol]??"",vb=b[sortCol]??"";if(typeof va==="number")return sortDir==="asc"?va-vb:vb-va;return sortDir==="asc"?String(va).localeCompare(String(vb)):String(vb).localeCompare(String(va));});
  const STATUT_COLORS={Prospect:"#4db8ff",Actif:SU,Inactif:WA,Terminé:"rgba(255,255,255,0.3)"};
  const fmtDate=d=>d?new Date(d+"T00:00:00").toLocaleDateString("fr-FR",{day:"2-digit",month:"short"}):"—";
  const fmtBudget=v=>v>0?new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(v)+" €":"—";
  const ColHd=({label,col})=><div onClick={()=>toggleSort(col)} style={{display:"inline-flex",alignItems:"center",gap:4,cursor:"pointer",userSelect:"none"}}>{label} <SI col={col}/></div>;
  if(ficheId)return<FicheClient id={ficheId} profil={profil} T={T} onRetour={()=>{setFicheId(null);charger();}} onOuvrirSimulation={onOuvrirSimulation}/>;
  return(
    <div style={{padding:`${SPACING.xl}px ${SPACING.xl+4}px`,maxWidth:1400,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:SPACING.xl-4,flexWrap:"wrap",gap:SPACING.sm+2}}>
        <div style={{display:"flex",alignItems:"center",gap:SPACING.md}}>
          <div style={{width:44,height:44,borderRadius:RADIUS.lg,background:T.accentBg,color:T.accent,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icon as={Users} size={22} strokeWidth={2}/></div>
          <div>
            <div style={{fontSize:FONT.h2.size,fontWeight:800,color:T.text,letterSpacing:-0.3}}>CRM Clients / Prospects</div>
            <div style={{fontSize:FONT.sm.size+1,color:T.textSub,marginTop:2}}>{filtered.length} contact{filtered.length!==1?"s":""}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:SPACING.sm}}>
          <button className={`inv-btn inv-btn-sm ${hasFilters?"inv-btn-accent":"inv-btn-out"}`} onClick={()=>setShowFiltres(f=>!f)}><Icon as={Filter} size={12} strokeWidth={2.2}/>Filtres{hasFilters?" (actifs)":""}{showFiltres?<Icon as={ChevronUp} size={12}/>:<Icon as={ChevronDown} size={12}/>}</button>
          <button className="inv-btn inv-btn-gold" onClick={()=>setShowForm(true)}><Icon as={Plus} size={13} strokeWidth={2.2}/> Nouveau contact</button>
        </div>
      </div>
      <div style={{marginBottom:SPACING.md}}>
        <div style={{position:"relative",width:280,marginBottom:showFiltres?SPACING.sm+2:0}}>
          <Icon as={Search} size={13} color={T.textMuted} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}/>
          <input className="inv-inp" placeholder="Rechercher…" value={search} onChange={e=>setSearch(e.target.value)} style={{width:"100%",textAlign:"left",paddingLeft:30,fontSize:FONT.sm.size+1}}/>
        </div>
        {showFiltres&&<div style={{background:T.cardHover,borderRadius:RADIUS.lg,padding:`${SPACING.md}px ${SPACING.lg}px`,border:`1px solid ${T.border}`,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:SPACING.sm+2,marginTop:SPACING.sm+2}}>
          <div><div style={{fontSize:FONT.xs.size-1,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>Statut</div><select className="inv-sel" value={filtreStatut} onChange={e=>setFiltreStatut(e.target.value)} style={{width:"100%"}}><option value="">Tous</option>{STATUTS_CLIENT.map(s=><option key={s}>{s}</option>)}</select></div>
          <div><div style={{fontSize:FONT.xs.size-1,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>Conseiller</div><select className="inv-sel" value={filtreConseiller} onChange={e=>setFiltreConseiller(e.target.value)} style={{width:"100%"}}><option value="">Tous</option>{conseillers.map(c=><option key={c}>{c}</option>)}</select></div>
          <div><div style={{fontSize:FONT.xs.size-1,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>Source</div><select className="inv-sel" value={filtreSource} onChange={e=>setFiltreSource(e.target.value)} style={{width:"100%"}}><option value="">Toutes</option>{SOURCES_CLIENT.map(s=><option key={s}>{s}</option>)}</select></div>
          <div><div style={{fontSize:FONT.xs.size-1,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>Étape</div><select className="inv-sel" value={filtreEtape} onChange={e=>setFiltreEtape(e.target.value)} style={{width:"100%"}}><option value="">Toutes</option>{ETAPES_CLIENT.filter(Boolean).map(e=><option key={e} value={e}>{e}</option>)}</select></div>
          <div><div style={{fontSize:FONT.xs.size-1,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>Budget min (€)</div><input className="inv-inp" type="number" placeholder="0" value={filtreBudgetMin} onChange={e=>setFiltreBudgetMin(e.target.value)} style={{width:"100%"}}/></div>
          <div><div style={{fontSize:FONT.xs.size-1,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>Budget max (€)</div><input className="inv-inp" type="number" placeholder="∞" value={filtreBudgetMax} onChange={e=>setFiltreBudgetMax(e.target.value)} style={{width:"100%"}}/></div>
          <div><div style={{fontSize:FONT.xs.size-1,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>Avant contact</div><input className="inv-inp" type="date" value={filtreAvant} onChange={e=>setFiltreAvant(e.target.value)} style={{width:"100%"}}/></div>
          {hasFilters&&<div style={{display:"flex",alignItems:"flex-end"}}><button className="inv-btn inv-btn-danger inv-btn-sm" onClick={()=>{setFiltreStatut("");setFiltreConseiller("");setFiltreSource("");setFiltreEtape("");setFiltreBudgetMin("");setFiltreBudgetMax("");setFiltreAvant("");}}><Icon as={X} size={12} strokeWidth={2.2}/> Réinitialiser</button></div>}
        </div>}
      </div>
      {loading?<div style={{textAlign:"center",padding:`${SPACING.xl}px 0`,color:T.textMuted,display:"flex",justifyContent:"center",alignItems:"center",gap:8}}><Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>Chargement…</div>:(
        <div style={{background:T.card,borderRadius:RADIUS.xl,border:`1px solid ${T.border}`,overflow:"hidden",boxShadow:T.shadowSm}}>
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1.3fr 1fr 1fr 80px",padding:`${SPACING.md-2}px ${SPACING.lg}px`,background:T.sectionHd,borderBottom:`1px solid ${T.border}`,fontSize:FONT.xs.size-1,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:0.8}}>
            <ColHd label="Contact" col="nom"/><ColHd label="Statut" col="statut"/><ColHd label="Budget" col="budget"/><ColHd label="Conseiller" col="conseiller"/><ColHd label="Étape" col="etape"/><ColHd label="Avant contact" col="date_avant_contact"/><ColHd label="Prochaine action" col="date_prochaine_action"/><div/>
          </div>
          {filtered.length===0?<div style={{textAlign:"center",padding:`${SPACING.xl}px 0`,color:T.textMuted,fontStyle:"italic"}}>Aucun contact trouvé</div>:filtered.map(c=>{
            const initials=`${c.prenom?.[0]||""}${c.nom?.[0]||""}`.toUpperCase();
            const enRetard=c.date_prochaine_action&&c.date_prochaine_action<new Date().toISOString().slice(0,10);
            return(
              <div key={c.id} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1.3fr 1fr 1fr 80px",padding:`${SPACING.md+2}px ${SPACING.lg}px`,borderBottom:`1px solid ${T.rowBorder}`,alignItems:"center",cursor:"pointer",transition:"background .12s"}} onMouseEnter={e=>e.currentTarget.style.background=T.cardHover} onMouseLeave={e=>e.currentTarget.style.background="transparent"} onClick={()=>setFicheId(c.id)}>
                <div style={{display:"flex",alignItems:"center",gap:SPACING.sm+2,minWidth:0}}>
                  <div style={{width:32,height:32,borderRadius:"50%",flexShrink:0,background:T.accentBg,color:T.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:FONT.sm.size,fontWeight:800}}>{initials}</div>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:700,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.prenom} {c.nom}</div>
                    <div style={{fontSize:FONT.xs.size,color:T.textMuted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.email||c.telephone||"—"}</div>
                  </div>
                </div>
                <div><span style={{background:`${STATUT_COLORS[c.statut]}18`,color:STATUT_COLORS[c.statut],border:`1px solid ${STATUT_COLORS[c.statut]}33`,borderRadius:RADIUS.pill,padding:`${SPACING.xs-2}px ${SPACING.sm+2}px`,fontSize:FONT.xs.size,fontWeight:700}}>{c.statut}</span></div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:FONT.sm.size+1,fontWeight:600,color:T.accent}}>{fmtBudget(c.budget)}</div>
                <div style={{fontSize:FONT.sm.size+1,color:T.textSub}}>{c.conseiller||"—"}</div>
                <div style={{fontSize:FONT.xs.size+1,color:T.textSub,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={c.etape||""}>{c.etape||"—"}</div>
                <div style={{fontSize:FONT.sm.size,color:T.textMuted}}>{fmtDate(c.date_avant_contact)}</div>
                <div style={{fontSize:FONT.sm.size,color:enRetard?DA:T.textMuted}}>
                  {enRetard&&<Icon as={AlertTriangle} size={11} strokeWidth={2.2} style={{marginRight:3,verticalAlign:-1}}/>}
                  {fmtDate(c.date_prochaine_action)}
                  {c.prochaine_action&&<div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.prochaine_action.slice(0,28)}</div>}
                </div>
                <div style={{textAlign:"right"}}><span style={{fontSize:FONT.sm.size,color:T.accent,fontWeight:700,display:"inline-flex",alignItems:"center",gap:3}}>Ouvrir <Icon as={ChevronRight} size={12} strokeWidth={2.5}/></span></div>
              </div>
            );
          })}
        </div>
      )}
      {showForm&&<FormulaireClient profil={profil} T={T} onSave={()=>{setShowForm(false);charger();}} onClose={()=>setShowForm(false)}/>}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ─── FORMULAIRE CLIENT (MODIFIÉ) ──────────────────────────────────────────────
function FormulaireClient({client,profil,onSave,onClose,T=THEMES_INV.dark}){
  const isEdit=!!client;
  const [form,setForm]=useState({
    nom:client?.nom||"",prenom:client?.prenom||"",email:client?.email||"",telephone:client?.telephone||"",
    conseiller:client?.conseiller||profil?.nom||"",source:client?.source||"Autre",statut:client?.statut||"Prospect",
    budget:client?.budget||0,etape:client?.etape||"",date_avant_contact:client?.date_avant_contact||"",
    prochaine_action:client?.prochaine_action||"",date_prochaine_action:client?.date_prochaine_action||"",
    notes_rapides:client?.notes_rapides||"",
  });
  const [saving,setSaving]=useState(false);
  const sauvegarder=async()=>{
    if(!form.nom.trim())return;setSaving(true);
    const payload={nom:form.nom.trim(),prenom:form.prenom.trim()||null,email:form.email.trim()||null,telephone:form.telephone.trim()||null,conseiller:form.conseiller.trim()||null,source:form.source||"Autre",statut:form.statut||"Prospect",budget:parseFloat(form.budget)||0,etape:form.etape||null,date_avant_contact:form.date_avant_contact||null,prochaine_action:form.prochaine_action.trim()||null,date_prochaine_action:form.date_prochaine_action||null,notes_rapides:form.notes_rapides.trim()||null};
    const{error}=isEdit?await supabase.from("invest_clients").update(payload).eq("id",client.id):await supabase.from("invest_clients").insert(payload);
    if(error){console.error("Erreur client:",error);alert("Erreur : "+error.message);}
    setSaving(false);if(!error)onSave();
  };
  const LBL=({children})=><label style={{fontSize:10,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:1.2,display:"block",marginBottom:5}}>{children}</label>;
  const F={marginBottom:14};
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300}}>
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:14,padding:"28px 30px",width:"90%",maxWidth:600,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 30px 80px rgba(0,0,0,.5)"}}>
        <div style={{fontSize:17,fontWeight:800,color:T.text,marginBottom:20}}>{isEdit?"Modifier le contact":"Nouveau contact"}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
          <div style={F}><LBL>Nom *</LBL><input className="inv-inp" value={form.nom} style={{width:"100%",textAlign:"left"}} onChange={e=>setForm({...form,nom:e.target.value})}/></div>
          <div style={F}><LBL>Prénom</LBL><input className="inv-inp" value={form.prenom} style={{width:"100%",textAlign:"left"}} onChange={e=>setForm({...form,prenom:e.target.value})}/></div>
          <div style={F}><LBL>Email</LBL><input className="inv-inp" type="email" value={form.email} style={{width:"100%",textAlign:"left"}} onChange={e=>setForm({...form,email:e.target.value})}/></div>
          <div style={F}><LBL>Téléphone</LBL><input className="inv-inp" value={form.telephone} style={{width:"100%",textAlign:"left"}} onChange={e=>setForm({...form,telephone:e.target.value})}/></div>
          <div style={F}><LBL>Conseiller référent</LBL><input className="inv-inp" value={form.conseiller} style={{width:"100%",textAlign:"left"}} onChange={e=>setForm({...form,conseiller:e.target.value})}/></div>
          <div style={F}><LBL>Source</LBL><select className="inv-sel" value={form.source} style={{width:"100%"}} onChange={e=>setForm({...form,source:e.target.value})}>{SOURCES_CLIENT.map(s=><option key={s}>{s}</option>)}</select></div>
          <div style={F}><LBL>Statut</LBL><select className="inv-sel" value={form.statut} style={{width:"100%"}} onChange={e=>setForm({...form,statut:e.target.value})}>{STATUTS_CLIENT.map(s=><option key={s}>{s}</option>)}</select></div>
          <div style={F}><LBL>Budget (€)</LBL><input className="inv-inp" type="number" value={form.budget} style={{width:"100%"}} onChange={e=>setForm({...form,budget:e.target.value})}/></div>
          <div style={{...F,gridColumn:"1 / -1"}}><LBL>Étape en cours</LBL><select className="inv-sel" value={form.etape} style={{width:"100%"}} onChange={e=>setForm({...form,etape:e.target.value})}>{ETAPES_CLIENT.map(e=><option key={e} value={e}>{e||"— Aucune étape —"}</option>)}</select></div>
          <div style={F}><LBL>Date avant contact</LBL><input className="inv-inp" type="date" value={form.date_avant_contact} style={{width:"100%"}} onChange={e=>setForm({...form,date_avant_contact:e.target.value})}/></div>
          <div style={F}><LBL>Date prochaine action</LBL><input className="inv-inp" type="date" value={form.date_prochaine_action} style={{width:"100%"}} onChange={e=>setForm({...form,date_prochaine_action:e.target.value})}/></div>
        </div>
        <div style={F}><LBL>Prochaine action</LBL><input className="inv-inp" value={form.prochaine_action} style={{width:"100%",textAlign:"left"}} onChange={e=>setForm({...form,prochaine_action:e.target.value})}/></div>
        <div style={F}><LBL>Notes rapides</LBL><textarea className="inv-textarea" rows={3} value={form.notes_rapides} onChange={e=>setForm({...form,notes_rapides:e.target.value})}/></div>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:8}}>
          <button className="inv-btn inv-btn-out" onClick={onClose}>Annuler</button>
          <button className="inv-btn inv-btn-gold" onClick={sauvegarder} disabled={saving}>{saving?"Enregistrement…":"Enregistrer"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── DOCUMENTS ────────────────────────────────────────────────────────────────
// IMPORTANT : Copiez ici votre fonction DocumentsSection complète depuis l'original
// (avec FILE_ICONS, getFileIcon, fmtSize)

// ─── FICHE CLIENT ─────────────────────────────────────────────────────────────
// IMPORTANT : Copiez ici votre fonction FicheClient complète depuis l'original

// ─── CARTE STOCK BIENS (NOUVEAU) ─────────────────────────────────────────────
function CarteStockBiens({biens,T=THEMES_INV.dark}){
  const containerRef=useRef(null);const mapRef=useRef(null);const markersRef=useRef([]);
  const [mapReady,setMapReady]=useState(false);const [geocoding,setGeocoding]=useState(false);const [progress,setProgress]=useState(0);
  useEffect(()=>{
    if(window.L){setMapReady(true);return;}
    if(!document.getElementById("leaflet-css")){const lk=document.createElement("link");lk.id="leaflet-css";lk.rel="stylesheet";lk.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";document.head.appendChild(lk);}
    const sc=document.createElement("script");sc.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";sc.onload=()=>setMapReady(true);document.head.appendChild(sc);
  },[]);
  useEffect(()=>{
    if(!mapReady||!containerRef.current||mapRef.current)return;
    const L=window.L;
    const map=L.map(containerRef.current).setView([46.5,2.5],6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:'© <a href="https://openstreetmap.org">OpenStreetMap</a>'}).addTo(map);
    mapRef.current=map;setTimeout(()=>map.invalidateSize(),150);
  },[mapReady]);
  useEffect(()=>{
    if(!mapReady||!mapRef.current)return;
    const L=window.L,map=mapRef.current;let cancelled=false;
    markersRef.current.forEach(m=>map.removeLayer(m));markersRef.current=[];
    const valides=biens.filter(b=>b.adresse||b.ville);if(!valides.length)return;
    setGeocoding(true);setProgress(0);
    (async()=>{
      const bounds=[];
      for(let i=0;i<valides.length;i++){
        if(cancelled)return;
        const b=valides[i];const coords=await geocodeAddress(b.adresse,b.ville);
        setProgress(Math.round(((i+1)/valides.length)*100));
        if(!coords||cancelled)continue;
        const color=STATUT_BIEN_COLORS[b.statut]||"#9aa0b0";
        const icon=L.divIcon({className:"",html:`<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,.4);cursor:pointer;transition:transform .12s" onmouseover="this.style.transform='scale(1.7)'" onmouseout="this.style.transform='scale(1)'"></div>`,iconSize:[14,14],iconAnchor:[7,7],popupAnchor:[0,-13]});
        const fmtEur=v=>v>0?new Intl.NumberFormat("fr-FR").format(v)+" €":"—";
        const popup=`<div style="font-family:'Segoe UI',Arial,sans-serif;min-width:210px;padding:2px 0"><div style="font-weight:700;font-size:13px;color:#1a2d4a;margin-bottom:3px">${b.adresse||"Sans adresse"}</div>${b.ville?`<div style="font-size:11px;color:#5a6070;margin-bottom:7px">📍 ${b.ville}${b.code_postal?" "+b.code_postal:""}</div>`:""}<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:10px;font-weight:700;margin-bottom:9px;background:${color}20;color:${color};border:1px solid ${color}40">${b.statut||"—"}</span><div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">${b.cout_total>0?`<div style="background:#f5f7fa;border-radius:6px;padding:5px 8px"><div style="font-size:9px;color:#9aa0b0;text-transform:uppercase">Coût total</div><div style="font-weight:700;font-size:12px">${fmtEur(b.cout_total)}</div></div>`:""}${b.rendement_brut>0?`<div style="background:#f0faf4;border-radius:6px;padding:5px 8px"><div style="font-size:9px;color:#9aa0b0;text-transform:uppercase">Rendement</div><div style="font-weight:700;font-size:12px;color:#1a7a4a">${b.rendement_brut.toFixed(1)} %</div></div>`:""}</div>${b.agence?`<div style="font-size:11px;color:#9aa0b0;margin-top:7px">${b.agence}</div>`:""}</div>`;
        const marker=L.marker([coords.lat,coords.lng],{icon}).addTo(map);
        marker.bindPopup(popup,{maxWidth:270});markersRef.current.push(marker);bounds.push([coords.lat,coords.lng]);
      }
      if(!cancelled&&bounds.length>0){if(bounds.length===1)map.setView(bounds[0],13);else map.fitBounds(bounds,{padding:[50,50]});}
      if(!cancelled)setGeocoding(false);
    })();
    return()=>{cancelled=true;};
  },[biens,mapReady]);
  return(
    <div className="inv-card" style={{marginBottom:SPACING.lg,position:"relative"}}>
      <div className="inv-card-hd blue" style={{justifyContent:"space-between"}}>
        <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={MapPin} size={13} strokeWidth={2.2}/>Carte des biens ({biens.length})</span>
        {geocoding&&<span style={{fontSize:FONT.xs.size,color:"rgba(255,255,255,.65)",display:"inline-flex",alignItems:"center",gap:5}}><Icon as={RefreshCw} size={11} style={{animation:"spin 1s linear infinite"}}/>Géocodage {progress}%</span>}
      </div>
      <div ref={containerRef} style={{height:420,borderRadius:`0 0 ${RADIUS.xl}px ${RADIUS.xl}px`}}/>
      {!mapReady&&<div style={{position:"absolute",bottom:0,left:0,right:0,height:420,display:"flex",alignItems:"center",justifyContent:"center",background:T.cardHover,borderRadius:`0 0 ${RADIUS.xl}px ${RADIUS.xl}px`,color:T.textMuted,gap:8}}><Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>Chargement de la carte…</div>}
    </div>
  );
}

// ─── STOCK BIENS (MODIFIÉ) ────────────────────────────────────────────────────
function StockBiens({profil,T=THEMES_INV.dark}){
  const [biens,setBiens]=useState([]);const [loading,setLoading]=useState(true);
  const [ficheId,setFicheId]=useState(null);const [showForm,setShowForm]=useState(false);
  const [filtreStatut,setFiltreStatut]=useState("");const [filtreVille,setFiltreVille]=useState("");
  const [search,setSearch]=useState("");const [sortCol,setSortCol]=useState("created_at");const [sortDir,setSortDir]=useState("desc");
  const charger=async()=>{setLoading(true);const{data}=await supabase.from("invest_biens").select("*").order("created_at",{ascending:false});setBiens(data||[]);setLoading(false);};
  useEffect(()=>{charger();},[]);
  const today=new Date().toISOString().slice(0,10);
  const villes=[...new Set(biens.map(b=>b.ville).filter(Boolean))];
  const toggleSort=(col)=>{if(sortCol===col)setSortDir(d=>d==="asc"?"desc":"asc");else{setSortCol(col);setSortDir("asc");}};
  const SI=({col})=>{if(sortCol!==col)return<Icon as={ChevronDown} size={10} color="rgba(255,255,255,.3)"/>;return sortDir==="asc"?<Icon as={ChevronUp} size={11} color="white"/>:<Icon as={ChevronDown} size={11} color="white"/>;};
  let filtered=biens.filter(b=>{
    if(filtreStatut&&b.statut!==filtreStatut)return false;
    if(filtreVille&&b.ville!==filtreVille)return false;
    if(search&&!`${b.adresse||""} ${b.ville||""} ${b.agence||""}`.toLowerCase().includes(search.toLowerCase()))return false;
    return true;
  });
  filtered=[...filtered].sort((a,b)=>{let va=a[sortCol]??"",vb=b[sortCol]??"";if(typeof va==="number")return sortDir==="asc"?va-vb:vb-va;return sortDir==="asc"?String(va).localeCompare(String(vb)):String(vb).localeCompare(String(va));});
  const aRelancer=biens.filter(b=>b.date_relance&&b.date_relance<=today).length;
  const fmtDate=d=>d?new Date(d+"T00:00:00").toLocaleDateString("fr-FR",{day:"2-digit",month:"short"}):"—";
  const fmtEur=v=>v>0?new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(v)+" €":"—";
  const COLS="40px 2fr 1.2fr 1fr 1fr 1fr 1fr 80px";
  const ColHd=({label,col})=><div onClick={()=>toggleSort(col)} style={{display:"inline-flex",alignItems:"center",gap:4,cursor:"pointer",userSelect:"none"}}>{label} <SI col={col}/></div>;
  if(ficheId)return<FicheBien id={ficheId} profil={profil} T={T} onRetour={()=>{setFicheId(null);charger();}}/>;
  return(
    <div style={{padding:`${SPACING.xl}px ${SPACING.xl+4}px`,maxWidth:1400,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:SPACING.xl-4,flexWrap:"wrap",gap:SPACING.sm+2}}>
        <div style={{display:"flex",alignItems:"center",gap:SPACING.md}}>
          <div style={{width:44,height:44,borderRadius:RADIUS.lg,background:T.accentBg,color:T.accent,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icon as={Building2} size={22} strokeWidth={2}/></div>
          <div>
            <div style={{fontSize:FONT.h2.size,fontWeight:800,color:T.text,letterSpacing:-0.3}}>Stock de Biens</div>
            <div style={{fontSize:FONT.sm.size+1,color:T.textMuted,marginTop:2,display:"inline-flex",alignItems:"center",gap:8}}>
              {filtered.length} bien{filtered.length!==1?"s":""}
              {aRelancer>0&&<span style={{display:"inline-flex",alignItems:"center",gap:4,color:DA,fontWeight:700}}>· <Icon as={Bell} size={11} strokeWidth={2.2}/> {aRelancer} à relancer</span>}
            </div>
          </div>
        </div>
        <button className="inv-btn inv-btn-gold" onClick={()=>setShowForm(true)}><Icon as={Plus} size={13} strokeWidth={2.2}/> Nouveau bien</button>
      </div>
      <CarteStockBiens biens={filtered} T={T}/>
      <div style={{display:"flex",gap:SPACING.sm+2,marginBottom:SPACING.lg,flexWrap:"wrap"}}>
        <div style={{position:"relative",width:240}}>
          <Icon as={Search} size={13} color={T.textMuted} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}/>
          <input className="inv-inp" placeholder="Rechercher…" value={search} onChange={e=>setSearch(e.target.value)} style={{width:"100%",textAlign:"left",paddingLeft:30,fontSize:FONT.sm.size+1}}/>
        </div>
        <select className="inv-sel" value={filtreStatut} onChange={e=>setFiltreStatut(e.target.value)}><option value="">Tous statuts</option>{STATUTS_BIEN.map(s=><option key={s}>{s}</option>)}</select>
        <select className="inv-sel" value={filtreVille} onChange={e=>setFiltreVille(e.target.value)}><option value="">Toutes villes</option>{villes.map(v=><option key={v}>{v}</option>)}</select>
        <button className="inv-btn inv-btn-danger inv-btn-sm" onClick={()=>{setFiltreStatut("À relancer");setSortCol("date_relance");setSortDir("asc");}}><Icon as={Bell} size={12} strokeWidth={2.2}/> Voir à relancer</button>
      </div>
      {loading?<div style={{textAlign:"center",padding:`${SPACING.xl}px 0`,color:T.textMuted,display:"flex",justifyContent:"center",alignItems:"center",gap:8}}><Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>Chargement…</div>:(
        <div style={{background:T.card,borderRadius:RADIUS.xl,border:`1px solid ${T.border}`,overflow:"hidden",boxShadow:T.shadowSm}}>
          <div style={{display:"grid",gridTemplateColumns:COLS,padding:`${SPACING.md-2}px ${SPACING.lg}px`,background:T.sectionHd,borderBottom:`1px solid ${T.border}`,fontSize:FONT.xs.size-1,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:0.8,alignItems:"center"}}>
            <div/><ColHd label="Bien" col="adresse"/><ColHd label="Statut" col="statut"/><ColHd label="Coût total" col="cout_total"/><ColHd label="Rendement" col="rendement_brut"/><ColHd label="Cash-flow" col="cashflow_estime"/><ColHd label="Relance" col="date_relance"/><div/>
          </div>
          {filtered.length===0?<div style={{textAlign:"center",padding:`${SPACING.xl}px 0`,color:T.textMuted,fontStyle:"italic"}}>Aucun bien trouvé</div>:filtered.map(b=>{
            const couleur=STATUT_BIEN_COLORS[b.statut]||"#9aa0b0";
            const enRelance=b.date_relance&&b.date_relance<=today;
            const rendCol=b.rendement_brut>=8?SU:b.rendement_brut>=5?WA:T.textMuted;
            const cfVal=b.cashflow_estime||0,cfCol=cfVal>0?SU:cfVal<0?DA:T.textMuted;
            return(
              <div key={b.id} style={{display:"grid",gridTemplateColumns:COLS,padding:`${SPACING.md+2}px ${SPACING.lg}px`,borderBottom:`1px solid ${T.rowBorder}`,alignItems:"center",cursor:"pointer",transition:"background .12s"}} onMouseEnter={e=>e.currentTarget.style.background=T.cardHover} onMouseLeave={e=>e.currentTarget.style.background="transparent"} onClick={()=>setFicheId(b.id)}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}><div title={b.statut} style={{width:10,height:10,borderRadius:"50%",background:couleur,boxShadow:`0 0 6px ${couleur}80`,flexShrink:0}}/></div>
                <div style={{display:"flex",alignItems:"center",gap:SPACING.sm+2,minWidth:0}}>
                  <div style={{width:34,height:34,borderRadius:RADIUS.md,flexShrink:0,background:`${couleur}22`,color:couleur,border:`1px solid ${couleur}40`,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon as={Home} size={17} strokeWidth={2}/></div>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:700,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.adresse||"Adresse non renseignée"}</div>
                    <div style={{fontSize:FONT.xs.size,color:T.textMuted,display:"inline-flex",alignItems:"center",gap:4}}>{b.ville&&<><Icon as={MapPin} size={10}/> {b.ville}</>}{b.agence&&<span> · {b.agence}</span>}</div>
                  </div>
                </div>
                <div><span style={{background:`${couleur}18`,color:couleur,border:`1px solid ${couleur}33`,borderRadius:RADIUS.pill,padding:`${SPACING.xs-2}px ${SPACING.sm+1}px`,fontSize:FONT.xs.size-1,fontWeight:700,whiteSpace:"nowrap"}}>{b.statut}</span></div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:FONT.sm.size,fontWeight:600,color:T.textSub}}>{fmtEur(b.cout_total)}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:FONT.sm.size+1,fontWeight:700,color:rendCol}}>{b.rendement_brut>0?b.rendement_brut.toFixed(1)+"%":"—"}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:FONT.sm.size,color:cfCol,fontWeight:cfVal!==0?600:400}}>{b.cashflow_estime?fmtEur(b.cashflow_estime)+"/mois":"—"}</div>
                <div style={{fontSize:FONT.sm.size,color:enRelance?DA:T.textMuted,fontWeight:enRelance?700:400,display:"inline-flex",alignItems:"center",gap:3}}>{enRelance&&<Icon as={Bell} size={11} strokeWidth={2.2}/>}{fmtDate(b.date_relance)}</div>
                <div style={{textAlign:"right"}}><span style={{fontSize:FONT.sm.size,color:T.accent,fontWeight:700,display:"inline-flex",alignItems:"center",gap:3}}>Ouvrir <Icon as={ChevronRight} size={12} strokeWidth={2.5}/></span></div>
              </div>
            );
          })}
        </div>
      )}
      {showForm&&<FormulaireBien profil={profil} T={T} onSave={()=>{setShowForm(false);charger();}} onClose={()=>setShowForm(false)}/>}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ─── COMPOSANTS INCHANGÉS ─────────────────────────────────────────────────────
// Copiez ici depuis votre original :
//  • function InpText(props) {...}
//  • function InpNum(props) {...}
//  • function FormulaireBien({...}) {...}
//  • function FicheBien({...}) {...}
//  • function AdminInvest({...}) {...}
//  • function OngletUtilisateursInvest({...}) {...}
//  • function SidebarInvest({...}) {...}
//  • export default function PageInvest({...}) {...}
