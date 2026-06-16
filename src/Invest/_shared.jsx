import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, useMemo } from "react";
import { supabase } from "../supabase";
import { LOGO_INVEST_H, LOGO_INVEST_V, FONT, RADIUS, SPACING, SEMANTIC, getBranchAccent } from "../constants";
import { Icon } from "../ui";
import { loadAccessConfig, canAccess as canAccessInvest, ROLE_PAGES_DEFAULT_INVEST, PAGES_INVEST } from "../access";
import { OngletAcces } from "../Renovation/Admin";
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

// Page ajoutée au contrôle d'accès Invest.
// On étend les constantes importées depuis ./access pour que la page
// “Dashboard Financier” apparaisse dans l'admin des accès et puisse être
// cochée/décochée par rôle comme les autres pages.
if (Array.isArray(PAGES_INVEST) && !PAGES_INVEST.some(p => p.id === "finance")) {
  const adminIndex = PAGES_INVEST.findIndex(p => p.id === "admin");
  const financePage = { id: "finance", label: "Dashboard Financier" };
  if (adminIndex >= 0) PAGES_INVEST.splice(adminIndex, 0, financePage);
  else PAGES_INVEST.push(financePage);
}
Object.keys(ROLE_PAGES_DEFAULT_INVEST || {}).forEach(roleKey => {
  const pages = ROLE_PAGES_DEFAULT_INVEST[roleKey];
  if (!Array.isArray(pages) || pages.includes("finance")) return;
  // Par défaut, on donne l'accès finance aux rôles qui avaient déjà accès
  // au pilotage global ou au simulateur. Ensuite l'admin peut l'ajuster.
  if (pages.includes("admin") || pages.includes("dashboard") || pages.includes("simulateur")) {
    const adminIndex = pages.indexOf("admin");
    if (adminIndex >= 0) pages.splice(adminIndex, 0, "finance");
    else pages.push("finance");
  }
});



if (Array.isArray(PAGES_INVEST) && !PAGES_INVEST.some(p => p.id === "suivi_financier")) {
  const financeIndex = PAGES_INVEST.findIndex(p => p.id === "finance");
  const adminIndex = PAGES_INVEST.findIndex(p => p.id === "admin");
  const suiviPage = { id: "suivi_financier", label: "Suivi Financier" };
  if (financeIndex >= 0) PAGES_INVEST.splice(financeIndex + 1, 0, suiviPage);
  else if (adminIndex >= 0) PAGES_INVEST.splice(adminIndex, 0, suiviPage);
  else PAGES_INVEST.push(suiviPage);
}
Object.keys(ROLE_PAGES_DEFAULT_INVEST || {}).forEach(roleKey => {
  const pages = ROLE_PAGES_DEFAULT_INVEST[roleKey];
  if (!Array.isArray(pages) || pages.includes("suivi_financier")) return;
  if (pages.includes("admin") || pages.includes("finance") || pages.includes("dashboard")) {
    const financeIndex = pages.indexOf("finance");
    const adminIndex = pages.indexOf("admin");
    if (financeIndex >= 0) pages.splice(financeIndex + 1, 0, "suivi_financier");
    else if (adminIndex >= 0) pages.splice(adminIndex, 0, "suivi_financier");
    else pages.push("suivi_financier");
  }
});

// Page Structuration Patrimoniale — liée aux clients Invest.
if (Array.isArray(PAGES_INVEST) && !PAGES_INVEST.some(p => p.id === "structuration")) {
  const financeIndex = PAGES_INVEST.findIndex(p => p.id === "finance");
  const biensIndex = PAGES_INVEST.findIndex(p => p.id === "biens");
  const structPage = { id: "structuration", label: "Structuration Patrimoniale" };
  if (financeIndex >= 0) PAGES_INVEST.splice(financeIndex, 0, structPage);
  else if (biensIndex >= 0) PAGES_INVEST.splice(biensIndex + 1, 0, structPage);
  else PAGES_INVEST.push(structPage);
}
Object.keys(ROLE_PAGES_DEFAULT_INVEST || {}).forEach(roleKey => {
  const pages = ROLE_PAGES_DEFAULT_INVEST[roleKey];
  if (!Array.isArray(pages) || pages.includes("structuration")) return;
  if (pages.includes("admin") || pages.includes("crm") || pages.includes("finance") || pages.includes("dashboard")) {
    const financeIndex = pages.indexOf("finance");
    const adminIndex = pages.indexOf("admin");
    if (financeIndex >= 0) pages.splice(financeIndex, 0, "structuration");
    else if (adminIndex >= 0) pages.splice(adminIndex, 0, "structuration");
    else pages.push("structuration");
  }
});

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

