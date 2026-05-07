import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";

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
const THEMES_INV = {
  dark: {
    bg:"#080a0d", surface:"#111318", card:"#111318", cardHover:"rgba(255,255,255,0.04)",
    border:"#1e2130", text:"#e8eaf0", textSub:"rgba(255,255,255,0.5)",
    textMuted:"rgba(255,255,255,0.25)", accent:"#4db8ff", sidebar:"#0c0e14",
    input:"#1a1d24", inputBorder:"#2a2d3a", scrollThumb:"#2a2d3a",
    rowBorder:"#1e2130", sectionHd:"#1a1d24", tabNav:"#111318",
  },
  light: {
    bg:"#f0f4f8", surface:"#ffffff", card:"#ffffff", cardHover:"#f5f7fa",
    border:"#dde3ec", text:"#1a2d4a", textSub:"rgba(26,45,74,0.65)",
    textMuted:"rgba(26,45,74,0.4)", accent:"#1f7ac0", sidebar:"#1a2d4a",
    input:"#ffffff", inputBorder:"#1f7ac0", scrollThumb:"#b0c4d8",
    rowBorder:"#e8eef5", sectionHd:"#f5f7fa", tabNav:"#ffffff",
  },
};

// ─── CSS INVEST — aligné sur Profero Rénovation ────────────────────────────────
const getCSS = (T) => `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap');
.inv{font-family:'Barlow Condensed','Arial Narrow',sans-serif;background:${T.bg};color:${T.text};font-size:14px;}
.inv *{box-sizing:border-box;margin:0;padding:0;}
.inv ::-webkit-scrollbar{width:5px;height:5px;}
.inv ::-webkit-scrollbar-thumb{background:${T.scrollThumb};border-radius:3px;}
.inv-card{background:${T.card};border-radius:10px;border:1px solid ${T.border};overflow:hidden;}
.inv-card-hd{background:${T.sectionHd};color:${T.text};padding:10px 16px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid ${T.border};}
.inv-card-hd.accent{background:rgba(77,184,255,0.1);color:${T.accent};border-bottom-color:rgba(77,184,255,0.2);}
.inv-card-hd.danger{background:rgba(224,92,92,0.1);color:#e05c5c;border-bottom-color:rgba(224,92,92,0.2);}
.inv-card-hd.green{background:rgba(80,200,120,0.08);color:#50c878;border-bottom-color:rgba(80,200,120,0.15);}
.inv-card-bd{padding:14px 16px;}
.inv-row{display:grid;grid-template-columns:1fr auto;align-items:center;padding:7px 0;border-bottom:1px solid ${T.rowBorder};gap:12px;}
.inv-row:last-child{border-bottom:none;}
.inv-row.total{border-top:2px solid ${T.accent};margin-top:4px;padding-top:8px;border-bottom:none;}
.inv-row.sub{background:${T.cardHover};margin:0 -16px;padding:7px 16px;}
.inv-lbl{font-size:13px;color:${T.textSub};}
.inv-lbl.bold{font-weight:700;color:${T.text};}
.inv-val{font-family:'DM Mono',monospace;font-size:13px;text-align:right;font-weight:500;white-space:nowrap;color:${T.textSub};}
.inv-val.calc{color:${T.accent};}
.inv-val.green{color:#50c878;font-weight:700;}
.inv-val.orange{color:#f5a623;font-weight:700;}
.inv-val.red{color:#e05c5c;font-weight:700;}
.inv-inp{font-family:'DM Mono',monospace;font-size:13px;font-weight:500;color:${T.accent};background:${T.input};border:1.5px solid ${T.inputBorder};border-radius:6px;padding:6px 10px;text-align:right;outline:none;transition:border-color .15s;}
.inv-inp:focus{border-color:${T.accent};box-shadow:0 0 0 2px rgba(77,184,255,.1);}
.inv-sel{font-family:'Barlow Condensed',sans-serif;font-size:13px;color:${T.text};background:${T.input};border:1.5px solid ${T.border};border-radius:6px;padding:6px 10px;outline:none;cursor:pointer;}
.inv-sel:focus{border-color:${T.accent};}
.inv-kpi{background:${T.card};border-radius:10px;padding:16px 18px;border:1px solid ${T.border};display:flex;flex-direction:column;gap:6px;transition:border-color .15s;}
.inv-kpi:hover{border-color:${T.accent};}
.inv-kpi-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:${T.textMuted};}
.inv-kpi-val{font-family:'DM Mono',monospace;font-size:24px;font-weight:700;color:${T.text};}
.inv-kpi-val.green{color:#50c878;}
.inv-kpi-val.orange{color:#f5a623;}
.inv-kpi-val.red{color:#e05c5c;}
.inv-kpi-val.accent{color:${T.accent};}
.inv-tab-nav{background:${T.tabNav};display:flex;padding:0 20px;gap:2px;border-bottom:1px solid ${T.border};flex-shrink:0;}
.inv-tab-btn{padding:10px 18px;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:${T.textMuted};background:transparent;border:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;letter-spacing:.5px;text-transform:uppercase;}
.inv-tab-btn:hover{color:${T.textSub};}
.inv-tab-btn.active{color:${T.accent};border-bottom-color:${T.accent};}
.inv-scen-hd{display:grid;grid-template-columns:1fr 110px 110px;padding:8px 16px;background:${T.sectionHd};font-size:10px;font-weight:700;color:${T.textMuted};letter-spacing:.08em;text-transform:uppercase;}
.inv-scen-row{display:grid;grid-template-columns:1fr 110px 110px;align-items:center;padding:7px 16px;border-bottom:1px solid ${T.rowBorder};gap:8px;}
.inv-scen-row:last-child{border-bottom:none;}
.inv-scen-row.hl{background:rgba(80,200,120,0.06);}
.inv-scen-row.warn{background:rgba(245,166,35,0.06);}
.inv-s{font-family:'DM Mono',monospace;font-size:13px;text-align:right;font-weight:500;color:${T.textSub};}
.inv-s.green{color:#50c878;font-weight:700;}
.inv-s.orange{color:#f5a623;font-weight:700;}
.inv-lot-grid{display:grid;grid-template-columns:90px 75px 75px 95px 70px 65px 70px 1fr 55px;gap:5px;align-items:center;padding:5px 0;border-bottom:1px solid ${T.rowBorder};min-width:680px;}
.inv-lot-grid.hd{font-size:10px;font-weight:700;color:${T.textMuted};letter-spacing:.06em;text-transform:uppercase;padding-bottom:8px;border-bottom:1px solid ${T.border};}
.inv-lot-grid input,.inv-lot-grid select{width:100%;}
.inv-lot-val{font-family:'DM Mono',monospace;font-size:12px;text-align:right;color:${T.textSub};}
.inv-add-lot{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:8px;padding:7px;background:${T.cardHover};border:1.5px dashed ${T.border};border-radius:6px;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:${T.accent};width:100%;letter-spacing:.5px;opacity:.7;}
.inv-add-lot:hover{opacity:1;border-color:${T.accent};}
.inv-brow{display:grid;grid-template-columns:1fr 60px 65px 75px 80px;padding:5px 0;border-bottom:1px solid ${T.rowBorder};align-items:center;gap:5px;}
.inv-brow.hd{font-size:10px;font-weight:700;color:${T.textMuted};text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid ${T.border};padding-bottom:8px;}
.inv-brow .bl{font-size:12px;color:${T.textSub};}
.inv-brow .bn{font-family:'DM Mono',monospace;font-size:12px;text-align:right;color:${T.textSub};}
.inv-brow input{width:100%;}
.inv-bsec{background:${T.sectionHd};color:${T.accent};padding:5px 0;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin:8px 0 3px;border-bottom:1px solid ${T.border};opacity:.8;}
.inv-regime{background:${T.card};border-radius:10px;border:1px solid ${T.border};overflow:hidden;}
.inv-regime-hd{padding:10px 14px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;}
.inv-regime-hd.is{background:rgba(30,58,95,0.5);color:#4db8ff;}
.inv-regime-hd.ir{background:rgba(58,30,95,0.5);color:#c084fc;}
.inv-regime-hd.lmnp{background:rgba(30,95,42,0.5);color:#50c878;}
.inv-regime-row{display:flex;justify-content:space-between;align-items:center;padding:6px 14px;border-bottom:1px solid ${T.rowBorder};gap:8px;}
.inv-regime-row:last-child{border-bottom:none;}
.inv-regime-row .rl{font-size:11px;color:${T.textSub};flex:1;}
.inv-regime-row .rv{font-family:'DM Mono',monospace;font-size:12px;font-weight:600;text-align:right;color:${T.text};}
.inv-regime-row.hl{background:rgba(80,200,120,0.06);}
.inv-regime-row.warn{background:rgba(245,166,35,0.06);}
.inv-toggle-wrap{display:flex;align-items:center;gap:10px;padding:6px 0;}
.inv-toggle{position:relative;width:38px;height:20px;}
.inv-toggle input{opacity:0;width:0;height:0;}
.inv-toggle-sl{position:absolute;inset:0;background:${T.border};border-radius:20px;cursor:pointer;transition:.2s;}
.inv-toggle-sl:before{content:'';position:absolute;width:14px;height:14px;left:3px;top:3px;background:${T.textSub};border-radius:50%;transition:.2s;}
input:checked+.inv-toggle-sl{background:${T.accent};}
input:checked+.inv-toggle-sl:before{transform:translateX(18px);background:white;}
.inv-photo-zone{border:2px dashed ${T.border};border-radius:8px;background:${T.input};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;cursor:pointer;transition:all .2s;min-height:100px;position:relative;overflow:hidden;}
.inv-photo-zone:hover{border-color:${T.accent};}
.inv-photo-zone.has-photo{border-style:solid;}
.inv-photo-zone img{width:100%;height:100%;object-fit:cover;display:block;}
.inv-photo-actions{position:absolute;top:5px;right:5px;}
.inv-btn{display:inline-flex;align-items:center;gap:5px;padding:8px 16px;border-radius:6px;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;cursor:pointer;border:none;white-space:nowrap;letter-spacing:.5px;transition:all .15s;}
.inv-btn-accent{background:${T.accent};color:white;}.inv-btn-accent:hover{opacity:.9;}
.inv-btn-blue{background:rgba(77,184,255,0.15);color:#4db8ff;border:1px solid rgba(77,184,255,0.3);}.inv-btn-blue:hover{background:rgba(77,184,255,0.25);}
.inv-btn-out{background:transparent;color:${T.textSub};border:1px solid ${T.border};}.inv-btn-out:hover{background:${T.cardHover};color:${T.text};}
.inv-btn-danger{background:rgba(224,92,92,0.12);color:#e05c5c;border:1px solid rgba(224,92,92,0.25);}.inv-btn-danger:hover{background:rgba(224,92,92,0.2);}
.inv-btn-gold{background:#4db8ff;color:white;}.inv-btn-gold:hover{opacity:.9;}
.inv-btn-sm{font-size:11px;padding:5px 11px;}
.inv-rm{background:none;border:none;cursor:pointer;color:${T.textMuted};font-size:16px;padding:0 3px;line-height:1;transition:color .15s;}
.inv-rm:hover{color:#e05c5c;}
.inv-textarea{width:100%;font-family:'Barlow Condensed',sans-serif;font-size:13px;color:${T.text};background:${T.input};border:1.5px solid ${T.border};border-radius:6px;padding:8px 10px;outline:none;resize:vertical;line-height:1.5;}
.inv-textarea:focus{border-color:${T.accent};}
.inv-scen-toggle{display:flex;gap:4px;margin-top:5px;}
.inv-scen-btn{flex:1;padding:4px;border-radius:5px;font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:700;border:1px solid ${T.border};background:transparent;color:${T.textMuted};cursor:pointer;letter-spacing:.5px;}
.inv-scen-btn.active{background:${T.accent};color:white;border-color:${T.accent};}
.inv-badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.5px;}
@media(max-width:768px){
  .inv-grid-2{grid-template-columns:1fr!important;}
  .inv-kpi-bar{grid-template-columns:1fr 1fr!important;}
  .inv-fisca-grid{grid-template-columns:1fr!important;}
}
`;
const CSS = getCSS(THEMES_INV.dark);
// ─── LISTE DES PROJETS ────────────────────────────────────────────────────────
function ListeProjets({ profil, onOuvrir, onNouveauProjet, inline, T=THEMES_INV.dark }) {
  const [projets, setProjets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [suppId, setSuppId]   = useState(null);

  const charger = async () => {
    setLoading(true);
    const { data } = await supabase.from("invest_projets")
      .select("id,nom,created_by,created_at,updated_at,donnees")
      .order("updated_at",{ascending:false});
    setProjets(data||[]);
    setLoading(false);
  };
  useEffect(()=>{charger();},[]);

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
    return (
      <div key={p.id} className="inv-card" style={{padding:"18px 20px",cursor:"pointer",transition:"all .18s"}}
        onClick={()=>onOuvrir(p)}
        onMouseEnter={e=>e.currentTarget.style.borderColor=T.accent}
        onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:10}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              📄 {p.nom}
            </div>
            <div style={{fontSize:11,color:T.textMuted}}>Par {p.created_by} · {fmtDate(p.updated_at)}</div>
          </div>
          <button className="inv-rm" onClick={e=>{e.stopPropagation();setSuppId(p.id);}}>×</button>
        </div>
        {k&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7,marginBottom:10}}>
            {[{label:"Coût total",val:k.total>0?fmt(k.total):"—",color:"#4db8ff"},{label:"Loyers/mois",val:k.loyer>0?fmt(k.loyer):"—",color:"#50c878"},{label:"Lots",val:k.nbLots,color:"#FFC200"}].map(item=>(
              <div key={item.label} style={{background:T.cardHover,borderRadius:7,padding:"7px 9px",borderLeft:`3px solid ${item.color}`}}>
                <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:.5,marginBottom:2}}>{item.label}</div>
                <div style={{fontSize:13,fontWeight:800,color:item.color}}>{item.val}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:10,background:T.cardHover,color:T.textSub,padding:"2px 8px",borderRadius:20,fontWeight:600}}>{fmtDate(p.created_at)}</span>
          <span style={{fontSize:12,color:T.accent,fontWeight:700}}>Ouvrir →</span>
        </div>
      </div>
    );
  };

  const modalSuppr = () => (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
      <div style={{background:"#111318",border:"1px solid #2a2d3a",borderRadius:14,padding:"26px 30px",maxWidth:360,width:"90%",textAlign:"center"}}>
        <div style={{fontSize:34,marginBottom:10}}>🗑️</div>
        <div style={{fontSize:15,fontWeight:800,color:"#e8eaf0",marginBottom:7}}>Supprimer ce projet ?</div>
        <div style={{fontSize:13,color:"rgba(255,255,255,0.4)",marginBottom:22,lineHeight:1.6}}>Cette action est irréversible.</div>
        <div style={{display:"flex",gap:10,justifyContent:"center"}}>
          <button className="inv-btn inv-btn-out" onClick={()=>setSuppId(null)}>Annuler</button>
          <button className="inv-btn inv-btn-danger" onClick={()=>supprimer(suppId)}>Supprimer</button>
        </div>
      </div>
    </div>
  );

  if (inline) return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <div style={{fontSize:13,color:"rgba(255,255,255,0.35)"}}>
          {projets.length} projet{projets.length!==1?"s":""} — partagés avec tous les associés
        </div>
        <button className="inv-btn inv-btn-gold" onClick={onNouveauProjet}>＋ Nouveau projet</button>
      </div>
      {loading ? (
        <div style={{textAlign:"center",padding:"40px 0",color:"rgba(255,255,255,0.3)"}}>Chargement…</div>
      ) : projets.length===0 ? (
        <div style={{textAlign:"center",padding:"60px 20px"}}>
          <div style={{fontSize:40,marginBottom:12}}>🏢</div>
          <div style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:16}}>Aucun projet pour l'instant</div>
          <button className="inv-btn inv-btn-gold" onClick={onNouveauProjet}>＋ Créer un projet</button>
        </div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:14}}>
          {projets.map(p=>renderCard(p))}
        </div>
      )}
      {suppId&&modalSuppr()}
    </div>
  );

  return (
    <div className="inv" style={{position:"fixed",inset:0,zIndex:9999,overflowY:"auto"}}>
      <style>{CSS}</style>
      {/* Header */}
      <div style={{background:"#080a0d",padding:"14px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:10,borderBottom:`1px solid ${T.border}`}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:11,letterSpacing:2,textTransform:"uppercase",color:"rgba(255,194,0,0.5)",fontFamily:"'Barlow Condensed',sans-serif"}}>Profero</span>
          <span style={{fontSize:22,fontWeight:800,color:"white"}}>Invest</span>
          <div style={{width:1,height:20,background:"rgba(255,255,255,0.15)"}}/>
          <span style={{fontSize:13,color:"rgba(255,255,255,0.4)"}}>Portefeuille de projets</span>
        </div>
        <button className="inv-btn inv-btn-gold" onClick={onNouveauProjet}>＋ Nouveau projet</button>
      </div>
      {/* Contenu */}
      <div style={{maxWidth:1100,margin:"0 auto",padding:"28px 24px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:22}}>
          <div>
            <div style={{fontSize:20,fontWeight:800,color:"#e8eaf0",letterSpacing:.3}}>Tous les projets</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.35)",marginTop:2}}>
              {projets.length} projet{projets.length!==1?"s":""} — partagés avec tous les associés
            </div>
          </div>
          <button className="inv-btn inv-btn-out inv-btn-sm" onClick={charger}>↻ Actualiser</button>
        </div>
        {loading ? (
          <div style={{textAlign:"center",padding:"60px 0",color:"rgba(255,255,255,0.3)"}}>Chargement…</div>
        ) : projets.length===0 ? (
          <div style={{textAlign:"center",padding:"80px 20px"}}>
            <div style={{fontSize:48,marginBottom:14}}>🏢</div>
            <div style={{fontSize:18,fontWeight:700,color:T.text,marginBottom:8}}>Aucun projet pour l'instant</div>
            <div style={{fontSize:14,color:T.textSub,marginBottom:22}}>Créez votre premier projet d'investissement</div>
            <button className="inv-btn inv-btn-gold" onClick={onNouveauProjet}>＋ Créer un projet</button>
          </div>
        ) : (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:14}}>
            {projets.map(p=>renderCard(p))}
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
    const payload = {nom, created_by:profil?.email||profil?.nom||"inconnu", updated_at:new Date().toISOString(), donnees:state};
    if(projetIdRef.current){
      await supabase.from("invest_projets").update(payload).eq("id",projetIdRef.current);
    } else {
      const {data} = await supabase.from("invest_projets").insert({...payload,created_at:new Date().toISOString()}).select("id").single();
      if(data?.id) projetIdRef.current=data.id;
    }
    setSaving(false); setSaved(true); setTimeout(()=>setSaved(false),2500);
  },[collectState, nom, profil]);

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

  // ── Champ numérique réutilisable ─────────────────────────────────────────────
  const Num=({value,onChange,style,min,step})=>(
    <input type="number" className="inv-inp" value={value} min={min||0} step={step||1}
      onChange={e=>{onChange(parseFloat(e.target.value)||0);scheduleAutoSave();}}
      style={{width:120,...style}}/>
  );

  // ── Photo handlers ───────────────────────────────────────────────────────────
  const handlePhoto=(i,file)=>{
    if(!file||file.size>5*1024*1024){alert("Photo max 5 Mo");return;}
    const r=new FileReader();
    r.onload=e=>{const p=[...photos];p[i]=e.target.result;setPhotos(p);scheduleAutoSave();};
    r.readAsDataURL(file);
  };

  const PHOTO_LABELS=["Photo principale","Vue intérieure","Vue extérieure","Autre"];

  return (
    <div className="inv" style={{position:"fixed",inset:0,zIndex:9999,display:"flex",flexDirection:"column"}}>
      <style>{CSS}</style>

      {/* Topbar */}
      <div style={{background:"#1a2d4a",borderBottom:"3px solid #c9a84c",padding:"8px 20px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button className="inv-btn inv-btn-out inv-btn-sm" onClick={onRetour}
          style={{color:"rgba(255,255,255,0.7)",borderColor:"rgba(255,255,255,0.2)",background:"rgba(255,255,255,0.06)"}}>
          ← Projets
        </button>
        <div style={{width:1,height:18,background:"rgba(255,255,255,0.15)"}}/>
        <span style={{fontSize:11,letterSpacing:1.5,textTransform:"uppercase",color:"rgba(201,168,76,0.7)"}}>Profero Invest</span>
        <input
          value={nom} onChange={e=>{setNom(e.target.value);scheduleAutoSave();}}
          style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:6,padding:"5px 12px",color:"white",fontFamily:"'Sora',sans-serif",fontSize:14,fontWeight:700,outline:"none",minWidth:200}}
        />
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          {saving&&<span style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>💾 Sync…</span>}
          {saved&&!saving&&<span style={{fontSize:11,color:"#50c878"}}>✓ Sauvegardé</span>}
          <button className="inv-btn inv-btn-sm" style={{background:"rgba(192,57,43,0.15)",color:"#e05c5c",border:"1px solid rgba(192,57,43,0.3)"}} onClick={()=>setShowReset(true)}>🔄 Reset</button>
          <button className="inv-btn inv-btn-sm inv-btn-out" style={{color:"rgba(255,255,255,0.7)",borderColor:"rgba(255,255,255,0.2)",background:"rgba(255,255,255,0.06)"}} onClick={genererFiche}>📄 Fiche PDF</button>
          <button className="inv-btn inv-btn-sm inv-btn-gold" onClick={sauvegarder}>💾 Enregistrer</button>
        </div>
      </div>

      {/* Tabs nav */}
      <div className="inv-tab-nav">
        {[["simulateur","📊 Simulateur"],["budget","🔨 Budget Travaux"],["fiscalite","⚖️ Fiscalité"]].map(([k,l])=>(
          <button key={k} className={`inv-tab-btn${tab===k?" active":""}`} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {/* Contenu scrollable */}
      <div style={{flex:1,overflowY:"auto",background:"#080a0d"}}>

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
                      <div key={label} className="inv-row"><span className="inv-lbl">{label}</span><Num value={val} onChange={set}/></div>
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
                    <div className="inv-row"><span className="inv-lbl">Surface totale (m²)</span><Num value={surface} onChange={setSurface}/></div>
                    <div className="inv-row"><span className="inv-lbl">Prix d'achat / m²</span><span className="inv-val calc">{surface>0?(prixAchat/surface).toFixed(0)+" €/m²":"—"}</span></div>
                    <div className="inv-row"><span className="inv-lbl">Budget travaux TTC (€)</span><Num value={budgetTravaux} onChange={setBudgetTravaux}/></div>
                    <div className="inv-row"><span className="inv-lbl">Honoraires (€)</span><Num value={honoraires} onChange={setHonoraires}/></div>
                    <div className="inv-row"><span className="inv-lbl">Raccordement Enedis (€)</span><Num value={enedis} onChange={setEnedis}/></div>
                    <div className="inv-row total"><span className="inv-lbl bold">COÛT TOTAL OPÉRATION</span><span className="inv-val green">{fmt(coutTotal)}</span></div>
                  </div>
                </div>

                {/* C — Charges */}
                <div className="inv-card">
                  <div className="inv-card-hd mid">📋 C — Charges d'Exploitation</div>
                  <div className="inv-card-bd">
                    {[["Taxe foncière (€/an)",taxeFonciere,setTaxeFonciere],["Assurance PNO (€/an)",assurance,setAssurance],["Comptabilité société (€/an)",compta,setCompta],["Provisions travaux (€/an)",provisions,setProvisions]].map(([l,v,s])=>(
                      <div key={l} className="inv-row"><span className="inv-lbl">{l}</span><Num value={v} onChange={s}/></div>
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

  const KPI = ({ label, value, color }) => (
    <div className="inv-kpi" style={{ borderLeft:`3px solid ${color||"#FFC200"}` }}>
      <div className="inv-kpi-lbl">{label}</div>
      <div className="inv-kpi-val" style={{ color: color||"#FFC200", fontSize:26 }}>{value}</div>
    </div>
  );

  return (
    <div style={{ padding:"24px 28px", maxWidth:1200, margin:"0 auto" }}>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:26, fontWeight:800, color:T.text, letterSpacing:.5 }}>Tableau de bord</div>
        <div style={{ fontSize:14, color:T.textSub, marginTop:3 }}>Vue globale de l'activité Profero Invest</div>
      </div>

      {loading ? (
        <div style={{ textAlign:"center", padding:"60px 0", color:T.textMuted }}>Chargement…</div>
      ) : stats && (
        <>
          <div style={{ fontSize:11, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:2, marginBottom:12 }}>👥 Clients & Prospects</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:12, marginBottom:28 }}>
            <KPI icon="🔵" label="Prospects"          value={stats.prospects}       color="#4db8ff" />
            <KPI icon="🟢" label="Clients actifs"     value={stats.actifs}          color="#50c878" />
            <KPI icon="🟡" label="Clients inactifs"   value={stats.inactifs}        color="#FFC200" />
            <KPI icon="⚫" label="Terminés"           value={stats.termines}        color="rgba(255,255,255,0.4)" />
            <KPI icon="✅" label="Total signés"       value={stats.totalSignes}     color="#50c878" />
            <KPI icon="💰" label="Budget total signé" value={stats.sommeBudgets > 0 ? fmt(stats.sommeBudgets)+" €" : "—"} color="#FFC200" />
            <KPI icon="⚠️" label="Sans prochaine action" value={stats.sansProchaineAction} color="#e05c5c" />
            <KPI icon="📋" label="Moy. biens / client" value={stats.moyBiensParClient} color="#c084fc" />
          </div>

          <div style={{ fontSize:11, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:2, marginBottom:12 }}>🏠 Stock de Biens</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:12 }}>
            <KPI icon="🏘️" label="Biens en stock"       value={stats.biensTotaux}      color="#4db8ff" />
            <KPI icon="🔔" label="À relancer"            value={stats.biensARelancer}   color="#e05c5c" />
            <KPI icon="📅" label="Visites programmées"   value={stats.visitesProg}      color="#50c878" />
            <KPI icon="📨" label="Offres envoyées"       value={stats.offreEnvoyees}    color="#FFC200" />
            <KPI icon="🎉" label="Offres acceptées"      value={stats.offresAcceptees}  color="#50c878" />
            <KPI icon="🔗" label="Propositions totales"  value={stats.nbPropositions}   color="#c084fc" />
          </div>
        </>
      )}
    </div>
  );
}

// ─── CRM CLIENTS ──────────────────────────────────────────────────────────────
const STATUTS_CLIENT  = ["Prospect","Actif","Inactif","Terminé"];
const SOURCES_CLIENT  = ["Fluidify","Réseau personnel","Cold calling","Autre"];
const TYPES_NOTE      = ["appel","rendez-vous","relance","commentaire","document","autre"];
const STATUTS_PROP    = ["proposé","intéressé","refusé","en analyse","offre en cours"];

function CRM({ profil, T=THEMES_INV.dark }) {
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

  if (ficheId) return <FicheClient id={ficheId} profil={profil} T={T} onRetour={() => { setFicheId(null); charger(); }} />;

  return (
    <div style={{ padding:"24px 28px", maxWidth:1400, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:10 }}>
        <div>
          <div style={{ fontSize:26, fontWeight:800, color:T.text, letterSpacing:.5 }}>CRM Clients / Prospects</div>
          <div style={{ fontSize:13, color:T.textSub, marginTop:3 }}>{filtered.length} contact{filtered.length!==1?"s":""}</div>
        </div>
        <button className="inv-btn inv-btn-gold" onClick={() => setShowForm(true)}>＋ Nouveau contact</button>
      </div>

      {/* Filtres */}
      <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        <input className="inv-inp" placeholder="🔍 Rechercher…" value={search} onChange={e=>setSearch(e.target.value)}
          style={{ width:200, textAlign:"left", fontSize:13 }}/>
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
        <div style={{ textAlign:"center", padding:"40px 0", color:T.textMuted }}>Chargement…</div>
      ) : (
        <div style={{ background:T.card, borderRadius:10, border:`1px solid ${T.border}`, overflow:"hidden" }}>
          <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr 1fr 80px", padding:"10px 16px", background:T.sectionHd, borderBottom:`1px solid ${T.border}`, fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:.6 }}>
            <div>Contact</div><div>Statut</div><div>Budget</div><div>Conseiller</div><div>Étape</div><div>Prochaine action</div><div/>
          </div>
          {filtered.length === 0 ? (
            <div style={{ textAlign:"center", padding:"40px 0", color:T.textMuted, fontSize:14 }}>Aucun contact trouvé</div>
          ) : filtered.map(c => (
            <div key={c.id} style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr 1fr 80px", padding:"12px 16px", borderBottom:`1px solid ${T.border}`, alignItems:"center", cursor:"pointer", transition:"background .12s" }}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}
              onClick={() => setFicheId(c.id)}>
              <div>
                <div style={{ fontWeight:700, color:T.text, fontSize:14 }}>{c.prenom} {c.nom}</div>
                <div style={{ fontSize:11, color:T.textMuted }}>{c.email || c.telephone || "—"}</div>
              </div>
              <div><span style={{ background:`${STATUT_COLORS[c.statut]}18`, color:STATUT_COLORS[c.statut], border:`1px solid ${STATUT_COLORS[c.statut]}33`, borderRadius:20, padding:"2px 10px", fontSize:11, fontWeight:700 }}>{c.statut}</span></div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:600, color:T.accent }}>{fmtBudget(c.budget)}</div>
              <div style={{ fontSize:13, color:T.textSub }}>{c.conseiller||"—"}</div>
              <div style={{ fontSize:12, color:T.textSub }}>{c.etape||"—"}</div>
              <div style={{ fontSize:12, color: c.date_prochaine_action && c.date_prochaine_action < new Date().toISOString().slice(0,10) ? "#e05c5c" : "rgba(255,255,255,0.45)" }}>
                {fmtDate(c.date_prochaine_action)}
                {c.prochaine_action && <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginTop:1 }}>{c.prochaine_action.slice(0,30)}</div>}
              </div>
              <div style={{ textAlign:"right" }}>
                <span style={{ fontSize:12, color:T.accent, fontWeight:700 }}>Ouvrir →</span>
              </div>
            </div>
          ))}
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
    const payload = { ...form, budget: parseFloat(form.budget)||0, updated_at: new Date().toISOString() };
    if (isEdit) {
      await supabase.from("invest_clients").update(payload).eq("id", client.id);
    } else {
      await supabase.from("invest_clients").insert(payload);
    }
    setSaving(false);
    onSave();
  };

  const F = ({ label, children }) => (
    <div style={{ marginBottom:14 }}>
      <label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>{label}</label>
      {children}
    </div>
  );

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 }}>
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, padding:"28px 30px", width:"90%", maxWidth:580, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 30px 80px rgba(0,0,0,.5)" }}>
        <div style={{ fontSize:17, fontWeight:800, color:T.text, marginBottom:20 }}>{isEdit ? "Modifier le contact" : "Nouveau contact"}</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 16px" }}>
          <F label="Nom *"><input className="inv-inp" value={form.nom} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,nom:e.target.value})}/></F>
          <F label="Prénom"><input className="inv-inp" value={form.prenom} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,prenom:e.target.value})}/></F>
          <F label="Email"><input className="inv-inp" type="email" value={form.email} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,email:e.target.value})}/></F>
          <F label="Téléphone"><input className="inv-inp" value={form.telephone} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,telephone:e.target.value})}/></F>
          <F label="Conseiller référent"><input className="inv-inp" value={form.conseiller} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,conseiller:e.target.value})}/></F>
          <F label="Source">
            <select className="inv-sel" value={form.source} style={{ width:"100%" }} onChange={e=>setForm({...form,source:e.target.value})}>
              {SOURCES_CLIENT.map(s=><option key={s}>{s}</option>)}
            </select>
          </F>
          <F label="Statut">
            <select className="inv-sel" value={form.statut} style={{ width:"100%" }} onChange={e=>setForm({...form,statut:e.target.value})}>
              {STATUTS_CLIENT.map(s=><option key={s}>{s}</option>)}
            </select>
          </F>
          <F label="Budget (€)"><input className="inv-inp" type="number" value={form.budget} style={{ width:"100%" }} onChange={e=>setForm({...form,budget:e.target.value})}/></F>
          <F label="Étape en cours"><input className="inv-inp" value={form.etape} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,etape:e.target.value})}/></F>
          <F label="Date prochaine action"><input className="inv-inp" type="date" value={form.date_prochaine_action} style={{ width:"100%" }} onChange={e=>setForm({...form,date_prochaine_action:e.target.value})}/></F>
        </div>
        <F label="Prochaine action"><input className="inv-inp" value={form.prochaine_action} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,prochaine_action:e.target.value})}/></F>
        <F label="Notes rapides"><textarea className="inv-textarea" rows={3} value={form.notes_rapides} onChange={e=>setForm({...form,notes_rapides:e.target.value})}/></F>
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

