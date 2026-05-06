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

// ─── CSS INVEST ───────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Sora:wght@300;400;600;700;800&display=swap');
.inv *{box-sizing:border-box;margin:0;padding:0;}
.inv{font-family:'Sora',sans-serif;background:#f8f9fb;color:#2c3040;font-size:13px;}
.inv ::-webkit-scrollbar{width:5px;height:5px;}
.inv ::-webkit-scrollbar-thumb{background:#d8dce6;border-radius:3px;}
.inv-card{background:white;border-radius:10px;box-shadow:0 1px 4px rgba(15,30,53,.06);border:1px solid #eef0f5;overflow:hidden;}
.inv-card-hd{background:#1a2d4a;color:white;padding:10px 16px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;display:flex;align-items:center;gap:8px;}
.inv-card-hd.mid{background:#1e3a5f;}.inv-card-hd.gold{background:#c9a84c;color:#1a2d4a;}.inv-card-hd.danger{background:#c0392b;}.inv-card-hd.blue{background:#1f4ea1;}
.inv-card-bd{padding:14px 16px;}
.inv-row{display:grid;grid-template-columns:1fr auto;align-items:center;padding:6px 0;border-bottom:1px solid #eef0f5;gap:12px;}
.inv-row:last-child{border-bottom:none;}.inv-row.total{border-top:2px solid #1a2d4a;margin-top:4px;padding-top:8px;border-bottom:none;}.inv-row.sub{background:#f8f9fb;margin:0 -16px;padding:6px 16px;}
.inv-lbl{font-size:12px;color:#5a6070;}.inv-lbl.bold{font-weight:700;color:#2c3040;}
.inv-val{font-family:'DM Mono',monospace;font-size:13px;text-align:right;font-weight:500;white-space:nowrap;}
.inv-val.calc{color:#1e3a5f;}.inv-val.green{color:#1a7a4a;font-weight:700;}.inv-val.orange{color:#d4610a;font-weight:700;}.inv-val.red{color:#c0392b;font-weight:700;}
.inv-inp{font-family:'DM Mono',monospace;font-size:13px;font-weight:500;color:#0033aa;background:#fffef5;border:1.5px solid #c9a84c;border-radius:6px;padding:5px 10px;text-align:right;outline:none;}
.inv-inp:focus{border-color:#2a7fd4;box-shadow:0 0 0 3px rgba(42,127,212,.12);}
.inv-sel{font-family:'Sora',sans-serif;font-size:12px;color:#2c3040;background:white;border:1.5px solid #d8dce6;border-radius:6px;padding:5px 10px;outline:none;cursor:pointer;}
.inv-sel:focus{border-color:#1f4ea1;}
.inv-kpi{background:white;border-radius:10px;padding:14px 16px;border:1px solid #eef0f5;box-shadow:0 1px 4px rgba(15,30,53,.06);display:flex;flex-direction:column;gap:4px;}
.inv-kpi-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#9aa0b0;}
.inv-kpi-val{font-family:'DM Mono',monospace;font-size:20px;font-weight:700;color:#1a2d4a;}
.inv-kpi-val.green{color:#1a7a4a;}.inv-kpi-val.orange{color:#d4610a;}.inv-kpi-val.red{color:#c0392b;}
.inv-tab-nav{background:#1a2d4a;display:flex;padding:0 24px;gap:2px;border-bottom:2px solid #1e3a5f;flex-shrink:0;}
.inv-tab-btn{padding:11px 20px;font-family:'Sora',sans-serif;font-size:12px;font-weight:600;color:#9aa0b0;background:transparent;border:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;}
.inv-tab-btn:hover{color:white;}.inv-tab-btn.active{color:#c9a84c;border-bottom-color:#c9a84c;}
.inv-scen-hd{display:grid;grid-template-columns:1fr 110px 110px;padding:8px 16px;background:#1e3a5f;font-size:11px;font-weight:700;color:white;letter-spacing:.04em;}
.inv-scen-row{display:grid;grid-template-columns:1fr 110px 110px;align-items:center;padding:6px 16px;border-bottom:1px solid #eef0f5;gap:8px;}
.inv-scen-row:last-child{border-bottom:none;}.inv-scen-row.hl{background:#e6f5ee;}.inv-scen-row.warn{background:#fef3e9;}
.inv-s{font-family:'DM Mono',monospace;font-size:13px;text-align:right;font-weight:500;}
.inv-s.green{color:#1a7a4a;font-weight:700;}.inv-s.orange{color:#d4610a;font-weight:700;}
.inv-lot-grid{display:grid;grid-template-columns:90px 75px 75px 95px 70px 65px 70px 1fr 55px;gap:5px;align-items:center;padding:5px 0;border-bottom:1px solid #eef0f5;min-width:680px;}
.inv-lot-grid.hd{font-size:10px;font-weight:700;color:#9aa0b0;letter-spacing:.05em;text-transform:uppercase;padding-bottom:7px;border-bottom:2px solid #d8dce6;}
.inv-lot-grid input,.inv-lot-grid select{width:100%;}
.inv-lot-val{font-family:'DM Mono',monospace;font-size:12px;text-align:right;color:#5a6070;}
.inv-add-lot{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:8px;padding:7px;background:#f8f9fb;border:1.5px dashed #d8dce6;border-radius:6px;cursor:pointer;font-family:'Sora',sans-serif;font-size:12px;font-weight:600;color:#1f4ea1;width:100%;}
.inv-add-lot:hover{background:#eef0f5;border-color:#1f4ea1;}
.inv-brow{display:grid;grid-template-columns:1fr 60px 65px 75px 80px;padding:4px 0;border-bottom:1px solid #eef0f5;align-items:center;gap:5px;}
.inv-brow.hd{font-size:10px;font-weight:700;color:#9aa0b0;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #d8dce6;padding-bottom:7px;}
.inv-brow .bl{font-size:12px;color:#5a6070;}
.inv-brow .bn{font-family:'DM Mono',monospace;font-size:12px;text-align:right;}
.inv-brow input{width:100%;}
.inv-bsec{background:#1e3a5f;color:white;padding:6px 14px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin:8px -16px 3px;display:flex;align-items:center;gap:5px;}
.inv-regime{background:white;border-radius:10px;border:1px solid #eef0f5;overflow:hidden;box-shadow:0 1px 4px rgba(15,30,53,.06);}
.inv-regime-hd{padding:11px 14px;font-size:12px;font-weight:700;color:white;}
.inv-regime-hd.is{background:#1e3a5f;}.inv-regime-hd.ir{background:#6b3a8a;}.inv-regime-hd.lmnp{background:#1a7a4a;}
.inv-regime-row{display:flex;justify-content:space-between;align-items:center;padding:5px 14px;border-bottom:1px solid #eef0f5;gap:8px;}
.inv-regime-row:last-child{border-bottom:none;}
.inv-regime-row .rl{font-size:11px;color:#5a6070;flex:1;}
.inv-regime-row .rv{font-family:'DM Mono',monospace;font-size:12px;font-weight:600;text-align:right;}
.inv-regime-row.hl{background:#e6f5ee;}.inv-regime-row.warn{background:#fef3e9;}
.inv-toggle-wrap{display:flex;align-items:center;gap:10px;padding:6px 0;}
.inv-toggle{position:relative;width:38px;height:20px;}
.inv-toggle input{opacity:0;width:0;height:0;}
.inv-toggle-sl{position:absolute;inset:0;background:#d8dce6;border-radius:20px;cursor:pointer;transition:.2s;}
.inv-toggle-sl:before{content:'';position:absolute;width:14px;height:14px;left:3px;top:3px;background:white;border-radius:50%;transition:.2s;}
input:checked+.inv-toggle-sl{background:#1f4ea1;}
input:checked+.inv-toggle-sl:before{transform:translateX(18px);}
.inv-photo-zone{border:2px dashed #d8dce6;border-radius:10px;background:#f8f9fb;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;cursor:pointer;transition:all .2s;min-height:110px;position:relative;overflow:hidden;}
.inv-photo-zone:hover{border-color:#1f4ea1;background:#eef0f5;}
.inv-photo-zone.has-photo{border-style:solid;border-color:#d8dce6;padding:0;}
.inv-photo-zone img{width:100%;height:100%;object-fit:cover;display:block;}
.inv-photo-actions{position:absolute;top:5px;right:5px;}
.inv-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:6px;font-family:'Sora',sans-serif;font-size:12px;font-weight:600;cursor:pointer;border:none;white-space:nowrap;}
.inv-btn-blue{background:#1f4ea1;color:white;}.inv-btn-blue:hover{background:#1740c0;}
.inv-btn-gold{background:#c9a84c;color:#1a2d4a;}.inv-btn-gold:hover{background:#d4b55a;}
.inv-btn-out{background:transparent;color:#1a2d4a;border:1.5px solid #d8dce6;}.inv-btn-out:hover{background:#f8f9fb;}
.inv-btn-sm{font-size:11px;padding:4px 9px;}
.inv-rm{background:none;border:none;cursor:pointer;color:#9aa0b0;font-size:15px;padding:0 3px;line-height:1;transition:color .15s;}
.inv-rm:hover{color:#c0392b;}
.inv-textarea{width:100%;font-family:'Sora',sans-serif;font-size:12px;color:#2c3040;background:#f8f9fb;border:1.5px solid #d8dce6;border-radius:6px;padding:7px 10px;outline:none;resize:vertical;line-height:1.5;}
.inv-textarea:focus{border-color:#1f4ea1;}
.inv-scen-toggle{display:flex;gap:5px;margin-top:5px;}
.inv-scen-btn{flex:1;padding:5px;border-radius:6px;font-family:'Sora',sans-serif;font-size:11px;font-weight:700;border:1.5px solid #d8dce6;background:#f8f9fb;color:#9aa0b0;cursor:pointer;}
.inv-scen-btn.active{background:#1f4ea1;color:white;border-color:#1f4ea1;}
@media(max-width:768px){
  .inv-grid-2{grid-template-columns:1fr!important;}
  .inv-kpi-bar{grid-template-columns:1fr 1fr!important;}
  .inv-lot-grid{min-width:600px;}
  .inv-fisca-grid{grid-template-columns:1fr!important;}
}
`;

// ─── LISTE DES PROJETS ────────────────────────────────────────────────────────
function ListeProjets({ profil, onOuvrir, onNouveauProjet }) {
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

  return (
    <div className="inv" style={{position:"fixed",inset:0,zIndex:9999,overflowY:"auto"}}>
      <style>{CSS}</style>
      {/* Header */}
      <div style={{background:"#1a2d4a",padding:"16px 28px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:10}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:11,letterSpacing:2,textTransform:"uppercase",color:"rgba(201,168,76,0.7)"}}>Profero</span>
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
            <div style={{fontSize:20,fontWeight:800,color:"#1a2d4a"}}>Tous les projets</div>
            <div style={{fontSize:13,color:"#9aa0b0",marginTop:2}}>
              {projets.length} projet{projets.length!==1?"s":""} — partagés avec tous les associés
            </div>
          </div>
          <button className="inv-btn inv-btn-out inv-btn-sm" onClick={charger}>↻ Actualiser</button>
        </div>

        {loading ? (
          <div style={{textAlign:"center",padding:"60px 0",color:"#9aa0b0"}}>Chargement…</div>
        ) : projets.length===0 ? (
          <div style={{textAlign:"center",padding:"80px 20px"}}>
            <div style={{fontSize:48,marginBottom:14}}>🏢</div>
            <div style={{fontSize:18,fontWeight:700,color:"#1a2d4a",marginBottom:8}}>Aucun projet pour l'instant</div>
            <div style={{fontSize:14,color:"#9aa0b0",marginBottom:22}}>Créez votre premier projet d'investissement</div>
            <button className="inv-btn inv-btn-blue" onClick={onNouveauProjet}>＋ Créer un projet</button>
          </div>
        ) : (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:16}}>
            {projets.map(p=>{
              const k=kpi(p.donnees);
              return (
                <div key={p.id} className="inv-card" style={{padding:"18px 20px",cursor:"pointer",transition:"all .18s"}}
                  onClick={()=>onOuvrir(p)}
                  onMouseEnter={e=>e.currentTarget.style.borderColor="#1f4ea1"}
                  onMouseLeave={e=>e.currentTarget.style.borderColor="#eef0f5"}>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:10}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:15,fontWeight:700,color:"#1a2d4a",marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        📄 {p.nom}
                      </div>
                      <div style={{fontSize:11,color:"#9aa0b0"}}>Par {p.created_by} · {fmtDate(p.updated_at)}</div>
                    </div>
                    <button className="inv-rm" onClick={e=>{e.stopPropagation();setSuppId(p.id);}}>×</button>
                  </div>
                  {k&&(
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7,marginBottom:10}}>
                      {[{label:"Coût total",val:k.total>0?fmt(k.total):"—",color:"#1f4ea1"},{label:"Loyers/mois",val:k.loyer>0?fmt(k.loyer):"—",color:"#1a7a4a"},{label:"Lots",val:k.nbLots,color:"#c9a84c"}].map(item=>(
                        <div key={item.label} style={{background:"#f8f9fb",borderRadius:7,padding:"7px 9px",borderLeft:`3px solid ${item.color}`}}>
                          <div style={{fontSize:9,color:"#9aa0b0",textTransform:"uppercase",letterSpacing:.5,marginBottom:2}}>{item.label}</div>
                          <div style={{fontSize:13,fontWeight:800,color:item.color}}>{item.val}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:10,background:"#eef0f5",color:"#5a6070",padding:"2px 7px",borderRadius:20,fontWeight:600}}>{fmtDate(p.created_at)}</span>
                    <span style={{fontSize:12,color:"#1f4ea1",fontWeight:700}}>Ouvrir →</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {suppId&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
          <div style={{background:"white",borderRadius:14,padding:"26px 30px",maxWidth:360,width:"90%",textAlign:"center"}}>
            <div style={{fontSize:34,marginBottom:10}}>🗑️</div>
            <div style={{fontSize:15,fontWeight:800,color:"#1a2d4a",marginBottom:7}}>Supprimer ce projet ?</div>
            <div style={{fontSize:13,color:"#5a6070",marginBottom:22,lineHeight:1.6}}>Cette action est irréversible.</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <button className="inv-btn inv-btn-out" onClick={()=>setSuppId(null)}>Annuler</button>
              <button className="inv-btn" style={{background:"#c0392b",color:"white"}} onClick={()=>supprimer(suppId)}>Supprimer</button>
            </div>
          </div>
        </div>
      )}
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
      <div style={{flex:1,overflowY:"auto",background:"#f8f9fb"}}>

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
                      <tr key={i} style={{background:i%2===0?"#f8f9fb":"white"}}>
                        <td style={{padding:8,fontWeight:600,color:"#2c3040",borderBottom:"1px solid #eef0f5"}}>{r[0]}</td>
                        {[1,2,3].map(j=><td key={j} style={{padding:8,textAlign:"center",borderBottom:"1px solid #eef0f5"}}>{r[j]}</td>)}
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
          <div style={{background:"white",borderRadius:14,padding:"26px 30px",maxWidth:380,width:"90%",textAlign:"center"}}>
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

// ─── PAGE INVEST (routeur interne) ────────────────────────────────────────────
export default function PageInvest({ profil }) {
  const [vue, setVue]                   = useState("liste");
  const [projetOuvert, setProjetOuvert] = useState(null);

  const ouvrir  = (p) => { setProjetOuvert(p); setVue("simulateur"); };
  const nouveau = ()  => { setProjetOuvert(null); setVue("simulateur"); };
  const retour  = ()  => { setProjetOuvert(null); setVue("liste"); };

  if (vue === "simulateur") {
    return <Simulateur projet={projetOuvert} profil={profil} onRetour={retour} />;
  }
  return <ListeProjets profil={profil} onOuvrir={ouvrir} onNouveauProjet={nouveau} />;
}