function openFicheClientInvestisseurPDF(data = {}) {
  const win = window.open("", "_blank", "width=980,height=780");
  if (!win) { alert("Autorisez les pop-ups."); return; }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
  const fmtN = (v) => num(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
  const fmtE = (v) => num(v) !== 0 ? `${fmtN(v)} €` : "—";
  const fmtPct = (v) => Number.isFinite(Number(v)) ? `${Number(v).toFixed(2).replace(".", ",")} %` : "—";
  const fmtM2 = (v) => Number.isFinite(Number(v)) && Number(v) > 0 ? `${fmtN(v)} €` : "—";

  const title = data.title || "Fiche investisseur";
  const address = data.address || "";
  const dateEdition = data.dateEdition || new Date().toLocaleDateString("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric" });
  const subtitle = data.subtitle || "Analyse de Rentabilité";
  const client = data.client || "";
  const lots = Array.isArray(data.lots) ? data.lots.filter(l => (l?.type || "") !== "Sélectionner") : [];

  const surface = num(data.surface);
  const logements = data.logements ?? lots.length;
  const prixAchat = num(data.prixAchat);
  const budgetTravaux = num(data.budgetTravaux);
  const coutTotal = num(data.coutTotal);
  const totLoyer = data.totLoyer !== undefined ? num(data.totLoyer) : lots.reduce((s,l)=>s+num(l.loyer),0);
  const totLoyerAn = data.totLoyerAn !== undefined ? num(data.totLoyerAn) : totLoyer * 12;
  const chargesAnnuelles = num(data.chargesAnnuelles);
  const annuiteS1 = num(data.annuiteS1);
  const mensualiteS1 = num(data.mensualiteS1);
  const cashflowS1 = num(data.cashflowS1);
  const rendementBrutPct = Number.isFinite(Number(data.rendementBrutPct)) ? Number(data.rendementBrutPct) : (coutTotal > 0 ? (totLoyerAn / coutTotal) * 100 : 0);
  const rendementNetPct = Number.isFinite(Number(data.rendementNetPct)) ? Number(data.rendementNetPct) : (coutTotal > 0 ? ((totLoyerAn - chargesAnnuelles) / coutTotal) * 100 : 0);
  const pointEquilibreMois = Number.isFinite(Number(data.pointEquilibreMois)) ? Number(data.pointEquilibreMois) : (totLoyerAn > 0 ? ((chargesAnnuelles + annuiteS1) / totLoyerAn) * 12 : 0);
  const margeSecuritePct = Number.isFinite(Number(data.margeSecuritePct)) ? Number(data.margeSecuritePct) : (totLoyerAn > 0 ? (1 - ((chargesAnnuelles + annuiteS1) / totLoyerAn)) * 100 : 0);
  const totalGestionMois = data.totalGestionMois !== undefined ? num(data.totalGestionMois) : lots.reduce((s,l)=>s+num(l.gestion),0);

  const maxLoyer = Math.max(1, ...lots.map(l => num(l.loyer)));
  const barAreaW = 330;
  const barGap = lots.length > 1 ? Math.min(28, Math.max(10, 140 / lots.length)) : 20;
  const barW = lots.length ? Math.max(18, Math.min(42, (barAreaW - barGap * Math.max(0, lots.length - 1)) / lots.length)) : 28;
  const totalBarsW = lots.length * barW + Math.max(0, lots.length - 1) * barGap;
  const startX = Math.max(36, (420 - totalBarsW) / 2);
  const barsSvg = lots.map((l,i) => {
    const h = Math.max(6, (num(l.loyer) / maxLoyer) * 150);
    const x = startX + i * (barW + barGap);
    const y = 178 - h;
    return `<g><text x="${x + barW/2}" y="${Math.max(14, y-8)}" text-anchor="middle" class="svg-val">${fmtN(l.loyer)}</text><rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" class="bar"/><text x="${x + barW/2}" y="206" text-anchor="middle" class="svg-lbl">Appt ${i+1}</text></g>`;
  }).join("");

  const years = Array.from({length:8}, (_,i)=>i+1);
  const loyersCumules = years.map(y => totLoyerAn * y);
  const cfCumules = years.map(y => cashflowS1 * 12 * y);
  const maxProjection = Math.max(1, ...loyersCumules, ...cfCumules.map(v => Math.max(0, v)));
  const chartX = (i) => 36 + (i * 330 / 7);
  const chartY = (v) => 178 - (Math.max(0, num(v)) / maxProjection) * 140;
  const pointsLoyers = loyersCumules.map((v,i)=>`${chartX(i)},${chartY(v)}`).join(" ");
  const pointsCF = cfCumules.map((v,i)=>`${chartX(i)},${chartY(v)}`).join(" ");
  const dotsLoyers = loyersCumules.map((v,i)=>`<circle cx="${chartX(i)}" cy="${chartY(v)}" r="3" class="dot-blue"/>`).join("");
  const dotsCF = cfCumules.map((v,i)=>`<circle cx="${chartX(i)}" cy="${chartY(v)}" r="3" class="dot-green"/>`).join("");
  const yearLabels = years.map((y,i)=>`<text x="${chartX(i)}" y="206" text-anchor="middle" class="svg-lbl">An ${y}</text>`).join("");

  const lotRows = lots.map((l,i) => {
    const gestion = l.gestion !== undefined ? num(l.gestion) : (l.type && GESTION_PRICES?.[l.type] ? GESTION_PRICES[l.type] : 0);
    return `<tr><td>Appartement ${i+1}${l.comment ? ` — <span class="muted">${esc(l.comment)}</span>` : ""}</td><td>${esc(l.type || "—")}</td><td>${esc(l.niveau || "—")}</td><td class="right">${num(l.m2) > 0 ? `${fmtN(l.m2)} m²` : "—"}</td><td class="right green">${fmtE(l.loyer)}</td><td class="right orange">${gestion > 0 ? fmtE(gestion) : "—"}</td></tr>`;
  }).join("");

  const description = data.description || "Projet d’investissement immobilier avec analyse de rentabilité, loyers cibles, financement et points de vigilance.";
  const travaux = data.travaux || "Travaux à préciser selon visite, devis et diagnostics.";
  const atouts = data.atouts || "Stratégie à confirmer selon objectifs patrimoniaux, financement et validation technique.";
  const recommandation = data.recommandation || "Analyse à valider";

  const indicRows = [
    ["Loyers bruts annuels", fmtE(totLoyerAn)],
    ["Charges d'exploitation", fmtE(chargesAnnuelles)],
    ["Annuité S1", fmtE(annuiteS1)],
    ["Rentabilité brute", fmtPct(rendementBrutPct), "blue"],
    ["Rentabilité nette", fmtPct(rendementNetPct), "green"],
    ["Cash-flow mensuel S1", fmtE(cashflowS1), cashflowS1 >= 0 ? "green" : "orange"],
    ["Cash-flow annuel S1", fmtE(cashflowS1 * 12)],
    ["Point d'équilibre", pointEquilibreMois > 0 ? `${pointEquilibreMois.toFixed(1).replace(".", ",")} mois/an` : "—"],
    ["Marge de sécurité", Number.isFinite(margeSecuritePct) ? `${margeSecuritePct.toFixed(1).replace(".", ",")} %` : "—", margeSecuritePct >= 20 ? "green" : "orange"],
  ].map(([l,v,cls])=>`<tr><td>${esc(l)}</td><td class="right ${cls||""}">${esc(v)}</td></tr>`).join("");

  win.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Fiche Investisseur — ${esc(title)}</title>
    <style>
      *{box-sizing:border-box} body{margin:0;background:#eef1f6;color:#19243a;font-family:'Arial Narrow','Barlow Condensed',Arial,sans-serif;font-size:12px;line-height:1.32} .page{width:794px;min-height:1123px;margin:0 auto;background:white;padding:22px 24px 18px;position:relative} .no-print{position:fixed;top:14px;right:14px;z-index:10;display:flex;gap:8px}.btn{border:0;border-radius:8px;padding:10px 15px;font-weight:800;cursor:pointer}.btn.primary{background:#17365f;color:white}.btn.light{background:white;color:#17365f;border:1px solid #d8dce6}.top{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:4px solid #17365f;padding-bottom:15px;margin-bottom:18px}.brand{display:flex;align-items:center;gap:10px}.logo{width:45px;height:45px;border-radius:9px;background:#0e1525;display:flex;align-items:center;justify-content:center;color:#4070e8;font-weight:900}.brand-title{font-weight:900;color:#1d4f90;letter-spacing:.3px}.brand-sub{font-size:10px;color:#7e8798;margin-top:2px}.doc-title{text-align:right}.doc-title h1{margin:0;font-size:22px;line-height:1.05;color:#19243a}.doc-title .sub{font-size:14px;color:#1d4f90;font-weight:800;margin-top:4px}.doc-title .date{font-size:10px;color:#8a93a5;margin-top:3px}.client{font-size:10px;color:#5f6d84;margin-top:3px}.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:11px;margin-bottom:17px}.kpi{border-left:4px solid #1d4f90;background:#fbfcfe;border-radius:9px;padding:12px 9px;box-shadow:0 1px 5px rgba(15,35,65,.08)}.kpi.green{border-color:#2aa66a}.kpi.blue{border-color:#1d4f90}.kpi.gold{border-color:#d2a92b}.kpi .val{font-size:21px;font-weight:900;letter-spacing:-.7px;color:#1d4f90}.kpi.green .val{color:#18945b}.kpi.gold .val{color:#c79b21}.kpi .lbl{font-size:9px;color:#7e8798;text-transform:uppercase;font-weight:900;margin-top:4px;letter-spacing:.35px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}.card{border:1px solid #e5eaf2;border-radius:7px;overflow:hidden;background:white}.hd{background:#17365f;color:white;font-weight:900;text-transform:uppercase;letter-spacing:.45px;font-size:12px;padding:8px 10px}.bd{padding:12px}.metrics{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px}.mini-label{font-size:9px;color:#8b94a6;text-transform:uppercase;font-weight:900;letter-spacing:.45px}.mini-val{font-size:16px;font-weight:900;color:#19243a;margin-top:2px}.finance-box{margin-top:13px;background:#f1f5ff;border-left:4px solid #1d4f90;border-radius:5px;padding:10px;color:#17365f;font-size:10px;line-height:1.45}.svg-val{font:800 10px Arial;fill:#17365f}.svg-lbl{font:700 9px Arial;fill:#758197}.bar{fill:#1d4f90}.axis{stroke:#e7ebf2;stroke-width:1}.line-blue{fill:none;stroke:#1d4f90;stroke-width:3}.line-green{fill:none;stroke:#18945b;stroke-width:3}.dot-blue{fill:#1d4f90}.dot-green{fill:#18945b}.legend{display:flex;gap:16px;font-size:9px;color:#7d8798;margin-left:34px;margin-bottom:4px}.legend span:before{content:"";display:inline-block;width:10px;height:6px;margin-right:5px;border-radius:2px;vertical-align:1px}.legend .blue:before{background:#1d4f90}.legend .green:before{background:#18945b}table{width:100%;border-collapse:collapse}.lots th{background:#17365f;color:white;text-align:left;font-size:9px;text-transform:uppercase;padding:7px 8px}.lots td{border-bottom:1px solid #e7ebf2;padding:7px 8px;font-size:11px}.lots tr:nth-child(even) td{background:#f8fafd}.lots .total td{background:#17365f!important;color:white;font-weight:900}.right{text-align:right}.green{color:#18945b!important;font-weight:900}.blue{color:#1d4f90!important;font-weight:900}.orange{color:#c56d1f!important;font-weight:900}.muted{color:#8a93a5;font-size:9px}.indics td{padding:7px 8px;border-bottom:1px solid #e8ecf3;font-size:11px}.indics tr:nth-child(even) td{background:#f8fafd}.appreciation{margin-top:17px}.app-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.app-card{border:1px solid #e7ebf2;border-top:4px solid #1d4f90;border-radius:8px;padding:12px;background:#fbfcfe;min-height:100px}.app-card.gold{border-top-color:#d2a92b}.app-card.green{border-top-color:#18945b}.app-title{font-weight:900;font-size:12px;margin-bottom:8px;color:#19243a}.app-txt{font-size:10px;color:#5f6d84;line-height:1.55;white-space:pre-wrap}.footer{position:absolute;left:24px;right:24px;bottom:12px;border-top:3px solid #17365f;padding-top:8px;display:flex;justify-content:space-between;color:#8a93a5;font-size:9px}.footer b{color:#17365f}.recommend{display:inline-block;background:#eaf7f0;color:#18945b;border:1px solid #b9e6cc;border-radius:999px;padding:3px 9px;font-weight:900;font-size:10px;margin-top:6px}@media print{body{background:white}.no-print{display:none}.page{width:auto;min-height:auto;margin:0;padding:9mm 10mm 8mm;box-shadow:none}@page{size:A4 portrait;margin:0}.footer{bottom:5mm;left:10mm;right:10mm}.card,.app-card{break-inside:avoid}}
    </style></head><body>
      <div class="no-print"><button class="btn light" onclick="window.close()">Fermer</button><button class="btn primary" onclick="window.print()">Télécharger en PDF</button></div>
      <div class="page">
        <div class="top"><div class="brand"><div class="logo">PI</div><div><div class="brand-title">PROFERO INVEST</div><div class="brand-sub">Fiche Projet Investissement</div></div></div><div class="doc-title"><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div><div class="date">Généré le ${esc(dateEdition)}</div>${client ? `<div class="client">Présenté à : ${esc(client)}</div>` : ""}${address ? `<div class="client">📍 ${esc(address)}</div>` : ""}</div></div>
        <div class="kpis"><div class="kpi green"><div class="val">${fmtPct(rendementBrutPct)}</div><div class="lbl">Rendement brut</div></div><div class="kpi green"><div class="val">${fmtPct(rendementNetPct)}</div><div class="lbl">Rendement net</div></div><div class="kpi green"><div class="val">${fmtE(cashflowS1)}/mois</div><div class="lbl">Cash-flow S1</div></div><div class="kpi blue"><div class="val">${fmtE(coutTotal)}</div><div class="lbl">Coût total opération</div></div><div class="kpi gold"><div class="val">${fmtE(totLoyer)}/mois</div><div class="lbl">Rentrée locative</div></div></div>
        <div class="grid2"><div class="card"><div class="hd">🏢 Description du projet</div><div class="bd"><div class="metrics"><div><div class="mini-label">Surface</div><div class="mini-val">${surface ? `${fmtN(surface)} m²` : "—"}</div></div><div><div class="mini-label">Logements</div><div class="mini-val">${logements || "—"}</div></div><div><div class="mini-label">Prix d'achat</div><div class="mini-val">${fmtE(prixAchat)}</div></div><div><div class="mini-label">Budget travaux</div><div class="mini-val">${fmtE(budgetTravaux)}</div></div><div><div class="mini-label">Prix achat/m²</div><div class="mini-val">${surface ? fmtM2(prixAchat/surface) : "—"}</div></div><div><div class="mini-label">Opération/m²</div><div class="mini-val">${surface ? fmtM2(coutTotal/surface) : "—"}</div></div></div><div class="finance-box"><b>FINANCEMENT S1</b><br/>Apport : ${fmtE(data.apportS1)} · Taux : ${data.tauxS1 ? `${String(data.tauxS1).replace(".", ",")} %` : "—"} · Durée : ${data.dureeS1 ? `${data.dureeS1} ans` : "—"}<br/>Mensualité : ${fmtE(mensualiteS1)} · Annuité : ${fmtE(annuiteS1)}</div></div></div><div class="card"><div class="hd">📊 Loyers mensuels par logement (€)</div><div class="bd"><svg viewBox="0 0 420 225" width="100%" height="225" role="img"><line x1="36" y1="178" x2="390" y2="178" class="axis"/><line x1="36" y1="128" x2="390" y2="128" class="axis"/><line x1="36" y1="78" x2="390" y2="78" class="axis"/>${barsSvg || `<text x="210" y="112" text-anchor="middle" class="svg-lbl">Aucun lot renseigné</text>`}</svg></div></div></div>
        <div class="card" style="margin-bottom:16px"><div class="hd">🏘️ Détail des ${lots.length || 0} logements</div><table class="lots"><thead><tr><th>Désignation</th><th>Type</th><th>Niveau</th><th class="right">Surface</th><th class="right">Loyer/mois</th><th class="right">Gestion</th></tr></thead><tbody>${lotRows || `<tr><td colspan="6" style="text-align:center;color:#8a93a5;padding:18px">Aucun lot renseigné</td></tr>`}<tr class="total"><td>TOTAL</td><td colspan="2">${lots.length} lot${lots.length>1?"s":""}</td><td class="right">${surface ? `${fmtN(surface)} m²` : "—"}</td><td class="right">${fmtE(totLoyer)}/mois</td><td class="right">${totalGestionMois ? `${fmtE(totalGestionMois)}/mois` : "—"}</td></tr></tbody></table></div>
        <div class="grid2"><div class="card"><div class="hd">📈 Projection cumulée — 8 ans</div><div class="bd"><div class="legend"><span class="blue">Revenus cumulés</span><span class="green">Cash-flow cumulé</span></div><svg viewBox="0 0 420 225" width="100%" height="225"><line x1="36" y1="178" x2="390" y2="178" class="axis"/><line x1="36" y1="128" x2="390" y2="128" class="axis"/><line x1="36" y1="78" x2="390" y2="78" class="axis"/><polyline points="${pointsLoyers}" class="line-blue"/>${dotsLoyers}<polyline points="${pointsCF}" class="line-green"/>${dotsCF}${yearLabels}</svg></div></div><div class="card"><div class="hd">⚖️ Indicateurs clés</div><table class="indics"><tbody>${indicRows}</tbody></table></div></div>
        <div class="appreciation"><div class="card"><div class="hd">🎯 Notre appréciation <span class="recommend">${esc(recommandation)}</span></div><div class="bd"><div class="app-grid"><div class="app-card"><div class="app-title">🏢 Description du Projet</div><div class="app-txt">${esc(description)}</div></div><div class="app-card gold"><div class="app-title">🔨 Travaux Prévus</div><div class="app-txt">${esc(travaux)}</div></div><div class="app-card green"><div class="app-title">🎯 Atouts & Stratégie</div><div class="app-txt">${esc(atouts)}</div></div></div></div></div></div>
        <div class="footer"><div><b>Profero Invest</b></div><div>Transformer vos ambitions en investissements réussis</div><div>Document généré le ${esc(dateEdition)}</div></div>
      </div>
    </body></html>`);
  win.document.close();
}


// ─── THÈMES INVEST ────────────────────────────────────────────────────────────
// Aligné sur Profero Rénovation (THEMES.dark / THEMES.light dans constants.js)
// pour cohérence visuelle, avec l'accent bleu Profero Invest comme différence.
const THEMES_INV = {
  dark: {
    // Surfaces — alignées sur THEMES.dark de constants.js
    // ATTENTION : .inv-card et .inv-kpi utilisent T.card. On met donc card=surface
    // pour que les cards soient bien visibles (pas transparentes).
    bg:        "#1e2128",
    surface:   "#262a32",
    card:      "#262a32",
    cardHover: "rgba(64,112,232,0.07)",
    cardActive:"rgba(64,112,232,0.12)",
    // Borders
    border:    "rgba(255,255,255,0.07)",
    borderHover: INVEST_ACC.border,
    rowBorder: "rgba(255,255,255,0.05)",
    // Texte
    text:      "#f0f0f0",
    textSub:   "#9aa5c0",
    textMuted: "#5b6a8a",
    // Accent (bleu officiel Profero Invest)
    accent:       INVEST_ACC.accent,
    accentHover:  INVEST_ACC.accentLight,
    accentBg:     INVEST_ACC.bg10,
    accentBg20:   INVEST_ACC.bg20,
    accentBorder: INVEST_ACC.border,
    onAccent:     INVEST_ACC.onAccent,
    // Sidebar / nav
    sidebar:   "#16181d",
    sidebarBorder: "rgba(255,255,255,0.06)",
    sectionHd: "rgba(255,255,255,0.03)",
    tabNav:    "#1a1d24",
    // Inputs
    input:        "rgba(255,255,255,0.05)",
    inputBorder:  "rgba(255,255,255,0.10)",
    inputBorderHover: INVEST_ACC.border,
    scrollThumb: "#3a4060",
    // Shadows
    shadowSm:  "0 1px 2px rgba(0,0,0,0.3)",
    shadowMd:  "0 4px 12px rgba(0,0,0,0.25)",
  },
  light: {
    // Aligné sur THEMES.light de constants.js
    bg:        "#f7f7f7",
    surface:   "#ffffff",
    card:      "#ffffff",
    cardHover: "rgba(64,112,232,0.05)",
    cardActive:"rgba(64,112,232,0.10)",
    border:    "rgba(0,0,0,0.09)",
    borderHover: INVEST_ACC.border,
    rowBorder: "rgba(0,0,0,0.06)",
    text:      "#1a1f2e",
    textSub:   "#4a5568",
    textMuted: "#8a9ab0",
    accent:       INVEST_ACC.accent,
    accentHover:  INVEST_ACC.accentDark,
    accentBg:     INVEST_ACC.bg10,
    accentBg20:   INVEST_ACC.bg20,
    accentBorder: INVEST_ACC.border,
    onAccent:     INVEST_ACC.onAccent,
    sidebar:   "#1a1f2e",
    sidebarBorder: "rgba(255,255,255,0.08)",
    sectionHd: "rgba(0,0,0,0.03)",
    tabNav:    "#ffffff",
    input:        "rgba(0,0,0,0.04)",
    inputBorder:  "rgba(0,0,0,0.10)",
    inputBorderHover: INVEST_ACC.border,
    scrollThumb: "#c0c8d8",
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
.inv{font-family:'Barlow Condensed','Arial Narrow',sans-serif;background:${T.bg};color:${T.text};font-size:${FONT.base.size}px;max-width:100%;overflow-x:hidden;}
.inv *{box-sizing:border-box;margin:0;padding:0;}
.inv ::-webkit-scrollbar{width:6px;height:6px;}
.inv ::-webkit-scrollbar-thumb{background:${T.scrollThumb};border-radius:${RADIUS.sm}px;}
.inv ::-webkit-scrollbar-track{background:transparent;}

/* ─── CARDS ────────────────────────────────────────────────────────────── */
.inv-card{background:${T.card};border-radius:${RADIUS.xl}px;border:1px solid ${T.border};overflow:hidden;box-shadow:${T.shadowSm};transition:border-color .18s, box-shadow .18s;min-width:0;}
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
.inv-btn-accent{background:${T.accent};color:#0f172a;}.inv-btn-accent:hover:not(:disabled){background:${T.accentHover};}
.inv-btn-blue{background:${T.accentBg};color:${T.accent};border:1px solid ${T.accentBorder};}.inv-btn-blue:hover:not(:disabled){background:${T.accentBg20};}
.inv-btn-gold{background:${T.accent};color:#0f172a;}.inv-btn-gold:hover:not(:disabled){background:${T.accentHover};}
.inv-btn-out{background:transparent;color:${T.textSub};border:1px solid ${T.border};}.inv-btn-out:hover:not(:disabled){background:${T.cardHover};color:${T.text};border-color:${T.borderHover};}
.inv-btn-danger{background:${SEMANTIC.danger.bg};color:${DA};border:1px solid ${SEMANTIC.danger.border};}.inv-btn-danger:hover:not(:disabled){background:rgba(225,90,90,0.20);}
.inv-btn-sm{font-size:${FONT.xs.size+1}px;padding:${SPACING.xs+1}px ${SPACING.md-1}px;}
.inv-card-hd .inv-btn{color:#0f172a !important;}
.inv-page-safe{max-width:100%;overflow-x:hidden;}
.inv-grid-safe{min-width:0;max-width:100%;}
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

const ETAPES_CLIENT = [
  "1 Signature contrat",
  "2 Envoi des documents d'analyse",
  "3 Définition de la stratégie d'investissement",
  "4 Recherche du projet (visites et analyse)",
  "5 Présentation des projets",
  "6 Offre d'achat",
  "7 Réalisation des devis précis",
  "8 Signature du compromis",
  "9 Réalisation du dossier bancaire",
  "10 Obtention du financement",
  "11 Réalisation des dossiers d'urbanismes",
  "12 Validation des conditions suspensives d'achat",
  "13 Signature Notaire",
];

const TYPES_PLANNING_INVEST = [
  "Visite de bien",
  "RDV client",
  "Relance commerciale",
  "Point interne",
  "Signature",
  "Autre",
];

const isoDate = (d) => d.toISOString().slice(0, 10);
const getWeekRange = (base = new Date()) => {
  const d = new Date(base);
  d.setHours(12, 0, 0, 0);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { today: isoDate(d), startWeek: isoDate(monday), endWeek: isoDate(sunday) };
};

const isActionLateOrThisWeek = (item) => {
  const { today, endWeek } = getWeekRange();
  return !!(item?.prochaine_action && item?.date_prochaine_action && item.date_prochaine_action <= endWeek);
};

const normTxt = (v) => String(v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function compareValues(a, b, direction = "asc") {
  const mult = direction === "asc" ? 1 : -1;
  if (a === null || a === undefined || a === "") return 1;
  if (b === null || b === undefined || b === "") return -1;
  const na = Number(a), nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return (na - nb) * mult;
  return String(a).localeCompare(String(b), "fr", { numeric:true, sensitivity:"base" }) * mult;
}

function SortableHeader({ label, sortKey, sortConfig, onSort, T, align="left" }) {
  const active = sortConfig?.key === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      style={{
        border:"none", background:"transparent", color:active ? T.accent : T.textMuted,
        fontFamily:"inherit", fontSize:"inherit", fontWeight:800, textTransform:"uppercase",
        letterSpacing:0.8, cursor:"pointer", textAlign:align, padding:0,
        display:"inline-flex", alignItems:"center", gap:4, justifyContent:align === "right" ? "flex-end" : "flex-start",
      }}
      title={`Trier par ${label}`}
    >
      {label}
      <span style={{fontSize:10, opacity:active ? 1 : .35}}>{active ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}</span>
    </button>
  );
}

function KPICard({ label, value, color, icon: IconComp, onClick, sub }) {
  const c = color || "#FFC200";
  return (
    <div className="inv-kpi" onClick={onClick} style={{
      display:"flex", flexDirection:"row", alignItems:"center", gap:SPACING.md,
      borderLeft:`3px solid ${c}`, cursor:onClick ? "pointer" : "default",
    }}
      onMouseEnter={e=>{ if(onClick) e.currentTarget.style.transform="translateY(-1px)"; }}
      onMouseLeave={e=>{ if(onClick) e.currentTarget.style.transform="none"; }}>
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
        {sub && <div style={{fontSize:FONT.xs.size, color:"inherit", opacity:.65, marginTop:3}}>{sub}</div>}
      </div>
    </div>
  );
}



const DASH_STAGE_COLORS = ["#4db8ff", "#50c878", "#FFC200", "#c084fc", "#fb7185", "#38bdf8", "#f97316", "#a3e635", "#facc15", "#22c55e", "#60a5fa", "#e879f9", "#94a3b8"];

const fmtDashboardEur = (v) => Number(v || 0) > 0
  ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits:0 }).format(Number(v || 0)) + " €"
  : "—";
const fmtDashboardPct = (v) => Number.isFinite(Number(v)) ? Number(v).toFixed(1).replace(".", ",") + " %" : "—";
const safeDate = (d) => d ? new Date(d).toLocaleDateString("fr-FR", { day:"2-digit", month:"short" }) : "—";
const daysBetween = (from, to = new Date()) => {
  if (!from) return null;
  const a = new Date(from); a.setHours(12,0,0,0);
  const b = new Date(to); b.setHours(12,0,0,0);
  return Math.round((b - a) / 86400000);
};
const isFilledDash = (v) => v !== null && v !== undefined && String(v).trim() !== "";
const getClientName = (c) => `${c?.prenom || ""} ${c?.nom || ""}`.trim() || c?.nom || "Client";
const getBienLabel = (b) => [b?.reference_interne, b?.adresse, b?.ville].filter(Boolean).join(" · ") || "Bien sans adresse";
const getBienScore = (b) => {
  const v = b?.visite_data || {};
  const note = parseFloat(v?.conclusion?.note_globale || 0);
  const rendement = parseFloat(b?.rendement_brut || v?.finance?.rendement_brut || 0);
  const cashflow = parseFloat(b?.cashflow_estime || v?.finance?.cashflow_mensuel_estime || 0);
  let score = 0;
  if (note > 0) score += Math.min(10, note) * 10;
  if (rendement > 0) score += Math.min(15, rendement) * 3;
  if (cashflow > 0) score += Math.min(500, cashflow) / 20;
  if (["Offre à faire", "Visité", "À analyser", "A analyser"].includes(b?.statut)) score += 12;
  if (["Offre envoyée", "Offre acceptée"].includes(b?.statut)) score += 18;
  return Math.round(score);
};
const isBienFicheComplete = (b) => {
  const v = b?.visite_data || {};
  return !!(
    isFilledDash(b?.adresse) &&
    isFilledDash(b?.ville) &&
    isFilledDash(v?.conclusion?.recommandation) &&
    isFilledDash(v?.finance?.budget_travaux_ttc || b?.prix_travaux) &&
    Array.isArray(v?.configuration?.lots) && v.configuration.lots.length > 0
  );
};
const hasSimulateurBien = (b) => !!(b?.visite_data?.simulateur || b?.visite_data?.simulateur_updated_at);
const isGeolocBien = (b) => Number.isFinite(parseFloat(b?.latitude)) && Number.isFinite(parseFloat(b?.longitude));


// ─── MODULES D’AIDE À LA DÉCISION — CLIENTS / BIENS ─────────────────────────
const CLIENT_STRATEGIES_INVEST = ["", "Cash-flow", "Patrimoine", "Fiscalité", "Revente à terme", "Diversification", "Premier investissement"];
const CLIENT_TRAVAUX_ACCEPTES = ["", "Léger", "Moyen", "Lourd", "Création de lots", "À éviter", "À préciser"];
const CLIENT_URGENCE_INVEST = ["", "Immédiate", "1 à 3 mois", "3 à 6 mois", "6 à 12 mois", "Veille opportuniste"];
const CLIENT_FISCALITES_INVEST = ["", "LMNP réel", "SCI IS", "SCI IR", "Location nue", "À arbitrer", "Non défini"];
const OFFRE_STATUTS_INVEST = ["", "À préparer", "À envoyer", "Envoyée", "Relance à faire", "Acceptée", "Refusée", "Abandonnée"];

const CLIENT_DOCUMENT_CHECKLIST = [
  ["identite", "Pièce d’identité"],
  ["solvabilite", "Dossier de solvabilité / banque"],
  ["strategie", "Stratégie d’investissement validée"],
  ["accord_mandat", "Contrat / mandat Profero signé"],
  ["simulation", "Simulation bancaire ou enveloppe validée"],
];
const BIEN_DOCUMENT_CHECKLIST = [
  ["diagnostics", "Diagnostics / DDT"],
  ["taxe_fonciere", "Taxe foncière"],
  ["plans", "Plans / croquis"],
  ["devis", "Devis travaux"],
  ["pv_ag", "PV d’AG / règlement copropriété"],
  ["urbanisme", "Documents urbanisme / PLU"],
  ["photos", "Photos du bien"],
  ["titre_baux", "Titre de propriété / baux existants"],
];

const emptyClientStrategy = (client = {}) => ({
  objectif: "", budget_max: client.budget || "", apport: "", zones: "", rendement_min: "", strategie: "",
  travaux_acceptes: "", urgence: "", fiscalite: "", remarques: "", documents_checklist: {},
});
const clientStrategy = (client = {}) => ({ ...emptyClientStrategy(client), ...(client?.strategie_data || {}) });
const checklistPct = (checklist = {}, items = []) => {
  if (!items.length) return 0;
  const done = items.filter(([k]) => checklist?.[k] === "recu" || checklist?.[k] === true).length;
  return Math.round((done / items.length) * 100);
};
const getNumberLoose = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9,.-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const bienTotalCost = (b = {}) => getNumberLoose(b.cout_total) || (getNumberLoose(b.prix_vente) + getNumberLoose(b.prix_travaux));
const bienLotsCount = (b = {}) => Array.isArray(b?.visite_data?.configuration?.lots) ? b.visite_data.configuration.lots.filter(l => l && (l.type || l.surface || l.loyer)).length : 0;
const computeAutoBienScore = (b = {}) => {
  const v = b.visite_data || {};
  const rendement = getNumberLoose(b.rendement_brut || v.finance?.rendement_brut || v.finance?.rendement_brut_calcule);
  const cashflow = getNumberLoose(b.cashflow_estime || v.finance?.cashflow_mensuel || v.finance?.cashflow_mensuel_estime);
  const note = getNumberLoose(v.conclusion?.note_globale);
  const reco = v.conclusion?.recommandation || "";
  const completion = isBienFicheComplete(b) ? 100 : 45;
  const riskItems = Object.values(v.risques?.controles || {});
  const problems = riskItems.filter(x => x?.statut === "Problème").length;
  const checks = riskItems.filter(x => x?.statut === "À vérifier").length;
  let score = 0;
  score += Math.min(30, rendement * 2.1);
  score += cashflow > 0 ? Math.min(20, cashflow / 25) : Math.max(-10, cashflow / 50);
  score += note > 0 ? Math.min(20, note * 2) : 0;
  score += completion >= 100 ? 10 : 3;
  score += reco === "Passer à l'offre" ? 12 : reco === "Approfondir" ? 6 : reco === "Abandonner" ? -18 : 0;
  score -= problems * 7 + checks * 2;
  return Math.max(0, Math.min(100, Math.round(score)));
};
const computeClientBienMatch = (client = {}, bien = {}) => {
  const strat = clientStrategy(client);
  const budget = getNumberLoose(strat.budget_max || client.budget);
  const total = bienTotalCost(bien);
  const rendement = getNumberLoose(bien.rendement_brut || bien.visite_data?.finance?.rendement_brut || bien.visite_data?.finance?.rendement_brut_calcule);
  const rendMin = getNumberLoose(strat.rendement_min);
  const zones = normTxt(strat.zones || "");
  const loc = normTxt(`${bien.ville || ""} ${bien.code_postal || ""} ${bien.adresse || ""}`);
  const travaux = getNumberLoose(bien.prix_travaux || bien.visite_data?.finance?.budget_travaux_ttc);
  const reasons = [];
  let score = 35;
  if (budget > 0 && total > 0) {
    const ratio = total / budget;
    if (ratio <= 1) { score += 25; reasons.push("budget compatible"); }
    else if (ratio <= 1.10) { score += 12; reasons.push("budget proche"); }
    else { score -= 22; reasons.push("hors budget"); }
  }
  if (rendMin > 0 && rendement > 0) {
    if (rendement >= rendMin) { score += 20; reasons.push("rendement cible atteint"); }
    else { score -= 10; reasons.push("rendement sous cible"); }
  } else if (rendement >= 8) { score += 10; reasons.push("rendement attractif"); }
  if (zones && loc && zones.split(/[;,]/).some(z => z.trim() && loc.includes(z.trim()))) { score += 15; reasons.push("zone recherchée"); }
  if (strat.travaux_acceptes === "Léger" && travaux > 60000) { score -= 10; reasons.push("travaux importants"); }
  if (strat.travaux_acceptes === "Lourd" && travaux > 0) { score += 6; reasons.push("travaux acceptés"); }
  if (strat.strategie && normTxt(strat.strategie).includes("cash") && getNumberLoose(bien.cashflow_estime) > 0) { score += 10; reasons.push("cash-flow positif"); }
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
};


function DashboardPanel({ title, icon: IconComp, subtitle, children, T=THEMES_INV.dark, action }) {
  return (
    <div className="inv-card" style={{ marginBottom:SPACING.xxl-2 }}>
      <div className="inv-card-hd blue" style={{ alignItems:"center" }}>
        <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
          {IconComp && <Icon as={IconComp} size={13} strokeWidth={2.2}/>}
          {title}
        </span>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {subtitle && <span style={{ fontSize:FONT.xs.size, color:T.textMuted, textTransform:"none", letterSpacing:0, fontWeight:600 }}>{subtitle}</span>}
          {action}
        </div>
      </div>
      <div className="inv-card-bd">{children}</div>
    </div>
  );
}

function DashboardAlertList({ items=[], T=THEMES_INV.dark, empty="Aucune alerte" }) {
  return (
    <div style={{display:"flex", flexDirection:"column", gap:8}}>
      {items.length === 0 ? (
        <div style={{padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, color:T.textMuted, textAlign:"center", fontSize:FONT.sm.size+1, fontStyle:"italic"}}>{empty}</div>
      ) : items.map((it, idx) => (
        <button key={idx} type="button" onClick={it.onClick}
          style={{
            display:"flex", alignItems:"center", gap:SPACING.sm+2, textAlign:"left",
            background:T.input, border:`1px solid ${it.color || T.border}`, borderRadius:RADIUS.md,
            padding:`${SPACING.sm+2}px ${SPACING.md}px`, cursor:it.onClick ? "pointer" : "default",
            fontFamily:"inherit", transition:"all .12s",
          }}
          onMouseEnter={e=>{ if(it.onClick){ e.currentTarget.style.transform="translateY(-1px)"; e.currentTarget.style.background=T.cardHover; } }}
          onMouseLeave={e=>{ e.currentTarget.style.transform="none"; e.currentTarget.style.background=T.input; }}>
          <span style={{width:28,height:28,borderRadius:RADIUS.sm+1,background:`${it.color || T.accent}18`,color:it.color || T.accent,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <Icon as={it.icon || AlertTriangle} size={14} strokeWidth={2.2}/>
          </span>
          <span style={{minWidth:0, flex:1}}>
            <span style={{display:"block",fontSize:FONT.sm.size+1,fontWeight:800,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.title}</span>
            <span style={{display:"block",fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:2,lineHeight:1.35}}>{it.sub}</span>
          </span>
          {it.badge && <span style={{fontSize:FONT.xs.size,fontWeight:800,color:it.color || T.accent,background:`${it.color || T.accent}14`,border:`1px solid ${(it.color || T.accent)}33`,borderRadius:RADIUS.pill,padding:"3px 8px",whiteSpace:"nowrap"}}>{it.badge}</span>}
        </button>
      ))}
    </div>
  );
}


const FILE_ICONS = {
  pdf: "📄", doc: "📝", docx: "📝", xls: "📊", xlsx: "📊",
  jpg: "🖼️", jpeg: "🖼️", png: "🖼️", gif: "🖼️", webp: "🖼️",
  zip: "🗜️", rar: "🗜️", mp4: "🎥", mp3: "🎵", txt: "📃",
};

const DOCUMENT_CATEGORIES_BIEN = [
  { id:"photos", label:"Photos", icon:"🖼️" },
  { id:"devis", label:"Devis", icon:"📄" },
  { id:"plans", label:"Plans", icon:"📐" },
  { id:"autres", label:"Autres", icon:"📎" },
];


const GOOGLE_DRIVE_API_KEY = (
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_GOOGLE_DRIVE_API_KEY)
  || (typeof process !== "undefined" && process.env && process.env.REACT_APP_GOOGLE_DRIVE_API_KEY)
  || ""
);
const GOOGLE_DRIVE_CLIENT_ID = (
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID)
  || (typeof process !== "undefined" && process.env && process.env.REACT_APP_GOOGLE_DRIVE_CLIENT_ID)
  || ""
);
const GOOGLE_DRIVE_APP_ID = (
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_GOOGLE_DRIVE_APP_ID)
  || (typeof process !== "undefined" && process.env && process.env.REACT_APP_GOOGLE_DRIVE_APP_ID)
  || ""
);
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const GOOGLE_DRIVE_LINKS_TABLE = "invest_drive_links";

function getGoogleDriveConfig() {
  return {
    apiKey: (GOOGLE_DRIVE_API_KEY || "").trim(),
    clientId: (GOOGLE_DRIVE_CLIENT_ID || "").trim(),
    appId: (GOOGLE_DRIVE_APP_ID || "").trim(),
  };
}

const GOOGLE_DRIVE_SCRIPT_PROMISES = {};
let GOOGLE_DRIVE_LIBRARIES_PROMISE = null;

function loadExternalScriptOnce(src, id, isReady) {
  if (typeof window === "undefined") return Promise.reject(new Error("Navigateur indisponible"));
  if (typeof isReady === "function" && isReady()) return Promise.resolve();
  const key = id || src;
  if (GOOGLE_DRIVE_SCRIPT_PROMISES[key]) return GOOGLE_DRIVE_SCRIPT_PROMISES[key];

  GOOGLE_DRIVE_SCRIPT_PROMISES[key] = new Promise((resolve, reject) => {
    const existing = (id && document.getElementById(id)) || [...document.scripts].find(s => s.src === src);
    const finish = () => {
      const start = Date.now();
      const check = () => {
        if (!isReady || isReady()) return resolve();
        if (Date.now() - start > 10000) return reject(new Error(`Chargement Google incomplet : ${src}`));
        window.setTimeout(check, 80);
      };
      check();
    };

    if (existing) {
      existing.addEventListener?.("load", finish, { once:true });
      existing.addEventListener?.("error", () => reject(new Error(`Impossible de charger ${src}`)), { once:true });
      finish();
      return;
    }

    const script = document.createElement("script");
    if (id) script.id = id;
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = finish;
    script.onerror = () => reject(new Error(`Impossible de charger ${src}`));
    document.head.appendChild(script);
  }).catch((e) => {
    delete GOOGLE_DRIVE_SCRIPT_PROMISES[key];
    throw e;
  });

  return GOOGLE_DRIVE_SCRIPT_PROMISES[key];
}

async function ensureGoogleDriveLibrariesLoaded() {
  if (typeof window !== "undefined" && window.google?.accounts?.oauth2 && window.google?.picker) return;
  if (GOOGLE_DRIVE_LIBRARIES_PROMISE) return GOOGLE_DRIVE_LIBRARIES_PROMISE;

  GOOGLE_DRIVE_LIBRARIES_PROMISE = (async () => {
    await loadExternalScriptOnce(
      "https://accounts.google.com/gsi/client",
      "google-gsi-client",
      () => !!window.google?.accounts?.oauth2
    );
    await loadExternalScriptOnce(
      "https://apis.google.com/js/api.js",
      "google-api-js",
      () => !!window.gapi
    );
    if (!window.gapi) throw new Error("Google API indisponible");
    if (!window.google?.picker) {
      await new Promise((resolve, reject) => {
        let done = false;
        const finish = () => { if (!done) { done = true; window.clearTimeout(timer); resolve(); } };
        const fail = (msg) => { if (!done) { done = true; window.clearTimeout(timer); reject(new Error(msg)); } };
        const timer = window.setTimeout(() => fail("Google Picker ne répond pas. Rechargez la page puis réessayez."), 12000);
        window.gapi.load("picker", {
          callback: finish,
          onerror: () => fail("Google Picker indisponible"),
          ontimeout: () => fail("Google Picker indisponible"),
          timeout: 12000,
        });
      });
    }
  })().catch((e) => {
    GOOGLE_DRIVE_LIBRARIES_PROMISE = null;
    throw e;
  });

  return GOOGLE_DRIVE_LIBRARIES_PROMISE;
}

const GOOGLE_DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const GOOGLE_DRIVE_SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

function isGoogleDriveFolderMime(mimeType) {
  return String(mimeType || "").toLowerCase() === GOOGLE_DRIVE_FOLDER_MIME;
}

function isGoogleDriveShortcutMime(mimeType) {
  return String(mimeType || "").toLowerCase() === GOOGLE_DRIVE_SHORTCUT_MIME;
}

function getDriveEffectiveId(doc) {
  return doc?.shortcutDetails?.targetId || doc?.shortcut_details?.targetId || doc?.targetId || doc?.id || doc?.fileId || doc?.file_id || doc?.[window.google?.picker?.Document?.ID] || "";
}

function getDriveEffectiveMimeType(doc) {
  return doc?.shortcutDetails?.targetMimeType || doc?.shortcut_details?.targetMimeType || doc?.targetMimeType || doc?.mimeType || doc?.mime_type || doc?.[window.google?.picker?.Document?.MIME_TYPE] || "";
}

function isGoogleDriveFolderItem(doc) {
  return isGoogleDriveFolderMime(getDriveEffectiveMimeType(doc));
}

function isGoogleDriveShortcutItem(doc) {
  return isGoogleDriveShortcutMime(doc?.mimeType || doc?.mime_type);
}

function getDriveUrlForDoc(id, mimeType, fallbackUrl = "") {
  if (fallbackUrl) return fallbackUrl;
  if (!id || String(id).startsWith("manual_")) return "";
  return isGoogleDriveFolderMime(mimeType)
    ? `https://drive.google.com/drive/folders/${id}`
    : `https://drive.google.com/open?id=${id}`;
}

function normalizeDriveDoc(doc) {
  const rawId = doc?.id || doc?.fileId || doc?.file_id || doc?.[window.google?.picker?.Document?.ID] || `manual_${Date.now()}`;
  const id = getDriveEffectiveId(doc) || rawId;
  const name = doc?.name || doc?.title || doc?.[window.google?.picker?.Document?.NAME] || "Document Google Drive";
  const mimeType = getDriveEffectiveMimeType(doc);
  const url = getDriveUrlForDoc(id, mimeType, doc?.url || doc?.webViewLink || doc?.[window.google?.picker?.Document?.URL] || "");
  const iconUrl = doc?.iconUrl || doc?.iconLink || doc?.[window.google?.picker?.Document?.ICON_URL] || "";
  const sizeBytes = Number(doc?.sizeBytes || doc?.size || 0) || null;
  return { id, name, mimeType, url, iconUrl, sizeBytes };
}

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


function GoogleDriveLinksSection({ folder, T = THEMES_INV.dark, profil = null }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("");
  const [folderContents, setFolderContents] = useState({});
  const [folderLoadingId, setFolderLoadingId] = useState("");
  const [driveExplorerOpen, setDriveExplorerOpen] = useState(false);
  const [driveExplorerLoading, setDriveExplorerLoading] = useState(false);
  const [driveExplorerItems, setDriveExplorerItems] = useState([]);
  const [driveExplorerFolderId, setDriveExplorerFolderId] = useState("root");
  const [driveExplorerPath, setDriveExplorerPath] = useState([{ id:"root", name:"Mon Drive" }]);
  const tokenRef = useRef("");
  const tokenClientRef = useRef(null);

  const cfg = getGoogleDriveConfig();
  const isConfigured = !!cfg.apiKey && !!cfg.clientId;

  useEffect(() => {
    let alive = true;
    if (!isConfigured) {
      setGoogleReady(false);
      setGoogleLoading(false);
      setStatus("");
      return () => { alive = false; };
    }
    setGoogleLoading(true);
    setStatus("Préparation Google Drive…");
    setErr(prev => prev && prev.includes("Google Drive") ? "" : prev);
    ensureGoogleDriveLibrariesLoaded()
      .then(() => {
        if (!alive) return;
        setGoogleReady(true);
        setGoogleLoading(false);
        setStatus("");
      })
      .catch((e) => {
        if (!alive) return;
        setGoogleReady(false);
        setGoogleLoading(false);
        setStatus("");
        setErr(e?.message || "Impossible de préparer Google Drive");
      });
    return () => { alive = false; };
  }, [isConfigured]);

  const charger = useCallback(async () => {
    if (!folder) return;
    setLoading(true);
    const { data, error } = await supabase
      .from(GOOGLE_DRIVE_LINKS_TABLE)
      .select("*")
      .eq("folder", folder)
      .order("created_at", { ascending:false });
    if (error) {
      setErr(error.code === "42P01" ? "Table invest_drive_links introuvable. Lancez la migration SQL Google Drive." : error.message);
      setLinks([]);
    } else {
      setLinks(data || []);
      setErr("");
    }
    setLoading(false);
  }, [folder]);

  useEffect(() => { charger(); }, [charger]);

  const enregistrerDriveDocs = async (docs, source = "google_drive") => {
    const cleanDocs = (docs || []).map(normalizeDriveDoc).filter(d => d.id && d.name);
    if (!cleanDocs.length) return;
    const rows = cleanDocs.map(d => ({
      folder,
      file_id: d.id,
      name: d.name,
      mime_type: d.mimeType || null,
      url: d.url || getDriveUrlForDoc(d.id, d.mimeType),
      icon_url: d.iconUrl || null,
      size_bytes: d.sizeBytes || null,
      created_by: profil?.email || profil?.nom || null,
      metadata: { source, kind: isGoogleDriveFolderMime(d.mimeType) ? "folder" : "file" },
    }));
    const { error } = await supabase
      .from(GOOGLE_DRIVE_LINKS_TABLE)
      .upsert(rows, { onConflict:"folder,file_id" });
    if (error) {
      const msg = String(error.message || "");
      setErr(msg.includes("row-level security")
        ? "Supabase bloque l’enregistrement Drive (RLS). Lancez le correctif SQL invest_drive_links_rls_fix_v2.sql, puis réessayez."
        : msg
      );
      return;
    }
    await charger();
  };

  const demanderTokenGoogle = () => new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error("Google Identity Services n'est pas disponible."));
      return;
    }

    let finished = false;
    const timer = window.setTimeout(() => {
      if (finished) return;
      finished = true;
      reject(new Error("Aucune réponse de Google. Autorisez les pop-ups pour planning-chantiers.vercel.app et vérifiez que votre email est dans les utilisateurs de test OAuth."));
    }, 9000);

    const finish = (fn, value) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      fn(value);
    };

    tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: GOOGLE_DRIVE_SCOPE,
      callback: (tokenResponse) => {
        if (tokenResponse?.error) {
          finish(reject, new Error(tokenResponse.error_description || tokenResponse.error));
          return;
        }
        if (!tokenResponse?.access_token) {
          finish(reject, new Error("Google n'a pas renvoyé de jeton d'accès. Vérifiez les utilisateurs de test OAuth et les pop-ups."));
          return;
        }
        finish(resolve, tokenResponse.access_token);
      },
      error_callback: (error) => {
        const type = error?.type || error?.message || "popup_closed_or_failed";
        finish(reject, new Error(type === "popup_failed_to_open" ? "La fenêtre Google a été bloquée par le navigateur. Autorisez les pop-ups pour ce site." : `Connexion Google interrompue : ${type}`));
      },
    });

    tokenClientRef.current.requestAccessToken({ prompt: tokenRef.current ? "" : "consent" });
  });

  const obtenirToken = async () => {
    const token = tokenRef.current || await demanderTokenGoogle();
    tokenRef.current = token;
    return token;
  };

  const fetchDriveFolderItems = async (folderId = "root") => {
    const token = await obtenirToken();
    const safeFolderId = String(folderId || "root").replace(/'/g, "\\'");
    const params = new URLSearchParams({
      q: `'${safeFolderId}' in parents and trashed = false`,
      pageSize: "100",
      orderBy: "folder,name_natural",
      fields: "files(id,name,mimeType,webViewLink,iconLink,size,modifiedTime,shortcutDetails(targetId,targetMimeType))",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `Erreur Drive ${res.status}`);
    return json.files || [];
  };

  const openDriveExplorerAt = async (folderId = "root", path = [{ id:"root", name:"Mon Drive" }]) => {
    if (!checkReadyOrExplain()) return;
    setDriveExplorerOpen(true);
    setDriveExplorerLoading(true);
    setErr("");
    setStatus("Connexion à Google Drive…");
    try {
      const items = await fetchDriveFolderItems(folderId);
      setDriveExplorerFolderId(folderId);
      setDriveExplorerPath(path);
      setDriveExplorerItems(items);
      setStatus(items.length ? "" : "Dossier Drive ouvert : aucun fichier visible dans ce dossier.");
    } catch (e) {
      setErr(e?.message || "Impossible de lire Google Drive");
      setStatus("");
    } finally {
      setDriveExplorerLoading(false);
    }
  };

  const ouvrirExplorateurDrive = async (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    await openDriveExplorerAt("root", [{ id:"root", name:"Mon Drive" }]);
  };

  const ouvrirDossierExplorateur = async (item) => {
    const targetId = getDriveEffectiveId(item);
    if (!targetId) return;
    await openDriveExplorerAt(targetId, [...driveExplorerPath, { id:targetId, name:item.name || "Dossier" }]);
  };

  const allerBreadcrumbDrive = async (index) => {
    const path = driveExplorerPath.slice(0, index + 1);
    const target = path[path.length - 1] || { id:"root", name:"Mon Drive" };
    await openDriveExplorerAt(target.id, path);
  };

  const lierDossierExplorateur = async () => {
    const current = driveExplorerPath[driveExplorerPath.length - 1] || { id:"root", name:"Mon Drive" };
    if (!current?.id) return;
    setWorking(true);
    setStatus("Sauvegarde du dossier Drive sur cette fiche…");
    try {
      await enregistrerDriveDocs([{
        id: current.id,
        name: current.name || "Dossier Google Drive",
        mimeType: GOOGLE_DRIVE_FOLDER_MIME,
        webViewLink: getDriveUrlForDoc(current.id, GOOGLE_DRIVE_FOLDER_MIME),
      }], "google_drive_explorer_folder_saved_to_record");
      setStatus("Dossier Drive sauvegardé sur cette fiche. Il restera visible après rechargement.");
      window.setTimeout(() => setStatus(""), 4500);
    } finally {
      setWorking(false);
    }
  };

  const lierDossierDepuisItem = async (item, source = "google_drive_explorer_folder_item") => {
    const folderId = getDriveEffectiveId(item);
    const folderName = item?.name || "Dossier Google Drive";
    if (!folderId) return;
    setWorking(true);
    setStatus("Sauvegarde du dossier Drive sur cette fiche…");
    try {
      await enregistrerDriveDocs([{
        id: folderId,
        name: folderName,
        mimeType: GOOGLE_DRIVE_FOLDER_MIME,
        webViewLink: item?.webViewLink || getDriveUrlForDoc(folderId, GOOGLE_DRIVE_FOLDER_MIME),
        iconLink: item?.iconLink || null,
      }], source);
      setStatus("Dossier Drive sauvegardé sur cette fiche.");
      window.setTimeout(() => setStatus(""), 3500);
    } finally {
      setWorking(false);
    }
  };

  const lierTousLesFichiersExplorateur = async () => {
    const files = (driveExplorerItems || []).filter(f => !isGoogleDriveFolderItem(f));
    if (!files.length) {
      setErr("Aucun fichier à lier dans ce dossier. Ouvrez un autre dossier Drive.");
      return;
    }
    await lierFichiersDuDossier(files);
  };

  const checkReadyOrExplain = () => {
    if (!isConfigured) {
      setErr("Configuration Google Drive incomplète : ajoutez VITE_GOOGLE_DRIVE_API_KEY et VITE_GOOGLE_DRIVE_CLIENT_ID.");
      return false;
    }
    if (!googleReady) {
      setErr("Google Drive est encore en préparation. Attendez 2 secondes puis réessayez.");
      return false;
    }
    if (!window.google?.accounts?.oauth2 || !window.google?.picker) {
      setErr("Les librairies Google Drive ne sont pas prêtes. Rechargez la page puis réessayez.");
      return false;
    }
    return true;
  };

  const ouvrirPickerFichiersAvecToken = (accessToken) => {
    if (!window.google?.picker) throw new Error("Google Picker n'est pas disponible.");
    setStatus("Ouverture du sélecteur de fichiers Google Drive…");

    const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);

    const builder = new window.google.picker.PickerBuilder()
      .addView(view)
      .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(accessToken)
      .setDeveloperKey(cfg.apiKey)
      .setOrigin(window.location.origin)
      .setCallback(async (data) => {
        const action = data?.[window.google.picker.Response?.ACTION] || data?.action;
        const docs = data?.[window.google.picker.Response?.DOCUMENTS] || data?.docs || [];

        if (action === window.google.picker.Action.PICKED || action === "picked") {
          setWorking(true);
          setStatus("Enregistrement des liens Drive…");
          try {
            await enregistrerDriveDocs(docs, "google_picker_files");
            setStatus("");
          } finally {
            setWorking(false);
          }
          return;
        }

        if (action === window.google.picker.Action.CANCEL || action === "cancel") {
          setStatus("");
          setWorking(false);
        }
      });

    if (cfg.appId) builder.setAppId(cfg.appId);
    const picker = builder.build();
    picker.setVisible(true);
    setWorking(false);
    window.setTimeout(() => setStatus(prev => prev === "Ouverture du sélecteur de fichiers Google Drive…" ? "" : prev), 2500);
  };

  const ouvrirPickerDossiersAvecToken = (accessToken) => {
    if (!window.google?.picker) throw new Error("Google Picker n'est pas disponible.");
    setStatus("Ouverture du sélecteur de dossiers Google Drive…");

    const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true);

    const builder = new window.google.picker.PickerBuilder()
      .addView(view)
      .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(accessToken)
      .setDeveloperKey(cfg.apiKey)
      .setOrigin(window.location.origin)
      .setCallback(async (data) => {
        const action = data?.[window.google.picker.Response?.ACTION] || data?.action;
        const docs = data?.[window.google.picker.Response?.DOCUMENTS] || data?.docs || [];

        if (action === window.google.picker.Action.PICKED || action === "picked") {
          setWorking(true);
          setStatus("Liaison du dossier Drive…");
          try {
            const folders = (docs || []).map(d => ({ ...d, mimeType: d?.mimeType || GOOGLE_DRIVE_FOLDER_MIME }));
            await enregistrerDriveDocs(folders, "google_picker_folders");
            setStatus("Dossier Drive lié. Cliquez sur “Voir fichiers” pour afficher son contenu.");
            window.setTimeout(() => setStatus(""), 3500);
          } finally {
            setWorking(false);
          }
          return;
        }

        if (action === window.google.picker.Action.CANCEL || action === "cancel") {
          setStatus("");
          setWorking(false);
        }
      });

    if (cfg.appId) builder.setAppId(cfg.appId);
    const picker = builder.build();
    picker.setVisible(true);
    setWorking(false);
    window.setTimeout(() => setStatus(prev => prev === "Ouverture du sélecteur de dossiers Google Drive…" ? "" : prev), 2500);
  };

  const ouvrirPicker = async (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!checkReadyOrExplain()) return;

    setWorking(true);
    setErr("");
    setStatus("Ouverture de l'autorisation Google…");

    try {
      const token = await obtenirToken();
      ouvrirPickerFichiersAvecToken(token);
    } catch (e) {
      setErr(e?.message || "Impossible d'ouvrir Google Drive");
      setStatus("");
      setWorking(false);
    }
  };

  const choisirDossierDrive = async (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!checkReadyOrExplain()) return;

    setWorking(true);
    setErr("");
    setStatus("Ouverture de l'autorisation Google…");

    try {
      const token = await obtenirToken();
      ouvrirPickerDossiersAvecToken(token);
    } catch (e) {
      setErr(e?.message || "Impossible d'ouvrir les dossiers Google Drive");
      setStatus("");
      setWorking(false);
    }
  };

  const listerContenuDossier = async (driveFolder) => {
    if (!driveFolder?.file_id) return;
    setErr("");
    setStatus("Lecture du dossier Drive…");
    setFolderLoadingId(driveFolder.file_id);
    try {
      const token = await obtenirToken();
      const params = new URLSearchParams({
        q: `'${String(driveFolder.file_id).replace(/'/g, "\\'")}' in parents and trashed = false`,
        pageSize: "100",
        orderBy: "folder,name_natural",
        fields: "files(id,name,mimeType,webViewLink,iconLink,size,modifiedTime,shortcutDetails(targetId,targetMimeType))",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      });
      const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Erreur Drive ${res.status}`);
      setFolderContents(prev => ({ ...prev, [driveFolder.file_id]: json.files || [] }));
      setStatus("");
    } catch (e) {
      setErr(e?.message || "Impossible de lire le dossier Drive");
      setStatus("");
    } finally {
      setFolderLoadingId("");
    }
  };

  const lierFichiersDuDossier = async (files) => {
    const onlyFiles = (files || []).filter(f => !isGoogleDriveFolderItem(f));
    if (!onlyFiles.length) return;
    setWorking(true);
    setStatus("Liaison des fichiers du dossier…");
    try {
      await enregistrerDriveDocs(onlyFiles, "google_drive_folder_content");
      setStatus("");
    } finally {
      setWorking(false);
    }
  };

  const ajouterLienManuel = async (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const url = window.prompt("Collez le lien Google Drive du document ou du dossier :");
    if (!url) return;
    const isFolderUrl = /\/folders\//.test(String(url));
    const name = window.prompt("Nom du document ou du dossier :", isFolderUrl ? "Dossier Google Drive" : "Document Google Drive") || (isFolderUrl ? "Dossier Google Drive" : "Document Google Drive");
    const fileMatch = String(url).match(/\/folders\/([^/?#]+)|\/d\/([^/]+)|id=([^&]+)/);
    const fileId = fileMatch?.[1] || fileMatch?.[2] || fileMatch?.[3] || `manual_${Date.now()}`;
    const { error } = await supabase.from(GOOGLE_DRIVE_LINKS_TABLE).upsert([{
      folder,
      file_id: fileId,
      name,
      mime_type: isFolderUrl ? GOOGLE_DRIVE_FOLDER_MIME : null,
      url,
      icon_url: null,
      size_bytes: null,
      created_by: profil?.email || profil?.nom || null,
      metadata: { source:"manual_link", kind: isFolderUrl ? "folder" : "file" },
    }], { onConflict:"folder,file_id" });
    if (error) setErr(error.message);
    else charger();
  };

  const supprimerLien = async (id, name) => {
    if (!window.confirm(`Retirer le lien Drive « ${name} » de l'application ?\nLe fichier ne sera pas supprimé de Google Drive.`)) return;
    const { error } = await supabase.from(GOOGLE_DRIVE_LINKS_TABLE).delete().eq("id", id);
    if (error) setErr(error.message);
    else charger();
  };

  const linkedIds = useMemo(() => new Set((links || []).map(l => l.file_id)), [links]);
  const folders = links.filter(l => isGoogleDriveFolderMime(l.mime_type) || l.metadata?.kind === "folder");
  const files = links.filter(l => !(isGoogleDriveFolderMime(l.mime_type) || l.metadata?.kind === "folder"));

  const renderDriveFileRow = (file, idx, fromFolderId = "") => {
    const isFolder = isGoogleDriveFolderItem(file);
    const effectiveId = getDriveEffectiveId(file);
    const effectiveMimeType = getDriveEffectiveMimeType(file);
    const isShortcut = isGoogleDriveShortcutItem(file);
    const alreadyLinked = linkedIds.has(effectiveId || file.id);
    return (
      <div key={`${file.id || idx}-${fromFolderId}`} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 8px", borderRadius:RADIUS.md, background:T.input, border:`1px solid ${T.border}` }}>
        {file.iconLink ? <img src={file.iconLink} alt="" style={{ width:16, height:16 }} /> : <span>{isFolder ? "📁" : getFileIcon(file.name)}</span>}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color:T.text, fontSize:12, fontWeight:800, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{file.name}</div>
          <div style={{ color:T.textSub, fontSize:10 }}>{isFolder ? (isShortcut ? "Raccourci dossier" : "Dossier") : (isShortcut ? "Raccourci fichier" : (file.mimeType || "Fichier"))}{file.size ? ` · ${fmtSize(Number(file.size))}` : ""}</div>
        </div>
        <button type="button" className="inv-btn inv-btn-sm" style={{ background:T.card, color:T.text, border:`1px solid ${T.border}` }} onClick={() => window.open(file.webViewLink || getDriveUrlForDoc(effectiveId || file.id, effectiveMimeType || file.mimeType), "_blank")}>Ouvrir</button>
        {isFolder ? (
          <button type="button" className="inv-btn inv-btn-sm inv-btn-blue" disabled={alreadyLinked || working} onClick={() => lierDossierDepuisItem(file, "google_drive_subfolder_from_linked_folder")}>
            {alreadyLinked ? "Dossier lié" : "Lier dossier"}
          </button>
        ) : (
          <button type="button" className="inv-btn inv-btn-sm inv-btn-blue" disabled={alreadyLinked || working} onClick={() => enregistrerDriveDocs([file], "google_drive_folder_content")}>
            {alreadyLinked ? "Déjà lié" : "Lier"}
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ marginTop:18, borderTop:`1px solid ${T.border}`, paddingTop:14 }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:10, marginBottom:10 }}>
        <div>
          <div style={{ color:T.text, fontWeight:900, fontSize:FONT.sm.size }}>Google Drive</div>
          <div style={{ color:T.textSub, fontSize:FONT.xs.size+1 }}>Naviguez dans les dossiers Drive, ouvrez uniquement le dossier choisi, puis liez les fichiers utiles à cette fiche.</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent:"flex-end" }}>
          <button type="button" className="inv-btn inv-btn-sm" style={{ background:T.input, color:T.text, border:`1px solid ${T.border}` }} onClick={ajouterLienManuel}>Coller un lien</button>
          <button type="button" className="inv-btn inv-btn-sm inv-btn-blue" onClick={ouvrirExplorateurDrive} disabled={working || googleLoading || driveExplorerLoading || (isConfigured && !googleReady)}>
            {driveExplorerLoading ? "Lecture Drive…" : working ? "Connexion…" : googleLoading ? "Préparation…" : "Explorer Google Drive"}
          </button>
        </div>
      </div>

      {!isConfigured && (
        <div style={{ fontSize:12, color:T.textSub, background:T.input, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, padding:"8px 10px", marginBottom:10 }}>
          Configuration requise : <strong style={{ color:T.text }}>VITE_GOOGLE_DRIVE_API_KEY</strong> et <strong style={{ color:T.text }}>VITE_GOOGLE_DRIVE_CLIENT_ID</strong> dans Vercel / .env.
        </div>
      )}
      {status && <div style={{ fontSize:12, color:T.accent || "#2563eb", background:T.accentBg || "rgba(37,99,235,.08)", border:`1px solid ${T.accentBorder || "rgba(37,99,235,.22)"}`, borderRadius:RADIUS.md, padding:"8px 10px", marginBottom:10 }}>ℹ {status}</div>}
      {err && <div style={{ fontSize:12, color:"#e05c5c", background:"rgba(224,92,92,.08)", border:"1px solid rgba(224,92,92,.2)", borderRadius:RADIUS.md, padding:"8px 10px", marginBottom:10 }}>⚠ {err}</div>}

      {driveExplorerOpen && (
        <div style={{ border:`1px solid ${T.border}`, background:T.card, borderRadius:RADIUS.lg, padding:10, marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:8 }}>
            <div style={{ minWidth:0 }}>
              <div style={{ color:T.text, fontSize:12, fontWeight:900 }}>Explorateur Google Drive</div>
              <div style={{ display:"flex", alignItems:"center", gap:4, flexWrap:"wrap", marginTop:4 }}>
                {driveExplorerPath.map((p, idx) => (
                  <React.Fragment key={`${p.id}-${idx}`}>
                    {idx > 0 && <span style={{ color:T.textMuted, fontSize:11 }}>›</span>}
                    <button type="button" onClick={() => allerBreadcrumbDrive(idx)} style={{ border:"none", background:"transparent", padding:0, color:idx === driveExplorerPath.length - 1 ? T.text : T.accent, fontSize:11, fontWeight:800, cursor:"pointer" }}>
                      {p.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            </div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", justifyContent:"flex-end" }}>
              <button type="button" className="inv-btn inv-btn-sm" style={{ background:T.input, color:T.text, border:`1px solid ${T.border}` }} onClick={() => openDriveExplorerAt(driveExplorerFolderId, driveExplorerPath)} disabled={driveExplorerLoading}>Actualiser</button>
              <button type="button" className="inv-btn inv-btn-sm" style={{ background:T.accentBg, color:T.accent, border:`1px solid ${T.accentBorder}` }} onClick={lierDossierExplorateur} disabled={working || driveExplorerFolderId === "root"}>Lier ce dossier à la fiche</button>
              <button type="button" className="inv-btn inv-btn-sm inv-btn-blue" onClick={lierTousLesFichiersExplorateur} disabled={working || driveExplorerLoading}>Lier tous les fichiers</button>
              <button type="button" className="inv-btn inv-btn-sm" style={{ background:T.input, color:T.text, border:`1px solid ${T.border}` }} onClick={() => setDriveExplorerOpen(false)}>Masquer</button>
            </div>
          </div>
          {driveExplorerLoading ? (
            <div style={{ color:T.textSub, fontSize:12, padding:"10px 0" }}>Lecture du dossier Google Drive…</div>
          ) : driveExplorerItems.length === 0 ? (
            <div style={{ color:T.textMuted, fontSize:12, padding:"10px 0", fontStyle:"italic" }}>Aucun fichier ou dossier visible ici.</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6, maxHeight:360, overflowY:"auto", paddingRight:4 }}>
              {driveExplorerItems.map((item, idx) => {
                const isFolder = isGoogleDriveFolderItem(item);
                const effectiveId = getDriveEffectiveId(item);
                const effectiveMimeType = getDriveEffectiveMimeType(item);
                const isShortcut = isGoogleDriveShortcutItem(item);
                const alreadyLinked = linkedIds.has(effectiveId || item.id);
                return (
                  <div key={`${item.id || idx}-explorer`} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 9px", borderRadius:RADIUS.md, background:T.input, border:`1px solid ${T.border}` }}>
                    {item.iconLink ? <img src={item.iconLink} alt="" style={{ width:16, height:16 }} /> : <span>{isFolder ? "📁" : getFileIcon(item.name)}</span>}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ color:T.text, fontSize:12, fontWeight:900, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.name}</div>
                      <div style={{ color:T.textSub, fontSize:10 }}>{isFolder ? (isShortcut ? "Raccourci dossier" : "Dossier") : (isShortcut ? "Raccourci fichier" : (item.mimeType || "Fichier"))}{item.size ? ` · ${fmtSize(Number(item.size))}` : ""}</div>
                    </div>
                    {isFolder ? (
                      <>
                        <button type="button" className="inv-btn inv-btn-sm" style={{ background:T.card, color:T.text, border:`1px solid ${T.border}` }} onClick={() => ouvrirDossierExplorateur(item)}>Ouvrir</button>
                        <button type="button" className="inv-btn inv-btn-sm inv-btn-blue" disabled={alreadyLinked || working} onClick={() => lierDossierDepuisItem(item, "google_drive_explorer_folder_item_saved_to_record")}>
                          {alreadyLinked ? "Dossier lié" : "Lier dossier"}
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="inv-btn inv-btn-sm" style={{ background:T.card, color:T.text, border:`1px solid ${T.border}` }} onClick={() => window.open(item.webViewLink || getDriveUrlForDoc(effectiveId || item.id, effectiveMimeType || item.mimeType), "_blank")}>Voir</button>
                        <button type="button" className="inv-btn inv-btn-sm inv-btn-blue" disabled={alreadyLinked || working} onClick={() => enregistrerDriveDocs([item], "google_drive_explorer_file")}>{alreadyLinked ? "Déjà lié" : "Lier"}</button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ color:T.textSub, fontSize:13, padding:"8px 0" }}>Chargement des liens Drive…</div>
      ) : links.length === 0 ? (
        <div style={{ color:T.textMuted, fontSize:13, padding:"8px 0", fontStyle:"italic" }}>
          Aucun document Google Drive lié. Cliquez sur <strong style={{ color:T.text }}>Explorer Google Drive</strong>, ouvrez ou sélectionnez le dossier client souhaité, puis cliquez sur <strong style={{ color:T.text }}>Lier dossier</strong> ou <strong style={{ color:T.text }}>Lier ce dossier à la fiche</strong>. Le dossier restera sauvegardé sur cette fiche.
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {folders.length > 0 && (
            <div>
              <div style={{ color:T.text, fontSize:12, fontWeight:900, marginBottom:6 }}>Dossiers Drive liés</div>
              <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                {folders.map(link => {
                  const content = folderContents[link.file_id] || [];
                  const filesOnly = content.filter(f => !isGoogleDriveFolderItem(f));
                  return (
                    <div key={link.id} style={{ padding:10, borderRadius:RADIUS.md, background:T.card, border:`1px solid ${T.border}` }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        {link.icon_url ? <img src={link.icon_url} alt="" style={{ width:18, height:18 }} /> : <span style={{ fontSize:18 }}>📁</span>}
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ color:T.text, fontSize:13, fontWeight:900, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{link.name}</div>
                          <div style={{ color:T.textSub, fontSize:11 }}>Dossier Drive · lié le {link.created_at ? new Date(link.created_at).toLocaleDateString("fr-FR") : "-"}</div>
                        </div>
                        <button type="button" className="inv-btn inv-btn-sm" style={{ background:T.accentBg, color:T.accent, border:`1px solid ${T.accentBorder}` }} onClick={() => window.open(link.url, "_blank")}>Ouvrir</button>
                        <button type="button" className="inv-btn inv-btn-sm" style={{ background:T.input, color:T.text, border:`1px solid ${T.border}` }} onClick={() => listerContenuDossier(link)} disabled={folderLoadingId === link.file_id}>
                          {folderLoadingId === link.file_id ? "Lecture…" : content.length ? "Actualiser" : "Voir fichiers"}
                        </button>
                        <button type="button" className="inv-btn inv-btn-sm" style={{ background:"rgba(225,90,90,.08)", color:"#e15a5a", border:"1px solid rgba(225,90,90,.25)" }} onClick={() => supprimerLien(link.id, link.name)}>Retirer</button>
                      </div>
                      {content.length > 0 && (
                        <div style={{ marginTop:10, display:"flex", flexDirection:"column", gap:6 }}>
                          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                            <div style={{ color:T.textSub, fontSize:11 }}>{content.length} élément(s) trouvé(s) dans ce dossier</div>
                            {filesOnly.length > 0 && <button type="button" className="inv-btn inv-btn-sm inv-btn-blue" onClick={() => lierFichiersDuDossier(filesOnly)}>Lier tous les fichiers</button>}
                          </div>
                          {content.map((file, idx) => renderDriveFileRow(file, idx, link.file_id))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {files.length > 0 && (
            <div>
              <div style={{ color:T.text, fontSize:12, fontWeight:900, marginBottom:6 }}>Documents Drive liés à la fiche</div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {files.map(link => (
                  <div key={link.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", borderRadius:RADIUS.md, background:T.card, border:`1px solid ${T.border}` }}>
                    {link.icon_url ? <img src={link.icon_url} alt="" style={{ width:18, height:18 }} /> : <span style={{ fontSize:18 }}>{getFileIcon(link.name)}</span>}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ color:T.text, fontSize:13, fontWeight:800, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{link.name}</div>
                      <div style={{ color:T.textSub, fontSize:11 }}>{link.created_at ? new Date(link.created_at).toLocaleDateString("fr-FR") : "Drive"}{link.mime_type ? ` · ${link.mime_type}` : ""}{link.size_bytes ? ` · ${fmtSize(Number(link.size_bytes))}` : ""}</div>
                    </div>
                    <button type="button" className="inv-btn inv-btn-sm" style={{ background:T.accentBg, color:T.accent, border:`1px solid ${T.accentBorder}` }} onClick={() => window.open(link.url, "_blank")}>Ouvrir</button>
                    <button type="button" className="inv-btn inv-btn-sm" style={{ background:"rgba(225,90,90,.08)", color:"#e15a5a", border:"1px solid rgba(225,90,90,.25)" }} onClick={() => supprimerLien(link.id, link.name)}>Retirer</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DocumentsSection({ folder, T = THEMES_INV.dark, categories = null }) {
  // folder = "clients/uuid" ou "biens/uuid"
  const [fichiers, setFichiers]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [uploading, setUploading]   = useState(false);
  const [uploadPct, setUploadPct]   = useState(0);
  const [erreur, setErreur]         = useState("");
  const [dragOver, setDragOver]     = useState(false);
  const fileRef                     = useRef();
  const hasCategories              = Array.isArray(categories) && categories.length > 0;
  const [activeCategory, setActiveCategory] = useState(hasCategories ? categories[0].id : "");
  const currentFolder              = hasCategories && activeCategory ? `${folder}/${activeCategory}` : folder;

  const BUCKET = "invest-documents";

  const charger = async () => {
    setLoading(true);
    const { data, error } = await supabase.storage.from(BUCKET).list(currentFolder, { sortBy: { column: "created_at", order: "desc" } });
    if (error) { setErreur("Bucket introuvable. Voir instructions ci-dessous."); setLoading(false); return; }
    setFichiers(data || []);
    setLoading(false);
    setErreur("");
  };

  useEffect(() => { charger(); }, [currentFolder]);

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
      const path  = `${currentFolder}/${uname}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (error) setErreur(`Erreur upload : ${error.message}`);
    }
    setUploading(false);
    charger();
  };

  const telecharger = async (nom) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(`${currentFolder}/${nom}`, 300);
    if (error || !data?.signedUrl) { alert("Impossible de générer le lien."); return; }
    window.open(data.signedUrl, "_blank");
  };

  const supprimer = async (nom) => {
    if (!window.confirm(`Supprimer "${nom}" ?`)) return;
    await supabase.storage.from(BUCKET).remove([`${currentFolder}/${nom}`]);
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
          style={{ background:"rgba(255,255,255,0.65)", color:"black", border:`1px solid ${T.border}` }}
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
        {hasCategories && (
          <div style={{display:"flex", gap:6, flexWrap:"wrap", marginBottom:12}}>
            {categories.map(cat => {
              const active = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  className="inv-btn inv-btn-sm"
                  onClick={() => setActiveCategory(cat.id)}
                  style={{
                    background: active ? T.accentBg : T.input,
                    color: active ? T.accent : T.textSub,
                    border: `1px solid ${active ? T.accentBorder : T.border}`,
                  }}
                >
                  <span>{cat.icon}</span> {cat.label}
                </button>
              );
            })}
          </div>
        )}

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
        <GoogleDriveLinksSection folder={currentFolder} T={T} profil={null} />
      </div>
    </div>
  );
}

// Liste des collaborateurs Profero Invest utilisée par MissionParcoursClientCard
// (CRM.jsx) et MissionActionsCollaborateursDashboard (Dashboard.jsx).
const MISSION_COLLABORATEURS = [
  "Matthieu", "Tom", "Quentin", "Camille", "Loris", "François",
  "Client", "Courtier / Banque", "Notaire", "Agence", "Enedis", "Gestion locative",
];

// Honoraires de référence Profero Invest — utilisés par DirectionPilotageDashboard
// (Dashboard.jsx) et DashboardFinancier (Finance.jsx) pour les calculs prévisionnels.
const HONORAIRE_BASE_CONTRAT_HT = 1583;
const HONORAIRE_CONSEIL_MOYEN_HT = 7500;

// Statuts possibles d'une proposition (bien proposé à un client) — référencé par
// CRM.jsx (sélecteur dans FicheClient) et Biens.jsx (sélecteur dans FicheBien).
const STATUTS_PROP = ["proposé","intéressé","refusé","en analyse","offre en cours"];

// Barre de complétude réutilisable — utilisée par FicheClient (CRM.jsx) et
// FicheBien (Biens.jsx).
function CompletionBar({ label, value, color, T=THEMES_INV.dark }) {
  const pct = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div style={{marginBottom:8}}>
      <div style={{display:"flex", justifyContent:"space-between", gap:8, marginBottom:4, fontSize:FONT.xs.size+1, color:T.textSub, fontWeight:700}}>
        <span>{label}</span><span style={{color}}>{pct}%</span>
      </div>
      <div style={{height:7, borderRadius:RADIUS.pill, background:T.input, border:`1px solid ${T.border}`, overflow:"hidden"}}>
        <div style={{height:"100%", width:`${pct}%`, background:color, borderRadius:RADIUS.pill}} />
      </div>
    </div>
  );
}

export {
  MISSION_COLLABORATEURS,
  HONORAIRE_BASE_CONTRAT_HT,
  HONORAIRE_CONSEIL_MOYEN_HT,
  STATUTS_PROP,
  CompletionBar,
  INVEST_ACC,
  LOT_TYPES,
  NIVEAUX,
  MAX_LOTS,
  GESTION_PRICES,
  DEFAULT_LOTS,
  BUDGET_SECTIONS,
  COMP_FISCA,
  pmt,
  fmt,
  fmtPct,
  fmtMois,
  actLots,
  initBudgetState,
  openFicheClientInvestisseurPDF,
  THEMES_INV,
  SU,
  WA,
  DA,
  IN,
  getCSS,
  CSS,
  NumInput,
  ETAPES_CLIENT,
  TYPES_PLANNING_INVEST,
  isoDate,
  getWeekRange,
  isActionLateOrThisWeek,
  normTxt,
  compareValues,
  SortableHeader,
  KPICard,
  DASH_STAGE_COLORS,
  fmtDashboardEur,
  fmtDashboardPct,
  safeDate,
  daysBetween,
  isFilledDash,
  getClientName,
  getBienLabel,
  getBienScore,
  isBienFicheComplete,
  hasSimulateurBien,
  isGeolocBien,
  CLIENT_STRATEGIES_INVEST,
  CLIENT_TRAVAUX_ACCEPTES,
  CLIENT_URGENCE_INVEST,
  CLIENT_FISCALITES_INVEST,
  OFFRE_STATUTS_INVEST,
  CLIENT_DOCUMENT_CHECKLIST,
  BIEN_DOCUMENT_CHECKLIST,
  emptyClientStrategy,
  clientStrategy,
  checklistPct,
  getNumberLoose,
  bienTotalCost,
  bienLotsCount,
  computeAutoBienScore,
  computeClientBienMatch,
  DashboardPanel,
  DashboardAlertList,
  FILE_ICONS,
  DOCUMENT_CATEGORIES_BIEN,
  GOOGLE_DRIVE_API_KEY,
  GOOGLE_DRIVE_CLIENT_ID,
  GOOGLE_DRIVE_APP_ID,
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_DRIVE_LINKS_TABLE,
  getGoogleDriveConfig,
  GOOGLE_DRIVE_SCRIPT_PROMISES,
  loadExternalScriptOnce,
  GOOGLE_DRIVE_FOLDER_MIME,
  GOOGLE_DRIVE_SHORTCUT_MIME,
  isGoogleDriveFolderMime,
  isGoogleDriveShortcutMime,
  getDriveEffectiveId,
  getDriveEffectiveMimeType,
  isGoogleDriveFolderItem,
  isGoogleDriveShortcutItem,
  getDriveUrlForDoc,
  normalizeDriveDoc,
  getFileIcon,
  fmtSize,
  GoogleDriveLinksSection,
  DocumentsSection,
};