function FicheClient({ id, profil, onRetour, T=THEMES_INV.dark }) {
  const [client, setClient]   = useState(null);
  const [notes, setNotes]     = useState([]);
  const [props, setProps]     = useState([]);
  const [showEdit, setShowEdit] = useState(false);
  const [newNote, setNewNote] = useState({ type:"commentaire", contenu:"" });
  const [savingNote, setSavingNote] = useState(false);

  const charger = async () => {
    const [{ data: c }, { data: n }, { data: p }] = await Promise.all([
      supabase.from("invest_clients").select("*").eq("id", id).single(),
      supabase.from("invest_notes").select("*").eq("client_id", id).order("date", { ascending: false }),
      supabase.from("invest_propositions").select("*, bien:invest_biens(adresse,ville,statut)").eq("client_id", id).order("created_at", { ascending: false }),
    ]);
    setClient(c); setNotes(n||[]); setProps(p||[]);
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
          <div style={{ fontSize:22, fontWeight:800, color:"#1a2d4a" }}>{client.prenom} {client.nom}</div>
          <div style={{ fontSize:13, color:"#9aa0b0", marginTop:2 }}>{client.email} {client.telephone ? `· ${client.telephone}` : ""}</div>
        </div>
        <span style={{ background:`${STATUT_COLORS[client.statut]}18`, color:STATUT_COLORS[client.statut], border:`1px solid ${STATUT_COLORS[client.statut]}33`, borderRadius:20, padding:"4px 14px", fontSize:12, fontWeight:700 }}>{client.statut}</span>
        <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => setShowEdit(true)}>✏️ Modifier</button>
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
            <div className="inv-card-hd">🏠 Biens proposés ({props.length})</div>
            <div className="inv-card-bd">
              {props.length === 0 ? (
                <div style={{ fontSize:13, color:"#9aa0b0", fontStyle:"italic" }}>Aucun bien proposé</div>
              ) : props.map(p => (
                <div key={p.id} style={{ padding:"8px 0", borderBottom:`1px solid ${T.border}` }}>
                  <div style={{ fontWeight:600, fontSize:13, color:T.text }}>{p.bien?.adresse||"Bien"} {p.bien?.ville ? `— ${p.bien.ville}` : ""}</div>
                  <div style={{ fontSize:11, color:T.textMuted, marginTop:2 }}>
                    {new Date(p.date_proposition).toLocaleDateString("fr-FR")} · {p.statut}
                    {p.commentaire && ` · ${p.commentaire}`}
                  </div>
                </div>
              ))}
            </div>
          </div>
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
    <div style={{ padding:"24px 28px", maxWidth:1400, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:10 }}>
        <div>
          <div style={{ fontSize:26, fontWeight:800, color:T.text, letterSpacing:.5 }}>Stock de Biens</div>
          <div style={{ fontSize:13, color:"#9aa0b0", marginTop:3 }}>
            {filtered.length} bien{filtered.length!==1?"s":""}
            {aRelancer > 0 && <span style={{ marginLeft:10, color:"#e05c5c", fontWeight:700 }}>· 🔔 {aRelancer} à relancer</span>}
          </div>
        </div>
        <button className="inv-btn inv-btn-gold" onClick={() => setShowForm(true)}>＋ Nouveau bien</button>
      </div>

      {/* Filtres */}
      <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        <input className="inv-inp" placeholder="🔍 Rechercher…" value={search} onChange={e=>setSearch(e.target.value)}
          style={{ width:200, textAlign:"left", fontSize:13 }}/>
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
        <button className="inv-btn inv-btn-out inv-btn-sm" style={{ color:"#c0392b", borderColor:"rgba(192,57,43,.3)" }}
          onClick={() => { setFiltreStatut("À relancer"); setSortBy("relance"); }}>
          🔔 Voir à relancer
        </button>
      </div>

      {/* Liste */}
      {loading ? (
        <div style={{ textAlign:"center", padding:"40px 0", color:T.textMuted }}>Chargement…</div>
      ) : (
        <div style={{ background:T.card, borderRadius:10, border:`1px solid ${T.border}`, overflow:"hidden" }}>
          <div style={{ display:"grid", gridTemplateColumns:"2fr 1.2fr 1fr 1fr 1fr 1fr 80px", padding:"10px 16px", background:T.sectionHd, borderBottom:`1px solid ${T.border}`, fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:.6 }}>
            <div>Bien</div><div>Statut</div><div>Coût total</div><div>Rendement</div><div>Cash-flow</div><div>Relance</div><div/>
          </div>
          {filtered.length === 0 ? (
            <div style={{ textAlign:"center", padding:"40px 0", color:T.textMuted, fontSize:14 }}>Aucun bien trouvé</div>
          ) : filtered.map(b => (
            <div key={b.id} style={{ display:"grid", gridTemplateColumns:"2fr 1.2fr 1fr 1fr 1fr 1fr 80px", padding:"12px 16px", borderBottom:`1px solid ${T.border}`, alignItems:"center", cursor:"pointer", transition:"background .12s" }}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}
              onClick={() => setFicheId(b.id)}>
              <div>
                <div style={{ fontWeight:700, color:T.text, fontSize:14 }}>{b.adresse||"Adresse non renseignée"}</div>
                <div style={{ fontSize:11, color:T.textMuted }}>{b.ville||""}{b.agence ? ` · ${b.agence}` : ""}</div>
              </div>
              <div>
                <span style={{ background:`${STATUT_BIEN_COLORS[b.statut]||"#9aa0b0"}18`, color:STATUT_BIEN_COLORS[b.statut]||"#9aa0b0", border:`1px solid ${STATUT_BIEN_COLORS[b.statut]||"#9aa0b0"}33`, borderRadius:20, padding:"2px 8px", fontSize:10, fontWeight:700, whiteSpace:"nowrap" }}>{b.statut}</span>
              </div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, color:T.textSub }}>{fmtEur(b.cout_total)}</div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:700, color: b.rendement_brut >= 8 ? "#1a7a4a" : b.rendement_brut >= 5 ? "#c9a84c" : "#9aa0b0" }}>
                {b.rendement_brut > 0 ? b.rendement_brut.toFixed(1)+"%" : "—"}
              </div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color: (b.cashflow_estime||0) > 0 ? "#1a7a4a" : (b.cashflow_estime||0) < 0 ? "#c0392b" : "#9aa0b0" }}>
                {b.cashflow_estime ? fmtEur(b.cashflow_estime)+"/mois" : "—"}
              </div>
              <div style={{ fontSize:12, color: b.date_relance && b.date_relance <= today ? "#c0392b" : "#5a6070", fontWeight: b.date_relance && b.date_relance <= today ? 700 : 400 }}>
                {fmtDate(b.date_relance)}
              </div>
              <div style={{ textAlign:"right" }}><span style={{ fontSize:12, color:"#1f4ea1", fontWeight:700 }}>Ouvrir →</span></div>
            </div>
          ))}
        </div>
      )}

      {showForm && <FormulaireBien profil={profil} T={T} onSave={() => { setShowForm(false); charger(); }} onClose={() => setShowForm(false)} />}
    </div>
  );
}

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
    const payload = { ...form, updated_at: new Date().toISOString() };
    Object.keys(payload).forEach(k => { if (typeof payload[k] === "string" && payload[k] === "" && ["prix_vente","prix_travaux","cout_total","rendement_brut","cashflow_estime","montant_offre"].includes(k)) payload[k] = 0; });
    if (isEdit) {
      await supabase.from("invest_biens").update(payload).eq("id", bien.id);
    } else {
      await supabase.from("invest_biens").insert(payload);
    }
    setSaving(false);
    onSave();
  };

  const F = ({ label, children, col }) => (
    <div style={{ marginBottom:12, gridColumn: col }}>
      <label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>{label}</label>
      {children}
    </div>
  );
  const I = (props) => <input className="inv-inp" {...props} style={{ width:"100%", textAlign:"left", ...props.style }}/>;
  const N = (props) => <input className="inv-inp" type="number" {...props} style={{ width:"100%", ...props.style }}/>;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 }}>
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, padding:"28px 30px", width:"90%", maxWidth:680, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 30px 80px rgba(0,0,0,.5)" }}>
        <div style={{ fontSize:17, fontWeight:800, color:T.text, marginBottom:20 }}>{isEdit ? "Modifier le bien" : "Nouveau bien"}</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 16px" }}>
          <F label="Adresse" col="1 / 3"><I value={form.adresse} onChange={e=>setForm({...form,adresse:e.target.value})} placeholder="123 rue de la Paix"/></F>
          <F label="Ville"><I value={form.ville} onChange={e=>setForm({...form,ville:e.target.value})}/></F>
          <F label="Code postal"><I value={form.code_postal} onChange={e=>setForm({...form,code_postal:e.target.value})}/></F>
          <F label="Interlocuteur"><I value={form.interlocuteur} onChange={e=>setForm({...form,interlocuteur:e.target.value})}/></F>
          <F label="Téléphone"><I value={form.telephone_interlocuteur} onChange={e=>setForm({...form,telephone_interlocuteur:e.target.value})}/></F>
          <F label="Agence"><I value={form.agence} onChange={e=>setForm({...form,agence:e.target.value})}/></F>
          <F label="Statut">
            <select className="inv-sel" value={form.statut} style={{ width:"100%" }} onChange={e=>setForm({...form,statut:e.target.value})}>
              {STATUTS_BIEN.map(s=><option key={s}>{s}</option>)}
            </select>
          </F>
          <F label="Prix de vente (€)"><N value={form.prix_vente} onChange={e=>setForm({...form,prix_vente:e.target.value})}/></F>
          <F label="Prix travaux (€)"><N value={form.prix_travaux} onChange={e=>setForm({...form,prix_travaux:e.target.value})}/></F>
          <F label="Coût total (€)"><N value={form.cout_total} onChange={e=>setForm({...form,cout_total:e.target.value})}/></F>
          <F label="Rendement brut (%)"><N value={form.rendement_brut} step="0.1" onChange={e=>setForm({...form,rendement_brut:e.target.value})}/></F>
          <F label="Cash-flow estimé (€/mois)"><N value={form.cashflow_estime} onChange={e=>setForm({...form,cashflow_estime:e.target.value})}/></F>
          <F label="Montant offre (€)"><N value={form.montant_offre} onChange={e=>setForm({...form,montant_offre:e.target.value})}/></F>
          <F label="Date visite"><I type="date" value={form.date_visite} onChange={e=>setForm({...form,date_visite:e.target.value})}/></F>
          <F label="Date relance"><I type="date" value={form.date_relance} onChange={e=>setForm({...form,date_relance:e.target.value})}/></F>
          <F label="Lien annonce" col="1 / 3"><I value={form.lien_annonce} onChange={e=>setForm({...form,lien_annonce:e.target.value})} placeholder="https://…"/></F>
          <F label="Lien Drive"><I value={form.lien_drive} onChange={e=>setForm({...form,lien_drive:e.target.value})} placeholder="https://…"/></F>
          <F label="Lien dossier rentabilité"><I value={form.lien_rentabilite} onChange={e=>setForm({...form,lien_rentabilite:e.target.value})} placeholder="https://…"/></F>
          <F label="Commentaire" col="1 / 3"><textarea className="inv-textarea" rows={3} value={form.commentaire} onChange={e=>setForm({...form,commentaire:e.target.value})}/></F>
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
          <div style={{ fontSize:22, fontWeight:800, color:"#1a2d4a" }}>{bien.adresse||"Bien sans adresse"}</div>
          <div style={{ fontSize:13, color:"#9aa0b0", marginTop:2 }}>{bien.ville||""}{bien.code_postal ? ` ${bien.code_postal}` : ""}{bien.agence ? ` · ${bien.agence}` : ""}</div>
        </div>
        <span style={{ background:`${couleur}18`, color:couleur, border:`1px solid ${couleur}33`, borderRadius:20, padding:"4px 14px", fontSize:12, fontWeight:700 }}>{bien.statut}</span>
        <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => setShowEdit(true)}>✏️ Modifier</button>
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
        </div>

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
function SidebarInvest({ page, setPage, theme, setTheme, profil }) {
  const isAdmin = profil?.role === "admin";
  const NAV = [
    { id:"dashboard",  icon:"⊞",  label:"Tableau de bord" },
    { id:"crm",        icon:"👥", label:"CRM Clients" },
    { id:"biens",      icon:"🏠", label:"Stock de biens" },
    { id:"simulateur", icon:"📐", label:"Simulateur" },
    ...(isAdmin ? [{ id:"admin", icon:"⚙️", label:"Réglages" }] : []),
  ];
  return (
    <div style={{ width:220, flexShrink:0, background:"#0c0e14", borderRight:"1px solid #1e2130", display:"flex", flexDirection:"column", height:"100%", overflowY:"auto" }}>
      <div style={{ padding:"18px 16px 14px", borderBottom:"1px solid #1e2130" }}>
        <div style={{ fontSize:10, letterSpacing:3, textTransform:"uppercase", color:"rgba(255,194,0,0.5)", marginBottom:4, fontFamily:"'Barlow Condensed',sans-serif" }}>Profero</div>
        <div style={{ fontSize:22, fontWeight:800, color:"#e8eaf0", fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:.5 }}>Invest</div>
      </div>
      <nav style={{ padding:"8px 8px", flex:1 }}>
        {NAV.map(n => (
          <button key={n.id} onClick={() => setPage(n.id)}
            style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"11px 14px", borderRadius:10, border:"none", cursor:"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontSize:15, fontWeight:700, letterSpacing:.3, background: page===n.id ? "rgba(77,184,255,0.12)" : "transparent", color: page===n.id ? "#4db8ff" : "rgba(255,255,255,0.4)", marginBottom:4, textAlign:"left", transition:"all .12s" }}>
            <span style={{ fontSize:20, width:24, textAlign:"center", flexShrink:0 }}>{n.icon}</span>
            <span>{n.label}</span>
            {page===n.id && <span style={{ marginLeft:"auto", width:4, height:18, borderRadius:2, background:"#4db8ff", display:"block", flexShrink:0 }}/>}
          </button>
        ))}
      </nav>
      <div style={{ padding:"12px 14px", borderTop:"1px solid #1e2130", display:"flex", flexDirection:"column", gap:8 }}>
        <button onClick={() => { const n = theme==="dark"?"light":"dark"; setTheme(n); localStorage.setItem("invest_theme",n); }}
          style={{ width:"100%", background:"rgba(77,184,255,0.1)", border:"1px solid rgba(77,184,255,0.2)", borderRadius:8, padding:"8px 12px", color:"#4db8ff", fontFamily:"'Barlow Condensed',sans-serif", fontSize:13, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:8, letterSpacing:.5 }}>
          {theme==="dark" ? "☀️ Mode clair" : "🌙 Mode sombre"}
        </button>
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.2)", lineHeight:1.5, fontFamily:"'Barlow Condensed',sans-serif" }}>
          {new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}
        </div>
      </div>
    </div>
  );
}

