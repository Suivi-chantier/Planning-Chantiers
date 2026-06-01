import React, { useState, useEffect, useRef, useCallback, useImperativeHandle } from "react";
import { supabase } from "./supabase";
import { LOGO_INVEST_H, LOGO_INVEST_V, FONT, RADIUS, SPACING, SEMANTIC, getBranchAccent } from "./constants";
import { Icon } from "./ui";
import { loadAccessConfig, canAccess as canAccessInvest, ROLE_PAGES_DEFAULT_INVEST, PAGES_INVEST } from "./access";
import { OngletAcces } from "./Admin";
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
function Simulateur({ projet, profil, onRetour, theme="dark", setTheme, embedded=false, bienId: embeddedBienId=null, bienSource=null, onBienSaved }) {
  const isNew = !projet?.id;
  const projetIdRef = useRef(projet?.id||null);
  const isEmbedded = !!embedded;

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
  const [provisions,    setProvisions]    = useState(d0.provisions ?? 0);
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
  const [adresse,   setAdresse]   = useState(projet?.donnees?.descriptions?.adresse||"");
  const [photos,    setPhotos]    = useState(projet?.donnees?.photos||[null,null,null,null]);
  // Liaison optionnelle vers un bien du stock (table invest_biens)
  const [bienId,    setBienId]    = useState(projet?.donnees?.bien_id||"");
  const [biensList, setBiensList] = useState([]);
  const [showLierBien, setShowLierBien] = useState(false);
  useEffect(() => {
    supabase.from("invest_biens").select("id,adresse,ville,code_postal,prix_vente,prix_travaux,cout_total,interlocuteur,agence").order("adresse")
      .then(({ data }) => setBiensList(data || []));
  }, []);

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
    descriptions:{description:desc,travaux,atouts,adresse},
    photos:photos.slice(),
    bien_id: bienId || null,
  }),[nom,prixAffiche,prixNegocie,budgetTravaux,tauxNotaire,surface,honoraires,enedis,taxeFonciere,assurance,compta,provisions,apport1,apport2,taux1,taux2,duree1,duree2,coefEtat,imprevusPct,gestionActive,modeDetention,tmi,selectedScen,lots,budgetQty,budgetPrice,customDivers,desc,travaux,atouts,adresse,photos,bienId]);

  const sauvegarder = useCallback(async(options = {})=>{
    const silent = !!options?.silent;
    setSaving(true);
    const state = collectState();

    if (isEmbedded && embeddedBienId) {
      const existingVisiteData = (bienSource && bienSource.visite_data) || {};
      const updatedVisiteData = {
        ...existingVisiteData,
        simulateur: state,
        simulateur_updated_at: new Date().toISOString(),
      };

      const payloadBien = {
        visite_data: updatedVisiteData,
        prix_vente: parseFloat(prixAffiche) || 0,
        prix_travaux: parseFloat(budgetTravaux) || 0,
        cout_total: parseFloat(coutTotal) || 0,
        rendement_brut: rb > 0 ? rb * 100 : 0,
        cashflow_estime: parseFloat(cfSel) || 0,
        montant_offre: parseFloat(prixNegocie) || 0,
      };

      const { error } = await supabase.from("invest_biens").update(payloadBien).eq("id", embeddedBienId);
      if (error) {
        console.error("Erreur sauvegarde simulateur bien:", error);
        if (!silent) alert("Erreur sauvegarde simulateur : " + error.message);
      } else {
        if (!silent && typeof onBienSaved === "function") onBienSaved();
        setSaved(true);
        setTimeout(()=>setSaved(false),2500);
      }
      setSaving(false);
      return;
    }

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
      if (!silent) alert("Erreur sauvegarde simulateur : " + res.error.message);
    } else if (!projetIdRef.current && res.data?.id) {
      projetIdRef.current = res.data.id;
    }
    setSaving(false); setSaved(true); setTimeout(()=>setSaved(false),2500);
  },[collectState, nom, profil, clientId, isEmbedded, embeddedBienId, bienSource, prixAffiche, prixNegocie, budgetTravaux, coutTotal, rb, cfSel, onBienSaved]);

  // Autosave rapide du simulateur
  const autoRef = useRef(null);
  const saveRef = useRef(null);
  useEffect(() => { saveRef.current = sauvegarder; }, [sauvegarder]);

  const scheduleAutoSave = useCallback(()=>{
    if(autoRef.current) clearTimeout(autoRef.current);
    autoRef.current = setTimeout(()=>{
      saveRef.current?.({ silent:true });
    }, 900);
  },[]);

  // Sauvegarde avant fermeture/changement d'onglet pour ne pas perdre les dernières saisies.
  useEffect(()=>()=>{
    if(autoRef.current) { clearTimeout(autoRef.current); autoRef.current = null; }
    saveRef.current?.({ silent:true });
  },[]);

  // Auto-déclenche scheduleAutoSave dès qu'une donnée du simulateur change.
  const autoSaveBootRef = useRef(true);
  useEffect(() => {
    if (autoSaveBootRef.current) { autoSaveBootRef.current = false; return; }
    scheduleAutoSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    nom, clientId, prixAffiche, prixNegocie, budgetTravaux, tauxNotaire, surface,
    honoraires, enedis, taxeFonciere, assurance, compta, provisions,
    apport1, apport2, taux1, taux2, duree1, duree2,
    coefEtat, imprevusPct, gestionActive, modeDetention, tmi, selectedScen,
    lots, budgetQty, budgetPrice, customDivers,
    desc, travaux, atouts, adresse, photos, bienId,
  ]);

  // ── Reset ───────────────────────────────────────────────────────────────────
  const doReset = () => {
    setPrixAffiche(0);setPrixNegocie(0);setSurface(0);setBudgetTravaux(0);
    setHonoraires(0);setEnedis(0);setTaxeFonciere(0);setAssurance(0);setCompta(0);setProvisions(0);
    setApport1(0);setApport2(0);setTaux1(0);setTaux2(0);setDuree1(0);setDuree2(0);
    setCoefEtat(1);setImprevusPct(10);setGestionActive(false);setModeDetention("IS");setTmi(0.30);
    setLots([{type:"Sélectionner",m2:0,loyer:0,niveau:"RDC",comment:""}]);
    setDesc("");setTravaux("");setAtouts("");setAdresse("");setBienId("");setPhotos([null,null,null,null]);
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
    const esc=s=>String(s||"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const lotRows=aLots.map((l,i)=>`<tr><td>Appt ${i+1}${l.comment?` — <span style="color:#888;font-size:9px">${esc(l.comment)}</span>`:""}</td><td style="text-align:center">${esc(l.type)}</td><td style="text-align:center">${esc(l.niveau)||"—"}</td><td style="text-align:right">${l.m2} m²</td><td style="text-align:right;font-weight:700;color:#1a7a4a">${l.loyer.toLocaleString("fr-FR")} €</td></tr>`).join("");
    // Photo principale (index 0) si dispo
    const photoMain = photos && photos[0] ? photos[0] : null;
    // Map iframe Google Maps Embed si adresse renseignée
    const hasAddr = adresse && adresse.trim();
    const mapSrc = hasAddr ? `https://maps.google.com/maps?q=${encodeURIComponent(adresse)}&output=embed` : null;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Fiche — ${esc(nom)}</title>
    <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Helvetica',sans-serif;background:white;padding:14mm;font-size:11px;color:#2c3040;}
    .hd{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #1f4ea1;}
    .brand{font-size:16px;font-weight:800;color:#1a2d4a;}.title{font-size:18px;font-weight:800;color:#1a2d4a;}
    .addr{font-size:11px;color:#1f4ea1;margin-top:4px;display:flex;align-items:center;gap:4px}
    .addr svg{vertical-align:middle}
    .kpi-bar{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px;}
    .kpi{background:#f8f9fb;border-radius:7px;padding:9px 11px;border-left:3px solid #1f4ea1;}
    .kpi.green{border-left-color:#1a7a4a;}.kpi.gold{border-left-color:#c9a84c;}
    .kv{font-size:14px;font-weight:800;color:#1a2d4a;}.kv.green{color:#1a7a4a;}.kv.orange{color:#d4610a;}
    .kl{font-size:9px;font-weight:600;color:#9aa0b0;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;}
    .sec-hd{background:#1a2d4a;color:white;padding:5px 9px;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;border-radius:4px 4px 0 0;}
    .sec-bd{border:1px solid #eef0f5;border-top:none;border-radius:0 0 4px 4px;padding:9px 11px;}
    .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:11px;}
    .visu-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-bottom:12px;}
    .photo-block,.map-block{border:1px solid #eef0f5;border-radius:5px;overflow:hidden;}
    .photo-block img{width:100%;height:200px;object-fit:cover;display:block;}
    .map-block iframe{width:100%;height:200px;border:0;display:block;}
    .photo-cap,.map-cap{padding:5px 9px;font-size:9px;color:#5a6070;background:#f8f9fb;border-top:1px solid #eef0f5;text-transform:uppercase;letter-spacing:.05em;font-weight:600;}
    table{width:100%;border-collapse:collapse;font-size:10px;}th{background:#1e3a5f;color:white;padding:4px 7px;text-align:left;font-size:9px;text-transform:uppercase;}
    td{padding:4px 7px;border-bottom:1px solid #eef0f5;}tr:nth-child(even) td{background:#f8f9fb;}
    .footer{border-top:1px solid #eef0f5;padding-top:7px;margin-top:12px;text-align:center;font-size:9px;color:#9aa0b0;}
    .no-print{position:fixed;top:14px;right:14px;display:flex;gap:7px;}
    .pbtn{padding:9px 18px;background:#1f4ea1;color:white;border:none;border-radius:5px;font-size:12px;font-weight:700;cursor:pointer;}
    .cbtn{padding:9px 14px;background:#f8f9fb;color:#1a2d4a;border:1px solid #d8dce6;border-radius:5px;font-size:12px;cursor:pointer;}
    @media print{
      .no-print{display:none!important;}
      body{padding:0;}
      @page{size:A4;margin:14mm;}
      /* En impression, les iframes Google Maps deviennent souvent blanches —
         on remplace par une vignette statique via screenshot fallback */
      .map-block.print-fallback{background:#f0f4ff;display:flex;align-items:center;justify-content:center;font-size:11px;color:#1f4ea1;font-weight:700;padding:60px 20px;text-align:center;line-height:1.6}
    }
    </style></head><body>
    <div class="no-print"><button class="cbtn" onclick="window.close()">✕ Fermer</button><button class="pbtn" onclick="window.print()">🖨️ Imprimer / PDF</button></div>
    <div class="hd">
      <div class="brand">🏢 Profero Invest</div>
      <div style="text-align:right">
        <div class="title">${esc(nom)}</div>
        <div style="font-size:11px;color:#1f4ea1;margin-top:3px">Analyse de Rentabilité · ${new Date().toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"})}</div>
        ${hasAddr ? `<div class="addr">📍 ${esc(adresse)}</div>` : ""}
      </div>
    </div>
    <div class="kpi-bar">
      <div class="kpi green"><div class="kv green">${(rb*100).toFixed(2)} %</div><div class="kl">Rendement brut</div></div>
      <div class="kpi green"><div class="kv green">${(rn*100).toFixed(2)} %</div><div class="kl">Rendement net</div></div>
      <div class="kpi ${cfm1>=0?"green":""}"><div class="kv ${cfm1>=0?"green":"orange"}">${fmtN(cfm1)} €/mois</div><div class="kl">Cash-flow S1</div></div>
      <div class="kpi"><div class="kv">${fmtN(coutTotal)} €</div><div class="kl">Coût total</div></div>
      <div class="kpi gold"><div class="kv">${fmtN(totLoyer)} €/mois</div><div class="kl">Loyers mensuels</div></div>
    </div>
    ${(photoMain || mapSrc) ? `<div class="visu-grid">
      ${photoMain ? `<div class="photo-block">
        <img src="${photoMain}" alt="Photo principale"/>
        <div class="photo-cap">📷 Photo principale</div>
      </div>` : `<div class="photo-block" style="background:#f8f9fb;display:flex;align-items:center;justify-content:center;color:#9aa0b0;font-size:10px;font-style:italic;min-height:200px">Aucune photo principale</div>`}
      ${mapSrc ? `<div class="map-block">
        <iframe src="${mapSrc}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
        <div class="map-cap">🗺️ ${esc(adresse)}</div>
      </div>` : `<div class="map-block" style="background:#f8f9fb;display:flex;align-items:center;justify-content:center;color:#9aa0b0;font-size:10px;font-style:italic;min-height:200px">Adresse non renseignée</div>`}
    </div>` : ""}
    <div class="grid-2" style="margin-bottom:12px">
      <div><div class="sec-hd">🏢 Acquisition</div><div class="sec-bd">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 10px">
          <div><div style="font-size:9px;color:#9aa0b0;text-transform:uppercase">Prix négocié</div><div style="font-weight:700">${fmtN(prixNegocie)} €</div></div>
          <div><div style="font-size:9px;color:#9aa0b0;text-transform:uppercase">Budget travaux</div><div style="font-weight:700">${fmtN(budgetTravaux)} €</div></div>
          <div><div style="font-size:9px;color:#9aa0b0;text-transform:uppercase">Surface</div><div style="font-weight:700">${surface} m²</div></div>
          <div><div style="font-size:9px;color:#9aa0b0;text-transform:uppercase">Coût total</div><div style="font-weight:700;color:#1a7a4a">${fmtN(coutTotal)} €</div></div>
        </div>
        ${desc?`<div style="margin-top:7px;padding:5px 7px;background:#f0f4ff;border-radius:4px;border-left:3px solid #1f4ea1;font-size:10px;color:#5a6070;line-height:1.5">${esc(desc)}</div>`:""}
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

  // ── Fiche de Présentation Client ─────────────────────────────────────────────
  // Vue commerciale séduisante destinée à être partagée avec un client investisseur.
  // Cache les infos sensibles (prix négocié, budget travaux, marges) et met en
  // avant les indicateurs vendeurs (rendement, cash-flow, loyers, photos, map).
  const genererFicheClient = () => {
    const client = clientId ? clientsList.find(c => c.id === clientId) : null;
    const clientFullName = client ? `${client.prenom||""} ${client.nom||""}`.trim() : "";
    const lotsPDF = aLots.map((l, i) => ({
      type: l.type,
      niveau: l.niveau,
      m2: l.m2,
      loyer: l.loyer,
      gestion: gestionActive ? (GESTION_PRICES[l.type] || 0) : 0,
      comment: l.comment || "",
    }));

    openFicheClientInvestisseurPDF({
      title: nom,
      subtitle: "Analyse de Rentabilité",
      client: clientFullName,
      address: adresse,
      dateEdition: new Date().toLocaleDateString("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric" }),
      lots: lotsPDF,
      surface,
      logements: aLots.length,
      prixAchat: prixNegocie,
      budgetTravaux,
      coutTotal,
      totLoyer,
      totLoyerAn,
      chargesAnnuelles: totCharges,
      annuiteS1: ann1,
      mensualiteS1: m1,
      cashflowS1: cfm1,
      rendementBrutPct: rb * 100,
      rendementNetPct: rn * 100,
      pointEquilibreMois: pe1 * 12,
      margeSecuritePct: (1 - pe1) * 100,
      totalGestionMois: totGestMois,
      apportS1: apport1,
      tauxS1: taux1,
      dureeS1: duree1,
      description: desc || "Projet d’investissement immobilier analysé par Profero Invest.",
      travaux: travaux || (budgetTravaux > 0 ? `Budget travaux estimé : ${new Intl.NumberFormat("fr-FR", {maximumFractionDigits:0}).format(budgetTravaux)} €.` : "Travaux à préciser après validation technique et devis."),
      atouts: atouts || `Rentabilité brute estimée à ${(rb*100).toFixed(2).replace(".", ",")} %. Cash-flow S1 estimé à ${new Intl.NumberFormat("fr-FR", {maximumFractionDigits:0}).format(cfm1)} €/mois.`,
      recommandation: cfSel >= 0 && rb >= 0.08 ? "Opportunité à approfondir" : "Analyse à confirmer",
    });
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

  // Thème dynamique (suit le toggle de la sidebar) — le CSS de la page parente
  // s'applique déjà via <style>{CSS}</style>, mais on a besoin de T ici pour
  // les inline styles de la topbar.
  const T = THEMES_INV[theme] || THEMES_INV.dark;
  const localCSS = getCSS(T);
  const switchTheme = () => {
    if (!setTheme) return;
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("invest_theme", next);
  };
  return (
    <div className="inv" style={isEmbedded
      ? {display:"flex",flexDirection:"column",background:T.bg,borderRadius:RADIUS.xl,overflow:"hidden",minHeight:760}
      : {position:"fixed",inset:0,zIndex:9999,display:"flex",flexDirection:"column",background:T.bg}
    }>
      <style>{localCSS}</style>

      {/* Topbar moderne — fond sombre avec accent bleu (au lieu du navy/doré vintage) */}
      <div style={{
        background:T.sidebar,borderBottom:`1px solid ${T.sidebarBorder}`,
        padding:`${SPACING.sm+2}px ${SPACING.xl-4}px`,
        display:"flex",alignItems:"center",gap:SPACING.md,flexShrink:0,
        boxShadow:T.shadowSm,
      }}>
        {!isEmbedded && (
          <>
            <button className="inv-btn inv-btn-out inv-btn-sm" onClick={onRetour}>
              <Icon as={ArrowLeft} size={13} strokeWidth={2.2}/>
              Projets
            </button>
            <div style={{width:1,height:20,background:T.border}}/>
          </>
        )}
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
          {setTheme && (
            <button onClick={switchTheme} title={theme==="dark" ? "Mode clair" : "Mode sombre"}
              className="inv-btn inv-btn-out inv-btn-sm" style={{padding:"5px 9px"}}>
              <Icon as={theme==="dark" ? Sun : Moon} size={13} strokeWidth={2.2}/>
            </button>
          )}
          <button className="inv-btn inv-btn-sm inv-btn-danger" onClick={()=>setShowReset(true)}>
            <Icon as={RefreshCw} size={12} strokeWidth={2.2}/> Reset
          </button>
          <button className="inv-btn inv-btn-sm inv-btn-blue" onClick={genererFicheClient} title="Générer la fiche client investisseur">
            <Icon as={Sparkles} size={12} strokeWidth={2.2}/> Fiche client
          </button>
          <button className="inv-btn inv-btn-sm inv-btn-gold" onClick={sauvegarder}>
            <Icon as={Save} size={12} strokeWidth={2.2}/> Enregistrer
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Tabs nav */}
      <div className="inv-tab-nav">
        {[
          ["simulateur","Simulateur", BarChart3],
          ["budget","Budget Travaux", Hammer],
          ["fiscalite","Fiscalité", Briefcase],
        ].map(([k,l,IconComp])=>(
          <button key={k} className={`inv-tab-btn${tab===k?" active":""}`} onClick={()=>setTab(k)}
            style={{display:"inline-flex",alignItems:"center",gap:6}}>
            <Icon as={IconComp} size={13} strokeWidth={2.2}/>
            {l}
          </button>
        ))}
      </div>

      {/* Contenu scrollable */}
      <div style={{flex:1,overflowY:"auto",background:T.bg}}>

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
                  <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Home} size={13} strokeWidth={2.2}/>A — Acquisition</span></div>
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
                  <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={FileText} size={13} strokeWidth={2.2}/>C — Charges d'Exploitation</span></div>
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
                  <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Building2} size={13} strokeWidth={2.2}/>B — Lots & Loyers</span></div>
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
                  <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Pencil} size={13} strokeWidth={2.2}/>Description du Projet</span></div>
                  <div className="inv-card-bd" style={{display:"flex",flexDirection:"column",gap:10}}>
                    {/* Adresse + bouton Lier à un bien */}
                    <div>
                      <label style={{fontSize:10,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:1.2,display:"block",marginBottom:5}}>Adresse du bien</label>
                      <div style={{display:"flex",gap:6}}>
                        <input className="inv-inp" value={adresse}
                          onChange={e=>setAdresse(e.target.value)}
                          placeholder="123 rue de la Paix, 49000 Angers"
                          style={{flex:1, textAlign:"left"}}/>
                        <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={()=>setShowLierBien(true)} title="Importer depuis un bien du stock">
                          <Icon as={Building2} size={12} strokeWidth={2.2}/> Lier
                        </button>
                      </div>
                      {bienId && (() => {
                        const b = biensList.find(x => x.id === bienId);
                        return b ? (
                          <div style={{marginTop:6, fontSize:11, color:T.accent, display:"inline-flex", alignItems:"center", gap:5}}>
                            <Icon as={Building2} size={11} strokeWidth={2.2}/>
                            Lié au bien : <strong>{b.adresse}</strong>{b.ville ? ` — ${b.ville}` : ""}
                            <button onClick={()=>setBienId("")} title="Délier" style={{background:"transparent",border:"none",color:T.textMuted,cursor:"pointer",padding:"0 4px"}}>×</button>
                          </div>
                        ) : null;
                      })()}
                    </div>
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

                {/* Localisation — map iframe Google Maps Embed (gratuit, sans clé API) */}
                {adresse && (
                  <div className="inv-card">
                    <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={MapPin} size={13} strokeWidth={2.2}/>Localisation</span></div>
                    <div className="inv-card-bd" style={{padding:0}}>
                      <iframe
                        title="Carte du bien"
                        src={`https://maps.google.com/maps?q=${encodeURIComponent(adresse)}&output=embed`}
                        width="100%" height="280"
                        style={{border:0, display:"block"}}
                        loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                      />
                      <div style={{padding:`${SPACING.sm+2}px ${SPACING.lg}px`, borderTop:`1px solid ${T.border}`, fontSize:FONT.sm.size, color:T.textSub, display:"flex", alignItems:"center", justifyContent:"space-between", gap:SPACING.sm}}>
                        <span>{adresse}</span>
                        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(adresse)}`}
                          target="_blank" rel="noreferrer"
                          style={{color:T.accent, fontSize:FONT.xs.size+1, fontWeight:700, display:"inline-flex", alignItems:"center", gap:4, textDecoration:"none"}}>
                          Ouvrir dans Maps <Icon as={ExternalLink} size={11} strokeWidth={2.2}/>
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* D+E — Financement + Rentabilité */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginTop:16}}>
              <div className="inv-card">
                <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Wallet} size={13} strokeWidth={2.2}/>D — Plan de Financement</span></div>
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
                  <div className="inv-card-hd gold"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={TrendingUp} size={13} strokeWidth={2.2}/>E — Rentabilité</span></div>
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
                  <div className="inv-card-hd danger"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={AlertTriangle} size={13} strokeWidth={2.2}/>F — Point d'Équilibre</span></div>
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
              <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Briefcase} size={13} strokeWidth={2.2}/>G — Fiscalité Rapide (Scénario 1)</span></div>
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
                <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Settings} size={13} strokeWidth={2.2}/>Paramètres</span></div>
                <div className="inv-card-bd">
                  {[["Surface totale",surface+" m²"],["Logements",actLots(lots).length],["Studios",lots.filter(l=>l.type==="Studio").length],["T1",lots.filter(l=>l.type==="T1").length],["T2",lots.filter(l=>l.type==="T2").length],["T3",lots.filter(l=>l.type==="T3").length],["T4+",lots.filter(l=>["T4","T5","T6"].includes(l.type)).length]].map(([l,v])=>(
                    <div key={l} className="inv-row"><span className="inv-lbl">{l}</span><span className="inv-val calc">{v}</span></div>
                  ))}
                </div>
              </div>
              <div className="inv-card">
                <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Building2} size={13} strokeWidth={2.2}/>Coefficient État Général</span></div>
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
              <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Hammer} size={13} strokeWidth={2.2}/>Détail par Corps de Métier</span></div>
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
              <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Briefcase} size={13} strokeWidth={2.2}/>Comparatif des Régimes Fiscaux</span></div>
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
                <div className="inv-regime-hd ir"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Users} size={13} strokeWidth={2.2}/>SCI à l'IR</span></div>
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

      {/* Modal Lier à un bien */}
      {showLierBien && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,backdropFilter:"blur(4px)"}}
          onClick={()=>setShowLierBien(false)}>
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:RADIUS.xl,padding:`${SPACING.xl}px ${SPACING.xl+2}px`,maxWidth:560,width:"92%",maxHeight:"82vh",overflowY:"auto",boxShadow:T.shadowMd}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",gap:SPACING.md,marginBottom:SPACING.md}}>
              <div style={{
                width:40,height:40,borderRadius:RADIUS.lg,flexShrink:0,
                background:T.accentBg, color:T.accent,
                display:"flex",alignItems:"center",justifyContent:"center",
              }}><Icon as={Building2} size={20} strokeWidth={2}/></div>
              <div>
                <div style={{fontSize:FONT.md.size+1,fontWeight:800,color:T.text}}>Importer depuis un bien</div>
                <div style={{fontSize:FONT.xs.size+1,color:T.textSub,marginTop:2}}>Auto-remplit adresse, prix de vente et budget travaux</div>
              </div>
            </div>
            {biensList.length === 0 ? (
              <div style={{textAlign:"center",padding:`${SPACING.lg}px 0`,color:T.textMuted,fontStyle:"italic"}}>
                Aucun bien dans le stock. Ajoute d'abord un bien depuis « Stock de biens ».
              </div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {biensList.map(b => (
                  <button key={b.id}
                    onClick={()=>{
                      const addr = [b.adresse, b.code_postal, b.ville].filter(Boolean).join(", ");
                      if (addr) setAdresse(addr);
                      if (b.prix_vente) { setPrixAffiche(b.prix_vente); setPrixNegocie(b.prix_vente); }
                      if (b.prix_travaux) setBudgetTravaux(b.prix_travaux);
                      setBienId(b.id);
                      setShowLierBien(false);
                    }}
                    style={{
                      display:"flex",alignItems:"center",gap:SPACING.sm+2,
                      padding:`${SPACING.sm+2}px ${SPACING.md+2}px`,
                      background:bienId===b.id?T.accentBg:T.input,
                      border:`1px solid ${bienId===b.id?T.accentBorder:T.border}`,
                      borderRadius:RADIUS.md,cursor:"pointer",textAlign:"left",
                      fontFamily:"inherit",transition:"all .12s",
                    }}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=T.borderHover;}}
                    onMouseLeave={e=>{if(bienId!==b.id)e.currentTarget.style.borderColor=T.border;}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,color:T.text,fontSize:FONT.base.size,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {b.adresse || "Sans adresse"}
                      </div>
                      <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:2,display:"flex",gap:8,flexWrap:"wrap"}}>
                        {b.ville && <span><Icon as={MapPin} size={10} strokeWidth={2.2}/> {b.ville}</span>}
                        {b.prix_vente > 0 && <span>· {new Intl.NumberFormat("fr-FR").format(b.prix_vente)} €</span>}
                        {b.agence && <span>· {b.agence}</span>}
                      </div>
                    </div>
                    <Icon as={ChevronRight} size={14} color={T.accent} strokeWidth={2.2}/>
                  </button>
                ))}
              </div>
            )}
            <div style={{display:"flex",justifyContent:"flex-end",marginTop:SPACING.md+2}}>
              <button className="inv-btn inv-btn-out" onClick={()=>setShowLierBien(false)}>Fermer</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Reset */}
      {showReset&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,backdropFilter:"blur(4px)"}}>
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:RADIUS.xl,padding:`${SPACING.xl+2}px ${SPACING.xl+6}px`,maxWidth:380,width:"90%",textAlign:"center",boxShadow:T.shadowMd}}>
            <div style={{
              width:56,height:56,borderRadius:"50%",margin:`0 auto ${SPACING.md}px`,
              background:SEMANTIC.warning.bg,border:`2px solid ${SEMANTIC.warning.border}`,
              display:"flex",alignItems:"center",justifyContent:"center",color:WA,
            }}><Icon as={AlertTriangle} size={26} strokeWidth={2}/></div>
            <div style={{fontSize:FONT.md.size+1,fontWeight:800,color:T.text,marginBottom:6}}>Réinitialiser le simulateur ?</div>
            <div style={{fontSize:FONT.sm.size+1,color:T.textSub,marginBottom:SPACING.xl-2,lineHeight:1.55}}>Toutes les données saisies seront effacées. Cette action est <strong>irréversible</strong>.</div>
            <div style={{display:"flex",gap:SPACING.sm+2,justifyContent:"center"}}>
              <button className="inv-btn inv-btn-out" onClick={()=>setShowReset(false)}>Annuler</button>
              <button className="inv-btn inv-btn-danger" onClick={doReset}><Icon as={RefreshCw} size={13} strokeWidth={2.2}/> Réinitialiser</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TABLEAU DE BORD INVEST ───────────────────────────────────────────────────
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


const DASH_CLIENT_STATUS_CONFIG = [
  { statut:"Prospect", label:"Prospects", color:"#4db8ff", icon:Users },
  { statut:"Actif", label:"Clients actifs", color:SU, icon:Check },
  { statut:"Inactif", label:"Clients inactifs", color:WA, icon:Bell },
  { statut:"Terminé", label:"Terminés", color:"rgba(255,255,255,0.38)", icon:Lock },
];
const DASH_STAT_KEY = { Prospect:"prospects", Actif:"actifs", Inactif:"inactifs", Terminé:"termines" };

function ClientsStatutsBoard({ clients=[], T=THEMES_INV.dark, movingClientId, onMoveClient, onOpenStatus }) {
  const [dragOverStatut, setDragOverStatut] = useState("");
  const fmtBudgetClient = (v) => v > 0 ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits:0 }).format(v) + " €" : "—";
  const fmtDateShort = (d) => d ? new Date(d).toLocaleDateString("fr-FR", { day:"2-digit", month:"short" }) : "—";
  const clientsParStatut = DASH_CLIENT_STATUS_CONFIG.reduce((acc, cfg) => {
    acc[cfg.statut] = clients.filter(c => (c.statut || "Prospect") === cfg.statut)
      .sort((a,b) => String(a.nom || "").localeCompare(String(b.nom || ""), "fr", { sensitivity:"base" }));
    return acc;
  }, {});

  return (
    <div className="inv-card" style={{ marginBottom:SPACING.xxl-2 }}>
      <div className="inv-card-hd blue" style={{ alignItems:"center" }}>
        <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
          <Icon as={LayoutGrid} size={13} strokeWidth={2.2}/>
          Statuts clients — pilotage rapide
        </span>
        <span style={{ fontSize:FONT.xs.size, color:T.textMuted, textTransform:"none", letterSpacing:0, fontWeight:600 }}>
          Glisser-déposer un client pour changer son statut
        </span>
      </div>
      <div className="inv-card-bd">
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,minmax(230px,1fr))", gap:SPACING.md, overflowX:"auto", paddingBottom:2 }}>
          {DASH_CLIENT_STATUS_CONFIG.map(cfg => {
            const list = clientsParStatut[cfg.statut] || [];
            const isOver = dragOverStatut === cfg.statut;
            const IconComp = cfg.icon;
            return (
              <div key={cfg.statut}
                onDragOver={e=>{ e.preventDefault(); setDragOverStatut(cfg.statut); }}
                onDragLeave={()=>setDragOverStatut("")}
                onDrop={e=>{
                  e.preventDefault();
                  const clientId = e.dataTransfer.getData("text/plain");
                  setDragOverStatut("");
                  if (clientId) onMoveClient?.(clientId, cfg.statut);
                }}
                style={{
                  minHeight:150, borderRadius:RADIUS.lg,
                  border:`1.5px solid ${isOver ? cfg.color : T.border}`,
                  background:isOver ? `${cfg.color}12` : T.input,
                  padding:SPACING.sm+2,
                  transition:"all .15s",
                }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:SPACING.sm+2 }}>
                  <button type="button" onClick={()=>onOpenStatus?.(cfg.statut)}
                    style={{
                      border:"none", background:"transparent", padding:0, cursor:"pointer",
                      display:"inline-flex", alignItems:"center", gap:7, color:cfg.color,
                      fontFamily:"inherit", fontSize:FONT.sm.size+1, fontWeight:800,
                    }}
                    title={`Voir les ${cfg.label.toLowerCase()} dans le CRM`}>
                    <span style={{
                      width:24, height:24, borderRadius:RADIUS.sm+1,
                      display:"inline-flex", alignItems:"center", justifyContent:"center",
                      background:`${cfg.color}18`, color:cfg.color,
                    }}><Icon as={IconComp} size={13} strokeWidth={2.2}/></span>
                    {cfg.label}
                  </button>
                  <span style={{
                    minWidth:24, height:24, borderRadius:RADIUS.pill,
                    background:`${cfg.color}18`, color:cfg.color, border:`1px solid ${cfg.color}33`,
                    display:"inline-flex", alignItems:"center", justifyContent:"center",
                    fontSize:FONT.xs.size, fontWeight:800, fontFamily:"'DM Mono',monospace",
                  }}>{list.length}</span>
                </div>

                <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                  {list.length === 0 ? (
                    <div style={{
                      border:`1px dashed ${T.border}`, borderRadius:RADIUS.md,
                      padding:`${SPACING.md}px ${SPACING.sm}px`, textAlign:"center",
                      color:T.textMuted, fontSize:FONT.xs.size+1, fontStyle:"italic",
                    }}>
                      Glisser un client ici
                    </div>
                  ) : list.map(c => {
                    const isMoving = movingClientId === c.id;
                    return (
                      <div key={c.id}
                        draggable
                        onDragStart={e=>{
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", c.id);
                        }}
                        onDragEnd={()=>setDragOverStatut("")}
                        style={{
                          padding:`${SPACING.sm}px ${SPACING.sm+2}px`,
                          borderRadius:RADIUS.md, background:T.card, border:`1px solid ${T.border}`,
                          cursor:isMoving ? "wait" : "grab", opacity:isMoving ? .55 : 1,
                          boxShadow:T.shadowSm, transition:"all .12s",
                        }}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor=cfg.color; e.currentTarget.style.transform="translateY(-1px)";}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border; e.currentTarget.style.transform="none";}}
                        title="Glisser vers une autre colonne pour modifier le statut">
                        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontSize:FONT.sm.size+1, fontWeight:800, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {c.prenom} {c.nom}
                            </div>
                            <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:2, display:"flex", gap:6, flexWrap:"wrap" }}>
                              <span>{fmtBudgetClient(c.budget)}</span>
                              {c.date_prochaine_action && <span>· Action {fmtDateShort(c.date_prochaine_action)}</span>}
                            </div>
                          </div>
                          <span style={{ color:T.textMuted, fontSize:15, lineHeight:1 }}>↔</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
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

function ClientStrategyCard({ client, T=THEMES_INV.dark, onSaved }) {
  const [data, setData] = useState(() => clientStrategy(client));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { setData(clientStrategy(client)); }, [client?.id]);
  const update = (k, v) => setData(prev => ({...prev, [k]:v}));
  const save = async () => {
    setSaving(true); setMsg("");
    const payload = { strategie_data:data, budget:getNumberLoose(data.budget_max || client.budget) };
    const { error } = await supabase.from("invest_clients").update(payload).eq("id", client.id);
    setSaving(false);
    if (error) setMsg(`Erreur sauvegarde stratégie : ${error.message}`);
    else { setMsg("Stratégie sauvegardée"); onSaved?.(); setTimeout(()=>setMsg(""),2200); }
  };
  const field = (label, key, options, type="text") => (
    <div>
      <label style={{fontSize:FONT.xs.size, fontWeight:800, color:T.textMuted, textTransform:"uppercase", letterSpacing:.8, display:"block", marginBottom:4}}>{label}</label>
      {options ? (
        <select className="inv-sel" value={data[key] || ""} onChange={e=>update(key,e.target.value)} style={{width:"100%"}}>{options.map(o=><option key={o} value={o}>{o || "—"}</option>)}</select>
      ) : (
        <input className="inv-inp" type={type} value={data[key] || ""} onChange={e=>update(key,e.target.value)} style={{width:"100%", textAlign:type==="number"?"right":"left"}} />
      )}
    </div>
  );
  return (
    <div className="inv-card">
      <div className="inv-card-hd blue" style={{justifyContent:"space-between"}}>
        <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Sparkles} size={13} strokeWidth={2.2}/>Dossier investisseur</span>
        <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={save} disabled={saving}><Icon as={Save} size={12}/> {saving?"Sync…":"Sauvegarder"}</button>
      </div>
      <div className="inv-card-bd">
        {msg && <div style={{fontSize:FONT.xs.size+1, color:msg.startsWith("Erreur")?DA:SU, marginBottom:8, fontWeight:800}}>{msg}</div>}
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}}>
          {field("Objectif", "objectif", CLIENT_STRATEGIES_INVEST)}
          {field("Budget max (€)", "budget_max", null, "number")}
          {field("Apport disponible (€)", "apport", null, "number")}
          {field("Rendement min (%)", "rendement_min", null, "number")}
          {field("Zones recherchées", "zones")}
          {field("Travaux acceptés", "travaux_acceptes", CLIENT_TRAVAUX_ACCEPTES)}
          {field("Urgence", "urgence", CLIENT_URGENCE_INVEST)}
          {field("Fiscalité cible", "fiscalite", CLIENT_FISCALITES_INVEST)}
        </div>
        <div style={{marginTop:10}}>
          <label style={{fontSize:FONT.xs.size, fontWeight:800, color:T.textMuted, textTransform:"uppercase", letterSpacing:.8, display:"block", marginBottom:4}}>Freins / remarques</label>
          <textarea className="inv-textarea" rows={3} value={data.remarques || ""} onChange={e=>update("remarques", e.target.value)} />
        </div>
      </div>
    </div>
  );
}

function MatchingBiensClientCard({ client, biens=[], propositions=[], T=THEMES_INV.dark, onProposer }) {
  const proposed = new Set((propositions || []).map(p => p.bien_id || p.bien?.id).filter(Boolean));
  const ranked = biens.map(b => ({ b, ...computeClientBienMatch(client, b) })).filter(x => !proposed.has(x.b.id)).sort((a,b)=>b.score-a.score).slice(0,6);
  return (
    <div className="inv-card">
      <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Handshake} size={13} strokeWidth={2.2}/>Matching biens compatibles</span></div>
      <div className="inv-card-bd">
        {ranked.length === 0 ? <div style={{fontSize:13,color:T.textMuted,fontStyle:"italic",textAlign:"center",padding:"16px 0"}}>Aucun bien compatible non proposé</div> : ranked.map(({b, score, reasons}) => (
          <div key={b.id} style={{padding:"10px 0", borderBottom:`1px solid ${T.border}`}}>
            <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:8}}>
              <div style={{fontWeight:800, color:T.text, fontSize:FONT.sm.size+1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{b.adresse || b.ville || "Bien sans adresse"}</div>
              <span style={{fontFamily:"'DM Mono',monospace", color:score>=75?SU:score>=55?WA:DA, fontWeight:900}}>{score}%</span>
            </div>
            <div style={{fontSize:FONT.xs.size+1, color:T.textMuted, marginTop:3}}>{fmtDashboardEur(bienTotalCost(b))} · {b.rendement_brut ? fmtDashboardPct(b.rendement_brut) : "rendement —"} · {reasons.slice(0,2).join(" · ") || "matching général"}</div>
            {onProposer && <button className="inv-btn inv-btn-blue inv-btn-sm" style={{marginTop:8}} onClick={()=>onProposer(b.id)}>Proposer à ce client</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChecklistDocumentsClientCard({ client, T=THEMES_INV.dark, onSaved }) {
  const [data, setData] = useState(() => clientStrategy(client));
  useEffect(() => { setData(clientStrategy(client)); }, [client?.id]);
  const setStatus = async (key, status) => {
    const next = { ...data, documents_checklist:{ ...(data.documents_checklist || {}), [key]:status } };
    setData(next);
    const { error } = await supabase.from("invest_clients").update({ strategie_data:next }).eq("id", client.id);
    if (!error) onSaved?.();
  };
  const pct = checklistPct(data.documents_checklist, CLIENT_DOCUMENT_CHECKLIST);
  return (
    <div className="inv-card">
      <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={FileText} size={13}/>Documents manquants client</span><span style={{fontFamily:"'DM Mono',monospace", color:T.accent}}>{pct}%</span></div>
      <div className="inv-card-bd">
        <CompletionBar label="Complétude documentaire" value={pct} color={pct>=80?SU:WA} T={T}/>
        {CLIENT_DOCUMENT_CHECKLIST.map(([k,label]) => (
          <div key={k} className="inv-row"><span className="inv-lbl">{label}</span><select className="inv-sel" value={data.documents_checklist?.[k] || ""} onChange={e=>setStatus(k,e.target.value)}><option value="">À demander</option><option value="recu">Reçu</option><option value="na">Non applicable</option></select></div>
        ))}
      </div>
    </div>
  );
}

function AutoScoreBienCard({ bien, T=THEMES_INV.dark }) {
  const score = computeAutoBienScore(bien);
  const v = bien.visite_data || {};
  const rendement = getNumberLoose(bien.rendement_brut || v.finance?.rendement_brut_calcule || v.finance?.rendement_brut);
  const cash = getNumberLoose(bien.cashflow_estime || v.finance?.cashflow_mensuel || v.finance?.cashflow_mensuel_estime);
  const docs = checklistPct(v.documents_checklist || {}, BIEN_DOCUMENT_CHECKLIST);
  return (
    <div className="inv-card">
      <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Sparkles} size={13}/>Score Profero automatique</span></div>
      <div className="inv-card-bd">
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:12}}>
          <div style={{width:72,height:72,borderRadius:"50%",border:`5px solid ${score>=75?SU:score>=50?WA:DA}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono',monospace",fontWeight:900,color:score>=75?SU:score>=50?WA:DA,fontSize:18}}>{score}</div>
          <div style={{flex:1}}>
            <div style={{fontSize:FONT.md.size,fontWeight:900,color:T.text}}>{score>=75?"Très intéressant":score>=50?"À approfondir":"Risque / à challenger"}</div>
            <div style={{fontSize:FONT.sm.size,color:T.textMuted,marginTop:3}}>Score basé sur rentabilité, cash-flow, conclusion, complétude et risques renseignés</div>
          </div>
        </div>
        <CompletionBar label="Rendement" value={Math.min(100, rendement*8)} color={SU} T={T}/>
        <CompletionBar label="Cash-flow" value={cash>0?Math.min(100, cash/4):20} color={cash>0?SU:WA} T={T}/>
        <CompletionBar label="Documents" value={docs} color={T.accent} T={T}/>
      </div>
    </div>
  );
}

function MatchingClientsBienCard({ bien, clients=[], propositions=[], T=THEMES_INV.dark, onAssociate }) {
  const associated = new Set((propositions||[]).map(p => p.client_id).filter(Boolean));
  const ranked = clients.map(c => ({ c, ...computeClientBienMatch(c, bien) })).sort((a,b)=>b.score-a.score).slice(0,8);
  return (
    <div className="inv-card">
      <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Handshake} size={13}/>Matching clients ↔ bien</span></div>
      <div className="inv-card-bd">
        {ranked.length===0 ? <div style={{fontSize:13,color:T.textMuted,fontStyle:"italic",textAlign:"center",padding:"16px 0"}}>Aucun client à matcher</div> : ranked.map(({c, score, reasons}) => (
          <div key={c.id} style={{padding:"9px 0",borderBottom:`1px solid ${T.border}`}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
              <div style={{fontSize:FONT.sm.size+1,fontWeight:900,color:T.text}}>{getClientName(c)}</div>
              <span style={{fontFamily:"'DM Mono',monospace",fontWeight:900,color:score>=75?SU:score>=55?WA:DA}}>{score}%</span>
            </div>
            <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:3}}>{fmtDashboardEur(c.budget || c.strategie_data?.budget_max)} · {c.strategie_data?.strategie || "stratégie à compléter"} · {reasons.slice(0,2).join(" · ") || "compatibilité générale"}</div>
            {onAssociate && !associated.has(c.id) && <button className="inv-btn inv-btn-blue inv-btn-sm" style={{marginTop:7}} onClick={()=>onAssociate(c.id)}>Associer / proposer</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function OffreAchatBienCard({ bien, T=THEMES_INV.dark, onSaved }) {
  const initial = bien?.visite_data?.offre_achat || {};
  const [data, setData] = useState({ prix_recommande:bien.montant_offre || initial.prix_recommande || "", marge_negociation:initial.marge_negociation || "", statut:initial.statut || "À préparer", arguments:initial.arguments || "", conditions:initial.conditions || "", date_relance:initial.date_relance || bien.date_relance || "" });
  const [msg, setMsg] = useState("");
  useEffect(()=>{ const i=bien?.visite_data?.offre_achat || {}; setData({ prix_recommande:bien.montant_offre || i.prix_recommande || "", marge_negociation:i.marge_negociation || "", statut:i.statut || "À préparer", arguments:i.arguments || "", conditions:i.conditions || "", date_relance:i.date_relance || bien.date_relance || "" }); }, [bien?.id]);
  const upd = (k,v)=>setData(prev=>({...prev,[k]:v}));
  const save = async () => {
    const visite_data = { ...(bien.visite_data || {}), offre_achat:data };
    const payload = { visite_data, montant_offre:getNumberLoose(data.prix_recommande) || null, date_relance:data.date_relance || null };
    const { error } = await supabase.from("invest_biens").update(payload).eq("id", bien.id);
    if (error) setMsg(`Erreur : ${error.message}`); else { setMsg("Offre sauvegardée"); onSaved?.(); setTimeout(()=>setMsg(""),2200); }
  };
  const genMail = () => {
    const body = `Bonjour,\n\nSuite à l’analyse du bien situé ${[bien.adresse,bien.code_postal,bien.ville].filter(Boolean).join(" ")}, nous souhaiterions transmettre une offre à ${fmtDashboardEur(data.prix_recommande)}.\n\nArguments principaux :\n${data.arguments || "- À compléter"}\n\nConditions souhaitées :\n${data.conditions || "- À compléter"}\n\nBien cordialement,\nProfero Invest`;
    navigator.clipboard?.writeText(body); setMsg("Texte d’offre copié"); setTimeout(()=>setMsg(""),2200);
  };
  return (
    <div className="inv-card">
      <div className="inv-card-hd gold"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Send} size={13}/>Module offre d’achat</span></div>
      <div className="inv-card-bd">
        {msg && <div style={{fontSize:FONT.xs.size+1,color:msg.startsWith("Erreur")?DA:SU,fontWeight:800,marginBottom:8}}>{msg}</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div><label className="inv-kpi-lbl">Prix d’offre recommandé</label><input className="inv-inp" type="number" value={data.prix_recommande} onChange={e=>upd("prix_recommande",e.target.value)} style={{width:"100%"}}/></div>
          <div><label className="inv-kpi-lbl">Marge de négociation</label><input className="inv-inp" value={data.marge_negociation} onChange={e=>upd("marge_negociation",e.target.value)} style={{width:"100%",textAlign:"left"}}/></div>
          <div><label className="inv-kpi-lbl">Statut offre</label><select className="inv-sel" value={data.statut} onChange={e=>upd("statut",e.target.value)} style={{width:"100%"}}>{OFFRE_STATUTS_INVEST.map(o=><option key={o}>{o}</option>)}</select></div>
          <div><label className="inv-kpi-lbl">Date de relance</label><input className="inv-inp" type="date" value={data.date_relance} onChange={e=>upd("date_relance",e.target.value)} style={{width:"100%"}}/></div>
        </div>
        <div style={{marginTop:10}}><label className="inv-kpi-lbl">Arguments de négociation</label><textarea className="inv-textarea" rows={3} value={data.arguments} onChange={e=>upd("arguments",e.target.value)} /></div>
        <div style={{marginTop:10}}><label className="inv-kpi-lbl">Conditions suspensives à prévoir</label><textarea className="inv-textarea" rows={2} value={data.conditions} onChange={e=>upd("conditions",e.target.value)} /></div>
        <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:10}}><button className="inv-btn inv-btn-out inv-btn-sm" onClick={genMail}>Copier texte offre</button><button className="inv-btn inv-btn-gold inv-btn-sm" onClick={save}><Icon as={Save} size={12}/> Enregistrer offre</button></div>
      </div>
    </div>
  );
}

function ChecklistDocumentsBienCard({ bien, T=THEMES_INV.dark, onSaved }) {
  const [checklist, setChecklist] = useState(() => bien?.visite_data?.documents_checklist || {});
  useEffect(()=>setChecklist(bien?.visite_data?.documents_checklist || {}), [bien?.id]);
  const setStatus = async (key, status) => {
    const next = { ...checklist, [key]:status };
    setChecklist(next);
    const visite_data = { ...(bien.visite_data || {}), documents_checklist:next };
    const { error } = await supabase.from("invest_biens").update({ visite_data }).eq("id", bien.id);
    if (!error) onSaved?.();
  };
  const pct = checklistPct(checklist, BIEN_DOCUMENT_CHECKLIST);
  return (
    <div className="inv-card">
      <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={FileText} size={13}/>Checklist documents du bien</span><span style={{fontFamily:"'DM Mono',monospace",color:T.accent}}>{pct}%</span></div>
      <div className="inv-card-bd">
        <CompletionBar label="Documents reçus" value={pct} color={pct>=80?SU:WA} T={T}/>
        {BIEN_DOCUMENT_CHECKLIST.map(([k,label]) => (
          <div key={k} className="inv-row"><span className="inv-lbl">{label}</span><select className="inv-sel" value={checklist?.[k] || ""} onChange={e=>setStatus(k,e.target.value)}><option value="">À demander</option><option value="recu">Reçu</option><option value="na">Non applicable</option><option value="verifier">À vérifier</option></select></div>
        ))}
      </div>
    </div>
  );
}

function HistoriqueBienCard({ bien, propositions=[], T=THEMES_INV.dark }) {
  const events = [];
  if (bien.created_at) events.push([bien.created_at, "Création du bien", bien.created_by || "Stock de biens"]);
  if (bien.updated_at) events.push([bien.updated_at, "Dernière mise à jour", bien.statut || "Fiche bien"]);
  if (bien.date_visite) events.push([bien.date_visite, "Visite du bien", bien.conseiller_profero || "Conseiller"]);
  if (bien.visite_data?.simulateur_updated_at) events.push([bien.visite_data.simulateur_updated_at, "Simulation mise à jour", "Simulateur intégré"]);
  propositions.forEach(p => events.push([p.created_at || p.date_proposition, `Bien proposé à ${p.client?.prenom || ""} ${p.client?.nom || ""}`.trim(), p.statut || "proposé"]));
  events.sort((a,b)=>new Date(b[0])-new Date(a[0]));
  return (
    <div className="inv-card">
      <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={MessageSquare} size={13}/>Historique activité</span></div>
      <div className="inv-card-bd">
        {events.length===0 ? <div style={{fontSize:13,color:T.textMuted,fontStyle:"italic",textAlign:"center",padding:"14px 0"}}>Aucun historique</div> : events.slice(0,8).map((e,i)=>(
          <div key={i} style={{display:"grid",gridTemplateColumns:"86px 1fr",gap:10,padding:"8px 0",borderBottom:`1px solid ${T.border}`}}>
            <div style={{fontSize:FONT.xs.size,color:T.textMuted}}>{safeDate(e[0])}</div><div><div style={{fontWeight:800,color:T.text,fontSize:FONT.sm.size+1}}>{e[1]}</div><div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:2}}>{e[2]}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}


function computeClientPriorityScore(client = {}, propositions = [], biens = []) {
  const strat = clientStrategy(client);
  const proposed = propositions.filter(p => p.client_id === client.id);
  const budget = getNumberLoose(strat.budget_max || client.budget);
  let score = 30;
  const reasons = [];
  if (client.statut === "Actif") { score += 18; reasons.push("client actif"); }
  if (client.date_signature) { score += 14; reasons.push("contrat signé"); }
  if (budget > 0) { score += 12; reasons.push("budget renseigné"); }
  if (strat.strategie) { score += 10; reasons.push("stratégie définie"); }
  if (strat.zones) { score += 8; reasons.push("zone ciblée"); }
  if (strat.urgence === "Immédiate" || strat.urgence === "1 à 3 mois") { score += 10; reasons.push("urgence forte"); }
  if (proposed.length > 0) { score += Math.min(12, proposed.length * 4); reasons.push(`${proposed.length} bien${proposed.length>1?"s":""} proposé${proposed.length>1?"s":""}`); }
  if (!client.prochaine_action && client.statut !== "Terminé") { score -= 16; reasons.push("prochaine action manquante"); }
  const days = daysBetween(client.date_prochaine_action || client.updated_at || client.created_at);
  if (days !== null && days > 14 && client.statut !== "Terminé") { score -= 10; reasons.push("suivi à relancer"); }
  const bestMatch = biens.map(b => computeClientBienMatch(client, b).score).sort((a,b)=>b-a)[0] || 0;
  if (bestMatch >= 75) { score += 10; reasons.push("bien compatible disponible"); }
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons, bestMatch };
}

function ClientScoreCard({ client, propositions=[], biens=[], T=THEMES_INV.dark }) {
  const { score, reasons, bestMatch } = computeClientPriorityScore(client, propositions, biens);
  const color = score >= 75 ? SU : score >= 50 ? WA : DA;
  const strat = clientStrategy(client);
  const docs = checklistPct(strat.documents_checklist, CLIENT_DOCUMENT_CHECKLIST);
  return (
    <div className="inv-card">
      <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Sparkles} size={13}/>Score maturité client</span></div>
      <div className="inv-card-bd">
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:12}}>
          <div style={{width:72,height:72,borderRadius:"50%",border:`5px solid ${color}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono',monospace",fontWeight:900,color,fontSize:18}}>{score}</div>
          <div style={{flex:1}}>
            <div style={{fontSize:FONT.md.size,fontWeight:900,color:T.text}}>{score>=75?"Client prioritaire":score>=50?"Client à faire avancer":"Client à qualifier"}</div>
            <div style={{fontSize:FONT.sm.size,color:T.textMuted,marginTop:3}}>Budget, stratégie, urgence, suivi et compatibilité avec le stock</div>
          </div>
        </div>
        <CompletionBar label="Dossier investisseur" value={(strat.strategie?25:0)+(strat.budget_max||client.budget?25:0)+(strat.zones?20:0)+(strat.urgence?15:0)+(strat.fiscalite?15:0)} color={T.accent} T={T}/>
        <CompletionBar label="Documents client" value={docs} color={docs>=80?SU:WA} T={T}/>
        <CompletionBar label="Meilleur matching disponible" value={bestMatch} color={bestMatch>=75?SU:bestMatch>=50?WA:DA} T={T}/>
        <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:8,lineHeight:1.5}}>{reasons.slice(0,4).join(" · ") || "Compléter la stratégie pour fiabiliser le score"}</div>
      </div>
    </div>
  );
}

function buildQuickBienAnalysis(bien = {}) {
  const v = bien.visite_data || {};
  const surface = getNumberLoose(v.general?.surface_totale || bien.surface || v.finance?.surface_totale);
  const prix = getNumberLoose(bien.prix_vente || v.general?.prix_affiche);
  const travaux = getNumberLoose(bien.prix_travaux || v.finance?.budget_travaux_ttc);
  const offre = getNumberLoose(bien.montant_offre || v.conclusion?.prix_offre_recommande || v.finance?.prix_acquisition_negocie);
  const total = getNumberLoose(bien.cout_total) || (offre || prix) + travaux;
  const loyers = getNumberLoose(v.configuration?.total_loyers_mensuels || v.finance?.loyers_bruts_mensuels);
  const rendement = getNumberLoose(bien.rendement_brut) || (total > 0 && loyers > 0 ? (loyers*12/total)*100 : 0);
  const cash = getNumberLoose(bien.cashflow_estime || v.finance?.cashflow_mensuel_estime);
  const prixM2 = surface > 0 && prix > 0 ? prix / surface : 0;
  const totalM2 = surface > 0 && total > 0 ? total / surface : 0;
  const score = computeAutoBienScore(bien);
  const recommendation = score >= 75 || rendement >= 10 ? "À prioriser" : score >= 50 || rendement >= 8 ? "À approfondir" : "À challenger";
  const alerts = [];
  if (!surface) alerts.push("surface manquante");
  if (!loyers) alerts.push("loyers cibles manquants");
  if (!travaux) alerts.push("travaux à estimer");
  if (!offre) alerts.push("offre à définir");
  return { surface, prix, travaux, offre, total, loyers, rendement, cash, prixM2, totalM2, score, recommendation, alerts };
}

function AnalyseRapideBienCard({ bien, T=THEMES_INV.dark, onSaved }) {
  const a = buildQuickBienAnalysis(bien);
  const [msg, setMsg] = useState("");
  const save = async () => {
    const visite_data = { ...(bien.visite_data || {}), analyse_rapide:{ ...a, saved_at:new Date().toISOString() } };
    const payload = { visite_data };
    if (a.total > 0) payload.cout_total = Math.round(a.total);
    if (a.rendement > 0) payload.rendement_brut = Number(a.rendement.toFixed(2));
    if (Number.isFinite(a.cash) && a.cash !== 0) payload.cashflow_estime = Math.round(a.cash);
    const { error } = await supabase.from("invest_biens").update(payload).eq("id", bien.id);
    if (error) setMsg(`Erreur : ${error.message}`); else { setMsg("Analyse rapide sauvegardée"); onSaved?.(); setTimeout(()=>setMsg(""),2200); }
  };
  return (
    <div className="inv-card">
      <div className="inv-card-hd gold"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={TrendingUp} size={13}/>Analyse rapide du bien</span></div>
      <div className="inv-card-bd">
        {msg && <div style={{fontSize:FONT.xs.size+1,color:msg.startsWith("Erreur")?DA:SU,fontWeight:800,marginBottom:8}}>{msg}</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[["Prix / m²", a.prixM2 ? `${Math.round(a.prixM2).toLocaleString("fr-FR")} €/m²` : "—"],["Coût total / m²", a.totalM2 ? `${Math.round(a.totalM2).toLocaleString("fr-FR")} €/m²` : "—"],["Coût total", fmtDashboardEur(a.total)],["Loyers mensuels", fmtDashboardEur(a.loyers)],["Rendement brut", a.rendement ? fmtDashboardPct(a.rendement) : "—"],["Cash-flow", a.cash ? `${fmtDashboardEur(a.cash)}/mois` : "—"]].map(([l,v])=>(
            <div key={l} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:RADIUS.md,padding:"9px 10px"}}>
              <div style={{fontSize:FONT.xs.size,color:T.textMuted,textTransform:"uppercase",fontWeight:800,letterSpacing:.7}}>{l}</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:FONT.sm.size+1,fontWeight:900,color:T.text,marginTop:3}}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{marginTop:10,padding:"10px 12px",borderRadius:RADIUS.md,background:a.recommendation==="À prioriser"?SEMANTIC.success.bg:a.recommendation==="À approfondir"?SEMANTIC.warning.bg:SEMANTIC.danger.bg,border:`1px solid ${a.recommendation==="À prioriser"?SEMANTIC.success.border:a.recommendation==="À approfondir"?SEMANTIC.warning.border:SEMANTIC.danger.border}`,color:a.recommendation==="À prioriser"?SU:a.recommendation==="À approfondir"?WA:DA,fontWeight:900,fontSize:FONT.sm.size+1}}>
          Décision rapide : {a.recommendation}
        </div>
        {a.alerts.length > 0 && <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:8}}>À compléter : {a.alerts.join(" · ")}</div>}
        <div style={{display:"flex",justifyContent:"flex-end",marginTop:10}}><button className="inv-btn inv-btn-gold inv-btn-sm" onClick={save}><Icon as={Save} size={12}/> Sauvegarder l’analyse</button></div>
      </div>
    </div>
  );
}

const MODE_VISITE_TERRAIN_OPTIONS = ["", "OK", "À vérifier", "Problème", "Non vu"];
const MODE_VISITE_CONCLUSIONS = ["", "À creuser", "Offre possible", "Contre-visite", "Abandonner"];
function ModeVisiteTerrainCard({ bien, T=THEMES_INV.dark, onSaved }) {
  const initial = bien?.visite_data?.mode_visite_terrain || {};
  const [data, setData] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(()=>setData(bien?.visite_data?.mode_visite_terrain || {}), [bien?.id]);
  const upd = (k,v)=>setData(prev=>({...prev,[k]:v}));
  const save = async () => {
    setSaving(true); setMsg("");
    const visite_data = { ...(bien.visite_data || {}), mode_visite_terrain:{ ...data, updated_at:new Date().toISOString(), conseiller:data.conseiller || bien.conseiller_profero || "" } };
    const payload = { visite_data };
    if (data.date_visite) payload.date_visite = data.date_visite;
    if (data.prochaine_action_date) payload.date_relance = data.prochaine_action_date;
    const { error } = await supabase.from("invest_biens").update(payload).eq("id", bien.id);
    setSaving(false);
    if (error) setMsg(`Erreur : ${error.message}`); else { setMsg("Mode visite sauvegardé"); onSaved?.(); setTimeout(()=>setMsg(""),2200); }
  };
  const quickField = (label, key) => (
    <div>
      <label className="inv-kpi-lbl">{label}</label>
      <select className="inv-sel" value={data[key] || ""} onChange={e=>upd(key,e.target.value)} style={{width:"100%"}}>{MODE_VISITE_TERRAIN_OPTIONS.map(o=><option key={o} value={o}>{o || "—"}</option>)}</select>
    </div>
  );
  return (
    <div className="inv-card">
      <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={PhoneIcon} size={13}/>Mode visite terrain</span></div>
      <div className="inv-card-bd">
        {msg && <div style={{fontSize:FONT.xs.size+1,color:msg.startsWith("Erreur")?DA:SU,fontWeight:800,marginBottom:8}}>{msg}</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div><label className="inv-kpi-lbl">Date de visite</label><input className="inv-inp" type="date" value={data.date_visite || bien.date_visite || ""} onChange={e=>upd("date_visite",e.target.value)} style={{width:"100%"}}/></div>
          <div><label className="inv-kpi-lbl">Conclusion rapide</label><select className="inv-sel" value={data.conclusion || ""} onChange={e=>upd("conclusion",e.target.value)} style={{width:"100%"}}>{MODE_VISITE_CONCLUSIONS.map(o=><option key={o} value={o}>{o || "—"}</option>)}</select></div>
          {quickField("État général", "etat_general")}
          {quickField("Toiture / façade", "toiture_facade")}
          {quickField("Humidité", "humidite")}
          {quickField("Électricité", "electricite")}
          {quickField("Plomberie", "plomberie")}
          {quickField("Découpe possible", "decoupe")}
        </div>
        <div style={{marginTop:10}}><label className="inv-kpi-lbl">Risques immédiats / notes terrain</label><textarea className="inv-textarea" rows={3} value={data.commentaire || ""} onChange={e=>upd("commentaire", e.target.value)} placeholder="Dictée vocale possible sur mobile : toiture, humidité, réseaux, accès, potentiel…"/></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 140px",gap:10,marginTop:10}}>
          <div><label className="inv-kpi-lbl">Prochaine action</label><input className="inv-inp" value={data.prochaine_action || ""} onChange={e=>upd("prochaine_action", e.target.value)} style={{width:"100%",textAlign:"left"}} placeholder="Ex : demander DDT, rappeler agent, faire offre…"/></div>
          <div><label className="inv-kpi-lbl">Date relance</label><input className="inv-inp" type="date" value={data.prochaine_action_date || bien.date_relance || ""} onChange={e=>upd("prochaine_action_date", e.target.value)} style={{width:"100%"}}/></div>
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",marginTop:10}}><button className="inv-btn inv-btn-blue inv-btn-sm" onClick={save} disabled={saving}><Icon as={Save} size={12}/> {saving?"Sync…":"Enregistrer visite"}</button></div>
      </div>
    </div>
  );
}



const VISITE_TERRAIN_STATUS_OPTIONS = ["", "OK", "À vérifier", "Problème", "Non vu", "Non applicable"];
const VISITE_TERRAIN_DECISIONS = ["", "À creuser", "Offre possible", "Contre-visite", "Abandonner"];
const VISITE_TERRAIN_INTERETS = ["", "Très intéressant", "Intéressant", "Moyen", "Faible", "Non pertinent"];
const VISITE_TERRAIN_POTENTIELS = ["", "Oui", "Non", "À vérifier"];
const VISITE_TERRAIN_POINTS = [
  { group:"Extérieur & structure", items:[
    ["toiture", "Toiture"], ["charpente", "Charpente"], ["facade", "Façade / ravalement"], ["fissures", "Fissures structurelles"], ["humidite", "Humidité / moisissures"],
  ]},
  { group:"Réseaux & équipements", items:[
    ["electricite", "Électricité"], ["plomberie", "Plomberie"], ["chauffage", "Chauffage"], ["vmc", "VMC / ventilation"], ["compteurs", "Compteurs individuels"],
  ]},
  { group:"Découpe & exploitation", items:[
    ["acces", "Accès indépendants"], ["escaliers", "Escaliers / circulation"], ["stationnement", "Stationnement"], ["configuration", "Configuration des lots"], ["marche_locatif", "Marché locatif perçu"],
  ]},
  { group:"Réglementaire", items:[
    ["copro", "Copropriété / règlement"], ["urbanisme", "Urbanisme / division"], ["dpe", "DPE / énergie"], ["documents", "Documents disponibles"],
  ]},
];
const VISITE_TERRAIN_DOCS = [
  ["photos", "Photos prises"], ["diagnostics", "Diagnostics / DDT"], ["plans", "Plans"], ["taxe_fonciere", "Taxe foncière"], ["devis", "Devis travaux"], ["copro", "Docs copropriété"], ["baux", "Baux existants"],
];

function normaliseModeVisiteTerrain(bien = {}) {
  const raw = bien?.visite_data?.mode_visite_terrain || {};
  const points = { ...(raw.points || {}) };
  VISITE_TERRAIN_POINTS.flatMap(g => g.items).forEach(([key]) => {
    points[key] = { statut:"", commentaire:"", ...(points[key] || {}) };
  });
  const docs = { ...(raw.docs || {}) };
  VISITE_TERRAIN_DOCS.forEach(([key]) => { if (docs[key] === undefined) docs[key] = false; });
  return {
    date_visite: raw.date_visite || bien.date_visite || new Date().toISOString().slice(0,10),
    conseiller: raw.conseiller || bien.conseiller_profero || "",
    temps_visite: raw.temps_visite || "",
    interet: raw.interet || "",
    conclusion: raw.conclusion || "",
    potentiel_decoupe: raw.potentiel_decoupe || "",
    offre_possible: raw.offre_possible || "",
    nombre_lots_possible: raw.nombre_lots_possible || "",
    budget_travaux_ressenti: raw.budget_travaux_ressenti || "",
    points,
    docs,
    photos_commentaire: raw.photos_commentaire || "",
    points_forts: raw.points_forts || "",
    points_blocants: raw.points_blocants || "",
    questions_agent: raw.questions_agent || "",
    prochaine_action: raw.prochaine_action || "",
    prochaine_action_date: raw.prochaine_action_date || bien.date_relance || "",
    commentaire: raw.commentaire || "",
    updated_at: raw.updated_at || null,
  };
}

function ModeVisiteTerrainOnglet({ bien, profil, T=THEMES_INV.dark, onSaved }) {
  const [data, setData] = useState(() => normaliseModeVisiteTerrain(bien));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState("");
  const autoSaveRef = useRef(null);
  const bootRef = useRef(true);
  const latestRef = useRef(data);

  useEffect(() => {
    const next = normaliseModeVisiteTerrain(bien);
    setData(next);
    latestRef.current = next;
    bootRef.current = true;
  }, [bien?.id]);

  const updateData = (patch) => {
    setData(prev => {
      const next = { ...prev, ...patch };
      latestRef.current = next;
      return next;
    });
  };
  const updatePoint = (key, patch) => {
    setData(prev => {
      const next = { ...prev, points:{ ...prev.points, [key]:{ ...(prev.points?.[key] || {}), ...patch } } };
      latestRef.current = next;
      return next;
    });
  };
  const updateDoc = (key, value) => {
    setData(prev => {
      const next = { ...prev, docs:{ ...prev.docs, [key]: value } };
      latestRef.current = next;
      return next;
    });
  };

  const pointLabels = VISITE_TERRAIN_POINTS.flatMap(g => g.items);
  const statusDone = pointLabels.filter(([key]) => !!latestRef.current.points?.[key]?.statut).length;
  const decisionDone = ["date_visite", "interet", "conclusion", "potentiel_decoupe", "prochaine_action"].filter(k => String(latestRef.current[k] || "").trim()).length;
  const total = pointLabels.length + 5;
  const done = statusDone + decisionDone;
  const pct = Math.min(100, Math.round((done / Math.max(total, 1)) * 100));
  const missing = [
    ...(!data.date_visite ? ["Date de visite"] : []),
    ...(!data.interet ? ["Intérêt du bien"] : []),
    ...(!data.conclusion ? ["Décision rapide"] : []),
    ...(!data.potentiel_decoupe ? ["Potentiel de découpe"] : []),
    ...(!data.prochaine_action ? ["Prochaine action"] : []),
    ...pointLabels.filter(([key]) => !data.points?.[key]?.statut).map(([,label]) => label),
  ];
  const problemes = pointLabels.filter(([key]) => data.points?.[key]?.statut === "Problème").map(([,label]) => label);
  const aVerifier = pointLabels.filter(([key]) => data.points?.[key]?.statut === "À vérifier").map(([,label]) => label);

  const getSuggestedStatut = (d) => {
    if (d.conclusion === "Offre possible") return "Offre à faire";
    if (d.conclusion === "Abandonner") return "Abandonné";
    if (d.conclusion === "Contre-visite") return "À relancer";
    if (d.conclusion === "À creuser") return "Visité";
    return bien.statut || "Visité";
  };

  const save = async ({ silent=false } = {}) => {
    if (!bien?.id) return;
    const d = latestRef.current;
    setSaving(true);
    setMsg("");
    const mode_visite_terrain = {
      ...d,
      conseiller: d.conseiller || profil?.nom || bien.conseiller_profero || "",
      completion_pct: pct,
      updated_at: new Date().toISOString(),
    };
    const visite_data = {
      ...(bien.visite_data || {}),
      mode_visite_terrain,
      conclusion: {
        ...(bien.visite_data?.conclusion || {}),
        recommandation: d.conclusion === "Offre possible" ? "Passer à l'offre" : d.conclusion === "Abandonner" ? "Abandonner" : (bien.visite_data?.conclusion?.recommandation || ""),
        prochaine_etape: d.prochaine_action || bien.visite_data?.conclusion?.prochaine_etape || "",
        commentaire_conseiller: d.commentaire || bien.visite_data?.conclusion?.commentaire_conseiller || "",
      },
    };
    const payload = {
      visite_data,
      date_visite: d.date_visite || bien.date_visite || null,
      date_relance: d.prochaine_action_date || bien.date_relance || null,
      statut: getSuggestedStatut(d),
      statut_relance: d.prochaine_action || bien.statut_relance || null,
    };
    const { error } = await supabase.from("invest_biens").update(payload).eq("id", bien.id);
    setSaving(false);
    if (error) {
      setMsg(`Erreur sauvegarde : ${error.message}`);
      if (!silent) alert("Erreur sauvegarde visite terrain : " + error.message);
      return;
    }
    setSaved(true);
    if (!silent) setMsg("Visite terrain sauvegardée");
    setTimeout(() => { setSaved(false); if (!silent) setMsg(""); }, 2200);
    onSaved?.();
  };

  useEffect(() => {
    if (bootRef.current) { bootRef.current = false; return; }
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => save({ silent:true }), 900);
    return () => { if (autoSaveRef.current) clearTimeout(autoSaveRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const statusColor = (st) => st === "OK" ? SU : st === "À vérifier" ? WA : st === "Problème" ? DA : T.textMuted;
  const DecisionButton = ({ value }) => {
    const active = data.conclusion === value;
    return (
      <button
        className="inv-btn inv-btn-sm"
        onClick={() => updateData({ conclusion:value })}
        style={{
          background: active ? (value === "Offre possible" ? SEMANTIC.success.bg : value === "Abandonner" ? SEMANTIC.danger.bg : T.accentBg) : T.input,
          border:`1px solid ${active ? (value === "Offre possible" ? SEMANTIC.success.border : value === "Abandonner" ? SEMANTIC.danger.border : T.accentBorder) : T.border}`,
          color: active ? (value === "Offre possible" ? SU : value === "Abandonner" ? DA : T.accent) : T.textSub,
          justifyContent:"center",
        }}
      >{value}</button>
    );
  };

  return (
    <div style={{display:"grid",gridTemplateColumns:"300px 1fr",gap:16,alignItems:"start"}}>
      <div style={{position:"sticky",top:14,display:"flex",flexDirection:"column",gap:12}}>
        <div className="inv-card">
          <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={PhoneIcon} size={13}/>Visite terrain</span></div>
          <div className="inv-card-bd">
            {msg && <div style={{fontSize:FONT.xs.size+1,color:msg.startsWith("Erreur")?DA:SU,fontWeight:800,marginBottom:8}}>{msg}</div>}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:8}}>
              <div>
                <div className="inv-kpi-lbl">Complétion terrain</div>
                <div style={{fontSize:FONT.h2.size,fontWeight:900,color:T.text,lineHeight:1}}>{pct}%</div>
              </div>
              <div style={{fontSize:FONT.xs.size,color:T.textMuted,textAlign:"right"}}>{done}/{total}<br/>réponses</div>
            </div>
            <div style={{height:8,borderRadius:RADIUS.pill,background:T.input,overflow:"hidden",border:`1px solid ${T.border}`}}>
              <div style={{height:"100%",width:`${pct}%`,background:pct>=80?SU:pct>=45?WA:DA,transition:"width .2s"}}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:12}}>
              <div style={{padding:8,borderRadius:RADIUS.md,background:SEMANTIC.danger.bg,border:`1px solid ${SEMANTIC.danger.border}`,color:DA,fontWeight:800,fontSize:FONT.sm.size}}>⚠ {problemes.length} problème{problemes.length>1?"s":""}</div>
              <div style={{padding:8,borderRadius:RADIUS.md,background:SEMANTIC.warning.bg,border:`1px solid ${SEMANTIC.warning.border}`,color:WA,fontWeight:800,fontSize:FONT.sm.size}}>⏳ {aVerifier.length} à vérifier</div>
            </div>
            <button className="inv-btn inv-btn-blue" onClick={() => save({ silent:false })} disabled={saving} style={{width:"100%",justifyContent:"center",marginTop:12}}>
              <Icon as={saving ? RefreshCw : Save} size={13} style={saving ? {animation:"spin 1s linear infinite"} : undefined}/>
              {saving ? "Sauvegarde…" : saved ? "Sauvegardé" : "Enregistrer la visite"}
            </button>
            <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:8,lineHeight:1.45}}>Autosave actif après chaque saisie. Le statut du bien est ajusté selon la décision rapide.</div>
          </div>
        </div>

        <div className="inv-card">
          <div className="inv-card-hd"><span>À compléter</span></div>
          <div className="inv-card-bd" style={{maxHeight:260,overflowY:"auto"}}>
            {missing.length === 0 ? (
              <div style={{fontSize:FONT.sm.size,color:SU,fontWeight:800}}>Toutes les réponses terrain sont complétées.</div>
            ) : missing.slice(0,18).map(m => (
              <div key={m} style={{fontSize:FONT.xs.size+1,color:T.textSub,padding:"4px 0",borderBottom:`1px solid ${T.rowBorder}`}}>• {m}</div>
            ))}
            {missing.length > 18 && <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:6}}>+ {missing.length-18} autres éléments</div>}
          </div>
        </div>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:16}}>
        <div className="inv-card">
          <div className="inv-card-hd gold"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Sparkles} size={13}/>Décision rapide en fin de visite</span></div>
          <div className="inv-card-bd">
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
              {VISITE_TERRAIN_DECISIONS.filter(Boolean).map(v => <DecisionButton key={v} value={v}/>)}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              <div><label className="inv-kpi-lbl">Intérêt du bien</label><select className="inv-sel" value={data.interet} onChange={e=>updateData({interet:e.target.value})} style={{width:"100%"}}>{VISITE_TERRAIN_INTERETS.map(o=><option key={o} value={o}>{o||"—"}</option>)}</select></div>
              <div><label className="inv-kpi-lbl">Potentiel découpe</label><select className="inv-sel" value={data.potentiel_decoupe} onChange={e=>updateData({potentiel_decoupe:e.target.value})} style={{width:"100%"}}>{VISITE_TERRAIN_POTENTIELS.map(o=><option key={o} value={o}>{o||"—"}</option>)}</select></div>
              <div><label className="inv-kpi-lbl">Offre possible</label><select className="inv-sel" value={data.offre_possible} onChange={e=>updateData({offre_possible:e.target.value})} style={{width:"100%"}}>{VISITE_TERRAIN_POTENTIELS.map(o=><option key={o} value={o}>{o||"—"}</option>)}</select></div>
              <div><label className="inv-kpi-lbl">Date visite</label><input className="inv-inp" type="date" value={data.date_visite} onChange={e=>updateData({date_visite:e.target.value})} style={{width:"100%"}}/></div>
              <div><label className="inv-kpi-lbl">Conseiller</label><input className="inv-inp" value={data.conseiller} onChange={e=>updateData({conseiller:e.target.value})} style={{width:"100%",textAlign:"left"}} placeholder={profil?.nom||"Conseiller"}/></div>
              <div><label className="inv-kpi-lbl">Temps de visite</label><input className="inv-inp" value={data.temps_visite} onChange={e=>updateData({temps_visite:e.target.value})} style={{width:"100%",textAlign:"left"}} placeholder="Ex : 25 min"/></div>
            </div>
          </div>
        </div>

        <div className="inv-card">
          <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Check} size={13}/>Checklist terrain rapide</span></div>
          <div className="inv-card-bd" style={{display:"flex",flexDirection:"column",gap:14}}>
            {VISITE_TERRAIN_POINTS.map(group => (
              <div key={group.group}>
                <div style={{fontSize:FONT.xs.size,fontWeight:900,color:T.accent,textTransform:"uppercase",letterSpacing:1.2,marginBottom:8}}>{group.group}</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:8}}>
                  {group.items.map(([key,label]) => {
                    const row = data.points?.[key] || {};
                    return (
                      <div key={key} style={{border:`1px solid ${T.border}`,borderRadius:RADIUS.md,background:T.input,padding:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",marginBottom:7}}>
                          <div style={{fontSize:FONT.sm.size+1,fontWeight:800,color:T.text}}>{label}</div>
                          <select className="inv-sel" value={row.statut || ""} onChange={e=>updatePoint(key,{statut:e.target.value})} style={{width:118,color:statusColor(row.statut),fontWeight:800}}>{VISITE_TERRAIN_STATUS_OPTIONS.map(o=><option key={o} value={o}>{o||"—"}</option>)}</select>
                        </div>
                        <input className="inv-inp" value={row.commentaire || ""} onChange={e=>updatePoint(key,{commentaire:e.target.value})} style={{width:"100%",textAlign:"left",fontSize:FONT.xs.size+1}} placeholder="Commentaire rapide…"/>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <div className="inv-card">
            <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Building2} size={13}/>Découpe & chiffrage ressenti</span></div>
            <div className="inv-card-bd" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div><label className="inv-kpi-lbl">Nombre de lots possible</label><input className="inv-inp" value={data.nombre_lots_possible} onChange={e=>updateData({nombre_lots_possible:e.target.value})} style={{width:"100%"}} placeholder="Ex : 4"/></div>
              <div><label className="inv-kpi-lbl">Budget travaux ressenti</label><input className="inv-inp" value={data.budget_travaux_ressenti} onChange={e=>updateData({budget_travaux_ressenti:e.target.value})} style={{width:"100%"}} placeholder="Ex : 140 000"/></div>
              <div style={{gridColumn:"1 / -1"}}><label className="inv-kpi-lbl">Points forts</label><textarea className="inv-textarea" rows={2} value={data.points_forts} onChange={e=>updateData({points_forts:e.target.value})} placeholder="Emplacement, volumes, accès, luminosité, demande locative…"/></div>
              <div style={{gridColumn:"1 / -1"}}><label className="inv-kpi-lbl">Points bloquants</label><textarea className="inv-textarea" rows={2} value={data.points_blocants} onChange={e=>updateData({points_blocants:e.target.value})} placeholder="Structure, humidité, copropriété, stationnement, DPE, enveloppe travaux…"/></div>
            </div>
          </div>

          <div className="inv-card">
            <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={FileText} size={13}/>Documents & photos à chaud</span></div>
            <div className="inv-card-bd">
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                {VISITE_TERRAIN_DOCS.map(([key,label]) => (
                  <label key={key} style={{display:"flex",alignItems:"center",gap:8,fontSize:FONT.sm.size+1,color:T.textSub,fontWeight:700,background:T.input,border:`1px solid ${T.border}`,borderRadius:RADIUS.md,padding:"8px 9px",cursor:"pointer"}}>
                    <input type="checkbox" checked={!!data.docs?.[key]} onChange={e=>updateDoc(key,e.target.checked)}/>
                    {label}
                  </label>
                ))}
              </div>
              <label className="inv-kpi-lbl">Commentaire photos / documents</label>
              <textarea className="inv-textarea" rows={3} value={data.photos_commentaire} onChange={e=>updateData({photos_commentaire:e.target.value})} placeholder="Photos manquantes, documents à demander à l’agent, pièces bloquantes…"/>
            </div>
          </div>
        </div>

        <div className="inv-card">
          <div className="inv-card-hd danger"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={AlertTriangle} size={13}/>Suite à donner</span></div>
          <div className="inv-card-bd">
            <div style={{display:"grid",gridTemplateColumns:"1fr 160px",gap:10,marginBottom:10}}>
              <div><label className="inv-kpi-lbl">Prochaine action</label><input className="inv-inp" value={data.prochaine_action} onChange={e=>updateData({prochaine_action:e.target.value})} style={{width:"100%",textAlign:"left"}} placeholder="Ex : faire offre, demander DDT, programmer contre-visite…"/></div>
              <div><label className="inv-kpi-lbl">Date relance</label><input className="inv-inp" type="date" value={data.prochaine_action_date} onChange={e=>updateData({prochaine_action_date:e.target.value})} style={{width:"100%"}}/></div>
            </div>
            <label className="inv-kpi-lbl">Questions à poser / notes libres</label>
            <textarea className="inv-textarea" rows={3} value={data.questions_agent} onChange={e=>updateData({questions_agent:e.target.value})} placeholder="Questions à l’agent, points à vérifier en mairie, éléments à transmettre à Profero Rénovation…"/>
            <label className="inv-kpi-lbl" style={{marginTop:10,display:"block"}}>Commentaire final terrain</label>
            <textarea className="inv-textarea" rows={3} value={data.commentaire} onChange={e=>updateData({commentaire:e.target.value})} placeholder="Conclusion terrain rapide : pourquoi on poursuit ou pourquoi on abandonne…"/>
          </div>
        </div>
      </div>
    </div>
  );
}
function DossiersRelanceDashboard({ clients=[], biens=[], propositions=[], T=THEMES_INV.dark, onNavigate }) {
  const today = isoDate(new Date());
  const items = [];
  clients.filter(c => c.statut !== "Terminé" && !c.prochaine_action).slice(0,4).forEach(c => items.push({title:`${getClientName(c)} — aucune prochaine action`, sub:`${c.etape || c.statut || "À qualifier"}`, badge:"Client", color:DA, icon:Users, onClick:()=>onNavigate?.("crm", { type:"sans_action" })}));
  biens.filter(b => b.date_relance && b.date_relance <= today).slice(0,4).forEach(b => items.push({title:`${b.adresse || b.ville || "Bien"} — relance à faire`, sub:`${safeDate(b.date_relance)} · ${b.statut || "statut non renseigné"}`, badge:"Bien", color:WA, icon:Bell, onClick:()=>onNavigate?.("biens", { type:"a_relancer" })}));
  biens.filter(b => ["Offre envoyée"].includes(b.statut) && !(b.date_relance && b.date_relance > today)).slice(0,3).forEach(b => items.push({title:`Offre sans relance — ${b.adresse || b.ville || "Bien"}`, sub:`Offre ${fmtDashboardEur(b.montant_offre)} · programmer une relance`, badge:"Offre", color:T.accent, icon:Send, onClick:()=>onNavigate?.("biens", { type:"statut", value:"Offre envoyée" })}));
  propositions.filter(p => p.statut === "proposé" || p.statut === "en analyse").slice(0,3).forEach(p => items.push({title:`Proposition à suivre`, sub:`Client / bien à relancer · ${safeDate(p.date_proposition || p.created_at)}`, badge:"Prop.", color:"#c084fc", icon:Handshake}));
  return <DashboardPanel title="Dossiers à relancer" icon={Bell} subtitle="Clients, biens, offres et propositions à ne pas laisser dormir" T={T}><DashboardAlertList items={items.slice(0,10)} T={T} empty="Aucun dossier à relancer" /></DashboardPanel>;
}

const HONORAIRE_BASE_CONTRAT_HT = 1583;
const HONORAIRE_CONSEIL_MOYEN_HT = 7500;

function DirectionPilotageDashboard({ stats, T=THEMES_INV.dark }) {
  if (!stats) return null;
  const items = [
    ["Honoraires signés", fmtDashboardEur(stats.baseHonorairesSignes), SU, "Base 1 583 € HT / client signé"],
    ["Honoraires pipeline", fmtDashboardEur(stats.baseHonorairesPipeline), "#FFC200", "Clients en cours + prospects"],
    ["Conseil estimé", fmtDashboardEur(stats.estimationHonoraireConseil), "#c084fc", "Moy. 7 500 € HT / offre active"],
    ["Taux transformation", `${stats.tauxTransformation || 0}%`, T.accent, "Clients réels / contacts"],
    ["Acceptation offres", `${stats.tauxAcceptationOffres || 0}%`, SU, "Offres acceptées / envoyées"],
    ["Délai signature", stats.delaiMoyenSignature !== null ? `${stats.delaiMoyenSignature} j` : "—", WA, "Premier contact → signature"],
    ["Qualité stock", `${stats.tauxFichesCompletes || 0}%`, T.accent, "Fiches biens complètes"],
  ];
  return (
    <DashboardPanel title="Direction / pilotage" icon={BarChart3} subtitle="Vision dirigeant : CA, conversion, délai et qualité du stock" T={T}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
        {items.map(([label,value,color,sub])=>(
          <div key={label} className="inv-kpi" style={{padding:12,borderLeft:`3px solid ${color}`}}>
            <div className="inv-kpi-lbl">{label}</div>
            <div className="inv-kpi-val" style={{fontSize:FONT.xl.size,color}}>{value}</div>
            <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:3}}>{sub}</div>
          </div>
        ))}
      </div>
    </DashboardPanel>
  );
}

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

function ActionsPrioritairesDashboard({ clients=[], biens=[], planning=[], T=THEMES_INV.dark, onNavigate }) {
  const { today, endWeek } = getWeekRange();
  const items = [];
  clients.filter(c => c.prochaine_action && c.date_prochaine_action && c.date_prochaine_action < today)
    .sort((a,b)=>String(a.date_prochaine_action).localeCompare(String(b.date_prochaine_action))).slice(0,4)
    .forEach(c => items.push({
      title:`${getClientName(c)} — action en retard`, sub:`${safeDate(c.date_prochaine_action)} · ${c.prochaine_action}`, badge:"Retard", color:DA, icon:AlertTriangle,
      onClick:()=>onNavigate?.("crm", { type:"actions_week_or_late" })
    }));
  biens.filter(b => b.date_relance && b.date_relance <= today)
    .sort((a,b)=>String(a.date_relance).localeCompare(String(b.date_relance))).slice(0,3)
    .forEach(b => items.push({
      title:`Relancer le bien — ${b.adresse || b.ville || "sans adresse"}`, sub:`Relance prévue le ${safeDate(b.date_relance)} · ${b.statut || "statut non renseigné"}`, badge:"Bien", color:WA, icon:Bell,
      onClick:()=>onNavigate?.("biens", { type:"a_relancer" })
    }));
  planning.filter(e => e.date_rdv === today).slice(0,3).forEach(e => items.push({
    title:`Aujourd'hui — ${e.titre}`, sub:`${e.heure_debut ? e.heure_debut.slice(0,5) : "Horaire libre"} · ${e.type || "RDV"}`, badge:"Aujourd'hui", color:SU, icon:Calendar,
  }));
  clients.filter(c => c.prochaine_action && c.date_prochaine_action && c.date_prochaine_action >= today && c.date_prochaine_action <= endWeek)
    .sort((a,b)=>String(a.date_prochaine_action).localeCompare(String(b.date_prochaine_action))).slice(0,3)
    .forEach(c => items.push({
      title:`${getClientName(c)} — action cette semaine`, sub:`${safeDate(c.date_prochaine_action)} · ${c.prochaine_action}`, badge:"Semaine", color:T.accent, icon:Calendar,
      onClick:()=>onNavigate?.("crm", { type:"actions_week_or_late" })
    }));
  return (
    <DashboardPanel title="À faire en priorité" icon={AlertTriangle} subtitle="Actions, relances et RDV les plus urgents" T={T}>
      <DashboardAlertList items={items.slice(0,10)} T={T} empty="Aucune action prioritaire cette semaine" />
    </DashboardPanel>
  );
}

function OpportunitesChaudesDashboard({ biens=[], T=THEMES_INV.dark, onNavigate }) {
  const hot = [...biens]
    .map(b => ({ ...b, _score:getBienScore(b) }))
    .filter(b => b._score > 0 || ["Visite programmée", "Visité", "À analyser", "A analyser", "Offre à faire", "Offre envoyée", "Offre acceptée"].includes(b.statut))
    .sort((a,b)=>b._score-a._score)
    .slice(0,6);
  return (
    <DashboardPanel title="Opportunités chaudes" icon={Sparkles} subtitle="Biens qui méritent une décision rapide" T={T}>
      {hot.length === 0 ? (
        <div style={{padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, color:T.textMuted, textAlign:"center", fontSize:FONT.sm.size+1, fontStyle:"italic"}}>Aucune opportunité chaude détectée</div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:SPACING.md}}>
          {hot.map(b => {
            const v = b.visite_data || {};
            const recom = v?.conclusion?.recommandation || b.statut || "À analyser";
            return (
              <button key={b.id} type="button" onClick={()=>onNavigate?.("biens", { type:"all" })}
                style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:RADIUS.lg,padding:SPACING.md,textAlign:"left",fontFamily:"inherit",cursor:"pointer",transition:"all .12s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=T.accent; e.currentTarget.style.transform="translateY(-1px)";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border; e.currentTarget.style.transform="none";}}>
                <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8,marginBottom:8}}>
                  <div style={{fontSize:FONT.sm.size+1,fontWeight:900,color:T.text,lineHeight:1.25,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{getBienLabel(b)}</div>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:FONT.xs.size,fontWeight:900,color:T.accent,background:T.accentBg,border:`1px solid ${T.accentBorder}`,borderRadius:RADIUS.pill,padding:"3px 7px"}}>Score {b._score}</span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
                  <div style={{fontSize:FONT.xs.size,color:T.textMuted}}>Rendement<br/><strong style={{fontSize:FONT.sm.size+1,color:SU}}>{b.rendement_brut ? fmtDashboardPct(b.rendement_brut) : "—"}</strong></div>
                  <div style={{fontSize:FONT.xs.size,color:T.textMuted}}>Cash-flow<br/><strong style={{fontSize:FONT.sm.size+1,color:Number(b.cashflow_estime)>0?SU:WA}}>{fmtDashboardEur(b.cashflow_estime)}</strong></div>
                  <div style={{fontSize:FONT.xs.size,color:T.textMuted}}>Offre<br/><strong style={{fontSize:FONT.sm.size+1,color:T.accent}}>{fmtDashboardEur(b.montant_offre)}</strong></div>
                  <div style={{fontSize:FONT.xs.size,color:T.textMuted}}>Travaux<br/><strong style={{fontSize:FONT.sm.size+1,color:T.textSub}}>{fmtDashboardEur(b.prix_travaux)}</strong></div>
                </div>
                <div style={{fontSize:FONT.xs.size+1,color:T.textSub,display:"flex",justifyContent:"space-between",gap:8}}>
                  <span>{recom}</span><span>{b.statut || "—"}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </DashboardPanel>
  );
}

function StockPilotageDashboard({ stats, T=THEMES_INV.dark, onNavigate }) {
  if (!stats) return null;
  return (
    <>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:SPACING.md, marginBottom:SPACING.lg }}>
        <KPICard icon={Home} label="Biens en stock" value={stats.biensTotaux} color="#4db8ff" onClick={()=>onNavigate?.("biens", { type:"all" })}/>
        <KPICard icon={Sparkles} label="Top opportunités" value={stats.topOpportunites} color="#c084fc" sub="Score Profero élevé" onClick={()=>onNavigate?.("biens", { type:"all" })}/>
        <KPICard icon={Bell} label="À relancer" value={stats.biensARelancer} color={DA} onClick={()=>onNavigate?.("biens", { type:"a_relancer" })}/>
        <KPICard icon={Send} label="Offres envoyées" value={stats.offreEnvoyees} color="#FFC200" onClick={()=>onNavigate?.("biens", { type:"statut", value:"Offre envoyée" })}/>
        <KPICard icon={Check} label="Offres acceptées" value={stats.offresAcceptees} color={SU} onClick={()=>onNavigate?.("biens", { type:"statut", value:"Offre acceptée" })}/>
        <KPICard icon={AlertTriangle} label="Fiches incomplètes" value={stats.biensIncomplets} color={WA} sub={`${stats.tauxFichesCompletes}% complètes`}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))",gap:SPACING.md,marginBottom:SPACING.xxl-2}}>
        {[
          ["Fiches complètes", stats.tauxFichesCompletes, SU],
          ["Biens géolocalisés", stats.tauxGeoloc, T.accent],
          ["Simulateurs remplis", stats.tauxSimulateur, "#c084fc"],
          ["Offres / stock", stats.tauxOffresStock, "#FFC200"],
        ].map(([label,pct,color]) => (
          <div key={label} className="inv-card" style={{padding:SPACING.md,borderLeft:`3px solid ${color}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div className="inv-kpi-lbl">{label}</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontWeight:900,color}}>{pct}%</div>
            </div>
            <div style={{height:7,background:T.input,borderRadius:RADIUS.pill,overflow:"hidden",border:`1px solid ${T.border}`}}>
              <div style={{height:"100%",width:`${Math.max(0,Math.min(100,pct))}%`,background:color,borderRadius:RADIUS.pill}}/>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function PipelineEtapesBoard({ clients=[], T=THEMES_INV.dark, movingClientId, onMoveClient, onOpenEtape }) {
  const [dragOverEtape, setDragOverEtape] = useState("");
  const clientsByEtape = ETAPES_CLIENT.reduce((acc, etape) => {
    acc[etape] = clients.filter(c => (c.etape || "") === etape)
      .sort((a,b)=>String(a.nom||"").localeCompare(String(b.nom||""), "fr", { sensitivity:"base" }));
    return acc;
  }, {});
  const noStage = clients.filter(c => !c.etape);
  const columns = [{etape:"", label:"Étape non définie", color:DA, list:noStage}, ...ETAPES_CLIENT.map((etape,i)=>({ etape, label:etape, color:DASH_STAGE_COLORS[i % DASH_STAGE_COLORS.length], list:clientsByEtape[etape] || [] }))];
  return (
    <DashboardPanel title="Pipeline clients par étape" icon={TrendingUp} subtitle="Glisser-déposer pour changer l’étape du client" T={T}>
      <div style={{display:"flex",gap:SPACING.md,overflowX:"auto",paddingBottom:4}}>
        {columns.map(col => {
          const isOver = dragOverEtape === col.etape;
          const budget = col.list.reduce((s,c)=>s+(Number(c.budget)||0),0);
          return (
            <div key={col.label}
              onDragOver={e=>{e.preventDefault();setDragOverEtape(col.etape);}}
              onDragLeave={()=>setDragOverEtape("")}
              onDrop={e=>{e.preventDefault(); const clientId=e.dataTransfer.getData("text/plain"); setDragOverEtape(""); if(clientId) onMoveClient?.(clientId, col.etape);}}
              style={{minWidth:235,maxWidth:250,background:isOver?`${col.color}12`:T.input,border:`1.5px solid ${isOver?col.color:T.border}`,borderRadius:RADIUS.lg,padding:SPACING.sm+2,transition:"all .15s"}}>
              <button type="button" onClick={()=>onOpenEtape?.(col.etape)} style={{border:"none",background:"transparent",padding:0,cursor:"pointer",fontFamily:"inherit",textAlign:"left",width:"100%"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:5}}>
                  <div style={{fontSize:FONT.xs.size+1,fontWeight:900,color:col.color,lineHeight:1.2,textTransform:"uppercase",letterSpacing:.6}}>{col.label}</div>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:FONT.xs.size,fontWeight:900,color:col.color,background:`${col.color}18`,border:`1px solid ${col.color}33`,borderRadius:RADIUS.pill,padding:"2px 7px"}}>{col.list.length}</span>
                </div>
                <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginBottom:9}}>Budget cumulé : <strong style={{color:T.textSub}}>{fmtDashboardEur(budget)}</strong></div>
              </button>
              <div style={{display:"flex",flexDirection:"column",gap:7,minHeight:72}}>
                {col.list.length === 0 ? <div style={{border:`1px dashed ${T.border}`,borderRadius:RADIUS.md,padding:SPACING.sm,textAlign:"center",fontSize:FONT.xs.size,color:T.textMuted,fontStyle:"italic"}}>Déposer ici</div> : col.list.slice(0,8).map(c => (
                  <div key={c.id} draggable onDragStart={e=>{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",c.id);}}
                    style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:RADIUS.md,padding:`${SPACING.sm-1}px ${SPACING.sm}px`,cursor:movingClientId===c.id?"wait":"grab",opacity:movingClientId===c.id ? .55 : 1}}>
                    <div style={{fontSize:FONT.sm.size,fontWeight:800,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{getClientName(c)}</div>
                    <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:2,display:"flex",justifyContent:"space-between",gap:8}}><span>{fmtDashboardEur(c.budget)}</span><span>{safeDate(c.date_prochaine_action)}</span></div>
                  </div>
                ))}
                {col.list.length > 8 && <div style={{fontSize:FONT.xs.size,color:T.textMuted,textAlign:"center"}}>+ {col.list.length - 8} autre{col.list.length - 8 > 1 ? "s" : ""}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </DashboardPanel>
  );
}

function ClientsARisqueDashboard({ clients=[], propositions=[], T=THEMES_INV.dark, onNavigate }) {
  const propByClient = propositions.reduce((acc,p)=>{ if(p.client_id) acc[p.client_id]=(acc[p.client_id]||0)+1; return acc; }, {});
  const risks = [];
  clients.filter(c => c.statut !== "Prospect").forEach(c => {
    if (!c.prochaine_action && !c.date_prochaine_action) risks.push({title:`${getClientName(c)} — aucune prochaine action`, sub:`Statut : ${c.statut || "—"} · Étape : ${c.etape || "non définie"}`, color:DA, icon:AlertTriangle, onClick:()=>onNavigate?.("crm", { type:"sans_action" })});
    if ((c.statut === "Actif" || c.date_signature) && !propByClient[c.id]) risks.push({title:`${getClientName(c)} — aucun bien proposé`, sub:`Budget : ${fmtDashboardEur(c.budget)} · Contrat signé`, color:WA, icon:Home, onClick:()=>onNavigate?.("crm", { type:"signes" })});
    if (!c.etape) risks.push({title:`${getClientName(c)} — étape non définie`, sub:`Le parcours client n’est pas pilotable`, color:"#c084fc", icon:TrendingUp, onClick:()=>onNavigate?.("crm", { type:"all" })});
  });
  return (
    <DashboardPanel title="Clients à risque" icon={AlertTriangle} subtitle="Situations qui peuvent créer une perte de suivi" T={T}>
      <DashboardAlertList items={risks.slice(0,8)} T={T} empty="Aucun client à risque détecté" />
    </DashboardPanel>
  );
}

function PerformanceCommercialeDashboard({ stats, T=THEMES_INV.dark }) {
  if (!stats) return null;
  const cards = [
    ["Transformation contacts → clients", `${stats.tauxTransformation}%`, "Clients hors prospects / total contacts", SU, Handshake],
    ["Biens proposés / client actif", stats.biensParClientActif.toFixed(1).replace(".", ","), "Propositions / clients actifs", T.accent, Building2],
    ["Offres acceptées / envoyées", `${stats.tauxAcceptationOffres}%`, "Offres acceptées / offres actives", "#FFC200", Check],
    ["Délai moyen signature", stats.delaiMoyenSignature ? `${stats.delaiMoyenSignature} j` : "—", "Premier contact → signature", "#c084fc", Calendar],
  ];
  return (
    <DashboardPanel title="Performance commerciale" icon={BarChart3} subtitle="Ratios de conversion et rythme commercial" T={T}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:SPACING.md}}>
        {cards.map(([label,value,sub,color,IconComp]) => <KPICard key={label} label={label} value={value} sub={sub} color={color} icon={IconComp}/>) }
      </div>
    </DashboardPanel>
  );
}

function ValeurBusinessDashboard({ stats, T=THEMES_INV.dark }) {
  if (!stats) return null;
  return (
    <DashboardPanel title="Valeur business potentielle" icon={Wallet} subtitle="Vision financière du pipeline" T={T}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:SPACING.md}}>
        <KPICard icon={Wallet} label="Budget clients actifs" value={fmtDashboardEur(stats.budgetClientsActifs)} color={T.accent} sub="Prospects exclus"/>
        <KPICard icon={Send} label="Montant offres en cours" value={fmtDashboardEur(stats.montantOffresCours)} color="#FFC200" sub="Offres renseignées sur les biens/projets"/>
        <KPICard icon={Handshake} label="Base honoraires signés" value={fmtDashboardEur(stats.baseHonorairesSignes)} color={SU} sub="1 583 € HT / client signé"/>
        <KPICard icon={TrendingUp} label="Base honoraires pipeline" value={fmtDashboardEur(stats.baseHonorairesPipeline)} color="#c084fc" sub="Clients en cours + prospects"/>
        <KPICard icon={Briefcase} label="Estimation honoraire conseil" value={fmtDashboardEur(stats.estimationHonoraireConseil)} color="#4db8ff" sub="7 500 € HT / offre active"/>
      </div>
    </DashboardPanel>
  );
}


function getProjetSimFinance(p = {}) {
  const d = p?.donnees || {};
  const inputs = d.inputs || {};
  const selects = d.selects || {};
  const lots = Array.isArray(d.lots) ? d.lots.filter(l => l && l.type && l.type !== "Sélectionner") : [];
  const prixNegocie = Number(inputs.prixNegocie || 0);
  const tauxNotaire = Number(inputs.tauxNotaire ?? 0.08);
  const fraisNotaire = prixNegocie * tauxNotaire;
  const budgetTravaux = Number(inputs.budgetTravaux || 0);
  const honoraires = Number(inputs.honoraires || 0);
  const enedis = Number(inputs.enedis || 0);
  const coutTotal = prixNegocie + fraisNotaire + budgetTravaux + honoraires + enedis;
  const loyersMensuels = lots.reduce((s, l) => s + (Number(l.loyer) || 0), 0);
  const loyersAnnuels = loyersMensuels * 12;
  const gestionActive = !!selects.gestionActive;
  const gestionAnnuelle = gestionActive
    ? lots.reduce((s, l) => s + (GESTION_PRICES[l.type] || 0), 0) * 12
    : 0;
  const charges = Number(inputs.taxeFonciere || 0)
    + Number(inputs.assurance || 0)
    + Number(inputs.compta || 0)
    + Number(inputs.provisions || 0)
    + gestionAnnuelle;
  const mensualite = pmt(
    Math.max(0, coutTotal - (Number(inputs.apport1) || 0)),
    Number(inputs.taux1 || 0),
    Number(inputs.duree1 || 0)
  );
  const rendementBrut = coutTotal > 0 ? (loyersAnnuels / coutTotal) * 100 : 0;
  const rendementNet = coutTotal > 0 ? ((loyersAnnuels - charges) / coutTotal) * 100 : 0;
  const cashflowMensuel = loyersMensuels ? ((loyersAnnuels - charges) / 12) - mensualite : 0;
  return { coutTotal, loyersMensuels, loyersAnnuels, rendementBrut, rendementNet, cashflowMensuel, nbLots:lots.length };
}


const FINANCE_CLIENT_PROB_DEFAULTS = {
  prospect: 0.20,
  actif: 0.75,
  inactif: 0.15,
  termine: 1,
};

function numFinance(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function firstPositive(obj, keys=[]) {
  for (const k of keys) {
    const n = numFinance(obj?.[k]);
    if (n > 0) return n;
  }
  return 0;
}

function includesAny(v, words=[]) {
  const n = normTxt(v || "");
  return words.some(w => n.includes(normTxt(w)));
}

function getClientPipelineProbability(c={}) {
  if (c.date_signature) return 1;
  if (includesAny(c.etape, ["signature contrat"])) return 0.85;
  if (includesAny(c.etape, ["envoi des documents", "stratégie", "strategie"])) return 0.65;
  if (includesAny(c.etape, ["recherche", "visites", "analyse", "présentation", "presentation"])) return 0.55;
  if (includesAny(c.etape, ["offre", "compromis", "financement", "notaire"])) return 0.90;
  if (c.statut === "Actif") return FINANCE_CLIENT_PROB_DEFAULTS.actif;
  if (c.statut === "Inactif") return FINANCE_CLIENT_PROB_DEFAULTS.inactif;
  if (c.statut === "Terminé") return FINANCE_CLIENT_PROB_DEFAULTS.termine;
  return FINANCE_CLIENT_PROB_DEFAULTS.prospect;
}

function getOffreProbability(statut="") {
  if (includesAny(statut, ["compromis", "notaire", "financement", "conditions suspensives"])) return 1;
  if (includesAny(statut, ["acceptée", "acceptee", "accepté", "accepte"])) return 0.80;
  if (includesAny(statut, ["envoyée", "envoyee", "en cours", "proposé", "propose", "intéressé", "interesse"])) return 0.50;
  if (includesAny(statut, ["à faire", "a faire", "possible", "visité", "visite", "à analyser", "a analyser"])) return 0.25;
  if (includesAny(statut, ["refus", "aband", "perdu"])) return 0;
  return 0.35;
}

function getClientEncaisse(c={}) {
  return firstPositive(c, [
    "ca_encaisse_ht", "ca_encaisse", "honoraires_encaisse_ht", "honoraires_encaisse",
    "honoraires_fixes_encaisse_ht", "montant_encaisse", "paiement_recu", "honoraires_payes",
    "acompte_encaisse", "acompte_ht"
  ]);
}

function getStageDefaultDays(c={}) {
  if (c.date_signature) return 15;
  if (includesAny(c.etape, ["signature contrat"])) return 15;
  if (c.statut === "Actif") return 30;
  if (c.statut === "Prospect") return 60;
  return 90;
}

function getDueDateOrDefault(dateValue, days=30) {
  if (dateValue) {
    const d = new Date(dateValue);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function addToForecastBuckets(buckets, amount, dueDate) {
  const n = numFinance(amount);
  if (n <= 0) return;
  const days = daysBetween(new Date(), dueDate);
  if (!Number.isFinite(days)) { buckets.d90 += n; return; }
  if (days <= 30) buckets.d30 += n;
  if (days <= 60) buckets.d60 += n;
  if (days <= 90) buckets.d90 += n;
}

function getClientFirstProjectDate(clientId, propositions=[], projets=[]) {
  const dates = [];
  propositions.filter(p => p.client_id === clientId).forEach(p => { if (p.date_proposition || p.created_at) dates.push(new Date(p.date_proposition || p.created_at)); });
  projets.filter(p => p.client_id === clientId).forEach(p => { if (p.created_at || p.updated_at) dates.push(new Date(p.created_at || p.updated_at)); });
  const valid = dates.filter(d => !Number.isNaN(d.getTime())).sort((a,b)=>a-b);
  return valid[0] || null;
}

function getBienFinanceFromVisite(b={}) {
  const v = b.visite_data || {};
  const fin = v.finance || {};
  return {
    travaux: numFinance(b.prix_travaux || fin.budget_travaux_ttc),
    rendement: numFinance(b.rendement_brut || fin.rendement_brut_calcule || fin.rendement_brut),
    cashflow: numFinance(b.cashflow_estime || fin.cashflow_mensuel || fin.cashflow_mensuel_estime),
    coutTotal: numFinance(b.cout_total || fin.cout_total_operation),
  };
}

function buildFinancePilotageStats({ clients=[], biens=[], propositions=[], projets=[] }) {
  const clientsReels = clients.filter(c => c.statut !== "Prospect");
  const prospects = clients.filter(c => c.statut === "Prospect");
  const clientsActifs = clients.filter(c => c.statut === "Actif");
  const clientsSignes = clientsReels.filter(c => !!c.date_signature);
  const clientsPipeline = clients.filter(c => c.statut !== "Terminé");
  const clientsSansAction = clientsReels.filter(c => !c.prochaine_action && !c.date_prochaine_action);
  const prospectsSansAction = prospects.filter(c => !c.prochaine_action && !c.date_prochaine_action);
  const propByClient = propositions.reduce((acc,p)=>{ if(p.client_id) acc[p.client_id]=(acc[p.client_id]||0)+1; return acc; }, {});
  const projectByClient = projets.reduce((acc,p)=>{ if(p.client_id) acc[p.client_id]=(acc[p.client_id]||0)+1; return acc; }, {});
  const clientsAvecProjet = clientsSignes.filter(c => propByClient[c.id] || projectByClient[c.id]);
  const clientsActifsSansProp = clientsActifs.filter(c => !propByClient[c.id] && !projectByClient[c.id]);
  const clientsSignesSansProjet = clientsSignes.filter(c => !propByClient[c.id] && !projectByClient[c.id]);
  const clientsSignesSansBudget = clientsSignes.filter(c => !numFinance(c.budget));
  const clientsSansStrategie = clientsReels.filter(c => !c.etape || includesAny(c.etape, ["signature contrat"]));

  const offresEnvoyees = biens.filter(b => includesAny(b.statut, ["Offre envoyée", "Offre en cours"]));
  const offresAcceptees = biens.filter(b => includesAny(b.statut, ["Offre acceptée", "Compromis", "Financement", "Notaire"]));
  const offresActivesMap = new Map();
  const addOffreActive = (key, amount, source, label, statut, dateRef) => {
    const n = Number(amount) || 0;
    if (!key || n <= 0) return;
    const prob = getOffreProbability(statut);
    if (prob <= 0) return;
    offresActivesMap.set(key, { amount:n, source, label, statut, probability:prob, dateRef });
  };
  biens.forEach(b => {
    const statut = b.statut || "";
    if (Number(b.montant_offre) > 0 && !includesAny(statut, ["Abandonné", "Offre refusée", "Refus"])) {
      addOffreActive(`bien-${b.id}`, b.montant_offre, "Stock", getBienLabel(b), statut || "Offre renseignée", b.date_relance || b.created_at);
    }
  });
  propositions.forEach(p => {
    if (!includesAny(p.statut, ["offre", "proposé", "propose", "intéressé", "interesse", "analyse", "accept"])) return;
    addOffreActive(
      `prop-${p.bien_id || p.id}`,
      p.bien?.montant_offre || p.bien?.prix_vente,
      "Proposition",
      p.bien?.adresse || p.bien?.ville || "Bien proposé",
      p.statut || "Proposition",
      p.date_proposition || p.created_at
    );
  });
  const offresActives = Array.from(offresActivesMap.values());
  const montantOffresCours = offresActives.reduce((s, x) => s + x.amount, 0);
  const montantOffresPondere = offresActives.reduce((s, x) => s + x.amount * x.probability, 0);
  const honorairesConseilBrut = offresActives.length * HONORAIRE_CONSEIL_MOYEN_HT;
  const honorairesConseilPondere = offresActives.reduce((s, x) => s + HONORAIRE_CONSEIL_MOYEN_HT * x.probability, 0);
  const honorairesConseilSignes = offresActives.filter(x => x.probability >= 0.8).length * HONORAIRE_CONSEIL_MOYEN_HT;

  const baseHonorairesSignes = clientsSignes.length * HONORAIRE_BASE_CONTRAT_HT;
  const baseHonorairesPipelineBrut = clientsPipeline.length * HONORAIRE_BASE_CONTRAT_HT;
  const baseHonorairesPipelinePondere = clientsPipeline.reduce((s,c)=>s + HONORAIRE_BASE_CONTRAT_HT * getClientPipelineProbability(c), 0);
  const caSigneTheorique = baseHonorairesSignes + honorairesConseilSignes;
  const caEncaisseDeclare = clients.reduce((s,c)=>s + getClientEncaisse(c), 0);
  const caRestantAEncaisser = Math.max(0, caSigneTheorique - caEncaisseDeclare);
  const caPipelineBrut = baseHonorairesPipelineBrut + honorairesConseilBrut;
  const caPipelinePondere = baseHonorairesPipelinePondere + honorairesConseilPondere;
  const caPotentielTotal = caPipelineBrut;
  const caPotentielRestant = Math.max(0, caPotentielTotal - caSigneTheorique);

  const delaisSignature = clientsSignes
    .map(x => daysBetween(x.date_premier_contact || x.created_at, new Date(x.date_signature)))
    .filter(v => Number.isFinite(v) && v >= 0);
  const delaisSignatureProjet = clientsSignes
    .map(c => {
      const firstProjectDate = getClientFirstProjectDate(c.id, propositions, projets);
      return firstProjectDate ? daysBetween(c.date_signature, firstProjectDate) : null;
    })
    .filter(v => Number.isFinite(v) && v >= 0);
  const delaisOffreRelance = offresActives
    .map(o => o.dateRef ? daysBetween(o.dateRef, new Date()) : null)
    .filter(v => Number.isFinite(v) && v >= 0);

  const simMetrics = projets.map(getProjetSimFinance);
  const simulationsAvecCout = simMetrics.filter(m => m.coutTotal > 0);
  const totalCoutSimule = simMetrics.reduce((s,m)=>s+m.coutTotal,0);
  const totalLoyersAnnuelsSimules = simMetrics.reduce((s,m)=>s+m.loyersAnnuels,0);
  const totalCashflowMensuelSimule = simMetrics.reduce((s,m)=>s+m.cashflowMensuel,0);
  const rendementBrutMoyen = simulationsAvecCout.length
    ? simulationsAvecCout.reduce((s,m)=>s+m.rendementBrut,0) / simulationsAvecCout.length
    : 0;
  const rendementNetMoyen = simulationsAvecCout.length
    ? simulationsAvecCout.reduce((s,m)=>s+m.rendementNet,0) / simulationsAvecCout.length
    : 0;
  const projetsRentables = simMetrics.filter(m => m.coutTotal > 0 && (m.rendementBrut >= 8 || m.cashflowMensuel > 0)).length;
  const projetsNonRentables = simMetrics.filter(m => m.coutTotal > 0 && m.rendementBrut < 8 && m.cashflowMensuel <= 0).length;
  const biensAbandonnes = biens.filter(b => includesAny(b.statut, ["aband", "refus", "perdu"])).length;
  const biensSansTravaux = biens.filter(b => !getBienFinanceFromVisite(b).travaux).length;
  const biensCashflowNegatif = biens.filter(b => getBienFinanceFromVisite(b).cashflow < 0).length;
  const biensRendementFaible = biens.filter(b => {
    const f = getBienFinanceFromVisite(b);
    return f.rendement > 0 && f.rendement < 8;
  }).length;
  const biensSansSimulateur = biens.filter(b => !b.visite_data?.simulateur && !b.visite_data?.finance?.cout_total_operation).length;

  const forecast = { d30:0, d60:0, d90:0 };
  clientsPipeline.forEach(c => {
    const amount = HONORAIRE_BASE_CONTRAT_HT * getClientPipelineProbability(c);
    addToForecastBuckets(forecast, amount, getDueDateOrDefault(c.date_prochaine_action || c.date_signature, getStageDefaultDays(c)));
  });
  offresActives.forEach(o => {
    const amount = HONORAIRE_CONSEIL_MOYEN_HT * o.probability;
    addToForecastBuckets(forecast, amount, getDueDateOrDefault(o.dateRef, o.probability >= .8 ? 30 : 60));
  });

  const offresEnvoyeesEtAcceptees = offresEnvoyees.length + offresAcceptees.length;
  const tauxProjetPresente = clientsSignes.length ? Math.round((clientsAvecProjet.length / clientsSignes.length) * 100) : 0;
  const tauxProjetOffre = propositions.length ? Math.round((offresActives.length / propositions.length) * 100) : 0;
  const tauxAcceptationOffres = offresEnvoyeesEtAcceptees ? Math.round((offresAcceptees.length / offresEnvoyeesEtAcceptees) * 100) : 0;

  const alertesFinancieres = [];
  const addAlert = (title, sub, color=WA, icon=AlertTriangle) => alertesFinancieres.push({ title, sub, color, icon });
  if (clientsSignesSansBudget.length) addAlert("Clients signés sans budget", `${clientsSignesSansBudget.length} dossier${clientsSignesSansBudget.length>1?"s":""} à compléter`, DA, Wallet);
  if (clientsSignesSansProjet.length) addAlert("Clients signés sans projet présenté", `${clientsSignesSansProjet.length} client${clientsSignesSansProjet.length>1?"s":""} à traiter`, WA, Home);
  if (clientsSansAction.length) addAlert("Clients sans prochaine action", `${clientsSansAction.length} client${clientsSansAction.length>1?"s":""} hors prospects`, DA, Calendar);
  if (clientsSansStrategie.length) addAlert("Stratégie client incomplète", `${clientsSansStrategie.length} dossier${clientsSansStrategie.length>1?"s":""} peu pilotable${clientsSansStrategie.length>1?"s":""}`, "#c084fc", Users);
  if (biensCashflowNegatif.length) addAlert("Cash-flow négatif", `${biensCashflowNegatif.length} bien${biensCashflowNegatif.length>1?"s":""} à arbitrer`, DA, Euro);
  if (biensRendementFaible.length) addAlert("Rendement sous objectif", `${biensRendementFaible.length} bien${biensRendementFaible.length>1?"s":""} sous 8 %`, WA, BarChart3);
  if (biensSansTravaux.length) addAlert("Budget travaux manquant", `${biensSansTravaux.length} bien${biensSansTravaux.length>1?"s":""} sans budget travaux`, WA, Hammer);
  if (offresActives.length && !delaisOffreRelance.length) addAlert("Offres sans date de pilotage", "Ajoutez une date de relance sur les offres en cours", WA, Bell);

  return {
    totalContacts: clients.length,
    prospects: prospects.length,
    clientsReels: clientsReels.length,
    clientsActifs: clientsActifs.length,
    clientsSignes: clientsSignes.length,
    clientsSansAction: clientsSansAction.length,
    prospectsSansAction: prospectsSansAction.length,
    clientsActifsSansProp: clientsActifsSansProp.length,
    clientsSignesSansProjet: clientsSignesSansProjet.length,
    clientsSignesSansBudget: clientsSignesSansBudget.length,
    clientsSansStrategie: clientsSansStrategie.length,
    budgetClientsActifs: clientsActifs.reduce((s,x)=>s+(Number(x.budget)||0),0),
    tauxTransformation: clients.length ? Math.round((clientsReels.length / clients.length) * 100) : 0,
    tauxSignature: clients.length ? Math.round((clientsSignes.length / clients.length) * 100) : 0,
    tauxProspectClient: clients.length ? Math.round((clientsSignes.length / clients.length) * 100) : 0,
    tauxClientProjet: tauxProjetPresente,
    tauxProjetOffre,
    biensProposesParClientActif: clientsActifs.length ? propositions.length / clientsActifs.length : 0,
    offresEnvoyees: offresEnvoyees.length,
    offresAcceptees: offresAcceptees.length,
    tauxAcceptationOffres,
    delaiMoyenSignature: delaisSignature.length ? Math.round(delaisSignature.reduce((s,x)=>s+x,0) / delaisSignature.length) : null,
    delaiMoyenSignatureProjet: delaisSignatureProjet.length ? Math.round(delaisSignatureProjet.reduce((s,x)=>s+x,0) / delaisSignatureProjet.length) : null,
    delaiMoyenOffreRelance: delaisOffreRelance.length ? Math.round(delaisOffreRelance.reduce((s,x)=>s+x,0) / delaisOffreRelance.length) : null,
    montantOffresCours,
    montantOffresPondere,
    nbOffresActives: offresActives.length,
    offresActives,
    baseHonorairesSignes,
    baseHonorairesPipeline: baseHonorairesPipelineBrut,
    baseHonorairesPipelineBrut,
    baseHonorairesPipelinePondere,
    estimationHonoraireConseil: honorairesConseilBrut,
    honorairesConseilBrut,
    honorairesConseilPondere,
    honorairesConseilSignes,
    caSigneTheorique,
    caEncaisseDeclare,
    caRestantAEncaisser,
    caPipelineBrut,
    caPipelinePondere,
    caPotentielTotal,
    caPotentielRestant,
    forecast30: Math.round(forecast.d30),
    forecast60: Math.round(forecast.d60),
    forecast90: Math.round(forecast.d90),
    simulations: projets.length,
    simulationsAvecCout: simulationsAvecCout.length,
    totalCoutSimule,
    totalLoyersAnnuelsSimules,
    totalCashflowMensuelSimule,
    rendementBrutMoyen,
    rendementNetMoyen,
    projetsRentables,
    projetsNonRentables,
    biensAbandonnes,
    biensSansTravaux,
    biensCashflowNegatif,
    biensRendementFaible,
    biensSansSimulateur,
    alertesFinancieres,
  };
}

function FinanceMetricRow({ label, value, sub, color, icon: IconComp, T=THEMES_INV.dark }) {
  return (
    <div className="inv-kpi" style={{padding:14,borderLeft:`3px solid ${color || T.accent}`}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        {IconComp && <span style={{width:32,height:32,borderRadius:RADIUS.md,background:`${color || T.accent}18`,color:color || T.accent,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icon as={IconComp} size={16}/></span>}
        <div style={{minWidth:0}}>
          <div className="inv-kpi-lbl">{label}</div>
          <div className="inv-kpi-val" style={{fontSize:FONT.xl.size+2,color:color || T.text}}>{value}</div>
          {sub && <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:3,lineHeight:1.35}}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

function FinanceBar({ label, value, max, color, T=THEMES_INV.dark, displayValue }) {
  const pct = max > 0 ? Math.min(100, Math.round((Number(value || 0) / max) * 100)) : 0;
  return (
    <div style={{display:"grid",gridTemplateColumns:"170px 1fr 110px",gap:10,alignItems:"center",fontSize:FONT.sm.size+1,color:T.textSub}}>
      <div style={{fontWeight:700,color:T.text}}>{label}</div>
      <div style={{height:10,borderRadius:RADIUS.pill,background:T.input,border:`1px solid ${T.border}`,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${pct}%`,background:color || T.accent,borderRadius:RADIUS.pill}}/>
      </div>
      <div style={{fontFamily:"'DM Mono',monospace",fontWeight:800,color:color || T.accent,textAlign:"right"}}>{displayValue || `${pct}%`}</div>
    </div>
  );
}

function FinanceMiniTable({ rows=[], T=THEMES_INV.dark }) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:7}}>
      {rows.map((r, i) => (
        <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,alignItems:"center",padding:"9px 10px",borderRadius:RADIUS.md,background:T.input,border:`1px solid ${T.border}`}}>
          <div>
            <div style={{fontSize:FONT.sm.size+1,fontWeight:800,color:T.text}}>{r.label}</div>
            {r.sub && <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:2}}>{r.sub}</div>}
          </div>
          <div style={{fontFamily:"'DM Mono',monospace",fontWeight:900,color:r.color || T.accent,textAlign:"right",whiteSpace:"nowrap"}}>{r.value}</div>
        </div>
      ))}
    </div>
  );
}

function DashboardFinancier({ profil, T=THEMES_INV.dark }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState(null);
  const [raw, setRaw] = useState({ clients:[], biens:[], propositions:[], projets:[] });

  const charger = useCallback(async () => {
    setLoading(true);
    setError("");
    const [clientsRes, biensRes, propsRes, projetsRes] = await Promise.all([
      supabase.from("invest_clients").select("*"),
      supabase.from("invest_biens").select("*"),
      supabase.from("invest_propositions").select("*, bien:invest_biens(*)"),
      supabase.from("invest_projets").select("*"),
    ]);
    const firstError = clientsRes.error || biensRes.error || propsRes.error || projetsRes.error;
    if (firstError) {
      console.error("Erreur Dashboard Financier:", firstError);
      setError(firstError.message || "Impossible de charger les données financières.");
    }
    const data = {
      clients: clientsRes.data || [],
      biens: biensRes.data || [],
      propositions: propsRes.data || [],
      projets: projetsRes.data || [],
    };
    setRaw(data);
    setStats(buildFinancePilotageStats(data));
    setLoading(false);
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const maxPerf = 100;
  const maxBusiness = Math.max(1, stats?.caPipelineBrut || 0, stats?.montantOffresCours || 0, stats?.budgetClientsActifs || 0);
  const maxForecast = Math.max(1, stats?.forecast30 || 0, stats?.forecast60 || 0, stats?.forecast90 || 0);
  const pointsPilotage = stats ? [
    { title:"Clients réels sans prochaine action", value:stats.clientsSansAction, sub:"À traiter pour éviter la perte de suivi", color:stats.clientsSansAction > 0 ? DA : SU, icon:AlertTriangle },
    { title:"Prospects sans prochaine action", value:stats.prospectsSansAction, sub:"À convertir ou nettoyer du pipeline", color:stats.prospectsSansAction > 0 ? WA : SU, icon:Users },
    { title:"Clients actifs sans bien proposé", value:stats.clientsActifsSansProp, sub:"Potentiel commercial non exploité", color:stats.clientsActifsSansProp > 0 ? WA : SU, icon:Building2 },
    { title:"Offres actives à piloter", value:stats.nbOffresActives, sub:fmtDashboardEur(stats.montantOffresCours), color:T.accent, icon:Send },
  ] : [];

  return (
    <div style={{ padding:`${SPACING.xl}px ${SPACING.xl+4}px`, maxWidth:1480, margin:"0 auto" }}>
      <div style={{ marginBottom:SPACING.xl, display:"flex", alignItems:"center", justifyContent:"space-between", gap:SPACING.md, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:SPACING.md }}>
          <div style={{ width:48, height:48, borderRadius:RADIUS.lg, flexShrink:0, background:T.accentBg, color:T.accent, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <Icon as={Euro} size={24} strokeWidth={2}/>
          </div>
          <div>
            <div style={{ fontSize:FONT.h2.size, fontWeight:800, color:T.text, letterSpacing:-0.3 }}>Dashboard Financier</div>
            <div style={{ fontSize:FONT.sm.size+1, color:T.textSub, marginTop:2 }}>CA signé, pipeline pondéré, offres, délais, alertes et qualité des projets</div>
          </div>
        </div>
        <button className="inv-btn inv-btn-out inv-btn-sm" onClick={charger}>
          <Icon as={RefreshCw} size={12} strokeWidth={2.2}/> Actualiser
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign:"center", padding:`${SPACING.xxxl}px 0`, color:T.textMuted, display:"flex", justifyContent:"center", alignItems:"center", gap:8 }}>
          <Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>
          Chargement…
        </div>
      ) : error ? (
        <div style={{padding:SPACING.lg,borderRadius:RADIUS.lg,background:SEMANTIC.danger.bg,border:`1px solid ${SEMANTIC.danger.border}`,color:DA}}>{error}</div>
      ) : stats && (
        <>
          <DashboardPanel title="Synthèse financière" icon={Wallet} subtitle="Ce qui est signé, encaissé, restant dû et probable" T={T}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(215px,1fr))",gap:SPACING.md}}>
              <FinanceMetricRow T={T} icon={Handshake} label="CA signé HT théorique" value={fmtDashboardEur(stats.caSigneTheorique)} color={SU} sub={`${fmtDashboardEur(stats.baseHonorairesSignes)} fixes + ${fmtDashboardEur(stats.honorairesConseilSignes)} conseil probable`}/>
              <FinanceMetricRow T={T} icon={Euro} label="CA encaissé déclaré" value={fmtDashboardEur(stats.caEncaisseDeclare)} color={stats.caEncaisseDeclare > 0 ? SU : WA} sub={stats.caEncaisseDeclare > 0 ? "D'après les champs d'encaissement renseignés" : "À renseigner si tu veux piloter la trésorerie réelle"}/>
              <FinanceMetricRow T={T} icon={Wallet} label="CA restant à encaisser" value={fmtDashboardEur(stats.caRestantAEncaisser)} color={stats.caRestantAEncaisser > 0 ? WA : SU} sub="CA signé théorique - encaissé déclaré"/>
              <FinanceMetricRow T={T} icon={TrendingUp} label="Pipeline brut" value={fmtDashboardEur(stats.caPipelineBrut)} color="#FFC200" sub="Contrats potentiels + conseil brut"/>
              <FinanceMetricRow T={T} icon={Sparkles} label="Pipeline pondéré" value={fmtDashboardEur(stats.caPipelinePondere)} color="#c084fc" sub="Vision réaliste selon les probabilités"/>
              <FinanceMetricRow T={T} icon={Send} label="Offres en cours" value={fmtDashboardEur(stats.montantOffresCours)} color="#4db8ff" sub={`Pondéré : ${fmtDashboardEur(stats.montantOffresPondere)}`}/>
            </div>
          </DashboardPanel>

          <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:SPACING.md,alignItems:"start"}}>
            <DashboardPanel title="Pipeline pondéré 30 / 60 / 90 jours" icon={Calendar} subtitle="Prévision HT probable selon les étapes, actions et offres" T={T}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(175px,1fr))",gap:SPACING.md,marginBottom:SPACING.lg}}>
                <FinanceMetricRow T={T} icon={Calendar} label="Prévision 30 jours" value={fmtDashboardEur(stats.forecast30)} color={SU} sub="Court terme"/>
                <FinanceMetricRow T={T} icon={Calendar} label="Prévision 60 jours" value={fmtDashboardEur(stats.forecast60)} color="#FFC200" sub="Court / moyen terme"/>
                <FinanceMetricRow T={T} icon={Calendar} label="Prévision 90 jours" value={fmtDashboardEur(stats.forecast90)} color="#c084fc" sub="Potentiel trimestre"/>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <FinanceBar T={T} label="30 jours" value={stats.forecast30} max={maxForecast} color={SU} displayValue={fmtDashboardEur(stats.forecast30)}/>
                <FinanceBar T={T} label="60 jours" value={stats.forecast60} max={maxForecast} color="#FFC200" displayValue={fmtDashboardEur(stats.forecast60)}/>
                <FinanceBar T={T} label="90 jours" value={stats.forecast90} max={maxForecast} color="#c084fc" displayValue={fmtDashboardEur(stats.forecast90)}/>
              </div>
            </DashboardPanel>

            <DashboardPanel title="Honoraires & offres" icon={Briefcase} subtitle="Base fixe, conseil négociation et volume d'acquisition" T={T}>
              <FinanceMiniTable T={T} rows={[
                {label:"Honoraires fixes signés", value:fmtDashboardEur(stats.baseHonorairesSignes), sub:`${stats.clientsSignes} client${stats.clientsSignes>1?"s":""} signé${stats.clientsSignes>1?"s":""} · 1 583 € HT`, color:SU},
                {label:"Honoraires fixes pipeline brut", value:fmtDashboardEur(stats.baseHonorairesPipelineBrut), sub:"Prospects + clients en cours", color:"#FFC200"},
                {label:"Honoraires fixes pipeline pondéré", value:fmtDashboardEur(stats.baseHonorairesPipelinePondere), sub:"Selon maturité client", color:"#c084fc"},
                {label:"Honoraires conseil brut", value:fmtDashboardEur(stats.honorairesConseilBrut), sub:"7 500 € HT / offre active", color:"#4db8ff"},
                {label:"Honoraires conseil pondéré", value:fmtDashboardEur(stats.honorairesConseilPondere), sub:"Selon statut des offres", color:T.accent},
              ]}/>
            </DashboardPanel>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:SPACING.md,alignItems:"start"}}>
            <DashboardPanel title="Performance commerciale" icon={BarChart3} subtitle="Conversion, rythme et efficacité commerciale" T={T}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(175px,1fr))",gap:SPACING.md,marginBottom:SPACING.lg}}>
                <FinanceMetricRow T={T} icon={Users} label="Contacts" value={stats.totalContacts} color={T.accent} sub={`${stats.prospects} prospects · ${stats.clientsReels} clients réels`}/>
                <FinanceMetricRow T={T} icon={Handshake} label="Prospect → client signé" value={`${stats.tauxProspectClient}%`} color={SU} sub="Clients signés / contacts"/>
                <FinanceMetricRow T={T} icon={Home} label="Signé → projet présenté" value={`${stats.tauxClientProjet}%`} color="#FFC200" sub="Clients signés avec proposition/projet"/>
                <FinanceMetricRow T={T} icon={Send} label="Projet → offre" value={`${stats.tauxProjetOffre}%`} color="#4db8ff" sub="Offres actives / propositions"/>
                <FinanceMetricRow T={T} icon={Check} label="Offre → acceptée" value={`${stats.tauxAcceptationOffres}%`} color="#c084fc" sub="Offres acceptées / offres envoyées"/>
                <FinanceMetricRow T={T} icon={Building2} label="Biens / client actif" value={stats.biensProposesParClientActif.toFixed(1).replace(".", ",")} color={T.accent} sub="Propositions / clients actifs"/>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <FinanceBar T={T} label="Contact → signé" value={stats.tauxProspectClient} max={maxPerf} color={SU}/>
                <FinanceBar T={T} label="Signé → projet" value={stats.tauxClientProjet} max={maxPerf} color="#FFC200"/>
                <FinanceBar T={T} label="Projet → offre" value={stats.tauxProjetOffre} max={maxPerf} color="#4db8ff"/>
                <FinanceBar T={T} label="Offre → acceptée" value={stats.tauxAcceptationOffres} max={maxPerf} color="#c084fc"/>
              </div>
            </DashboardPanel>

            <DashboardPanel title="Délais moyens" icon={Calendar} subtitle="Repérer les ralentissements dans le parcours" T={T}>
              <FinanceMiniTable T={T} rows={[
                {label:"Premier contact → signature", value:stats.delaiMoyenSignature !== null ? `${stats.delaiMoyenSignature} j` : "—", sub:"Objectif : réduire le délai de décision", color:T.accent},
                {label:"Signature → premier projet", value:stats.delaiMoyenSignatureProjet !== null ? `${stats.delaiMoyenSignatureProjet} j` : "—", sub:"Objectif : présenter vite les premières opportunités", color:stats.delaiMoyenSignatureProjet && stats.delaiMoyenSignatureProjet > 15 ? WA : SU},
                {label:"Offre → relance / suivi", value:stats.delaiMoyenOffreRelance !== null ? `${stats.delaiMoyenOffreRelance} j` : "—", sub:"À fiabiliser avec les dates de relance", color:stats.delaiMoyenOffreRelance && stats.delaiMoyenOffreRelance > 7 ? WA : T.accent},
              ]}/>
            </DashboardPanel>
          </div>

          <DashboardPanel title="Portefeuille simulateurs & qualité des projets" icon={BarChart3} subtitle="Rentabilité, cash-flow, travaux et arbitrages" T={T}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:SPACING.md,marginBottom:SPACING.lg}}>
              <FinanceMetricRow T={T} icon={FileText} label="Simulations" value={stats.simulations} color={T.accent} sub={`${stats.simulationsAvecCout} avec coût total renseigné`}/>
              <FinanceMetricRow T={T} icon={Wallet} label="Coût total simulé" value={fmtDashboardEur(stats.totalCoutSimule)} color="#FFC200" sub="Somme des opérations simulées"/>
              <FinanceMetricRow T={T} icon={TrendingUp} label="Loyers annuels simulés" value={fmtDashboardEur(stats.totalLoyersAnnuelsSimules)} color={SU} sub="Total loyers bruts annuels"/>
              <FinanceMetricRow T={T} icon={BarChart3} label="Rendement brut moyen" value={fmtDashboardPct(stats.rendementBrutMoyen)} color="#c084fc" sub={`Rendement net moyen : ${fmtDashboardPct(stats.rendementNetMoyen)}`}/>
              <FinanceMetricRow T={T} icon={Euro} label="Cash-flow mensuel simulé" value={fmtDashboardEur(stats.totalCashflowMensuelSimule)} color={stats.totalCashflowMensuelSimule >= 0 ? SU : DA} sub="Somme des cash-flows mensuels S1"/>
              <FinanceMetricRow T={T} icon={Check} label="Projets rentables" value={stats.projetsRentables} color={SU} sub={`${stats.projetsNonRentables} non rentables · ${stats.biensAbandonnes} abandonnés`}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(185px,1fr))",gap:SPACING.sm+2}}>
              <FinanceMetricRow T={T} icon={Hammer} label="Travaux manquants" value={stats.biensSansTravaux} color={stats.biensSansTravaux > 0 ? WA : SU} sub="Biens sans budget travaux"/>
              <FinanceMetricRow T={T} icon={AlertTriangle} label="Cash-flow négatif" value={stats.biensCashflowNegatif} color={stats.biensCashflowNegatif > 0 ? DA : SU} sub="Biens à arbitrer"/>
              <FinanceMetricRow T={T} icon={BarChart3} label="Rendement faible" value={stats.biensRendementFaible} color={stats.biensRendementFaible > 0 ? WA : SU} sub="Sous 8 % brut"/>
              <FinanceMetricRow T={T} icon={FileText} label="Sans simulateur" value={stats.biensSansSimulateur} color={stats.biensSansSimulateur > 0 ? WA : SU} sub="Fiches biens à compléter"/>
            </div>
          </DashboardPanel>

          <div style={{display:"grid",gridTemplateColumns:"minmax(0,.95fr) minmax(0,1.05fr)",gap:SPACING.md,alignItems:"start"}}>
            <DashboardPanel title="Pilotage à surveiller" icon={AlertTriangle} subtitle="Points financiers et commerciaux à traiter" T={T}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:SPACING.sm+2,marginBottom:SPACING.md}}>
                {pointsPilotage.map(p => <FinanceMetricRow key={p.title} T={T} icon={p.icon} label={p.title} value={p.value} color={p.color} sub={p.sub}/>) }
              </div>
              <DashboardAlertList items={stats.alertesFinancieres.slice(0,8)} T={T} empty="Aucune alerte financière" />
            </DashboardPanel>

            <DashboardPanel title="Offres en cours" icon={Send} subtitle="Montants à suivre dans les négociations" T={T}>
              {stats.offresActives.length === 0 ? (
                <div style={{padding:SPACING.lg,border:`1px dashed ${T.border}`,borderRadius:RADIUS.md,color:T.textMuted,textAlign:"center",fontStyle:"italic"}}>Aucune offre active renseignée</div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:7,maxHeight:420,overflowY:"auto"}}>
                  {stats.offresActives.slice(0,14).map((o,idx)=>(
                    <div key={idx} style={{display:"grid",gridTemplateColumns:"1fr 120px 105px",gap:10,alignItems:"center",padding:"9px 10px",borderRadius:RADIUS.md,background:T.input,border:`1px solid ${T.border}`}}>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:FONT.sm.size+1,fontWeight:800,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.label}</div>
                        <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:2}}>{o.source} · {o.statut || "—"}</div>
                      </div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontWeight:800,color:T.accent,textAlign:"right"}}>{fmtDashboardEur(o.amount)}</div>
                      <div style={{fontSize:FONT.xs.size,fontWeight:800,color:o.probability >= .8 ? SU : T.accent,background:`${o.probability >= .8 ? SU : T.accent}18`,border:`1px solid ${o.probability >= .8 ? SU : T.accent}33`,borderRadius:RADIUS.pill,padding:"4px 8px",textAlign:"center"}}>{Math.round(o.probability*100)} %</div>
                    </div>
                  ))}
                </div>
              )}
            </DashboardPanel>
          </div>
        </>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function PlanningSemaine({ profil, T=THEMES_INV.dark }) {
  const { startWeek, endWeek, today } = getWeekRange();
  const [events, setEvents] = useState([]);
  const [clients, setClients] = useState([]);
  const [biens, setBiens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    titre:"", type:"Visite de bien", date_rdv:today, heure_debut:"", heure_fin:"",
    client_id:"", bien_id:"", lieu:"", commentaire:"",
  });

  const charger = async () => {
    setLoading(true); setError("");
    const [planningRes, clientsRes, biensRes] = await Promise.all([
      supabase.from("invest_planning").select("*, client:invest_clients(id,nom,prenom), bien:invest_biens(id,adresse,ville)").gte("date_rdv", startWeek).lte("date_rdv", endWeek).order("date_rdv", { ascending:true }).order("heure_debut", { ascending:true }),
      supabase.from("invest_clients").select("id,nom,prenom").order("nom"),
      supabase.from("invest_biens").select("id,adresse,ville").order("adresse"),
    ]);
    let planningData = planningRes.data || [];
    if (planningRes.error) {
      const fallback = await supabase.from("invest_planning").select("*").gte("date_rdv", startWeek).lte("date_rdv", endWeek).order("date_rdv", { ascending:true }).order("heure_debut", { ascending:true });
      if (fallback.error) {
        setError("La table invest_planning n'existe pas encore. Lancez la migration SQL fournie avec le fichier.");
        planningData = [];
      } else {
        planningData = fallback.data || [];
      }
    }
    setEvents(planningData);
    setClients(clientsRes.data || []);
    setBiens(biensRes.data || []);
    setLoading(false);
  };

  useEffect(() => { charger(); }, []);

  const ajouter = async () => {
    if (!form.titre.trim() || !form.date_rdv) return;
    setSaving(true);
    const payload = {
      titre: form.titre.trim(), type: form.type, date_rdv: form.date_rdv,
      heure_debut: form.heure_debut || null, heure_fin: form.heure_fin || null,
      client_id: form.client_id || null, bien_id: form.bien_id || null,
      lieu: form.lieu.trim() || null, commentaire: form.commentaire.trim() || null,
      created_by: profil?.email || profil?.nom || null,
    };
    const { error } = await supabase.from("invest_planning").insert(payload);
    setSaving(false);
    if (error) {
      console.error("Erreur insert invest_planning:", error);
      setError(`Impossible d'ajouter le RDV : ${error.message || "vérifiez les droits RLS et la table invest_planning."}`);
      return;
    }
    setForm({ titre:"", type:"Visite de bien", date_rdv:today, heure_debut:"", heure_fin:"", client_id:"", bien_id:"", lieu:"", commentaire:"" });
    charger();
  };

  const supprimer = async (id) => {
    if (!window.confirm("Supprimer ce rendez-vous ?")) return;
    await supabase.from("invest_planning").delete().eq("id", id);
    charger();
  };

  const jours = Array.from({length:7}, (_,i)=>{
    const d = new Date(startWeek); d.setDate(d.getDate()+i);
    return { iso: isoDate(d), label: d.toLocaleDateString("fr-FR", { weekday:"short", day:"2-digit", month:"short" }) };
  });

  return (
    <div className="inv-card" style={{marginBottom:SPACING.xxl-2}}>
      <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Calendar} size={13} strokeWidth={2.2}/>Planning commercial de la semaine</span></div>
      <div className="inv-card-bd">
        {error && <div style={{marginBottom:12, padding:"9px 11px", borderRadius:RADIUS.md, background:SEMANTIC.warning.bg, border:`1px solid ${SEMANTIC.warning.border}`, color:WA, fontSize:FONT.sm.size}}>{error}</div>}
        <div style={{display:"grid",gridTemplateColumns:"1.2fr 150px 130px 90px 90px 1fr 1fr auto",gap:8,alignItems:"center",marginBottom:14}}>
          <input className="inv-inp" value={form.titre} placeholder="Titre du RDV" onChange={e=>setForm({...form,titre:e.target.value})} style={{width:"100%", textAlign:"left"}}/>
          <select className="inv-sel" value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{TYPES_PLANNING_INVEST.map(t=><option key={t}>{t}</option>)}</select>
          <input className="inv-inp" type="date" value={form.date_rdv} onChange={e=>setForm({...form,date_rdv:e.target.value})} style={{width:"100%"}}/>
          <input className="inv-inp" type="time" value={form.heure_debut} onChange={e=>setForm({...form,heure_debut:e.target.value})} style={{width:"100%"}}/>
          <input className="inv-inp" type="time" value={form.heure_fin} onChange={e=>setForm({...form,heure_fin:e.target.value})} style={{width:"100%"}}/>
          <select className="inv-sel" value={form.client_id} onChange={e=>setForm({...form,client_id:e.target.value})}><option value="">Client lié</option>{clients.map(c=><option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>)}</select>
          <select className="inv-sel" value={form.bien_id} onChange={e=>setForm({...form,bien_id:e.target.value})}><option value="">Bien lié</option>{biens.map(b=><option key={b.id} value={b.id}>{b.adresse}{b.ville ? ` — ${b.ville}` : ""}</option>)}</select>
          <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={ajouter} disabled={saving || !form.titre.trim()}><Icon as={Plus} size={12} strokeWidth={2.2}/> Ajouter</button>
        </div>

        {loading ? (
          <div style={{textAlign:"center", color:T.textMuted, padding:18}}>Chargement…</div>
        ) : (
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:8,overflowX:"auto"}}>
            {jours.map(j => {
              const evts = events.filter(e => e.date_rdv === j.iso);
              return (
                <div key={j.iso} style={{minWidth:145, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, overflow:"hidden", background:T.input}}>
                  <div style={{padding:"7px 9px", background:j.iso===today?T.accentBg:T.sectionHd, color:j.iso===today?T.accent:T.textSub, fontSize:FONT.xs.size, fontWeight:800, textTransform:"uppercase", letterSpacing:.8}}>{j.label}</div>
                  <div style={{padding:8, display:"flex", flexDirection:"column", gap:6, minHeight:92}}>
                    {evts.length === 0 ? <div style={{fontSize:FONT.xs.size, color:T.textMuted, fontStyle:"italic"}}>Aucun RDV</div> : evts.map(e => (
                      <div key={e.id} style={{padding:"7px 8px", borderRadius:RADIUS.sm+1, background:T.card, border:`1px solid ${T.border}`}}>
                        <div style={{display:"flex", justifyContent:"space-between", gap:5}}>
                          <div style={{fontSize:FONT.sm.size, fontWeight:800, color:T.text, lineHeight:1.2}}>{e.titre}</div>
                          <button onClick={()=>supprimer(e.id)} style={{background:"transparent",border:"none",color:T.textMuted,cursor:"pointer",fontSize:13}}>×</button>
                        </div>
                        <div style={{fontSize:FONT.xs.size, color:T.accent, marginTop:3, fontWeight:700}}>{e.heure_debut ? e.heure_debut.slice(0,5) : "Horaire libre"}{e.heure_fin ? ` - ${e.heure_fin.slice(0,5)}` : ""}</div>
                        <div style={{fontSize:FONT.xs.size, color:T.textMuted, marginTop:2}}>{e.type}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TableauBord({ profil, T=THEMES_INV.dark, onNavigate }) {
  const [stats, setStats] = useState(null);
  const [clientsDash, setClientsDash] = useState([]);
  const [biensDash, setBiensDash] = useState([]);
  const [propsDash, setPropsDash] = useState([]);
  const [planningDash, setPlanningDash] = useState([]);
  const [movingClientId, setMovingClientId] = useState(null);
  const [movingEtapeClientId, setMovingEtapeClientId] = useState(null);
  const [dashboardError, setDashboardError] = useState("");
  const [loading, setLoading] = useState(true);

  const chargerDashboard = useCallback(async () => {
    setLoading(true);
    setDashboardError("");
    const { today, startWeek, endWeek } = getWeekRange();
    const [clientsRes, biensRes, propsRes, planningRes] = await Promise.all([
      supabase.from("invest_clients").select("id,nom,prenom,statut,budget,date_signature,date_premier_contact,prochaine_action,date_prochaine_action,created_at,etape,source,conseiller"),
      supabase.from("invest_biens").select("id,adresse,ville,statut,date_relance,date_visite,rendement_brut,cashflow_estime,prix_vente,prix_travaux,cout_total,montant_offre,visite_data,latitude,longitude,reference_interne,conseiller_profero,created_at"),
      supabase.from("invest_propositions").select("id,client_id,bien_id,statut,created_at,date_proposition,bien:invest_biens(id,montant_offre,prix_vente,statut)"),
      supabase.from("invest_planning").select("id,titre,type,date_rdv,heure_debut,heure_fin,client_id,bien_id,lieu,commentaire").gte("date_rdv", startWeek).lte("date_rdv", endWeek).order("date_rdv", { ascending:true }).order("heure_debut", { ascending:true }),
    ]);

    const c = clientsRes.data || [];
    const b = biensRes.data || [];
    const p = propsRes.data || [];
    const planning = planningRes.error ? [] : (planningRes.data || []);
    setClientsDash(c);
    setBiensDash(b);
    setPropsDash(p);
    setPlanningDash(planning);

    const actionsRetard = c.filter(x => x.prochaine_action && x.date_prochaine_action && x.date_prochaine_action < today);
    const actionsSemaine = c.filter(x => x.prochaine_action && x.date_prochaine_action && x.date_prochaine_action >= today && x.date_prochaine_action <= endWeek);
    const prospects = c.filter(x => x.statut === "Prospect");
    const clientsReels = c.filter(x => x.statut !== "Prospect");
    const clientsPipeline = c.filter(x => x.statut !== "Terminé");
    const clientsSignes = clientsReels.filter(x => x.date_signature);
    const clientsActifs = c.filter(x => x.statut === "Actif");
    const clientsSansAction = clientsReels.filter(x => !x.prochaine_action && !x.date_prochaine_action);
    const offresEnv = b.filter(x => x.statut === "Offre envoyée");
    const offresAcc = b.filter(x => x.statut === "Offre acceptée");
    const offresActivesMap = new Map();
    const addOffreActive = (key, amount) => {
      const n = Number(amount) || 0;
      if (!key || n <= 0) return;
      offresActivesMap.set(key, n);
    };
    b.forEach(x => {
      const statut = x.statut || "";
      const hasOffre = Number(x.montant_offre) > 0;
      if (hasOffre && !["Abandonné", "Offre refusée"].includes(statut)) addOffreActive(`bien-${x.id}`, x.montant_offre);
    });
    p.forEach(prop => {
      if (!["offre en cours", "proposé", "intéressé", "en analyse"].includes(prop.statut)) return;
      addOffreActive(`prop-${prop.bien_id || prop.id}`, prop.bien?.montant_offre || prop.bien?.prix_vente);
    });
    const montantOffresCours = Array.from(offresActivesMap.values()).reduce((s,x)=>s+x,0);
    const nbOffresActives = offresActivesMap.size;
    const delaisSignature = clientsSignes
      .filter(x => x.date_signature)
      .map(x => daysBetween(x.date_premier_contact || x.created_at, new Date(x.date_signature)))
      .filter(v => Number.isFinite(v) && v >= 0);
    const fichesCompletes = b.filter(isBienFicheComplete).length;
    const geoloc = b.filter(isGeolocBien).length;
    const simulateurs = b.filter(hasSimulateurBien).length;
    const topOpps = b.filter(x => getBienScore(x) >= 45).length;
    const offresStock = nbOffresActives;

    setStats({
      prospects:       prospects.length,
      actifs:          clientsActifs.length,
      inactifs:        c.filter(x => x.statut === "Inactif").length,
      termines:        c.filter(x => x.statut === "Terminé").length,
      totalSignes:     clientsSignes.length,
      sommeBudgets:    clientsSignes.reduce((s, x) => s + (x.budget || 0), 0),
      biensTotaux:     b.length,
      biensARelancer:  b.filter(x => x.date_relance && x.date_relance <= today).length,
      visitesProg:     b.filter(x => x.statut === "Visite programmée").length,
      offreEnvoyees:   offresEnv.length,
      offresAcceptees: offresAcc.length,
      sansProchaineAction: clientsSansAction.length,
      prospectsSansAction: prospects.filter(x => !x.prochaine_action && !x.date_prochaine_action).length,
      nbPropositions:  p.length,
      actionsRetard:   actionsRetard.length,
      actionsSemaine:  actionsSemaine.length,
      actionsATraiter: actionsRetard.length + actionsSemaine.length,
      rdvSemaine:      planning.length,
      visitesSemaine:  planning.filter(e => e.type === "Visite de bien").length,
      topOpportunites: topOpps,
      biensIncomplets: Math.max(0, b.length - fichesCompletes),
      tauxFichesCompletes: b.length ? Math.round((fichesCompletes / b.length) * 100) : 0,
      tauxGeoloc: b.length ? Math.round((geoloc / b.length) * 100) : 0,
      tauxSimulateur: b.length ? Math.round((simulateurs / b.length) * 100) : 0,
      tauxOffresStock: b.length ? Math.round((offresStock / b.length) * 100) : 0,
      tauxTransformation: c.length ? Math.round((clientsReels.length / c.length) * 100) : 0,
      biensParClientActif: clientsActifs.length ? p.length / clientsActifs.length : 0,
      tauxAcceptationOffres: offresEnv.length + offresAcc.length ? Math.round((offresAcc.length / (offresEnv.length + offresAcc.length)) * 100) : 0,
      delaiMoyenSignature: delaisSignature.length ? Math.round(delaisSignature.reduce((s,x)=>s+x,0) / delaisSignature.length) : null,
      budgetClientsActifs: clientsActifs.reduce((s,x)=>s+(Number(x.budget)||0),0),
      montantOffresCours,
      nbOffresActives,
      baseHonorairesSignes: clientsSignes.length * HONORAIRE_BASE_CONTRAT_HT,
      baseHonorairesPipeline: clientsPipeline.length * HONORAIRE_BASE_CONTRAT_HT,
      estimationHonoraireConseil: nbOffresActives * HONORAIRE_CONSEIL_MOYEN_HT,
    });
    setLoading(false);
  }, []);

  useEffect(() => { chargerDashboard(); }, [chargerDashboard]);

  const fmt = v => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v);
  const go = (target, filter) => { if (onNavigate) onNavigate(target, filter); };

  const changerStatutClient = async (clientId, nouveauStatut) => {
    const client = clientsDash.find(c => c.id === clientId);
    if (!client || !nouveauStatut || client.statut === nouveauStatut) return;
    const ancienStatut = client.statut || "Prospect";
    setMovingClientId(clientId);
    setDashboardError("");

    setClientsDash(prev => prev.map(c => c.id === clientId ? { ...c, statut:nouveauStatut } : c));
    setStats(prev => {
      if (!prev) return prev;
      const next = { ...prev };
      const oldKey = DASH_STAT_KEY[ancienStatut];
      const newKey = DASH_STAT_KEY[nouveauStatut];
      if (oldKey) next[oldKey] = Math.max(0, (next[oldKey] || 0) - 1);
      if (newKey) next[newKey] = (next[newKey] || 0) + 1;
      return next;
    });

    const { error } = await supabase.from("invest_clients").update({ statut:nouveauStatut }).eq("id", clientId);
    setMovingClientId(null);
    if (error) {
      console.error("Erreur changement statut client:", error);
      setClientsDash(prev => prev.map(c => c.id === clientId ? { ...c, statut:ancienStatut } : c));
      setStats(prev => {
        if (!prev) return prev;
        const next = { ...prev };
        const oldKey = DASH_STAT_KEY[ancienStatut];
        const newKey = DASH_STAT_KEY[nouveauStatut];
        if (newKey) next[newKey] = Math.max(0, (next[newKey] || 0) - 1);
        if (oldKey) next[oldKey] = (next[oldKey] || 0) + 1;
        return next;
      });
      setDashboardError(`Impossible de modifier le statut de ${client.prenom || ""} ${client.nom || ""} : ${error.message || "erreur Supabase"}`);
    }
  };

  const changerEtapeClient = async (clientId, nouvelleEtape) => {
    const client = clientsDash.find(c => c.id === clientId);
    if (!client || (client.etape || "") === (nouvelleEtape || "")) return;
    const ancienneEtape = client.etape || "";
    setMovingEtapeClientId(clientId);
    setDashboardError("");
    setClientsDash(prev => prev.map(c => c.id === clientId ? { ...c, etape:nouvelleEtape || null } : c));
    const { error } = await supabase.from("invest_clients").update({ etape:nouvelleEtape || null }).eq("id", clientId);
    setMovingEtapeClientId(null);
    if (error) {
      console.error("Erreur changement étape client:", error);
      setClientsDash(prev => prev.map(c => c.id === clientId ? { ...c, etape:ancienneEtape || null } : c));
      setDashboardError(`Impossible de modifier l'étape de ${getClientName(client)} : ${error.message || "erreur Supabase"}`);
    }
  };

  const sectionTitle = (icon, label, sub) => (
    <div style={{
      fontSize:FONT.xs.size, fontWeight:700, color:T.textMuted, textTransform:"uppercase",
      letterSpacing:1.8, marginBottom:SPACING.md, display:"flex", alignItems:"center", justifyContent:"space-between", gap:SPACING.sm-2,
    }}>
      <span style={{display:"inline-flex",alignItems:"center",gap:SPACING.sm-2}}><Icon as={icon} size={13} strokeWidth={2}/>{label}</span>
      {sub && <span style={{textTransform:"none",letterSpacing:0,fontWeight:600,color:T.textMuted}}>{sub}</span>}
    </div>
  );

  return (
    <div style={{ padding:`${SPACING.xl}px ${SPACING.xl+4}px`, maxWidth:1380, margin:"0 auto" }}>
      <div style={{ marginBottom:SPACING.xl, display:"flex", alignItems:"center", justifyContent:"space-between", gap:SPACING.md, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:SPACING.md }}>
          <div style={{
            width:48, height:48, borderRadius:RADIUS.lg, flexShrink:0,
            background:T.accentBg, color:T.accent,
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>
            <Icon as={LayoutDashboard} size={24} strokeWidth={2}/>
          </div>
          <div>
            <div style={{ fontSize:FONT.h2.size, fontWeight:800, color:T.text, letterSpacing:-0.3 }}>Tableau de bord</div>
            <div style={{ fontSize:FONT.sm.size+1, color:T.textSub, marginTop:2 }}>Cockpit de pilotage quotidien Profero Invest</div>
          </div>
        </div>
        <button className="inv-btn inv-btn-out inv-btn-sm" onClick={chargerDashboard}>
          <Icon as={RefreshCw} size={12} strokeWidth={2.2}/> Actualiser
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign:"center", padding:`${SPACING.xxxl}px 0`, color:T.textMuted, display:"flex", justifyContent:"center", alignItems:"center", gap:8 }}>
          <Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>
          Chargement…
        </div>
      ) : stats && (
        <>
          <PlanningSemaine profil={profil} T={T} />

          {sectionTitle(AlertTriangle, "Pilotage immédiat", `${stats.actionsRetard} retard · ${stats.actionsSemaine} cette semaine · ${stats.visitesSemaine} visites`)}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:SPACING.md, marginBottom:SPACING.xxl-2 }}>
            <KPICard icon={AlertTriangle} label="Actions en retard" value={stats.actionsRetard} color={stats.actionsRetard > 0 ? DA : SU} onClick={()=>go("crm", { type:"actions_week_or_late" })}/>
            <KPICard icon={Calendar} label="Actions cette semaine" value={stats.actionsSemaine} color={WA} onClick={()=>go("crm", { type:"actions_week_or_late" })}/>
            <KPICard icon={Home} label="Visites prévues" value={stats.visitesSemaine} color={T.accent}/>
            <KPICard icon={Users} label="Clients sans action" value={stats.sansProchaineAction} color={DA} sub="Prospects exclus" onClick={()=>go("crm", { type:"sans_action" })}/>
            <KPICard icon={Sparkles} label="Top opportunités" value={stats.topOpportunites} color="#c084fc" onClick={()=>go("biens", { type:"all" })}/>
            <KPICard icon={Wallet} label="Honoraires pipeline" value={fmtDashboardEur(stats.baseHonorairesPipeline)} color="#FFC200" sub="Base 1 583 € HT"/>
          </div>

          <ActionsPrioritairesDashboard clients={clientsDash} biens={biensDash} planning={planningDash} T={T} onNavigate={go} />
          <OpportunitesChaudesDashboard biens={biensDash} T={T} onNavigate={go} />
          <DossiersRelanceDashboard clients={clientsDash} biens={biensDash} propositions={propsDash} T={T} onNavigate={go} />

          {sectionTitle(Building2, "Stock de biens", "Opportunités, relances et qualité des fiches")}
          <StockPilotageDashboard stats={stats} T={T} onNavigate={go} />

          {dashboardError && (
            <div style={{ marginBottom:SPACING.md, padding:`${SPACING.sm+2}px ${SPACING.md}px`, borderRadius:RADIUS.md, background:SEMANTIC.danger.bg, border:`1px solid ${SEMANTIC.danger.border}`, color:DA, fontSize:FONT.sm.size+1 }}>
              {dashboardError}
            </div>
          )}

          <ClientsStatutsBoard
            clients={clientsDash}
            T={T}
            movingClientId={movingClientId}
            onMoveClient={changerStatutClient}
            onOpenStatus={(statut)=>go("crm", { type:"statut", value:statut })}
          />

          <PipelineEtapesBoard
            clients={clientsDash}
            T={T}
            movingClientId={movingEtapeClientId}
            onMoveClient={changerEtapeClient}
            onOpenEtape={(etape)=>go("crm", etape ? { type:"etape", value:etape } : { type:"all" })}
          />

          <div style={{display:"grid",gridTemplateColumns:"minmax(0,1.05fr) minmax(0,.95fr)",gap:SPACING.md,alignItems:"start"}}>
            <ClientsARisqueDashboard clients={clientsDash} propositions={propsDash} T={T} onNavigate={go} />
            <div>
              <PerformanceCommercialeDashboard stats={stats} T={T} />
              <ValeurBusinessDashboard stats={stats} T={T} />
              <DirectionPilotageDashboard stats={stats} T={T} />
            </div>
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

function CRM({ profil, T=THEMES_INV.dark, onOuvrirSimulation, onOpenStructuration, initialFilter }) {
  const [clients, setClients]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [ficheId, setFicheId]     = useState(null);
  const [showForm, setShowForm]   = useState(false);
  const [filtreStatut, setFiltreStatut] = useState("");
  const [filtreConseiller, setFiltreConseiller] = useState("");
  const [filtreSource, setFiltreSource] = useState("");
  const [specialFilter, setSpecialFilter] = useState("");
  const [search, setSearch]       = useState("");
  const [columnFilters, setColumnFilters] = useState({});
  const [sortConfig, setSortConfig] = useState({ key:"created_at", direction:"desc" });

  const charger = async () => {
    setLoading(true);
    const { data } = await supabase.from("invest_clients").select("*").order("created_at", { ascending: false });
    setClients(data || []);
    setLoading(false);
  };
  useEffect(() => { charger(); }, []);

  useEffect(() => {
    if (!initialFilter) return;
    setFiltreStatut(""); setFiltreConseiller(""); setFiltreSource(""); setSpecialFilter(""); setColumnFilters({}); setSearch("");
    if (initialFilter.type === "statut") setFiltreStatut(initialFilter.value || "");
    if (initialFilter.type === "etape") setColumnFilters({ etape: initialFilter.value || "" });
    if (["sans_action", "actions_week_or_late", "signes", "with_propositions"].includes(initialFilter.type)) setSpecialFilter(initialFilter.type);
  }, [initialFilter]);

  const conseillers = [...new Set(clients.map(c => c.conseiller).filter(Boolean))];
  const today = new Date().toISOString().slice(0,10);

  const updateColumnFilter = (key, value) => setColumnFilters(prev => ({ ...prev, [key]: value }));
  const handleSort = (key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));

  const valueForColumn = (c, key) => {
    if (key === "contact") return `${c.prenom||""} ${c.nom||""} ${c.email||""} ${c.telephone||""}`;
    if (key === "action") return `${c.date_prochaine_action||""} ${c.prochaine_action||""}`;
    return c[key];
  };

  let filtered = clients.filter(c => {
    if (filtreStatut && c.statut !== filtreStatut) return false;
    if (filtreConseiller && c.conseiller !== filtreConseiller) return false;
    if (filtreSource && c.source !== filtreSource) return false;
    if (specialFilter === "sans_action" && (c.prochaine_action || c.date_prochaine_action)) return false;
    if (specialFilter === "actions_week_or_late" && !isActionLateOrThisWeek(c)) return false;
    if (specialFilter === "signes" && !c.date_signature) return false;
    if (search && !normTxt(`${c.nom} ${c.prenom} ${c.email} ${c.telephone} ${c.conseiller} ${c.source} ${c.etape} ${c.prochaine_action}`).includes(normTxt(search))) return false;
    return Object.entries(columnFilters).every(([key, value]) => {
      if (!value) return true;
      return normTxt(valueForColumn(c, key)).includes(normTxt(value));
    });
  });

  filtered = [...filtered].sort((a,b) => compareValues(valueForColumn(a, sortConfig.key), valueForColumn(b, sortConfig.key), sortConfig.direction));

  const STATUT_COLORS = { Prospect:"#4db8ff", Actif:"#50c878", Inactif:"#FFC200", Terminé:"rgba(255,255,255,0.3)" };
  const fmtDate = d => d ? new Date(d).toLocaleDateString("fr-FR", { day:"2-digit", month:"short" }) : "—";
  const fmtBudget = v => v > 0 ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits:0 }).format(v)+" €" : "—";
  const gridCols = "1.55fr .85fr .85fr .9fr .85fr .95fr 1.35fr 1.25fr 75px";

  if (ficheId) return <FicheClient id={ficheId} profil={profil} T={T} onRetour={() => { setFicheId(null); charger(); }} onOuvrirSimulation={onOuvrirSimulation} onOpenStructuration={onOpenStructuration} />;

  return (
    <div style={{ padding:`${SPACING.xl}px ${SPACING.xl+4}px`, maxWidth:1600, margin:"0 auto" }}>
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

      {/* Filtres rapides */}
      <div style={{ display:"flex", gap:SPACING.sm+2, marginBottom:SPACING.lg, flexWrap:"wrap" }}>
        <div style={{position:"relative", width:260}}>
          <Icon as={Search} size={13} color={T.textMuted}
            style={{position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", pointerEvents:"none"}}/>
          <input className="inv-inp" placeholder="Rechercher partout…" value={search} onChange={e=>setSearch(e.target.value)}
            style={{ width:"100%", textAlign:"left", paddingLeft:30, fontSize:FONT.sm.size+1 }}/>
        </div>
        <select className="inv-sel" value={filtreStatut} onChange={e=>{setFiltreStatut(e.target.value); setSpecialFilter("");}}>
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
        <button className="inv-btn inv-btn-out inv-btn-sm" onClick={()=>{setFiltreStatut("");setFiltreConseiller("");setFiltreSource("");setSpecialFilter("");setSearch("");setColumnFilters({});}}>
          <Icon as={X} size={12} strokeWidth={2.2}/> Réinitialiser
        </button>
        {specialFilter && <span style={{fontSize:FONT.sm.size, color:T.accent, fontWeight:700, display:"inline-flex", alignItems:"center"}}>Filtre dashboard actif</span>}
      </div>

      {/* Liste */}
      {loading ? (
        <div style={{ textAlign:"center", padding:`${SPACING.xl}px 0`, color:T.textMuted, display:"flex", justifyContent:"center", alignItems:"center", gap:8 }}>
          <Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>
          Chargement…
        </div>
      ) : (
        <div style={{ background:T.card, borderRadius:RADIUS.xl, border:`1px solid ${T.border}`, overflowX:"auto", boxShadow:T.shadowSm }}>
          <div style={{ minWidth:1280 }}>
            <div style={{
              display:"grid", gridTemplateColumns:gridCols,
              padding:`${SPACING.md-2}px ${SPACING.lg}px`, background:T.sectionHd,
              borderBottom:`1px solid ${T.border}`, fontSize:FONT.xs.size-1, fontWeight:700,
              color:T.textMuted, textTransform:"uppercase", letterSpacing:0.8, gap:10,
            }}>
              <SortableHeader label="Contact" sortKey="contact" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Date contact" sortKey="date_premier_contact" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Statut" sortKey="statut" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Source" sortKey="source" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Budget" sortKey="budget" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Conseiller" sortKey="conseiller" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Étape" sortKey="etape" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Prochaine action" sortKey="action" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <div/>
            </div>
            <div style={{
              display:"grid", gridTemplateColumns:gridCols, gap:10, padding:`${SPACING.sm}px ${SPACING.lg}px`,
              background:T.input, borderBottom:`1px solid ${T.border}`,
            }}>
              {["contact","date_premier_contact","statut","source","budget","conseiller","etape","action"].map(k => (
                <input key={k} className="inv-inp" value={columnFilters[k]||""} placeholder="Filtrer…" onChange={e=>updateColumnFilter(k,e.target.value)} style={{width:"100%", textAlign:"left", fontSize:FONT.xs.size+1, padding:"5px 7px"}}/>
              ))}
              <div/>
            </div>
            {filtered.length === 0 ? (
              <div style={{ textAlign:"center", padding:`${SPACING.xl}px 0`, color:T.textMuted, fontSize:FONT.base.size, fontStyle:"italic" }}>Aucun contact trouvé</div>
            ) : filtered.map(c => {
              const initials = `${c.prenom?.[0]||""}${c.nom?.[0]||""}`.toUpperCase();
              const enRetard = c.date_prochaine_action && c.date_prochaine_action < today;
              return (
                <div key={c.id} style={{
                  display:"grid", gridTemplateColumns:gridCols, gap:10,
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
                  <div style={{ fontSize:FONT.sm.size, color:T.textSub }}>{fmtDate(c.date_premier_contact)}</div>
                  <div>
                    <span style={{
                      background:`${STATUT_COLORS[c.statut]}18`, color:STATUT_COLORS[c.statut],
                      border:`1px solid ${STATUT_COLORS[c.statut]}33`, borderRadius:RADIUS.pill,
                      padding:`${SPACING.xs-2}px ${SPACING.sm+2}px`, fontSize:FONT.xs.size, fontWeight:700,
                    }}>{c.statut}</span>
                  </div>
                  <div style={{ fontSize:FONT.sm.size, color:T.textSub }}>{c.source||"—"}</div>
                  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:FONT.sm.size+1, fontWeight:600, color:T.accent }}>{fmtBudget(c.budget)}</div>
                  <div style={{ fontSize:FONT.sm.size+1, color:T.textSub }}>{c.conseiller||"—"}</div>
                  <div style={{ fontSize:FONT.sm.size, color:T.textSub }}>{c.etape||"—"}</div>
                  <div style={{ fontSize:FONT.sm.size, color: enRetard ? DA : T.textMuted }}>
                    {enRetard && <Icon as={AlertTriangle} size={11} strokeWidth={2.2} style={{marginRight:3, verticalAlign:-1}}/>}
                    {fmtDate(c.date_prochaine_action)}
                    {c.prochaine_action && <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:1, opacity:0.7 }}>{c.prochaine_action.slice(0,42)}</div>}
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
    date_premier_contact: client?.date_premier_contact||"",
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
      etape:                 form.etape || null,
      date_premier_contact:  form.date_premier_contact || null,
      prochaine_action:      form.prochaine_action.trim() || null,
      date_prochaine_action: form.date_prochaine_action || null,
      notes_rapides:         form.notes_rapides.trim() || null,
    };
    Object.keys(payload).forEach(k => { if (payload[k] === "") payload[k] = null; });
    const write = async (p) => isEdit
      ? await supabase.from("invest_clients").update(p).eq("id", client.id)
      : await supabase.from("invest_clients").insert(p);
    let { error } = await write(payload);
    if (error && (error.code === "42703" || error.code === "PGRST204" || String(error.message||"").includes("date_premier_contact"))) {
      const { date_premier_contact, ...fallbackPayload } = payload;
      const retry = await write(fallbackPayload);
      error = retry.error;
      if (!error) console.warn("Colonne date_premier_contact absente. Lancez la migration SQL pour activer cette donnée.");
    }
    if (error) { console.error("Erreur sauvegarde client:", error); alert("Erreur : " + error.message); }
    setSaving(false);
    if (!error) onSave();
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 }}>
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, padding:"28px 30px", width:"90%", maxWidth:640, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 30px 80px rgba(0,0,0,.5)" }}>
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
          <div style={{ marginBottom:14, gridColumn:"1 / 3" }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Étape en cours</label>
            <select className="inv-sel" value={form.etape} style={{ width:"100%" }} onChange={e=>setForm({...form,etape:e.target.value})}>
              <option value="">Sélectionner une étape…</option>
              {ETAPES_CLIENT.map(e=><option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Date avant contact</label><input className="inv-inp" type="date" value={form.date_premier_contact} style={{ width:"100%" }} onChange={e=>setForm({...form,date_premier_contact:e.target.value})}/></div>
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

// ─── DOCUMENTS// ─── DOCUMENTS (Supabase Storage) ────────────────────────────────────────────
// Bucket requis : "invest-documents" (public: false, RLS: authenticated)
// Chemin des fichiers : clients/{client_id}/{filename} ou biens/{bien_id}/{filename}

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
      </div>
    </div>
  );
}

function FicheClient({ id, profil, onRetour, T=THEMES_INV.dark, onOuvrirSimulation, onOpenStructuration }) {
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
      supabase.from("invest_biens").select("id,adresse,ville,code_postal,statut,prix_vente,prix_travaux,cout_total,montant_offre,rendement_brut,cashflow_estime,visite_data").order("adresse"),
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

  const proposerBienDirect = async (bienId) => {
    if (!bienId) return;
    const { error } = await supabase.from("invest_propositions").insert({
      client_id: id,
      bien_id: bienId,
      statut: "proposé",
      commentaire: "Proposé depuis le matching automatique",
      lien_dossier: "",
      date_proposition: new Date().toISOString().slice(0,10),
    });
    if (error) alert("Impossible de proposer ce bien : " + error.message);
    else charger();
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
        <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => setShowEdit(true)}>
          <Icon as={Pencil} size={12} strokeWidth={2.2}/> Modifier
        </button>
        {onOpenStructuration && (
          <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => onOpenStructuration(client.id)}>
            <Icon as={Briefcase} size={12} strokeWidth={2.2}/> Structuration
          </button>
        )}
        <button className="inv-btn inv-btn-danger inv-btn-sm" onClick={async () => {
          if (!window.confirm(`Supprimer ${client.prenom} ${client.nom} ? Cette action est irréversible.`)) return;
          await supabase.from("invest_notes").delete().eq("client_id", id);
          await supabase.from("invest_propositions").delete().eq("client_id", id);
          await supabase.from("invest_clients").delete().eq("id", id);
          onRetour();
        }}><Icon as={Trash2} size={12} strokeWidth={2.2}/> Supprimer</button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        {/* Infos */}
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <ClientScoreCard client={client} propositions={props} biens={biens} T={T} />
          <div className="inv-card">
            <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Users} size={13} strokeWidth={2.2}/>Informations</span></div>
            <div className="inv-card-bd">
              {[["Conseiller", client.conseiller],["Source", client.source],["Budget", fmtBudget(client.budget)],["Étape", client.etape||"—"],["Date signature", fmtDate(client.date_signature)],["Avancement", client.avancement ? client.avancement+"%" : "—"]].map(([l,v])=>(
                <div key={l} className="inv-row"><span className="inv-lbl">{l}</span><span className="inv-val calc">{v||"—"}</span></div>
              ))}
            </div>
          </div>
          <ClientStrategyCard client={client} T={T} onSaved={charger} />
          <ChecklistDocumentsClientCard client={client} T={T} onSaved={charger} />
          <MatchingBiensClientCard client={client} biens={biens} propositions={props} T={T} onProposer={proposerBienDirect} />
          <div className="inv-card">
            <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Calendar} size={13} strokeWidth={2.2}/>Prochaine Action</span></div>
            <div className="inv-card-bd">
              <div className="inv-row"><span className="inv-lbl">Action</span><span className="inv-val calc">{client.prochaine_action||"—"}</span></div>
              <div className="inv-row"><span className="inv-lbl">Date</span><span className="inv-val calc" style={{ color: client.date_prochaine_action < new Date().toISOString().slice(0,10) ? "#e05c5c" : T.text }}>{fmtDate(client.date_prochaine_action)}</span></div>
              {client.notes_rapides && <div style={{ marginTop:10, padding:"8px 10px", background:"#f8f9fb", borderRadius:7, fontSize:12, color:"#5a6070", lineHeight:1.6 }}>{client.notes_rapides}</div>}
            </div>
          </div>
          {/* Propositions */}
          <div className="inv-card">
            <div className="inv-card-hd" style={{ justifyContent:"space-between" }}>
              <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Home} size={13} strokeWidth={2.2}/>Biens proposés ({props.length})</span>
              <button className="inv-btn inv-btn-sm" style={{ background:"rgba(255,255,255,0.15)", color:"black", border:"none" }} onClick={() => setShowProp(true)}>＋ Proposer</button>
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
                  {p.lien_dossier && <a href={p.lien_dossier} target="_blank" rel="noreferrer" style={{ fontSize:11, color:T.accent, display:"inline-flex", alignItems:"center", gap:3 }}><Icon as={FileText} size={10} strokeWidth={2.2}/> Dossier présenté <Icon as={ExternalLink} size={9}/></a>}
                </div>
              ))}
            </div>
          </div>
          {/* Simulations liées au client */}
          {onOuvrirSimulation && (
            <div className="inv-card">
              <div className="inv-card-hd" style={{ justifyContent:"space-between" }}>
                <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={BarChart3} size={13} strokeWidth={2.2}/>Simulations ({simulations.length})</span>
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
                        <div style={{ fontWeight:600, fontSize:13, color:T.text, display:"inline-flex", alignItems:"center", gap:6 }}><Icon as={FileText} size={13} strokeWidth={2.2}/> {s.nom}</div>
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
          <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={MessageSquare} size={13} strokeWidth={2.2}/>Historique des notes ({notes.length})</span></div>
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


const GOOGLE_MAPS_API_KEY = (
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_GOOGLE_MAPS_API_KEY)
  || (typeof process !== "undefined" && process.env && process.env.REACT_APP_GOOGLE_MAPS_API_KEY)
  || "AIzaSyB9LLndlvqmpaxGg4zZoZzu5lzQYs4QQRg"
);
const GOOGLE_MAPS_SCRIPT_ID = "google-maps-js-api-profero-invest";

function getGoogleMapsApiKey() {
  return (GOOGLE_MAPS_API_KEY || "").trim();
}

function getBienGoogleAddress(b) {
  return [b.adresse, b.code_postal, b.ville].filter(Boolean).join(", ").trim();
}

function googleMapsSearchUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function isValidLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}

function loadGoogleMapsApi(apiKey) {
  if (typeof window === "undefined") return Promise.reject(new Error("Google Maps doit être chargé côté navigateur."));
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (!apiKey || apiKey === "REMPLACER_PAR_VOTRE_CLE_API_GOOGLE_MAPS") {
    return Promise.reject(new Error("Clé API Google Maps manquante."));
  }
  if (window.__proferoGoogleMapsPromise) return window.__proferoGoogleMapsPromise;

  window.__proferoGoogleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_MAPS_SCRIPT_ID);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google.maps), { once:true });
      existing.addEventListener("error", () => reject(new Error("Chargement Google Maps impossible.")), { once:true });
      return;
    }
    const script = document.createElement("script");
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&language=fr&region=FR`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google.maps);
    script.onerror = () => reject(new Error("Chargement Google Maps impossible. Vérifiez la clé API et les restrictions de domaine."));
    document.head.appendChild(script);
  });
  return window.__proferoGoogleMapsPromise;
}

function readGeocodeCache() {
  try { return JSON.parse(localStorage.getItem("profero_invest_geocode_cache_v1") || "{}"); }
  catch { return {}; }
}

function writeGeocodeCache(cache) {
  try { localStorage.setItem("profero_invest_geocode_cache_v1", JSON.stringify(cache || {})); }
  catch {}
}

async function geocodeAddressWithApiAdresse(address) {
  const cleanAddress = String(address || "").trim();
  if (!cleanAddress) return { error:"Adresse manquante" };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(cleanAddress)}&limit=1`;
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) return { error:`API Adresse indisponible (${response.status})` };

    const json = await response.json();
    const feature = json?.features?.[0];
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return { error:"Adresse introuvable" };

    const lng = parseFloat(coords[0]);
    const lat = parseFloat(coords[1]);
    if (!isValidLatLng(lat, lng)) return { error:"Coordonnées invalides" };

    return {
      lat,
      lng,
      formatted_address: feature?.properties?.label || cleanAddress,
      status:"OK",
      source:"api-adresse",
    };
  } catch (e) {
    return { error: e?.name === "AbortError" ? "API Adresse trop lente" : (e?.message || "Géocodage API Adresse impossible") };
  }
}

function geocodeAddress(geocoder, address) {
  return new Promise(resolve => {
    geocoder.geocode({ address, region:"FR" }, async (results, status) => {
      if (status === "OK" && results?.[0]?.geometry?.location) {
        const loc = results[0].geometry.location;
        resolve({
          lat: loc.lat(),
          lng: loc.lng(),
          formatted_address: results[0].formatted_address || address,
          status,
          source:"google",
        });
        return;
      }

      // Fallback France : si Google refuse le géocodage (REQUEST_DENIED) ou ne trouve pas,
      // on utilise l'API Adresse nationale pour créer latitude/longitude à partir de l'adresse.
      const fallback = await geocodeAddressWithApiAdresse(address);
      if (fallback?.lat && fallback?.lng && isValidLatLng(fallback.lat, fallback.lng)) {
        resolve({ ...fallback, google_status: status || "UNKNOWN_ERROR" });
      } else {
        resolve({ error: status || fallback?.error || "UNKNOWN_ERROR" });
      }
    });
  });
}

async function saveBienCoordinatesIfPossible(bienId, lat, lng) {
  try {
    await supabase.from("invest_biens").update({ latitude: lat, longitude: lng }).eq("id", bienId);
  } catch (e) {
    // La carte continue à fonctionner même si les colonnes ou les droits d'écriture ne sont pas disponibles.
  }
}

async function getCoordinatesFromAddress(address) {
  const cleanAddress = String(address || "").trim();
  if (!cleanAddress) return { lat:null, lng:null, error:"Adresse manquante" };

  const cache = readGeocodeCache();
  if (cache[cleanAddress] && isValidLatLng(cache[cleanAddress].lat, cache[cleanAddress].lng)) {
    return { ...cache[cleanAddress], source:"cache" };
  }

  // 1) Priorité à l'adresse française : génère latitude/longitude sans dépendre
  // du statut REQUEST_DENIED de Google Geocoding.
  const adresseNationale = await geocodeAddressWithApiAdresse(cleanAddress);
  if (adresseNationale?.lat && adresseNationale?.lng && isValidLatLng(adresseNationale.lat, adresseNationale.lng)) {
    const coords = {
      lat: adresseNationale.lat,
      lng: adresseNationale.lng,
      formatted_address: adresseNationale.formatted_address || cleanAddress,
      source:"api-adresse",
    };
    cache[cleanAddress] = coords;
    writeGeocodeCache(cache);
    return coords;
  }

  // 2) Fallback Google si l'adresse n'est pas reconnue par l'API Adresse.
  try {
    const maps = await loadGoogleMapsApi(getGoogleMapsApiKey());
    const geocoder = new maps.Geocoder();
    const geo = await geocodeAddress(geocoder, cleanAddress);

    if (geo?.lat && geo?.lng && isValidLatLng(geo.lat, geo.lng)) {
      const coords = {
        lat: geo.lat,
        lng: geo.lng,
        formatted_address: geo.formatted_address || cleanAddress,
        source: geo.source || "google",
      };
      cache[cleanAddress] = coords;
      writeGeocodeCache(cache);
      return coords;
    }

    return { lat:null, lng:null, error: geo?.error || adresseNationale?.error || "Adresse introuvable" };
  } catch (e) {
    return { lat:null, lng:null, error: adresseNationale?.error || e?.message || "Géocodage impossible" };
  }
}

function resolveCoordinatesFromGeocode(geocoded, fallbackBien, address, previousAddress) {
  if (geocoded && isValidLatLng(parseFloat(geocoded.lat), parseFloat(geocoded.lng))) {
    return { lat: parseFloat(geocoded.lat), lng: parseFloat(geocoded.lng) };
  }

  const oldLat = parseFloat(fallbackBien?.latitude);
  const oldLng = parseFloat(fallbackBien?.longitude);
  const sameAddress = String(address || "").trim() === String(previousAddress || "").trim();
  if (sameAddress && isValidLatLng(oldLat, oldLng)) {
    return { lat: oldLat, lng: oldLng };
  }

  return { lat:null, lng:null };
}

function CarteBiens({ biens, T=THEMES_INV.dark, onOpenBien }) {
  const [selectedId, setSelectedId] = useState(null);
  const [points, setPoints] = useState([]);
  const [loadingMap, setLoadingMap] = useState(false);
  const [mapError, setMapError] = useState("");
  const mapElRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const infoWindowRef = useRef(null);
  const geocodeCacheRef = useRef(readGeocodeCache());

  const biensAvecAdresse = biens.filter(b => getBienGoogleAddress(b));
  const addressKey = biensAvecAdresse.map(b => `${b.id}:${getBienGoogleAddress(b)}:${b.latitude||""}:${b.longitude||""}`).join("|");
  const fmtEur  = v => v > 0 ? new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(v)+" €" : "—";
  const apiKey = getGoogleMapsApiKey();

  useEffect(() => {
    if (biensAvecAdresse.length === 0) {
      setSelectedId(null);
      setPoints([]);
      return;
    }
    if (!selectedId || !biensAvecAdresse.some(b => b.id === selectedId)) {
      setSelectedId(biensAvecAdresse[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressKey, selectedId]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setMapError("");
      if (biensAvecAdresse.length === 0) { setPoints([]); return; }
      setLoadingMap(true);
      try {
        const maps = await loadGoogleMapsApi(apiKey);
        if (cancelled) return;
        if (!mapInstanceRef.current && mapElRef.current) {
          mapInstanceRef.current = new maps.Map(mapElRef.current, {
            center: { lat: 47.4784, lng: -0.5632 },
            zoom: 11,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
          });
          infoWindowRef.current = new maps.InfoWindow();
        }

        const geocoder = new maps.Geocoder();
        const cache = geocodeCacheRef.current || {};
        const resolved = [];

        for (const b of biensAvecAdresse) {
          const address = getBienGoogleAddress(b);
          const dbLat = parseFloat(b.latitude);
          const dbLng = parseFloat(b.longitude);

          if (isValidLatLng(dbLat, dbLng)) {
            resolved.push({ b, address, lat: dbLat, lng: dbLng, formatted_address: address, source:"database" });
            continue;
          }

          if (cache[address] && isValidLatLng(cache[address].lat, cache[address].lng)) {
            resolved.push({ b, address, ...cache[address], source:"cache" });
            continue;
          }

          const geo = await geocodeAddress(geocoder, address);
          if (cancelled) return;
          if (geo?.lat && geo?.lng) {
            const coords = { lat: geo.lat, lng: geo.lng, formatted_address: geo.formatted_address || address, source: geo.source || "google" };
            cache[address] = coords;
            resolved.push({ b, address, ...coords, source: coords.source });
            saveBienCoordinatesIfPossible(b.id, geo.lat, geo.lng);
          } else {
            resolved.push({ b, address, error: geo.error || "Adresse introuvable" });
          }
          await new Promise(r => setTimeout(r, 120));
        }

        geocodeCacheRef.current = cache;
        writeGeocodeCache(cache);
        setPoints(resolved.filter(p => isValidLatLng(p.lat, p.lng)));

        const failed = resolved.filter(p => p.error).length;
        setMapError(failed > 0 ? `${failed} adresse${failed>1?"s":""} non géocodée${failed>1?"s":""}. Vérifier l'adresse dans la fiche bien.` : "");
      } catch (e) {
        if (!cancelled) {
          setMapError(e?.message || "Impossible de charger Google Maps.");
          setPoints([]);
        }
      } finally {
        if (!cancelled) setLoadingMap(false);
      }
    };
    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressKey, apiKey]);

  const openPointInfo = useCallback((point, marker) => {
    if (!point || !infoWindowRef.current) return;
    const b = point.b;
    const address = point.formatted_address || point.address;
    const html = `
      <div style="font-family:Arial,sans-serif;min-width:230px;max-width:310px;color:#1a1f2e">
        <div style="font-size:14px;font-weight:800;margin-bottom:4px">${escapeHtml(b.adresse || b.ville || "Bien")}</div>
        <div style="font-size:12px;color:#4a5568;line-height:1.45;margin-bottom:8px">${escapeHtml(address)}</div>
        <div style="font-size:12px;line-height:1.7">
          <div><strong>Statut :</strong> ${escapeHtml(b.statut || "—")}</div>
          <div><strong>Prix :</strong> ${escapeHtml(fmtEur(b.prix_vente))}</div>
          <div><strong>Offre :</strong> ${escapeHtml(fmtEur(b.montant_offre))}</div>
          <div><strong>Travaux :</strong> ${escapeHtml(fmtEur(b.prix_travaux))}</div>
          <div><strong>Rendement :</strong> ${b.rendement_brut ? `${Number(b.rendement_brut).toFixed(1)} %` : "—"}</div>
          <div><strong>Cash-flow :</strong> ${escapeHtml(fmtEur(b.cashflow_estime))}</div>
        </div>
        <a href="${googleMapsSearchUrl(point.address)}" target="_blank" rel="noreferrer" style="display:inline-block;margin-top:9px;color:#4070e8;text-decoration:none;font-weight:700;font-size:12px">Ouvrir dans Google Maps →</a>
      </div>`;
    infoWindowRef.current.setContent(html);
    if (marker) infoWindowRef.current.open({ anchor: marker, map: mapInstanceRef.current });
  }, [fmtEur]);

  useEffect(() => {
    const maps = window.google?.maps;
    const map = mapInstanceRef.current;
    if (!maps || !map) return;

    markersRef.current.forEach(marker => marker.setMap(null));
    markersRef.current = [];

    if (points.length === 0) return;

    const bounds = new maps.LatLngBounds();
    points.forEach((point, idx) => {
      const color = STATUT_BIEN_COLORS[point.b.statut] || "#4070e8";
      const marker = new maps.Marker({
        position: { lat: point.lat, lng: point.lng },
        map,
        title: point.address,
        label: { text: String(idx + 1), color: "#ffffff", fontSize: "11px", fontWeight: "700" },
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: 11,
          fillColor: color,
          fillOpacity: 0.95,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
      marker.addListener("click", () => {
        setSelectedId(point.b.id);
        openPointInfo(point, marker);
      });
      markersRef.current.push(marker);
      bounds.extend({ lat: point.lat, lng: point.lng });
    });

    if (points.length === 1) {
      map.setCenter({ lat: points[0].lat, lng: points[0].lng });
      map.setZoom(14);
    } else {
      map.fitBounds(bounds, 54);
    }
  }, [points, openPointInfo]);

  useEffect(() => {
    const maps = window.google?.maps;
    const map = mapInstanceRef.current;
    if (!maps || !map || !selectedId) return;
    const idx = points.findIndex(p => p.b.id === selectedId);
    if (idx < 0) return;
    const point = points[idx];
    const marker = markersRef.current[idx];
    map.panTo({ lat: point.lat, lng: point.lng });
    if ((map.getZoom?.() || 0) < 12) map.setZoom(13);
    openPointInfo(point, marker);
  }, [selectedId, points, openPointInfo]);

  const selectedPoint = points.find(p => p.b.id === selectedId) || points[0] || null;

  return (
    <div className="inv-card" style={{ marginBottom:SPACING.lg }}>
      <div className="inv-card-hd blue" style={{justifyContent:"space-between"}}>
        <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
          <Icon as={MapPin} size={13} strokeWidth={2.2}/>
          Google Maps — biens en stock
        </span>
        <span style={{fontSize:FONT.xs.size, color:T.textMuted, textTransform:"none", letterSpacing:0}}>
          {points.length}/{biensAvecAdresse.length} bien{biensAvecAdresse.length>1?"s":""} positionné{points.length>1?"s":""}
        </span>
      </div>
      <div className="inv-card-bd">
        {biensAvecAdresse.length === 0 ? (
          <div style={{padding:20, textAlign:"center", color:T.textMuted, border:`1px dashed ${T.border}`, borderRadius:RADIUS.lg, background:T.input}}>
            Aucun bien avec une adresse exploitable pour Google Maps. Renseignez au minimum une adresse ou une ville dans la fiche bien.
          </div>
        ) : !apiKey || apiKey === "REMPLACER_PAR_VOTRE_CLE_API_GOOGLE_MAPS" ? (
          <div style={{padding:20, border:`1px dashed ${T.accentBorder}`, borderRadius:RADIUS.lg, background:T.accentBg, color:T.textSub, lineHeight:1.6}}>
            <div style={{fontWeight:800, color:T.accent, marginBottom:6}}>Clé API Google Maps à ajouter</div>
            Dans le fichier <strong>PageInvest.jsx</strong>, remplacez la valeur de <strong>GOOGLE_MAPS_API_KEY</strong> par votre clé Google Maps, puis activez les API <strong>Maps JavaScript API</strong> et <strong>Geocoding API</strong> dans Google Cloud.
          </div>
        ) : (
          <div style={{display:"grid", gridTemplateColumns:"2.1fr 1fr", gap:SPACING.md, alignItems:"stretch"}}>
            <div style={{border:`1px solid ${T.border}`, borderRadius:RADIUS.xl, overflow:"hidden", background:T.input, minHeight:450, position:"relative"}}>
              <div ref={mapElRef} style={{height:390, width:"100%"}} />
              {loadingMap && (
                <div style={{position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.28)", color:"white", fontWeight:800, gap:8}}>
                  <Icon as={RefreshCw} size={15} style={{animation:"spin 1s linear infinite"}}/> Chargement Google Maps…
                </div>
              )}
              <div style={{
                padding:`${SPACING.sm+2}px ${SPACING.lg}px`, borderTop:`1px solid ${T.border}`,
                display:"flex", alignItems:"center", justifyContent:"space-between", gap:SPACING.sm, flexWrap:"wrap",
                background:T.card,
              }}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:FONT.sm.size+1, fontWeight:800, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                    {selectedPoint?.b?.adresse || selectedPoint?.b?.ville || "Sélectionnez un bien"}
                  </div>
                  <div style={{fontSize:FONT.xs.size+1, color:mapError ? DA : T.textSub, marginTop:2}}>
                    {mapError || selectedPoint?.formatted_address || selectedPoint?.address || "Carte Google Maps"}
                  </div>
                </div>
                {selectedPoint && (
                  <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
                    <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={()=>onOpenBien?.(selectedPoint.b.id)}>
                      Ouvrir la fiche
                    </button>
                    <a
                      className="inv-btn inv-btn-out inv-btn-sm"
                      href={googleMapsSearchUrl(selectedPoint.address)}
                      target="_blank"
                      rel="noreferrer"
                      style={{textDecoration:"none"}}
                    >
                      Google Maps <Icon as={ExternalLink} size={11}/>
                    </a>
                  </div>
                )}
              </div>
            </div>

            <div style={{
              border:`1px solid ${T.border}`, borderRadius:RADIUS.xl, background:T.input,
              minHeight:450, maxHeight:450, overflowY:"auto",
            }}>
              <div style={{padding:`${SPACING.sm+2}px ${SPACING.md}px`, borderBottom:`1px solid ${T.border}`, background:T.sectionHd}}>
                <div style={{fontSize:FONT.xs.size, fontWeight:800, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2}}>
                  Biens géolocalisés
                </div>
              </div>
              <div style={{display:"flex", flexDirection:"column", gap:6, padding:SPACING.sm}}>
                {biensAvecAdresse.map((b, idx) => {
                  const addr = getBienGoogleAddress(b);
                  const point = points.find(p => p.b.id === b.id);
                  const active = selectedId === b.id;
                  const color = STATUT_BIEN_COLORS[b.statut] || T.accent;
                  return (
                    <button
                      key={b.id}
                      onClick={() => point && setSelectedId(b.id)}
                      disabled={!point}
                      style={{
                        width:"100%", textAlign:"left", cursor:point ? "pointer" : "not-allowed", fontFamily:"inherit",
                        padding:`${SPACING.sm+1}px ${SPACING.md}px`, borderRadius:RADIUS.md,
                        border:`1px solid ${active ? T.accentBorder : T.border}`,
                        background: active ? T.accentBg : T.card,
                        transition:"all .12s", opacity:point ? 1 : .55,
                      }}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor=T.borderHover;}}
                      onMouseLeave={e=>{e.currentTarget.style.borderColor=active ? T.accentBorder : T.border;}}
                    >
                      <div style={{display:"flex", alignItems:"flex-start", gap:8}}>
                        <span style={{
                          width:22, height:22, borderRadius:"50%", background:color, color:"white",
                          flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center",
                          fontSize:FONT.xs.size-1, fontWeight:800, marginTop:1,
                          boxShadow:`0 0 0 3px ${color}22`,
                        }}>{idx+1}</span>
                        <div style={{minWidth:0, flex:1}}>
                          <div style={{fontSize:FONT.sm.size+1, fontWeight:800, color:active ? T.accent : T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                            {b.adresse || b.ville || "Bien sans adresse"}
                          </div>
                          <div style={{fontSize:FONT.xs.size+1, color:T.textSub, marginTop:2, lineHeight:1.35}}>
                            {point?.formatted_address || addr}
                          </div>
                          <div style={{display:"flex", gap:6, flexWrap:"wrap", marginTop:6, fontSize:FONT.xs.size, color:T.textMuted}}>
                            {b.statut && <span style={{color, fontWeight:700}}>{b.statut}</span>}
                            {b.prix_vente > 0 && <span>· {fmtEur(b.prix_vente)}</span>}
                            {b.rendement_brut > 0 && <span>· {Number(b.rendement_brut).toFixed(1)} %</span>}
                            {!point && <span style={{color:DA}}>· non positionné</span>}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StockBiens({ profil, T=THEMES_INV.dark, initialFilter }) {
  const [biens, setBiens]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [ficheId, setFicheId]   = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [filtreStatut, setFiltreStatut] = useState("");
  const [filtreVille, setFiltreVille]   = useState("");
  const [specialFilter, setSpecialFilter] = useState("");
  const [search, setSearch]     = useState("");
  const [sortConfig, setSortConfig] = useState({ key:"created_at", direction:"desc" });

  const charger = async () => {
    setLoading(true);
    const { data } = await supabase.from("invest_biens").select("*").order("created_at", { ascending: false });
    setBiens(data || []);
    setLoading(false);
  };
  useEffect(() => { charger(); }, []);

  useEffect(() => {
    if (!initialFilter) return;
    setFiltreStatut(""); setFiltreVille(""); setSpecialFilter(""); setSearch("");
    if (initialFilter.type === "statut") setFiltreStatut(initialFilter.value || "");
    if (initialFilter.type === "a_relancer") { setSpecialFilter("a_relancer"); setSortConfig({ key:"date_relance", direction:"asc" }); }
    if (initialFilter.type === "all") setSortConfig({ key:"created_at", direction:"desc" });
  }, [initialFilter]);

  const today = new Date().toISOString().slice(0,10);
  const villes = [...new Set(biens.map(b => b.ville).filter(Boolean))];
  const handleSort = (key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));

  let filtered = biens.filter(b => {
    if (filtreStatut && b.statut !== filtreStatut) return false;
    if (filtreVille && b.ville !== filtreVille) return false;
    if (specialFilter === "a_relancer" && !(b.date_relance && b.date_relance <= today)) return false;
    if (search && !normTxt(`${b.adresse||""} ${b.ville||""} ${b.code_postal||""} ${b.agence||""} ${b.interlocuteur||""} ${b.statut||""}`).includes(normTxt(search))) return false;
    return true;
  });

  filtered = [...filtered].sort((a,b) => compareValues(a[sortConfig.key], b[sortConfig.key], sortConfig.direction));

  const fmtDate = d => d ? new Date(d).toLocaleDateString("fr-FR",{day:"2-digit",month:"short"}) : "—";
  const fmtEur  = v => v > 0 ? new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(v)+" €" : "—";
  const aRelancer = biens.filter(b => b.date_relance && b.date_relance <= today).length;
  const gridCols = ".85fr 2fr 1.15fr 1fr 1fr 1fr 1fr 80px";

  if (ficheId) return <FicheBien id={ficheId} profil={profil} T={T} onRetour={() => { setFicheId(null); charger(); }} />;

  return (
    <div style={{ padding:`${SPACING.xl}px ${SPACING.xl+4}px`, maxWidth:1500, margin:"0 auto" }}>
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

      <CarteBiens biens={filtered} T={T} onOpenBien={setFicheId} />

      {/* Filtres */}
      <div style={{ display:"flex", gap:SPACING.sm+2, marginBottom:SPACING.lg, flexWrap:"wrap" }}>
        <div style={{position:"relative", width:240}}>
          <Icon as={Search} size={13} color={T.textMuted}
            style={{position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", pointerEvents:"none"}}/>
          <input className="inv-inp" placeholder="Rechercher…" value={search} onChange={e=>setSearch(e.target.value)}
            style={{ width:"100%", textAlign:"left", paddingLeft:30, fontSize:FONT.sm.size+1 }}/>
        </div>
        <select className="inv-sel" value={filtreStatut} onChange={e=>{setFiltreStatut(e.target.value); setSpecialFilter("");}}>
          <option value="">Tous statuts</option>
          {STATUTS_BIEN.map(s=><option key={s}>{s}</option>)}
        </select>
        <select className="inv-sel" value={filtreVille} onChange={e=>setFiltreVille(e.target.value)}>
          <option value="">Toutes villes</option>
          {villes.map(v=><option key={v}>{v}</option>)}
        </select>
        <select className="inv-sel" value={`${sortConfig.key}:${sortConfig.direction}`} onChange={e=>{ const [key,direction]=e.target.value.split(":"); setSortConfig({key,direction}); }}>
          <option value="created_at:desc">Date entrée ↓</option>
          <option value="rendement_brut:desc">Rendement brut ↓</option>
          <option value="cashflow_estime:desc">Cash-flow ↓</option>
          <option value="cout_total:desc">Coût total ↓</option>
          <option value="date_relance:asc">Date relance ↑</option>
        </select>
        <button className="inv-btn inv-btn-danger inv-btn-sm"
          onClick={() => { setSpecialFilter("a_relancer"); setSortConfig({key:"date_relance", direction:"asc"}); }}>
          <Icon as={Bell} size={12} strokeWidth={2.2}/> Voir à relancer
        </button>
        <button className="inv-btn inv-btn-out inv-btn-sm" onClick={() => { setFiltreStatut(""); setFiltreVille(""); setSpecialFilter(""); setSearch(""); setSortConfig({key:"created_at", direction:"desc"}); }}>
          <Icon as={X} size={12} strokeWidth={2.2}/> Réinitialiser
        </button>
      </div>

      {/* Liste */}
      {loading ? (
        <div style={{ textAlign:"center", padding:`${SPACING.xl}px 0`, color:T.textMuted, display:"flex", justifyContent:"center", alignItems:"center", gap:8 }}>
          <Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>
          Chargement…
        </div>
      ) : (
        <div style={{ background:T.card, borderRadius:RADIUS.xl, border:`1px solid ${T.border}`, overflowX:"auto", boxShadow:T.shadowSm }}>
          <div style={{minWidth:1180}}>
            <div style={{
              display:"grid", gridTemplateColumns:gridCols, gap:10,
              padding:`${SPACING.md-2}px ${SPACING.lg}px`, background:T.sectionHd,
              borderBottom:`1px solid ${T.border}`, fontSize:FONT.xs.size-1, fontWeight:700,
              color:T.textMuted, textTransform:"uppercase", letterSpacing:0.8,
            }}>
              <SortableHeader label="Date entrée" sortKey="created_at" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Bien" sortKey="adresse" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Statut" sortKey="statut" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Coût total" sortKey="cout_total" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Rendement" sortKey="rendement_brut" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Cash-flow" sortKey="cashflow_estime" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Relance" sortKey="date_relance" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <div/>
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
                  display:"grid", gridTemplateColumns:gridCols, gap:10,
                  padding:`${SPACING.md+2}px ${SPACING.lg}px`,
                  borderBottom:`1px solid ${T.rowBorder}`, alignItems:"center",
                  cursor:"pointer", transition:"background .12s",
                }}
                  onMouseEnter={e=>e.currentTarget.style.background=T.cardHover}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                  onClick={() => setFicheId(b.id)}>
                  <div style={{ fontSize:FONT.sm.size, color:T.textMuted }}>{fmtDate(b.created_at)}</div>
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
                    {b.rendement_brut > 0 ? Number(b.rendement_brut).toFixed(1)+"%" : "—"}
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
    latitude: bien?.latitude||"", longitude: bien?.longitude||"",
    commentaire: bien?.commentaire||"", interlocuteur: bien?.interlocuteur||"",
    telephone_interlocuteur: bien?.telephone_interlocuteur||"", agence: bien?.agence||"",
    lien_annonce: bien?.lien_annonce||"", lien_drive: bien?.lien_drive||"", lien_rentabilite: bien?.lien_rentabilite||"",
    statut: bien?.statut||"À analyser", prix_vente: bien?.prix_vente||0, prix_travaux: bien?.prix_travaux||0,
    cout_total: bien?.cout_total||0, rendement_brut: bien?.rendement_brut||0, cashflow_estime: bien?.cashflow_estime||0,
    montant_offre: bien?.montant_offre||0,
    date_relance: bien?.date_relance||"", statut_relance: bien?.statut_relance||"",
    date_visite: bien?.date_visite||"",
    reference_interne: bien?.reference_interne||"", conseiller_profero: bien?.conseiller_profero||"", source_bien: bien?.source_bien||"",
  });
  const [saving, setSaving] = useState(false);

  // Auto-calcul coût total
  useEffect(() => {
    const ct = (parseFloat(form.prix_vente)||0) + (parseFloat(form.prix_travaux)||0);
    if (ct > 0) setForm(f => ({ ...f, cout_total: ct }));
  }, [form.prix_vente, form.prix_travaux]);

  const sauvegarder = async () => {
    setSaving(true);
    const fullAddress = [form.adresse, form.code_postal, form.ville].filter(Boolean).join(", ").trim();
    const previousAddress = getBienGoogleAddress(bien || {});
    const geocoded = fullAddress ? await getCoordinatesFromAddress(fullAddress) : null;
    const coords = resolveCoordinatesFromGeocode(geocoded, bien, fullAddress, previousAddress);

    const payload = {
      adresse:                 form.adresse?.trim() || null,
      ville:                   form.ville?.trim() || null,
      code_postal:             form.code_postal?.trim() || null,
      latitude:                coords.lat,
      longitude:               coords.lng,
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
      reference_interne:       form.reference_interne?.trim() || null,
      conseiller_profero:      form.conseiller_profero?.trim() || null,
      source_bien:             form.source_bien || null,
    };
    const write = async (p) => isEdit
      ? await supabase.from("invest_biens").update(p).eq("id", bien.id)
      : await supabase.from("invest_biens").insert(p);
    let { error } = await write(payload);
    if (error && (error.code === "42703" || error.code === "PGRST204" || String(error.message||"").includes("latitude") || String(error.message||"").includes("longitude"))) {
      const { latitude, longitude, ...fallbackPayload } = payload;
      const retry = await write(fallbackPayload);
      error = retry.error;
      if (!error) console.warn("Colonnes latitude/longitude absentes. Lancez la migration SQL pour activer la carte.");
    }
    if (error) { console.error("Erreur bien:", error); alert("Erreur : " + error.message); }
    setSaving(false);
    if (!error) onSave();
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 }}>
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, padding:"28px 30px", width:"90%", maxWidth:720, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 30px 80px rgba(0,0,0,.5)" }}>
        <div style={{ fontSize:17, fontWeight:800, color:T.text, marginBottom:20 }}>{isEdit ? "Modifier le bien" : "Nouveau bien"}</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 16px" }}>
          <div style={{ marginBottom:12, gridColumn: "1 / 3" }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Adresse</label><InpText value={form.adresse} onChange={e=>setForm({...form,adresse:e.target.value})} placeholder="123 rue de la Paix"/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Ville</label><InpText value={form.ville} onChange={e=>setForm({...form,ville:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Code postal</label><InpText value={form.code_postal} onChange={e=>setForm({...form,code_postal:e.target.value})}/></div>
          <div style={{ marginBottom:12, gridColumn:"1 / 3", padding:"9px 11px", borderRadius:RADIUS.md, background:T.accentBg, border:`1px solid ${T.accentBorder}`, color:T.accent, fontSize:FONT.sm.size }}>
            📍 La latitude et la longitude seront calculées automatiquement à partir de l'adresse lors de l'enregistrement, puis le bien apparaîtra sur la Maps.
          </div>
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
          <div style={{ marginBottom:12, gridColumn: "1 / 3" }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Lien annonce</label><InpText value={form.lien_annonce} onChange={e=>setForm({...form,lien_annonce:e.target.value})} placeholder="https://…"/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Lien Drive</label><InpText value={form.lien_drive} onChange={e=>setForm({...form,lien_drive:e.target.value})} placeholder="https://…"/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Lien dossier rentabilité</label><InpText value={form.lien_rentabilite} onChange={e=>setForm({...form,lien_rentabilite:e.target.value})} placeholder="https://…"/></div>
          <div style={{ marginBottom:12, gridColumn: "1 / 3" }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Commentaire</label><textarea className="inv-textarea" rows={3} value={form.commentaire} onChange={e=>setForm({...form,commentaire:e.target.value})}/></div>
        </div>
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
          <button className="inv-btn inv-btn-out" onClick={onClose}>Annuler</button>
          <button className="inv-btn inv-btn-gold" onClick={sauvegarder} disabled={saving}>{saving?"Enregistrement…":"Enregistrer"}</button>
        </div>
      </div>
    </div>
  );
}


// ─── FICHE VISITE BIEN ────────────────────────────────────────────────────────
const VISITE_STATUS = ["", "OK", "À vérifier", "Problème"];
const YES_NO = ["", "Oui", "Non"];
const COMPLEXITE_VISITE = ["", "Simple", "Moyenne", "Complexe"];
const RECO_VISITE = ["", "Passer à l'offre", "Approfondir", "Abandonner"];
const SOURCES_BIEN_VISITE = ["", "LBC", "Agent", "Réseau", "Autre"];
const MANDATS_VISITE = ["", "Exclusif", "Simple"];
const TENSION_LOCATIVE = ["", "Faible", "Moyenne", "Forte"];
const LETTRES_DPE = ["", "A", "B", "C", "D", "E", "F", "G"];
const TYPES_LOT_VISITE = ["", "Studio", "T1", "T2", "T3", "T4", "T5", "T6", "Commerce"];

const TYPE_BIEN_VISITE = ["", "Immeuble de rapport", "Maison", "Appartement", "Local commercial", "Mixte habitation / commerce", "Terrain", "Autre"];
const NIVEAUX_BIEN_VISITE = ["", "RDC uniquement", "R+1", "R+2", "R+3", "R+4", "R+5 et plus", "À vérifier"];
const DELAI_VENTE_VISITE = ["", "Très court (< 7 jours)", "Court (1 à 3 semaines)", "Moyen (1 à 2 mois)", "Long (> 2 mois)", "À vérifier"];
const EXPOSITION_ANNONCE_VISITE = ["", "Nouvelle annonce", "Moins de 15 jours", "15 à 30 jours", "1 à 3 mois", "+3 mois", "À vérifier"];
const COMPTEUR_NOMBRE_VISITE = ["", "0", "1", "2", "3", "4", "5", "6+", "À vérifier"];
const DUREE_CHANTIER_VISITE = ["", "< 1 mois", "1 à 2 mois", "2 à 4 mois", "4 à 6 mois", "+6 mois", "À vérifier"];
const DELAI_RELOCATION_VISITE = ["", "< 7 jours", "1 à 2 semaines", "2 à 4 semaines", "+1 mois", "À vérifier"];
const VACANCE_LOCATIVE_VISITE = ["", "Quasi nulle", "< 2 semaines/an", "2 à 4 semaines/an", "+1 mois/an", "À vérifier"];
const FISCALITE_VISITE = ["", "LMNP réel", "SCI IS", "SCI IR", "Location nue", "À arbitrer avec fiscaliste", "À vérifier"];
const PROFILS_LOCATAIRES_VISITE = ["", "Étudiants", "Jeunes actifs", "Familles", "Couples", "Professionnels / mobilité", "Colocation", "Mixte", "À vérifier"];
const STRATEGIE_LOCATIVE_VISITE = ["", "Location meublée", "Location nue", "Colocation", "Mixte meublé / nu", "Courte durée", "Commerce / professionnel", "À approfondir"];
const PROCHAINE_ETAPE_VISITE = ["", "Faire une offre", "Demander documents complémentaires", "Contacter urbanisme", "Faire devis travaux", "Lancer simulation financière", "Organiser contre-visite", "Abandonner"];
const DUREE_REMBOURSEMENT_VISITE = ["", "15 ans", "20 ans", "25 ans", "30 ans", "À simuler"];

const TECHNIQUE_VISITE_GROUPS = [
  { title:"Gros œuvre", key:"gros_oeuvre", items:[
    ["toiture","État de la toiture"],["charpente","État de la charpente"],["facades","État des façades / ravalement"],
    ["murs_porteurs","État des murs porteurs"],["humidite","Présence d'humidité / moisissures"],
    ["amiante_plomb","Présence d'amiante / plomb (DDT)"],["planchers_dalles","État des planchers / dalles"],
    ["fondations","État des fondations"],["fissures_structurelles","Présence de fissures structurelles"],
  ]},
  { title:"Menuiseries & Isolation", key:"menuiseries_isolation", items:[
    ["type_vitrage","Type de vitrage"],["fenetres_portes_fenetres","État des fenêtres et portes-fenêtres"],
    ["volets","État des volets"],["isolation_combles","Isolation des combles"],["isolation_murs","Isolation des murs"],
    ["isolation_sol","Isolation du sol"],["porte_entree","Type de porte d'entrée"],
  ]},
  { title:"Électricité", key:"electricite", items:[
    ["tableau_electrique","Tableau électrique"],["terre","Mise à la terre"],["differentiels","Disjoncteurs différentiels"],
    ["cablage","Type de câblage"],["compteurs_individuels","Présence de compteurs individuels"],
    ["puissance_kva","Puissance disponible (kVA)"],["vmc","Présence de VMC"],["interphonie","Système d'interphonie"],
  ]},
  { title:"Plomberie & Eau", key:"plomberie_eau", items:[
    ["canalisations","Type de canalisations"],["plomberie_generale","État de la plomberie générale"],
    ["compteurs_lots","Compteurs individuels par lot"],["chauffe_eau","Chauffe-eau"],
    ["colonnes_montantes","Présence de colonnes montantes"],["evacuations","État des évacuations"],
    ["wc_sdb_par_lot","Présence WC / SDB possible par lot"],
  ]},
  { title:"Chauffage", key:"chauffage", items:[
    ["type_chauffage","Type de chauffage"],["chaudiere","Chaudière collective ou individuelle"],
    ["age_systeme","État et âge du système de chauffage"],["chauffage_individuel","Possibilité de chauffage individuel par lot"],
    ["radiateurs","Radiateurs"],["plancher_chauffant","Plancher chauffant"],
  ]},
];

const URBANISME_VISITE_ITEMS = [
  ["zone_plu","Zone PLU"],["zone_abf","Bien en zone ABF"],["permis_requis","Permis de construire requis pour la découpe"],
  ["dp_suffisante","Déclaration préalable suffisante"],["stationnement","Règles de stationnement"],
  ["division_logement","Règles locales de division de logement"],["servitudes","Servitudes existantes"],
  ["risques_naturels","Risques naturels"],["cadastre","Cadastre / plan de masse disponible"],
  ["copropriete","Régime de copropriété"],["reglement_copro","Règlement de copropriété autorisant la division"],
  ["syndic_charges","Syndic / charges de copropriété"],
];

const RISQUES_VISITE_ITEMS = [
  ["structurel","Risque structurel"],["amiante_plomb","Risque amiante / plomb non traité"],["refus_bancaire","Risque de refus bancaire"],
  ["refus_urbanisme","Risque de refus permis / déclaration"],["depassement_travaux","Risque de dépassement budget travaux"],
  ["delai_chantier","Risque de délai chantier"],["vacance","Risque de vacance locative élevée"],
  ["fiscal","Risque fiscal"],["contentieux_copro","Risque de contentieux copropriété"],
  ["voisinage","Risque de voisinage / nuisances"],["motivation_vendeur","Motivation vendeur"],
  ["titre_propriete","Qualité du titre de propriété"],
];

const makeAuditDefaults = (groupsOrItems) => {
  const entries = Array.isArray(groupsOrItems?.[0])
    ? groupsOrItems
    : groupsOrItems.flatMap(g => g.items);
  return entries.reduce((acc, [key]) => ({ ...acc, [key]: { statut:"", commentaire:"" } }), {});
};

const emptyLotCible = (i = 0) => ({
  numero: String(i + 1), type:"", surface:"", loyer:"", meuble:"", stationnement:"",
});
const emptyLotsCibles = (count = 1) => Array.from({length:Math.max(1, count)}, (_,i)=>emptyLotCible(i));

const deepMergeVisite = (base, extra) => {
  if (Array.isArray(base)) return Array.isArray(extra) ? extra : base;
  if (!base || typeof base !== "object") return extra !== undefined && extra !== null ? extra : base;
  const out = { ...base };
  Object.keys(extra || {}).forEach(k => {
    out[k] = deepMergeVisite(base[k], extra[k]);
  });
  return out;
};

const buildDefaultVisiteData = (bien = {}) => ({
  identification: {
    adresse: bien.adresse || "", ville: bien.ville || "", code_postal: bien.code_postal || "",
    latitude: bien.latitude ?? "", longitude: bien.longitude ?? "",
    conseiller_profero: bien.conseiller_profero || "", date_visite: bien.date_visite || "",
    source: bien.source_bien || "", reference_interne: bien.reference_interne || "",
  },
  general: {
    type_bien:"", annee_construction:"", surface_totale:"", nombre_niveaux:"",
    lots_actuels:"", lots_cibles:"", prix_affiche: bien.prix_vente || "",
    mandat:"", agence_vendeur: bien.agence || "", delai_vente_estime:"", duree_exposition_annonce:"",
  },
  configuration: {
    escaliers_interieurs:"", acces_independants:"", compteurs_eau:"", compteurs_gaz:"", compteurs_electricite:"",
    lots: emptyLotsCibles(1),
  },
  technique: makeAuditDefaults(TECHNIQUE_VISITE_GROUPS),
  dpe: {
    dpe_actuel:"", ges_actuel:"", conso_energie:"", emissions_co2:"", dpe_cible:"",
    audit_disponible:"", passoires_identifiees:"", travaux_energetiques:"",
  },
  urbanisme: {
    controles: makeAuditDefaults(URBANISME_VISITE_ITEMS),
    contact_mairie:"", observations:"", autorisations:"", duree_chantier:"",
    complexite:"", vigilance_travaux:"",
  },
  finance: {
    prix_acquisition_negocie:"", frais_notaire:"", frais_agence:"", frais_profero:"", budget_travaux_ttc:"",
    mobilier:"", frais_financement:"", divers_fonds_roulement:"",
    taux_vacance:"", loyers_nets_vacance:"", charges_annuelles:"", loyers_nets_charges:"",
    rendement_brut:"", rendement_net:"", cashflow_mensuel:"", duree_remboursement:"", plus_value_potentielle:"",
  },
  marche: {
    tension_locative:"", delai_relocation:"", loyer_moyen_m2:"", colocation_possible:"",
    meuble_pertinente:"", nue_pertinente:"", regime_fiscal:"", vacance_moyenne:"",
    profil_locataires:"", concurrence:"", points_forts:"", points_faibles:"",
  },
  risques: {
    controles: makeAuditDefaults(RISQUES_VISITE_ITEMS),
    points_negociation:"", marge_negociation:"", conditions_suspensives:"", observations_libres:"",
  },
  conclusion: {
    note_globale:"", recommandation:"", prix_offre_recommande:"", strategie_locative:"",
    fiscalite_recommandee:"", prochaine_etape:"", commentaire_conseiller:"",
  },
});

const normaliseVisiteData = (bien = {}) => {
  const merged = deepMergeVisite(buildDefaultVisiteData(bien), bien.visite_data || {});
  const existingLots = Array.isArray(merged.configuration?.lots) ? merged.configuration.lots : [];
  const countFromGeneral = parseInt(merged.general?.lots_cibles, 10);
  const baseCount = existingLots.length || (Number.isFinite(countFromGeneral) && countFromGeneral > 0 ? countFromGeneral : 1);
  merged.configuration.lots = emptyLotsCibles(baseCount).map((baseLot, i) => ({
    ...baseLot,
    ...(existingLots[i] || {}),
    numero: existingLots[i]?.numero || String(i + 1),
  }));
  if (!merged.general.lots_cibles) merged.general.lots_cibles = String(merged.configuration.lots.length);
  return merged;
};

const numVal = (v) => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

function MiniField({ label, value, onChange, type="text", options, textarea=false, readOnly=false, required=false, helper="", T=THEMES_INV.dark }) {
  const isMissing = required && !readOnly && (value === null || value === undefined || String(value).trim() === "");
  const commonStyle = {
    width:"100%",
    textAlign:type==="number" ? "right" : "left",
    opacity:readOnly ? .8 : 1,
    borderColor:isMissing ? SEMANTIC.warning.border : undefined,
    background:isMissing ? SEMANTIC.warning.bg : undefined,
  };
  return (
    <div style={{ marginBottom:10 }}>
      <label style={{ fontSize:10, fontWeight:800, color:isMissing ? WA : T.textMuted, textTransform:"uppercase", letterSpacing:1, display:"block", marginBottom:5 }}>
        {label}{required && !readOnly ? <span style={{color:WA}}> •</span> : null}
      </label>
      {textarea ? (
        <textarea className="inv-textarea" rows={3} value={value || ""} readOnly={readOnly} onChange={e=>onChange(e.target.value)} style={commonStyle} />
      ) : options ? (
        <select className="inv-sel" value={value || ""} disabled={readOnly} onChange={e=>onChange(e.target.value)} style={{ width:"100%", ...commonStyle }}>
          {options.map(o => <option key={o} value={o}>{o || "Sélectionner"}</option>)}
        </select>
      ) : (
        <input className="inv-inp" type={type} value={value ?? ""} readOnly={readOnly} onChange={e=>onChange(e.target.value)} style={commonStyle} />
      )}
      {(helper || isMissing) && (
        <div style={{fontSize:FONT.xs.size, color:isMissing ? WA : T.textMuted, marginTop:4, lineHeight:1.35}}>
          {isMissing ? "Réponse à compléter pour une fiche complète" : helper}
        </div>
      )}
    </div>
  );
}

function VisitSection({ title, icon, children, T=THEMES_INV.dark }) {
  return (
    <div style={{ border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, overflow:"hidden", marginBottom:14, background:T.input }}>
      <div style={{ padding:`${SPACING.sm}px ${SPACING.md}px`, background:T.sectionHd, color:T.accent, fontSize:FONT.xs.size, fontWeight:900, textTransform:"uppercase", letterSpacing:1.3, display:"flex", alignItems:"center", gap:6 }}>
        {icon && <Icon as={icon} size={13} strokeWidth={2.2}/>}
        {title}
      </div>
      <div style={{ padding:SPACING.md }}>{children}</div>
    </div>
  );
}

function AuditRows({ items, values, onChange, T=THEMES_INV.dark }) {
  const issueStatuses = ["À vérifier", "Problème"];
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
      {items.map(([key,label]) => {
        const row = values?.[key] || { statut:"", commentaire:"" };
        const commentRequired = issueStatuses.includes(row.statut || "");
        const missingStatus = !row.statut;
        const missingComment = commentRequired && !String(row.commentaire || "").trim();
        return (
          <div key={key} style={{ display:"grid", gridTemplateColumns:"1.15fr 120px 1.45fr", gap:8, alignItems:"start", padding:missingStatus || missingComment ? "6px" : 0, borderRadius:RADIUS.md, background:missingStatus || missingComment ? SEMANTIC.warning.bg : "transparent", border:missingStatus || missingComment ? `1px solid ${SEMANTIC.warning.border}` : "1px solid transparent" }}>
            <div style={{ fontSize:FONT.sm.size, color:T.textSub, fontWeight:700, paddingTop:6 }}>{label} <span style={{color:WA}}>•</span></div>
            <select className="inv-sel" value={row.statut || ""} onChange={e=>onChange(key, "statut", e.target.value)} style={{ width:"100%", fontSize:FONT.xs.size+1, padding:"5px 7px" }}>
              {VISITE_STATUS.map(s => <option key={s} value={s}>{s || "Sélectionner"}</option>)}
            </select>
            <div>
              <input className="inv-inp" value={row.commentaire || ""} placeholder={commentRequired ? "Commentaire à compléter…" : "Commentaire utile si besoin…"} onChange={e=>onChange(key, "commentaire", e.target.value)} style={{ width:"100%", textAlign:"left", fontSize:FONT.xs.size+1, padding:"5px 7px", borderColor:missingComment ? SEMANTIC.warning.border : undefined, background:missingComment ? SEMANTIC.warning.bg : undefined }}/>
              {missingComment && <div style={{fontSize:FONT.xs.size, color:WA, marginTop:3}}>Commentaire conseillé pour préciser le point à vérifier ou le problème identifié</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const FicheVisiteBien = React.forwardRef(function FicheVisiteBien({ bien, profil, T=THEMES_INV.dark, onSaved, onSaveStateChange }, ref) {
  const [data, setData] = useState(() => normaliseVisiteData(bien));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [visitStep, setVisitStep] = useState(0);
  const autoSaveTimerRef = useRef(null);
  const autoSaveBootRef = useRef(true);
  const dirtyRef = useRef(false);
  const latestDataRef = useRef(data);

  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveBootRef.current = true;
    const nextData = normaliseVisiteData(bien);
    latestDataRef.current = nextData;
    dirtyRef.current = false;
    setData(nextData);
    setVisitStep(0);
  }, [bien?.id]);
  useEffect(() => { latestDataRef.current = data; }, [data]);
  useEffect(() => { if (onSaveStateChange) onSaveStateChange({ saving, saved }); }, [saving, saved, onSaveStateChange]);

  const markDirtyData = (next) => { latestDataRef.current = next; dirtyRef.current = true; return next; };
  const upd = (section, key, value) => setData(prev => markDirtyData({ ...prev, [section]: { ...prev[section], [key]: value } }));
  const updControl = (section, key, field, value) => setData(prev => markDirtyData({ ...prev, [section]: { ...prev[section], controles: { ...prev[section]?.controles, [key]: { ...prev[section]?.controles?.[key], [field]: value } } } }));
  const updLot = (idx, key, value) => setData(prev => {
    const lots = [...(prev.configuration?.lots || emptyLotsCibles(1))];
    lots[idx] = { ...emptyLotCible(idx), ...lots[idx], [key]: value };
    return markDirtyData({ ...prev, configuration: { ...prev.configuration, lots } });
  });
  const addLotVisite = () => setData(prev => {
    const currentLots = prev.configuration?.lots || emptyLotsCibles(1);
    const lots = [...currentLots, emptyLotCible(currentLots.length)];
    return markDirtyData({
      ...prev,
      general: { ...prev.general, lots_cibles: String(lots.length) },
      configuration: { ...prev.configuration, lots },
    });
  });
  const removeLotVisite = (idx) => setData(prev => {
    const currentLots = prev.configuration?.lots || emptyLotsCibles(1);
    if (currentLots.length <= 1) return prev;
    const lots = currentLots.filter((_, i) => i !== idx).map((lot, i) => ({ ...lot, numero: String(i + 1) }));
    return markDirtyData({
      ...prev,
      general: { ...prev.general, lots_cibles: String(lots.length) },
      configuration: { ...prev.configuration, lots },
    });
  });

  const lots = data.configuration?.lots || [];
  const totalLoyersMensuels = lots.reduce((s,l)=>s+numVal(l.loyer),0);
  const totalLoyersAnnuels = totalLoyersMensuels * 12;
  const fin = data.finance || {};
  const coutOperation =
    numVal(fin.prix_acquisition_negocie) + numVal(fin.frais_notaire) + numVal(fin.frais_agence) +
    numVal(fin.frais_profero) + numVal(fin.budget_travaux_ttc) + numVal(fin.mobilier) +
    numVal(fin.frais_financement) + numVal(fin.divers_fonds_roulement);
  const loyersNetsVacance = totalLoyersAnnuels * (1 - (numVal(fin.taux_vacance) / 100));
  const loyersNetsCharges = loyersNetsVacance - numVal(fin.charges_annuelles);
  const rendementBrut = coutOperation > 0 ? (totalLoyersAnnuels / coutOperation) * 100 : 0;
  const rendementNet = coutOperation > 0 ? (loyersNetsCharges / coutOperation) * 100 : 0;

  const filled = (v) => v !== null && v !== undefined && String(v).trim() !== "";
  const allTechniqueItems = TECHNIQUE_VISITE_GROUPS.flatMap(g => g.items);
  const issueStatuses = ["À vérifier", "Problème"];
  const targetLotsCount = Math.max(1, (lots || []).length || numVal(data.general?.lots_cibles) || 1);
  const isLotComplete = (lot) => filled(lot?.type) && filled(lot?.surface) && filled(lot?.loyer) && filled(lot?.meuble) && filled(lot?.stationnement);
  const countLots = (lots || []).filter(isLotComplete).length;
  const item = (label, done) => ({ label, done: !!done });
  const fieldItem = (label, obj, key) => item(label, filled(obj?.[key]));
  const auditItems = (title, values, items) => items.flatMap(([key,label]) => {
    const row = values?.[key] || {};
    const base = [item(`${title} — ${label}`, filled(row.statut))];
    if (issueStatuses.includes(row.statut || "")) {
      base.push(item(`${title} — commentaire ${label}`, filled(row.commentaire)));
    }
    return base;
  });
  const lotsChecklist = Array.from({length:targetLotsCount}, (_,i) => {
    const lot = lots?.[i] || {};
    return [
      item(`Lot ${i+1} — type`, filled(lot.type)),
      item(`Lot ${i+1} — surface`, filled(lot.surface)),
      item(`Lot ${i+1} — loyer cible`, filled(lot.loyer)),
      item(`Lot ${i+1} — meublé ou nu`, filled(lot.meuble)),
      item(`Lot ${i+1} — stationnement`, filled(lot.stationnement)),
    ];
  }).flat();
  const getStepChecklist = (idx) => {
    switch (idx) {
      case 0:
        return [
          fieldItem("Conseiller Profero", data.identification, "conseiller_profero"),
          fieldItem("Adresse complète", data.identification, "adresse"),
          fieldItem("Ville", data.identification, "ville"),
          fieldItem("Code postal", data.identification, "code_postal"),
          fieldItem("Date de visite", data.identification, "date_visite"),
          fieldItem("Source", data.identification, "source"),
          fieldItem("Type de bien", data.general, "type_bien"),
          fieldItem("Année de construction", data.general, "annee_construction"),
          fieldItem("Surface totale", data.general, "surface_totale"),
          fieldItem("Nombre de niveaux", data.general, "nombre_niveaux"),
          fieldItem("Nombre de lots actuels", data.general, "lots_actuels"),
          fieldItem("Nombre de lots cibles", data.general, "lots_cibles"),
          fieldItem("Prix affiché", data.general, "prix_affiche"),
          fieldItem("Mandat", data.general, "mandat"),
          fieldItem("Agence / vendeur", data.general, "agence_vendeur"),
          fieldItem("Délai de vente estimé", data.general, "delai_vente_estime"),
          fieldItem("Durée d’exposition de l’annonce", data.general, "duree_exposition_annonce"),
        ];
      case 1:
        return [
          fieldItem("Présence d’escaliers intérieurs", data.configuration, "escaliers_interieurs"),
          fieldItem("Accès indépendants existants", data.configuration, "acces_independants"),
          fieldItem("Nombre de compteurs eau", data.configuration, "compteurs_eau"),
          fieldItem("Nombre de compteurs gaz", data.configuration, "compteurs_gaz"),
          fieldItem("Nombre de compteurs électricité", data.configuration, "compteurs_electricite"),
          ...lotsChecklist,
        ];
      case 2:
        return TECHNIQUE_VISITE_GROUPS.flatMap(g => auditItems(g.title, data.technique, g.items));
      case 3:
        return [
          fieldItem("DPE actuel", data.dpe, "dpe_actuel"),
          fieldItem("GES actuel", data.dpe, "ges_actuel"),
          fieldItem("Consommation énergie", data.dpe, "conso_energie"),
          fieldItem("Émissions CO2", data.dpe, "emissions_co2"),
          fieldItem("DPE cible", data.dpe, "dpe_cible"),
          fieldItem("Audit énergétique disponible", data.dpe, "audit_disponible"),
          fieldItem("Passoires identifiées", data.dpe, "passoires_identifiees"),
          fieldItem("Travaux énergétiques envisagés", data.dpe, "travaux_energetiques"),
          ...auditItems("Urbanisme", data.urbanisme?.controles, URBANISME_VISITE_ITEMS),
          fieldItem("Contact mairie / urbanisme consulté", data.urbanisme, "contact_mairie"),
          fieldItem("Observations réglementaires", data.urbanisme, "observations"),
          fieldItem("Autorisations préalables", data.urbanisme, "autorisations"),
          fieldItem("Durée prévisionnelle du chantier", data.urbanisme, "duree_chantier"),
          fieldItem("Complexité estimée", data.urbanisme, "complexite"),
          fieldItem("Points de vigilance travaux", data.urbanisme, "vigilance_travaux"),
        ];
      case 4:
        return [
          fieldItem("Prix acquisition négocié", data.finance, "prix_acquisition_negocie"),
          fieldItem("Frais de notaire", data.finance, "frais_notaire"),
          fieldItem("Frais d’agence", data.finance, "frais_agence"),
          fieldItem("Frais Profero Invest", data.finance, "frais_profero"),
          fieldItem("Budget travaux TTC", data.finance, "budget_travaux_ttc"),
          fieldItem("Mobilier", data.finance, "mobilier"),
          fieldItem("Frais financement / garantie", data.finance, "frais_financement"),
          fieldItem("Divers / fonds de roulement", data.finance, "divers_fonds_roulement"),
          fieldItem("Taux de vacance", data.finance, "taux_vacance"),
          fieldItem("Charges annuelles", data.finance, "charges_annuelles"),
          fieldItem("Cash-flow mensuel", data.finance, "cashflow_mensuel"),
          fieldItem("Durée de remboursement", data.finance, "duree_remboursement"),
          fieldItem("Plus-value potentielle", data.finance, "plus_value_potentielle"),
        ];
      case 5:
        return [
          fieldItem("Tension locative", data.marche, "tension_locative"),
          fieldItem("Délai de relocation", data.marche, "delai_relocation"),
          fieldItem("Loyer moyen secteur", data.marche, "loyer_moyen_m2"),
          fieldItem("Colocation possible", data.marche, "colocation_possible"),
          fieldItem("Location meublée pertinente", data.marche, "meuble_pertinente"),
          fieldItem("Location nue pertinente", data.marche, "nue_pertinente"),
          fieldItem("Régime fiscal adapté", data.marche, "regime_fiscal"),
          fieldItem("Durée moyenne de vacance", data.marche, "vacance_moyenne"),
          fieldItem("Profil locataires cibles", data.marche, "profil_locataires"),
          fieldItem("Concurrence directe", data.marche, "concurrence"),
          fieldItem("Points forts du secteur", data.marche, "points_forts"),
          fieldItem("Points faibles / risques secteur", data.marche, "points_faibles"),
          ...auditItems("Risques", data.risques?.controles, RISQUES_VISITE_ITEMS),
          fieldItem("Marge de négociation", data.risques, "marge_negociation"),
          fieldItem("Points de négociation", data.risques, "points_negociation"),
          fieldItem("Conditions suspensives", data.risques, "conditions_suspensives"),
          fieldItem("Observations libres", data.risques, "observations_libres"),
        ];
      default:
        return [
          fieldItem("Note globale", data.conclusion, "note_globale"),
          fieldItem("Recommandation", data.conclusion, "recommandation"),
          fieldItem("Prix d’offre recommandé", data.conclusion, "prix_offre_recommande"),
          fieldItem("Stratégie locative", data.conclusion, "strategie_locative"),
          fieldItem("Fiscalité recommandée", data.conclusion, "fiscalite_recommandee"),
          fieldItem("Prochaine étape", data.conclusion, "prochaine_etape"),
          fieldItem("Commentaire conseiller", data.conclusion, "commentaire_conseiller"),
        ];
    }
  };
  const stepScores = Array.from({length:7}, (_,i) => {
    const list = getStepChecklist(i);
    return { done:list.filter(x=>x.done).length, total:list.length || 1 };
  });
  const pct = (i) => Math.min(100, Math.round((stepScores[i].done / Math.max(stepScores[i].total, 1)) * 100));
  const globalDone = stepScores.reduce((s,x)=>s+x.done,0);
  const globalTotal = stepScores.reduce((s,x)=>s+x.total,0);
  const globalPct = Math.min(100, Math.round((globalDone / Math.max(globalTotal,1)) * 100));
  const stepCompleted = (i) => getStepChecklist(i).every(x => x.done);
  const currentMissing = getStepChecklist(visitStep).filter(x => !x.done).map(x => x.label);
  const currentStepComplete = currentMissing.length === 0;
  const canReachStep = () => true;


  const sauvegarder = async (options = {}) => {
    const { refresh = true, dataOverride = null, silent = false } = options;
    const dataToSave = dataOverride || latestDataRef.current || data;
    if (!bien?.id) return false;
    if (!silent) { setSaving(true); setError(""); }
    const fullAddress = [dataToSave.identification?.adresse, dataToSave.identification?.code_postal, dataToSave.identification?.ville].filter(Boolean).join(", ").trim();
    const lotsToSave = dataToSave.configuration?.lots || [];
    const totalLoyersMensuelsSave = lotsToSave.reduce((s,l)=>s+numVal(l.loyer),0);
    const totalLoyersAnnuelsSave = totalLoyersMensuelsSave * 12;
    const finToSave = dataToSave.finance || {};
    const coutOperationSave =
      numVal(finToSave.prix_acquisition_negocie) + numVal(finToSave.frais_notaire) + numVal(finToSave.frais_agence) +
      numVal(finToSave.frais_profero) + numVal(finToSave.budget_travaux_ttc) + numVal(finToSave.mobilier) +
      numVal(finToSave.frais_financement) + numVal(finToSave.divers_fonds_roulement);
    const loyersNetsVacanceSave = totalLoyersAnnuelsSave * (1 - (numVal(finToSave.taux_vacance) / 100));
    const loyersNetsChargesSave = loyersNetsVacanceSave - numVal(finToSave.charges_annuelles);
    const rendementBrutSave = coutOperationSave > 0 ? (totalLoyersAnnuelsSave / coutOperationSave) * 100 : 0;
    const rendementNetSave = coutOperationSave > 0 ? (loyersNetsChargesSave / coutOperationSave) * 100 : 0;
    const previousAddress = getBienGoogleAddress(bien || {});
    const geocoded = fullAddress ? await getCoordinatesFromAddress(fullAddress) : null;
    const coords = resolveCoordinatesFromGeocode(geocoded, bien, fullAddress, previousAddress);

    const visiteData = {
      ...dataToSave,
      identification: {
        ...dataToSave.identification,
        latitude: coords.lat ?? "",
        longitude: coords.lng ?? "",
        geocoded_address: geocoded?.formatted_address || fullAddress || "",
        geocoding_status: geocoded?.error ? `Erreur : ${geocoded.error}` : (fullAddress ? "Adresse géolocalisée" : "Adresse non renseignée"),
        reference_interne: bien.reference_interne || dataToSave.identification?.reference_interne || "",
        total_loyers_mensuels_cibles: totalLoyersMensuelsSave,
        total_loyers_annuels_cibles: totalLoyersAnnuelsSave,
      },
      finance: {
        ...dataToSave.finance,
        cout_total_operation_calcule: coutOperationSave,
        loyers_bruts_mensuels: totalLoyersMensuelsSave,
        loyers_bruts_annuels: totalLoyersAnnuelsSave,
        loyers_nets_vacance_calcule: Math.round(loyersNetsVacanceSave),
        loyers_nets_charges_calcule: Math.round(loyersNetsChargesSave),
        rendement_brut_calcule: Number(rendementBrutSave.toFixed(2)),
        rendement_net_calcule: Number(rendementNetSave.toFixed(2)),
      },
    };
    visiteData.simulateur = syncSimulateurFromVisiteData(visiteData, bien);
    visiteData.simulateur_updated_at = new Date().toISOString();

    const payload = {
      adresse: dataToSave.identification?.adresse?.trim() || null,
      ville: dataToSave.identification?.ville?.trim() || null,
      code_postal: dataToSave.identification?.code_postal?.trim() || null,
      latitude: coords.lat,
      longitude: coords.lng,
      date_visite: dataToSave.identification?.date_visite || null,
      conseiller_profero: dataToSave.identification?.conseiller_profero?.trim() || profil?.nom || null,
      source_bien: dataToSave.identification?.source || null,
      visite_data: visiteData,
    };

    const { error } = await supabase.from("invest_biens").update(payload).eq("id", bien.id);
    if (!silent) setSaving(false);
    if (error) {
      console.error("Erreur sauvegarde fiche visite:", error);
      if (!silent) setError(`Erreur sauvegarde : ${error.message}. Vérifiez que la migration SQL fiche visite a bien été exécutée.`);
      return false;
    }
    dirtyRef.current = false;
    if (!silent) {
      setSaved(true);
      setTimeout(()=>setSaved(false), 2200);
    }
    if (refresh && onSaved) onSaved();
    return true;
  };
  useImperativeHandle(ref, () => ({ sauvegarder }));

  // Sauvegarde automatique de la fiche visite :
  // dès qu'une donnée est modifiée, on attend une courte pause de saisie,
  // puis on enregistre dans Supabase sans recharger toute la fiche.
  useEffect(() => {
    if (!bien?.id) return;
    if (autoSaveBootRef.current) {
      autoSaveBootRef.current = false;
      return;
    }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      sauvegarder({ refresh:false, dataOverride: latestDataRef.current });
    }, 700);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      if (dirtyRef.current && bien?.id) {
        sauvegarder({ refresh:false, dataOverride: latestDataRef.current, silent:true });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bien?.id]);

  const grid2 = { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))", gap:"0 12px" };
  const grid3 = { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:"0 12px" };
  const stepDefs = [
    { key:"essentiel", label:"Essentiel", icon:MapPin, help:"Adresse, source, vendeur et caractéristiques principales" },
    { key:"decoupe", label:"Découpe & loyers", icon:Home, help:"Configuration actuelle et loyers cibles par lot" },
    { key:"technique", label:"Technique", icon:Hammer, help:"Contrôle rapide du bâti par corps d'état" },
    { key:"energie", label:"Énergie & urbanisme", icon:AlertTriangle, help:"DPE, PLU, copropriété, autorisations" },
    { key:"finance", label:"Financier", icon:Wallet, help:"Coût global, loyers, rendement et cash-flow" },
    { key:"marche", label:"Marché & risques", icon:TrendingUp, help:"Tension locative, risques et négociation" },
    { key:"conclusion", label:"Conclusion", icon:Check, help:"Décision, prix d'offre et prochaine étape" },
  ];

  const stepButton = (s, i) => {
    const IconComp = s.icon;
    const active = visitStep === i;
    const complete = stepCompleted(i);
    const reachable = canReachStep(i);
    return (
      <button key={s.key} onClick={()=>{ if (reachable) setVisitStep(i); }} disabled={!reachable} style={{
        width:"100%", textAlign:"left", border:`1px solid ${active ? T.accentBorder : complete ? SEMANTIC.success.border : T.border}`,
        background:active ? T.accentBg : T.card, color:active ? T.accent : T.text,
        borderRadius:RADIUS.lg, padding:`${SPACING.sm+1}px ${SPACING.md}px`, cursor:reachable ? "pointer" : "not-allowed",
        display:"grid", gridTemplateColumns:"28px 1fr auto", alignItems:"center", gap:8,
        fontFamily:"inherit", transition:"all .15s", opacity:reachable ? 1 : .45,
      }}>
        <span style={{width:28,height:28,borderRadius:RADIUS.md,background:complete?SU:(active?T.accent:T.input),color:complete?"white":(active?T.onAccent:T.accent),display:"flex",alignItems:"center",justifyContent:"center"}}><Icon as={complete ? Check : IconComp} size={14} strokeWidth={2.2}/></span>
        <span style={{minWidth:0}}>
          <span style={{fontSize:FONT.sm.size+1,fontWeight:900,display:"block",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{i+1}. {s.label}</span>
          <span style={{fontSize:FONT.xs.size,color:T.textMuted,display:"block",marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.help}</span>
        </span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:FONT.xs.size,fontWeight:900,color:complete?SU:(active?T.accent:T.textMuted)}}>{pct(i)}%</span>
      </button>
    );
  };

  const renderStepContent = () => {
    switch (visitStep) {
      case 0:
        return (
          <>
            <VisitSection title="1. Identification rapide" icon={MapPin} T={T}>
              <div style={grid2}>
                <MiniField label="Référence interne Profero" value={bien.reference_interne || data.identification.reference_interne || "Générée automatiquement"} readOnly onChange={()=>{}} T={T}/>
                <MiniField label="Conseiller Profero en charge" value={data.identification.conseiller_profero} onChange={v=>upd("identification","conseiller_profero",v)} required helper="Personne responsable du suivi du bien" T={T}/>
                <MiniField label="Adresse complète" value={data.identification.adresse} onChange={v=>upd("identification","adresse",v)} required helper="Utilisée pour créer automatiquement latitude / longitude" T={T}/>
                <MiniField label="Ville" value={data.identification.ville} onChange={v=>upd("identification","ville",v)} required T={T}/>
                <MiniField label="Code postal" value={data.identification.code_postal} onChange={v=>upd("identification","code_postal",v)} required T={T}/>
                <MiniField label="Date de la visite" type="date" value={data.identification.date_visite} onChange={v=>upd("identification","date_visite",v)} required T={T}/>
                <MiniField label="Source" value={data.identification.source} options={SOURCES_BIEN_VISITE} onChange={v=>upd("identification","source",v)} required T={T}/>
                <MiniField label="Géolocalisation" value={data.identification.geocoding_status || (data.identification.latitude && data.identification.longitude ? "Coordonnées enregistrées" : "Automatique à l'enregistrement")} readOnly onChange={()=>{}} T={T}/>
              </div>
            </VisitSection>
            <VisitSection title="2. Données générales utiles à la décision" icon={Building2} T={T}>
              <div style={grid3}>
                <MiniField label="Type de bien" value={data.general.type_bien} options={TYPE_BIEN_VISITE} onChange={v=>upd("general","type_bien",v)} required T={T}/>
                <MiniField label="Année de construction" type="number" value={data.general.annee_construction} onChange={v=>upd("general","annee_construction",v)} required T={T}/>
                <MiniField label="Surface totale (m²)" type="number" value={data.general.surface_totale} onChange={v=>upd("general","surface_totale",v)} required T={T}/>
                <MiniField label="Nombre de niveaux" value={data.general.nombre_niveaux} options={NIVEAUX_BIEN_VISITE} onChange={v=>upd("general","nombre_niveaux",v)} required T={T}/>
                <MiniField label="Lots actuels" type="number" value={data.general.lots_actuels} onChange={v=>upd("general","lots_actuels",v)} required T={T}/>
                <MiniField label="Lots cibles" type="number" value={data.general.lots_cibles} onChange={v=>upd("general","lots_cibles",v)} required helper="Détermine le nombre de lots à compléter à l’étape suivante" T={T}/>
                <MiniField label="Prix affiché (€)" type="number" value={data.general.prix_affiche} onChange={v=>upd("general","prix_affiche",v)} required T={T}/>
                <MiniField label="Prix/m² affiché" value={numVal(data.general.surface_totale)>0 ? Math.round(numVal(data.general.prix_affiche)/numVal(data.general.surface_totale))+" €/m²" : "—"} readOnly onChange={()=>{}} T={T}/>
                <MiniField label="Mandat" value={data.general.mandat} options={MANDATS_VISITE} onChange={v=>upd("general","mandat",v)} required T={T}/>
                <MiniField label="Agence / vendeur" value={data.general.agence_vendeur} onChange={v=>upd("general","agence_vendeur",v)} required T={T}/>
                <MiniField label="Délai de vente estimé" value={data.general.delai_vente_estime} options={DELAI_VENTE_VISITE} onChange={v=>upd("general","delai_vente_estime",v)} required T={T}/>
                <MiniField label="Durée d'exposition de l'annonce" value={data.general.duree_exposition_annonce} options={EXPOSITION_ANNONCE_VISITE} onChange={v=>upd("general","duree_exposition_annonce",v)} required T={T}/>
              </div>
            </VisitSection>
          </>
        );
      case 1:
        return (
          <VisitSection title="Configuration cible et loyers" icon={Home} T={T}>
            <div style={grid3}>
              <MiniField label="Escaliers intérieurs" value={data.configuration.escaliers_interieurs} options={YES_NO} onChange={v=>upd("configuration","escaliers_interieurs",v)} required T={T}/>
              <MiniField label="Accès indépendants existants" value={data.configuration.acces_independants} options={YES_NO} onChange={v=>upd("configuration","acces_independants",v)} required T={T}/>
              <MiniField label="Compteurs eau" value={data.configuration.compteurs_eau} options={COMPTEUR_NOMBRE_VISITE} onChange={v=>upd("configuration","compteurs_eau",v)} required T={T}/>
              <MiniField label="Compteurs gaz" value={data.configuration.compteurs_gaz} options={COMPTEUR_NOMBRE_VISITE} onChange={v=>upd("configuration","compteurs_gaz",v)} required T={T}/>
              <MiniField label="Compteurs électricité" value={data.configuration.compteurs_electricite} options={COMPTEUR_NOMBRE_VISITE} onChange={v=>upd("configuration","compteurs_electricite",v)} required T={T}/>
            </div>
            <div style={{overflowX:"auto", marginTop:10, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, padding:10, background:T.card}}>
              <div style={{display:"grid", gridTemplateColumns:"60px 90px 90px 110px 90px 120px 38px", gap:6, minWidth:610, fontSize:FONT.xs.size, color:T.textMuted, fontWeight:800, textTransform:"uppercase", letterSpacing:.7, marginBottom:6}}>
                <div>Lot</div><div>Type</div><div>Surface</div><div>Loyer cible</div><div>Meublé</div><div>Stationnement</div><div/>
              </div>
              {lots.map((lot,idx)=>(
                <div key={idx} style={{display:"grid", gridTemplateColumns:"60px 90px 90px 110px 90px 120px 38px", gap:6, minWidth:610, marginBottom:6}}>
                  <input className="inv-inp" value={lot.numero} onChange={e=>updLot(idx,"numero",e.target.value)} style={{width:"100%"}}/>
                  <select className="inv-sel" value={lot.type || ""} onChange={e=>updLot(idx,"type",e.target.value)}>{TYPES_LOT_VISITE.map(x=><option key={x}>{x}</option>)}</select>
                  <input className="inv-inp" type="number" value={lot.surface || ""} onChange={e=>updLot(idx,"surface",e.target.value)} style={{width:"100%"}}/>
                  <input className="inv-inp" type="number" value={lot.loyer || ""} onChange={e=>updLot(idx,"loyer",e.target.value)} style={{width:"100%"}}/>
                  <select className="inv-sel" value={lot.meuble || ""} onChange={e=>updLot(idx,"meuble",e.target.value)}>{YES_NO.map(x=><option key={x}>{x || "—"}</option>)}</select>
                  <select className="inv-sel" value={lot.stationnement || ""} onChange={e=>updLot(idx,"stationnement",e.target.value)}>{YES_NO.map(x=><option key={x}>{x || "—"}</option>)}</select>
                  <button className="inv-btn inv-btn-danger inv-btn-sm" onClick={()=>removeLotVisite(idx)} disabled={lots.length <= 1} title="Supprimer ce lot" style={{padding:"5px 7px", justifyContent:"center"}}>×</button>
                </div>
              ))}
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, marginTop:10, flexWrap:"wrap"}}>
                <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={addLotVisite}>
                  <Icon as={Plus} size={12} strokeWidth={2.2}/> Ajouter un lot
                </button>
                <span style={{fontSize:FONT.xs.size+1, color:T.textMuted}}>Nombre de lots libre · la fiche se sauvegarde automatiquement</span>
              </div>
            </div>
            <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:10, marginTop:12}}>
              <div className="inv-kpi" style={{padding:12}}><div className="inv-kpi-lbl">Loyers mensuels cibles</div><div className="inv-kpi-val green" style={{fontSize:18}}>{fmt(totalLoyersMensuels)}</div></div>
              <div className="inv-kpi" style={{padding:12}}><div className="inv-kpi-lbl">Loyers annuels cibles</div><div className="inv-kpi-val green" style={{fontSize:18}}>{fmt(totalLoyersAnnuels)}</div></div>
              <div className="inv-kpi" style={{padding:12}}><div className="inv-kpi-lbl">Lots renseignés</div><div className="inv-kpi-val accent" style={{fontSize:18}}>{countLots}/{lots.length}</div></div>
            </div>
          </VisitSection>
        );
      case 2:
        return (
          <>
            <div style={{padding:"10px 12px", marginBottom:12, borderRadius:RADIUS.md, background:T.accentBg, border:`1px solid ${T.accentBorder}`, color:T.textSub, fontSize:FONT.sm.size+1}}>
              Renseignez d'abord le statut de chaque point. Ajoutez un commentaire uniquement quand il y a un risque, un doute ou une précision utile.
            </div>
            {TECHNIQUE_VISITE_GROUPS.map(g => (
              <VisitSection key={g.key} title={`Technique — ${g.title}`} icon={Hammer} T={T}>
                <AuditRows items={g.items} values={data.technique} onChange={(key,field,value)=>upd("technique",key,{...(data.technique?.[key]||{}),[field]:value})} T={T}/>
              </VisitSection>
            ))}
          </>
        );
      case 3:
        return (
          <>
            <VisitSection title="Performance énergétique & DPE" icon={Sparkles} T={T}>
              <div style={grid3}>
                <MiniField label="DPE actuel" value={data.dpe.dpe_actuel} options={LETTRES_DPE} onChange={v=>upd("dpe","dpe_actuel",v)} required T={T}/>
                <MiniField label="GES actuel" value={data.dpe.ges_actuel} options={LETTRES_DPE} onChange={v=>upd("dpe","ges_actuel",v)} required T={T}/>
                <MiniField label="Consommation énergie" type="number" value={data.dpe.conso_energie} onChange={v=>upd("dpe","conso_energie",v)} required T={T}/>
                <MiniField label="Émissions CO2" type="number" value={data.dpe.emissions_co2} onChange={v=>upd("dpe","emissions_co2",v)} required T={T}/>
                <MiniField label="DPE cible" value={data.dpe.dpe_cible} options={LETTRES_DPE} onChange={v=>upd("dpe","dpe_cible",v)} required T={T}/>
                <MiniField label="Audit énergétique disponible" value={data.dpe.audit_disponible} options={YES_NO} onChange={v=>upd("dpe","audit_disponible",v)} required T={T}/>
              </div>
              <MiniField label="Principales passoires identifiées" textarea value={data.dpe.passoires_identifiees} onChange={v=>upd("dpe","passoires_identifiees",v)} required T={T}/>
              <MiniField label="Travaux d'amélioration énergétique envisagés" textarea value={data.dpe.travaux_energetiques} onChange={v=>upd("dpe","travaux_energetiques",v)} required T={T}/>
            </VisitSection>
            <VisitSection title="Urbanisme, réglementation & faisabilité" icon={AlertTriangle} T={T}>
              <AuditRows items={URBANISME_VISITE_ITEMS} values={data.urbanisme.controles} onChange={(key,field,value)=>updControl("urbanisme",key,field,value)} T={T}/>
              <div style={{...grid3, marginTop:12}}>
                <MiniField label="Contact mairie / urbanisme consulté" value={data.urbanisme.contact_mairie} onChange={v=>upd("urbanisme","contact_mairie",v)} T={T}/>
                <MiniField label="Durée prévisionnelle du chantier" value={data.urbanisme.duree_chantier} options={DUREE_CHANTIER_VISITE} onChange={v=>upd("urbanisme","duree_chantier",v)} required T={T}/>
                <MiniField label="Complexité estimée" value={data.urbanisme.complexite} options={COMPLEXITE_VISITE} onChange={v=>upd("urbanisme","complexite",v)} T={T}/>
              </div>
              <MiniField label="Observations / risques réglementaires" textarea value={data.urbanisme.observations} onChange={v=>upd("urbanisme","observations",v)} required T={T}/>
              <MiniField label="Autorisations préalables à prévoir" textarea value={data.urbanisme.autorisations} onChange={v=>upd("urbanisme","autorisations",v)} required T={T}/>
              <MiniField label="Points de vigilance travaux spécifiques" textarea value={data.urbanisme.vigilance_travaux} onChange={v=>upd("urbanisme","vigilance_travaux",v)} required T={T}/>
            </VisitSection>
          </>
        );
      case 4:
        return (
          <>
            <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))", gap:10, marginBottom:12}}>
              <div className="inv-kpi" style={{padding:12}}><div className="inv-kpi-lbl">Coût total opération</div><div className="inv-kpi-val" style={{fontSize:18}}>{fmt(coutOperation)}</div></div>
              <div className="inv-kpi" style={{padding:12}}><div className="inv-kpi-lbl">Loyers annuels</div><div className="inv-kpi-val green" style={{fontSize:18}}>{fmt(totalLoyersAnnuels)}</div></div>
              <div className="inv-kpi" style={{padding:12}}><div className="inv-kpi-lbl">Rendement brut</div><div className="inv-kpi-val accent" style={{fontSize:18}}>{rendementBrut ? rendementBrut.toFixed(2)+" %" : "—"}</div></div>
              <div className="inv-kpi" style={{padding:12}}><div className="inv-kpi-lbl">Rendement net</div><div className="inv-kpi-val green" style={{fontSize:18}}>{rendementNet ? rendementNet.toFixed(2)+" %" : "—"}</div></div>
            </div>
            <VisitSection title="Coût total de l'opération" icon={Wallet} T={T}>
              <div style={grid3}>
                <MiniField label="Prix acquisition négocié (€)" type="number" value={fin.prix_acquisition_negocie} onChange={v=>upd("finance","prix_acquisition_negocie",v)} required T={T}/>
                <MiniField label="Frais de notaire estimés (€)" type="number" value={fin.frais_notaire} onChange={v=>upd("finance","frais_notaire",v)} required T={T}/>
                <MiniField label="Frais d'agence (€)" type="number" value={fin.frais_agence} onChange={v=>upd("finance","frais_agence",v)} required T={T}/>
                <MiniField label="Frais Profero Invest (€)" type="number" value={fin.frais_profero} onChange={v=>upd("finance","frais_profero",v)} required T={T}/>
                <MiniField label="Budget travaux TTC (€)" type="number" value={fin.budget_travaux_ttc} onChange={v=>upd("finance","budget_travaux_ttc",v)} required T={T}/>
                <MiniField label="Mobilier si meublé (€)" type="number" value={fin.mobilier} onChange={v=>upd("finance","mobilier",v)} required T={T}/>
                <MiniField label="Frais financement / garantie (€)" type="number" value={fin.frais_financement} onChange={v=>upd("finance","frais_financement",v)} required T={T}/>
                <MiniField label="Divers / fonds de roulement (€)" type="number" value={fin.divers_fonds_roulement} onChange={v=>upd("finance","divers_fonds_roulement",v)} required T={T}/>
              </div>
            </VisitSection>
            <VisitSection title="Rentabilité locative" icon={TrendingUp} T={T}>
              <div style={grid3}>
                <MiniField label="Loyers bruts mensuels" value={fmt(totalLoyersMensuels)} readOnly onChange={()=>{}} T={T}/>
                <MiniField label="Loyers bruts annuels" value={fmt(totalLoyersAnnuels)} readOnly onChange={()=>{}} T={T}/>
                <MiniField label="Taux de vacance estimé (%)" type="number" value={fin.taux_vacance} onChange={v=>upd("finance","taux_vacance",v)} required T={T}/>
                <MiniField label="Loyers nets de vacance" value={fmt(loyersNetsVacance)} readOnly onChange={()=>{}} T={T}/>
                <MiniField label="Charges annuelles" type="number" value={fin.charges_annuelles} onChange={v=>upd("finance","charges_annuelles",v)} required T={T}/>
                <MiniField label="Loyers nets de charges" value={fmt(loyersNetsCharges)} readOnly onChange={()=>{}} T={T}/>
                <MiniField label="Cash-flow mensuel estimé (€)" type="number" value={fin.cashflow_mensuel} onChange={v=>upd("finance","cashflow_mensuel",v)} required T={T}/>
                <MiniField label="Durée de remboursement" value={fin.duree_remboursement} options={DUREE_REMBOURSEMENT_VISITE} onChange={v=>upd("finance","duree_remboursement",v)} required T={T}/>
                <MiniField label="Plus-value potentielle à terme (€)" type="number" value={fin.plus_value_potentielle} onChange={v=>upd("finance","plus_value_potentielle",v)} required T={T}/>
              </div>
            </VisitSection>
          </>
        );
      case 5:
        return (
          <>
            <VisitSection title="Marché locatif local" icon={TrendingUp} T={T}>
              <div style={grid3}>
                <MiniField label="Tension locative" value={data.marche.tension_locative} options={TENSION_LOCATIVE} onChange={v=>upd("marche","tension_locative",v)} required T={T}/>
                <MiniField label="Délai de relocation moyen" value={data.marche.delai_relocation} options={DELAI_RELOCATION_VISITE} onChange={v=>upd("marche","delai_relocation",v)} required T={T}/>
                <MiniField label="Loyer moyen secteur (€/m²)" type="number" value={data.marche.loyer_moyen_m2} onChange={v=>upd("marche","loyer_moyen_m2",v)} required T={T}/>
                <MiniField label="Colocation possible ?" value={data.marche.colocation_possible} options={YES_NO} onChange={v=>upd("marche","colocation_possible",v)} required T={T}/>
                <MiniField label="Location meublée pertinente ?" value={data.marche.meuble_pertinente} options={YES_NO} onChange={v=>upd("marche","meuble_pertinente",v)} required T={T}/>
                <MiniField label="Location nue pertinente ?" value={data.marche.nue_pertinente} options={YES_NO} onChange={v=>upd("marche","nue_pertinente",v)} required T={T}/>
                <MiniField label="Régime fiscal adapté" value={data.marche.regime_fiscal} options={FISCALITE_VISITE} onChange={v=>upd("marche","regime_fiscal",v)} required T={T}/>
                <MiniField label="Durée moyenne de vacance" value={data.marche.vacance_moyenne} options={VACANCE_LOCATIVE_VISITE} onChange={v=>upd("marche","vacance_moyenne",v)} required T={T}/>
              </div>
              <MiniField label="Profil des locataires cibles" value={data.marche.profil_locataires} options={PROFILS_LOCATAIRES_VISITE} onChange={v=>upd("marche","profil_locataires",v)} required T={T}/>
              <MiniField label="Concurrence directe" textarea value={data.marche.concurrence} onChange={v=>upd("marche","concurrence",v)} required T={T}/>
              <MiniField label="Points forts du secteur" textarea value={data.marche.points_forts} onChange={v=>upd("marche","points_forts",v)} required T={T}/>
              <MiniField label="Points faibles ou risques du secteur" textarea value={data.marche.points_faibles} onChange={v=>upd("marche","points_faibles",v)} required T={T}/>
            </VisitSection>
            <VisitSection title="Points de vigilance & risques" icon={AlertTriangle} T={T}>
              <AuditRows items={RISQUES_VISITE_ITEMS} values={data.risques.controles} onChange={(key,field,value)=>updControl("risques",key,field,value)} T={T}/>
              <div style={{...grid3, marginTop:12}}>
                <MiniField label="Marge de négociation estimée" value={data.risques.marge_negociation} onChange={v=>upd("risques","marge_negociation",v)} T={T}/>
              </div>
              <MiniField label="Points de négociation identifiés" textarea value={data.risques.points_negociation} onChange={v=>upd("risques","points_negociation",v)} required T={T}/>
              <MiniField label="Conditions suspensives à prévoir" textarea value={data.risques.conditions_suspensives} onChange={v=>upd("risques","conditions_suspensives",v)} required T={T}/>
              <MiniField label="Observations libres" textarea value={data.risques.observations_libres} onChange={v=>upd("risques","observations_libres",v)} required T={T}/>
            </VisitSection>
          </>
        );
      default:
        return (
          <VisitSection title="Conclusion & recommandation Profero" icon={Check} T={T}>
            <div style={grid3}>
              <MiniField label="Note globale du dossier /10" type="number" value={data.conclusion.note_globale} onChange={v=>upd("conclusion","note_globale",v)} required T={T}/>
              <MiniField label="Recommandation" value={data.conclusion.recommandation} options={RECO_VISITE} onChange={v=>upd("conclusion","recommandation",v)} required T={T}/>
              <MiniField label="Prix d'offre recommandé (€)" type="number" value={data.conclusion.prix_offre_recommande} onChange={v=>upd("conclusion","prix_offre_recommande",v)} required T={T}/>
              <MiniField label="Stratégie locative recommandée" value={data.conclusion.strategie_locative} options={STRATEGIE_LOCATIVE_VISITE} onChange={v=>upd("conclusion","strategie_locative",v)} required T={T}/>
              <MiniField label="Fiscalité recommandée" value={data.conclusion.fiscalite_recommandee} options={FISCALITE_VISITE} onChange={v=>upd("conclusion","fiscalite_recommandee",v)} required T={T}/>
              <MiniField label="Prochaine étape à engager" value={data.conclusion.prochaine_etape} options={PROCHAINE_ETAPE_VISITE} onChange={v=>upd("conclusion","prochaine_etape",v)} required T={T}/>
            </div>
            <MiniField label="Commentaire libre du conseiller Profero" textarea value={data.conclusion.commentaire_conseiller} onChange={v=>upd("conclusion","commentaire_conseiller",v)} required T={T}/>
          </VisitSection>
        );
    }
  };

  return (
    <div className="inv-card" style={{overflow:"visible"}}>
      <div className="inv-card-hd blue" style={{ justifyContent:"space-between", position:"sticky", top:0, zIndex:3 }}>
        <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={FileText} size={13} strokeWidth={2.2}/>Fiche visite guidée</span>
        <span style={{
          fontSize:FONT.xs.size+1,
          color: saving ? WA : saved ? SU : T.textMuted,
          fontWeight:800,
          display:"inline-flex",
          alignItems:"center",
          gap:5,
        }}>
          {saving && <Icon as={RefreshCw} size={11} strokeWidth={2.2} style={{animation:"spin 1s linear infinite"}}/>}
          {saving ? "Sauvegarde en cours…" : saved ? "Sauvegardé" : "Complétion progressive"}
        </span>
      </div>
      <div className="inv-card-bd">
        {error && <div style={{marginBottom:12, padding:"9px 11px", borderRadius:RADIUS.md, background:SEMANTIC.danger.bg, border:`1px solid ${SEMANTIC.danger.border}`, color:DA, fontSize:FONT.sm.size}}>{error}</div>}

        <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:8, marginBottom:14}}>
          <div style={{padding:10, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, background:T.cardHover}}>
            <div className="inv-kpi-lbl">Avancement fiche</div>
            <div style={{fontSize:FONT.md.size, fontWeight:900, color:T.accent}}>{globalPct}%</div>
            <div style={{height:5, borderRadius:5, background:T.input, overflow:"hidden", marginTop:6}}><div style={{width:`${globalPct}%`, height:"100%", background:T.accent}}/></div>
          </div>
          <div style={{padding:10, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, background:T.cardHover}}>
            <div className="inv-kpi-lbl">Recommandation</div>
            <div style={{fontSize:FONT.md.size, fontWeight:900, color:data.conclusion?.recommandation === "Abandonner" ? DA : SU}}>{data.conclusion?.recommandation || "À compléter"}</div>
          </div>
          <div style={{padding:10, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, background:T.cardHover}}>
            <div className="inv-kpi-lbl">Coût total</div>
            <div style={{fontSize:FONT.md.size, fontWeight:900, color:T.text}}>{fmt(coutOperation)}</div>
          </div>
          <div style={{padding:10, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, background:T.cardHover}}>
            <div className="inv-kpi-lbl">Rendement brut</div>
            <div style={{fontSize:FONT.md.size, fontWeight:900, color:T.accent}}>{rendementBrut ? rendementBrut.toFixed(2)+" %" : "—"}</div>
          </div>
        </div>

        <div style={{display:"grid", gridTemplateColumns:"300px 1fr", gap:16, alignItems:"start"}}>
          <div style={{position:"sticky", top:56, display:"flex", flexDirection:"column", gap:8}}>
            {stepDefs.map((s,i)=>stepButton(s,i))}
            <div style={{padding:12, border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, background:T.input, color:T.textMuted, fontSize:FONT.xs.size+1, lineHeight:1.55}}>
              <strong style={{color:T.accent}}>Méthode de saisie :</strong><br/>
              1. compléter l’essentiel<br/>
              2. valider la configuration cible<br/>
              3. les réponses manquantes restent visibles<br/>
              4. commentaire conseillé si “À vérifier” ou “Problème”
            </div>
          </div>

          <div>
            <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:12, padding:"10px 12px", border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, background:T.input}}>
              <div>
                <div style={{fontSize:FONT.md.size, fontWeight:900, color:T.text}}>{stepDefs[visitStep].label}</div>
                <div style={{fontSize:FONT.sm.size, color:T.textSub, marginTop:2}}>{stepDefs[visitStep].help}</div>
              </div>
              <div style={{fontFamily:"'DM Mono',monospace", color:T.accent, fontWeight:900}}>{pct(visitStep)}%</div>
            </div>

            {renderStepContent()}

            {!currentStepComplete && (
              <div style={{marginTop:14, padding:"10px 12px", borderRadius:RADIUS.md, background:SEMANTIC.warning.bg, border:`1px solid ${SEMANTIC.warning.border}`, color:T.textSub, fontSize:FONT.sm.size, lineHeight:1.5}}>
                <strong style={{color:WA}}>Réponses manquantes / à compléter :</strong>
                <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))", gap:"2px 12px", marginTop:6}}>
                  {currentMissing.slice(0, 12).map(m => <span key={m}>• {m}</span>)}
                  {currentMissing.length > 12 && <span>• +{currentMissing.length - 12} autre(s) point(s)</span>}
                </div>
              </div>
            )}

            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginTop:14, paddingTop:12, borderTop:`1px solid ${T.border}`}}>
              <button className="inv-btn inv-btn-out" onClick={()=>setVisitStep(Math.max(0, visitStep-1))} disabled={visitStep===0}>
                <Icon as={ChevronLeft} size={13} strokeWidth={2.2}/> Précédent
              </button>
              <div style={{fontSize:FONT.xs.size+1, color:currentStepComplete ? SU : WA, fontWeight:800}}>
                {currentStepComplete ? "Étape complète" : `${currentMissing.length} réponse(s) manquante(s)`} · étape {visitStep+1}/{stepDefs.length}
              </div>
              <button className="inv-btn inv-btn-blue" onClick={()=>setVisitStep(Math.min(stepDefs.length-1, visitStep+1))} disabled={visitStep===stepDefs.length-1} title={currentStepComplete ? "Étape suivante" : "Étape suivante — réponses à compléter visibles ci-dessus"}>
                Suivant <Icon as={ChevronRight} size={13} strokeWidth={2.2}/>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});




function mapVisiteLotsToSimulateurLots(visiteData = {}) {
  const lotsCibles = Array.isArray(visiteData?.configuration?.lots) ? visiteData.configuration.lots : [];
  return lotsCibles
    .filter(l => l && (l.type || l.surface || l.loyer || l.meuble || l.stationnement))
    .map((l, idx) => {
      const lotNumber = l.numero || String(idx + 1);
      const comments = [
        `Lot ${lotNumber}`,
        l.meuble ? `Location : ${l.meuble}` : "",
        l.stationnement ? `Stationnement : ${l.stationnement}` : "",
      ].filter(Boolean).join(" · ");
      return {
        type: l.type || "T2",
        m2: numVal(l.surface),
        loyer: numVal(l.loyer),
        niveau: l.niveau || "RDC",
        comment: comments,
      };
    });
}

function syncSimulateurFromVisiteData(visiteData = {}, bien = {}) {
  const existingSim = visiteData?.simulateur || {};
  const existingInputs = existingSim.inputs || {};
  const existingSelects = existingSim.selects || {};
  const existingDescriptions = existingSim.descriptions || {};
  const finance = visiteData.finance || {};
  const general = visiteData.general || {};
  const dpe = visiteData.dpe || {};
  const marche = visiteData.marche || {};
  const lots = mapVisiteLotsToSimulateurLots(visiteData);
  const surfaceFromLots = lots.reduce((s,l)=>s+(l.m2||0),0);
  const pickPositive = (...vals) => {
    for (const v of vals) {
      const n = numVal(v);
      if (n > 0) return n;
    }
    return 0;
  };
  const prixAffiche = pickPositive(general.prix_affiche, bien.prix_vente, existingInputs.prixAffiche);
  const prixNegocie = pickPositive(finance.prix_acquisition_negocie, bien.montant_offre, existingInputs.prixNegocie, prixAffiche);
  const budgetTravaux = pickPositive(finance.budget_travaux_ttc, bien.prix_travaux, existingInputs.budgetTravaux);
  const surface = pickPositive(general.surface_totale, bien.surface_totale, existingInputs.surface, surfaceFromLots);
  const adresse = [
    visiteData.identification?.adresse || bien.adresse,
    visiteData.identification?.code_postal || bien.code_postal,
    visiteData.identification?.ville || bien.ville,
  ].filter(Boolean).join(", ");

  return {
    ...existingSim,
    version: existingSim.version || 4,
    savedAt: new Date().toISOString(),
    projectName: existingSim.projectName || `Simulation — ${bien.reference_interne || bien.adresse || "Bien"}`,
    inputs: {
      tauxNotaire: 0.08,
      enedis: 0,
      taxeFonciere: 0,
      assurance: 0,
      compta: 0,
      provisions: 0,
      apport1: 0,
      apport2: 0,
      taux1: 4.20,
      taux2: 4.20,
      duree1: 20,
      duree2: 25,
      coefEtat: 1.0,
      imprevusPct: 10,
      ...existingInputs,
      prixAffiche,
      prixNegocie,
      budgetTravaux,
      surface,
      honoraires: pickPositive(finance.frais_profero, existingInputs.honoraires),
    },
    selects: {
      gestionActive: false,
      modeDetention: "IS",
      tmi: "0.30",
      selectedScenario: 1,
      ...existingSelects,
    },
    lots: lots.length ? lots : (Array.isArray(existingSim.lots) && existingSim.lots.length ? existingSim.lots : [{type:"Sélectionner",m2:0,loyer:0,niveau:"RDC",comment:""}]),
    budgetQty: existingSim.budgetQty || {},
    budgetPrice: existingSim.budgetPrice || {},
    customDivers: Array.isArray(existingSim.customDivers) ? existingSim.customDivers : [],
    descriptions: {
      description: bien.commentaire || existingDescriptions.description || "",
      travaux: dpe.travaux_energetiques || existingDescriptions.travaux || "",
      atouts: marche.points_forts || existingDescriptions.atouts || "",
      adresse: adresse || existingDescriptions.adresse || "",
    },
    photos: Array.isArray(existingSim.photos) ? existingSim.photos : [null,null,null,null],
    bien_id: bien.id || existingSim.bien_id || null,
    synced_from_fiche_bien_at: new Date().toISOString(),
  };
}

function buildSimulateurProjectFromBien(bien = {}) {
  const visite = bien.visite_data || {};
  if (visite.simulateur) {
    return {
      id: null,
      nom: `Simulation — ${bien.reference_interne || bien.adresse || "Bien"}`,
      donnees: syncSimulateurFromVisiteData(visite, bien),
      client_id: "",
    };
  }

  const finance = visite.finance || {};
  const general = visite.general || {};
  const configuration = visite.configuration || {};
  const lots = mapVisiteLotsToSimulateurLots(visite);

  const prixAffiche = parseFloat(general.prix_affiche || bien.prix_vente) || 0;
  const prixNegocie = parseFloat(finance.prix_acquisition_negocie || bien.montant_offre || bien.prix_vente) || prixAffiche || 0;
  const budgetTravaux = parseFloat(finance.budget_travaux_ttc || bien.prix_travaux) || 0;
  const surface = parseFloat(general.surface_totale || bien.surface_totale) || lots.reduce((s,l)=>s+(l.m2||0),0) || 0;

  return {
    id: null,
    nom: `Simulation — ${bien.reference_interne || bien.adresse || "Bien"}`,
    client_id: "",
    donnees: {
      version:4,
      savedAt: bien.updated_at || new Date().toISOString(),
      projectName: `Simulation — ${bien.reference_interne || bien.adresse || "Bien"}`,
      inputs: {
        prixAffiche, prixNegocie, budgetTravaux, tauxNotaire:0.08, surface,
        honoraires: parseFloat(finance.frais_profero) || 0,
        enedis:0,
        taxeFonciere:0, assurance:0, compta:0, provisions:0,
        apport1:0, apport2:0, taux1:4.20, taux2:4.20, duree1:20, duree2:25,
        coefEtat:1.0, imprevusPct:10,
      },
      selects: { gestionActive:false, modeDetention:"IS", tmi:"0.30", selectedScenario:1 },
      lots: lots.length ? lots : [{type:"Sélectionner",m2:0,loyer:0,niveau:"RDC",comment:""}],
      budgetQty:{}, budgetPrice:{}, customDivers:[],
      descriptions: {
        description: bien.commentaire || "",
        travaux: visite.dpe?.travaux_energetiques || "",
        atouts: visite.marche?.points_forts || "",
        adresse: [bien.adresse, bien.code_postal, bien.ville].filter(Boolean).join(", "),
      },
      photos:[null,null,null,null],
      bien_id: bien.id || null,
    },
  };
}

function FicheBien({ id, profil, onRetour, T=THEMES_INV.dark }) {
  const [bien, setBien]       = useState(null);
  const [props, setProps]     = useState([]);
  const [clients, setClients] = useState([]);
  const [showEdit, setShowEdit] = useState(false);
  const [showProp, setShowProp] = useState(false);
  const [newProp, setNewProp] = useState({ client_id:"", statut:"proposé", commentaire:"", lien_dossier:"" });
  const [savingProp, setSavingProp] = useState(false);
  const [geolocatingBien, setGeolocatingBien] = useState(false);
  const [geoMessageBien, setGeoMessageBien] = useState("");
  const [ficheTab, setFicheTab] = useState("fiche");
  const ficheVisiteRef = useRef(null);
  const [visiteSaveState, setVisiteSaveState] = useState({ saving:false, saved:false });

  const charger = async () => {
    const [{ data: b }, { data: p }, { data: c }] = await Promise.all([
      supabase.from("invest_biens").select("*").eq("id", id).single(),
      supabase.from("invest_propositions").select("*, client:invest_clients(nom,prenom)").eq("bien_id", id).order("created_at",{ascending:false}),
      supabase.from("invest_clients").select("id,nom,prenom,budget,statut,etape,strategie_data").order("nom"),
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

  const associerClientMatching = async (clientId) => {
    if (!clientId) return;
    const { error } = await supabase.from("invest_propositions").insert({
      bien_id: id,
      client_id: clientId,
      statut: "proposé",
      commentaire: "Proposé depuis le matching automatique",
      lien_dossier: "",
      date_proposition: new Date().toISOString().slice(0,10),
    });
    if (error) alert("Impossible d'associer ce client : " + error.message);
    else charger();
  };

  const validerGeolocalisationBien = async () => {
    const adresseComplete = getBienGoogleAddress(bien || {});
    if (!adresseComplete) {
      setGeoMessageBien("Adresse manquante : renseignez au minimum l'adresse, le code postal ou la ville.");
      return;
    }

    setGeolocatingBien(true);
    setGeoMessageBien("");

    try {
      const geo = await getCoordinatesFromAddress(adresseComplete);
      if (!geo || !isValidLatLng(parseFloat(geo.lat), parseFloat(geo.lng))) {
        setGeoMessageBien(`Adresse introuvable par Google Maps : ${geo?.error || "vérifiez l'adresse"}`);
        setGeolocatingBien(false);
        return;
      }

      const lat = parseFloat(geo.lat);
      const lng = parseFloat(geo.lng);
      const updatedVisiteData = {
        ...(bien.visite_data || {}),
        identification: {
          ...(bien.visite_data?.identification || {}),
          latitude: lat,
          longitude: lng,
          geocoding_status: `Géolocalisation validée le ${new Date().toLocaleDateString("fr-FR")}`,
          adresse_google: geo.formatted_address || adresseComplete,
        },
      };

      const { error } = await supabase
        .from("invest_biens")
        .update({
          latitude: lat,
          longitude: lng,
          visite_data: updatedVisiteData,
        })
        .eq("id", id);

      if (error) {
        console.error("Erreur géolocalisation bien:", error);
        setGeoMessageBien(`Erreur Supabase : ${error.message}`);
      } else {
        setBien(prev => ({
          ...prev,
          latitude: lat,
          longitude: lng,
          visite_data: updatedVisiteData,
        }));
        setGeoMessageBien(`Géolocalisation validée : ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        charger();
      }
    } catch (e) {
      console.error("Erreur géolocalisation:", e);
      setGeoMessageBien(e?.message || "Géolocalisation impossible.");
    } finally {
      setGeolocatingBien(false);
    }
  };

  const fmtDate = d => d ? new Date(d).toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"}) : "—";
  const fmtEur  = v => v > 0 ? new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(v)+" €" : "—";

  if (!bien) return <div style={{ textAlign:"center", padding:"60px", color:T.textMuted }}>Chargement…</div>;

  const couleur = STATUT_BIEN_COLORS[bien.statut] || "#9aa0b0";
  const currentTheme = T?.bg === THEMES_INV.light.bg ? "light" : "dark";
  const simulateurProjetBien = buildSimulateurProjectFromBien(bien);
  const visiteDataBien = bien.visite_data || {};
  const conclusionBien = visiteDataBien.conclusion || {};
  const generalBien = visiteDataBien.general || {};
  const financeBien = visiteDataBien.finance || {};
  const genererFicheBienPDF = () => {
    const v = bien.visite_data || {}; const idf = v.identification || {}; const gen = v.general || {}; const fin = v.finance || {}; const concl = v.conclusion || {}; const lots = v.configuration?.lots || [];
    const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const win = window.open("", "_blank", "width=900,height=720"); if(!win){ alert("Autorisez les pop-ups."); return; }
    const lotRows = lots.filter(l=>l && (l.type||l.surface||l.loyer)).map(l=>`<tr><td>${esc(l.numero)}</td><td>${esc(l.type)}</td><td>${esc(l.surface)} m²</td><td>${esc(l.loyer)} €/mois</td><td>${esc(l.meuble)}</td></tr>`).join("");
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Fiche bien ${esc(bien.reference_interne||bien.adresse)}</title><style>body{font-family:Arial,sans-serif;margin:0;background:#f5f7fb;color:#1a1f2e}.wrap{max-width:900px;margin:0 auto;background:white;min-height:100vh}.hd{background:#1a2d4a;color:white;padding:28px 34px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:18px 34px}.kpi{border-left:4px solid #4070e8;background:#f8f9fb;padding:12px;border-radius:8px}.k{font-size:20px;font-weight:800}.l{font-size:10px;text-transform:uppercase;color:#7b8496}.sec{padding:16px 34px;border-top:1px solid #eef0f5}.title{font-size:12px;font-weight:800;text-transform:uppercase;color:#4070e8;letter-spacing:1.6px;margin-bottom:10px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px}.row{display:flex;justify-content:space-between;border-bottom:1px solid #eef0f5;padding:6px 0;font-size:13px}.row b{color:#1a2d4a}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#1a2d4a;color:white;text-align:left;padding:8px}td{padding:8px;border-bottom:1px solid #eef0f5}.no-print{position:fixed;right:18px;top:18px}.btn{background:#4070e8;color:white;border:0;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer}@media print{.no-print{display:none}.wrap{max-width:none}}</style></head><body><div class="no-print"><button class="btn" onclick="window.print()">Imprimer / PDF</button></div><div class="wrap"><div class="hd"><div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.7">Profero Invest</div><h1>${esc(bien.reference_interne||"Fiche bien")}</h1><div>${esc([bien.adresse,bien.code_postal,bien.ville].filter(Boolean).join(" "))}</div></div><div class="kpis"><div class="kpi"><div class="k">${esc(concl.note_globale||"—")}/10</div><div class="l">Note</div></div><div class="kpi"><div class="k">${esc(concl.recommandation||"—")}</div><div class="l">Recommandation</div></div><div class="kpi"><div class="k">${esc(fmtEur(bien.montant_offre||concl.prix_offre_recommande))}</div><div class="l">Offre</div></div><div class="kpi"><div class="k">${bien.rendement_brut?Number(bien.rendement_brut).toFixed(1)+" %":"—"}</div><div class="l">Rendement</div></div></div><div class="sec"><div class="title">Informations essentielles</div><div class="grid"><div class="row"><span>Type</span><b>${esc(gen.type_bien||"—")}</b></div><div class="row"><span>Surface</span><b>${esc(gen.surface_totale||"—")} m²</b></div><div class="row"><span>Prix affiché</span><b>${esc(fmtEur(bien.prix_vente))}</b></div><div class="row"><span>Travaux</span><b>${esc(fmtEur(bien.prix_travaux))}</b></div><div class="row"><span>Coût total</span><b>${esc(fmtEur(bien.cout_total))}</b></div><div class="row"><span>Cash-flow</span><b>${esc(fmtEur(bien.cashflow_estime))}/mois</b></div></div></div><div class="sec"><div class="title">Configuration cible</div><table><thead><tr><th>Lot</th><th>Type</th><th>Surface</th><th>Loyer</th><th>Location</th></tr></thead><tbody>${lotRows||"<tr><td colspan='5'>Aucun lot renseigné</td></tr>"}</tbody></table></div><div class="sec"><div class="title">Conclusion Profero</div><p><b>Stratégie locative :</b> ${esc(concl.strategie_locative||"—")}</p><p><b>Fiscalité recommandée :</b> ${esc(concl.fiscalite_recommandee||"—")}</p><p><b>Prochaine étape :</b> ${esc(concl.prochaine_etape||"—")}</p><p>${esc(concl.commentaire_conseiller||"")}</p></div></div></body></html>`); win.document.close();
  };


  const genererPresentationClientPDF = () => {
    const v = bien.visite_data || {};
    const sim = v.simulateur || {};
    const inputs = sim.inputs || {};
    const selects = sim.selects || {};
    const simLots = Array.isArray(sim.lots) ? sim.lots : [];
    const cfgLots = Array.isArray(v.configuration?.lots) ? v.configuration.lots : [];
    const sourceLots = (simLots.length ? simLots : cfgLots).filter(l => (l?.type || "") !== "Sélectionner");
    const lotsPDF = sourceLots.map(l => ({
      type: l.type || l.typologie || l.type_lot || "Lot",
      niveau: l.niveau || "—",
      m2: l.m2 ?? l.surface ?? 0,
      loyer: l.loyer ?? l.loyer_cible ?? 0,
      gestion: l.gestion ?? (l.type && GESTION_PRICES[l.type] ? GESTION_PRICES[l.type] : 0),
      comment: l.comment || l.commentaire || "",
    }));
    const surfacePdf = Number(inputs.surface || v.general?.surface_totale || bien.surface || lotsPDF.reduce((s,l)=>s+(Number(l.m2)||0),0) || 0);
    const prixPdf = Number(inputs.prixNegocie || bien.montant_offre || bien.prix_vente || v.finance?.prix_acquisition_negocie || 0);
    const budgetTravauxPdf = Number(inputs.budgetTravaux || bien.prix_travaux || v.finance?.budget_travaux_ttc || 0);
    const tauxNotairePdf = Number(inputs.tauxNotaire || 0.08);
    const coutTotalPdf = Number(bien.cout_total || v.finance?.cout_total_operation || (prixPdf + prixPdf * tauxNotairePdf + budgetTravauxPdf + Number(inputs.honoraires||0) + Number(inputs.enedis||0)) || 0);
    const totLoyerPdf = lotsPDF.reduce((s,l)=>s+(Number(l.loyer)||0),0) || Number(v.finance?.loyers_bruts_mensuels || 0);
    const totLoyerAnPdf = totLoyerPdf * 12;
    const chargesPdf = Number(inputs.taxeFonciere||0) + Number(inputs.assurance||0) + Number(inputs.compta||0) + Number(inputs.provisions||0);
    const apportPdf = Number(inputs.apport1 || 0);
    const tauxPdf = Number(inputs.taux1 || 0);
    const dureePdf = Number(inputs.duree1 || 20);
    const mensualitePdf = pmt(Math.max(coutTotalPdf - apportPdf, 0), tauxPdf, dureePdf);
    const annuitePdf = mensualitePdf * 12;
    const rbPdf = coutTotalPdf > 0 ? (totLoyerAnPdf / coutTotalPdf) * 100 : Number(bien.rendement_brut || 0);
    const rnPdf = coutTotalPdf > 0 ? ((totLoyerAnPdf - chargesPdf) / coutTotalPdf) * 100 : 0;
    const cfPdf = (totLoyerAnPdf - chargesPdf) / 12 - mensualitePdf;
    const pePdf = totLoyerAnPdf > 0 ? ((chargesPdf + annuitePdf) / totLoyerAnPdf) * 12 : 0;
    const margePdf = totLoyerAnPdf > 0 ? (1 - ((chargesPdf + annuitePdf) / totLoyerAnPdf)) * 100 : 0;
    const desc = sim.descriptions?.description || v.presentation || v.general?.commentaire || "Projet d’investissement immobilier analysé par Profero Invest.";
    const travaux = sim.descriptions?.travaux || v.technique?.travaux_envisages || (budgetTravauxPdf > 0 ? `Budget travaux estimé : ${new Intl.NumberFormat("fr-FR", {maximumFractionDigits:0}).format(budgetTravauxPdf)} €.` : "Travaux à préciser après validation technique et devis.");
    const atouts = sim.descriptions?.atouts || v.marche?.points_forts || v.conclusion?.commentaire || `Rentabilité brute estimée à ${rbPdf.toFixed(2).replace(".", ",")} %. Stratégie à confirmer selon financement et objectifs client.`;

    openFicheClientInvestisseurPDF({
      title: [bien.adresse, bien.ville].filter(Boolean).join(" - ") || bien.reference_interne || "Fiche investisseur",
      subtitle: "Analyse de Rentabilité",
      address: [bien.adresse, bien.code_postal, bien.ville].filter(Boolean).join(", "),
      dateEdition: new Date().toLocaleDateString("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric" }),
      lots: lotsPDF,
      surface: surfacePdf,
      logements: lotsPDF.length || v.general?.nombre_lots_cibles || "—",
      prixAchat: prixPdf,
      budgetTravaux: budgetTravauxPdf,
      coutTotal: coutTotalPdf,
      totLoyer: totLoyerPdf,
      totLoyerAn: totLoyerAnPdf,
      chargesAnnuelles: chargesPdf,
      annuiteS1: annuitePdf,
      mensualiteS1: mensualitePdf,
      cashflowS1: cfPdf,
      rendementBrutPct: rbPdf,
      rendementNetPct: rnPdf,
      pointEquilibreMois: pePdf,
      margeSecuritePct: margePdf,
      totalGestionMois: lotsPDF.reduce((s,l)=>s+(Number(l.gestion)||0),0),
      apportS1: apportPdf,
      tauxS1: tauxPdf,
      dureeS1: dureePdf,
      description: desc,
      travaux,
      atouts,
      recommandation: v.conclusion?.recommandation || (cfPdf >= 0 && rbPdf >= 8 ? "Opportunité à approfondir" : "Analyse à confirmer"),
    });
  };

  const quitterFicheBien = async () => {
    if (ficheTab === "fiche" && ficheVisiteRef.current?.sauvegarder) {
      await ficheVisiteRef.current.sauvegarder({ refresh:false });
    }
    onRetour();
  };

  const changerOngletFiche = async (key) => {
    if (ficheTab === "fiche" && key !== "fiche" && ficheVisiteRef.current?.sauvegarder) {
      await ficheVisiteRef.current.sauvegarder({ refresh:false });
      await charger();
    }
    setFicheTab(key);
  };

  const ClientsAssociesCard = () => (
    <div className="inv-card">
      <div className="inv-card-hd" style={{ justifyContent:"space-between" }}>
        <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Users} size={13} strokeWidth={2.2}/>Clients associés ({props.length})</span>
        <button className="inv-btn inv-btn-sm" style={{ background:"rgba(255,255,255,0.15)", color:"black", border:"none" }} onClick={() => setShowProp(true)}>＋ Proposer</button>
      </div>
      <div className="inv-card-bd">
        {props.length === 0 ? (
          <div style={{ fontSize:13, color:T.textMuted, fontStyle:"italic", textAlign:"center", padding:"16px 0" }}>Aucun client associé</div>
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
  );

  return (
    <div style={{ padding:"24px 28px", maxWidth:1420, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
        <button className="inv-btn inv-btn-out inv-btn-sm" onClick={quitterFicheBien}>← Stock de biens</button>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:22, fontWeight:800, color:T.text }}>{bien.adresse||"Bien sans adresse"}</div>
          <div style={{ fontSize:13, color:T.textSub, marginTop:2 }}>
            {bien.reference_interne ? <span style={{color:T.accent,fontWeight:800,marginRight:8}}>{bien.reference_interne}</span> : null}
            {bien.ville||""}{bien.code_postal ? ` ${bien.code_postal}` : ""}{bien.agence ? ` · ${bien.agence}` : ""}
          </div>
        </div>
        <span style={{ background:`${couleur}18`, color:couleur, border:`1px solid ${couleur}33`, borderRadius:20, padding:"4px 14px", fontSize:12, fontWeight:700 }}>{bien.statut}</span>
        {ficheTab === "fiche" && (
          <button
            className="inv-btn inv-btn-gold inv-btn-sm"
            onClick={() => ficheVisiteRef.current?.sauvegarder?.()}
            disabled={visiteSaveState.saving}
            title="Enregistrer la fiche visite"
          >
            <Icon as={Save} size={12} strokeWidth={2.2}/>
            {visiteSaveState.saving ? "Sauvegarde…" : visiteSaveState.saved ? "Sauvegardé" : "Enregistrer"}
          </button>
        )}
        <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={genererPresentationClientPDF} title="Générer la fiche client investisseur">
          <Icon as={Sparkles} size={12} strokeWidth={2.2}/> Fiche client
        </button>
        <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => setShowEdit(true)}>
          <Icon as={Pencil} size={12} strokeWidth={2.2}/> Modifier
        </button>
        <button
          className="inv-btn inv-btn-blue inv-btn-sm"
          onClick={validerGeolocalisationBien}
          disabled={geolocatingBien}
          title="Valider et enregistrer les coordonnées Google Maps à partir de l'adresse"
        >
          <Icon as={geolocatingBien ? RefreshCw : MapPin} size={12} strokeWidth={2.2} style={geolocatingBien ? {animation:"spin 1s linear infinite"} : undefined}/>
          {geolocatingBien ? "Géoloc…" : "Valider géoloc."}
        </button>
        <button className="inv-btn inv-btn-danger inv-btn-sm" onClick={async () => {
          if (!window.confirm(`Supprimer ce bien (${bien.adresse||"sans adresse"}) ? Cette action est irréversible.`)) return;
          await supabase.from("invest_propositions").delete().eq("bien_id", id);
          await supabase.from("invest_biens").delete().eq("id", id);
          onRetour();
        }}><Icon as={Trash2} size={12} strokeWidth={2.2}/> Supprimer</button>
      </div>

      {geoMessageBien && (
        <div style={{
          marginBottom:16, padding:"10px 13px", borderRadius:RADIUS.md,
          background: geoMessageBien.startsWith("Géolocalisation validée") ? SEMANTIC.success.bg : SEMANTIC.warning.bg,
          border:`1px solid ${geoMessageBien.startsWith("Géolocalisation validée") ? SEMANTIC.success.border : SEMANTIC.warning.border}`,
          color: geoMessageBien.startsWith("Géolocalisation validée") ? SU : WA,
          fontSize:FONT.sm.size+1, fontWeight:700,
        }}>
          {geoMessageBien}
        </div>
      )}

      <div style={{ display:"flex", gap:4, marginBottom:18, borderBottom:`1px solid ${T.border}`, paddingBottom:8, flexWrap:"wrap" }}>
        {[
          ["fiche", "Fiche visite", FileText],
          ["terrain", "Visite terrain", PhoneIcon],
          ["simulateur", "Simulateur", BarChart3],
        ].map(([key,label,IconComp]) => (
          <button key={key}
            onClick={() => changerOngletFiche(key)}
            style={{
              padding:"8px 18px", border:"none", borderRadius:6, cursor:"pointer",
              fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:800,
              letterSpacing:.6, textTransform:"uppercase", display:"inline-flex", alignItems:"center", gap:7,
              background: ficheTab===key ? T.accent : "transparent",
              color: ficheTab===key ? T.onAccent : T.textSub,
              transition:"all .15s",
            }}>
            <Icon as={IconComp} size={13} strokeWidth={2.2}/> {label}
          </button>
        ))}
      </div>

      {ficheTab === "fiche" && (
        <div className="inv-card" style={{marginBottom:16}}>
          <div className="inv-card-hd blue">
            <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Sparkles} size={13} strokeWidth={2.2}/>Synthèse rapide du bien</span>
          </div>
          <div className="inv-card-bd">
            <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:10}}>
              <div className="inv-kpi" style={{padding:12}}>
                <div className="inv-kpi-lbl">Référence</div>
                <div className="inv-kpi-val accent" style={{fontSize:18}}>{bien.reference_interne || "—"}</div>
              </div>
              <div className="inv-kpi" style={{padding:12}}>
                <div className="inv-kpi-lbl">Prix affiché</div>
                <div className="inv-kpi-val" style={{fontSize:18}}>{fmtEur(bien.prix_vente || generalBien.prix_affiche)}</div>
              </div>
              <div className="inv-kpi" style={{padding:12}}>
                <div className="inv-kpi-lbl">Offre / prix cible</div>
                <div className="inv-kpi-val orange" style={{fontSize:18}}>{fmtEur(bien.montant_offre || conclusionBien.prix_offre_recommande || financeBien.prix_acquisition_negocie)}</div>
              </div>
              <div className="inv-kpi" style={{padding:12}}>
                <div className="inv-kpi-lbl">Rendement brut</div>
                <div className="inv-kpi-val green" style={{fontSize:18}}>{bien.rendement_brut ? Number(bien.rendement_brut).toFixed(1)+" %" : (financeBien.rendement_brut_calcule ? Number(financeBien.rendement_brut_calcule).toFixed(1)+" %" : "—")}</div>
              </div>
              <div className="inv-kpi" style={{padding:12}}>
                <div className="inv-kpi-lbl">Recommandation</div>
                <div className={`inv-kpi-val ${conclusionBien.recommandation === "Abandonner" ? "red" : "green"}`} style={{fontSize:18}}>{conclusionBien.recommandation || "À compléter"}</div>
              </div>
              <div className="inv-kpi" style={{padding:12}}>
                <div className="inv-kpi-lbl">Note dossier</div>
                <div className="inv-kpi-val accent" style={{fontSize:18}}>{conclusionBien.note_globale ? `${conclusionBien.note_globale}/10` : "—"}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {ficheTab === "simulateur" ? (
        <Simulateur
          key={`${id}-${bien.visite_data?.simulateur_updated_at || bien.updated_at || "sim"}`}
          projet={simulateurProjetBien}
          profil={profil}
          embedded={true}
          bienId={id}
          bienSource={bien}
          onBienSaved={charger}
          onRetour={() => setFicheTab("fiche")}
          theme={currentTheme}
          setTheme={null}
        />
      ) : ficheTab === "terrain" ? (
        <ModeVisiteTerrainOnglet bien={bien} profil={profil} T={T} onSaved={charger} />
      ) : (
      <div style={{ display:"grid", gridTemplateColumns:"0.82fr 1.18fr", gap:16, alignItems:"start" }}>
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <ClientsAssociesCard />
          <AutoScoreBienCard bien={bien} T={T} />
          <AnalyseRapideBienCard bien={bien} T={T} onSaved={charger} />
          <div className="inv-card">
            <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={PhoneIcon} size={13}/>Visite terrain</span></div>
            <div className="inv-card-bd">
              <div style={{fontSize:FONT.sm.size+1,color:T.textSub,lineHeight:1.55,marginBottom:10}}>Ouvrez l’onglet dédié pour remplir rapidement la visite sur mobile, avec checklist et décision immédiate.</div>
              <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => setFicheTab("terrain")} style={{width:"100%",justifyContent:"center"}}>Ouvrir la visite terrain</button>
            </div>
          </div>
          <MatchingClientsBienCard bien={bien} clients={clients} propositions={props} T={T} onAssociate={associerClientMatching} />

          <div className="inv-card">
            <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Home} size={13} strokeWidth={2.2}/>Informations</span></div>
            <div className="inv-card-bd">
              {[["Référence Profero", bien.reference_interne || "—"],["Géolocalisation", (isValidLatLng(parseFloat(bien.latitude), parseFloat(bien.longitude)) ? `${parseFloat(bien.latitude).toFixed(6)}, ${parseFloat(bien.longitude).toFixed(6)}` : "À valider")],["Interlocuteur", bien.interlocuteur],["Téléphone", bien.telephone_interlocuteur],["Source", bien.source_bien || bien.visite_data?.identification?.source],["Conseiller", bien.conseiller_profero || bien.visite_data?.identification?.conseiller_profero],["Lien annonce", bien.lien_annonce ? <a href={bien.lien_annonce} target="_blank" rel="noreferrer" style={{color:T.accent}}>Voir l'annonce ↗</a> : "—"],["Date visite", fmtDate(bien.date_visite)],["Date relance", fmtDate(bien.date_relance)],["Statut relance", bien.statut_relance||"—"]].map(([l,v])=>(
                <div key={l} className="inv-row"><span className="inv-lbl">{l}</span><span className="inv-val calc">{v||"—"}</span></div>
              ))}
            </div>
          </div>

          <div className="inv-card">
            <div className="inv-card-hd gold"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Wallet} size={13} strokeWidth={2.2}/>Données Financières</span></div>
            <div className="inv-card-bd">
              {[["Prix de vente", fmtEur(bien.prix_vente)],["Prix travaux", fmtEur(bien.prix_travaux)],["Coût total", fmtEur(bien.cout_total)],["Montant offre", fmtEur(bien.montant_offre)],["Rendement brut", bien.rendement_brut > 0 ? bien.rendement_brut.toFixed(1)+"%" : "—"],["Cash-flow estimé", bien.cashflow_estime ? fmtEur(bien.cashflow_estime)+"/mois" : "—"]].map(([l,v])=>(
                <div key={l} className="inv-row"><span className="inv-lbl">{l}</span><span className="inv-val calc" style={{fontFamily:"'DM Mono',monospace",fontWeight:700}}>{v}</span></div>
              ))}
              {(bien.lien_drive || bien.lien_rentabilite) && (
                <div style={{ marginTop:12, display:"flex", gap:8, flexWrap:"wrap" }}>
                  {bien.lien_drive && <a href={bien.lien_drive} target="_blank" rel="noreferrer" className="inv-btn inv-btn-out inv-btn-sm" style={{color:T.accent,borderColor:T.accentBorder}}><Icon as={FileText} size={12} strokeWidth={2.2}/> Dossier Drive <Icon as={ExternalLink} size={10}/></a>}
                  {bien.lien_rentabilite && <a href={bien.lien_rentabilite} target="_blank" rel="noreferrer" className="inv-btn inv-btn-out inv-btn-sm" style={{color:T.accent,borderColor:T.accentBorder}}><Icon as={BarChart3} size={12} strokeWidth={2.2}/> Rentabilité <Icon as={ExternalLink} size={10}/></a>}
                </div>
              )}
            </div>
          </div>
          {bien.commentaire && (
            <div className="inv-card">
              <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={MessageSquare} size={13} strokeWidth={2.2}/>Commentaire</span></div>
              <div className="inv-card-bd" style={{ fontSize:13, color:T.textSub, lineHeight:1.7 }}>{bien.commentaire}</div>
            </div>
          )}

          <OffreAchatBienCard bien={bien} T={T} onSaved={charger} />
          <ChecklistDocumentsBienCard bien={bien} T={T} onSaved={charger} />
          <DocumentsSection folder={`biens/${id}`} T={T} categories={DOCUMENT_CATEGORIES_BIEN} />
          <HistoriqueBienCard bien={bien} propositions={props} T={T} />
        </div>

        <FicheVisiteBien ref={ficheVisiteRef} bien={bien} profil={profil} T={T} onSaved={charger} onSaveStateChange={setVisiteSaveState} />
      </div>
      )}

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
      <div style={{ display:"flex", gap:4, marginBottom:24, borderBottom:`1px solid ${T.border}`, paddingBottom:8, flexWrap:"wrap" }}>
        {[["utilisateurs","👥 Utilisateurs"],["acces","🔒 Accès"],["apparence","🎨 Apparence"]].map(([k,l])=>(
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

      {/* Onglet Accès — composant partagé avec les Réglages Rénovation */}
      {onglet === "acces" && (
        <OngletAcces T={T} acc={{ accent: T.accent, onAccent: "#fff", bg10: T.accentBg }}/>
      )}

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
  const [invBranches, setInvBranches]   = useState(["invest"]);
  const [invLoading, setInvLoading]     = useState(false);
  const [editId, setEditId]             = useState(null);
  const [editData, setEditData]         = useState({});
  const [resetId, setResetId]           = useState(null);
  const [resetEmail, setResetEmail]     = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  // Liste de rôles chargée dynamiquement (union Réno + Invest).
  const [ROLES, setROLES] = useState([
    { value:"admin",      label:"Administrateur" },
    { value:"conducteur", label:"Conducteur de travaux" },
    { value:"commercial", label:"Commercial" },
    { value:"comptable",  label:"Comptable" },
  ]);
  const [ROLE_LABELS, setRoleLabels] = useState({ admin:"Administrateur", conducteur:"Conducteur de travaux", commercial:"Commercial", comptable:"Comptable" });
  const [ROLE_COLORS, setRoleColors] = useState({ admin:"#FFC200", conducteur:"#50c878", commercial:"#4db8ff", comptable:"#c084fc" });
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadAccessConfig("renovation"), loadAccessConfig("invest")]).then(([reno, inv]) => {
      if (cancelled) return;
      const seen = new Map();
      for (const r of reno.roles) if (!seen.has(r.id)) seen.set(r.id, r);
      for (const r of inv.roles)  if (!seen.has(r.id)) seen.set(r.id, r);
      const arr = Array.from(seen.values());
      setROLES(arr.map(r => ({ value: r.id, label: r.label })));
      setRoleLabels(Object.fromEntries(arr.map(r => [r.id, r.label])));
      setRoleColors(Object.fromEntries(arr.map(r => [r.id, r.color])));
    });
    return () => { cancelled = true; };
  }, []);
  const BRANCHES = [
    { value:"renovation", label:"Rénovation" },
    { value:"invest",     label:"Invest" },
  ];
  const BRANCHE_LABELS = { renovation:"Rénovation", invest:"Invest" };

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
      setInvEmail(""); setInvNom(""); setInvRole("conducteur"); setInvBranches(["invest"]);
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
                  <div style={{ width:38, height:38, borderRadius:10, flexShrink:0, background:`${(ROLE_COLORS[u.role] || "#888888")}22`, border:`1.5px solid ${(ROLE_COLORS[u.role] || "#888888")}55`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:800, color:(ROLE_COLORS[u.role] || "#888888") }}>
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
                      <span style={{ fontSize:11, padding:"2px 8px", borderRadius:4, fontWeight:700, background:`${(ROLE_COLORS[u.role] || "#888888")}18`, color:(ROLE_COLORS[u.role] || "#888888"), border:`1px solid ${(ROLE_COLORS[u.role] || "#888888")}33` }}>
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
                    <button className="inv-btn inv-btn-out inv-btn-sm" onClick={()=>{ setEditId(u.id); setEditData({nom:u.nom,role:u.role,branches:u.branches||["invest"]}); }}>✏️ Modifier</button>
                    <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={()=>{ setResetId(u.id); setResetEmail(u.email); }}><Icon as={RefreshCw} size={12} strokeWidth={2.2}/> Réinit.</button>
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
            <div style={{
              width:52, height:52, borderRadius:"50%", margin:`0 auto ${SPACING.md-2}px`,
              background:THEMES_INV.dark.accentBg, border:`2px solid ${THEMES_INV.dark.accentBorder}`,
              display:"flex", alignItems:"center", justifyContent:"center", color:THEMES_INV.dark.accent,
            }}><Icon as={RefreshCw} size={24} strokeWidth={2}/></div>
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


// ─── SUIVI FINANCIER PROFERO INVEST ──────────────────────────────────────────
const SUIVI_FIN_MONTHS = ["Déc. 25","Jan. 26","Fév. 26","Mar. 26","Avr. 26","Mai 26","Juin 26","Juil. 26","Août 26","Sep. 26","Oct. 26","Nov. 26","Dec. 26","Janv. 27","Fev. 27","Mars 27"];
const SUIVI_FIN_DEFAULT = {
  "version": 1,
  "params": {
    "tauxIS": 15,
    "tvaCollecteePct": 20,
    "tresoDepart": 3200,
    "objectifTreso": 30000,
    "objectifCA": 100000,
    "forfaitFixeHT": 1583.33,
    "commissionPctGain": 50
  },
  "commercial": {
    "pipeline": [
      {
        "id": "r7",
        "label": "Prospects contactés",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r8",
        "label": "1ers RDV réalisés",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r9",
        "label": "Signatures contrats",
        "values": [
          4.0,
          4.0,
          1.0,
          1.0,
          4.0,
          1.0,
          0.0,
          0.0,
          0.0,
          0.0,
          0.0,
          0.0,
          0.0,
          0.0,
          0.0,
          0.0
        ]
      }
    ],
    "forfaits": [
      {
        "id": "r11",
        "label": "Tom & Camille",
        "values": [
          1250.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r12",
        "label": "Artur F.",
        "values": [
          1250.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r13",
        "label": "Louison",
        "values": [
          1583.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r14",
        "label": "Alex & Delphine",
        "values": [
          1250.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r15",
        "label": "Thibault Martin",
        "values": [
          0,
          1583.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r16",
        "label": "Pierre Poilvilain",
        "values": [
          0,
          1583.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r17",
        "label": "Thomas Legault",
        "values": [
          0,
          1583.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r18",
        "label": "Jules Landais",
        "values": [
          0,
          1583.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r19",
        "label": "Raphael Sanyas",
        "values": [
          0,
          0,
          1583.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r20",
        "label": "Fabien Norniella",
        "values": [
          0,
          0,
          0,
          1583.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r21",
        "label": "Marius Chaillou (SARL CHAIL'HOME)",
        "values": [
          0,
          0,
          0,
          0,
          1583.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r22",
        "label": "William Anitei",
        "values": [
          0,
          0,
          0,
          0,
          1583.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r23",
        "label": "Léo/Léa",
        "values": [
          0,
          0,
          0,
          0,
          1583.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r24",
        "label": "Mathieu Rabineau",
        "values": [
          0,
          0,
          0,
          0,
          0.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r25",
        "label": "Maelys et lukas",
        "values": [
          0,
          0,
          0,
          0,
          0,
          1583.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r26",
        "label": "Prévisions futures (€)",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      }
    ],
    "negociation": [
      {
        "id": "r29",
        "label": "Tom & Camille",
        "values": [
          0,
          0,
          0,
          0,
          10833.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r30",
        "label": "Artur F.",
        "values": [
          0,
          3125.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r31",
        "label": "Louison",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          3932.5,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r32",
        "label": "Alex & Delphine",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r33",
        "label": "Thibault Martin",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r34",
        "label": "Pierre Poilvilain",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r35",
        "label": "Thomas Legault",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r36",
        "label": "Jules Landais",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r37",
        "label": "Raphael Sanyas",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          10416.67,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r38",
        "label": "Fabien Norniella",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r39",
        "label": "Marius Chaillou (SARL CHAIL'HOME)",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r40",
        "label": "William Anitei",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r41",
        "label": "Léo/Léa",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r42",
        "label": "Mathieu Rabineau",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r43",
        "label": "Maelys et Lukas",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r44",
        "label": "Prévisions futures (€)",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      }
    ],
    "autres": [
      {
        "id": "r47",
        "label": "Autres recettes (à définir)",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r48",
        "label": "Prévisions futures",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      }
    ]
  },
  "finance": {
    "chargesFixes": [
      {
        "id": "r6",
        "label": "Alimentaire / repas",
        "values": [
          438.6,
          666.31,
          636.22,
          530.05,
          794.65,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r7",
        "label": "Quote-part Loyer",
        "values": [
          0.0,
          0.0,
          0.0,
          0.0,
          0.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r8",
        "label": "Expert-comptable",
        "values": [
          0,
          0,
          382.8,
          382.8,
          382.8,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r9",
        "label": "Rémunération TOM",
        "values": [
          0.0,
          0.0,
          0.0,
          0.0,
          0.0,
          500.0,
          1258.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r10",
        "label": "Rémunération MF",
        "values": [
          0.0,
          0.0,
          0.0,
          0.0,
          0.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r11",
        "label": "Autres charges fixes",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      }
    ],
    "chargesVariables": [
      {
        "id": "r14",
        "label": "Prospection FLUIDIFY",
        "values": [
          1692.0,
          1692.0,
          1692.0,
          1692.0,
          1692.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r15",
        "label": "Licences Fluidify",
        "values": [
          339.5,
          339.5,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r16",
        "label": "Sales Navigator",
        "values": [
          99.99,
          99.99,
          99.99,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r17",
        "label": "LEMLIST (emailing)",
        "values": [
          435.18,
          48.6,
          352.98,
          48.6,
          48.6,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r18",
        "label": "Carburant / déplacements",
        "values": [
          342.86,
          264.33,
          196.17,
          223.79,
          353.11,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r20",
        "label": "Frais bureau / logiciels",
        "values": [
          240.06,
          27.6,
          164.19,
          108.2,
          437.66,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r21",
        "label": "Depenses exceptionnelles",
        "values": [
          276.2,
          37.0,
          0,
          3795.79,
          49.86,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r24",
        "label": "Autres dépenses variables",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      }
    ],
    "tvaDeductible": [
      {
        "id": "r47",
        "label": "TVA déductible (sur achats TTC)",
        "values": [
          772.88,
          635.07,
          704.87,
          1356.25,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      }
    ]
  }
};

const cloneSuiviFinancier = () => JSON.parse(JSON.stringify(SUIVI_FIN_DEFAULT));
const finEvalExpression = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/^=/, "").replace(/€/g, "").replace(/\s/g, "").replace(/,/g, ".");
  if (!/^[0-9+\-*/().]+$/.test(cleaned)) return parseFloat(cleaned) || 0;
  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${cleaned});`)();
    return Number.isFinite(result) ? result : 0;
  } catch { return parseFloat(cleaned) || 0; }
};
const finNum = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  return finEvalExpression(v);
};
const finSum = (arr) => (arr || []).reduce((s, v) => s + finNum(v), 0);
const finVec = () => SUIVI_FIN_MONTHS.map(() => 0);
const finEmptyVec = () => SUIVI_FIN_MONTHS.map(() => "");
const finIsZeroLike = (v) => v === 0 || v === "0" || v === "0.0" || v === "0.00";
const FIN_START_YEAR = 2025;
const FIN_START_MONTH = 11; // Décembre 2025, mois JS 0-11
const finMonthIndexFromDate = (value) => {
  if (!value) return -1;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return -1;
  const idx = (d.getFullYear() - FIN_START_YEAR) * 12 + d.getMonth() - FIN_START_MONTH;
  return idx >= 0 && idx < SUIVI_FIN_MONTHS.length ? idx : -1;
};
const finClientName = (c) => `${c?.prenom || ""} ${c?.nom || ""}`.trim() || c?.email || "Client sans nom";
const finMergeSignedClients = (source, clients = []) => {
  const next = JSON.parse(JSON.stringify(source || cloneSuiviFinancier()));
  next.commercial = next.commercial || {};
  next.commercial.pipeline = next.commercial.pipeline || [];
  next.commercial.forfaits = next.commercial.forfaits || [];
  const forfait = finNum(next.params?.forfaitFixeHT ?? 1583.33);
  const signedClients = (clients || []).filter(c => !!c.date_signature);
  const existingByClientId = new Set(next.commercial.forfaits.map(r => r.auto_client_id).filter(Boolean));
  const normalizeName = (v) => String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const existingNames = new Set(next.commercial.forfaits.map(r => normalizeName(r.label)).filter(Boolean));
  signedClients.forEach(c => {
    const clientLabel = finClientName(c);
    const clientKey = normalizeName(clientLabel);
    if (existingByClientId.has(c.id) || existingNames.has(clientKey)) return;
    const mi = finMonthIndexFromDate(c.date_signature);
    if (mi < 0) return;
    const values = finEmptyVec();
    values[mi] = forfait;
    next.commercial.forfaits.push({
      id: `auto_client_${c.id}`,
      auto_client_id: c.id,
      label: clientLabel,
      values,
      payment_status: ""
    });
    existingByClientId.add(c.id);
    existingNames.add(clientKey);
  });
  const counts = finVec();
  signedClients.forEach(c => { const mi = finMonthIndexFromDate(c.date_signature); if (mi >= 0) counts[mi] += 1; });
  let sigRow = next.commercial.pipeline.find(r => String(r.label || "").toLowerCase().includes("signature"));
  if (!sigRow) {
    sigRow = { id:`auto_signatures_${Date.now()}`, label:"Signatures contrats", values:finVec() };
    next.commercial.pipeline.push(sigRow);
  }
  sigRow.values = SUIVI_FIN_MONTHS.map((_, i) => Math.max(finNum(sigRow.values?.[i]), counts[i]));
  return next;
};
const finRowsSum = (rows) => SUIVI_FIN_MONTHS.map((_, i) => (rows || []).reduce((s, r) => s + finNum(r.values?.[i]), 0));
const finAddVec = (...vectors) => SUIVI_FIN_MONTHS.map((_, i) => vectors.reduce((s, v) => s + finNum(v?.[i]), 0));
const finSubVec = (a, b) => SUIVI_FIN_MONTHS.map((_, i) => finNum(a?.[i]) - finNum(b?.[i]));
const finMulVec = (a, pct) => SUIVI_FIN_MONTHS.map((_, i) => finNum(a?.[i]) * finNum(pct) / 100);
const finPct = (num, den) => finNum(den) ? finNum(num) / finNum(den) : 0;
const finLastNonZero = (arr) => {
  for (let i = (arr || []).length - 1; i >= 0; i--) if (Math.abs(finNum(arr[i])) > 0.0001) return finNum(arr[i]);
  return 0;
};
const finEur = (v) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(finNum(v)) + " €";
const finPctFmt = (v) => Number.isFinite(v) ? (v * 100).toFixed(1).replace(".", ",") + " %" : "—";
const SUIVI_FIN_BILAN1_END_INDEX = 3;
const finBilan1 = (arr) => finSum((arr || []).slice(0, SUIVI_FIN_BILAN1_END_INDEX + 1));
const finTotalAnnuel = (arr) => finSum((arr || []).slice(SUIVI_FIN_BILAN1_END_INDEX + 1));
const finTvaRateForRow = (row) => /alimentaire|repas/i.test(String(row?.label || "")) ? 10 : 20;
const finTvaDeductibleRows = (finance = {}) => [
  ...(finance.chargesFixes || []), ...(finance.chargesVariables || [])
].map(r => ({ id:`tva_${r.id || r.label}`, label:r.label || "Charge", rate:finTvaRateForRow(r), values:SUIVI_FIN_MONTHS.map((_,i)=>finNum(r.values?.[i]) * finTvaRateForRow(r) / 100) }));


function calcSuiviFinancier(data) {
  const d = data || cloneSuiviFinancier();
  const p = d.params || {};
  const forfaits = finRowsSum(d.commercial?.forfaits);
  const negociation = finRowsSum(d.commercial?.negociation);
  const autres = finRowsSum(d.commercial?.autres);
  const ca = finAddVec(forfaits, negociation, autres);
  const chargesFixes = finRowsSum(d.finance?.chargesFixes);
  const chargesVariables = finRowsSum(d.finance?.chargesVariables);
  const decaissements = finAddVec(chargesFixes, chargesVariables);
  const margeBrute = finSubVec(ca, chargesVariables);
  const tauxMarge = SUIVI_FIN_MONTHS.map((_, i) => finPct(margeBrute[i], ca[i]));
  const rnAvantIS = finSubVec(margeBrute, chargesFixes);
  const impotIS = rnAvantIS.map(v => Math.max(0, finNum(v)) * finNum(p.tauxIS ?? 15) / 100);
  const rnApresIS = finSubVec(rnAvantIS, impotIS);
  const tauxRentabiliteNette = SUIVI_FIN_MONTHS.map((_, i) => finPct(rnApresIS[i], ca[i]));
  const tvaCollectee = finMulVec(ca.map(v => finNum(v) * 1.2), p.tvaCollecteePct ?? 20);
  const tvaDeductibleRows = finTvaDeductibleRows(d.finance || {});
  const tvaDeductible = finRowsSum(tvaDeductibleRows);
  const tvaNette = finSubVec(tvaCollectee, tvaDeductible);
  const treso = [];
  let current = finNum(p.tresoDepart ?? 0);
  ca.forEach((v, i) => { current += finNum(v) - finNum(decaissements[i]); treso.push(current); });
  const signatures = (d.commercial?.pipeline || []).find(r => String(r.label || "").toLowerCase().includes("signature"))?.values || finVec();
  const prospects = (d.commercial?.pipeline || []).find(r => String(r.label || "").toLowerCase().includes("prospect"))?.values || finVec();
  const rdv = (d.commercial?.pipeline || []).find(r => String(r.label || "").toLowerCase().includes("rdv"))?.values || finVec();
  return { forfaits, negociation, autres, ca, chargesFixes, chargesVariables, decaissements, margeBrute, tauxMarge, rnAvantIS, impotIS, rnApresIS, tauxRentabiliteNette, tvaCollectee, tvaDeductibleRows, tvaDeductible, tvaNette, treso, signatures, prospects, rdv };
}

function FinKPI({ label, value, sub, color, icon: IconComp, T }) {
  const c = color || T.accent;
  return (
    <div className="inv-kpi" style={{ display:"flex", flexDirection:"row", alignItems:"center", gap:SPACING.md, borderLeft:`3px solid ${c}` }}>
      {IconComp && <div style={{ width:38, height:38, borderRadius:RADIUS.md, flexShrink:0, background:`${c}18`, color:c, display:"flex", alignItems:"center", justifyContent:"center" }}><Icon as={IconComp} size={18} strokeWidth={2}/></div>}
      <div style={{ minWidth:0, flex:1 }}>
        <div className="inv-kpi-lbl">{label}</div>
        <div className="inv-kpi-val" style={{ color:c, fontSize:FONT.xl.size+2 }}>{value}</div>
        {sub && <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:3 }}>{sub}</div>}
      </div>
    </div>
  );
}

const finIsFormulaValue = (v) => {
  const raw = String(v ?? "").trim();
  if (!raw) return false;
  const cleaned = raw.replace(/^=/, "").replace(/€/g, "").replace(/\s/g, "").replace(/,/g, ".");
  return /[+*/()]/.test(cleaned) || /\d-\d/.test(cleaned);
};

function SuiviFinanceCell({ value, onChange, T, money=true, highlight=false }) {
  const [editing, setEditing] = useState(false);
  const raw = value ?? "";
  const hasFormula = finIsFormulaValue(raw);
  const displayValue = (raw === "" || finIsZeroLike(raw))
    ? ""
    : editing
      ? raw
      : money
        ? finEur(raw)
        : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(finNum(raw));
  return (
    <input
      className="inv-inp"
      type="text"
      inputMode="decimal"
      value={displayValue}
      title={hasFormula ? `Calcul : ${raw} = ${money ? finEur(raw) : finNum(raw)}` : "Cliquez pour saisir un montant ou un calcul, ex : 100+200"}
      onFocus={e => { setEditing(true); setTimeout(() => e.target.select?.(), 0); }}
      onBlur={() => setEditing(false)}
      onChange={e => onChange(e.target.value)}
      style={{ width:"100%", border:"none", borderLeft:`1px solid ${T.rowBorder}`, borderRadius:0, background:hasFormula && !editing ? T.accentBg : (highlight ? "rgba(34,197,94,0.08)" : "transparent"), color:hasFormula && !editing ? T.accent : T.textSub, padding:"7px 5px", fontSize:FONT.xs.size, textAlign:"right" }}
    />
  );
}

function SuiviFinanceTable({ title, rows, sectionPath, data, setData, scheduleSave, T, canAdd=true, money=true, showPaymentStatus=false, validatedMonths=null }) {
  const updateLabel = (idx, value) => {
    const next = JSON.parse(JSON.stringify(data));
    const [a,b] = sectionPath.split(".");
    next[a][b][idx].label = value;
    setData(next); scheduleSave(next);
  };
  const updateValue = (idx, monthIdx, value) => {
    const next = JSON.parse(JSON.stringify(data));
    const [a,b] = sectionPath.split(".");
    if (!next[a][b][idx].values) next[a][b][idx].values = finEmptyVec();
    next[a][b][idx].values[monthIdx] = value;
    setData(next); scheduleSave(next);
  };
  const updatePaymentStatus = (idx, value) => {
    const next = JSON.parse(JSON.stringify(data));
    const [a,b] = sectionPath.split(".");
    next[a][b][idx].payment_status = value;
    setData(next); scheduleSave(next);
  };
  const addRow = () => {
    const next = JSON.parse(JSON.stringify(data));
    const [a,b] = sectionPath.split(".");
    next[a][b].push({ id:`custom_${Date.now()}`, label:"Nouvelle ligne", values:finEmptyVec(), ...(showPaymentStatus ? { payment_status:"" } : {}) });
    setData(next); scheduleSave(next);
  };
  const removeRow = (idx) => {
    const next = JSON.parse(JSON.stringify(data));
    const [a,b] = sectionPath.split(".");
    next[a][b].splice(idx, 1);
    setData(next); scheduleSave(next);
  };
  const totals = finRowsSum(rows);
  const gridCols = `minmax(145px,1.35fr) repeat(${SUIVI_FIN_MONTHS.length}, minmax(38px,.65fr)) minmax(62px,.75fr) ${showPaymentStatus ? "minmax(82px,.75fr)" : ""} 26px`;
  const paymentBg = (r) => {
    if (!showPaymentStatus || finSum(r.values) <= 0) return "transparent";
    if (r.payment_status === "regle") return "rgba(34,197,94,0.10)";
    if (r.payment_status === "non_regle") return "rgba(239,68,68,0.08)";
    if (r.payment_status === "partiel") return "rgba(245,158,11,0.08)";
    return "transparent";
  };
  return (
    <div className="inv-card" style={{ marginBottom:SPACING.lg }}>
      <div className="inv-card-hd" style={{ justifyContent:"space-between" }}>
        <span>{title}</span>
        {canAdd && <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={addRow}><Icon as={Plus} size={12}/> Ajouter</button>}
      </div>
      <div className="inv-card-bd" style={{ padding:0, overflowX:"auto" }}>
        <div style={{ width:"100%", minWidth:920 }}>
          <div style={{ display:"grid", gridTemplateColumns:gridCols, gap:0, background:T.sectionHd, borderBottom:`1px solid ${T.border}` }}>
            <div style={{ padding:"8px 8px", fontSize:FONT.xs.size-1, color:T.textMuted, fontWeight:800, textTransform:"uppercase", letterSpacing:.8 }}>Poste</div>
            {SUIVI_FIN_MONTHS.map(m => <div key={m} style={{ padding:"8px 3px", fontSize:FONT.xs.size-2, color:T.textMuted, fontWeight:800, textAlign:"right" }}>{m}</div>)}
            <div style={{ padding:"8px 4px", fontSize:FONT.xs.size-1, color:T.accent, fontWeight:800, textAlign:"right" }}>Total</div>
            {showPaymentStatus && <div style={{ padding:"8px 4px", fontSize:FONT.xs.size-2, color:T.textMuted, fontWeight:800, textAlign:"center" }}>Paiement</div>}
            <div />
          </div>
          {(rows || []).map((r, ri) => (
            <div key={r.id || ri} style={{ display:"grid", gridTemplateColumns:gridCols, borderBottom:`1px solid ${T.rowBorder}`, alignItems:"center", background:paymentBg(r) }}>
              <input className="inv-inp" value={r.label || ""} onChange={e=>updateLabel(ri,e.target.value)} style={{ width:"100%", textAlign:"left", border:"none", background:"transparent", color:T.text, fontFamily:"inherit", fontWeight:600, fontSize:FONT.xs.size+1, padding:"7px 8px" }}/>
              {SUIVI_FIN_MONTHS.map((m, mi) => (
                <SuiviFinanceCell
                  key={m}
                  value={r.values?.[mi] ?? ""}
                  onChange={value => updateValue(ri, mi, value)}
                  T={T}
                  money={money}
                  highlight={!!validatedMonths?.[mi]}
                />
              ))}
              <div style={{ padding:"7px 4px", textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:FONT.xs.size, color:T.accent, fontWeight:700, borderLeft:`1px solid ${T.rowBorder}` }}>{money ? finEur(finSum(r.values)) : finSum(r.values)}</div>
              {showPaymentStatus && (
                <div style={{ padding:"3px 4px", borderLeft:`1px solid ${T.rowBorder}` }}>
                  <select className="inv-sel" value={r.payment_status || ""} onChange={e=>updatePaymentStatus(ri,e.target.value)} style={{ width:"100%", padding:"4px 5px", fontSize:FONT.xs.size-1 }}>
                    <option value="">—</option>
                    <option value="regle">Réglé</option>
                    <option value="non_regle">Non réglé</option>
                    <option value="partiel">Partiel</option>
                  </select>
                </div>
              )}
              <button title="Supprimer" onClick={()=>removeRow(ri)} style={{ background:"transparent", border:"none", color:T.textMuted, cursor:"pointer", padding:3 }}><Icon as={Trash2} size={12}/></button>
            </div>
          ))}
          <div style={{ display:"grid", gridTemplateColumns:gridCols, background:T.accentBg, borderTop:`1px solid ${T.accentBorder}`, alignItems:"center" }}>
            <div style={{ padding:"8px 8px", color:T.accent, fontWeight:800, fontSize:FONT.xs.size+1 }}>TOTAL</div>
            {totals.map((v, i) => <div key={i} style={{ padding:"8px 4px", textAlign:"right", fontFamily:"'DM Mono',monospace", color:T.accent, fontWeight:700, fontSize:FONT.xs.size }}>{money ? finEur(v) : v}</div>)}
            <div style={{ padding:"8px 4px", textAlign:"right", fontFamily:"'DM Mono',monospace", color:T.accent, fontWeight:800, fontSize:FONT.xs.size }}>{money ? finEur(finSum(totals)) : finSum(totals)}</div>
            {showPaymentStatus && <div />}
            <div />
          </div>
        </div>
      </div>
    </div>
  );
}

function SuiviTvaAutoTable({ rows, T, validatedMonths=null }) {
  const totals = finRowsSum(rows);
  return (
    <div className="inv-card" style={{ marginBottom:SPACING.lg }}>
      <div className="inv-card-hd blue"><span>TVA déductible automatique</span></div>
      <div className="inv-card-bd" style={{ padding:0, overflowX:"auto" }}>
        <div style={{ width:"100%", minWidth:920 }}>
          <div style={{ display:"grid", gridTemplateColumns:`minmax(145px,1.35fr) repeat(${SUIVI_FIN_MONTHS.length}, minmax(38px,.65fr)) minmax(62px,.75fr) 26px`, background:T.sectionHd }}>
            <div style={{ padding:"8px", color:T.textMuted, fontWeight:800, fontSize:FONT.xs.size }}>Poste / taux</div>
            {SUIVI_FIN_MONTHS.map(m => <div key={m} style={{ padding:"8px 3px", textAlign:"right", color:T.textMuted, fontWeight:800, fontSize:FONT.xs.size-2 }}>{m}</div>)}
            <div style={{ padding:"8px 5px", textAlign:"right", color:T.accent, fontWeight:800, fontSize:FONT.xs.size }}>Total</div><div/>
          </div>
          {(rows || []).filter(r => finSum(r.values) !== 0).map((r, idx) => (
            <div key={r.id || idx} style={{ display:"grid", gridTemplateColumns:`minmax(145px,1.35fr) repeat(${SUIVI_FIN_MONTHS.length}, minmax(38px,.65fr)) minmax(62px,.75fr) 26px`, borderBottom:`1px solid ${T.rowBorder}` }}>
              <div style={{ padding:"7px 8px", color:T.textSub, fontWeight:700, fontSize:FONT.xs.size+1 }}>{r.label} <span style={{color:T.accent}}>· {r.rate}%</span></div>
              {SUIVI_FIN_MONTHS.map((m, mi) => <div key={m} style={{ padding:"7px 4px", textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:FONT.xs.size, color:T.textSub, background:validatedMonths?.[mi] ? "rgba(34,197,94,0.08)" : "transparent" }}>{finEur(r.values?.[mi])}</div>)}
              <div style={{ padding:"7px 5px", textAlign:"right", fontFamily:"'DM Mono',monospace", color:T.accent, fontWeight:800, fontSize:FONT.xs.size }}>{finEur(finSum(r.values))}</div><div/>
            </div>
          ))}
          <div style={{ display:"grid", gridTemplateColumns:`minmax(145px,1.35fr) repeat(${SUIVI_FIN_MONTHS.length}, minmax(38px,.65fr)) minmax(62px,.75fr) 26px`, background:T.accentBg }}>
            <div style={{ padding:"8px", color:T.accent, fontWeight:800 }}>TOTAL TVA DÉDUCTIBLE</div>
            {totals.map((v,i)=><div key={i} style={{padding:"8px 4px", textAlign:"right", fontFamily:"'DM Mono',monospace", color:T.accent, fontWeight:700, fontSize:FONT.xs.size, background:validatedMonths?.[i] ? "rgba(34,197,94,0.08)" : "transparent"}}>{finEur(v)}</div>)}
            <div style={{padding:"8px 5px", textAlign:"right", fontFamily:"'DM Mono',monospace", color:T.accent, fontWeight:800, fontSize:FONT.xs.size}}>{finEur(finSum(totals))}</div><div/>
          </div>
        </div>
      </div>
    </div>
  );
}

function SuiviFinancier({ profil, T=THEMES_INV.dark }) {
  const [data, setData] = useState(() => cloneSuiviFinancier());
  const [tab, setTab] = useState("synthese");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const saveRef = useRef(null);
  const calc = calcSuiviFinancier(data);
  const params = data.params || {};

  const loadData = useCallback(async () => {
    setLoading(true); setError("");
    const [suiviRes, clientsRes] = await Promise.all([
      supabase.from("invest_suivi_financier").select("data").eq("id", "global").maybeSingle(),
      supabase.from("invest_clients").select("id,nom,prenom,email,statut,date_signature,created_at")
    ]);
    const { data: row, error } = suiviRes;
    if (error) {
      console.warn("Suivi financier non chargé:", error);
      setError("La table invest_suivi_financier n'est pas encore disponible. Lance la migration SQL fournie, puis recharge la page.");
    }
    const base = row?.data
      ? { ...cloneSuiviFinancier(), ...row.data, params: { ...cloneSuiviFinancier().params, ...(row.data.params || {}) } }
      : cloneSuiviFinancier();
    const merged = finMergeSignedClients(base, clientsRes.data || []);
    setData(merged);
    if (JSON.stringify(merged) !== JSON.stringify(base)) {
      await supabase.from("invest_suivi_financier").upsert({
        id:"global",
        data: merged,
        updated_at: new Date().toISOString(),
        updated_by: profil?.email || profil?.nom || null,
      });
    }
    setLoading(false);
  }, [profil]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => () => { if (saveRef.current) clearTimeout(saveRef.current); }, []);

  const sauvegarder = useCallback(async (payload = data, silent=false) => {
    setSaving(true); setError("");
    const { error } = await supabase.from("invest_suivi_financier").upsert({
      id:"global",
      data: payload,
      updated_at: new Date().toISOString(),
      updated_by: profil?.email || profil?.nom || null,
    });
    setSaving(false);
    if (error) {
      console.error("Erreur sauvegarde suivi financier", error);
      setError("Impossible d'enregistrer le suivi financier : " + (error.message || "erreur Supabase"));
      return;
    }
    if (!silent) { setSaved(true); setTimeout(()=>setSaved(false), 1800); }
  }, [data, profil]);

  const scheduleSave = useCallback((next) => {
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => sauvegarder(next, true), 900);
  }, [sauvegarder]);

  const updateParam = (key, value) => {
    const next = JSON.parse(JSON.stringify(data));
    next.params = { ...(next.params || {}), [key]: finNum(value) };
    setData(next); scheduleSave(next);
  };

  const toggleDecaissementValidation = (monthIdx) => {
    const next = JSON.parse(JSON.stringify(data));
    next.finance = next.finance || {};
    next.finance.validatedMonths = Array.isArray(next.finance.validatedMonths) ? next.finance.validatedMonths : SUIVI_FIN_MONTHS.map(() => false);
    next.finance.validatedMonths[monthIdx] = !next.finance.validatedMonths[monthIdx];
    setData(next); scheduleSave(next);
  };

  const DecaissementsValidationBar = () => {
    const validated = data.finance?.validatedMonths || [];
    return (
      <div className="inv-card" style={{ marginBottom:SPACING.lg }}>
        <div className="inv-card-hd green"><span>Validation des décaissements</span></div>
        <div className="inv-card-bd" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(76px,1fr))", gap:6 }}>
          {SUIVI_FIN_MONTHS.map((m, i) => {
            const ok = !!validated[i];
            return (
              <button key={m} className="inv-btn inv-btn-sm" onClick={() => toggleDecaissementValidation(i)}
                style={{ justifyContent:"center", background:ok ? "rgba(34,197,94,0.14)" : T.input, color:ok ? SU : T.textSub, border:`1px solid ${ok ? "rgba(34,197,94,0.35)" : T.border}` }}>
                {ok ? "✓ " : ""}{m}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const exportCsv = () => {
    const lines = [["Indicateur", ...SUIVI_FIN_MONTHS, "Total"]];
    const add = (label, arr) => lines.push([label, ...arr.map(v => finNum(v).toFixed(2)), finSum(arr).toFixed(2)]);
    add("CA HT", calc.ca); add("Charges fixes", calc.chargesFixes); add("Charges variables", calc.chargesVariables); add("Décaissements TTC", calc.decaissements); add("Marge brute", calc.margeBrute); add("Résultat avant IS", calc.rnAvantIS); add("Résultat après IS", calc.rnApresIS); add("TVA nette", calc.tvaNette); add("Trésorerie fin de mois", calc.treso);
    const csv = lines.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(";")).join("\n");
    const blob = new Blob([csv], { type:"text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = "suivi-financier-profero-invest.csv"; a.click(); URL.revokeObjectURL(url);
  };

  const totalCA = finSum(calc.ca);
  const totalDec = finSum(calc.decaissements);
  const totalRN = finSum(calc.rnApresIS);
  const tauxMargeAnnuel = finPct(finSum(calc.margeBrute), totalCA);
  const tauxRNAnnuel = finPct(totalRN, totalCA);
  const tresoActuelle = finLastNonZero(calc.treso);
  const objectifCA = finNum(params.objectifCA || 100000);
  const objectifTreso = finNum(params.objectifTreso || 30000);

  const SummaryTable = () => (
    <div className="inv-card">
      <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={BarChart3} size={13}/>Synthèse mensuelle calculée</span></div>
      <div className="inv-card-bd" style={{ padding:0, overflowX:"auto" }}>
        <div style={{ width:"100%", minWidth:980 }}>
          <div style={{ display:"grid", gridTemplateColumns:`minmax(170px,1.5fr) repeat(4,minmax(52px,.75fr)) minmax(78px,.9fr) repeat(${SUIVI_FIN_MONTHS.length-4},minmax(52px,.75fr)) minmax(82px,.95fr)`, background:T.sectionHd, borderBottom:`1px solid ${T.border}` }}>
            <div style={{ padding:"8px 9px", color:T.textMuted, fontWeight:800, fontSize:FONT.xs.size, textTransform:"uppercase" }}>Indicateur</div>
            {SUIVI_FIN_MONTHS.flatMap((m,i)=> i===SUIVI_FIN_BILAN1_END_INDEX ? [<div key={m} style={{padding:"8px 3px", textAlign:"right", color:T.textMuted, fontWeight:800, fontSize:FONT.xs.size-2}}>{m}</div>, <div key="bilan_header" style={{padding:"8px 4px", textAlign:"right", color:T.accent, background:T.accentBg, fontWeight:900, fontSize:FONT.xs.size-2}}>Bilan N°1</div>] : [<div key={m} style={{padding:"8px 3px", textAlign:"right", color:T.textMuted, fontWeight:800, fontSize:FONT.xs.size-2}}>{m}</div>])}
            <div style={{ padding:"8px 5px", textAlign:"right", color:T.accent, fontWeight:900, fontSize:FONT.xs.size-2 }}>Total annuel</div>
          </div>
          {[
            ["CA HT", calc.ca, "green"],
            ["Charges fixes", calc.chargesFixes, ""],
            ["Charges variables", calc.chargesVariables, ""],
            ["Décaissements TTC", calc.decaissements, "orange"],
            ["Marge brute", calc.margeBrute, "green"],
            ["Taux marge brute", calc.tauxMarge, "pct"],
            ["Résultat avant IS", calc.rnAvantIS, "green"],
            ["IS estimé", calc.impotIS, "orange"],
            ["Résultat après IS", calc.rnApresIS, "green"],
            ["Trésorerie fin de mois", calc.treso, "accent"],
            ["TVA nette à payer", calc.tvaNette, "orange"],
          ].map((row, ri) => (
            <div key={row[0]} style={{ display:"grid", gridTemplateColumns:`minmax(170px,1.5fr) repeat(4,minmax(52px,.75fr)) minmax(78px,.9fr) repeat(${SUIVI_FIN_MONTHS.length-4},minmax(52px,.75fr)) minmax(82px,.95fr)`, borderBottom:`1px solid ${T.rowBorder}`, background:ri===0?T.accentBg:"transparent" }}>
              <div style={{ padding:"9px 12px", color:ri===0?T.accent:T.textSub, fontWeight:800, fontSize:FONT.sm.size }}>{row[0]}</div>
              {row[1].flatMap((v, i) => { const cell = <div key={i} style={{ padding:"8px 4px", textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:FONT.xs.size, color:row[2]==="orange"?WA:row[2]==="green"?SU:row[2]==="accent"?T.accent:T.textSub }}>{row[2]==="pct" ? finPctFmt(v) : finEur(v)}</div>; if (i===SUIVI_FIN_BILAN1_END_INDEX) { const bv = row[2]==="pct" ? finPct(finBilan1(calc.margeBrute), finBilan1(calc.ca)) : finBilan1(row[1]); return [cell, <div key="bilan1" style={{ padding:"8px 5px", textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:FONT.xs.size, color:T.accent, fontWeight:800, background:T.accentBg }}>{row[2]==="pct" ? finPctFmt(bv) : finEur(bv)}</div>]; } return [cell]; })}
              <div style={{ padding:"9px 7px", textAlign:"right", fontFamily:"'DM Mono',monospace", fontWeight:800, color:T.accent, fontSize:FONT.xs.size }}>{row[2]==="pct" ? finPctFmt(finPct(finSum(calc.margeBrute.slice(4)), finSum(calc.ca.slice(4)))) : finEur(finTotalAnnuel(row[1]))}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (loading) return <div style={{ padding:40, color:T.textMuted }}>Chargement du suivi financier…</div>;

  return (
    <div style={{ padding:`${SPACING.xl}px ${SPACING.xl+4}px`, maxWidth:1600, margin:"0 auto" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:SPACING.md, marginBottom:SPACING.xl, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:SPACING.md }}>
          <div style={{ width:48, height:48, borderRadius:RADIUS.lg, background:T.accentBg, color:T.accent, display:"flex", alignItems:"center", justifyContent:"center" }}><Icon as={Euro} size={24}/></div>
          <div>
            <div style={{ fontSize:FONT.h2.size, fontWeight:800, color:T.text, letterSpacing:-0.3 }}>Suivi financier</div>
            <div style={{ fontSize:FONT.sm.size+1, color:T.textSub, marginTop:2 }}>Reprise du fichier Excel : suivi commercial, encaissements, décaissements, TVA automatique et résultat</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:SPACING.sm, alignItems:"center", flexWrap:"wrap" }}>
          {saving && <span style={{ fontSize:FONT.xs.size, color:T.textMuted }}>Sync…</span>}
          {saved && <span style={{ fontSize:FONT.xs.size, color:SU, fontWeight:700 }}>Sauvegardé</span>}
          <button className="inv-btn inv-btn-out inv-btn-sm" onClick={exportCsv}><Icon as={Download} size={12}/> Export CSV</button>
          <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={()=>sauvegarder(data)}><Icon as={Save} size={12}/> Enregistrer</button>
        </div>
      </div>

      {error && <div style={{ marginBottom:SPACING.md, padding:"10px 12px", borderRadius:RADIUS.md, border:`1px solid ${SEMANTIC.warning.border}`, background:SEMANTIC.warning.bg, color:WA, fontSize:FONT.sm.size+1 }}>{error}</div>}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))", gap:SPACING.md, marginBottom:SPACING.xl }}>
        <FinKPI T={T} icon={Euro} label="CA HT total" value={finEur(totalCA)} sub={`Objectif : ${finEur(objectifCA)} · ${finPctFmt(finPct(totalCA, objectifCA))}`} color={SU} />
        <FinKPI T={T} icon={Wallet} label="Décaissements" value={finEur(totalDec)} sub="Charges fixes + variables" color={WA} />
        <FinKPI T={T} icon={TrendingUp} label="Résultat après IS" value={finEur(totalRN)} sub={`Taux net : ${finPctFmt(tauxRNAnnuel)}`} color={totalRN >= 0 ? SU : DA} />
        <FinKPI T={T} icon={BarChart3} label="Marge brute" value={finPctFmt(tauxMargeAnnuel)} sub={finEur(finSum(calc.margeBrute))} color={T.accent} />
        <FinKPI T={T} icon={Wallet} label="Trésorerie actuelle" value={finEur(tresoActuelle)} sub={`Objectif : ${finEur(objectifTreso)}`} color={tresoActuelle >= objectifTreso ? SU : "#4db8ff"} />
        <FinKPI T={T} icon={FileText} label="TVA nette" value={finEur(finSum(calc.tvaNette))} sub="Collectée - déductible auto" color="#c084fc" />
      </div>

      <div className="inv-tab-nav" style={{ marginBottom:SPACING.lg, borderRadius:RADIUS.xl, overflow:"hidden", border:`1px solid ${T.border}` }}>
        {[["synthese","Synthèse"],["commercial","Commercial & encaissements"],["decaissements","Décaissements"],["params","Paramètres"]].map(([k,l]) => (
          <button key={k} className={`inv-tab-btn${tab===k?" active":""}`} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "synthese" && <SummaryTable />}
      {tab === "commercial" && <>
        <SuiviFinanceTable title="Pipeline commercial" rows={data.commercial?.pipeline || []} sectionPath="commercial.pipeline" data={data} setData={setData} scheduleSave={scheduleSave} T={T} canAdd={false} money={false} />
        <SuiviFinanceTable title="Encaissements — Forfaits clients HT" rows={data.commercial?.forfaits || []} sectionPath="commercial.forfaits" data={data} setData={setData} scheduleSave={scheduleSave} T={T} showPaymentStatus />
        <SuiviFinanceTable title="Encaissements — Honoraires négociation HT" rows={data.commercial?.negociation || []} sectionPath="commercial.negociation" data={data} setData={setData} scheduleSave={scheduleSave} T={T} showPaymentStatus />
        <SuiviFinanceTable title="Autres encaissements HT" rows={data.commercial?.autres || []} sectionPath="commercial.autres" data={data} setData={setData} scheduleSave={scheduleSave} T={T} showPaymentStatus />
      </>}
      {tab === "decaissements" && <>
        <DecaissementsValidationBar />
        <SuiviFinanceTable title="Charges fixes récurrentes" rows={data.finance?.chargesFixes || []} sectionPath="finance.chargesFixes" data={data} setData={setData} scheduleSave={scheduleSave} T={T} validatedMonths={data.finance?.validatedMonths || []} />
        <SuiviFinanceTable title="Charges variables opérationnelles" rows={data.finance?.chargesVariables || []} sectionPath="finance.chargesVariables" data={data} setData={setData} scheduleSave={scheduleSave} T={T} validatedMonths={data.finance?.validatedMonths || []} />
        <SuiviTvaAutoTable rows={calc.tvaDeductibleRows || []} T={T} validatedMonths={data.finance?.validatedMonths || []} />
      </>}
      {tab === "params" && (
        <div className="inv-card">
          <div className="inv-card-hd blue"><span>Paramètres de pilotage</span></div>
          <div className="inv-card-bd" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))", gap:SPACING.md }}>
            {[["tauxIS","Taux IS (%)"],["tvaCollecteePct","TVA collectée (%)"],["tresoDepart","Trésorerie de départ"],["objectifTreso","Objectif trésorerie"],["objectifCA","Objectif CA HT"],["forfaitFixeHT","Forfait fixe HT / client"],["commissionPctGain","Commission sur gain négo (%)"]].map(([key,label]) => (
              <div key={key}>
                <label style={{ fontSize:FONT.xs.size, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, fontWeight:800, display:"block", marginBottom:5 }}>{label}</label>
                <input className="inv-inp" type="number" value={params[key] ?? ""} onChange={e=>updateParam(key,e.target.value)} style={{ width:"100%" }}/>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ─── STRUCTURATION PATRIMONIALE ─────────────────────────────────────────────
const STRUCT_DOC_CATEGORIES = [
  { id:"identite", label:"Identité & situation personnelle", description:"État civil, domicile et situation familiale" },
  { id:"revenus", label:"Revenus & activité professionnelle", description:"Capacité de revenus et stabilité professionnelle" },
  { id:"engagements", label:"Charges & engagements financiers", description:"Crédits, charges et engagements hors bilan" },
  { id:"immobilier", label:"Patrimoine immobilier existant", description:"Détention, fiscalité, flux et financement des biens" },
  { id:"financier", label:"Patrimoine financier & retraite", description:"Épargne, placements, retraite et produits fiscaux" },
  { id:"bancaire", label:"Épargne & étude bancaire", description:"Apport, relevés et pièces nécessaires au financement" },
  { id:"structures", label:"Structures, fiscalité & transmission", description:"SCI, sociétés, IFI et cadre patrimonial" },
  { id:"mission", label:"Mission & conformité", description:"Contrat, consentement et mise en œuvre" },
];

const STRUCT_DOCS_DEFAULT = [
  { id:"piece_identite", categorie:"identite", label:"Pièce d'identité valide", required:true, statut:"À demander", commentaire:"" },
  { id:"justificatif_domicile", categorie:"identite", label:"Justificatif de domicile de moins de 3 mois", required:true, statut:"À demander", commentaire:"" },
  { id:"situation_familiale", categorie:"identite", label:"Livret de famille / justificatif de situation familiale", required:false, statut:"À demander", commentaire:"" },
  { id:"contrat_mariage", categorie:"identite", label:"Contrat de mariage / PACS / jugement de divorce", required:false, statut:"À demander", commentaire:"" },

  { id:"bulletins_salaire", categorie:"revenus", label:"3 derniers bulletins de salaire", required:false, statut:"À demander", commentaire:"Salarié" },
  { id:"contrat_travail", categorie:"revenus", label:"Contrat de travail / attestation employeur", required:false, statut:"À demander", commentaire:"Salarié" },
  { id:"avis_imposition", categorie:"revenus", label:"2 derniers avis d'imposition", required:true, statut:"À demander", commentaire:"" },
  { id:"bilans_entreprise", categorie:"revenus", label:"2 ou 3 derniers bilans comptables", required:false, statut:"À demander", commentaire:"TNS / chef d'entreprise" },
  { id:"liasse_fiscale", categorie:"revenus", label:"Dernière liasse fiscale", required:false, statut:"À demander", commentaire:"TNS / chef d'entreprise" },
  { id:"remuneration_dividendes", categorie:"revenus", label:"Attestation de rémunération et dividendes", required:false, statut:"À demander", commentaire:"Dirigeant" },
  { id:"urssaf", categorie:"revenus", label:"Attestation URSSAF", required:false, statut:"À demander", commentaire:"Indépendant" },
  { id:"kbis_statuts_pro", categorie:"revenus", label:"Extrait Kbis / statuts de société professionnelle", required:false, statut:"À demander", commentaire:"" },

  { id:"credits_en_cours", categorie:"engagements", label:"Liste des crédits en cours", required:true, statut:"À demander", commentaire:"" },
  { id:"tableau_credits", categorie:"engagements", label:"Échéanciers / tableaux d'amortissement des prêts", required:true, statut:"À demander", commentaire:"" },
  { id:"baux_quittances_perso", categorie:"engagements", label:"Baux et quittances de résidence principale", required:false, statut:"À demander", commentaire:"Si locataire" },
  { id:"pensions", categorie:"engagements", label:"Justificatifs de pensions versées ou reçues", required:false, statut:"À demander", commentaire:"" },
  { id:"charges_fixes", categorie:"engagements", label:"Charges fixes mensuelles principales", required:false, statut:"À demander", commentaire:"" },
  { id:"cautions", categorie:"engagements", label:"Cautions bancaires / garanties / avals", required:false, statut:"À demander", commentaire:"" },

  { id:"actes_notaries", categorie:"immobilier", label:"Actes de propriété de tous les biens", required:true, statut:"À demander", commentaire:"" },
  { id:"amortissements_immo", categorie:"immobilier", label:"Tableaux d'amortissement des crédits immobiliers", required:true, statut:"À demander", commentaire:"" },
  { id:"baux", categorie:"immobilier", label:"Baux locatifs et justificatifs de loyers", required:true, statut:"À demander", commentaire:"" },
  { id:"taxes_foncieres", categorie:"immobilier", label:"Taxes foncières des biens détenus", required:true, statut:"À demander", commentaire:"" },
  { id:"charges_copro", categorie:"immobilier", label:"Charges de copropriété et derniers PV d'AG", required:false, statut:"À demander", commentaire:"" },
  { id:"dpe_ddt", categorie:"immobilier", label:"Diagnostics, DPE et DDT", required:false, statut:"À demander", commentaire:"" },
  { id:"pno", categorie:"immobilier", label:"Assurances PNO / GLI", required:false, statut:"À demander", commentaire:"" },
  { id:"declarations_locatives", categorie:"immobilier", label:"Déclarations ou résultats locatifs / LMNP / foncier", required:false, statut:"À demander", commentaire:"" },

  { id:"releves_placements", categorie:"financier", label:"Relevés livrets et épargne", required:true, statut:"À demander", commentaire:"" },
  { id:"assurance_vie", categorie:"financier", label:"Relevés assurance-vie", required:false, statut:"À demander", commentaire:"" },
  { id:"pea_cto", categorie:"financier", label:"Comptes-titres / PEA", required:false, statut:"À demander", commentaire:"" },
  { id:"scpi_opci", categorie:"financier", label:"SCPI / OPCI / actifs immobiliers papier", required:false, statut:"À demander", commentaire:"" },
  { id:"per_retraite", categorie:"financier", label:"PER / épargne retraite / épargne salariale", required:false, statut:"À demander", commentaire:"" },
  { id:"produits_defiscalisants", categorie:"financier", label:"Produits défiscalisants en cours", required:false, statut:"À demander", commentaire:"Pinel, Denormandie, Malraux..." },

  { id:"releves_bancaires", categorie:"bancaire", label:"Relevés bancaires des 3 derniers mois", required:true, statut:"À demander", commentaire:"" },
  { id:"epargne_disponible", categorie:"bancaire", label:"Justificatif d'épargne disponible / apport", required:true, statut:"À demander", commentaire:"" },
  { id:"epargne_programmee", categorie:"bancaire", label:"Justificatifs d'épargne programmée", required:false, statut:"À demander", commentaire:"" },
  { id:"bonus_primes", categorie:"bancaire", label:"Bonus / primes / revenus exceptionnels", required:false, statut:"À demander", commentaire:"" },
  { id:"tresorerie_societe", categorie:"bancaire", label:"Trésorerie de société mobilisable", required:false, statut:"À demander", commentaire:"Investissement via structure" },
  { id:"situation_bancaire", categorie:"bancaire", label:"Relevé de situation bancaire / simulation existante", required:false, statut:"À demander", commentaire:"" },
  { id:"assurance_habitation", categorie:"bancaire", label:"Assurance habitation résidence principale", required:false, statut:"À demander", commentaire:"Étude bancaire" },
  { id:"rib", categorie:"bancaire", label:"RIB", required:false, statut:"À demander", commentaire:"" },

  { id:"statuts_societes", categorie:"structures", label:"Statuts SCI / sociétés de détention", required:false, statut:"À demander", commentaire:"" },
  { id:"kbis_sci", categorie:"structures", label:"Kbis / RIB / PV d'AG des SCI", required:false, statut:"À demander", commentaire:"" },
  { id:"bilans_sci", categorie:"structures", label:"Bilans et liasses fiscales des SCI / holdings", required:false, statut:"À demander", commentaire:"" },
  { id:"organigramme_detention", categorie:"structures", label:"Organigramme de détention actuel", required:false, statut:"À demander", commentaire:"" },
  { id:"declaration_ifi", categorie:"structures", label:"Déclaration IFI / éléments d'assiette", required:false, statut:"À demander", commentaire:"Si concerné" },
  { id:"deficits_reportables", categorie:"structures", label:"Déficits fonciers / amortissements reportables", required:false, statut:"À demander", commentaire:"" },

  { id:"contrat_mission", categorie:"mission", label:"Lettre de mission Structuration Patrimoniale signée", required:true, statut:"À demander", commentaire:"" },
  { id:"consentement_rgpd", categorie:"mission", label:"Consentement RGPD / certification des informations", required:true, statut:"À demander", commentaire:"" },
  { id:"rapport_restitution", categorie:"mission", label:"Rapport de restitution transmis", required:false, statut:"À demander", commentaire:"À l'issue de la phase 1" },
  { id:"pv_restitution", categorie:"mission", label:"Compte rendu de réunion de restitution", required:false, statut:"À demander", commentaire:"" },
];

const STRUCT_DEFAULT_LOTS = [
  { adresse:"", type:"T2", structure:"PP direct", regime:"Foncier réel", loyer_mois:"", mensualite:"", crd:"", valeur:"", charges_annuelles:"", travaux_a_prevoir:"" },
];

const firstStructValue = (...vals) => {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    return v;
  }
  return "";
};

const getStructClientStrategy = (client) => (
  client?.strategie_data ||
  client?.donnees_strategie ||
  client?.strategie ||
  client?.profil_investisseur ||
  {}
);

const getStructNested = (obj, ...keys) => {
  let cur = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== "object") return "";
    cur = cur[k];
  }
  return cur ?? "";
};

function buildStructDefault(client) {
  const strategie = getStructClientStrategy(client);
  const zones = firstStructValue(
    strategie?.zones, strategie?.zone_recherche, strategie?.zones_recherchees, strategie?.ville_recherchee,
    getStructNested(strategie, "recherche", "zones"), getStructNested(strategie, "criteres", "zones")
  );
  const objectifPrincipal = firstStructValue(
    strategie?.objectif_principal, strategie?.objectif, strategie?.strategie,
    getStructNested(strategie, "objectifs", "principal"),
    "Accélération patrimoniale"
  );
  const budgetClient = firstStructValue(
    client?.budget, strategie?.budget, strategie?.budget_max, strategie?.budget_global,
    getStructNested(strategie, "financement", "budget"), getStructNested(strategie, "criteres", "budget")
  );
  const apportClient = firstStructValue(
    strategie?.apport, strategie?.apport_disponible, getStructNested(strategie, "financement", "apport")
  );
  const rendementCible = firstStructValue(
    strategie?.rendement_cible, strategie?.rendement_minimum, getStructNested(strategie, "objectifs", "rendement_cible")
  );
  const fiscalite = firstStructValue(
    strategie?.fiscalite_recommandee, strategie?.fiscalite, strategie?.regime_fiscal, getStructNested(strategie, "fiscalite", "regime")
  );
  return {
    version: 1,
    collecte: {
      profil: {
        prenom: client?.prenom || "", nom: client?.nom || "", email: client?.email || "", telephone: client?.telephone || "", conseiller: client?.conseiller || "",
        source_crm: client?.source || "", statut_crm: client?.statut || "", budget_crm: budgetClient || "", etape_crm: client?.etape || "", notes_crm: client?.notes_rapides || "",
        date_naissance:"", age:"", adresse:"", situation_familiale:"", regime_matrimonial:"", contrat_mariage:"", enfants:"", enfants_details:"",
        profession:"", statut_pro:"", employeur:"", anciennete:"", revenus_nets_mois:"", revenus_conjoint_mois:"", revenus_locatifs_nets_mois:"", dividendes_an:"", autres_revenus_an:"", impot_revenu:"", tmi:"", residence_fiscale:"France", regime_locatif:"", dispositifs_fiscaux:"", deficit_foncier:"", ifi:"",
      },
      qualification: {
        date_r1:"", source_lead:"", prescripteur:"", origine_commentaire:"", objectif_classement:"", budget_min:"", budget_max:"", type_bien_vise:"", zone_geographique:"", niveau_levier:"", niveau_implication:"",
        charges_fixes_mois:"", credits_conso_mois:"", pensions_mois:"", engagements_hors_bilan:"", situation_bancaire:"RAS", accompagnements:"", niveau_complexite:"", justification_complexite:"", alertes:"", consentement_rgpd:"",
      },
      patrimoine: {
        residence_principale_statut:"", rp_valeur:"", rp_crd:"", residence_secondaire_valeur:"", patrimoine_professionnel:"", patrimoine_pro_commentaires:"", retraite:"", liberalites:"", lots: STRUCT_DEFAULT_LOTS.map(x=>({...x})),
      },
      financement: {
        banque_principale:"", relation_bancaire:"", mensualites_total:"", apport_disponible:apportClient || "", capacite_avec_revente:budgetClient || "", financable_sans_revente:"",
        taux_moyen:"", duree_initiale:"", premiere_echeance:"", bien_premiere_echeance:"", montant_libere_echeance:"", mensualite_max:"", epargne_precaution:"", refinancement_envisage:"",
      },
      structures: {
        sci_existante:"", sci_regime:fiscalite || "", sci_associes:"", sci_biens:"", sci_resultat:"", sci_optimisee:"", holding_envisagee:"", nouvelles_sci:"", transmission:"",
      },
      objectifs: {
        objectif_principal:objectifPrincipal || "Accélération patrimoniale", horizon:firstStructValue(strategie?.horizon, getStructNested(strategie, "objectifs", "horizon"), "15 ans"), rendement_cible:rendementCible || "", rythme_achat:firstStructValue(strategie?.rythme_achat, getStructNested(strategie, "objectifs", "rythme_achat")) || "", zones:Array.isArray(zones) ? zones.join(", ") : (zones || ""), gestion_locative:firstStructValue(strategie?.gestion_locative, getStructNested(strategie, "exploitation", "gestion_locative")) || "", temps_immo:"", delegation:"", travaux:firstStructValue(strategie?.travaux, getStructNested(strategie, "criteres", "travaux")) || "", protection_famille:"", revenus_immediats:"", valorisation_capital:"", transmission_priorite:"", reduction_impots:"", projets_3_5_ans:"",
      },
      patrimoine_financier: { liquidites:"", assurance_vie:"", pea_cto:"", per:"", epargne_salariale:"", autres:"" },
      rdv: { motivations:"", objections:"", notes:"", issue:"", relance:"", prochaine_action:"", date_r2:"", lieu_r2:"", documents_prioritaires:"", email_recap_date:"", signature_client:"" },
      documents: STRUCT_DOCS_DEFAULT.map(x=>({...x})),
    },
    analyse: {
      diagnostic:"", strategie_recommandee:"", points_attention:"", conclusion:"", analyse_performance:"", analyse_bancaire:"", analyse_fiscale:"", analyse_structure:"", analyse_transmission:"", analyse_risques:"", arbitrages:"", professionnels_a_mobiliser:"", hypothese_centrale:"",
      contexte_client:"", projet_etudie:"", investissement_total:"", cashflow_cible:"", revenus_exceptionnels:"",
      point_majeur:"", point_vigilance:"", strategie_fiscale:"", simulation_fiscale:"", capacite_emprunt:"",
      calendrier:"", points_forts:"", points_preparer:"", note_finale:"",
      scenarios: [
        { id:"s1", nom:"Conserver & optimiser", objectif:"Optimiser fiscalité, gestion et refinancement sans arbitrage majeur", statut:"À étudier" },
        { id:"s2", nom:"Arbitrer & réinvestir", objectif:"Céder les actifs peu performants pour reconstituer capacité d’emprunt", statut:"À étudier" },
        { id:"s3", nom:"Structurer en société", objectif:"SCI IS / Holding / démembrement selon objectifs de capitalisation et transmission", statut:"À étudier" },
      ],
      preconisations: [
        { id:"p1", axe:"Financement", priorite:"Haute", titre:"Clarifier la capacité d’emprunt résiduelle", detail:"Comparer la lecture bancaire actuelle avec un scénario d’arbitrage ou de refinancement.", action:"Collecter échéanciers et CRD exacts", statut:"À faire" },
        { id:"p2", axe:"Fiscalité", priorite:"Haute", titre:"Comparer IR / LMNP / SCI IS", detail:"Évaluer la charge fiscale actuelle et l’intérêt d’une structure à l’IS selon l’horizon et les flux.", action:"Reconstituer résultat fiscal par bien", statut:"À faire" },
        { id:"p3", axe:"Transmission", priorite:"Moyenne", titre:"Préparer la transmission du patrimoine immobilier", detail:"Étudier donation de parts, démembrement et SCI familiale si enfants / conjoint concernés.", action:"Valider situation familiale et objectifs", statut:"À faire" },
      ],
    },
  };
}

const STRUCT_STATUTS = ["Collecte", "Analyse", "Préconisations", "Restitution", "Phase 2", "Terminé"];
const STRUCT_PHASES = ["Phase 1 — Audit & Conseil", "Phase 2 — Suivi patrimonial", "Phase 1 + Phase 2"];
const STRUCT_DOC_STATUTS = ["À demander", "Demandé", "Reçu", "Validé", "À vérifier", "Non applicable"];
const STRUCT_LOT_TYPES = ["Studio","T1","T2","T3","T4","T5+","Commerce","Immeuble","SCPI","Autre"];
const STRUCT_DETENTION = ["PP direct","SCI IR","SCI IS","SARL famille","Holding SAS","Démembrement","Autre"];
const STRUCT_REGIMES = ["Foncier réel","Micro-foncier","LMNP réel","Micro-BIC","SCI IS","LMP","Non défini"];


// Champ stable utilisé par la page Structuration Patrimoniale.
// Important : il est défini hors du composant principal pour éviter que React
// démonte/remonte l'input à chaque frappe, ce qui faisait perdre le focus.
function StructField({ T=THEMES_INV.dark, label, value, onChange, type="text", placeholder="", options=null, wide=false, compact=false }) {
  const controlStyle = {
    width:"100%",
    minHeight: compact ? 34 : undefined,
    padding: compact ? "7px 9px" : undefined,
    background:T.input || "rgba(255,255,255,0.06)",
    color:T.text || "#f5f0e8",
    border:`1px solid ${T.border || "rgba(255,255,255,0.16)"}`,
    borderRadius:RADIUS.md,
    fontSize: compact ? FONT.xs.size + 1 : FONT.sm.size,
  };
  return (
    <div style={{ gridColumn: wide ? "1 / -1" : "auto", minWidth:0 }}>
      <label style={{ fontSize:FONT.xs.size, color:T.textSub || T.textMuted, textTransform:"uppercase", letterSpacing:1.1, fontWeight:900, display:"block", marginBottom:4 }}>{label}</label>
      {options ? (
        <select className="inv-sel" value={value || ""} onChange={e=>onChange(e.target.value)} style={controlStyle}>
          <option value="">—</option>{options.map(o=><option key={o} value={o}>{o}</option>)}
        </select>
      ) : type === "textarea" ? (
        <textarea className="inv-textarea" rows={compact ? 2 : 3} value={value || ""} placeholder={placeholder} onChange={e=>onChange(e.target.value)} style={{ ...controlStyle, minHeight:compact ? 58 : 82, resize:"vertical" }} />
      ) : (
        <input className="inv-inp" type={type} value={value || ""} placeholder={placeholder} onChange={e=>onChange(e.target.value)} style={{ ...controlStyle, textAlign:type === "number" ? "right" : "left" }} />
      )}
    </div>
  );
}

function StructurationPatrimoniale({ profil, T=THEMES_INV.dark, initialClientId }) {
  const [clients, setClients] = useState([]);
  const [dossiers, setDossiers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [dossier, setDossier] = useState(null);
  const [data, setData] = useState(buildStructDefault(null));
  const [tab, setTab] = useState("audit");
  const [filter, setFilter] = useState("Tous");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [newClientId, setNewClientId] = useState(initialClientId || "");
  const saveTimerRef = useRef(null);
  const initialHandledRef = useRef(false);
  const loadedDossierIdRef = useRef(null);
  const dataRef = useRef(data);
  const dossierRef = useRef(dossier);

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { dossierRef.current = dossier; }, [dossier]);

  const fmtEur = (v) => {
    const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")) || 0;
    return n ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits:0 }).format(n) + " €" : "—";
  };
  const fmtPct = v => Number.isFinite(Number(v)) ? `${Math.round(Number(v) * 100)} %` : "—";
  const toN = (v) => Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")) || 0;
  const clientFullName = (c) => [c?.prenom, c?.nom].filter(Boolean).join(" ") || c?.email || "Client";
  const currentClient = clients.find(c => c.id === dossier?.client_id) || dossier?.client || null;

  const calc = useCallback((d = data) => {
    const lots = d.collecte?.patrimoine?.lots || [];
    const valeurLots = lots.reduce((s,l)=>s+toN(l.valeur),0);
    const loyers = lots.reduce((s,l)=>s+toN(l.loyer_mois),0);
    const mensualitesLots = lots.reduce((s,l)=>s+toN(l.mensualite),0);
    const crdLots = lots.reduce((s,l)=>s+toN(l.crd),0);
    const rpVal = toN(d.collecte?.patrimoine?.rp_valeur);
    const rpCrd = toN(d.collecte?.patrimoine?.rp_crd);
    const patrimoineFinancier = Object.values(d.collecte?.patrimoine_financier || {}).reduce((s,v)=>s+toN(v),0);
    const patrimoineBrut = valeurLots + rpVal + patrimoineFinancier;
    const crdTotal = crdLots + rpCrd;
    const patrimoineNet = patrimoineBrut - crdTotal;
    const revenusPro = toN(d.collecte?.profil?.revenus_nets_mois);
    const autresRevMois = (toN(d.collecte?.profil?.dividendes_an)+toN(d.collecte?.profil?.autres_revenus_an))/12;
    const revenusRetenus = revenusPro + autresRevMois + loyers * 0.70;
    const mensualitesTotal = toN(d.collecte?.financement?.mensualites_total) || mensualitesLots;
    const tauxEndettement = revenusRetenus ? mensualitesTotal / revenusRetenus : 0;
    const cashflowMois = loyers - mensualitesLots;
    const rendementBrut = valeurLots ? (loyers*12)/valeurLots : 0;
    const ltv = patrimoineBrut ? crdTotal / patrimoineBrut : 0;
    const ifiBase = Math.max(0, valeurLots + rpVal * 0.70 - crdTotal);
    const docs = d.collecte?.documents || [];
    const docsRecus = docs.filter(x=>["Reçu", "Validé", "À vérifier", "Non applicable"].includes(x.statut)).length;
    const docsObligatoires = docs.filter(x=>x.required);
    const docsObligatoiresOk = docsObligatoires.filter(x=>["Reçu", "Validé", "Non applicable"].includes(x.statut)).length;
    const required = [
      d.collecte?.profil?.nom, d.collecte?.profil?.prenom, d.collecte?.profil?.situation_familiale,
      d.collecte?.profil?.profession, d.collecte?.profil?.revenus_nets_mois, d.collecte?.profil?.tmi,
      d.collecte?.patrimoine?.lots?.some(l => toN(l.valeur) || toN(l.loyer_mois)),
      d.collecte?.financement?.banque_principale, d.collecte?.financement?.apport_disponible,
      d.collecte?.objectifs?.objectif_principal, d.collecte?.objectifs?.horizon, d.collecte?.qualification?.niveau_implication, d.collecte?.rdv?.prochaine_action,
      d.analyse?.diagnostic, d.analyse?.strategie_recommandee,
    ];
    const completion = Math.min(100, Math.round(((required.filter(Boolean).length / required.length) * 0.70 + (docsObligatoires.length ? docsObligatoiresOk/docsObligatoires.length : 0) * 0.30) * 100));
    const tarif = patrimoineBrut <= 500000 ? { phase1:2500, phase2:190, tranche:"0 à 500 k€" }
      : patrimoineBrut <= 1500000 ? { phase1:4500, phase2:390, tranche:"500 k€ à 1,5 M€" }
      : patrimoineBrut <= 5000000 ? { phase1:7500, phase2:590, tranche:"1,5 M€ à 5 M€" }
      : { phase1:10000, phase2:890, tranche:"+5 M€ — sur devis" };
    return { valeurLots, loyers, mensualitesLots, crdLots, rpVal, rpCrd, patrimoineFinancier, patrimoineBrut, crdTotal, patrimoineNet, revenusRetenus, tauxEndettement, cashflowMois, rendementBrut, ltv, ifiBase, docsRecus, docsObligatoires:docsObligatoires.length, docsObligatoiresOk, completion, tarif };
  }, [data]);

  const mergeStructData = (d) => {
    const base = buildStructDefault(d?.client || null);
    const incoming = d?.donnees || {};
    const merged = { ...base, ...incoming };
    merged.collecte = { ...base.collecte, ...(incoming.collecte || {}) };
    merged.collecte.profil = { ...base.collecte.profil, ...(incoming.collecte?.profil || {}) };
    merged.collecte.qualification = { ...base.collecte.qualification, ...(incoming.collecte?.qualification || {}) };
    merged.collecte.patrimoine = { ...base.collecte.patrimoine, ...(incoming.collecte?.patrimoine || {}) };
    merged.collecte.financement = { ...base.collecte.financement, ...(incoming.collecte?.financement || {}) };
    merged.collecte.structures = { ...base.collecte.structures, ...(incoming.collecte?.structures || {}) };
    merged.collecte.objectifs = { ...base.collecte.objectifs, ...(incoming.collecte?.objectifs || {}) };
    merged.collecte.patrimoine_financier = { ...base.collecte.patrimoine_financier, ...(incoming.collecte?.patrimoine_financier || {}) };
    merged.collecte.rdv = { ...base.collecte.rdv, ...(incoming.collecte?.rdv || {}) };
    const docIncoming = incoming.collecte?.documents || [];
    const docIndex = new Map(docIncoming.map(doc => [doc.id, doc]));
    merged.collecte.documents = STRUCT_DOCS_DEFAULT.map(doc => ({ ...doc, ...(docIndex.get(doc.id) || {}) })).concat(docIncoming.filter(doc => !STRUCT_DOCS_DEFAULT.some(baseDoc => baseDoc.id === doc.id)));
    merged.analyse = { ...base.analyse, ...(incoming.analyse || d?.analyse_data || {}) };
    if (!Array.isArray(merged.analyse.scenarios)) merged.analyse.scenarios = base.analyse.scenarios;
    if (!Array.isArray(merged.analyse.preconisations)) merged.analyse.preconisations = base.analyse.preconisations;
    return merged;
  };

  const charger = useCallback(async () => {
    setLoading(true); setError("");
    const [clientsRes, dossiersRes] = await Promise.all([
      supabase.from("invest_clients").select("*").order("nom"),
      supabase.from("invest_structuration_patrimoniale").select("*, client:invest_clients(*)").order("updated_at", { ascending:false }),
    ]);
    if (clientsRes.error) setError(clientsRes.error.message);
    if (dossiersRes.error) {
      setError("Table invest_structuration_patrimoniale introuvable ou non accessible. Lancez la migration SQL fournie.");
      setDossiers([]);
    } else {
      const list = dossiersRes.data || [];
      setDossiers(list);
      if (!selectedId && list.length) setSelectedId(list[0].id);
    }
    setClients(clientsRes.data || []);
    setLoading(false);
  }, [selectedId]);

  useEffect(() => { charger(); }, []);

  useEffect(() => {
    const d = dossiers.find(x => x.id === selectedId) || null;
    setDossier(d);
    dossierRef.current = d;
    if (!d) { loadedDossierIdRef.current = null; return; }
    if (loadedDossierIdRef.current === d.id) { setNewClientId(d.client_id || ""); return; }
    loadedDossierIdRef.current = d.id;
    const merged = mergeStructData(d);
    dataRef.current = merged;
    setData(merged);
    setNewClientId(d.client_id || "");
  }, [selectedId, dossiers]);

  const sauvegarder = useCallback(async () => {
    const currentDossier = dossierRef.current;
    const currentData = dataRef.current;
    if (!selectedId || !currentDossier) return;
    setSaving(true);
    const payload = {
      titre: currentDossier.titre,
      statut: currentDossier.statut,
      phase: currentDossier.phase,
      conseiller: currentDossier.conseiller,
      client_id: currentDossier.client_id || null,
      donnees: currentData,
      analyse_data: currentData.analyse || {},
      updated_at: new Date().toISOString(),
    };
    const { data: updated, error } = await supabase.from("invest_structuration_patrimoniale").update(payload).eq("id", selectedId).select("*, client:invest_clients(*)").single();
    setSaving(false);
    if (error) { setError("Impossible d'enregistrer : " + error.message); return; }
    setError("");
    setSaved(true); setTimeout(()=>setSaved(false), 1600);
    if (updated) {
      const hydrated = { ...updated, donnees: currentData, analyse_data: currentData.analyse || {} };
      setDossiers(prev => prev.map(x => x.id === selectedId ? hydrated : x));
      setDossier(hydrated);
      dossierRef.current = hydrated;
    }
  }, [selectedId]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => sauvegarder(), 850);
  }, [sauvegarder]);
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  const mutateData = useCallback((updater) => {
    setData(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      dataRef.current = next;
      return next;
    });
    scheduleSave();
  }, [scheduleSave]);

  const patchDossier = (fields) => {
    setDossier(prev => {
      const next = prev ? { ...prev, ...fields } : prev;
      dossierRef.current = next;
      return next;
    });
    setDossiers(prev => prev.map(x => x.id === selectedId ? { ...x, ...fields } : x));
    scheduleSave();
  };

  const updateSection = (section, key, value) => {
    mutateData(prev => ({
      ...prev,
      collecte: { ...prev.collecte, [section]: { ...(prev.collecte?.[section] || {}), [key]: value } }
    }));
  };
  const updateAnalyse = (key, value) => mutateData(prev => ({ ...prev, analyse:{ ...(prev.analyse || {}), [key]:value } }));
  const updateLot = (idx, key, value) => mutateData(prev => {
    const lots = [...(prev.collecte?.patrimoine?.lots || [])];
    lots[idx] = { ...(lots[idx] || {}), [key]:value };
    return { ...prev, collecte:{ ...prev.collecte, patrimoine:{ ...(prev.collecte?.patrimoine || {}), lots } } };
  });
  const addLot = () => mutateData(prev => ({ ...prev, collecte:{ ...prev.collecte, patrimoine:{ ...(prev.collecte?.patrimoine || {}), lots:[...(prev.collecte?.patrimoine?.lots || []), { ...STRUCT_DEFAULT_LOTS[0], id:`lot-${Date.now()}` }] } } }));
  const removeLot = (idx) => { if (!window.confirm("Supprimer ce lot ?")) return; mutateData(prev => ({ ...prev, collecte:{ ...prev.collecte, patrimoine:{ ...(prev.collecte?.patrimoine || {}), lots:(prev.collecte?.patrimoine?.lots || []).filter((_,i)=>i!==idx) } } })); };
  const updateDoc = (idx, key, value) => mutateData(prev => {
    const docs = [...(prev.collecte?.documents || [])];
    docs[idx] = { ...(docs[idx] || {}), [key]:value };
    return { ...prev, collecte:{ ...prev.collecte, documents:docs } };
  });
  const updateScenario = (idx, key, value) => mutateData(prev => {
    const scenarios = [...(prev.analyse?.scenarios || [])];
    scenarios[idx] = { ...(scenarios[idx] || {}), [key]:value };
    return { ...prev, analyse:{ ...(prev.analyse || {}), scenarios } };
  });
  const updateReco = (idx, key, value) => mutateData(prev => {
    const preconisations = [...(prev.analyse?.preconisations || [])];
    preconisations[idx] = { ...(preconisations[idx] || {}), [key]:value };
    return { ...prev, analyse:{ ...(prev.analyse || {}), preconisations } };
  });
  const addReco = () => mutateData(prev => ({ ...prev, analyse:{ ...(prev.analyse || {}), preconisations:[...(prev.analyse?.preconisations || []), { id:`p${Date.now()}`, axe:"Stratégie", priorite:"Moyenne", titre:"Nouvelle préconisation", detail:"", action:"", statut:"À faire" }] } }));
  const removeReco = (idx) => { if (!window.confirm("Supprimer cette préconisation ?")) return; mutateData(prev => ({ ...prev, analyse:{ ...(prev.analyse || {}), preconisations:(prev.analyse?.preconisations || []).filter((_,i)=>i!==idx) } })); };

  const fillStructEmpty = (current = {}, prefill = {}) => {
    const out = { ...(current || {}) };
    Object.entries(prefill || {}).forEach(([k,v]) => {
      if (v === null || v === undefined || v === "") return;
      if (out[k] === null || out[k] === undefined || out[k] === "") out[k] = v;
    });
    return out;
  };

  const reintegrerInfosClientCRM = useCallback(() => {
    const clientId = dossierRef.current?.client_id || newClientId;
    if (!clientId) { alert("Sélectionnez d’abord un client."); return; }
    const client = clients.find(x => x.id === clientId);
    if (!client) { alert("Client introuvable dans le CRM."); return; }
    const base = buildStructDefault(client);
    mutateData(prev => {
      const currentProfil = prev.collecte?.profil || {};
      const baseProfil = base.collecte.profil || {};
      return {
        ...prev,
        collecte: {
          ...prev.collecte,
          profil: { ...fillStructEmpty(currentProfil, baseProfil), prenom:baseProfil.prenom || currentProfil.prenom || "", nom:baseProfil.nom || currentProfil.nom || "", email:baseProfil.email || currentProfil.email || "", telephone:baseProfil.telephone || currentProfil.telephone || "", conseiller:baseProfil.conseiller || currentProfil.conseiller || "", source_crm:baseProfil.source_crm || currentProfil.source_crm || "", statut_crm:baseProfil.statut_crm || currentProfil.statut_crm || "", budget_crm:baseProfil.budget_crm || currentProfil.budget_crm || "", etape_crm:baseProfil.etape_crm || currentProfil.etape_crm || "", notes_crm:baseProfil.notes_crm || currentProfil.notes_crm || "" },
          financement: fillStructEmpty(prev.collecte?.financement || {}, base.collecte.financement || {}),
          structures: fillStructEmpty(prev.collecte?.structures || {}, base.collecte.structures || {}),
          objectifs: fillStructEmpty(prev.collecte?.objectifs || {}, base.collecte.objectifs || {}),
          rdv: fillStructEmpty(prev.collecte?.rdv || {}, base.collecte.rdv || {}),
        },
      };
    });
  }, [clients, newClientId, mutateData]);

  const creerDossier = async (clientId = newClientId) => {
    if (!clientId) { alert("Sélectionnez un client avant de créer un dossier."); return; }
    const existing = dossiers.find(d => d.client_id === clientId);
    if (existing && window.confirm("Un dossier existe déjà pour ce client. L’ouvrir ?")) { setSelectedId(existing.id); return; }
    const c = clients.find(x => x.id === clientId);
    const base = buildStructDefault(c);
    const payload = {
      client_id: clientId,
      titre: `Structuration patrimoniale — ${clientFullName(c)}`,
      statut: "Collecte",
      phase: "Phase 1 — Audit & Conseil",
      conseiller: profil?.nom || c?.conseiller || "",
      donnees: base,
      analyse_data: base.analyse,
      created_by: profil?.email || profil?.nom || null,
      updated_at: new Date().toISOString(),
    };
    const { data: created, error } = await supabase.from("invest_structuration_patrimoniale").insert(payload).select("*, client:invest_clients(*)").single();
    if (error) { alert("Impossible de créer le dossier : " + error.message); return; }
    setDossiers(prev => [created, ...prev]);
    loadedDossierIdRef.current = null;
    setSelectedId(created.id);
    setTab("audit");
  };

  const supprimerDossier = async (id) => {
    const target = dossiers.find(d => d.id === id);
    if (!target) return;
    const label = target.client ? clientFullName(target.client) : (target.titre || "ce dossier");
    const ok = window.confirm(`Supprimer définitivement le dossier de structuration de ${label} ?\n\nCette action supprimera le dossier et ses données d'analyse. Les documents associés seront également supprimés si le bucket est accessible.`);
    if (!ok) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaving(true); setError("");
    try {
      const bucket = supabase.storage.from("invest-documents");
      const folder = `structuration/${id}`;
      const { data: files } = await bucket.list(folder);
      if (Array.isArray(files) && files.length > 0) await bucket.remove(files.map(f => `${folder}/${f.name}`));
    } catch (e) { console.warn("Suppression documents impossible", e); }
    const { error } = await supabase.from("invest_structuration_patrimoniale").delete().eq("id", id);
    setSaving(false);
    if (error) { setError("Impossible de supprimer le dossier : " + error.message); return; }
    const remaining = dossiers.filter(d => d.id !== id);
    setDossiers(remaining);
    if (selectedId === id) { loadedDossierIdRef.current = null; setSelectedId(remaining[0]?.id || null); }
  };

  useEffect(() => {
    if (!initialClientId || initialHandledRef.current || loading) return;
    initialHandledRef.current = true;
    const existing = dossiers.find(d => d.client_id === initialClientId);
    if (existing) setSelectedId(existing.id);
    else { setNewClientId(initialClientId); setTimeout(() => creerDossier(initialClientId), 80); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClientId, loading, dossiers.length]);

  const filteredDossiers = dossiers.filter(d => filter === "Tous" || d.statut === filter);
  const c = calc();
  const p = data.collecte?.profil || {};
  const q = data.collecte?.qualification || {};
  const pat = data.collecte?.patrimoine || {};
  const fin = data.collecte?.financement || {};
  const st = data.collecte?.structures || {};
  const obj = data.collecte?.objectifs || {};
  const pf = data.collecte?.patrimoine_financier || {};
  const rdv = data.collecte?.rdv || {};
  const docs = data.collecte?.documents || [];
  const lots = pat.lots || [];

  const statusColors = {
    "Collecte": { bg:SEMANTIC.info.bg, color:SEMANTIC.info.color, border:SEMANTIC.info.border },
    "Analyse": { bg:SEMANTIC.warning.bg, color:SEMANTIC.warning.color, border:SEMANTIC.warning.border },
    "Préconisations": { bg:T.accentBg, color:T.accent, border:T.accentBorder },
    "Restitution": { bg:SEMANTIC.success.bg, color:SU, border:SEMANTIC.success.border },
    "Phase 2": { bg:"rgba(80,200,120,0.10)", color:SU, border:"rgba(80,200,120,0.25)" },
    "Terminé": { bg:T.input, color:T.textMuted, border:T.border },
  };
  const chipStyle = (status) => ({ fontSize:FONT.xs.size, fontWeight:800, padding:"3px 8px", borderRadius:999, background:statusColors[status]?.bg || T.input, color:statusColors[status]?.color || T.textSub, border:`1px solid ${statusColors[status]?.border || T.border}`, display:"inline-flex", alignItems:"center", gap:4 });
  const cardStyle = { background:T.card, border:`1px solid ${T.border}`, borderRadius:RADIUS.xl, boxShadow:T.shadow, overflow:"hidden" };
  const cardHd = (label, tone="") => <div style={{ padding:"12px 14px", borderBottom:`1px solid ${T.border}`, color:tone === "gold" ? T.accent : T.text, fontWeight:900, letterSpacing:.8, textTransform:"uppercase", fontSize:FONT.xs.size }}>{label}</div>;
  const kpi = (label, value, sub, tone="") => <div style={{ ...cardStyle, padding:"14px 16px", borderLeft:`4px solid ${tone === "gold" ? T.accent : tone === "red" ? DA : tone === "green" ? SU : T.accentBorder}` }}><div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:FONT.h2.size, fontWeight:800, color:T.text }}>{value}</div><div style={{ color:T.textMuted, fontSize:FONT.xs.size, textTransform:"uppercase", letterSpacing:.8, fontWeight:800 }}>{label}</div>{sub && <div style={{ color:T.textSub, fontSize:FONT.xs.size+1, marginTop:4 }}>{sub}</div>}</div>;

  const renderProgress = (pct, height=5) => <div style={{ width:"100%", height, background:T.input, borderRadius:999, overflow:"hidden" }}><div style={{ width:`${Math.max(0, Math.min(100, pct || 0))}%`, height:"100%", background:T.accent, borderRadius:999 }}/></div>;

  const renderSidebarDossiers = () => (
    <div style={{ background:T.sidebar, borderRadius:RADIUS.xl, overflow:"hidden", border:`1px solid ${T.sidebarBorder}`, height:"100%", minHeight:0, display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"20px 18px 16px", borderBottom:`1px solid ${T.sidebarBorder}` }}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:22, color:T.text, fontWeight:500 }}>Profero Invest</div>
        <div style={{ fontSize:FONT.xs.size, letterSpacing:2.4, textTransform:"uppercase", color:T.accent, marginTop:2 }}>Gestion des dossiers</div>
      </div>
      <div style={{ padding:14, borderBottom:`1px solid ${T.sidebarBorder}` }}>
        <div style={{ display:"flex", gap:7 }}>
          <select className="inv-sel" value={newClientId} onChange={e=>setNewClientId(e.target.value)} style={{ flex:1, minWidth:0 }}>
            <option value="">Nouveau dossier client…</option>
            {clients.map(c=><option key={c.id} value={c.id}>{clientFullName(c)}</option>)}
          </select>
          <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={()=>creerDossier()} title="Créer"><Icon as={Plus} size={13}/></button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:5, marginTop:10 }}>
          {["Tous","Collecte","Analyse","Phase 2"].map(f => <button key={f} onClick={()=>setFilter(f)} style={{ border:`1px solid ${filter === f ? T.accentBorder : T.sidebarBorder}`, background:filter === f ? T.accentBg : "rgba(255,255,255,0.03)", color:filter === f ? T.accent : T.textMuted, borderRadius:RADIUS.sm+2, fontSize:FONT.xs.size, padding:"6px 2px", cursor:"pointer", fontWeight:800 }}>{f}</button>)}
        </div>
      </div>
      <div style={{ padding:12, overflowY:"auto", flex:1 }}>
        {loading ? <div style={{ color:T.textMuted, padding:18, textAlign:"center" }}>Chargement…</div> : filteredDossiers.length === 0 ? <div style={{ color:T.textMuted, textAlign:"center", padding:24, lineHeight:1.6 }}>Aucun dossier<br/>dans ce filtre</div> : filteredDossiers.map(d => {
          const active = d.id === selectedId;
          const metaData = mergeStructData(d);
          const cc = calc(metaData);
          return <button key={d.id} onClick={()=>{ setSelectedId(d.id); setTab("audit"); }} style={{ width:"100%", textAlign:"left", border:`1px solid ${active ? T.accentBorder : "transparent"}`, background:active ? T.accentBg : "transparent", borderRadius:RADIUS.md, padding:"11px 11px", marginBottom:8, cursor:"pointer", fontFamily:"inherit" }}>
            <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"flex-start" }}>
              <div style={{ minWidth:0, flex:1 }}>
                <div style={{ color:active ? T.accent : T.text, fontWeight:900, fontSize:FONT.sm.size+1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{d.client ? clientFullName(d.client) : d.titre || "Nouveau dossier"}</div>
                <div style={{ color:T.textMuted, fontSize:FONT.xs.size, marginTop:2 }}>{d.conseiller || "Sans conseiller"} · {new Date(d.updated_at || d.created_at).toLocaleDateString("fr-FR")}</div>
              </div>
              <span style={chipStyle(d.statut || "Collecte")}>{d.statut || "Collecte"}</span>
            </div>
            <div style={{ marginTop:8 }}>{renderProgress(cc.completion, 3)}</div>
            <div style={{ marginTop:5, color:T.textMuted, fontSize:FONT.xs.size }}>{cc.completion} % complété</div>
          </button>;
        })}
      </div>
    </div>
  );

  const renderListView = () => {
    const count = (status) => dossiers.filter(d => d.statut === status).length;
    const avgCompletion = dossiers.length ? Math.round(dossiers.reduce((s,d)=>s+calc(mergeStructData(d)).completion,0)/dossiers.length) : 0;
    return <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:SPACING.md, ...cardStyle, padding:"18px 20px" }}>
        <div>
          <div style={{ fontSize:FONT.h2.size, fontWeight:900, color:T.text }}>Tableau de bord structuration</div>
          <div style={{ color:T.textSub, fontSize:FONT.sm.size }}>Pilotage des missions de collecte, analyse, restitution et suivi patrimonial</div>
        </div>
        <button className="inv-btn inv-btn-gold" onClick={()=>newClientId ? creerDossier() : alert("Sélectionnez un client dans la colonne de gauche.")}><Icon as={Plus} size={14}/> Nouveau dossier</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,minmax(0,1fr))", gap:SPACING.md }}>
        {kpi("Dossiers total", dossiers.length, "Portefeuille structuration")}
        {kpi("En collecte", count("Collecte"), "Données & documents")}
        {kpi("En analyse", count("Analyse") + count("Préconisations"), "Stratégie à formaliser", "gold")}
        {kpi("Complétude moyenne", `${avgCompletion} %`, "Qualité des dossiers", avgCompletion > 70 ? "green" : "red")}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:SPACING.md }}>
        {dossiers.map(d => {
          const md = mergeStructData(d);
          const cc = calc(md);
          const initials = ((d.client?.prenom || md.collecte?.profil?.prenom || "?")[0] + (d.client?.nom || md.collecte?.profil?.nom || "?")[0]).toUpperCase();
          return <button key={d.id} onClick={()=>{ setSelectedId(d.id); setTab("audit"); }} style={{ ...cardStyle, padding:16, textAlign:"left", cursor:"pointer", fontFamily:"inherit" }}>
            <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
              <div style={{ width:42, height:42, borderRadius:"50%", background:T.accentBg, color:T.accent, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900 }}>{initials}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:900, color:T.text, fontSize:FONT.md.size }}>{d.client ? clientFullName(d.client) : d.titre}</div>
                <div style={{ color:T.textMuted, fontSize:FONT.xs.size+1 }}>{d.conseiller || "Sans conseiller"}</div>
              </div>
              <span style={chipStyle(d.statut || "Collecte")}>{d.statut || "Collecte"}</span>
            </div>
            <div style={{ marginTop:14, display:"flex", justifyContent:"space-between", color:T.textMuted, fontSize:FONT.xs.size, fontWeight:800 }}><span>Progression</span><span>{cc.completion} %</span></div>
            <div style={{ marginTop:5 }}>{renderProgress(cc.completion, 5)}</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:12, color:T.textSub, fontSize:FONT.xs.size+1 }}>
              <span>Patrimoine : <b style={{ color:T.text }}>{fmtEur(cc.patrimoineBrut)}</b></span>
              <span>Docs : <b style={{ color:T.text }}>{cc.docsRecus}/{docs.length || STRUCT_DOCS_DEFAULT.length}</b></span>
            </div>
          </button>;
        })}
      </div>
    </div>;
  };

  const renderDossierHeader = () => (
    <div style={{ ...cardStyle, overflow:"hidden" }}>
      <div style={{ background:T.sidebar, padding:"16px 18px", display:"flex", alignItems:"center", gap:SPACING.md, borderBottom:`1px solid ${T.sidebarBorder}` }}>
        <button className="inv-btn inv-btn-sm" onClick={()=>setSelectedId(null)} style={{ background:"rgba(255,255,255,0.06)", color:T.textSub, border:`1px solid ${T.sidebarBorder}` }}><Icon as={ArrowLeft} size={13}/> Dossiers</button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:25, fontWeight:500, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{currentClient ? clientFullName(currentClient) : (dossier?.titre || "Dossier structuration")}</div>
          <div style={{ color:T.textMuted, fontSize:FONT.xs.size+1, marginTop:2 }}>{dossier?.phase || "Phase 1"} · Créé le {dossier?.created_at ? new Date(dossier.created_at).toLocaleDateString("fr-FR") : "—"}</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", justifyContent:"flex-end" }}>
          {saving && <span style={{ color:T.accent, fontSize:FONT.xs.size, fontWeight:800 }}><Icon as={RefreshCw} size={12} style={{animation:"spin 1s linear infinite"}}/> Enregistrement…</span>}
          {saved && <span style={{ color:SU, fontSize:FONT.xs.size, fontWeight:900 }}><Icon as={Check} size={13}/> Sauvegardé</span>}
          <select className="inv-sel" value={dossier?.statut || "Collecte"} onChange={e=>patchDossier({ statut:e.target.value })} style={{ minWidth:140 }}>{STRUCT_STATUTS.map(s=><option key={s} value={s}>{s}</option>)}</select>
          <select className="inv-sel" value={dossier?.phase || "Phase 1 — Audit & Conseil"} onChange={e=>patchDossier({ phase:e.target.value })} style={{ minWidth:210 }}>{STRUCT_PHASES.map(s=><option key={s} value={s}>{s}</option>)}</select>
          <button className="inv-btn inv-btn-blue" onClick={reintegrerInfosClientCRM} disabled={!dossier?.client_id}><Icon as={RefreshCw} size={13}/> Réimporter CRM</button>
          <button className="inv-btn inv-btn-gold" onClick={()=>sauvegarder()}><Icon as={Save} size={13}/> Enregistrer</button>
          <button className="inv-btn inv-btn-sm" onClick={()=>supprimerDossier(dossier.id)} style={{ background:SEMANTIC.danger.bg, color:DA, border:`1px solid ${SEMANTIC.danger.border}` }}><Icon as={Trash2} size={13}/></button>
        </div>
      </div>
      <div style={{ padding:"14px 18px", display:"grid", gridTemplateColumns:"repeat(5,minmax(0,1fr))", gap:SPACING.md }}>
        {kpi("Patrimoine brut", fmtEur(c.patrimoineBrut), c.tarif.tranche)}
        {kpi("Patrimoine net", fmtEur(c.patrimoineNet), `LTV ${fmtPct(c.ltv)}`)}
        {kpi("Cash-flow locatif", `${fmtEur(c.cashflowMois)}/mois`, `Loyers ${fmtEur(c.loyers)}/mois`, c.cashflowMois >= 0 ? "green" : "red")}
        {kpi("Endettement indicatif", fmtPct(c.tauxEndettement), "Lecture bancaire à qualifier", c.tauxEndettement > 0.35 ? "red" : "green")}
        {kpi("Mission Phase 1", fmtEur(c.tarif.phase1), `Phase 2 ${fmtEur(c.tarif.phase2)}/mois`, "gold")}
      </div>
      <div style={{ padding:"0 18px 16px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", color:T.textMuted, fontSize:FONT.xs.size, marginBottom:6, fontWeight:800 }}><span>Progression du dossier</span><span>{c.completion} %</span></div>
        {renderProgress(c.completion, 6)}
      </div>
    </div>
  );

  const tabItems = [
    { id:"audit", label:"Audit · Collecte de données" },
    { id:"profil", label:"Profil patrimonial" },
    { id:"patrimoine", label:"Patrimoine & financement" },
    { id:"documents", label:"Documents" },
    { id:"analyse", label:"Analyse & préconisations" },
  ];
  const renderTabs = () => <div style={{ ...cardStyle, display:"flex", gap:0, padding:"0 14px", overflowX:"auto", flexShrink:0 }}>{tabItems.map(t => <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:"12px 14px", border:"none", borderBottom:`2px solid ${tab === t.id ? T.accent : "transparent"}`, background:tab === t.id ? T.accentBg : "transparent", color:tab === t.id ? T.text : T.textSub, cursor:"pointer", fontFamily:"inherit", fontWeight:900, fontSize:FONT.sm.size, whiteSpace:"nowrap" }}>{t.label}</button>)}</div>;

  const renderAudit = () => {
    const fieldProps = { T, compact:true };
    const criticalDocs = docs.filter(doc => doc.required).slice(0, 12);
    const auditKpis = [
      ["Patrimoine brut déclaré", fmtEur(c.patrimoineBrut)],
      ["Patrimoine net estimé", fmtEur(c.patrimoineNet)],
      ["Taux d'endettement", fmtPct(c.tauxEndettement)],
      ["Pièces indispensables", `${c.docsObligatoiresOk}/${c.docsObligatoires}`],
    ];
    return <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,minmax(0,1fr))", gap:SPACING.md }}>
        {auditKpis.map(([lab,val],i)=><div key={lab} style={{ ...cardStyle, padding:"12px 14px", borderTop:`3px solid ${i===2 && c.tauxEndettement > .35 ? DA : T.accent}` }}><div style={{ color:T.textMuted, fontSize:FONT.xs.size, textTransform:"uppercase", fontWeight:900, letterSpacing:.7 }}>{lab}</div><div style={{ color:T.text, fontSize:FONT.h3.size, fontWeight:900, marginTop:5 }}>{val}</div></div>)}
      </div>
      <div style={{ ...cardStyle, padding:"11px 14px", borderLeft:`4px solid ${T.accent}`, background:T.accentBg }}>
        <div style={{ color:T.text, fontWeight:900, fontSize:FONT.sm.size }}>Trame de rendez-vous patrimonial immobilier</div>
        <div style={{ color:T.textSub, fontSize:FONT.xs.size+1, marginTop:3 }}>Renseignez dans l'ordre : qualification → foyer → revenus/fiscalité → objectifs → patrimoine déclaré → alertes et suite. Les données alimentent automatiquement les onglets Profil patrimonial, Patrimoine & financement et Analyse.</div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:SPACING.md, alignItems:"start" }}>
        <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
          <div style={cardStyle}>{cardHd("01 — Cadre du rendez-vous & origine du lead", "gold")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:10 }}>
            <StructField {...fieldProps} label="Date du R1" type="date" value={q.date_r1} onChange={v=>updateSection("qualification","date_r1",v)} />
            <StructField {...fieldProps} label="Conseiller référent" value={p.conseiller || dossier?.conseiller} onChange={v=>updateSection("profil","conseiller",v)} />
            <StructField {...fieldProps} label="Source du lead" value={q.source_lead} onChange={v=>updateSection("qualification","source_lead",v)} options={["Recommandation","Réseau personnel","Site web","Événement","Partenaire","Autre"]} />
            <StructField {...fieldProps} label="Prescripteur" value={q.prescripteur} onChange={v=>updateSection("qualification","prescripteur",v)} />
            <StructField {...fieldProps} label="Contexte / origine de la demande" type="textarea" value={q.origine_commentaire} onChange={v=>updateSection("qualification","origine_commentaire",v)} wide />
          </div></div>
          <div style={cardStyle}>{cardHd("02 — Identité, famille & protection", "gold")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:10 }}>
            <StructField {...fieldProps} label="Prénom" value={p.prenom} onChange={v=>updateSection("profil","prenom",v)} />
            <StructField {...fieldProps} label="Nom" value={p.nom} onChange={v=>updateSection("profil","nom",v)} />
            <StructField {...fieldProps} label="Date de naissance" type="date" value={p.date_naissance} onChange={v=>updateSection("profil","date_naissance",v)} />
            <StructField {...fieldProps} label="Situation familiale" value={p.situation_familiale} onChange={v=>updateSection("profil","situation_familiale",v)} options={["Célibataire","Marié(e)","Pacsé(e)","Divorcé(e)","Concubinage","Veuf/veuve"]} />
            <StructField {...fieldProps} label="Régime matrimonial" value={p.regime_matrimonial} onChange={v=>updateSection("profil","regime_matrimonial",v)} options={["Communauté réduite aux acquêts","Séparation de biens","Participation aux acquêts","Communauté universelle","Non applicable"]} />
            <StructField {...fieldProps} label="Contrat mariage / PACS" value={p.contrat_mariage} onChange={v=>updateSection("profil","contrat_mariage",v)} options={["Oui","Non","À vérifier","Non applicable"]} />
            <StructField {...fieldProps} label="Enfants à charge" type="number" value={p.enfants} onChange={v=>updateSection("profil","enfants",v)} />
            <StructField {...fieldProps} label="Détail enfants / transmission" value={p.enfants_details} onChange={v=>updateSection("profil","enfants_details",v)} wide />
            <StructField {...fieldProps} label="Adresse" value={p.adresse} onChange={v=>updateSection("profil","adresse",v)} wide />
          </div></div>
          <div style={cardStyle}>{cardHd("03 — Activité, revenus & fiscalité", "gold")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:10 }}>
            <StructField {...fieldProps} label="Profession / fonction" value={p.profession} onChange={v=>updateSection("profil","profession",v)} />
            <StructField {...fieldProps} label="Statut professionnel" value={p.statut_pro} onChange={v=>updateSection("profil","statut_pro",v)} options={["Salarié CDI","Salarié CDD","TNS / Indépendant","Chef d'entreprise","Profession libérale","Fonctionnaire","Retraité","Autre"]} />
            <StructField {...fieldProps} label="Employeur / secteur" value={p.employeur} onChange={v=>updateSection("profil","employeur",v)} />
            <StructField {...fieldProps} label="Revenus client / mois" type="number" value={p.revenus_nets_mois} onChange={v=>updateSection("profil","revenus_nets_mois",v)} />
            <StructField {...fieldProps} label="Revenus conjoint / mois" type="number" value={p.revenus_conjoint_mois} onChange={v=>updateSection("profil","revenus_conjoint_mois",v)} />
            <StructField {...fieldProps} label="Revenus locatifs nets / mois" type="number" value={p.revenus_locatifs_nets_mois} onChange={v=>updateSection("profil","revenus_locatifs_nets_mois",v)} />
            <StructField {...fieldProps} label="Dividendes / an" type="number" value={p.dividendes_an} onChange={v=>updateSection("profil","dividendes_an",v)} />
            <StructField {...fieldProps} label="Impôt sur le revenu N-1" type="number" value={p.impot_revenu} onChange={v=>updateSection("profil","impot_revenu",v)} />
            <StructField {...fieldProps} label="TMI estimée" value={p.tmi} onChange={v=>updateSection("profil","tmi",v)} options={["0 %","11 %","30 %","41 %","45 %","À vérifier"]} />
            <StructField {...fieldProps} label="Régime revenus locatifs" value={p.regime_locatif} onChange={v=>updateSection("profil","regime_locatif",v)} options={["Micro-foncier","Foncier réel","LMNP micro-BIC","LMNP réel","LMP","SCI IS","Non applicable"]} />
            <StructField {...fieldProps} label="IFI" value={p.ifi} onChange={v=>updateSection("profil","ifi",v)} options={["Non assujetti","Assujetti","Proche du seuil","À vérifier"]} />
            <StructField {...fieldProps} label="Déficits / dispositifs actifs" value={p.dispositifs_fiscaux} onChange={v=>updateSection("profil","dispositifs_fiscaux",v)} wide />
          </div></div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
          <div style={cardStyle}>{cardHd("04 — Objectifs & critères de stratégie", "gold")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:10 }}>
            <StructField {...fieldProps} label="Objectif principal" value={obj.objectif_principal} onChange={v=>updateSection("objectifs","objectif_principal",v)} options={["Revenus complémentaires","Constitution patrimoine","Retraite","Défiscalisation","Transmission","Accélération patrimoniale","Mix"]} />
            <StructField {...fieldProps} label="Horizon d'investissement" value={obj.horizon} onChange={v=>updateSection("objectifs","horizon",v)} options={["Court terme < 5 ans","Moyen terme 5-15 ans","Long terme > 15 ans","À définir"]} />
            <StructField {...fieldProps} label="Budget acquisition min." type="number" value={q.budget_min} onChange={v=>updateSection("qualification","budget_min",v)} />
            <StructField {...fieldProps} label="Budget acquisition max." type="number" value={q.budget_max} onChange={v=>updateSection("qualification","budget_max",v)} />
            <StructField {...fieldProps} label="Type de bien visé" value={q.type_bien_vise} onChange={v=>updateSection("qualification","type_bien_vise",v)} options={["Appartement","Maison","Immeuble de rapport","Local commercial","SCPI","Pas de préférence"]} />
            <StructField {...fieldProps} label="Zone géographique" value={obj.zones} onChange={v=>updateSection("objectifs","zones",v)} />
            <StructField {...fieldProps} label="Niveau de levier" value={q.niveau_levier} onChange={v=>updateSection("qualification","niveau_levier",v)} options={["Faible < 70 % LTV","Standard 70-80 %","Élevé > 80 %","Sans préférence"]} />
            <StructField {...fieldProps} label="Niveau d'implication" value={q.niveau_implication} onChange={v=>updateSection("qualification","niveau_implication",v)} options={["Autonome","Accompagné","Clé-en-main"]} />
            <StructField {...fieldProps} label="Projets à 3-5 ans" type="textarea" value={obj.projets_3_5_ans} onChange={v=>updateSection("objectifs","projets_3_5_ans",v)} wide />
          </div></div>
          <div style={cardStyle}>{cardHd("05 — Photo patrimoniale déclarative", "gold")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:10 }}>
            <StructField {...fieldProps} label="Statut résidence principale" value={pat.residence_principale_statut} onChange={v=>updateSection("patrimoine","residence_principale_statut",v)} options={["Propriétaire — crédit en cours","Propriétaire — crédit soldé","Locataire","Hébergé(e)"]} />
            <StructField {...fieldProps} label="Valeur résidence principale" type="number" value={pat.rp_valeur} onChange={v=>updateSection("patrimoine","rp_valeur",v)} />
            <StructField {...fieldProps} label="CRD résidence principale" type="number" value={pat.rp_crd} onChange={v=>updateSection("patrimoine","rp_crd",v)} />
            <StructField {...fieldProps} label="Épargne liquide disponible" type="number" value={pf.liquidites} onChange={v=>updateSection("patrimoine_financier","liquidites",v)} />
            <StructField {...fieldProps} label="Apport mobilisable" type="number" value={fin.apport_disponible} onChange={v=>updateSection("financement","apport_disponible",v)} />
            <StructField {...fieldProps} label="Mensualités crédits en cours" type="number" value={fin.mensualites_total} onChange={v=>updateSection("financement","mensualites_total",v)} />
            <StructField {...fieldProps} label="Charges fixes mensuelles" type="number" value={q.charges_fixes_mois} onChange={v=>updateSection("qualification","charges_fixes_mois",v)} />
            <StructField {...fieldProps} label="Crédits conso / pensions" type="number" value={q.credits_conso_mois} onChange={v=>updateSection("qualification","credits_conso_mois",v)} />
          </div><div style={{ padding:"0 14px 14px", color:T.textSub, fontSize:FONT.xs.size+1 }}>Le détail des biens, crédits, placements et structures est complété dans l'onglet <b style={{color:T.text}}>Patrimoine & financement</b>.</div></div>
          <div style={cardStyle}>{cardHd("06 — Qualification, alertes & suite", "gold")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:10 }}>
            <StructField {...fieldProps} label="Complexité attribuée" value={q.niveau_complexite} onChange={v=>updateSection("qualification","niveau_complexite",v)} options={["Simple","Intermédiaire","Complexe"]} />
            <StructField {...fieldProps} label="Situation bancaire / conformité" value={q.situation_bancaire} onChange={v=>updateSection("qualification","situation_bancaire",v)} options={["RAS","Incident récent","FICP","Surendettement","À vérifier"]} />
            <StructField {...fieldProps} label="Justification du niveau" type="textarea" value={q.justification_complexite} onChange={v=>updateSection("qualification","justification_complexite",v)} wide />
            <StructField {...fieldProps} label="Points d'alerte détectés" type="textarea" value={q.alertes} onChange={v=>updateSection("qualification","alertes",v)} placeholder="Endettement, revenus, objectifs, structure, risques..." wide />
            <StructField {...fieldProps} label="Décision issue du RDV" value={rdv.issue} onChange={v=>updateSection("rdv","issue",v)} options={["Dossier ouvert — R2 planifié","En attente de pièces","Dossier non qualifié","À recontacter","Phase 1 signée"]} />
            <StructField {...fieldProps} label="Date R2 / relance" type="date" value={rdv.date_r2 || rdv.relance} onChange={v=>updateSection("rdv","date_r2",v)} />
            <StructField {...fieldProps} label="Prochaine action" value={rdv.prochaine_action} onChange={v=>updateSection("rdv","prochaine_action",v)} wide />
            <StructField {...fieldProps} label="Consentement RGPD" value={q.consentement_rgpd} onChange={v=>updateSection("qualification","consentement_rgpd",v)} options={["Obtenu","À obtenir","Refusé"]} />
          </div></div>
          <div style={cardStyle}>{cardHd("Pièces prioritaires à demander avant analyse")}<div style={{ padding:14, display:"flex", flexDirection:"column", gap:6 }}>
            {criticalDocs.map((doc,i)=><div key={doc.id} style={{ display:"grid", gridTemplateColumns:"1fr 115px", gap:8, alignItems:"center", padding:"5px 7px", background:T.input, borderRadius:RADIUS.md }}><div style={{ color:T.text, fontSize:FONT.xs.size+1, fontWeight:800 }}>{doc.label}</div><select className="inv-sel" value={doc.statut || "À demander"} onChange={e=>updateDoc(docs.findIndex(x=>x.id===doc.id),"statut",e.target.value)} style={{ fontSize:FONT.xs.size+1 }}>{STRUCT_DOC_STATUTS.map(x=><option key={x}>{x}</option>)}</select></div>)}
          </div></div>
        </div>
      </div>
    </div>;
  };

  const renderProfil = () => <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(5,minmax(0,1fr))", gap:SPACING.md }}>
      {kpi("Patrimoine brut", fmtEur(c.patrimoineBrut), "Base déclarative")}
      {kpi("Patrimoine net", fmtEur(c.patrimoineNet), `CRD ${fmtEur(c.crdTotal)}`)}
      {kpi("Revenus retenus", `${fmtEur(c.revenusRetenus)}/mois`, "Lecture prudentielle")}
      {kpi("Endettement", fmtPct(c.tauxEndettement), c.tauxEndettement > .35 ? "Vigilance bancaire" : "À valider sur pièces", c.tauxEndettement > .35 ? "red" : "green")}
      {kpi("Complexité", q.niveau_complexite || "À qualifier", p.tmi || "TMI à préciser", "gold")}
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"1.05fr .95fr", gap:SPACING.md, alignItems:"start" }}>
      <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
        <div style={cardStyle}>{cardHd("Profil personnel & familial", "gold")}<div style={{ padding:16, display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:SPACING.md }}>
          <StructField T={T} label="Prénom" value={p.prenom} onChange={v=>updateSection("profil","prenom",v)} />
          <StructField T={T} label="Nom" value={p.nom} onChange={v=>updateSection("profil","nom",v)} />
          <StructField T={T} label="Date de naissance" type="date" value={p.date_naissance} onChange={v=>updateSection("profil","date_naissance",v)} />
          <StructField T={T} label="Situation familiale" value={p.situation_familiale} onChange={v=>updateSection("profil","situation_familiale",v)} options={["Célibataire","Marié(e)","Pacsé(e)","Divorcé(e)","Concubinage","Veuf/veuve"]}/>
          <StructField T={T} label="Régime matrimonial" value={p.regime_matrimonial} onChange={v=>updateSection("profil","regime_matrimonial",v)} options={["Communauté réduite aux acquêts","Séparation de biens","Participation aux acquêts","Communauté universelle","Non applicable"]}/>
          <StructField T={T} label="Enfants à charge" type="number" value={p.enfants} onChange={v=>updateSection("profil","enfants",v)}/>
          <StructField T={T} label="Enfants / objectifs transmission" value={p.enfants_details} onChange={v=>updateSection("profil","enfants_details",v)} wide/>
          <StructField T={T} label="Adresse" value={p.adresse} onChange={v=>updateSection("profil","adresse",v)} wide/>
        </div></div>
        <div style={cardStyle}>{cardHd("Profession, revenus & fiscalité")}<div style={{ padding:16, display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:SPACING.md }}>
          <StructField T={T} label="Profession / fonction" value={p.profession} onChange={v=>updateSection("profil","profession",v)} />
          <StructField T={T} label="Statut professionnel" value={p.statut_pro} onChange={v=>updateSection("profil","statut_pro",v)} options={["Salarié CDI","Salarié CDD","TNS / Indépendant","Chef d'entreprise","Profession libérale","Fonctionnaire","Retraité","Autre"]}/>
          <StructField T={T} label="Employeur / secteur" value={p.employeur} onChange={v=>updateSection("profil","employeur",v)} />
          <StructField T={T} label="Revenus client / mois" type="number" value={p.revenus_nets_mois} onChange={v=>updateSection("profil","revenus_nets_mois",v)}/>
          <StructField T={T} label="Revenus conjoint / mois" type="number" value={p.revenus_conjoint_mois} onChange={v=>updateSection("profil","revenus_conjoint_mois",v)}/>
          <StructField T={T} label="Dividendes / an" type="number" value={p.dividendes_an} onChange={v=>updateSection("profil","dividendes_an",v)}/>
          <StructField T={T} label="IR N-1" type="number" value={p.impot_revenu} onChange={v=>updateSection("profil","impot_revenu",v)}/>
          <StructField T={T} label="TMI" value={p.tmi} onChange={v=>updateSection("profil","tmi",v)} options={["0 %","11 %","30 %","41 %","45 %","À vérifier"]}/>
          <StructField T={T} label="IFI" value={p.ifi} onChange={v=>updateSection("profil","ifi",v)} options={["Non assujetti","Proche du seuil","Assujetti","À vérifier"]}/>
          <StructField T={T} label="Régime locatif actuel" value={p.regime_locatif} onChange={v=>updateSection("profil","regime_locatif",v)} options={["Micro-foncier","Foncier réel","LMNP micro-BIC","LMNP réel","LMP","SCI IS","Non applicable"]}/>
          <StructField T={T} label="Dispositifs / déficits reportables" value={p.dispositifs_fiscaux} onChange={v=>updateSection("profil","dispositifs_fiscaux",v)} wide/>
        </div></div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
        <div style={cardStyle}>{cardHd("Vision patrimoniale & objectif client", "gold")}<div style={{ padding:16, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:SPACING.md }}>
          <StructField T={T} label="Objectif principal" value={obj.objectif_principal} onChange={v=>updateSection("objectifs","objectif_principal",v)} options={["Revenus complémentaires","Constitution patrimoine","Retraite","Défiscalisation","Transmission","Accélération patrimoniale","Mix"]}/>
          <StructField T={T} label="Horizon" value={obj.horizon} onChange={v=>updateSection("objectifs","horizon",v)} options={["Court terme < 5 ans","Moyen terme 5-15 ans","Long terme > 15 ans","À définir"]}/>
          <StructField T={T} label="Niveau d'implication" value={q.niveau_implication} onChange={v=>updateSection("qualification","niveau_implication",v)} options={["Autonome","Accompagné","Clé-en-main"]}/>
          <StructField T={T} label="Niveau de levier" value={q.niveau_levier} onChange={v=>updateSection("qualification","niveau_levier",v)} options={["Faible < 70 % LTV","Standard 70-80 %","Élevé > 80 %","Sans préférence"]}/>
          <StructField T={T} label="Zones souhaitées" value={obj.zones} onChange={v=>updateSection("objectifs","zones",v)} wide/>
          <StructField T={T} label="Projets 3-5 ans / transmission" type="textarea" value={obj.projets_3_5_ans} onChange={v=>updateSection("objectifs","projets_3_5_ans",v)} wide/>
        </div></div>
        <div style={cardStyle}>{cardHd("Qualification & alertes R1")}<div style={{ padding:16, display:"grid", gap:SPACING.md }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:SPACING.md }}><StructField T={T} label="Niveau de complexité" value={q.niveau_complexite} onChange={v=>updateSection("qualification","niveau_complexite",v)} options={["Simple","Intermédiaire","Complexe"]}/><StructField T={T} label="Situation bancaire" value={q.situation_bancaire} onChange={v=>updateSection("qualification","situation_bancaire",v)} options={["RAS","Incident récent","FICP","Surendettement","À vérifier"]}/></div>
          <StructField T={T} label="Justification du niveau" type="textarea" value={q.justification_complexite} onChange={v=>updateSection("qualification","justification_complexite",v)} wide/>
          <StructField T={T} label="Alertes / vigilances" type="textarea" value={q.alertes} onChange={v=>updateSection("qualification","alertes",v)} wide/>
          <div style={{ display:"flex", gap:8, alignItems:"center", color:T.textSub, fontSize:FONT.sm.size }}><Icon as={Check} size={13}/><span>Consentement RGPD : <b style={{ color:T.text }}>{q.consentement_rgpd || "À obtenir"}</b></span></div>
        </div></div>
      </div>
    </div>
  </div>;

  const renderPatrimoine = () => <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(6,minmax(0,1fr))", gap:SPACING.md }}>
      {kpi("Immobilier brut", fmtEur(c.valeurLots + c.rpVal), "Biens + RP")}
      {kpi("Financier", fmtEur(c.patrimoineFinancier), "Épargne & placements")}
      {kpi("CRD total", fmtEur(c.crdTotal), "Dette immobilière", "red")}
      {kpi("Patrimoine net", fmtEur(c.patrimoineNet), `LTV ${fmtPct(c.ltv)}`, "gold")}
      {kpi("Cash-flow locatif", `${fmtEur(c.cashflowMois)}/mois`, `Loyers ${fmtEur(c.loyers)}/mois`, c.cashflowMois >= 0 ? "green" : "red")}
      {kpi("Rendement brut", fmtPct(c.rendementBrut), "Sur actifs locatifs")}
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1.2fr) minmax(340px,.8fr)", gap:SPACING.md, alignItems:"start" }}>
      <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
        <div style={cardStyle}>{cardHd("Inventaire immobilier & lecture de performance", "gold")}<div style={{ padding:14 }}>
          <div style={{ color:T.textSub, fontSize:FONT.xs.size+1, marginBottom:10 }}>Un actif par ligne : valeur, dette, flux et régime de détention. Cette base alimente l'analyse de levier, l'arbitrage et la fiscalité.</div>
          <div style={{ overflowX:"auto", border:`1px solid ${T.border}`, borderRadius:RADIUS.md }}><table className="inv-table" style={{ minWidth:980 }}><thead><tr><th>#</th><th>Bien / adresse</th><th>Type</th><th>Détention</th><th>Fiscalité</th><th>Loyer</th><th>Mensualité</th><th>CRD</th><th>Valeur</th><th>Équité</th><th></th></tr></thead><tbody>{lots.map((l,i)=>{ const equity = toN(l.valeur)-toN(l.crd); return <tr key={l.id || i}><td style={{ color:T.accent, fontWeight:900 }}>{i+1}</td><td><input className="inv-inp" value={l.adresse || ""} onChange={e=>updateLot(i,"adresse",e.target.value)} placeholder="Adresse"/></td><td><select className="inv-sel" value={l.type || ""} onChange={e=>updateLot(i,"type",e.target.value)}>{STRUCT_LOT_TYPES.map(o=><option key={o}>{o}</option>)}</select></td><td><select className="inv-sel" value={l.structure || ""} onChange={e=>updateLot(i,"structure",e.target.value)}>{STRUCT_DETENTION.map(o=><option key={o}>{o}</option>)}</select></td><td><select className="inv-sel" value={l.regime || ""} onChange={e=>updateLot(i,"regime",e.target.value)}>{STRUCT_REGIMES.map(o=><option key={o}>{o}</option>)}</select></td><td><input className="inv-inp" type="number" value={l.loyer_mois || ""} onChange={e=>updateLot(i,"loyer_mois",e.target.value)} style={{textAlign:"right"}}/></td><td><input className="inv-inp" type="number" value={l.mensualite || ""} onChange={e=>updateLot(i,"mensualite",e.target.value)} style={{textAlign:"right"}}/></td><td><input className="inv-inp" type="number" value={l.crd || ""} onChange={e=>updateLot(i,"crd",e.target.value)} style={{textAlign:"right"}}/></td><td><input className="inv-inp" type="number" value={l.valeur || ""} onChange={e=>updateLot(i,"valeur",e.target.value)} style={{textAlign:"right"}}/></td><td style={{ color:equity >= 0 ? SU : DA, fontWeight:900, whiteSpace:"nowrap" }}>{fmtEur(equity)}</td><td><button className="inv-rm" onClick={()=>removeLot(i)}>×</button></td></tr>})}</tbody></table></div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginTop:12, flexWrap:"wrap" }}><button className="inv-btn inv-btn-blue inv-btn-sm" onClick={addLot}><Icon as={Plus} size={12}/> Ajouter un actif</button><div style={{ display:"flex", gap:14, color:T.textSub, fontSize:FONT.xs.size+1, fontWeight:800 }}><span>Valeur <b style={{color:T.text}}>{fmtEur(c.valeurLots)}</b></span><span>Loyers <b style={{color:T.text}}>{fmtEur(c.loyers)}/mois</b></span><span>CRD <b style={{color:T.text}}>{fmtEur(c.crdLots)}</b></span></div></div>
        </div></div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:SPACING.md }}>
          <div style={cardStyle}>{cardHd("Résidence principale & autres actifs")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:10 }}><StructField T={T} compact label="Statut RP" value={pat.residence_principale_statut} onChange={v=>updateSection("patrimoine","residence_principale_statut",v)} options={["Propriétaire — crédit en cours","Propriétaire — crédit soldé","Locataire","Hébergé(e)"]}/><StructField T={T} compact label="Valeur RP" type="number" value={pat.rp_valeur} onChange={v=>updateSection("patrimoine","rp_valeur",v)}/><StructField T={T} compact label="CRD RP" type="number" value={pat.rp_crd} onChange={v=>updateSection("patrimoine","rp_crd",v)}/><StructField T={T} compact label="Patrimoine professionnel" type="number" value={pat.patrimoine_professionnel} onChange={v=>updateSection("patrimoine","patrimoine_professionnel",v)}/><StructField T={T} compact label="Commentaires actifs pro / libéralités" type="textarea" value={pat.patrimoine_pro_commentaires || pat.liberalites} onChange={v=>updateSection("patrimoine","patrimoine_pro_commentaires",v)} wide/></div></div>
          <div style={cardStyle}>{cardHd("Patrimoine financier & retraite")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:10 }}><StructField T={T} compact label="Liquidités / livrets" type="number" value={pf.liquidites} onChange={v=>updateSection("patrimoine_financier","liquidites",v)}/><StructField T={T} compact label="Assurance-vie" type="number" value={pf.assurance_vie} onChange={v=>updateSection("patrimoine_financier","assurance_vie",v)}/><StructField T={T} compact label="PEA / CTO" type="number" value={pf.pea_cto} onChange={v=>updateSection("patrimoine_financier","pea_cto",v)}/><StructField T={T} compact label="PER / retraite" type="number" value={pf.per} onChange={v=>updateSection("patrimoine_financier","per",v)}/><StructField T={T} compact label="Épargne salariale" type="number" value={pf.epargne_salariale} onChange={v=>updateSection("patrimoine_financier","epargne_salariale",v)}/><StructField T={T} compact label="Autres placements" type="number" value={pf.autres} onChange={v=>updateSection("patrimoine_financier","autres",v)}/></div></div>
        </div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
        <div style={cardStyle}>{cardHd("Financement & capacité bancaire", "gold")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:10 }}><StructField T={T} compact label="Banque principale" value={fin.banque_principale} onChange={v=>updateSection("financement","banque_principale",v)}/><StructField T={T} compact label="Relation bancaire" value={fin.relation_bancaire} onChange={v=>updateSection("financement","relation_bancaire",v)} options={["Banque unique","Plusieurs banques","Via courtier","Mix"]}/><StructField T={T} compact label="Mensualités totales" type="number" value={fin.mensualites_total} onChange={v=>updateSection("financement","mensualites_total",v)}/><StructField T={T} compact label="Apport disponible" type="number" value={fin.apport_disponible} onChange={v=>updateSection("financement","apport_disponible",v)}/><StructField T={T} compact label="Épargne de précaution" type="number" value={fin.epargne_precaution} onChange={v=>updateSection("financement","epargne_precaution",v)}/><StructField T={T} compact label="Mensualité max supportable" type="number" value={fin.mensualite_max} onChange={v=>updateSection("financement","mensualite_max",v)}/><StructField T={T} compact label="Capacité avec revente" type="number" value={fin.capacite_avec_revente} onChange={v=>updateSection("financement","capacite_avec_revente",v)}/><StructField T={T} compact label="Finançable sans revente" value={fin.financable_sans_revente} onChange={v=>updateSection("financement","financable_sans_revente",v)} options={["Oui","Non — bloqué","Partiellement","À confirmer"]}/><StructField T={T} compact label="Taux moyen portefeuille" type="number" value={fin.taux_moyen} onChange={v=>updateSection("financement","taux_moyen",v)}/><StructField T={T} compact label="Refinancement envisagé" value={fin.refinancement_envisage} onChange={v=>updateSection("financement","refinancement_envisage",v)} options={["Oui","Non","À étudier"]}/></div></div>
        <div style={cardStyle}>{cardHd("Structures de détention & transmission", "gold")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:10 }}><StructField T={T} compact label="SCI existante" value={st.sci_nom || st.sci_existante} onChange={v=>updateSection("structures","sci_nom",v)}/><StructField T={T} compact label="Régime SCI" value={st.sci_regime} onChange={v=>updateSection("structures","sci_regime",v)} options={["IR","IS","Non défini","Pas de SCI"]}/><StructField T={T} compact label="Associés" value={st.sci_associes} onChange={v=>updateSection("structures","sci_associes",v)}/><StructField T={T} compact label="Résultat dernier bilan" type="number" value={st.sci_resultat} onChange={v=>updateSection("structures","sci_resultat",v)}/><StructField T={T} compact label="Nouvelles SCI" value={st.nouvelles_sci} onChange={v=>updateSection("structures","nouvelles_sci",v)} options={["Oui — 1 SCI / projet","À définir","Non"]}/><StructField T={T} compact label="Holding" value={st.holding} onChange={v=>updateSection("structures","holding",v)} options={["Oui","Non","À étudier"]}/><StructField T={T} compact label="Transmission / protection" type="textarea" value={st.transmission} onChange={v=>updateSection("structures","transmission",v)} wide/></div></div>
        <div style={{ ...cardStyle, padding:14 }}><div style={{ fontWeight:900, color:T.text, marginBottom:8 }}>Lecture d'analyse immédiate</div><div style={{ display:"grid", gap:7, color:T.textSub, fontSize:FONT.xs.size+1 }}><div>• Endettement indicatif : <b style={{color:c.tauxEndettement > .35 ? DA : SU}}>{fmtPct(c.tauxEndettement)}</b></div><div>• LTV globale : <b style={{color:T.text}}>{fmtPct(c.ltv)}</b></div><div>• Base IFI indicative : <b style={{color:T.text}}>{fmtEur(c.ifiBase)}</b></div><div>• Cash-flow locatif : <b style={{color:c.cashflowMois >= 0 ? SU : DA}}>{fmtEur(c.cashflowMois)}/mois</b></div><div>• Point à qualifier : <b style={{color:T.text}}>{q.alertes || "Renseigner les alertes dans l'audit"}</b></div></div></div>
      </div>
    </div>
  </div>;

  const renderFinancement = () => <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:SPACING.md }}>
    <div style={cardStyle}>{cardHd("Situation bancaire", "gold")}<div style={{ padding:16, display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:SPACING.md }}><StructField T={T} label="Banque principale" value={fin.banque_principale} onChange={v=>updateSection("financement","banque_principale",v)}/><StructField T={T} label="Relation bancaire" value={fin.relation_bancaire} onChange={v=>updateSection("financement","relation_bancaire",v)} options={["4 banques en concurrence","Banque unique","Via courtier","Mix banques + courtier"]}/><StructField T={T} label="Mensualités totales" type="number" value={fin.mensualites_total} onChange={v=>updateSection("financement","mensualites_total",v)}/><StructField T={T} label="Apport disponible" type="number" value={fin.apport_disponible} onChange={v=>updateSection("financement","apport_disponible",v)}/><StructField T={T} label="Capacité avec revente" type="number" value={fin.capacite_avec_revente} onChange={v=>updateSection("financement","capacite_avec_revente",v)}/><StructField T={T} label="Finançable sans revente" value={fin.financable_sans_revente} onChange={v=>updateSection("financement","financable_sans_revente",v)} options={["Oui","Non — bloqué","Partiellement","À confirmer"]}/><StructField T={T} label="Taux moyen" type="number" value={fin.taux_moyen} onChange={v=>updateSection("financement","taux_moyen",v)}/><StructField T={T} label="Durée initiale" value={fin.duree_initiale} onChange={v=>updateSection("financement","duree_initiale",v)} options={["15 ans","20 ans","25 ans","Mix"]}/></div></div>
    <div style={cardStyle}>{cardHd("Objectifs & structures", "gold")}<div style={{ padding:16, display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:SPACING.md }}><StructField T={T} label="Objectif principal" value={obj.objectif_principal} onChange={v=>updateSection("objectifs","objectif_principal",v)} options={["Cash-flow","Capitalisation","Transmission","Défiscalisation","Accélération patrimoniale","Mix"]}/><StructField T={T} label="Horizon" value={obj.horizon} onChange={v=>updateSection("objectifs","horizon",v)} options={["5 ans","10 ans","15 ans","20 ans","20 ans +"]}/><StructField T={T} label="Rendement cible" type="number" value={obj.rendement_cible} onChange={v=>updateSection("objectifs","rendement_cible",v)}/><StructField T={T} label="Rythme d'achat" value={obj.rythme_achat} onChange={v=>updateSection("objectifs","rythme_achat",v)} options={["1 bien / an","2 biens / an","1 bien / 2 ans","Opportuniste"]}/><StructField T={T} label="Zones" value={obj.zones} onChange={v=>updateSection("objectifs","zones",v)} /><StructField T={T} label="Gestion locative" value={obj.gestion_locative} onChange={v=>updateSection("objectifs","gestion_locative",v)} options={["Lui-même","Agence","Mix","À déléguer"]}/><StructField T={T} label="SCI existante" value={st.sci_existante} onChange={v=>updateSection("structures","sci_existante",v)} /><StructField T={T} label="Régime SCI" value={st.sci_regime} onChange={v=>updateSection("structures","sci_regime",v)} options={["IR","IS","Non défini","Pas de SCI"]}/><StructField T={T} label="Holding envisagée" value={st.holding_envisagee} onChange={v=>updateSection("structures","holding_envisagee",v)} options={["Oui","Non","À étudier"]}/><StructField T={T} label="Transmission" value={st.transmission} onChange={v=>updateSection("structures","transmission",v)} /></div></div>
  </div>;

  const renderDocuments = () => <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) 370px", gap:SPACING.md, alignItems:"start" }}>
    <div style={cardStyle}>{cardHd("Liste des documents à fournir — audit & stratégie", "gold")}<div style={{ padding:14 }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:10, marginBottom:14 }}>
        <div style={{ ...cardStyle, padding:10 }}><div style={{color:T.textMuted,fontSize:FONT.xs.size,fontWeight:900}}>TOTAL</div><div style={{color:T.text,fontWeight:900,fontSize:FONT.h3.size}}>{docs.length}</div></div>
        <div style={{ ...cardStyle, padding:10 }}><div style={{color:T.textMuted,fontSize:FONT.xs.size,fontWeight:900}}>REÇUS / TRAITÉS</div><div style={{color:SU,fontWeight:900,fontSize:FONT.h3.size}}>{c.docsRecus}</div></div>
        <div style={{ ...cardStyle, padding:10 }}><div style={{color:T.textMuted,fontSize:FONT.xs.size,fontWeight:900}}>OBLIGATOIRES VALIDÉS</div><div style={{color:T.accent,fontWeight:900,fontSize:FONT.h3.size}}>{c.docsObligatoiresOk}/{c.docsObligatoires}</div></div>
      </div>
      {STRUCT_DOC_CATEGORIES.map(cat => { const catDocs = docs.filter(doc => doc.categorie === cat.id); const complete = catDocs.filter(doc => ["Reçu","Validé","Non applicable"].includes(doc.statut)).length; return <div key={cat.id} style={{ marginBottom:14, border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, overflow:"hidden" }}>
        <div style={{ padding:"9px 10px", display:"flex", justifyContent:"space-between", gap:8, background:T.input, borderBottom:`1px solid ${T.border}` }}><div><div style={{color:T.text,fontSize:FONT.sm.size,fontWeight:900}}>{cat.label}</div><div style={{color:T.textMuted,fontSize:FONT.xs.size+1}}>{cat.description}</div></div><div style={{color:T.accent,fontWeight:900,fontSize:FONT.sm.size,whiteSpace:"nowrap"}}>{complete}/{catDocs.length}</div></div>
        <div style={{ padding:8, display:"flex", flexDirection:"column", gap:6 }}>{catDocs.map(doc => { const idx = docs.findIndex(x=>x.id===doc.id); return <div key={doc.id} style={{ display:"grid", gridTemplateColumns:"minmax(180px,1fr) 128px minmax(180px,.8fr)", gap:8, alignItems:"center", padding:"6px 8px", borderRadius:RADIUS.md, background:doc.required ? T.accentBg : "transparent" }}><div style={{color:T.text,fontSize:FONT.xs.size+1,fontWeight:doc.required ? 900 : 700}}>{doc.label}{doc.required && <span style={{color:DA,marginLeft:4}}>*</span>}</div><select className="inv-sel" value={doc.statut || "À demander"} onChange={e=>updateDoc(idx,"statut",e.target.value)} style={{fontSize:FONT.xs.size+1}}>{STRUCT_DOC_STATUTS.map(o=><option key={o}>{o}</option>)}</select><input className="inv-inp" value={doc.commentaire || ""} onChange={e=>updateDoc(idx,"commentaire",e.target.value)} placeholder="Commentaire" style={{fontSize:FONT.xs.size+1}}/></div>})}</div>
      </div> })}
      <div style={{ color:T.textMuted, fontSize:FONT.xs.size+1 }}>* Pièces nécessaires pour lancer l'analyse dans de bonnes conditions. Les documents complémentaires sont à demander selon la situation du client.</div>
    </div></div>
    <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
      <div style={cardStyle}>{cardHd("Fichiers transmis")}<div style={{ padding:14 }}><div style={{ color:T.textSub, fontSize:FONT.xs.size+1, marginBottom:10 }}>Déposez les documents reçus dans le dossier sécurisé du client.</div>{selectedId ? <DocumentsSection folder={`structuration/${selectedId}`} T={T} /> : <div style={{ color:T.textMuted }}>Créez d'abord un dossier.</div>}</div></div>
      <div style={{ ...cardStyle, padding:14, borderLeft:`4px solid ${T.accent}` }}><div style={{color:T.text,fontWeight:900,marginBottom:8}}>À demander prioritairement</div>{docs.filter(d=>d.required && !["Reçu","Validé","Non applicable"].includes(d.statut)).slice(0,8).map(d=><div key={d.id} style={{color:T.textSub,fontSize:FONT.xs.size+1,padding:"5px 0",borderBottom:`1px solid ${T.border}`}}>• {d.label}</div>)}</div>
    </div>
  </div>;

  const renderNotes = () => <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:SPACING.md }}>
    <div style={cardStyle}>{cardHd("Notes RDV", "gold")}<div style={{ padding:16, display:"grid", gap:SPACING.md }}><StructField T={T} label="Motivations captées" type="textarea" value={rdv.motivations} onChange={v=>updateSection("rdv","motivations",v)} wide/><StructField T={T} label="Objections / résistances" type="textarea" value={rdv.objections} onChange={v=>updateSection("rdv","objections",v)} wide/><StructField T={T} label="Notes libres" type="textarea" value={rdv.notes} onChange={v=>updateSection("rdv","notes",v)} wide/></div></div>
    <div style={cardStyle}>{cardHd("Issue & suivi")}
      <div style={{ padding:16, display:"grid", gridTemplateColumns:"1fr 1fr", gap:SPACING.md }}><StructField T={T} label="Issue" value={rdv.issue} onChange={v=>updateSection("rdv","issue",v)} options={["Phase 1 signée","Phase 1 + Phase 2 signées","Réflexion — relance fixée","Refus","Contrat à envoyer"]}/><StructField T={T} label="Date de relance" type="date" value={rdv.relance} onChange={v=>updateSection("rdv","relance",v)}/><StructField T={T} label="Prochaine action" value={rdv.prochaine_action} onChange={v=>updateSection("rdv","prochaine_action",v)} wide/></div>
    </div>
  </div>;

  const renderReport = () => {
    const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
    const win = window.open("", "_blank", "width=1080,height=900");
    if (!win) { alert("Autorisez les pop-ups pour générer la note patrimoniale."); return; }
    const clientName = currentClient ? clientFullName(currentClient) : [p.prenom, p.nom].filter(Boolean).join(" ") || dossier?.titre || "Client";
    const reportTitle = data.analyse?.projet_etudie || "Votre projet immobilier";
    const investmentTotal = toN(data.analyse?.investissement_total) || c.patrimoineBrut || c.valeurLots;
    const cashflowTarget = toN(data.analyse?.cashflow_cible) || c.cashflowMois;
    const lotsRows = lots.map((l,i)=>`<tr><td>${esc(l.adresse || `Lot ${i+1}`)}</td><td>${esc(l.type || "—")}</td><td>${esc(l.structure || "—")}</td><td>${esc(l.regime || "—")}</td><td>${esc(fmtEur(l.valeur))}</td><td>${esc(fmtEur(l.loyer_mois))}</td><td>${esc(fmtEur(l.mensualite))}</td><td>${esc(fmtEur(l.crd))}</td></tr>`).join("") || `<tr><td colspan="8">Aucun lot renseigné</td></tr>`;
    const pfRows = [
      ["Liquidités / livrets", pf.liquidites], ["Assurance-vie", pf.assurance_vie], ["PEA / CTO", pf.pea_cto], ["PER", pf.per], ["Épargne salariale", pf.epargne_salariale], ["Autres placements", pf.autres]
    ].filter(([,v])=>toN(v)>0).map(([label,v])=>`<tr><td>${esc(label)}</td><td>${esc(clientName)}</td><td>${esc(fmtEur(v))}</td><td>À préciser</td></tr>`).join("") || `<tr><td colspan="4">Aucun placement financier renseigné</td></tr>`;
    const maxLoyer = Math.max(1, ...lots.map(l => toN(l.loyer_mois)));
    const loyerBars = lots.map((l,i)=>{ const val = toN(l.loyer_mois); const h = Math.max(6, Math.round((val/maxLoyer)*112)); return `<div class="bar-item"><div class="bar-val">${esc(fmtEur(val))}</div><div class="bar" style="height:${h}px"></div><div class="bar-lab">${esc(l.type || `Lot ${i+1}`)}</div></div>`; }).join("") || `<div class="empty">Aucun loyer renseigné</div>`;
    const projectionRows = Array.from({length:8}, (_,i)=>{ const an=i+1; const revenus = c.loyers*12*an; const cf = c.cashflowMois*12*an; return `<div class="proj-row"><span>An ${an}</span><div class="proj-line"><i style="width:${Math.min(100, an*12)}%"></i></div><b>${esc(fmtEur(revenus))}</b><b class="green">${esc(fmtEur(cf))}</b></div>`; }).join("");
    const recos = (data.analyse?.preconisations || []).map(r=>`<div class="reco"><div class="reco-top"><b>${esc(r.axe || "Stratégie")}</b><span>${esc(r.priorite || "Moyenne")}</span></div><h4>${esc(r.titre || "Préconisation")}</h4><p>${esc(r.detail || "À préciser")}</p><small>Action : ${esc(r.action || "À définir")}</small></div>`).join("");
    const splitLines = (txt, fallback=[]) => String(txt || "").split(/\n|;/).map(x=>x.trim()).filter(Boolean).length ? String(txt || "").split(/\n|;/).map(x=>x.trim()).filter(Boolean) : fallback;
    const timeline = splitLines(data.analyse?.calendrier, ["Collecte complète des documents", "Analyse des structures actuelles", "Simulation fiscale et bancaire", "Restitution de la note patrimoniale", "Mise en œuvre avec notaire / expert-comptable / banque"]).map((x,i)=>`<div class="step"><em>${String(i+1).padStart(2,"0")}</em><strong>${esc(x)}</strong></div>`).join("");
    const pointsForts = splitLines(data.analyse?.points_forts, ["Patrimoine immobilier déjà constitué", "Capacité d'épargne à qualifier", "Effet de levier bancaire à optimiser", "Vision long terme compatible avec une structuration patrimoniale"]);
    const pointsPrep = splitLines(data.analyse?.points_preparer, ["Finaliser les documents manquants", "Valider le régime fiscal cible", "Confirmer la capacité bancaire", "Sécuriser les hypothèses de loyers et de charges"]);
    const atoutsHtml = pointsForts.map(x=>`<li>${esc(x)}</li>`).join("");
    const prepHtml = pointsPrep.map(x=>`<li>${esc(x)}</li>`).join("");
    const fiscalRows = [
      ["Structure actuelle", st.sci_nom || "Détention actuelle à préciser", st.sci_regime || "À qualifier"],
      ["Structure cible", st.nouvelles_sci || "À définir", st.holding || "Holding à arbitrer"],
      ["Objectif fiscal", data.analyse?.strategie_fiscale || obj.objectif_principal || "Optimisation IR / IS / LMNP selon horizon", "Simulation à valider"],
      ["Transmission", st.transmission || "À préciser", "Donation, démembrement ou SCI familiale à étudier"]
    ].map(r=>`<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join("");
    const debtRows = [
      ["Revenus professionnels", p.revenus_nets_mois, "100 % — à qualifier"],
      ["Dividendes / autres revenus", Math.round((toN(p.dividendes_an)+toN(p.autres_revenus_an))/12), "Selon stabilité"],
      ["Loyers retenus", Math.round(c.loyers*0.70), "70 % méthode prudentielle"],
      ["Mensualités actuelles", toN(fin.mensualites_total) || c.mensualitesLots, "Crédits en cours"]
    ].map(r=>`<tr><td>${esc(r[0])}</td><td>${esc(fmtEur(r[1]))}/mois</td><td>${esc(r[2])}</td></tr>`).join("");
    const caution = data.analyse?.point_vigilance || data.analyse?.points_attention || "Point de vigilance à formaliser : sécuriser les hypothèses fiscales, bancaires et locatives avant toute mise en œuvre.";
    const highlight = data.analyse?.point_majeur || data.analyse?.contexte_client || "Atout majeur : la structuration doit transformer les données patrimoniales du client en plan d'action clair, chiffré et pilotable.";

    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(clientName)} — Note patrimoniale</title><style>
      @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=DM+Sans:wght@300;400;500;700;900&display=swap');
      *{box-sizing:border-box}body{margin:0;background:#eef1f4;color:#0D1B2A;font-family:'DM Sans',Arial,sans-serif}.page{width:210mm;min-height:297mm;margin:0 auto 10mm;background:#fff;padding:16mm 14mm;position:relative;overflow:hidden}.cover{background:#0D1B2A;color:#F5F0E8}.brand{font-family:'Cormorant Garamond',serif;font-size:20px;letter-spacing:.5px}.brand-sub{font-size:8px;letter-spacing:3px;text-transform:uppercase;color:#C9A84C}.doc-date{position:absolute;right:16mm;top:14mm;text-align:right;color:rgba(245,240,232,.55);font-size:10px}.eyebrow{font-size:9px;letter-spacing:4px;text-transform:uppercase;color:#C9A84C;font-weight:700}.cover-title{font-family:'Cormorant Garamond',serif;font-size:48px;line-height:.96;font-weight:300;margin:18mm 0 6mm}.cover-title em{color:#C9A84C;font-style:italic}.cover-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14mm;margin-top:12mm}.cover-k{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#C9A84C}.cover-v{font-size:16px;font-weight:700;margin-top:4px}.quote{position:absolute;left:14mm;right:14mm;bottom:36mm;border-left:2px solid #C9A84C;padding:8mm;color:rgba(245,240,232,.75);font-family:'Cormorant Garamond',serif;font-size:15px;line-height:1.55;background:rgba(255,255,255,.03)}.footer{position:absolute;left:14mm;right:14mm;bottom:8mm;border-top:1px solid rgba(13,27,42,.12);padding-top:5mm;font-size:8px;color:#8a96a3;display:flex;justify-content:space-between}.cover .footer{border-color:rgba(245,240,232,.15);color:rgba(245,240,232,.35)}h2{font-family:'Cormorant Garamond',serif;font-size:30px;font-weight:400;margin:0 0 7mm;color:#0D1B2A}.sec{font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#C9A84C;font-weight:800;margin-bottom:2mm}.line{height:1px;background:#e6e6e6;margin-bottom:6mm}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;margin-bottom:6mm}.card{border:1px solid #e5e8ec;border-top:3px solid #C9A84C;padding:4mm;background:#fff}.card.green{border-top-color:#2D6A4F}.card.blue{border-top-color:#185FA5}.card b{display:block;font-size:20px}.card span{font-size:8px;text-transform:uppercase;color:#7A8A9A;letter-spacing:.8px;font-weight:900}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:6mm}.box{border:1px solid #e5e8ec;background:#fff;margin-bottom:6mm}.box h3{margin:0;background:#0D1B2A;color:white;font-size:12px;text-transform:uppercase;letter-spacing:1.2px;padding:3mm 4mm}.box .bd{padding:4mm;font-size:11px;line-height:1.65}.note{border:1px solid #E2C97E;background:#fff9e7;padding:5mm;margin:5mm 0;font-size:13px;line-height:1.7}.note b{color:#854F0B}table{width:100%;border-collapse:collapse;font-size:10.5px}th{background:#0D1B2A;color:white;text-align:left;padding:2.6mm;font-size:8px;text-transform:uppercase;letter-spacing:1px}td{border-bottom:1px solid #edf0f2;padding:2.4mm}tr.total td{background:#0D1B2A;color:white;font-weight:900}.bar-chart{height:150px;display:flex;gap:8mm;align-items:flex-end;justify-content:center;border:1px solid #eef1f4;padding:6mm 4mm 8mm}.bar-item{text-align:center;min-width:18mm}.bar{width:13mm;background:#12385f;margin:2mm auto 0;border-radius:2px 2px 0 0}.bar-val{font-size:9px;font-weight:900;color:#12385f}.bar-lab{font-size:8px;color:#738090;margin-top:2mm}.proj-row{display:grid;grid-template-columns:22mm 1fr 24mm 24mm;gap:4mm;align-items:center;font-size:10px;margin:2mm 0}.proj-line{height:4px;background:#eef1f4;border-radius:99px;overflow:hidden}.proj-line i{display:block;height:100%;background:#12385f}.green{color:#2D6A4F}.red{color:#7B2D2D}.reco{border-left:3px solid #C9A84C;background:#fbf7eb;padding:4mm;margin-bottom:3mm}.reco-top{display:flex;justify-content:space-between;font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#7A8A9A}.reco h4{margin:1mm 0;font-size:13px;color:#0D1B2A}.reco p{margin:0 0 2mm;font-size:11px}.step{border:1px solid #e5e8ec;padding:5mm;margin-bottom:4mm}.step em{font-family:'Cormorant Garamond',serif;font-size:28px;color:#C9A84C;font-style:normal;margin-right:5mm}.step strong{font-size:12px}.cols{display:grid;grid-template-columns:1fr 1fr;gap:8mm}.pill-list{list-style:none;margin:0;padding:0}.pill-list li{padding:3mm 4mm;margin-bottom:3mm;border-radius:4px;border:1px solid #d9efe4;background:#effaf4;color:#2D6A4F;font-size:11px}.pill-list.warn li{border-color:#f3dfa7;background:#fff8df;color:#854F0B}.dark-call{background:#0D1B2A;color:#F5F0E8;padding:8mm;margin-top:8mm;font-family:'Cormorant Garamond',serif;font-size:16px;line-height:1.6;border-left:3px solid #C9A84C}.no-print{position:fixed;right:16px;top:16px;z-index:10}.btn{background:#0D1B2A;color:white;border:0;border-radius:8px;padding:11px 16px;font-weight:900;cursor:pointer}.empty{font-size:11px;color:#8a96a3;align-self:center}@media print{body{background:white}.page{margin:0;page-break-after:always}.page:last-child{page-break-after:auto}.no-print{display:none}@page{size:A4;margin:0}}
    </style></head><body><div class="no-print"><button class="btn" onclick="window.print()">Imprimer / PDF</button></div>

    <section class="page cover"><div class="brand">Profero Invest</div><div class="brand-sub">Conseil en structuration du patrimoine immobilier</div><div class="doc-date">Note patrimoniale<br/>${new Date().toLocaleDateString("fr-FR",{month:"long",year:"numeric"})}</div><div style="margin-top:34mm" class="eyebrow">Note patrimoniale & stratégie d'investissement</div><div class="cover-title">Votre projet<br/><em>immobilier</em></div><div style="font-size:17px">${esc(clientName)}</div><div class="cover-grid"><div><div class="cover-k">Projet</div><div class="cover-v">${esc(reportTitle)}</div></div><div><div class="cover-k">Patrimoine / investissement total</div><div class="cover-v">${esc(fmtEur(investmentTotal))}</div></div><div><div class="cover-k">Cash-flow cible</div><div class="cover-v">${esc(fmtEur(cashflowTarget))}/mois</div></div></div><div class="quote">${esc(data.analyse?.note_finale || data.analyse?.contexte_client || `Cette note synthétise la situation patrimoniale de ${clientName}, les points clés identifiés, les arbitrages structurants et les prochaines étapes pour transformer le patrimoine existant en stratégie immobilière lisible et pilotable.`)}</div><div class="footer"><span>Profero Invest — document confidentiel</span><span>01</span></div></section>

    <section class="page"><div class="sec">01 — Qui vous êtes</div><h2>Votre profil patrimonial</h2><div class="line"></div><div class="cards"><div class="card"><b>${esc(fmtEur(p.revenus_nets_mois))}</b><span>Revenus nets mensuels</span></div><div class="card"><b>${esc(fmtEur(c.patrimoineFinancier))}</b><span>Patrimoine financier</span></div><div class="card"><b>${esc(fmtEur(fin.apport_disponible))}</b><span>Apport disponible</span></div><div class="card green"><b>${esc(p.tmi || "—")}</b><span>TMI déclarée</span></div></div><div class="note"><b>Atout majeur —</b> ${esc(highlight)}</div><div class="box"><h3>Situation personnelle & professionnelle</h3><div class="bd"><table><tbody><tr><td>Client</td><td><b>${esc(clientName)}</b></td></tr><tr><td>Situation familiale</td><td>${esc(p.situation_familiale || "À préciser")}</td></tr><tr><td>Régime matrimonial</td><td>${esc(p.regime_matrimonial || "À préciser")}</td></tr><tr><td>Profession</td><td>${esc(p.profession || "À préciser")}</td></tr><tr><td>Statut professionnel</td><td>${esc(p.statut_pro || p.statut_professionnel || "À préciser")}</td></tr><tr><td>Résidence fiscale</td><td>${esc(p.residence_fiscale || "France")}</td></tr></tbody></table></div></div><div class="box"><h3>Votre patrimoine financier détaillé</h3><div class="bd"><table><thead><tr><th>Actif</th><th>Titulaire</th><th>Montant</th><th>Disponibilité</th></tr></thead><tbody>${pfRows}<tr class="total"><td colspan="2">TOTAL</td><td colspan="2">${esc(fmtEur(c.patrimoineFinancier))}</td></tr></tbody></table></div></div><div class="footer"><span>Profero Invest</span><span>02</span></div></section>

    <section class="page"><div class="sec">02 — Ce que vous avez déjà bâti</div><h2>Patrimoine immobilier existant</h2><div class="line"></div><div class="cards"><div class="card"><b>${esc(fmtEur(c.valeurLots))}</b><span>Valeur locative détenue</span></div><div class="card"><b>${esc(fmtEur(c.crdLots))}</b><span>Capital restant dû</span></div><div class="card green"><b>${esc(fmtEur(c.loyers))}/mois</b><span>Loyers mensuels</span></div><div class="card ${c.cashflowMois>=0?'green':'red'}"><b>${esc(fmtEur(c.cashflowMois))}/mois</b><span>Cash-flow locatif</span></div></div><div class="box"><h3>Inventaire immobilier</h3><div class="bd"><table><thead><tr><th>#</th><th>Bien</th><th>Type</th><th>Structure</th><th>Fiscalité</th><th>Valeur</th><th>Loyer</th><th>CRD</th></tr></thead><tbody>${lotsRows}</tbody></table></div></div><div class="grid2"><div class="box"><h3>Structure actuelle</h3><div class="bd"><table><tbody><tr><td>SCI existante</td><td>${esc(st.sci_nom || st.sci_existante || "À préciser")}</td></tr><tr><td>Régime</td><td>${esc(st.sci_regime || "À préciser")}</td></tr><tr><td>Associés</td><td>${esc(st.sci_associes || "À préciser")}</td></tr><tr><td>Résultat / bilan</td><td>${esc(fmtEur(st.sci_resultat))}</td></tr></tbody></table></div></div><div class="box"><h3>Lecture Profero</h3><div class="bd">${esc(data.analyse?.diagnostic || "Diagnostic patrimonial à compléter : performance des actifs, structure de détention, fiscalité, transmission et capacité bancaire.")}</div></div></div><div class="footer"><span>Profero Invest</span><span>03</span></div></section>

    <section class="page"><div class="sec">03 — Le projet / l'opportunité</div><h2>${esc(reportTitle)}</h2><div class="line"></div><div class="cards"><div class="card"><b>${esc(fmtEur(c.rendementBrut*100))}</b><span>Rendement brut indicatif</span></div><div class="card green"><b>${esc(fmtEur(c.cashflowMois))}</b><span>Cash-flow actuel / cible</span></div><div class="card"><b>${esc(fmtEur(c.loyers))}/mois</b><span>Rentrée locative</span></div><div class="card blue"><b>${esc(fmtEur(investmentTotal))}</b><span>Base patrimoniale</span></div></div><div class="grid2"><div class="box"><h3>Paramètres clés</h3><div class="bd"><table><tbody><tr><td>Projet étudié</td><td>${esc(reportTitle)}</td></tr><tr><td>Objectif principal</td><td>${esc(obj.objectif_principal || "À préciser")}</td></tr><tr><td>Horizon</td><td>${esc(obj.horizon || "À préciser")}</td></tr><tr><td>Zones cibles</td><td>${esc(obj.zones || "À préciser")}</td></tr><tr><td>Apport disponible</td><td>${esc(fmtEur(fin.apport_disponible))}</td></tr><tr><td>Capacité avec revente</td><td>${esc(fmtEur(fin.capacite_avec_revente))}</td></tr></tbody></table></div></div><div class="box"><h3>Loyers mensuels par lot</h3><div class="bd"><div class="bar-chart">${loyerBars}</div></div></div></div><div class="note"><b>Point de vigilance —</b> ${esc(caution)}</div><div class="footer"><span>Profero Invest</span><span>04</span></div></section>

    <section class="page"><div class="sec">04 — Le cœur de la stratégie</div><h2>Optimisation fiscale & architecture patrimoniale</h2><div class="line"></div><div class="box"><h3>Architecture patrimoniale cible</h3><div class="bd"><table><thead><tr><th>Thème</th><th>Lecture actuelle / cible</th><th>Point de décision</th></tr></thead><tbody>${fiscalRows}</tbody></table></div></div><div class="grid2"><div class="box"><h3>Pourquoi structurer ?</h3><div class="bd">${esc(data.analyse?.strategie_recommandee || "La structuration vise à aligner la fiscalité, le financement, la transmission et l'exploitation du patrimoine avec les objectifs de long terme du client.")}</div></div><div class="box"><h3>Simulation fiscale à réaliser</h3><div class="bd">${esc(data.analyse?.simulation_fiscale || "À compléter : comparaison détention directe / SCI IR / SCI IS / LMNP, imputation des déficits, effort d'épargne, fiscalité annuelle et impact transmission.")}</div></div></div><div class="box"><h3>Préconisations opérationnelles</h3><div class="bd">${recos || "Préconisations à compléter dans l'onglet Analyse."}</div></div><div class="footer"><span>Profero Invest</span><span>05</span></div></section>

    <section class="page"><div class="sec">05 — Le dossier bancaire</div><h2>Capacité d'emprunt & taux d'endettement</h2><div class="line"></div><div class="grid2"><div class="box"><h3>Revenus retenus par la banque</h3><div class="bd"><table><thead><tr><th>Source</th><th>Montant</th><th>Méthode</th></tr></thead><tbody>${debtRows}<tr class="total"><td>Total revenus retenus</td><td>${esc(fmtEur(c.revenusRetenus))}/mois</td><td>Lecture indicative</td></tr></tbody></table></div></div><div class="box"><h3>Taux d'endettement</h3><div class="bd"><div class="cards" style="grid-template-columns:1fr 1fr"><div class="card ${c.tauxEndettement>0.35?'red':'green'}"><b>${esc(fmtPct(c.tauxEndettement))}</b><span>Endettement indicatif</span></div><div class="card"><b>${esc(fmtEur(c.crdTotal))}</b><span>CRD total</span></div></div>${esc(data.analyse?.capacite_emprunt || "À compléter : lecture bancaire, marge de manœuvre, apport mobilisable, scénarios avec ou sans revente / refinancement.")}</div></div></div><div class="note"><b>Point à valider —</b> ${esc(data.analyse?.revenus_exceptionnels || "Identifier les revenus que la banque retiendra réellement et ceux qui doivent être sécurisés par une hypothèse prudente.")}</div><div class="footer"><span>Profero Invest</span><span>06</span></div></section>

    <section class="page"><div class="sec">06 — Ce qui nous attend</div><h2>Calendrier & prochaines étapes</h2><div class="line"></div>${timeline}<div class="footer"><span>Profero Invest</span><span>07</span></div></section>

    <section class="page"><div class="sec">07 — Ce qu'il faut retenir</div><h2>Synthèse & points d'action</h2><div class="line"></div><div class="cols"><div><h3 style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:400">Points forts du dossier</h3><ul class="pill-list">${atoutsHtml}</ul></div><div><h3 style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:400">Points à préparer</h3><ul class="pill-list warn">${prepHtml}</ul></div></div><div class="dark-call">${esc(data.analyse?.conclusion || "Vous disposez d'une base patrimoniale qui peut devenir beaucoup plus lisible, finançable et transmissible à condition de structurer les détentions, qualifier les flux et sécuriser le calendrier de mise en œuvre.")}</div><div class="footer"><span>Profero Invest — conseil en structuration du patrimoine immobilier</span><span>08</span></div></section>

    </body></html>`);
    win.document.close();
  };

  const renderAnalyse = () => {
    const alertesAuto = [
      c.tauxEndettement > .35 ? `Endettement indicatif élevé : ${fmtPct(c.tauxEndettement)}` : null,
      c.ltv > .80 ? `Levier élevé : LTV ${fmtPct(c.ltv)}` : null,
      p.ifi === "Assujetti" || c.ifiBase > 1300000 ? "IFI à traiter dans la stratégie" : null,
      q.situation_bancaire && q.situation_bancaire !== "RAS" ? `Situation bancaire : ${q.situation_bancaire}` : null,
      c.docsObligatoiresOk < c.docsObligatoires ? `${c.docsObligatoires - c.docsObligatoiresOk} pièces obligatoires à obtenir` : null,
      !st.sci_regime && c.valeurLots > 500000 ? "Structure de détention à qualifier" : null,
    ].filter(Boolean);
    const readiness = Math.round((c.completion * .7) + ((c.docsObligatoires ? c.docsObligatoiresOk/c.docsObligatoires : 0) * 30));
    return <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,minmax(0,1fr))", gap:SPACING.md }}>
        {kpi("Patrimoine net", fmtEur(c.patrimoineNet), `Brut ${fmtEur(c.patrimoineBrut)}`, "gold")}
        {kpi("Endettement", fmtPct(c.tauxEndettement), c.tauxEndettement > .35 ? "Vigilance" : "À valider", c.tauxEndettement > .35 ? "red" : "green")}
        {kpi("Cash-flow", `${fmtEur(c.cashflowMois)}/mois`, `Rendement ${fmtPct(c.rendementBrut)}`, c.cashflowMois >= 0 ? "green" : "red")}
        {kpi("IFI indicatif", fmtEur(c.ifiBase), "Assiette à confirmer")}
        {kpi("Dossier prêt", `${readiness} %`, `${c.docsObligatoiresOk}/${c.docsObligatoires} pièces clés`, readiness >= 75 ? "green" : "red")}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"minmax(320px,.75fr) minmax(0,1.25fr)", gap:SPACING.md, alignItems:"start" }}>
        <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
          <div style={cardStyle}>{cardHd("Feu tricolore de décision", "gold")}<div style={{padding:14}}>
            {alertesAuto.length ? alertesAuto.map((a,i)=><div key={i} style={{padding:"8px 10px",marginBottom:6,background:SEMANTIC.warning.bg,border:`1px solid ${SEMANTIC.warning.border}`,borderRadius:RADIUS.md,color:T.text,fontSize:FONT.xs.size+1,fontWeight:700}}>⚠ {a}</div>) : <div style={{padding:"10px",background:SEMANTIC.success.bg,border:`1px solid ${SEMANTIC.success.border}`,borderRadius:RADIUS.md,color:SU,fontWeight:900}}>Aucune alerte automatique majeure identifiée</div>}
            <div style={{marginTop:10}}><StructField T={T} label="Points d'attention conseiller" type="textarea" value={data.analyse?.points_attention} onChange={v=>updateAnalyse("points_attention",v)} wide compact/></div>
          </div></div>
          <div style={cardStyle}>{cardHd("Livrable & restitution")}<div style={{padding:14,display:"grid",gap:10}}><StructField T={T} compact label="Titre du projet / dossier" value={data.analyse?.projet_etudie} onChange={v=>updateAnalyse("projet_etudie",v)}/><StructField T={T} compact label="Contexte à afficher en couverture" type="textarea" value={data.analyse?.contexte_client} onChange={v=>updateAnalyse("contexte_client",v)} wide/><StructField T={T} compact label="Conclusion de restitution" type="textarea" value={data.analyse?.conclusion} onChange={v=>updateAnalyse("conclusion",v)} wide/><button className="inv-btn inv-btn-blue" onClick={renderReport}><Icon as={FileText} size={13}/> Générer la note patrimoniale PDF</button></div></div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
          <div style={cardStyle}>{cardHd("Matrice d'analyse patrimoniale", "gold")}<div style={{padding:14,display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:10}}>
            <StructField T={T} compact label="Performance des actifs / arbitrages" type="textarea" value={data.analyse?.analyse_performance} onChange={v=>updateAnalyse("analyse_performance",v)} wide/>
            <StructField T={T} compact label="Capacité bancaire / refinancement" type="textarea" value={data.analyse?.analyse_bancaire || data.analyse?.capacite_emprunt} onChange={v=>updateAnalyse("analyse_bancaire",v)} wide/>
            <StructField T={T} compact label="Fiscalité actuelle & cible" type="textarea" value={data.analyse?.analyse_fiscale || data.analyse?.strategie_fiscale} onChange={v=>updateAnalyse("analyse_fiscale",v)} wide/>
            <StructField T={T} compact label="Structures de détention" type="textarea" value={data.analyse?.analyse_structure} onChange={v=>updateAnalyse("analyse_structure",v)} wide/>
            <StructField T={T} compact label="Transmission & protection familiale" type="textarea" value={data.analyse?.analyse_transmission} onChange={v=>updateAnalyse("analyse_transmission",v)} wide/>
            <StructField T={T} compact label="Risques / conditions de mise en œuvre" type="textarea" value={data.analyse?.analyse_risques} onChange={v=>updateAnalyse("analyse_risques",v)} wide/>
          </div></div>
          <div style={cardStyle}>{cardHd("Diagnostic & recommandation centrale", "gold")}<div style={{padding:14,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><StructField T={T} compact label="Diagnostic patrimonial" type="textarea" value={data.analyse?.diagnostic} onChange={v=>updateAnalyse("diagnostic",v)} wide/><StructField T={T} compact label="Stratégie recommandée" type="textarea" value={data.analyse?.strategie_recommandee} onChange={v=>updateAnalyse("strategie_recommandee",v)} wide/><StructField T={T} compact label="Arbitrages à envisager" type="textarea" value={data.analyse?.arbitrages} onChange={v=>updateAnalyse("arbitrages",v)} wide/><StructField T={T} compact label="Professionnels à mobiliser" type="textarea" value={data.analyse?.professionnels_a_mobiliser} onChange={v=>updateAnalyse("professionnels_a_mobiliser",v)} wide/></div></div>
        </div>
      </div>
      <div style={cardStyle}>{cardHd("Scénarios stratégiques comparés", "gold")}<div style={{padding:14,display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:SPACING.md}}>{(data.analyse?.scenarios || []).map((scenario,i)=><div key={scenario.id || i} style={{padding:12,border:`1px solid ${T.border}`,borderRadius:RADIUS.lg,background:T.input,display:"grid",gap:8}}><StructField T={T} compact label="Scénario" value={scenario.nom} onChange={v=>updateScenario(i,"nom",v)}/><StructField T={T} compact label="Objectif / bénéfice recherché" type="textarea" value={scenario.objectif} onChange={v=>updateScenario(i,"objectif",v)}/><StructField T={T} compact label="Statut" value={scenario.statut} onChange={v=>updateScenario(i,"statut",v)} options={["À étudier","Recommandé","Alternative","À écarter"]}/></div>)}</div></div>
      <div style={cardStyle}>{cardHd("Plan de préconisations opérationnelles", "gold")}<div style={{padding:14,display:"flex",flexDirection:"column",gap:8}}>{(data.analyse?.preconisations || []).map((r,i)=><div key={r.id || i} style={{display:"grid",gridTemplateColumns:"125px 104px minmax(180px,1fr) minmax(190px,1.25fr) minmax(180px,1fr) 36px",gap:8,alignItems:"center",padding:9,border:`1px solid ${T.border}`,borderRadius:RADIUS.md,background:T.input}}><select className="inv-sel" value={r.axe || ""} onChange={e=>updateReco(i,"axe",e.target.value)}>{["Financement","Fiscalité","Structure","Transmission","Arbitrage","Gestion","Documents","Stratégie"].map(o=><option key={o}>{o}</option>)}</select><select className="inv-sel" value={r.priorite || ""} onChange={e=>updateReco(i,"priorite",e.target.value)}>{["Haute","Moyenne","Basse"].map(o=><option key={o}>{o}</option>)}</select><input className="inv-inp" value={r.titre || ""} onChange={e=>updateReco(i,"titre",e.target.value)} placeholder="Préconisation"/><input className="inv-inp" value={r.detail || ""} onChange={e=>updateReco(i,"detail",e.target.value)} placeholder="Justification"/><input className="inv-inp" value={r.action || ""} onChange={e=>updateReco(i,"action",e.target.value)} placeholder="Action / intervenant / délai"/><button className="inv-rm" onClick={()=>removeReco(i)}>×</button></div>)}<button className="inv-btn inv-btn-blue inv-btn-sm" onClick={addReco} style={{alignSelf:"flex-start"}}><Icon as={Plus} size={12}/> Ajouter une préconisation</button></div></div>
      <div style={cardStyle}>{cardHd("Calendrier & synthèse finale")}<div style={{padding:14,display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:10}}><StructField T={T} compact label="Calendrier — une étape par ligne" type="textarea" value={data.analyse?.calendrier} onChange={v=>updateAnalyse("calendrier",v)} wide/><StructField T={T} compact label="Points forts — une ligne par point" type="textarea" value={data.analyse?.points_forts} onChange={v=>updateAnalyse("points_forts",v)} wide/><StructField T={T} compact label="Points à préparer — une ligne par point" type="textarea" value={data.analyse?.points_preparer} onChange={v=>updateAnalyse("points_preparer",v)} wide/><StructField T={T} compact label="Texte final de synthèse" type="textarea" value={data.analyse?.note_finale} onChange={v=>updateAnalyse("note_finale",v)} wide/></div></div>
    </div>;
  };

  const renderContent = () => {
    if (!selectedId || !dossier) return renderListView();
    const map = { audit:renderAudit, profil:renderProfil, patrimoine:renderPatrimoine, documents:renderDocuments, analyse:renderAnalyse };
    return <div style={{ display:"flex", flexDirection:"column", gap:SPACING.sm, minHeight:0, height:"100%" }}>
      <div style={{ flexShrink:0 }}>{renderDossierHeader()}</div>
      <div style={{ flexShrink:0 }}>{renderTabs()}</div>
      <div style={{ minHeight:0, overflowY:"auto", paddingRight:4, maxHeight:"calc(100vh - 335px)" }}>{map[tab]?.()}</div>
    </div>;
  };

  return <div style={{ padding:`${SPACING.md}px ${SPACING.xl}px`, maxWidth:1800, margin:"0 auto", height:"calc(100vh - 24px)", overflow:"hidden" }}>
    <style>{`.structuration-compact .inv-inp,.structuration-compact .inv-sel,.structuration-compact .inv-textarea{color:${T.text}!important;background:${T.input}!important}.structuration-compact option{color:#0D1B2A;background:#fff}.structuration-compact ::placeholder{color:${T.textMuted}!important;opacity:.85}`}</style>
    <div className="structuration-compact" style={{ display:"grid", gridTemplateColumns:"300px minmax(0,1fr)", gap:SPACING.md, alignItems:"start", height:"100%", minHeight:0 }}>
      <div style={{ height:"100%", minHeight:0 }}>{renderSidebarDossiers()}</div>
      <div style={{ minWidth:0, height:"100%", minHeight:0, overflow:"hidden" }}>
        {error && <div style={{ marginBottom:SPACING.sm, padding:"10px 12px", background:SEMANTIC.warning.bg, border:`1px solid ${SEMANTIC.warning.border}`, color:WA, borderRadius:RADIUS.md }}>{error}</div>}
        {renderContent()}
      </div>
    </div>
  </div>;
}

// ─── SIDEBAR INVEST ───────────────────────────────────────────────────────────
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
    crm:        Users,
    biens:      Building2,
    simulateur: BarChart3,
    finance:    Wallet,
    suivi_financier: Euro,
    structuration: Briefcase,
    admin:      Settings,
  };

  // Construction de la nav depuis PAGES_INVEST, filtrée par les pages autorisées
  // pour le rôle courant (config dynamique avec fallback ROLE_PAGES_DEFAULT_INVEST).
  const allowed = (rolePages && rolePages[role]) || ROLE_PAGES_DEFAULT_INVEST[role] || ROLE_PAGES_DEFAULT_INVEST.admin;
  const NAV = PAGES_INVEST
    .filter(p => allowed.includes(p.id))
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
  const canSee = (p) => canAccessInvest(rolePages, role, p);
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
        {page === "crm"        && (canSee("crm")        ? <CRM profil={profil} T={T} initialFilter={crmInitialFilter} onOuvrirSimulation={ouvrirSimulationDepuisCRM} onOpenStructuration={ouvrirStructurationDepuisClient} />        : <AccesRefuseInvest T={T} page="crm"/>)}
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