// ─── PAGE INVEST (routeur interne) ────────────────────────────────────────────
export default function PageInvest({ profil }) {
  const [theme, setTheme] = useState(() => localStorage.getItem("invest_theme") || "dark");
  const T = THEMES_INV[theme];
  const CSS = getCSS(T);
  const [page, setPage]                 = useState("dashboard");
  const [projetOuvert, setProjetOuvert] = useState(null);
  const [vueSim, setVueSim]             = useState("liste");

  const ouvrirProjet  = (p) => { setProjetOuvert(p); setVueSim("simulateur"); };
  const nouveauProjet = ()  => { setProjetOuvert(null); setVueSim("simulateur"); };

  // Simulateur plein écran — uniquement quand une fiche projet est ouverte
  if (page === "simulateur" && vueSim === "simulateur") {
    return (
      <div className="inv" style={{ position:"fixed", inset:0, zIndex:9999 }}>
        <style>{CSS}</style>
        <Simulateur projet={projetOuvert} profil={profil} onRetour={() => setVueSim("liste")} />
      </div>
    );
  }

  return (
    <div className="inv" style={{ position:"fixed", inset:0, zIndex:9999, display:"flex", background:T.bg }}>
      <style>{CSS}</style>
      <SidebarInvest page={page} setPage={setPage} theme={theme} setTheme={setTheme} profil={profil} />
      <div style={{ flex:1, overflowY:"auto", background:T.bg }}>
        {page === "dashboard"  && <TableauBord profil={profil} T={T} />}
        {page === "crm"        && <CRM profil={profil} T={T} />}
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
